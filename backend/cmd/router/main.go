package main

import (
	"flag"
	"log"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"self-healing-cache/internal/gateway"
)

func main() {
	defaultPort := getEnvInt("PORT", 8000)
	defaultHost := getEnv("HOST", "0.0.0.0")
	defaultNodes := getEnv("GATEWAY_NODES", "node-a=http://localhost:8001,node-b=http://localhost:8002,node-c=http://localhost:8003,node-d=http://localhost:8004,node-e=http://localhost:8005,node-f=http://localhost:8006,node-g=http://localhost:8007,node-h=http://localhost:8008,node-i=http://localhost:8009")
	defaultVNodes := getEnvInt("VNODES", 50)
	defaultHeartbeat := getEnvDuration("HEARTBEAT_INTERVAL", 500*time.Millisecond)
	defaultSuspect := getEnvDuration("SUSPECT_TIMEOUT", 1*time.Second)
	defaultFail := getEnvDuration("FAIL_TIMEOUT", 2*time.Second)
	defaultTimeout := getEnvDuration("REQUEST_TIMEOUT", 2*time.Second)

	port := flag.Int("port", defaultPort, "Port for the unified API router (or env PORT)")
	host := flag.String("host", defaultHost, "Host address to bind to (or env HOST)")
	nodesRaw := flag.String("nodes", defaultNodes, "Comma-separated list of cache nodes (id=url, or env GATEWAY_NODES)")
	vnodes := flag.Int("vnodes", defaultVNodes, "Number of virtual nodes per physical node")
	heartbeat := flag.Duration("heartbeat", defaultHeartbeat, "Heartbeat interval to backend nodes")
	suspect := flag.Duration("suspect-timeout", defaultSuspect, "Suspect timeout")
	fail := flag.Duration("fail-timeout", defaultFail, "Fail timeout")
	timeout := flag.Duration("timeout", defaultTimeout, "Request timeout")

	flag.Parse()

	var nodes []string
	if *nodesRaw != "" {
		for _, n := range strings.Split(*nodesRaw, ",") {
			trimmed := strings.TrimSpace(n)
			if trimmed != "" {
				nodes = append(nodes, trimmed)
			}
		}
	}

	cfg := gateway.Config{
		Port:              *port,
		Host:              *host,
		Nodes:             nodes,
		VNodes:            *vnodes,
		HeartbeatInterval: *heartbeat,
		SuspectTimeout:    *suspect,
		FailTimeout:       *fail,
		RequestTimeout:    *timeout,
	}

	gw := gateway.New(cfg)

	// Graceful shutdown handling
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		<-sigChan
		log.Println("\n[Gateway] Shutting down unified router gracefully...")
		_ = gw.Close()
		os.Exit(0)
	}()

	log.Printf("===============================================================")
	log.Printf("  SELF-HEALING DISTRIBUTED CACHE — UNIFIED API ROUTER")
	log.Printf("  Listening on: http://%s:%d", *host, *port)
	log.Printf("  Client Endpoints:")
	log.Printf("    POST   http://localhost:%d/api/set", *port)
	log.Printf("    GET    http://localhost:%d/api/get?key=...", *port)
	log.Printf("    DELETE http://localhost:%d/api/delete?key=...", *port)
	log.Printf("    GET    http://localhost:%d/api/cluster", *port)
	log.Printf("===============================================================")

	if err := gw.Start(); err != nil && err.Error() != "http: Server closed" {
		log.Fatalf("[Gateway] Server error: %v", err)
	}
}

func getEnv(key, defaultVal string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return defaultVal
}

func getEnvInt(key string, defaultVal int) int {
	if val := os.Getenv(key); val != "" {
		if i, err := strconv.Atoi(val); err == nil {
			return i
		}
	}
	return defaultVal
}

func getEnvDuration(key string, defaultVal time.Duration) time.Duration {
	if val := os.Getenv(key); val != "" {
		if d, err := time.ParseDuration(val); err == nil {
			return d
		}
	}
	return defaultVal
}
