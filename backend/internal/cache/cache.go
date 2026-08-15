package cache

import (
	"sync"
	"sync/atomic"
	"time"
)

// Item represents a single stored key-value entry with metadata.
type Item struct {
	Key       string    `json:"key"`
	Value     string    `json:"value"`
	CreatedAt time.Time `json:"created_at"`
	ExpiresAt time.Time `json:"expires_at"` // Zero value means no TTL (never expires)
	Version   uint64    `json:"version"`
	IsReplica bool      `json:"is_replica"`
}

// IsExpired returns true if the item has a TTL and the current time is past ExpiresAt.
func (i *Item) IsExpired() bool {
	if i.ExpiresAt.IsZero() {
		return false
	}
	return time.Now().After(i.ExpiresAt)
}

// TTLRemaining returns the remaining TTL in seconds, or -1 if no TTL is set.
func (i *Item) TTLRemaining() int64 {
	if i.ExpiresAt.IsZero() {
		return -1
	}
	remaining := time.Until(i.ExpiresAt)
	if remaining <= 0 {
		return 0
	}
	return int64(remaining.Seconds())
}

// Stats holds operational telemetry for the cache node.
type Stats struct {
	TotalKeys     int    `json:"total_keys"`
	PrimaryKeys   int    `json:"primary_keys"`
	ReplicaKeys   int    `json:"replica_keys"`
	HitCount      uint64 `json:"hit_count"`
	MissCount     uint64 `json:"miss_count"`
	SetCount      uint64 `json:"set_count"`
	DeleteCount   uint64 `json:"delete_count"`
	ExpiredCount  uint64 `json:"expired_count"`
	UptimeSeconds int64  `json:"uptime_seconds"`
}

// Cache is a thread-safe in-memory key-value store.
type Cache struct {
	mu           sync.RWMutex
	items        map[string]*Item
	hitCount     atomic.Uint64
	missCount    atomic.Uint64
	setCount     atomic.Uint64
	deleteCount  atomic.Uint64
	expiredCount atomic.Uint64
	startTime    time.Time
	stopCleanup  chan struct{}
}

// New creates a new Cache instance with an automatic background cleanup ticker.
func New(cleanupInterval time.Duration) *Cache {
	if cleanupInterval <= 0 {
		cleanupInterval = 1 * time.Second
	}

	c := &Cache{
		items:       make(map[string]*Item),
		startTime:   time.Now(),
		stopCleanup: make(chan struct{}),
	}

	go c.startCleanupWorker(cleanupInterval)
	return c
}

// Set inserts or updates a primary key-value pair with an optional TTL.
func (c *Cache) Set(key string, value string, ttl time.Duration) *Item {
	return c.SetWithMetadata(key, value, ttl, 0, false)
}

// SetWithMetadata inserts or updates a key-value pair with explicit version and replica metadata.
func (c *Cache) SetWithMetadata(key string, value string, ttl time.Duration, version uint64, isReplica bool) *Item {
	c.mu.Lock()
	defer c.mu.Unlock()

	now := time.Now()
	var expiresAt time.Time
	if ttl > 0 {
		expiresAt = now.Add(ttl)
	}

	if version == 0 {
		version = 1
		if existing, exists := c.items[key]; exists {
			version = existing.Version + 1
		}
	}

	item := &Item{
		Key:       key,
		Value:     value,
		CreatedAt: now,
		ExpiresAt: expiresAt,
		Version:   version,
		IsReplica: isReplica,
	}

	c.items[key] = item
	c.setCount.Add(1)
	return item
}

// Get retrieves an item by key. Returns (item, true) on hit, or (nil, false) on miss/expiration.
func (c *Cache) Get(key string) (*Item, bool) {
	c.mu.RLock()
	item, exists := c.items[key]
	c.mu.RUnlock()

	if !exists {
		c.missCount.Add(1)
		return nil, false
	}

	// Passive expiration check
	if item.IsExpired() {
		c.mu.Lock()
		if curItem, stillExists := c.items[key]; stillExists && curItem.IsExpired() {
			delete(c.items, key)
			c.expiredCount.Add(1)
		}
		c.mu.Unlock()

		c.missCount.Add(1)
		return nil, false
	}

	c.hitCount.Add(1)
	return item, true
}

// Delete removes an item by key. Returns true if the key existed and was removed.
func (c *Cache) Delete(key string) bool {
	c.mu.Lock()
	defer c.mu.Unlock()

	if _, exists := c.items[key]; exists {
		delete(c.items, key)
		c.deleteCount.Add(1)
		return true
	}
	return false
}

// Stats returns a snapshot of cache metrics including primary and replica key counts.
func (c *Cache) Stats() Stats {
	c.mu.RLock()
	totalKeys := len(c.items)
	primaryCount := 0
	replicaCount := 0
	for _, item := range c.items {
		if item.IsReplica {
			replicaCount++
		} else {
			primaryCount++
		}
	}
	c.mu.RUnlock()

	return Stats{
		TotalKeys:     totalKeys,
		PrimaryKeys:   primaryCount,
		ReplicaKeys:   replicaCount,
		HitCount:      c.hitCount.Load(),
		MissCount:     c.missCount.Load(),
		SetCount:      c.setCount.Load(),
		DeleteCount:   c.deleteCount.Load(),
		ExpiredCount:  c.expiredCount.Load(),
		UptimeSeconds: int64(time.Since(c.startTime).Seconds()),
	}
}

// Keys returns a slice of all active keys currently in the cache.
func (c *Cache) Keys() []string {
	c.mu.RLock()
	defer c.mu.RUnlock()

	keys := make([]string, 0, len(c.items))
	now := time.Now()
	for k, item := range c.items {
		if item.ExpiresAt.IsZero() || now.Before(item.ExpiresAt) {
			keys = append(keys, k)
		}
	}
	return keys
}

// Close gracefully stops the background cleanup worker.
func (c *Cache) Close() {
	select {
	case <-c.stopCleanup:
	default:
		close(c.stopCleanup)
	}
}

func (c *Cache) startCleanupWorker(interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			c.purgeExpired()
		case <-c.stopCleanup:
			return
		}
	}
}

func (c *Cache) purgeExpired() {
	c.mu.Lock()
	defer c.mu.Unlock()

	now := time.Now()
	for key, item := range c.items {
		if !item.ExpiresAt.IsZero() && now.After(item.ExpiresAt) {
			delete(c.items, key)
			c.expiredCount.Add(1)
		}
	}
}
