package database

import (
	"fmt"
	"log"
	"os"
	"time"
)

// TaxiTrip represents a real-world record from the NYC Yellow Taxi dataset.
type TaxiTrip struct {
	TripID          string   `json:"trip_id"`
	RowID           int64    `json:"row_id"`
	VendorID        *float64 `json:"vendor_id,omitempty"`
	PickupDatetime  string   `json:"pickup_datetime"`
	DropoffDatetime string   `json:"dropoff_datetime"`
	PassengerCount  *float64 `json:"passenger_count,omitempty"`
	TripDistance    float64  `json:"trip_distance"`
	RatecodeID      *float64 `json:"ratecode_id,omitempty"`
	PULocationID    *float64 `json:"pu_location_id,omitempty"`
	DOLocationID    *float64 `json:"do_location_id,omitempty"`
	PaymentType     *float64 `json:"payment_type,omitempty"`
	FareAmount      float64  `json:"fare_amount"`
	TipAmount       float64  `json:"tip_amount"`
	TotalAmount     float64  `json:"total_amount"`
}

// Database defines the standard persistent storage contract for SHC cache-aside acceleration.
type Database interface {
	QueryTripByID(rowID int64) (*TaxiTrip, error, time.Duration)
	UpdateTripField(rowID int64, field string, value interface{}) (*TaxiTrip, error, time.Duration)
	GetStats() map[string]interface{}
	Close() error
}

// Config specifies the database connection parameters.
type Config struct {
	Driver   string `json:"driver"` // "postgres" or "sqlite"
	URL      string `json:"url"`
	Host     string `json:"host"`
	Port     int    `json:"port"`
	User     string `json:"user"`
	Password string `json:"password"`
	DBName   string `json:"dbname"`
	SSLMode  string `json:"sslmode"`
	Path     string `json:"path"`
}

// Open initializes and returns the appropriate persistent database driver (PostgreSQL or SQLite).
func Open(cfg Config) (Database, error) {
	// 1. Check for PostgreSQL Configuration
	pgURL := cfg.URL
	if pgURL == "" {
		pgURL = os.Getenv("DATABASE_URL")
	}
	if pgURL == "" && (cfg.Host != "" || os.Getenv("DATABASE_HOST") != "") {
		host := cfg.Host
		if host == "" {
			host = os.Getenv("DATABASE_HOST")
		}
		port := cfg.Port
		if port == 0 {
			port = 5432
		}
		user := cfg.User
		if user == "" {
			user = os.Getenv("DATABASE_USER")
		}
		pass := cfg.Password
		if pass == "" {
			pass = os.Getenv("DATABASE_PASSWORD")
		}
		dbname := cfg.DBName
		if dbname == "" {
			dbname = os.Getenv("DATABASE_NAME")
			if dbname == "" {
				dbname = "shc_db"
			}
		}
		sslmode := cfg.SSLMode
		if sslmode == "" {
			sslmode = os.Getenv("DATABASE_SSLMODE")
			if sslmode == "" {
				sslmode = "require" // Standard for AWS RDS
			}
		}
		pgURL = fmt.Sprintf("postgres://%s:%s@%s:%d/%s?sslmode=%s", user, pass, host, port, dbname, sslmode)
	}

	if pgURL != "" || cfg.Driver == "postgres" {
		log.Printf("[Database] Connecting to Amazon RDS PostgreSQL...")
		return OpenPostgresDB(pgURL)
	}

	// 2. Default / Local Fallback: SQLite
	sqlitePath := cfg.Path
	if sqlitePath == "" {
		sqlitePath = os.Getenv("SQLITE_PATH")
	}
	log.Printf("[Database] Connecting to Persistent SQLite File...")
	return OpenTaxiDB(sqlitePath)
}
