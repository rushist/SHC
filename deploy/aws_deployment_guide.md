# 🚀 AWS 3-EC2 Multi-Machine Deployment Guide

This guide walks through deploying the **Self-Healing Distributed Cache (SHC)** across **3 physical AWS EC2 instances** with **7.66 Million NYC Taxi records** in persistent storage.

---

## 🏛️ Physical & Networking Architecture

```
                                   [ INTERNET / USERS ]
                                             |
                                             v
                             +-------------------------------+
                             |    Gateway & Dashboard Host   |
                             |   (Public IP: Gateway_Pub_IP) |
                             |   Ports: :8000 (API), :3000   |
                             +---------------+---------------+
                                             |
                   +-------------------------+-------------------------+
                   | (AWS Private VPC Subnet: 10.0.1.0/24)             |
                   v                                                   v
+------------------------------------+               +------------------------------------+
|            AWS EC2 - A             |               |            AWS EC2 - B             |
|    (Private IP: 10.0.1.10)         | <===========> |    (Private IP: 10.0.1.11)         |
+------------------------------------+ (TCP 8001-09) +------------------------------------+
| Container 1: Node A (:8001)        |               | Container 1: Node D (:8004)        |
| Container 2: Node B (:8002)        |               | Container 2: Node E (:8005)        |
| Container 3: Node C (:8003)        |               | Container 3: Node F (:8006)        |
+------------------------------------+               +------------------------------------+
                   ^                                                   ^
                   |                                                   |
                   +=======================+===========================+
                                           | (TCP 8001-09)
                                           v
                         +------------------------------------+
                         |            AWS EC2 - C             |
                         |    (Private IP: 10.0.1.12)         |
                         +------------------------------------+
                         | Container 1: Node G (:8007)        |
                         | Container 2: Node H (:8008)        |
                         | Container 3: Node I (:8009)        |
                         +------------------------------------+
```

---

## 🔒 Security Group Configuration

Create two AWS Security Groups:

### 1. `cache-cluster-internal-sg` (Attached to EC2-A, EC2-B, EC2-C)
| Type | Port Range | Source | Description |
| :--- | :--- | :--- | :--- |
| **Custom TCP** | `8001 - 8009` | `10.0.1.0/24` (VPC CIDR) | Private inter-node replication and heartbeats |
| **SSH** | `22` | Your IP | Admin access |

### 2. `cache-gateway-public-sg` (Attached to Gateway Host)
| Type | Port Range | Source | Description |
| :--- | :--- | :--- | :--- |
| **Custom TCP** | `3000` | `0.0.0.0/0` | Next.js Pistachio Control Plane |
| **Custom TCP** | `8000` | `0.0.0.0/0` | Unified Client REST Gateway |
| **SSH** | `22` | Your IP | Admin access |

---

## 📋 Step-by-Step Deployment Instructions

### Step 1: Launch 3 EC2 Instances (EC2-A, EC2-B, EC2-C)
* **AMI**: Ubuntu 24.04 LTS (or Amazon Linux 2023)
* **Instance Type**: `t3.micro` or `t3.small` (Free tier eligible)
* **Security Group**: Attach `cache-cluster-internal-sg`
* Note down their private IPs (e.g. `10.0.1.10`, `10.0.1.11`, `10.0.1.12`).

---

### Step 2: Install Docker on all EC2 instances
SSH into each instance and run:
```bash
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2 git
sudo usermod -aG docker $USER && newgrp docker
```

---

### Step 3: Start Nodes on EC2-A (`10.0.1.10`)
```bash
export EC2_A_IP="10.0.1.10"
export EC2_B_IP="10.0.1.11"
export EC2_C_IP="10.0.1.12"

docker compose -f deploy/ec2-a.docker-compose.yml up -d
```
*Starts Node A (:8001), Node B (:8002), and Node C (:8003).*

---

### Step 4: Start Nodes on EC2-B (`10.0.1.11`)
```bash
export EC2_A_IP="10.0.1.10"
export EC2_B_IP="10.0.1.11"
export EC2_C_IP="10.0.1.12"

docker compose -f deploy/ec2-b.docker-compose.yml up -d
```
*Starts Node D (:8004), Node E (:8005), and Node F (:8006).*

---

### Step 5: Start Nodes on EC2-C (`10.0.1.12`)
```bash
export EC2_A_IP="10.0.1.10"
export EC2_B_IP="10.0.1.11"
export EC2_C_IP="10.0.1.12"

docker compose -f deploy/ec2-c.docker-compose.yml up -d
```
*Starts Node G (:8007), Node H (:8008), and Node I (:8009).*

---

### Step 6: Start Gateway & Dashboard on Public Web Host
Copy `2019-01.sqlite` to `/opt/cache/2019-01.sqlite` and launch:
```bash
export EC2_A_IP="10.0.1.10"
export EC2_B_IP="10.0.1.11"
export EC2_C_IP="10.0.1.12"

docker compose -f deploy/gateway.docker-compose.yml up -d
```

---

## 🧪 Live Failure Testing on AWS

1. **Individual Node Kill**:
   ```bash
   ssh ubuntu@10.0.1.10 "docker stop cache-node-b"
   ```
   *Dashboard marks Node B as `FAILED`; Gateway routes to its replica on EC2-B with zero downtime.*

2. **Full EC2 Outage Simulation**:
   ```bash
   aws ec2 stop-instances --instance-ids i-0123456789abcdef0
   ```
   *Terminates EC2-A completely (killing Node A, B, and C simultaneously). Because replicas are placed cross-host on EC2-B and EC2-C, 100% of read traffic continues without data loss!*
