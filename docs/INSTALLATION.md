# 安装、迁移与在线更新

本文说明固定目录安装器。源码开发与解压即用的便携菜单见[主说明](../README.md)和[便携菜单说明](PORTABLE_README.txt)。以下命令在安装包或仓库根目录执行。

## Android Termux：首次安装并启动

先安装下载工具：

```sh
pkg install curl
```

然后执行一条命令：

```sh
curl -fL https://raw.githubusercontent.com/AYUUKI-K/MMDB-PG/main/mmdb.sh -o "$HOME/mmdb-install.sh" && bash "$HOME/mmdb-install.sh"
```

进入数字管理菜单。首次选 `1` → `1` 启动本机反代，或选 `2` 安装 / 更新并启动。自动准备 Node.js（缺少时）和 unzip、下载固定 ZIP 并安装依赖，安装目录为 `~/mmdb-pg`。

首次安装成功后，`~/mmdb-install.sh` 可以删除。管理器保存在 `~/.local/share/mmdb/`，`mmdb` 命令会继续可用。

## 以后怎么用

只输入 `mmdb`，然后用数字操作：

| 数字 | 操作 |
|---|---|
| 1 | 启动反代，再选本机或局域网 |
| 2 | 安装 / 更新，完成后在后台启动 |
| 3 | 查看日志，按 1 刷新 |
| 4 | 停止反代 |
| 5 | 查看版本与状态 |
| 0 | 返回上级；主菜单中为退出菜单 |

启动、更新、停止和状态结果页均输入 `0` 返回。反代在后台运行，返回或退出菜单不会停止反代；用主菜单 `4` 停止。仍需保持 Termux 和 AI Studio 运行，安卓系统强制结束 Termux 时后台也会停止。

Windows 一键管理器中，选择不同的启动模式会先确认后台空闲，再重启切换本机 / 局域网模式；有请求时会拒绝切换。同一模式重复选择不会重复启动。

旧版管理器用户重新执行上面的首次命令一次，就能获得新版数字菜单。已有反代的配置会保留。高级命令 `mmdb start / lan / stop / upgrade / status` 仍然可用，其中直接 `start / lan / upgrade` 使用前台运行。

生成结束后再升级。可在另一个 Termux 会话执行更新命令；管理器仅停止能确认归属的本机进程，不会按端口强杀其他程序。其他目录的旧反代请先在原启动窗口 Ctrl+C。

更新先在临时目录解压并安装依赖，准备完成后替换安装目录。保留 `config.json`、`lan-config.json`、`st-path.json` 和诊断日志。旧目录保存在 `~/.local/share/mmdb/backup.*`，便于人工回退；这些备份不会自动删除。不要同时运行旧备份和新目录。

**后端更新完成后，还需在油猴里检查“MMDB 本地桥”更新，再刷新 AI Studio。浏览器扩展的安装确认无法由终端代点。**

## 旧用户迁移

原来就在 `~/mmdb-pg`：结束生成，执行上面的首次命令，再选 `2`，即可保留配置更新并接入管理器。原来放在其他目录：先停止那份后台，再安装；自定义配置需从原目录迁移，管理器不会猜测并删除其他目录。

如果固定地址暂时下载失败，也可手动下载 ZIP，执行：

```sh
termux-setup-storage
mmdb update local
mmdb start
```

`local` 会在 Download 等常用目录寻找版本号最高的 `mmdb-pg-x.x.x-universal.zip`。或明确指定文件：`mmdb update /sdcard/Download/实际文件名.zip`。更新拒绝降级。

## Linux

先安装 Bash、Node.js 22+、npm、curl 和 unzip，再执行相同首次命令。管理命令安装在 `~/.local/bin/mmdb`；如当前终端找不到命令，重新打开 Bash 或使用 `~/.local/bin/mmdb`。进程归属确认依赖 Linux `/proc`。

## Windows

先安装 Node.js 22+。[下载最新版 ZIP](https://raw.githubusercontent.com/AYUUKI-K/MMDB-PG/main/downloads/mmdb-pg-latest.zip)，完整解压后在包目录执行 `powershell -ExecutionPolicy Bypass -File .\mmdb-manager.ps1`，进入固定安装数字菜单：`1` 启动、`2` 安装 / 更新并启动、`3` 日志、`4` 停止、`5` 状态，`0` 返回。

首次选 `2`；后续双击固定管理目录中的 `MMDB.cmd`。解压目录中的 MMDB.cmd 打开便携菜单。程序安装到 `%LOCALAPPDATA%\MMDB-PG\app`，固定管理入口为 `%LOCALAPPDATA%\MMDB-PG\manager\MMDB.cmd`，可创建桌面快捷方式。更新自动从本仓库拉取 ZIP，保留配置；反代在后台运行，关闭菜单不会停止。用菜单 `4` 停止。

旧用户迁移前先结束生成、关闭原启动窗口。管理器首次安装会从它旁边的旧启动包目录复制 `config.json / lan-config.json / st-path.json` 和诊断日志；其他位置的配置不会自动寻找。旧的 `Start.cmd / Start-LAN.cmd` 保留，但不要与新管理器同时启动。

如果 GitHub 下载失败，可以先手动下载 ZIP 后用 PowerShell 执行 `powershell -ExecutionPolicy Bypass -File .\mmdb-manager.ps1 -Action install -Package "实际ZIP路径"`，再回菜单启动。Windows 更新功能同样没有修复浏览器到 Google 的上游断联；油猴仍需检查更新并刷新页面。

## 浏览器和酒馆设置

后台启动后，打开 `http://127.0.0.1:8765/local-pg.user.js` 安装油猴脚本；打开 AI Studio、登录并点击 Meow 激活，等待本地连接和 Google 就绪。

酒馆使用“聊天补全 → 自定义兼容 OpenAI”，本机地址 `http://127.0.0.1:8765/v1`，默认密钥 `mmdb`。手机连接电脑时使用 LAN 启动窗口给出的地址。

详细功能、补丁和协议来源见 [启动包文档](USAGE.md)、[许可证](../LICENSE) 和 [第三方说明](THIRD_PARTY.md)。管理器更新源可用 `mmdb source HTTPS地址` 指定，`mmdb source clear` 恢复本仓库地址；安装包来自更新源并会执行其中的构建脚本，请使用可信发布地址。
