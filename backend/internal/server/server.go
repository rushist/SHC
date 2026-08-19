package server

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"regexp"
	"strings"
	"time"

	"self-healing-cache/internal/cache"
	"self-healing-cache/internal/cluster"
	"self-healing-cache/internal/failover"
	"self-healing-cache/internal/hashing"
	"self-healing-cache/internal/health"
	"self-healing-cache/internal/hotkey"
	"self-healing-cache/internal/rebalancing"
	"self-healing-cache/internal/replication"
)

// Config configures the cache node HTTP server and cluster integration.
type Config struct {
	NodeID            string
	Host              string
	Port              int
	Peers             []string
	VNodes            int
	HeartbeatInterval time.Duration
	SuspectTimeout    time.Duration
	FailTimeout       time.Duration
	HotkeyWindow      time.Duration
	HotkeyThreshold   uint64
}

// Server wraps HTTP mux, Cache, PeerManager, HashRing, Replicator, HealthMonitor, FailoverRouter, RebalanceManager, and HotkeyDetector.
type Server struct {
	config           Config
	cache            *cache.Cache
	peerManager      *cluster.PeerManager
	hashRing         *hashing.HashRing
	replicator       *replication.Replicator
	healthMonitor    *health.Monitor
	failoverRouter   *failover.Router
	rebalanceManager *rebalancing.Manager
	hotkeyDetector   *hotkey.Detector
	mux              *http.ServeMux
	server           *http.Server
}

// SetRequest represents the payload for POST /set and POST /internal/replicate.
type SetRequest struct {
	Key        string `json:"key"`
	Value      string `json:"value"`
	TTLSeconds int64  `json:"ttl_seconds,omitempty"`
	Version    uint64 `json:"version,omitempty"`
	IsReplica  bool   `json:"is_replica,omitempty"`
}

// SetResponse represents the response for POST /set.
type SetResponse struct {
	Status      string `json:"status"`
	Key         string `json:"key"`
	NodeID      string `json:"node_id"`
	Version     uint64 `json:"version"`
	IsReplica   bool   `json:"is_replica"`
	ReplicaNode string `json:"replica_node,omitempty"`
}

// GetResponse represents the response for GET /get.
type GetResponse struct {
	Status       string `json:"status"`
	Key          string `json:"key"`
	Value        string `json:"value,omitempty"`
	TTLRemaining int64  `json:"ttl_remaining,omitempty"`
	Version      uint64 `json:"version,omitempty"`
	IsReplica    bool   `json:"is_replica"`
	IsHot        bool   `json:"is_hot"`
	RequestCount uint64 `json:"request_count"`
	NodeID       string `json:"node_id"`
	Message      string `json:"message,omitempty"`
}

// DeleteResponse represents the response for DELETE /delete.
type DeleteResponse struct {
	Status  string `json:"status"`
	Key     string `json:"key"`
	NodeID  string `json:"node_id"`
	Message string `json:"message,omitempty"`
}

// HealthResponse represents the response for GET /health.
type HealthResponse struct {
	Status        string `json:"status"`
	NodeID        string `json:"node_id"`
	State         string `json:"state"`
	UptimeSeconds int64  `json:"uptime_seconds"`
}

// StatsResponse represents the response for GET /stats.
type StatsResponse struct {
	NodeID           string            `json:"node_id"`
	State            string            `json:"state"`
	TotalKeys        int               `json:"total_keys"`
	PrimaryKeys      int               `json:"primary_keys"`
	ReplicaKeys      int               `json:"replica_keys"`
	HitCount         uint64            `json:"hit_count"`
	MissCount        uint64            `json:"miss_count"`
	SetCount         uint64            `json:"set_count"`
	DeleteCount      uint64            `json:"delete_count"`
	ExpiredCount     uint64            `json:"expired_count"`
	ReplicationStats replication.Stats `json:"replication_stats"`
	FailoverStats    failover.Stats    `json:"failover_stats"`
	UptimeSeconds    int64             `json:"uptime_seconds"`
}

