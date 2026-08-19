"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import OptionWheel from "../components/OptionWheel";

const SECTIONS = [
  { id: "section-sdks", label: "1-File Client SDKs" },
  { id: "section-docker", label: "Docker Sidecar Setup" },
  { id: "section-api", label: "REST API Reference" },
  { id: "section-invariants", label: "Architecture Invariants" },
];

const CODE_EXAMPLES = {
  python: `# SHC Client for Python (FastAPI, Flask, Django, Data Pipelines)
# Zero external dependencies (uses standard requests)
import requests

class SHC:
    def __init__(self, host="http://13.127.44.111:8000"):
        self.host = host.rstrip("/")

    def get(self, key: str):
        """1.2ms RAM read (auto-hydrates from RDS PostgreSQL on cache miss)"""
        res = requests.get(f"{self.host}/api/get", params={"key": key}, timeout=1.5)
        return res.json() if res.status_code == 200 else None

    def set(self, key: str, value: str, ttl_seconds: int = 300):
        """Write-Through to cache ring and persistent database"""
        payload = {"key": key, "value": value, "ttl_seconds": ttl_seconds}
        res = requests.post(f"{self.host}/api/set", json=payload, timeout=1.5)
        return res.json()

    def evict(self, key: str):
        """Invalidates key from RAM cache (database row stays intact)"""
        res = requests.delete(f"{self.host}/api/delete", params={"key": key}, timeout=1.5)
        return res.json()

# --- Example Usage ---
cache = SHC("http://13.127.44.111:8000")

# 1. Write session
cache.set("session:user_101", '{"user_id": 101, "role": "admin"}', ttl_seconds=3600)

# 2. Fast 1.2ms Read
user_session = cache.get("session:user_101")
print("Session payload:", user_session["value"])
`,
  typescript: `// SHC Client for TypeScript / Node.js (Next.js, Express, NestJS)
// Zero external dependencies (uses standard fetch)

export class SHC {
  constructor(private host = "http://13.127.44.111:8000") {}

  /** 1.2ms RAM read (auto-hydrates from RDS on cache miss) */
  async get(key: string) {
    const res = await fetch(\`\${this.host}/api/get?key=\${encodeURIComponent(key)}\`);
    return res.ok ? await res.json() : null;
  }

  /** Write-Through to cache ring and persistent database */
  async set(key: string, value: string, ttlSeconds = 300) {
    const res = await fetch(\`\${this.host}/api/set\`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value, ttl_seconds: ttlSeconds }),
    });
    return await res.json();
  }

  /** Invalidates key from RAM cache (keeps database row intact) */
  async evict(key: string) {
    const res = await fetch(\`\${this.host}/api/delete?key=\${encodeURIComponent(key)}\`, {
      method: "DELETE",
    });
    return await res.json();
  }
}

// --- Example Usage ---
const cache = new SHC("http://13.127.44.111:8000");

// Write
await cache.set("order:4021", JSON.stringify({ id: 4021, amount: 245.50 }));

// Read
const order = await cache.get("order:4021");
console.log("Cached Order:", order.value);
`,
  go: `// SHC Client for Go Microservices (Zero third-party dependencies)
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

type SHC struct {
	host       string
	httpClient *http.Client
}

func NewSHC(host string) *SHC {
	return &SHC{
		host:       host,
		httpClient: &http.Client{Timeout: 1500 * time.Millisecond},
	}
}

type SetPayload struct {
	Key        string \`json:"key"\`
	Value      string \`json:"value"\`
	TTLSeconds int    \`json:"ttl_seconds"\`
}

func (c *SHC) Set(ctx context.Context, key, value string, ttlSeconds int) error {
	body, _ := json.Marshal(SetPayload{Key: key, Value: value, TTLSeconds: ttlSeconds})
	req, _ := http.NewRequestWithContext(ctx, "POST", fmt.Sprintf("%s/api/set", c.host), bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	return nil
}

func (c *SHC) Get(ctx context.Context, key string) (string, error) {
	req, _ := http.NewRequestWithContext(ctx, "GET", fmt.Sprintf("%s/api/get?key=%s", c.host, key), nil)
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	return "value", nil
}
`,
  docker: `# docker-compose.yml — Sidecar Integration
# Add this service definition to any existing application compose file

services:
  # Your existing web application
  my-app:
    image: my-app:latest
    environment:
      - CACHE_HOST=http://shc-gateway:8000
    depends_on:
      - shc-gateway

  # SHC Unified Gateway Router Sidecar
  shc-gateway:
    image: shc/backend:latest
    container_name: shc-gateway-router
    entrypoint: ["/app/router"]
    restart: unless-stopped
    environment:
      - ROUTER_PORT=8000
      - ROUTER_HOST=0.0.0.0
      - GATEWAY_NODES=node-a=http://10.0.1.10:8001,node-b=http://10.0.1.11:8001,node-c=http://10.0.1.13:8001
      - DATABASE_URL=\${DATABASE_URL}
      - HEARTBEAT_INTERVAL=500ms
      - SUSPECT_TIMEOUT=1s
      - FAIL_TIMEOUT=2s
    ports:
      - "8000:8000"
`,
};

