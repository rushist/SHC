# PowerShell script to kill a specific cache node by id or port
param (
    [string]$Node = "node-c"
)

Write-Host "Looking for process for '$Node'..."

# Calculate port from node id (e.g. node-a -> 8001, node-i -> 8009)
$port = 8000
if ($Node -match "node-([a-i])") {
    $letter = $matches[1]
    $idx = [char][byte][char]$letter - [char][byte][char]'a' + 1
    $port = 8000 + $idx
} elseif ($Node -match "(\d{4})") {
    $port = [int]$matches[1]
}

if ($port -gt 8000) {
    try {
        $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
        if ($conns) {
            foreach ($conn in $conns) {
                $pidToKill = $conn.OwningProcess
                Write-Host "Killing process with PID $pidToKill listening on port :$port..."
                Stop-Process -Id $pidToKill -Force -ErrorAction SilentlyContinue
            }
            Write-Host "Successfully terminated $Node on port :$port." -ForegroundColor Green
            return
        }
    } catch {}
}

# Fallback: search process command lines
$processes = Get-Process -Name "cachenode", "router" -ErrorAction SilentlyContinue | Where-Object {
    $_.CommandLine -like "*$Node*" -or $_.CommandLine -like "*port $port*"
}

if ($processes) {
    foreach ($p in $processes) {
        Write-Host "Stopping process PID $($p.Id) for $Node..."
        Stop-Process -Id $p.Id -Force
    }
    Write-Host "Successfully terminated $Node." -ForegroundColor Green
} else {
    Write-Host "No active listener found on port :$port for $Node." -ForegroundColor Yellow
}
