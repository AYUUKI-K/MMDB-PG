# 1.20.1：发布更新、旧用户升级与 Bot 接入

推荐无人值守 Bot 使用独立模式。MMDB 继续提供 OpenAI / Gemini 接口，Runtime Manager 负责账号、轮换、Camoufox、守护和调用诊断。用户不需要另外部署第二套反代，也不需要把 Google Cookie 填进 Bot。

## 维护者怎样发布

本次版本为 MMDB **1.20.1**、独立管理器 **0.3.0**。发布前保持 `package.json`、`package-lock.json`、`src/shared/version.js` 一致；管理器版本见 `runtime-manager/package.json`。

在源码目录执行：

```sh
npm test
npm run package -- --tracked-only --update-latest
npm run test:package
npm run test:update
python tests/legacy-menu-upgrade.py
python tools/package-manager.py
```

同时发布两条更新渠道：

| 用户入口 | 读取哪里 | 维护者要发布什么 |
| --- | --- | --- |
| 新版菜单“2 更新全部” | GitHub `main` 源码 ZIP，以同一包内提交号辨别更新 | 推送完整源码，包含 `runtime-manager/`、`browser-extension/` 和新服务端模块 |
| 旧版菜单、旧固定管理器、手动 ZIP 更新 | `downloads/mmdb-pg-latest.zip` 及 `.sha256` | 必须把最新 ZIP 与校验和一起提交，不能只推源码 |
| 手动下载 | Release 附件或本地提供的 universal ZIP | `artifacts/mmdb-pg-1.20.1-universal.zip` 及校验和 |

不要单独发送 `server.mjs` 或只发送 `Manager.cmd`；两者依赖完整源码目录。完整 MMDB 包已经包含独立管理项目，普通 MMDB 用户无需另下载 manager ZIP。使用 `--tracked-only` 前先将本次新增公开源码加入 Git 暂存区，避免把未跟踪的个人草稿打包。

`downloads/mmdb-pg-latest.zip` 是兼容旧菜单的完整更新包：新组件以经过校验的公开文件数据保存在 `tools/legacy-components.json`，由新版入口在本地恢复。这样 1.7.16 / 1.18.x 的目录白名单不会漏装或拒绝新目录；无需第二次下载或再次更新菜单。universal ZIP 直接包含展开后的组件，因此两个 ZIP 的 SHA-256 不同，各自使用配套校验和。构建会同步生成兼容数据，禁止手工修改其中的源码副本。

本地完成检查后，可按以下方式提交；先核对暂存列表再推送：

```sh
git add -u
git add runtime-manager browser-extension src/server tests tools docs/HEADLESS.md docs/BOT_UPGRADE.md downloads
git diff --cached --stat
git diff --cached --name-only
git commit -m "feat: add standalone diagnostics and image input for bots"
git push origin main
```

不要提交 `config.json`、`.headless/`、`runtime-manager/manager.config.json`、`runtime-manager/.runtime/`、`.experiments/` 或任何个人凭证。它们已被忽略；发布器还使用独立的公开文件白名单。`git add -u` 会包含当前已有的跟踪文件改动，提交前确认都属于此次发布。若使用 PR 流程，推送工作分支并合并到 main 后，新版菜单才会收到更新。

## 已安装用户的最短路径

1. 结束正在生成的请求，打开原来的 **MMDB.cmd → 2 更新全部**。
2. 更新完成后，**0 退出菜单，再重新打开**，选 4 核对文件与后台版本均为 1.20.1。
3. 选 **11 账号管理**。首次会自动下载并校验独立运行时，再打开控制台。Windows 需要 Node.js 22+；原来的 API Key 和配置保留。
4. 控制台按提示安装本机凭证助手，连接扩展，点击**一键抓取并导入**；也可使用 Camoufox 隔离登录或手动导入。首次安装扩展/登录仍由用户完成。多 Google 账号时核对账号序号 `/u/N/`。
5. 在账号池**启用**导入的账号，点击**启动生成服务**，发送一次固定测试。新导入的账号不会自动加入轮换池；请按需启用多个。
6. 回到 MMDB 菜单 **12 → 2 独立模式**。它会关闭不适用的原生续写，保留合成读取，空闲时安全重启 PG。若 PG 尚未运行，再选 1 启动。
7. 日常直接打开 `runtime-manager/Manager.cmd`，设置进程守护；Windows 登录自启动按需开启。菜单 13 可关闭启动时自动打开 AI Studio。
8. 填好下表中的 Bot 参数，先发短文本，再发一张图片；在**调用与诊断**查看对应记录。

**旧固定入口也可以直接选 2 更新。** 本版首次启动会恢复旧更新器白名单未复制的新组件，退出并重新打开后自动进入完整菜单。若下载中断或安装文件曾被手工改动，可下载完整 universal ZIP，从解压目录执行 `powershell -NoProfile -ExecutionPolicy Bypass -File .\mmdb-manager.ps1 -Action install -Package "完整ZIP路径"` 修复固定安装。不要手工删除旧目录或只复制凭证文件。

本版固定入口会转交已安装的完整菜单，后续更新采用就地替换，保留私有数据路径。更新会停止本安装的空闲管理页与守护进程，再恢复控制台；旧浏览器管理链接失效时，从 Manager.cmd 或菜单 11 重新打开，扩展配对身份仍保留。

## Bot 填哪些参数

