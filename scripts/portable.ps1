param([ValidateSet('menu','check','install','start','lan','stop','status','logs','links','ready','ready-lan','script','update')][string]$Action='menu',[string]$Package='')
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
        Write-Host '正在准备脚本安装页；后台未运行时会自动启动。'
        if(-not (Invoke-Manager 'script')) { return }
    }
    $taskUrl=& $script:taskNode $taskManager 'script-url'
    if($LASTEXITCODE -ne 0 -or $taskUrl -notmatch '^http://127\.0\.0\.1:\d+/local-pg\.user\.js\?v=\d+\.\d+\.\d+$') { throw '无法取得脚本安装地址。' }
    try { Start-Process -FilePath $taskUrl }
    catch { Write-Host "浏览器未能自动打开，请手动访问：$taskUrl" }
    Write-Host '请使用装有油猴的浏览器打开上面的地址，在浏览器中确认更新后刷新 AI Studio。'
}
function Update-All {
    Write-Host '更新全部：下载源码 → 保留配置并重启后台 → 打开油猴脚本更新页。'
    if(-not (Invoke-Manager 'update')) { return }
    Open-Script -Prepared
    Write-Host '程序已更新；请在油猴确认脚本更新，然后刷新 AI Studio。'
}
function Start-FromMenu {
    param([string]$Mode='ready')
    if(-not (Invoke-Manager $Mode)) { return }
    $url=& $script:taskNode $taskManager 'playground-target'
    if($LASTEXITCODE -ne 0) { return }
    if($url -eq 'connected') { Write-Host '已有 AI Studio 页面连接，继续使用现有页面，不重复打开。'; return }
    if($url -ne 'https://aistudio.google.com/prompts/new_chat') { throw '无法确认浏览器打开目标。' }
    Write-Host '后台已就绪，正在打开 AI Studio Playground；登录后点击 Meow 激活。'
    try { Start-Process -FilePath $url }
    catch { Write-Host "浏览器未能自动打开，请手动访问：$url" }
}
function Write-MenuText([string]$Text,[ConsoleColor]$Color='Gray') {
    if($null -ne [Environment]::GetEnvironmentVariable('NO_COLOR') -or $env:TERM -eq 'dumb' -or [Console]::IsOutputRedirected) {
        Write-Host $Text
    } else { Write-Host $Text -ForegroundColor $Color }
}
function Show-Menu {
    Write-Host ''
    Write-MenuText "  MEWO-FM · $(Get-MenuVersion)" Magenta
    Write-MenuText '  --------------------------------' DarkGray
    Write-MenuText '  喵喵电波'
    Show-Runtime
    Write-MenuText '  首次 3   日常 1   更新 2' Cyan
    Write-Host ''
    Write-MenuText '   1  启动 / 继续使用' Cyan
    Write-MenuText '   2  更新全部' Cyan
    Write-MenuText '   3  安装 / 更新浏览器脚本' Cyan
    Write-Host ''
    Write-MenuText '   4  刷新状态 / 连接地址'
    Write-MenuText '   5  查看日志'
    Write-MenuText '   6  停止后台' Yellow
    Write-MenuText '   7  手机连接此设备'
    Write-MenuText '   8  修复项目依赖'
    Write-MenuText '   9  更新说明'
    Write-MenuText '  10  安装 Node.js'
    Write-Host ''
    Write-MenuText '   0  退出菜单'
    Write-MenuText '  --------------------------------' DarkGray
    Write-MenuText '  退出菜单后，后台继续运行。'
    Write-MenuText '  更新脚本后，在油猴确认并刷新 AI Studio。'
}
function Show-Runtime {
    try {
        $taskRuntime=Find-Node
        if(-not $taskRuntime) { Write-MenuText '  反代 未启动 · 请先安装 Node.js' Yellow; return }
        $taskSummary=& $taskRuntime $taskManager 'menu-status' 2>$null | ConvertFrom-Json
        if($LASTEXITCODE -ne 0 -or -not $taskSummary.text) { throw '状态不可读' }
        $taskColor='Yellow'; if($taskSummary.backend -eq 'running' -and $taskSummary.browser -eq 'connected' -and $taskSummary.text -notmatch '后台仍为|选 3 确认|进行中') { $taskColor='Green' }
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
            Write-Host '选 2 会直接下载 GitHub main 源码，识别提交并构建，更新本目录后打开脚本安装页；无需访问令牌。'
            Write-Host '旧程序保留在 .updates 中；正在生成时请先结束请求。Git 工作区不会被自动覆盖。'
            Write-Host '维护者推送源码即可供新版菜单更新；修改浏览器脚本时仍需提高版本号。'
        } }
        '10' { Invoke-Page { Install-OfficialNode } }
        default { Write-Host '请输入 0–10。' }
    }
}
exit 0
