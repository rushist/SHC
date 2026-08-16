#!/usr/bin/env python3
"""
NYC Yellow Taxi Dataset Importer for Amazon RDS PostgreSQL
Streams 7.66 Million records from 2019-01.sqlite (or S3 staging) into Amazon RDS PostgreSQL.

Usage:
  python scripts/import_nyc_taxi_to_rds.py --db-url "postgres://postgres:password@rds-endpoint.amazonaws.com:5432/shc_db" --limit 100000
"""

import os
import sys
import time
import sqlite3
import argparse
import psycopg2
from psycopg2.extras import execute_batch

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS trips (
    id BIGINT PRIMARY KEY,
    vendor_id DOUBLE PRECISION,
    pickup_datetime TIMESTAMP,
    dropoff_datetime TIMESTAMP,
    passenger_count DOUBLE PRECISION,
    trip_distance DOUBLE PRECISION,
    ratecode_id DOUBLE PRECISION,
    pu_location_id DOUBLE PRECISION,
    do_location_id DOUBLE PRECISION,
    payment_type DOUBLE PRECISION,
    fare_amount DOUBLE PRECISION,
    tip_amount DOUBLE PRECISION,
    total_amount DOUBLE PRECISION,
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trips_id ON trips(id);
"""

def parse_args():
    parser = argparse.ArgumentParser(description="Import NYC Taxi Dataset into Amazon RDS PostgreSQL")
    parser.add_argument("--sqlite-path", default="2019-01.sqlite", help="Path to 2019-01.sqlite database")
    parser.add_argument("--db-url", default=os.getenv("DATABASE_URL"), help="PostgreSQL connection string")
    parser.add_argument("--batch-size", type=int, default=5000, help="Batch insert size (default: 5000)")
    parser.add_argument("--limit", type=int, default=0, help="Limit records (0 for full 7.66M dataset)")
    return parser.parse_args()

def main():
    args = parse_args()
    
    if not args.db_url:
        print("Error: DATABASE_URL is not set. Pass --db-url or set environment variable DATABASE_URL.")
        sys.exit(1)

    if not os.path.exists(args.sqlite_path):
        print(f"Error: SQLite source database not found at '{args.sqlite_path}'")
        sys.exit(1)

    print("=================================================================")
    print("  NYC YELLOW TAXI -> AMAZON RDS POSTGRESQL INGESTION PIPELINE   ")
    print("=================================================================")
    print(f"Source Database: {args.sqlite_path}")
    print(f"Target Database: {args.db_url.split('@')[-1] if '@' in args.db_url else args.db_url}")
    print(f"Batch Size:      {args.batch_size:,}")
    print(f"Limit Records:   {'All (7,667,792)' if args.limit == 0 else f'{args.limit:,}'}")
    print("-----------------------------------------------------------------")

    # 1. Connect to PostgreSQL and create schema
    print("\n[1/3] Connecting to PostgreSQL & Creating 'trips' table...")
    pg_conn = psycopg2.connect(args.db_url)
    pg_conn.autocommit = True
    pg_cur = pg_conn.cursor()
    pg_cur.execute(SCHEMA_SQL)
    print("  ✓ 'trips' table & indexes verified on RDS PostgreSQL.")

    # 2. Connect to Source SQLite
    print("\n[2/3] Connecting to SQLite source file...")
    sqlite_conn = sqlite3.connect(args.sqlite_path)
    sqlite_cur = sqlite_conn.cursor()

    count_query = "SELECT COUNT(*) FROM tripdata"
    if args.limit > 0:
        total_to_import = args.limit
    else:
        sqlite_cur.execute(count_query)
        total_to_import = sqlite_cur.fetchone()[0]

    print(f"  ✓ Found {total_to_import:,} records to import into PostgreSQL.")

    # 3. Stream & Batch Insert
    print(f"\n[3/3] Streaming rows into Amazon RDS PostgreSQL...")
    select_query = """
        SELECT rowid, vendorid, tpep_pickup_datetime, tpep_dropoff_datetime, 
               passenger_count, trip_distance, ratecodeid, pulocationid, 
               dolocationid, payment_type, fare_amount, tip_amount, total_amount 
        FROM tripdata
    """
    if args.limit > 0:
        select_query += f" LIMIT {args.limit}"

    insert_query = """
        INSERT INTO trips (
            id, vendor_id, pickup_datetime, dropoff_datetime, 
            passenger_count, trip_distance, ratecode_id, pu_location_id, 
            do_location_id, payment_type, fare_amount, tip_amount, total_amount
        ) VALUES (
            %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
        ) ON CONFLICT (id) DO UPDATE SET
            fare_amount = EXCLUDED.fare_amount,
            total_amount = EXCLUDED.total_amount,
            updated_at = NOW();
    """

    sqlite_cur.execute(select_query)
    start_time = time.time()
    imported_count = 0

    while True:
        rows = sqlite_cur.fetchmany(args.batch_size)
        if not rows:
            break

        execute_batch(pg_cur, insert_query, rows, page_size=args.batch_size)
        imported_count += len(rows)

        elapsed = time.time() - start_time
        rate = imported_count / elapsed if elapsed > 0 else 0
        pct = (imported_count / total_to_import) * 100
        print(f"  -> Imported {imported_count:,} / {total_to_import:,} ({pct:.1f}%) — {rate:.0f} rows/sec", end="\r")

    total_time = time.time() - start_time
    print(f"\n\n=================================================================")
    print(f"  ✓ INGESTION COMPLETE: {imported_count:,} records imported into RDS PostgreSQL in {total_time:.2f}s!")
    print("=================================================================")

    pg_cur.close()
    pg_conn.close()
    sqlite_conn.close()

if __name__ == "__main__":
    main()
