import { NextResponse } from "next/server";

const ALL_NODES = [
  { id: "node-a", port: 8001 },
  { id: "node-b", port: 8002 },
  { id: "node-c", port: 8003 },
  { id: "node-d", port: 8004 },
  { id: "node-e", port: 8005 },
  { id: "node-f", port: 8006 },
  { id: "node-g", port: 8007 },
  { id: "node-h", port: 8008 },
  { id: "node-i", port: 8009 },
];

export async function GET() {
  let clusterData = null;
  const nodeStats = {};
  let hotKeys = [];

  // 1. Fetch gateway cluster overview safely
  try {
    const gwRes = await fetch("http://127.0.0.1:8000/api/cluster", {
      signal: AbortSignal.timeout(600),
      cache: "no-store",
    });
    if (gwRes.ok) {
      clusterData = await gwRes.json();
    }
  } catch {
    // Gateway is starting up or offline
    clusterData = null;
  }

  // 2. Fetch stats for nodes in parallel without logging proxy errors
  await Promise.all(
    ALL_NODES.map(async (node) => {
      try {
        const statsRes = await fetch(`http://127.0.0.1:${node.port}/stats`, {
          signal: AbortSignal.timeout(300),
          cache: "no-store",
        });
        if (statsRes.ok) {
          nodeStats[node.id] = await statsRes.json();
        }

        const hkRes = await fetch(`http://127.0.0.1:${node.port}/hotkeys`, {
          signal: AbortSignal.timeout(300),
          cache: "no-store",
        });
        if (hkRes.ok) {
          const hkData = await hkRes.json();
          if (hkData.hot_keys) {
            hotKeys = [...hotKeys, ...hkData.hot_keys];
          }
        }
      } catch {
        // Node is offline/failed - expected during chaos and startup
        nodeStats[node.id] = { state: "FAILED", primary_keys: 0, replica_keys: 0, hit_count: 0 };
      }
    })
  );

  return NextResponse.json({
    status: "ok",
    cluster: clusterData,
    nodeStats,
    hotKeys,
  });
}