// Module 6: GET /route/get?key=... resolves key, checks health, and fails over to replica if primary is down
func (s *Server) handleRouteGet(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, `{"error":"Method not allowed, use GET"}`, http.StatusMethodNotAllowed)
		return
	}

	key := r.URL.Query().Get("key")
	if strings.TrimSpace(key) == "" {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Missing key query parameter"})
		return
	}

	result, err := s.failoverRouter.RouteGet(r.Context(), key)
	if err != nil {
		s.writeJSON(w, http.StatusNotFound, map[string]interface{}{
			"status":  "error",
			"key":     key,
			"message": err.Error(),
		})
		return
	}

	s.writeJSON(w, http.StatusOK, result)
}

// PeersResponse represents the response for GET /internal/peers.
type PeersResponse struct {
	SelfNodeID string                         `json:"self_node_id"`
	Peers      map[string]*cluster.PeerStatus `json:"peers"`
}

// LocateResponse represents key-to-node mapping for GET /debug/locate.
type LocateResponse struct {
	Key         string `json:"key"`
	Hash        uint32 `json:"hash"`
	PrimaryNode string `json:"primary_node"`
	PrimaryAddr string `json:"primary_addr"`
	ReplicaNode string `json:"replica_node,omitempty"`
	ReplicaAddr string `json:"replica_addr,omitempty"`
	IsLocal     bool   `json:"is_local"`
}

// OwnedKeysResponse represents the keys stored locally that map to this node.
type OwnedKeysResponse struct {
	NodeID      string   `json:"node_id"`
	TotalKeys   int      `json:"total_keys"`
	PrimaryKeys []string `json:"primary_keys"`
	ReplicaKeys []string `json:"replica_keys"`
}

// New creates a new HTTP Server for a cache node with peer management, hash ring, and replicator.
func New(cfg Config, c *cache.Cache) *Server {
	selfAddr := fmt.Sprintf("http://%s:%d", cfg.Host, cfg.Port)
	if cfg.Host == "0.0.0.0" {
		selfAddr = fmt.Sprintf("http://localhost:%d", cfg.Port)
	}

	peerAddrs := make([]string, 0, len(cfg.Peers))
	peerIDToAddr := make(map[string]string)

	for _, p := range cfg.Peers {
		if strings.Contains(p, "=") {
			parts := strings.SplitN(p, "=", 2)
			pID := strings.TrimSpace(parts[0])
			pAddr := strings.TrimSpace(parts[1])
			peerAddrs = append(peerAddrs, pAddr)
			peerIDToAddr[pID] = pAddr
		} else {
			peerAddrs = append(peerAddrs, p)
			peerIDToAddr[p] = p
		}
	}

	pm := cluster.NewPeerManager(cfg.NodeID, selfAddr, peerAddrs, 2*time.Second)

	vnodes := cfg.VNodes
	if vnodes <= 0 {
		vnodes = 50
	}
	ring := hashing.New(vnodes, nil)
	ring.AddNode(cfg.NodeID, selfAddr)
	for pID, pAddr := range peerIDToAddr {
		ring.AddNode(pID, pAddr)
	}

	rep := replication.New(2 * time.Second)

	healthCfg := health.Config{
		SelfNodeID:        cfg.NodeID,
		SelfAddr:          selfAddr,
		Peers:             peerIDToAddr,
		HeartbeatInterval: cfg.HeartbeatInterval,
		SuspectTimeout:    cfg.SuspectTimeout,
		FailTimeout:       cfg.FailTimeout,
	}
	hMon := health.NewMonitor(healthCfg)
	fRouter := failover.NewRouter(ring, hMon, 1500*time.Millisecond)
	rebMgr := rebalancing.NewManager(cfg.NodeID, selfAddr, c, ring, 3*time.Second)

	hkCfg := hotkey.Config{
		WindowDuration: cfg.HotkeyWindow,
		ThresholdCount: cfg.HotkeyThreshold,
	}
	hkDet := hotkey.NewDetector(hkCfg)

	s := &Server{
		config:           cfg,
		cache:            c,
		peerManager:      pm,
		hashRing:         ring,
		replicator:       rep,
		healthMonitor:    hMon,
		failoverRouter:   fRouter,
		rebalanceManager: rebMgr,
		hotkeyDetector:   hkDet,
		mux:              http.NewServeMux(),
	}

	s.routes()
	addr := fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)
	s.server = &http.Server{
		Addr:         addr,
		Handler:      s.enableCORS(s.mux),
		ReadTimeout:  5 * time.Second,
		WriteTimeout: 5 * time.Second,
	}

	return s
}

