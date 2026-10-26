# MMDB PG 本地反代

AI Studio Playground 与本机 OpenAI 兼容客户端之间的桥接器，当前版本 **1.7.7**。支持 Windows、Linux 和 Android Termux，需要 Node.js 22+。浏览器需安装用户脚本，保持已登录的 AI Studio 页面打开；一键激活会在当前标签页新建对话并发送 Meow，会话就绪后直接连接本地服务。默认启用后台保活，减少切回酒馆后的页面暂停。

保持一个 AI Studio 页面在线即可使用。需要更换账号时，关闭旧页面，在新账号页面点击一键激活，再回到酒馆发起请求。具体步骤见[账号使用与切换](docs/USAGE.md#账号使用与切换)。

## 首次使用

Windows 用户按以下顺序操作：

1. [下载最新版 ZIP](https://raw.githubusercontent.com/AYUUKI-K/MMDB-PG/main/downloads/mmdb-pg-latest.zip)，完整解压；浏览器先安装并启用油猴（Tampermonkey）。
2. 双击 `MMDB.cmd`，选 **3 安装 / 更新浏览器脚本**。缺少 Node.js 时按提示选 **10** 完成官方安装，再选 3；菜单会自动安装项目依赖并启动后台。
3. 在自动打开的油猴页面确认安装。然后打开 [AI Studio Playground](https://aistudio.google.com/prompts/new_chat)，登录并点击 **Meow**，等待本地连接和 Google 就绪。
4. 酒馆选择“聊天补全 → 自定义兼容 OpenAI”，填 `http://127.0.0.1:8765/v1`，默认密钥 `mmdb`。改过端口或密钥时，以菜单 4 和 `config.json` 为准。

日常只选 **1**；已有 AI Studio 脚本连接时不会再开页面。以后更新只选 **2 更新全部**，等待程序更新和脚本安装页打开，在油猴确认更新并刷新 AI Studio，无需再选 3。关闭菜单后后台继续运行，选 **6** 才会停止。

Linux / Android Termux 的首次安装见[安装说明](docs/INSTALLATION.md)，安装后的 1 / 2 / 3 操作相同。

## 开发与运行

仓库根目录就是项目根目录，直接执行：

    npm ci
    npm start

局域网入口使用 npm run start:lan。Windows 也可双击 MMDB.cmd 打开便携菜单；Linux / Termux 执行 bash mmdb.sh。首次直接选 3 安装浏览器脚本，菜单会自动安装缺少的项目依赖、启动后台并打开脚本安装页；日常选 1 启动。菜单、配置与依赖都属于当前目录。

后台启动后，在浏览器打开 http://127.0.0.1:8765/local-pg.user.js 安装用户脚本。酒馆选择“聊天补全 → 自定义兼容 OpenAI”，本机地址为 http://127.0.0.1:8765/v1，默认密钥为 mmdb。

主菜单直接列出全部操作：1 启动、2 更新全部、3 仅安装 / 更新浏览器脚本、4 状态与地址、5 日志、6 停止、7 局域网，以及各安装方式的维护选项。选择 2 后直接下载 GitHub main 源码快照、识别其中的提交、构建并保留配置、启动后台并打开油猴脚本更新页；只需在油猴确认更新并刷新 AI Studio。首次安装浏览器脚本或只修复脚本时选择 3。

便携版直接更新解压目录，旧程序保存在 .updates；Git 工作区不会被自动覆盖。固定目录安装、迁移和维护者操作见[安装与更新](docs/INSTALLATION.md)。

菜单选择 1 启动后台，或选择局域网启动，确认服务就绪后先检查 AI Studio 页面连接。已有连接就继续使用现有页面；没有连接时等待约 3 秒供旧页面重连，仍未连接才打开 Playground。只能识别连接到本后台的脚本，不能识别未安装或未连接脚本的浏览器标签页。Windows 使用默认浏览器，Termux 优先使用 termux-open-url；无法自动打开时显示地址。新页面仍需登录并点击 Meow 激活。查看状态和命令行诊断不会自动打开网页。

## 目录

    src/
      server/       Node 服务、协议、请求流程、配置与诊断
      browser/      AI Studio 用户脚本的面板、会话与执行器
      shared/       版本与生成设置定义
    scripts/        平台启动与便携菜单实现
    tools/          用户脚本构建、发布打包和维护工具
    tests/          Node 回归与平台管理器集成检查
    docs/           使用、安装、架构和历史说明
    licenses/       第三方许可证
    dist/           自动生成的用户脚本与预览（不提交）
    artifacts/      本地生成的 ZIP 与校验和（不提交）
    downloads/      供现有更新器下载的固定发布包

根目录的 launch.mjs、server.mjs、build.mjs 和系统启动脚本是稳定入口，内部实现见上述目录。完整职责与兼容约定见[架构说明](docs/ARCHITECTURE.md)。

## 验证与打包

    npm test
    npm run test:manager:windows
    npm run package
    npm run test:package
    npm run test:update

Linux / Termux 的固定更新器检查为 npm run test:manager:unix，需先生成发布包，并提供 Bash、unzip、Node.js 和 npm。测试使用隔离目录，不连接 Google。

打包命令会先重新构建用户脚本，再生成 artifacts/mmdb-pg-1.7.7-universal.zip 及 SHA-256 校验文件。ZIP 内保留一层 mmdb-pg/，供现有安装器识别；仓库源码不再嵌套另一份同名项目。新版菜单默认按提交下载源码，不依赖 downloads 中的发布包。为旧版更新器和手动下载保留兼容发布包；更新它时显式运行：

    npm run package -- --update-latest

源码推送到 main 后，新版菜单即可获取。浏览器脚本有改动时仍需提高版本号，便于油猴识别。修改版本时同时更新 package.json、package-lock.json 和 src/shared/version.js；构建会检查主版本定义是否一致。

## 参考与感谢

感谢以下项目、作者与文档提供的实现基础和参考：

- [Mag1cFall / AIStudio2API](https://github.com/Mag1cFall/AIStudio2API)：AI Studio 协议、会话验证、工具调用与原生续写字段参考。
- [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)：流式完成帧、尾随用量与传输结束的测试设计参考。
- [su-kaka / agy2api（原 gcli2api）](https://github.com/su-kaka/agy2api)：通过合成工具封装输出的抗截断思路；其注明的上游来源为 [Xeltra233 / Antigravity-gateway（原 Antigravity-anti-truncation-gateway）](https://github.com/Xeltra233/Antigravity-gateway)。
- Catiecli Playground Executor：早期本地版本使用的执行器。
- [SillyTavern](https://github.com/SillyTavern/SillyTavern)、[Tampermonkey 文档](https://www.tampermonkey.net/documentation.php)与 [Chrome Document Picture-in-Picture 文档](https://developer.chrome.com/docs/web-platform/document-picture-in-picture)：分别提供酒馆主题适配、跨页面样式同步及置顶悬浮窗的接口参考。
- [ws](https://github.com/websockets/ws)：本地后端使用的 WebSocket 依赖。

各项参考的使用范围、历史提交与许可证见[来源和许可证](docs/THIRD_PARTY.md)；第三方作品保留各自的许可与署名。

## 文档

- [功能、配置与使用方法](docs/USAGE.md)
- [安装、迁移与在线更新](docs/INSTALLATION.md)
- [便携菜单说明](docs/PORTABLE_README.txt)
- [面板、悬浮窗与一键激活](docs/USAGE.md#反代面板)
- [历史实验记录](docs/EXPERIMENTS.md)
- [历史更新记录](docs/HISTORY.md)
- [历史 1.5.0 评审材料](docs/AUTHOR_REVIEW.txt)
- [许可证](LICENSE)与[第三方来源](docs/THIRD_PARTY.md)

离线回归覆盖本地协议、单页面连接、手动重连和生命周期，不代表真实 Google 生成、上游断联或长输出已经得到验证。
