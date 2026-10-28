param()
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Push-Location $repo
try {
    $localDir = Join-Path $repo '.local'
    New-Item -ItemType Directory -Force -Path $localDir | Out-Null
    docker compose run --rm -v "${localDir}:/local" api ./seed-s1 -output /local/s1-accounts.json
    if ($LASTEXITCODE -ne 0) { throw 'S1 account seeding failed. Existing credentials were not overwritten.' }
    Write-Host "Local credentials: $localDir/s1-accounts.json (ignored by Git). Open this file locally to log in."
} finally { Pop-Location }
