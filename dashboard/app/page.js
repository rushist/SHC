"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import HashRing from "./components/HashRing";

const HOST_GROUPS = [
  {
    hostId: "EC2-A",
    ip: "10.0.1.10",
    zone: "ap-south-1a",
    nodes: [
      { id: "node-a", port: 8001, label: "Node A", replica: "Node B (EC2-B)" },
      { id: "node-d", port: 8002, label: "Node D", replica: "Node E (EC2-B)" },
      { id: "node-g", port: 8003, label: "Node G", replica: "Node H (EC2-B)" },
    ],
  },
  {
    hostId: "EC2-B",
    ip: "10.0.1.11",
    zone: "ap-south-1a",
    nodes: [
      { id: "node-b", port: 8001, label: "Node B", replica: "Node C (EC2-C)" },
      { id: "node-e", port: 8002, label: "Node E", replica: "Node F (EC2-C)" },
      { id: "node-h", port: 8003, label: "Node H", replica: "Node I (EC2-C)" },
    ],
  },
  {
    hostId: "EC2-C",
    ip: "10.0.1.13",
    zone: "ap-south-1b",
    nodes: [
      { id: "node-c", port: 8001, label: "Node C", replica: "Node D (EC2-A)" },
      { id: "node-f", port: 8002, label: "Node F", replica: "Node G (EC2-A)" },
      { id: "node-i", port: 8003, label: "Node I", replica: "Node A (EC2-A)" },
    ],
  },
];

const DB_FIELDS = [
  { key: "fare_amount", label: "fare_amount", type: "float", unit: "$", placeholder: "17.50", defaultValue: "17.50" },
  { key: "trip_distance", label: "trip_distance", type: "float", unit: "miles", placeholder: "3.40", defaultValue: "3.40" },
  { key: "passenger_count", label: "passenger_count", type: "integer", unit: "count", placeholder: "2", defaultValue: "2" },
  { key: "tip_amount", label: "tip_amount", type: "float", unit: "$", placeholder: "3.50", defaultValue: "3.50" },
  { key: "total_amount", label: "total_amount", type: "float", unit: "$", placeholder: "22.80", defaultValue: "22.80" },
  { key: "pu_location_id", label: "pu_location_id", type: "integer", unit: "zone", placeholder: "142", defaultValue: "142" },
  { key: "do_location_id", label: "do_location_id", type: "integer", unit: "zone", placeholder: "236", defaultValue: "236" },
];

