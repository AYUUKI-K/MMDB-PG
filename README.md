# MMDB PG 本地反代

AI Studio Playground 本地桥接器。后端版本 **1.2.10**；本次新增 Termux / Linux 启动更新管理器。浏览器到 Google 的长请求失败仍在排查，本次没有宣称修复断联。

## Android Termux：首次安装并启动

先安装下载工具：

```sh
pkg install curl
```

然后执行一条命令：

```sh
curl -fL https://raw.githubusercontent.com/AYUUKI-K/MMDB-PG/main/mmdb.sh -o "$HOME/mmdb-install.sh" && bash "$HOME/mmdb-install.sh" upgrade
```

自动安装 Node.js（缺少时）和 unzip，下载本仓库的固定 ZIP 地址，安装依赖，再启动本地反代。安装目录为 `~/mmdb-pg`。保持终端运行，Ctrl+C 停止。

首次安装成功后，`~/mmdb-install.sh` 可以删除。管理器保存在 `~/.local/share/mmdb/`，`mmdb` 命令会继续可用。

## 以后怎么用

```sh
mmdb            # 管理菜单
mmdb start      # 本机启动
mmdb lan        # 局域网启动
mmdb stop       # 停止已确认属于 ~/mmdb-pg 的后台
mmdb upgrade    # 下载最新版、保留配置、更新后启动
mmdb status     # 查看版本和进程状态
```

生成结束后再升级。可在另一个 Termux 会话执行更新命令；管理器仅停止能确认归属的本机进程，不会按端口强杀其他程序。其他目录的旧反代请先在原启动窗口 Ctrl+C。

更新先在临时目录解压并安装依赖，准备完成后替换安装目录。保留 `config.json`、`lan-config.json`、`st-path.json` 和诊断日志。旧目录保存在 `~/.local/share/mmdb/backup.*`，便于人工回退；这些备份不会自动删除。不要同时运行旧备份和新目录。

**后端更新完成后，还需在油猴里检查“MMDB 本地桥”更新，再刷新 AI Studio。浏览器扩展的安装确认无法由终端代点。**

## 旧用户迁移

原来就在 `~/mmdb-pg`：结束生成，执行上面的首次命令即可保留配置接入管理器。原来放在其他目录：先停止那份后台，再安装；自定义配置需从原目录迁移，管理器不会猜测并删除其他目录。

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

[下载固定最新版 ZIP](downloads/mmdb-pg-latest.zip)，完整解压后使用 `Start.cmd` / `Start-LAN.cmd`。本次 Bash 管理器针对 Termux / Linux，未实现 Windows 自动更新。

## 浏览器和酒馆设置

后台启动后，打开 `http://127.0.0.1:8765/local-pg.user.js` 安装油猴脚本；打开 AI Studio、登录并手动发送 hi，等待本地连接和 Google 就绪。

酒馆使用“聊天补全 → 自定义兼容 OpenAI”，本机地址 `http://127.0.0.1:8765/v1`，默认密钥 `mmdb`。手机连接电脑时使用 LAN 启动窗口给出的地址。

详细功能、补丁和协议来源见 [启动包文档](mmdb-pg/README.md)、[许可证](mmdb-pg/LICENSE) 和 [第三方说明](mmdb-pg/THIRD_PARTY.md)。管理器更新源可用 `mmdb source HTTPS地址` 指定，`mmdb source clear` 恢复本仓库地址；安装包来自更新源并会执行其中的构建脚本，请使用可信发布地址。
