import { exec } from "child_process";
import path from "path";
import { NextResponse } from "next/server";

const NODE_CONFIGS = {
  "node-a": { port: 8001, id: "node-a" },
  "node-b": { port: 8002, id: "node-b" },
  "node-c": { port: 8003, id: "node-c" },
  "node-d": { port: 8004, id: "node-d" },
  "node-e": { port: 8005, id: "node-e" },
  "node-f": { port: 8006, id: "node-f" },
  "node-g": { port: 8007, id: "node-g" },
  "node-h": { port: 8008, id: "node-h" },
  "node-i": { port: 8009, id: "node-i" },
};

function generatePeers(selfId) {
  return Object.entries(NODE_CONFIGS)
    .filter(([id]) => id !== selfId)
    .map(([id, conf]) => `${id}=http://localhost:${conf.port}`)
    .join(",");
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { action, nodeId, port, state } = body;
    const rootDir = path.resolve(process.cwd(), "..");

    // 1. Soft Manual State Override (Memory Level Fail / Revive)
    if (action === "override_state") {
      try {
        const gwRes = await fetch("http://127.0.0.1:8000/api/node/state", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ node_id: nodeId, state: state || "FAILED" }),
        });
        const gwData = await gwRes.json();
        return NextResponse.json({ success: true, action: "override_state", data: gwData });
      } catch (err) {
        return NextResponse.json({ error: "Failed to communicate with gateway router: " + err.message }, { status: 502 });
      }
    }

    // 2. Physical Process Kill
    if (action === "kill") {
      const target = nodeId || `node-${port}`;
      return new Promise((resolve) => {
        exec(
          `powershell.exe -ExecutionPolicy Bypass -File "${path.join(rootDir, "kill_node.ps1")}" ${target}`,
          async (error, stdout, stderr) => {
            // Also notify gateway of failure immediately
            try {
              await fetch("http://127.0.0.1:8000/api/node/state", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ node_id: nodeId, state: "FAILED" }),
              }).catch(() => {});
            } catch {}

            resolve(
              NextResponse.json({
                success: !error,
                action: "kill",
                target,
                output: stdout || stderr,
              })
            );
          }
        );
      });
    }

    // 3. Physical Process Start
    if (action === "start") {
      const conf = NODE_CONFIGS[nodeId];
      if (!conf) {
        return NextResponse.json({ error: `Unknown node ${nodeId}` }, { status: 400 });
      }

      const peers = generatePeers(nodeId);
      const args = `-id ${conf.id} -port ${conf.port} -peers ${peers}`;
      const nodeBin = path.join(rootDir, "backend", "cachenode.exe");

      exec(`powershell.exe -Command "Start-Process -FilePath '${nodeBin}' -ArgumentList '${args}' -WindowStyle Hidden"`);

      // Notify gateway of node recovery
      setTimeout(async () => {
        try {
          await fetch("http://127.0.0.1:8000/api/node/state", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ node_id: nodeId, state: "ALIVE" }),
          }).catch(() => {});
        } catch {}
      }, 500);

      return NextResponse.json({
        success: true,
        action: "start",
        nodeId,
        message: `Node ${nodeId} started on port :${conf.port}`,
      });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
