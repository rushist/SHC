package cluster

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"
)

// InternalHealth represents the response structure of GET /internal/health.
type InternalHealth struct {
	Status        string `json:"status"`
	NodeID        string `json:"node_id"`
	State         string `json:"state"`
	Addr          string `json:"addr"`
	PrimaryKeys   int    `json:"primary_keys"`
	ReplicaKeys   int    `json:"replica_keys"`
	HitCount      uint64 `json:"hit_count"`
	UptimeSeconds int64  `json:"uptime_seconds"`
}

// InternalStats represents the response structure of GET /internal/stats.
type InternalStats struct {
	NodeID        string `json:"node_id"`
	State         string `json:"state"`
	TotalKeys     int    `json:"total_keys"`
	HitCount      uint64 `json:"hit_count"`
	MissCount     uint64 `json:"miss_count"`
	SetCount      uint64 `json:"set_count"`
	DeleteCount   uint64 `json:"delete_count"`
	ExpiredCount  uint64 `json:"expired_count"`
	UptimeSeconds int64  `json:"uptime_seconds"`
}

// PeerStatus holds the live communication status of a remote peer.
type PeerStatus struct {
	Addr        string          `json:"addr"`
	Reachable   bool            `json:"reachable"`
	LatencyMs   int64           `json:"latency_ms"`
	NodeID      string          `json:"node_id,omitempty"`
	State       string          `json:"state,omitempty"`
	Stats       *InternalStats  `json:"stats,omitempty"`
	LastError   string          `json:"last_error,omitempty"`
	LastChecked time.Time       `json:"last_checked"`
}

// PeerManager handles node-to-node HTTP communications.
type PeerManager struct {
	selfNodeID string
	selfAddr   string
	peers      []string
	client     *http.Client
	mu         sync.RWMutex
	peerStates map[string]*PeerStatus
}

// NewPeerManager initializes a peer manager for cluster communications.
func NewPeerManager(selfNodeID, selfAddr string, peers []string, timeout time.Duration) *PeerManager {
	if timeout <= 0 {
		timeout = 2 * time.Second
	}

	pm := &PeerManager{
		selfNodeID: selfNodeID,
		selfAddr:   selfAddr,
		peers:      peers,
		client: &http.Client{
			Timeout: timeout,
		},
		peerStates: make(map[string]*PeerStatus),
	}

	for _, p := range peers {
		pm.peerStates[p] = &PeerStatus{
			Addr:        p,
			Reachable:   false,
			LastChecked: time.Time{},
		}
	}

	return pm
}

// PingPeer tests connectivity to a single peer and retrieves its /internal/health.
func (pm *PeerManager) PingPeer(ctx context.Context, peerAddr string) (*InternalHealth, int64, error) {
	url := fmt.Sprintf("%s/internal/health", peerAddr)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, 0, err
	}

	start := time.Now()
	resp, err := pm.client.Do(req)
	latency := time.Since(start).Milliseconds()
	if err != nil {
		return nil, latency, fmt.Errorf("ping failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, latency, fmt.Errorf("unexpected status code: %d", resp.StatusCode)
	}

	var health InternalHealth
	if err := json.NewDecoder(resp.Body).Decode(&health); err != nil {
		return nil, latency, fmt.Errorf("failed to decode response: %w", err)
	}

	return &health, latency, nil
}

// FetchPeerStats queries a peer's /internal/stats endpoint.
func (pm *PeerManager) FetchPeerStats(ctx context.Context, peerAddr string) (*InternalStats, error) {
	url := fmt.Sprintf("%s/internal/stats", peerAddr)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}

	resp, err := pm.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch stats failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status code: %d", resp.StatusCode)
	}

	var stats InternalStats
	if err := json.NewDecoder(resp.Body).Decode(&stats); err != nil {
		return nil, fmt.Errorf("failed to decode stats: %w", err)
	}

	return &stats, nil
}

// CheckAllPeers concurrently checks the health and stats of all configured peers.
func (pm *PeerManager) CheckAllPeers(ctx context.Context) map[string]*PeerStatus {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	var wg sync.WaitGroup
	results := make(map[string]*PeerStatus, len(pm.peers))
	var mapMu sync.Mutex

	for _, peerAddr := range pm.peers {
		wg.Add(1)
		go func(addr string) {
			defer wg.Done()

			health, latency, err := pm.PingPeer(ctx, addr)
			status := &PeerStatus{
				Addr:        addr,
				LatencyMs:   latency,
				LastChecked: time.Now(),
			}

			if err != nil {
				status.Reachable = false
				status.LastError = err.Error()
			} else {
				status.Reachable = true
				status.NodeID = health.NodeID
				status.State = health.State

				// Fetch full stats if reachable
				if stats, sErr := pm.FetchPeerStats(ctx, addr); sErr == nil {
					status.Stats = stats
				}
			}

			mapMu.Lock()
			results[addr] = status
			pm.peerStates[addr] = status
			mapMu.Unlock()
		}(peerAddr)
	}

	wg.Wait()
	return results
}

// GetPeersStatus returns the last cached status snapshot of all peers.
func (pm *PeerManager) GetPeersStatus() map[string]*PeerStatus {
	pm.mu.RLock()
	defer pm.mu.RUnlock()

	copyMap := make(map[string]*PeerStatus, len(pm.peerStates))
	for k, v := range pm.peerStates {
		copyMap[k] = v
	}
	return copyMap
}

// Peers returns the list of configured peer addresses.
func (pm *PeerManager) Peers() []string {
	return append([]string{}, pm.peers...)
}
