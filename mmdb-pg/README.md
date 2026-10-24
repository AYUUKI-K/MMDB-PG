# 喵喵电波 · MMDB 本地反代 1.2.10

Windows / Linux / Android Termux 共用此包，需要 Node.js 22+。默认密钥 `mmdb`，只支持文本聊天。浏览器需支持用户脚本；后端不能代替已登录的 AI Studio 页面。

## 启动

先完整解压。首次启动安装唯一依赖 ws，需要联网。启动时自动查找本机酒馆并安装推理强度补丁；只有找不到或存在多份酒馆时需要选择路径，详情见文末。

| 平台 | 本机酒馆 | 手机连接此设备 |
| --- | --- | --- |
| Windows | 双击 Start.cmd | 双击 Start-LAN.cmd |
| Linux | bash start.sh | bash start-lan.sh |
| Termux | bash start.sh | bash start-lan.sh |

Linux 先安装 Node.js 22+；Termux 执行 `pkg install nodejs-lts`。Termux 将项目放在其主目录（例如 ~/mmdb-pg），避免在 Android 共享存储里安装 node_modules。手机浏览器必须支持用户脚本，并保持 AI Studio 页面运行；系统后台冻结会影响生成。

启动后保持窗口运行，Ctrl+C 停止。Windows 也可用 Stop.cmd；新版核心和 LAN 入口属于同一进程，Stop-LAN.cmd 同样停止整个服务。不要重复启动两种模式；改用 LAN 模式前先停止当前服务。

## 安装浏览器脚本

打开 `http://127.0.0.1:8765/local-pg.user.js?v=1.2.10`，安装 **MMDB 本地桥 v1.2.10**。停用旧 Local PG 脚本，同名 MMDB 脚本原位更新。

进入 AI Studio Playground，首次手动发 hi，确认面板显示本地已连接、Google 已就绪。1.2.12 起后续请求直接签名，不写入或清空网页输入框，也不会改动未发送的草稿。

酒馆使用聊天补全 → 自定义兼容 OpenAI：

- 本机 Base URL：`http://127.0.0.1:8765/v1`
- 密钥：`mmdb`
- 普通模型：如 `pg-gemini-4-argon`，支持流式显示。
- 抗截断模型：如 `pg-gemini-4-argon-抗截断`，通过正文工具交付，按完整工具参数返回；实测正文一次显示。

普通与抗截断使用同一登录账号。工具模式不是更高额度，也不能保证消除所有截断。没有实际调用正文工具时明确报错，不静默切回普通输出。上游断流、额度和拒绝保留为错误。酒馆点停止会取消请求。

## 局域网

LAN 启动方式会同时启动本机核心和手机 API 网关。唯一可识别的私网 IPv4 会自动生成 lan-config.json；多网卡、VPN 或地址变化时，参考 lan-config.example.json 手工修改 address 与 allowedCIDR。

手机填启动窗口显示的 `http://电脑局域网IP:8766/v1`，密钥与电脑一致。电脑与手机应在可互通网络中；如系统防火墙提示，允许家庭私网访问。LAN 只提供生成 API，限制配置网段并验证密钥。不要把此入口映射到公网。

## 配置与等待

首次生成 config.json，已有配置保留。默认值：

| 字段 | 默认 | 含义 |
| --- | --- | --- |
| port | 8765 | 本机端口 |
| apiKey | mmdb | 个人密钥 |
| timeoutMs | 180000 | 普通模型首包／数据间隔、工具正文开始后的数据间隔上限，毫秒 |
| toolFirstByteTimeoutMs | 600000 | 工具模式每轮从派发到首段正文的固定等待上限，毫秒 |
| streamKeepAliveMs | 15000 | SSE 注释／非流式 JSON 空白保活间隔，毫秒 |
| maxContinuations | 2 | 明确 MAX_TOKENS 且已有正文时，最多额外续写次数，可设 0–5 |
| models | 内置模型列表 | 根据账号实际权限修改 |

SSE 注释没有正文，不会延长上游等待期限。非流式响应每隔同样的时间发送合法 JSON 空白，最后仍是一个完整 JSON 对象；保活不含正文。保活发出后 HTTP 状态已为 200，晚到错误通过 JSON error 对象返回；首个保活之前的错误仍使用实际 HTTP 状态码。未实际收到上游数据时，本地代码无法提前显示正文。

## 计时和诊断

