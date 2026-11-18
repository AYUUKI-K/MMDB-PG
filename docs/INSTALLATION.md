# 安装、迁移与更新

## 2.0.10 菜单与连接地址

| 主菜单 | 用途 |
| --- | --- |
| 1 | 启动或继续使用；自动同时准备本机与同 Wi-Fi 手机入口 |
| 2 | 更新全部；保留原有配置、账号和凭证 |
| 3 | 安装 / 更新网页脚本；首次使用会准备依赖和后台 |
| 4 | 连接地址与使用说明；含本机、手机 LAN 地址及排查提示 |
| 5 | 更多：1 独立模式与账号管理，2 日志，3 重启，4 停止，5 启动与守护，6 修复与依赖，7 更新说明，8 备用安装网页脚本 |
| 0 | 返回或退出；退出菜单不会停止后台 |

电脑默认地址 `http://127.0.0.1:8765/v1`；同 Wi-Fi 手机使用 `http://电脑局域网IP:8766/v1`。**两边默认密钥均为 `mmdb`**，修改过的密钥不会重置。开源包不包含外网地址、外网专用密钥或登录凭证。

首次启动无法识别出唯一的局域网地址时，菜单 1 会列出候选地址，也可以直接输入运行 MMDB 的设备在网络设置中显示的 IPv4。选好后立即尝试启动手机入口，成功后自动保存配置。按回车可跳过，以后再选 1 设置。本机服务在此期间继续运行。如果报端口占用，先解决冲突，再选 1 重试。

原本 ZIP、固定安装和 Termux 用户继续在原入口选 2 更新即可，不需要重新导入账号；旧 `lan` / `ready-lan` 命令仍兼容，正常启动已包含局域网入口。更新后重新打开菜单；网页模式还需确认油猴脚本更新并刷新 AI Studio。


适用于 **2.0.10**。日常选 **1**，更新选 **2**，网页模式首次安装脚本选 **3**；独立模式和账号管理在 **5 → 1**。程序后台和浏览器用户脚本是两部分：菜单准备程序、打开脚本页；你在油猴确认安装，再刷新 AI Studio。

