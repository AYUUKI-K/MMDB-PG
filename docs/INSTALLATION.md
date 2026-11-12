# 安装、迁移与更新

## 2.0.0 菜单与连接地址

| 主菜单 | 用途 |
| --- | --- |
| 1 | 启动或继续使用；自动同时准备本机与同 Wi-Fi 手机入口 |
| 2 | 更新全部；保留原有配置、账号和凭证 |
| 3 | 账号管理与三步导入教程 |
| 4 | 更多：1 连接地址与状态，2 日志，3 重启，4 停止，5 浏览器脚本，6 执行模式，7 启动与守护，8 修复与依赖 |
| 5 | 查看本版本更新说明 |
| 0 | 返回或退出；退出菜单不会停止后台 |

电脑默认地址 `http://127.0.0.1:8765/v1`；同 Wi-Fi 手机使用 `http://电脑局域网IP:8766/v1`。**两边默认密钥均为 `mmdb`**，修改过的密钥不会重置。开源包不包含外网地址、外网专用密钥或登录凭证。

局域网地址无法唯一确定、配置失效或 8766 被占用时，本机服务继续运行。检查 `lan-config.json` 后再次选择 1 会重试手机入口，不重启已有生成任务。手机连接失败时，先确认同一网络、电脑没有休眠，且系统防火墙允许此私网地址的 8766 端口。只在信任的局域网使用；不要把默认密钥的入口直接映射到公网。

原本 ZIP、固定安装和 Termux 用户继续在原入口选 2 更新即可，不需要重新导入账号；旧 `lan` / `ready-lan` 命令仍兼容，正常启动已包含局域网入口。更新后重新打开菜单；网页模式还需确认油猴脚本更新并刷新 AI Studio。


适用于 **2.0.0**。日常选 **1**，更新选 **2**，账号管理选 **3**；网页模式首次安装脚本选 **4 → 5**。程序后台和浏览器用户脚本是两部分：菜单准备程序、打开脚本页；你在油猴确认安装，再刷新 AI Studio。

