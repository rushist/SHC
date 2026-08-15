package rebalancing

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"

	"self-healing-cache/internal/cache"
	"self-healing-cache/internal/hashing"
)

// DumpItem represents a single serialized key-value entry for sync/rebalance.
type DumpItem struct {
	Key        string `json:"key"`
	Value      string `json:"value"`
	TTLSeconds int64  `json:"ttl_seconds"`
	Version    uint64 `json:"version"`
	IsReplica  bool   `json:"is_replica"`
}

// BulkSyncPayload is the payload passed to POST /internal/sync/bulk.
type BulkSyncPayload struct {
	SourceNode string     `json:"source_node"`
	Items      []DumpItem `json:"items"`
}

// RebalanceReport details the results of a rebalancing operation.
type RebalanceReport struct {
	ID            string         `json:"id"`
	TriggeredAt   time.Time      `json:"triggered_at"`
	AddedNodeID   string         `json:"added_node_id,omitempty"`
	RemovedNodeID string         `json:"removed_node_id,omitempty"`
	KeysEvaluated int            `json:"keys_evaluated"`
	KeysMoved     int            `json:"keys_moved"`
	KeysPerNode   map[string]int `json:"keys_per_node"`
	DurationMs    int64          `json:"duration_ms"`
	Status        string         `json:"status"`
}

// Manager handles differential key synchronization on node recovery and cluster rebalancing.
type Manager struct {
	selfNodeID string
	selfAddr   string
	cache      *cache.Cache
	hashRing   *hashing.HashRing
	client     *http.Client
	mu         sync.RWMutex
	reports    []RebalanceReport
}

// NewManager creates a new recovery and rebalance manager.
func NewManager(selfNodeID, selfAddr string, c *cache.Cache, ring *hashing.HashRing, timeout time.Duration) *Manager {
	if timeout <= 0 {
		timeout = 3 * time.Second
	}

	return &Manager{
		selfNodeID: selfNodeID,
		selfAddr:   selfAddr,
		cache:      c,
		hashRing:   ring,
		client: &http.Client{
			Timeout: timeout,
		},
		reports: make([]RebalanceReport, 0),
	}
}

// DumpLocalKeys serializes all active keys in this node's cache for syncing.
func (m *Manager) DumpLocalKeys() []DumpItem {
	allKeys := m.cache.Keys()
	items := make([]DumpItem, 0, len(allKeys))

	for _, k := range allKeys {
		if item, found := m.cache.Get(k); found {
			items = append(items, DumpItem{
				Key:        item.Key,
				Value:      item.Value,
				TTLSeconds: item.TTLRemaining(),
				Version:    item.Version,
				IsReplica:  item.IsReplica,
			})
		}
	}
	return items
}

// IngestBulkKeys inserts a batch of dump items into the local cache.
func (m *Manager) IngestBulkKeys(items []DumpItem) int {
	ingested := 0
	for _, item := range items {
		var ttl time.Duration
		if item.TTLSeconds > 0 {
			ttl = time.Duration(item.TTLSeconds) * time.Second
		}
		m.cache.SetWithMetadata(item.Key, item.Value, ttl, item.Version, item.IsReplica)
		ingested++
	}
	return ingested
}

// SyncFromPeer pulls dump items from a remote peer and updates local cache.
func (m *Manager) SyncFromPeer(ctx context.Context, peerAddr string) (int, error) {
	url := fmt.Sprintf("%s/internal/dump", peerAddr)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return 0, err
	}

	resp, err := m.client.Do(req)
	if err != nil {
		return 0, fmt.Errorf("sync dump request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return 0, fmt.Errorf("peer returned non-200 status: %d", resp.StatusCode)
	}

	var dump struct {
		Items []DumpItem `json:"items"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&dump); err != nil {
		return 0, fmt.Errorf("failed to decode dump: %w", err)
	}

	synced := 0
	for _, item := range dump.Items {
		// Only adopt keys where this node is either primary or replica on the hash ring
		targets, tErr := m.hashRing.GetNodes(item.Key, 2)
		if tErr == nil && len(targets) > 0 {
			isPrimary := targets[0].NodeID == m.selfNodeID
			isReplica := len(targets) > 1 && targets[1].NodeID == m.selfNodeID

			if isPrimary || isReplica {
				var ttl time.Duration
				if item.TTLSeconds > 0 {
					ttl = time.Duration(item.TTLSeconds) * time.Second
				}
				m.cache.SetWithMetadata(item.Key, item.Value, ttl, item.Version, isReplica)
				synced++
			}
		}
	}

	log.Printf("[Sync] Synchronized %d keys from peer %s upon recovery/rejoin", synced, peerAddr)
	return synced, nil
}

// RebalanceForNewNode migrates affected keys from local cache to a newly added node.
func (m *Manager) RebalanceForNewNode(ctx context.Context, newNodeID, newNodeAddr string) (*RebalanceReport, error) {
	start := time.Now()

	// 1. Add new node to local hash ring
	m.hashRing.AddNode(newNodeID, newNodeAddr)

	allKeys := m.cache.Keys()
	keysToMigrate := make([]DumpItem, 0)

	for _, k := range allKeys {
		targets, err := m.hashRing.GetNodes(k, 2)
		if err == nil && len(targets) > 0 {
			// If the new node is now the primary for this key, migrate it
			if targets[0].NodeID == newNodeID {
				if item, found := m.cache.Get(k); found {
					keysToMigrate = append(keysToMigrate, DumpItem{
						Key:        item.Key,
						Value:      item.Value,
						TTLSeconds: item.TTLRemaining(),
						Version:    item.Version,
						IsReplica:  false,
					})
				}
			}
		}
	}

	// 2. Transfer affected keys to new node via bulk sync
	if len(keysToMigrate) > 0 {
		payload := BulkSyncPayload{
			SourceNode: m.selfNodeID,
			Items:      keysToMigrate,
		}
		body, _ := json.Marshal(payload)
		url := fmt.Sprintf("%s/internal/sync/bulk", newNodeAddr)
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
		if err != nil {
			return nil, err
		}
		req.Header.Set("Content-Type", "application/json")

		resp, err := m.client.Do(req)
		if err != nil {
			return nil, fmt.Errorf("bulk transfer to new node %s failed: %w", newNodeAddr, err)
		}
		resp.Body.Close()
	}

	duration := time.Since(start).Milliseconds()
	report := RebalanceReport{
		ID:            fmt.Sprintf("reb-%d", time.Now().UnixNano()),
		TriggeredAt:   start,
		AddedNodeID:   newNodeID,
		KeysEvaluated: len(allKeys),
		KeysMoved:     len(keysToMigrate),
		KeysPerNode: map[string]int{
			newNodeID:    len(keysToMigrate),
			m.selfNodeID: len(allKeys) - len(keysToMigrate),
		},
		DurationMs: duration,
		Status:     "COMPLETED",
	}

	m.mu.Lock()
	m.reports = append(m.reports, report)
	m.mu.Unlock()

	log.Printf("[Rebalance] Completed: %d/%d keys migrated to newly added node %s in %dms",
		len(keysToMigrate), len(allKeys), newNodeID, duration)

	return &report, nil
}

// GetReports returns history of rebalance operations.
func (m *Manager) GetReports() []RebalanceReport {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return append([]RebalanceReport{}, m.reports...)
}
