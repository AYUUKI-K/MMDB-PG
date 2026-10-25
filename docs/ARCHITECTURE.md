# 项目架构与目录约定

## 一个源码项目，两种运行入口

仓库只维护一份 package.json、一份依赖锁和一份源码。源码树与发布 ZIP 采用相同的内部结构；ZIP 顶层额外添加 mmdb-pg/ 作为安装器识别目录。不要把 ZIP 解压回仓库形成第二份源码项目。

数据流为：酒馆或兼容客户端 → 可选 LAN 网关 → 本机 Node 服务 → 浏览器执行器 → AI Studio Playground。

| 位置 | 职责 |
| --- | --- |
| src/server/server.mjs | HTTP / WebSocket 入口、账号分配和请求生命周期编排 |
| src/server/launch.mjs | 启动核心和可选 LAN 服务，处理进程记录和退出 |
| src/server/lan-gateway.mjs | 私网入口、来源检查与请求转发 |
| src/server/protocol.mjs | 协议转换、分帧、完成状态与错误定义 |
| src/server/anti-truncation.mjs、continuation.mjs、input-read.mjs | 工具正文、续写和输入读取流程 |
| src/server/capabilities.mjs、deadlines.mjs | 模型能力与请求期限 |
| src/server/config.mjs、diagnostics.mjs、metrics.mjs | 配置、诊断与用量统计 |
| src/server/paths.mjs | 安装目录和构建资源路径，独立于调用者当前目录 |
| src/browser/ | 面板、Google 页面会话、执行器、恢复与引导 |
| src/shared/ | 版本和生成设置定义；不依赖 Node 或 DOM |
| scripts/ | 操作系统相关菜单和前台启动、停止脚本 |
| tools/ | 构建、打包、便携进程管理和诊断工具 |
| tests/ | 源码回归与 Windows / Unix 安装管理器测试 |

服务端依赖 shared，不导入浏览器页面实现。LAN 网关只依赖配置模块，避免经由 HTTP 主服务读取配置。浏览器产物由 tools/build-userscript.mjs 按显式模块顺序拼装，生成过程不需要第三方打包器。

## 稳定入口

根目录保留 build.mjs、launch.mjs、server.mjs、lan-gateway.mjs，以及已有的 CMD、PowerShell、Shell 启动文件。它们转交给内部实现，不维护第二份业务逻辑。

mmdb-manager.ps1 和 mmdb.sh 是固定更新器的独立分发入口。现有用户会单独下载或复制这些文件，因此它们必须在没有源码子目录时也能运行；不要把固定更新器拆成必须额外下载的模块。

- MMDB.cmd 在当前目录存在 scripts/portable.ps1 时打开便携菜单，否则打开旁边的 mmdb-manager.ps1。
- mmdb.sh 在当前目录存在 tools/portable-manager.mjs 时打开 scripts/portable.sh；单独下载、或复制到固定管理器目录后，继续使用固定安装菜单。
- 固定安装器仍接收含 mmdb-pg/package.json、build.mjs、launch.mjs、server.mjs 等入口的 ZIP。Windows 固定管理器复制 MMDB.cmd 与 mmdb-manager.ps1，Unix 固定管理器复制 mmdb.sh。
- 直接启动、便携菜单、固定安装器都通过同一根目录构建入口和启动入口运行。

## 配置与产物

config.json、lan-config.json、st-path.json、accounts.json、PID 和日志位于安装根目录，以兼容配置保留和进程归属检查。它们都不进入 Git 或发布 ZIP。

dist/ 只放可重建的 local-pg.user.js 和 preview.html。服务端的 /local-pg.user.js、/local-pg.meta.js 和 /preview 路由保持原地址。启动和测试命令都会先构建。

artifacts/ 存放本地发布包。打包器只纳入明确的源码目录、文档、许可证、入口与指定生成文件；不递归打包仓库、downloads、依赖、日志或用户配置。固定时间戳、排序和换行归一化使相同源码可重复生成相同 ZIP。

downloads/ 是现有线上更新器的兼容地址。普通 npm run package 不覆盖它，只有显式 --update-latest 才更新 ZIP 和校验和。每次正式发布前应先完成测试和解包启动验证。

## 面板生命周期

panel-window.js 负责将同一 Shadow DOM 宿主移入 Document PiP 或普通弹窗，并在关闭时移回；执行器和 WebSocket 始终留在 AI Studio 源页。源文档标记防止面板移出后重复初始化。session.js 的激活流程在同一标签页使用原生按钮新建对话，只发送 Meow，通过新请求、新会话验证及原生发送按钮恢复来结束等待；executor.js 在激活期间断开本地调度，避免与酒馆生成并发。

page-account.js 只从原生账号控件读取邮箱。session.js 在捕获原生请求时记录同一时刻的邮箱，executor.js 仅在当前账号控件与该记录一致时自动注册；变更或读不到原自动绑定账号时断开旧连接。tavern-theme.js 读取酒馆计算样式，通过同一脚本管理器存储同步到面板；不复制整份 CSS、图片或远程字体资源。
