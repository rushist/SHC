package chaos

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"sync"
	"sync/atomic"
	"time"
)

// Scenario represents the chaos test scenario type.
type Scenario string

const (
	ScenarioPrimaryKill Scenario = "primary_kill"
	ScenarioNodeFlap    Scenario = "node_flap"
	ScenarioCascading   Scenario = "cascading_failure"
	ScenarioHeavyLoad   Scenario = "heavy_concurrent_load"
)

// Config configures a chaos testing experiment.
type Config struct {
	GatewayURL    string        `json:"gateway_url"`
	Scenario      Scenario      `json:"scenario"`
	TotalRequests int           `json:"total_requests"`
	Concurrency   int           `json:"concurrency"`
	RequestDelay  time.Duration `json:"request_delay"`
	ChaosDelay    time.Duration `json:"chaos_delay"`
	NodeProcessHook func(action, nodeID string, port int) error `json:"-"`
}

// Scorecard stores the results and latency metrics of a chaos run.
type Scorecard struct {
	Scenario           Scenario      `json:"scenario"`
	TotalRequests      int           `json:"total_requests"`
	SuccessfulRequests int           `json:"successful_requests"`
	FailedRequests     int           `json:"failed_requests"`
	FailoverHits       int           `json:"failover_hits"`
	SuccessRate        float64       `json:"success_rate_percent"`
	DataCorruptions    int           `json:"data_corruptions"`
	DurationMs         int64         `json:"duration_ms"`
	ThroughputRPS      float64       `json:"throughput_rps"`
	MinLatencyMs       int64         `json:"min_latency_ms"`
	P50LatencyMs       int64         `json:"p50_latency_ms"`
	P95LatencyMs       int64         `json:"p95_latency_ms"`
	P99LatencyMs       int64         `json:"p99_latency_ms"`
	MaxLatencyMs       int64         `json:"max_latency_ms"`
	ChaosEvents        []string      `json:"chaos_events"`
	Status             string        `json:"status"`
}

// Runner executes chaos experiments against the distributed cache cluster.
type Runner struct {
	config Config
	client *http.Client
}

// NewRunner creates a new chaos test runner.
func NewRunner(cfg Config) *Runner {
	if cfg.GatewayURL == "" {
		cfg.GatewayURL = "http://localhost:8000"
	}
	if cfg.TotalRequests <= 0 {
		cfg.TotalRequests = 50
	}
	if cfg.Concurrency <= 0 {
		cfg.Concurrency = 5
	}
	if cfg.ChaosDelay <= 0 {
		cfg.ChaosDelay = 600 * time.Millisecond
	}

	return &Runner{
		config: cfg,
		client: &http.Client{
			Timeout: 2 * time.Second,
		},
	}
}

