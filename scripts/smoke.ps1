param(
    [string]$BaseUrl = 'http://127.0.0.1:18080',
    [switch]$ExpectDemo
)
$ErrorActionPreference = 'Stop'

Write-Host 'Waiting for web/API/database/Redis readiness...'
$ready = $false
for ($attempt = 1; $attempt -le 30; $attempt++) {
    try {
        $state = Invoke-RestMethod "$BaseUrl/api/v1/health/ready" -TimeoutSec 3
        if ($state.database -and $state.redis) { $ready = $true; break }
    } catch {
        if ($attempt % 5 -eq 0) { Write-Host "Readiness attempt $attempt/30" }
    }
    Start-Sleep -Seconds 1
}
if (-not $ready) { throw 'Readiness did not pass. Check docker compose logs api postgres redis.' }
$live = Invoke-RestMethod "$BaseUrl/api/v1/health/live" -TimeoutSec 5
if ($live.status -ne 'ok') { throw 'Liveness failed.' }
$catalog = Invoke-RestMethod "$BaseUrl/api/v1/courses" -TimeoutSec 5
if (@($catalog.data | Where-Object id -EQ 'demo-draft').Count -ne 0) { throw 'Draft course leaked.' }
if ($ExpectDemo -and @($catalog.data | Where-Object id -EQ 'demo-boundary').Count -ne 1) { throw 'Expected seeded published course is missing or duplicated.' }
foreach ($path in @('/', '/teacher/grading')) {
    $page = Invoke-WebRequest "$BaseUrl$path" -TimeoutSec 5
    if ($page.StatusCode -ne 200 -or $page.Content -notmatch '<div id="root">') { throw "SPA route failed: $path" }
}
Write-Host 'PASS: live, dependency readiness, course visibility, and SPA deep route.'
if ($ExpectDemo) { Write-Host 'PASS: synthetic published course exists; draft is filtered.' }
