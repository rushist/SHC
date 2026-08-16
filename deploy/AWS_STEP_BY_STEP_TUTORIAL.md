# 🚀 AWS Step-by-Step Production Deployment Tutorial: SHC Distributed Cache

Complete step-by-step operational guide to deploy the **SHC (Self-Healing Distributed Cache)** on **Amazon Web Services (AWS)** using **3 physical EC2 instances**, **Amazon RDS for PostgreSQL**, and **Docker**.

---

## 📐 Final AWS Prototype Topology

```
                                      [ INTERNET / USERS ]
                                                |
                             +------------------+------------------+
                             | (Public Subnet: 10.0.1.0/24)        |
                             |   Dashboard Host (:3000)            |
                             |   Gateway Router Host (:8000)       |
                             +------------------+------------------+
                                                |
         +--------------------------------------+--------------------------------------+
         | (Private VPC Subnet: Ports 8001-8003 Restricted to Nodes)                   |
         v                                      v                                      v
+------------------+                   +------------------+                   +------------------+
|      EC2 - A     |                   |      EC2 - B     |                   |      EC2 - C     |
| (IP: 10.0.1.10)  | <===============> | (IP: 10.0.1.11)  | <===============> | (IP: 10.0.1.12)  |
+------------------+                   +------------------+                   +------------------+
| Node A (:8001)   | ── Replicates ──> | Node B (:8001)   | ── Replicates ──> | Node C (:8001)   | ──┐
| Node D (:8002)   | ── Replicates ──> | Node E (:8002)   | ── Replicates ──> | Node F (:8002)   | ──┼─┐
| Node G (:8003)   | ── Replicates ──> | Node H (:8003)   | ── Replicates ──> | Node I (:8003)   | ──┼─┼─┐
+------------------+                   +------------------+                   +------------------+ │ │ │
         ^                                                                                         │ │ │
         └───────────────────────────── Replicates to Node D ──────────────────────────────────────┘ │ │
         └───────────────────────────── Replicates to Node G ────────────────────────────────────────┘ │
         └───────────────────────────── Replicates to Node A ──────────────────────────────────────────┘
         \                                      |                                      /
          \                                     |                                     /
           +------------------------------------+------------------------------------+
                                                | (Private Port 5432)
                                                v
                             +-------------------------------------+
                             |      Amazon RDS for PostgreSQL      |
                             |       (trips persistent table)      |
                             +-------------------------------------+
```

---

## 🛠️ Step 1: AWS VPC & Networking Setup

### 1.1 Create VPC
1. Open AWS Management Console $\to$ **VPC** $\to$ **Create VPC**.
2. Name: `shc-vpc`
3. IPv4 CIDR block: `10.0.0.0/16`

### 1.2 Create Subnets (Mumbai AZs)
* **Public Subnet (Ingress / Gateway / Dashboard)**: `10.0.1.0/24` (Availability Zone: `ap-south-1a`)
* **Private Subnet 1 (Cache Nodes A, B, C & RDS)**: `10.0.2.0/24` (Availability Zone: `ap-south-1a`)
* **Private Subnet 2 (RDS Multi-AZ Group Requirement)**: `10.0.3.0/24` (Availability Zone: `ap-south-1b`)

### 1.3 Internet Gateway & Routing
1. Create Internet Gateway `shc-igw` $\to$ Attach to `shc-vpc`.
2. On the Public Subnet Route Table, add route: `0.0.0.0/0` $\to$ `shc-igw`.

---

## 🔒 Step 2: Security Groups (Principle of Least Privilege)

Create 3 distinct Security Groups:

### Security Group 1: `shc-public-sg` (Gateway Router & Dashboard)
| Type | Port | Source | Description |
|---|---|---|---|
| Inbound HTTP | `3000` | `0.0.0.0/0` | Next.js Dashboard UI |
| Inbound API | `8000` | `0.0.0.0/0` | Public Gateway Router |
| Inbound SSH | `22` | `Your-IP/32` | Administrative Access |

### Security Group 2: `shc-nodes-sg` (Cache Nodes A–I)
| Type | Port Range | Source | Description |
|---|---|---|---|
| Custom TCP | `8001 - 8003` | `sg-shc-nodes-sg` | Inter-node replication & sync |
| Custom TCP | `8001 - 8003` | `sg-shc-public-sg` | Gateway Router reads & writes |
| Inbound SSH | `22` | `sg-shc-public-sg` or `Your-IP` | Bastion access |

### Security Group 3: `shc-rds-sg` (Amazon RDS PostgreSQL)
| Type | Port | Source | Description |
|---|---|---|---|
| PostgreSQL | `5432` | `sg-shc-public-sg` | **ONLY** Gateway Router can query DB |

---

## 🐘 Step 3: Launch Amazon RDS for PostgreSQL

1. Go to **RDS** $\to$ **Databases** $\to$ **Create Database**.
2. **Engine**: PostgreSQL (Version 15 or 16).
3. **Template**: Free Tier (or Dev/Test).
4. **Settings**:
   - DB instance identifier: `shc-postgres`
   - Master username: `postgres`
   - Master password: `YourStrongPassword123!`
5. **Instance Class**: `db.t4g.micro` (or `db.t3.micro`).
6. **Connectivity**:
   - Virtual Private Cloud (VPC): `shc-vpc`
   - Existing VPC Security Groups: Select `shc-rds-sg`
   - Initial database name: `shc_db`
7. Click **Create Database**.
8. Once available, copy the **Endpoint** (e.g. `shc-postgres.cxxxxxx.ap-south-1.rds.amazonaws.com`).

