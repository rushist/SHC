# Automated Chaos Testing Suite Execution Script
param (
    [string]$Scenario = "primary_kill",
    [int]$Requests = 40,
    [int]$Concurrency = 4
)

Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host "     RUNNING DISTRIBUTED CACHE AUTOMATED CHAOS EXPERIMENT     " -ForegroundColor Cyan
Write-Host "===============================================================" -ForegroundColor Cyan

# 1. Compile chaos binary
Write-Host "Compiling chaos test orchestrator..."
Push-Location "$PSScriptRoot\backend"
& "$HOME\go_sdk\bin\go.exe" build -o chaos.exe ./cmd/chaos
Pop-Location

# 2. Check if cluster is active; if not, launch it
$gwAlive = $false
try {
    $res = Invoke-RestMethod -Uri "http://localhost:8000/api/health" -TimeoutSec 1
    if ($res.status -eq "UP") { $gwAlive = $true }
} catch {}

$clusterStartedLocally = $false
if (-not $gwAlive) {
    Write-Host "Starting cluster mesh..."
    & "$PSScriptRoot\start_cluster.ps1"
    Start-Sleep -Seconds 3
    $clusterStartedLocally = $true
}

# 3. Execute Chaos Experiment
Write-Host "`nLaunching chaos experiment (Scenario: $Scenario)..." -ForegroundColor Yellow
Push-Location "$PSScriptRoot"
& ".\backend\chaos.exe" -gateway "http://localhost:8000" -scenario $Scenario -requests $Requests -concurrency $Concurrency
Pop-Location

# 4. Cleanup if started by this script
if ($clusterStartedLocally) {
    Write-Host "`nStopping cluster mesh..."
    & "$PSScriptRoot\stop_cluster.ps1"
}
