import {spawn} from 'node:child_process';
import {isManagerURL} from './portal.mjs';

// Wait until the OS has accepted the browser launch before the CMD window exits.
// Keep the private local URL out of the PowerShell command line and error output.
export async function openManagerPage(url,{platform=process.platform,spawnImpl=spawn,timeoutMs=15000}={}){
  if(!isManagerURL(url))throw Error('本机管理地址无效，未打开浏览器');
  const command=platform==='win32'?'powershell.exe':platform==='darwin'?'open':'xdg-open';
  const args=platform==='win32'?['-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop'; Start-Process -FilePath $env:MMDB_MANAGER_URL"]:[url];
  return new Promise((resolve,reject)=>{
    let child,settled=false,timer;
    const finish=error=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve();};
    try{child=spawnImpl(command,args,{windowsHide:true,stdio:'ignore',...(platform==='win32'?{env:{...process.env,MMDB_MANAGER_URL:url}}:{})});}
    catch{finish(Error('无法启动系统浏览器，请用下面的本机地址手动打开'));return;}
    child.once('error',()=>finish(Error('无法启动系统浏览器，请用下面的本机地址手动打开')));
    child.once('close',code=>finish(code===0?null:Error('系统未能打开浏览器，请用下面的本机地址手动打开')));
    timer=setTimeout(()=>{finish(Error('等待浏览器打开超时，请用下面的本机地址手动打开'));try{child.kill();}catch{}},timeoutMs);
  });
}
