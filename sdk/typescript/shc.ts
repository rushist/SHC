/**
 * SHC (Self-Healing Distributed Cache) — TypeScript / JavaScript Client SDK
 * Zero third-party dependencies (uses standard fetch API).
 */

export interface SHCResponse {
  status: "stored" | "hit" | "miss" | "deleted" | "error";
  key: string;
  value?: string;
  source?: "distributed_cache" | "backing_database";
  served_by?: string;
  is_failover?: boolean;
  db_updated?: boolean;
  message?: string;
}

export class SHC {
  private host: string;

  constructor(host = "http://13.127.44.111:8000") {
    this.host = host.replace(/\/$/, "");
  }

  /**
   * 1.2ms RAM read (auto-hydrates from RDS PostgreSQL on cache miss).
   */
  async get(key: string): Promise<SHCResponse | null> {
    const res = await fetch(`${this.host}/api/get?key=${encodeURIComponent(key)}`);
    return res.ok ? await res.json() : null;
  }

  /**
   * Write-Through: saves in distributed cache mesh and persists to Amazon RDS PostgreSQL.
   */
  async set(key: string, value: string, ttlSeconds = 300): Promise<SHCResponse> {
    const res = await fetch(`${this.host}/api/set`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value, ttl_seconds: ttlSeconds }),
    });
    return await res.json();
  }

  /**
   * Evicts key from volatile in-memory RAM cache (leaves database row intact).
   */
  async evict(key: string): Promise<SHCResponse> {
    const res = await fetch(`${this.host}/api/delete?key=${encodeURIComponent(key)}`, {
      method: "DELETE",
    });
    return await res.json();
  }

  /**
   * Cache-Aside query against the 7.66M NYC Yellow Taxi dataset.
   */
  async trip(tripId: string): Promise<any> {
    const res = await fetch(`${this.host}/api/trip?id=${encodeURIComponent(tripId)}`);
    return res.ok ? await res.json() : null;
  }
}

export default SHC;
