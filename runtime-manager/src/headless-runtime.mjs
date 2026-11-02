import {mkdirSync,readFileSync,writeFileSync,renameSync,existsSync,lstatSync,chmodSync} from 'node:fs';
import {randomBytes,createHash} from 'node:crypto';
import {execFileSync,spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join,resolve} from 'node:path';
import {createConnection} from 'node:net';
import {managerSettings} from './settings.mjs';
import {validateRuntimeConnection} from './connection.mjs';
import {acquireRuntimeLock} from './headless-lock.mjs';

export const runtimeRoot=()=>managerSettings().dataDirectory;
export const runtimeExecutable=root=>join(root,process.platform==='win32'?'aistudio2api.exe':'aistudio2api');
const token=()=>randomBytes(32).toString('hex');
export function privateDirectory(root){
  root=resolve(root);mkdirSync(root,{recursive:true,mode:0o700});
  if(lstatSync(root).isSymbolicLink()||!lstatSync(root).isDirectory())throw Error('运行时目录必须为本机普通目录');
  if(process.platform==='win32'){
    const sid=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command','[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value'],{encoding:'utf8',windowsHide:true}).trim();
    if(!/^S-1-5-\d+(?:-\d+)+$/.test(sid))throw Error('无法确认当前 Windows 用户');
    execFileSync('icacls.exe',[root,'/inheritance:r','/grant:r',`*${sid}:(OI)(CI)F`,'*S-1-5-18:(OI)(CI)F'],{stdio:'pipe',windowsHide:true});
  }else chmodSync(root,0o700);
  return root;
}
export function readRuntimeSettings(root=runtimeRoot()){
  let value;try{value=JSON.parse(readFileSync(join(root,'control.json'),'utf8'));}catch{throw Error('独立运行时尚未配置，请先运行 npm run headless -- install');}
  validateRuntimeConnection(value);
  if(value.version!==1||typeof value.adminPassword!=='string'||!/^[a-f0-9]{64}$/.test(value.adminPassword))throw Error('独立运行时配置无效');
  return value;
}
export function initializeRuntime(root=runtimeRoot(),{port=18767,previewPort=18768}={}){
  privateDirectory(root);
  if(existsSync(join(root,'control.json')))return readRuntimeSettings(root);
  for(const value of [port,previewPort])if(!Number.isInteger(value)||value<1024||value>65535)throw Error('运行时端口无效');
  if(port===previewPort)throw Error('运行时端口不能相同');
  const settings={version:1,url:`http://127.0.0.1:${port}`,apiKey:token(),adminPassword:token(),previewPort};
  const values={AISTUDIO_AUTH_STATES:'auth',LISTEN_ADDR:`127.0.0.1:${port}`,PREVIEW_LISTEN_ADDR:`127.0.0.1:${previewPort}`,PROXY_API_KEY:settings.apiKey,ADMIN_AUTH_ENABLED:'true',ADMIN_USERNAME:'mmdb',ADMIN_PASSWORD:settings.adminPassword,AUTO_START:'true',WAA_BACKEND:'spidermonkey',UPSTREAM_CHANNELS:'playground',ROUTING_STRATEGY:'fill-first',PER_ACCOUNT_CONCURRENCY:'1',WARM_WORKER_LIMIT:'1',MAX_ACTIVE_WORKERS:'1',WARM_STARTUP_CONCURRENCY:'1',REQUEST_BODY_LOG:'false',LOG_FILE:'false',FAKE_STREAM:'false',FIRST_EVENT_HEDGE:'off',CONTINUATION_REWRITE:'false',YOUTUBE_LINKS:'false',REQUEST_TIMEOUT:'30m'};
  writeFileSync(join(root,'.env'),Object.entries(values).map(([key,value])=>`${key}=${value}`).join('\n')+'\n',{mode:0o600,flag:'wx'});
  writeFileSync(join(root,'control.json'),JSON.stringify(settings,null,2)+'\n',{mode:0o600,flag:'wx'});
  return settings;
}

async function jsonResponse(response){
  if(!response.ok){
    const error=Error(`运行时管理操作失败（HTTP ${response.status}），请在本地管理页检查账号状态`);
    // v0.2.18 verifies the cookie's email before reporting account_exists.
    // Retain only that typed identity privately; never surface raw error bodies.
    if(response.status===409){
      try{
        const chunks=[];let size=0;for await(const chunk of response.body??[]){size+=chunk.length;if(size>65536)break;chunks.push(chunk);}
        if(size<=65536){const detail=JSON.parse(Buffer.concat(chunks).toString('utf8'))?.error;
          const match=typeof detail?.message==='string'?detail.message.match(/^账户已存在: ([^\s@/\\:]{1,128}@[a-zA-Z0-9.-]{1,190})$/):null;
          if(detail?.code==='account_exists'&&match)Object.defineProperties(error,{code:{value:'account_exists'},accountId:{value:match[1]}});
        }
      }catch{}
    }else await response.body?.cancel();
    throw error;
  }
  if(response.status===204)return null;
  const chunks=[];let size=0;
  for await(const chunk of response.body??[]){size+=chunk.length;if(size>4*1024*1024)throw Error('运行时管理响应过大');chunks.push(chunk);}
  const text=Buffer.concat(chunks).toString('utf8');
  try{return JSON.parse(text);}catch{throw Error('运行时管理响应无效');}
}
export function runtimeAdmin(settings,{fetchImpl=fetch}={}){
  const {url}=validateRuntimeConnection(settings);let cookie,loggingIn;
  const login=()=>loggingIn??=(async()=>{
    const response=await fetchImpl(url+'/api/auth/login',{method:'POST',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'mmdb',password:settings.adminPassword}),signal:AbortSignal.timeout(5000)});
    await jsonResponse(response);cookie=response.headers.getSetCookie?.().find(value=>value.startsWith('aistudio_admin='))?.split(';')[0];
    if(!cookie)throw Error('运行时未建立管理会话');
  })().finally(()=>{loggingIn=undefined;});
  return async(path,{method='GET',body,timeoutMs=15000}={})=>{
    if(!/^\/api\/[a-zA-Z0-9_/%@.:-]+$/.test(path))throw Error('无效管理路径');
    if(!cookie)await login();
    const send=()=>fetchImpl(url+path,{method,redirect:'error',headers:{Cookie:cookie,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(timeoutMs)});
    let response=await send();
    if(response.status===401){await response.body?.cancel();await login();response=await send();}
    return jsonResponse(response);
  };
}

