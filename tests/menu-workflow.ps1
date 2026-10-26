$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
function Import-Functions($File,$Names) {
    $tokens=$null; $errors=$null
    $ast=[System.Management.Automation.Language.Parser]::ParseFile($File,[ref]$tokens,[ref]$errors)
    if($errors.Count) { throw 'PowerShell parse failed' }
    foreach($name in $Names) {
        $definition=$ast.Find({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true)
        Set-Item -Path ('Function:script:'+$name) -Value ([scriptblock]::Create($definition.Body.Extent.Text.TrimStart('{').TrimEnd('}')))
    }
}
$script:opened=@()
function Start-Process { param($FilePath) $script:opened+=,$FilePath }
function Read-Host { throw 'Unexpected extra confirmation' }
Import-Functions (Join-Path $PSScriptRoot '..\scripts\portable.ps1') @('Open-Script','Update-All','Start-FromMenu')
$script:ready=$false
function Invoke-Manager { param($Action) return $script:ready }
function Test-NodeCommand { param($Manager,$Action); $global:LASTEXITCODE=0; if($Action -eq 'playground-target') { return $script:playgroundTarget }; return 'http://127.0.0.1:18765/local-pg.user.js?v=1.7.4' }
$script:playgroundTarget='https://aistudio.google.com/prompts/new_chat'
$script:taskNode='Test-NodeCommand'; $taskManager='unused'
Open-Script
if($script:opened.Count) { throw 'Browser opened after preparation failed' }
Update-All
if($script:opened.Count) { throw 'Browser opened after program update failed' }
$script:ready=$true
Open-Script
if($script:opened.Count -ne 1 -or $script:opened[0] -ne 'http://127.0.0.1:18765/local-pg.user.js?v=1.7.4') { throw 'Portable script URL was not opened' }
Update-All
if($script:opened.Count -ne 2) { throw 'Update-all did not proceed to the browser step' }
$script:opened=$script:opened[0..0]
$script:ready=$false
Start-FromMenu
if($script:opened.Count -ne 1) { throw 'Playground opened after backend startup failed' }
$script:ready=$true
Start-FromMenu -Mode 'ready-lan'
if($script:opened.Count -ne 2 -or $script:opened[1] -ne 'https://aistudio.google.com/prompts/new_chat') { throw 'Playground did not open after backend readiness' }
$script:playgroundTarget='connected'
Start-FromMenu
if($script:opened.Count -ne 2) { throw 'Duplicate connected Playground was opened' }
$script:opened=$script:opened[0..0]

$App=Join-Path ([IO.Path]::GetTempPath()) ('mmdb-menu-test-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $App | Out-Null
try {
    Set-Content -LiteralPath (Join-Path $App 'package.json') -Value '{"version":"1.7.4"}'
    Import-Functions (Join-Path $PSScriptRoot '..\mmdb-manager.ps1') @('Prepare-Script','Open-Script','Open-Playground')
    function Continue-Relay { Write-Output 'service preparation output' }
    function Build-App { Write-Output 'build output' }
    function Get-RelayStatus { return [pscustomobject]@{version='1.7.4';pending=1;active=@();executorOnline=$script:connected} }
    function Start-Sleep { param($Milliseconds) }
    $script:connected=$false
    function Get-RelayPort { return 18765 }
    $script:invalid=$false
    function Invoke-WebRequest {
        param($Uri,$TimeoutSec,$MaximumRedirection,[switch]$UseBasicParsing)
        if($script:invalid) { return [pscustomobject]@{Content='not a userscript'} }
        return [pscustomobject]@{Content=[Text.Encoding]::UTF8.GetBytes("// ==UserScript==`n// @version      1.7.4`n// ==/UserScript==`n")}
    }
    Open-Script
    if($script:opened.Count -ne 2 -or $script:opened[1] -isnot [string] -or $script:opened[1] -ne $script:opened[0]) { throw 'Build output leaked into browser URL' }
    $script:invalid=$true
    try { Open-Script; throw 'Invalid script was accepted' } catch { if($_.Exception.Message -notmatch '脚本尚未就绪') { throw } }
    if($script:opened.Count -ne 2) { throw 'Invalid script opened in browser' }
    Open-Playground
    if($script:opened.Count -ne 3 -or $script:opened[2] -ne 'https://aistudio.google.com/prompts/new_chat') { throw 'Fixed manager did not open Playground' }
    $script:connected=$true
    Open-Playground
    if($script:opened.Count -ne 3) { throw 'Fixed manager opened a duplicate connected page' }
    function Get-RelayStatus { throw 'backend not ready' }
    try { Open-Playground; throw 'unready backend accepted' } catch { if($_.Exception.Message -ne 'backend not ready') { throw } }
    if($script:opened.Count -ne 3) { throw 'Fixed manager opened Playground before readiness' }
    Write-Output 'PASS: menu opens only the verified URL, without an extra confirmation or output contamination.'
} finally {
    $resolved=[IO.Path]::GetFullPath($App)
    $tempRoot=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')+'\'
    if($resolved.StartsWith($tempRoot) -and [IO.Path]::GetFileName($resolved).StartsWith('mmdb-menu-test-')) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
