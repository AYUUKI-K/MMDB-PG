import {openSync,writeFileSync,readFileSync,closeSync,unlinkSync,lstatSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';

export function processAlive(pid){if(!Number.isSafeInteger(pid)||pid<=1)return true;try{process.kill(pid,0);return true;}catch(error){return error.code!=='ESRCH';}}
export async function acquireRuntimeLock(file,{signal,waitMs=0}={}){
  const nonce=randomUUID(),deadline=Date.now()+waitMs;
  for(;;){
    signal?.throwIfAborted();let fd;
    try{fd=openSync(file,'wx',0o600);writeFileSync(fd,JSON.stringify({pid:process.pid,nonce}));}
    catch(error){
      if(fd!==undefined){closeSync(fd);throw error;}
      if(error.code!=='EEXIST')throw error;
      let stat;try{stat=lstatSync(file);}catch(error){if(error.code==='ENOENT')continue;throw error;}if(!stat.isFile()||stat.isSymbolicLink())throw Error('运行锁不是普通文件');
      let previous;try{previous=readFileSync(file,'utf8');const value=JSON.parse(previous);if(!processAlive(value.pid)&&readFileSync(file,'utf8')===previous){unlinkSync(file);continue;}}catch(error){if(error.code==='ENOENT')continue;}
      if(Date.now()>=deadline)throw Object.assign(Error('运行时正在生成或处理账号操作，请稍后再试'),{code:'runtime_busy'});
      await delay(100,undefined,{signal});continue;
    }
    let released=false;
    return ()=>{if(released)return;released=true;closeSync(fd);try{if(JSON.parse(readFileSync(file,'utf8')).nonce===nonce)unlinkSync(file);}catch(error){if(error.code!=='ENOENT')throw error;}};
  }
}
