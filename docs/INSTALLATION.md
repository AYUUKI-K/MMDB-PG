# 安装、迁移与更新

适用于 **1.7.10**。首次选 **3**，日常选 **1**，更新选 **2**。程序后台和浏览器用户脚本是两部分：菜单准备程序、打开脚本页；你在油猴确认安装，再刷新 AI Studio。

## 菜单与安装目录对照

| 安装方式 | 打开菜单 | 程序与配置目录 | 8 的含义 |
| --- | --- | --- | --- |
| Windows 便携包 | 解压目录的 `MMDB.cmd` | 当前解压目录 | 安装 / 修复项目依赖 |
| Linux / Termux 解压包 | 在包内运行 `bash mmdb.sh` | 当前解压目录 | 安装 / 修复项目依赖 |
| Windows 固定安装 | `%LOCALAPPDATA%\MMDB-PG\manager\MMDB.cmd` | `%LOCALAPPDATA%\MMDB-PG\app` | 切回本机模式 |
| Linux / Termux 固定安装 | `mmdb` | `~/mmdb-pg` | 切回本机模式 |

1–7 与 0 的用途一致：1 启动 / 继续使用、2 更新全部、3 安装当前版本浏览器脚本、4 版本与状态、5 日志、6 停止、7 局域网、0 退出菜单。便携版另外提供 9 更新说明、10 Node.js 安装入口。

菜单顶部显示**文件版本**及安装类型；状态页分别显示文件版本、运行中后台版本、已连接的浏览器脚本版本。文件版本更新不代表旧后台已重启，也不代表油猴已安装新脚本。未安装、未连接或无法识别时会说明状态。

返回结果页一般按回车，日志页按其提示操作。选 0 不停止后台；要停止请先结束生成，再选 6。不要同时运行便携目录、固定安装或旧备份中的两份服务。

## Windows 便携包：首次安装

