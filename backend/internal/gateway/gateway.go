package gateway

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"self-healing-cache/internal/database"
	"self-healing-cache/internal/failover"
	"self-healing-cache/internal/hashing"
	"self-healing-cache/internal/health"
)

var (
	ErrNoNodes = errors.New("gateway: no healthy nodes available in cluster")
)

// Config configures the unified gateway router.
type Config struct {
	Port              int           `json:"port"`
	Host              string        `json:"host"`
	Nodes             []string      `json:"nodes"` // e.g. ["node-a=http://localhost:8001", "node-b=http://localhost:8002", "node-c=http://localhost:8003"]
	VNodes            int           `json:"vnodes"`
	HeartbeatInterval time.Duration `json:"heartbeat_interval"`
	SuspectTimeout    time.Duration `json:"suspect_timeout"`
	FailTimeout       time.Duration `json:"fail_timeout"`
	RequestTimeout    time.Duration `json:"request_timeout"`
}

// Gateway provides the unified abstraction layer over the cache cluster on Port 8000.
type Gateway struct {
	config        Config
	hashRing      *hashing.HashRing
	healthMonitor *health.Monitor
	failover      *failover.Router
	backingDB     *database.BackingDB
	client        *http.Client
	mux           *http.ServeMux
	server        *http.Server
}

// ClientSetRequest is the public body for POST /api/set.
type ClientSetRequest struct {
	Key        string `json:"key"`
	Value      string `json:"value"`
	TTLSeconds int64  `json:"ttl_seconds,omitempty"`
}

// ClientResponse is the unified client response format.
type ClientResponse struct {
	Status       string `json:"status"`
	Key          string `json:"key,omitempty"`
	Value        string `json:"value,omitempty"`
	TTLRemaining int64  `json:"ttl_remaining,omitempty"`
	Version      uint64 `json:"version,omitempty"`
	ServedBy     string `json:"served_by,omitempty"`
	IsFailover   bool   `json:"is_failover,omitempty"`
	Message      string `json:"message,omitempty"`
}

// New creates a new Gateway instance.
func New(cfg Config) *Gateway {
	if cfg.Port <= 0 {
		cfg.Port = 8000
	}
	if cfg.Host == "" {
		cfg.Host = "0.0.0.0"
	}
	if cfg.VNodes <= 0 {
		cfg.VNodes = 50
	}
	if cfg.HeartbeatInterval <= 0 {
		cfg.HeartbeatInterval = 500 * time.Millisecond
	}
	if cfg.SuspectTimeout <= 0 {
		cfg.SuspectTimeout = 1 * time.Second
	}
	if cfg.FailTimeout <= 0 {
		cfg.FailTimeout = 2 * time.Second
	}
	if cfg.RequestTimeout <= 0 {
		cfg.RequestTimeout = 2 * time.Second
	}

	ring := hashing.New(cfg.VNodes, nil)
	peerMap := make(map[string]string)

	for _, n := range cfg.Nodes {
		parts := strings.SplitN(n, "=", 2)
		if len(parts) == 2 {
			id := strings.TrimSpace(parts[0])
			addr := strings.TrimSpace(parts[1])
			ring.AddNode(id, addr)
			peerMap[id] = addr
		}
	}

	hMon := health.NewMonitor(health.Config{
		SelfNodeID:        "gateway-router",
		Peers:             peerMap,
		HeartbeatInterval: cfg.HeartbeatInterval,
		SuspectTimeout:    cfg.SuspectTimeout,
		FailTimeout:       cfg.FailTimeout,
	})

	fo := failover.NewRouter(ring, hMon, cfg.RequestTimeout)
	db := database.New(10000, 45) // 10,000 seeded records with 45ms realistic DB latency

	gw := &Gateway{
		config:        cfg,
		hashRing:      ring,
		healthMonitor: hMon,
		failover:      fo,
		backingDB:     db,
		client: &http.Client{
			Timeout: cfg.RequestTimeout,
		},
		mux: http.NewServeMux(),
	}

	gw.routes()
	addr := fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)
	gw.server = &http.Server{
		Addr:         addr,
		Handler:      gw.enableCORS(gw.mux),
		ReadTimeout:  5 * time.Second,
		WriteTimeout: 5 * time.Second,
	}

	return gw
}

