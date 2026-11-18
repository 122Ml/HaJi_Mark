param([switch]$Check)
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $repo
$node = (Get-Command node -ErrorAction Stop).Source
$python = (Get-Command python -ErrorAction Stop).Source
$env:HAJIMARK_NODE = $node
$env:PYTHONIOENCODING = 'utf-8'
$moduleRoots = @("$repo/web/node_modules", "$repo/node_modules")
if ($env:NODE_PATH) { $moduleRoots += $env:NODE_PATH.Split(';') }
$runtime = Get-AppxPackage -Name 'OpenAI.CodexPrimaryRuntime*' | Sort-Object Version -Descending | Select-Object -First 1
if ($runtime) { $moduleRoots += Join-Path $runtime.InstallLocation 'dependencies/node/node_modules' }
$env:NODE_PATH = ($moduleRoots | Select-Object -Unique) -join ';'
& $node -e "require('playwright');"
if ($LASTEXITCODE -ne 0) { throw '未找到 Playwright。请安装项目已有的浏览器验收依赖或从 Codex 运行此入口。' }
$health = Invoke-WebRequest 'http://127.0.0.1:18080/api/v1/health/ready' -SkipHttpErrorCheck
if ($health.StatusCode -ne 200) { throw '本地平台未就绪，请先启动 Docker 容器。' }
if ($Check) {
  & $python -X utf8 -B scripts/auto-demo/controller.py --self-test
  exit $LASTEXITCODE
}
Start-Process -FilePath $python -ArgumentList @('-X','utf8','-B',"`"$repo/scripts/auto-demo/controller.py`"") -WorkingDirectory $repo -WindowStyle Hidden
Write-Host '演示控制窗已启动。快捷键为 Ctrl + Alt + D；被占用时改用 Ctrl + Alt + Shift + D，以窗口显示为准。'
