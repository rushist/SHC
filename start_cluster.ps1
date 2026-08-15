# PowerShell script to build and launch 9-Node Cache Cluster + Unified API Router
Write-Host "Starting 9-Node Cache Cluster..." -ForegroundColor Cyan

# Stop any existing node and router processes
& "$PSScriptRoot\stop_cluster.ps1"
Start-Sleep -Milliseconds 400

# 1. Compile binaries
Write-Host "Compiling cachenode and router binaries..."
Push-Location "$PSScriptRoot\backend"
& "$HOME\go_sdk\bin\go.exe" build -o cachenode.exe ./cmd/node
& "$HOME\go_sdk\bin\go.exe" build -o router.exe ./cmd/router
Pop-Location

$nodeBin = "$PSScriptRoot\backend\cachenode.exe"
$routerBin = "$PSScriptRoot\backend\router.exe"

$nodes = @("a", "b", "c", "d", "e", "f", "g", "h", "i")

# 2. Launch all 9 nodes
foreach ($n in $nodes) {
    $idx = [char][byte][char]$n - [char][byte][char]'a' + 1
    $port = 8000 + $idx
    $id = "node-$n"

    # Build peers list
    $peers = ($nodes | Where-Object { $_ -ne $n } | ForEach-Object {
        $pIdx = [char][byte][char]$_ - [char][byte][char]'a' + 1
        $pPort = 8000 + $pIdx
        "node-$_`=http://localhost:$pPort"
    }) -join ","

    $args = "-id $id -port $port -peers $peers"
    $proc = Start-Process -FilePath $nodeBin -ArgumentList $args -PassThru -WindowStyle Hidden
    Write-Host "Started Node $($n.ToUpper()) on :$port (PID: $($proc.Id))" -ForegroundColor Green
}

# 3. Launch Unified API Router on Port 8000
$allNodes = ($nodes | ForEach-Object {
    $pIdx = [char][byte][char]$_ - [char][byte][char]'a' + 1
    $pPort = 8000 + $pIdx
    "node-$_`=http://localhost:$pPort"
}) -join ","

$routerArgs = "-port 8000 -nodes $allNodes"
$routerProc = Start-Process -FilePath $routerBin -ArgumentList $routerArgs -PassThru -WindowStyle Hidden
Write-Host "Started Unified API Router on :8000 (PID: $($routerProc.Id))" -ForegroundColor Magenta

Write-Host "`n===============================================================" -ForegroundColor Yellow
Write-Host "  9-NODE DISTRIBUTED CACHE CLUSTER & ROUTER ARE RUNNING!       " -ForegroundColor Yellow
Write-Host "  Public Client Gateway: http://localhost:8000                 " -ForegroundColor Yellow
Write-Host "  Nodes Active: :8001 through :8009                            " -ForegroundColor Yellow
Write-Host "===============================================================" -ForegroundColor Yellow
