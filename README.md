# MMDB PG 本地反代

AI Studio Playground 本地桥接器。当前版本 **1.5.1**；提供 Windows / Termux / Linux 数字菜单启动更新管理器。

## 1.5.1：兼容旧配置

读取旧版 `toolPromptStyle: tail-user` 时映射到新版 `legacy`，修复从 1.2.x 升级后后台启动失败。迁移只作用于内存，不改写用户的配置文件。

## 1.5.0：合入便携菜单版

合入提供的 `mmdb-pg-1.5.0-portable-menu.zip` 源码，包括便携菜单、续写完整性检查、模型观测和默认关闭的实验功能。详细说明见 [便携版说明](mmdb-pg/PORTABLE_README.txt)、[作者说明](mmdb-pg/AUTHOR_REVIEW.txt) 和 [实验说明](mmdb-pg/EXPERIMENTS.md)。离线回归通过不代表真实 4A 长请求断连已经解决。

已有一键更新用户仍可在原管理菜单选 `2` 更新。下载包中的 Windows / Linux 入口兼容原固定管理器；直接解压后运行 `mmdb-pg/MMDB.cmd` 或 `bash mmdb-pg/mmdb.sh` 则进入便携菜单。更新后台后仍需安装 **1.5.1 浏览器用户脚本**，刷新 AI Studio 并重新发 hi 引导。

## 1.2.12：与新版 Playground 执行流程对齐

参考用户提供的 Catiecli Playground Executor 2.12.0 执行流程：后续请求直接对后端 `binding` 计算 SHA-256、生成 fresh WAA proof 并发送，不再把完整聊天内容写入、同步或清空网页输入框。已有草稿不再阻止请求，生成、取消和重试都不会修改它；输入框尚未渲染也不阻止已完成引导的会话发送。

首次仍需手动发 hi 捕获页面签名服务，本次未加入自动引导。抗截断工具、尾部用户提示词、思考强度、续传和超时策略不变。这是执行流程兼容修正，尚未经过用户的真实长对话证明能消除 4A 上游断联，不宣称根治或加速。1.2.11 的页面状态诊断继续保留。

## 1.2.11：请求鉴权修正与断联诊断

- 每次请求重新计算能够从当前页面 Cookie 读取并明确识别的 SAPISID 签名段，不再始终重放上次发 hi 捕获的时间戳。读不到 Cookie 或遇到未知扩展格式时保留页面原值，不丢弃其他账号或会员请求头。
- 不再重放上次页面生成请求的 `x-goog-ext-*` 动态上下文头。保留页面真实的 API 标识、会员档位、账号选择与 visit-id。
- Google 连接失败时记录页面可见性、浏览器在线标志、页面定时器最长间隔和是否刷新签名；在菜单 `3` 可看到这些状态。不记录 Cookie、签名或聊天正文。
- 继续区分 Google 上游失败与本地 WebSocket 断开。没有增加重复生成、放宽安全检查或继续延长超时。

这些是已验证的请求处理修正，**尚未通过真实 4A 长请求证明能消除断联或缩短生成时间**。日志里的在线标志不等于 Google 一定可达，定时器长间隔也可能来自后台节流、忙碌或系统休眠，不能单独当作根因证明。此次没有修改抗截断工具或尾部提示词。

