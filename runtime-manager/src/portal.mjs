// A reusable, loopback-only account panel, independent of the terminal and PG.
import {readFileSync,writeFileSync,renameSync,openSync,closeSync,unlinkSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {runtimeRoot,privateDirectory,readRuntimeSettings,ensureRuntime} from './headless-runtime.mjs';
import {createHeadlessManager} from './headless-manager.mjs';
import {createBrowserCapture,loadCaptureIdentity} from './headless-browser-capture.mjs';
import {createCredentialImporter} from './headless-credentials.mjs';
import {createAccountPool} from './headless-pool.mjs';
import {createRuntimeWatchdog} from './headless-watchdog.mjs';
import {managerSettings} from './settings.mjs';

export function isManagerURL(value){
  if(typeof value!=='string'||!/^http:\/\/127\.0\.0\.1:\d+\/#[a-f0-9]{64}$/.test(value))return false;
  try{const url=new URL(value);return Number(url.port)>0&&Number(url.port)<=65535;}catch{return false;}
}
async function existing(root){
  try{
    const saved=JSON.parse(readFileSync(join(root,'manager.json'),'utf8'));
    if(!isManagerURL(saved.url)||!Number.isSafeInteger(saved.pid)||saved.pid<=1)return;
    const url=new URL(saved.url);
    const response=await fetch(url.origin+'/api/health',{headers:{Authorization:'Bearer '+url.hash.slice(1)},redirect:'error',signal:AbortSignal.timeout(1500)});
    if(!response.ok){await response.body?.cancel();return;}
    const health=await response.json();
    if(health.service==='mmdb-headless-manager'&&health.pid===saved.pid&&health.accountPool===1&&health.standalone===1)return saved;
  }catch{}
}
export async function ensureManager(root=runtimeRoot()){
  root=resolve(root);readRuntimeSettings(root);privateDirectory(root);
  const lock=join(root,'manager.lock');let fd;
  const deadline=Date.now()+35000;
  while(fd===undefined){
    const saved=await existing(root);if(saved)return saved;
    try{fd=openSync(lock,'wx',0o600);writeFileSync(fd,String(process.pid));}
    catch(error){
      if(error.code!=='EEXIST')throw error;
      try{const pid=Number(readFileSync(lock,'utf8'));if(Number.isSafeInteger(pid)&&pid>1){try{process.kill(pid,0);}catch(e){if(e.code==='ESRCH')unlinkSync(lock);}}}catch{}
      if(Date.now()>deadline)throw Error('账号管理入口正在启动，请稍后重试；若上次异常退出，请检查 .headless/manager.lock。');
      await delay(200);
    }
  }
  try{
    const saved=await existing(root);if(saved)return saved;
    const child=spawn(process.execPath,[fileURLToPath(import.meta.url),root],{cwd:root,detached:true,windowsHide:true,stdio:['ignore','ignore','ignore','ipc']});
    try{
      const ready=await new Promise((resolveReady,reject)=>{
        const timer=setTimeout(()=>reject(Error('账号管理入口启动超时，请检查独立运行时。')),30000);
        const finish=(error,value)=>{clearTimeout(timer);error?reject(error):resolveReady(value);};
        child.once('error',()=>finish(Error('无法启动账号管理入口。')));
        child.once('exit',()=>finish(Error('账号管理入口未能启动，请检查独立运行时。')));
        child.once('message',message=>{
          if(message?.error)finish(Error(message.error));
          else if(isManagerURL(message?.url)&&message.pid===child.pid)finish(null,message);
          else finish(Error('账号管理入口返回了无效地址。'));
        });
      });
      writeFileSync(join(root,'manager.json.tmp'),JSON.stringify(ready)+'\n',{mode:0o600});
      renameSync(join(root,'manager.json.tmp'),join(root,'manager.json'));
      return ready;
    }catch(error){child.kill();throw error;}
    finally{if(child.connected)child.disconnect();child.unref();}
  }finally{closeSync(fd);unlinkSync(lock);}
}

async function serve(root){
  if(!process.send)throw Error('请从 MMDB 菜单 11 或 npm run headless -- manage-url 打开账号管理。');
  const {admin,settings}=await ensureRuntime(root),pool=createAccountPool({root,admin,recover:()=>ensureRuntime(root)}),capture=createBrowserCapture({identity:loadCaptureIdentity(root)}),importer=createCredentialImporter({root,admin});
  const config=managerSettings(),integration=config.integrationModule?(await import(pathToFileURL(config.integrationModule).href)).createIntegration():null;
  const guard=await import('./supervisor.mjs');
  const supervision={status:()=>({...guard.supervisionSettings(root),loginStartup:guard.loginStartupEnabled(root)}),
    async update(body){if(typeof body.enabled!=='boolean'||typeof body.loginStartup!=='boolean')throw Error('守护设置无效');if(body.enabled)await guard.enableSupervision(root,{lan:(await integration?.status())?.mode==='lan'});else await guard.disableSupervision(root);if(body.loginStartup!==guard.loginStartupEnabled(root))await guard.setLoginStartup(body.loginStartup,root);}};
  const panel=await createHeadlessManager({admin,settings,capture,pool,integration,supervision,importAccount:(...args)=>pool.exclusive(()=>importer(...args))});
  const watchdog=createRuntimeWatchdog(()=>pool.recoverOnce());
  for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{watchdog.close();panel.close();});
  process.send({url:panel.url,pid:process.pid});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)serve(resolve(process.argv[2]??runtimeRoot())).catch(error=>{
  if(process.send)process.send({error:error.message},()=>process.exit(1));else process.exitCode=1;
});