export default function Dashboard() {
  const [mounted, setMounted] = useState(false);
  const [clusterData, setClusterData] = useState(null);
  const [nodeStats, setNodeStats] = useState({});
  const [isPolling, setIsPolling] = useState(true);
  const [logs, setLogs] = useState([]);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Key Simulator State
  const [simKey, setSimKey] = useState("trip:45210");
  const [selectedField, setSelectedField] = useState("fare_amount");
  const [simVal, setSimVal] = useState("17.50");
  const [simTTL, setSimTTL] = useState(60);
  const [simResult, setSimResult] = useState(null);
  const [simLoading, setSimLoading] = useState(false);
  const [activeHashLoc, setActiveHashLoc] = useState(null);

  // 7.66M NYC Yellow Taxi Database Query State
  const [tripId, setTripId] = useState("trip:45210");
  const [tripResult, setTripResult] = useState(null);
  const [tripLoading, setTripLoading] = useState(false);

  // 5,000+ Record Database Bombardment State
  const [bombardRunning, setBombardRunning] = useState(false);
  const [bombardCount, setBombardCount] = useState(5000);
  const [bombardProgress, setBombardProgress] = useState(0);
  const [bombardStats, setBombardStats] = useState({
    total: 0,
    hits: 0,
    misses: 0,
    avgLatency: 0,
    elapsedMs: 0,
    rate: 0,
  });
  const bombardAbortRef = useRef(false);

  // Database Connection Metrics
  const [dbMetrics, setDbMetrics] = useState({
    status: "connected",
    type: "Amazon RDS for PostgreSQL",
    queries: 0,
    writes: 0,
  });

  const addLog = useCallback((message, type = "info") => {
    const time = new Date().toLocaleTimeString();
    const entry = {
      id: Math.random(),
      seq: Date.now() * 100000 + Math.floor(Math.random() * 1000),
      time,
      message,
      type,
    };
    setLogs((prev) => {
      const merged = [entry, ...prev];
      merged.sort((a, b) => b.seq - a.seq);
      return merged.slice(0, 500);
    });
  }, []);

  const addLogBatch = useCallback((newEntries) => {
    const time = new Date().toLocaleTimeString();
    const formatted = newEntries.map((e) => ({
      id: Math.random(),
      seq: e.seq !== undefined ? e.seq : (Date.now() * 100000 + Math.floor(Math.random() * 1000)),
      time,
      message: e.message,
      type: e.type || "info",
    }));
    setLogs((prev) => {
      const merged = [...formatted, ...prev];
      merged.sort((a, b) => b.seq - a.seq);
      return merged.slice(0, 500);
    });
  }, []);

  const refreshCluster = useCallback(async () => {
    try {
      const res = await fetch("/api/mesh");
      if (res.ok) {
        const data = await res.json();
        setClusterData(data.cluster);
        setNodeStats(data.nodeStats || {});
        if (data.dbStats) {
          setDbMetrics({
            status: data.dbStats.status || "connected",
            type: data.dbStats.database_type || "Amazon RDS for PostgreSQL",
            queries: data.dbStats.db_queries_executed || 0,
            writes: data.dbStats.db_writes_executed || 0,
            openConnections: data.dbStats.open_connections || 0,
            idleConnections: data.dbStats.idle_connections || 0,
          });
        }
      }
    } catch (err) {
      console.error("Cluster mesh poll failed:", err);
    }
  }, []);

  useEffect(() => {
    refreshCluster();
    if (!isPolling) return;
    const interval = setInterval(refreshCluster, 1000);
    return () => clearInterval(interval);
  }, [isPolling, refreshCluster]);

  useEffect(() => {
    if (simKey) {
      locateKey(simKey);
    }
  }, [simKey]);

  const locateKey = async (key) => {
    try {
      const res = await fetch("/api/crud", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "LOCATE", key }),
      });
      if (res.ok) {
        const data = await res.json();
        setActiveHashLoc(data);
        return data;
      }
    } catch {}
    return null;
  };

  const handleTripQuery = async (customId = null) => {
    const targetId = customId || tripId || "trip:45210";
    setTripLoading(true);
    try {
      const res = await fetch("/api/crud", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "TRIP", id: targetId }),
      });
      const data = await res.json();
      const internalLatency = data.latency_ms !== undefined ? data.latency_ms : (data.cache_hit ? 1 : 12);

      setTripResult({ ...data, roundtrip_ms: internalLatency });
      locateKey(targetId);

      let hitDetails = "";
      if (data.cache_hit) {
        const failoverTag = data.is_failover ? " [REPLICA FAILOVER]" : "";
        hitDetails = `CACHE HIT (RAM: ${data.served_by || "cluster"}${failoverTag})`;
      } else {
        hitDetails = `DATABASE READ (Hydrated to Cache)`;
      }
      addLog(`[Query] ${targetId} -> ${hitDetails} (${internalLatency}ms)`, data.cache_hit ? "success" : "info");
    } catch (err) {
      addLog(`[Query Error] ${targetId}: ${err.message}`, "error");
    } finally {
      setTripLoading(false);
    }
  };

  const handleBombard = async () => {
    if (bombardRunning) {
      bombardAbortRef.current = true;
      setBombardRunning(false);
      addLog("[Bombardment] Stopped by user", "warn");
      return;
    }

    const count = bombardCount || 5000;
    bombardAbortRef.current = false;
    setBombardRunning(true);
    setBombardProgress(0);
    const startTime = performance.now();
    setBombardStats({
      total: 0,
      hits: 0,
      misses: 0,
      avgLatency: 0,
      elapsedMs: 0,
      rate: 0,
    });

    addLog(`[Bombardment Started] Launching ${count.toLocaleString()} queries against Persistent Database & 9-Node Cache Mesh...`, "warn");

    // Generate a diverse working set of hot keys for this bombardment session
    const hotPool = [
      45210, 108420, 521940, 1492019, 2948102, 3847291, 5192048, 6492018, 7194028,
      ...Array.from({ length: 40 }, () => Math.floor(Math.random() * 7660000) + 1)
    ];

    const getQueryId = () => {
      // 40% probability to hit hot-pool keys (demonstrating RAM cache hit acceleration)
      // 60% probability to hit completely random IDs across the entire 7.66M dataset
      if (Math.random() < 0.40) {
        const hk = hotPool[Math.floor(Math.random() * hotPool.length)];
        return `trip:${hk}`;
      }
      const randomRow = Math.floor(Math.random() * 7660000) + 1;
      return `trip:${randomRow}`;
    };

    // Divide into high-throughput parallel batches of 50 keys
    const batchSize = 50;
    const totalBatches = Math.ceil(count / batchSize);
    let completed = 0;
    let hitsCount = 0;
    let missesCount = 0;
    let totalLatency = 0;
    let currentBatchIdx = 0;

    // Worker pool for executing batches in parallel
    const parallelWorkers = 8;

    const runBatchWorker = async () => {
      while (!bombardAbortRef.current) {
        const bIdx = currentBatchIdx++;
        if (bIdx >= totalBatches) break;

        const startIdx = bIdx * batchSize;
        const currentBatchKeys = [];
        for (let i = 0; i < batchSize && startIdx + i < count; i++) {
          currentBatchKeys.push(getQueryId());
        }

        try {
          const res = await fetch("/api/crud", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ op: "BATCH_BOMBARD", keys: currentBatchKeys }),
          });
          if (!res.ok) {
            continue;
          }
          const data = await res.json();
          const results = data.results || [];

          const batchLogs = [];
          for (let i = 0; i < results.length; i++) {
            const item = results[i];
            const itemLatency = Number(item.latency_ms) || (item.cache_hit ? 1.2 : 12.0);
            totalLatency += itemLatency;

            if (item.cache_hit) {
              hitsCount++;
            } else {
              missesCount++;
            }

            const hitTag = item.cache_hit
              ? `CACHE HIT (${item.served_by || "RAM"}) [${itemLatency.toFixed(1)}ms]`
              : `DATABASE READ (Hydrated to Cache) [${itemLatency.toFixed(1)}ms]`;

            batchLogs.push({
              seq: startTime * 10000 + (startIdx + i + 1),
              message: `[Bombard #${startIdx + i + 1}] ${item.id} -> ${hitTag}`,
              type: item.cache_hit ? "success" : "info",
            });
          }

          completed += results.length;

          // Stream logs into audit feed in strict chronological order
          if (batchLogs.length > 0) {
            addLogBatch(batchLogs);
          }

          const now = performance.now();
          const elapsedSec = (now - startTime) / 1000 || 0.001;
          const currentTotal = hitsCount + missesCount;
          setBombardProgress(currentTotal);
          setBombardStats({
            total: currentTotal,
            hits: hitsCount,
            misses: missesCount,
            avgLatency: currentTotal > 0 ? (totalLatency / currentTotal).toFixed(1) : 0,
            elapsedMs: Math.round(now - startTime),
            rate: Math.round(currentTotal / elapsedSec),
          });
        } catch (err) {
          addLog(`[Batch Error] ${err.message}`, "error");
        }
      }
    };

    const workers = [];
    for (let w = 0; w < parallelWorkers; w++) {
      workers.push(runBatchWorker());
    }
    await Promise.all(workers);

    const elapsed = Math.round(performance.now() - startTime);
    const elapsedSec = elapsed / 1000 || 0.001;
    const finalTotal = hitsCount + missesCount;
    setBombardRunning(false);
    setBombardProgress(finalTotal);
    setBombardStats({
      total: finalTotal,
      hits: hitsCount,
      misses: missesCount,
      avgLatency: finalTotal > 0 ? (totalLatency / finalTotal).toFixed(1) : 0,
      elapsedMs: elapsed,
      rate: Math.round(finalTotal / elapsedSec),
    });

    refreshCluster();

    const hitPct = finalTotal > 0 ? ((hitsCount / finalTotal) * 100).toFixed(1) : 0;
    addLog(`[Bombardment Complete] ${finalTotal.toLocaleString()} requests in ${elapsedSec.toFixed(2)}s (${hitPct}% Cache Hits, ~${Math.round(finalTotal / elapsedSec)} req/sec, Avg Engine Ping: ${(totalLatency / (finalTotal || 1)).toFixed(1)}ms)`, "success");
  };

  const handleCRUD = async (op) => {
    setSimLoading(true);
    const start = performance.now();
    try {
      let payloadValue = simVal;
      if (op === "SET" && selectedField) {
        payloadValue = JSON.stringify({
          trip_id: simKey,
          field_modified: selectedField,
          [selectedField]: isNaN(Number(simVal)) ? simVal : Number(simVal),
          updated_at: new Date().toISOString(),
        });
      }

      const res = await fetch("/api/crud", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          op,
          key: simKey,
          value: payloadValue,
          ttl_seconds: simTTL,
        }),
      });

      const data = await res.json();
      const elapsed = Math.round(performance.now() - start);

      setSimResult({ ...data, roundtrip_ms: elapsed, op });
      locateKey(simKey);

      if (data.status === "error") {
        addLog(`[${op} Error] '${simKey}': ${data.message}`, "error");
      } else {
        const nodeInfo = data.served_by ? ` [Node: ${data.served_by}${data.is_failover ? " (Replica)" : ""}]` : "";
        addLog(`[${op}] '${simKey}' (${elapsed}ms)${nodeInfo} -> ${data.status || "OK"}`, "success");
      }
    } catch (err) {
      addLog(`[${op} Failed] ${err.message}`, "error");
    } finally {
      setSimLoading(false);
      refreshCluster();
    }
  };

  const handleNodeStateChange = async (nodeId, newState) => {
    try {
      const res = await fetch("/api/chaos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "override_state", nodeId, state: newState }),
      });
      if (res.ok) {
        addLog(`[State Override] ${nodeId} -> ${newState}`, newState === "ALIVE" ? "success" : "warn");
        refreshCluster();
      }
    } catch (err) {
      addLog(`[State Error] ${nodeId}: ${err.message}`, "error");
    }
  };

  const handleHostToggle = async (host, targetState) => {
    addLog(`[Host Action] Setting ${host.hostId} (${host.nodes.map((n) => n.id).join(", ")}) -> ${targetState}...`, targetState === "ALIVE" ? "success" : "warn");
    await Promise.all(host.nodes.map((node) => handleNodeStateChange(node.id, targetState)));
    refreshCluster();
  };

  const allActiveCount = Object.values(nodeStats).filter((s) => s.state !== "FAILED").length;
  const totalClusterHits = Object.values(nodeStats).reduce((acc, s) => acc + (Number(s.hit_count) || 0), 0);
  const totalPrimaryKeys = Object.values(nodeStats).reduce((acc, s) => acc + (Number(s.primary_keys) || 0), 0);
  const totalReplicaKeys = Object.values(nodeStats).reduce((acc, s) => acc + (Number(s.replica_keys) || 0), 0);
  const totalDbHits = Number(dbMetrics.queries) || 0;
  const totalDbWrites = Number(dbMetrics.writes) || 0;
  const totalCombinedOps = totalClusterHits + totalDbHits;
  const cacheEfficiency = totalCombinedOps > 0 ? ((totalClusterHits / totalCombinedOps) * 100).toFixed(1) : "100.0";

  if (!mounted) {
    return (
      <div suppressHydrationWarning style={{ minHeight: "100vh", backgroundColor: "var(--bg-canvas)", color: "var(--text-primary)", padding: "24px" }}>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.85rem", color: "var(--text-muted)" }}>
          Initializing SHC Console...
        </div>
      </div>
    );
  }

  return (
    <div suppressHydrationWarning style={{ minHeight: "100vh", backgroundColor: "var(--bg-canvas)", color: "var(--text-primary)" }}>
      {/* AWS Console Navigation Header */}
      <header className="system-header">
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
            <div style={{ color: "#ff9900", fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>AWS / EC2 / Mumbai</div>
            <div style={{ fontSize: "0.95rem", fontWeight: 700, letterSpacing: "-0.01em" }}>
              SHC / Self-Healing Distributed Cache
            </div>
            <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
              Multi-Machine Topology (AWS ap-south-1 Mumbai)
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          <div className={`status-pill ${allActiveCount >= 9 ? "status-pill-alive" : "status-pill-suspect"}`}>
            Cluster: {allActiveCount}/9 Nodes Active
          </div>
          <div className="status-pill status-pill-alive" title="Sum of cache hits across all 9 distributed nodes">
            Total Cache Hits: {totalClusterHits.toLocaleString()}
          </div>
          <div className="status-pill status-pill-suspect" title="Total persistent database queries">
            Total DB Hits: {totalDbHits.toLocaleString()}
          </div>
          <button
            onClick={() => setIsPolling(!isPolling)}
            className="sys-btn sys-btn-sm"
          >
            {isPolling ? "Pause Polling" : "Resume Polling"}
          </button>
          <Link href="/docs" className="sys-btn sys-btn-sm sys-btn-primary">
            Documentation & SDKs
          </Link>
        </div>
      </header>

      {/* Main Content Layout */}
      <main style={{ padding: "16px 24px", display: "grid", gap: "16px" }}>
        {/* Section 1: Physical Failure Domains (3 EC2 Instances) */}
        <section>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
            <div>
              <div style={{ fontSize: "0.68rem", color: "var(--accent-brand)", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: "2px" }}>Cluster resources</div>
              <h2 style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.03em" }}>
                Physical Failure Domains (3 EC2 Hosts)
              </h2>
            </div>
            <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
              Replication: Clockwise (R=2) | Universal Cache Hits: <strong style={{ color: "var(--status-alive-text)" }}>{totalClusterHits.toLocaleString()}</strong> | DB Reads: <strong style={{ color: "var(--accent-brand)" }}>{totalDbHits.toLocaleString()}</strong>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "12px" }}>
            {HOST_GROUPS.map((host) => {
              const hostNodes = host.nodes.map((n) => ({
                ...n,
                stats: nodeStats[n.id] || { state: "ALIVE", primary_keys: 0, replica_keys: 0, hit_count: 0 },
              }));
              const allHostAlive = hostNodes.every((n) => n.stats.state !== "FAILED");

              return (
                <div key={host.hostId} className="sys-panel">
                  <div className="sys-panel-header">
                    <div>
                      <span style={{ fontWeight: 700, fontFamily: "var(--font-mono)", fontSize: "0.88rem" }}>
                        {host.hostId}
                      </span>
                      <span style={{ marginLeft: "8px", fontSize: "0.72rem", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                        {host.ip} ({host.zone})
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: "6px" }}>
                      {allHostAlive ? (
                        <button
                          onClick={() => handleHostToggle(host, "FAILED")}
                          className="sys-btn sys-btn-danger sys-btn-sm"
                        >
                          Simulate Outage
                        </button>
                      ) : (
                        <button
                          onClick={() => handleHostToggle(host, "ALIVE")}
                          className="sys-btn sys-btn-success sys-btn-sm"
                        >
                          Restore Host
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Hosted Nodes List */}
                  <div style={{ display: "grid", gap: "6px" }}>
                    {hostNodes.map((n) => {
                      const isAlive = n.stats.state !== "FAILED";
                      return (
                        <div
                          key={n.id}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            padding: "6px 8px",
                            borderRadius: "var(--radius-sm)",
                            background: isAlive ? "var(--bg-surface-subtle)" : "var(--status-failed-bg)",
                            border: `1px solid ${isAlive ? "var(--border-default)" : "var(--status-failed-border)"}`,
                          }}
                        >
                          <div>
                            <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                              <span style={{ fontWeight: 600, fontFamily: "var(--font-mono)", fontSize: "0.80rem" }}>
                                {n.label}
                              </span>
                              <span className={`status-pill ${isAlive ? "status-pill-alive" : "status-pill-failed"}`}>
                                {isAlive ? "ALIVE" : "FAILED"}
                              </span>

                              {/* Real-time Node Heartbeat Monitor */}
                              <div
                                className={`heartbeat-badge ${isAlive ? "heartbeat-badge-alive" : "heartbeat-badge-failed"}`}
                                title={`Heartbeat Signal: ${isAlive ? (n.stats.latency_ms > 0 ? `${n.stats.latency_ms}ms response` : '<1ms response') : 'Unreachable / Connection Timeout'}`}
                              >
                                <svg
                                  width="12"
                                  height="12"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke={isAlive ? "#1d8102" : "#d13212"}
                                  strokeWidth="2.5"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  className={isAlive ? "heartbeat-icon-active" : ""}
                                  style={{ flexShrink: 0 }}
                                >
                                  <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
                                </svg>
                                <span style={{ fontWeight: 600 }}>
                                  {isAlive ? (n.stats.latency_ms > 0 ? `${n.stats.latency_ms}ms` : "<1ms") : "timeout"}
                                </span>
                              </div>
                            </div>
                            <div style={{ fontSize: "0.70rem", color: "var(--text-muted)", fontFamily: "var(--font-mono)", marginTop: "2px" }}>
                              Replica Target: {n.replica}
                            </div>
                          </div>

                          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <div style={{ textAlign: "right", fontSize: "0.70rem", fontFamily: "var(--font-mono)" }}>
                              <div>P: {n.stats.primary_keys} | R: {n.stats.replica_keys}</div>
                              <div style={{ color: "var(--status-alive-text)", fontWeight: 700 }}>Hits: {n.stats.hit_count.toLocaleString()}</div>
                            </div>
                            <button
                              onClick={() => handleNodeStateChange(n.id, isAlive ? "FAILED" : "ALIVE")}
                              className={`sys-btn sys-btn-sm ${isAlive ? "sys-btn-danger" : "sys-btn-success"}`}
                            >
                              {isAlive ? "Fail" : "Revive"}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Section 2: Storage Acceleration & Key Routing Inspector */}
        <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: "12px" }}>
          {/* Card 1: 7.66M NYC Taxi Persistent Query Inspector */}
          <div className="sys-panel">
            <div className="sys-panel-header">
              <span className="sys-panel-title">Cache-Aside Storage Acceleration</span>
              <span style={{ fontSize: "0.72rem", fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
                Amazon RDS PostgreSQL (7.66M Records)
              </span>
            </div>

            <div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
              <input
                type="text"
                value={tripId}
                onChange={(e) => setTripId(e.target.value)}
                placeholder="trip:45210"
                className="sys-input"
              />
              <button
                onClick={() => handleTripQuery()}
                disabled={tripLoading || bombardRunning}
                className="sys-btn sys-btn-primary"
              >
                {tripLoading ? "Querying..." : "Query Record"}
              </button>
            </div>

            {/* Bombard Database 5000+ Controls */}
            <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "12px" }}>
              <button
                onClick={handleBombard}
                disabled={tripLoading}
                className={`sys-btn ${bombardRunning ? "sys-btn-danger" : "sys-btn-success"}`}
                style={{ flex: 1, fontWeight: 700 }}
              >
                {bombardRunning ? (
                  <>
                    <span className="heartbeat-icon-active">■</span> Stop Bombardment ({bombardProgress.toLocaleString()} / {bombardCount.toLocaleString()})
                  </>
                ) : (
                  <>
                    Bombard Database ({bombardCount.toLocaleString()}+ Queries)
                  </>
                )}
              </button>
              <select
                value={bombardCount}
                onChange={(e) => setBombardCount(Number(e.target.value))}
                disabled={bombardRunning}
                className="sys-input"
                style={{ width: "120px", height: "31px" }}
              >
                <option value={1000}>1,000 queries</option>
                <option value={5000}>5,000 queries</option>
                <option value={10000}>10,000 queries</option>
              </select>
            </div>

            {/* Live Bombardment Telemetry Progress Card */}
            {(bombardRunning || bombardStats.total > 0) && (
              <div className="bombard-progress-container" style={{ marginBottom: "12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.72rem", fontFamily: "var(--font-mono)" }}>
                  <span style={{ fontWeight: 600, color: bombardRunning ? "var(--accent-brand)" : "var(--status-alive-text)" }}>
                    {bombardRunning ? "Bombarding Database & Mesh..." : "Bombardment Complete"}
                  </span>
                  <span>
                    {bombardProgress.toLocaleString()} / {bombardCount.toLocaleString()} ({((bombardProgress / (bombardCount || 1)) * 100).toFixed(1)}%)
                  </span>
                </div>

                <div className="bombard-bar-bg">
                  <div
                    className="bombard-bar-fill"
                    style={{ width: `${Math.min(100, (bombardProgress / (bombardCount || 1)) * 100)}%` }}
                  />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "6px", textAlign: "center", fontSize: "0.68rem", fontFamily: "var(--font-mono)", marginTop: "6px" }}>
                  <div style={{ padding: "4px", background: "var(--bg-surface)", borderRadius: "var(--radius-xs)", border: "1px solid var(--border-default)" }}>
                    <div style={{ color: "var(--text-muted)", fontSize: "0.62rem" }}>HITS</div>
                    <div style={{ fontWeight: 700, color: "var(--status-alive-text)" }}>{bombardStats.hits.toLocaleString()}</div>
                  </div>
                  <div style={{ padding: "4px", background: "var(--bg-surface)", borderRadius: "var(--radius-xs)", border: "1px solid var(--border-default)" }}>
                    <div style={{ color: "var(--text-muted)", fontSize: "0.62rem" }}>DB READS</div>
                    <div style={{ fontWeight: 700, color: "var(--accent-brand)" }}>{bombardStats.misses.toLocaleString()}</div>
                  </div>
                  <div style={{ padding: "4px", background: "var(--bg-surface)", borderRadius: "var(--radius-xs)", border: "1px solid var(--border-default)" }}>
                    <div style={{ color: "var(--text-muted)", fontSize: "0.62rem" }}>AVG PING</div>
                    <div style={{ fontWeight: 700 }}>{bombardStats.avgLatency}ms</div>
                  </div>
                  <div style={{ padding: "4px", background: "var(--bg-surface)", borderRadius: "var(--radius-xs)", border: "1px solid var(--border-default)" }}>
                    <div style={{ color: "var(--text-muted)", fontSize: "0.62rem" }}>RATE</div>
                    <div style={{ fontWeight: 700 }}>{bombardStats.rate}/s</div>
                  </div>
                </div>
              </div>
            )}

            {/* Query Result Details */}
            {tripResult?.trip ? (
              <div style={{ padding: "8px", background: "var(--bg-surface-subtle)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-default)" }}>
                <div className="data-grid">
                  <div className="data-row">
                    <span className="data-label">Trip ID</span>
                    <span className="data-value">{tripResult.trip.trip_id}</span>
                  </div>
                  <div className="data-row">
                    <span className="data-label">Source</span>
                    <span className="data-value">
                      <span className={`status-pill ${tripResult.cache_hit ? "status-pill-alive" : "status-pill-suspect"}`}>
                        {tripResult.cache_hit ? "RAM Cache Hit" : "PostgreSQL Database Read"}
                      </span>
                    </span>
                  </div>
                  <div className="data-row">
                    <span className="data-label">Distance / Fare</span>
                    <span className="data-value">{tripResult.trip.trip_distance} mi | ${tripResult.trip.fare_amount}</span>
                  </div>
                  <div className="data-row">
                    <span className="data-label">Total Amount</span>
                    <span className="data-value">${tripResult.trip.total_amount}</span>
                  </div>
                  <div className="data-row">
                    <span className="data-label">Pickup / Dropoff</span>
                    <span className="data-value">{tripResult.trip.pickup_datetime} (Zone #{tripResult.trip.pu_location_id} to #{tripResult.trip.do_location_id})</span>
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ padding: "12px", textAlign: "center", color: "var(--text-muted)", fontSize: "0.75rem" }}>
                Enter a Trip ID (e.g. <code>trip:45210</code>) and click Query Record to observe cache-aside acceleration.
              </div>
            )}
          </div>

          {/* Column 2: Key Simulator & Dedicated Database Node Cards */}
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {/* Card 2A: Write-Through Key Simulator */}
            <div className="sys-panel" style={{ flex: 1 }}>
              <div className="sys-panel-header">
                <span className="sys-panel-title">Write-Through Key Simulator</span>
                <span style={{ fontSize: "0.72rem", fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
                  Port :8000
                </span>
              </div>

              <div style={{ display: "grid", gap: "8px", marginBottom: "10px" }}>
                <div>
                  <label style={{ fontSize: "0.70rem", color: "var(--text-muted)", display: "block", marginBottom: "2px" }}>Target Key</label>
                  <input
                    type="text"
                    value={simKey}
                    onChange={(e) => setSimKey(e.target.value)}
                    className="sys-input"
                  />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                  <div>
                    <label style={{ fontSize: "0.70rem", color: "var(--text-muted)", display: "block", marginBottom: "2px" }}>Database Column</label>
                    <select
                      value={selectedField}
                      onChange={(e) => {
                        setSelectedField(e.target.value);
                        const f = DB_FIELDS.find((x) => x.key === e.target.value);
                        if (f) setSimVal(f.defaultValue);
                      }}
                      className="sys-input"
                      style={{ height: "31px" }}
                    >
                      {DB_FIELDS.map((f) => (
                        <option key={f.key} value={f.key}>{f.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: "0.70rem", color: "var(--text-muted)", display: "block", marginBottom: "2px" }}>Field Value</label>
                    <input
                      type="text"
                      value={simVal}
                      onChange={(e) => setSimVal(e.target.value)}
                      className="sys-input"
                    />
                  </div>
                </div>

                <div style={{ display: "flex", gap: "6px" }}>
                  <button
                    onClick={() => handleCRUD("SET")}
                    disabled={simLoading || bombardRunning}
                    className="sys-btn sys-btn-primary"
                    style={{ flex: 1 }}
                  >
                    Write (SET)
                  </button>
                  <button
                    onClick={() => handleCRUD("GET")}
                    disabled={simLoading || bombardRunning}
                    className="sys-btn"
                    style={{ flex: 1 }}
                  >
                    Read (GET)
                  </button>
                  <button
                    onClick={() => handleCRUD("DELETE")}
                    disabled={simLoading || bombardRunning}
                    className="sys-btn sys-btn-danger"
                    style={{ flex: 1 }}
                  >
                    Evict (DEL)
                  </button>
                </div>
              </div>

              {/* CRUD Operation & Response Box (ALWAYS visible by default) */}
              <div style={{ padding: "8px 10px", background: "var(--bg-surface-subtle)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-default)", minHeight: "64px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px", fontSize: "0.72rem", fontFamily: "var(--font-mono)" }}>
                  <span>
                    Response: <strong>{simResult ? simResult.op : "IDLE / READY"}</strong>
                  </span>
                  <span className={`status-pill ${simResult ? (simResult.status === "error" ? "status-pill-failed" : "status-pill-alive") : "status-pill-alive"}`}>
                    {simResult ? (simResult.status || "OK") : "READY TO EXECUTE"}
                  </span>
                </div>
                <div style={{ fontSize: "0.70rem", color: "var(--text-muted)", fontFamily: "var(--font-mono)", wordBreak: "break-all" }}>
                  {simResult ? (
                    <>
                      Served by: <strong>{simResult.served_by || "Cluster Router"}</strong>{simResult.is_failover ? " (Replica Failover)" : ""} | Roundtrip: <strong>{simResult.roundtrip_ms}ms</strong>
                      {simResult.value && (
                        <div style={{ marginTop: "3px", color: "var(--text-primary)", fontSize: "0.68rem" }}>
                          Payload: {simResult.value.length > 80 ? simResult.value.slice(0, 80) + "..." : simResult.value}
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      Target: <strong>{activeHashLoc?.primary_node || "node-a"}</strong> (Primary) &rarr; <strong>{activeHashLoc?.replica_node || "node-b"}</strong> (Replica) | Latency: <strong>--</strong>
                      <div style={{ marginTop: "3px", color: "var(--text-muted)", fontSize: "0.68rem" }}>
                        Click Write (SET) to persist or Read (GET) to query cache/DB.
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Card 2B: Dedicated Standalone Database Node Panel */}
            <div className="sys-panel">
              <div className="sys-panel-header">
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span className="sys-panel-title">Database Node</span>
                  <span className="status-pill status-pill-alive">
                    CONNECTED (RDS)
                  </span>
                  <div
                    className="heartbeat-badge heartbeat-badge-alive"
                    title="Database Query Latency"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#1d8102" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="heartbeat-icon-active">
                      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
                    </svg>
                    <span style={{ fontWeight: 600 }}>~9ms</span>
                  </div>
                </div>
                <span style={{ fontSize: "0.68rem", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                  Storage Tier
                </span>
              </div>

              {/* DB Node Live Telemetry Grid */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "6px", textAlign: "center", fontSize: "0.68rem", fontFamily: "var(--font-mono)" }}>
                <div style={{ padding: "6px 4px", background: "var(--bg-surface-subtle)", borderRadius: "var(--radius-xs)", border: "1px solid var(--border-default)" }}>
                  <div style={{ color: "var(--text-muted)", fontSize: "0.62rem" }}>TOTAL DB HITS</div>
                  <div style={{ fontWeight: 700, fontSize: "0.92rem", color: "var(--accent-brand)" }}>
                    {(dbMetrics.queries || 0).toLocaleString()}
                  </div>
                  <div style={{ fontSize: "0.60rem", color: "var(--text-muted)" }}>Disk Reads</div>
                </div>
                <div style={{ padding: "6px 4px", background: "var(--bg-surface-subtle)", borderRadius: "var(--radius-xs)", border: "1px solid var(--border-default)" }}>
                  <div style={{ color: "var(--text-muted)", fontSize: "0.62rem" }}>DB WRITES</div>
                  <div style={{ fontWeight: 700, fontSize: "0.92rem", color: "var(--text-primary)" }}>
                    {(dbMetrics.writes || 0).toLocaleString()}
                  </div>
                  <div style={{ fontSize: "0.60rem", color: "var(--text-muted)" }}>Write-Through</div>
                </div>
                <div style={{ padding: "6px 4px", background: "var(--bg-surface-subtle)", borderRadius: "var(--radius-xs)", border: "1px solid var(--border-default)" }}>
                  <div style={{ color: "var(--text-muted)", fontSize: "0.62rem" }}>CACHE OFFLOAD</div>
                  <div style={{ fontWeight: 700, fontSize: "0.92rem", color: "var(--status-alive-text)" }}>
                    {cacheEfficiency}%
                  </div>
                  <div style={{ fontSize: "0.60rem", color: "var(--text-muted)" }}>RAM Hit Ratio</div>
                </div>
              </div>
            </div>
          </div>

          {/* Card 3: Consistent Hash Ring Topology */}
          <div className="sys-panel" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
            <div className="sys-panel-header">
              <span className="sys-panel-title">Consistent Hash Ring</span>
              <span style={{ fontSize: "0.72rem", fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
                450 Virtual Tokens (FNV-1a)
              </span>
            </div>

            <HashRing
              nodes={nodeStats}
              activeKey={simKey}
              keyLocation={activeHashLoc}
            />

            <div style={{ fontSize: "0.70rem", color: "var(--text-muted)", textAlign: "center", marginTop: "8px" }}>
              Partitions evenly distribute across 9 nodes. Node failure triggers sub-millisecond route shifting.
            </div>
          </div>
        </section>

        {/* Section 3: Live System Audit Log */}
        <section className="sys-panel">
          <div className="sys-panel-header">
            <span className="sys-panel-title">System Audit Log</span>
            <button
              onClick={() => setLogs([])}
              className="sys-btn sys-btn-sm"
            >
              Clear Log
            </button>
          </div>

          <div className="sys-log-feed">
            {logs.length === 0 ? (
              <div style={{ color: "#64748b" }}>Audit feed initialized. System operations will appear here...</div>
            ) : (
              logs.map((log) => (
                <div key={log.id} className="sys-log-entry">
                  <span className="sys-log-time">[{log.time}]</span>
                  <span style={{ color: log.type === "error" ? "#f87171" : log.type === "warn" ? "#fbbf24" : log.type === "success" ? "#4ade80" : "#cbd5e1" }}>
                    {log.message}
                  </span>
                </div>
              ))
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
