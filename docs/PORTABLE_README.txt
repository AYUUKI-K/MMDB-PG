MMDB 1.7.2 便携菜单版

先完整解压，不要在压缩包里直接运行。
程序、配置与运行日志都保存在解压目录；移动文件夹前先停止后台。

Windows

双击 MMDB.cmd 打开中文菜单，无需以管理员身份运行菜单。
1：检测 Node.js、npm、项目依赖和本目录后台状态。
8：缺少 Node.js 时，从 nodejs.org 自动选择 x64 / ARM64 的 LTS 安装器；校验官方 SHA-256 后打开安装向导。安装过程由你确认，不静默安装；保留 npm 组件。
2：安装 / 修复项目依赖。满足锁定版本时跳过下载，否则从 npm 官方源安装；不执行依赖安装脚本。
3：启动本机后台；4：启动局域网后台。
6：查看并打开浏览器用户脚本安装页；油猴的安装 / 更新确认需要手动点击。之后刷新 AI Studio、登录并点击 Meow 激活。
5：停止这份便携包的后台；有生成或验证请求时会提示先结束请求。
7：查看运行日志；0：退出菜单，后台继续运行。

如果 Node.js 已安装但检测不到，重新打开菜单后再试。官方下载失败时，可自行访问 https://nodejs.org/en/download 完成安装；菜单不会切换到第三方镜像。安装器保存在 .downloads，可稍后手动运行。

Linux / Android Termux

执行 bash mmdb.sh 打开同样的数字菜单。
Linux 请先按 Node.js 官网说明安装 Node.js 22+ 和 npm；系统依赖由用户安装。
Termux 使用官方软件源执行 pkg install nodejs-lts npm，再进入菜单选择 2、3。不要使用桌面 Linux 的 Node.js 二进制包。
Termux 请把解压后的目录放在其主目录内，不要放在 /sdcard 等共享存储中运行。保持 Termux 和 AI Studio 页面运行；系统冻结应用会中断服务。

脚本命令方式（便于诊断）

Windows：powershell -NoProfile -ExecutionPolicy Bypass -File .\MMDB.ps1 -Action check
Linux / Termux：bash mmdb.sh check
可用动作：check / install / start / lan / stop / status / logs / links。

便携范围与更新

本包不内置 Node.js，不修改系统 PATH，不创建系统服务或开机自启。Node.js 官方安装器可能按用户选择安装到系统位置；程序自身及 npm 项目依赖留在本目录。
便携包按完整包升级：先停止旧后台，解压新包，再按需迁移 config.json、lan-config.json、st-path.json 和 accounts.json。需要通过管理器在线更新时，按 INSTALLATION.md 使用固定目录安装方式。
浏览器脚本已有本机更新入口；更新后仍需刷新 AI Studio。

运行环境：Node.js 22+。Windows 的安装、更新、配置保留和进程管理已通过集成测试；Linux / Termux 真机安装尚未验证。

MMDB 浏览器面板 → 生成设置 → 工具读取输入。开启后在酒馆普通输入框输入并发送即可；每轮增加一次模型读取请求。工具读取输入和原生续写均保留独立开关，新安装默认关闭。
