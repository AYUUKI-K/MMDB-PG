param([ValidateSet('menu','check','install','start','lan','stop','status','logs','links','ready','ready-lan','script','update','mode-browser','mode-headless','open-pg-on','open-pg-off')][string]$Action='menu',[string]$Package='')
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$OutputEncoding=[Console]::OutputEncoding
$taskAppRoot=Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $taskAppRoot
$taskDownload='https://nodejs.org/en/download'
$taskManager=Join-Path $taskAppRoot 'tools\portable-manager.mjs'

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
    Write-Host '可选择“10 安装 / 修复 Node.js”下载、校验并打开官方安装向导。'
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
    $taskCache=Join-Path $taskAppRoot '.downloads'
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
    if($taskAction -eq 'update' -and $Package) { & $script:taskNode $taskManager $taskAction $Package | Out-Host }
    else { & $script:taskNode $taskManager $taskAction | Out-Host }
    return ($LASTEXITCODE -eq 0)
}
function Invoke-Page([scriptblock]$taskWork) {
    try { & $taskWork } catch { Write-Host "操作未完成：$($_.Exception.Message)" -ForegroundColor Red }
    [void](Read-Host '按回车返回菜单')
}
function Open-Script {
    param([switch]$Prepared)
    if(-not $Prepared) {
        Write-Host '正在检查执行后端；浏览器模式会准备脚本安装页。'
        if(-not (Invoke-Manager 'script')) { return }
    }
    $taskUrl=& $script:taskNode $taskManager 'script-url'
    if($LASTEXITCODE -eq 0 -and $taskUrl -eq 'headless') { Write-Host '当前为独立后端，无需安装浏览器脚本；账号管理请选择 11。'; return }
    if($LASTEXITCODE -ne 0 -or $taskUrl -notmatch '^http://127\.0\.0\.1:\d+/local-pg\.user\.js\?v=\d+\.\d+\.\d+$') { throw '无法取得脚本安装地址。' }
    try { Start-Process -FilePath $taskUrl }
    catch { Write-Host "浏览器未能自动打开，请手动访问：$taskUrl" }
    Write-Host '请使用装有油猴的浏览器打开上面的地址，在浏览器中确认更新后刷新 AI Studio。'
}
function Update-All {
    Write-Host '更新全部：下载源码 → 保留配置与凭证并重启 PG → 检查当前执行后端。'
    if(-not (Invoke-Manager 'update')) { return }
    Open-Script -Prepared
    Write-Host '更新流程已完成；退出并重新打开菜单以加载新版菜单。'
}
function Open-Accounts {
    if(-not (Test-Node)) { Show-Download; return }
    Write-Host '正在准备本机账号管理；首次使用会下载并校验独立运行时…'
    $taskUrl=& $script:taskNode $taskManager 'accounts-url'
    if($LASTEXITCODE -ne 0) { throw '账号管理入口未能启动，请查看上面的提示。' }
    if($taskUrl -notmatch '^http://127\.0\.0\.1:\d+/#[a-f0-9]{64}$') { throw '账号管理地址无效。' }
    try { Start-Process -FilePath $taskUrl }
    catch { Write-Host "浏览器未能自动打开，请在本机手动访问：$taskUrl" }
    Write-Host '可导入账号、设置轮换和恢复、使用 Camoufox 登录；调用与诊断页可筛选并脱敏导出。'
    Write-Host '关闭管理页或退出菜单后，账号管理服务和独立运行时继续运行。'
}
function Start-FromMenu {
    param([string]$Mode='ready')
    if(-not (Invoke-Manager $Mode)) { return }
    $url=& $script:taskNode $taskManager 'playground-target'
    if($LASTEXITCODE -ne 0) { return }
    if($url -eq 'connected') { Write-Host '已有 AI Studio 页面连接，继续使用现有页面，不重复打开。'; return }
    if($url -eq 'disabled') { Write-Host '已关闭启动后自动打开网页；可在菜单 13 开启。'; return }
    if($url -eq 'opened') { Write-Host '本次后台启动已打开过 PG 页面，不重复打开；需要时可手动打开 AI Studio。'; return }
    if($url -ne 'https://aistudio.google.com/prompts/new_chat') { throw '无法确认浏览器打开目标。' }
    Write-Host '正在打开 AI Studio Playground。网页模式需 Meow 激活；独立模式无需网页连接。'
    try { Start-Process -FilePath $url; & $script:taskNode $taskManager 'playground-opened' | Out-Host }
    catch { Write-Host "浏览器未能自动打开，请手动访问：$url" }
}
function Select-Backend {
    if(-not (Test-Node)) { Show-Download; return }
    & $script:taskNode $taskManager 'startup-settings' | Out-Host
    Write-Host '1 网页模式：依赖已登录的 AI Studio 页面；2 独立模式：使用已导入凭证；0 返回。'
    Write-Host '两种模式择一运行。后台运行中会安全重启 PG；正在生成时拒绝切换。'
    switch(Read-Host '选择模式') {
        '1' { [void](Invoke-Manager 'mode-browser') }
        '2' { [void](Invoke-Manager 'mode-headless') }
    }
}
function Select-StartupPage {
    if(-not (Test-Node)) { Show-Download; return }
    & $script:taskNode $taskManager 'startup-settings' | Out-Host
    Write-Host '1 开启启动后打开 AI Studio Playground；2 关闭；0 返回。两种模式均可使用。'
    switch(Read-Host '选择启动行为') {
        '1' { [void](Invoke-Manager 'open-pg-on') }
        '2' { [void](Invoke-Manager 'open-pg-off') }
    }
}
function Select-Unattended {
    if(-not (Test-Node)) { Show-Download; return }
    $taskGuard=Join-Path $taskAppRoot 'tools\unattended.mjs'
    & $script:taskNode $taskGuard 'status' | Out-Host
    Write-Host '1 开启 PG 进程守护；2 关闭守护；3 开启 Windows 登录自启动；4 关闭登录自启动；0 返回。'
    Write-Host '守护只用于独立模式；菜单 6 手动停止会暂停守护，菜单 1 恢复。登录自启动默认关闭。'
    $taskOperation=switch(Read-Host '选择无人值守设置') {
        '1' { 'enable' }; '2' { 'disable' }; '3' { 'autostart-on' }; '4' { 'autostart-off' }
    }
    if($taskOperation) { & $script:taskNode $taskGuard $taskOperation | Out-Host }
}
function Write-MenuText([string]$Text,[ConsoleColor]$Color='Gray') {
    if($null -ne [Environment]::GetEnvironmentVariable('NO_COLOR') -or $env:TERM -eq 'dumb' -or [Console]::IsOutputRedirected) {
        Write-Host $Text
    } else { Write-Host $Text -ForegroundColor $Color }
}
function Show-Menu {
    Write-Host ''
    Write-MenuText "  MEOW-FM · $(Get-MenuVersion)" Magenta
    Write-MenuText '  --------------------------------' DarkGray
    Write-MenuText '  喵喵电波'
    Show-Runtime
    if($script:taskExecutionBackend -eq 'headless') { Write-MenuText '  日常 1   账号 11   更新 2' Cyan }
    else { Write-MenuText '  首次 3   日常 1   更新 2' Cyan }
    Write-Host ''
    Write-MenuText '   1  启动 / 继续使用' Cyan
    Write-MenuText '   2  更新全部' Cyan
    Write-MenuText '   3  安装 / 更新浏览器脚本（浏览器模式）' Cyan
    Write-Host ''
    Write-MenuText '   4  刷新状态 / 连接地址'
    Write-MenuText '   5  查看日志'
    Write-MenuText '   6  停止 PG 反代' Yellow
    Write-MenuText '   7  手机连接此设备'
    Write-MenuText '   8  修复项目依赖'
    Write-MenuText '   9  更新说明'
    Write-MenuText '  10  安装 Node.js'
    Write-MenuText '  11  账号管理（独立后端）' Cyan
    Write-MenuText '  12  选择网页 / 独立模式' Cyan
    Write-MenuText '  13  启动后打开 PG：开启 / 关闭'
    Write-MenuText '  14  无人值守 / Windows 登录自启动' Cyan
    Write-Host ''
    Write-MenuText '   0  退出菜单'
    Write-MenuText '  --------------------------------' DarkGray
    Write-MenuText '  退出菜单后，后台继续运行。'
    if($script:taskExecutionBackend -eq 'headless') { Write-MenuText '  停止 PG 不会退出独立运行时或删除账号凭证。' }
    else { Write-MenuText '  更新脚本后，在油猴确认并刷新 AI Studio。' }
}
function Show-Runtime {
    $script:taskExecutionBackend='unknown'
    try {
        $taskRuntime=Find-Node
        if(-not $taskRuntime) { Write-MenuText '  反代 未启动 · 请先安装 Node.js' Yellow; return }
        $taskSummary=& $taskRuntime $taskManager 'menu-status' 2>$null | ConvertFrom-Json
        if($LASTEXITCODE -ne 0 -or -not $taskSummary.text) { throw '状态不可读' }
        $script:taskExecutionBackend=$taskSummary.executionBackend
        $taskColor='Yellow'; if($taskSummary.ready -and $taskSummary.text -notmatch '后台仍为|选 3 确认|进行中|配置已改变') { $taskColor='Green' }
        foreach($taskLine in ($taskSummary.text -split "`n")) { Write-MenuText "  $taskLine" $taskColor }
        Write-MenuText '  返回菜单时刷新状态，选 4 可重新检查。' DarkGray
    } catch { Write-MenuText '  状态暂不可读 · 选择 4 查看详情' Yellow }
}
function Get-MenuVersion {
    try {
        $version=(Get-Content -LiteralPath (Join-Path $taskAppRoot 'package.json') -Encoding UTF8 -Raw | ConvertFrom-Json).version
        if($version -match '^\d+\.\d+\.\d+$') { return "v$version" }
    } catch {}
    return '版本未知'
}
if($Action -ne 'menu') {
    if(Invoke-Manager $Action) { exit 0 } else { exit 1 }
}
while($true) {
    Show-Menu
    $taskChoice=Read-Host '请选择'
    if($null -eq $taskChoice -or $taskChoice -eq '0') { break }
    switch($taskChoice) {
        '1' { Invoke-Page { Start-FromMenu } }
        '2' { Invoke-Page { Update-All } }
        '3' { Invoke-Page { Open-Script } }
        '4' { Invoke-Page { [void](Invoke-Manager 'check') } }
        '5' { Invoke-Page { [void](Invoke-Manager 'logs') } }
        '6' { Invoke-Page { [void](Invoke-Manager 'stop') } }
        '7' { Invoke-Page { Start-FromMenu -Mode 'ready-lan' } }
        '8' { Invoke-Page { [void](Invoke-Manager 'install') } }
        '9' { Invoke-Page {
            Write-Host '选 2 会直接下载 GitHub main 源码，识别提交并构建；保留 config.json 和 .headless 凭证。'
            Write-Host '独立模式检查后台；浏览器模式打开脚本安装页，需在油猴确认并刷新 AI Studio。'
            Write-Host '旧程序保留在 .updates 中；正在生成时请先结束请求。Git 工作区不会被自动覆盖。'
            Write-Host '维护者推送源码即可供新版菜单更新；修改浏览器脚本时仍需提高版本号。'
        } }
        '10' { Invoke-Page { Install-OfficialNode } }
        '11' { Invoke-Page { Open-Accounts } }
        '12' { Invoke-Page { Select-Backend } }
        '13' { Invoke-Page { Select-StartupPage } }
        '14' { Invoke-Page { Select-Unattended } }
        default { Write-Host '请输入 0–14。' }
    }
}
exit 0