func (s *Server) enableCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}

		next.ServeHTTP(w, r)
	})
}

func (s *Server) routes() {
	// Public node endpoints
	s.mux.HandleFunc("/health", s.handleHealth)
	s.mux.HandleFunc("/stats", s.handleStats)
	s.mux.HandleFunc("/set", s.handleSet)
	s.mux.HandleFunc("/get", s.handleGet)
	s.mux.HandleFunc("/delete", s.handleDelete)

	// Module 5: Cluster Health & Membership view
	s.mux.HandleFunc("/cluster", s.handleCluster)

	// Module 6: Health-aware failover read routing
	s.mux.HandleFunc("/route/get", s.handleRouteGet)

	// Module 7: Recovery & Rebalancing endpoints
	s.mux.HandleFunc("/internal/dump", s.handleInternalDump)
	s.mux.HandleFunc("/internal/sync/bulk", s.handleInternalSyncBulk)
	s.mux.HandleFunc("/internal/rebalance", s.handleInternalRebalance)
	s.mux.HandleFunc("/debug/rebalance-stats", s.handleDebugRebalanceStats)

	// Module 8: Hot-Key detection endpoint
	s.mux.HandleFunc("/hotkeys", s.handleHotKeys)

	// Internal cluster endpoints
	s.mux.HandleFunc("/internal/health", s.handleInternalHealth)
	s.mux.HandleFunc("/internal/stats", s.handleInternalStats)
	s.mux.HandleFunc("/internal/peers", s.handleInternalPeers)
	s.mux.HandleFunc("/internal/replicate", s.handleInternalReplicate)
	s.mux.HandleFunc("/internal/replicate-delete", s.handleInternalReplicateDelete)

	// Debug & inspection endpoints
	s.mux.HandleFunc("/debug/ring", s.handleDebugRing)
	s.mux.HandleFunc("/debug/locate", s.handleDebugLocate)
	s.mux.HandleFunc("/debug/owned-keys", s.handleDebugOwnedKeys)
}

// HotkeyDetector returns the server's hot key detector.
func (s *Server) HotkeyDetector() *hotkey.Detector {
	return s.hotkeyDetector
}

// RebalanceManager returns the server's recovery and rebalance manager.
func (s *Server) RebalanceManager() *rebalancing.Manager {
	return s.rebalanceManager
}

// FailoverRouter returns the server's failover router.
func (s *Server) FailoverRouter() *failover.Router {
	return s.failoverRouter
}

// HealthMonitor returns the server's cluster health monitor.
func (s *Server) HealthMonitor() *health.Monitor {
	return s.healthMonitor
}

// HashRing returns the server's consistent hash ring.
func (s *Server) HashRing() *hashing.HashRing {
	return s.hashRing
}

// Replicator returns the server's replication engine.
func (s *Server) Replicator() *replication.Replicator {
	return s.replicator
}

// PeerManager returns the server's peer communication manager.
func (s *Server) PeerManager() *cluster.PeerManager {
	return s.peerManager
}

// Handler returns the underlying http.Handler (useful for httptest).
func (s *Server) Handler() http.Handler {
	return s.enableCORS(s.mux)
}

// Start begins listening on the configured address and starts the health monitor.
func (s *Server) Start() error {
	s.healthMonitor.Start()
	return s.server.ListenAndServe()
}

// Close gracefully closes the server and stops the health monitor.
func (s *Server) Close() error {
	s.healthMonitor.Stop()
	return s.server.Close()
}