面板“请求耗时”包含执行器排队，完成时使用后台从收到该次生成请求起计算的总耗时。它不包含酒馆发起请求之前的预处理，也不等于酒馆的“思考”标签或页面渲染耗时。酒馆使用近似分钟显示时，152 秒可能显示为“3 分钟”；可悬停其标签查看秒数（取决于酒馆版本）。

`GET /v1/status` 需要 `Authorization: Bearer mmdb`，包含活动请求及最近 50 次调用的阶段、数据块数与相对耗时。firstClientTextMs 表示后台第一次调用正文写出，不是酒馆收到或显示的时刻。诊断仅保存元数据到 diagnostics.log，不保存提示词、正文、Cookie 或令牌。

## 升级

先结束生成、停止旧服务。将新版解压到新文件夹，按需复制自己的 config.json 和 lan-config.json，再启动。安装新版用户脚本并刷新 AI Studio、手动发 hi。旧文件夹确认不再需要后自行删除。分发包不含你的配置、密钥历史、日志、PID、node_modules 或聊天数据。

## 开发与来源

`npm test` 运行离线模拟检查，不调用 Google；`npm run build` 生成用户脚本和预览。`npm start` / `npm run start:lan` 启动本机／LAN。源码、离线测试和许可随包提供。

正文工具思路参考 su-kaka/gcli2api，本项目的 PG 适配与界面实现见 THIRD_PARTY.md。参考协议来源的许可证保留在 licenses/。没有复制后来提供的 Build 启动包代码或提示词。

## 响应前连接失败的恢复

仅抗截断模式在收到任何响应字节之前发生连接错误（包括已有响应头但读不到数据），会重新生成会话验证并自动重试一次。同一个客户端请求最多一次恢复，包括后续 MAX_TOKENS 轮次；整体等待上限不因重试而重置。已收到任何响应字节后的断流、任何 HTTP 错误、额度、权限、内容拒绝及主动取消都不重试。

断开时无法确认 Google 是否已开始生成，因此重试可能额外消耗一次调用；它不能保证网络不掉线。面板会明确显示重试事件，诊断 networkRetries 记录次数。普通模型不启用这层恢复。

## 用户脚本自动更新

1.2.0 起提供本机 @updateURL 与 @downloadURL。手动安装一次此版本后，在油猴中开启该脚本的更新检查。以后先升级本地后台文件，保持后台运行，油猴便可按其检查周期从本机获取新版本；也可在油猴中手动检查更新。安装后刷新 AI Studio 使新脚本生效。更新检查时间和权限取决于脚本管理器设置，无法保证立即自动安装。

这个机制不会自动下载新的后端启动包，也不会从旧的后台目录获得尚未升级的代码。旧版脚本还没有这些更新声明，需要先手动安装一次。

## 性能诊断与精简策略（1.2.0）

本版记录实际发送的 generation 参数、toolPromptStyle、每次请求尝试的阶段时间和上游用量。usage 中缺失的 token 字段表示未知，显式 0 才是报告为零。usageComplete 表示所有尝试的四项 token 计数是否完整；失败尝试的未报告用量不会被假装为零。attempts 中分别保留首次尝试、网络恢复和 MAX_TOKENS 续写的数据，单次使用上游累计计数的最后值，不重复相加每个响应帧。HTTP 兼容接口无法得到完整 OpenAI 用量统计时，省略 usage；诊断仍保留上游明确报告的部分计数。

面板区分响应头、响应数据和正文到达；这些时刻都不能精确表示 Google 内部开始或结束思考的时间。

1.2.9 已统一使用尾部独立 user 消息，只追加英文工具调用要求，不再插入额外系统指令或处理 assistant 预填分支。

提示词调整需实测速度和成功率；不会改变温度、输出上限或思考强度。

在项目目录运行 `node tools/performance-report.mjs` 可只读汇总现有诊断，无需生成请求。仅统计有明确配置、没有重试／续写的成功记录，按普通／工具策略分组显示中位数和可用的 token 统计；未知计数显示 null，旧记录缺少配置会被排除。这些自然使用记录不保证输入相同，不能冒充受控实验。

## 长时间非流式请求（1.2.1）

反代给非流式请求发送 JSON 空白保活。酒馆原本会把整篇 JSON 缓冲完再回复浏览器，因此使用酒馆时还需在酒馆所在设备运行一次：

```sh
node tools/install-st-keepalive.mjs "你的SillyTavern目录"
```

