import {randomBytes,createHmac} from 'node:crypto';
import {readFileSync,writeFileSync,lstatSync} from 'node:fs';
import {join} from 'node:path';
import {privateDirectory} from './headless-runtime.mjs';
import {EXTENSION_ID,hex,localOrigin,ticketText} from '../browser-extension/protocol.mjs';

const secret=()=>randomBytes(32).toString('hex');
export function loadCaptureIdentity(root){
  privateDirectory(root);const path=join(root,'browser-bridge.json');
  let identity;
  try{if(lstatSync(path).isSymbolicLink())throw Error('扩展连接记录不能是链接');identity=JSON.parse(readFileSync(path,'utf8'));}
  catch(error){
    if(error.code!=='ENOENT')throw error;
    identity={version:1,installationId:secret(),secret:secret()};
    try{writeFileSync(path,JSON.stringify(identity)+'\n',{mode:0o600,flag:'wx'});}
    catch(error){if(error.code!=='EEXIST')throw error;identity=JSON.parse(readFileSync(path,'utf8'));}
  }
  if(identity.version!==1||!hex(identity.installationId)||!hex(identity.secret))throw Error('扩展连接记录无效');
  return identity;
}
export function createBrowserCapture({identity={version:1,installationId:secret(),secret:secret()},now=Date.now}={}){
  const jobs=new Map();
  const prune=()=>{for(const [key,value] of jobs)if(value.state!=='importing'&&value.retireAt<now())jobs.delete(key);};
  return {
    info:()=>({extensionId:EXTENSION_ID,installationId:identity.installationId}),
    pair(origin){if(!localOrigin(origin))throw Error('无效管理地址');return {...identity,origin};},
    issue(origin,authUser){
      prune();if(!localOrigin(origin)||!Number.isSafeInteger(authUser)||authUser<0||authUser>99)throw Error('账号序号无效');
      if([...jobs.values()].some(job=>job.state==='importing'))throw Error('正在导入凭证，请等待完成');
      if(jobs.size>=16)throw Error('抓取请求过于频繁，请稍后重试');
      const ticket={version:1,installationId:identity.installationId,origin,token:secret(),authUser,expiresAt:now()+60000};
      ticket.proof=createHmac('sha256',Buffer.from(identity.secret,'hex')).update(ticketText(ticket)).digest('hex');
      jobs.set(ticket.token,{ticket,state:'waiting',retireAt:ticket.expiresAt});return ticket;
    },
    accept(token){
      prune();const job=jobs.get(token);
      if(!job||job.state!=='waiting'||job.ticket.expiresAt<=now())throw Error('抓取请求已过期或已使用，请重新点击抓取');
      if([...jobs.values()].some(value=>value.state==='importing'))throw Error('正在导入凭证，请等待完成后重新抓取');
      job.state='importing';return job.ticket;
    },
    finish(token,error){const job=jobs.get(token);if(job){job.state=error?'failed':'succeeded';job.error=error;job.retireAt=now()+300000;}},
    result(token){prune();const job=jobs.get(token);if(!job)throw Error('抓取记录已失效，请刷新后重试');return {state:job.state,...(job.error?{error:job.error}:{})};}
  };
}