// Module 7: GET /internal/dump exports all active keys for sync and recovery
func (s *Server) handleInternalDump(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, `{"error":"Method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	items := s.rebalanceManager.DumpLocalKeys()
	s.writeJSON(w, http.StatusOK, map[string]interface{}{
		"node_id": s.config.NodeID,
		"count":   len(items),
		"items":   items,
	})
}

// Module 7: POST /internal/sync/bulk imports an array of dump items into memory
func (s *Server) handleInternalSyncBulk(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"Method not allowed, use POST"}`, http.StatusMethodNotAllowed)
		return
	}

	var payload rebalancing.BulkSyncPayload
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid bulk payload: " + err.Error()})
		return
	}

	ingested := s.rebalanceManager.IngestBulkKeys(payload.Items)
	s.writeJSON(w, http.StatusOK, map[string]interface{}{
		"status":   "bulk_synced",
		"node_id":  s.config.NodeID,
		"ingested": ingested,
	})
}

// Module 7: POST /internal/rebalance migrates affected keys to a newly added node
func (s *Server) handleInternalRebalance(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"Method not allowed, use POST"}`, http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		NodeID string `json:"node_id"`
		Addr   string `json:"addr"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.NodeID == "" || req.Addr == "" {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Provide node_id and addr in JSON"})
		return
	}

	report, err := s.rebalanceManager.RebalanceForNewNode(r.Context(), req.NodeID, req.Addr)
	if err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	s.writeJSON(w, http.StatusOK, report)
}

// Module 7: GET /debug/rebalance-stats returns rebalance history
func (s *Server) handleDebugRebalanceStats(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, `{"error":"Method not allowed, use GET"}`, http.StatusMethodNotAllowed)
		return
	}

	reports := s.rebalanceManager.GetReports()
	s.writeJSON(w, http.StatusOK, map[string]interface{}{
		"node_id": s.config.NodeID,
		"count":   len(reports),
		"reports": reports,
	})
}

// Module 5: GET /cluster returns live cluster membership and node states
func (s *Server) handleCluster(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, `{"error":"Method not allowed, use GET"}`, http.StatusMethodNotAllowed)
		return
	}

	view := s.healthMonitor.GetClusterView()
	s.writeJSON(w, http.StatusOK, view)
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, `{"error":"Method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	stats := s.cache.Stats()
	resp := HealthResponse{
		Status:        "UP",
		NodeID:        s.config.NodeID,
		State:         "ALIVE",
		UptimeSeconds: stats.UptimeSeconds,
	}

	s.writeJSON(w, http.StatusOK, resp)
}

func (s *Server) handleStats(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, `{"error":"Method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	stats := s.cache.Stats()
	resp := StatsResponse{
		NodeID:           s.config.NodeID,
		State:            "ALIVE",
		TotalKeys:        stats.TotalKeys,
		PrimaryKeys:      stats.PrimaryKeys,
		ReplicaKeys:      stats.ReplicaKeys,
		HitCount:         stats.HitCount,
		MissCount:        stats.MissCount,
		SetCount:         stats.SetCount,
		DeleteCount:      stats.DeleteCount,
		ExpiredCount:     stats.ExpiredCount,
		ReplicationStats: s.replicator.Stats(),
		FailoverStats:    s.failoverRouter.Stats(),
		UptimeSeconds:    stats.UptimeSeconds,
	}

	s.writeJSON(w, http.StatusOK, resp)
}

func (s *Server) handleInternalHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, `{"error":"Method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	stats := s.cache.Stats()
	addr := fmt.Sprintf("http://%s:%d", s.config.Host, s.config.Port)
	if s.config.Host == "0.0.0.0" {
		addr = fmt.Sprintf("http://localhost:%d", s.config.Port)
	}

	resp := cluster.InternalHealth{
		Status:        "UP",
		NodeID:        s.config.NodeID,
		State:         "ALIVE",
		Addr:          addr,
		PrimaryKeys:   stats.PrimaryKeys,
		ReplicaKeys:   stats.ReplicaKeys,
		HitCount:      stats.HitCount,
		UptimeSeconds: stats.UptimeSeconds,
	}

	s.writeJSON(w, http.StatusOK, resp)
}

func (s *Server) handleInternalStats(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, `{"error":"Method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	stats := s.cache.Stats()
	resp := cluster.InternalStats{
		NodeID:        s.config.NodeID,
		State:         "ALIVE",
		TotalKeys:     stats.TotalKeys,
		HitCount:      stats.HitCount,
		MissCount:     stats.MissCount,
		SetCount:      stats.SetCount,
		DeleteCount:   stats.DeleteCount,
		ExpiredCount:  stats.ExpiredCount,
		UptimeSeconds: stats.UptimeSeconds,
	}

	s.writeJSON(w, http.StatusOK, resp)
}

