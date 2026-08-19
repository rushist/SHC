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

export default function HashRing({ nodes = {}, activeKey = "", keyLocation = null }) {
  const size = 300;
  const center = size / 2;
  const radius = 105;
  const maxHash = 4294967295;

  const vnodes = useMemo(() => {
    const list = [];
    const nodeEntries = Object.entries(nodes);

    nodeEntries.forEach(([nodeId, info]) => {
      const isFailed = info?.state === "FAILED";
      
      // 8 sample virtual tokens per node for clean visual mapping
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
          color: isFailed ? "#cbd5e1" : "#166534",
          isFailed,
        });
      }
    });

    return list.sort((a, b) => a.angle - b.angle);
  }, [nodes, center, radius, maxHash]);

  const keyPos = useMemo(() => {
    if (!activeKey) return null;
    const hash = fnv32a(activeKey);
    const angle = (hash / maxHash) * 360;
    const rad = ((angle - 90) * Math.PI) / 180;
    return {
      hash,
      angle,
      x: center + radius * Math.cos(rad),
      y: center + radius * Math.sin(rad),
    };
  }, [activeKey, center, radius, maxHash]);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <div style={{ position: "relative", width: size, height: size }}>
        <svg width={size} height={size}>
          {/* Main Hash Ring Perimeter */}
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke="#e2e8f0"
            strokeWidth="2"
            strokeDasharray="4 4"
          />

          {/* Virtual Node Points */}
          {vnodes.map((v) => (
            <circle
              key={v.id}
              cx={v.x}
              cy={v.y}
              r={v.isFailed ? 2.5 : 3.5}
              fill={v.color}
              opacity={v.isFailed ? 0.35 : 0.85}
            />
          ))}

          {/* Active Key Routing Marker */}
          {keyPos && (
            <g>
              <line
                x1={center}
                y1={center}
                x2={keyPos.x}
                y2={keyPos.y}
                stroke="#0f172a"
                strokeWidth="1.5"
                strokeDasharray="2 2"
              />
              <circle
                cx={keyPos.x}
                cy={keyPos.y}
                r={5.5}
                fill="#0f172a"
                stroke="#ffffff"
                strokeWidth="1.5"
              />
            </g>
          )}
        </svg>

        {/* Center Ring Telemetry */}
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            textAlign: "center",
            pointerEvents: "none",
          }}
        >
          <div style={{ fontSize: "0.68rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
            Hash Ring
          </div>
          <div style={{ fontSize: "0.95rem", fontWeight: 700, fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
            450 VNodes
          </div>
          {keyLocation?.primary_node && (
            <div style={{ fontSize: "0.68rem", fontFamily: "var(--font-mono)", color: "var(--status-alive-text)", marginTop: "2px" }}>
              Mapped: {keyLocation.primary_node}
            </div>
          )}
        </div>
      </div>

      {keyPos && (
        <div style={{ marginTop: "4px", fontSize: "0.72rem", fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
          Key: <span style={{ color: "var(--text-primary)" }}>{activeKey}</span> | FNV Hash: <span style={{ color: "var(--text-primary)" }}>{keyPos.hash}</span>
        </div>
      )}
    </div>
  );
}