协议研究参考 [AIStudio2API 的鉴权与请求头说明](https://github.com/Mag1cFall/AIStudio2API/blob/main/docs/protocol.md)；后台计时器行为参考 [Chrome 官方说明](https://developer.chrome.com/blog/timer-throttling-in-chrome-88/)。没有找到直接证明“4A 抗截断约 200 秒失败必然由保活引起”的 GitHub 问题结论。

## Android Termux：首次安装并启动

先安装下载工具：

```sh
pkg install curl
```

然后执行一条命令：

```sh
curl -fL https://raw.githubusercontent.com/AYUUKI-K/MMDB-PG/main/mmdb.sh -o "$HOME/mmdb-install.sh" && bash "$HOME/mmdb-install.sh"
```

进入数字管理菜单。首次选 `1` → `1` 启动本机反代，或选 `2` 安装 / 更新并启动。自动准备 Node.js（缺少时）和 unzip、下载固定 ZIP 并安装依赖，安装目录为 `~/mmdb-pg`。

首次安装成功后，`~/mmdb-install.sh` 可以删除。管理器保存在 `~/.local/share/mmdb/`，`mmdb` 命令会继续可用。

## 以后怎么用

只输入 `mmdb`，然后用数字操作：

| 数字 | 操作 |
|---|---|
| 1 | 启动反代，再选本机或局域网 |
| 2 | 安装 / 更新，完成后在后台启动 |
| 3 | 查看日志，按 1 刷新 |
| 4 | 停止反代 |
| 5 | 查看版本与状态 |
| 0 | 返回上级；主菜单中为退出菜单 |

启动、更新、停止和状态结果页均输入 `0` 返回。反代在后台运行，返回或退出菜单不会停止反代；用主菜单 `4` 停止。仍需保持 Termux 和 AI Studio 运行，安卓系统强制结束 Termux 时后台也会停止。

旧版管理器用户重新执行上面的首次命令一次，就能获得新版数字菜单。已有反代的配置会保留。高级命令 `mmdb start / lan / stop / upgrade / status` 仍然可用，其中直接 `start / lan / upgrade` 使用前台运行。

生成结束后再升级。可在另一个 Termux 会话执行更新命令；管理器仅停止能确认归属的本机进程，不会按端口强杀其他程序。其他目录的旧反代请先在原启动窗口 Ctrl+C。

更新先在临时目录解压并安装依赖，准备完成后替换安装目录。保留 `config.json`、`lan-config.json`、`st-path.json` 和诊断日志。旧目录保存在 `~/.local/share/mmdb/backup.*`，便于人工回退；这些备份不会自动删除。不要同时运行旧备份和新目录。

**后端更新完成后，还需在油猴里检查“MMDB 本地桥”更新，再刷新 AI Studio。浏览器扩展的安装确认无法由终端代点。**

## 旧用户迁移

原来就在 `~/mmdb-pg`：结束生成，执行上面的首次命令，再选 `2`，即可保留配置更新并接入管理器。原来放在其他目录：先停止那份后台，再安装；自定义配置需从原目录迁移，管理器不会猜测并删除其他目录。

如果固定地址暂时下载失败，也可手动下载 ZIP，执行：

```sh
termux-setup-storage
mmdb update local
mmdb start
```

`local` 会在 Download 等常用目录寻找版本号最高的 `mmdb-pg-x.x.x-universal.zip`。或明确指定文件：`mmdb update /sdcard/Download/实际文件名.zip`。更新拒绝降级。

## Linux

先安装 Bash、Node.js 22+、npm、curl 和 unzip，再执行相同首次命令。管理命令安装在 `~/.local/bin/mmdb`；如当前终端找不到命令，重新打开 Bash 或使用 `~/.local/bin/mmdb`。进程归属确认依赖 Linux `/proc`。

## Windows

先安装 Node.js 22+。[下载最新版 ZIP](https://raw.githubusercontent.com/AYUUKI-K/MMDB-PG/main/downloads/mmdb-pg-latest.zip)，完整解压后双击 **`MMDB.cmd`**，即可进入与安卓相同的数字菜单：`1` 启动、`2` 安装 / 更新并启动、`3` 日志、`4` 停止、`5` 状态，`0` 返回。

首次选 `2`；后续仍然双击 `MMDB.cmd`。程序安装到 `%LOCALAPPDATA%\MMDB-PG\app`，固定管理入口为 `%LOCALAPPDATA%\MMDB-PG\manager\MMDB.cmd`，可创建桌面快捷方式。更新自动从本仓库拉取 ZIP，保留配置；反代在后台运行，关闭菜单不会停止。用菜单 `4` 停止。

旧用户迁移前先结束生成、关闭原启动窗口。管理器首次安装会从它旁边的旧启动包目录复制 `config.json / lan-config.json / st-path.json` 和诊断日志；其他位置的配置不会自动寻找。旧的 `Start.cmd / Start-LAN.cmd` 保留，但不要与新管理器同时启动。

如果 GitHub 下载失败，可以先手动下载 ZIP 后用 PowerShell 执行 `powershell -ExecutionPolicy Bypass -File .\mmdb-manager.ps1 -Action install -Package "实际ZIP路径"`，再回菜单启动。Windows 更新功能同样没有修复浏览器到 Google 的上游断联；油猴仍需检查更新并刷新页面。

## 浏览器和酒馆设置

后台启动后，打开 `http://127.0.0.1:8765/local-pg.user.js` 安装油猴脚本；打开 AI Studio、登录并手动发送 hi，等待本地连接和 Google 就绪。

酒馆使用“聊天补全 → 自定义兼容 OpenAI”，本机地址 `http://127.0.0.1:8765/v1`，默认密钥 `mmdb`。手机连接电脑时使用 LAN 启动窗口给出的地址。

详细功能、补丁和协议来源见 [启动包文档](mmdb-pg/README.md)、[许可证](mmdb-pg/LICENSE) 和 [第三方说明](mmdb-pg/THIRD_PARTY.md)。管理器更新源可用 `mmdb source HTTPS地址` 指定，`mmdb source clear` 恢复本仓库地址；安装包来自更新源并会执行其中的构建脚本，请使用可信发布地址。

### 1.2.13 更新

4A 抗截断改为允许分段工具答复；无上游数据的连接失败允许一次重试，仍共用原有 600 秒期限。需更新后台和油猴脚本并刷新 AI Studio。已通过本地回归测试，实际 4A 断链修复效果仍待验证。

## 1.2.14：4A 回退基线

仅 gemini-4-argon 抗截断恢复 1.2.12 的单次工具尾部指令和工具描述，并关闭自动网络重试，避免长等待失败后重复消耗调用。3.8 Flash 和其他模型保留 1.2.13 行为。后台更新重启即可，1.2.13 油猴仍兼容；没有证据保证回退后成功率恢复，根因仍待定位。
