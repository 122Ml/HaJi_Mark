<#
HaJi Mark release tool. Builds immutable images from a clean git snapshot, exports them,
writes release.json / compose / scripts into .local/deployment/<release-id>/, and optionally
uploads + switches the server. Server steps never prompt: they need HAJI_SSH_PASSWORD
(used through plink/pscp if present) or a working SSH key for root@154.201.71.22.

  pwsh -File deploy/deploy.ps1 -Action build        # local only: build, export, verify
  pwsh -File deploy/deploy.ps1 -Action verify       # re-check an existing bundle
  pwsh -File deploy/deploy.ps1 -Action deploy       # upload + load + switch (needs credentials)
  pwsh -File deploy/deploy.ps1 -Action rollback     # switch back to release.json previous_release
#>
param(
  [ValidateSet('build', 'verify', 'deploy', 'rollback')] [string]$Action = 'build',
  [string]$ReleaseId = '',
  [string]$PreviousRelease = 'hajimark-s1-99168eb-20261028',
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
  @{ name = 'backend'; tag = "hajimark-backend:$Tag"; context = 'backend' },
  @{ name = 'web'; tag = "hajimark-web:$Tag"; context = 'web' }
)
function Build-Bundle {
  if (git status --porcelain --untracked-files=no) { throw 'Tracked files have uncommitted changes; commit first so the release maps to one source commit.' }
  if (Test-Path $Bundle) { throw "$Bundle already exists; pass a new -ReleaseId" }
  $src = Join-Path $env:TEMP "hajimark-src-$short"
  if (Test-Path $src) { Remove-Item -Recurse -Force $src }
  Step "Export clean source $commit"
  New-Item -ItemType Directory $src | Out-Null
  try {
    Run git @('archive', '--format=tar', '-o', "$src.tar", $commit, 'backend', 'web')
    Run (Join-Path $env:SystemRoot 'System32/tar.exe') @('-xf', "$src.tar", '-C', $src)
    foreach ($img in $images) {
      Step "docker build $($img.tag)"
      Run docker @('build', '--label', "org.opencontainers.image.revision=$commit", '-t', $img.tag, (Join-Path $src $img.context))
    }
  } finally { Remove-Item -Recurse -Force $src, "$src.tar" -ErrorAction SilentlyContinue }
  New-Item -ItemType Directory -Force $Bundle | Out-Null
  Step 'docker save | gzip'
  Run docker (@('save', '-o', "$Bundle/images.tar") + ($images | ForEach-Object { $_.tag }))
  python -c "import gzip,shutil,sys; shutil.copyfileobj(open(sys.argv[1],'rb'), gzip.open(sys.argv[2],'wb',6))" "$Bundle/images.tar" "$Bundle/images.tar.gz"
  if ($LASTEXITCODE -ne 0) { throw 'gzip failed' }
  Remove-Item "$Bundle/images.tar"
  foreach ($f in 'compose.production.yaml', 'backup.sh', 'renew-certificate.sh', 'openresty-hajistudy.conf') { Copy-Item "deploy/$f" $Bundle }
  $manifest = [ordered]@{
    release_id = $ReleaseId; source_commit = $commit; source_branch = (git branch --show-current).Trim()
    images = @($images | ForEach-Object {
      $i = docker image inspect $_.tag | ConvertFrom-Json
      [ordered]@{ tag = $_.tag; local_image_id = $i[0].Id; config_id = $i[0].Id; revision = $commit }
    })
    archive = [ordered]@{ file = 'images.tar.gz'; bytes = (Get-Item "$Bundle/images.tar.gz").Length; sha256 = (Get-FileHash "$Bundle/images.tar.gz" -Algorithm SHA256).Hash.ToLower() }
    migration = 8; compose_project = 'hajimark-production'; ai_enabled = $false; previous_release = $PreviousRelease
  }
  $manifest | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8NoBOM "$Bundle/release.json"
  Write-EnvTemplate
  Write-ServerScripts
}