export default function DocsPage() {
  const [mounted, setMounted] = useState(false);
  const [activeSectionIndex, setActiveSectionIndex] = useState(0);
  const [sdkLanguage, setSdkLanguage] = useState("python");
  const [copiedKey, setCopiedKey] = useState(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleCopy = (key, text) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const isScrollingRef = React.useRef(false);

  const scrollToSection = (index) => {
    setActiveSectionIndex(index);
    const sec = SECTIONS[index];
    if (!sec) return;
    const target = document.getElementById(sec.id);
    if (target) {
      isScrollingRef.current = true;
      const rect = target.getBoundingClientRect();
      const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
      const topOffset = rect.top + scrollTop - 80;
      window.scrollTo({
        top: Math.max(0, topOffset),
        behavior: "smooth",
      });
      setTimeout(() => {
        isScrollingRef.current = false;
      }, 750);
    }
  };

  // Observe scrolling to highlight active section in the sidebar
  useEffect(() => {
    if (!mounted) return;
    const handleScroll = () => {
      if (isScrollingRef.current) return;
      const scrollPos = (window.pageYOffset || document.documentElement.scrollTop) + 160;
      for (let i = SECTIONS.length - 1; i >= 0; i--) {
        const el = document.getElementById(SECTIONS[i].id);
        if (el) {
          const rect = el.getBoundingClientRect();
          const elTop = rect.top + (window.pageYOffset || document.documentElement.scrollTop);
          if (elTop <= scrollPos) {
            setActiveSectionIndex(i);
            break;
          }
        }
      }
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [mounted]);

  if (!mounted) {
    return (
      <div suppressHydrationWarning style={{ minHeight: "100vh", backgroundColor: "var(--bg-canvas)", color: "var(--text-primary)", padding: "24px" }}>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.85rem", color: "var(--text-muted)" }}>
          Loading Documentation...
        </div>
      </div>
    );
  }

  return (
    <div suppressHydrationWarning style={{ minHeight: "100vh", backgroundColor: "var(--bg-canvas)", color: "var(--text-primary)" }}>
      {/* Top Navigation Header matching Cluster Console */}
      <header className="system-header">
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
            <div style={{ color: "#ff9900", fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
              AWS / EC2 / Integration
            </div>
            <div style={{ fontSize: "0.95rem", fontWeight: 700, letterSpacing: "-0.01em" }}>
              SHC / Developer Integration Guide
            </div>
            <div style={{ fontSize: "0.72rem", color: "#c9d1d9", fontFamily: "var(--font-mono)" }}>
              HTTP Gateway Router & Client SDK Specifications
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          {/* <div className="status-pill status-pill-alive">
            Gateway :8000 Active
          </div> */}
          <Link href="/" className="sys-btn sys-btn-sm sys-btn-primary">
            ← Return to Cluster Console
          </Link>
        </div>
      </header>

      {/* Main Layout Container */}
      <div style={{ display: "flex", width: "100%", minHeight: "calc(100vh - 60px)" }}>
        {/* Left Column: Fixed Sidebar */}
        <aside
          style={{
            position: "fixed",
            top: "60px",
            left: 0,
            bottom: 0,
            width: "280px",
            padding: "36px 28px",
            borderRight: "1px solid var(--border-default)",
            background: "var(--bg-canvas)",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            zIndex: 40,
          }}
        >
          <div>
            {/* <div style={{ fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "16px", fontFamily: "var(--font-mono)" }}>
              Table of Contents
            </div> */}

            <OptionWheel
              items={SECTIONS.map((s) => s.label)}
              defaultSelected={activeSectionIndex}
              onChange={(idx) => scrollToSection(idx)}
              fontSize={1.5}
              spacing={3}
              className="docs-option-wheel"
            />
          </div>

          {/* <div style={{ borderTop: "1px solid var(--border-default)", paddingTop: "16px", fontSize: "0.72rem", color: "var(--text-muted)", fontFamily: "var(--font-mono)", lineHeight: 1.7 }}>
            <div>Gateway: <strong>:8000</strong></div>
            <div>Topology: <strong>9 Nodes (3 EC2)</strong></div>
            <div>Database: <strong>RDS Postgres</strong></div>
          </div> */}
        </aside>

        {/* Right Column: Independently Scrolling Documentation Stream */}
        <main
          style={{
            marginLeft: "280px",
            width: "calc(100% - 280px)",
            padding: "36px 48px 80px 48px",
            display: "flex",
            flexDirection: "column",
            gap: "32px",
            maxWidth: "1160px",
          }}
        >
          {/* Section 1: 1-File SDKs */}
          <section id="section-sdks" className="sys-panel" style={{ scrollMarginTop: "80px" }}>
            <div className="sys-panel-header">
              <span className="sys-panel-title">Option 1: 1-File Drop-in Client (Zero Dependencies)</span>
              <div style={{ display: "flex", gap: "4px" }}>
                {["python", "typescript", "go"].map((lang) => (
                  <button
                    key={lang}
                    onClick={() => setSdkLanguage(lang)}
                    className={`sys-btn sys-btn-sm ${sdkLanguage === lang ? "sys-btn-primary" : ""}`}
                    style={{ textTransform: "capitalize" }}
                  >
                    {lang === "typescript" ? "TypeScript / Node" : lang}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ fontSize: "0.78rem", color: "var(--text-secondary)", marginBottom: "12px" }}>
              Copy and paste this single file directly into your application. It provides instant 1.2ms RAM reads, write-through persistence, and automatic cache-miss hydration without requiring any third-party packages.
            </div>

            {/* Code Container */}
            <div style={{ position: "relative" }}>
              <button
                onClick={() => handleCopy("sdk", CODE_EXAMPLES[sdkLanguage])}
                className="sys-btn sys-btn-sm"
                style={{ position: "absolute", top: "8px", right: "8px", zIndex: 10, background: "#1e293b", color: "#e2e8f0", borderColor: "#334155" }}
              >
                {copiedKey === "sdk" ? "✓ Copied" : "Copy Code"}
              </button>
              <pre
                style={{
                  background: "#0f172a",
                  color: "#e2e8f0",
                  padding: "16px",
                  borderRadius: "var(--radius-sm)",
                  fontFamily: "var(--font-mono)",
                  fontSize: "0.76rem",
                  lineHeight: 1.55,
                  overflowX: "auto",
                  maxHeight: "420px",
                }}
              >
                <code>{CODE_EXAMPLES[sdkLanguage]}</code>
              </pre>
            </div>
          </section>

          {/* Section 2: Docker Sidecar */}
          <section id="section-docker" className="sys-panel" style={{ scrollMarginTop: "80px" }}>
            <div className="sys-panel-header">
              <span className="sys-panel-title">Option 2: Docker Compose Sidecar Deployment</span>
              <button
                onClick={() => handleCopy("docker", CODE_EXAMPLES.docker)}
                className="sys-btn sys-btn-sm"
              >
                {copiedKey === "docker" ? "✓ Copied" : "Copy YAML"}
              </button>
            </div>

            <div style={{ fontSize: "0.78rem", color: "var(--text-secondary)", marginBottom: "12px" }}>
              Deploy the SHC Unified Router alongside your microservices in your existing <code>docker-compose.yml</code>. Any container on the same Docker bridge network can communicate with SHC via <code>http://shc-gateway:8000</code>.
            </div>

            <pre
              style={{
                background: "#0f172a",
                color: "#e2e8f0",
                padding: "16px",
                borderRadius: "var(--radius-sm)",
                fontFamily: "var(--font-mono)",
                fontSize: "0.76rem",
                lineHeight: 1.55,
                overflowX: "auto",
              }}
            >
              <code>{CODE_EXAMPLES.docker}</code>
            </pre>
          </section>

          {/* Section 3: REST API Reference */}
          <section id="section-api" className="sys-panel" style={{ scrollMarginTop: "80px" }}>
            <div className="sys-panel-header">
              <span className="sys-panel-title">Unified Gateway HTTP REST API Reference</span>
              <span style={{ fontSize: "0.72rem", fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
                Base URL: http://&lt;GATEWAY_IP&gt;:8000
              </span>
            </div>

            <div className="data-grid" style={{ gap: "12px" }}>
              {/* Endpoint 1 */}
              <div style={{ padding: "12px", background: "var(--bg-surface-subtle)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-default)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                  <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: "0.82rem" }}>
                    <span className="status-pill status-pill-alive" style={{ marginRight: "6px" }}>POST</span>
                    /api/set
                  </span>
                  <span style={{ fontSize: "0.70rem", color: "var(--text-muted)" }}>Write-Through Persistence</span>
                </div>
                <div style={{ fontSize: "0.76rem", color: "var(--text-secondary)", marginBottom: "6px" }}>
                  Stores key in the Primary node, replicates to the clockwise Replica node on a different EC2 machine, and updates Amazon RDS PostgreSQL.
                </div>
                <code style={{ fontSize: "0.72rem", background: "#0f172a", color: "#e2e8f0", padding: "6px 10px", borderRadius: "3px", display: "block" }}>
                  {`{"key": "trip:45210", "value": "{\\"fare_amount\\": 25.50}", "ttl_seconds": 300}`}
                </code>
              </div>

              {/* Endpoint 2 */}
              <div style={{ padding: "12px", background: "var(--bg-surface-subtle)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-default)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                  <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: "0.82rem" }}>
                    <span className="status-pill status-pill-alive" style={{ marginRight: "6px" }}>GET</span>
                    /api/get?key=&#123;key&#125;
                  </span>
                  <span style={{ fontSize: "0.70rem", color: "var(--text-muted)" }}>Fast RAM Read (~1.2ms)</span>
                </div>
                <div style={{ fontSize: "0.76rem", color: "var(--text-secondary)" }}>
                  Routes to the Primary node via consistent hashing. If the Primary is failed, routes instantly to the Replica node with zero downtime.
                </div>
              </div>

              {/* Endpoint 3 */}
              <div style={{ padding: "12px", background: "var(--bg-surface-subtle)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-default)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                  <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: "0.82rem" }}>
                    <span className="status-pill status-pill-failed" style={{ marginRight: "6px" }}>DELETE</span>
                    /api/delete?key=&#123;key&#125;
                  </span>
                  <span style={{ fontSize: "0.70rem", color: "var(--text-muted)" }}>Cache Eviction</span>
                </div>
                <div style={{ fontSize: "0.76rem", color: "var(--text-secondary)" }}>
                  Evicts key from Primary and Replica RAM caches while leaving the persistent database record intact for subsequent cache-aside testing.
                </div>
              </div>

              {/* Endpoint 4 */}
              <div style={{ padding: "12px", background: "var(--bg-surface-subtle)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-default)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                  <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: "0.82rem" }}>
                    <span className="status-pill status-pill-alive" style={{ marginRight: "6px" }}>GET</span>
                    /api/cluster
                  </span>
                  <span style={{ fontSize: "0.70rem", color: "var(--text-muted)" }}>Cluster Topology</span>
                </div>
                <div style={{ fontSize: "0.76rem", color: "var(--text-secondary)" }}>
                  Returns real-time health states, virtual token distribution, and key counters for all 9 cluster nodes.
                </div>
              </div>
            </div>
          </section>

          {/* Section 4: Architecture Invariants */}
          <section id="section-invariants" className="sys-panel" style={{ scrollMarginTop: "80px" }}>
            <div className="sys-panel-header">
              <span className="sys-panel-title">System Invariants & Mathematical Principles</span>
            </div>

            <div className="data-grid" style={{ gap: "8px" }}>
              <div className="data-row">
                <span className="data-label">Consistent Hash Ring</span>
                <span className="data-value">450 Virtual Tokens (50 VNodes/Node) using 32-bit FNV-1a</span>
              </div>
              <div className="data-row">
                <span className="data-label">Cross-Host Replication (R=2)</span>
                <span className="data-value">A→B (EC2-A to EC2-B), D→E (EC2-A to EC2-B), G→H (EC2-A to EC2-B)</span>
              </div>
              <div className="data-row">
                <span className="data-label">Heartbeat Failure Detection</span>
                <span className="data-value">500ms Interval, 1.0s Suspect Timeout, 2.0s Failover Trigger</span>
              </div>
              <div className="data-row">
                <span className="data-label">Database Persistence Tier</span>
                <span className="data-value">Amazon RDS for PostgreSQL (7.66M records, Write-Through updates)</span>
              </div>
              <div className="data-row">
                <span className="data-label">Mathematical Invariant Solver</span>
                <span className="data-value">Distance, Base Fare, Gratuity, and Total Amount recalculate synchronously</span>
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