菜单顶部显示反代是否运行、运行模式和浏览器脚本是否连接，返回菜单时刷新。启动时会显示“正在启动”，看到“后台已启动”后仍要等待 AI Studio 页面激活并连接。选 **4「连接地址与使用说明」**可重新检查状态、本机地址和手机 LAN 地址。安卓画中画设置见[使用说明](USAGE.md#安卓画中画)。

## 菜单与安装目录对照

| 安装方式 | 打开菜单 | 程序与配置目录 |
| --- | --- | --- |
| Windows 便携包 | 解压目录的 `MMDB.cmd` | 当前解压目录 |
| Linux / Termux 解压包 | 在包内运行 `bash mmdb.sh` | 当前解压目录 |
| Windows 固定安装 | `%LOCALAPPDATA%\MMDB-PG\manager\MMDB.cmd` | `%LOCALAPPDATA%\MMDB-PG\app` |
| Linux / Termux 固定安装 | `mmdb` | `~/mmdb-pg` |

完整安装后各平台使用相同主菜单与「更多」编号，见上表。首次安装前的引导菜单只提供安装所需入口。独立模式下启动和更新不要求油猴脚本；「更多 → 停止后台」只停止 PG，运行时与凭证保留。

菜单顶部显示 **MEOW-FM · 文件版本**；状态页分别显示文件版本、运行中后台版本、已连接的浏览器脚本版本。文件版本更新不代表旧后台已重启，也不代表油猴已安装新脚本。未安装、未连接或无法识别时会说明状态。

返回结果页一般按回车，日志页按其提示操作。选 0 不停止后台；要停止请先结束生成，再选「更多 → 停止后台」。不要同时运行便携目录、固定安装或旧备份中的两份服务。

## Windows 便携包：首次安装

1. 浏览器安装并启用 Tampermonkey。[下载最新版 ZIP](https://raw.githubusercontent.com/AYUUKI-K/MMDB-PG/main/downloads/mmdb-pg-latest.zip)，完整解压。
2. 双击解压目录的 `MMDB.cmd`。缺少 Node.js 时选「更多 → 修复与依赖 → 安装 / 修复 Node.js」，完成官方 LTS 安装向导；菜单会重新检测。保留 npm 组件，需要 Node.js 22+。
3. 选 **3**。菜单安装缺少的项目依赖、启动后台、验证脚本内容并尝试打开安装页。
4. 在油猴中确认安装 **MMDB 本地桥**，打开 [AI Studio Playground](https://aistudio.google.com/prompts/new_chat)，登录后点 Meow。等面板显示本地连接成功及 Google 就绪。
5. 酒馆选择“聊天补全 → 自定义兼容 OpenAI”，填默认地址 `http://127.0.0.1:8765/v1`、默认密钥 `mmdb`，刷新模型列表并选择模型。

不必以管理员身份运行 MMDB 菜单；官方 Node.js 安装向导如要求系统授权，按其提示完成。安装页没有打开时，把菜单输出的本机脚本地址复制到装有油猴的浏览器。

## Android Termux：首次安装

在 Termux 中执行：

```sh
apt update && apt full-upgrade -y && apt install -y curl nodejs-lts npm unzip &&
curl -fL https://raw.githubusercontent.com/AYUUKI-K/MMDB-PG/main/mmdb.sh -o "$HOME/mmdb-install.sh" && bash "$HOME/mmdb-install.sh"
```

完整复制以上两行，不需要先输入 `sh`。命令先完整升级 Termux 软件包，再安装依赖；任一步失败都会停止，不会继续下载或执行安装器。升级过程中如出现配置文件问题，按终端提示选择并等待完成。

这是**固定安装**入口。管理器按需检查 Node.js、npm、unzip，进入菜单后首次可直接选 **3** 下载 main 源码、构建并打开网页脚本安装页。需要 Node.js 22+。

在同一手机支持用户脚本的浏览器中安装 MMDB 脚本，打开 AI Studio 登录并点击 Meow。酒馆使用 `http://127.0.0.1:8765/v1`，默认密钥 `mmdb`。后台、浏览器及酒馆所在设备需保持运行；Android 的冻结或省电限制仍可能中断服务。

以后输入：

```sh
mmdb
```

程序位于 `~/mmdb-pg`，管理器位于 `~/.local/share/mmdb/`；注册成功后下载的 `~/mmdb-install.sh` 可以删除。项目不要放在共享存储；Termux 使用官方 `nodejs-lts` / npm，不安装桌面 Linux 的 Node 二进制。

如果你手动下载 ZIP 并在解压目录运行 `bash mmdb.sh`，打开的是**便携菜单**，需自行准备 Node.js 与 npm。它不会把这份解压目录变成固定安装。

### Termux 重启后提示「无法确认进程状态」

1.20.0 的更多 → 连接地址与状态 和 12 都报这个错时，旧菜单可能卡在上一次启动留下的 `runtime.pid`。如果菜单 2 也报同样的错，先选 **0** 退出菜单。固定安装在 Termux 运行以下命令，修复启动器后继续更新到新版：

```sh
curl -fL https://raw.githubusercontent.com/AYUUKI-K/MMDB-PG/main/downloads/mmdb-termux-update-1.20.0.sh -o "$HOME/mmdb-termux-update.sh" &&
bash "$HOME/mmdb-termux-update.sh" &&
mmdb update
```

更新完成后输入 `mmdb`，选 **4「连接地址与使用说明」**核对文件版本和后台版本。网页模式可选 **3** 在油猴确认脚本更新，然后刷新 AI Studio。

如果暂时无法下载更新，可用以下命令从前台启动。便携安装把 `$HOME/mmdb-pg` 换成自己的解压目录。

```sh
cd "$HOME/mmdb-pg" && node launch.mjs
```

看到「本机酒馆」地址后，保持这个 Termux 会话运行。网页模式下切回同一部手机的 AI Studio，刷新并点击 **Meow**。本次启动会写入新的进程号。想恢复菜单后台运行时，先结束生成，在这个终端按 **Ctrl+C**，再打开菜单选 **1**。

如果终端显示 `EADDRINUSE`，说明输出中的端口已被占用。保留 `runtime.pid`，回到原启动窗口核对服务。需要反馈时，提供这行错误和「更多 → 查看日志」 的启动日志，隐去密钥。

### Termux 系统库修复

如果下载前就出现：

```text
CANNOT LINK EXECUTABLE "curl": cannot locate symbol "SSL_set_quic_tls_early_data_enabled" referenced by ".../libcurl.so"
```

说明 curl 加载的系统库缺少所需符号，通常是 curl / libcurl 与 OpenSSL 没有同步升级。此时 MMDB 安装脚本尚未下载运行。`pkg` 检查镜像也依赖 curl，因此直接用 `apt` 完整升级；[Termux 官方 pkg 实现](https://github.com/termux/termux-tools/blob/master/scripts/pkg.in)也对动态链接错误给出这一恢复方法。

先执行，等待全部完成：

```sh
apt update && apt full-upgrade -y &&
apt install --reinstall -y openssl libcurl curl &&
curl --version
```

看到 curl 和 OpenSSL 的版本信息后，重新执行上面的首次安装命令。无需清空 Termux 数据或删除现有 MMDB 目录；也不要只反复执行 `pkg install curl`。

如果 `apt update` 报软件源不可用，运行 `termux-change-repo` 选择可用的 Main 源，再重试修复命令。若 `apt` 自身也报 `CANNOT LINK EXECUTABLE`，或完整升级后仍缺少符号，请保留完整报错和 `termux-info` 输出以继续排查，不要删除系统库或使用关闭证书校验的命令。

## Linux

先准备 Bash、Node.js 22+、npm、curl、unzip，然后执行上面的 `curl ... && bash ...` 命令。管理命令安装到 `~/.local/bin/mmdb`；终端找不到 `mmdb` 时，重新打开 Bash 或运行：

```sh
bash "$HOME/.local/share/mmdb/mmdb.sh"
```

进程归属检查依赖 Linux `/proc`。平台脚本有隔离检查，Linux / Termux 真机后台运行仍需验证。

## 日常使用与更新

### 2.0.6 提示「EXPERIMENT_DEFAULTS is not defined」

这是 2.0.6 网页脚本漏打包共享设置造成的启动错误，2.0.7 已修复。

1. 结束正在进行的生成，在原 MMDB 菜单选 **2「更新全部」**，等待程序更新完成。
2. 在弹出的油猴安装页确认将 **MMDB 本地桥**更新到 **2.0.7 或更新版本**。安装页没打开时，选 **0** 退出并重新打开菜单，再选 **3「安装 / 更新网页脚本」**；油猴官网中转页卡住时，可选下方的备用安装方式。
3. **刷新原 AI Studio 页面**，需要时重新点击 Meow，等待本地已连接、Google 已就绪。
4. 重新打开菜单，选 **4「连接地址与使用说明」**核对文件、后台及已连接的脚本版本。仍报同样错误时，检查当前浏览器油猴中的 MMDB 本地桥是否已更新到相应版本，并关闭重复启用的旧版脚本。

**必须先更新程序，再确认油猴更新并刷新页面。** 只选 3 会重装当前目录里的脚本；程序仍为 2.0.6 时无法修复。无需删除配置、账号或重新安装 Node.js。

### 常用操作

- **启动：** 打开原来那份菜单，选 1。已有后台沿用当前模式；没有浏览器连接时，短暂等待旧页面重连后才尝试打开 Playground。新页面仍需登录并点击 Meow。
- **更新：** 先结束生成，选 2。程序下载、构建并启动后，菜单打开对应版本脚本安装页；在油猴确认更新，再刷新 AI Studio。**不必再次打开脚本安装入口。**
- **仅修复脚本：** 选 **3「安装 / 更新网页脚本」**，安装当前目录已提供的脚本。此项不会拉取新版程序，也不会为了装脚本中断现有生成。
- **备用安装：** 油猴官网中转页卡住时，选 **5「更多」→ 8「备用安装网页脚本」**。准备并校验脚本后显示安装指引，不自动打开链接，操作见下节。
- **核对版本：** 选 **4「连接地址与使用说明」**。后台版本落后时结束生成并停止 / 重启；脚本版本落后时选 **3**，油猴确认后刷新页面。
- **停止：** 结束生成，选「更多 → 停止后台」。直接前台启动的服务在原终端 Ctrl+C；关闭菜单不会停止后台服务。
- **一键重启：** 选择「更多 → 重启后台」，同时重新准备本机和局域网入口并重新加载 PG 与已打开的账号管理服务。生成或账号操作进行中时拒绝重启。凭证保留，账号管理从「更多 → 独立模式与账号管理」重新打开；CLI 可执行 `node tools/portable-manager.mjs restart`。

更新完成后选 0 退出并重新打开菜单，加载新版菜单文案和功能；退出菜单不会停止后台。

更新默认直接下载 GitHub 官方 main 源码 ZIP，从同一包内读取提交号；不调用 REST API，不需要 Git 或访问令牌。同提交跳过替换，同版本不同提交仍可更新。浏览器安装确认与刷新页面始终需要用户完成。

保留 `config.json`、`lan-config.json`、`st-path.json` 和诊断日志。便携旧版存于当前目录 `.updates/backup-*`；Unix 固定旧版存于 `~/.local/share/mmdb/backup.*`；Windows 固定旧版存于 `%LOCALAPPDATA%\MMDB-PG\backup.*`。备份不会自动删除，确认不再需要后再自行处理。

### 油猴官网中转页卡住：备用安装

常规安装及更新仍按原流程打开脚本链接。若停在 `tampermonkey.net/script_installation.php`，可选用备用方式：

1. 在 MMDB 菜单选 **5「更多」→ 8「备用安装网页脚本」**。首次使用会准备依赖并启动后台；已有后台继续运行。Windows 会尝试复制已校验的脚本地址，其他平台或复制失败时手动复制终端给出的完整地址。
2. 在运行 MMDB 的同一设备上，打开 **油猴（Tampermonkey）→ 管理面板（Dashboard）→ 实用工具（Utilities）**。
3. 找到 **从 URL 安装／导入（Install / Import from URL）**，粘贴脚本地址并点击安装，在油猴中确认当前版本的 **MMDB 本地桥**。
4. **刷新 AI Studio**，需要时重新点击 Meow。安装期间保持 MMDB 后台运行。

备用方式使用油猴内部的导入功能，不需要打开官网中转页；[油猴维护者也建议使用此方法](https://github.com/Tampermonkey/tampermonkey/issues/2675)。它不会下载新版本程序，旧用户仍需先选 2 更新程序。更新后退出并重新打开菜单，才会显示新入口。独立模式无需安装网页脚本；旧版固定安装器的引导菜单可按“备用安装网页脚本”文字选择。

## 手机连接电脑

这是手机调用电脑反代的方式，手机不需要再运行 MMDB 后台或 AI Studio 执行器：

1. 电脑完成首次安装，保持电脑的 AI Studio 页面已登录、Meow 激活。
2. 在电脑菜单选 **1 启动 / 继续使用**，电脑与手机入口一起准备，无需停止或切换模式。
3. 在电脑菜单 **4「连接地址与使用说明」**或启动日志查看**手机酒馆地址**，例如 `http://192.168.1.100:8766/v1`。
4. 在手机酒馆中填写该地址和电脑相同的密钥。电脑与手机应网络互通；Windows 防火墙如提示，允许家庭私网访问。

手机上的 `127.0.0.1` 指手机自己，不是电脑。电脑本机客户端仍用 8765；LAN 入口默认 8766，只开放生成 API，不分发浏览器脚本，也不接受远程浏览器执行器。

首次启动只有一个可识别私网 IPv4 时自动配置。若有多张网卡，菜单 1 会显示网卡名和地址，选择用于连接酒馆的网卡。系统没有提供候选地址时，直接输入后台设备的 Wi-Fi 或以太网 IPv4。手动输入支持带网络前缀的地址，如 `192.168.1.38/23`。省略前缀时优先使用所选网卡的私网前缀，读不到时使用 `/24`。

入口启动成功后，菜单显示酒馆可用的完整地址。以后启动会复用保存在 `lan-config.json` 中的配置。需要自定义端口或限制可访问网段时，配置示例如下。

```json
{
  "address": "192.168.1.100",
  "port": 8766,
  "allowedCIDR": "192.168.1.0/24"
}
```

地址变化时重新核对该文件。allowedCIDR 必须完整填写，例如 `192.168.1.0/24`，且整个网段都属于私网；空前缀、`/0` 或跨入公网的网段会被拒绝，本机入口继续运行。LAN 入口校验网段和密钥，只用于可信私网，不要映射到公网。本机地址始终同时可用，不需要切回本机模式。

## Windows 固定安装与旧用户迁移

先准备 Node.js 22+ 和 npm。在最新版解压包目录打开 PowerShell，执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\mmdb-manager.ps1
```

首次选 1，程序安装到 `%LOCALAPPDATA%\MMDB-PG\app`。以后双击 `%LOCALAPPDATA%\MMDB-PG\manager\MMDB.cmd`，可给这个入口创建快捷方式。安装后所有维护项统一放在「更多」。

迁移前停止旧服务。首次安装会从安装器旁边的旧包目录复制配置和诊断日志，其他位置不会自动搜索；请从原目录手动迁移需要的 `config.json`、`lan-config.json`、`st-path.json`。旧 `Start.cmd` 保留兼容，但不要与管理器后台重复启动。

正常选 2 也会更新固定管理入口，退出菜单再打开后载入新代码。如果旧固定管理器无法完成更新，Windows 可在新版解压包里重新执行上述命令；Unix 可重新执行首次安装的 curl 命令。特别是 1.7.6 遇到“检查源码失败 HTTP 403”的旧菜单，需要先更新管理器，再选 2。配置保留；不再迁移已停用的 `accounts.json`。

## 下载失败与手动更新

### Windows 更新提示「无法确认进程状态」

1.18.x 等旧菜单会先用 Node 检查 `runtime.pid` 保存的进程号。Windows 权限不足、重启后进程号被其他受保护程序复用时，这一步可能直接报「无法确认进程状态，未操作任何进程」，还没有开始下载或更新。

1. 退出所有 MMDB 菜单，下载[Windows 更新修复补丁 ZIP](https://raw.githubusercontent.com/AYUUKI-K/MMDB-PG/main/downloads/mmdb-windows-update-hotfix.zip)（[SHA-256](https://raw.githubusercontent.com/AYUUKI-K/MMDB-PG/main/downloads/mmdb-windows-update-hotfix.zip.sha256)）。
2. 解压到原安装根目录，即原 `MMDB.cmd` 所在目录，确认覆盖补丁内的 `tools` 文件；不要另建一层目录。
3. 双击补丁里的 `Repair-Update.cmd`。它会检查配置中的本机端口；仅在端口空闲时将旧 `runtime.pid` 移到 `.updates/runtime-pid-….txt` 备份，不结束任何进程，不更改配置或凭证。此步骤无需 npm 依赖或联网。
4. 看到修复完成后，重新打开原 `MMDB.cmd`，选择 **2 更新全部**，再在浏览器确认脚本更新。

如果修复提示端口仍被占用，先结束生成并从原启动窗口停止后台，再运行修复；不要直接删除进程记录或结束所有 `node.exe`。补丁同时包含新版更新器及 1.18.x 缺少的兼容模块，避免修复进程记录后又卡在模块缺失或目录占用上。补丁不是完整发布包，不能作为 `update` 命令的 ZIP 参数。

### Windows 更新提示目录占用

Windows 旧版更新若提示 `EPERM` / `EBUSY`，并显示将 `scripts` 等程序目录改名为 `.updates/backup-…` 失败，可能是终端或其他进程仍占用该目录。若同时显示“已恢复原程序”，此次更新已回滚，配置和凭证仍在原位置。先退出菜单，关闭工作目录位于安装目录内的其他终端，再从安装根目录重新打开 `MMDB.cmd` 重试。

2.0.1 更新器保留已有程序目录，逐文件备份和替换，避免目录占用造成更新失败；废弃程序文件也会备份，失败时一并恢复。旧更新器重试无效时，下载上方修复补丁，退出菜单，解压到原安装根目录，覆盖 `tools/release-update.mjs` 和 `tools/legacy-components.mjs`，再重新打开菜单选 2。仅目录占用报错无需运行 `Repair-Update.cmd`；配置和凭证保留。仅重新下载新版更新包不会先替换正在执行的旧更新器。

### 手动指定完整发布包

先保留原安装。旧管理器和手动下载仍可使用[完整发布 ZIP](https://raw.githubusercontent.com/AYUUKI-K/MMDB-PG/main/downloads/mmdb-pg-latest.zip)。不要把 GitHub 源码 ZIP 当作手动发布 ZIP 传给兼容安装器。

便携目录中执行：

```sh
node tools/portable-manager.mjs update "完整发布ZIP路径"
```

Windows 固定安装中执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\mmdb-manager.ps1 -Action install -Package "完整发布ZIP路径"
```

然后回固定菜单启动，选 **3「安装 / 更新网页脚本」**更新脚本。Unix 固定安装中执行：

```sh
mmdb update "/完整发布ZIP路径"
mmdb
```

Termux 需要读取共享下载目录时先运行 `termux-setup-storage`。命令 `mmdb update local` 会寻找常用下载目录中版本最高的 `mmdb-pg-x.x.x-universal.zip`；固定名 `mmdb-pg-latest.zip` 请直接传完整路径。管理器拒绝降级和自动覆盖 Git 工作区。

Unix 旧自定义源可用 `mmdb source clear` 恢复默认来源。自定义 HTTPS 发布 ZIP 需配套同址加 `.sha256` 的校验文件。来源中的构建程序会在本机执行，请使用可信地址。

## 命令行与源码开发

在完整源码根目录运行 `npm ci --ignore-scripts`、`npm start`；`npm run start:lan` 保留为兼容入口，普通 `npm start` 已同时准备 LAN。这些是前台进程，保持终端运行，Ctrl+C 停止。

便携命令 `node tools/portable-manager.mjs script` / `update` 准备并输出脚本地址；菜单才负责打开浏览器。Unix 固定命令 `mmdb script` / `update-all` 同样只输出地址；`mmdb start`、`lan`、`upgrade` 则以前台运行。不要把前台命令与退出菜单后继续运行的后台模式混淆。

源码组织、测试与兼容发布包生成见[架构与维护](ARCHITECTURE.md#验证与发布)。功能、配置与错误排查见[使用说明](USAGE.md)。iOS 不属于本项目的本地后台运行平台。
