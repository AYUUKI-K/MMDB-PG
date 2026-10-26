# 安装、迁移与在线更新

本文说明固定目录安装器。源码开发与解压即用的便携菜单见[主说明](../README.md)和[便携菜单说明](PORTABLE_README.txt)。以下命令在安装包或仓库根目录执行。

菜单选择 1 启动后台，或选择局域网启动，确认服务就绪后先检查 AI Studio 页面连接。已有连接就继续使用现有页面；没有连接时等待约 3 秒供旧页面重连，仍未连接才打开 Playground。只能识别连接到本后台的脚本，不能识别未安装或未连接脚本的浏览器标签页。Windows 使用默认浏览器，Termux 优先使用 termux-open-url；无法自动打开时显示地址。新页面仍需登录并点击 Meow 激活。查看状态和命令行诊断不会自动打开网页。

## Android Termux：首次安装并启动

先安装下载工具：

```sh
pkg install curl
```

然后执行一条命令：

```sh
curl -fL https://raw.githubusercontent.com/AYUUKI-K/MMDB-PG/main/mmdb.sh -o "$HOME/mmdb-install.sh" && bash "$HOME/mmdb-install.sh"
```

进入数字管理菜单。浏览器先安装并启用油猴（Tampermonkey）。首次直接选 `3` 安装浏览器脚本：自动准备缺少的 Node.js、npm 和 unzip、下载 main 源码快照并识别提交、安装依赖并启动后台，再打开脚本安装页。在油猴确认安装后打开 [AI Studio Playground](https://aistudio.google.com/prompts/new_chat)，登录并点击 Meow 激活。日常选 `1` 启动；程序安装目录为 `~/mmdb-pg`。

首次安装成功后，`~/mmdb-install.sh` 可以删除。管理器保存在 `~/.local/share/mmdb/`，`mmdb` 命令会继续可用。

## 以后怎么用

只输入 `mmdb`，然后用数字操作：

| 数字 | 操作 |
|---|---|
| 1 | 启动 / 继续使用，保留已有后台模式 |
| 2 | 更新全部：下载源码、启动后台、自动打开脚本更新页 |
| 3 | 仅安装 / 更新浏览器脚本，自动准备后台 |
| 4 | 查看版本、连接状态与酒馆地址 |
| 5 | 查看日志，按 1 刷新 |
| 6 | 停止后台 |
| 7 | 启动局域网模式 |
| 8 | 切换回本机模式 |
| 0 | 退出菜单 |

所有选项直接显示，操作结果页按回车返回。返回或退出菜单不会停止后台，用主菜单 6 停止。仍需保持 Termux 和 AI Studio 运行。

Windows 固定管理器选择不同启动模式时，先确认后台空闲再切换；Unix 固定管理器及便携版先停止再切换。主菜单 1 和 3 不重复启动或中断现有请求。

旧版管理器用户重新执行上面的首次命令一次，即可获取支持源码更新的菜单。原发布包更新入口也保留兼容版本。已有反代的配置会保留。高级命令 `mmdb start / lan / stop / upgrade / status` 仍然可用，其中直接 `start / lan / upgrade` 使用前台运行。

生成结束后再升级。可在另一个 Termux 会话执行更新命令；管理器仅停止能确认归属的本机进程，不会按端口强杀其他程序。其他目录的旧反代请先在原启动窗口 Ctrl+C。

更新先在临时目录解压源码并安装依赖，准备完成后替换安装目录。保留 `config.json`、`lan-config.json`、`st-path.json` 和诊断日志。旧目录保存在 `~/.local/share/mmdb/backup.*`，便于人工回退；这些备份不会自动删除。不要同时运行旧备份和新目录。

**以后直接选 2“更新全部”**。菜单直接下载 main 源码快照、识别提交并构建、保留配置、启动后台，并接着打开对应版本的油猴脚本安装页。你只需在油猴确认更新，再刷新 AI Studio。无需返回菜单再选一次。若只需安装或修复当前程序的脚本，选 3。

更新前结束生成。手动使用油猴“检查更新”时也需要本机后台运行。Windows 和 Unix 的 `update-all` 命令会更新并输出脚本安装地址，不自动打开浏览器；原有更新命令继续兼容。

## 旧用户迁移

1.7.6 菜单若报“检查源码失败：HTTP 403”，先退出菜单，重新执行上面的 `curl ... mmdb-install.sh` 命令获取新版管理器，再选 **2 更新全部**。新版直接下载官方源码 ZIP，不再调用发生限流的 API；原安装和配置会保留。

原来就在 `~/mmdb-pg`：结束生成，执行上面的首次命令，再选 `2`，即可保留配置更新并接入管理器，菜单会接着打开浏览器脚本更新页。原来放在其他目录：先停止那份后台，再安装；自定义配置需从原目录迁移，管理器不会猜测并删除其他目录。

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

先安装 Node.js 22+。[下载最新版 ZIP](https://raw.githubusercontent.com/AYUUKI-K/MMDB-PG/main/downloads/mmdb-pg-latest.zip)，完整解压后在包目录执行 `powershell -ExecutionPolicy Bypass -File .\mmdb-manager.ps1`，进入固定安装数字菜单。主菜单编号与便携版一致：`1` 启动、`2` 更新全部、`3` 仅浏览器脚本、`4` 状态与地址、`5` 日志、`6` 停止、`7` 局域网、`8` 切回本机。

首次直接选 `3`，自动安装程序并准备后台，再打开浏览器脚本安装页；后续双击固定管理目录中的 `MMDB.cmd`。解压目录中的 MMDB.cmd 打开便携菜单。程序安装到 `%LOCALAPPDATA%\MMDB-PG\app`，固定管理入口为 `%LOCALAPPDATA%\MMDB-PG\manager\MMDB.cmd`，可创建桌面快捷方式。`2` 从本仓库更新程序、保留配置并自动打开浏览器脚本更新页；后台运行时关闭菜单不会停止，用主菜单 `6` 停止。

旧用户迁移前先结束生成、关闭原启动窗口。管理器首次安装会从它旁边的旧启动包目录复制 `config.json / lan-config.json / st-path.json` 和诊断日志；其他位置的配置不会自动寻找。旧的 `Start.cmd / Start-LAN.cmd` 保留，但不要与新管理器同时启动。

如果 GitHub 下载失败，可以先手动下载 ZIP 后用 PowerShell 执行 `powershell -ExecutionPolicy Bypass -File .\mmdb-manager.ps1 -Action install -Package "实际ZIP路径"`，再回菜单启动。后台升级后，在油猴中检查脚本更新并刷新 AI Studio。

## 浏览器和酒馆设置

先在浏览器安装并启用油猴（Tampermonkey）。菜单 3 会准备后台并打开脚本安装页，也可手动打开 `http://127.0.0.1:8765/local-pg.user.js`。在油猴确认安装后打开 [AI Studio Playground](https://aistudio.google.com/prompts/new_chat)、登录并点击 Meow 激活，等待本地连接和 Google 就绪。

酒馆使用“聊天补全 → 自定义兼容 OpenAI”，本机地址 `http://127.0.0.1:8765/v1`，默认密钥 `mmdb`。手机连接电脑时使用 LAN 启动窗口给出的地址。

详细功能、补丁和协议来源见 [启动包文档](USAGE.md)、[许可证](../LICENSE) 和 [第三方说明](THIRD_PARTY.md)。管理器更新源可用 `mmdb source HTTPS地址` 指定，`mmdb source clear` 恢复本仓库地址；安装包来自更新源并会执行其中的构建脚本，请使用可信发布地址。

## 维护者如何发布更新

新版菜单默认从 GitHub 官方 codeload 下载 `AYUUKI-K/MMDB-PG` 的 main 源码 ZIP，从同一份 ZIP 的注释读取完整提交号，再安装锁定依赖并构建。全程不调用 GitHub REST API，不需要访问令牌。用户无需安装 Git，也无需等待维护者手动打包。更新只安装程序文件，不安装仓库中的 downloads、工作流等文件。

维护者验证后提交并推送源码即可。程序按提交判断是否有变化，`.source-revision.json` 记录安装提交；同提交不重复替换，同版本不同提交仍可更新。浏览器脚本有改动时，仍需同步提高 package.json、package-lock.json 和 src/shared/version.js 的版本，方便油猴识别更新。油猴安装确认和刷新 AI Studio 仍需用户完成。

为旧版管理器和手动下载保留发布包。兼容包可以通过以下命令生成，并将 ZIP 与校验文件一同推送：

```sh
npm run package -- --update-latest
```

旧版首次升级可以继续读取 downloads/mmdb-pg-latest.zip；升级至新版菜单后默认使用源码。Unix 若手动设置过旧发布包地址，可运行 `mmdb source clear` 恢复默认源码来源。自定义 HTTPS 发布包仍需同地址加 `.sha256` 的校验文件；明确指定本地完整 ZIP 也继续支持。

源码下载只访问 GitHub 官方 codeload 域名，不消耗 REST API 配额。每次检查会下载源码包，同一提交仍跳过替换；提交号缺失、格式错误或下载失败时保留原程序，不会自动切到不明镜像。便携版原目录更新，旧程序保存在 `.updates`，配置和日志保留；Git 工作区拒绝自动覆盖。

Windows、Linux 和 Termux 使用相同的提交来源和安装流程，运行环境各自准备。Termux 使用官方 `nodejs-lts` / npm，固定安装器按需准备 unzip；项目放在 `~/mmdb-pg`，不要放在共享存储。手机浏览器需要支持用户脚本；安卓的应用后台限制仍可能中断 Termux 或 AI Studio。iOS 不提供 Termux 宿主，不包含在本地运行支持范围内。
