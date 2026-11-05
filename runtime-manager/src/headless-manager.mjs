import http from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {importCredentials,probeRuntime,setAccountEnabled,runtimeInspector,assertRuntimeReady} from './headless-operations.mjs';
import {createBrowserCapture} from './headless-browser-capture.mjs';
import {EXTENSION_ORIGIN} from '../browser-extension/protocol.mjs';
import {diagnosticsHTML} from './diagnostics-page.mjs';
import {chromeEmail} from './chrome-oauth.mjs';

async function requestBody(req){
  if(!/^application\/json(?:;|$)/.test(req.headers['content-type']??''))throw Error('需要 JSON 请求');
  const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>1024*1024)throw Error('凭证文件过大');chunks.push(chunk);}
  let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Error('请求格式无效');}
  if(!body||typeof body!=='object'||Array.isArray(body))throw Error('请求格式无效');return body;
}
export async function createHeadlessManager({admin,settings,pool,integration,supervision,importChrome,capture=createBrowserCapture(),importAccount=(cookies,options)=>importCredentials(admin,cookies,options)}){
  const token=randomBytes(32).toString('hex');
  let job;
  const startJob=fn=>{if(job?.state==='running')throw Error('已有后台操作，请等待完成');const current={id:randomBytes(16).toString('hex'),state:'running'};job=current;void Promise.resolve().then(fn).then(()=>{current.state='succeeded';},error=>{current.state='failed';current.error=error instanceof TypeError?'本地运行时连接失败':error.message;});return {id:current.id};};
  const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
  const server=http.createServer(async(req,res)=>{
    const origin=`http://127.0.0.1:${server.address().port}`;
    res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');
    try{
      const fromExtension=req.url==='/api/browser/import'&&req.headers.origin===EXTENSION_ORIGIN;
      if(req.headers.host!==new URL(origin).host||req.headers.origin&&req.headers.origin!==origin&&!fromExtension){json(res,403,{error:'仅允许本地管理页访问'});return;}
      if(fromExtension){
        res.setHeader('Access-Control-Allow-Origin',EXTENSION_ORIGIN);res.setHeader('Vary','Origin');
        if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Methods','POST');res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');res.writeHead(204);res.end();return;}
      }
      if(req.method==='GET'&&['/','/diagnostics'].includes(req.url)){
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"});res.end(req.url==='/diagnostics'?diagnosticsHTML:managerHTML);return;
      }
      const key=req.headers.authorization?.replace(/^Bearer /,'')??'';
      if(req.method==='POST'&&req.url==='/api/browser/import'){
        const body=await requestBody(req);
        if(typeof body.cookies!=='string'||!body.cookies.trim()||Buffer.byteLength(body.cookies)>900*1024)throw Error('凭证不能为空，且必须小于 900 KiB');
        const ticket=capture.accept(key);
        // A short acknowledgement keeps the browser service worker alive. The
        // authenticated manager page polls the result of upstream validation.
        void (async()=>{
          try{
            const state=await admin('/api/status');if(state.active_requests>0)throw Error('正在生成，请等待完成后重新抓取');
            await importAccount(body.cookies,{authUser:ticket.authUser});capture.finish(key);
          }catch(error){capture.finish(key,error instanceof TypeError?'本地运行时连接失败':error.message||'凭证导入失败');}
        })();
        json(res,202,{ok:true,submitted:true});return;
      }
      if(!/^[a-f0-9]{64}$/.test(key)||!timingSafeEqual(Buffer.from(key),Buffer.from(token))){json(res,401,{error:'管理链接已失效，请从终端重新打开'});return;}
      if(req.method==='GET'&&req.url==='/api/health'){json(res,200,{service:'mmdb-headless-manager',pid:process.pid,browserCapture:1,accountPool:1,standalone:1,diagnostics:1});return;}
      if(req.method==='GET'&&req.url==='/api/control-state'){json(res,200,{integration:integration?await integration.status():null,supervision:supervision?await supervision.status():null,chromeOAuth:!!importChrome});return;}
      if(req.method==='GET'&&req.url==='/api/browser/info'){json(res,200,{...capture.info(),extensionPath:fileURLToPath(new URL('../browser-extension/',import.meta.url))});return;}
      if(req.method==='GET'&&req.url==='/api/state'){
        if(pool){json(res,200,await pool.summary({privateView:true}));return;}
        const [status,result]=await Promise.all([admin('/api/status'),admin('/api/accounts')]);
        json(res,200,{state:status.state,ready:status.ready,accounts:result.accounts.map(row=>({id:row.id,label:row.label,enabled:row.enabled,state:row.state,models:row.models}))});return;
      }
      if(req.method!=='POST'){json(res,404,{error:'接口不存在'});return;}
      if(!/^application\/json(?:;|$)/.test(req.headers['content-type']??'')){json(res,415,{error:'需要 JSON 请求'});return;}
      const body=await requestBody(req);
      if(pool?.diagnostics&&req.url.startsWith('/api/diagnostics/')){
        const audit=pool.diagnostics;
        if(req.url==='/api/diagnostics/query'){json(res,200,audit.query(body));return;}
        if(req.url==='/api/diagnostics/detail'){json(res,200,audit.detail(body.requestId));return;}
        if(req.url==='/api/diagnostics/settings'){json(res,200,audit.configure(body));return;}
        if(req.url==='/api/diagnostics/export'){const data=audit.exportJSONL(body);res.writeHead(200,{'Content-Type':'application/x-ndjson; charset=utf-8','Content-Disposition':'attachment; filename="mmdb-diagnostics.jsonl"','Cache-Control':'no-store'});res.end(data);return;}
      }
      if(req.url==='/api/job'){if(!job||body.id!==job.id)throw Error('后台操作不存在');json(res,200,job);return;}
      if(req.url==='/api/chrome/import'){
        if(!importChrome)throw Error('Chrome OAuth 导入目前只支持 Windows x64');
        const email=chromeEmail(body.email);json(res,202,startJob(()=>importChrome(email)));return;
      }
      if(req.url==='/api/integration'&&integration){if(!['start','stop'].includes(body.action))throw Error('控制操作无效');json(res,202,startJob(()=>body.action==='start'?integration.start(body.lan===true):integration.stop()));return;}
      if(req.url==='/api/supervision'&&supervision){json(res,202,startJob(()=>supervision.update(body)));return;}
      if(req.url==='/api/pool'&&pool){json(res,200,await pool.configure(body));return;}
      if(req.url==='/api/backend'&&pool){json(res,202,startJob(()=>pool.backend(body.backend)));return;}
      if(req.url==='/api/login'&&pool){json(res,202,startJob(()=>pool.login(body.id)));return;}
      if(req.url==='/api/verify-account'&&pool){json(res,202,startJob(()=>pool.verify(body.id)));return;}
      if(req.url==='/api/recover'&&pool){json(res,202,startJob(()=>pool.recoverOnce({force:true})));return;}
      if(req.url==='/api/browser/pair'){json(res,200,capture.pair(origin));return;}
      if(req.url==='/api/browser/ticket'){json(res,200,capture.issue(origin,body.authUser));return;}
      if(req.url==='/api/browser/result'){json(res,200,capture.result(body.ticket));return;}
      if(req.url==='/api/import'){await importAccount(body.cookies,{authUser:body.authUser});json(res,200,{ok:true});return;}
      if(req.url==='/api/start'){if(pool)await pool.control(true);else await admin('/api/control/start',{method:'POST',timeoutMs:180000});json(res,200,{ok:true});return;}
      if(req.url==='/api/stop'&&pool){await pool.control(false);json(res,200,{ok:true});return;}
      if(req.url==='/api/probe'){
        if(pool){const logicalId='probe-'+randomBytes(16).toString('hex'),started=Date.now(),context={requestId:logicalId,model:body.model,source:'probe'};let lease;pool.diagnostics?.record('request-start',context);
          try{lease=await pool.lease({model:body.model,logicalId,stage:'probe'});pool.diagnostics?.record('request-sent',{...context,accountId:lease.accountId,stage:'probe'});const result=await probeRuntime(settings,body.model);lease.verified?.();pool.diagnostics?.record('request-finish',{...context,status:'finished',elapsedMs:Date.now()-started});json(res,200,result);}
          catch(error){await lease?.failure(error);pool.diagnostics?.record('request-finish',{...context,status:'failed',httpStatus:error.status,code:error.code??'probe_failed',elapsedMs:Date.now()-started});throw error;}
          finally{lease?.release();await pool.finish(logicalId);}}
        else{assertRuntimeReady(await runtimeInspector(admin)());json(res,200,await probeRuntime(settings,body.model));}return;
      }
      if(req.url==='/api/account'){if(pool)await pool.membership(body.id,body.enabled);else await setAccountEnabled(admin,body.id,body.enabled);json(res,200,{ok:true});return;}
      json(res,404,{error:'接口不存在'});
    }catch(error){json(res,400,{error:error instanceof TypeError?'本地运行时连接失败':error.message||'操作失败'});}
  });
  server.requestTimeout=200000;server.headersTimeout=15000;
  server.listen(0,'127.0.0.1');await once(server,'listening');
  return {server,url:`http://127.0.0.1:${server.address().port}/#${token}`,close:()=>{server.closeAllConnections();server.close();}};
}

