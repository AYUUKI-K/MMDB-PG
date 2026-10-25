param([switch]$LAN)
$ErrorActionPreference = 'Stop'
$taskAppRoot=Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $taskAppRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Please install Node.js 22 or newer.' }
& node -e "if(Number(process.versions.node.split('.')[0])<22)process.exit(1)"
if ($LASTEXITCODE -ne 0) { throw 'Please install Node.js 22 or newer.' }
if (-not (Test-Path -LiteralPath 'node_modules/ws/package.json')) {
    & npm.cmd ci --omit=dev --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
}
& node (Join-Path $taskAppRoot 'build.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
$taskArguments = @((Join-Path $taskAppRoot 'launch.mjs'))
if ($LAN) { $taskArguments += '--lan' }
& node @taskArguments
if ($LASTEXITCODE -ne 0) { throw 'MMDB could not start. Check the error above; stop the existing service before upgrading.' }
