param(
    [ValidateSet('menu','install','update','start','lan','stop','status')][string]$Action='menu',
    [string]$Package='',
    [string]$ManagerHome=(Join-Path $env:LOCALAPPDATA 'MMDB-PG')
)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$OutputEncoding=[Console]::OutputEncoding
$Base=[IO.Path]::GetFullPath($ManagerHome)
$App=Join-Path $Base 'app'
$State=Join-Path $Base 'manager'
$DefaultSource='https://raw.githubusercontent.com/AYUUKI-K/MMDB-PG/main/downloads/mmdb-pg-latest.zip'
$LegacyApp=$null
foreach($candidate in @($PSScriptRoot,(Join-Path $PSScriptRoot 'mmdb-pg'))) {
    $manifest=Join-Path $candidate 'package.json'
    if(Test-Path -LiteralPath $manifest) {
        if((Get-Content -Encoding UTF8 -LiteralPath $manifest -Raw | ConvertFrom-Json).name -eq 'mmdb-pg') { $LegacyApp=$candidate; break }
    }
}
New-Item -ItemType Directory -Path $Base,$State -Force | Out-Null
function Require-Runtime {
    if(-not (Get-Command node.exe -ErrorAction SilentlyContinue)) { throw '请先安装 Node.js 22+：https://nodejs.org/' }
    & node.exe -e "if(Number(process.versions.node.split('.')[0])<22)process.exit(1)"
    if($LASTEXITCODE -ne 0) { throw '需要 Node.js 22 或更新版本。' }
}
function Get-OwnedService {
    $pidPath=Join-Path $App 'runtime.pid'
    if(-not (Test-Path -LiteralPath $pidPath)) { return $null }
    $serviceId=0
    if(-not [int]::TryParse((Get-Content -Encoding UTF8 -LiteralPath $pidPath -Raw).Trim(),[ref]$serviceId) -or $serviceId -le 1) { throw '运行记录无效，未停止任何进程。' }
    $service=Get-CimInstance Win32_Process -Filter "ProcessId = $serviceId"
    if($null -eq $service) { return $null }
    $launch=[regex]::Escape((Join-Path $App 'launch.mjs'))
    if($service.Name -ne 'node.exe' -or $service.CommandLine -notmatch ('(?:^|["\s])'+$launch+'(?:["\s]|$)')) { throw 'PID 不属于此安装目录，未停止其他程序。' }
    return $service
}
function Stop-Relay {
    $service=Get-OwnedService
    if($null -eq $service) { Write-Host '本目录没有运行中的反代。'; return }
    Stop-Process -Id $service.ProcessId -ErrorAction Stop
    Wait-Process -Id $service.ProcessId -Timeout 10 -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath (Join-Path $App 'runtime.pid') -ErrorAction SilentlyContinue
    Write-Host '反代已停止。'
}
function Get-RelayPort {
    $port=8765
    $configFile=Join-Path $App 'config.json'
    if(Test-Path -LiteralPath $configFile) {
        $config=Get-Content -Encoding UTF8 -LiteralPath $configFile -Raw | ConvertFrom-Json
        if($null -ne $config.port) { $port=[int]$config.port }
    }
    if($env:MMDB_PORT) { $port=[int]$env:MMDB_PORT }
    return $port
}
function Assert-PortFree {
    $port=Get-RelayPort
    $listener=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,$port)
    try { $listener.Start() } catch { throw "端口 $port 已被占用。请先关闭原启动窗口里的旧反代。" } finally { $listener.Stop() }
}
function Build-App([string]$Folder) {
    Push-Location -LiteralPath $Folder
    try {
        if(-not (Test-Path -LiteralPath 'node_modules/ws/package.json')) {
            & npm.cmd ci --omit=dev --no-audit --no-fund
            if($LASTEXITCODE -ne 0) { throw '安装依赖失败；原安装尚未替换。' }
        }
        & node.exe (Join-Path $Folder 'build.mjs')
        if($LASTEXITCODE -ne 0) { throw '构建失败；原安装尚未替换。' }
    } finally { Pop-Location }
}
function Install-Relay([string]$Source) {
    Require-Runtime
    $stage=Join-Path $Base ('stage.'+[guid]::NewGuid().ToString('N'))
    $lockPath=Join-Path $Base 'update.lock'
    # OpenOrCreate plus an exclusive handle: a crash releases the handle automatically.
    $lock=$null
    try { $lock=[IO.File]::Open($lockPath,[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None) }
    catch { throw '已有安装或更新任务，请等待完成。' }
    try {
        New-Item -ItemType Directory -Path $stage | Out-Null
        $zipPath=Join-Path $stage 'package.zip'
        if(-not $Source) { $Source=$DefaultSource }
        if($Source -match '^https://') {
            Write-Host '正在下载最新版…'
            [Net.ServicePointManager]::SecurityProtocol=[Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
            $downloadSource=$Source
            if($Source -eq $DefaultSource) { $downloadSource=$Source+'?_mmdb='+[DateTimeOffset]::UtcNow.ToUnixTimeSeconds() }
            Invoke-WebRequest -UseBasicParsing -Uri $downloadSource -OutFile $zipPath -TimeoutSec 120
        } else { Copy-Item -LiteralPath $Source -Destination $zipPath }
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $zip=[IO.Compression.ZipFile]::OpenRead($zipPath)
        try {
            $names=New-Object 'System.Collections.Generic.HashSet[string]'
            $expandedSize=0L
            foreach($entry in $zip.Entries) {
                $name=$entry.FullName
                $expandedSize+=$entry.Length
                if(-not $name.StartsWith('mmdb-pg/') -or $name.Contains('\') -or $name -match '(^|/)\.{1,2}(/|$)|[\x00-\x1f]' -or -not $names.Add($name) -or (($entry.ExternalAttributes -shr 16) -band 61440) -eq 40960) { throw '安装包路径不安全或存在重复文件。' }
            }
            if($expandedSize -gt 100MB) { throw '安装包解压大小超过 100MB。' }
            foreach($required in @('package.json','package-lock.json','launch.mjs','server.mjs','build.mjs')) {
                if(-not $names.Contains('mmdb-pg/'+$required)) { throw '不是完整的 MMDB 安装包。' }
            }
        } finally { $zip.Dispose() }
        $unpacked=Join-Path $stage 'unpacked'
        [IO.Compression.ZipFile]::ExtractToDirectory($zipPath,$unpacked)
        $next=Join-Path $unpacked 'mmdb-pg'
        $manifest=Get-Content -Encoding UTF8 -LiteralPath (Join-Path $next 'package.json') -Raw | ConvertFrom-Json
        if($manifest.name -ne 'mmdb-pg' -or $manifest.version -notmatch '^\d+\.\d+\.\d+$') { throw '安装包标识或版本无效。' }
        $oldManifest=Join-Path $App 'package.json'
        if(Test-Path -LiteralPath $oldManifest) {
            $old=Get-Content -Encoding UTF8 -LiteralPath $oldManifest -Raw | ConvertFrom-Json
            if([version]$manifest.version -lt [version]$old.version) { throw '安装包比当前版本旧，已拒绝降级。' }
        } elseif(Test-Path -LiteralPath $App) { throw '目标目录不是已识别的 MMDB 安装，未覆盖。' }
        Build-App $next
        Stop-Relay
        Assert-PortFree
        $preserve=$App
        if(-not (Test-Path -LiteralPath $oldManifest) -and $LegacyApp) { $preserve=$LegacyApp }
        foreach($name in @('config.json','lan-config.json','st-path.json','diagnostics.log')) {
            $file=Join-Path $preserve $name
            if(Test-Path -LiteralPath $file) { Copy-Item -LiteralPath $file -Destination (Join-Path $next $name) }
        }
        $backup=$null
        if(Test-Path -LiteralPath $App) {
            $backup=Join-Path $Base ('backup.'+[guid]::NewGuid().ToString('N'))
            Move-Item -LiteralPath $App -Destination $backup
        }
        try { Move-Item -LiteralPath $next -Destination $App }
        catch { if($backup) { Move-Item -LiteralPath $backup -Destination $App }; throw }
        # Keep a stable double-click entry independent of downloaded/extracted folders.
        foreach($name in @('MMDB.cmd','mmdb-manager.ps1')) {
            $file=Join-Path $App $name
            if(Test-Path -LiteralPath $file) { Copy-Item -LiteralPath $file -Destination (Join-Path $State $name) -Force }
        }
        Write-Host "版本 $($manifest.version) 已安装，配置已保留。"
        if($backup) { Write-Host "上一份安装保留在：$backup" }
        Write-Host "固定入口：$(Join-Path $State 'MMDB.cmd')（可以创建快捷方式）"
        Write-Host '油猴检查 MMDB 本地桥更新后，刷新 AI Studio。'
    } finally {
        # Only delete this invocation's generated stage directory under the verified base.
        if([IO.Path]::GetFullPath($stage).StartsWith($Base+[IO.Path]::DirectorySeparatorChar) -and (Test-Path -LiteralPath $stage)) { Remove-Item -LiteralPath $stage -Recurse -Force }
        $lock.Dispose()
    }
}
function Start-Relay([bool]$LAN=$false) {
    Require-Runtime
    if(-not (Test-Path -LiteralPath (Join-Path $App 'launch.mjs'))) { Install-Relay $Package }
    $running=Get-OwnedService
    if($null -ne $running) {
        $runningLAN=$running.CommandLine -match '(?:^|\s)--lan(?:\s|$)'
        if($runningLAN -eq $LAN) { Write-Host '反代已按所选模式运行，无需重复启动。'; return }
        $apiKey='mmdb'
        $configFile=Join-Path $App 'config.json'
        if(Test-Path -LiteralPath $configFile) {
            $settings=Get-Content -Encoding UTF8 -LiteralPath $configFile -Raw | ConvertFrom-Json
            if($null -ne $settings.apiKey) { $apiKey=$settings.apiKey }
        }
        if($env:MMDB_API_KEY) { $apiKey=$env:MMDB_API_KEY }
        $status=Invoke-RestMethod -Uri ('http://127.0.0.1:'+(Get-RelayPort)+'/v1/status') -Headers @{Authorization=('Bearer '+$apiKey)} -TimeoutSec 5
        if($null -eq $status.pending -or $status.pending -ne 0) { throw '仍有请求运行或无法确认空闲，请等待生成完成后再切换启动模式。' }
        Write-Host '正在切换启动模式…'
        Stop-Relay
    }
    Assert-PortFree
    Build-App $App
    $mode='local'; if($LAN) { $mode='lan' }
    Set-Content -LiteralPath (Join-Path $State 'start-mode') -Value $mode -Encoding Ascii
    $argsText='"'+(Join-Path $App 'launch.mjs')+'"'; if($LAN) { $argsText+=' --lan' }
    $service=Start-Process -FilePath (Get-Command node.exe).Source -ArgumentList $argsText -WorkingDirectory $App -WindowStyle Hidden -RedirectStandardOutput (Join-Path $State 'service.log') -RedirectStandardError (Join-Path $State 'error.log') -PassThru
    for($i=0;$i -lt 80;$i++) {
        Start-Sleep -Milliseconds 250
        $service.Refresh()
        if($service.HasExited) { Show-Logs; throw '启动失败，请查看以上日志。' }
        if(Test-Path -LiteralPath (Join-Path $App 'runtime.pid')) {
            if((Get-Content -Encoding UTF8 -LiteralPath (Join-Path $App 'runtime.pid') -Raw).Trim() -eq [string]$service.Id) {
                Write-Host '反代已在后台启动，返回菜单不会停止服务。'
                Show-Logs
                return
            }
        }
    }
    Write-Host '启动仍在准备，请在日志页确认结果，不要重复启动。'
}
function Show-Logs {
    foreach($name in @('service.log','error.log')) {
        $file=Join-Path $State $name
        if(Test-Path -LiteralPath $file) { Get-Content -Encoding UTF8 -LiteralPath $file -Tail 40 }
    }
    $file=Join-Path $App 'diagnostics.log'
    if(Test-Path -LiteralPath $file) {
        try {
            Write-Host '—— 最近请求（不显示正文和密钥）——'
            @(Get-Content -Encoding UTF8 -LiteralPath $file -Raw | ConvertFrom-Json) | Select-Object -First 6 | ForEach-Object {
                Write-Host "$($_.startedAt) | $($_.model) | $($_.status) | $([math]::Round($_.elapsedMs/1000)) 秒 | $($_.errorCode)"
                if($null -ne $_.pageVisibility) { Write-Host "  页面=$($_.pageVisibility) 在线=$($_.browserOnline) 定时器最长间隔=$($_.maxTimerGapMs)ms 鉴权刷新=$($_.authRefreshed)" }
            }
        } catch { Write-Host '诊断日志暂不可读，请稍后刷新。' }
    }
}
function Show-Status {
    $file=Join-Path $App 'package.json'
    if(Test-Path -LiteralPath $file) { Write-Host "已安装版本：$((Get-Content -Encoding UTF8 -LiteralPath $file -Raw | ConvertFrom-Json).version)" } else { Write-Host '尚未安装。' }
    $service=Get-OwnedService
    if($service) { Write-Host "运行中，PID：$($service.ProcessId)" } else { Write-Host '本目录未运行。' }
}
function Wait-Back { while((Read-Host '输入 0 返回') -ne '0') {} }
function Invoke-Page([scriptblock]$Task) {
    try { & $Task } catch { Write-Host "操作未完成：$($_.Exception.Message)" -ForegroundColor Red }
    Wait-Back
}
function Update-AndStart {
    $lan=$false
    $modeFile=Join-Path $State 'start-mode'
    if(Test-Path -LiteralPath $modeFile) { $lan=(Get-Content -Encoding UTF8 -LiteralPath $modeFile -Raw).Trim() -eq 'lan' }
    Install-Relay $Package
    Start-Relay $lan
}
switch($Action) {
    install { Install-Relay $Package }
    update { Update-AndStart }
    start { Start-Relay }
    lan { Start-Relay $true }
    stop { Stop-Relay }
    status { Show-Status }
    menu {
        $exitMenu=$false
        while(-not $exitMenu) {
            Write-Host "`n========== MMDB 本地反代 ==========`n1) 启动反代`n2) 安装 / 更新（完成后启动）`n3) 查看日志`n4) 停止反代`n5) 版本与状态`n0) 退出菜单（反代继续运行）"
            switch(Read-Host '请选择') {
                '1' {
                    $back=$false
                    while(-not $back) {
                        Write-Host "`n1) 本机使用`n2) 让手机连接电脑（局域网）`n0) 返回"
                        switch(Read-Host '请选择') { '1' { Invoke-Page { Start-Relay } }; '2' { Invoke-Page { Start-Relay $true } }; '0' { $back=$true }; default { Write-Host '请输入 0–2。' } }
                    }
                }
                '2' { Invoke-Page { Update-AndStart } }
                '3' {
                    do { Show-Logs; $key=Read-Host '输入 1 刷新，0 返回' } while($key -ne '0')
                }
                '4' { Invoke-Page { Stop-Relay } }
                '5' { Invoke-Page { Show-Status } }
                '0' { $exitMenu=$true }
                default { Write-Host '请输入 0–5。' }
            }
        }
    }
}
