MMDB 1.7.7 便携菜单版

先完整解压，不要在压缩包里直接运行。
Windows 双击 MMDB.cmd；Linux / Android Termux 执行 bash mmdb.sh。
无需以管理员身份运行菜单，程序、配置和运行日志属于解压目录。

首次使用与日常使用

浏览器先安装并启用油猴（Tampermonkey）。首次选 3：自动补齐项目依赖、启动后台、打开脚本安装页。
缺少 Node.js 时，Windows 选 10 完成官方安装后再选 3；Linux / Termux 按下方运行环境说明安装。
在油猴确认安装后打开 https://aistudio.google.com/prompts/new_chat，登录并点击 Meow 激活。
等待本地连接和 Google 就绪，再在酒馆的“聊天补全 → 自定义兼容 OpenAI”填写 http://127.0.0.1:8765/v1，默认密钥 mmdb。
改过端口或密钥时，以菜单 4 和 config.json 为准。手机连接电脑时使用局域网启动显示的地址。
日常选 1 启动；已有后台不重复启动，已有 AI Studio 脚本连接不重复打开网页。
没有连接时等待约 3 秒供旧页面重连，仍未连接才打开 Playground，登录后点 Meow。
只能检测本后台的脚本连接，不能识别未安装或未连接脚本的浏览器标签页。
Windows 用默认浏览器，Termux 优先用 termux-open-url；自动打开失败时显示地址。

全部选项直接显示在主菜单

1：启动后台，按连接状态打开 AI Studio Playground；已有后台保持当前模式。
2：更新全部。下载源码并识别提交 → 构建 → 保留配置、备份旧版 → 启动新版后台 → 打开脚本更新页。
3：安装 / 更新浏览器脚本（首次用）。使用本目录当前版本，后台未运行时自动准备。
4：查看状态、运行环境与酒馆连接地址。
5：查看运行日志。
6：停止本目录后台。有生成或验证请求时先结束请求。
7：启动局域网模式。切换模式前先选 6 停止后台。
8：安装 / 修复项目依赖，需要先停止后台；满足锁定版本时跳过下载。
9：查看程序更新说明。
10：Windows 下载、校验并打开官方 Node.js LTS 安装向导；Unix 显示对应平台的安装方法。
0：退出菜单，后台继续运行。操作结果页按回车返回。

更新全部的最后一步

选 2 后无需再选 3。菜单会自动打开对应版本的油猴更新页。
你仍需在油猴中确认更新，并刷新 AI Studio；菜单不能代替浏览器完成确认。
更新前先结束生成。仅更新脚本可选 3；手动使用油猴“检查更新”时需要后台运行。

更新范围与恢复

默认直接下载 GitHub main 源码 ZIP，从包内读取提交号并在本机构建；不调用 REST API，不需要 Git 或访问令牌。
维护者提交并推送源码后即可更新；浏览器脚本有改动时仍需提高版本号。
旧发布包及本地 ZIP 更新继续兼容；自定义 HTTPS 发布包仍需配套 SHA-256 文件。
便携版直接更新当前目录，配置、日志及根目录个人文件保留；旧程序保存在 .updates/backup-*。
下载、校验或准备依赖失败时不替换原程序；替换或新版启动失败时尝试恢复原程序。
如果恢复受文件占用等因素阻止，菜单会显示保留的恢复路径；不要删除这些文件。
源码提交记录在 .source-revision.json；同一提交不重复替换，不同提交即使版本相同也会更新。
拒绝版本降级；Git 工作区不能自动覆盖。下载或网络失败时可以稍后重试。

运行环境

需要 Node.js 22+ 和 npm。Windows 缺少 Node.js 时选 10，官方安装向导中保留 npm 组件。
安装器保存在 .downloads；下载失败时可手动访问 https://nodejs.org/en/download 。
Linux 按 Node.js 官网说明安装；Termux 使用官方源执行 pkg install nodejs-lts npm。
Termux 把项目放在主目录，不要在 /sdcard 等共享存储中运行，不使用桌面 Linux 的 Node.js 二进制包。
保持 Termux 和 AI Studio 运行，系统强制冻结应用会影响服务。

命令行方式

Windows：powershell -NoProfile -ExecutionPolicy Bypass -File ./MMDB.ps1 -Action check
Linux / Termux：bash mmdb.sh check
原有动作 check / install / start / lan / stop / status / logs / links 保留。
ready / ready-lan 自动补齐依赖并启动；script 准备并输出脚本地址；update 更新程序并准备脚本地址。
命令行动作不自动打开浏览器。离线更新可执行 node tools/portable-manager.mjs update 实际ZIP路径。
Windows 也可使用 MMDB.ps1 -Action update -Package 实际ZIP路径。

本包不内置 Node.js，不创建系统服务或开机自启。需要固定目录安装时见 INSTALLATION.md。
Windows 已验证更新与配置保留；Unix 脚本另做隔离安装验证，但不代表 Linux / Termux 真机运行验证。
