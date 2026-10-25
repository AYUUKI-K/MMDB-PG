# 来源和许可证

MMDB 浏览器执行器与界面位于 src/browser/panel.js、src/browser/session.js、src/browser/executor.js，为本次另行编写的实现。公开包不包含此前直接修改的 Catiecli Playground Executor、原站前端、原始参考副本或其安装文件。早期本地版本曾使用 Catiecli 脚本，这段历史并不因重写而抹去；本次没有声称是与原脚本完全隔离的 clean-room 实现。

Google AI Studio 私有协议字段和 WAA 工作流程参考 Mag1cFall / AIStudio2API 的协议文档：https://github.com/Mag1cFall/AIStudio2API/blob/main/docs/protocol.md 。该项目采用 MIT，附原许可及版权声明 licenses/AIStudio2API-LICENSE；本项目不包含其 Go 程序或 Google 官方页面 bundle。

1.3.0 的 ListModels 能力位置、CONTINUATION 枚举、GenerateContent 原生续写字段及跨轮用量合并规则，核对至 AIStudio2API 提交 `59fbc735f362916a17b03fe3ecb3fdb09f068772`：[models.go](https://github.com/Mag1cFall/AIStudio2API/blob/59fbc735f362916a17b03fe3ecb3fdb09f068772/internal/aistudio/models.go)、[generate.go](https://github.com/Mag1cFall/AIStudio2API/blob/59fbc735f362916a17b03fe3ecb3fdb09f068772/internal/aistudio/generate.go)、[event.go](https://github.com/Mag1cFall/AIStudio2API/blob/59fbc735f362916a17b03fe3ecb3fdb09f068772/internal/aistudio/event.go)。对应 MIT 许可已随包保留。MMDB 的浏览器协议、能力缓存、超时及测试适配在本项目实现；可用字段计数不足时保持未知，不将缺省值自动当作零。

测试设计另参考 [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI/tree/bc0643405a1d0adf77dd0f109972ac3313d66397) 对完成帧、尾随 usage 和传输结束的区分；未引入其运行时代码。研究过的其他 2api 项目不构成 MMDB 的直接依赖，也没有把其他许可证下的模块复制进发布包。

依赖 ws 采用 MIT，原许可和版权声明位于 licenses/ws-LICENSE。安装后的 node_modules/ws 中也保留其原有许可文件。

抗截断模型参考 su-kaka/gcli2api 的合成工具封装输出思路：https://github.com/su-kaka/gcli2api/blob/master/src/converter/anti_truncation.py 。该文件同时注明参考 Xeltra233/Antigravity-anti-truncation-gateway。gcli2api 项目采用 CNC-1.0，含非商业、保留署名与派生作品等要求，不能称为无条件 MIT 授权。本项目的 anti-truncation.mjs 是按该思路编写的 PG Tool/Schema/Struct 适配与正文解码器，未直接复制原 Python 模块或其控制提示词；工具名及说明为 MMDB 本地实现。公开发布时应保留此思路来源说明，不得声称这项原理由 MMDB 首创，或把原模块作为本项目的 MIT 源文件发布。

Google 页面协议随时可能变化。文本、历史角色与流式兼容不代表支持所有 Gemini 功能；图片、客户端自定义工具和附件当前未实现。

1.5.0 的 `input-read.mjs` 是本项目实现的两阶段输入读取流程。函数调用 part[10]、函数结果 part[11]、思考签名 part[14]、Tool/Schema/Struct 编码及非文本 part 的空字符串请求绑定规则，核对至 AIStudio2API 提交 `59fbc735f362916a17b03fe3ecb3fdb09f068772` 的 [tools.go](https://github.com/Mag1cFall/AIStudio2API/blob/59fbc735f362916a17b03fe3ecb3fdb09f068772/internal/aistudio/tools.go)、[media.go](https://github.com/Mag1cFall/AIStudio2API/blob/59fbc735f362916a17b03fe3ecb3fdb09f068772/internal/aistudio/media.go)、[event.go](https://github.com/Mag1cFall/AIStudio2API/blob/59fbc735f362916a17b03fe3ecb3fdb09f068772/internal/aistudio/event.go) 和 [waa.md](https://github.com/Mag1cFall/AIStudio2API/blob/59fbc735f362916a17b03fe3ecb3fdb09f068772/docs/waa.md)。沿用随包保留的 MIT 许可；没有引入其 Go 模块，也没有使用伪造的签名占位符。输入读取工具与请求生命周期由 PG 自行维护，不依赖 SillyTavern-TicketBridge。