func (g *Gateway) enableCORS(next http.Handler) http.Handler {
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

func (g *Gateway) routes() {
	// Unified Public Client API
	g.mux.HandleFunc("/api/set", g.handleAPISet)
	g.mux.HandleFunc("/api/get", g.handleAPIGet)
	g.mux.HandleFunc("/api/delete", g.handleAPIDelete)

	// Backing Database & Catalog Cache-Aside API
	g.mux.HandleFunc("/api/catalog", g.handleAPICatalog)
	g.mux.HandleFunc("/api/db/stats", g.handleAPIDBStats)

	// Cluster Observability & Topology APIs
	g.mux.HandleFunc("/api/health", g.handleAPIHealth)
	g.mux.HandleFunc("/api/cluster", g.handleAPICluster)
	g.mux.HandleFunc("/api/stats", g.handleAPIStats)
	g.mux.HandleFunc("/api/node/state", g.handleAPINodeState)
}

// Start boots the heartbeat monitor and starts listening for client HTTP requests.
func (g *Gateway) Start() error {
	g.healthMonitor.Start()
	log.Printf("[Gateway] Unified Router running on %s:%d (Connected to %d nodes)", g.config.Host, g.config.Port, g.hashRing.NodeCount())
	return g.server.ListenAndServe()
}

// Close stops the gateway server and heartbeat monitor.
func (g *Gateway) Close() error {
	g.healthMonitor.Stop()
	return g.server.Close()
}

// Handler returns the HTTP handler for testing.
func (g *Gateway) Handler() http.Handler {
	return g.enableCORS(g.mux)
}

func (g *Gateway) writeJSON(w http.ResponseWriter, statusCode int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	_ = json.NewEncoder(w).Encode(data)
}

// POST /api/set — Unified client set endpoint
func (g *Gateway) handleAPISet(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		g.writeJSON(w, http.StatusMethodNotAllowed, ClientResponse{Status: "error", Message: "Method not allowed, use POST"})
		return
	}

	var req ClientSetRequest
	if r.Body != nil {
		bodyBytes, _ := io.ReadAll(r.Body)
		if len(bodyBytes) > 0 {
			if err := json.Unmarshal(bodyBytes, &req); err != nil {
				raw := string(bodyBytes)
				req.Key = extractString(raw, "key")
				req.Value = extractString(raw, "value")
				if ttlStr := extractString(raw, "ttl_seconds"); ttlStr != "" {
					fmt.Sscanf(ttlStr, "%d", &req.TTLSeconds)
				}
			}
		}
	}

	if req.Key == "" {
		req.Key = r.URL.Query().Get("key")
		if req.Key == "" {
			req.Key = r.FormValue("key")
		}
	}
	if req.Value == "" {
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

	if req.Key == "" {
		g.writeJSON(w, http.StatusBadRequest, ClientResponse{Status: "error", Message: "Key cannot be empty"})
		return
	}

	// Locate primary and replica nodes
	targets, err := g.hashRing.GetNodes(req.Key, 2)
	if err != nil || len(targets) == 0 {
		g.writeJSON(w, http.StatusServiceUnavailable, ClientResponse{Status: "error", Message: "No storage nodes available"})
		return
	}

	primary := targets[0]
	targetAddr := primary.Addr

	// If primary is known to be down, route set directly to replica
	pState, known := g.healthMonitor.GetNodeState(primary.NodeID)
	if known && pState == health.StateFailed && len(targets) > 1 {
		targetAddr = targets[1].Addr
	}

	// Forward write to storage node
	payloadBytes, _ := json.Marshal(req)
	resp, err := g.client.Post(fmt.Sprintf("%s/set", targetAddr), "application/json", bytes.NewReader(payloadBytes))
	if err != nil && len(targets) > 1 {
		// Fallback write to replica if primary connection errored
		targetAddr = targets[1].Addr
		resp, err = g.client.Post(fmt.Sprintf("%s/set", targetAddr), "application/json", bytes.NewReader(payloadBytes))
	}

	if err != nil {
		g.writeJSON(w, http.StatusBadGateway, ClientResponse{Status: "error", Key: req.Key, Message: fmt.Sprintf("Cluster write failed: %v", err)})
		return
	}
	defer resp.Body.Close()

	g.writeJSON(w, http.StatusOK, ClientResponse{
		Status:   "stored",
		Key:      req.Key,
		ServedBy: primary.NodeID,
	})
}

// GET /api/get — Unified client get endpoint with automatic failover
func (g *Gateway) handleAPIGet(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		g.writeJSON(w, http.StatusMethodNotAllowed, ClientResponse{Status: "error", Message: "Method not allowed, use GET"})
		return
	}

	key := r.URL.Query().Get("key")
	if strings.TrimSpace(key) == "" {
		g.writeJSON(w, http.StatusBadRequest, ClientResponse{Status: "error", Message: "Missing required query parameter: key"})
		return
	}

	res, err := g.failover.RouteGet(r.Context(), key)
	if err != nil {
		g.writeJSON(w, http.StatusNotFound, ClientResponse{
			Status:  "miss",
			Key:     key,
			Message: "Key not found or expired",
		})
		return
	}

	g.writeJSON(w, http.StatusOK, ClientResponse{
		Status:       "hit",
		Key:          res.Key,
		Value:        res.Value,
		TTLRemaining: res.TTLRemaining,
		Version:      res.Version,
		ServedBy:     res.ServedBy,
		IsFailover:   res.IsFailover,
	})
}