1. 浏览器安装并启用 Tampermonkey。[下载最新版 ZIP](https://raw.githubusercontent.com/AYUUKI-K/MMDB-PG/main/downloads/mmdb-pg-latest.zip)，完整解压。
2. 双击解压目录的 `MMDB.cmd`。缺少 Node.js 时选 10，完成官方 LTS 安装向导；菜单会重新检测。保留 npm 组件，需要 Node.js 22+。
3. 选 3。菜单安装缺少的项目依赖、启动后台、验证脚本内容并尝试打开安装页。
4. 在油猴中确认安装 **MMDB 本地桥**，打开 [AI Studio Playground](https://aistudio.google.com/prompts/new_chat)，登录后点 Meow。等面板显示本地连接成功及 Google 就绪。
5. 酒馆选择“聊天补全 → 自定义兼容 OpenAI”，填默认地址 `http://127.0.0.1:8765/v1`、默认密钥 `mmdb`，刷新模型列表并选择模型。

不必以管理员身份运行 MMDB 菜单；官方 Node.js 安装向导如要求系统授权，按其提示完成。安装页没有打开时，把菜单输出的本机脚本地址复制到装有油猴的浏览器。

## Android Termux：首次安装

在 Termux 中执行：

```sh
pkg install curl
curl -fL https://raw.githubusercontent.com/AYUUKI-K/MMDB-PG/main/mmdb.sh -o "$HOME/mmdb-install.sh" && bash "$HOME/mmdb-install.sh"
```

这是**固定安装**入口。管理器按需准备 Node.js、npm、unzip，进入菜单后首次选 3，下载 main 源码并构建、启动后台，再打开浏览器脚本安装页。已装但过旧的 Node.js 需先按报错更新到 22+。

在同一手机支持用户脚本的浏览器中安装 MMDB 脚本，打开 AI Studio 登录并点击 Meow。酒馆使用 `http://127.0.0.1:8765/v1`，默认密钥 `mmdb`。后台、浏览器及酒馆所在设备需保持运行；Android 的冻结或省电限制仍可能中断服务。

以后输入：

```sh
mmdb
```

程序位于 `~/mmdb-pg`，管理器位于 `~/.local/share/mmdb/`；注册成功后下载的 `~/mmdb-install.sh` 可以删除。项目不要放在共享存储；Termux 使用官方 `nodejs-lts` / npm，不安装桌面 Linux 的 Node 二进制。

如果你手动下载 ZIP 并在解压目录运行 `bash mmdb.sh`，打开的是**便携菜单**，需自行准备 Node.js 与 npm。它不会把这份解压目录变成固定安装。

## Linux

先准备 Bash、Node.js 22+、npm、curl、unzip，然后执行上面的 `curl ... && bash ...` 命令。管理命令安装到 `~/.local/bin/mmdb`；终端找不到 `mmdb` 时，重新打开 Bash 或运行：

```sh
bash "$HOME/.local/share/mmdb/mmdb.sh"
```

进程归属检查依赖 Linux `/proc`。平台脚本有隔离检查，Linux / Termux 真机后台运行仍需验证。

## 日常使用与更新

- **启动：** 打开原来那份菜单，选 1。已有后台沿用当前模式；没有浏览器连接时，短暂等待旧页面重连后才尝试打开 Playground。新页面仍需登录并点击 Meow。
- **更新：** 先结束生成，选 2。程序下载、构建并启动后，菜单打开对应版本脚本安装页；在油猴确认更新，再刷新 AI Studio。**不用再选一次 3。**
- **仅修复脚本：** 选 3，安装当前目录已提供的脚本。此项不会拉取新版程序，也不会为了装脚本中断现有生成。
- **核对版本：** 选 4。后台版本落后时结束生成并停止 / 重启；脚本版本落后时选 3，油猴确认后刷新页面。
- **停止：** 结束生成，选 6。直接前台启动的服务在原终端 Ctrl+C；关闭菜单不会停止后台服务。

更新完成后选 0 退出并重新打开菜单，加载新版菜单文案和功能；退出菜单不会停止后台。

更新默认直接下载 GitHub 官方 main 源码 ZIP，从同一包内读取提交号；不调用 REST API，不需要 Git 或访问令牌。同提交跳过替换，同版本不同提交仍可更新。浏览器安装确认与刷新页面始终需要用户完成。

保留 `config.json`、`lan-config.json`、`st-path.json` 和诊断日志。便携旧版存于当前目录 `.updates/backup-*`；Unix 固定旧版存于 `~/.local/share/mmdb/backup.*`；Windows 固定旧版存于 `%LOCALAPPDATA%\MMDB-PG\backup.*`。备份不会自动删除，确认不再需要后再自行处理。

## 手机连接电脑

这是手机调用电脑反代的方式，手机不需要再运行 MMDB 后台或 AI Studio 执行器：

1. 电脑完成首次安装，保持电脑的 AI Studio 页面已登录、Meow 激活。
2. 结束生成，在电脑菜单选 **6 停止**，再选 **7 局域网启动**。
3. 在电脑菜单 4 或启动日志查看**手机酒馆地址**，例如 `http://192.168.1.100:8766/v1`。
4. 在手机酒馆中填写该地址和电脑相同的密钥。电脑与手机应网络互通；Windows 防火墙如提示，允许家庭私网访问。

手机上的 `127.0.0.1` 指手机自己，不是电脑。电脑本机客户端仍用 8765；LAN 入口默认 8766，只开放生成 API，不分发浏览器脚本，也不接受远程浏览器执行器。

首次 LAN 启动只有一个可识别私网 IPv4 时自动生成 `lan-config.json`。多网卡 / VPN 无法唯一识别时，复制 `lan-config.example.json` 为 `lan-config.json`，按实际地址修改：

```json
{
  "address": "192.168.1.100",
  "port": 8766,
  "allowedCIDR": "192.168.1.0/24"
}
```

地址变化时重新核对该文件。LAN 入口校验网段和密钥，只用于可信私网，不要映射到公网。切回本机：便携菜单先 6 再 1，固定菜单先 6 再 8。

## Windows 固定安装与旧用户迁移

先准备 Node.js 22+ 和 npm。在最新版解压包目录打开 PowerShell，执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\mmdb-manager.ps1
```

首次选 3，程序安装到 `%LOCALAPPDATA%\MMDB-PG\app`。以后双击 `%LOCALAPPDATA%\MMDB-PG\manager\MMDB.cmd`，可给这个入口创建快捷方式。固定菜单没有便携版的 9 / 10 维护项。

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

然后回固定菜单启动，选 3 更新脚本。Unix 固定安装中执行：

```sh
mmdb update "/完整发布ZIP路径"
mmdb
```

Termux 需要读取共享下载目录时先运行 `termux-setup-storage`。命令 `mmdb update local` 会寻找常用下载目录中版本最高的 `mmdb-pg-x.x.x-universal.zip`；固定名 `mmdb-pg-latest.zip` 请直接传完整路径。管理器拒绝降级和自动覆盖 Git 工作区。

Unix 旧自定义源可用 `mmdb source clear` 恢复默认来源。自定义 HTTPS 发布 ZIP 需配套同址加 `.sha256` 的校验文件。来源中的构建程序会在本机执行，请使用可信地址。

## 命令行与源码开发

在完整源码根目录运行 `npm ci --ignore-scripts`、`npm start`；LAN 使用 `npm run start:lan`。这些是前台进程，保持终端运行，Ctrl+C 停止。

便携命令 `node tools/portable-manager.mjs script` / `update` 准备并输出脚本地址；菜单才负责打开浏览器。Unix 固定命令 `mmdb script` / `update-all` 同样只输出地址；`mmdb start`、`lan`、`upgrade` 则以前台运行。不要把前台命令与退出菜单后继续运行的后台模式混淆。

源码组织、测试与兼容发布包生成见[架构与维护](ARCHITECTURE.md#验证与发布)。功能、配置与错误排查见[使用说明](USAGE.md)。iOS 不属于本项目的本地后台运行平台。
