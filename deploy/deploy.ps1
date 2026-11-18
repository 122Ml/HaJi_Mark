<#
HaJi Mark release tool. Builds immutable images from a clean git snapshot, exports them,
writes release.json / compose / scripts into .local/deployment/<release-id>/, and optionally
uploads + switches the server. Server steps never prompt: they need HAJI_SSH_PASSWORD
(used through plink/pscp if present) or a working SSH key for root@154.201.71.22.

  pwsh -File deploy/deploy.ps1 -Action build        # local only: build, export, verify (HAJI_GOPROXY optional)
  pwsh -File deploy/deploy.ps1 -Action verify       # re-check an existing bundle
  pwsh -File deploy/deploy.ps1 -Action deploy       # upload + load + switch (needs credentials)
  pwsh -File deploy/deploy.ps1 -Action rollback     # switch back to release.json previous_release
#>
param(
  [ValidateSet('build', 'verify', 'deploy', 'rollback')] [string]$Action = 'build',
  [string]$ReleaseId = '',
  [string]$PreviousRelease = '',
  [string]$TargetHost = '154.201.71.22'
)
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Step($m) { Write-Host "==> $m" -ForegroundColor Cyan }
function Run($exe, [string[]]$argv) { & $exe @argv; if ($LASTEXITCODE -ne 0) { throw "$exe $($argv -join ' ') failed ($LASTEXITCODE)" } }

