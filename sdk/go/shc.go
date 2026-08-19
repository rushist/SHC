// Package shc provides a pure Go client SDK for the Self-Healing Distributed Cache Gateway.
package shc

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

type Client struct {
	host       string
	httpClient *http.Client
}

func New(host string) *Client {
	return &Client{
		host:       strings.TrimSuffix(host, "/"),
		httpClient: &http.Client{Timeout: 1500 * time.Millisecond},
	}
}

type SetRequest struct {
	Key        string `json:"key"`
	Value      string `json:"value"`
	TTLSeconds int    `json:"ttl_seconds,omitempty"`
}

type Response struct {
	Status     string `json:"status"`
	Key        string `json:"key"`
	Value      string `json:"value,omitempty"`
	Source     string `json:"source,omitempty"`
	ServedBy   string `json:"served_by,omitempty"`
	IsFailover bool   `json:"is_failover,omitempty"`
	DBUpdated  bool   `json:"db_updated,omitempty"`
	Message    string `json:"message,omitempty"`
}

func (c *Client) Set(ctx context.Context, key, value string, ttlSeconds int) (*Response, error) {
	body, _ := json.Marshal(SetRequest{Key: key, Value: value, TTLSeconds: ttlSeconds})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, fmt.Sprintf("%s/api/set", c.host), bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var r Response
	if err := json.NewDecoder(resp.Body).Decode(&r); err != nil {
		return nil, err
	}
	return &r, nil
}

func (c *Client) Get(ctx context.Context, key string) (*Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, fmt.Sprintf("%s/api/get?key=%s", c.host, key), nil)
	if err != nil {
		return nil, err
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var r Response
	if err := json.NewDecoder(resp.Body).Decode(&r); err != nil {
		return nil, err
	}
	return &r, nil
}

func (c *Client) Evict(ctx context.Context, key string) (*Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, fmt.Sprintf("%s/api/delete?key=%s", c.host, key), nil)
	if err != nil {
		return nil, err
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var r Response
	if err := json.NewDecoder(resp.Body).Decode(&r); err != nil {
		return nil, err
	}
	return &r, nil
}
