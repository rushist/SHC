package config

import (
	"flag"
	"os"
	"strconv"
	"strings"
	"time"
)

// NodeConfig holds all configuration parameters for a cache node instance.
type NodeConfig struct {
	NodeID            string        `json:"node_id"`
	HostID            string        `json:"host_id"` // e.g. EC2-A, EC2-B, EC2-C
	Host              string        `json:"host"`
	Port              int           `json:"port"`
	Peers             []string      `json:"peers"`
	CleanupInterval   time.Duration `json:"cleanup_interval"`
	PingTimeout       time.Duration `json:"ping_timeout"`
	HeartbeatInterval time.Duration `json:"heartbeat_interval"`
	SuspectTimeout    time.Duration `json:"suspect_timeout"`
	FailTimeout       time.Duration `json:"fail_timeout"`
	HotkeyWindow      time.Duration `json:"hotkey_window"`
	HotkeyThreshold   uint64        `json:"hotkey_threshold"`
}

// ParseFlags parses CLI flags and environment variables to construct a NodeConfig.
func ParseFlags() NodeConfig {
	defaultID := getFirstEnv([]string{"NODE_ID", "CACHE_NODE_ID"}, "node-a")
	defaultHostID := getFirstEnv([]string{"HOST_ID", "EC2_HOST_ID"}, "EC2-A")
	defaultHost := getFirstEnv([]string{"NODE_ADDRESS", "CACHE_HOST"}, "0.0.0.0")
	defaultPort := getFirstEnvInt([]string{"PORT", "NODE_PORT"}, 8001)
	defaultPeers := getFirstEnv([]string{"PEER_NODES", "PEERS", "CACHE_PEERS"}, "")
	defaultCleanup := getEnvDuration("CLEANUP_INTERVAL", 1*time.Second)
	defaultPingTimeout := getEnvDuration("PING_TIMEOUT", 2*time.Second)
	defaultHeartbeat := getEnvDuration("HEARTBEAT_INTERVAL", 1*time.Second)
	defaultSuspect := getEnvDuration("SUSPECT_TIMEOUT", 2*time.Second)
	defaultFail := getEnvDuration("FAIL_TIMEOUT", 4*time.Second)
	defaultHkWindow := getEnvDuration("HOTKEY_WINDOW", 5*time.Second)
	defaultHkThreshold := uint64(getEnvInt("HOTKEY_THRESHOLD", 20))

	nodeID := flag.String("id", defaultID, "Unique identifier for this node (or env NODE_ID)")
	hostID := flag.String("host-id", defaultHostID, "Physical host/EC2 instance identifier (or env HOST_ID)")
	host := flag.String("host", defaultHost, "Host address to bind to (or env NODE_ADDRESS)")
	port := flag.Int("port", defaultPort, "Port number to listen on (or env PORT / NODE_PORT)")
	peersRaw := flag.String("peers", defaultPeers, "Comma-separated list of peers (or env PEER_NODES)")
	cleanup := flag.Duration("cleanup", defaultCleanup, "TTL eviction ticker interval")
	pingTimeout := flag.Duration("ping-timeout", defaultPingTimeout, "HTTP timeout for peer communications")
	heartbeat := flag.Duration("heartbeat", defaultHeartbeat, "Heartbeat interval between peers")
	suspect := flag.Duration("suspect-timeout", defaultSuspect, "Duration before an unresponsive node is marked SUSPECTED")
	fail := flag.Duration("fail-timeout", defaultFail, "Duration before an unresponsive node is marked FAILED")
	hkWindow := flag.Duration("hotkey-window", defaultHkWindow, "Sliding window for hot-key detection")
	hkThreshold := flag.Uint64("hotkey-threshold", defaultHkThreshold, "Request threshold within window to mark a key as HOT")

	flag.Parse()

	var peers []string
	if *peersRaw != "" {
		for _, p := range strings.Split(*peersRaw, ",") {
			trimmed := strings.TrimSpace(p)
			if trimmed != "" {
				peers = append(peers, trimmed)
			}
		}
	}

	return NodeConfig{
		NodeID:            *nodeID,
		HostID:            *hostID,
		Host:              *host,
		Port:              *port,
		Peers:             peers,
		CleanupInterval:   *cleanup,
		PingTimeout:       *pingTimeout,
		HeartbeatInterval: *heartbeat,
		SuspectTimeout:    *suspect,
		FailTimeout:       *fail,
		HotkeyWindow:      *hkWindow,
		HotkeyThreshold:   *hkThreshold,
	}
}

func getFirstEnv(keys []string, fallback string) string {
	for _, k := range keys {
		if val := os.Getenv(k); val != "" {
			return val
		}
	}
	return fallback
}

func getFirstEnvInt(keys []string, fallback int) int {
	for _, k := range keys {
		if val := os.Getenv(k); val != "" {
			if i, err := strconv.Atoi(val); err == nil {
				return i
			}
		}
	}
	return fallback
}

func getEnv(key, fallback string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return fallback
}

func getEnvInt(key string, fallback int) int {
	if val := os.Getenv(key); val != "" {
		if i, err := strconv.Atoi(val); err == nil {
			return i
		}
	}
	return fallback
}

func getEnvDuration(key string, fallback time.Duration) time.Duration {
	if val := os.Getenv(key); val != "" {
		if d, err := time.ParseDuration(val); err == nil {
			return d
		}
	}
	return fallback
}
