#!/usr/bin/env bash
# Portable menu: system dependencies are installed by the user.
set -u
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." || exit 1
download='https://nodejs.org/en/download'
show_download() {
  if [ -n "${TERMUX_VERSION:-}" ] || [[ "${PREFIX:-}" == *com.termux* ]]; then
    printf '\nTermux 请使用官方软件源安装：pkg install nodejs-lts npm\n不要安装面向桌面 Linux 的 Node.js 二进制包。\n'
  else
    printf '\nNode.js 官方下载：%s\n请选择适合系统的 LTS 版本，并安装 npm。\n' "$download"
  fi
  printf '安装后回菜单重新检测。菜单不会自动安装系统依赖。\n'
}
node_ready() {
  if ! command -v node >/dev/null 2>&1; then printf '未检测到 Node.js。\n'; show_download; return 1; fi
  if ! node -e 'if(Number(process.versions.node.split(".")[0])<22)process.exit(1)'; then printf '需要 Node.js 22+。\n'; show_download; return 1; fi
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
    printf '正在准备脚本安装页；后台未运行时会自动启动。\n'
    run_action script || return 1
  fi
  local url
  url=$(node tools/portable-manager.mjs script-url) || return 1
  open_url "$url" || printf '浏览器未能自动打开，请手动访问：%s\n' "$url"
  printf '请使用装有油猴的浏览器打开上面的地址，在浏览器中确认更新后刷新 AI Studio。\n'
}
update_page() {
  printf '更新全部：下载源码 → 保留配置并重启后台 → 打开油猴脚本更新页。\n'
  run_action update || return 1
  script_page prepared
}
start_page() {
  run_action "${1:-ready}" || return 1
  local url
  url=$(node tools/portable-manager.mjs playground-target) || return 1
  if [ "$url" = connected ]; then printf '已有 AI Studio 页面连接，继续使用现有页面，不重复打开。\n'; return 0; fi
  [ "$url" = 'https://aistudio.google.com/prompts/new_chat' ] || return 1
  printf '后台已就绪，正在打开 AI Studio Playground；登录后点击 Meow 激活。\n'
  open_url "$url" || printf '浏览器未能自动打开，请手动访问：%s\n' "$url"
}
update_help() {
  printf '选 2 会直接下载 GitHub main 源码，识别提交并构建，更新本目录后打开脚本安装页；无需访问令牌。\n旧程序保留在 .updates 中；正在生成时请先结束请求。Git 工作区不会被自动覆盖。\n维护者推送源码即可供新版菜单更新；修改浏览器脚本时仍需提高版本号。\n'
}
menu_line() {
  local color="$1" text="$2"
  if [ -t 1 ] && [ "${TERM:-}" != dumb ] && [ -z "${NO_COLOR+x}" ]; then
    printf '\033[%sm%s\033[0m\n' "$color" "$text"
  else printf '%s\n' "$text"; fi
}
show_menu() {
  printf '\n'
  menu_line 95 "  MEWO-FM · $1"
  menu_line 90 '  --------------------------------'
  menu_line 37 '  喵喵电波'
  menu_line 96 '  首次 3   日常 1   更新 2'
  printf '\n'
  menu_line 96 '   1  启动 / 继续使用'
  menu_line 96 '   2  更新全部'
  menu_line 96 '   3  安装 / 更新浏览器脚本'
  printf '\n'
  menu_line 37 '   4  版本与连接地址'
  menu_line 37 '   5  查看日志'
  menu_line 33 '   6  停止后台'
  menu_line 37 '   7  手机连接此设备'
  menu_line 37 '   8  修复项目依赖'
  menu_line 37 '   9  更新说明'
  menu_line 37 '  10  安装 Node.js'
  printf '\n'
  menu_line 37 '   0  退出菜单'
  menu_line 90 '  --------------------------------'
  menu_line 37 '  退出菜单后，后台继续运行。'
  menu_line 37 '  更新脚本后，在油猴确认并刷新 AI Studio。'
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
  case "$1" in check|install|start|lan|stop|status|logs|links|ready|ready-lan|script|update) run_action "$@"; exit $?;; *) printf '未知操作。\n'; exit 1;; esac
fi
while true; do
  show_menu "$(menu_version)"
  read -r -p '请选择：' choice || break
  case "$choice" in
    1) page start_page ready;; 2) page update_page;; 3) page script_page;;
    4) page run_action check;; 5) page run_action logs;; 6) page run_action stop;;
    7) page start_page ready-lan;; 8) page run_action install;;
    9) page update_help;; 10) page show_download;; 0) break;;
    *) printf '请输入 0–10。\n';;
  esac
done
