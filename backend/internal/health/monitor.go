package health

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"
)

// NodeState represents the health lifecycle state of a cluster member.
type NodeState string

const (
	StateAlive     NodeState = "ALIVE"
	StateSuspected NodeState = "SUSPECTED"
	StateFailed    NodeState = "FAILED"
)

// MemberInfo describes the state and metadata of a single cluster node.
type MemberInfo struct {
	NodeID         string    `json:"node_id"`
	Addr           string    `json:"addr"`
	State          NodeState `json:"state"`
	LatencyMs      int64     `json:"latency_ms"`
	PrimaryKeys    int       `json:"primary_keys"`
	ReplicaKeys    int       `json:"replica_keys"`
	HitCount       uint64    `json:"hit_count"`
	ManualOverride bool      `json:"manual_override,omitempty"`
	LastSeen       time.Time `json:"last_seen"`
	MissedPings    int       `json:"missed_pings"`
	LastError      string    `json:"last_error,omitempty"`
}

// ClusterView represents the complete membership snapshot returned by GET /cluster.
type ClusterView struct {
	SelfNodeID  string                 `json:"self_node_id"`
	TotalNodes  int                    `json:"total_nodes"`
	AliveNodes  int                    `json:"alive_nodes"`
	FailedNodes int                    `json:"failed_nodes"`
	Members     map[string]*MemberInfo `json:"members"`
	Timestamp   time.Time              `json:"timestamp"`
}

// Config defines timing thresholds for the health monitor.
type Config struct {
	SelfNodeID        string
	SelfAddr          string
	Peers             map[string]string // NodeID -> Addr
	HeartbeatInterval time.Duration
	SuspectTimeout    time.Duration
	FailTimeout       time.Duration
}

// Monitor runs background heartbeats and maintains cluster node states.
type Monitor struct {
	config    Config
	client    *http.Client
	mu        sync.RWMutex
	members   map[string]*MemberInfo
	stopChan  chan struct{}
	listeners []func(nodeID string, oldState, newState NodeState)
}

// NewMonitor initializes a cluster health monitor.
func NewMonitor(cfg Config) *Monitor {
	if cfg.HeartbeatInterval <= 0 {
		cfg.HeartbeatInterval = 1 * time.Second
	}
	if cfg.SuspectTimeout <= 0 {
		cfg.SuspectTimeout = 2 * time.Second
	}
	if cfg.FailTimeout <= 0 {
		cfg.FailTimeout = 4 * time.Second
	}

	m := &Monitor{
		config: cfg,
		client: &http.Client{
			Timeout: 1500 * time.Millisecond,
		},
		members:  make(map[string]*MemberInfo),
		stopChan: make(chan struct{}),
	}

	// Register self as permanently ALIVE
	m.members[cfg.SelfNodeID] = &MemberInfo{
		NodeID:    cfg.SelfNodeID,
		Addr:      cfg.SelfAddr,
		State:     StateAlive,
		LastSeen:  time.Now(),
		LatencyMs: 0,
	}

	// Register peers initially
	for nodeID, addr := range cfg.Peers {
		if nodeID != cfg.SelfNodeID {
			m.members[nodeID] = &MemberInfo{
				NodeID:      nodeID,
				Addr:        addr,
				State:       StateAlive, // Optimistically start as ALIVE, verified on 1st tick
				LastSeen:    time.Now(),
				MissedPings: 0,
			}
		}
	}

	return m
}

// Start launches the background heartbeat loop.
func (m *Monitor) Start() {
	go m.heartbeatLoop()
}

// Stop gracefully stops the monitor.
func (m *Monitor) Stop() {
	select {
	case <-m.stopChan:
	default:
		close(m.stopChan)
	}
}

// AddNode adds or updates a peer in the membership view.
func (m *Monitor) AddNode(nodeID, addr string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if _, exists := m.members[nodeID]; !exists {
		m.members[nodeID] = &MemberInfo{
			NodeID:      nodeID,
			Addr:        addr,
			State:       StateAlive,
			LastSeen:    time.Now(),
			MissedPings: 0,
		}
	} else {
		m.members[nodeID].Addr = addr
	}
}

// OnStateChange registers a callback triggered when any node changes state.
func (m *Monitor) OnStateChange(cb func(nodeID string, oldState, newState NodeState)) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.listeners = append(m.listeners, cb)
}

// GetClusterView returns a snapshot of all cluster members and their states.
func (m *Monitor) GetClusterView() ClusterView {
	m.mu.RLock()
	defer m.mu.RUnlock()

	membersCopy := make(map[string]*MemberInfo, len(m.members))
	aliveCount := 0
	failedCount := 0

	for id, mem := range m.members {
		cpy := *mem
		membersCopy[id] = &cpy
		if mem.State == StateAlive {
			aliveCount++
		} else if mem.State == StateFailed {
			failedCount++
		}
	}

	return ClusterView{
		SelfNodeID:  m.config.SelfNodeID,
		TotalNodes:  len(m.members),
		AliveNodes:  aliveCount,
		FailedNodes: failedCount,
		Members:     membersCopy,
		Timestamp:   time.Now(),
	}
}

