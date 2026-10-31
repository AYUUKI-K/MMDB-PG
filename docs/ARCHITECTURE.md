# 项目架构与目录约定

本文对应 1.18.0 的目录与维护流程。日常安装和数字菜单操作见 [INSTALLATION.md](INSTALLATION.md)。

## 一个源码项目，两种运行入口

仓库只维护一份 package.json、一份依赖锁和一份源码。源码树与发布 ZIP 采用相同的内部结构；ZIP 顶层额外添加 mmdb-pg/ 作为安装器识别目录。不要把 ZIP 解压回仓库形成第二份源码项目。

数据流为：酒馆或兼容客户端 → 可选 LAN 网关 → 本机 Node 服务 → 浏览器执行器 → AI Studio Playground。

| 位置 | 职责 |
| --- | --- |
| src/server/server.mjs | HTTP / WebSocket 入口、单页面连接和请求生命周期编排 |
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

主菜单直接展示全部操作：1 启动、2 更新全部、3 仅浏览器脚本、4 状态与地址、5 日志、6 停止、7 局域网；其余维护操作按安装方式直接列出。更新全部自动串联程序更新、后台启动及浏览器脚本安装页，浏览器确认与刷新仍由用户完成。

菜单每次展示时读取安装 manifest，显示 MEOW-FM 与文件版本；状态页区分文件、运行中的后台和浏览器脚本版本。便携 8 修复依赖，固定 8 切回本机，二者不混用。后台启动日志明确退出菜单后继续运行，前台入口仍提示保留终端、Ctrl+C 停止。状态页按实际运行模式区分本机地址与手机 LAN 地址。

便携更新在 tools/release-update.mjs 中实现：GitHub 分支源码快照下载、ZIP 注释提交号解析、受限 ZIP 解包、临时构建、空闲检查、同目录程序文件替换、旧文件备份和失败恢复。不改配置与根目录个人文件，不重命名 Windows 菜单持有的工作目录；Git 工作区拒绝自动覆盖。更新与其他便携管理动作共用 .manager.lock。固定更新器继续独立分发，不依赖未安装的源码模块；Windows/Unix 均直接访问官方 codeload 的 main ZIP，不调用 REST API；提交号来自同一份 ZIP 的 EOCD 注释（git archive 格式），避免分支查询与下载之间的竞态。源码快照只安装公开程序文件，忽略 downloads 和其他仓库专用文件。安装提交保存在 .source-revision.json，与程序一起备份和恢复；旧 HTTPS 发布包继续校验配套 SHA-256。

脚本安装先验证实际内容、版本和占位符；单独安装脚本保持已有后台和模式。新程序启动成功后，脚本步骤失败不回滚已经运行的新程序，用户可选 3 重试。命令行 script / update（便携）/ update-all（固定）只输出安装地址，菜单负责打开浏览器。

## 配置与产物

