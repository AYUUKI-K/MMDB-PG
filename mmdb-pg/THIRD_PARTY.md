# 来源和许可证

MMDB 浏览器执行器与界面位于 src/panel.js、src/session.js、src/executor.js，为本次另行编写的实现。公开包不包含此前直接修改的 Catiecli Playground Executor、原站前端、原始参考副本或其安装文件。早期本地版本曾使用 Catiecli 脚本，这段历史并不因重写而抹去；本次没有声称是与原脚本完全隔离的 clean-room 实现。

Google AI Studio 私有协议字段和 WAA 工作流程参考 Mag1cFall / AIStudio2API 的协议文档：https://github.com/Mag1cFall/AIStudio2API/blob/main/docs/protocol.md 。该项目采用 MIT，附原许可及版权声明 licenses/AIStudio2API-LICENSE；本项目不包含其 Go 程序或 Google 官方页面 bundle。

依赖 ws 采用 MIT，原许可和版权声明位于 licenses/ws-LICENSE。安装后的 node_modules/ws 中也保留其原有许可文件。

抗截断模型参考 su-kaka/gcli2api 的合成工具封装输出思路：https://github.com/su-kaka/gcli2api/blob/master/src/converter/anti_truncation.py 。该文件同时注明参考 Xeltra233/Antigravity-anti-truncation-gateway。gcli2api 项目采用 CNC-1.0，含非商业、保留署名与派生作品等要求，不能称为无条件 MIT 授权。本项目的 anti-truncation.mjs 是按该思路编写的 PG Tool/Schema/Struct 适配与正文解码器，未直接复制原 Python 模块或其控制提示词；工具名及说明为 MMDB 本地实现。公开发布时应保留此思路来源说明，不得声称这项原理由 MMDB 首创，或把原模块作为本项目的 MIT 源文件发布。

Google 页面协议随时可能变化。文本、历史角色与流式兼容不代表支持所有 Gemini 功能；图片、客户端自定义工具和附件当前未实现。
