"use client";

import React, { useMemo } from "react";

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

export default function HashRing({ nodes = {}, activeKey = "", keyLocation = null }) {
  const size = 340;
  const center = size / 2;
  const radius = 112;
  const maxHash = 4294967295;

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

  const keyPos = useMemo(() => {
    if (!activeKey) return null;
    const hash = fnv32a(activeKey);
    const angle = (hash / maxHash) * 360;
    return { hash, angle, point: polarPoint(center, radius, angle) };
  }, [activeKey, center, radius, maxHash]);

  const locationInfo = useMemo(() => {
    if (keyLocation?.primary_node) return keyLocation;
    if (activeKey) return computeKeyRingLocation(activeKey);
    return null;
  }, [keyLocation, activeKey]);

  const activeNode = locationInfo?.primary_node || "node-a";
  const activeReplica = locationInfo?.replica_node || "node-b";
  const nodeIdx = ALL_NODE_IDS.indexOf(activeNode);
  const activeColor = nodeIdx >= 0 ? NODE_COLORS[nodeIdx % NODE_COLORS.length] : "#007eb9";

  return (
    <div className="hash-ring-wrap">
      <div style={{ position: "relative", width: size, height: size, maxWidth: "100%" }}>
        <svg viewBox={`0 0 ${size} ${size}`} width="100%" height="100%" role="img" aria-label="Consistent hash ring topology">
          <circle cx={center} cy={center} r={radius + 16} fill="none" stroke="var(--border-default)" strokeWidth="1" />
          <circle cx={center} cy={center} r={radius - 18} fill="var(--bg-surface-subtle)" stroke="var(--border-default)" strokeWidth="1" />
          {Array.from({ length: 12 }, (_, i) => {
            const point = polarPoint(center, radius + 16, i * 30);
            return <line key={i} x1={center} y1={center} x2={point.x} y2={point.y} stroke="var(--border-default)" strokeWidth="1" opacity="0.45" />;
          })}
          {vnodes.map((v) => (
            <circle
              key={v.id}
              cx={v.point.x}
              cy={v.point.y}
              r={v.isFailed ? 3 : 4.2}
              fill={v.isFailed ? "var(--text-dim)" : v.color}
              opacity={v.isFailed ? 0.35 : 0.95}
              stroke="var(--bg-surface)"
              strokeWidth="1.5"
            />
          ))}
          {Array.from({ length: 9 }, (_, i) => (
            <path
              key={i}
              d={arcPath(center, radius + 8, i * 40, i * 40 + 35)}
              fill="none"
              stroke={NODE_COLORS[i]}
              strokeWidth="5"
              strokeLinecap="round"
              opacity={Object.values(nodes)[i]?.state === "FAILED" ? 0.25 : 0.72}
            />
          ))}
          {keyPos && (
            <g>
              <line
                x1={center}
                y1={center}
                x2={keyPos.point.x}
                y2={keyPos.point.y}
                stroke="var(--text-primary)"
                strokeWidth="1.5"
                strokeDasharray="4 4"
                opacity="0.7"
              />
              <circle cx={keyPos.point.x} cy={keyPos.point.y} r="7" fill="var(--bg-surface)" stroke="var(--text-primary)" strokeWidth="2" />
              <circle cx={keyPos.point.x} cy={keyPos.point.y} r="3" fill="var(--text-primary)" />
            </g>
          )}
        </svg>

        {/* Center Ring Telemetry */}
        <div className="hash-ring-center">
          <div className="hash-ring-kicker">Consistent Hash</div>
          <strong style={{ fontSize: "1.1rem" }}>450</strong>
          <span style={{ fontSize: "0.68rem" }}>virtual tokens</span>
          <div style={{ marginTop: "4px", fontSize: "0.80rem", fontWeight: 700, color: activeColor, fontFamily: "var(--font-mono)" }}>
            Primary: {activeNode}
          </div>
          <div style={{ fontSize: "0.68rem", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
            Replica: {activeReplica}
          </div>
        </div>
      </div>

      <div className="hash-ring-legend">
        {ALL_NODE_IDS.map((nodeId, i) => (
          <span key={nodeId}>
            <i style={{ background: NODE_COLORS[i] }} />
            {nodeId}
          </span>
        ))}
      </div>

      {keyPos && (
        <div className="hash-ring-key" style={{ fontSize: "0.75rem", fontFamily: "var(--font-mono)", marginTop: "6px" }}>
          Target: <strong>{activeKey}</strong> · Hash: <strong>{keyPos.hash}</strong> → <span style={{ color: activeColor, fontWeight: 700 }}>{activeNode}</span>
        </div>
      )}
    </div>
  );
}
