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

function computeKeyRingLocation(key) {
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

  let replicaNode = "node-b";
  for (let i = 1; i < tokens.length; i++) {
    const idx = (primaryIndex + i) % tokens.length;
    if (tokens[idx].nodeId !== primaryNode) {
      replicaNode = tokens[idx].nodeId;
      break;
    }
  }

  return {
    key,
    hash: keyHash,
    primary_node: primaryNode,
    replica_node: replicaNode,
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
      const activeBombardNode = ALL_NODE_IDS[nodeIndex % ALL_NODE_IDS.length];
      const replicaIndex = (nodeIndex + 1) % ALL_NODE_IDS.length;
      const replicaBombardNode = ALL_NODE_IDS[replicaIndex];

      setBombardState({
        hash: randHash,
        angle,
        primary_node: activeBombardNode,
        replica_node: replicaBombardNode,
        point: polarPoint(center, radius, angle),
        simulatedKey: `trip:${Math.floor(Math.random() * 7660000) + 1}`,
      });
    }, 75);

    return () => clearInterval(timer);
  }, [isBombarding, center, radius, maxHash]);

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
    if (keyLocation?.primary_node) return keyLocation;
    if (activeKey) return computeKeyRingLocation(activeKey);
    return null;
  }, [isBombarding, bombardState, keyLocation, activeKey]);

  const keyPos = useMemo(() => {
    if (isBombarding && bombardState) {
      return bombardState;
    }
    if (!activeKey) return null;
    const hash = fnv32a(activeKey);
    const angle = (hash / maxHash) * 360;
    return { hash, angle, point: polarPoint(center, radius, angle), key: activeKey };
  }, [isBombarding, bombardState, activeKey, center, radius, maxHash]);

  const activeNode = locationInfo?.primary_node || "node-a";
  const activeReplica = locationInfo?.replica_node || "node-b";
  const nodeIdx = ALL_NODE_IDS.indexOf(activeNode);
  const activeColor = nodeIdx >= 0 ? NODE_COLORS[nodeIdx % NODE_COLORS.length] : "#007eb9";
  const displayKey = isBombarding && bombardState ? bombardState.simulatedKey : (activeKey || "trip:45210");

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
            const isThisSectorActive = ALL_NODE_IDS[i] === activeNode;
            return (
              <path
                key={i}
                d={arcPath(center, radius + 8, i * 40, i * 40 + 35)}
                fill="none"
                stroke={NODE_COLORS[i]}
                strokeWidth={isThisSectorActive ? "7" : "5"}
                strokeLinecap="round"
                opacity={Object.values(nodes)[i]?.state === "FAILED" ? 0.25 : (isThisSectorActive ? 1 : 0.65)}
                style={{ transition: "stroke-width 0.12s ease-out, opacity 0.12s ease-out" }}
              />
            );
          })}

          {/* Virtual Node Tokens */}
          {vnodes.map((v) => {
            const isTargetNode = v.nodeId === activeNode;
            return (
              <circle
                key={v.id}
                cx={v.point.x}
                cy={v.point.y}
                r={v.isFailed ? 3 : isTargetNode ? 5.5 : 4.2}
                fill={v.isFailed ? "var(--text-dim)" : v.color}
                opacity={v.isFailed ? 0.35 : isTargetNode ? 1 : 0.85}
                stroke={isTargetNode ? "#ffffff" : "var(--bg-surface)"}
                strokeWidth={isTargetNode ? "2" : "1.5"}
                style={{ transition: "r 0.08s ease-out, opacity 0.08s ease-out" }}
              />
            );
          })}

          {/* Active Key Target Tracer & Rotating Coordinate Ray */}
          {keyPos && (
            <g>
              {/* Pulsing Outer Glow */}
              <circle
                cx={keyPos.point.x}
                cy={keyPos.point.y}
                r={isBombarding ? "13" : "9"}
                fill={activeColor}
                opacity={isBombarding ? "0.45" : "0.28"}
                style={{ transition: "cx 0.06s linear, cy 0.06s linear" }}
              />
              {/* Center-to-Token Direction Ray */}
              <line
                x1={center}
                y1={center}
                x2={keyPos.point.x}
                y2={keyPos.point.y}
                stroke={activeColor}
                strokeWidth={isBombarding ? "2.4" : "1.8"}
                strokeDasharray="4 3"
                opacity="0.9"
                style={{ transition: "x2 0.06s linear, y2 0.06s linear, stroke 0.1s ease" }}
              />
              {/* Outer Cursor Halo */}
              <circle
                cx={keyPos.point.x}
                cy={keyPos.point.y}
                r={isBombarding ? "8" : "7.5"}
                fill="var(--bg-surface)"
                stroke={activeColor}
                strokeWidth="2.5"
                style={{ transition: "cx 0.06s linear, cy 0.06s linear" }}
              />
              {/* Inner Core Pulse */}
              <circle
                cx={keyPos.point.x}
                cy={keyPos.point.y}
                r={isBombarding ? "4" : "3.5"}
                fill={activeColor}
                style={{ transition: "cx 0.06s linear, cy 0.06s linear, fill 0.1s ease" }}
              />
            </g>
          )}
        </svg>

        {/* Center Ring Telemetry */}
        <div className="hash-ring-center">
          <div className="hash-ring-kicker">{isBombarding ? "⚡ BOMBARDING" : "Consistent Hash"}</div>
          <strong style={{ fontSize: "1.1rem" }}>450</strong>
          <span style={{ fontSize: "0.68rem" }}>virtual tokens</span>
          <div style={{ marginTop: "4px", fontSize: "0.80rem", fontWeight: 700, color: activeColor, fontFamily: "var(--font-mono)", transition: "color 0.1s ease" }}>
            Primary: {activeNode}
          </div>
          <div style={{ fontSize: "0.68rem", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
            Replica: {activeReplica}
          </div>
        </div>
      </div>

      {/* Legend with perfect center flex layout */}
      <div className="hash-ring-legend">
        {ALL_NODE_IDS.map((nodeId, i) => (
          <span key={nodeId} style={{ opacity: nodeId === activeNode ? 1 : 0.7, fontWeight: nodeId === activeNode ? 700 : 400 }}>
            <i style={{ background: NODE_COLORS[i] }} />
            {nodeId}
          </span>
        ))}
      </div>

      {/* Target Key & FNV-1a Hash Details */}
      {keyPos && (
        <div className="hash-ring-key" style={{ fontSize: "0.75rem", fontFamily: "var(--font-mono)", marginTop: "4px" }}>
          Target: <strong>{displayKey}</strong> · Hash: <strong>{keyPos.hash}</strong> → <span style={{ color: activeColor, fontWeight: 700 }}>{activeNode}</span>
        </div>
      )}
    </div>
  );
}