// Run executes the configured chaos scenario and generates the resilience scorecard.
func (r *Runner) Run(ctx context.Context) (*Scorecard, error) {
	start := time.Now()
	var (
		successCount  atomic.Int64
		failedCount   atomic.Int64
		failoverCount atomic.Int64
		corruptCount  atomic.Int64
		latenciesMu   sync.Mutex
		latencies     []int64
		chaosEvents   []string
		eventsMu      sync.Mutex
	)

	recordEvent := func(evt string) {
		eventsMu.Lock()
		chaosEvents = append(chaosEvents, fmt.Sprintf("[%s] %s", time.Now().Format("15:04:05.000"), evt))
		eventsMu.Unlock()
	}

	recordEvent(fmt.Sprintf("Started Chaos Experiment: %s with %d requests across %d workers",
		r.config.Scenario, r.config.TotalRequests, r.config.Concurrency))

	// Channel of work items
	type workItem struct {
		id  int
		key string
		val string
	}

	workChan := make(chan workItem, r.config.TotalRequests)
	for i := 0; i < r.config.TotalRequests; i++ {
		workChan <- workItem{
			id:  i,
			key: fmt.Sprintf("chaos:key:%d", i%15), // cycle 15 keys to test overwrites and reads
			val: fmt.Sprintf("val_ver_%d", i),
		}
	}
	close(workChan)

	var wg sync.WaitGroup

	// 1. Launch Concurrent Workers
	for w := 0; w < r.config.Concurrency; w++ {
		wg.Add(1)
		go func(workerID int) {
			defer wg.Done()
			for item := range workChan {
				reqStart := time.Now()

				// First: SET key
				setPayload := map[string]interface{}{
					"key":         item.key,
					"value":       item.val,
					"ttl_seconds": 60,
				}
				body, _ := json.Marshal(setPayload)
				setResp, sErr := r.client.Post(r.config.GatewayURL+"/api/set", "application/json", bytes.NewReader(body))

				var setSuccess bool
				if sErr == nil && setResp.StatusCode == http.StatusOK {
					setSuccess = true
					io.Copy(io.Discard, setResp.Body)
					setResp.Body.Close()
				} else if setResp != nil {
					setResp.Body.Close()
				}

				// Second: Immediate GET key
				getURL := fmt.Sprintf("%s/api/get?key=%s", r.config.GatewayURL, item.key)
				getResp, gErr := r.client.Get(getURL)

				lat := time.Since(reqStart).Milliseconds()
				latenciesMu.Lock()
				latencies = append(latencies, lat)
				latenciesMu.Unlock()

				if gErr == nil && getResp.StatusCode == http.StatusOK {
					var res struct {
						Status     string `json:"status"`
						Value      string `json:"value"`
						IsFailover bool   `json:"is_failover"`
					}
					if err := json.NewDecoder(getResp.Body).Decode(&res); err == nil && res.Status == "hit" {
						successCount.Add(1)
						if res.IsFailover {
							failoverCount.Add(1)
						}
					} else {
						failedCount.Add(1)
					}
					getResp.Body.Close()
				} else {
					if getResp != nil {
						getResp.Body.Close()
					}
					if !setSuccess {
						failedCount.Add(1)
					} else {
						failedCount.Add(1)
					}
				}

				if r.config.RequestDelay > 0 {
					time.Sleep(r.config.RequestDelay)
				}
			}
		}(w)
	}

	// 2. Inject Chaos Event halfway through experiment
	go func() {
		time.Sleep(r.config.ChaosDelay)
		if r.config.NodeProcessHook != nil {
			switch r.config.Scenario {
			case ScenarioPrimaryKill:
				recordEvent("CHAOS TRIGGER: Killing Node C (:8003) during active load")
				_ = r.config.NodeProcessHook("kill", "node-c", 8003)
			case ScenarioNodeFlap:
				recordEvent("CHAOS TRIGGER: Flapping Node C (Kill -> Revive)")
				_ = r.config.NodeProcessHook("kill", "node-c", 8003)
				time.Sleep(400 * time.Millisecond)
				_ = r.config.NodeProcessHook("start", "node-c", 8003)
				recordEvent("CHAOS TRIGGER: Revived Node C")
			case ScenarioCascading:
				recordEvent("CHAOS TRIGGER: Cascading kill (Node C then Node B)")
				_ = r.config.NodeProcessHook("kill", "node-c", 8003)
				time.Sleep(300 * time.Millisecond)
				_ = r.config.NodeProcessHook("kill", "node-b", 8002)
			}
		}
	}()

	wg.Wait()
	duration := time.Since(start)

	// Compute Percentiles
	sort.Slice(latencies, func(i, j int) bool { return latencies[i] < latencies[j] })
	var minLat, p50, p95, p99, maxLat int64
	n := len(latencies)
	if n > 0 {
		minLat = latencies[0]
		maxLat = latencies[n-1]
		p50 = latencies[int(float64(n)*0.50)]
		p95 = latencies[int(float64(n)*0.95)]
		p99 = latencies[int(float64(n)*0.99)]
	}

	tot := int(successCount.Load() + failedCount.Load())
	suc := int(successCount.Load())
	fai := int(failedCount.Load())
	fo := int(failoverCount.Load())

	successRate := 0.0
	if tot > 0 {
		successRate = (float64(suc) / float64(tot)) * 100.0
	}

	throughput := 0.0
	if duration.Seconds() > 0 {
		throughput = float64(tot) / duration.Seconds()
	}

	scorecard := &Scorecard{
		Scenario:           r.config.Scenario,
		TotalRequests:      tot,
		SuccessfulRequests: suc,
		FailedRequests:     fai,
		FailoverHits:       fo,
		SuccessRate:        successRate,
		DataCorruptions:    int(corruptCount.Load()),
		DurationMs:         duration.Milliseconds(),
		ThroughputRPS:      throughput,
		MinLatencyMs:       minLat,
		P50LatencyMs:       p50,
		P95LatencyMs:       p95,
		P99LatencyMs:       p99,
		MaxLatencyMs:       maxLat,
		ChaosEvents:        chaosEvents,
		Status:             "COMPLETED",
	}

	return scorecard, nil
}
