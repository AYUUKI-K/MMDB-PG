// Stop only this installation's idle Node management workers before replacing
// their source. The upstream executable, credential store and pool stay intact.
import {existsSync,readFileSync} from 'node:fs';
import {join,resolve,basename} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {dataDirectoryFor} from './manager-paths.mjs';
import {acquireRuntimeLock} from '../runtime-manager/src/headless-lock.mjs';
export function managerWorkerOwned(record,script,root){
  if(!record||!['node','node.exe'].includes(basename(record.executable??'').toLowerCase()))return false;
  const args=record.args??Array.from((record.commandLine??'').matchAll(/"([^"]*)"|([^\s"]+)/g),m=>m[1]??m[2]);
  const same=(a,b)=>process.platform==='win32'?resolve(a).toLowerCase()===resolve(b).toLowerCase():resolve(a)===resolve(b);
  return args.length>=3&&same(args[1],script)&&args.slice(2).some(a=>a!=='--watch'&&same(a,root));
}
export async function stopManagerWorkers(root,{inspect,signal=pid=>process.kill(pid,'SIGTERM')}={}){
  const data=dataDirectoryFor(root);if(!existsSync(data))return {wasOpen:false};
  const release=await acquireRuntimeLock(join(data,'operation.lock'));let wasOpen=false;
  try{
    const workers=[];
    // Supervisor first, so it cannot respawn a portal between shutdowns.
    for(const [receipt,name] of [['supervisor-status.json','supervisor.mjs'],['manager.json','portal.mjs']]){
      const file=join(data,receipt);if(!existsSync(file))continue;
      let saved;try{saved=JSON.parse(readFileSync(file,'utf8'));}catch{continue;}
      if(!Number.isSafeInteger(saved.pid)||saved.pid<=1)throw Error('独立管理器进程记录无效，未执行更新');
      const record=inspect(saved.pid);if(!record)continue;
      if(!managerWorkerOwned(record,join(root,'runtime-manager','src',name),data))throw Error('独立管理器进程归属不符，未停止其他程序');
      if(name==='portal.mjs')wasOpen=true;
      workers.push({pid:saved.pid,name});
    }
    // Validate every receipt before stopping anything, then recheck at signal time.
    for(const {pid,name} of workers){
      const record=inspect(pid);if(!record)continue;
      if(!managerWorkerOwned(record,join(root,'runtime-manager','src',name),data))throw Error('独立管理器进程归属不符，未停止其他程序');
      signal(pid);for(let i=0;i<50&&inspect(pid);i++)await delay(100);
      if(inspect(pid))throw Error('独立管理器尚未退出，请稍后重试更新');
    }
    return {wasOpen};
  }finally{release();}
}