然后重启酒馆。Windows、Linux、Termux 都可用同一命令；手机酒馆装在手机上时，补丁也要应用在手机酒馆目录。命令会检查生成入口的结构，不匹配时拒绝修改，重复运行不会叠加补丁。酒馆更新后若覆盖了补丁，重新运行即可。只转发带 MMDB 标记的自定义 pg- 模型非流式 JSON，不修改预设、聊天、普通流式显示或其他提供商的行为。

这段保活让本地 HTTP 链路不再长时间完全静默，无法取消客户端自己的固定总时长上限，也无法向 Google 的响应连接注入数据。如果依然在固定时间断开，需要结合该客户端的限制继续定位。诊断 clientKeepAlives / lastKeepAliveMs 记录保活发送情况；client_disconnected 表示调用方断开，不能单凭该状态认定是超时。

Google 连接失败只在没有收到任何数据时允许已有的一次恢复；读到部分内容后断流会明确报 upstream_stream_disconnected，不重放已收到的内容、不伪装完成，也不无限重试。代理或 Google 主动断线仍可能失败；本地保活不能保证修复这一段网络。

## 手机悬浮条挡住发送键（1.2.2）

手机默认收起条改到左侧中部。手指拖动收起条、或拖动展开面板的标题，可以移动位置；松手后记住位置。展开面板底部的“换位置”可直接切换位置，不必拖动。键盘聚焦标题或收起条时，也可用方向键移动。屏幕旋转或软键盘弹出后会将面板限制在可见范围内。

升级后台文件后，在油猴中检查“MMDB 本地桥”更新到 1.2.2，刷新 AI Studio 才会启用新的界面；只更换 ZIP、未更新当前页面的脚本，不会改变已有悬浮条。生成、抗截断、保活逻辑与 1.2.1 相同。

## 思考摘要返回（1.2.3）

普通模型和抗截断模型默认向 Google 请求思考摘要，收到后通过 OpenAI 的 reasoning_content 字段返回，Gemini 接口保留 thought Part。流式请求收到摘要即转发；非流式与正文一起返回。抗截断正文仍通过正文工具交付，上游完整返回工具参数后才有正文。摘要来自上游，不是反代要求模型另写一份，也不代表完整内部思维链。模型可能不提供摘要；不提供时不影响正常正文。

1.2.3 只开启摘要返回，尚未发送 thinkingLevel；1.2.4 的等级行为见下一节。酒馆需开启“显示思维链”（名称随版本变化）才能展示；若仍不显示，结合 /v1/status 的 thoughtChars 检查是否确实收到了摘要，thinkingConfigSent=true 只表示发送了配置。

OpenAI 请求可用 `"include_reasoning": false` 关闭摘要，也兼容 `"extra_body": {"google": {"thinking_config": {"include_thoughts": false}}}`（显式 Google 配置优先）。原生 Gemini 请求可用 `"generationConfig": {"thinkingConfig": {"includeThoughts": false}}`；支持对应 snake_case 字段名。

升级时先停止旧后台，将最新版解压后启动；默认密钥仍为 mmdb，端口不变。如曾自定义配置，只复制自己的 config.json / lan-config.json。油猴检查更新或重新安装本机用户脚本，然后刷新 AI Studio、手动发 hi。1.2.2 浏览器执行器也能转发本次新增的请求字段。

## 4A 思考等级配置（1.2.4）

4A（gemini-4-argon）没有显式等级时，本版明确发送中等思考（medium），并请求思考摘要；普通、抗截断和续写均使用同一配置。这是本地选定的兼容默认值，没有自动读取账号的 ListModels 目录或网页 Run settings。其他模型未指定等级时继续使用上游默认。没有添加 thinkingBudget、修改温度、输出上限或抗截断提示词。

OpenAI 接口支持 `"reasoning_effort": "low"` / `"medium"` / `"high"`，auto 为本版默认行为；max 和 xhigh 映射到 high。也支持 extra_body.google.thinking_config.thinking_level，优先于 reasoning_effort。原生 Gemini 接口支持 generationConfig.thinkingConfig.thinkingLevel 以及对应 snake_case 字段名；不支持的等级或数值预算会在本地明确报错。

关闭 include_reasoning / includeThoughts 只关闭摘要返回，不关闭模型思考，也不把等级改成低档。诊断 generation.includeThoughts 与 generation.thinkingLevel 记录本次实际发送的摘要开关和等级；旧记录缺少这些字段时表示未知，不能当作 false。

