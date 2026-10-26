# MEWO-FM · 喵喵电波

终端菜单使用 MEWO-FM 名称，沿用 MMDB 文件名和安装路径。

把已登录的 Google AI Studio Playground 连接到酒馆或兼容 OpenAI 的客户端。当前版本 **1.7.11**，支持 Windows、Linux 和 Android Termux，需要 Node.js 22+、npm，以及支持用户脚本的浏览器。

**首次选 3，日常选 1，更新选 2。** 浏览器仍须安装 MMDB 用户脚本，并保持 AI Studio 页面打开；点击 **Meow** 完成会话激活。后台保活默认开启，但不能保证抵抗设备休眠或手机系统强制冻结。

## 先选你的用法

| 用法 | 后台与 AI Studio 放在哪里 | 酒馆连接地址 |
| --- | --- | --- |
| 电脑本机使用 | 同一台电脑 | 默认 `http://127.0.0.1:8765/v1` |
| 安卓手机独立使用 | 同一部手机：Termux 后台 + 支持脚本的浏览器 | 默认 `http://127.0.0.1:8765/v1` |
| 手机连接电脑 | 电脑运行后台与 AI Studio；手机只运行酒馆客户端 | 菜单显示的 `http://电脑局域网IP:8766/v1` |

手机只调用电脑反代时，不需要在手机上再装 Node.js、Termux 或 MMDB 浏览器脚本。LAN 入口提供生成 API，浏览器执行器仍连接运行后台的那台设备。详见[手机连接电脑](docs/INSTALLATION.md#手机连接电脑)。

## Windows：首次安装

1. 浏览器安装并启用油猴（Tampermonkey）。[下载最新版 ZIP](https://raw.githubusercontent.com/AYUUKI-K/MMDB-PG/main/downloads/mmdb-pg-latest.zip)，完整解压，双击 `MMDB.cmd`。
2. 选 **3「安装 / 更新浏览器脚本」**。缺少 Node.js 时，先选 **10** 完成官方安装，再选 3。菜单会安装项目依赖、启动后台并打开脚本安装页。
3. 在油猴中确认安装 **MMDB 本地桥**。打开 [AI Studio Playground](https://aistudio.google.com/prompts/new_chat)，登录，点击面板 **Meow**，等待“本地已连接 / Google 已就绪”。Meow 会在当前标签页新建对话并发送一次问候，请先处理未发送的草稿。
4. 酒馆选择“聊天补全 → 自定义兼容 OpenAI”，填写 `http://127.0.0.1:8765/v1`，默认密钥 `mmdb`，刷新模型列表并选模型。改过端口或密钥时，以菜单 **4** 与 `config.json` 为准。

以上是**便携目录**用法，配置保存在解压目录。已有固定安装的用户继续使用 `%LOCALAPPDATA%\MMDB-PG\manager\MMDB.cmd`，不要同时启动两份。固定安装与迁移见[安装说明](docs/INSTALLATION.md#windows-固定安装与旧用户迁移)。

## Android Termux：首次安装

在 Termux 中执行：

```sh
pkg install curl
curl -fL https://raw.githubusercontent.com/AYUUKI-K/MMDB-PG/main/mmdb.sh -o "$HOME/mmdb-install.sh" && bash "$HOME/mmdb-install.sh"
```

进入**固定安装**菜单后选 **3**，按提示准备运行环境和浏览器脚本。在同一手机的脚本浏览器中确认安装，再打开 AI Studio 登录并点击 Meow。后续输入 `mmdb` 即可打开菜单。项目安装在 `~/mmdb-pg`，不要放到 `/sdcard` 等共享存储。

Linux 先准备 Bash、Node.js 22+、npm、curl、unzip，再执行同一条 `curl ... && bash ...` 命令。详细步骤、命令找不到和旧管理器升级见[安装说明](docs/INSTALLATION.md)。

## 日常启动、更新和停止

| 选项 | 用途 | 你还需要做什么 |
| --- | --- | --- |
| 1 | 启动 / 继续使用，已有后台沿用当前模式 | 没有可用会话时登录 AI Studio、点击 Meow |
| 2 | 更新程序、启动后台，打开对应版本的脚本安装页 | 在油猴确认更新，再刷新 AI Studio |
| 3 | 安装 / 更新当前程序提供的浏览器脚本 | 在油猴确认；这一步不下载新版程序 |
| 4 | 查看文件版本、后台状态和连接地址 | 核对自己正在用的是哪份目录 |
| 5 | 查看日志 | 需要排查时保留错误码与发生时间 |
| 6 | 停止后台 | 先结束生成 |
| 7 | 局域网启动，供手机连接此设备 | 建议先选 6 停止，再选 7 |
| 0 | 退出菜单 | 后台继续运行；AI Studio 页面仍需打开 |

结果页按回车返回；日志页按屏幕提示刷新或返回。**便携版的 8 是修复项目依赖，固定安装版的 8 是切回本机模式**；9 / 10 为便携版维护选项。完整对照见[安装说明](docs/INSTALLATION.md#菜单与安装目录对照)。

程序更新后，选 0 退出并重新打开菜单，以加载新版菜单内容；后台继续运行。

选 1 时，菜单先检查本后台是否已有浏览器执行器连接；等待旧页面重连后仍未连接，才尝试打开 Playground。浏览器未自动打开时，复制提示地址到装有油猴的浏览器。已安装脚本的用户无需每次重装。

## 模型与功能

- 普通文本模型：例如 `pg-gemini-4-argon`，支持流式响应。
- 抗截断模型：例如 `pg-gemini-4-argon-抗截断`，沿用现有正文工具与续写流程。1.7.9 / 1.7.11 没有调整抗截断策略。
- 模型列表：保留配置中的普通 / 抗截断条目，并在当前页面能力目录有效时追加新识别的普通文本模型；目录失效时回退到配置。新模型可用性仍取决于上游权限。
- 工具读取输入、原生续写：两个独立开关，默认关闭，详见[使用说明](docs/USAGE.md#生成设置)。
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