菜单顶部显示反代是否运行、运行模式和浏览器脚本是否连接，返回菜单时刷新。启动时会显示“正在启动”，看到“后台已启动”后仍要等待 AI Studio 页面激活并连接。选「更多 → 连接地址与状态」 可重新检查状态和地址。安卓画中画设置见[使用说明](USAGE.md#安卓画中画)。

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
3. 选 **4 → 5**。菜单安装缺少的项目依赖、启动后台、验证脚本内容并尝试打开安装页。
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

这是**固定安装**入口。管理器按需检查 Node.js、npm、unzip，进入菜单后首次选 **1** 下载 main 源码、构建并启动；再选 **4 → 5** 打开浏览器脚本安装页。需要 Node.js 22+。

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

更新完成后输入 `mmdb`，选「更多 → 连接地址与状态」 核对文件版本和后台版本。网页模式可选 **4 → 5** 在油猴确认脚本更新，然后刷新 AI Studio。

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

- **启动：** 打开原来那份菜单，选 1。已有后台沿用当前模式；没有浏览器连接时，短暂等待旧页面重连后才尝试打开 Playground。新页面仍需登录并点击 Meow。
- **更新：** 先结束生成，选 2。程序下载、构建并启动后，菜单打开对应版本脚本安装页；在油猴确认更新，再刷新 AI Studio。**不必再次打开脚本安装入口。**
- **仅修复脚本：** 选「更多 → 浏览器脚本」，安装当前目录已提供的脚本。此项不会拉取新版程序，也不会为了装脚本中断现有生成。
- **核对版本：** 选「更多 → 连接地址与状态」。后台版本落后时结束生成并停止 / 重启；脚本版本落后时选「更多 → 浏览器脚本」，油猴确认后刷新页面。
- **停止：** 结束生成，选「更多 → 停止后台」。直接前台启动的服务在原终端 Ctrl+C；关闭菜单不会停止后台服务。
- **一键重启：** 选择「更多 → 重启后台」，同时重新准备本机和局域网入口并重新加载 PG 与已打开的账号管理服务。生成或账号操作进行中时拒绝重启。凭证保留，账号管理从主菜单 3 重新打开；CLI 可执行 `node tools/portable-manager.mjs restart`。

更新完成后选 0 退出并重新打开菜单，加载新版菜单文案和功能；退出菜单不会停止后台。

更新默认直接下载 GitHub 官方 main 源码 ZIP，从同一包内读取提交号；不调用 REST API，不需要 Git 或访问令牌。同提交跳过替换，同版本不同提交仍可更新。浏览器安装确认与刷新页面始终需要用户完成。

保留 `config.json`、`lan-config.json`、`st-path.json` 和诊断日志。便携旧版存于当前目录 `.updates/backup-*`；Unix 固定旧版存于 `~/.local/share/mmdb/backup.*`；Windows 固定旧版存于 `%LOCALAPPDATA%\MMDB-PG\backup.*`。备份不会自动删除，确认不再需要后再自行处理。

## 手机连接电脑

这是手机调用电脑反代的方式，手机不需要再运行 MMDB 后台或 AI Studio 执行器：

1. 电脑完成首次安装，保持电脑的 AI Studio 页面已登录、Meow 激活。
2. 在电脑菜单选 **1 启动 / 继续使用**，电脑与手机入口一起准备，无需停止或切换模式。
3. 在电脑更多 → 连接地址与状态 或启动日志查看**手机酒馆地址**，例如 `http://192.168.1.100:8766/v1`。
4. 在手机酒馆中填写该地址和电脑相同的密钥。电脑与手机应网络互通；Windows 防火墙如提示，允许家庭私网访问。

手机上的 `127.0.0.1` 指手机自己，不是电脑。电脑本机客户端仍用 8765；LAN 入口默认 8766，只开放生成 API，不分发浏览器脚本，也不接受远程浏览器执行器。

首次启动只有一个可识别私网 IPv4 时自动生成 `lan-config.json`。多网卡 / VPN 无法唯一识别时，复制 `lan-config.example.json` 为 `lan-config.json`，按实际地址修改：

```json
{
  "address": "192.168.1.100",
  "port": 8766,
  "allowedCIDR": "192.168.1.0/24"
}
```

地址变化时重新核对该文件。LAN 入口校验网段和密钥，只用于可信私网，不要映射到公网。本机地址始终同时可用，不需要切回本机模式。

## Windows 固定安装与旧用户迁移

先准备 Node.js 22+ 和 npm。在最新版解压包目录打开 PowerShell，执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\mmdb-manager.ps1
```

首次选 1，程序安装到 `%LOCALAPPDATA%\MMDB-PG\app`。以后双击 `%LOCALAPPDATA%\MMDB-PG\manager\MMDB.cmd`，可给这个入口创建快捷方式。安装后所有维护项统一放在「更多」。

迁移前停止旧服务。首次安装会从安装器旁边的旧包目录复制配置和诊断日志，其他位置不会自动搜索；请从原目录手动迁移需要的 `config.json`、`lan-config.json`、`st-path.json`。旧 `Start.cmd` 保留兼容，但不要与管理器后台重复启动。

正常选 2 也会更新固定管理入口，退出菜单再打开后载入新代码。如果旧固定管理器无法完成更新，Windows 可在新版解压包里重新执行上述命令；Unix 可重新执行首次安装的 curl 命令。特别是 1.7.6 遇到“检查源码失败 HTTP 403”的旧菜单，需要先更新管理器，再选 2。配置保留；不再迁移已停用的 `accounts.json`。

## 下载失败与手动更新

先保留原安装。旧管理器和手动下载仍可使用[完整发布 ZIP](https://raw.githubusercontent.com/AYUUKI-K/MMDB-PG/main/downloads/mmdb-pg-latest.zip)。不要把 GitHub 源码 ZIP 当作手动发布 ZIP 传给兼容安装器。

便携目录中执行：

```sh
node tools/portable-manager.mjs update "完整发布ZIP路径"
```

Windows 固定安装中执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\mmdb-manager.ps1 -Action install -Package "完整发布ZIP路径"
```

然后回固定菜单启动，选「更多 → 浏览器脚本」更新脚本。Unix 固定安装中执行：

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
