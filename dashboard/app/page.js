"use client";

import React, { useState, useEffect, useCallback } from "react";
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

  // Database Connection Metrics
  const [dbMetrics, setDbMetrics] = useState({
    status: "connected",
    type: "Amazon RDS for PostgreSQL",
    queries: 0,
    writes: 0,
  });

  const addLog = useCallback((message, type = "info") => {
    const time = new Date().toLocaleTimeString();
    setLogs((prev) => [{ id: Date.now() + Math.random(), time, message, type }, ...prev.slice(0, 49)]);
  }, []);

  const refreshCluster = useCallback(async () => {
    try {
      const res = await fetch("/api/mesh");
      if (res.ok) {
        const data = await res.json();
        setClusterData(data.cluster);
        setNodeStats(data.nodeStats || {});
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
    const start = performance.now();
    try {
      const res = await fetch("/api/crud", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "TRIP", id: targetId }),
      });
      const data = await res.json();
      const elapsed = Math.round(performance.now() - start);

      setTripResult({ ...data, roundtrip_ms: elapsed });
      locateKey(targetId);

      let hitDetails = "";
      if (data.cache_hit) {
        const failoverTag = data.is_failover ? " [REPLICA FAILOVER]" : "";
        hitDetails = `CACHE HIT (RAM: ${data.served_by || "cluster"}${failoverTag})`;
      } else {
        hitDetails = `DATABASE READ (Hydrated to Cache)`;
      }
      addLog(`[Query] ${targetId} -> ${hitDetails} (${elapsed}ms)`, data.cache_hit ? "success" : "info");
    } catch (err) {
      addLog(`[Query Error] ${targetId}: ${err.message}`, "error");
    } finally {
      setTripLoading(false);
    }
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
            Cluster Health: {allActiveCount}/9 Nodes Active
          </div>
          <div className="status-pill status-pill-alive">
            PostgreSQL: Connected (RDS)
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
              Replication: Clockwise Ring (R=2) Across Physical AZs
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
                            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                              <span style={{ fontWeight: 600, fontFamily: "var(--font-mono)", fontSize: "0.80rem" }}>
                                {n.label}
                              </span>
                              <span className={`status-pill ${isAlive ? "status-pill-alive" : "status-pill-failed"}`}>
                                {isAlive ? "ALIVE" : "FAILED"}
                              </span>
                            </div>
                            <div style={{ fontSize: "0.70rem", color: "var(--text-muted)", fontFamily: "var(--font-mono)", marginTop: "2px" }}>
                              Replica Target: {n.replica}
                            </div>
                          </div>

                          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <div style={{ textAlign: "right", fontSize: "0.70rem", fontFamily: "var(--font-mono)" }}>
                              <div>P: {n.stats.primary_keys} | R: {n.stats.replica_keys}</div>
                              <div style={{ color: "var(--text-muted)" }}>Hits: {n.stats.hit_count}</div>
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

            <div style={{ display: "flex", gap: "8px", marginBottom: "10px" }}>
              <input
                type="text"
                value={tripId}
                onChange={(e) => setTripId(e.target.value)}
                placeholder="trip:45210"
                className="sys-input"
              />
              <button
                onClick={() => handleTripQuery()}
                disabled={tripLoading}
                className="sys-btn sys-btn-primary"
              >
                {tripLoading ? "Querying..." : "Query Record"}
              </button>
            </div>

            {/* Benchmark Latency Comparison */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "12px" }}>
              <div style={{ padding: "8px", background: "var(--bg-surface-subtle)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-default)" }}>
                <div style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>POSTGRESQL DISK READ</div>
                <div style={{ fontSize: "1.05rem", fontWeight: 700, fontFamily: "var(--font-mono)" }}>~45 ms</div>
                <div style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>Primary disk fetch</div>
              </div>
              <div style={{ padding: "8px", background: "var(--status-alive-bg)", borderRadius: "var(--radius-sm)", border: "1px solid var(--status-alive-border)" }}>
                <div style={{ fontSize: "0.68rem", color: "var(--status-alive-text)" }}>RAM CACHE HIT</div>
                <div style={{ fontSize: "1.05rem", fontWeight: 700, fontFamily: "var(--font-mono)", color: "var(--status-alive-text)" }}>~1.2 ms</div>
                <div style={{ fontSize: "0.68rem", color: "var(--status-alive-text)" }}>37x acceleration</div>
              </div>
            </div>

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

          {/* Card 2: Key CRUD & Mutation Simulator */}
          <div className="sys-panel">
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
                  disabled={simLoading}
                  className="sys-btn sys-btn-primary"
                  style={{ flex: 1 }}
                >
                  Write (SET)
                </button>
                <button
                  onClick={() => handleCRUD("GET")}
                  disabled={simLoading}
                  className="sys-btn"
                  style={{ flex: 1 }}
                >
                  Read (GET)
                </button>
                <button
                  onClick={() => handleCRUD("DELETE")}
                  disabled={simLoading}
                  className="sys-btn sys-btn-danger"
                  style={{ flex: 1 }}
                >
                  Evict (DEL)
                </button>
              </div>
            </div>

            {/* CRUD Response Box */}
            {simResult && (
              <div style={{ padding: "8px", background: "var(--bg-surface-subtle)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-default)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px", fontSize: "0.72rem", fontFamily: "var(--font-mono)" }}>
                  <span>Response: <strong>{simResult.op}</strong></span>
                  <span className={`status-pill ${simResult.status === "error" ? "status-pill-failed" : "status-pill-alive"}`}>
                    {simResult.status || "OK"}
                  </span>
                </div>
                <div style={{ fontSize: "0.70rem", color: "var(--text-muted)", fontFamily: "var(--font-mono)", wordBreak: "break-all" }}>
                  Served by: {simResult.served_by || "Cluster Router"} | Roundtrip: {simResult.roundtrip_ms}ms
                </div>
              </div>
            )}
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
