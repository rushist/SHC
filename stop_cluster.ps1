# Stop all Go cache node and router processes
Write-Host "Stopping all running cache node and router processes..." -ForegroundColor Yellow
Get-Process -Name "cachenode", "router", "chaos" -ErrorAction SilentlyContinue | Stop-Process -Force
Write-Host "Distributed cache nodes and router stopped." -ForegroundColor Green
