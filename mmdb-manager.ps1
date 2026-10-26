param(
    [ValidateSet('menu','install','update','start','lan','stop','status','script','update-all')][string]$Action='menu',
    [string]$Package='',
    [string]$ManagerHome=(Join-Path $env:LOCALAPPDATA 'MMDB-PG')
)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$OutputEncoding=[Console]::OutputEncoding
$Base=[IO.Path]::GetFullPath($ManagerHome)
$App=Join-Path $Base 'app'
$State=Join-Path $Base 'manager'
$DefaultSource='source'
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
    $status=Get-RelayStatus
    if($status.pending -ne 0) { throw '仍有请求运行，请等待生成完成后再停止或更新程序。' }
    $current=Get-OwnedService
    if($null -eq $current -or $current.ProcessId -ne $service.ProcessId) { throw '进程状态已变化，请重新查看状态。' }
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
function Get-RelayStatus {
    $apiKey='mmdb'
    $configFile=Join-Path $App 'config.json'
    if(Test-Path -LiteralPath $configFile) {
        $settings=Get-Content -Encoding UTF8 -LiteralPath $configFile -Raw | ConvertFrom-Json
        if($null -ne $settings.apiKey) { $apiKey=$settings.apiKey }
    }
    if($env:MMDB_API_KEY) { $apiKey=$env:MMDB_API_KEY }
    $status=Invoke-RestMethod -Uri ('http://127.0.0.1:'+(Get-RelayPort)+'/v1/status') -Headers @{Authorization=('Bearer '+$apiKey)} -TimeoutSec 5
    if($null -eq $status.pending -or $null -eq $status.active) { throw '无法确认后台状态，请查看日志。' }
    return $status
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
            & npm.cmd ci --omit=dev --omit=optional --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org/
            if($LASTEXITCODE -ne 0) { throw '安装依赖失败；原安装尚未替换。' }
        }
        & node.exe (Join-Path $Folder 'build.mjs')
        if($LASTEXITCODE -ne 0) { throw '构建失败；原安装尚未替换。' }
    } finally { Pop-Location }
}
function Get-SourceRevision([string]$ZipPath) {
    if((Get-Item -LiteralPath $ZipPath).Length -gt 50MB) { throw '下载文件超过 50MB。' }
    $bytes=[IO.File]::ReadAllBytes($ZipPath)
    for($i=$bytes.Length-22;$i -ge [Math]::Max(0,$bytes.Length-65557);$i--) {
        if([BitConverter]::ToUInt32($bytes,$i) -ne 101010256) { continue }
        $length=[BitConverter]::ToUInt16($bytes,$i+20)
        if($i+22+$length -ne $bytes.Length) { continue }
        $revision=[Text.Encoding]::UTF8.GetString($bytes,$i+22,$length)
        if($revision -cmatch '^[0-9a-f]{40}$') { return $revision }
        break
    }
    throw '源码包缺少有效提交标识，原程序未更改。'
}
function Test-SourceFile([string]$Name) {
    if($Name -match '^(src|scripts|tools|tests|docs|licenses|dist)/') { return $true }
    return $Name -cin @('package.json','package-lock.json','README.md','LICENSE','.gitignore','.gitattributes','build.mjs','launch.mjs','server.mjs','lan-gateway.mjs','lan-config.example.json','MMDB.cmd','MMDB.ps1','mmdb.sh','mmdb-manager.ps1','Start.cmd','Start.ps1','Start-LAN.cmd','Start-LAN.ps1','Stop.cmd','Stop.ps1','Stop-LAN.cmd','Stop-LAN.ps1','start.sh','start-lan.sh')
}
function Install-Relay([string]$Source) {
    Require-Runtime
    if(Test-Path -LiteralPath (Join-Path $App '.git')) { throw '安装目录是 Git 工作区，不能自动覆盖；请使用 Git 工作流更新。' }
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
        $sourceRevision=$null
        $branchSource=$Source -eq 'source'
        if($branchSource) { $Source='https://codeload.github.com/AYUUKI-K/MMDB-PG/zip/refs/heads/main' }
        if($Source -match '^https://') {
            Write-Host '正在下载最新版…'
            [Net.ServicePointManager]::SecurityProtocol=[Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
            $downloadUri=[UriBuilder]::new($Source)
            $stamp='_mmdb='+[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
            $downloadUri.Query=($downloadUri.Query.TrimStart('?')+'&'+$stamp).TrimStart('&')
            Invoke-WebRequest -UseBasicParsing -Uri $downloadUri.Uri.AbsoluteUri -Headers @{'User-Agent'='MMDB-Updater';'Cache-Control'='no-cache'} -OutFile $zipPath -TimeoutSec 120
            if(-not $branchSource) {
            $sumUri=[UriBuilder]::new($Source)
            $sumUri.Path+='.sha256'
            $sumUri.Query='_mmdb='+[DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
            $checksum=(Invoke-WebRequest -UseBasicParsing -Uri $sumUri.Uri.AbsoluteUri -TimeoutSec 30).Content
            if($checksum -is [byte[]]) { $checksum=[Text.Encoding]::UTF8.GetString($checksum) }
            if($checksum -notmatch '^\s*([0-9a-fA-F]{64})\s+') { throw '更新包缺少有效 SHA-256 校验信息。' }
            $expected=$Matches[1]
            if((Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash -ne $expected) { throw '更新包 SHA-256 校验失败，请稍后重试；原程序未更改。' }
            }
        } else { Copy-Item -LiteralPath $Source -Destination $zipPath }
        if((Get-Item -LiteralPath $zipPath).Length -gt 50MB) { throw '下载文件超过 50MB。' }
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $zip=[IO.Compression.ZipFile]::OpenRead($zipPath)
        try {
            $names=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
            $prefix='mmdb-pg/'
            if($branchSource -or $zip.Entries[0].FullName.StartsWith('MMDB-PG-main/')) {
                $sourceRevision=Get-SourceRevision $zipPath
                $prefix='MMDB-PG-main/'
            } elseif($zip.Entries[0].FullName -cmatch '^MMDB-PG-([0-9a-f]{40})/') {
                $sourceRevision=$Matches[1]; $prefix="MMDB-PG-$sourceRevision/"
            }
            $expandedSize=0L
            foreach($entry in $zip.Entries) {
                $name=$entry.FullName
                $expandedSize+=$entry.Length
                if(-not $name.StartsWith($prefix) -or $name.Contains('\') -or $name -match '(^|/)\.{1,2}(/|$)|[\x00-\x1f:<>"|?*]|[ .]/' -or -not $names.Add($name) -or (($entry.ExternalAttributes -shr 16) -band 61440) -eq 40960) { throw '安装包路径不安全或存在重复文件。' }
            }
            if($expandedSize -gt 100MB) { throw '安装包解压大小超过 100MB。' }
            foreach($required in @('package.json','package-lock.json','launch.mjs','server.mjs','build.mjs')) {
                if(-not $names.Contains($prefix+$required)) { throw '不是完整的 MMDB 安装包。' }
            }
            if($sourceRevision) {
                Write-Host "源码提交：$($sourceRevision.Substring(0,12))"
                $receiptFile=Join-Path $App '.source-revision.json'
                if((Test-Path -LiteralPath $receiptFile) -and (Test-Path -LiteralPath (Join-Path $App 'package.json'))) {
                    try {
                        $receipt=Get-Content -LiteralPath $receiptFile -Encoding UTF8 -Raw | ConvertFrom-Json
                        $installed=Get-Content -LiteralPath (Join-Path $App 'package.json') -Encoding UTF8 -Raw | ConvertFrom-Json
                        if($receipt.repository -eq 'AYUUKI-K/MMDB-PG' -and $receipt.commit -eq $sourceRevision -and $receipt.version -eq $installed.version) { Write-Host '已是最新源码，继续准备浏览器脚本。'; return }
                    } catch { Write-Host '源码记录不可读，将重新准备。' }
                }
                $next=Join-Path $stage 'source'
                New-Item -ItemType Directory -Path $next | Out-Null
                foreach($entry in $zip.Entries) {
                    $relative=$entry.FullName.Substring($prefix.Length)
                    if(-not $relative -or $relative.EndsWith('/') -or -not (Test-SourceFile $relative)) { continue }
                    $target=[IO.Path]::GetFullPath((Join-Path $next $relative))
                    if(-not $target.StartsWith($next+[IO.Path]::DirectorySeparatorChar)) { throw '源码文件不在预期目录内。' }
                    New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
                    [IO.Compression.ZipFileExtensions]::ExtractToFile($entry,$target,$false)
                }
            }
        } finally { $zip.Dispose() }
        if(-not $sourceRevision) {
            $unpacked=Join-Path $stage 'unpacked'
            [IO.Compression.ZipFile]::ExtractToDirectory($zipPath,$unpacked)
            $next=Join-Path $unpacked 'mmdb-pg'
        }
        $manifest=Get-Content -Encoding UTF8 -LiteralPath (Join-Path $next 'package.json') -Raw | ConvertFrom-Json
        if($manifest.name -ne 'mmdb-pg' -or $manifest.version -notmatch '^\d+\.\d+\.\d+$') { throw '安装包标识或版本无效。' }
        $oldManifest=Join-Path $App 'package.json'
        if(Test-Path -LiteralPath $oldManifest) {
            $old=Get-Content -Encoding UTF8 -LiteralPath $oldManifest -Raw | ConvertFrom-Json
            if([version]$manifest.version -lt [version]$old.version) { throw '安装包比当前版本旧，已拒绝降级。' }
        } elseif(Test-Path -LiteralPath $App) { throw '目标目录不是已识别的 MMDB 安装，未覆盖。' }
        Build-App $next
        @{repository='AYUUKI-K/MMDB-PG';branch='main';commit=$sourceRevision;version=$manifest.version} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $next '.source-revision.json') -Encoding UTF8
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
        $status=Get-RelayStatus
        if($null -eq $status.pending -or $status.pending -ne 0) { throw '仍有请求运行或无法确认空闲，请等待生成完成后再切换启动模式。' }
        Write-Host '正在切换启动模式…'
        Stop-Relay
    }
    Assert-PortFree
    Build-App $App
    $mode='local'; if($LAN) { $mode='lan' }
    Set-Content -LiteralPath (Join-Path $State 'start-mode') -Value $mode -Encoding Ascii
    $argsText='"'+(Join-Path $App 'launch.mjs')+'" --background'; if($LAN) { $argsText+=' --lan' }
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
    if(Test-Path -LiteralPath $file) { Write-Host "文件版本：$((Get-Content -Encoding UTF8 -LiteralPath $file -Raw | ConvertFrom-Json).version)" } else { Write-Host '尚未安装。' }
    $service=Get-OwnedService
    if($service) { Write-Host "运行中，PID：$($service.ProcessId)" } else { Write-Host '本目录未运行。' }
    Write-Host "安装目录：$App"
    Write-Host ('酒馆本机地址：http://127.0.0.1:'+(Get-RelayPort)+'/v1')
    Write-Host '密钥：见安装目录 config.json；浏览器脚本：主菜单选 3。'
    if($service) {
        $isLAN=$service.CommandLine -match '(?:^|\s)--lan(?:\s|$)'
        if($isLAN) {
            Write-Host '运行模式：局域网（手机可连接）'
            try {
                $lanConfig=Get-Content -LiteralPath (Join-Path $App 'lan-config.json') -Encoding UTF8 -Raw | ConvertFrom-Json
                Write-Host "手机酒馆地址：http://$($lanConfig.address):$($lanConfig.port)/v1"
            } catch { Write-Host '局域网地址暂不可读，请查看 lan-config.json 和运行日志。' }
        } else { Write-Host '运行模式：仅本机' }
        $status=Get-RelayStatus
        Write-Host "后台版本：$($status.version)；活动请求：$($status.pending)"
        if($status.executorOnline) { Write-Host "AI Studio 已连接，脚本版本：$($status.executorVersion)" }
        else { Write-Host '下一步：切回 AI Studio，登录并点击 Meow；尚未安装脚本时才需选 3。' }
        if($status.page.state -eq 'unresponsive') { Write-Host 'AI Studio 页面暂未响应，请切回页面检查后台保活。' }
    } else { Write-Host '下一步：选择 1 启动，或直接选择 3 安装 / 更新浏览器脚本。' }
}
function Continue-Relay {
    if(Get-OwnedService) { [void](Get-RelayStatus); Write-Host '后台已运行，继续使用当前模式。'; return }
    $lan=$false
    $modeFile=Join-Path $State 'start-mode'
    if(Test-Path -LiteralPath $modeFile) { $lan=(Get-Content -Encoding UTF8 -LiteralPath $modeFile -Raw).Trim() -eq 'lan' }
    Start-Relay $lan
}
function Prepare-Script {
    Continue-Relay | Out-Host
    Build-App $App | Out-Host
    $status=Get-RelayStatus
    $version=(Get-Content -Encoding UTF8 -LiteralPath (Join-Path $App 'package.json') -Raw | ConvertFrom-Json).version
    $url='http://127.0.0.1:'+(Get-RelayPort)+"/local-pg.user.js?v=$version"
    $response=Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 5 -MaximumRedirection 0
    $source=$response.Content
    if($source -is [byte[]]) { $source=[Text.Encoding]::UTF8.GetString($source) }
    if($source -notmatch '^// ==UserScript==' -or $source -notmatch ('(?m)^// @version\s+'+[regex]::Escape($version)+'\s*$') -or $source -match '__LOCAL_PG_(PORT|KEY)__') { throw '浏览器脚本尚未就绪，请查看日志；未打开安装页。' }
    if($status.version -and $status.version -ne $version) { Write-Host '后台版本与文件不同，结束生成后请停止并重新启动后台。' }
    Write-Host "浏览器脚本已就绪：$url"
    Write-Host '请在已启用油猴的浏览器中确认安装 / 更新。'
    Write-Host '首次使用：打开 https://aistudio.google.com/prompts/new_chat，登录并点击 Meow 激活。'
    Write-Host '后续更新：刷新已打开的 AI Studio；需要激活时点击 Meow。'
    return $url
}
function Open-Script {
    $url=Prepare-Script
    try { Start-Process -FilePath $url }
    catch { Write-Host "浏览器未能自动打开，请手动访问：$url" }
}
function Wait-Back { [void](Read-Host '按回车返回菜单') }
function Invoke-Page([scriptblock]$Task) {
    try { & $Task } catch { Write-Host "操作未完成：$($_.Exception.Message)" -ForegroundColor Red }
    Wait-Back
}
function Update-AndStart {
    if(Get-OwnedService) {
        $status=Get-RelayStatus
        if($status.pending -ne 0) { throw '当前仍有生成请求，请结束生成后再更新全部。' }
    }
    Write-Host '[1/3] 下载并准备新版 MMDB…'

    $lan=$false
    $modeFile=Join-Path $State 'start-mode'
    if(Test-Path -LiteralPath $modeFile) { $lan=(Get-Content -Encoding UTF8 -LiteralPath $modeFile -Raw).Trim() -eq 'lan' }
    Install-Relay $Package
    Write-Host '[2/3] 启动更新后的后台…'
    Start-Relay $lan
    Write-Host '程序已更新并启动。'
}
function Update-All {
    Update-AndStart | Out-Host
    Write-Host '[3/3] 打开对应版本的浏览器脚本安装页…'
    Open-Script
    Write-Host '接下来在油猴确认更新，再刷新 AI Studio，即可完成全部更新。'
}
function Open-Playground {
    for($i=0;$i -lt 7;$i++) {
        $status=Get-RelayStatus
        if($status.executorOnline) { Write-Host '已有 AI Studio 页面连接，继续使用现有页面，不重复打开。'; return }
        if($i -lt 6) { Start-Sleep -Milliseconds 500 }
    }
    $url='https://aistudio.google.com/prompts/new_chat'
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
    Write-MenuText '  首次 3   日常 1   更新 2' Cyan
    Write-Host ''
    Write-MenuText '   1  启动 / 继续使用' Cyan
    Write-MenuText '   2  更新全部' Cyan
    Write-MenuText '   3  安装 / 更新浏览器脚本' Cyan
    Write-Host ''
    Write-MenuText '   4  版本与连接地址'
    Write-MenuText '   5  查看日志'
    Write-MenuText '   6  停止后台' Yellow
    Write-MenuText '   7  手机连接此设备'
    Write-MenuText '   8  切回本机模式'
    Write-Host ''
    Write-MenuText '   0  退出菜单'
    Write-MenuText '  --------------------------------' DarkGray
    Write-MenuText '  退出菜单后，后台继续运行。'
    Write-MenuText '  更新脚本后，在油猴确认并刷新 AI Studio。'
}
function Get-MenuVersion {
    $manifest=Join-Path $App 'package.json'
    if(-not (Test-Path -LiteralPath $manifest)) { return '尚未安装' }
    try {
        $version=(Get-Content -LiteralPath $manifest -Encoding UTF8 -Raw | ConvertFrom-Json).version
        if($version -match '^\d+\.\d+\.\d+$') { return "v$version" }
    } catch {}
    return '版本未知'
}
switch($Action) {
    install { Install-Relay $Package }
    update { Update-AndStart }
    update-all { Update-AndStart; [void](Prepare-Script) }
    start { Start-Relay }
    lan { Start-Relay $true }
    stop { Stop-Relay }
    status { Show-Status }
    script { [void](Prepare-Script) }
    menu {
        $exitMenu=$false
        while(-not $exitMenu) {
            Show-Menu
            switch(Read-Host '请选择') {
                '1' { Invoke-Page { Continue-Relay; Open-Playground } }
                '2' { Invoke-Page { Update-All } }
                '3' { Invoke-Page { Open-Script } }
                '5' {
                    do { Show-Logs; $key=Read-Host '输入 1 刷新，0 返回' } while($key -ne '0')
                }
                '6' { Invoke-Page { Stop-Relay } }
                '4' { Invoke-Page { Show-Status } }
                '7' { Invoke-Page { Start-Relay $true; Open-Playground } }
                '8' { Invoke-Page { Start-Relay; Open-Playground } }
                '0' { $exitMenu=$true }
                default { Write-Host '请输入 0–8。' }
            }
        }
    }
}
