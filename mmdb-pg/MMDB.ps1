param([ValidateSet('menu','check','install','start','lan','stop','status','logs','links')][string]$Action='menu')
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$OutputEncoding=[Console]::OutputEncoding
Set-Location -LiteralPath $PSScriptRoot
$taskDownload='https://nodejs.org/en/download'
$taskManager=Join-Path $PSScriptRoot 'tools\portable-manager.mjs'

function Find-Node {
    # Discover a newly installed official runtime without replacing the user's PATH.
    $taskCommand=Get-Command node.exe -ErrorAction SilentlyContinue
    if($taskCommand) { return $taskCommand.Source }
    foreach($taskFolder in @((Join-Path $env:ProgramFiles 'nodejs'),(Join-Path $env:LOCALAPPDATA 'Programs\nodejs'))) {
        $taskCandidate=Join-Path $taskFolder 'node.exe'
        if(Test-Path -LiteralPath $taskCandidate) { $env:Path=$taskFolder+';'+$env:Path; return $taskCandidate }
    }
    return $null
}
function Test-Node {
    $script:taskNode=Find-Node
    if(-not $script:taskNode) { Write-Host '未检测到 Node.js。'; return $false }
    $taskVersion=& $script:taskNode --version
    if($LASTEXITCODE -ne 0 -or $taskVersion -notmatch '^v(\d+)\.') { Write-Host 'Node.js 无法正常运行。'; return $false }
    Write-Host "Node.js：$taskVersion"
    if([int]$Matches[1] -lt 22) { Write-Host '版本过低，需要 Node.js 22 或更新的 LTS 版本。'; return $false }
    return $true
}
function Show-Download {
    Write-Host "官方下载：$taskDownload"
    Write-Host '请选择适合系统的 LTS 安装器，保留 npm 组件。安装完成后回菜单重新检测；如仍找不到，请关闭并重新打开菜单。'
    Write-Host '可选择菜单 8 从官网自动下载、校验并打开安装向导；安装步骤由你确认。'
}
function Get-InstallerHash([string]$File) {
    $taskStream=[IO.File]::OpenRead($File)
    $taskHasher=[Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($taskHasher.ComputeHash($taskStream))).Replace('-','').ToLowerInvariant() }
    finally { $taskHasher.Dispose(); $taskStream.Dispose() }
}
function Install-OfficialNode {
    if(Test-Node) {
        if((Read-Host 'Node.js 已满足要求。输入 1 继续下载官方 LTS 修复 / 升级，其他键返回') -ne '1') { return }
    }
    $taskArch=$env:PROCESSOR_ARCHITEW6432
    if(-not $taskArch) { $taskArch=$env:PROCESSOR_ARCHITECTURE }
    switch($taskArch.ToUpperInvariant()) { 'AMD64' { $taskArch='x64' }; 'ARM64' { $taskArch='arm64' }; default { throw '当前架构不支持自动选择安装器，请使用官网手动选择。' } }
    [Net.ServicePointManager]::SecurityProtocol=[Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    Write-Host '正在查询 nodejs.org 官方 LTS 版本…'
    $taskIndex=Invoke-WebRequest -UseBasicParsing -Uri 'https://nodejs.org/dist/index.json' -MaximumRedirection 0 -TimeoutSec 30
    $taskReleases=ConvertFrom-Json -InputObject $taskIndex.Content
    $taskRelease=$taskReleases | Where-Object { $_.lts -and $_.version -match '^v\d+\.\d+\.\d+$' -and [int]$_.version.Split('.')[0].Substring(1) -ge 22 -and $_.files -contains "win-$taskArch-msi" } | Sort-Object { [version]$_.version.Substring(1) } -Descending | Select-Object -First 1
    if(-not $taskRelease) { throw '官方目录中没有适合当前架构的 Node.js LTS 安装器。' }
    $taskVersion=$taskRelease.version
    $taskName="node-$taskVersion-$taskArch.msi"
    $taskBase="https://nodejs.org/dist/$taskVersion/"
    $taskSums=(Invoke-WebRequest -UseBasicParsing -Uri ($taskBase+'SHASUMS256.txt') -MaximumRedirection 0 -TimeoutSec 30).Content
    $taskExpected=$null
    foreach($taskLine in ($taskSums -split "`n")) {
        if($taskLine.Trim() -match ('^([0-9a-fA-F]{64})\s+'+[regex]::Escape($taskName)+'$')) { $taskExpected=$Matches[1].ToLowerInvariant(); break }
    }
    if(-not $taskExpected) { throw '没有找到官方 SHA-256 校验值，未运行安装器。' }
    $taskCache=Join-Path $PSScriptRoot '.downloads'
    New-Item -ItemType Directory -Path $taskCache -Force | Out-Null
    $taskDestination=Join-Path $taskCache $taskName
    $taskTemp=Join-Path $taskCache ([guid]::NewGuid().ToString('N')+'.part')
    try {
        $taskCached=(Test-Path -LiteralPath $taskDestination) -and (Get-InstallerHash $taskDestination) -eq $taskExpected
        if(-not $taskCached) {
            Write-Host "下载官方安装器：$taskName"
            Invoke-WebRequest -UseBasicParsing -Uri ($taskBase+$taskName) -OutFile $taskTemp -MaximumRedirection 0 -TimeoutSec 300
            if((Get-InstallerHash $taskTemp) -ne $taskExpected) { throw '下载文件校验不一致，未运行安装器，请重试。' }
            Move-Item -LiteralPath $taskTemp -Destination $taskDestination -Force
        }
        Write-Host 'SHA-256 校验通过。即将打开官方安装向导，请保留 npm 组件并按向导完成安装。'
        # An interactive installer is deliberate here; never run it silently.
        $taskInstaller=Start-Process -FilePath 'msiexec.exe' -ArgumentList @('/i',('"'+$taskDestination+'"')) -Wait -PassThru
        if($taskInstaller.ExitCode -eq 1602) { Write-Host '安装已取消，安装器保留在 .downloads 中。'; return }
        if($taskInstaller.ExitCode -notin @(0,3010)) { throw "安装器返回代码 $($taskInstaller.ExitCode)，请按安装器提示处理。" }
        if($taskInstaller.ExitCode -eq 3010) { Write-Host '安装器提示需要重启系统。' }
        Write-Host '安装向导已结束，正在重新检测。'
        [void](Test-Node)
    } finally { if(Test-Path -LiteralPath $taskTemp) { Remove-Item -LiteralPath $taskTemp -Force } }
}
function Invoke-Manager([string]$taskAction) {
    if(-not (Test-Node)) { Show-Download; return $false }
    $taskNpm=Get-Command npm.cmd -ErrorAction SilentlyContinue
    if($taskAction -eq 'check' -or $taskAction -eq 'install') {
        if($taskNpm) {
            $taskNpmVersion=& $taskNpm.Source --version
            if($LASTEXITCODE -ne 0) { Write-Host 'npm 无法正常运行。'; $taskNpm=$null }
            else { Write-Host "npm：$taskNpmVersion" }
        }
        if(-not $taskNpm) {
            Write-Host '未检测到可用的 npm。安装项目依赖需要 npm；可通过官方 Node.js 安装器修复。'
            Show-Download
            if($taskAction -eq 'install') { return $false }
        }
    }
    & $script:taskNode $taskManager $taskAction | Out-Host
    return ($LASTEXITCODE -eq 0)
}
function Invoke-Page([scriptblock]$taskWork) {
    try { & $taskWork } catch { Write-Host "操作未完成：$($_.Exception.Message)" -ForegroundColor Red }
    [void](Read-Host '按回车返回菜单')
}
if($Action -ne 'menu') {
    if(Invoke-Manager $Action) { exit 0 } else { exit 1 }
}
Write-Host '首次使用请先选择 1 检测，再选择 2 安装项目依赖。无需管理员权限。'
while($true) {
    Write-Host "`n========== MMDB 便携管理菜单 ==========`n1) 检测依赖与运行状态`n2) 安装 / 修复项目依赖（npm 官方源）`n3) 启动本机反代`n4) 启动局域网反代`n5) 停止本目录后台`n6) 安装 / 更新浏览器脚本`n7) 查看运行日志`n8) 下载并安装官方 Node.js LTS`n0) 退出菜单（后台继续运行）"
    $taskChoice=Read-Host '请选择'
    if($null -eq $taskChoice -or $taskChoice -eq '0') { break }
    switch($taskChoice) {
        '1' { Invoke-Page { [void](Invoke-Manager 'check') } }
        '2' { Invoke-Page { [void](Invoke-Manager 'install') } }
        '3' { Invoke-Page { [void](Invoke-Manager 'start') } }
        '4' { Invoke-Page { [void](Invoke-Manager 'lan') } }
        '5' { Invoke-Page { [void](Invoke-Manager 'stop') } }
        '6' { Invoke-Page {
            if(Invoke-Manager 'links') {
                Write-Host '请先启动后台。油猴安装确认需要自己点击；安装后刷新 AI Studio 并发送 hi。'
                if((Read-Host '输入 1 打开脚本安装页，其他键返回') -eq '1') {
                    $taskUrl=& $script:taskNode $taskManager 'script-url'
                    if($LASTEXITCODE -eq 0 -and $taskUrl -match '^http://127\.0\.0\.1:\d+/local-pg\.user\.js\?v=\d+\.\d+\.\d+$') { Start-Process -FilePath $taskUrl }
                }
            }
        } }
        '7' { Invoke-Page { [void](Invoke-Manager 'logs') } }
        '8' { Invoke-Page { Install-OfficialNode } }
        default { Write-Host '请输入 0–8。' }
    }
}