func (s *Server) handleInternalPeers(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, `{"error":"Method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	var peersStatus map[string]*cluster.PeerStatus
	if r.URL.Query().Get("refresh") == "true" {
		ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
		defer cancel()
		peersStatus = s.peerManager.CheckAllPeers(ctx)
		for addr, status := range peersStatus {
			if status.Reachable && status.NodeID != "" {
				s.hashRing.AddNode(status.NodeID, addr)
			}
		}
	} else {
		peersStatus = s.peerManager.GetPeersStatus()
	}

	resp := PeersResponse{
		SelfNodeID: s.config.NodeID,
		Peers:      peersStatus,
	}

	s.writeJSON(w, http.StatusOK, resp)
}

// Module 4: Handle replicated write payload from primary node
func (s *Server) handleInternalReplicate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"Method not allowed, use POST"}`, http.StatusMethodNotAllowed)
		return
	}

	var req SetRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON body: " + err.Error()})
		return
	}

	var ttl time.Duration
	if req.TTLSeconds > 0 {
		ttl = time.Duration(req.TTLSeconds) * time.Second
	}

	item := s.cache.SetWithMetadata(req.Key, req.Value, ttl, req.Version, true)

	resp := SetResponse{
		Status:    "replicated",
		Key:       item.Key,
		NodeID:    s.config.NodeID,
		Version:   item.Version,
		IsReplica: true,
	}

	s.writeJSON(w, http.StatusOK, resp)
}

