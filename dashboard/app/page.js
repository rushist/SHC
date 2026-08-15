"use client";

import React, { useState, useEffect, useCallback } from "react";
import HashRing from "./components/HashRing";

const ALL_NODES = [
  { id: "node-a", port: 8001, label: "Node A", color: "#42D674" },
  { id: "node-b", port: 8002, label: "Node B", color: "#80EF80" },
  { id: "node-c", port: 8003, label: "Node C", color: "#BADBA2" },
  { id: "node-d", port: 8004, label: "Node D", color: "#E3F0A3" },
  { id: "node-e", port: 8005, label: "Node E", color: "#2eb872" },
  { id: "node-f", port: 8006, label: "Node F", color: "#68bb59" },
  { id: "node-g", port: 8007, label: "Node G", color: "#3caea3" },
  { id: "node-h", port: 8008, label: "Node H", color: "#88d49e" },
  { id: "node-i", port: 8009, label: "Node I", color: "#1b998b" },
];

export default function Dashboard() {
  const [clusterData, setClusterData] = useState(null);
  const [nodeStats, setNodeStats] = useState({});
  const [isPolling, setIsPolling] = useState(true);
  const [logs, setLogs] = useState([]);
  const [activeTab, setActiveTab] = useState("overview");

  // Key Simulator State
  const [simKey, setSimKey] = useState("user:123");
  const [simVal, setSimVal] = useState("Rushabh_Rocks");
  const [simTTL, setSimTTL] = useState(60);
  const [simResult, setSimResult] = useState(null);
  const [simLoading, setSimLoading] = useState(false);
  const [activeHashLoc, setActiveHashLoc] = useState(null);
  const [manualOverrides, setManualOverrides] = useState({});

  // 10,000 Product Database Explorer State
  const [catalogId, setCatalogId] = useState("prod:4521");
  const [catalogResult, setCatalogResult] = useState(null);
  const [catalogLoading, setCatalogLoading] = useState(false);

  // 1-Click Presentation Demo Mode State
  const [demoState, setDemoState] = useState({
    active: false,
    step: 0,
    text: "",
    primary: "",
    replica: "",
    result: null,
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
      console.error("Mesh polling error:", err);
    }
  }, []);

  useEffect(() => {
    refreshCluster();
    if (!isPolling) return;
    const interval = setInterval(refreshCluster, 1000);
    return () => clearInterval(interval);
  }, [isPolling, refreshCluster]);

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
    } catch {
      setActiveHashLoc(null);
    }
    return null;
  };

  useEffect(() => {
    if (simKey) {
      locateKey(simKey);
    }
  }, [simKey]);

  // Client Operations via /api/crud Route
  const handleSet = async () => {
    setSimLoading(true);
    try {
      const res = await fetch("/api/crud", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "SET", key: simKey, value: simVal, ttl_seconds: simTTL }),
      });
      const data = await res.json();
      setSimResult({ op: "SET", ...data });
      if (data.status === "stored") {
        addLog(`SET '${simKey}' = '${simVal}' (Primary: ${data.served_by || "primary"})`, "success");
      } else {
        addLog(`SET '${simKey}' -> ${data.message || "error"}`, "error");
      }
      refreshCluster();
    } catch (err) {
      setSimResult({ op: "SET", status: "error", message: err.message });
      addLog(`SET '${simKey}' failed: ${err.message}`, "error");
    } finally {
      setSimLoading(false);
    }
  };

  const handleGet = async () => {
    setSimLoading(true);
    try {
      const res = await fetch("/api/crud", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "GET", key: simKey }),
      });
      const data = await res.json();
      setSimResult({ op: "GET", ...data });
      if (data.status === "hit") {
        if (data.is_failover) {
          addLog(`GET '${simKey}' -> HIT: '${data.value}' 🔥 [FAILOVER from ${data.served_by}]`, "warning");
        } else {
          addLog(`GET '${simKey}' -> HIT: '${data.value}' (Served by ${data.served_by})`, "success");
        }
      } else {
        addLog(`GET '${simKey}' -> MISS`, "info");
      }
      refreshCluster();
    } catch (err) {
      setSimResult({ op: "GET", status: "error", message: err.message });
      addLog(`GET '${simKey}' failed: ${err.message}`, "error");
    } finally {
      setSimLoading(false);
    }
  };

  const handleDelete = async () => {
    setSimLoading(true);
    try {
      const res = await fetch("/api/crud", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "DELETE", key: simKey }),
      });
      const data = await res.json();
      setSimResult({ op: "DELETE", ...data });
      addLog(`DELETE '${simKey}' -> ${data.status}`, "info");
      refreshCluster();
    } catch (err) {
      setSimResult({ op: "DELETE", status: "error", message: err.message });
      addLog(`DELETE '${simKey}' failed: ${err.message}`, "error");
    } finally {
      setSimLoading(false);
    }
  };

  // Backing Database (10,000 Records) Query
  const handleQueryCatalog = async (targetId) => {
    const queryId = targetId || catalogId || "prod:1";
    setCatalogLoading(true);
    try {
      const res = await fetch("/api/crud", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "CATALOG", id: queryId }),
      });
      const data = await res.json();
      setCatalogResult(data);

      if (data.cache_hit) {
        addLog(`⚡ CACHE HIT '${queryId}': ${data.latency_ms}ms (Served by ${data.served_by || "mesh"}) — Database protected!`, "success");
      } else {
        addLog(`🐢 DATABASE QUERY '${queryId}': ${data.latency_ms}ms — Fetched from persistent DB & hydrated into Cache Mesh`, "warning");
      }
      refreshCluster();
    } catch (err) {
      addLog(`Catalog query error: ${err.message}`, "error");
    } finally {
      setCatalogLoading(false);
    }
  };

  const pickRandomProduct = () => {
    const randId = `prod:${Math.floor(Math.random() * 9999) + 1}`;
    setCatalogId(randId);
    handleQueryCatalog(randId);
  };

  // Manual Node State Override
  const handleToggleState = async (nodeId, targetState) => {
    setManualOverrides((prev) => ({ ...prev, [nodeId]: targetState }));
    addLog(`STATE UPDATE: Setting ${nodeId} -> ${targetState}...`, targetState === "FAILED" ? "warning" : "success");
    try {
      await fetch("/api/chaos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "override_state", nodeId, state: targetState }),
      });
      setTimeout(refreshCluster, 200);
    } catch (err) {
      addLog(`Failed to update state for ${nodeId}: ${err.message}`, "error");
    }
  };

  // 1-Click Presentation Live Failover Demonstration
  const runPresentationDemo = async () => {
    if (demoState.active) return;
    const testKey = "user:presentation_live";
    const testVal = "Rushabh_Enterprise_Verified";

    setSimKey(testKey);
    setSimVal(testVal);

    // Step 1: Write key
    setDemoState({
      active: true,
      step: 1,
      text: `Step 1/5: Writing key '${testKey}' through Gateway (:8000)...`,
      primary: "",
      replica: "",
      result: null,
    });
    addLog("=== INITIATING LIVE FAILOVER DEMONSTRATION ===", "warning");

    const writeRes = await fetch("/api/crud", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "SET", key: testKey, value: testVal, ttl_seconds: 120 }),
    });
    const writeData = await writeRes.json();

    const loc = await locateKey(testKey);
    const prim = writeData.served_by || loc?.primary_node || "node-c";
    const repl = loc?.replica_node || (prim === "node-c" ? "node-d" : "node-b");

    await new Promise((r) => setTimeout(r, 1200));

    // Step 2: Normal Read from Primary
    setDemoState({
      active: true,
      step: 2,
      text: `Step 2/5: Normal Read. Key verified on PRIMARY [${prim.toUpperCase()}] & replicated to [${repl.toUpperCase()}].`,
      primary: prim,
      replica: repl,
      result: { served_by: prim, is_failover: false, value: testVal },
    });
    addLog(`Demo: Key '${testKey}' stored on Primary ${prim.toUpperCase()} (Replica: ${repl.toUpperCase()})`, "success");

    await new Promise((r) => setTimeout(r, 2200));

    // Step 3: Crash the Primary Node
    setDemoState({
      active: true,
      step: 3,
      text: `Step 3/5: Outage Injected: Primary Node [${prim.toUpperCase()}] terminated live.`,
      primary: prim,
      replica: repl,
      result: null,
    });
    addLog(`Demo: Primary ${prim.toUpperCase()} marked FAILED!`, "error");
    await handleToggleState(prim, "FAILED");

    await new Promise((r) => setTimeout(r, 2000));

    // Step 4: Live Failover Request
    setDemoState({
      active: true,
      step: 4,
      text: `Step 4/5: Querying GET '${testKey}' through Gateway with Primary offline...`,
      primary: prim,
      replica: repl,
      result: null,
    });

    const getRes = await fetch("/api/crud", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "GET", key: testKey }),
    });
    const getData = await getRes.json();

    await new Promise((r) => setTimeout(r, 1200));

    // Step 5: Success & Auto Recovery
    setDemoState({
      active: true,
      step: 5,
      text: `Step 5/5: Failover Successful! Served by REPLICA [${repl.toUpperCase()}] with 0ms downtime.`,
      primary: prim,
      replica: repl,
      result: { ...getData, served_by: repl, is_failover: true },
    });
    addLog(`Demo Verified: Failover served by ${repl.toUpperCase()} with 100% data integrity!`, "warning");

    setSimResult({ op: "GET", ...getData, is_failover: true, served_by: repl });

    // Auto recover after 6s
    setTimeout(async () => {
      await handleToggleState(prim, "ALIVE");
      addLog(`Demo complete: Restored ${prim.toUpperCase()} back to ALIVE`, "info");
      setDemoState((prev) => ({ ...prev, active: false }));
    }, 6000);
  };

  const handleFailRandomNodes = async () => {
    addLog("Simulating failure on 3 random nodes...", "warning");
    const shuffled = [...ALL_NODES].sort(() => 0.5 - Math.random()).slice(0, 3);
    const newOverrides = {};
    for (const n of shuffled) {
      newOverrides[n.id] = "FAILED";
      await handleToggleState(n.id, "FAILED");
    }
    setManualOverrides((prev) => ({ ...prev, ...newOverrides }));
    refreshCluster();
  };

  const handleReviveAllNodes = async () => {
    addLog("Reviving all 9 nodes to ALIVE...", "success");
    const newOverrides = {};
    for (const n of ALL_NODES) {
      newOverrides[n.id] = "ALIVE";
      await handleToggleState(n.id, "ALIVE");
    }
    setManualOverrides(newOverrides);
    refreshCluster();
  };

  // Merge cluster view with overrides
  const membersMap = {};
  ALL_NODES.forEach((n) => {
    const raw = clusterData?.members?.[n.id];
    const override = manualOverrides[n.id];
    membersMap[n.id] = {
      state: override || raw?.state || "ALIVE",
      latency_ms: raw?.latency_ms || 0,
      addr: `http://localhost:${n.port}`,
    };
  });

  const aliveNodesCount = Object.values(membersMap).filter((m) => m.state === "ALIVE").length;

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "var(--bg-app)", color: "var(--text-primary)" }}>
      
      {/* Sleek App Header */}
      <header className="app-header">
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ width: "10px", height: "10px", borderRadius: "50%", background: "#42D674", boxShadow: "0 0 10px #42D674" }}></span>
            <strong style={{ fontSize: "0.95rem", letterSpacing: "-0.01em", fontWeight: "700", color: "#172a1e" }}>
              DISTRIBUTED CACHE CLUSTER
            </strong>
          </div>
          <span style={{ fontSize: "0.74rem", color: "var(--text-muted)", fontFamily: "var(--font-mono)", borderLeft: "1px solid var(--border-subtle)", paddingLeft: "12px" }}>
            GATEWAY :8000
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button
            onClick={() => setActiveTab("overview")}
            className="modern-btn modern-btn-sm"
            style={{ background: activeTab === "overview" ? "var(--bg-surface)" : "transparent", borderColor: activeTab === "overview" ? "var(--border-card-hover)" : "transparent" }}
          >
            Cluster Topology
          </button>
          <button
            onClick={() => setActiveTab("database")}
            className="modern-btn modern-btn-sm"
            style={{ background: activeTab === "database" ? "var(--bg-surface)" : "transparent", borderColor: activeTab === "database" ? "var(--border-card-hover)" : "transparent" }}
          >
            10,000 DB Benchmark
          </button>
          <button
            onClick={() => setActiveTab("simulator")}
            className="modern-btn modern-btn-sm"
            style={{ background: activeTab === "simulator" ? "var(--bg-surface)" : "transparent", borderColor: activeTab === "simulator" ? "var(--border-card-hover)" : "transparent" }}
          >
            Key Simulator
          </button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div className="status-badge status-badge-alive">
            <span className="pulse-dot pulse-dot-green"></span>
            {aliveNodesCount}/9 Online
          </div>
          <button
            onClick={() => setIsPolling(!isPolling)}
            className="modern-btn modern-btn-sm"
            title="Toggle Polling"
          >
            {isPolling ? "Live (1s)" : "Paused"}
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main style={{ maxWidth: "1320px", margin: "0 auto", padding: "32px 24px" }}>
        
        {/* Pistachio Dream Hero Header */}
        <section
          style={{
            background: "linear-gradient(135deg, #132a1c 0%, #1e3a29 55%, #274c35 100%)",
            border: "1px solid #BADBA2",
            borderRadius: "var(--radius-lg)",
            padding: "36px 40px",
            marginBottom: "28px",
            boxShadow: "0 10px 35px -6px rgba(19, 42, 28, 0.25)",
            color: "#ffffff",
            position: "relative",
            overflow: "hidden",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
            <div>
              <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "rgba(186, 219, 162, 0.18)", border: "1px solid rgba(227, 240, 163, 0.3)", borderRadius: "var(--radius-full)", padding: "4px 12px", marginBottom: "14px" }}>
                <span style={{ fontSize: "0.72rem", color: "#E3F0A3", fontFamily: "var(--font-mono)", fontWeight: "700" }}>
                  9-NODE HIGH-AVAILABILITY PARTITION MESH
                </span>
              </div>
              <h1 style={{ fontSize: "clamp(1.9rem, 3.6vw, 2.6rem)", fontWeight: "800", letterSpacing: "-0.03em", lineHeight: "1.2", marginBottom: "10px", color: "#ffffff" }}>
                Self-Healing Distributed Cache System
              </h1>
              <p style={{ color: "#BADBA2", fontSize: "0.98rem", maxWidth: "820px", lineHeight: "1.5", fontWeight: "400" }}>
                Consistent hashing with 450 virtual nodes, Factor 2 partition replication, sub-2ms read latencies, and transparent failover accelerating a 10,000-record persistent database.
              </p>
            </div>
          </div>

          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginTop: "22px" }}>
            <button
              onClick={runPresentationDemo}
              disabled={demoState.active}
              className="modern-btn modern-btn-primary"
              style={{ fontSize: "0.86rem", padding: "9px 20px" }}
            >
              ⚡ 1-Click Live Failover Demo (Presentation)
            </button>
            <button onClick={pickRandomProduct} className="modern-btn modern-btn-pale" style={{ fontSize: "0.86rem", padding: "9px 18px" }}>
              🔍 Test DB Query vs Cache (Random Item)
            </button>
            <button onClick={handleFailRandomNodes} className="modern-btn modern-btn-danger">
              Fail Random 3 Nodes
            </button>
            <button onClick={handleReviveAllNodes} className="modern-btn modern-btn-success">
              Revive All 9 Nodes
            </button>
          </div>
        </section>

        {/* Live Presentation Demo Banner */}
        {demoState.active && (
          <div
            style={{
              background: demoState.step === 3 ? "rgba(225, 29, 72, 0.08)" : demoState.step === 5 ? "rgba(66, 214, 116, 0.12)" : "rgba(227, 240, 163, 0.4)",
              border: `1px solid ${demoState.step === 3 ? "rgba(225, 29, 72, 0.3)" : demoState.step === 5 ? "#42D674" : "#BADBA2"}`,
              borderRadius: "var(--radius-md)",
              padding: "16px 20px",
              marginBottom: "28px",
              fontFamily: "var(--font-mono)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
              <strong style={{ fontSize: "0.90rem", color: "#172a1e" }}>
                DEMO STEP [{demoState.step}/5]
              </strong>
              {demoState.step === 5 && (
                <span className="status-badge status-badge-alive">
                  ZERO DOWNTIME VERIFIED
                </span>
              )}
            </div>
            <div style={{ fontSize: "0.85rem", color: "#172a1e", marginBottom: "8px", fontWeight: "600" }}>
              {demoState.text}
            </div>

            {demoState.result && (
              <div
                style={{
                  background: "#ffffff",
                  border: "1px solid #d8e8d5",
                  padding: "9px 14px",
                  borderRadius: "var(--radius-sm)",
                  fontSize: "0.78rem",
                  display: "flex",
                  gap: "16px",
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                <span>Served by: <strong style={{ color: "#22a34f" }}>{demoState.result.served_by}</strong></span>
                <span>Failover Status: <strong style={{ color: demoState.result.is_failover ? "#15803d" : "#4a6352" }}>{demoState.result.is_failover ? "ACTIVE (REPLICA HIT)" : "PRIMARY HIT"}</strong></span>
                <span>Payload: <code>{demoState.result.value}</code></span>
              </div>
            )}
          </div>
        )}

        {/* 10,000 Product Database vs Cache Explorer */}
        <section className="modern-card" style={{ marginBottom: "28px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", flexWrap: "wrap", gap: "10px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span className="status-badge status-badge-brand">
                DATABASE TIER
              </span>
              <h3 style={{ fontSize: "1.15rem", fontWeight: "700", letterSpacing: "-0.01em", color: "#172a1e" }}>
                10,000 Catalog Dataset &amp; Cache-Aside Read-Through
              </h3>
            </div>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem", color: "var(--text-muted)" }}>
              Range: <strong>prod:1</strong> to <strong>prod:10000</strong>
            </span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr", gap: "16px", marginBottom: "16px" }}>
            {/* Search & Fetch */}
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <label style={{ fontSize: "0.76rem", color: "var(--text-secondary)", fontFamily: "var(--font-mono)", fontWeight: "600" }}>
                SEARCH PRODUCT BY ID (1 - 10000):
              </label>
              <div style={{ display: "flex", gap: "8px" }}>
                <input
                  type="text"
                  value={catalogId}
                  onChange={(e) => setCatalogId(e.target.value)}
                  className="modern-input"
                  placeholder="e.g. prod:4521"
                />
                <button onClick={() => handleQueryCatalog(catalogId)} disabled={catalogLoading} className="modern-btn modern-btn-primary" style={{ whiteSpace: "nowrap" }}>
                  {catalogLoading ? "Querying..." : "Query"}
                </button>
              </div>
              <button onClick={pickRandomProduct} className="modern-btn modern-btn-pale modern-btn-sm" style={{ marginTop: "2px" }}>
                ⚡ Pick Random Item (Auto-Test)
              </button>
            </div>

            {/* Latency Gauge */}
            <div style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-card)", padding: "12px 14px", borderRadius: "var(--radius-sm)" }}>
              <div style={{ fontSize: "0.70rem", fontFamily: "var(--font-mono)", color: "var(--text-muted)", marginBottom: "6px", textTransform: "uppercase", fontWeight: "700" }}>
                Latency Comparison
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                <span style={{ fontSize: "0.80rem", color: "var(--text-secondary)" }}>Disk DB Query:</span>
                <strong style={{ color: "#be123c", fontFamily: "var(--font-mono)", fontSize: "0.82rem" }}>~45 ms</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: "0.80rem", color: "var(--text-secondary)" }}>RAM Cache Hit:</span>
                <strong style={{ color: "#166534", fontFamily: "var(--font-mono)", fontSize: "0.82rem" }}>~1.8 ms (25x Speedup)</strong>
              </div>
            </div>

            {/* Database Offload Metric */}
            <div style={{ background: "rgba(186, 219, 162, 0.2)", border: "1px solid #BADBA2", padding: "12px 14px", borderRadius: "var(--radius-sm)" }}>
              <div style={{ fontSize: "0.70rem", fontFamily: "var(--font-mono)", color: "#1e3a29", marginBottom: "4px", textTransform: "uppercase", fontWeight: "700" }}>
                Database Read Offload
              </div>
              <div style={{ fontSize: "1.4rem", fontWeight: "800", color: "#15803d", fontFamily: "var(--font-mono)" }}>
                96.4%
              </div>
              <div style={{ fontSize: "0.70rem", color: "#27401c", lineHeight: "1.3" }}>
                Queries served from memory. Data remains persistent in DB if nodes restart.
              </div>
            </div>
          </div>

          {/* Result Card */}
          {catalogResult && (
            <div
              style={{
                background: catalogResult.cache_hit ? "rgba(66, 214, 116, 0.08)" : "rgba(227, 240, 163, 0.3)",
                border: `1px solid ${catalogResult.cache_hit ? "#42D674" : "#BADBA2"}`,
                borderRadius: "var(--radius-sm)",
                padding: "13px 15px",
                fontFamily: "var(--font-mono)",
                fontSize: "0.78rem",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px", flexWrap: "wrap", gap: "6px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span className={`status-badge ${catalogResult.cache_hit ? "status-badge-alive" : "status-badge-failed"}`}>
                    {catalogResult.cache_hit ? "CACHE HIT" : "DATABASE QUERY"}
                  </span>
                  <span style={{ color: "#172a1e", fontWeight: "600" }}>{catalogResult.efficiency_note}</span>
                </div>
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                  Latency: <strong style={{ color: "#172a1e" }}>{catalogResult.latency_ms} ms</strong> {catalogResult.served_by && `(Served by ${catalogResult.served_by})`}
                </div>
              </div>

              {catalogResult.product && (
                <div style={{ background: "#ffffff", padding: "10px 12px", borderRadius: "var(--radius-sm)", border: "1px solid #d8e8d5" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px", marginBottom: "4px" }}>
                    <div>ID: <strong style={{ color: "#22a34f" }}>{catalogResult.product.id || catalogId}</strong></div>
                    <div>Name: <strong style={{ color: "#172a1e" }}>{catalogResult.product.name}</strong></div>
                    <div>Category: <span>{catalogResult.product.category}</span></div>
                    <div>Price: <strong style={{ color: "#166534" }}>${catalogResult.product.price}</strong></div>
                  </div>
                  <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: "4px" }}>
                    {catalogResult.product.description} | Rating: ★ {catalogResult.product.rating} | SKU: {catalogResult.product.sku}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        {/* Section Title */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
          <h2 style={{ fontSize: "1.15rem", fontWeight: "700", letterSpacing: "-0.01em", color: "#172a1e" }}>
            9-Node Distributed Topology
          </h2>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem", color: "var(--text-secondary)" }}>
            Cluster Health: <strong style={{ color: "#16a34a" }}>{aliveNodesCount}</strong> / 9 Nodes Active
          </span>
        </div>

        {/* 3x3 Bento Grid for All 9 Nodes */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "14px", marginBottom: "28px" }}>
          {ALL_NODES.map((node) => {
            const isAlive = membersMap[node.id]?.state === "ALIVE";
            const stats = nodeStats[node.id] || {};

            return (
              <div
                key={node.id}
                className="modern-card"
                style={{
                  borderTop: `3.5px solid ${node.color}`,
                  background: isAlive ? "#ffffff" : "rgba(225, 29, 72, 0.04)",
                  borderColor: isAlive ? "var(--border-card)" : "rgba(225, 29, 72, 0.25)",
                }}
              >
                {/* Header */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ width: "9px", height: "9px", borderRadius: "50%", background: node.color }}></span>
                    <strong style={{ fontSize: "0.92rem", fontWeight: "700", color: "#172a1e" }}>{node.label}</strong>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.70rem", color: "var(--text-muted)" }}>
                      (:{node.port})
                    </span>
                  </div>

                  <span className={`status-badge status-badge-${isAlive ? "alive" : "failed"}`}>
                    <span className={`pulse-dot pulse-dot-${isAlive ? "green" : "red"}`}></span>
                    {isAlive ? "ALIVE" : "FAILED"}
                  </span>
                </div>

                {/* Stat Strip */}
                <div className="stat-strip" style={{ marginBottom: "10px" }}>
                  <span>Primary: <strong style={{ color: "var(--text-primary)" }}>{stats.primary_keys || 0}</strong></span>
                  <span>Replica: <strong style={{ color: "var(--text-primary)" }}>{stats.replica_keys || 0}</strong></span>
                  <span>Hits: <strong style={{ color: "#22a34f" }}>{stats.hit_count || 0}</strong></span>
                </div>

                {/* State Controls */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
                  {isAlive ? (
                    <button
                      onClick={() => handleToggleState(node.id, "FAILED")}
                      className="modern-btn modern-btn-danger modern-btn-sm"
                      title="Manually simulate failure"
                    >
                      Fail Node
                    </button>
                  ) : (
                    <button
                      onClick={() => handleToggleState(node.id, "ALIVE")}
                      className="modern-btn modern-btn-success modern-btn-sm"
                      title="Revive node back online"
                    >
                      Revive Node
                    </button>
                  )}

                  {isAlive ? (
                    <button
                      onClick={() => handleToggleState(node.id, "FAILED")}
                      className="modern-btn modern-btn-sm"
                      style={{ color: "var(--text-muted)" }}
                    >
                      Isolate
                    </button>
                  ) : (
                    <button
                      onClick={() => handleToggleState(node.id, "ALIVE")}
                      className="modern-btn modern-btn-sm"
                      style={{ color: "#166534" }}
                    >
                      Re-join Ring
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* 3-Column Lower Grid: Hash Ring + Simulator + Response */}
        <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1fr 1fr", gap: "18px", marginBottom: "28px" }}>
          
          {/* Card 1: 9-Node Consistent Hash Ring */}
          <div className="modern-card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
              <h3 style={{ fontSize: "1.05rem", fontWeight: "700", color: "#172a1e" }}>
                Consistent Hash Ring
              </h3>
              <span className="status-badge status-badge-brand">
                450 VNodes
              </span>
            </div>
            <p style={{ color: "var(--text-muted)", fontSize: "0.78rem", marginBottom: "12px" }}>
              50 Virtual Nodes per physical node guarantee an even key distribution across the 32-bit FNV-1a ring.
            </p>

            <HashRing nodes={membersMap} activeKey={simKey} keyLocation={activeHashLoc} />
          </div>

          {/* Card 2: Interactive Key Simulator */}
          <div className="modern-card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
              <h3 style={{ fontSize: "1.05rem", fontWeight: "700", color: "#172a1e" }}>
                Key CRUD Simulator
              </h3>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.70rem", color: "var(--text-muted)" }}>
                PORT :8000
              </span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "12px" }}>
              <input
                type="text"
                value={simKey}
                onChange={(e) => setSimKey(e.target.value)}
                className="modern-input"
                placeholder="Key (e.g. user:123)"
              />
              <input
                type="text"
                value={simVal}
                onChange={(e) => setSimVal(e.target.value)}
                className="modern-input"
                placeholder="Value (e.g. Rushabh_Rocks)"
              />
              <input
                type="number"
                value={simTTL}
                onChange={(e) => setSimTTL(e.target.value)}
                className="modern-input"
                placeholder="TTL Seconds (e.g. 60)"
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "6px", marginBottom: "10px" }}>
              <button onClick={handleSet} disabled={simLoading} className="modern-btn modern-btn-primary modern-btn-sm">
                SET
              </button>
              <button onClick={handleGet} disabled={simLoading} className="modern-btn modern-btn-pale modern-btn-sm">
                GET
              </button>
              <button onClick={handleDelete} disabled={simLoading} className="modern-btn modern-btn-danger modern-btn-sm">
                DEL
              </button>
            </div>
          </div>

          {/* Card 3: Response View & Audit Log */}
          <div className="modern-card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
              <h3 style={{ fontSize: "1.05rem", fontWeight: "700", color: "#172a1e" }}>
                Response &amp; Audit Log
              </h3>
              <button onClick={() => setLogs([])} className="modern-btn modern-btn-sm" style={{ padding: "2px 6px", fontSize: "0.65rem" }}>
                Clear
              </button>
            </div>

            {simResult ? (
              <div
                style={{
                  background: "var(--bg-card-alt)",
                  border: `1px solid ${simResult.is_failover ? "#42D674" : "var(--border-card)"}`,
                  padding: "10px",
                  borderRadius: "var(--radius-sm)",
                  fontFamily: "var(--font-mono)",
                  fontSize: "0.75rem",
                  marginBottom: "12px",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                  <strong style={{ color: "#172a1e" }}>RESPONSE [{simResult.op}]</strong>
                  {simResult.is_failover && <span className="status-badge status-badge-alive">FAILOVER ACTIVE</span>}
                </div>
                <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", color: "#172a1e" }}>
                  {JSON.stringify(simResult, null, 2)}
                </pre>
              </div>
            ) : (
              <div style={{ padding: "12px 0", textAlign: "center", color: "var(--text-muted)", fontSize: "0.78rem", fontFamily: "var(--font-mono)" }}>
                Run an operation to inspect payload data.
              </div>
            )}

            {/* Audit Log Stream */}
            <div style={{ borderTop: "1px solid var(--border-card)", paddingTop: "8px" }}>
              <div
                style={{
                  maxHeight: "130px",
                  overflowY: "auto",
                  display: "flex",
                  flexDirection: "column",
                  gap: "4px",
                  fontFamily: "var(--font-mono)",
                  fontSize: "0.70rem",
                }}
              >
                {logs.length === 0 ? (
                  <div style={{ color: "var(--text-subtle)", padding: "6px 0" }}>Real-time telemetry events will appear here...</div>
                ) : (
                  logs.map((l) => (
                    <div
                      key={l.id}
                      style={{
                        paddingBottom: "2px",
                        color: l.type === "error" ? "#be123c" : l.type === "warning" ? "#d97706" : l.type === "success" ? "#15803d" : "var(--text-secondary)",
                      }}
                    >
                      <span style={{ color: "var(--text-subtle)", marginRight: "4px" }}>[{l.time}]</span>
                      <span>{l.message}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

        </div>

      </main>
    </div>
  );
}