本次已用模拟上游验证等级编码、覆盖与续写保留、普通/抗截断的流式及非流式摘要转发。真实 Google 是否返回摘要仍需实际调用确认；有开关和等级也不保证每次有摘要。此兼容修正尚不能被当作两次零摘要的已确认根因。

## 酒馆推理强度下拉框修复（1.2.5）

有些酒馆版本的自定义接口会过滤 PG 模型的 reasoning_effort。1.2.7 启动器已自动调用本机补丁；下列手动方式保留用于特殊情况。补丁只让自定义接口的 pg-gemini- 模型转发预设选择的强度；普通与抗截断都生效，不修改角色卡、预设、聊天、密钥或其他提供商。

每份酒馆程序安装一次，不需要每个模型、角色或聊天分别安装。多台设备各自运行酒馆时分别安装；手机打开电脑酒馆只需安装在电脑，手机本机 localhost:8000 则安装在手机。只更新电脑反代 ZIP 不会自动修改手机酒馆。酒馆更新覆盖源码后可能需要重装。

- Windows：双击 Fix-ST-Reasoning.cmd，输入酒馆根目录。
- 手机 Termux / Linux：在本包目录执行 `bash fix-st-reasoning.sh ~/SillyTavern`，最后的路径按实际酒馆位置调整。
- 通用命令：`node tools/install-st-reasoning.mjs "酒馆根目录"`。

首次看到“补丁已写入”或“自动安装”后，结束生成并重启酒馆。补丁自动保留 .mmdb-reasoning.bak 源码备份；重复安装不会叠加，源码结构不匹配时拒绝修改。支持 Android /sdcard 路径别名，安装不需要联网或发起模型请求。极高在 4A 映射为 high；自动不传等级，PG 的 4A 使用本地默认 medium。可通过 /v1/status 的 generation.thinkingLevel 核对本次实际发送的等级。

单独发送的 mmdb-st-reasoning-fix.mjs 与此补丁功能相同，无需重复安装。此版本核心生成逻辑与 1.2.4 相同；参数转发修复不代表上游每次都会提供思考摘要。

## 参数和摘要诊断（1.2.6）

补丁安装后，重启运行酒馆的进程。等网页就绪，再在酒馆所在设备运行：

```sh
node tools/check-st-reasoning.mjs
```

默认检查本机 8000，最长等待启动 30 秒。仅发送一条合成文本到本机临时模拟接口，不调用 Google、不修改聊天或连接设置。high 表示运行中的后端能转发强度；missing 表示仍丢失参数；startup 表示尚未连上服务，不能判断补丁。登录或 CSRF 失败会报告状态，不绕过认证。

/v1/status 的 recent/active 新增 reasoning：requestEffort 是反代实际收到的字段（missing 表示缺失）；generation.thinkingLevel 是构造的上游等级，不能证明 Google 已执行。rawThoughtChars 是解析前在已知协议位置找到的摘要字符数；decodedThoughtChars 是解析出的摘要；forwardedThoughtChars 是已写入调用方响应的摘要字符数，不能证明酒馆界面已显示或客户端已收完。partShapes 只记录前 32 个槽位的位置和类型，最多 8 种结构，不记录正文、签名、密钥或自定义字段名。

raw=0 仅表示已知协议位置未发现摘要，仍可能是上游未提供或协议布局变化。签名存在也不能证明有可读摘要。旧日志没有这些字段时表示未知。本版未改变思考等级默认值和摘要解析规则；真实 Google 摘要返回仍待验收。

## 启动自动安装酒馆补丁（1.2.7）

新老用户使用同一个 ZIP。停止旧反代，把新版文件覆盖到原目录（保留 config.json、lan-config.json、st-path.json），再使用 Start.cmd / Start-LAN.cmd 或 bash start.sh / bash start-lan.sh 启动。更新油猴脚本到 1.2.7 并刷新 AI Studio。

启动器会查找 ~/SillyTavern、~/GitHub/SillyTavern、~/Documents/GitHub/SillyTavern，以及反代上方三级目录旁的 SillyTavern。只找到一份时自动安装；有多份或找不到时，交互终端提示选择序号或输入根目录。路径保存在 st-path.json，以后自动检查。回车可跳过并记住选择；删除 st-path.json 可重新检测。非交互环境不等待输入，也不猜选多份酒馆，可通过 MMDB_ST_DIR 指定路径。

