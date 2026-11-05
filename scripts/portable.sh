#!/usr/bin/env bash
# Portable menu: system dependencies are installed by the user.
set -u
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." || exit 1
download='https://nodejs.org/en/download'
show_download() {
  if [ -n "${TERMUX_VERSION:-}" ] || [[ "${PREFIX:-}" == *com.termux* ]]; then
    printf '\nTermux 请先完整升级，再使用官方软件源安装：\napt update && apt full-upgrade -y && apt install -y nodejs-lts npm curl unzip\n不要安装面向桌面 Linux 的 Node.js 二进制包。\n'
  else
    printf '\nNode.js 官方下载：%s\n请选择适合系统的 LTS 版本，并安装 npm。\n' "$download"
  fi
  printf '安装后回菜单重新检测。菜单不会自动安装系统依赖。\n'
}
node_ready() {
  local output
  if ! command -v node >/dev/null 2>&1; then printf '未检测到 Node.js。\n'; show_download; return 1; fi
  if ! output=$(node -e 'if(Number(process.versions.node.split(".")[0])<22)process.exit(1)' 2>&1); then
    [ -z "$output" ] || printf '%s\n' "$output" >&2
    if { [ -n "${TERMUX_VERSION:-}" ] || [[ "${PREFIX:-}" == *com.termux* ]]; } && [[ "$output" == *'CANNOT LINK EXECUTABLE'* ]]; then
      printf 'Termux 系统库无法加载，请先完整升级；详细步骤见 docs/INSTALLATION.md 的「Termux 系统库修复」。\n'
    else printf '需要可运行的 Node.js 22+。\n'; fi
    show_download; return 1
  fi
}
run_action() {
  node_ready || return 1
  case "$1" in
    check|install)
      if ! command -v npm >/dev/null 2>&1 || ! npm --version; then
        printf '未检测到可用的 npm。\n'; show_download
        [ "$1" != install ] || return 1
      fi;;
  esac
  node tools/portable-manager.mjs "$@"
}
open_url() {
  if command -v termux-open-url >/dev/null 2>&1; then termux-open-url "$1"
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$1" >/dev/null 2>&1
  elif command -v open >/dev/null 2>&1 && [ "$(uname -s)" = Darwin ]; then open "$1"
  else printf '请在浏览器打开：%s\n' "$1"; fi
}
page() { "$@" || printf '\n操作未完成，请查看上面的提示。\n'; read -r -p '按回车返回菜单' _ || true; }
script_page() {
  if [ "${1:-}" != prepared ]; then
    printf '正在检查执行后端；浏览器模式会准备脚本安装页。\n'
    run_action script || return 1
  fi
  local url
  url=$(node tools/portable-manager.mjs script-url) || return 1
  if [ "$url" = headless ]; then printf '当前为独立后端，无需安装浏览器脚本；账号管理请选择 11。\n'; return 0; fi
  open_url "$url" || printf '浏览器未能自动打开，请手动访问：%s\n' "$url"
  printf '请使用装有油猴的浏览器打开上面的地址，在浏览器中确认更新后刷新 AI Studio。\n'
}
update_page() {
  printf '更新全部：下载源码 → 保留配置与凭证并重启 PG → 检查当前执行后端。\n'
  run_action update || return 1
  script_page prepared
}
start_page() {
  run_action "${1:-ready}" || return 1
  local url
  url=$(node tools/portable-manager.mjs playground-target) || return 1
  if [ "$url" = disabled ]; then printf '已关闭启动后自动打开网页；可在菜单 13 开启。\n'; return 0; fi
  if [ "$url" = opened ]; then printf '本次后台启动已打开过 PG 页面，不重复打开；需要时可手动打开 AI Studio。\n'; return 0; fi
  if [ "$url" = connected ]; then printf '已有 AI Studio 页面连接，继续使用现有页面，不重复打开。\n'; return 0; fi
  [ "$url" = 'https://aistudio.google.com/prompts/new_chat' ] || return 1
  printf '正在打开 AI Studio Playground。网页模式需 Meow 激活；独立模式无需网页连接。\n'
  if open_url "$url"; then node tools/portable-manager.mjs playground-opened; else printf '浏览器未能自动打开，请手动访问：%s\n' "$url"; fi
}
backend_page() {
  node_ready || return 1
  node tools/portable-manager.mjs startup-settings || return 1
  printf '1 网页模式：依赖 AI Studio 页面；2 独立模式：使用导入凭证；0 返回。\n两种模式择一运行；有生成任务时拒绝切换。\n'
  local selected
  read -r -p '选择模式：' selected || return 0
  case "${selected%$'\r'}" in 1) run_action mode-browser;; 2) run_action mode-headless;; esac
}
startup_page() {
  node_ready || return 1
  node tools/portable-manager.mjs startup-settings || return 1
  printf '1 开启启动后打开 AI Studio Playground；2 关闭；0 返回。\n'
  local selected
  read -r -p '选择启动行为：' selected || return 0
  case "${selected%$'\r'}" in 1) run_action open-pg-on;; 2) run_action open-pg-off;; esac
}
accounts_page() {
  node_ready || return 1
  local url
  printf '正在准备账号管理；首次使用会下载并校验独立运行时…\n'
  url=$(node tools/portable-manager.mjs accounts-url) || return 1
  [[ "$url" =~ ^http://127\.0\.0\.1:[0-9]+/#[a-f0-9]{64}$ ]] || return 1
  open_url "$url" || printf '请在本机手动访问：%s\n' "$url"
  printf '可导入多个账号、设置轮换与恢复策略，也可使用 Camoufox 隔离登录。\n关闭管理页或退出菜单后，管理服务和独立运行时继续运行。\n'
}
unattended_page() {
  node_ready || return 1
  node tools/unattended.mjs status || return 1
  printf '1 开启 PG 进程守护；2 关闭守护；0 返回。\n菜单 6 手动停止会暂停守护，菜单 1 恢复。系统登录自启动请使用本机进程管理器。\n'
  local selected
  read -r -p '选择无人值守设置：' selected || return 0
  case "${selected%$'\r'}" in 1) node tools/unattended.mjs enable;; 2) node tools/unattended.mjs disable;; esac
}
update_help() {
  printf '选 2 会下载 GitHub main 源码，识别提交并构建；保留配置和 .headless 凭证。\n独立模式检查后台；浏览器模式打开脚本安装页，需在油猴确认并刷新 AI Studio。\n旧程序保留在 .updates 中；正在生成时请先结束请求。Git 工作区不会被自动覆盖。\n'
}
menu_line() {
  local color="$1" text="$2"
  if [ -t 1 ] && [ "${TERM:-}" != dumb ] && [ -z "${NO_COLOR+x}" ]; then
    printf '\033[%sm%s\033[0m\n' "$color" "$text"
  else printf '%s\n' "$text"; fi
}
show_menu() {
  printf '\n'
  menu_line 95 "  MEOW-FM · $1"
  menu_line 90 '  --------------------------------'
  menu_line 37 '  喵喵电波'
  show_runtime
  if [ "${task_backend:-}" = headless ]; then menu_line 96 '  日常 1   账号 11   更新 2'
  else menu_line 96 '  首次 3   日常 1   更新 2'; fi
  printf '\n'
  menu_line 96 '   1  启动 / 继续使用'
  menu_line 96 '   2  更新全部'
  menu_line 96 '   3  安装 / 更新浏览器脚本（浏览器模式）'
  printf '\n'
  menu_line 37 '   4  刷新状态 / 连接地址'
  menu_line 37 '   5  查看日志'
  menu_line 33 '   6  停止 PG 反代'
  menu_line 37 '   7  手机连接此设备'
  menu_line 37 '   8  修复项目依赖'
  menu_line 37 '   9  更新说明'
  menu_line 37 '  10  安装 Node.js'
  menu_line 96 '  11  账号管理（独立后端）'
  menu_line 96 '  12  选择网页 / 独立模式'
  menu_line 37 '  13  启动后打开 PG：开启 / 关闭'
  menu_line 96 '  14  无人值守 / 进程守护'
  menu_line 96 '  15  一键重启（沿用当前模式）'
  printf '\n'
  menu_line 37 '   0  退出菜单'
  menu_line 90 '  --------------------------------'
  menu_line 37 '  退出菜单后，后台继续运行。'
  if [ "${task_backend:-}" = headless ]; then menu_line 37 '  停止 PG 不会退出独立运行时或删除账号凭证。'
  else menu_line 37 '  更新脚本后，在油猴确认并刷新 AI Studio。'; fi
}

