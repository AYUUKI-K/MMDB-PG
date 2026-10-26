MMDB 1.7.10 · 便携包快速说明

先完整解压，不要在压缩包内运行。
Windows 双击 MMDB.cmd；Linux / Android Termux 在包内执行 bash mmdb.sh。
程序、配置和日志属于当前目录。固定安装入口与目录见 docs/INSTALLATION.md。

最短使用步骤
1. 浏览器先安装并启用 Tampermonkey（油猴）。
2. 首次选 3，准备后台并打开脚本安装页；在油猴确认 MMDB 本地桥安装。
3. 同一设备打开 https://aistudio.google.com/prompts/new_chat，登录后点 Meow。
4. 等待本地已连接、Google 已就绪；酒馆填 http://127.0.0.1:8765/v1，默认密钥 mmdb。
5. 日常选 1；更新选 2 → 油猴确认 → 刷新 AI Studio。已安装脚本无需每次重装。
更新后选 0 退出并重开菜单，加载新版菜单内容；后台继续运行。

菜单
顶部显示文件版本和“便携目录”。菜单 4 分别显示文件、后台与已连接脚本的版本。
1  启动 / 继续使用；已有后台沿用当前模式。
2  更新程序、启动后台并打开脚本更新页；浏览器里仍需确认。
3  安装 / 更新当前版本的浏览器脚本；不下载新版程序。
4  版本、状态、模式和地址。
5  日志。
6  停止后台；先结束生成。
7  局域网启动，供手机连接此设备；切换前先选 6。
8  安装 / 修复项目依赖；先停止后台。
9  更新说明。
10 Node.js 安装入口：Windows 官方安装向导；Unix 显示安装方法。
0  退出菜单，后台继续运行。
结果页按回车返回。固定安装版的 8 是切回本机模式，没有 9 / 10。

手机连接电脑
电脑运行 MMDB 后台和已激活的 AI Studio 页面，结束生成后选 6，再选 7。
手机酒馆填菜单 4 或日志输出的 http://电脑局域网IP:8766/v1，密钥与电脑一致。
手机只调用电脑 API 时，无需再安装 MMDB 后台或浏览器脚本。
手机的 127.0.0.1 指手机自己。两端网络需互通，防火墙允许私网访问。
多网卡、VPN 或地址变化时核对 lan-config.json，示例见 lan-config.example.json。
LAN 只提供生成 API；浏览器执行器仍在后台所在设备运行。

运行环境
需要 Node.js 22+ 和 npm。Windows 缺少环境时选 10，完成向导后重新检测。
Termux 使用官方源：pkg install nodejs-lts npm。项目放主目录，不放共享存储。
Linux 使用适合本机的 Node.js 与 npm。
Android 独立运行也可按 docs/INSTALLATION.md 的 curl 命令使用固定安装。
AI Studio 页面必须保持打开。后台保活不能防止系统休眠、应用被杀或上游网络断流。

更新与保留
选 2 后不用再选 3。程序更新完成与油猴脚本安装完成是两个步骤。
便携更新直接下载官方 main 源码 ZIP，按提交判断变化，不调用 REST API，不需要 Git 或令牌。
配置、日志和根目录个人文件保留；旧程序放在 .updates/backup-*。
Git 工作区拒绝自动覆盖，请使用 Git 工作流。
下载或构建失败不替换原程序；恢复失败时保留路径供人工处理。
本地完整发布 ZIP 可用：node tools/portable-manager.mjs update "ZIP路径"。
旧完整发布 ZIP 与 HTTPS 配套 SHA-256 校验方式继续兼容。

命令行和前台运行
Windows：powershell -NoProfile -ExecutionPolicy Bypass -File ./MMDB.ps1 -Action check
Linux / Termux：bash mmdb.sh check
便携动作 check / install / start / lan / stop / status / logs / links / ready / ready-lan / script / update 保留。
script / update 命令准备并输出脚本地址，不自动打开网页。
npm start、Start.cmd、bash start.sh 是前台启动，保持终端运行，Ctrl+C 停止。
数字菜单启动的是后台，可关闭菜单，用菜单 6 停止。没有系统服务或开机自启。

常见排查
面板仍是旧版：确认油猴更新，然后刷新 AI Studio；菜单 4 核对三个版本。
已安装但未连接：切回 AI Studio 登录 / Meow，不必反复安装脚本。
提示已有页面连接：结束生成并关闭旧 AI Studio 页面，再连接目标页面。
本地已连接但 Google 请求失败：看具体上游错误，不能只靠本地保活判断。
完整配置与排查见 docs/USAGE.md；历史测试保留在 docs/HISTORY.md 和 docs/EXPERIMENTS.md。