补丁仅修改已识别版本的 PG 强度转发条件，首次保留原文件备份；已安装时不重复写入。版本不兼容或备份冲突会明确提示，反代仍可运行。自动修改磁盘源码不能更新已经加载的酒馆进程：首次安装后，若酒馆正在运行，需要重启酒馆一次。

电脑反代连接手机酒馆时，电脑启动器无法修改手机。请把本包放到手机，在手机运行 bash fix-st-reasoning.sh（无需在手机再启动反代）；或在手机本身运行本包反代时由启动器自动安装。仍保留 Windows 的 Fix-ST-Reasoning.cmd 和本机检查器用于特殊目录或排查。已经确认强度生效的用户无需再次重启酒馆。

## 抗截断等待与连接失败（1.2.8）

1.2.8 曾默认 compact；1.2.9 已统一替换为文末的单条英文 user 方案，旧 toolPromptStyle 值兼容读取但不再选择其他提示词。

1.2.8—1.2.12 仅在首轮执行开始后 30 秒以内、尚未收到数据的连接失败允许一次自动重试；等待超过 30 秒再失败时，不会自动重新提交整段生成。这不是 30 秒生成超时：工具每轮首段正文保持 600 秒预算；只要连接未失败，300 秒后成功的请求仍可继续等。已收到数据、额度、权限、用户取消和其他错误都不自动重复。

错误区分浏览器到 Google 的连接失败与浏览器到本地反代的 WebSocket 断开。日志新增 upstreamFailurePhase、upstreamFailureWaitMs、retrySkipped、executorCloseCode；不记录请求内容或网络凭据。旧油猴脚本遇到长等待后重试，也会由新版后端拒绝重复提交，但建议同时更新油猴脚本。

本版不能修复外部代理或 Google 自身断开，也不能保证将实际生成从 300 秒降到 90 秒。请用同一条实测对照新的 toolPromptStyle、首个响应头时间和错误位置。

## 单条英文尾部指令（1.2.9）

抗截断保留 mmdb_emit_answer 工具和必填字符串参数 content。只在原始历史末尾追加一条独立 user 消息：

```text
Call mmdb_emit_answer once to submit the final answer.
```

原有系统提示词和历史不变。不再插入额外系统指令，不拼接到最后一条 user，也没有 assistant 预填特殊分支。工具与参数的描述分别为 Submit the final answer. 和 The final answer.。普通模型不追加这条消息。诊断 toolPromptStyle 为 tail-user，旧的 legacy / compact 配置统一兼容为这一方案。本次修改在后台，重启反代生效；已有 1.2.8 油猴可以继续使用。

## 工具正文等待修复（1.2.10）

抗截断每轮从派发起，最多等待 toolFirstByteTimeoutMs（默认 600 秒）收到首段非空正文。思考摘要、签名、工具名称和未拼完的数据帧不会将它提前降为 180 秒，也不会刷新这条固定期限。首段正文到达后恢复 timeoutMs（默认 180 秒）的数据间隔限制；MAX_TOKENS 续写单独计算下一轮的正文等待期限。

超时仍会取消浏览器任务，正文尚未到达但已收到其他数据时记录 tool_body_timeout；完全无上游数据时保留 upstream_first_byte_timeout。真实网络断开仍按原错误返回，不会被伪装为继续等待。本次仅修改后台超时判断，重启反代生效，已有 1.2.8／1.2.9 油猴可继续使用。

## 4A 工具分段与连接恢复（1.2.13）

工具尾部指令现在允许按顺序多次调用 mmdb_emit_answer，建议每次约 1000 字符，直到完整答复结束；不再要求整篇只调用一次。分段由模型决定，不能保证 Google 会立即返回响应头或按段发送。仍只接受工具正文，普通文本不会冒充工具结果。

抗截断在未收到任何上游数据、且错误为 upstream_connection_failed 时，允许重新获取 proof 后重试一次，包括等待超过 30 秒的连接失败。请求仍共用原有每轮 600 秒正文期限，重试不重置期限；取消、额度错误、已收到数据的断流不重试。面板明确提示重试可能额外消耗额度。此规则取代 1.2.8 的 30 秒重试窗口限制。

已验证分段拼接、长等待后的唯一一次恢复、取消和总期限；尚未通过真实 4A 长请求证实断链问题已解决。后台和油猴均更新到 1.2.13，再刷新 AI Studio 生效。
