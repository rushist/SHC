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

// ToFloat safely parses any interface into a float64
func ToFloat(v interface{}) float64 {
	switch val := v.(type) {
	case float64:
		return val
	case float32:
		return float64(val)
	case int:
		return float64(val)
	case int64:
		return float64(val)
	case string:
		var f float64
		_, _ = fmt.Sscanf(val, "%f", &f)
		return f
	default:
		return 0
	}
}

// CalculateTripCascade implements mathematical invariants across NYC taxi fields.
// Modifying distance recalculates fare & total; modifying fare recalculates distance & total;
// modifying tip recalculates total; modifying total recalculates fare & distance.
func CalculateTripCascade(t *TaxiTrip, field string, val interface{}) {
	if t == nil {
		return
	}

	// Calculate base rate per mile ($/mile). NYC average is ~$3.50/mi
	ratePerMile := 3.50
	if t.TripDistance > 0 && t.FareAmount > 0 {
		ratePerMile = t.FareAmount / t.TripDistance
		if ratePerMile < 1.0 {
			ratePerMile = 1.0
		} else if ratePerMile > 20.0 {
			ratePerMile = 20.0
		}
	}

	// Fixed taxes/surcharges (extra, mta_tax, tolls, congestion)
	fixedSurcharges := t.TotalAmount - (t.FareAmount + t.TipAmount)
	if fixedSurcharges < 0.80 {
		fixedSurcharges = 0.80 // standard minimum NYC surcharges ($0.50 MTA + $0.30 improvement)
	}

	switch field {
	case "trip_distance":
		newDist := ToFloat(val)
		if newDist < 0.1 {
			newDist = 0.1
		}
		t.TripDistance = float64(int(newDist*100+0.5)) / 100
		t.FareAmount = float64(int((newDist*ratePerMile)*100+0.5)) / 100
		if t.FareAmount < 2.50 {
			t.FareAmount = 2.50
		}
		// Tip preserves tip ratio (standard ~18%)
		tipRatio := 0.18
		if t.FareAmount > 0 && t.TipAmount > 0 {
			tipRatio = t.TipAmount / t.FareAmount
			if tipRatio <= 0 || tipRatio > 0.5 {
				tipRatio = 0.18
			}
		}
		t.TipAmount = float64(int((t.FareAmount*tipRatio)*100+0.5)) / 100
		t.TotalAmount = float64(int((t.FareAmount+t.TipAmount+fixedSurcharges)*100+0.5)) / 100

	case "fare_amount":
		newFare := ToFloat(val)
		if newFare < 2.50 {
			newFare = 2.50
		}
		t.FareAmount = float64(int(newFare*100+0.5)) / 100
		t.TripDistance = float64(int((newFare/ratePerMile)*100+0.5)) / 100
		if t.TripDistance < 0.1 {
			t.TripDistance = 0.1
		}
		t.TotalAmount = float64(int((t.FareAmount+t.TipAmount+fixedSurcharges)*100+0.5)) / 100

	case "tip_amount":
		newTip := ToFloat(val)
		if newTip < 0 {
			newTip = 0
		}
		t.TipAmount = float64(int(newTip*100+0.5)) / 100
		t.TotalAmount = float64(int((t.FareAmount+t.TipAmount+fixedSurcharges)*100+0.5)) / 100

	case "total_amount":
		newTotal := ToFloat(val)
		if newTotal < 3.30 {
			newTotal = 3.30
		}
		t.TotalAmount = float64(int(newTotal*100+0.5)) / 100
		// Back-calculate fare and distance
		availableFare := t.TotalAmount - (t.TipAmount + fixedSurcharges)
		if availableFare < 2.50 {
			availableFare = 2.50
			t.TipAmount = t.TotalAmount - availableFare - fixedSurcharges
			if t.TipAmount < 0 {
				t.TipAmount = 0
			}
		}
		t.FareAmount = float64(int(availableFare*100+0.5)) / 100
		t.TripDistance = float64(int((t.FareAmount/ratePerMile)*100+0.5)) / 100

	case "passenger_count":
		newPass := ToFloat(val)
		if newPass < 1 {
			newPass = 1
		} else if newPass > 6 {
			newPass = 6
		}
		t.PassengerCount = &newPass

	case "pu_location_id", "pulocationid":
		newPu := ToFloat(val)
		t.PULocationID = &newPu
		if t.DOLocationID != nil {
			diff := *t.PULocationID - *t.DOLocationID
			if diff < 0 {
				diff = -diff
			}
			estimatedDist := float64(int((diff*0.06+1.2)*100+0.5)) / 100
			t.TripDistance = estimatedDist
			t.FareAmount = float64(int((estimatedDist*ratePerMile)*100+0.5)) / 100
			t.TotalAmount = float64(int((t.FareAmount+t.TipAmount+fixedSurcharges)*100+0.5)) / 100
		}

	case "do_location_id", "dolocationid":
		newDo := ToFloat(val)
		t.DOLocationID = &newDo
		if t.PULocationID != nil {
			diff := *t.PULocationID - *t.DOLocationID
			if diff < 0 {
				diff = -diff
			}
			estimatedDist := float64(int((diff*0.06+1.2)*100+0.5)) / 100
			t.TripDistance = estimatedDist
			t.FareAmount = float64(int((estimatedDist*ratePerMile)*100+0.5)) / 100
			t.TotalAmount = float64(int((t.FareAmount+t.TipAmount+fixedSurcharges)*100+0.5)) / 100
		}
	}
}

