package database

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync/atomic"
	"time"

	_ "modernc.org/sqlite"
)

// SQLiteDB manages the persistent connection to the 2019-01.sqlite database.
type SQLiteDB struct {
	db          *sql.DB
	dbPath      string
	totalRows   int64
	queryCount  uint64
	writeCount  uint64
	initialized bool
}

// OpenTaxiDB opens the 2019-01.sqlite database file in Read-Write mode.
func OpenTaxiDB(customPath string) (*SQLiteDB, error) {
	candidatePaths := []string{
		customPath,
		"2019-01.sqlite",
		"../2019-01.sqlite",
		"../../2019-01.sqlite",
		filepath.Join(os.Getenv("DATA_DIR"), "2019-01.sqlite"),
	}

	var foundPath string
	for _, p := range candidatePaths {
		if p != "" {
			if _, err := os.Stat(p); err == nil {
				foundPath = p
				break
			}
		}
	}

	if foundPath == "" {
		return nil, fmt.Errorf("could not find 2019-01.sqlite database file")
	}

	// Open in Read-Write mode with WAL journal for concurrent reads & writes
	dsn := fmt.Sprintf("file:%s?_journal_mode=WAL&_synchronous=NORMAL&_busy_timeout=5000", foundPath)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("failed to open sqlite db at %s: %w", foundPath, err)
	}

	db.SetMaxOpenConns(20)
	db.SetMaxIdleConns(10)
	db.SetConnMaxLifetime(1 * time.Hour)

	var count int64 = 7667792 // Known total rows
	log.Printf("[Database] Connected to Persistent SQLite DB (Read-Write WAL): %s (~7.66 Million records)", foundPath)

	return &SQLiteDB{
		db:          db,
		dbPath:      foundPath,
		totalRows:   count,
		initialized: true,
	}, nil
}

// QueryTripByID fetches a single taxi trip from the 7.66M dataset by row ID.
func (s *SQLiteDB) QueryTripByID(rowID int64) (*TaxiTrip, error, time.Duration) {
	if s == nil || s.db == nil {
		return nil, fmt.Errorf("sqlite database not connected"), 0
	}

	start := time.Now()
	atomic.AddUint64(&s.queryCount, 1)

	query := `
		SELECT rowid, vendorid, tpep_pickup_datetime, tpep_dropoff_datetime, 
		       passenger_count, trip_distance, ratecodeid, pulocationid, 
		       dolocationid, payment_type, fare_amount, tip_amount, total_amount 
		FROM tripdata 
		WHERE rowid = ? LIMIT 1;
	`

	row := s.db.QueryRow(query, rowID)

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
			return nil, fmt.Errorf("trip with rowid %d not found in 7.66M dataset", rowID), latency
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

// UpdateTripField updates a specific field of a taxi trip in the persistent SQLite database.
func (s *SQLiteDB) UpdateTripField(rowID int64, field string, value interface{}) (*TaxiTrip, error, time.Duration) {
	if s == nil || s.db == nil {
		return nil, fmt.Errorf("sqlite database not connected"), 0
	}

	// Whitelist valid editable column names
	allowedColumns := map[string]bool{
		"fare_amount":     true,
		"trip_distance":   true,
		"passenger_count": true,
		"tip_amount":      true,
		"total_amount":    true,
		"pulocationid":    true,
		"dolocationid":    true,
		"pu_location_id":  true,
		"do_location_id":  true,
	}

	col := field
	if col == "pu_location_id" {
		col = "pulocationid"
	} else if col == "do_location_id" {
		col = "dolocationid"
	}

	if !allowedColumns[col] {
		return nil, fmt.Errorf("field '%s' is not an editable database column", field), 0
	}

	start := time.Now()
	atomic.AddUint64(&s.writeCount, 1)

	query := fmt.Sprintf("UPDATE tripdata SET %s = ? WHERE rowid = ?;", col)
	_, err := s.db.Exec(query, value, rowID)
	if err != nil {
		return nil, fmt.Errorf("failed to update sqlite db: %w", err), time.Since(start)
	}

	// Fetch complete updated trip record
	updatedTrip, err, _ := s.QueryTripByID(rowID)
	latency := time.Since(start)
	return updatedTrip, err, latency
}

// GetStats returns current database metrics.
func (s *SQLiteDB) GetStats() map[string]interface{} {
	if s == nil {
		return map[string]interface{}{
			"status": "not_connected",
		}
	}

	return map[string]interface{}{
		"database_path":        s.dbPath,
		"database_type":        "SQLite 3 Persistent Database (1GB WAL Read-Write)",
		"dataset_name":         "NYC Yellow Taxi Dataset (January 2019)",
		"total_records":        s.totalRows,
		"db_queries_executed":  atomic.LoadUint64(&s.queryCount),
		"db_writes_executed":   atomic.LoadUint64(&s.writeCount),
	}
}

// Close closes the database connection pool.
func (s *SQLiteDB) Close() error {
	if s != nil && s.db != nil {
		return s.db.Close()
	}
	return nil
}
