// Portable installation management. No Google requests or system-wide installs.
import {existsSync,readFileSync,writeFileSync,openSync,closeSync,unlinkSync,realpathSync,renameSync} from 'node:fs';
import {resolve,join,dirname,basename,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,spawnSync,execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {createServer} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {randomUUID} from 'node:crypto';
import {dataDirectoryFor} from './manager-paths.mjs';
import {restoreLegacyComponents} from './legacy-components.mjs';
restoreLegacyComponents();

export const NODE_DOWNLOAD='https://nodejs.org/en/download';
// Small allowlisted summary, safe to show before every menu without leaking config.
export function menuStatus(info) {
  const backend=!info.running?'stopped':info.statusError?'unavailable':'running';
  const executionBackend=info.executionBackend==='headless'?'headless':'browser',headless=executionBackend==='headless';
  const browser=headless?'unused':backend!=='running'?'unknown':info.executorOnline!==true?'disconnected':info.page?.state==='unresponsive'?'unresponsive':'connected';
  const notices=[];
  if(backend==='running'&&Number.isSafeInteger(info.pending)&&info.pending>0)notices.push(`进行中 ${info.pending} 个请求 · 停止或更新前请先结束生成`);
  const version=value=>/^\d+\.\d+\.\d+$/.test(value??'');
  const executorVersion=typeof info.executorVersion==='string'?info.executorVersion.replace(/^mmdb-/,''):info.executorVersion;
  if(backend==='running'&&version(info.version)&&version(info.serviceVersion)&&info.serviceVersion!==info.version)notices.push(`后台仍为 v${info.serviceVersion} · 结束生成后选 15 一键重启`);
  if(!headless&&browser!=='unknown'&&info.executorOnline===true&&version(info.version)&&version(executorVersion)&&executorVersion!==info.version)notices.push(`浏览器脚本 v${executorVersion} · 选 3 确认更新，再刷新 AI Studio`);
  if(info.running&&info.configuredBackend&&info.configuredBackend!==executionBackend)notices.push('后端配置已改变 · 结束生成后选 15 一键重启生效');
  if(typeof info.openPlaygroundOnStart==='boolean')notices.push(`启动后打开 PG ${info.openPlaygroundOnStart?'开启':'关闭'} · 模式选 12 · 自动打开选 13`);
  let detail;
  if(headless){
    const runtime=info.runtime;
    const state=!runtime?'待检测':!runtime.online?'未连接 · 自动恢复检查中，或选 11 检查':runtime.enabledAccounts===0?'没有启用账号 · 选 11 导入或启用':runtime.accountState==='auth_required'||runtime.enabledAccounts>0&&runtime.authRequiredAccounts===runtime.enabledAccounts?'凭证已失效 · 选 11 重新登录':runtime.accountState==='cooldown'?'额度冷却中 · 选 11 查看':runtime.ready?'已就绪':runtime.state==='STOPPED'?'生成服务已停止 · 选 11 启动':runtime.state==='LAUNCHING'?'启动中 · 稍后选 4 刷新':'暂不可用 · 选 11 检查';
    const count=Number.isSafeInteger(runtime?.enabledAccounts)?` · 已启用 ${runtime.enabledAccounts} 个账号`:'';
    detail=`执行后端 独立运行时 · ${state}${count}\n账号池 ${runtime?.strategy==='round-robin'?'逐请求轮询':'优先用完当前账号'} · 账号管理选 11 · 无人值守选 14`;
  }else detail=`浏览器脚本 ${browser==='unknown'?'待检测':browser==='disconnected'?'未连接 · 打开 AI Studio 并点击 Meow':browser==='unresponsive'?'页面暂未响应 · 请切回 AI Studio':'已连接'}`;
  return {backend,browser,executionBackend,ready:backend==='running'&&(headless?info.runtime?.ready===true&&info.executorOnline===true:browser==='connected'),mode:info.running?(info.mode==='lan'?'lan':'local'):'none',
    text:[`反代 ${backend==='stopped'?'未启动':backend==='unavailable'?'进程存在 · 服务暂未就绪':'运行中'} · ${info.running?(info.mode==='lan'?'局域网':'本机'):'选择 1 启动'}`,detail,...notices].join('\n')};
}
const defaultRoot=fileURLToPath(new URL('../',import.meta.url));
const readJSON=file=>JSON.parse(readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const samePath=(a,b,platform=process.platform)=>platform==='win32'?resolve(a).toLowerCase()===resolve(b).toLowerCase():resolve(a)===resolve(b);
export async function changeBackend(mode,{status,prepare,read,write,stop,start}){
  if(!['browser','headless'].includes(mode))throw Error('执行模式无效');
  const state=await status();
  if(state.statusError)throw Error('当前服务状态不可读，未切换模式');
  if(state.pending>0)throw Error('当前有生成或验证任务，请结束后再切换模式');
  if(state.executionBackend===mode&&state.configuredBackend===mode)return false;
  await prepare(mode);
  const previous=read(),config=JSON.parse(previous.replace(/^\uFEFF/,''));
  if(mode==='headless'){
    if(state.executionBackend==='browser')config.browserNativeContinuation=config.nativeContinuation===true;
    config.nativeContinuation=false;
  }else if(typeof config.browserNativeContinuation==='boolean')config.nativeContinuation=config.browserNativeContinuation;
  config.executionBackend=mode;
  if(state.running)await stop(); // Rechecks pending work and exact process ownership.
  try{write(JSON.stringify(config,null,2)+'\n');if(state.running)await start(state.mode==='lan');}
  catch(error){
    // start() cleans up its failed child; restore the exact prior configuration.
    write(previous);
    if(state.running)try{await start(state.mode==='lan');}catch{throw Error('切换失败，已恢复原配置；原后台未能重启，请选 5 查看日志');}
    throw Error('切换失败，已恢复原配置和原运行模式');
  }
  return true;
}
export function commandBelongsToRoot(record,root,platform=process.platform) {
  if(!record||!['node','node.exe'].includes(basename(record.executable??'').toLowerCase()))return false;
  const args=record.args??Array.from((record.commandLine??'').matchAll(/"([^"]*)"|([^\s"]+)/g),match=>match[1]??match[2]);
  // Only the script argument can establish ownership, never an arbitrary later flag.
  if(args.length<2||args[1].startsWith('-'))return false;
  if(!record.cwd&&!isAbsolute(args[1]))return false;
  return ['launch.mjs','server.mjs'].some(name=>samePath(resolve(record.cwd??root,args[1]),join(root,name),platform));
}
export function inspectProcess(pid,platform=process.platform) {
  if(!Number.isSafeInteger(pid)||pid<=1)throw Error('运行记录无效，未操作任何进程。');
  try{process.kill(pid,0);}catch(error){if(error.code==='ESRCH')return null;throw Error('无法确认进程状态，未操作任何进程。');}
  if(platform==='win32'){
    const command=`$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}' | Select-Object Name,CommandLine | ConvertTo-Json -Compress`;
    const raw=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{encoding:'utf8',windowsHide:true,timeout:10000}).trim();
    if(!raw)return null;const row=JSON.parse(raw);return {executable:row.Name,commandLine:row.CommandLine};
  }
  if(existsSync(`/proc/${pid}/cmdline`))return {executable:realpathSync(`/proc/${pid}/exe`),cwd:realpathSync(`/proc/${pid}/cwd`),args:readFileSync(`/proc/${pid}/cmdline`,'utf8').split('\0').filter(Boolean)};
  if(platform==='darwin')return {executable:execFileSync('ps',['-p',String(pid),'-o','comm='],{encoding:'utf8'}).trim(),commandLine:execFileSync('ps',['-p',String(pid),'-o','args='],{encoding:'utf8'}).trim()};
  throw Error('当前平台无法确认进程归属，请在原启动窗口停止。');
}
export function dependencyState(root=defaultRoot) {
  try {
    const expected=readJSON(join(root,'package-lock.json')).packages['node_modules/ws'].version;
    const installed=readJSON(join(root,'node_modules/ws/package.json')).version;
    const found=createRequire(join(root,'package.json')).resolve('ws');
    if(!samePath(dirname(found),join(root,'node_modules/ws'))||expected!==installed)return {ready:false,expected,installed};
    createRequire(join(root,'package.json'))('ws');
    return {ready:true,expected,installed};
  }catch{return {ready:false};}
}
export function createManager({root=defaultRoot,env=process.env,inspect=inspectProcess,signal=(pid)=>process.kill(pid,'SIGTERM'),fetchStatus,fetchRuntimeStatus}={}) {
  root=realpathSync(root);
  const path=name=>join(root,name),lockPath=path('.manager.lock');
  const manifest=()=>{const data=readJSON(path('package.json'));if(data.name!=='mmdb-pg')throw Error('当前目录不是 MMDB 便携包。');return data;};
  const settings=()=>{
    const data=existsSync(path('config.json'))?readJSON(path('config.json')):{};
    const port=Number(env.MMDB_PORT||data.port||8765),apiKey=env.MMDB_API_KEY||data.apiKey||'mmdb';
    if(!Number.isInteger(port)||port<1||port>65535||typeof apiKey!=='string'||apiKey.length<4)throw Error('config.json 的端口或密钥配置无效。');
    const executionBackend=data.executionBackend??'browser';
    if(!['browser','headless'].includes(executionBackend))throw Error('config.json 的执行后端配置无效。');
    const openPlaygroundOnStart=typeof data.openPlaygroundOnStart==='boolean'?data.openPlaygroundOnStart:executionBackend==='browser';
    return {port,apiKey,executionBackend,openPlaygroundOnStart};
  };
  function writeConfig(value){const file=path('config.json'),temp=file+'.manager-tmp';writeFileSync(temp,value,{mode:0o600});renameSync(temp,file);}
  const owned=()=>{
    if(!existsSync(path('runtime.pid')))return null;
    const pid=Number(readFileSync(path('runtime.pid'),'utf8').trim()),record=inspect(pid);
    if(!record)return null;
    if(!commandBelongsToRoot(record,root))throw Error('运行记录指向其他程序或目录，未操作该进程。请先检查 runtime.pid。');
    return {pid,record};
  };
  const statusRequest=async()=>{
    if(fetchStatus)return fetchStatus();
    const {port,apiKey}=settings();
    const response=await fetch(`http://127.0.0.1:${port}/v1/status`,{headers:{Authorization:`Bearer ${apiKey}`},signal:AbortSignal.timeout(3000)});
    if(!response.ok)throw Error('无法验证后台状态；请检查端口与密钥，或在原启动窗口停止。');
    const data=await response.json();if(!Number.isInteger(data.pending)||!Array.isArray(data.active))throw Error('端口上的服务状态不是预期格式。');return data;
  };
  async function locked(action) {
    let fd;
    try{fd=openSync(lockPath,'wx');writeFileSync(fd,String(process.pid));}
    catch(error){if(error.code==='EEXIST')throw Error('已有菜单操作，或上次异常退出留下 .manager.lock。请确认其他菜单已关闭后移除该文件。');throw error;}
    try{return await action();}finally{closeSync(fd);unlinkSync(lockPath);}
  }
  function runNode(script,args=[]) {
    const result=spawnSync(process.execPath,[path(script),...args],{cwd:root,env,stdio:'inherit',windowsHide:true});
    if(result.error||result.status!==0)throw Error(`${script} 执行失败，请查看上面的提示。`);
  }
  async function installUnlocked() {
    manifest();if(owned())throw Error('后台正在运行，请先在菜单中停止，再安装或修复依赖。');
    if(!dependencyState(root).ready){
      console.log('正在从 npm 官方源安装锁定版本的项目依赖；不执行依赖安装脚本。');
      const npmArgs=['ci','--omit=dev','--omit=optional','--ignore-scripts','--no-audit','--no-fund','--registry=https://registry.npmjs.org/'];
      const command=process.platform==='win32'?'powershell.exe':'npm';
      const args=process.platform==='win32'?['-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop'; & npm.cmd "+npmArgs.join(' ')+"; exit $LASTEXITCODE"]:npmArgs;
      const result=spawnSync(command,args,{cwd:root,env,stdio:'inherit',windowsHide:true});
      if(result.error||result.status!==0)throw Error('依赖安装失败。请检查 npm、网络和官方源访问；原配置保留。');
    }else console.log('项目依赖已满足，无需重新下载。');
    if(!dependencyState(root).ready)throw Error('依赖校验未通过，请检查安装输出。');
    runNode('build.mjs');
    console.log(settings().executionBackend==='headless'?'PG 项目依赖已准备好；独立运行时与账号请在菜单 11 检查。':'项目依赖和浏览器脚本已准备好。');
  }
  const install=()=>locked(installUnlocked);
  async function status() {
    const config=settings(),info={version:manifest().version,root,dependency:dependencyState(root),running:false,port:config.port,executionBackend:config.executionBackend,configuredBackend:config.executionBackend,openPlaygroundOnStart:config.openPlaygroundOnStart};
    const service=owned();
    if(service){
      info.running=true;info.pid=service.pid;
      info.mode=service.record.args?.includes('--lan')||/(?:^|\s)--lan(?:\s|$)/.test(service.record.commandLine??'')?'lan':'local';
      try{const remote=await statusRequest();info.pending=remote.pending;info.executorOnline=remote.executorOnline;info.executorVersion=remote.executorVersion;info.serviceVersion=remote.version;info.page=remote.page;info.executionBackend=remote.executionBackend==='headless'?'headless':'browser';info.runtime=remote.runtime;}
      catch(error){info.statusError=error.message;}
    }
    if(info.executionBackend==='headless'&&!info.runtime){
      try{
        if(fetchRuntimeStatus)info.runtime=await fetchRuntimeStatus();
        else{
          const {readRuntimeSettings,runtimeAdmin}=await import('../src/server/headless-runtime.mjs');
          const {createAccountPool}=await import('../src/server/headless-pool.mjs');
          info.runtime=await createAccountPool({root:dataDirectoryFor(root),admin:runtimeAdmin(readRuntimeSettings(dataDirectoryFor(root)))}).summary();
        }
      }catch{info.runtime={online:false,ready:false};}
    }
    // Never propagate account identities or secrets into terminal status output.
    if(info.runtime){const {online,state,ready,enabledAccounts,accountState,readyAccounts,authRequiredAccounts,coolingAccounts,strategy,autoRecover,runWanted}=info.runtime;info.runtime={online,state,ready,enabledAccounts,accountState,readyAccounts,authRequiredAccounts,coolingAccounts,strategy,autoRecover,runWanted};}
    return info;
  }
  async function startUnlocked(lan=false,{portWaitMs=0}={}) {
    manifest();if(owned()){console.log('这份便携包的后台已经运行。如需切换模式，请先停止。');return;}
    if(!dependencyState(root).ready)throw Error('项目依赖尚未就绪，请先选择“安装 / 修复项目依赖”。');
    const {port}=settings();
    const portDeadline=Date.now()+portWaitMs;
    for(;;){
      const free=await new Promise(resolveFree=>{const server=createServer();server.once('error',()=>resolveFree(false));server.listen(port,'127.0.0.1',()=>server.close(()=>resolveFree(true)));});
      if(free)break;
      if(Date.now()>=portDeadline)throw Error(`端口 ${port} 已被占用，请先关闭对应的旧后台。`);
      await delay(100); // Windows can release the listener after the PID exits.
    }
    console.log('正在启动反代，请稍候…');
    runNode('build.mjs');
    let child,spawnError,exited=false;
    if(process.platform==='win32'){
      // Avoid inheriting the menu's Windows output pipes in the background child.
      const quote=value=>"'"+value.replaceAll("'","''")+"'";
      const args='"'+path('launch.mjs')+'" --background'+(lan?' --lan':'');
      const receipt=path('.manager-start-'+randomUUID()+'.pid');
      const command="$ErrorActionPreference='Stop'; $p=Start-Process -FilePath "+quote(process.execPath)+" -ArgumentList "+quote(args)+" -WorkingDirectory "+quote(root)+" -WindowStyle Hidden -RedirectStandardOutput "+quote(path('portable-service.log'))+" -RedirectStandardError "+quote(path('portable-error.log'))+" -PassThru; Set-Content -LiteralPath "+quote(receipt)+" -Value $p.Id -Encoding Ascii";
      let pid;
      try{
        const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{stdio:'ignore',env,windowsHide:true,timeout:15000});
        if(result.error||result.status!==0)throw Error('Windows 后台启动失败，请查看运行日志。');
        pid=Number(readFileSync(receipt,'utf8').trim());
      }finally{if(existsSync(receipt))unlinkSync(receipt);}
      if(!Number.isSafeInteger(pid)||pid<=1)throw Error('未能取得后台进程标识，请查看日志。');
      child={pid};
    }else{
      const out=openSync(path('portable-service.log'),'a'),err=openSync(path('portable-error.log'),'a');
      try{child=spawn(process.execPath,[path('launch.mjs'),'--background',...(lan?['--lan']:[])],{cwd:root,env,detached:true,stdio:['ignore',out,err]});}
      finally{closeSync(out);closeSync(err);}
      child.on('error',error=>{spawnError=error;});child.on('exit',()=>{exited=true;});child.unref();
    }
    const deadline=Date.now()+(settings().executionBackend==='headless'?30000:10000);
    while(Date.now()<deadline){
      try{process.kill(child.pid,0);}catch(error){if(error.code==='ESRCH')exited=true;}
      if(spawnError||exited)throw Error('后台启动失败，请查看菜单中的运行日志。');
      if(existsSync(path('runtime.pid'))&&Number(readFileSync(path('runtime.pid'),'utf8').trim())===child.pid){
        try{await statusRequest();console.log(`后台已启动（${lan?'局域网':'本机'}），PID ${child.pid}。退出菜单不会停止服务。`);printLinks({lan});return;}catch{}
      }
      await delay(150);
    }
    if(!exited&&commandBelongsToRoot(inspect(child.pid),root))signal(child.pid);
    throw Error('后台未在限定时间内就绪，已结束本次启动，请查看日志。');
  }
  const start=(lan=false)=>locked(()=>startUnlocked(lan));
  async function readyUnlocked(lan=false,options) {
    // Existing services (including LAN) keep their mode and active requests.
    if(!owned()&&!dependencyState(root).ready)await installUnlocked();
    await startUnlocked(lan,options);
    const state=await statusRequest();
    if(state.executionBackend==='headless'){const service=owned(),actualLAN=service?.record.args?.includes('--lan')||/(?:^|\s)--lan(?:\s|$)/.test(service?.record.commandLine??'');const {resumeSupervision}=await import('./unattended.mjs');await resumeSupervision(root,{lan:actualLAN===true});}
    if(state.version&&state.version!==manifest().version)console.log(`提示：文件版本为 ${manifest().version}，后台仍为 ${state.version}。结束生成后停止并重新启动后台，使程序更新生效。`);
    return state;
  }
  const ready=(lan=false)=>locked(()=>readyUnlocked(lan));
  const scriptURL=()=>`http://127.0.0.1:${settings().port}/local-pg.user.js?v=${manifest().version}`;
  async function prepareScriptUnlocked() {
    const state=await readyUnlocked();
    if(state.executionBackend==='headless'){console.log('独立后端已启动，无需安装浏览器脚本；账号未就绪时选 11 检查。');return 'headless';}
    // The running server reads the asset on each request. Rebuild without a restart.
    runNode('build.mjs');
    const url=scriptURL();
    const response=await fetch(url,{signal:AbortSignal.timeout(5000),redirect:'error'});
    const source=await response.text();
    if(!response.ok||!source.startsWith('// ==UserScript==')||source.match(/^\/\/ @version\s+(\S+)/m)?.[1]!==manifest().version||/__LOCAL_PG_(PORT|KEY)__/.test(source))throw Error('浏览器脚本尚未就绪，请查看运行日志；未打开安装页。');
    console.log(`浏览器脚本已就绪：${url}\n请在已启用油猴的浏览器中确认安装 / 更新。\n首次使用：打开 https://aistudio.google.com/prompts/new_chat，登录并点击 Meow 激活。\n后续更新：刷新已打开的 AI Studio；需要激活时点击 Meow。`);
    return url;
  }
  const prepareScript=()=>locked(prepareScriptUnlocked);
  async function stopUnlocked() {
    const service=owned();if(!service){const {pauseSupervision}=await import('./unattended.mjs');pauseSupervision(root);console.log('这份便携包没有运行中的 PG 反代；进程守护已暂停。');return;}
    const state=await statusRequest();
    if(state.pending>0)throw Error('当前还有生成或能力验证请求，请先在酒馆停止或等待完成，再停止后台。');
    const {pauseSupervision}=await import('./unattended.mjs');pauseSupervision(root);
    // Recheck ownership after the HTTP roundtrip before signalling a PID.
    const current=owned();if(!current||current.pid!==service.pid)throw Error('进程状态已变化，请重新查看状态后再操作。');
    signal(service.pid);
    for(let i=0;i<50;i++){
      if(!inspect(service.pid)){
        if(existsSync(path('runtime.pid'))&&Number(readFileSync(path('runtime.pid'),'utf8').trim())===service.pid)unlinkSync(path('runtime.pid'));
        console.log(state.executionBackend==='headless'?'PG 反代已停止；独立运行时、账号凭证和管理入口保留。':'后台已停止。');return;
      }
      await delay(100);
    }
    throw Error('后台尚未退出，请在原启动窗口停止；没有强制结束其他程序。');
  }
  const stop=()=>locked(stopUnlocked);
  const restart=()=>locked(async()=>{
    const previous=await status();
    if(previous.statusError)throw Error('当前服务状态不可读，未重启；请选 5 查看日志');
    if(previous.pending>0)throw Error('当前有生成或验证任务，请结束后再重启');
    const {stopManagerWorkers}=await import('./manager-update.mjs');
    const {wasOpen}=await stopManagerWorkers(root,{inspect,signal,beforeStop:stopUnlocked});
    try{
      const state=await readyUnlocked(previous.mode==='lan',{portWaitMs:5000});
      if(wasOpen){const {ensureManager}=await import('./headless-portal.mjs');await ensureManager(dataDirectoryFor(root));}
      console.log('一键重启完成；配置、账号凭证与运行时已保留。');
      if(wasOpen)console.log('账号管理已重新加载，请选 11 打开新的管理入口。');
      printLinks({lan:previous.mode==='lan',executionBackend:state.executionBackend});
      return state;
    }catch(error){throw Error('重启未全部完成；配置与凭证已保留，请选 5 查看日志，再选 1 启动、11 打开账号管理',{cause:error});}
  });
  const setBackend=mode=>locked(async()=>{
    if(!existsSync(path('config.json'))){const {readConfig}=await import('../src/server/config.mjs');readConfig(path('config.json'),{});}
    const changed=await changeBackend(mode,{status,read:()=>readFileSync(path('config.json'),'utf8'),write:writeConfig,stop:stopUnlocked,start:readyUnlocked,
      prepare:async target=>{if(target==='headless'){const {installRuntime}=await import('./headless-install.mjs');await installRuntime(dataDirectoryFor(root));const {ensureRuntime}=await import('../src/server/headless-runtime.mjs');await ensureRuntime(dataDirectoryFor(root));}}
    });
    console.log(`${changed?'已切换为':'当前已是'}${mode==='headless'?'独立模式；无需 Meow，账号管理选 11。':'网页模式；在 AI Studio 激活会话后使用。'}`);
    if(!(await status()).running)console.log('模式已保存，选择 1 启动。');
  });
  const setOpenPlayground=enabled=>locked(()=>{
    const config=existsSync(path('config.json'))?readJSON(path('config.json')):{};
    config.openPlaygroundOnStart=enabled===true;writeConfig(JSON.stringify(config,null,2)+'\n');
    console.log(`启动后自动打开 AI Studio Playground：${enabled?'开启':'关闭'}。`);
  });
  const update=(source)=>locked(async()=>{
    const {updatePortable}=await import('./release-update.mjs');
    let reopen=false;
    const stopUpdate=async()=>{await stopUnlocked();if(existsSync(path('runtime-manager/src/portal.mjs'))){const {stopManagerWorkers}=await import('./manager-update.mjs');reopen=(await stopManagerWorkers(root,{inspect,signal})).wasOpen||reopen;}};
    const startUpdate=async lan=>{await readyUnlocked(lan);if(reopen){const {ensureManager}=await import('./headless-portal.mjs');await ensureManager(dataDirectoryFor(root));}};
    return updatePortable({root,env,source,status,stop:stopUpdate,start:startUpdate,prepareScript:prepareScriptUnlocked});
  });
  async function playgroundTarget({pause=delay,attempts=7}={}) {
    const service=owned();if(!service)throw Error('后台未运行，未打开 Playground。');
    // Existing userscripts retry every two seconds. Give a just-started relay a
    // bounded reconnection window before asking the browser to open another tab.
    for(let i=0;i<attempts;i++){
      const state=await statusRequest();
      if(!settings().openPlaygroundOnStart)return 'disabled';
      if(state.executionBackend!=='headless'&&state.executorOnline)return 'connected';
      try{const opened=readJSON(path('.manager-playground.json'));if(opened.pid===service.pid&&opened.startedAt===(state.requestTotals?.startedAt??null))return 'opened';}catch{}
      if(state.executionBackend==='headless')return 'https://aistudio.google.com/prompts/new_chat';
      if(i+1<attempts)await pause(500);
    }
    return 'https://aistudio.google.com/prompts/new_chat';
  }
  async function playgroundOpened(){const service=owned();if(!service)return;const state=await statusRequest();writeFileSync(path('.manager-playground.json'),JSON.stringify({pid:service.pid,startedAt:state.requestTotals?.startedAt??null}));}
  function printLinks({lan=false,executionBackend=settings().executionBackend}={}) {
    const {port}=settings();
    if(executionBackend==='browser')console.log(`本机脚本安装：http://127.0.0.1:${port}/local-pg.user.js?v=${manifest().version}`);
    else console.log('本机账号管理：菜单 11（仅在此设备打开）');
    console.log(`本机酒馆 / Bot 地址：http://127.0.0.1:${port}/v1\n密钥：见本目录 config.json`);
    if(lan)try{
      const config=readJSON(path('lan-config.json'));
      if(!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(config.address)||!Number.isInteger(config.port)||config.port<1||config.port>65535)throw Error();
      console.log(`手机酒馆地址：http://${config.address}:${config.port}/v1\n手机使用上面的局域网地址；${executionBackend==='headless'?'独立运行时在本设备运行，无需打开 AI Studio。':'AI Studio 仍在本设备运行。'}`);
    }catch{console.log('局域网地址暂不可读，请查看 lan-config.json 和运行日志。');}
  }
  function logs(){for(const name of ['portable-service.log','portable-error.log']){
    console.log(`\n—— ${name} ——`);
    if(!existsSync(path(name))){console.log('暂无日志。');continue;}
    const secret=settings().apiKey;
    const lines=readFileSync(path(name),'utf8').split(/\r?\n/).slice(-40).map(line=>line.replace(/^(?:密钥|API Key)[:：].*$/,'密钥：[已隐藏]'));
    console.log(lines.join('\n').replaceAll(secret,'[已隐藏]'));
  }}
  return {install,status,start,ready,prepareScript,update,restart,playgroundTarget,playgroundOpened,setBackend,setOpenPlayground,stop,logs,printLinks,scriptURL};
}
export async function main(action=process.argv[2]??'status') {
  if(Number(process.versions.node.split('.')[0])<22)throw Error(`需要 Node.js 22+，官方下载：${NODE_DOWNLOAD}`);
  const manager=createManager();
  if(action==='menu-status'){
    try{const summary=menuStatus(await manager.status());console.log(process.argv[3]==='--text'?summary.text:JSON.stringify(summary));}
    catch{const text='反代 状态暂不可读 · 选择 4 查看详情';console.log(process.argv[3]==='--text'?text:JSON.stringify({backend:'unknown',executionBackend:'unknown',ready:false,mode:'none',text}));}
    return;
  }
  if(action==='install')return manager.install();
  if(action==='restart')return manager.restart();
  if(action==='start'||action==='lan')return manager.start(action==='lan');
  if(action==='ready'||action==='ready-lan')return manager.ready(action==='ready-lan');
  if(action==='mode-browser'||action==='mode-headless')return manager.setBackend(action.slice(5));
  if(action==='open-pg-on'||action==='open-pg-off')return manager.setOpenPlayground(action==='open-pg-on');
  if(action==='startup-settings'){const state=await manager.status();console.log(`执行模式：${state.executionBackend==='headless'?'独立模式':'网页模式'}\n启动后打开 AI Studio：${state.openPlaygroundOnStart?'开启':'关闭'}\n模式选择 12 · 自动打开选择 13`);return;}
  if(action==='script')return manager.prepareScript();
  if(action==='update')return manager.update(process.argv[3]);
  if(action==='stop')return manager.stop();
  if(action==='logs')return manager.logs();
  if(action==='accounts-url'){const {installRuntime}=await import('./headless-install.mjs');await installRuntime(dataDirectoryFor(defaultRoot));const {ensureManager}=await import('./headless-portal.mjs');console.log((await ensureManager(dataDirectoryFor(defaultRoot))).url);return;}
  if(action==='script-url'){console.log((await manager.status()).executionBackend==='headless'?'headless':manager.scriptURL());return;}
  if(action==='playground-target'){console.log(await manager.playgroundTarget());return;}
  if(action==='playground-opened')return manager.playgroundOpened();
  if(action==='links'){const info=await manager.status();return manager.printLinks({lan:info.running&&info.mode==='lan',executionBackend:info.executionBackend});}
  if(action==='status'||action==='check'){
    const info=await manager.status();
    console.log(`MEOW-FM 文件版本：${info.version}\n目录：${info.root}\nNode.js：${process.version}\n项目依赖：${info.dependency.ready?'已就绪':'未就绪，请选择安装 / 修复'}\n后台：${info.running?'运行中，PID '+info.pid:'未运行'}\n本机端口：${info.port}`);
    try{const receipt=readJSON(join(info.root,'.source-revision.json'));if(/^[0-9a-f]{40}$/.test(receipt.commit??''))console.log(`源码提交：${receipt.commit.slice(0,12)}`);}catch{}
    if(info.running)console.log(`运行模式：${info.mode==='lan'?'局域网（手机可连接）':'仅本机'}`);
    if(info.running)console.log(info.statusError??`后台版本：${info.serviceVersion??'未知'}\n活动请求：${info.pending}`);
    console.log(menuStatus(info).text);
    if(info.serviceVersion&&info.serviceVersion!==info.version)console.log('文件已更新，后台仍是旧版本；结束生成后选 15 一键重启。');
    if(info.executionBackend==='browser'){
      if(info.page?.state==='unresponsive')console.log('AI Studio 页面暂未响应，请切回该页面检查后台保活。');
      if(info.running&&!info.statusError&&!info.executorOnline)console.log('下一步：切回 AI Studio，登录并点击 Meow；尚未安装脚本时才需选 3。');
      if(!info.running)console.log('下一步：选择 1 启动，或直接选择 3 安装浏览器脚本。');
    }
    manager.printLinks({lan:info.running&&info.mode==='lan',executionBackend:info.executionBackend});
    return;
  }
  throw Error('未知菜单操作。');
}
if(process.argv[1]&&samePath(fileURLToPath(import.meta.url),process.argv[1]))main().catch(error=>{console.error(`操作未完成：${error.message}`);process.exitCode=1;});