// Module 4: Handle replicated delete from primary node
func (s *Server) handleInternalReplicateDelete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete && r.Method != http.MethodPost {
		http.Error(w, `{"error":"Method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	key := r.URL.Query().Get("key")
	if key == "" {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Missing key"})
		return
	}

	s.cache.Delete(key)
	s.writeJSON(w, http.StatusOK, map[string]string{"status": "deleted_replica", "key": key})
}

// Debug endpoint returning the full Hash Ring topology
func (s *Server) handleDebugRing(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, `{"error":"Method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	topology := s.hashRing.GetTopology()
	s.writeJSON(w, http.StatusOK, topology)
}

// Debug endpoint locating which node owns a given key
func (s *Server) handleDebugLocate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, `{"error":"Method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	key := r.URL.Query().Get("key")
	if strings.TrimSpace(key) == "" {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Missing query parameter: key"})
		return
	}

	nodes, err := s.hashRing.GetNodes(key, 2)
	if err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	keyHash := s.hashRing.HashKey(key)

	resp := LocateResponse{
		Key:         key,
		Hash:        keyHash,
		PrimaryNode: nodes[0].NodeID,
		PrimaryAddr: nodes[0].Addr,
		IsLocal:     nodes[0].NodeID == s.config.NodeID,
	}

	if len(nodes) > 1 {
		resp.ReplicaNode = nodes[1].NodeID
		resp.ReplicaAddr = nodes[1].Addr
	}

	s.writeJSON(w, http.StatusOK, resp)
}

// Debug endpoint listing keys stored in this node partitioned by primary / replica
func (s *Server) handleDebugOwnedKeys(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, `{"error":"Method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	allKeys := s.cache.Keys()
	primaryKeys := make([]string, 0)
	replicaKeys := make([]string, 0)

	for _, k := range allKeys {
		if item, found := s.cache.Get(k); found {
			if item.IsReplica {
				replicaKeys = append(replicaKeys, k)
			} else {
				primaryKeys = append(primaryKeys, k)
			}
		}
	}

	resp := OwnedKeysResponse{
		NodeID:      s.config.NodeID,
		TotalKeys:   len(allKeys),
		PrimaryKeys: primaryKeys,
		ReplicaKeys: replicaKeys,
	}

	s.writeJSON(w, http.StatusOK, resp)
}

func (s *Server) handleSet(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"Method not allowed, use POST"}`, http.StatusMethodNotAllowed)
		return
	}

	var req SetRequest
	if r.Body != nil {
		bodyBytes, _ := io.ReadAll(r.Body)
		if len(bodyBytes) > 0 {
			// Try strict JSON decode first
			if err := json.Unmarshal(bodyBytes, &req); err != nil {
				// If JSON decode failed (e.g. PowerShell stripped quotes: {key:user:123,value:Rushabh_Rocks})
				raw := string(bodyBytes)
				req.Key = extractField(raw, "key")
				req.Value = extractField(raw, "value")
				if ttlStr := extractField(raw, "ttl_seconds"); ttlStr != "" {
					fmt.Sscanf(ttlStr, "%d", &req.TTLSeconds)
				}
			}
		}
	}

	// Fallback to URL query params or Form values
	if strings.TrimSpace(req.Key) == "" {
		req.Key = r.URL.Query().Get("key")
		if req.Key == "" {
			req.Key = r.FormValue("key")
		}
	}
	if strings.TrimSpace(req.Value) == "" {
		req.Value = r.URL.Query().Get("value")
		if req.Value == "" {
			req.Value = r.FormValue("value")
		}
	}
	if req.TTLSeconds == 0 {
		if ttlQuery := r.URL.Query().Get("ttl_seconds"); ttlQuery != "" {
			fmt.Sscanf(ttlQuery, "%d", &req.TTLSeconds)
		} else if ttlQuery = r.URL.Query().Get("ttl"); ttlQuery != "" {
			fmt.Sscanf(ttlQuery, "%d", &req.TTLSeconds)
		}
	}

	if strings.TrimSpace(req.Key) == "" {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Key cannot be empty (provide JSON body or ?key=...&value=...)"})
		return
	}

	var ttl time.Duration
	if req.TTLSeconds > 0 {
		ttl = time.Duration(req.TTLSeconds) * time.Second
	}

	// Store locally
	item := s.cache.SetWithMetadata(req.Key, req.Value, ttl, req.Version, req.IsReplica)

	replicaNodeID := ""

	// If this is a primary write, propagate to replica node (factor 2)
	if !req.IsReplica {
		if targets, err := s.hashRing.GetNodes(req.Key, 2); err == nil && len(targets) > 1 {
			replicaTarget := targets[1]
			replicaNodeID = replicaTarget.NodeID

			// Replicate if replica is a different node
			if replicaTarget.NodeID != s.config.NodeID && replicaTarget.Addr != "" {
				go func(addr, k, v string, d time.Duration, ver uint64) {
					ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
					defer cancel()
					if repErr := s.replicator.ReplicateSet(ctx, addr, k, v, d, ver); repErr != nil {
						log.Printf("[Replication] Warning: Failed to replicate key '%s' to %s (%s): %v", k, replicaTarget.NodeID, addr, repErr)
					}
				}(replicaTarget.Addr, item.Key, item.Value, ttl, item.Version)
			}
		}
	}

	resp := SetResponse{
		Status:      "stored",
		Key:         item.Key,
		NodeID:      s.config.NodeID,
		Version:     item.Version,
		IsReplica:   item.IsReplica,
		ReplicaNode: replicaNodeID,
	}

	s.writeJSON(w, http.StatusOK, resp)
}

// Module 8: GET /hotkeys returns list of active hot keys on this node
func (s *Server) handleHotKeys(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, `{"error":"Method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	hotList := s.hotkeyDetector.GetHotKeys()
	s.writeJSON(w, http.StatusOK, map[string]interface{}{
		"node_id":        s.config.NodeID,
		"total_hot_keys": len(hotList),
		"hot_keys":       hotList,
	})
}

func (s *Server) handleGet(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, `{"error":"Method not allowed, use GET"}`, http.StatusMethodNotAllowed)
		return
	}

	key := r.URL.Query().Get("key")
	if strings.TrimSpace(key) == "" {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Missing required query parameter: key"})
		return
	}

	item, found := s.cache.Get(key)
	if !found {
		resp := GetResponse{
			Status:  "miss",
			Key:     key,
			NodeID:  s.config.NodeID,
			Message: "Key not found or expired",
		}
		s.writeJSON(w, http.StatusNotFound, resp)
		return
	}

	// Module 8: Record request frequency for hot-key detection
	isHot, count := s.hotkeyDetector.RecordAccess(key)

	// If key is hot, automatically promote it to an extra replica node if available
	if isHot {
		if targets, err := s.hashRing.GetNodes(key, 3); err == nil && len(targets) > 2 {
			extraReplica := targets[2]
			if extraReplica.NodeID != s.config.NodeID && extraReplica.Addr != "" {
				go func(addr, k, v string, ttlRemaining int64, ver uint64) {
					ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
					defer cancel()
					var ttl time.Duration
					if ttlRemaining > 0 {
						ttl = time.Duration(ttlRemaining) * time.Second
					}
					s.replicator.ReplicateSet(ctx, addr, k, v, ttl, ver)
				}(extraReplica.Addr, item.Key, item.Value, item.TTLRemaining(), item.Version)
			}
		}
	}

	resp := GetResponse{
		Status:       "hit",
		Key:          item.Key,
		Value:        item.Value,
		TTLRemaining: item.TTLRemaining(),
		Version:      item.Version,
		IsReplica:    item.IsReplica,
		IsHot:        isHot,
		RequestCount: count,
		NodeID:       s.config.NodeID,
	}

	s.writeJSON(w, http.StatusOK, resp)
}

