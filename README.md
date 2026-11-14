# MEOW-FM · 喵喵电波

终端菜单使用 MEOW-FM 名称，沿用 MMDB 文件名和安装路径。

把已登录的 Google AI Studio Playground 连接到酒馆或兼容 OpenAI 的客户端。当前源码版本 **2.0.2**，支持 Windows、Linux 和 Android Termux，需要 Node.js 22+、npm，以及支持用户脚本的浏览器。

Windows 旧版更新遇到 `EPERM` / `EBUSY` 目录改名失败时，可先应用[更新器修复补丁](https://raw.githubusercontent.com/AYUUKI-K/MMDB-PG/main/downloads/mmdb-windows-update-hotfix.zip)，再在原菜单选 2；[操作步骤](docs/INSTALLATION.md#下载失败与手动更新)。

**一次启动，电脑和同 Wi-Fi 手机同时可用。** 电脑继续填 `http://127.0.0.1:8765/v1`，手机填菜单显示的 `http://电脑局域网IP:8766/v1`。两边的默认 API 密钥都是 **`mmdb`**；自定义密钥和端口会保留。手机上的 `127.0.0.1` 指手机自己，不能代替电脑的局域网地址。

终端顶部显示版本、后台和执行后端状态。主菜单只有五项：**1 启动 / 继续使用、2 更新全部、3 账号管理与教程、4 更多、5 更新说明**；**0 退出**。连接地址、日志、重启、停止、浏览器脚本、执行模式、启动设置及依赖修复都放在「更多」，按 1–8 连续编号。

网页模式需要保持 AI Studio 页面打开，并点击 **Meow** 激活；独立模式使用本机导入的凭证。后台保活不能抵抗设备休眠或系统强制冻结。支持视频画中画的安卓浏览器可用小窗查看状态，详见[安卓画中画](docs/USAGE.md#安卓画中画)。

## 先选你的用法

无浏览器后端见[独立运行时与凭证管理](docs/HEADLESS.md)。已拆出 [Runtime Manager 独立控制台](runtime-manager/README.md)：直接双击 `runtime-manager/Manager.cmd` 管理账号池、Camoufox、后台启停与无人值守。默认优先用完当前账号，支持额度冷却、失效切换和进程恢复；Windows 登录自启动默认关闭。

主菜单 **3** 的账号管理页支持一键抓取浏览器凭证。首次在 Chrome / Edge 加载并连接随项目提供的[凭证助手扩展](browser-extension/README.md)，之后按页面三步教程点击“导入当前账号”即可；手动导入仍可使用。

Windows x64 还可在账号页选择“从本机 Chrome 导入（含 OAuth 续签）”，按邮箱获取并验证续签材料；已有账号可直接点“获取 Chrome OAuth”。普通 Cookie 抓取不包含刷新令牌，具体条件见 [OAuth 导入说明](docs/HEADLESS.md#获取-oauth-续签材料windows-x64)。

「更多 → 执行模式」 选择网页或独立模式；有活动生成时拒绝切换，切换失败恢复原配置。「更多 → 启动与守护设置」 开关启动后打开 AI Studio Playground，两种模式均支持，同一轮后台启动避免重复打开。独立模式的网页面板显示“独立模式”，无需 Meow；网页模式多开时可在空闲后点击“使用此页面连接”，被接替的页面不会自动抢回连接。

| 用法 | 后台与 AI Studio 放在哪里 | 酒馆连接地址 |
| --- | --- | --- |
| 电脑本机使用 | 同一台电脑 | 默认 `http://127.0.0.1:8765/v1` |
| 安卓手机独立使用 | 同一部手机：Termux 后台 + 支持脚本的浏览器 | 默认 `http://127.0.0.1:8765/v1` |
| 手机连接电脑 | 电脑运行后台与 AI Studio；手机只运行酒馆客户端 | 菜单显示的 `http://电脑局域网IP:8766/v1` |

手机只调用电脑反代时，不需要在手机上再装 Node.js、Termux 或 MMDB 浏览器脚本。LAN 入口提供生成 API，浏览器执行器仍连接运行后台的那台设备。详见[手机连接电脑](docs/INSTALLATION.md#手机连接电脑)。

## Windows：首次安装

1. 浏览器安装并启用油猴（Tampermonkey）。[下载最新版 ZIP](https://raw.githubusercontent.com/AYUUKI-K/MMDB-PG/main/downloads/mmdb-pg-latest.zip)，完整解压，双击 `MMDB.cmd`。
2. 选 **4「更多」→ 5「安装 / 更新浏览器脚本」**。缺少 Node.js 时，先到 **更多 → 修复与依赖 → 安装 / 修复 Node.js** 完成官方安装。菜单会准备依赖、启动后台并打开脚本安装页。
3. 在油猴中确认安装 **MMDB 本地桥**。打开 [AI Studio Playground](https://aistudio.google.com/prompts/new_chat)，登录，点击面板 **Meow**，等待“本地已连接 / Google 已就绪”。Meow 会在当前标签页新建对话并发送一次问候，请先处理未发送的草稿。
4. 酒馆选择“聊天补全 → 自定义兼容 OpenAI”，填写 `http://127.0.0.1:8765/v1`，默认密钥 `mmdb`，刷新模型列表并选模型。改过端口或密钥时，以「更多 → 连接地址与状态」及 `config.json` 为准。

以上是**便携目录**用法，配置保存在解压目录。已有固定安装的用户继续使用 `%LOCALAPPDATA%\MMDB-PG\manager\MMDB.cmd`，不要同时启动两份。固定安装与迁移见[安装说明](docs/INSTALLATION.md#windows-固定安装与旧用户迁移)。

## Android Termux：首次安装

在 Termux 中执行：

```sh
apt update && apt full-upgrade -y && apt install -y curl nodejs-lts npm unzip &&
curl -fL https://raw.githubusercontent.com/AYUUKI-K/MMDB-PG/main/mmdb.sh -o "$HOME/mmdb-install.sh" && bash "$HOME/mmdb-install.sh"
```

先完整升级 Termux 软件包，再安装依赖；任一步失败都会停止。若出现 `CANNOT LINK EXECUTABLE "curl"` / `SSL_set_quic_tls_early_data_enabled`，按[Termux 系统库修复](docs/INSTALLATION.md#termux-系统库修复)恢复后重试。

进入**固定安装**菜单后选 **1** 启动，再选 **4 → 5** 安装浏览器脚本。在同一手机的脚本浏览器中确认安装，再打开 AI Studio 登录并点击 Meow。后续输入 `mmdb` 即可打开菜单。项目安装在 `~/mmdb-pg`，不要放到 `/sdcard` 等共享存储。

Linux 先准备 Bash、Node.js 22+、npm、curl、unzip，再执行同一条 `curl ... && bash ...` 命令。详细步骤、命令找不到和旧管理器升级见[安装说明](docs/INSTALLATION.md)。

1.19.0 增加独立模式的**调用与诊断**，并支持两种模式发送 PNG / JPEG / WebP 图像。旧用户更新、维护者发布及 Bot 参数请看 [更新到 Bot 使用的完整流程](docs/BOT_UPGRADE.md)。

## 日常启动、更新和停止

| 主菜单 | 用途 |
| --- | --- |
| 1 | 启动 / 继续使用，自动准备电脑和手机入口 |
| 2 | 更新全部，保留配置与凭证；网页模式需要确认油猴更新 |
| 3 | 账号管理与详细导入教程 |
| 4 | 更多：1 地址与状态、2 日志、3 重启、4 停止、5 浏览器脚本、6 执行模式、7 启动与守护、8 修复与依赖 |
| 5 | 更新说明 |
| 0 | 返回或退出，后台继续运行 |

各平台菜单编号一致。安装目录与维护命令见[安装说明](docs/INSTALLATION.md#菜单与安装目录对照)。

程序更新后，选 0 退出并重新打开菜单，以加载新版菜单内容；后台继续运行。

选 1 时，独立模式直接显示后台与账号状态。浏览器模式先等待已有页面重连，仍未连接才尝试打开 Playground。浏览器未自动打开时，复制提示地址到装有油猴的浏览器。已安装脚本的用户无需每次重装。

## 模型与功能

- 普通文本模型：例如 `pg-gemini-4-argon`，支持流式响应。
- 抗截断模型：例如 `pg-gemini-4-argon-抗截断`，沿用现有正文工具与续写流程。1.7.9 / 1.7.11 没有调整抗截断策略。
- 模型列表：保留配置中的普通 / 抗截断条目，并在当前页面能力目录有效时追加新识别的普通文本模型；目录失效时回退到配置。新模型可用性仍取决于上游权限。
- 工具读取输入、原生续写：均默认关闭；可开启合成读取记录，省去一次读取请求，详见[使用说明](docs/USAGE.md#生成设置)。
- 请求计数：面板显示本轮上游次数和后台启动累计，最近活动区分读取、正文、续写与重试。
- 客户端工具：支持 OpenAI `tools`、`tool_choice`、`tool_calls` 和结果回传；工具由客户端执行。携带工具声明或历史的请求跳过内置读取及抗截断封装，详见[工具接口](docs/USAGE.md#客户端工具接口)。
- 保活与状态：保留默认开启的 WebRTC 保活，新增默认关闭的静音音频辅助选项；一键菜单显示反代运行模式与浏览器脚本连接状态。
- 单页面执行：需要换号时结束生成、关闭旧页面，在新账号页面 Meow 激活。没有账号轮询、自动换号或云端 Cookie 推送。
- 面板可跟随同一浏览器中的酒馆主题。桌面置顶窗取决于浏览器能力；手机不支持时使用页内状态条。

## 常见问题

| 现象 | 先做什么 |
| --- | --- |
| 安装页没弹出，或只显示源码 | 把菜单提供的脚本地址复制到装有且已启用油猴的浏览器 |
| 程序更新了，面板还是旧版 | 在油猴确认脚本更新，再刷新 AI Studio；核对菜单 4 的版本 |
| 本地已连接，但 Google 生成失败 | 查看原始错误；本地连接正常不等于 Google 上游连接正常 |
| 手机无法使用 `127.0.0.1` 连接电脑 | 使用菜单 7 输出的电脑局域网地址，检查同网和防火墙 |
| 提示另一个页面已连接 | 结束生成并关闭旧 AI Studio 页面，再在目标页面重连 |

更多排查见[使用说明](docs/USAGE.md#常见问题)。

## 开发、验证与发布

仓库根目录就是项目根目录：

```sh
npm ci --ignore-scripts
npm start
```

局域网前台入口为 `npm run start:lan`。Git 工作区使用 Git 更新；菜单不会覆盖工作区。源码目录、测试与发布命令见[架构与维护说明](docs/ARCHITECTURE.md#验证与发布)。

## 文档与来源

- [安装、迁移与更新](docs/INSTALLATION.md)
- [使用、配置与排查](docs/USAGE.md)
- [便携包内快速说明](docs/PORTABLE_README.txt)
- [架构与维护](docs/ARCHITECTURE.md)
- [历史更新](docs/HISTORY.md)、[历史实验](docs/EXPERIMENTS.md)、[历史模型调查](docs/MODEL_OBSERVABILITY.md)
- [许可证](LICENSE)、[第三方来源与许可](docs/THIRD_PARTY.md)

感谢 [AIStudio2API](https://github.com/Mag1cFall/AIStudio2API)、[CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)、[agy2api](https://github.com/su-kaka/agy2api) 与其注明的 [Antigravity-gateway](https://github.com/Xeltra233/Antigravity-gateway)、[aistudio-api](https://github.com/DeconstructedCube/aistudio-api)、早期 Catiecli Executor，以及 SillyTavern、Tampermonkey、Chrome 的接口文档。各自使用范围与许可见第三方说明。

离线测试不调用 Google，不代表已验证所有真实模型、安卓后台环境或长输出连接。
