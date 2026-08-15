package hotkey

import (
	"sync"
	"time"
)

// HotKeyInfo holds telemetry for a key identified as hot.
type HotKeyInfo struct {
	Key          string    `json:"key"`
	RequestCount uint64    `json:"request_count"`
	RequestRate  float64   `json:"request_rate_per_sec"`
	DetectedAt   time.Time `json:"detected_at"`
	IsHot        bool      `json:"is_hot"`
}

type keyBucket struct {
	count     uint64
	timestamp time.Time
}

// Config defines thresholds for hot-key detection.
type Config struct {
	WindowDuration time.Duration // Sliding window duration (e.g. 5 seconds)
	ThresholdCount uint64        // Number of requests in window to qualify as HOT (e.g. 30)
}

// Detector tracks request frequency per key and detects hot keys.
type Detector struct {
	config    Config
	mu        sync.RWMutex
	keyAccess map[string][]keyBucket // Key -> array of timestamped access counts
	hotKeys   map[string]time.Time   // Key -> time detected
}

// NewDetector creates a new hot-key detector.
func NewDetector(cfg Config) *Detector {
	if cfg.WindowDuration <= 0 {
		cfg.WindowDuration = 5 * time.Second
	}
	if cfg.ThresholdCount <= 0 {
		cfg.ThresholdCount = 20
	}

	return &Detector{
		config:    cfg,
		keyAccess: make(map[string][]keyBucket),
		hotKeys:   make(map[string]time.Time),
	}
}

// RecordAccess increments the access counter for a key and returns true if it is now HOT.
func (d *Detector) RecordAccess(key string) (bool, uint64) {
	d.mu.Lock()
	defer d.mu.Unlock()

	now := time.Now()
	cutoff := now.Add(-d.config.WindowDuration)

	buckets := d.keyAccess[key]
	validBuckets := make([]keyBucket, 0, len(buckets)+1)
	var totalCount uint64 = 0

	for _, b := range buckets {
		if b.timestamp.After(cutoff) {
			validBuckets = append(validBuckets, b)
			totalCount += b.count
		}
	}

	// Add current access
	validBuckets = append(validBuckets, keyBucket{count: 1, timestamp: now})
	totalCount++

	d.keyAccess[key] = validBuckets

	isHot := totalCount >= d.config.ThresholdCount
	if isHot {
		if _, wasHot := d.hotKeys[key]; !wasHot {
			d.hotKeys[key] = now
		}
	} else {
		delete(d.hotKeys, key)
	}

	return isHot, totalCount
}

// IsHot checks if a key is currently tagged as hot.
func (d *Detector) IsHot(key string) (bool, uint64) {
	d.mu.RLock()
	defer d.mu.RUnlock()

	now := time.Now()
	cutoff := now.Add(-d.config.WindowDuration)

	buckets := d.keyAccess[key]
	var totalCount uint64 = 0
	for _, b := range buckets {
		if b.timestamp.After(cutoff) {
			totalCount += b.count
		}
	}

	return totalCount >= d.config.ThresholdCount, totalCount
}

// GetHotKeys returns all keys currently exceeding the hot threshold.
func (d *Detector) GetHotKeys() []HotKeyInfo {
	d.mu.Lock()
	defer d.mu.Unlock()

	now := time.Now()
	cutoff := now.Add(-d.config.WindowDuration)
	hotList := make([]HotKeyInfo, 0)

	for key, buckets := range d.keyAccess {
		var totalCount uint64 = 0
		validBuckets := make([]keyBucket, 0, len(buckets))

		for _, b := range buckets {
			if b.timestamp.After(cutoff) {
				validBuckets = append(validBuckets, b)
				totalCount += b.count
			}
		}
		d.keyAccess[key] = validBuckets

		if totalCount >= d.config.ThresholdCount {
			rate := float64(totalCount) / d.config.WindowDuration.Seconds()
			detTime := d.hotKeys[key]
			if detTime.IsZero() {
				detTime = now
				d.hotKeys[key] = now
			}
			hotList = append(hotList, HotKeyInfo{
				Key:          key,
				RequestCount: totalCount,
				RequestRate:  rate,
				DetectedAt:   detTime,
				IsHot:        true,
			})
		} else {
			delete(d.hotKeys, key)
		}
	}

	return hotList
}
