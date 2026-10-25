# MMDB PG 本地反代

AI Studio Playground 与本机 OpenAI 兼容客户端之间的桥接器，当前版本 **1.7.3**。支持 Windows、Linux 和 Android Termux，需要 Node.js 22+。浏览器需安装用户脚本，保持已登录的 AI Studio 页面打开；一键激活会在当前标签页新建对话并发送 Meow，会话就绪后直接连接本地服务。

保持一个 AI Studio 页面在线即可使用。需要更换账号时，关闭旧页面，在新账号页面点击一键激活，再回到酒馆发起请求。具体步骤见[账号使用与切换](docs/USAGE.md#账号使用与切换)。

## 开发与运行

仓库根目录就是项目根目录，直接执行：

    npm ci
    npm start

局域网入口使用 npm run start:lan。Windows 也可双击 MMDB.cmd 打开便携菜单；Linux / Termux 执行 bash mmdb.sh。菜单、配置与依赖都属于当前目录。

后台启动后，在浏览器打开 http://127.0.0.1:8765/local-pg.user.js 安装用户脚本。酒馆选择“聊天补全 → 自定义兼容 OpenAI”，本机地址为 http://127.0.0.1:8765/v1，默认密钥为 mmdb。

需要安装到固定目录并在线更新时，参见[安装与更新](docs/INSTALLATION.md)。固定安装管理器和便携菜单使用各自的操作编号。

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

Linux / Termux 的固定更新器检查为 npm run test:manager:unix，需先生成发布包，并提供 Bash、unzip、Node.js 和 npm。测试使用隔离目录，不连接 Google。

打包命令会先重新构建用户脚本，再生成 artifacts/mmdb-pg-1.7.3-universal.zip 及 SHA-256 校验文件。ZIP 内保留一层 mmdb-pg/，供现有安装器识别；仓库源码不再嵌套另一份同名项目。普通构建和打包不会改动 downloads 中的公开更新包。需要更新该文件时显式运行：

    npm run package -- --update-latest

修改版本时同时更新 package.json、package-lock.json 和 src/shared/version.js；构建会检查主版本定义是否一致。

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
