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
  node tools/portable-manager.mjs "$1"
}
open_url() {
  if command -v termux-open-url >/dev/null 2>&1; then termux-open-url "$1"
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$1" >/dev/null 2>&1
  elif command -v open >/dev/null 2>&1 && [ "$(uname -s)" = Darwin ]; then open "$1"
  else printf '请在浏览器打开：%s\n' "$1"; fi
}
page() { "$@" || printf '\n操作未完成，请查看上面的提示。\n'; read -r -p '按回车返回菜单' _ || true; }
script_page() {
  run_action links || return 1
  printf '请先启动后台。油猴安装确认需要自己点击；安装后刷新 AI Studio 并点击 Meow 激活。\n'
  local answer url
  read -r -p '输入 1 打开脚本安装页，其他键返回：' answer || return 0
  if [ "$answer" = 1 ]; then url=$(node tools/portable-manager.mjs script-url) || return 1; open_url "$url"; fi
}
if [ "$#" -gt 0 ]; then
  case "$1" in check|install|start|lan|stop|status|logs|links) run_action "$1"; exit $?;; *) printf '未知操作。\n'; exit 1;; esac
fi
printf '首次使用请先选择 1 检测，再选择 2 安装项目依赖。\n'
while true; do
  printf '\n========== MMDB 便携管理菜单 ==========\n1) 检测依赖与运行状态\n2) 安装 / 修复项目依赖（npm 官方源）\n3) 启动本机反代\n4) 启动局域网反代\n5) 停止本目录后台\n6) 安装 / 更新浏览器脚本\n7) 查看运行日志\n8) 查看官方依赖安装方法\n0) 退出菜单（后台继续运行）\n'
  read -r -p '请选择：' choice || break
  case "$choice" in
    1) page run_action check;; 2) page run_action install;;
    3) page run_action start;; 4) page run_action lan;;
    5) page run_action stop;; 6) page script_page;;
    7) page run_action logs;; 8) page show_download;; 0) break;;
    *) printf '请输入 0–8。\n';;
  esac
done
