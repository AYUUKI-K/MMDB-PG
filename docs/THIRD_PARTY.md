# 来源和许可证

当前目录和运行方式对应 1.7.11；按版本注明的引用与许可记录保留其历史范围。安装与菜单操作见 [INSTALLATION.md](INSTALLATION.md)。

## 本项目实现与早期沿革

MMDB 浏览器执行器与界面位于 `src/browser/`，包括面板 `panel.js`、会话 `session.js`、执行器 `executor.js`，以及悬浮窗 `panel-window.js`、主题同步 `tavern-theme.js`。

早期本地版本使用并修改过 Catiecli Playground Executor，后续在已有研究基础上重写为当前实现。原执行器及其安装文件不随当前发布包分发。

## 协议与测试参考

Google AI Studio 私有协议字段和 WAA 工作流程参考 [Mag1cFall / AIStudio2API 的协议文档](https://github.com/Mag1cFall/AIStudio2API/blob/main/docs/protocol.md)。该项目采用 MIT，附[原许可及版权声明](../licenses/AIStudio2API-LICENSE)；本项目不包含其 Go 程序或 Google 官方页面 bundle。

1.3.0 的 ListModels 能力位置、CONTINUATION 枚举、GenerateContent 原生续写字段及跨轮用量合并规则，核对至 AIStudio2API 提交 `59fbc735f362916a17b03fe3ecb3fdb09f068772`：[models.go](https://github.com/Mag1cFall/AIStudio2API/blob/59fbc735f362916a17b03fe3ecb3fdb09f068772/internal/aistudio/models.go)、[generate.go](https://github.com/Mag1cFall/AIStudio2API/blob/59fbc735f362916a17b03fe3ecb3fdb09f068772/internal/aistudio/generate.go)、[event.go](https://github.com/Mag1cFall/AIStudio2API/blob/59fbc735f362916a17b03fe3ecb3fdb09f068772/internal/aistudio/event.go)。对应 MIT 许可已随包保留。MMDB 的浏览器协议、能力缓存、超时及测试适配在本项目实现；可用字段计数不足时保持未知，不将缺省值自动当作零。

测试设计另参考 [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI/tree/bc0643405a1d0adf77dd0f109972ac3313d66397) 对完成帧、尾随 usage 和传输结束的区分；未引入其运行时代码。

1.5.0 的 `input-read.mjs` 是本项目实现的两阶段输入读取流程。函数调用 part[10]、函数结果 part[11]、思考签名 part[14]、Tool/Schema/Struct 编码及非文本 part 的空字符串请求绑定规则，核对至 AIStudio2API 提交 `59fbc735f362916a17b03fe3ecb3fdb09f068772` 的 [tools.go](https://github.com/Mag1cFall/AIStudio2API/blob/59fbc735f362916a17b03fe3ecb3fdb09f068772/internal/aistudio/tools.go)、[media.go](https://github.com/Mag1cFall/AIStudio2API/blob/59fbc735f362916a17b03fe3ecb3fdb09f068772/internal/aistudio/media.go)、[event.go](https://github.com/Mag1cFall/AIStudio2API/blob/59fbc735f362916a17b03fe3ecb3fdb09f068772/internal/aistudio/event.go) 和 [waa.md](https://github.com/Mag1cFall/AIStudio2API/blob/59fbc735f362916a17b03fe3ecb3fdb09f068772/docs/waa.md)。沿用随包保留的 MIT 许可。

## 1.7.9 页面兼容与目录参考

验证入口识别范围及文本模型目录筛选，另核对了 [DeconstructedCube / aistudio-api](https://github.com/DeconstructedCube/aistudio-api/tree/99c38baefc84d8cb66b05c28ede8a49ce050bfb2) 的 `src/aistudio_api/infrastructure/browser/js/install_hooks.js` 和 `src/aistudio_api/infrastructure/gateway/model_discovery.py`。本项目独立实现用户脚本适配及测试，未引入该项目源码、浏览器控制或账号调度模块；核对时仓库未提供单独的 LICENSE 文件。相关模型字段的既有协议来源及许可见上文。

## 抗截断思路来源

抗截断模型参考 [su-kaka / agy2api（原 gcli2api）的合成工具封装输出思路](https://github.com/su-kaka/agy2api/blob/master/src/converter/anti_truncation.py)。该文件同时注明参考 [Xeltra233 / Antigravity-gateway（原 Antigravity-anti-truncation-gateway）](https://github.com/Xeltra233/Antigravity-gateway)。2026-10-25 核对时，两个旧仓库地址均重定向到上述现名；保留原名以对应早期参考记录。

gcli2api 项目采用 CNC-1.0，含非商业、保留署名与派生作品等要求。本项目的 `src/server/anti-truncation.mjs` 是按该思路编写的 PG Tool/Schema/Struct 适配与正文解码器，未直接复制原 Python 模块或其控制提示词；工具名及说明为 MMDB 本地实现。原项目的代码及提示词保留其自身许可。

## 1.7 系列面板与宿主接口参考

| 来源 | 本项目使用范围 |
| --- | --- |
| [SillyTavern](https://github.com/SillyTavern/SillyTavern) | 识别酒馆原生界面、读取 SmartTheme 变量及当前元素的计算样式，适配每位用户自己的主题。 |
| [Tampermonkey 官方文档](https://www.tampermonkey.net/documentation.php) | 用户脚本匹配规则，以及 `GM_setValue`、`GM_getValue`、`GM_addValueChangeListener`、`GM_removeValueChangeListener` 的跨页面存储与监听接口。 |
| [Chrome Document Picture-in-Picture 官方文档](https://developer.chrome.com/docs/web-platform/document-picture-in-picture) | 置顶窗口的创建、DOM 元素移入及窗口关闭生命周期；本项目实现面板恢复、重复打开保护与普通弹窗回退。 |

主题同步只读取用户酒馆页面已生效的样式值。发布包没有内置第三方酒馆主题、自定义 CSS、背景图片或远程字体文件；面板布局和同步逻辑由 MMDB 实现。

1.7.1 的页面按需会话验证兼容，以及 1.7.2 的登录邮箱读取、原生新建对话按钮和 Meow 激活流程，依据当时实际 AI Studio 页面的请求与控件核对。1.7.3 已移除邮箱读取部分。

## 运行时依赖与许可文件

依赖 [ws](https://github.com/websockets/ws) 采用 MIT，[原许可和版权声明](../licenses/ws-LICENSE)随包保留；安装后的 `node_modules/ws` 中也保留其原有许可文件。上述平台和官方文档属于接口参考，未作为第三方主题或前端库打包。

Google 页面协议随时可能变化。文本、历史角色与流式兼容不代表支持所有 Gemini 功能；图片、客户端自定义工具和附件当前未实现。
