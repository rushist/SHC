# Run Single Cache Node
Write-Host "Starting Cache Node on http://localhost:8001..." -ForegroundColor Cyan
go run -C backend ./cmd/node -id node-1 -port 8001
