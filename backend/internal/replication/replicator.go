package replication

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync/atomic"
	"time"
)

// ReplicatePayload is the JSON payload sent from Primary to Replica.
type ReplicatePayload struct {
	Key        string `json:"key"`
	Value      string `json:"value"`
	TTLSeconds int64  `json:"ttl_seconds,omitempty"`
	Version    uint64 `json:"version"`
	IsReplica  bool   `json:"is_replica"`
}

// ReplicateDeletePayload is the JSON payload sent from Primary to Replica for deletions.
type ReplicateDeletePayload struct {
	Key string `json:"key"`
}

// Stats holds replication telemetry.
type Stats struct {
	ReplicationsTotal    uint64 `json:"replications_total"`
	ReplicationSuccesses uint64 `json:"replication_successes"`
	ReplicationFailures  uint64 `json:"replication_failures"`
}

// Replicator manages write propagation from Primary to Replica nodes.
type Replicator struct {
	client      *http.Client
	total       atomic.Uint64
	successes   atomic.Uint64
	failures    atomic.Uint64
}

// New creates a new Replicator instance.
func New(timeout time.Duration) *Replicator {
	if timeout <= 0 {
		timeout = 2 * time.Second
	}

	return &Replicator{
		client: &http.Client{
			Timeout: timeout,
		},
	}
}

// ReplicateSet sends a SET command to a replica node.
func (r *Replicator) ReplicateSet(ctx context.Context, replicaAddr, key, value string, ttl time.Duration, version uint64) error {
	r.total.Add(1)

	var ttlSec int64
	if ttl > 0 {
		ttlSec = int64(ttl.Seconds())
	}

	payload := ReplicatePayload{
		Key:        key,
		Value:      value,
		TTLSeconds: ttlSec,
		Version:    version,
		IsReplica:  true,
	}

	body, err := json.Marshal(payload)
	if err != nil {
		r.failures.Add(1)
		return fmt.Errorf("failed to marshal replicate payload: %w", err)
	}

	url := fmt.Sprintf("%s/internal/replicate", replicaAddr)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		r.failures.Add(1)
		return fmt.Errorf("failed to create replicate request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := r.client.Do(req)
	if err != nil {
		r.failures.Add(1)
		return fmt.Errorf("replica write failed to %s: %w", replicaAddr, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		r.failures.Add(1)
		return fmt.Errorf("replica %s returned non-200 status: %d", replicaAddr, resp.StatusCode)
	}

	r.successes.Add(1)
	return nil
}

// ReplicateDelete sends a DELETE command to a replica node.
func (r *Replicator) ReplicateDelete(ctx context.Context, replicaAddr, key string) error {
	url := fmt.Sprintf("%s/internal/replicate-delete?key=%s", replicaAddr, key)
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, url, nil)
	if err != nil {
		return err
	}

	resp, err := r.client.Do(req)
	if err != nil {
		return fmt.Errorf("replica delete failed to %s: %w", replicaAddr, err)
	}
	defer resp.Body.Close()

	return nil
}

// Stats returns a snapshot of replication metrics.
func (r *Replicator) Stats() Stats {
	return Stats{
		ReplicationsTotal:    r.total.Load(),
		ReplicationSuccesses: r.successes.Load(),
		ReplicationFailures:  r.failures.Load(),
	}
}