$commit = (git rev-parse HEAD).Trim()
$short = (git rev-parse --short HEAD).Trim()
if (-not $ReleaseId) {
  $existing = Get-ChildItem .local/deployment -Directory -Filter "hajimark-ui-$short-*" -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 1
  $ReleaseId = if ($existing -and $Action -ne 'build') { $existing.Name } else { "hajimark-ui-$short-$(Get-Date -Format yyyyMMdd)" }
}
if ($ReleaseId -notmatch '^hajimark-[A-Za-z0-9_-]{1,80}$') { throw "Invalid release id $ReleaseId" }
$Tag = $ReleaseId -replace '^hajimark-', ''
$Bundle = Join-Path $Root ".local/deployment/$ReleaseId"
$RemoteDir = "/opt/hajimark/releases/$ReleaseId"
$images = @(
  @{ name = 'postgres'; tag = "hajimark-postgres:$Tag"; context = 'backend/docker/postgres' },
  @{ name = 'backend'; tag = "hajimark-backend:$Tag"; context = 'backend' },
  @{ name = 'worker'; tag = "hajimark-worker:$Tag"; context = 'backend'; target = 'rag-worker' },
  @{ name = 'web'; tag = "hajimark-web:$Tag"; context = 'web' }
)
function Build-Bundle {
  if (git status --porcelain) { throw 'Commit source and artifacts before building a release.' }
  if (-not $PreviousRelease) { throw 'Pass the directly observed -PreviousRelease.' }
  $sourceTag = (git describe --exact-match --tags HEAD 2>$null)
  $version = (Get-Content web/package.json -Raw | ConvertFrom-Json).version
  if ($LASTEXITCODE -ne 0 -or $sourceTag -ne "v$version") { throw 'HEAD must have the exact immutable version tag matching web/package.json.' }
  Run git @('fsck', '--no-dangling')
  if (Test-Path $Bundle) { throw "$Bundle already exists; pass a new -ReleaseId" }
  $src = Join-Path $Bundle 'source'
  Step "Export clean source $commit"
  New-Item -ItemType Directory $src -Force | Out-Null
  try {
    Run git @('archive', '--format=tar', '-o', "$src.tar", $commit, 'backend', 'web')
    Run (Join-Path $env:SystemRoot 'System32/tar.exe') @('-xf', "$src.tar", '-C', $src)
    foreach ($img in $images) {
      Step "docker build $($img.tag)"
      $proxy = if ($env:HAJI_GOPROXY) { @('--build-arg', "GOPROXY=$env:HAJI_GOPROXY") } else { @() }
      $target = if ($img.target) { @('--target', $img.target) } else { @() }
      Run docker (@('build', '--label', "org.opencontainers.image.revision=$commit", '-t', $img.tag) + $target + $proxy + @((Join-Path $src $img.context)))
    }
  } finally {
    $resolved = [IO.Path]::GetFullPath($src)
    if ($resolved -ne [IO.Path]::GetFullPath((Join-Path $Bundle 'source'))) { throw 'Unexpected source cleanup target' }
    Remove-Item -LiteralPath $resolved -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath "$src.tar" -ErrorAction SilentlyContinue
  }
  New-Item -ItemType Directory -Force $Bundle | Out-Null
  Step 'docker save | gzip'
  Run docker (@('save', '-o', "$Bundle/images.tar") + ($images | ForEach-Object { $_.tag }))
  python -c "import gzip,shutil,sys; shutil.copyfileobj(open(sys.argv[1],'rb'), gzip.open(sys.argv[2],'wb',6))" "$Bundle/images.tar" "$Bundle/images.tar.gz"
  if ($LASTEXITCODE -ne 0) { throw 'gzip failed' }
  # Docker's containerd store may report an index ID; classic Docker loads the config ID.
  $configJSON = python -c "import json,tarfile,sys; a=tarfile.open(sys.argv[1]); entries=json.load(a.extractfile('manifest.json')); print(json.dumps({tag:'sha256:'+entry['Config'].rsplit('/',1)[-1].removesuffix('.json') for entry in entries for tag in entry['RepoTags']}))" "$Bundle/images.tar"
  if ($LASTEXITCODE -ne 0) { throw 'Could not read exported image config IDs' }
  $configIDs = $configJSON | ConvertFrom-Json
  Remove-Item "$Bundle/images.tar"
  foreach ($f in 'compose.production.yaml', 'backup.sh', 'renew-certificate.sh', 'openresty-hajistudy.conf', 'fingerprint-db.py', 'publish-diagrams.py') { Copy-Item "deploy/$f" $Bundle }
  $manifest = [ordered]@{
    release_id = $ReleaseId; source_commit = $commit; source_tag = $sourceTag; source_branch = (git branch --show-current).Trim()
    images = @($images | ForEach-Object {
      $i = docker image inspect $_.tag | ConvertFrom-Json
      [ordered]@{ tag = $_.tag; local_image_id = $i[0].Id; config_id = $configIDs.PSObject.Properties[$_.tag].Value; revision = $commit }
    })
    archive = [ordered]@{ file = 'images.tar.gz'; bytes = (Get-Item "$Bundle/images.tar.gz").Length; sha256 = (Get-FileHash "$Bundle/images.tar.gz" -Algorithm SHA256).Hash.ToLower() }
    migration = ((Get-ChildItem "$Root/backend/db/migrations/*.sql" | ForEach-Object { [int]($_.BaseName.Split('_')[0]) } | Measure-Object -Maximum).Maximum); compose_project = 'hajimark-production'; ai_enabled = $false; previous_release = $PreviousRelease
  }
  $manifest | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8NoBOM "$Bundle/release.json"
  Write-EnvTemplate
  Write-ServerScripts
}