function Write-EnvTemplate {
  @"
# /opt/hajimark/shared/.env (root:root 0600). Never commit. Keep the existing POSTGRES_PASSWORD on upgrade.
POSTGRES_PASSWORD=<existing-random-password>
BACKEND_IMAGE=hajimark-backend:$Tag
WEB_IMAGE=hajimark-web:$Tag
"@ | Set-Content -Encoding utf8NoBOM "$Bundle/env.template"
}
function Write-ServerScripts {
  # Runs on the server inside the release dir. Selects images by rewriting the two tag lines of shared/.env.
  $switch = @'
#!/bin/bash
# usage: switch-release.sh <release-id>   (run as root on the server)
set -euo pipefail
umask 077
target=/opt/hajimark/releases/$1
test -f "$target/release.json" && test -f "$target/compose.production.yaml"
cd "$target"
python3 - "$target" <<'PY'
import json,subprocess,sys
from pathlib import Path
release=Path(sys.argv[1]);manifest=json.loads((release/'release.json').read_text())
tags={}
for item in manifest['images']:
 actual=json.loads(subprocess.check_output(['docker','image','inspect',item['tag']],text=True))[0]
 assert actual['Id'] in (item['local_image_id'],item['config_id']),item['tag']
 assert actual['Config']['Labels']['org.opencontainers.image.revision']==manifest['source_commit'],item['tag']
 tags['BACKEND_IMAGE' if 'backend' in item['tag'] else 'WEB_IMAGE']=item['tag']
env=Path('/opt/hajimark/shared/.env');lines=env.read_text().splitlines()
(release/'.env.before-switch').write_text(env.read_text())
out=[f"{k}={tags[k]}" if (k:=l.split('=',1)[0]) in tags else l for l in lines]
nxt=env.with_name('.env.next');nxt.write_text('\n'.join(out)+'\n');nxt.chmod(0o600);nxt.replace(env)
link=Path('/opt/hajimark/.current-next')
if link.is_symlink(): link.unlink()
link.symlink_to(release);link.replace('/opt/hajimark/current')
print('IMAGES_VERIFIED_AND_RELEASE_SELECTED',manifest['release_id'])
PY
docker compose --env-file /opt/hajimark/shared/.env -f /opt/hajimark/current/compose.production.yaml config -q
docker compose --env-file /opt/hajimark/shared/.env -f /opt/hajimark/current/compose.production.yaml up -d --no-build --no-deps --wait --wait-timeout 150 api worker web
curl -fsS --max-time 10 -H 'Host: hajistudy.online' http://127.0.0.1:18080/api/v1/health/ready
curl -fsS --max-time 10 -H 'Host: hajistudy.online' http://127.0.0.1:18080/login -o /dev/null
printf '\nSWITCHED %s\n' "$1"
'@
  $update = @'
#!/bin/bash
# usage: update-release.sh   (run as root inside /opt/hajimark/releases/__RELEASE__)
set -euo pipefail
umask 077
cd /opt/hajimark/releases/__RELEASE__
sha256sum -c <<<"__SHA256__  images.tar.gz"
readlink /opt/hajimark/current > .previous-current
/bin/sh /opt/hajimark/current/backup.sh
docker load -i images.tar.gz
bash ./switch-release.sh __RELEASE__
'@
  $rollback = @'
#!/bin/bash
# usage: rollback.sh   (run as root). Switches images back; never restores the database.
set -euo pipefail
cd /opt/hajimark/releases/__RELEASE__
previous=$(basename "$(cat .previous-current 2>/dev/null || echo /opt/hajimark/releases/__PREVIOUS__)")
bash ./switch-release.sh "$previous"
'@
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
  $env:WEB_IMAGE = ($m.images | Where-Object { $_.tag -like '*web*' }).tag
  try { Run docker @('compose', '-f', "$Bundle/compose.production.yaml", 'config', '-q') }
  finally { Remove-Item Env:POSTGRES_PASSWORD, Env:BACKEND_IMAGE, Env:WEB_IMAGE }
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
    if ((Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:18089/$css").Content -notmatch 'sidebar-title') { throw 'release web image does not contain the UI refresh stylesheet' }
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
    $files = 'images.tar.gz', 'release.json', 'compose.production.yaml', 'backup.sh', 'renew-certificate.sh', 'openresty-hajistudy.conf', 'switch-release.sh', 'update-release.sh', 'rollback.sh' | ForEach-Object { Join-Path $Bundle $_ }
    Step "Upload to $TargetHost`:$RemoteDir, backup, load, switch"
    Invoke-Remote "test ! -e $RemoteDir/images.tar.gz && echo NEW_RELEASE_DIR || (echo 'release dir already has images; refusing to overwrite' && exit 1)"
    Invoke-Remote "chmod 700 $RemoteDir/*.sh && bash $RemoteDir/update-release.sh" $files
    Step 'Public check'
    $r = Invoke-WebRequest -UseBasicParsing https://hajistudy.online/login
    if ($r.StatusCode -ne 200 -or $r.Content -notmatch 'assets/index-') { throw 'public /login check failed' }
    Write-Host "DEPLOYED $ReleaseId" -ForegroundColor Green
  }
  'rollback' { $script:KeyAccess = Get-Remote; Invoke-Remote "bash $RemoteDir/rollback.sh"; Write-Host 'ROLLED_BACK' }
}