// DELETE /api/delete — Unified client delete endpoint
func (g *Gateway) handleAPIDelete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete && r.Method != http.MethodPost {
		g.writeJSON(w, http.StatusMethodNotAllowed, ClientResponse{Status: "error", Message: "Method not allowed, use DELETE"})
		return
	}

	key := r.URL.Query().Get("key")
	if key == "" {
		key = r.FormValue("key")
	}
	if strings.TrimSpace(key) == "" {
		g.writeJSON(w, http.StatusBadRequest, ClientResponse{Status: "error", Message: "Missing required key parameter"})
		return
	}

	targets, err := g.hashRing.GetNodes(key, 2)
	if err != nil || len(targets) == 0 {
		g.writeJSON(w, http.StatusServiceUnavailable, ClientResponse{Status: "error", Message: "No storage nodes available"})
		return
	}

	primary := targets[0]
	delURL := fmt.Sprintf("%s/delete?key=%s", primary.Addr, key)
	req, _ := http.NewRequestWithContext(r.Context(), http.MethodDelete, delURL, nil)
	resp, err := g.client.Do(req)

	if err != nil && len(targets) > 1 {
		// Fallback delete to replica
		delURL = fmt.Sprintf("%s/delete?key=%s", targets[1].Addr, key)
		req, _ = http.NewRequestWithContext(r.Context(), http.MethodDelete, delURL, nil)
		resp, err = g.client.Do(req)
	}

	if err != nil {
		g.writeJSON(w, http.StatusBadGateway, ClientResponse{Status: "error", Key: key, Message: "Delete failed: " + err.Error()})
		return
	}
	defer resp.Body.Close()

	g.writeJSON(w, http.StatusOK, ClientResponse{
		Status:   "deleted",
		Key:      key,
		ServedBy: primary.NodeID,
	})
}

// GET /api/health — Gateway health and peer summaries
func (g *Gateway) handleAPIHealth(w http.ResponseWriter, r *http.Request) {
	view := g.healthMonitor.GetClusterView()
	g.writeJSON(w, http.StatusOK, map[string]interface{}{
		"status":      "UP",
		"gateway":     "port_8000",
		"total_nodes": view.TotalNodes,
		"alive_nodes": view.AliveNodes,
		"cluster":     view,
	})
}

// GET /api/cluster — Unified cluster topology view
func (g *Gateway) handleAPICluster(w http.ResponseWriter, r *http.Request) {
	view := g.healthMonitor.GetClusterView()
	g.writeJSON(w, http.StatusOK, view)
}

// GET /api/stats — Aggregated cluster metrics
func (g *Gateway) handleAPIStats(w http.ResponseWriter, r *http.Request) {
	view := g.healthMonitor.GetClusterView()
	fStats := g.failover.Stats()

	g.writeJSON(w, http.StatusOK, map[string]interface{}{
		"gateway_role":   "unified_api_router",
		"port":           g.config.Port,
		"cluster_health": view,
		"failover_stats": fStats,
	})
}