show_runtime() {
  local state line color
  task_backend=unknown
  if ! command -v node >/dev/null 2>&1; then menu_line 33 '  反代 未启动 · 请先安装 Node.js'; return; fi
  state=$(node tools/portable-manager.mjs menu-status --text 2>/dev/null) || state='状态暂不可读 · 选择 4 查看详情'
  case "$state" in *执行后端\ 独立运行时*) task_backend=headless;; esac
  while IFS= read -r line; do
    color=92; case "$line" in *未启动*|*未就绪*|*未连接*|*未响应*|*待检测*|*不可读*|*选\ 3\ 确认*|*后台仍为*|*个请求*|*选\ 11*|*启动中*|*配置已改变*) color=33;; esac
    menu_line "$color" "  $line"
  done <<< "$state"
  menu_line 90 '  以上状态在返回菜单时刷新，选 4 可重新检查。'
}

menu_version() {
  local line
  while IFS= read -r line; do
    if [[ "$line" =~ \"version\"[[:space:]]*:[[:space:]]*\"([0-9]+\.[0-9]+\.[0-9]+)\" ]]; then
      printf 'v%s' "${BASH_REMATCH[1]}"; return
    fi
  done < package.json
  printf '版本未知'
}
if [ "$#" -gt 0 ]; then
  case "$1" in accounts) accounts_page; exit $?;; check|install|start|lan|stop|restart|status|logs|links|ready|ready-lan|script|update|mode-browser|mode-headless|open-pg-on|open-pg-off) run_action "$@"; exit $?;; *) printf '未知操作。\n'; exit 1;; esac
fi
while true; do
  show_menu "$(menu_version)"
  read -r -p '请选择：' choice || break
  choice=${choice%$'\r'}
  case "$choice" in
    1) page start_page ready;; 2) page update_page;; 3) page script_page;;
    4) page run_action check;; 5) page run_action logs;; 6) page run_action stop;;
    7) page start_page ready-lan;; 8) page run_action install;;
    9) page update_help;; 10) page show_download;; 11) page accounts_page;; 12) page backend_page;; 13) page startup_page;; 14) page unattended_page;; 15) page run_action restart;; 0) break;;
    *) printf '请输入 0–15。\n';;
  esac
done