func (s *Server) handleDelete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete && r.Method != http.MethodPost {
		http.Error(w, `{"error":"Method not allowed, use DELETE"}`, http.StatusMethodNotAllowed)
		return
	}

	key := r.URL.Query().Get("key")
	if key == "" && r.Body != nil {
		var body struct {
			Key string `json:"key"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err == nil {
			key = body.Key
		}
	}

	if strings.TrimSpace(key) == "" {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Missing required parameter: key"})
		return
	}

	deleted := s.cache.Delete(key)

	// Propagate delete to replica
	if targets, err := s.hashRing.GetNodes(key, 2); err == nil && len(targets) > 1 {
		replicaTarget := targets[1]
		if replicaTarget.NodeID != s.config.NodeID && replicaTarget.Addr != "" {
			go func(addr, k string) {
				ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
				defer cancel()
				s.replicator.ReplicateDelete(ctx, addr, k)
			}(replicaTarget.Addr, key)
		}
	}

	if !deleted {
		resp := DeleteResponse{
			Status:  "not_found",
			Key:     key,
			NodeID:  s.config.NodeID,
			Message: "Key does not exist",
		}
		s.writeJSON(w, http.StatusNotFound, resp)
		return
	}

	resp := DeleteResponse{
		Status: "deleted",
		Key:    key,
		NodeID: s.config.NodeID,
	}

	s.writeJSON(w, http.StatusOK, resp)
}

func (s *Server) writeJSON(w http.ResponseWriter, statusCode int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	json.NewEncoder(w).Encode(data)
}

// extractField parses unquoted or semi-quoted key values from malformed command-line payloads
func extractField(raw, field string) string {
	// Pattern 1: field:"value" or field:value or "field":"value"
	patterns := []string{
		`"` + field + `"\s*:\s*"([^"]+)"`,
		`"` + field + `"\s*:\s*([^,}\s]+)`,
		`\b` + field + `\s*:\s*"([^"]+)"`,
		`\b` + field + `\s*:\s*([^,}\s]+)`,
	}

	for _, p := range patterns {
		re := regexp.MustCompile(p)
		matches := re.FindStringSubmatch(raw)
		if len(matches) > 1 {
			val := strings.Trim(matches[1], `"' `)
			return val
		}
	}
	return ""
}

