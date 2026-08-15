# Launch Next.js Dashboard on Port 3000
Write-Host "Starting Next.js Distributed Cache Dashboard on http://localhost:3000..." -ForegroundColor Cyan
Push-Location "$PSScriptRoot\dashboard"
npm run dev
Pop-Location
