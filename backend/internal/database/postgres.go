package database

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"sync/atomic"
	"time"

	_ "github.com/lib/pq"
)

// PostgresDB manages the connection pool to Amazon RDS PostgreSQL.
type PostgresDB struct {
	db          *sql.DB
	url         string
	queryCount  uint64
	writeCount  uint64
	initialized bool
}

// OpenPostgresDB opens a connection pool to Amazon RDS PostgreSQL.
func OpenPostgresDB(connStr string) (*PostgresDB, error) {
	if connStr == "" {
		return nil, fmt.Errorf("postgres connection string is empty")
	}

	db, err := sql.Open("postgres", connStr)
	if err != nil {
		return nil, fmt.Errorf("failed to open postgres connection: %w", err)
	}

	// Production connection pool tuning for Amazon RDS
	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(10)
	db.SetConnMaxLifetime(30 * time.Minute)
	db.SetConnMaxIdleTime(5 * time.Minute)

	// Verify connection with timeout
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := db.PingContext(ctx); err != nil {
		log.Printf("[Database] Warning: PostgreSQL ping failed (may still be booting): %v", err)
	} else {
		log.Printf("[Database] Successfully connected to Amazon RDS PostgreSQL!")
	}

	return &PostgresDB{
		db:          db,
		url:         connStr,
		initialized: true,
	}, nil
}

// QueryTripByID queries a single trip from PostgreSQL `trips` table.
func (p *PostgresDB) QueryTripByID(rowID int64) (*TaxiTrip, error, time.Duration) {
	if p == nil || p.db == nil {
		return nil, fmt.Errorf("postgres database not connected"), 0
	}

	start := time.Now()
	atomic.AddUint64(&p.queryCount, 1)

	query := `
		SELECT id, vendor_id, pickup_datetime, dropoff_datetime, 
		       passenger_count, trip_distance, ratecode_id, pu_location_id, 
		       do_location_id, payment_type, fare_amount, tip_amount, total_amount 
		FROM trips 
		WHERE id = $1 LIMIT 1;
	`

	row := p.db.QueryRow(query, rowID)

	var trip TaxiTrip
	trip.TripID = fmt.Sprintf("trip:%d", rowID)
	trip.RowID = rowID

	var vendorID, passCount, rateCode, puLoc, doLoc, payType sql.NullFloat64
	var pickup, dropoff sql.NullString
	var distance, fare, tip, total sql.NullFloat64

	err := row.Scan(
		&trip.RowID,
		&vendorID,
		&pickup,
		&dropoff,
		&passCount,
		&distance,
		&rateCode,
		&puLoc,
		&doLoc,
		&payType,
		&fare,
		&tip,
		&total,
	)

	latency := time.Since(start)

	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("trip with id %d not found in RDS PostgreSQL", rowID), latency
		}
		return nil, err, latency
	}

	if vendorID.Valid {
		trip.VendorID = &vendorID.Float64
	}
	if pickup.Valid {
		trip.PickupDatetime = pickup.String
	}
	if dropoff.Valid {
		trip.DropoffDatetime = dropoff.String
	}
	if passCount.Valid {
		trip.PassengerCount = &passCount.Float64
	}
	if distance.Valid {
		trip.TripDistance = distance.Float64
	}
	if rateCode.Valid {
		trip.RatecodeID = &rateCode.Float64
	}
	if puLoc.Valid {
		trip.PULocationID = &puLoc.Float64
	}
	if doLoc.Valid {
		trip.DOLocationID = &doLoc.Float64
	}
	if payType.Valid {
		trip.PaymentType = &payType.Float64
	}
	if fare.Valid {
		trip.FareAmount = fare.Float64
	}
	if tip.Valid {
		trip.TipAmount = tip.Float64
	}
	if total.Valid {
		trip.TotalAmount = total.Float64
	}

	return &trip, nil, latency
}

// UpdateTripField updates a field in PostgreSQL (Write-Through).
func (p *PostgresDB) UpdateTripField(rowID int64, field string, value interface{}) (*TaxiTrip, error, time.Duration) {
	if p == nil || p.db == nil {
		return nil, fmt.Errorf("postgres database not connected"), 0
	}

	allowedColumns := map[string]string{
		"fare_amount":     "fare_amount",
		"trip_distance":   "trip_distance",
		"passenger_count": "passenger_count",
		"tip_amount":      "tip_amount",
		"total_amount":    "total_amount",
		"pulocationid":    "pu_location_id",
		"dolocationid":    "do_location_id",
		"pu_location_id":  "pu_location_id",
		"do_location_id":  "do_location_id",
	}

	col, ok := allowedColumns[field]
	if !ok {
		return nil, fmt.Errorf("field '%s' is not an editable column", field), 0
	}

	start := time.Now()
	atomic.AddUint64(&p.writeCount, 1)

	query := fmt.Sprintf("UPDATE trips SET %s = $1, updated_at = NOW() WHERE id = $2;", col)
	_, err := p.db.Exec(query, value, rowID)
	if err != nil {
		return nil, fmt.Errorf("failed to update postgres db: %w", err), time.Since(start)
	}

	updatedTrip, err, _ := p.QueryTripByID(rowID)
	latency := time.Since(start)
	return updatedTrip, err, latency
}

// GetStats returns current telemetry for Amazon RDS PostgreSQL.
func (p *PostgresDB) GetStats() map[string]interface{} {
	if p == nil || p.db == nil {
		return map[string]interface{}{"status": "not_connected"}
	}

	stats := p.db.Stats()

	return map[string]interface{}{
		"database_type":        "Amazon RDS for PostgreSQL",
		"status":               "connected",
		"open_connections":     stats.OpenConnections,
		"in_use_connections":   stats.InUse,
		"idle_connections":     stats.Idle,
		"db_queries_executed":  atomic.LoadUint64(&p.queryCount),
		"db_writes_executed":   atomic.LoadUint64(&p.writeCount),
	}
}

// Close closes the PostgreSQL connection pool.
func (p *PostgresDB) Close() error {
	if p != nil && p.db != nil {
		return p.db.Close()
	}
	return nil
}
