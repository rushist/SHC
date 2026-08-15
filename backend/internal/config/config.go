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
// CLI flags override environment variables; environment variables override default values.
func ParseFlags() NodeConfig {
	defaultID := getEnv("CACHE_NODE_ID", "node-1")
	defaultHost := getEnv("CACHE_HOST", "0.0.0.0")
	defaultPort := getEnvInt("PORT", 8001)
	defaultPeers := getEnv("CACHE_PEERS", "")
	defaultCleanup := getEnvDuration("CLEANUP_INTERVAL", 1*time.Second)
	defaultPingTimeout := getEnvDuration("PING_TIMEOUT", 2*time.Second)
	defaultHeartbeat := getEnvDuration("HEARTBEAT_INTERVAL", 1*time.Second)
	defaultSuspect := getEnvDuration("SUSPECT_TIMEOUT", 2*time.Second)
	defaultFail := getEnvDuration("FAIL_TIMEOUT", 4*time.Second)
	defaultHkWindow := getEnvDuration("HOTKEY_WINDOW", 5*time.Second)
	defaultHkThreshold := uint64(getEnvInt("HOTKEY_THRESHOLD", 20))

	nodeID := flag.String("id", defaultID, "Unique identifier for this node (or env CACHE_NODE_ID)")
	host := flag.String("host", defaultHost, "Host address to bind to (or env CACHE_HOST)")
	port := flag.Int("port", defaultPort, "Port number to listen on (or env PORT)")
	peersRaw := flag.String("peers", defaultPeers, "Comma-separated list of peers (or env CACHE_PEERS)")
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
