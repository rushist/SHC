"use client";

import React, { useMemo } from "react";

// 32-bit FNV-1a hash matching backend Go implementation
function fnv32a(str) {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return hash >>> 0;
}

const NODE_THEME = {
  "node-a": { bg: "#42D674", text: "#0d351a", label: "Node A (:8001)" },
  "node-b": { bg: "#80EF80", text: "#1a401c", label: "Node B (:8002)" },
  "node-c": { bg: "#BADBA2", text: "#1b3a24", label: "Node C (:8003)" },
  "node-d": { bg: "#E3F0A3", text: "#2c4015", label: "Node D (:8004)" },
  "node-e": { bg: "#2eb872", text: "#ffffff", label: "Node E (:8005)" },
  "node-f": { bg: "#68bb59", text: "#ffffff", label: "Node F (:8006)" },
  "node-g": { bg: "#3caea3", text: "#ffffff", label: "Node G (:8007)" },
  "node-h": { bg: "#88d49e", text: "#15331e", label: "Node H (:8008)" },
  "node-i": { bg: "#1b998b", text: "#ffffff", label: "Node I (:8009)" },
};

export default function HashRing({ nodes = {}, activeKey = "", keyLocation = null }) {
  const size = 330;
  const center = size / 2;
  const radius = 115;
  const maxHash = 4294967295;

  const vnodes = useMemo(() => {
    const list = [];
    const nodeEntries = Object.entries(nodes);

    nodeEntries.forEach(([nodeId, info]) => {
      const theme = NODE_THEME[nodeId] || { bg: "#BADBA2", text: "#000" };
      const isFailed = info?.state === "FAILED";
      
      // 8 virtual node samples per physical node for clean SVG representation
      for (let i = 0; i < 8; i++) {
        const vnodeKey = `${nodeId}-vnode-${i}`;
        const hash = fnv32a(vnodeKey);
        const angle = (hash / maxHash) * 360;
        const rad = ((angle - 90) * Math.PI) / 180;
        const x = center + radius * Math.cos(rad);
        const y = center + radius * Math.sin(rad);

        list.push({
          id: vnodeKey,
          nodeId,
          hash,
          angle,
          x,
          y,
          color: isFailed ? "#cbd5e1" : theme.bg,
          isFailed,
        });
      }
    });

    return list.sort((a, b) => a.hash - b.hash);
  }, [nodes, center, radius, maxHash]);

  const activeKeyPos = useMemo(() => {
    if (!activeKey) return null;
    const hash = fnv32a(activeKey);
    const angle = (hash / maxHash) * 360;
    const rad = ((angle - 90) * Math.PI) / 180;
    const x = center + radius * Math.cos(rad);
    const y = center + radius * Math.sin(rad);
    return { hash, angle, x, y };
  }, [activeKey, center, radius, maxHash]);

  const aliveCount = Object.values(nodes).filter((n) => n?.state === "ALIVE").length;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Background Circle */}
        <circle cx={center} cy={center} r={radius + 20} fill="#f7faf5" stroke="#d8e8d5" strokeWidth="1.5" />

        {/* Ring Orbit Track */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="#BADBA2"
          strokeWidth="3.5"
          strokeDasharray="4 4"
        />

        {/* Center Hub */}
        <circle cx={center} cy={center} r={radius - 42} fill="#ffffff" stroke="#d8e8d5" strokeWidth="1.5" />

        {/* Center Labels */}
        <text
          x={center}
          y={center - 14}
          textAnchor="middle"
          fill="#718d79"
          fontSize="9"
          fontWeight="700"
          fontFamily="var(--font-mono)"
          letterSpacing="0.05em"
        >
          9-NODE HASH RING
        </text>
        <text
          x={center}
          y={center + 6}
          textAnchor="middle"
          fill="#172a1e"
          fontSize="14"
          fontWeight="800"
          fontFamily="var(--font-mono)"
        >
          {aliveCount}/{Object.keys(nodes).length} ACTIVE
        </text>
        <text
          x={center}
          y={center + 24}
          textAnchor="middle"
          fill="#22a34f"
          fontSize="8.5"
          fontWeight="700"
          fontFamily="var(--font-mono)"
        >
          2^32 KEYSPACE (FNV-1A)
        </text>

        {/* Virtual Node Points */}
        {vnodes.map((v) => (
          <circle
            key={v.id}
            cx={v.x}
            cy={v.y}
            r={v.isFailed ? 2.5 : 4.5}
            fill={v.color}
            stroke="#ffffff"
            strokeWidth="1.5"
          >
            <title>{`${v.nodeId} (Hash: ${v.hash})`}</title>
          </circle>
        ))}

        {/* Active Key Marker */}
        {activeKeyPos && (
          <g>
            <line
              x1={center}
              y1={center}
              x2={activeKeyPos.x}
              y2={activeKeyPos.y}
              stroke="#e11d48"
              strokeWidth="2"
              strokeDasharray="3 3"
            />
            <circle
              cx={activeKeyPos.x}
              cy={activeKeyPos.y}
              r="8"
              fill="#e11d48"
              stroke="#ffffff"
              strokeWidth="2"
            />
            <circle
              cx={activeKeyPos.x}
              cy={activeKeyPos.y}
              r="3"
              fill="#ffffff"
            />
          </g>
        )}
      </svg>

      {/* 9-Node Legend Grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: "6px",
          marginTop: "10px",
          width: "100%",
        }}
      >
        {Object.entries(nodes).map(([id, info]) => {
          const theme = NODE_THEME[id] || { bg: "#BADBA2", text: "#000" };
          const isFailed = info?.state === "FAILED";
          return (
            <div
              key={id}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "4px 7px",
                borderRadius: "6px",
                background: isFailed ? "#f1f5f9" : theme.bg,
                color: isFailed ? "#94a3b8" : theme.text,
                border: "1px solid rgba(0,0,0,0.06)",
                fontFamily: "var(--font-mono)",
                fontSize: "0.68rem",
                fontWeight: "700",
                opacity: isFailed ? 0.6 : 1,
              }}
            >
              <span>{id.toUpperCase()}</span>
              <span style={{ fontSize: "0.60rem" }}>[{isFailed ? "FAIL" : "UP"}]</span>
            </div>
          );
        })}
      </div>

      {activeKey && (
        <div
          style={{
            marginTop: "10px",
            fontSize: "0.74rem",
            background: "#f7faf5",
            border: "1px solid #d8e8d5",
            borderRadius: "6px",
            padding: "5px 9px",
            fontFamily: "var(--font-mono)",
            fontWeight: "600",
            width: "100%",
            textAlign: "center",
            color: "#172a1e",
          }}
        >
          Key: <strong style={{ color: "#22a34f" }}>{activeKey}</strong> | Hash: <strong>{activeKeyPos?.hash}</strong>
          {keyLocation?.primary_node && (
            <span> | Primary: <strong style={{ color: "#e11d48" }}>{keyLocation.primary_node}</strong></span>
          )}
        </div>
      )}
    </div>
  );
}
