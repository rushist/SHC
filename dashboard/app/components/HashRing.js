"use client";

import React, { useState, useEffect, useMemo } from "react";

function fnv32a(str) {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return hash >>> 0;
}

const ALL_NODE_IDS = ["node-a", "node-b", "node-c", "node-d", "node-e", "node-f", "node-g", "node-h", "node-i"];
const NODE_COLORS = ["#007eb9", "#5b5ea6", "#1d8102", "#ec7211", "#2b7c92", "#8c5a9e", "#4d7c0f", "#b45309", "#496a8f"];

function polarPoint(center, radius, angle) {
  const rad = ((angle - 90) * Math.PI) / 180;
  return { x: center + radius * Math.cos(rad), y: center + radius * Math.sin(rad) };
}

function arcPath(center, radius, start, end) {
  const from = polarPoint(center, radius, start);
  const to = polarPoint(center, radius, end);
  const largeArc = end - start > 180 ? 1 : 0;
  return `M ${from.x} ${from.y} A ${radius} ${radius} 0 ${largeArc} 1 ${to.x} ${to.y}`;
}

function computeKeyRingLocation(key, nodes = {}) {
  if (!key) return null;

  const tokens = [];
  for (const nodeId of ALL_NODE_IDS) {
    for (let i = 0; i < 50; i++) {
      tokens.push({
        hash: fnv32a(`${nodeId}-vnode-${i}`),
        nodeId,
      });
    }
  }
  tokens.sort((a, b) => a.hash - b.hash);

  const keyHash = fnv32a(key);
  let primaryIndex = tokens.findIndex((t) => t.hash >= keyHash);
  if (primaryIndex === -1) {
    primaryIndex = 0;
  }
  const primaryNode = tokens[primaryIndex].nodeId;

  // Find replica node (next distinct node clockwise)
  let replicaNode = "node-b";
  for (let i = 1; i < tokens.length; i++) {
    const idx = (primaryIndex + i) % tokens.length;
    if (tokens[idx].nodeId !== primaryNode) {
      replicaNode = tokens[idx].nodeId;
      break;
    }
  }

  // Consistent Hashing Failover Routing: If primary node is FAILED, route clockwise to next healthy node
  const isPrimaryFailed = nodes[primaryNode]?.state === "FAILED";
  let effectiveNode = primaryNode;
  let isFailover = false;

  if (isPrimaryFailed) {
    for (let i = 1; i < tokens.length; i++) {
      const idx = (primaryIndex + i) % tokens.length;
      const candidateId = tokens[idx].nodeId;
      if (candidateId !== primaryNode && nodes[candidateId]?.state !== "FAILED") {
        effectiveNode = candidateId;
        isFailover = true;
        break;
      }
    }
    if (!isFailover) {
      effectiveNode = replicaNode;
      isFailover = true;
    }
  }

  return {
    key,
    hash: keyHash,
    primary_node: primaryNode,
    replica_node: replicaNode,
    effective_node: effectiveNode,
    is_failover: isFailover,
    primary_failed: isPrimaryFailed,
  };
}

