# 模型身份与路由调查 · 2026-10-25

本文记录 1.4.2 的调查结果。1.7 系列已移除面板中的“实际模型”核验提示，当前面板说明见[反代面板](USAGE.md#反代面板)。

## 当时能确认的范围

MMDB 1.4.2 区分请求模型、发送到 Google 的模型和上游身份核验结果。当前 Playground 私有协议尚未确认可靠的响应模型字段，因此 `modelIdentity.reported` 为 `null`，`verification` 为 `unavailable`。面板显示“实际模型：无法核验”，不把请求选择、模型目录、速度、思考长度或模型自述当作服务端身份。

这不是换模检测器，也不宣称能够阻止上游换模。没有添加随机标签、提示词混淆、强制路由参数或自动重试开关。没有改动用户预设或聊天。

生成结束时，面板日志显示发送模型、输入/思考/输出 token、结束原因；续写请求额外显示首轮输入与续写次数。未知用量不按零处理。`/v1/status` 的 active/recent 以及本地诊断历史保存相同的模型身份状态；记录只有元数据。旧历史没有这些字段，不补造历史结果。

新日志需要同时更新后台和用户脚本。仅重新构建文件不会替换已经运行的进程或浏览器里的旧脚本。

## 公开证据

1. [Google 官方 SDK](https://googleapis.github.io/js-genai/release_docs/classes/types.GenerateContentResponse.html#modelVersion) 定义 `modelVersion` 为生成响应所用模型的版本。这是公开 API 的字段契约，不能直接套到 Playground 数组位置。即使取得该字段，它也是提供方报告，不是对服务器内部权重的独立鉴定。
2. [Google 开发者论坛的路由反馈](https://discuss.ai.google.dev/t/ai-studio-silently-routing-gemini-3-1-pro-preview-requests-to-flash-lite/180734)：必须读至 2026-09-21 第 7 帖。帖主撤回早先的约 12.6k token 阈值结论，报告只差一个词的短提示词得到不同末帧模型版本。第 6 帖称其公共 API 异常、网页内部端点正常，与另一用户的网页体验反馈不同。Google 第 5 帖要求复现材料，当前可见回复未给出原因或修复结论。实际换模与身份/计量误报仍需服务方确认。
3. 更正：首次整理遗漏第 6、7 帖，过度强调输入长度；现已修正。该讨论提供了提示词措辞与异常相关的具体用户样本，但没有证明“热门预设头尾/思考标签黑名单”或其作用于当前 Playground 的机制。
4. [官方提示设计指南](https://ai.google.dev/gemini-api/docs/prompting-strategies?hl=en) 本身建议一致的结构、分隔符和 XML 格式。因此 XML 标签的存在不能单独证明降级。对个别标签的怀疑应使用控制变量测试。
5. [官方思考说明](https://ai.google.dev/gemini-api/docs/generate-content/thinking?hl=en) 区分思考摘要和思考 token。预设让模型输出的 `<think>` 文本不是原生思考配置；思考文本短或用量缺省也不能直接证明模型改变。
6. [Google 滥用监控政策](https://ai.google.dev/gemini-api/docs/usage-policies) 明确列出可能通过改变回答某次请求的模型来限制使用；适用范围包括 Gemini API 与 AI Studio。文档未披露具体触发规则，也没有确认本帖案例属于该机制。邮件联络写的是可能进行，不能解读为换模前一定通知。

## 开源实现中可借鉴的部分

| 项目 | 核对位置 | 可借鉴内容与边界 |
| --- | --- | --- |
| AIStudio2API | [协议说明](https://github.com/Mag1cFall/AIStudio2API/blob/1169c534a4f4faa46981a117f0c80aada72bc0bb/docs/protocol.md)、[Gemini 适配器](https://github.com/Mag1cFall/AIStudio2API/blob/1169c534a4f4faa46981a117f0c80aada72bc0bb/internal/api/gemini.go) | 私有协议和分帧可参考；该提交的适配器用 `request.Model` 填充 `modelVersion`，不能据此确认实际模型。 |
| AIstudioProxyAPI | [模型切换模块](https://github.com/CJackHwang/AIstudioProxyAPI/blob/044c3db48e956097d4c509c87ebf0ecadb4e79e2/api_utils/model_switching.py) | 区分客户端请求、代理模型映射和页面选择，有助于排查本地选错模型；页面选择不证明服务端没有换模。 |
| Promptfoo | [入门](https://www.promptfoo.dev/docs/getting-started/)、[兼容 OpenAI 接口](https://www.promptfoo.dev/docs/providers/openai/) | 可对不同预设做固定样本评估，接入本地兼容接口。它比较行为与质量，不证明底层模型身份；本项目未安装此依赖。 |

这些是观测与对照的方法，未找到可直接移植、经验证能锁住 Playground 底层模型的成熟开源防护模块。[Vertex AI 的 RoutingConfig](https://cloud.google.com/vertex-ai/generative-ai/docs/reference/rest/v1beta1/GenerationConfig#RoutingConfig) 有自己的接口范围，也不能作为 PG 可用强制路由字段的证明。

## 建议的对照方法

先复制预设，用脱敏、固定的聊天片段测，不直接修改常用原件。固定账号、请求模型、普通/工具模式、采样参数、输出预算以及历史内容；交错重复各组，而非只比较各一次。

- A：原预设。B：只对疑似标签做一致重命名，保留语义和引用关系，尽量保持输入 token 接近。用于调查标签相关性。
- C：保持原标签，只缩短历史或删除重复的格式说明。用于调查长度与冗余。
- 分开记录普通模型和抗截断模型；工具模式会改变请求结构，不混作同一组。
- 比较首轮输入、思考用量、结束原因、首字延迟、正文完整性和固定任务得分。不要把缩短输入后变快，直接解释为标签洗白或模型恢复。
- 若公开 API 能返回 `modelVersion`，保留首帧、末帧及每次变化；只看首帧可能漏掉尾帧变化。若仍没有可靠字段，结论只能是行为差异。

近期可做的稳妥优化是删去重复或相互冲突的指令、让结构与角色层级清楚、按需缩短历史、检查 stop sequences 是否误匹配思考或正文标签。这些措施改善提示质量和可诊断性，不保证防止上游路由。

暂不建议默认添加随机噪声、零宽字符或频繁变换标签：缺少有效性证据，还可能增加 token、破坏正则和格式约定，使问题更难复现。也不建议凭短回复自动重发，因为无法确认原因且会额外消耗额度。

## 后续实现条件

若拿到当前 Playground 原始响应中可验证的身份字段，先确认它是服务器生成且会随响应变化，再实现每轮的首/末模型与变化记录。已知别名须与不同型号区分，异常才告警。严格拒绝模式必须说明：若身份只在末帧提供，要避免向酒馆送出不匹配内容就需要缓冲整轮，无法同时保证实时流式展示。当前没有满足这个条件，因此不放置无效入口。
