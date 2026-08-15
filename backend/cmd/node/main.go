package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"self-healing-cache/internal/cache"
	"self-healing-cache/internal/config"
	"self-healing-cache/internal/server"
)

func main() {
	cfg := config.ParseFlags()

	log.Printf("==================================================")
	log.Printf("  Distributed Cache Node: %s", cfg.NodeID)
	log.Printf("  Binding Address: http://%s:%d", cfg.Host, cfg.Port)
	log.Printf("  Peers Configured: %v", cfg.Peers)
	log.Printf("  TTL Eviction Interval: %v", cfg.CleanupInterval)
	log.Printf("==================================================")

	// Initialize thread-safe cache engine
	c := cache.New(cfg.CleanupInterval)
	defer c.Close()

	// Initialize HTTP server with peer manager, health monitor, and hotkey detector
	srvCfg := server.Config{
		NodeID:            cfg.NodeID,
		Host:              cfg.Host,
		Port:              cfg.Port,
		Peers:             cfg.Peers,
		HeartbeatInterval: cfg.HeartbeatInterval,
		SuspectTimeout:    cfg.SuspectTimeout,
		FailTimeout:       cfg.FailTimeout,
		HotkeyWindow:      cfg.HotkeyWindow,
		HotkeyThreshold:   cfg.HotkeyThreshold,
	}
	srv := server.New(srvCfg, c)

	// Graceful shutdown listener
	stopChan := make(chan os.Signal, 1)
	signal.Notify(stopChan, os.Interrupt, syscall.SIGTERM)

	go func() {
		if err := srv.Start(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Fatal: HTTP server failed: %v", err)
		}
	}()

	log.Printf("Node %s is READY and serving requests on :%d", cfg.NodeID, cfg.Port)

	// If peers are configured, perform background peer discovery and key synchronization
	if len(cfg.Peers) > 0 {
		go func() {
			time.Sleep(1 * time.Second)
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			results := srv.PeerManager().CheckAllPeers(ctx)
			for addr, st := range results {
				if st.Reachable {
					log.Printf("[Cluster] Peer %s (%s) connected (latency: %dms)", addr, st.NodeID, st.LatencyMs)
					// Synchronize missing keys from reachable peer upon startup/recovery
					if synced, err := srv.RebalanceManager().SyncFromPeer(ctx, addr); err == nil && synced > 0 {
						log.Printf("[Sync] Restored %d keys from peer %s upon node startup/recovery", synced, addr)
					}
				} else {
					log.Printf("[Cluster] Peer %s unreachable yet (%s)", addr, st.LastError)
				}
			}
		}()
	}

	<-stopChan
	log.Println("\nShutdown signal received. Stopping node gracefully...")

	if err := srv.Close(); err != nil {
		log.Printf("Error closing server: %v", err)
	}

	log.Printf("Node %s stopped successfully.", cfg.NodeID)
}