// POST /api/node/state — Override node state manually (FAILED, ALIVE, SUSPECTED)
func (g *Gateway) handleAPINodeState(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		g.writeJSON(w, http.StatusMethodNotAllowed, ClientResponse{Status: "error", Message: "Method not allowed, use POST"})
		return
	}

	var req struct {
		NodeID string `json:"node_id"`
		State  string `json:"state"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		g.writeJSON(w, http.StatusBadRequest, ClientResponse{Status: "error", Message: "Invalid JSON body"})
		return
	}

	if req.NodeID == "" || req.State == "" {
		g.writeJSON(w, http.StatusBadRequest, ClientResponse{Status: "error", Message: "Missing node_id or state"})
		return
	}

	var targetState health.NodeState
	switch strings.ToUpper(req.State) {
	case "FAILED":
		targetState = health.StateFailed
	case "ALIVE":
		targetState = health.StateAlive
	case "SUSPECTED":
		targetState = health.StateSuspected
	default:
		g.writeJSON(w, http.StatusBadRequest, ClientResponse{Status: "error", Message: "State must be ALIVE, FAILED, or SUSPECTED"})
		return
	}

	ok := g.healthMonitor.SetNodeStateManual(req.NodeID, targetState)
	if !ok {
		g.writeJSON(w, http.StatusNotFound, ClientResponse{Status: "error", Message: "Node not found in cluster"})
		return
	}

	g.writeJSON(w, http.StatusOK, map[string]interface{}{
		"status":  "updated",
		"node_id": req.NodeID,
		"state":   targetState,
	})
}

// GET /api/catalog?id=prod:123 — Cache-Aside high performance read-through endpoint
func (g *Gateway) handleAPICatalog(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		g.writeJSON(w, http.StatusMethodNotAllowed, ClientResponse{Status: "error", Message: "Method not allowed, use GET"})
		return
	}

	id := r.URL.Query().Get("id")
	if id == "" {
		id = "prod:1"
	}
	if !strings.HasPrefix(id, "prod:") {
		id = "prod:" + id
	}

	start := time.Now()

	// 1. Check Distributed Cache Mesh (Fast Path)
	cacheRes, err := g.failover.RouteGet(r.Context(), id)
	if err == nil && cacheRes != nil && cacheRes.Value != "" {
		latency := time.Since(start).Milliseconds()
		if latency == 0 {
			latency = 1
		}
		var prodObj interface{}
		if err := json.Unmarshal([]byte(cacheRes.Value), &prodObj); err != nil {
			prodObj = cacheRes.Value
		}

		g.writeJSON(w, http.StatusOK, map[string]interface{}{
			"source":          "distributed_cache",
			"cache_hit":       true,
			"latency_ms":      latency,
			"served_by":       cacheRes.ServedBy,
			"is_failover":     cacheRes.IsFailover,
			"product":         prodObj,
			"efficiency_note": "⚡ Fast RAM Cache Hit (~1-2ms) — DB Query Prevented!",
		})
		return
	}

	// 2. Cache MISS / Outage -> Query Backing Database (Slow Path ~45ms)
	product, exists, dbLatency := g.backingDB.QueryByID(id)
	if !exists {
		g.writeJSON(w, http.StatusNotFound, map[string]interface{}{
			"status":  "not_found",
			"message": fmt.Sprintf("Product '%s' not found in database (valid range: prod:1 to prod:10000)", id),
		})
		return
	}

	totalLatency := time.Since(start).Milliseconds()
	prodJSON, _ := json.Marshal(product)

	// 3. Asynchronously Populate / Hydrate the Cache
	go func() {
		targets, err := g.hashRing.GetNodes(id, 2)
		if err == nil && len(targets) > 0 {
			reqBody, _ := json.Marshal(ClientSetRequest{
				Key:        id,
				Value:      string(prodJSON),
				TTLSeconds: 180, // Cache for 3 minutes
			})
			_ = g.forwardSet(targets[0].Addr, reqBody)
		}
	}()

	g.writeJSON(w, http.StatusOK, map[string]interface{}{
		"source":          "backing_database",
		"cache_hit":       false,
		"latency_ms":      totalLatency,
		"db_latency_ms":   dbLatency,
		"product":         product,
		"hydrated_cache":  true,
		"efficiency_note": fmt.Sprintf("🐢 Persistent DB Query (%dms) — Automatically hydrated into Cache Mesh!", dbLatency),
	})
}

func (g *Gateway) forwardSet(addr string, body []byte) error {
	resp, err := g.client.Post(fmt.Sprintf("%s/set", addr), "application/json", bytes.NewReader(body))
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	return nil
}

// GET /api/db/stats — Database and cache efficiency statistics
func (g *Gateway) handleAPIDBStats(w http.ResponseWriter, r *http.Request) {
	dbStats := g.backingDB.GetStats()
	fStats := g.failover.Stats()

	g.writeJSON(w, http.StatusOK, map[string]interface{}{
		"database_metrics": dbStats,
		"cache_metrics":    fStats,
	})
}

func extractString(raw, key string) string {
	idx := strings.Index(raw, key)
	if idx == -1 {
		return ""
	}
	rest := raw[idx+len(key):]
	colonIdx := strings.Index(rest, ":")
	if colonIdx == -1 {
		return ""
	}
	val := rest[colonIdx+1:]
	val = strings.TrimLeft(val, " \"'")
	endIdx := strings.IndexAny(val, "\",}\n\r")
	if endIdx != -1 {
		return strings.TrimSpace(val[:endIdx])
	}
	return strings.TrimSpace(val)
}
