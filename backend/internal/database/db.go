package database

import (
	"fmt"
	"math/rand"
	"sync"
	"sync/atomic"
	"time"
)

// Product represents a realistic record in the primary backing database.
type Product struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Category    string  `json:"category"`
	Price       float64 `json:"price"`
	Stock       int     `json:"stock"`
	Rating      float64 `json:"rating"`
	SKU         string  `json:"sku"`
	Description string  `json:"description"`
	LastUpdated string  `json:"last_updated"`
}

// BackingDB simulates a persistent SQL / NoSQL database with realistic I/O latency.
type BackingDB struct {
	mu           sync.RWMutex
	records      map[string]Product
	queryCount   uint64
	latencySimMs int
}

// New creates and seeds a persistent backing database with 10,000 catalog records.
func New(recordCount int, simulatedLatencyMs int) *BackingDB {
	if recordCount <= 0 {
		recordCount = 10000
	}
	if simulatedLatencyMs <= 0 {
		simulatedLatencyMs = 45 // Realistic 45ms DB disk/network query time
	}

	db := &BackingDB{
		records:      make(map[string]Product, recordCount),
		latencySimMs: simulatedLatencyMs,
	}

	db.seedData(recordCount)
	return db
}

func (db *BackingDB) seedData(count int) {
	categories := []string{"AI Accelerators", "Quantum Compute", "GPU Clusters", "Edge Routers", "NVMe Storage", "Cybersecurity", "Developer Tools"}
	adjectives := []string{"Ultra", "Quantum", "Hyper", "Apex", "Titanium", "Neural", "Nexus", "Vector", "Optima", "Infinity"}
	nouns := []string{"Tensor Core", "Compute Blade", "H100 Node", "Switch 100G", "RAID Array", "Firewall Vault", "Workstation Pro"}

	rnd := rand.New(rand.NewSource(42)) // Deterministic seed

	for i := 1; i <= count; i++ {
		id := fmt.Sprintf("prod:%d", i)
		adj := adjectives[rnd.Intn(len(adjectives))]
		noun := nouns[rnd.Intn(len(nouns))]
		cat := categories[rnd.Intn(len(categories))]

		p := Product{
			ID:          id,
			Name:        fmt.Sprintf("%s %s v%d", adj, noun, rnd.Intn(9)+1),
			Category:    cat,
			Price:       float64(rnd.Intn(4900)+100) + 0.99,
			Stock:       rnd.Intn(500) + 10,
			Rating:      4.0 + (rnd.Float64() * 0.99),
			SKU:         fmt.Sprintf("SKU-%s-%05d", cat[:3], i),
			Description: fmt.Sprintf("Enterprise high-performance %s designed for distributed infrastructure workloads.", noun),
			LastUpdated: time.Now().Format("2006-01-02 15:04:05"),
		}
		db.records[id] = p
	}
}

// QueryByID simulates a database read with realistic disk/network latency (e.g. 45ms).
func (db *BackingDB) QueryByID(id string) (Product, bool, int64) {
	atomic.AddUint64(&db.queryCount, 1)

	// Simulate realistic DB latency (35ms - 55ms)
	latency := db.latencySimMs + (rand.Intn(16) - 8)
	if latency < 10 {
		latency = 10
	}
	time.Sleep(time.Duration(latency) * time.Millisecond)

	db.mu.RLock()
	defer db.mu.RUnlock()

	p, exists := db.records[id]
	return p, exists, int64(latency)
}

// GetStats returns current database statistics.
func (db *BackingDB) GetStats() map[string]interface{} {
	db.mu.RLock()
	defer db.mu.RUnlock()

	return map[string]interface{}{
		"total_records":        len(db.records),
		"db_queries_executed":  atomic.LoadUint64(&db.queryCount),
		"average_db_latency":   fmt.Sprintf("%dms", db.latencySimMs),
		"database_type":        "Simulated Persistent SQL/NoSQL Cluster",
	}
}
