$ErrorActionPreference = 'Stop'
$taskAppRoot=Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $taskAppRoot
foreach ($taskPidFile in @('runtime.pid','lan-runtime.pid')) {
    if (-not (Test-Path -LiteralPath $taskPidFile)) { continue }
    $taskServicePid = [int](Get-Content -LiteralPath $taskPidFile -Raw)
    $taskService = Get-CimInstance Win32_Process -Filter "ProcessId = $taskServicePid"
    if ($null -ne $taskService) {
        $taskMatch = $false
        foreach ($taskFile in @('launch.mjs','server.mjs','lan-gateway.mjs')) {
            if ($taskService.CommandLine.Contains((Join-Path $taskAppRoot $taskFile))) { $taskMatch = $true }
        }
        if ($taskService.Name -ne 'node.exe' -or -not $taskMatch) { throw 'PID does not match this MMDB installation; no process was stopped.' }
        Stop-Process -Id $taskServicePid
    }
    Remove-Item -LiteralPath $taskPidFile -ErrorAction SilentlyContinue
}
Write-Host 'MMDB stopped.'