| 项目 | 填写方式 |
| --- | --- |
| 服务类型 | OpenAI Compatible / 自定义 OpenAI |
| Base URL | Bot 和 MMDB 在同一台主机时，`http://127.0.0.1:8765/v1` |
| API Key | **MMDB 安装目录 `config.json` 的 `apiKey`**，不是 Google Cookie，也不是控制台链接中的令牌 |
| 模型 | 从 `/v1/models` 选择当前账号可用的 `pg-…` 模型；例如本机验证的 `pg-gemini-3-flash-preview` |
| 接口 | Chat Completions：`POST /v1/chat/completions`；不是 `/v1/responses` |
| 图片/视觉能力 | 在 Bot 中为模型开启图像输入，实际发送 `image_url` 内容块 |
| 流式 | 支持 SSE；若 Bot 更适合非流式，也可关闭 |
| 超时与重试 | 首次验证建议 180 秒；不要遇到部分输出或连接断开就无限重发，可能重复消耗调用 |
| 工具调用 | 支持 `tools` / `tool_calls`，Bot 自己执行工具并回传结果 |

如果 Bot 表单要求**完整请求地址**而非 Base URL，应填写 `http://127.0.0.1:8765/v1/chat/completions`。不要重复拼两遍 `/v1`。

同一家庭局域网的另一台设备，选菜单 **7**，使用状态页显示的 `http://电脑局域网IP:8766/v1`。默认 8765 只绑定回环地址。Docker 内的 `127.0.0.1` 指向容器；需要按容器网络连接宿主机的受控入口，不能直接照抄主机回环地址。公网 Bot 不能直接访问你电脑的回环/局域网地址，需要另行部署可达且鉴权的连接方案；本版不会自动暴露管理控制台或开放公网端口。

## 图片请求示例与限制

OpenAI：

```json
{
  "model": "pg-gemini-3-flash-preview",
  "messages": [{
    "role": "user",
    "content": [
      {"type": "text", "text": "这张图是什么？"},
      {"type": "image_url", "image_url": {"url": "data:image/png;base64,实际图片Base64"}}
    ]
  }]
}
```

`image_url.url` 也可以使用公开可下载的 HTTP(S) 图片地址；下载不附带任何 Cookie 或 API Key，重定向逐跳检查，拒绝内网、本机、保留地址和非标准端口。Bot 的本地文件、私有图片地址、需要登录或防盗链验证的图片应由 Bot 读取后转 Base64。

Gemini `contents[].parts[]` 支持 `{"inlineData":{"mimeType":"image/png","data":"实际Base64"}}`，兼容 `inline_data` / `mime_type`。常规浏览器模式与独立模式共用输入适配；图片在历史和提示词续写中保留，合成/真实读取只处理文字，不移除图片。

- 支持 PNG、JPEG、WebP；每次最多 8 张，单张解码后不超过 8 MiB，合计不超过 12 MiB，整个 JSON 请求不超过 20 MiB。
- 图片 URL 准备最多 30 秒，每个网络连接最多 15 秒等待；失败返回明确错误，不把图片悄悄当作文字地址。
- `detail: auto/low/high` 接受为兼容提示；当前 PG 没有已验证的对应参数，不承诺按其改变分辨率或计费。
- 这是**图像输入/识图**，没有新增图片生成、视频、音频、文件上传接口或 Responses API。
- MMDB 日志不保存图片正文或地址；独立运行时可能按其协议把图片上传为当前 Google 账号的附件，详见 [AIStudio2API 媒体协议](https://github.com/Mag1cFall/AIStudio2API/blob/v0.2.18/docs/protocol.md#drive-上传与文件-part)。

## 诊断与验收

控制台 → **调用与诊断**：按时间、状态、模型、账号代号、来源、错误码、事件类型筛选；点击请求 ID 查看派发、切换、冷却、续写与终止时间线。账号页显示对应的稳定诊断代号。响应头 `X-MMDB-Request-Id` 可关联 Bot 日志。

默认保存 7 天或 100 MiB，以日志段轮换；保留策略可在页面修改。导出是 JSONL，首行为清单，包含条数、是否截断；每次导出重新匿名化账号和请求 ID。只记录参数、时延、计数、已报告用量和错误类别，不记录对话、图像、Cookie、密钥、认证头或原始错误全文。未报告用量保持未知；派发次数不代表 Google 内部请求或扣额次数。

验收顺序：

1. 管理页固定测试成功，PG `/health` 中 `executionBackend=headless` 且 `executorOnline=true`。
2. Bot 短文本成功，再检查同一逻辑调用在诊断页为“已完成”。
3. Bot 发图，确认详情中的图像数量和大小非零，模型能回答图像内容。
4. 关闭日常浏览器窗口，Bot 继续生成；关闭 Manager.cmd 命令窗口不影响后台。
5. 按需开启守护、自启动；手动停止应保持停止，再启动后恢复守护。
6. 多账号场景核对切换原因和冷却期限。不要为验收故意耗尽真实账号额度；模拟测试覆盖换号、部分输出不重放和跨阶段绑定。

真正接入特定 Bot 时，还需核对该 Bot 的 Base URL 拼接、视觉开关和超时设置。本版协议测试不能代替尚未提供的 Bot 配置实测。

本次本机验收：417 项自动化测试通过，Windows 菜单、完整 ZIP 启动、原样 1.7.16 和 1.18.1 更新器的源码 / ZIP / Windows 固定安装升级通过；独立模式发送红蓝测试图，HTTP 200 并返回 `red blue`，已核对诊断页面与实际下载的匿名导出。常规网页模式的图片协议与模拟端到端测试通过；真实页面测试时 AI Studio 返回 `Permission denied`，Meow 未建立有效会话，因此未完成常规模式的真实识图验证。网页模式应先确认页面所选模型可手动生成、更新油猴脚本并激活，再测试图片；不会通过重复请求来绕过账号权限限制。
