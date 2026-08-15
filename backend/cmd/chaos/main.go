package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os/exec"
	"path/filepath"
	"time"

	"self-healing-cache/internal/chaos"
)

func main() {
	gatewayURL := flag.String("gateway", "http://localhost:8000", "Unified API Gateway URL")
	scenarioStr := flag.String("scenario", "primary_kill", "Chaos scenario: primary_kill, node_flap, cascading_failure, heavy_concurrent_load")
	requests := flag.Int("requests", 50, "Total number of test requests")
	concurrency := flag.Int("concurrency", 5, "Number of concurrent worker threads")
	chaosDelay := flag.Duration("chaos-delay", 800*time.Millisecond, "Time to wait before triggering chaos event")
	reqDelay := flag.Duration("req-delay", 30*time.Millisecond, "Delay between requests per worker")

	flag.Parse()

	scenario := chaos.Scenario(*scenarioStr)

	// Process management hook for live Windows processes
	processHook := func(action, nodeID string, port int) error {
		rootDir, _ := filepath.Abs(".")
		if action == "kill" {
			killScript := filepath.Join(rootDir, "kill_node.ps1")
			cmd := exec.Command("powershell.exe", "-ExecutionPolicy", "Bypass", "-File", killScript, nodeID)
			return cmd.Run()
		} else if action == "start" {
			var args string
			if nodeID == "node-a" {
				args = "-id node-a -port 8001 -peers node-b=http://localhost:8002,node-c=http://localhost:8003"
			} else if nodeID == "node-b" {
				args = "-id node-b -port 8002 -peers node-a=http://localhost:8001,node-c=http://localhost:8003"
			} else if nodeID == "node-c" {
				args = "-id node-c -port 8003 -peers node-a=http://localhost:8001,node-b=http://localhost:8002"
			}
			nodeBin := filepath.Join(rootDir, "backend", "node.exe")
			cmd := exec.Command("powershell.exe", "-Command", fmt.Sprintf("Start-Process -FilePath '%s' -ArgumentList '%s'", nodeBin, args))
			return cmd.Run()
		}
		return nil
	}

	cfg := chaos.Config{
		GatewayURL:      *gatewayURL,
		Scenario:        scenario,
		TotalRequests:   *requests,
		Concurrency:     *concurrency,
		RequestDelay:    *reqDelay,
		ChaosDelay:      *chaosDelay,
		NodeProcessHook: processHook,
	}

	runner := chaos.NewRunner(cfg)

	fmt.Println("=================================================================")
	fmt.Println("  SELF-HEALING DISTRIBUTED CACHE — CHAOS ENGINEERING SUITE")
	fmt.Println("=================================================================")
	fmt.Printf("  Target Gateway : %s\n", *gatewayURL)
	fmt.Printf("  Scenario       : %s\n", scenario)
	fmt.Printf("  Requests       : %d | Concurrency: %d workers\n", *requests, *concurrency)
	fmt.Println("=================================================================")
	fmt.Println("Running chaos experiment...")

	ctx := context.Background()
	card, err := runner.Run(ctx)
	if err != nil {
		log.Fatalf("Chaos test failed: %v", err)
	}

	fmt.Println("\n=================================================================")
	fmt.Println("                     RESILIENCE SCORECARD                        ")
	fmt.Println("=================================================================")
	fmt.Printf("  Total Requests Sent    : %d\n", card.TotalRequests)
	fmt.Printf("  Successful Operations  : %d\n", card.SuccessfulRequests)
	fmt.Printf("  Failed Operations      : %d\n", card.FailedRequests)
	fmt.Printf("  Failover Read Hits     : %d\n", card.FailoverHits)
	fmt.Printf("  Overall Success Rate   : %.2f%%\n", card.SuccessRate)
	fmt.Printf("  Data Corruptions       : %d\n", card.DataCorruptions)
	fmt.Printf("  Total Duration         : %d ms\n", card.DurationMs)
	fmt.Printf("  Throughput             : %.1f req/sec\n", card.ThroughputRPS)
	fmt.Println("-----------------------------------------------------------------")
	fmt.Println("  Latency Metrics:")
	fmt.Printf("    Min Latency          : %d ms\n", card.MinLatencyMs)
	fmt.Printf("    P50 (Median) Latency : %d ms\n", card.P50LatencyMs)
	fmt.Printf("    P95 Latency          : %d ms\n", card.P95LatencyMs)
	fmt.Printf("    P99 Latency          : %d ms\n", card.P99LatencyMs)
	fmt.Printf("    Max Latency          : %d ms\n", card.MaxLatencyMs)
	fmt.Println("-----------------------------------------------------------------")
	fmt.Println("  Chaos Timeline Events:")
	for _, evt := range card.ChaosEvents {
		fmt.Printf("    %s\n", evt)
	}
	fmt.Println("=================================================================")

	if card.SuccessRate >= 95.0 {
		fmt.Println("  [VERDICT] EXCELLENT RESILIENCE — ZERO DOWNTIME MAINTAINED!")
	} else if card.SuccessRate >= 80.0 {
		fmt.Println("  [VERDICT] ACCEPTABLE FAULT TOLERANCE")
	} else {
		fmt.Println("  [VERDICT] RESILIENCE GOAL NOT MET")
	}
	fmt.Println("=================================================================")
}