---

## 📊 Step 4: Import NYC Taxi Dataset into PostgreSQL

From your administrative workstation or Gateway EC2 instance:

```bash
# Set your RDS Connection String (Mumbai Region)
export DATABASE_URL="postgres://postgres:YourStrongPassword123!@shc-postgres.cxxxxxx.ap-south-1.rds.amazonaws.com:5432/shc_db?sslmode=require"

# Install psycopg2 dependency
pip install psycopg2-binary

# Run the high-speed ingestion pipeline (imports 100,000 initial trips or full dataset)
python scripts/import_nyc_taxi_to_rds.py --sqlite-path 2019-01.sqlite --limit 100000
```

---

## 🖥️ Step 5: Launch 3 Physical EC2 Instances for Cache Nodes

Launch 3 EC2 instances (`t4g.micro` or `t3.micro`, Amazon Linux 2023 or Ubuntu 22.04) attached to `shc-nodes-sg`:

* **EC2-A**: Private IP `10.0.1.10`
* **EC2-B**: Private IP `10.0.1.11`
* **EC2-C**: Private IP `10.0.1.12`

Install Docker and Docker Compose on each EC2:
```bash
sudo yum update -y
sudo yum install -y docker git
sudo systemctl enable --now docker
sudo usermod -aG docker ec2-user
```

---

## 📦 Step 6: Deploy Containers to Each EC2 Instance

### On EC2-A (Hosts Node A, Node D, Node G):
```bash
git clone <your-repo-url> /app/shc
cd /app/shc

# Configure environment with private IP peer addresses
export PEER_NODES="http://10.0.1.10:8001,http://10.0.1.10:8002,http://10.0.1.10:8003,http://10.0.1.11:8001,http://10.0.1.11:8002,http://10.0.1.11:8003,http://10.0.1.12:8001,http://10.0.1.12:8002,http://10.0.1.12:8003"

# Start Node A (:8001), Node D (:8002), Node G (:8003)
docker compose -f deploy/ec2-a.docker-compose.yml up -d
```

### On EC2-B (Hosts Node B, Node E, Node H):
```bash
git clone <your-repo-url> /app/shc
cd /app/shc

export PEER_NODES="http://10.0.1.10:8001,http://10.0.1.10:8002,http://10.0.1.10:8003,http://10.0.1.11:8001,http://10.0.1.11:8002,http://10.0.1.11:8003,http://10.0.1.12:8001,http://10.0.1.12:8002,http://10.0.1.12:8003"

# Start Node B (:8001), Node E (:8002), Node H (:8003)
docker compose -f deploy/ec2-b.docker-compose.yml up -d
```

### On EC2-C (Hosts Node C, Node F, Node I):
```bash
git clone <your-repo-url> /app/shc
cd /app/shc

export PEER_NODES="http://10.0.1.10:8001,http://10.0.1.10:8002,http://10.0.1.10:8003,http://10.0.1.11:8001,http://10.0.1.11:8002,http://10.0.1.11:8003,http://10.0.1.12:8001,http://10.0.1.12:8002,http://10.0.1.12:8003"

# Start Node C (:8001), Node F (:8002), Node I (:8003)
docker compose -f deploy/ec2-c.docker-compose.yml up -d
```

---

## 🌐 Step 7: Deploy Gateway Router & Dashboard UI

On your Public Gateway instance:

```bash
cd /app/shc

export DATABASE_URL="postgres://postgres:YourStrongPassword123!@shc-postgres.cxxxxxx.us-east-1.rds.amazonaws.com:5432/shc_db?sslmode=require"
export ALL_CACHE_NODES="http://10.0.1.10:8001,http://10.0.1.10:8002,http://10.0.1.10:8003,http://10.0.1.11:8001,http://10.0.1.11:8002,http://10.0.1.11:8003,http://10.0.1.12:8001,http://10.0.1.12:8002,http://10.0.1.12:8003"

# Launch Gateway Router (:8000) and Dashboard (:3000)
docker compose -f deploy/gateway.docker-compose.yml up -d
```

Open **`http://<GATEWAY_PUBLIC_IP>:3000`** in your browser!

---

## 🧪 Step 8: Verifying Physical Failure Domains

### Test 1: Cache Miss $\to$ PostgreSQL Read $\to$ RAM Cache Hit
1. In Dashboard, click **`🚕 trip:45210`** $\to$ **Query Trip**.
2. **First Query**: `Cache MISS` $\to$ Queries RDS PostgreSQL (`~45ms`) $\to$ Hydrates Node A (EC2-A) and Node B (EC2-B).
3. **Second Query**: `Cache HIT (RAM)` $\to$ `~1.5ms` (**30x Latency Reduction**).

### Test 2: Kill a Single Node (`Node A`)
1. Click **Fail Node (Node A)**.
2. Query `trip:45210` $\to$ Router detects Node A is `FAILED` and reads from replica **`Node B on EC2-B`** (`is_failover: true`) with **zero downtime**.

### Test 3: Total EC2 Outage (`Simulate EC2-A Crash`)
1. Click **`💥 Kill EC2-A`** (kills Node A, Node D, Node G simultaneously).
2. All keys previously served by EC2-A are instantly routed to their replicas on **EC2-B (Node B, Node E, Node H)**.
3. 100% of data remains accessible with **0% data loss**.

### Test 4: Recover EC2-A
1. Click **`✨ Revive EC2-A`**.
2. Nodes A, D, and G reboot, trigger peer synchronization, and rejoin the consistent hash ring automatically!
