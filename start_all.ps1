# Master Script to Launch Backend Cluster + Next.js Dashboard
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "  STARTING SELF-HEALING DISTRIBUTED CACHE + NEXT.JS DASHBOARD    " -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan

# 1. Stop any existing processes
& "$PSScriptRoot\stop_cluster.ps1"
Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*next*" } | Stop-Process -Force
Start-Sleep -Milliseconds 400

# 2. Start Backend Cluster Mesh (Node A: 8001, Node B: 8002, Node C: 8003, Router: 8000)
Write-Host "Launching Backend Cluster (Nodes + Router)..."
& "$PSScriptRoot\start_cluster.ps1"
Start-Sleep -Seconds 2

# 3. Start Next.js Dashboard Dev Server on Port 3000
Write-Host "Launching Next.js Dashboard on http://localhost:3000..." -ForegroundColor Magenta
$dashDir = "$PSScriptRoot\dashboard"
Start-Process -FilePath "npm.cmd" -ArgumentList "run dev" -WorkingDirectory $dashDir

Start-Sleep -Seconds 3

Write-Host "`n=================================================================" -ForegroundColor Green
Write-Host "  SUCCESS! EVERYTHING IS RUNNING:" -ForegroundColor Green
Write-Host "  ---------------------------------------------------------------"
Write-Host "  ★ Next.js Dashboard UI : http://localhost:3000" -ForegroundColor Yellow
Write-Host "  ★ Unified API Gateway   : http://localhost:8000" -ForegroundColor Cyan
Write-Host "  ★ Storage Nodes         : :8001 (A), :8002 (B), :8003 (C)"
Write-Host "=================================================================" -ForegroundColor Green
Write-Host "Open http://localhost:3000 in your browser to interact with the dashboard!"
Write-Host "Run .\stop_cluster.ps1 to terminate the cluster when finished."
