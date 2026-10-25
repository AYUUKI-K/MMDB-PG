$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
Import-Module Microsoft.PowerShell.Utility
$taskRoot=Join-Path ([IO.Path]::GetTempPath()) ('mmdb-installer-test-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $taskRoot | Out-Null
$taskTokens=$null; $taskErrors=$null
$taskAst=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '..\scripts\portable.ps1'),[ref]$taskTokens,[ref]$taskErrors)
if($taskErrors.Count) { throw 'PowerShell parse failed' }
foreach($taskName in @('Test-Node','Show-Download','Get-InstallerHash')) {
    $taskDefinition=$taskAst.Find({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $taskName},$true)
    . ([scriptblock]::Create($taskDefinition.Extent.Text))
}
function Find-Node { return $null }
$taskDownload='https://nodejs.org/en/download'
if(Test-Node) { throw 'missing Node was accepted' }
Show-Download
function Test-NodeBinary { $global:LASTEXITCODE=0; return $script:taskFakeVersion }
function Find-Node { return 'Test-NodeBinary' }
$script:taskFakeVersion='v20.20.2'
if(Test-Node) { throw 'outdated Node was accepted' }
$script:taskFakeVersion='v24.22.1'
if(-not (Test-Node)) { throw 'supported Node was rejected' }
$taskFunction=$taskAst.Find({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Install-OfficialNode'},$true)
$taskCode=$taskFunction.Extent.Text.Replace('$taskAppRoot',("'"+$taskRoot.Replace("'","''")+"'"))
. ([scriptblock]::Create($taskCode))
$script:taskBody=[Text.Encoding]::UTF8.GetBytes('synthetic installer; never executed')
$taskHasher=[Security.Cryptography.SHA256]::Create()
$script:taskDigest=([BitConverter]::ToString($taskHasher.ComputeHash($script:taskBody))).Replace('-','').ToLowerInvariant()
$taskHasher.Dispose()
$script:taskCalls=0; $script:taskRequests=0; $script:taskReady=$false; $script:taskCorrupt=$false; $script:taskNoHash=$false
function Test-Node { return $script:taskReady }
function Read-Host { param($Prompt) return '0' }
function Invoke-WebRequest {
    param($Uri,$OutFile,$MaximumRedirection,$TimeoutSec,[switch]$UseBasicParsing)
    $script:taskRequests++
    if($Uri -notmatch '^https://nodejs\.org/dist/') { throw 'unexpected download host' }
    if($Uri.EndsWith('/index.json')) {
        return [pscustomobject]@{Content='[{"version":"v26.12.1","lts":false,"files":["win-x64-msi","win-arm64-msi"]},{"version":"v22.23.4","lts":"Jod","files":["win-x64-msi","win-arm64-msi"]},{"version":"v24.22.1","lts":"Krypton","files":["win-x64-msi","win-arm64-msi"]}]'}
    }
    if($Uri.EndsWith('/SHASUMS256.txt')) {
        if($script:taskNoHash) { return [pscustomobject]@{Content='no matching checksum'} }
        return [pscustomobject]@{Content=($script:taskDigest+'  node-v24.22.1-x64.msi'+[Environment]::NewLine+$script:taskDigest+'  node-v24.22.1-arm64.msi')}
    }
    if(-not $OutFile) { throw 'missing output path' }
    if($script:taskCorrupt) { [IO.File]::WriteAllText($OutFile,'corrupt') }
    else { [IO.File]::WriteAllBytes($OutFile,$script:taskBody) }
}
function Start-Process {
    param($FilePath,$ArgumentList,[switch]$Wait,[switch]$PassThru)
    if($FilePath -ne 'msiexec.exe' -or $ArgumentList[0] -ne '/i' -or -not $Wait -or -not $PassThru) { throw 'unexpected installer command' }
    if($ArgumentList -contains '/qn' -or $ArgumentList -contains '/quiet') { throw 'silent install forbidden' }
    $script:taskCalls++
    return [pscustomobject]@{ExitCode=0}
}
try {
    $script:taskReady=$true
    Install-OfficialNode
    if($script:taskRequests -ne 0 -or $script:taskCalls -ne 0) { throw 'installed runtime should not download after cancel' }
    $script:taskReady=$false
    Install-OfficialNode
    if($script:taskCalls -ne 1) { throw 'verified installer not offered' }
    $taskFiles=@(Get-ChildItem -LiteralPath (Join-Path $taskRoot '.downloads') -Filter '*.msi')
    if($taskFiles.Count -ne 1) { throw 'verified cache missing' }
    $taskRequestsBefore=$script:taskRequests
    Install-OfficialNode
    if($script:taskRequests -ne ($taskRequestsBefore+2)) { throw 'valid cache was downloaded again' }
    Remove-Item -LiteralPath $taskFiles[0].FullName
    $script:taskCorrupt=$true; $taskCallsBefore=$script:taskCalls
    try { Install-OfficialNode; throw 'corrupt installer accepted' } catch { if($_.Exception.Message -notmatch '校验不一致') { throw } }
    if($script:taskCalls -ne $taskCallsBefore) { throw 'corrupt installer was executed' }
    if(@(Get-ChildItem -LiteralPath (Join-Path $taskRoot '.downloads') -Filter '*.part').Count) { throw 'partial file leaked' }
    $script:taskNoHash=$true
    try { Install-OfficialNode; throw 'missing checksum accepted' } catch { if($_.Exception.Message -notmatch '没有找到官方') { throw } }
    if($script:taskCalls -ne $taskCallsBefore) { throw 'unverified installer was executed' }
    Write-Output 'PASS: existing runtime, official origin, SHA-256, cache, corruption and interactive installer handling.'
} finally {
    $taskResolved=[IO.Path]::GetFullPath($taskRoot)
    $taskTempRoot=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')+'\'
    if($taskResolved.StartsWith($taskTempRoot) -and [IO.Path]::GetFileName($taskResolved).StartsWith('mmdb-installer-test-')) { Remove-Item -LiteralPath $taskResolved -Recurse -Force }
}
