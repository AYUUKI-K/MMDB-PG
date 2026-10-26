# Playground 实验记录 · 2026-10-25

本文保留 2026-10-25 的历史探测结果，不是 1.7.10 安装指南；当前功能开关与用法见[生成设置](USAGE.md#生成设置)，安装入口见[安装说明](INSTALLATION.md)。下文的旧接口限制、版本和单次结果按当时情形保留。

范围：当前登录的 AI Studio Playground，经本项目浏览器执行器发送固定合成提示词。没有使用酒馆聊天内容。模型为 `gemini-3.8-flash` 与 `gemini-4-argon`；各场景各一次，不能代表其他模型、账号或未来版本。

## 原生强制调用：候选字段未生效

公开 Vertex 协议支持 FunctionCallingConfig，但不能直接套用其数组位置。此次读取的 PG 前端中，ToolConfig 的第 1 字段已经是 RetrievalConfig；公开 Vertex 协议则使用不同布局。

本次只检验一个候选映射：PG 请求 `wire[13][1]` 为 FunctionCallingConfig，内部依次使用 mode、allowedFunctionNames、空位、streamFunctionCallArguments。这是实验假设，不是已确认的 PG 字段。正式生成路径不会发送它。

| 模型 | AUTO：要求普通文本 | 候选 ANY：同一提示词 | 候选 NONE：要求调用工具 |
| --- | --- | --- | --- |
| Gemini 3.8 Flash | 11 字符普通文本，0 工具帧 | 11 字符普通文本，0 工具帧 | 1 工具帧，0 普通文本 |
| Gemini 4 Argon | 11 字符普通文本，0 工具帧 | 11 字符普通文本，0 工具帧 | 1 工具帧，0 普通文本 |

ANY 没有强制调用，NONE 没有禁止调用。HTTP 200 只能证明请求被接受，不能证明这些字段已生效。该结果排除了本次候选映射的可用性，不能证明 PG 后端绝对不支持其他映射。

## 工具参数流式：未观察到

固定请求为调用正文工具，写 100 行编号故事，每行至少 12 个词；输出上限 4096。开启上述候选参数流式字段。

| 模型 | 网络数据块 | 响应帧 | 带参数工具帧 | 参数序列化字符数 | partialArgs 帧 | 耗时 |
| --- | --- | --- | --- | --- | --- | --- |
| Gemini 3.8 Flash | 1 | 2 | 1 | 12135 | 0 | 28.7 秒 |
| Gemini 4 Argon | 2 | 2 | 1 | 10653 | 0 | 43.8 秒 |

多个网络数据块不等于参数流式。此次两模型均在单个工具帧中给出完整参数，没有观察到公开 Vertex 协议所描述的 partialArgs / willContinue 扩展。面板不提供强制调用或参数流式入口，也不提供无效配置项。

## 原生续写：保留实验开关

当前页面实际 ListModels 目录中，Argon 同时声明函数工具和 output continuation；Flash 3.8 没有声明 output continuation。Argon 目录的输出上限为 32768。

Argon 短请求使用 `generationConfig[45]=1`、清除 `wire[10]`，返回 HTTP 200、一个完整工具参数帧和 STOP，未返回 continuation token。它验证了短请求可用，**没有验证跨 32768 token 的真实续写、token 消费或跨轮工具参数拼接**。不通过降低单轮上限模拟一个 PG 并未声明支持的续写流程。

面板仅保留“原生续写”，默认关闭，保存到 config.json。支持目录必须新鲜且来自当前执行器；只作用于抗截断模型。正常生成仍保留现有严格工具解码与错误处理，未经验证的 partialArgs 不能被当成普通正文。

1.4.0 后台开关另做了一次真实短请求：通过设置接口开启，检查配置已落盘，再调用 Argon 抗截断模型；返回正文匹配固定标记、finish_reason 为 stop、诊断 continuationMode 为 native。结束后恢复关闭。该请求使用当前已安装的 1.3.1 执行器，证明后台切换可即时生效。新版面板在独立预览中通过开关、锁定、390×844 手机与 1280×900 桌面、浅深色样式检查；用户选择稍后自行更新脚本，因此未声称已在其 AI Studio 页面完成 1.4.0 面板的刷新验证。

## 复现与保留数据

服务与页面已就绪、没有其他生成时，在项目目录执行：

```sh
node tools/probe-playground.mjs tool-auto gemini-3.8-flash
node tools/probe-playground.mjs tool-any gemini-3.8-flash
node tools/probe-playground.mjs tool-none gemini-3.8-flash
node tools/probe-playground.mjs argument-stream gemini-3.8-flash
node tools/probe-playground.mjs native-continuation gemini-4-argon
```

命令会消耗一次真实调用。`/v1/experiments/probe` 需要本机密钥，只接受上述固定探测类型和已配置模型；没有任意 wire 注入接口。探测不重试，3 分钟超时，与正常生成互斥。取消、断线和超时都会清理任务。CLI 将时间、帧计数、参数长度和完成状态记录到忽略目录 `.experiments/results.jsonl`，不保存提示词、模型正文、调用 ID、Cookie、签名或续写 token。分发包不含该目录。

设置接口 `GET/POST /v1/experiments` 同样需要本机密钥。POST 的唯一配置字段是布尔值 `nativeContinuation`；生成或探测期间拒绝修改，落盘失败时不更新运行状态。页面通过当前已验证连接的 WebSocket 接收保存确认，后台状态是唯一来源，旧页面缓存不会覆盖配置。

## 参考

- [Google 官方 Vertex FunctionCallingConfig / FunctionCall / PartialArg 协议](https://github.com/googleapis/googleapis/blob/master/google/cloud/aiplatform/v1beta1/tool.proto)
- [Google 官方参数流式文档](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/tools/function-calling#streaming_function_call_arguments)
- [Google 官方 Generative Language content 协议](https://github.com/googleapis/googleapis/blob/master/google/ai/generativelanguage/v1beta/content.proto)
- [AIStudio2API 的 PG 请求实现](https://github.com/Mag1cFall/AIStudio2API/blob/main/internal/aistudio/generate.go)

这些资料用于构造假设；公开 API 的支持情况不自动等于 Playground 私有接口支持情况。
