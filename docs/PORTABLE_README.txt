MEOW-FM 2.0.2 · 喵喵电波

先完整解压，不要在压缩包内运行。
Windows 双击 MMDB.cmd；Linux / Android Termux 在包内执行 bash mmdb.sh。
程序、配置和日志属于当前目录。固定安装入口与目录见 docs/INSTALLATION.md。

最短使用步骤（浏览器模式）
1. 浏览器先安装并启用 Tampermonkey（油猴）。
2. 首次选 4「更多」→ 5「安装 / 更新浏览器脚本」，准备后台并打开脚本安装页；在油猴确认 MMDB 本地桥安装。
3. 同一设备打开 https://aistudio.google.com/prompts/new_chat，登录后点 Meow。
4. 等待本地已连接、Google 已就绪；酒馆填 http://127.0.0.1:8765/v1，默认密钥 mmdb。
5. 日常选 1；更新选 2 → 油猴确认 → 刷新 AI Studio。已安装脚本无需每次重装。
更新后选 0 退出并重开菜单，加载新版菜单内容；后台继续运行。

独立后端
独立模式日常直接打开 runtime-manager/Manager.cmd，在网页中管理账号池、Camoufox、后台和守护。
MMDB 主菜单 3 打开账号管理与教程；更多 → 启动与守护设置管理进程守护。
更多 → 重启后台会重启 PG 与已打开的账号管理；有活动任务时拒绝重启。
Windows x64 账号页可从本机 Chrome 获取 OAuth 材料，新账号按邮箱导入，已有账号可原位补充。
无需保持 AI Studio 打开，也无需安装油猴脚本。选 2 更新后不会打开脚本安装页。
账号管理服务在退出菜单后仍可访问，重复选 3 会复用入口；电脑重启后再选 3 创建新入口。
更多 → 停止后台只停止 PG，独立运行时、管理入口与凭证保留。账号池默认优先用完当前账号，支持失效切换和模型冷却；部分输出不重放。
首次安装运行时、启用方式和凭证说明见 docs/HEADLESS.md。

菜单
顶部显示 MEOW-FM 与文件版本，中文名为喵喵电波。更多 → 连接地址与状态分别显示文件、后台与已连接脚本的版本。
顶部显示反代与执行后端状态：浏览器模式看脚本连接；独立模式看运行时与账号是否就绪。
返回菜单会刷新状态。启动过程中显示“正在启动”，失败时查看更多 → 查看日志。
1  启动 / 继续使用；同时准备本机和同 Wi-Fi 手机入口，复用已有后台。
2  更新程序、启动后台；浏览器模式打开脚本更新页，独立模式检查后端。
3  账号管理与教程。
4  更多：1 连接地址与状态；2 日志；3 重启；4 停止；5 浏览器脚本；6 执行模式；7 启动与守护；8 修复与依赖。
5  更新说明。
0  退出菜单，后台继续运行。
结果页按回车返回。固定安装与便携安装使用相同菜单。

安卓画中画
AI Studio 展开面板后，支持视频画中画的浏览器显示“画中画 ↗”。
先在系统设置中允许浏览器画中画，再点击按钮，切到酒馆时可继续查看连接和生成状态。
小窗是静音状态视频，设置请回原页面操作；关闭小窗会释放资源。
采用本地首帧 → 1fps 视频 → 等待就绪并播放 → 请求 PiP 的顺序，画面由本项目自行绘制。
修正浏览器有 PiP 调用方法但没有能力标志时被误判不支持的问题。
Via / WebView 如果没有提供 PiP 调用方法，仍无法由脚本强行开启；面板会显示原因，可继续使用现有后台保活。
保留 AI Studio 页面与 Termux 后台；画中画不能保证抵抗系统杀进程。

手机连接电脑
电脑选 1 启动 MMDB；网页模式保持已激活的 AI Studio 页面，独立模式确认账号就绪。
手机酒馆填更多 → 连接地址与状态或日志输出的 http://电脑局域网IP:8766/v1，密钥与电脑一致。
手机只调用电脑 API 时，无需再安装 MMDB 后台或浏览器脚本。
手机的 127.0.0.1 指手机自己。两端网络需互通，防火墙允许私网访问。
多网卡、VPN 或地址变化时核对 lan-config.json，示例见 lan-config.example.json。
LAN 只提供生成 API；浏览器执行器仍在后台所在设备运行。

运行环境
需要 Node.js 22+ 和 npm。Windows 缺少环境时选更多 → 修复与依赖 → 安装 / 修复 Node.js，完成向导后重新检测。
Termux 使用官方源：apt update && apt full-upgrade -y && apt install -y nodejs-lts npm curl unzip。
项目放主目录，不放共享存储。curl 报 CANNOT LINK EXECUTABLE / SSL_set_quic_tls_early_data_enabled 时，
先按 docs/INSTALLATION.md 的「Termux 系统库修复」完整升级；pkg 自身依赖 curl，不能靠反复 pkg install curl 修复。
Linux 使用适合本机的 Node.js 与 npm。
Android 独立运行也可按 docs/INSTALLATION.md 的 curl 命令使用固定安装。
AI Studio 页面必须保持打开。后台保活不能防止系统休眠、应用被杀或上游网络断流。

更新与保留
选 2 后会自动准备浏览器脚本；程序更新完成与油猴脚本安装完成是两个步骤。
便携更新直接下载官方 main 源码 ZIP，按提交判断变化，不调用 REST API，不需要 Git 或令牌。
配置、日志、.headless 凭证和根目录个人文件保留；旧程序放在 .updates/backup-*。
Git 工作区拒绝自动覆盖，请使用 Git 工作流。
下载或构建失败不替换原程序；恢复失败时保留路径供人工处理。
2.0.1 保留已有程序目录并逐文件更新。旧版出现 EPERM / EBUSY 目录改名失败时，先按 docs/INSTALLATION.md 的修复补丁步骤替换更新器，再选 2。
本地完整发布 ZIP 可用：node tools/portable-manager.mjs update "ZIP路径"。
旧完整发布 ZIP 与 HTTPS 配套 SHA-256 校验方式继续兼容。

命令行和前台运行
Windows：powershell -NoProfile -ExecutionPolicy Bypass -File ./MMDB.ps1 -Action check
Linux / Termux：bash mmdb.sh check
便携动作 check / install / start / lan / stop / status / logs / links / ready / ready-lan / script / update 保留。
script / update 命令准备并输出脚本地址，不自动打开网页。
npm start、Start.cmd、bash start.sh 是前台启动，保持终端运行，Ctrl+C 停止。
数字菜单启动的是后台，可关闭菜单，用更多 → 停止后台停止。进程守护与 Windows 登录自启动按需开启，登录自启动默认关闭。

常见排查
面板仍是旧版：确认油猴更新，然后刷新 AI Studio；更多 → 连接地址与状态核对三个版本。
已安装但未连接：切回 AI Studio 登录 / Meow，不必反复安装脚本。
提示已有页面连接：结束生成并关闭旧 AI Studio 页面，再连接目标页面。
本地已连接但 Google 请求失败：看具体上游错误，不能只靠本地保活判断。
完整配置与排查见 docs/USAGE.md；历史测试保留在 docs/HISTORY.md 和 docs/EXPERIMENTS.md。

2.0.2 等待设置
普通模型默认 180 秒，抗截断首个有效正文默认 1000 秒。
旧安装保留自定义配置；需要调整时将 config.json 的 timeoutMs 设为 180000、toolFirstByteTimeoutMs 设为 1000000，再在空闲时重启后台。
