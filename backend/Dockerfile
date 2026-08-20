# Multi-stage Dockerfile for Self-Healing Cache Cluster (Go 1.22)
# Stage 1: Build binaries
FROM golang:1.22-alpine AS builder

WORKDIR /app

# Install build tools
RUN apk add --no-cache git

# Copy dependency files
COPY go.mod ./
RUN go mod download

# Copy source code
COPY . .

# Compile optimized static binaries in a single parallel pass
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-w -s" -o /app/bin/ ./cmd/node ./cmd/router ./cmd/chaos

# Stage 2: Ultra-lightweight runtime
FROM alpine:3.20

WORKDIR /app
RUN apk add --no-cache ca-certificates tzdata

COPY --from=builder /app/bin/node /app/cachenode
COPY --from=builder /app/bin/router /app/router
COPY --from=builder /app/bin/chaos /app/chaos

# Default to running storage node (can be overridden by command/entrypoint)
CMD ["/app/cachenode"]
