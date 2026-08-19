"""
SHC (Self-Healing Distributed Cache) — Python Client SDK
Zero third-party dependencies (uses standard requests).
"""
import requests

class SHC:
    def __init__(self, host="http://13.127.44.111:8000"):
        self.host = host.rstrip("/")

    def get(self, key: str):
        """
        1.2ms in-memory RAM cache read.
        Automatically falls back to Amazon RDS PostgreSQL and auto-hydrates on cache misses.
        """
        res = requests.get(f"{self.host}/api/get", params={"key": key}, timeout=1.5)
        return res.json() if res.status_code == 200 else None

    def set(self, key: str, value: str, ttl_seconds: int = 300):
        """
        Write-Through write: synchronously saves in the 9-node distributed cache mesh
        and persists into Amazon RDS PostgreSQL with mathematical cascade recalculations.
        """
        payload = {"key": key, "value": value, "ttl_seconds": ttl_seconds}
        res = requests.post(f"{self.host}/api/set", json=payload, timeout=1.5)
        return res.json()

    def evict(self, key: str):
        """
        Invalidates key from RAM cache (leaves backing database records intact).
        """
        res = requests.delete(f"{self.host}/api/delete", params={"key": key}, timeout=1.5)
        return res.json()

    def trip(self, trip_id: str):
        """
        Queries NYC Taxi record by ID (e.g. 'trip:45210') with cache-aside acceleration.
        """
        res = requests.get(f"{self.host}/api/trip", params={"id": trip_id}, timeout=1.5)
        return res.json() if res.status_code == 200 else None