export default function HashRing({ nodes = {}, activeKey = "", keyLocation = null, isBombarding = false }) {
  const size = 340;
  const center = size / 2;
  const radius = 112;
  const maxHash = 4294967295;

  // Real-time dynamic directional rotation & jumping during active bombardment
  const [bombardState, setBombardState] = useState(null);

  useEffect(() => {
    if (!isBombarding) {
      setBombardState(null);
      return;
    }

    // High-frequency ticker: rapidly changes angle and sector across the entire ring
    const timer = setInterval(() => {
      const randHash = Math.floor(Math.random() * maxHash);
      const angle = (randHash / maxHash) * 360;
      const nodeIndex = Math.floor((angle / 360) * ALL_NODE_IDS.length);
      const primaryCandidate = ALL_NODE_IDS[nodeIndex % ALL_NODE_IDS.length];
      const replicaCandidate = ALL_NODE_IDS[(nodeIndex + 1) % ALL_NODE_IDS.length];

      const isCandidateFailed = nodes[primaryCandidate]?.state === "FAILED";
      const effectiveCandidate = isCandidateFailed ? replicaCandidate : primaryCandidate;

      setBombardState({
        hash: randHash,
        angle,
        primary_node: primaryCandidate,
        replica_node: replicaCandidate,
        effective_node: effectiveCandidate,
        is_failover: isCandidateFailed,
        primary_failed: isCandidateFailed,
        point: polarPoint(center, radius, angle),
        simulatedKey: `trip:${Math.floor(Math.random() * 7660000) + 1}`,
      });
    }, 75);

    return () => clearInterval(timer);
  }, [isBombarding, nodes, center, radius, maxHash]);

  const vnodes = useMemo(() => {
    const nodeKeys = Object.keys(nodes).length > 0 ? Object.keys(nodes) : ALL_NODE_IDS;
    return nodeKeys.flatMap((nodeId, nodeIndex) => {
      const color = NODE_COLORS[nodeIndex % NODE_COLORS.length];
      const isFailed = nodes[nodeId]?.state === "FAILED";
      return Array.from({ length: 8 }, (_, i) => {
        const hash = fnv32a(`${nodeId}-vnode-${i}`);
        const angle = (hash / maxHash) * 360;
        return {
          id: `${nodeId}-vnode-${i}`,
          nodeId,
          hash,
          angle,
          point: polarPoint(center, radius, angle),
          color,
          isFailed,
        };
      });
    }).sort((a, b) => a.angle - b.angle);
  }, [nodes, center, radius, maxHash]);

  const locationInfo = useMemo(() => {
    if (isBombarding && bombardState) {
      return bombardState;
    }
    if (keyLocation?.primary_node) {
      const isPrimaryFailed = nodes[keyLocation.primary_node]?.state === "FAILED";
      return {
        ...keyLocation,
        effective_node: isPrimaryFailed ? (keyLocation.replica_node || "node-b") : keyLocation.primary_node,
        is_failover: isPrimaryFailed,
        primary_failed: isPrimaryFailed,
      };
    }
    if (activeKey) return computeKeyRingLocation(activeKey, nodes);
    return null;
  }, [isBombarding, bombardState, keyLocation, activeKey, nodes]);

  const keyPos = useMemo(() => {
    if (isBombarding && bombardState) {
      return bombardState;
    }
    if (!activeKey) return null;
    const hash = fnv32a(activeKey);
    const angle = (hash / maxHash) * 360;
    return { hash, angle, point: polarPoint(center, radius, angle), key: activeKey };
  }, [isBombarding, bombardState, activeKey, center, radius, maxHash]);

  const primaryNode = locationInfo?.primary_node || "node-a";
  const replicaNode = locationInfo?.replica_node || "node-b";
  const effectiveNode = locationInfo?.effective_node || (nodes[primaryNode]?.state === "FAILED" ? replicaNode : primaryNode);
  const isFailover = locationInfo?.is_failover || nodes[primaryNode]?.state === "FAILED";

  const effectiveNodeIdx = ALL_NODE_IDS.indexOf(effectiveNode);
  const activeColor = effectiveNodeIdx >= 0 ? NODE_COLORS[effectiveNodeIdx % NODE_COLORS.length] : "#007eb9";
  const displayKey = isBombarding && bombardState ? bombardState.simulatedKey : (activeKey || "trip:45210");

  // If failover is active, compute the replica target coordinate on the ring
  const effectiveAngle = useMemo(() => {
    if (!isFailover) return keyPos?.angle;
    const effIdx = ALL_NODE_IDS.indexOf(effectiveNode);
    return effIdx >= 0 ? (effIdx * 40 + 17) : (keyPos?.angle || 0);
  }, [isFailover, effectiveNode, keyPos]);

  const effectivePoint = useMemo(() => {
    if (effectiveAngle === undefined || effectiveAngle === null) return keyPos?.point;
    return polarPoint(center, radius, effectiveAngle);
  }, [effectiveAngle, keyPos, center, radius]);

  return (
    <div className="hash-ring-wrap">
      <div style={{ position: "relative", width: "100%", maxWidth: "320px", margin: "0 auto", aspectRatio: "1 / 1" }}>
        <svg
          viewBox={`0 0 ${size} ${size}`}
          width="100%"
          height="100%"
          role="img"
          aria-label="Consistent hash ring topology"
          style={{ display: "block", margin: "0 auto", overflow: "visible" }}
        >
          {/* Background Concentric Guideline Rings */}
          <circle cx={center} cy={center} r={radius + 16} fill="none" stroke="var(--border-default)" strokeWidth="1" />
          <circle cx={center} cy={center} r={radius - 18} fill="var(--bg-surface-subtle)" stroke="var(--border-default)" strokeWidth="1" />
          
          {/* Radial Spokes */}
          {Array.from({ length: 12 }, (_, i) => {
            const point = polarPoint(center, radius + 16, i * 30);
            return <line key={i} x1={center} y1={center} x2={point.x} y2={point.y} stroke="var(--border-default)" strokeWidth="1" opacity="0.45" />;
          })}

          {/* Node Arc Boundaries */}
          {Array.from({ length: 9 }, (_, i) => {
            const nodeId = ALL_NODE_IDS[i];
            const isNodeFailed = nodes[nodeId]?.state === "FAILED";
            const isThisSectorActive = nodeId === effectiveNode;
            const isPrimarySector = nodeId === primaryNode;

            return (
              <path
                key={i}
                d={arcPath(center, radius + 8, i * 40, i * 40 + 35)}
                fill="none"
                stroke={isNodeFailed ? "var(--text-dim)" : NODE_COLORS[i]}
                strokeWidth={isThisSectorActive ? "7" : isPrimarySector && isNodeFailed ? "3" : "5"}
                strokeLinecap="round"
                strokeDasharray={isNodeFailed ? "4 3" : "none"}
                opacity={isNodeFailed ? 0.35 : (isThisSectorActive ? 1 : 0.65)}
                style={{ transition: "stroke-width 0.12s ease-out, opacity 0.12s ease-out" }}
              />
            );
          })}

          {/* Virtual Node Tokens */}
          {vnodes.map((v) => {
            const isTargetNode = v.nodeId === effectiveNode;
            const isPrimaryFailedNode = v.nodeId === primaryNode && v.isFailed;

            return (
              <circle
                key={v.id}
                cx={v.point.x}
                cy={v.point.y}
                r={v.isFailed ? 3 : isTargetNode ? 5.5 : 4.2}
                fill={v.isFailed ? "var(--text-dim)" : v.color}
                opacity={v.isFailed ? (isPrimaryFailedNode ? 0.45 : 0.25) : isTargetNode ? 1 : 0.85}
                stroke={isTargetNode ? "#ffffff" : v.isFailed ? "var(--status-failed-border)" : "var(--bg-surface)"}
                strokeWidth={isTargetNode ? "2" : "1"}
                style={{ transition: "r 0.08s ease-out, opacity 0.08s ease-out" }}
              />
            );
          })}

          {/* Active Key Target Tracer & Rotating Coordinate Ray */}
          {effectivePoint && (
            <g>
              {/* Failover Origin Ghost Marker (Shows where the key hashed originally if primary is offline) */}
              {isFailover && keyPos && (
                <g opacity="0.6">
                  <line
                    x1={center}
                    y1={center}
                    x2={keyPos.point.x}
                    y2={keyPos.point.y}
                    stroke="#d13212"
                    strokeWidth="1.2"
                    strokeDasharray="2 3"
                  />
                  <circle cx={keyPos.point.x} cy={keyPos.point.y} r="4" fill="none" stroke="#d13212" strokeWidth="1.5" />
                  <line
                    x1={keyPos.point.x - 3}
                    y1={keyPos.point.y - 3}
                    x2={keyPos.point.x + 3}
                    y2={keyPos.point.y + 3}
                    stroke="#d13212"
                    strokeWidth="1.2"
                  />
                  <line
                    x1={keyPos.point.x + 3}
                    y1={keyPos.point.y - 3}
                    x2={keyPos.point.x - 3}
                    y2={keyPos.point.y + 3}
                    stroke="#d13212"
                    strokeWidth="1.2"
                  />
                </g>
              )}

              {/* Pulsing Outer Glow on Active Target (Replica or Primary) */}
              <circle
                cx={effectivePoint.x}
                cy={effectivePoint.y}
                r={isBombarding ? "13" : isFailover ? "11" : "9"}
                fill={activeColor}
                opacity={isBombarding ? "0.45" : isFailover ? "0.38" : "0.28"}
                style={{ transition: "cx 0.08s ease-out, cy 0.08s ease-out" }}
              />

              {/* Center-to-Target Routing Ray */}
              <line
                x1={center}
                y1={center}
                x2={effectivePoint.x}
                y2={effectivePoint.y}
                stroke={activeColor}
                strokeWidth={isBombarding ? "2.4" : isFailover ? "2.2" : "1.8"}
                strokeDasharray={isFailover ? "5 3" : "4 3"}
                opacity="0.9"
                style={{ transition: "x2 0.08s ease-out, y2 0.08s ease-out, stroke 0.1s ease" }}
              />

              {/* Outer Cursor Halo */}
              <circle
                cx={effectivePoint.x}
                cy={effectivePoint.y}
                r={isBombarding ? "8" : isFailover ? "8" : "7.5"}
                fill="var(--bg-surface)"
                stroke={activeColor}
                strokeWidth={isFailover ? "2.8" : "2.5"}
                style={{ transition: "cx 0.08s ease-out, cy 0.08s ease-out" }}
              />

              {/* Inner Core Pulse */}
              <circle
                cx={effectivePoint.x}
                cy={effectivePoint.y}
                r={isBombarding ? "4" : "3.5"}
                fill={activeColor}
                style={{ transition: "cx 0.08s ease-out, cy 0.08s ease-out, fill 0.1s ease" }}
              />
            </g>
          )}
        </svg>

        {/* Center Ring Telemetry */}
        <div className="hash-ring-center">
          <div className="hash-ring-kicker">
            {isBombarding ? "⚡ BOMBARDING" : isFailover ? "⚡ FAILOVER SHIFT" : "Consistent Hash"}
          </div>
          <strong style={{ fontSize: "1.1rem" }}>450</strong>
          <span style={{ fontSize: "0.68rem" }}>virtual tokens</span>
          
          {/* Failover-aware Node Status */}
          {isFailover ? (
            <>
              <div style={{ marginTop: "3px", fontSize: "0.72rem", color: "#d13212", fontFamily: "var(--font-mono)", fontWeight: 600, textDecoration: "line-through" }}>
                {primaryNode} (FAILED)
              </div>
              <div style={{ fontSize: "0.80rem", fontWeight: 700, color: activeColor, fontFamily: "var(--font-mono)" }}>
                &rarr; {effectiveNode} (REPLICA)
              </div>
            </>
          ) : (
            <>
              <div style={{ marginTop: "4px", fontSize: "0.80rem", fontWeight: 700, color: activeColor, fontFamily: "var(--font-mono)", transition: "color 0.1s ease" }}>
                Primary: {primaryNode}
              </div>
              <div style={{ fontSize: "0.68rem", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                Replica: {replicaNode}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Legend with perfect center flex layout */}
      <div className="hash-ring-legend">
        {ALL_NODE_IDS.map((nodeId, i) => {
          const isFailed = nodes[nodeId]?.state === "FAILED";
          const isEffective = nodeId === effectiveNode;

          return (
            <span
              key={nodeId}
              style={{
                opacity: isFailed ? 0.35 : isEffective ? 1 : 0.7,
                fontWeight: isEffective ? 700 : 400,
                textDecoration: isFailed ? "line-through" : "none",
              }}
            >
              <i style={{ background: isFailed ? "var(--text-dim)" : NODE_COLORS[i] }} />
              {nodeId}
            </span>
          );
        })}
      </div>

      {/* Target Key & FNV-1a Routing Details */}
      {keyPos && (
        <div className="hash-ring-key" style={{ fontSize: "0.75rem", fontFamily: "var(--font-mono)", marginTop: "4px" }}>
          {isFailover ? (
            <>
              Key: <strong>{displayKey}</strong> · <span style={{ color: "#d13212" }}>{primaryNode} FAILED</span> &rarr; <span style={{ color: activeColor, fontWeight: 700 }}>⚡ Routed to {effectiveNode} (Replica)</span>
            </>
          ) : (
            <>
              Key: <strong>{displayKey}</strong> · Hash: <strong>{keyPos.hash}</strong> &rarr; <span style={{ color: activeColor, fontWeight: 700 }}>{primaryNode} (Primary)</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
