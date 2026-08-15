package failover

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sync/atomic"
	"time"

	"self-healing-cache/internal/hashing"
	"self-healing-cache/internal/health"
)

var (
	ErrNoHealthyNodes = errors.New("failover error: no healthy primary or replica nodes available")
)

// ReadResult wraps the result of a read operation routed through failover logic.
type ReadResult struct {
	Key          string `json:"key"`
	Value        string `json:"value"`
	TTLRemaining int64  `json:"ttl_remaining"`
	Version      uint64 `json:"version"`
	ServedBy     string `json:"served_by"`
	ServedAddr   string `json:"served_addr"`
	IsFailover   bool   `json:"is_failover"`
	PrimaryNode  string `json:"primary_node"`
	PrimaryState string `json:"primary_state"`
	LatencyMs    int64  `json:"latency_ms"`
}

// Stats tracks failover telemetry.
type Stats struct {
	TotalRouted      uint64 `json:"total_routed"`
	DirectHits       uint64 `json:"direct_hits"`
	FailoverHits     uint64 `json:"failover_hits"`
	FailuresCount    uint64 `json:"failures_count"`
}

// Router manages health-aware request routing and automatic replica failover.
type Router struct {
	hashRing      *hashing.HashRing
	healthMonitor *health.Monitor
	client        *http.Client
	totalRouted   atomic.Uint64
	directHits    atomic.Uint64
	failoverHits  atomic.Uint64
	failures      atomic.Uint64
}

// NewRouter creates a new failover Router.
func NewRouter(ring *hashing.HashRing, mon *health.Monitor, timeout time.Duration) *Router {
	if timeout <= 0 {
		timeout = 1500 * time.Millisecond
	}

	return &Router{
		hashRing:      ring,
		healthMonitor: mon,
		client: &http.Client{
			Timeout: timeout,
		},
	}
}

// RouteGet resolves primary and replica for a key, checks health, and fails over if primary is unavailable.
func (r *Router) RouteGet(ctx context.Context, key string) (*ReadResult, error) {
	r.totalRouted.Add(1)
	start := time.Now()

	targets, err := r.hashRing.GetNodes(key, 2)
	if err != nil || len(targets) == 0 {
		r.failures.Add(1)
		return nil, ErrNoHealthyNodes
	}

	primary := targets[0]
	var replica hashing.NodeTarget
	hasReplica := len(targets) > 1
	if hasReplica {
		replica = targets[1]
	}

	primaryState, knownPrimary := r.healthMonitor.GetNodeState(primary.NodeID)
	if !knownPrimary {
		primaryState = health.StateAlive
	}

	// 1. If Primary is ALIVE, try reading from Primary
	if primaryState == health.StateAlive {
		res, pErr := r.readFromNode(ctx, primary.Addr, key)
		if pErr == nil {
			r.directHits.Add(1)
			return &ReadResult{
				Key:          res.Key,
				Value:        res.Value,
				TTLRemaining: res.TTLRemaining,
				Version:      res.Version,
				ServedBy:     primary.NodeID,
				ServedAddr:   primary.Addr,
				IsFailover:   false,
				PrimaryNode:  primary.NodeID,
				PrimaryState: string(primaryState),
				LatencyMs:    time.Since(start).Milliseconds(),
			}, nil
		}
		// Primary failed network call on the fly: record it
	}

	// 2. Failover: Primary is SUSPECTED/FAILED or network call failed -> fallback to Replica
	if hasReplica {
		replicaState, knownReplica := r.healthMonitor.GetNodeState(replica.NodeID)
		if !knownReplica || replicaState != health.StateFailed {
			res, rErr := r.readFromNode(ctx, replica.Addr, key)
			if rErr == nil {
				r.failoverHits.Add(1)
				return &ReadResult{
					Key:          res.Key,
					Value:        res.Value,
					TTLRemaining: res.TTLRemaining,
					Version:      res.Version,
					ServedBy:     replica.NodeID,
					ServedAddr:   replica.Addr,
					IsFailover:   true,
					PrimaryNode:  primary.NodeID,
					PrimaryState: string(primaryState),
					LatencyMs:    time.Since(start).Milliseconds(),
				}, nil
			}
		}
	}

	r.failures.Add(1)
	return nil, fmt.Errorf("read failed for key '%s': primary %s (%s) and replica unavailable", key, primary.NodeID, primaryState)
}

type nodeGetPayload struct {
	Status       string `json:"status"`
	Key          string `json:"key"`
	Value        string `json:"value"`
	TTLRemaining int64  `json:"ttl_remaining"`
	Version      uint64 `json:"version"`
	IsReplica    bool   `json:"is_replica"`
	NodeID       string `json:"node_id"`
}

func (r *Router) readFromNode(ctx context.Context, nodeAddr, key string) (*nodeGetPayload, error) {
	url := fmt.Sprintf("%s/get?key=%s", nodeAddr, key)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}

	resp, err := r.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("status code %d", resp.StatusCode)
	}

	var payload nodeGetPayload
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, err
	}

	if payload.Status != "hit" {
		return nil, fmt.Errorf("status not hit: %s", payload.Status)
	}

	return &payload, nil
}

// Stats returns a snapshot of routing and failover counters.
func (r *Router) Stats() Stats {
	return Stats{
		TotalRouted:   r.totalRouted.Load(),
		DirectHits:    r.directHits.Load(),
		FailoverHits:  r.failoverHits.Load(),
		FailuresCount: r.failures.Load(),
	}
}