function Write-EnvTemplate {
  @"
# /opt/hajimark/shared/.env (root:root 0600). Never commit. Keep the existing POSTGRES_PASSWORD on upgrade.
POSTGRES_PASSWORD=<existing-random-password>
POSTGRES_IMAGE=hajimark-postgres:$Tag
BACKEND_IMAGE=hajimark-backend:$Tag
WORKER_IMAGE=hajimark-worker:$Tag
WEB_IMAGE=hajimark-web:$Tag
"@ | Set-Content -Encoding utf8NoBOM "$Bundle/env.template"
}
function Write-ServerScripts {
  # Runs on the server inside the release dir. Preserves secrets and selects bundled images.
  $switch = Get-Content (Join-Path $PSScriptRoot 'switch-release.sh') -Raw
  $update = Get-Content (Join-Path $PSScriptRoot 'update-release.sh') -Raw
  $rollback = "#!/bin/bash`nset -euo pipefail`necho 'No automatic rollback across schema changes. Verify schema compatibility and preserve post-upgrade writes before selecting an older release.' >&2`nexit 1`n"
  $sha = (Get-Content "$Bundle/release.json" -Raw | ConvertFrom-Json).archive.sha256
  foreach ($pair in @(@('switch-release.sh', $switch), @('update-release.sh', $update), @('rollback.sh', $rollback))) {
    $text = $pair[1].Replace('__RELEASE__', $ReleaseId).Replace('__PREVIOUS__', $PreviousRelease).Replace('__SHA256__', $sha) -replace "`r`n", "`n"
    [IO.File]::WriteAllText((Join-Path $Bundle $pair[0]), $text + "`n")
  }
}
function Verify-Bundle {
  $m = Get-Content "$Bundle/release.json" -Raw | ConvertFrom-Json
  Step 'Verify archive SHA256'
  if ((Get-FileHash "$Bundle/$($m.archive.file)" -Algorithm SHA256).Hash.ToLower() -ne $m.archive.sha256) { throw 'archive sha256 mismatch' }
  Step 'Verify images in archive match manifest and source commit'
  Run docker @('load', '-i', "$Bundle/$($m.archive.file)")
  foreach ($img in $m.images) {
    $i = (docker image inspect $img.tag | ConvertFrom-Json)[0]
    if ($i.Id -ne $img.local_image_id) { throw "$($img.tag) id mismatch" }
    if ($i.Config.Labels.'org.opencontainers.image.revision' -ne $m.source_commit) { throw "$($img.tag) revision label mismatch" }
  }
  Step 'Validate production compose with the release image tags'
  $env:POSTGRES_PASSWORD = 'compose-config-check-only'
  $env:BACKEND_IMAGE = ($m.images | Where-Object { $_.tag -like '*backend*' }).tag
  $env:WORKER_IMAGE = ($m.images | Where-Object { $_.tag -like '*worker*' }).tag
  $env:WEB_IMAGE = ($m.images | Where-Object { $_.tag -like '*web*' }).tag
  $env:POSTGRES_IMAGE = ($m.images | Where-Object { $_.tag -like '*postgres*' }).tag
  try { Run docker @('compose', '-f', "$Bundle/compose.production.yaml", 'config', '-q') }
  finally { Remove-Item Env:POSTGRES_PASSWORD, Env:BACKEND_IMAGE, Env:WORKER_IMAGE, Env:WEB_IMAGE, Env:POSTGRES_IMAGE }
  Step 'Check server scripts are LF-only and parse with bash -n'
  foreach ($s in 'switch-release.sh', 'update-release.sh', 'rollback.sh', 'backup.sh') {
    if ((Get-Content -Raw "$Bundle/$s").Contains("`r")) { throw "$s has CRLF" }
    Run docker @('run', '--rm', '-v', "${Bundle}:/r:ro", 'redis:7.4.10', 'bash', '-n', "/r/$s")
  }
  Step 'Smoke-test the release web image (static files + SPA fallback)'
  $name = "hajimark-release-smoke-$short"
  $webTag = ($m.images | Where-Object { $_.tag -like '*web*' }).tag
  Run docker @('run', '-d', '--rm', '--name', $name, '--add-host', 'api:127.0.0.1', '-p', '127.0.0.1:18089:80', $webTag)
  try {
    Start-Sleep 2
    $html = (Invoke-WebRequest -UseBasicParsing http://127.0.0.1:18089/teacher/dashboard).Content
    if ($html -notmatch 'assets/index-[^"]+\.js') { throw 'SPA fallback did not return index.html' }
    $css = [regex]::Match($html, 'assets/index-[^"]+\.css').Value
    if ((Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:18089/$css").Content -notmatch 'ant-drawer|ant-layout|workspace') { throw 'release web image stylesheet check failed' }
  } finally { docker rm -f $name | Out-Null }
  Write-Host "LOCAL_VERIFIED $ReleaseId ($($m.archive.bytes) bytes, sha256 $($m.archive.sha256))" -ForegroundColor Green
}

function Get-Remote {
  $keyOk = $false
  ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=yes "root@$TargetHost" true 2>$null
  if ($LASTEXITCODE -eq 0) { $keyOk = $true }
  if (-not $keyOk -and -not $env:HAJI_SSH_PASSWORD) { throw 'DEPLOY_PENDING: no SSH key access and HAJI_SSH_PASSWORD is not set. Nothing was changed on the server.' }
  return $keyOk
}

function Invoke-Remote([string]$command, [string[]]$upload = @()) {
  # Password path uses paramiko (non-interactive, known_hosts enforced); key path uses OpenSSH.
  $py = @'
import os,sys,paramiko
host,remote_dir,command=sys.argv[1:4];files=sys.argv[4:]
c=paramiko.SSHClient();c.load_host_keys(os.path.expanduser('~/.ssh/known_hosts'))
c.connect(host,username='root',password=os.environ['HAJI_SSH_PASSWORD'],look_for_keys=False,allow_agent=False,timeout=20)
c.get_transport().set_keepalive(20)
if files:
 c.exec_command(f'mkdir -p -m 700 {remote_dir}')[1].channel.recv_exit_status()
 s=c.open_sftp()
 for f in files: print('UPLOAD',os.path.basename(f),flush=True);s.put(f,f'{remote_dir}/{os.path.basename(f)}')
 s.close()
_,o,e=c.exec_command(command,timeout=900)
for line in o: print(line.rstrip(),flush=True)
err=e.read().decode();code=o.channel.recv_exit_status()
if err: print(err,file=sys.stderr)
sys.exit(code)
'@
  if ($script:KeyAccess) {
    if ($upload) { Run ssh @("root@$TargetHost", "mkdir -p -m 700 $RemoteDir"); Run scp ($upload + "root@${TargetHost}:$RemoteDir/") }
    Run ssh @("root@$TargetHost", $command)
  } else {
    $tmp = New-TemporaryFile; Set-Content $tmp $py
    try { Run python (@($tmp.FullName, $TargetHost, $RemoteDir, $command) + $upload) } finally { Remove-Item $tmp }
  }
}

switch ($Action) {
  'build' { Build-Bundle; Verify-Bundle }
  'verify' { Verify-Bundle }
  'deploy' {
    Verify-Bundle
    $script:KeyAccess = Get-Remote
    $files = 'images.tar.gz', 'release.json', 'compose.production.yaml', 'backup.sh', 'renew-certificate.sh', 'openresty-hajistudy.conf', 'switch-release.sh', 'update-release.sh', 'rollback.sh', 'fingerprint-db.py' | ForEach-Object { Join-Path $Bundle $_ }
    Step "Upload to $TargetHost`:$RemoteDir, backup, load, switch"
    Invoke-Remote "test ! -e $RemoteDir/images.tar.gz && echo NEW_RELEASE_DIR || (echo 'release dir already has images; refusing to overwrite' && exit 1)"
    Invoke-Remote "chmod 700 $RemoteDir/*.sh && nohup bash $RemoteDir/update-release.sh >$RemoteDir/deployment.log 2>&1 </dev/null &" $files
    Write-Host "DEPLOYMENT_STARTED $ReleaseId. Inspect deployment.log and deployment.exit, then verify the public site before declaring success." -ForegroundColor Green
  }
  'rollback' { $script:KeyAccess = Get-Remote; Invoke-Remote "bash $RemoteDir/rollback.sh"; Write-Host 'ROLLED_BACK' }
}