export async function ensureRuntime(root=runtimeRoot()){
  readRuntimeSettings(root);
  const release=await acquireRuntimeLock(join(root,'runtime-start.lock'),{waitMs:35000});
  try{return await ensureRuntimeUnlocked(root);}finally{release();}
}
async function ensureRuntimeUnlocked(root){
  const settings=readRuntimeSettings(root),admin=runtimeAdmin(settings);
  try{await admin('/api/status');return {settings,admin,started:false};}catch{}
  const port=Number(new URL(settings.url).port);
  const occupied=await new Promise(resolve=>{const socket=createConnection({host:'127.0.0.1',port});const finish=value=>{socket.destroy();resolve(value);};socket.once('connect',()=>finish(true));socket.once('error',()=>finish(false));socket.setTimeout(1000,()=>finish(true));});
  if(occupied)throw Error('独立运行时端口已被占用且管理认证失败；请检查 .headless 配置，未重复启动进程');
  const executable=runtimeExecutable(root);
  if(!existsSync(executable)||lstatSync(executable).isSymbolicLink())throw Error('尚未安装独立运行时，请运行 npm run headless -- install');
  const receipt=JSON.parse(readFileSync(join(root,'installation.json'),'utf8'));
  if(createHash('sha256').update(readFileSync(executable)).digest('hex')!==receipt.executableSHA256)throw Error('运行时执行文件与安装记录不一致，未启动');
  // No inherited configuration may widen the listener or switch WAA backends.
  const configKeys='AISTUDIO_AUTH_STATES LISTEN_ADDR PREVIEW_LISTEN_ADDR PROXY_API_KEY PROXY INIT_TIMEOUT REQUEST_TIMEOUT WARM_WORKER_LIMIT MAX_ACTIVE_WORKERS WARM_STARTUP_CONCURRENCY PER_ACCOUNT_CONCURRENCY ROUTING_STRATEGY UPSTREAM_CHANNELS MODEL_MAPPING MODEL_CHANNELS TEMPORARY_CHAT WAA_BACKEND MEDIA_OUTPUT MEDIA_BASE_URL AUTO_START REQUEST_BODY_LOG LOG_FILE LOG_MAX_TOTAL_MB ADMIN_AUTH_ENABLED ADMIN_USERNAME ADMIN_PASSWORD BUILD_NATIVE_NONSTREAM NONSTREAM_KEEPALIVE FAKE_STREAM YOUTUBE_LINKS SEARCH_MODEL_ALIASES GOOGLE_SEARCH FIRST_EVENT_HEDGE CONTINUATION_REWRITE CONTINUATION_PROMPT'.split(' ');
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!configKeys.includes(key.toUpperCase())));
  try{if(JSON.parse(readFileSync(join(root,'pool.json'),'utf8')).runWanted===false)env.AUTO_START='false';}catch{}
  const child=spawn(executable,['-open-ui=false'],{cwd:root,env,detached:true,stdio:'ignore',windowsHide:true});
  let spawnError;child.once('error',()=>{spawnError=true;});child.unref();
  const deadline=Date.now()+15000;
  while(Date.now()<deadline){
    if(spawnError)throw Error('无法启动独立运行时');
    try{await admin('/api/status');return {settings,admin,started:true,child};}catch{}
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  throw Error('独立运行时未就绪；请检查端口占用及 .headless 目录中的配置');
}
