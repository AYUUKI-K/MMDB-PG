#!/usr/bin/env bash
# MMDB local manager. Requires Bash and Node.js 22+; no cloud credentials.
set -euo pipefail
STATE="$HOME/.local/share/mmdb"
APP="$HOME/mmdb-pg"
DEFAULT_SOURCE='https://raw.githubusercontent.com/AYUUKI-K/MMDB-PG/main/downloads/mmdb-pg-latest.zip'
SELF_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
STAGE=''
LOCKED=0
cleanup() {
  if [ -n "$STAGE" ] && [[ "$STAGE" == "$STATE"/stage.* ]]; then rm -rf -- "$STAGE"; fi
  if [ "$LOCKED" -eq 1 ]; then rmdir -- "$STATE/update.lock"; LOCKED=0; fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
fail() { printf '错误：%s\n' "$*" >&2; exit 1; }
need_runtime() {
  if ! command -v node >/dev/null 2>&1; then
    if command -v pkg >/dev/null 2>&1; then pkg install -y nodejs-lts; else fail '请先安装 Node.js 22 或更新版本。'; fi
  fi
  node -e 'if(Number(process.versions.node.split(".")[0])<22)process.exit(1)' || fail '需要 Node.js 22 或更新版本。'
}
register() {
  mkdir -p -- "$STATE" "$HOME/.local/bin"
  local target="$STATE/mmdb.sh"
  if [ ! "${BASH_SOURCE[0]}" -ef "$target" ]; then cp -- "${BASH_SOURCE[0]}" "$target"; fi
  # Termux's bin is already on PATH; other terminals use ~/.local/bin.
  local bindir="$HOME/.local/bin"
  if [ -n "${PREFIX:-}" ] && [ -d "$PREFIX/bin" ] && [ -w "$PREFIX/bin" ] && [[ "$PREFIX" == *com.termux* ]]; then bindir="$PREFIX/bin"; fi
  if [ -e "$bindir/mmdb" ] && ! grep -q 'MMDB manager launcher' "$bindir/mmdb"; then
    fail "$bindir/mmdb 已存在其他命令，未覆盖。"
  fi
  printf '#!/usr/bin/env bash\n# MMDB manager launcher\nexec bash "$HOME/.local/share/mmdb/mmdb.sh" "$@"\n' > "$bindir/mmdb"
  chmod +x "$bindir/mmdb"
  if [ "$bindir" = "$HOME/.local/bin" ] && [[ ":$PATH:" != *":$bindir:"* ]]; then
    local rc="$HOME/.bashrc"
    if ! grep -qF '# MMDB manager PATH' "$rc" 2>/dev/null; then
      printf '\n# MMDB manager PATH\nexport PATH="$HOME/.local/bin:$PATH"\n' >> "$rc"
    fi
    export PATH="$bindir:$PATH"
    printf '命令已安装；其他终端重新打开后可输入 mmdb。\n'
  fi
}
owned_pid() {
  [ -f "$APP/runtime.pid" ] || return 1
  node --input-type=module - "$APP" <<'JS'
import fs from 'node:fs';
import path from 'node:path';
const root=fs.realpathSync(process.argv[2]);
const pid=Number(fs.readFileSync(path.join(root,'runtime.pid'),'utf8').trim());
if(!Number.isSafeInteger(pid)||pid<=1)process.exit(1);
try{process.kill(pid,0);}catch(e){if(e.code==='ESRCH')process.exit(1);throw e;}
try{
  const args=fs.readFileSync(`/proc/${pid}/cmdline`,'utf8').split('\0').filter(Boolean);
  const cwd=fs.realpathSync(`/proc/${pid}/cwd`);
  const matched=args.some(a=>path.resolve(cwd,a)===path.join(root,'launch.mjs'));
  if(!matched)process.exit(2);
}catch{process.exit(2);}
console.log(pid);
JS
}
stop_service() {
  local taskpid rc=0
  taskpid=$(owned_pid) || rc=$?
  if [ "$rc" -eq 1 ]; then printf '当前目录没有运行中的 MMDB。\n'; return; fi
  [ "$rc" -eq 0 ] || fail '不能确认 PID 属于这份反代；请在原启动窗口按 Ctrl+C，未停止其他进程。'
  kill -TERM "$taskpid"
  for ((i=0;i<50;i++)); do
    if ! kill -0 "$taskpid" 2>/dev/null; then printf 'MMDB 已停止。\n'; return; fi
    sleep 0.1
  done
  fail '进程仍未退出，请先结束生成并在原窗口按 Ctrl+C。'
}
check_port() {
  node --input-type=module - "$APP" <<'JS'
import fs from 'node:fs';
import net from 'node:net';
let port=8765;
try{port=JSON.parse(fs.readFileSync(process.argv[2]+'/config.json','utf8').replace(/^\uFEFF/,'')).port??port;}catch(e){if(e.code!=='ENOENT')throw e;}
if(process.env.MMDB_PORT)port=Number(process.env.MMDB_PORT);
const s=net.createServer();
s.once('error',e=>{console.error(`端口 ${port} 不可用：${e.code}。请先关闭旧目录的反代。`);process.exitCode=1;});
s.listen(port,'127.0.0.1',()=>s.close());
JS
}
find_zip() {
  node --input-type=module - "$SELF_DIR" "$PWD" "$HOME/Downloads" "$HOME/storage/downloads" /sdcard/Download <<'JS'
import fs from 'node:fs';import path from 'node:path';
const rows=[];
for(const dir of process.argv.slice(2)){
  let names;try{names=fs.readdirSync(dir);}catch{continue;}
  for(const name of names){
    const m=/^mmdb-pg-(\d+)\.(\d+)\.(\d+)-universal\.zip$/i.exec(name);if(!m)continue;
    const file=path.join(dir,name);const st=fs.statSync(file);if(!st.isFile())continue;
    rows.push({file,v:m.slice(1).map(Number),mtime:st.mtimeMs});
  }
}
rows.sort((a,b)=>b.v[0]-a.v[0]||b.v[1]-a.v[1]||b.v[2]-a.v[2]||b.mtime-a.mtime);
if(!rows.length)process.exit(1);console.log(rows[0].file);
JS
}
update_app() {
  local source="${1:-}" oldversion='' newversion
  mkdir -- "$STATE/update.lock" 2>/dev/null || fail '已有更新任务，或上次被强制结束留下 update.lock；请确认没有更新任务后移除该空目录。'
  LOCKED=1
  need_runtime
  command -v unzip >/dev/null 2>&1 || {
    if command -v pkg >/dev/null 2>&1; then pkg install -y unzip; else fail '请安装 unzip 后重试。'; fi
  }
  if [ -z "$source" ] && [ -f "$STATE/source-url" ]; then source=$(cat "$STATE/source-url"); fi
  if [ -z "$source" ]; then source="$DEFAULT_SOURCE"; fi
  if [ "$source" = local ]; then
    source=$(find_zip) || fail '未找到安装包。请下载最新版 mmdb-pg-x.x.x-universal.zip 到 Download；Termux 首次使用需先执行 termux-setup-storage 并允许存储访问。'
  fi
  STAGE=$(mktemp -d "$STATE/stage.XXXXXX")
  case "$source" in
    https://*)
      printf '正在下载更新包…\n'
      node --input-type=module - "$source" "$STAGE/package.zip" <<'JS'
import fs from 'node:fs';import {Readable} from 'node:stream';import {pipeline} from 'node:stream/promises';
const r=await fetch(process.argv[2],{signal:AbortSignal.timeout(120000)});
if(!r.ok||!r.body||!r.url.startsWith('https://'))throw Error(`下载失败：HTTP ${r.status}`);
let size=0;async function* bounded(){for await(const chunk of Readable.fromWeb(r.body)){size+=chunk.length;if(size>50*1024*1024)throw Error('更新包超过 50MB');yield chunk;}}
await pipeline(bounded(),fs.createWriteStream(process.argv[3],{flags:'wx'}));
JS
      ;;
    *) [ -f "$source" ] || fail "找不到文件：$source"; cp -- "$source" "$STAGE/package.zip"; printf '使用安装包：%s\n' "$source" ;;
  esac
  # Accept only the standard source package; reject traversal and symlinks before extraction.
  unzip -Z1 "$STAGE/package.zip" > "$STAGE/entries"
  unzip -Z -l "$STAGE/package.zip" > "$STAGE/details"
  node --input-type=module - "$STAGE" <<'JS'
import fs from 'node:fs';const base=process.argv[2];
const names=fs.readFileSync(base+'/entries','utf8').trim().split('\n');
if(names.some(n=>!n.startsWith('mmdb-pg/')||n.includes('\\')||n.split('/').some(p=>p==='.'||p==='..')||/[\x00-\x1f]/.test(n))||new Set(names).size!==names.length)throw Error('ZIP 路径不安全或重复');
if(/^l[rwx-]{9}\s/m.test(fs.readFileSync(base+'/details','utf8')))throw Error('ZIP 不允许包含符号链接');
for(const n of ['package.json','package-lock.json','launch.mjs','start.sh','server.mjs'])if(!names.includes('mmdb-pg/'+n))throw Error('不是完整的 MMDB 启动包');
JS
  unzip -q "$STAGE/package.zip" -d "$STAGE/unpacked"
  newversion=$(node -e 'const p=require(process.argv[1]);if(p.name!=="mmdb-pg"||!/^\d+\.\d+\.\d+$/.test(p.version))process.exit(1);console.log(p.version)' "$STAGE/unpacked/mmdb-pg/package.json")
  if [ -f "$APP/package.json" ]; then
    oldversion=$(node -p 'require(process.argv[1]).version' "$APP/package.json")
    node -e 'const a=process.argv[1].split(".").map(Number),b=process.argv[2].split(".").map(Number);for(let i=0;i<3;i++){if(a[i]>b[i])process.exit(0);if(a[i]<b[i])process.exit(1)}' "$newversion" "$oldversion" || fail '安装包比当前版本旧，已拒绝降级。'
  elif [ -e "$APP" ]; then fail "$APP 已存在且不是已识别的 MMDB 安装目录，未覆盖。"; fi
  printf '准备版本 %s；安装依赖…\n' "$newversion"
  (cd "$STAGE/unpacked/mmdb-pg"; npm ci --omit=dev --no-audit --no-fund; node build.mjs)
  # Stage and build first; stop the verified local process only when replacement is ready.
  stop_service
  check_port || fail '旧服务尚未关闭，未替换文件。'
  for name in config.json lan-config.json st-path.json diagnostics.log; do
    if [ -f "$APP/$name" ]; then cp -- "$APP/$name" "$STAGE/unpacked/mmdb-pg/$name"; fi
  done
  local backup=''
  if [ -d "$APP" ]; then backup=$(mktemp -d "$STATE/backup.XXXXXX"); rmdir "$backup"; mv -- "$APP" "$backup"; fi
  if ! mv -- "$STAGE/unpacked/mmdb-pg" "$APP"; then
    if [ -n "$backup" ]; then mv -- "$backup" "$APP"; fi
    fail '替换失败，已尝试恢复原目录。'
  fi
  if [ -f "$APP/mmdb.sh" ]; then
    cp -- "$APP/mmdb.sh" "$STATE/mmdb.sh.new"
    mv -- "$STATE/mmdb.sh.new" "$STATE/mmdb.sh"
  fi
  printf '版本 %s 已安装，配置已保留。\n' "$newversion"
  [ -z "$backup" ] || printf '上一份安装保留在：%s\n' "$backup"
  printf '输入 mmdb start 启动；油猴检查“MMDB 本地桥”更新后刷新 AI Studio。\n'
  cleanup; STAGE=''
}
start_app() {
  need_runtime
  [ -f "$APP/launch.mjs" ] || update_app
  if owned_pid >/dev/null; then printf 'MMDB 已在运行，无需重复启动。\n'; return; fi
  check_port || fail '请先停止旧后台。'
  cd -- "$APP"
  if [ ! -f node_modules/ws/package.json ]; then npm ci --omit=dev --no-audit --no-fund; fi
  node build.mjs
  printf 'Ctrl+C 停止；以后输入 mmdb 即可打开管理菜单。\n'
  exec node "$APP/launch.mjs" "$@"
}
status_app() {
  if [ -f "$APP/package.json" ]; then node -p '"已安装版本："+require(process.argv[1]).version' "$APP/package.json"; else printf '尚未安装。\n'; fi
  local taskpid
  if taskpid=$(owned_pid); then printf '本目录运行中，PID：%s\n' "$taskpid"; else printf '本目录未运行，或无法确认进程归属。\n'; fi
}
main() {
  mkdir -p -- "$STATE"
  need_runtime
  register
  local action="${1:-menu}"; [ "$#" -eq 0 ] || shift
  case "$action" in
    start) start_app "$@";;
    lan) start_app --lan;;
    stop) stop_service;;
    update|install) update_app "${1:-}";;
    upgrade) update_app "${1:-}"; start_app;;
    status) status_app;;
    source)
      if [ "${1:-}" = clear ]; then rm -f -- "$STATE/source-url"; printf '已恢复官方默认更新地址。\n';
      else [[ "${1:-}" == https://* ]] || fail '请填写可信发布方提供的固定 HTTPS ZIP 地址。'; printf '%s\n' "$1" > "$STATE/source-url"; printf '更新地址已保存。\n'; fi;;
    menu)
      while true; do
        printf '\nMMDB 本地反代\n1) 启动\n2) 局域网启动\n3) 停止\n4) 安装 / 更新\n5) 查看版本与状态\n0) 退出\n'
        local choice; read -r -p '请选择：' choice || return 0
        case "$choice" in 1) start_app;; 2) start_app --lan;; 3) stop_service;; 4) update_app;; 5) status_app;; 0) return;; *) printf '请输入 0–5。\n';; esac
      done;;
    *) fail '用法：mmdb [start|lan|stop|update [local或ZIP路径或HTTPS地址]|status|source 地址|source clear]' ;;
  esac
}
main "$@"