源码存档格式依据 [GitHub 的源码下载说明](https://docs.github.com/en/repositories/working-with-files/using-files/downloading-source-code-archives)和 [git archive 的提交号注释约定](https://git-scm.com/docs/git-archive)。提交号用于识别同一版本的源码；下载信任来自 GitHub 官方 HTTPS，不把 ZIP 注释当作数字签名。

config.json、lan-config.json、st-path.json、PID、源码提交记录和日志位于安装根目录，以兼容配置保留和进程归属检查。它们都不进入 Git 或发布 ZIP。

dist/ 只放可重建的 local-pg.user.js 和 preview.html。服务端的 /local-pg.user.js、/local-pg.meta.js 和 /preview 路由保持原地址。启动和测试命令都会先构建。

artifacts/ 存放本地发布包。打包器只纳入明确的源码目录、文档、许可证、入口与指定生成文件；不递归打包仓库、downloads、依赖、日志或用户配置。固定时间戳、排序和换行归一化使相同源码可重复生成相同 ZIP。

downloads/ 是现有线上更新器的兼容地址。普通 npm run package 不覆盖它，只有显式 --update-latest 才更新 ZIP 和校验和。每次正式发布前应先完成测试和解包启动验证。

## 验证与发布

在仓库根目录执行：

```sh
npm ci --ignore-scripts
npm test
npm run package
npm run test:package
npm run test:update
```

Windows 固定管理器检查为 `npm run test:manager:windows`；Linux / Termux 固定管理器隔离检查为 `npm run test:manager:unix`，需 Bash、unzip、Node.js 与 npm。测试不连接 Google；Git Bash 的语法与菜单检查不等于 Termux 真机后台验证。

正式发布同步 `package.json`、`package-lock.json`、`src/shared/version.js`；构建检查一致性。浏览器脚本有变更时必须提高版本，方便油猴识别。文档仅修订可沿用版本，但要核对其中的当前版本、菜单、配置默认值、相对链接与安装命令；历史记录保留原版本与当时测试范围。

新版菜单按源码提交更新，维护者推送 main 即可供其获取。兼容旧管理器 / 手动下载时执行 `npm run package -- --update-latest`，把 `downloads/mmdb-pg-latest.zip` 和对应 `.sha256` 一起提交。ZIP 中包含当前文档和生成脚本，不含配置与聊天资料。不要将发布 ZIP 解压到源码树内。

仓库根入口：`npm start` / `npm run start:lan` 为前台；`MMDB.cmd` / `bash mmdb.sh` 为目录菜单。直接 `node launch.mjs` 前先构建。源码工作区不接受菜单自动覆盖；用 Git 更新并保留本地改动。

## 面板生命周期

panel-window.js 负责将同一 Shadow DOM 宿主移入 Document PiP 或桌面普通弹窗，并在关闭时移回。手机（含触摸设备的桌面网站模式）缺少 PiP 或申请失败时保留页内状态条，不调用会被打开为整页标签的普通弹窗；子窗口设置设备宽度 viewport。执行器和 WebSocket 始终留在 AI Studio 源页。源文档标记防止面板移出后重复初始化。session.js 的激活流程在同一标签页使用原生按钮新建对话，只发送 Meow，通过新请求、新会话验证及原生发送按钮恢复来结束等待；executor.js 在激活期间断开本地调度，避免与酒馆生成并发。

session.js 从原生请求捕获当前认证与请求上下文；executor.js 在会话就绪后直接注册，原生请求上下文变化时停止旧请求并重新连接。后台每次接受一个页面连接，不维护邮箱、账号池或额度冷却。tavern-theme.js 读取酒馆计算样式，通过同一脚本管理器存储同步到面板；不复制整份 CSS、图片或远程字体资源。

1.7.12 的正常 generate 流程只对 payload.binding 计算摘要并调用捕获的页面验证入口，再发送携带 fresh proof 的 wire；不查找、读取、写入或清空输入框。textarea / fill 与原生按钮操作仅供 Meow 激活使用，激活保护、验证结果校验、会话版本检查和请求取消仍保留。

keep-alive.js 管理默认开启的本机 WebRTC 数据通道对，不使用媒体或外部 ICE 服务；以两端实际 open 为 active，失败释放两端后等待至少 30 秒再试，关闭或销毁会使尚未完成的异步协商失效。它与屏幕 Wake Lock 独立，不能保证对抗 OS 暂停或浏览器强制冻结。executor.js 的页面恢复、网络恢复和面板活动只检查连接，不重放请求。

page-liveness.mjs 管理新版执行器协商的 `pageHeartbeat: 1`。注册成功后发送带随机 nonce 与 connectionId 的 page-ping；页面回复 page-pong，后台校验连接归属与当前 nonce。每 15 秒尝试发起一次检查，最多一个未完成探测；45 秒无回应后拒绝新生成，既有任务不受心跳干预。关闭连接时销毁探测器。旧协议不启用检测，`/v1/status` 的 page 状态说明支持情况。

## 页面模型目录

会话激活后由当前页面查询 ListModels，后台只存能力目录，绑定当前执行器和 sessionRevision，10 分钟过期。能力查询既用于既有原生续写判断，也用于普通模型列表补充。1.7.9 起，模型列表保留配置中普通与抗截断条目，另追加明确属于文本生成的 canonical ID；别名、冲突 ID 和媒体 / 实时专用路由不追加，新条目不自动派生抗截断模型。页面断开、上下文变化、目录失效或过期时回到配置列表。

1.7.12 起，同一会话每 5 分钟刷新目录时保留上次成功结果，完整解析成功后再替换。网络或解析失败不延长原来的 10 分钟有效期；显式失效、上下文变化或断开仍立即清除。重复 canonical ID 的关联别名也同步禁用，不能通过别名重新启用被判为冲突的模型能力。

## 合成读取与请求计数

`inputReadSynthetic` 是依赖 `inputRead` 的默认关闭的功能开关。InputRead 仅在合成模式初始化本地调用参数、独立调用 ID 与占位签名；`ready` 表示工具历史已备好，不等于真实模型调用完成。诊断以 `inputReadMode` 区分，真实完成标志只用于真实读取。服务编排跳过读取请求，继续复用正文编码与两种续写；不回退、不自动重试输入读取请求。

AttemptTrace 根据每次尝试的 request-sent、响应头或响应数据计算 requestCounts，派发、排队和 proof 不计。按尝试身份去重，在后端累加 requestTotals，通过注册回复和 request-counts 消息同步面板。计数按后台生命周期累计，探测单列；每轮计数进入现有脱敏诊断历史以及 OpenAI 响应。失败尝试也计数，但不据此推断 Google 扣额。模型返回的 token 计数继续独立处理。


## 通用工具与保活（1.18.0）

external-tools.mjs 校验并编码函数声明、选择模式及返回参数；tool-history.mjs 校验客户端调用/结果配对并转换为 PG Struct/Part。errors.mjs 提供共享错误类型。含声明或历史的请求走普通工具路径，禁用本轮 InputRead、AnswerEnvelope 和自动续写；无工具请求维持原行为。ExternalToolCalls 在正常 STOP 后交付完整调用，JSON 和 SSE 共用校验与参数组装，不执行客户端函数。

audio-keep-alive.js 管理独立的 Web Audio 生命周期，默认关闭、用户交互恢复、状态变化更新 UI，关闭和销毁释放音源与上下文。它不替代 keep-alive.js 的 WebRTC 数据通道；零采样与零增益不满足 Chrome 的有声音频豁免。

沿用 tools/portable-manager.mjs 的 menu-status 摘要供四种菜单使用，按进程脚本路径核验归属，再读取有时限的状态接口。运行模式由已核实的进程参数判断，版本摘要兼容带 mmdb- 前缀的用户脚本版本。固定更新器在尚未安装程序时仍独立可用。
