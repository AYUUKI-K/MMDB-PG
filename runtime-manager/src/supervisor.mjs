// Hidden, installation-scoped process supervision. It never opens a browser or
// stores credentials in the startup command. Manual stop pauses supervision.
import {readFileSync,writeFileSync,renameSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn,execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {privateDirectory,runtimeRoot} from './headless-runtime.mjs';
import {managerSettings} from './settings.mjs';
import {ensureManager} from './portal.mjs';
import {acquireRuntimeLock,processAlive} from './headless-lock.mjs';
import {createCallDiagnostics} from './call-diagnostics.mjs';

const defaultRoot=runtimeRoot();
async function integration(){const file=managerSettings().integrationModule;return file?(await import(pathToFileURL(file).href)).createIntegration():null;}
const readJSON=file=>JSON.parse(readFileSync(file,'utf8').replace(/^\uFEFF/,''));
function write(root,name,value){const file=join(root,name),temp=file+'.'+randomUUID()+'.tmp';writeFileSync(temp,JSON.stringify(value)+'\n',{mode:0o600});renameSync(temp,file);}
export function supervisionSettings(root=defaultRoot){try{return readJSON(join(root,'supervision.json'));}catch{return {enabled:false,wanted:false,lan:false};}}
export function pauseSupervision(root=defaultRoot){const state=supervisionSettings(root);if(state.enabled)write(root,'supervision.json',{...state,wanted:false});}
export async function enableSupervision(root=defaultRoot,{lan=false}={}){root=resolve(root);privateDirectory(root);write(root,'supervision.json',{enabled:true,wanted:true,lan});return ensureSupervisor(root);}
export async function disableSupervision(root=defaultRoot){const state=supervisionSettings(root);write(root,'supervision.json',{...state,enabled:false,wanted:false});}
export async function resumeSupervision(root=defaultRoot,{lan=false}={}){const state=supervisionSettings(root);if(!state.enabled)return;write(root,'supervision.json',{...state,wanted:true,lan});return ensureSupervisor(root);}
export async function ensureSupervisor(root=defaultRoot){
  root=resolve(root);const state=supervisionSettings(root);if(!state.enabled||!state.wanted)return;
  try{const receipt=readJSON(join(root,'supervisor-status.json'));if(processAlive(receipt.pid)&&receipt.pid>1){
    const lock=readJSON(join(root,'supervisor.lock'));
    if(lock.pid===receipt.pid&&receipt.state!=='stopped'&&Date.now()-receipt.checkedAt<360000)return;
  }}catch{}
  const child=spawn(process.execPath,[fileURLToPath(import.meta.url),'--watch',root],{cwd:root,detached:true,windowsHide:true,stdio:['ignore','ignore','ignore','ipc']});
  try{await new Promise((resolveReady,reject)=>{const timer=setTimeout(()=>reject(Error('守护进程未能启动')),10000);const finish=error=>{clearTimeout(timer);error?reject(error):resolveReady();};child.once('error',()=>finish(Error('守护进程启动失败')));child.once('exit',code=>finish(code===0?null:Error('守护进程退出')));child.once('message',message=>finish(message?.ready?null:Error('守护进程未就绪')));});}
  finally{if(child.connected)child.disconnect();child.unref();}
}
export async function superviseStep({settings,backend,status,ready}){
  const desired=settings();if(!desired.enabled||!desired.wanted||backend()!=='headless')return false;
  const current=await status();if(!current.running)await ready(desired.lan===true);return true;
}
async function watch(root){
  let release;try{release=await acquireRuntimeLock(join(root,'supervisor.lock'));}catch{process.send?.({ready:true});return;}
  let stopped=false,failures=0;for(const event of ['SIGINT','SIGTERM'])process.once(event,()=>{stopped=true;});
  const bridge=await integration();
  const diagnostics=createCallDiagnostics({root});let previousState;
  const report=state=>{if(state!==previousState){diagnostics.record('supervisor-'+state,{source:'supervisor',reason:state==='retrying'?'recovery-failed':undefined});previousState=state;}write(root,'supervisor-status.json',{pid:process.pid,state,failures,checkedAt:Date.now()});};
  try{
    report('watching');process.send?.({ready:true});
    while(!stopped){
      try{const desired=supervisionSettings(root);if(!desired.enabled||!desired.wanted){failures=0;report('paused');await delay(15000);continue;}await ensureManager(root);if(bridge)await superviseStep({settings:()=>desired,backend:()=>bridge.backend(),status:()=>bridge.status(),ready:async lan=>{diagnostics.record('relay-recovery-started',{source:'supervisor'});await bridge.start(lan);diagnostics.record('relay-recovery-succeeded',{source:'supervisor'});}});failures=0;report('watching');}
      catch{failures++;report('retrying');}
      await delay(Math.min(300000,15000*2**Math.min(failures,5)));
    }
  }finally{report('stopped');release();}
}
const startupName=root=>'MMDB-PG-'+createHash('sha256').update(resolve(root).toLowerCase()).digest('hex').slice(0,12);
const ps=value=>"'"+value.replaceAll("'","''")+"'";
export function startupCommand(root=defaultRoot){return 'wscript.exe "'+join(resolve(root),'login-start.vbs')+'"';}
export function loginScript(root=defaultRoot,node=process.execPath){
  const command='"'+node+'" "'+fileURLToPath(import.meta.url)+'" login "'+resolve(root)+'"';
  return 'CreateObject("WScript.Shell").Run "'+command.replaceAll('"','""')+'", 0, False\r\n';
}
export async function setLoginStartup(enabled,root=defaultRoot){
  if(process.platform!=='win32')throw Error('登录自启动开关目前仅支持 Windows；其他系统请使用自己的进程管理器');
  root=resolve(root);privateDirectory(root);
  if(enabled)writeFileSync(join(root,'login-start.vbs'),loginScript(root),{mode:0o600});
  const key='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',name=startupName(root);
  const command=enabled?`New-Item -Path ${ps(key)} -Force | Out-Null; New-ItemProperty -LiteralPath ${ps(key)} -Name ${ps(name)} -Value ${ps(startupCommand(root))} -PropertyType String -Force | Out-Null`:`Remove-ItemProperty -LiteralPath ${ps(key)} -Name ${ps(name)} -ErrorAction SilentlyContinue`;
  execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop'; "+command],{windowsHide:true,stdio:'pipe'});
}
export function loginStartupEnabled(root=defaultRoot){if(process.platform!=='win32')return false;try{
  const command=`$v=Get-ItemPropertyValue -LiteralPath 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -Name ${ps(startupName(root))} -ErrorAction Stop; if($v -eq ${ps(startupCommand(root))}){'enabled'}`;
  return execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','ignore']}).trim()==='enabled';
}catch{return false;}}
export async function main(action=process.argv[2],root=defaultRoot){
  if(action==='--watch')return watch(resolve(process.argv[3]));
  if(action==='login'){root=resolve(process.argv[3]??root);await enableSupervision(root,{lan:supervisionSettings(root).lan===true});return;}
  if(action==='enable'){const bridge=await integration();const current=bridge?await bridge.status():null;await enableSupervision(root,{lan:current?.mode==='lan'});console.log('无人值守守护已开启；PG 意外退出后自动恢复，菜单 6 手动停止会暂停守护。');return;}
  if(action==='disable'){await disableSupervision(root);console.log('进程守护已关闭，当前 PG 继续运行。');return;}
  if(action==='autostart-on'||action==='autostart-off'){await setLoginStartup(action==='autostart-on',root);console.log(`Windows 登录自启动：${action==='autostart-on'?'开启':'关闭'}。`);return;}
  if(action==='status'){const config=supervisionSettings(root);let state;try{state=readJSON(join(root,'supervisor-status.json'));}catch{}console.log(`进程守护：${config.enabled?(config.wanted?'开启':'手动暂停'):'关闭'}\n守护状态：${state?.state==='watching'&&processAlive(state.pid)?'运行中':state?.state==='retrying'?'重试中':'未运行'}\nWindows 登录自启动：${loginStartupEnabled(root)?'开启':'关闭'}`);return;}
  throw Error('用法：node src/supervisor.mjs <enable|disable|status|autostart-on|autostart-off>');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error(error.message);process.exitCode=1;});