export const managerHTML=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>喵喵电波 · 独立运行时</title>
<style>
:root{color-scheme:dark;--panel:#202123;--inset:#17181a;--ink:#eeeae5;--secondary:#b2ada6;--muted:#87837e;--line:#ffffff16;--accent:#e5bf8e;--bad:#f0a59e;--good:#a8c9a0;--radius:12px;font:14px/1.6 'Segoe UI','Microsoft YaHei',sans-serif;background:var(--inset);color:var(--ink)}*{box-sizing:border-box}body{margin:0}main{max-width:920px;margin:48px auto;padding:0 24px}header{display:flex;gap:16px;align-items:center;margin-bottom:32px}.mark{color:var(--accent);font-size:28px}h1{font-size:24px;line-height:1.25;margin:0 0 4px}h2{font-size:18px;margin:0 0 12px}p{margin:8px 0;color:var(--secondary)}.caption{font-size:12px;color:var(--muted)}.route{margin-left:auto;font-size:12px;border:1px solid var(--line);padding:8px 12px;border-radius:24px}.layout{display:grid;grid-template-columns:1.2fr 1fr;gap:24px}section{background:var(--panel);padding:24px;border-radius:var(--radius);border:1px solid var(--line)}label{display:block;margin:16px 0 6px;font-weight:500}input,textarea,button{font:inherit;border:1px solid var(--line);border-radius:6px;min-height:44px}input,textarea{padding:10px 12px;background:var(--inset);color:var(--ink);width:100%}textarea{resize:vertical;min-height:120px;font-family:Consolas,monospace;font-size:12px}input[type=file]{font-size:12px}button{padding:10px 16px;background:transparent;color:var(--ink);cursor:pointer;font-weight:600}button.primary{background:var(--accent);color:var(--inset);border-color:var(--accent)}button:hover{filter:brightness(1.12)}button:active{transform:scale(.98)}button:disabled{opacity:.4;cursor:wait}button:focus-visible,input:focus-visible,textarea:focus-visible{outline:2px solid var(--accent);outline-offset:3px}.row{display:flex;gap:12px;align-items:center;margin-top:16px}.row>*{flex:1}#feedback{min-height:28px;color:var(--accent);overflow-wrap:anywhere}#feedback[data-error=true]{color:var(--bad)}ul{list-style:none;padding:0;margin:16px 0}li{padding:12px 0;border-bottom:1px solid var(--line);overflow-wrap:anywhere}li small{display:block;color:var(--secondary)}code{font-size:12px;color:var(--accent)}footer{margin:24px 0;color:var(--muted);font-size:12px}.status{color:var(--good);font-variant-numeric:tabular-nums}@media(max-width:720px){main{margin:24px auto;padding:0 16px}.layout{grid-template-columns:1fr}header{align-items:flex-start}.route{display:none}section{padding:20px}h1{font-size:22px}input,textarea{font-size:16px}}@media(prefers-reduced-motion:reduce){button:active{transform:none}}
details{margin-top:20px}summary{cursor:pointer;min-height:32px}#captureStatus{min-height:24px;margin-top:16px}#captureStatus[data-error=true]{color:var(--bad)}#extensionPath{display:block;overflow-wrap:anywhere;margin:8px 0}#extensionHelp ol{padding-left:20px;color:var(--secondary)}select{width:100%;min-height:44px;padding:10px;background:var(--inset);color:var(--ink);border:1px solid var(--line);border-radius:10px;font:inherit}.settings{margin-top:24px}.check{display:flex;align-items:center;gap:12px}.check input{width:20px;min-height:20px;margin:0}[hidden]{display:none!important}.account-actions{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}
.auth-capability{margin-top:8px}.auth-checked{font-variant-numeric:tabular-nums;color:var(--muted)}.auth-failure,[data-attention=true],.status[data-ready=false]{color:var(--bad)}
</style><main><header><span class="mark" aria-hidden="true">◡</span><div><h1>喵喵电波</h1><div class="caption">独立后台控制台</div></div><span class="route">本机凭证 → 后台生成</span></header><nav aria-label="控制台导航" style="display:flex;gap:24px;margin-bottom:24px"><a href="/" aria-current="page" style="color:var(--ink)">后台与账号</a><a href="/diagnostics" style="color:var(--accent)">调用与诊断</a></nav>
<section id="control" style="margin-bottom:24px"><h2>后台与无人值守</h2><p id="controlStatus">正在检查后台…</p><div class="account-actions" id="pgControls" hidden><button id="startPG" class="primary">启动 MMDB 反代</button><button id="stopPG">停止 MMDB 反代</button></div><div id="guardControls" hidden><label class="check"><input id="guardEnabled" type="checkbox">进程守护：后台意外退出后自动恢复</label><label class="check"><input id="loginStartup" type="checkbox">Windows 登录后自动启动（默认关闭）</label><button id="saveGuard">保存无人值守设置</button><p class="caption">手动停止 MMDB 会暂停守护；再次启动恢复守护。关闭网页和命令窗口不影响后台。电脑休眠或关机期间无法服务。</p></div></section>
<div class="layout"><section><h2>添加账号凭证</h2><p>从当前浏览器读取 AI Studio 登录凭证，直接验证并保存到本机。</p>
<details id="chromeImport"><summary>从本机 Chrome 导入（含 OAuth 续签）</summary><p id="chromeSupport" class="caption">正在检测支持情况…</p><form id="chromeForm" hidden><label for="chromeEmail">Chrome 中已登录的 Google 邮箱</label><input id="chromeEmail" type="email" required maxlength="320" autocomplete="email" placeholder="name@gmail.com"><div class="row"><button id="chromeSubmit" type="submit">获取 OAuth 并导入</button></div><p class="caption">无需浏览器扩展。只读取此邮箱的凭据，向 Google 验证后保存到本机；已有账号原位更新。通常需在 Chrome 配置文件中登录，仅登录网页不一定有可用 OAuth。凭据可能绑定此 Windows 设备，保存后也可能被撤销。</p></form></details>
<label for="slot">Google 账号序号</label><input id="slot" type="number" min="0" max="99" value="0" required><p class="caption">多个 Google 登录账号时，填写 AI Studio 地址 /u/N/ 中的 N；默认是 0。</p>
<div class="row"><button class="primary" id="capture" disabled>一键抓取并导入</button><button id="connect" disabled>连接浏览器扩展</button></div><p id="captureStatus" class="caption" role="status" aria-live="polite">正在检测浏览器扩展…</p><p class="caption">首次需要安装并连接扩展。之后无需打开开发者工具，也不需要发送测试消息。请在已登录目标账号的浏览器配置文件中操作。</p>
<details id="extensionHelp"><summary>首次安装扩展（Chrome / Edge）</summary><ol><li>打开 <code>chrome://extensions</code> 或 <code>edge://extensions</code>，开启“开发者模式”。</li><li>点击“加载已解压的扩展程序”，选择这个目录：<code id="extensionPath">正在读取…</code><button id="copyPath">复制扩展目录</button></li><li>安装后刷新本页，点击“连接浏览器扩展”，在扩展确认窗口中连接此本机服务。</li></ol><button id="detect">重新检测扩展</button><p class="caption">扩展只在你点击抓取后读取 AI Studio 使用的 Google Cookie；不保存 Cookie 副本，也不传给其他网站。无痕模式不支持。</p></details>
<details><summary>手动导入（备用）</summary><form id="importForm"><label for="file">选择本机文件</label><input id="file" type="file" accept=".json,.txt"><label for="cookies">或粘贴 Cookie 内容</label><textarea id="cookies" autocomplete="off" spellcheck="false" placeholder="支持 Cookie JSON、请求头或 storage-state 文件"></textarea><div class="row"><button type="submit">验证并保存凭证</button></div></form></details></section>
<section><h2>账号池与后台生成</h2><p>运行状态：<strong id="state" class="status">正在读取…</strong></p><p id="poolStatus" class="caption">正在读取账号池…</p><p class="caption">可启用多个账号。默认优先用完当前账号，额度耗尽或登录失效时切换；已开始输出的请求不会重放。</p><ul id="accounts"><li>正在读取账号…</li></ul><div class="row"><button id="refresh">刷新状态</button><button id="start">启动生成服务</button><button id="stop">停止生成服务</button></div><label for="model">测试模型</label><input id="model" list="models" placeholder="输入账号可用的模型 ID" autocomplete="off"><datalist id="models"></datalist><div class="row"><button id="probe">发送一次固定测试</button></div><p class="caption">测试会消耗一次真实调用，使用账号池中的一个可用账号。额度冷却到期后自动恢复；登录失效时，有续签材料的账号会在空闲时有限尝试恢复；也可点击“验证登录”。连续失败需重新登录或导入凭证。保存材料不保证续签成功。</p></section></div>
<section class="settings"><h2>轮换与无人值守</h2><div class="layout"><div><label for="strategy">账号使用策略</label><select id="strategy"><option value="fill-first">优先用完当前账号</option><option value="round-robin">每个新请求轮询账号</option></select><label class="check" for="autoRecover"><input id="autoRecover" type="checkbox" checked>自动恢复运行时与可续签账号</label><p class="caption">冷却、失效状态会保存。手动停止会保持停止，不会被自动拉起。上方可设置进程守护和 Windows 登录自启动。</p><button id="savePool">保存策略</button><button id="recover">立即检查恢复</button></div><div><label for="backend">会话验证方式</label><select id="backend"><option value="spidermonkey">轻量后端（无需常驻浏览器）</option><option value="camoufox">Camoufox 后台浏览器</option></select><p id="camoufoxStatus" class="caption">正在检查 Camoufox…</p><button id="saveBackend">应用验证方式</button><button id="login">用 Camoufox 添加账号</button><p class="caption">首次使用时由运行时准备 Camoufox。登录会打开隔离窗口，请自行登录，成功后保存凭证并关闭窗口。后端切换仅在空闲时进行，失败会恢复原设置。</p></div></div></section><p id="feedback" role="status" aria-live="polite"></p>
<details><summary>最近运行记录（不含凭证与对话）</summary><ul id="activity"><li>暂无记录</li></ul></details><details><summary>如何取得当前账号的 Cookie</summary><ol><li>在自己已登录的 AI Studio 页面打开开发者工具的 Network / 网络标签页，发送一次简短测试。</li><li>选中生成请求，在 Headers / 标头的 Request Headers / 请求标头中复制完整的 Cookie 值。</li><li>回到此页粘贴并导入。不要使用 document.cookie，它缺少 HttpOnly Cookie；不要把凭证发到聊天里。</li></ol></details>
<footer>凭证以明文保存在本机受限数据目录的 auth 子目录，验证和生成时由运行时发往 Google。Cookie 导入不保证永久续期；验证仍失败时需重新登录或导入。关闭此页不会停止生成服务。</footer></main>
<script>
const initial=location.hash.slice(1);if(initial){sessionStorage.setItem('mmdb-manager',initial);history.replaceState(null,'',location.pathname)}const token=sessionStorage.getItem('mmdb-manager');
const el=id=>document.getElementById(id);const feedback=(text,error=false)=>{el('feedback').textContent=text;el('feedback').dataset.error=String(error)};
async function api(path,body){const res=await fetch(path,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});const value=await res.json();if(!res.ok)throw Error(value.error||'操作失败');return value}
let browserInfo,preferencesDirty=false,backendDirty=false,guardDirty=false,refreshing=false,chromeImporting=false;
el('guardEnabled').onchange=el('loginStartup').onchange=()=>guardDirty=true;
el('strategy').onchange=el('autoRecover').onchange=()=>preferencesDirty=true;el('backend').onchange=()=>backendDirty=true;
function accountSlot(){if(!el('slot').reportValidity())throw Error('请填写 0 到 99 的整数账号序号');return el('slot').valueAsNumber;}
const captureSay=(message,error=false)=>{el('captureStatus').textContent=message;el('captureStatus').dataset.error=String(error);};
function extension(message){return new Promise((resolve,reject)=>{
  if(!globalThis.chrome?.runtime?.sendMessage){reject(Error('未检测到凭证助手，请按下方说明安装扩展后重新检测'));return;}
  chrome.runtime.sendMessage(browserInfo.extensionId,message,result=>{const error=chrome.runtime.lastError;if(error){reject(Error('未检测到凭证助手，请确认已在当前浏览器安装并启用扩展'));return;}if(!result?.ok){reject(Error(result?.error||'扩展未响应'));return;}resolve(result);});
});}
async function detectCapture(){
  el('capture').disabled=true;el('connect').disabled=true;
  browserInfo=await api('/api/browser/info');el('extensionPath').textContent=browserInfo.extensionPath;
  try{const status=await extension({type:'status',installationId:browserInfo.installationId});el('capture').disabled=!status.paired;el('connect').disabled=status.paired;el('connect').textContent=status.paired?'扩展已连接':'连接浏览器扩展';captureSay(status.paired?'已连接 · 可一键抓取当前浏览器凭证':'扩展已安装 · 首次请连接此管理服务');if(status.paired)el('extensionHelp').open=false;return status;}
  catch(error){el('extensionHelp').open=true;captureSay(error.message);return null;}
}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
el('detect').onclick=()=>work(el('detect'),detectCapture);
el('copyPath').onclick=()=>work(el('copyPath'),async()=>{await navigator.clipboard.writeText(browserInfo.extensionPath);captureSay('扩展目录已复制，在“加载已解压的扩展程序”中粘贴此路径。');});
el('connect').onclick=()=>work(el('connect'),async()=>{
  const pair=await api('/api/browser/pair',{});await extension({type:'pair',pair});captureSay('请在扩展弹出的确认窗口中连接此管理服务。');
  const deadline=Date.now()+180000;
  while(Date.now()<deadline){await pause(1000);const status=await extension({type:'status',installationId:browserInfo.installationId});if(status.paired){await detectCapture();return;}if(!status.pending){captureSay('连接已取消或超时，可重新点击连接。');return;}}
  captureSay('连接确认超时，请重新点击连接。');
}).finally(()=>{if(el('connect').textContent==='扩展已连接')el('connect').disabled=true;});
el('capture').onclick=()=>work(el('capture'),async()=>{
  try{
    const ticket=await api('/api/browser/ticket',{authUser:accountSlot()});captureSay('正在读取当前浏览器的登录凭证…');
    await extension({type:'capture',ticket});captureSay('凭证已提交到本机，正在验证账号…');
    const deadline=Date.now()+190000;
    while(Date.now()<deadline){const result=await api('/api/browser/result',{ticket:ticket.token});if(result.state==='succeeded'){await refresh();captureSay('凭证已验证并保存。请在右侧检查账号启用状态。');return;}if(result.state==='failed')throw Error(result.error);await pause(800);}
    throw Error('账号验证仍未完成，请刷新账号状态后再操作');
  }catch(error){captureSay(error.message,true);throw error;}
});
async function refresh(){
  const control=await api('/api/control-state');el('pgControls').hidden=!control.integration;el('guardControls').hidden=!control.supervision;
  el('chromeForm').hidden=!control.chromeOAuth;el('chromeSupport').textContent=control.chromeOAuth?'支持本机 Chrome OAuth 导入 · 可直接添加账号，也可为已有账号补充续签材料':'此设备不支持 Chrome OAuth 导入（需要 Windows x64）。可继续通过扩展导入 Cookie。';
  const pg=control.integration,guard=control.supervision;
  el('controlStatus').textContent=(pg?'MMDB '+(pg.running?(pg.unavailable?'进程存在，状态暂不可读':pg.ready?'运行中 · 已就绪':'运行中 · 等待运行时'):'已停止')+' · 进行中 '+pg.pending+' 个请求':'独立管理服务正在运行')+(guard?' · 守护'+(guard.enabled?(guard.wanted?'已开启':'已暂停'):'已关闭'):'');
  if(guard&&!guardDirty){el('guardEnabled').checked=guard.enabled;el('loginStartup').checked=guard.loginStartup;}
  const result=await api('/api/state');el('state').textContent=({RUNNING:'运行中',STOPPED:'已停止',LAUNCHING:'启动中',OFFLINE:'运行时离线'})[result.state]||result.state;
  el('chromeSubmit').disabled=chromeImporting||result.activeRequests>0;
  el('state').dataset.ready=String(result.ready===true);
  el('poolStatus').textContent='池中启用 '+(result.enabledAccounts??0)+' 个 · 可用 '+(result.readyAccounts??0)+' 个 · 需要登录 '+(result.authRequiredAccounts??0)+' 个 · 冷却 '+(result.coolingAccounts??0)+' 个'+(result.runWanted===false?' · 已手动停止':'');
  const recovery=result.recovery;
  if(recovery?.reason==='recovery-limited')el('poolStatus').textContent+=' · 自动恢复已达本小时上限，请检查账号或网络';
  else if(recovery?.reason==='not-ready')el('poolStatus').textContent+=' · 正在观察未就绪状态，空闲时尝试恢复';
  if(recovery?.lastFailure)el('poolStatus').textContent+=' · 上次运行时恢复未成功';
  if(!preferencesDirty){el('strategy').value=result.strategy||'fill-first';el('autoRecover').checked=result.autoRecover!==false;}if(result.backend&&!backendDirty)el('backend').value=result.backend;
  el('camoufoxStatus').textContent=result.camoufox?.download?'正在下载 Camoufox：'+Math.round((result.camoufox.download.received||0)/1048576)+' MiB':result.camoufox?.ready?'Camoufox 已就绪':'首次使用将准备 Camoufox，可能需要几分钟。';
  const labels={'strategy-saved':'轮换策略已保存','account-enabled':'账号已加入池','account-disabled':'账号已停用','account-switch':'切换到其他可用账号','login-required':'账号需要重新登录','model-cooldown':'模型进入冷却','service-stopped':'生成服务手动停止','service-started':'生成服务已启动','camoufox-enabled':'已切换到 Camoufox','lightweight-enabled':'已切换到轻量后端','backend-restored':'切换失败，已恢复原后端'};
  el('activity').replaceChildren(...(result.activity||[]).slice().reverse().map(item=>{const row=document.createElement('li');row.textContent=new Date(item.at).toLocaleString()+' · '+(labels[item.type]||'状态更新')+(item.model?' · '+item.model:'');return row;}));
  if(!Array.isArray(result.accounts))return;el('accounts').replaceChildren();
  for(const account of result.accounts){
    const row=document.createElement('li'),detail=document.createElement('small'),toggle=document.createElement('button');row.textContent=account.label&&account.label!==account.id?account.label+' · '+account.id:account.id;
    detail.textContent=(({ready:'可用',standby:'可用 · 待命',busy:'使用中',disabled:'已停用',auth_required:'需要重新登录',cooldown:'额度冷却中',unavailable:'暂不可用'})[account.state]||account.state)+(account.selected?' · 当前运行账号':'')+(account.diagnosticRef?' · '+account.diagnosticRef:'');
    if(account.cooldowns?.length)detail.textContent+=' · '+account.cooldowns.map(c=>c.model+' 冷却至 '+new Date(c.until).toLocaleString()).join('；');
    detail.dataset.attention=String(account.state==='auth_required');
    const auth=account.auth??{},renewal=document.createElement('small'),checked=document.createElement('small');renewal.className='auth-capability';checked.className='auth-checked';
    renewal.textContent=({saved_oauth:'续签：已保存 OAuth 材料，失效时自动尝试',chrome_source:'续签：依赖本机 Chrome 登录，失效时自动尝试',cookie_only:'续签：仅保存 Cookie，本机 Chrome 恢复能力未检测',unknown:'续签：暂无法确认凭证类型'})[auth.capability]||'续签：暂无法确认凭证类型';
    checked.textContent='最近验证：'+(auth.lastVerifiedAt?new Date(auth.lastVerifiedAt).toLocaleString('zh-CN',{hour12:false}):'尚无记录')+(auth.verifiedBy?' · '+({generation:'生成请求',credentials:'凭证导入 / 登录','runtime-check':'账号验证'}[auth.verifiedBy]||''): '');
    const failure=document.createElement('small');failure.className='auth-failure';
    if(auth.lastFailure)failure.textContent='最近验证未通过：'+({ 'authentication-required':'Google 要求重新登录','access-denied':'访问被拒绝','runtime-unavailable':'运行时或网络不可用','verification-failed':'验证未完成，请稍后重试'}[auth.lastFailure]||'请重新验证')+(auth.failures>=3?' · 自动验证已暂停，请手动验证或重新导入':auth.nextCheckAt&&auth.automatic?' · 下次尝试 '+new Date(auth.nextCheckAt).toLocaleString('zh-CN',{hour12:false}):'');
    toggle.textContent=account.enabled?'停用':'启用';toggle.setAttribute('aria-label',(account.enabled?'停用 ':'启用 ')+account.id);
    toggle.onclick=()=>work(toggle,async()=>{await api('/api/account',{id:account.id,enabled:!account.enabled});await refresh();feedback('账号池成员已更新')});
    const relogin=document.createElement('button');relogin.textContent='Camoufox 重新登录';relogin.onclick=()=>work(relogin,async()=>{await job('/api/login',{id:account.id},'请在 Camoufox 隔离窗口中完成登录。');await refresh();feedback('账号登录已更新')});
    const verify=document.createElement('button');verify.textContent='验证登录';verify.setAttribute('aria-label','验证登录 '+account.id);verify.disabled=result.activeRequests>0;verify.onclick=()=>work(verify,async()=>{try{await job('/api/verify-account',{id:account.id},'正在验证账号；具备续签条件时由运行时尝试恢复，不发送聊天。');feedback('账号验证通过')}finally{await refresh();}});
    const actions=document.createElement('div');actions.className='account-actions';actions.append(verify,toggle,relogin);row.append(detail,renewal,checked,failure,actions);el('accounts').append(row);
    if(control.chromeOAuth){const oauth=document.createElement('button');oauth.textContent=auth.capability==='saved_oauth'?'更新 Chrome OAuth':'获取 Chrome OAuth';oauth.setAttribute('aria-label',oauth.textContent+' '+account.id);oauth.disabled=chromeImporting||result.activeRequests>0;oauth.onclick=()=>work(oauth,()=>importChrome(account.id));actions.append(oauth);}
  }
  if(!result.accounts.length){const row=document.createElement('li');row.textContent='还没有账号，请先导入凭证。';el('accounts').append(row)}
  const models=[...new Set(result.accounts.filter(account=>account.enabled).flatMap(account=>account.models||[]).filter(name=>!/(image|veo|tts|lyria|live|build)/i.test(name)).map(name=>name.replace(/^models\\//,'')))];
  el('models').replaceChildren(...models.map(model=>{const option=document.createElement('option');option.value=model;return option}));if(models.length&&!el('model').value)el('model').value=models.find(name=>/^gemini-.*flash/.test(name))||models.find(name=>/^gemini-/.test(name))||models[0];
}
async function work(button,fn){button.disabled=true;feedback('正在处理…');try{await fn();if(el('feedback').textContent==='正在处理…')feedback('')}catch(error){feedback(error.message,true)}finally{button.disabled=false}}
async function job(path,body,message){const start=await api(path,body);feedback(message);const deadline=Date.now()+16*60*1000;while(Date.now()<deadline){await pause(1200);const result=await api('/api/job',{id:start.id});if(result.state==='succeeded')return;if(result.state==='failed')throw Error(result.error);await refresh();}throw Error('操作仍未完成，请刷新状态检查');}
async function importChrome(email){
  if(chromeImporting)throw Error('Chrome 导入正在进行，请等待完成');
  chromeImporting=true;
  try{await job('/api/chrome/import',{email},'正在从本机 Chrome 获取 OAuth 并验证账号，可能需要几分钟…');feedback('OAuth 已验证并保存；账号失效时将自动尝试续签。请检查账号启用状态。');}
  finally{chromeImporting=false;await refresh();}
}
el('chromeForm').onsubmit=event=>{event.preventDefault();work(event.submitter,()=>importChrome(el('chromeEmail').value.trim()));};
el('startPG').onclick=()=>work(el('startPG'),async()=>{await job('/api/integration',{action:'start'},'正在启动 MMDB…');await refresh();feedback('MMDB 反代已启动')});
el('stopPG').onclick=()=>work(el('stopPG'),async()=>{await job('/api/integration',{action:'stop'},'正在停止 MMDB…');await refresh();feedback('MMDB 已停止，进程守护已暂停')});
el('saveGuard').onclick=()=>work(el('saveGuard'),async()=>{await job('/api/supervision',{enabled:el('guardEnabled').checked,loginStartup:el('loginStartup').checked},'正在保存无人值守设置…');guardDirty=false;await refresh();feedback('无人值守设置已保存')});
el('savePool').onclick=()=>work(el('savePool'),async()=>{await api('/api/pool',{strategy:el('strategy').value,autoRecover:el('autoRecover').checked});preferencesDirty=false;await refresh();feedback('轮换与恢复策略已保存')});
el('saveBackend').onclick=()=>work(el('saveBackend'),async()=>{await job('/api/backend',{backend:el('backend').value},'正在切换验证方式；首次准备 Camoufox 可能需要几分钟。');backendDirty=false;await refresh();feedback('会话验证方式已更新')});
el('login').onclick=()=>work(el('login'),async()=>{await job('/api/login',{},'请在 Camoufox 隔离窗口中完成登录，成功后凭证保存到本机。');await refresh();feedback('账号已保存，请在账号池中启用')});
el('recover').onclick=()=>work(el('recover'),async()=>{await job('/api/recover',{},'正在检查运行时…');await refresh();feedback('恢复检查已完成')});
el('stop').onclick=()=>work(el('stop'),async()=>{await api('/api/stop',{});await refresh();feedback('生成服务已手动停止；自动恢复不会重新启动它')});
setInterval(async()=>{if(document.hidden||refreshing)return;refreshing=true;try{await refresh();}catch{}finally{refreshing=false;}},10000);
el('file').onchange=()=>{el('cookies').value=''};el('cookies').oninput=()=>{el('file').value=''};
el('importForm').onsubmit=event=>{event.preventDefault();work(event.submitter,async()=>{const authUser=accountSlot(),file=el('file').files[0];if(file&&file.size>900*1024)throw Error('文件必须小于 900 KiB');const cookies=file?await file.text():el('cookies').value;await api('/api/import',{cookies,authUser});el('cookies').value='';el('file').value='';await refresh();feedback('凭证已验证并保存。可以启动生成服务。')})};
el('refresh').onclick=()=>work(el('refresh'),async()=>{await refresh();feedback('状态已更新')});el('start').onclick=()=>work(el('start'),async()=>{await api('/api/start',{});await refresh();feedback('已提交启动，请稍后刷新状态')});el('probe').onclick=()=>work(el('probe'),async()=>{await api('/api/probe',{model:el('model').value.trim()});feedback('直连测试成功 · MMDB_HEADLESS_OK')});refresh().catch(error=>feedback(error.message,true));detectCapture().catch(error=>captureSay(error.message,true));
</script></html>`;