// GetNodeState returns the current state of a specific node.
func (m *Monitor) GetNodeState(nodeID string) (NodeState, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	mem, exists := m.members[nodeID]
	if !exists {
		return "", false
	}
	return mem.State, true
}

// SetNodeStateManual forces a node state transition manually (for chaos simulation).
func (m *Monitor) SetNodeStateManual(nodeID string, newState NodeState) bool {
	m.mu.Lock()
	defer m.mu.Unlock()

	mem, exists := m.members[nodeID]
	if !exists {
		return false
	}

	oldState := mem.State
	mem.State = newState
	if newState == StateAlive {
		mem.ManualOverride = false
		mem.LastSeen = time.Now()
		mem.MissedPings = 0
		mem.LastError = ""
	} else if newState == StateFailed {
		mem.ManualOverride = true
		mem.LastError = "Manually marked FAILED by user via dashboard"
	}

	log.Printf("[Health] MANUAL OVERRIDE: Node %s state forced %s -> %s (ManualOverride: %v)", nodeID, oldState, newState, mem.ManualOverride)
	m.notifyStateChange(nodeID, oldState, newState)
	return true
}

func (m *Monitor) heartbeatLoop() {
	ticker := time.NewTicker(m.config.HeartbeatInterval)
	defer ticker.Stop()

	// Initial immediate ping on startup
	m.pingAllPeers()

	for {
		select {
		case <-ticker.C:
			m.pingAllPeers()
		case <-m.stopChan:
			return
		}
	}
}

// PingAllPeers performs one cycle of heartbeats to all configured peers.
func (m *Monitor) pingAllPeers() {
	m.mu.RLock()
	peersToPing := make([]*MemberInfo, 0, len(m.members)-1)
	for id, mem := range m.members {
		if id != m.config.SelfNodeID {
			cpy := *mem
			peersToPing = append(peersToPing, &cpy)
		}
	}
	m.mu.RUnlock()

	var wg sync.WaitGroup
	for _, peer := range peersToPing {
		wg.Add(1)
		go func(p *MemberInfo) {
			defer wg.Done()
			m.pingPeer(p)
		}(peer)
	}
	wg.Wait()
}

func (m *Monitor) pingPeer(peer *MemberInfo) {
	ctx, cancel := context.WithTimeout(context.Background(), m.config.HeartbeatInterval)
	defer cancel()

	url := fmt.Sprintf("%s/internal/health", peer.Addr)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		m.recordFailure(peer.NodeID, err.Error())
		return
	}

	start := time.Now()
	resp, err := m.client.Do(req)
	latency := time.Since(start).Milliseconds()
	if latency <= 0 {
		latency = 1
	}

	if err != nil {
		m.recordFailure(peer.NodeID, err.Error())
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		m.recordFailure(peer.NodeID, fmt.Sprintf("HTTP %d", resp.StatusCode))
		return
	}

	var health struct {
		NodeID      string `json:"node_id"`
		State       string `json:"state"`
		PrimaryKeys int    `json:"primary_keys"`
		ReplicaKeys int    `json:"replica_keys"`
		HitCount    uint64 `json:"hit_count"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&health)

	m.recordSuccess(peer.NodeID, latency, health.PrimaryKeys, health.ReplicaKeys, health.HitCount)
}

func (m *Monitor) recordSuccess(nodeID string, latency int64, pKeys, rKeys int, hits uint64) {
	m.mu.Lock()
	defer m.mu.Unlock()

	mem, exists := m.members[nodeID]
	if !exists {
		return
	}

	mem.LastSeen = time.Now()
	mem.LatencyMs = latency
	mem.PrimaryKeys = pKeys
	mem.ReplicaKeys = rKeys
	mem.HitCount = hits
	mem.MissedPings = 0
	mem.LastError = ""

	// If node was manually marked FAILED for chaos testing, keep it FAILED until user clicks revive
	if mem.ManualOverride && mem.State == StateFailed {
		return
	}

	oldState := mem.State
	mem.State = StateAlive

	if oldState != StateAlive {
		log.Printf("[Heartbeat] Node %s RECOVERED (State: %s -> ALIVE, latency: %dms)", nodeID, oldState, latency)
		m.notifyStateChange(nodeID, oldState, StateAlive)
	}
}

func (m *Monitor) recordFailure(nodeID string, errReason string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	mem, exists := m.members[nodeID]
	if !exists {
		return
	}

	mem.MissedPings++
	mem.LastError = errReason
	elapsed := time.Since(mem.LastSeen)

	oldState := mem.State
	var newState NodeState = oldState

	if elapsed >= m.config.FailTimeout {
		newState = StateFailed
	} else if elapsed >= m.config.SuspectTimeout {
		newState = StateSuspected
	}

	if newState != oldState {
		mem.State = newState
		log.Printf("[Heartbeat] ALERT: Node %s transitioned from %s -> %s (missed pings: %d, elapsed: %v, reason: %s)",
			nodeID, oldState, newState, mem.MissedPings, elapsed.Round(time.Millisecond), errReason)
		m.notifyStateChange(nodeID, oldState, newState)
	}
}

func (m *Monitor) notifyStateChange(nodeID string, oldState, newState NodeState) {
	for _, cb := range m.listeners {
		go cb(nodeID, oldState, newState)
	}
}
