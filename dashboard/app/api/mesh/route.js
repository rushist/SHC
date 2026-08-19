import { NextResponse } from "next/server";

export async function GET() {
  let clusterData = null;
  const nodeStats = {};
  let hotKeys = [];

  const routerUrl = process.env.ROUTER_URL || "http://127.0.0.1:8000";
  const hosts = [routerUrl, "http://shc-gateway-router:8000", "http://gateway-router:8000", "http://10.0.1.10:8000", "http://127.0.0.1:8000", "http://localhost:8000"];

  // 1. Fetch gateway cluster overview safely
  for (const host of hosts) {
    if (!host) continue;
    try {
      const gwRes = await fetch(`${host}/api/cluster`, {
        signal: AbortSignal.timeout(800),
        cache: "no-store",
      });
      if (gwRes.ok) {
        clusterData = await gwRes.json();
        break;
      }
    } catch {}
  }

  // 2. Extract node stats from cluster members
  if (clusterData && clusterData.members) {
    for (const [nodeId, member] of Object.entries(clusterData.members)) {
      nodeStats[nodeId] = {
        state: member.state || "ALIVE",
        primary_keys: member.primary_keys || 0,
        replica_keys: member.replica_keys || 0,
        hit_count: member.hit_count || 0,
      };
    }
  }

  return NextResponse.json({
    status: "ok",
    cluster: clusterData,
    nodeStats,
    hotKeys,
  });
}
