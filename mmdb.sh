#!/usr/bin/env bash
# MMDB local manager. Requires Bash and Node.js 22+; no cloud credentials.
set -euo pipefail
# The extracted app uses its own portable menu; the fixed updater has no tools folder.
MMDB_ENTRY_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
if [ -f "$MMDB_ENTRY_DIR/tools/portable-manager.mjs" ]; then
  exec bash "$MMDB_ENTRY_DIR/scripts/portable.sh" "$@"
fi
STATE="$HOME/.local/share/mmdb"
APP="$HOME/mmdb-pg"
DEFAULT_SOURCE='source'
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
    if command -v pkg >/dev/null 2>&1; then pkg install -y nodejs-lts npm; else fail '请先安装 Node.js 22 或更新版本。'; fi
  fi
  node -e 'if(Number(process.versions.node.split(".")[0])<22)process.exit(1)' || fail '需要 Node.js 22 或更新版本。'
}
need_npm() {
  if ! command -v npm >/dev/null 2>&1; then
    if command -v pkg >/dev/null 2>&1; then pkg install -y npm; else fail '未检测到 npm，请安装 Node.js 的 npm 组件后重试。'; fi
  fi
  npm --version >/dev/null || fail 'npm 无法运行，请修复 npm 后重试。'
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
  check_idle || fail '仍有请求运行或无法确认后台状态，请结束生成后再停止或更新程序。'
  [ "$(owned_pid)" = "$taskpid" ] || fail '进程状态已变化，请重新查看状态。'
  kill -TERM "$taskpid"
  for ((i=0;i<50;i++)); do
    if ! kill -0 "$taskpid" 2>/dev/null; then printf 'MMDB 已停止。\n'; return; fi
    sleep 0.1
  done
  fail '进程仍未退出，请先结束生成并在原窗口按 Ctrl+C。'
}
check_idle() {
  node --input-type=module - "$APP" <<'JS'
import fs from 'node:fs';
const config=JSON.parse(fs.readFileSync(process.argv[2]+'/config.json','utf8').replace(/^\uFEFF/,''));
const response=await fetch(`http://127.0.0.1:${process.env.MMDB_PORT||config.port||8765}/v1/status`,{headers:{Authorization:`Bearer ${process.env.MMDB_API_KEY||config.apiKey||'mmdb'}`},signal:AbortSignal.timeout(5000)});
if(!response.ok)process.exit(1);
const state=await response.json();if(state.pending!==0||!Array.isArray(state.active))process.exit(1);
JS
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
  local source="${1:-}" oldversion='' newversion source_revision='' branch_source=0 prefix='mmdb-pg/' next
  [ ! -e "$APP/.git" ] || fail '安装目录是 Git 工作区，不能自动覆盖；请使用 Git 工作流更新。'
  mkdir -- "$STATE/update.lock" 2>/dev/null || fail '已有更新任务，或上次被强制结束留下 update.lock；请确认没有更新任务后移除该空目录。'
  LOCKED=1
  need_runtime
  need_npm
  command -v unzip >/dev/null 2>&1 || {
    if command -v pkg >/dev/null 2>&1; then pkg install -y unzip; else fail '请安装 unzip 后重试。'; fi
  }
  if [ -z "$source" ] && [ -f "$STATE/source-url" ]; then source=$(cat "$STATE/source-url"); fi
  if [ -z "$source" ]; then source="$DEFAULT_SOURCE"; fi
  if [ "$source" = local ]; then
    source=$(find_zip) || fail '未找到安装包。请下载最新版 mmdb-pg-x.x.x-universal.zip 到 Download；Termux 首次使用需先执行 termux-setup-storage 并允许存储访问。'
  fi
  STAGE=$(mktemp -d "$STATE/stage.XXXXXX")
  if [ "$source" = source ]; then
    source='https://codeload.github.com/AYUUKI-K/MMDB-PG/zip/refs/heads/main'
    branch_source=1
  fi
  case "$source" in
    https://*)
      printf '正在下载更新包…\n'
      node --input-type=module - "$source" "$STAGE/package.zip" "$branch_source" <<'JS'
import fs from 'node:fs';import {Readable} from 'node:stream';import {pipeline} from 'node:stream/promises';import {createHash} from 'node:crypto';
const url=new URL(process.argv[2]),sumURL=new URL(process.argv[2]);sumURL.pathname+='.sha256';
const stamp=String(Date.now());url.searchParams.set('_mmdb',stamp);sumURL.searchParams.set('_mmdb',stamp);
const r=await fetch(url,{headers:{'User-Agent':'MMDB-Updater','Cache-Control':'no-cache'},signal:AbortSignal.timeout(120000)});
if(!r.ok||!r.body||!r.url.startsWith('https://'))throw Error(`下载失败：HTTP ${r.status}`);
let size=0;async function* bounded(){for await(const chunk of Readable.fromWeb(r.body)){size+=chunk.length;if(size>50*1024*1024)throw Error('更新包超过 50MB');yield chunk;}}
await pipeline(bounded(),fs.createWriteStream(process.argv[3],{flags:'wx'}));
if(process.argv[4]!=='1'){
const sums=await fetch(sumURL,{signal:AbortSignal.timeout(30000)});
if(!sums.ok||!sums.url.startsWith('https://'))throw Error('更新包缺少 SHA-256 校验信息。');
const expected=(await sums.text()).trim().match(/^([0-9a-f]{64})\s+/i)?.[1];
if(!expected||createHash('sha256').update(fs.readFileSync(process.argv[3])).digest('hex')!==expected.toLowerCase())throw Error('更新包 SHA-256 校验失败，请稍后重试；原程序未更改。');
}
JS
      ;;
    *) [ -f "$source" ] || fail "找不到文件：$source"; cp -- "$source" "$STAGE/package.zip"; printf '使用安装包：%s\n' "$source" ;;
  esac
  # Accept only the standard source package; reject traversal and symlinks before extraction.
  unzip -Z1 "$STAGE/package.zip" > "$STAGE/entries"
  unzip -Z -l "$STAGE/package.zip" > "$STAGE/details"
  local first_entry; read -r first_entry < "$STAGE/entries"
  if [ "$branch_source" -eq 1 ] || [[ "$first_entry" == MMDB-PG-main/* ]]; then
    prefix='MMDB-PG-main/'
    source_revision=$(node --input-type=module - "$STAGE/package.zip" <<'JS'
import fs from 'node:fs';
if(fs.statSync(process.argv[2]).size>50*1024*1024)throw Error('源码包超过 50MB');
const bytes=fs.readFileSync(process.argv[2]);let revision='';
for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--){
  if(bytes.readUInt32LE(i)===0x06054b50&&i+22+bytes.readUInt16LE(i+20)===bytes.length){revision=bytes.subarray(i+22).toString('utf8');break;}
}
if(!/^[0-9a-f]{40}$/.test(revision))throw Error('源码包缺少有效提交标识，原程序未更改。');
console.log(revision);
JS
    )
  elif [[ "$first_entry" =~ ^MMDB-PG-([0-9a-f]{40})/ ]]; then
    source_revision="${BASH_REMATCH[1]}"; prefix="MMDB-PG-$source_revision/"
  fi
  node --input-type=module - "$STAGE" "$prefix" <<'JS'
import fs from 'node:fs';const base=process.argv[2];
const names=fs.readFileSync(base+'/entries','utf8').trim().split('\n');
if(names.some(n=>!n.startsWith(process.argv[3])||n.includes('\\')||n.split('/').some(p=>p==='.'||p==='..')||/[\x00-\x1f]/.test(n))||new Set(names).size!==names.length)throw Error('ZIP 路径不安全或重复');
if(/^l[rwx-]{9}\s/m.test(fs.readFileSync(base+'/details','utf8')))throw Error('ZIP 不允许包含符号链接');
for(const n of ['package.json','package-lock.json','launch.mjs','start.sh','server.mjs'])if(!names.includes(process.argv[3]+n))throw Error('不是完整的 MMDB 启动包');
JS
  if [ -n "$source_revision" ]; then
    printf '源码提交：%.12s\n' "$source_revision"
    if node --input-type=module - "$APP" "$source_revision" <<'JS'
import fs from 'node:fs';
try{
  const read=name=>JSON.parse(fs.readFileSync(process.argv[2]+'/'+name,'utf8').replace(/^\uFEFF/,''));
  const receipt=read('.source-revision.json'),manifest=read('package.json');
  process.exit(receipt.repository==='AYUUKI-K/MMDB-PG'&&receipt.commit===process.argv[3]&&receipt.version===manifest.version?0:1);
}catch{process.exit(1);}
JS
    then printf '已是最新源码，继续准备浏览器脚本。\n'; cleanup; STAGE=''; return; fi
  fi
  unzip -q "$STAGE/package.zip" -d "$STAGE/unpacked"
  next="$STAGE/unpacked/${prefix%/}"
  if [ -n "$source_revision" ]; then
    node --input-type=module - "$next" <<'JS'
import fs from 'node:fs';import path from 'node:path';
const root=fs.realpathSync(process.argv[2]);
const keep=new Set('src scripts tools tests docs licenses dist package.json package-lock.json README.md LICENSE .gitignore .gitattributes build.mjs launch.mjs server.mjs lan-gateway.mjs lan-config.example.json MMDB.cmd MMDB.ps1 mmdb.sh mmdb-manager.ps1 Start.cmd Start.ps1 Start-LAN.cmd Start-LAN.ps1 Stop.cmd Stop.ps1 Stop-LAN.cmd Stop-LAN.ps1 start.sh start-lan.sh'.split(' '));
for(const name of fs.readdirSync(root))if(!keep.has(name)){
  const target=path.resolve(root,name);if(path.dirname(target)!==root)throw Error('源码过滤路径无效');
  fs.rmSync(target,{recursive:true,force:true});
}
JS
  fi
  newversion=$(node -e 'const p=require(process.argv[1]);if(p.name!=="mmdb-pg"||!/^\d+\.\d+\.\d+$/.test(p.version))process.exit(1);console.log(p.version)' "$next/package.json")
  if [ -f "$APP/package.json" ]; then
    oldversion=$(node -p 'require(process.argv[1]).version' "$APP/package.json")
    node -e 'const a=process.argv[1].split(".").map(Number),b=process.argv[2].split(".").map(Number);for(let i=0;i<3;i++){if(a[i]>b[i])process.exit(0);if(a[i]<b[i])process.exit(1)}' "$newversion" "$oldversion" || fail '安装包比当前版本旧，已拒绝降级。'
  elif [ -e "$APP" ]; then fail "$APP 已存在且不是已识别的 MMDB 安装目录，未覆盖。"; fi
  printf '准备版本 %s；安装依赖…\n' "$newversion"
  (cd "$next"; npm ci --omit=dev --omit=optional --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org/; node build.mjs)
  node --input-type=module - "$next" "$source_revision" "$newversion" <<'JS'
import fs from 'node:fs';
fs.writeFileSync(process.argv[2]+'/.source-revision.json',JSON.stringify({repository:'AYUUKI-K/MMDB-PG',branch:'main',commit:process.argv[3]||null,version:process.argv[4]})+'\n');
JS
  # Stage and build first; stop the verified local process only when replacement is ready.
  stop_service
  check_port || fail '旧服务尚未关闭，未替换文件。'
  for name in config.json lan-config.json st-path.json diagnostics.log; do
    if [ -f "$APP/$name" ]; then cp -- "$APP/$name" "$next/$name"; fi
  done
  local backup=''
  if [ -d "$APP" ]; then backup=$(mktemp -d "$STATE/backup.XXXXXX"); rmdir "$backup"; mv -- "$APP" "$backup"; fi
  if ! mv -- "$next" "$APP"; then
    if [ -n "$backup" ]; then mv -- "$backup" "$APP"; fi
    fail '替换失败，已尝试恢复原目录。'
  fi
  if [ -f "$APP/mmdb.sh" ]; then
    cp -- "$APP/mmdb.sh" "$STATE/mmdb.sh.new"
    mv -- "$STATE/mmdb.sh.new" "$STATE/mmdb.sh"
  fi
  printf '版本 %s 已安装，配置已保留。\n' "$newversion"
  [ -z "$backup" ] || printf '上一份安装保留在：%s\n' "$backup"
  cleanup; STAGE=''
}
start_app() {
  need_runtime
  [ -f "$APP/launch.mjs" ] || update_app
  if owned_pid >/dev/null; then printf 'MMDB 已在运行，无需重复启动。\n'; return; fi
  check_port || fail '请先停止旧后台。'
  cd -- "$APP"
  if [ ! -f node_modules/ws/package.json ]; then need_npm; npm ci --omit=dev --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org/; fi
  node build.mjs
  printf 'Ctrl+C 停止；以后输入 mmdb 即可打开管理菜单。\n'
  exec node "$APP/launch.mjs" "$@"
}
status_app() {
  if [ -f "$APP/package.json" ]; then node -p '"文件版本："+require(process.argv[1]).version' "$APP/package.json"; else printf '尚未安装。\n'; fi
  local taskpid mode=local
  if taskpid=$(owned_pid); then printf '本目录运行中，PID：%s\n' "$taskpid"; else printf '本目录未运行，或无法确认进程归属。\n'; fi
  if [ -f "$STATE/start-mode" ]; then mode=$(cat "$STATE/start-mode"); fi
  printf '安装目录：%s\n浏览器脚本：主菜单选 3（自动准备后台）。\n' "$APP"
  if [ -f "$APP/package.json" ]; then
    node --input-type=module - "$APP" "$mode" "$taskpid" <<'JS'
import fs from 'node:fs';
let config={};try{config=JSON.parse(fs.readFileSync(process.argv[2]+'/config.json','utf8').replace(/^\uFEFF/,''));}catch(e){if(e.code!=='ENOENT')throw e;}
const port=process.env.MMDB_PORT||config.port||8765;
console.log(`酒馆本机地址：http://127.0.0.1:${port}/v1\n密钥：见安装目录 config.json。`);
if(process.argv[4]){
  console.log('运行模式：'+(process.argv[3]==='lan'?'局域网（手机可连接）':'仅本机'));
  if(process.argv[3]==='lan')try{
    const lan=JSON.parse(fs.readFileSync(process.argv[2]+'/lan-config.json','utf8').replace(/^\uFEFF/,''));
    console.log(`手机酒馆地址：http://${lan.address}:${lan.port}/v1`);
  }catch{console.log('局域网地址暂不可读，请查看 lan-config.json 和运行日志。');}
}
try{
  const response=await fetch(`http://127.0.0.1:${port}/v1/status`,{headers:{Authorization:`Bearer ${process.env.MMDB_API_KEY||config.apiKey||'mmdb'}`},signal:AbortSignal.timeout(3000)});
  if(!response.ok)throw Error();const state=await response.json();
  console.log(`后台版本：${state.version}；活动请求：${state.pending}\n浏览器脚本：${state.executorOnline?'已连接，版本 '+(state.executorVersion??'未知'):'未连接；已安装脚本时切回 AI Studio 点击 Meow，首次才需选 3。'}`);
  if(state.page?.state==='unresponsive')console.log('AI Studio 页面暂未响应，请切回页面检查后台保活。');
}catch{console.log('后台未就绪，可选择 1 启动；已有后台时请检查日志。');}
JS
  fi
}
start_background() {
  if owned_pid >/dev/null; then
    local running_mode=local
    if [ -f "$STATE/start-mode" ]; then running_mode=$(cat "$STATE/start-mode"); fi
    [ "$running_mode" = "${1:-local}" ] || fail '后台已按其他模式运行；请结束生成并在主菜单选 6 停止，再切换模式。'
    printf '反代已经运行，无需重复启动。\n'; return
  fi
  [ -f "$APP/launch.mjs" ] || update_app
  check_port || fail '请先关闭旧目录的反代。'
  printf '正在启动反代，请稍候…\n'
  local mode="${1:-local}" taskpid
  printf '%s\n' "$mode" > "$STATE/start-mode"
  if [ "$mode" = lan ]; then
    nohup bash "$STATE/mmdb.sh" lan --background > "$STATE/service.log" 2>&1 < /dev/null &
  else
    nohup bash "$STATE/mmdb.sh" start --background > "$STATE/service.log" 2>&1 < /dev/null &
  fi
  taskpid=$!
  # Wait for launch.mjs to bind the port and write its own PID, not just a shell PID.
  for ((i=0;i<80;i++)); do
    if [ -f "$APP/runtime.pid" ] && [ "$(cat "$APP/runtime.pid")" = "$taskpid" ] && kill -0 "$taskpid" 2>/dev/null; then
      printf '\n反代已在后台启动。\n返回菜单不会停止服务；保持 Termux 和 AI Studio 运行。\n'
      tail -n 12 "$STATE/service.log"
      return
    fi
    if ! kill -0 "$taskpid" 2>/dev/null; then tail -n 30 "$STATE/service.log"; fail '启动失败，以上是启动日志。'; fi
    sleep 0.25
  done
  printf '启动仍在准备，请到“查看日志”确认结果，不要重复启动。\n'
}
update_background() {
  if owned_pid >/dev/null; then check_idle || fail '当前仍有生成请求或无法确认后台状态，请结束生成后再更新全部。'; fi
  printf '[1/3] 下载并准备新版 MMDB…\n'

  local mode=local
  if [ -f "$STATE/start-mode" ]; then mode=$(cat "$STATE/start-mode"); fi
  update_app "${1:-}"
  printf '[2/3] 启动更新后的后台…\n'
  start_background "$mode"
  printf '程序已更新并启动。\n'
}
continue_background() {
  # Opening the script page must never switch a running service's mode.
  if owned_pid >/dev/null; then printf '后台已运行，继续使用当前模式。\n'; return; fi
  local mode=local
  if [ -f "$STATE/start-mode" ]; then mode=$(cat "$STATE/start-mode"); fi
  start_background "$mode"
}
prepare_script() {
  continue_background
  (cd -- "$APP" && node build.mjs)
  script_url=$(node --input-type=module - "$APP" <<'JS'
import fs from 'node:fs';
const root=process.argv[2],read=name=>JSON.parse(fs.readFileSync(root+'/'+name,'utf8').replace(/^\uFEFF/,''));
const config=read('config.json'),version=read('package.json').version;
const base=`http://127.0.0.1:${process.env.MMDB_PORT||config.port||8765}`;
const statusResponse=await fetch(base+'/v1/status',{headers:{Authorization:`Bearer ${process.env.MMDB_API_KEY||config.apiKey||'mmdb'}`},signal:AbortSignal.timeout(5000)});
if(!statusResponse.ok)throw Error('无法验证后台状态，请检查端口与密钥。');
const state=await statusResponse.json();if(!Number.isInteger(state.pending)||!Array.isArray(state.active))throw Error('后台状态格式无效。');
const url=base+`/local-pg.user.js?v=${version}`;
const response=await fetch(url,{signal:AbortSignal.timeout(5000),redirect:'error'}),source=await response.text();
if(!response.ok||!source.startsWith('// ==UserScript==')||source.match(/^\/\/ @version\s+(\S+)/m)?.[1]!==version||/__LOCAL_PG_(PORT|KEY)__/.test(source))throw Error('浏览器脚本尚未就绪，请查看日志；未打开安装页。');
if(state.version&&state.version!==version)console.error('后台版本与文件不同，结束生成后请停止并重新启动后台。');
console.log(url);
JS
  )
  printf '浏览器脚本已就绪：%s\n请在已启用油猴的浏览器中确认安装 / 更新。\n首次使用：打开 https://aistudio.google.com/prompts/new_chat，登录并点击 Meow 激活。\n后续更新：刷新已打开的 AI Studio；需要激活时点击 Meow。\n' "$script_url"
}
script_page() {
  prepare_script
  open_url "$script_url"
  printf '如未打开安装页，请使用装有油猴的浏览器手动访问上面的地址。\n'
}
open_url() {
  if command -v termux-open-url >/dev/null 2>&1; then termux-open-url "$1" || printf '请手动打开：%s\n' "$1"
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$1" >/dev/null 2>&1 || printf '请手动打开：%s\n' "$1"
  elif command -v open >/dev/null 2>&1 && [ "$(uname -s)" = Darwin ]; then open "$1" || printf '请手动打开：%s\n' "$1"
  else printf '请手动打开：%s\n' "$1"; fi
}
start_page() {
  if [ "${1:-continue}" = continue ]; then continue_background; else start_background "$1"; fi
  local target
  target=$(node --input-type=module - "$APP" <<'JS'
import fs from 'node:fs';
import {setTimeout as pause} from 'node:timers/promises';
const config=JSON.parse(fs.readFileSync(process.argv[2]+'/config.json','utf8').replace(/^\uFEFF/,''));
for(let i=0;i<7;i++){
const response=await fetch(`http://127.0.0.1:${process.env.MMDB_PORT||config.port||8765}/v1/status`,{headers:{Authorization:`Bearer ${process.env.MMDB_API_KEY||config.apiKey||'mmdb'}`},signal:AbortSignal.timeout(5000)});
if(!response.ok)throw Error('后台未就绪，请查看日志。');
const state=await response.json();if(!Number.isInteger(state.pending)||!Array.isArray(state.active))throw Error('后台状态无效。');
if(state.executorOnline){console.log('connected');process.exit(0);}
if(i<6)await pause(500);
}
console.log('open');
JS
  )
  if [ "$target" = connected ]; then printf '已有 AI Studio 页面连接，继续使用现有页面，不重复打开。\n'; return; fi
  [ "$target" = open ] || fail '无法确认浏览器打开目标。'
  printf '后台已就绪，正在打开 AI Studio Playground；登录后点击 Meow 激活。\n'
  open_url 'https://aistudio.google.com/prompts/new_chat'
}
back_page() {
  read -r -p '按回车返回菜单' _ || true
}
action_page() {
  # Run actions with errexit in an independent process context. An action failure
  # must not close the menu or suppress the updater's fail-fast checks.
  set +e
  (set -e; trap cleanup EXIT; trap 'exit 130' INT; "$@")
  local result=$?
  set -e
  if [ "$result" -ne 0 ]; then printf '\n操作未完成，可查看上面的原因后重试。\n'; fi
  back_page
}
logs_page() {
  local key
  while true; do
    printf '\n—— 最近启动 / 运行日志 ——\n'
    if [ -f "$STATE/service.log" ]; then tail -n 60 "$STATE/service.log"; else printf '还没有管理器启动日志。\n'; fi
    if [ -f "$APP/diagnostics.log" ]; then
      node --input-type=module - "$APP/diagnostics.log" <<'JS'
import fs from 'node:fs';
try {
  const rows=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
  console.log('\n—— 最近请求（不显示正文和密钥）——');
  for(const r of rows.slice(0,6)){
    console.log([r.startedAt,r.model,r.status,`${Math.round((r.elapsedMs??0)/1000)}秒`,r.errorCode??''].join(' | '));
    if(r.pageVisibility!==undefined)console.log(`  页面=${r.pageVisibility} 在线=${r.browserOnline??'未知'} 定时器最长间隔=${r.maxTimerGapMs??'未知'}ms 鉴权刷新=${r.authRefreshed??'未知'}`);
  }
} catch { console.log('诊断日志暂时不可读，可稍后刷新。'); }
JS
    fi
    printf '\n1) 刷新日志\n0) 返回\n'
    read -r -p '请选择：' key || return 0
    case "$key" in 0) return;; 1) :;; *) printf '请输入 1 或 0。\n';; esac
  done
}
update_all_page() {
  update_background
  printf '[3/3] 打开对应版本的浏览器脚本安装页…\n'
  script_page
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
  menu_line 96 '  首次 3   日常 1   更新 2'
  printf '\n'
  menu_line 96 '   1  启动 / 继续使用'
  menu_line 96 '   2  更新全部'
  menu_line 96 '   3  安装 / 更新浏览器脚本'
  printf '\n'
  menu_line 37 '   4  刷新状态 / 连接地址'
  menu_line 37 '   5  查看日志'
  menu_line 33 '   6  停止后台'
  menu_line 37 '   7  手机连接此设备'
  menu_line 37 '   8  切回本机模式'
  printf '\n'
  menu_line 37 '   0  退出菜单'
  menu_line 90 '  --------------------------------'
  menu_line 37 '  退出菜单后，后台继续运行。'
  menu_line 37 '  更新脚本后，在油猴确认并刷新 AI Studio。'
}
show_runtime() {
  local state line color
  if [ ! -f "$APP/tools/portable-manager.mjs" ]; then
    if [ -f "$APP/package.json" ]; then menu_line 33 '  旧版安装 · 选择 4 检查状态，选择 2 更新'
    else menu_line 33 '  反代 尚未安装 · 选择 3 开始'; fi
    return
  fi
  state=$(node "$APP/tools/portable-manager.mjs" menu-status --text 2>/dev/null) || state='状态暂不可读 · 选择 4 查看详情'
  while IFS= read -r line; do
    color=92; case "$line" in *未启动*|*未就绪*|*未连接*|*未响应*|*待检测*|*不可读*|*选\ 3\ 确认*|*后台仍为*|*个请求*) color=33;; esac
    menu_line "$color" "  $line"
  done <<< "$state"
  menu_line 90 '  返回菜单时刷新状态，选 4 可重新检查。'
}

main() {
  mkdir -p -- "$STATE"
  need_runtime
  register
  local action="${1:-menu}"; [ "$#" -eq 0 ] || shift
  case "$action" in
    start) start_app "$@";;
    lan) start_app --lan "$@";;
    stop) stop_service;;
    update|install) update_app "${1:-}";;
    upgrade) update_app "${1:-}"; start_app;;
    status) status_app;;
    script) prepare_script;;
    update-all) update_background "${1:-}"; prepare_script;;
    source)
      if [ "${1:-}" = clear ]; then rm -f -- "$STATE/source-url"; printf '已恢复官方默认更新地址。\n';
      else [[ "${1:-}" == https://* ]] || fail '请填写可信发布方提供的固定 HTTPS ZIP 地址。'; printf '%s\n' "$1" > "$STATE/source-url"; printf '更新地址已保存。\n'; fi;;
    menu)
      trap ':' INT
      while true; do
        local menu_version='尚未安装'
        if [ -f "$APP/package.json" ]; then menu_version=$(node -p '"v"+JSON.parse(require("fs").readFileSync(process.argv[1],"utf8").replace(/^\uFEFF/,"")).version' "$APP/package.json") || menu_version='版本未知'; fi
        show_menu "$menu_version"
        local choice; read -r -p '请选择：' choice || return 0
        choice=${choice%$'\r'}
        case "$choice" in 1) action_page start_page;; 2) action_page update_all_page;; 3) action_page script_page;; 4) action_page status_app;; 5) logs_page;; 6) action_page stop_service;; 7) action_page start_page lan;; 8) action_page start_page local;; 0) return;; *) printf '请输入 0–8。\n';; esac
      done;;
    *) fail '用法：mmdb [start|lan|stop|script|update-all [ZIP路径]|update [local或ZIP路径或HTTPS地址]|status|source 地址|source clear]' ;;
  esac
}
main "$@"
