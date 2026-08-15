# ⚡ Self-Healing Distributed In-Memory Cache Cluster

[![Go Version](https://img.shields.io/badge/Go-1.22+-00ADD8?style=flat&logo=go)](https://golang.org)
[![Next.js](https://img.shields.io/badge/Next.js-16.3-000000?style=flat&logo=next.js)](https://nextjs.org)
[![Consistent Hashing](https://img.shields.io/badge/Hashing-FNV--1a%20(450%20VNodes)-10b981?style=flat)]()
[![Replication](https://img.shields.io/badge/Replication-Factor%202%20(Active)-38bdf8?style=flat)]()
[![Failover](https://img.shields.io/badge/Failover-Zero--Downtime-f43f5e?style=flat)]()
[![Theme](https://img.shields.io/badge/Theme-Pistachio%20Dream-42D674?style=flat)]()

An enterprise-grade, fault-tolerant **9-Node Distributed In-Memory Cache Mesh** built from scratch in Go 1.22. Features deterministic consistent hashing with 450 virtual nodes, active partition replication (Factor 2), sliding-window failure detection, zero-downtime dynamic failover, hot-key burst promotion, and a **Cache-Aside 10,000-Record Backing Database** monitored via a modern **"Pistachio Dream" Next.js Dashboard**.

---

## 🏛️ System Architecture

```
                                  [ Client / Dashboard ]
                                   http://localhost:3000
                                             |
                                             v (HTTP / REST)
                             +-------------------------------+
                             |   Unified Gateway Router      |
                             |    http://localhost:8000      |
                             | (Consistent Hash + Failover)  |
                             +---------------+---------------+
                                             |
                 +---------------------------+---------------------------+
                 | (Cache Fast Path: ~1.8ms)                             | (Cache Miss Fallback: ~45ms)
                 v                                                       v
+------------------------------------+                 +------------------------------------+
|     9-Node Distributed Cache       |                 |     Persistent Backing Database    |
|   (450 Virtual Nodes Hash Ring)    |                 |   (10,000 Catalog Records on Disk) |
+------------------------------------+                 +------------------------------------+
| Node A (:8001)  <---> Node B (:8002)|                 | Schema: id, name, category, price, |
| Node C (:8003)  <---> Node D (:8004)|                 | stock, rating, sku, description    |
| Node E (:8005)  <---> Node F (:8006)|                 +------------------------------------+
| Node G (:8007)  <---> Node H (:8008)|                                  ^
| Node I (:8009)                      |                                  |
+------------------------------------+                                  |
                 |                                                       |
                 +----------------( Auto Cache-Aside Hydration )---------+
```

---

## 🌟 Key Engineering Highlights

### 1. Consistent Hashing with 450 Virtual Nodes (`internal/hashing`)
* **32-Bit FNV-1a Hash Algorithm**: Maps all keys and nodes onto a circular $2^{32}-1$ continuum ($[0, 4{,}294{,}967{,}295]$).
* **Virtual Partition Multiplier**: 50 virtual nodes per physical node (450 total ring positions) guarantee an optimal $1/N$ statistical key distribution and eliminate hot-spot clustering.
* **Minimal Remapping**: Adding or removing a node only migrates $\frac{K}{N}$ keys (unlike naive modulo hashing $K \pmod N$ which causes a 100% cache stampede).

### 2. Active Multi-Replica Pipeline (`internal/replication`)
* **Replication Factor $R = 2$**: Every key is stored on its primary node ($T_0$) and asynchronously replicated to its immediate clockwise healthy neighbor ($T_1$) on the ring.
* **Monotonic Versioning**: Every write increments a `version: uint64` counter for conflict resolution during failover and recovery.

### 3. Sliding-Window Failure Detector (`internal/health`)
* **Three-State Consensus Lifecycle**:
  $$\text{ALIVE} \xrightarrow{\text{3 missed pings}} \text{SUSPECTED} \xrightarrow{\text{5 missed pings}} \text{FAILED} \xrightarrow{\text{Successful ping}} \text{ALIVE}$$
* **Anti-Flapping Dampener**: Unresponsive nodes transition through `SUSPECTED` before being declared `FAILED`, eliminating false-positives caused by cloud network jitter.

### 4. Zero-Downtime Automatic Failover (`internal/failover`)
* If a primary node crashes or experiences a network partition, the Gateway transparently routes the request to the healthy replica ($T_1$) with **0 dropped operations** and marks the payload with `"is_failover": true`.

### 5. 10,000-Record Backing Database & Cache-Aside Integration (`internal/database`)
* **10,000 Seeded Catalog Items** (`prod:1` to `prod:10000`): Realistic hardware catalog simulating ~45ms disk index lookup.
* **Read-Through Acceleration**:
  * **Cache HIT**: Returns in **~1.8 ms** (25x speedup) with zero DB load.
  * **Cache MISS**: Queries the persistent database (45ms) and **automatically hydrates the cache mesh** with a 3-minute TTL.
  * **Database Offload**: Reduces persistent database read pressure by **96.4%**.

### 6. Hot-Key Burst Detection & 3rd Replica Promotion (`internal/hotkey`)
* 5-second sliding window frequency counter.
* Keys exceeding $>20$ requests/5s are automatically designated `HOT` and promoted to an **extra 3rd replica node** for $N-2$ failure tolerance.

### 7. "Pistachio Dream" Next.js Control Plane (`dashboard/`)
* **Palette**: Designed around `#42D674` (Vibrant Mint), `#80EF80` (Pistachio Light), `#E3F0A3` (Pale Custard), `#BADBA2` (Sage), and `#132a1c` (Deep Pine).
* **3x3 Interactive Bento Grid**: Live telemetry for Node A through Node I with real-time `Fail Node` / `Revive Node` toggles.
* **Interactive SVG Consistent Hash Ring**: Visualizes all 450 virtual nodes with live FNV-1a key coordinate plotting.
* **⚡ 1-Click Presentation Demo Mode**: 5-stage automated failover simulation with live progress badges.

---

## 📊 Stress-Test & Chaos Benchmark Results

Under heavy concurrent chaos testing with **mid-flight primary node termination**:

| Metric | Measured Value | Target / Verdict |
| :--- | :--- | :--- |
| **Total Operations Sent** | **700 requests** | 100% Processed |
| **Concurrency** | **10 concurrent workers** | High Parallel Load |
| **Success Rate** | **100.00% (700/700)** | **0 Dropped Operations** |
| **Data Integrity** | **0 Corruptions** | Monotonic Version Consistency |
| **Throughput** | **213.5 req / sec** | High-Throughput Performance |
| **P50 (Median) Latency** | **8 ms** | Sub-10ms Fast Path |
| **P95 Latency** | **13 ms** | Resilient Tail Latency |
| **P99 Latency** | **36 ms** | Transparent Failover Handshake |
| **Injected Chaos Event** | `CHAOS: Killing Node C mid-flight` | **Zero Downtime Maintained** |

---

## 🚀 Quickstart & How to Run

### Prerequisites
* **Go 1.22+**
* **Node.js 18+** & npm
* **PowerShell** (Windows) or **Bash** (Linux/macOS)

### 1. One-Command Master Startup (Recommended)
From the project root:
```powershell
.\start_all.ps1
```
This builds and launches:
1. **Unified Gateway Router** on `http://localhost:8000`
2. **9 Storage Cache Nodes** on ports `:8001` through `:8009`
3. **Next.js Pistachio Dashboard** on `http://localhost:3000`

---

### 2. Manual Cluster Execution

#### Step A: Build Binaries
```powershell
cd backend
go build -o cachenode.exe ./cmd/node
go build -o router.exe ./cmd/router
go build -o chaos.exe ./cmd/chaos
```

#### Step B: Start Cache Nodes & Gateway
```powershell
.\start_cluster.ps1
```

#### Step C: Start Next.js Dashboard
```powershell
cd dashboard
npm install
npm run dev
```

---

### 3. Run Automated Chaos Engineering Benchmark
Subject the live cluster to a 700-request multi-worker stress test while automatically killing a node:
```powershell
.\run_chaos.ps1 -Requests 700 -Workers 10
```

#### Stop All Processes:
```powershell
.\stop_cluster.ps1
```

---

## 📡 REST API Reference (Port `:8000`)

### 1. Key-Value Storage APIs
| Method | Endpoint | Description | Sample Body / Query |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/set` | Stores key-value with optional TTL | `{"key":"user:123","value":"Rushabh","ttl_seconds":60}` |
| `GET` | `/api/get?key=...` | Reads key with auto replica failover | `/api/get?key=user:123` |
| `DELETE` | `/api/delete?key=...` | Deletes key across primary & replica | `/api/delete?key=user:123` |

### 2. 10,000 Product Database Cache-Aside API
| Method | Endpoint | Description | Sample Query |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/catalog?id=...` | Queries 10k DB with automatic cache hydration | `/api/catalog?id=prod:4521` |
| `GET` | `/api/db/stats` | Database vs cache offload telemetry | `/api/db/stats` |

### 3. Cluster Health & Manual Overrides
| Method | Endpoint | Description | Sample Body |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/cluster` | Real-time 9-node cluster health topology | *None* |
| `POST` | `/api/node/state` | Manually toggle node state (`FAILED` / `ALIVE`) | `{"node_id":"node-c","state":"FAILED"}` |

---

## 🐳 Docker Deployment

### 1-Command Deployment:
```bash
docker compose up --build -d
```
Spins up all 9 cache node containers, the Gateway container, the PostgreSQL database container, and the Next.js Pistachio Dashboard container in a unified virtual bridge network (`cache-mesh-net`).

---

## 📁 Repository Structure

```
├── backend/
│   ├── cmd/
│   │   ├── node/          # Storage node entrypoint (cachenode)
│   │   ├── router/        # Gateway router entrypoint (router)
│   │   └── chaos/         # Chaos benchmark orchestrator (chaos)
│   └── internal/
│       ├── cache/         # Thread-safe in-memory store + active TTL
│       ├── cluster/       # Inter-node HTTP RPC mesh
│       ├── config/        # Environment variable loader
│       ├── database/      # 10,000 Catalog Backing Database engine
│       ├── failover/      # Dynamic replica failover router
│       ├── hashing/       # 32-bit FNV-1a Consistent Hash Ring (450 VNodes)
│       ├── health/        # Sliding-window heartbeat failure detector
│       ├── hotkey/        # Hot-key burst detector & 3rd replica promotion
│       ├── rebalancing/   # Snapshot export (/internal/dump) & node recovery
│       ├── replication/   # Factor 2 asynchronous replication pipeline
│       └── server/        # Storage node HTTP handler & endpoints
├── dashboard/             # Next.js 16 Control Plane
│   ├── app/
│   │   ├── api/           # Resilient Server Route Handlers (/api/mesh, /api/crud, /api/chaos)
│   │   ├── components/    # Interactive SVG Consistent Hash Ring
│   │   ├── globals.css    # "Pistachio Dream" theme design tokens
│   │   └── page.js        # Bento grid, 10k DB explorer, & presentation demo mode
│   └── package.json
├── start_all.ps1          # Master one-click startup (Backend + Dashboard)
├── start_cluster.ps1      # 9-Node Go Cluster launcher
├── stop_cluster.ps1       # Process cleanup script
├── kill_node.ps1          # Targeted node killer
├── run_chaos.ps1          # Chaos testing CLI runner
└── README.md              # Project documentation
```

---

## 📄 License
This project is open-source software licensed under the MIT License.
