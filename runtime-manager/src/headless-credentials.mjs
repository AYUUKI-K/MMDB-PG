// v0.2.18's import API cannot replace an existing account. After that API has
// verified the email, update only its credential files while generation is
// stopped. Keep account identity, flags, cooldowns and resources intact.
import {readFileSync,writeFileSync,renameSync,unlinkSync,readdirSync,lstatSync,mkdirSync,openSync,closeSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {privateDirectory} from './headless-runtime.mjs';
import {importCredentials} from './headless-operations.mjs';

const googleDomain=value=>typeof value==='string'&&/^(?:[a-z0-9-]+\.)*google\.com$/i.test(value.replace(/^\./,''));
const sameSite=value=>({none:'None',no_restriction:'None',lax:'Lax',strict:'Strict'})[String(value??'').toLowerCase()]??'';
export function credentialState(input){
  const text=input.trim().replace(/^\uFEFF/,'');let cookies,origins;
  if(/^[\[{]/.test(text)){
    let value;try{value=JSON.parse(text);}catch{throw Error('Cookie JSON 无效');}
    const rows=Array.isArray(value)?value:value.cookies;if(!Array.isArray(rows))throw Error('Cookie JSON 无效');
    cookies=rows.filter(row=>row.name&&row.value&&googleDomain(row.domain)).map(row=>({name:row.name,value:row.value,domain:row.domain,path:row.path||'/',expires:row.session?-1:row.expires??row.expirationDate??-1,httpOnly:row.httpOnly===true,secure:row.secure===true,sameSite:sameSite(row.sameSite)}));
    if(!Array.isArray(value)&&Array.isArray(value.origins))origins=value.origins.filter(row=>{try{const u=new URL(row.origin);return u.protocol==='https:'&&googleDomain(u.hostname);}catch{return false;}});
  }else if(text.includes('\t')){
    cookies=[];
    for(const original of text.split(/\r?\n/)){
      const httpOnly=original.startsWith('#HttpOnly_'),line=original.replace(/^#HttpOnly_/,'');if(!line.trim()||line.startsWith('#'))continue;
      const fields=line.split('\t');if(fields.length!==7)throw Error('Netscape Cookie 格式无效');
      const [domain,,path,secure,expiry,name,value]=fields;if(!googleDomain(domain))continue;
      cookies.push({domain,path:path||'/',name,value,secure:secure.toUpperCase()==='TRUE',httpOnly,expires:Number(expiry)>0?Number(expiry):-1,sameSite:''});
    }
  }else{
    const header=text.replace(/^Cookie:\s*/i,'');if(!header||/[\r\n]/.test(header))throw Error('Cookie 请求头必须是一行');
    cookies=header.split(';').map(item=>{const index=item.indexOf('='),name=item.slice(0,index).trim();if(index<1||!name)throw Error('Cookie 请求头格式无效');return {name,value:item.slice(index+1).trim(),domain:name.startsWith('__Host-')?'aistudio.google.com':'.google.com',path:'/',expires:-1,httpOnly:false,secure:true,sameSite:''};});
  }
  const unique=new Map();for(const cookie of cookies){
    if(typeof cookie.name!=='string'||typeof cookie.value!=='string'||typeof cookie.path!=='string'||!cookie.path.startsWith('/')||!Number.isFinite(cookie.expires))throw Error('Cookie 字段无效');
    unique.set(JSON.stringify([cookie.domain.toLowerCase(),cookie.path,cookie.name]),cookie);
  }
  if(!unique.size)throw Error('没有可保存的 Google Cookie');return {cookies:[...unique.values()],...(origins?{origins}:{})};
}
function plain(path,directory=false){const stat=lstatSync(path);if(stat.isSymbolicLink()||(directory?!stat.isDirectory():!stat.isFile()))throw Error('凭证路径必须是本机普通文件或目录');return path;}
function findAccount(root,id){
  const base=plain(join(root,'auth'),true),matches=[];
  for(const entry of readdirSync(base,{withFileTypes:true})){
    if(!entry.isDirectory()||entry.isSymbolicLink())continue;
    const directory=plain(join(base,entry.name),true),configPath=join(directory,'account.json');
    let config;try{plain(configPath);config=JSON.parse(readFileSync(configPath,'utf8'));}catch(error){if(error.code==='ENOENT')continue;throw Error('账号配置不可读，未更新凭证');}
    if(typeof config.label==='string'&&config.label.toLowerCase()===id.toLowerCase())matches.push({directory,configPath,storagePath:plain(join(directory,'storage-state.json'))});
  }
  if(matches.length!==1)throw Error('无法唯一定位已验证账号，未更新凭证');return matches[0];
}
function atomicWrite(path,text){
  plain(path);const temp=path+'.mmdb-'+randomUUID()+'.tmp';
  try{writeFileSync(temp,text,{mode:0o600,flag:'wx'});renameSync(temp,path);}finally{try{unlinkSync(temp);}catch(error){if(error.code!=='ENOENT')throw error;}}
}
export function createCredentialImporter({root,admin}){
  root=privateDirectory(root);
  // chromeAuth is supplied only by the local, verified runtime setup adapter,
  // never forwarded from HTTP bodies or arbitrary pasted storage-state JSON.
  return async(cookies,{authUser=0,chromeAuth,proxy}={})=>{
    const lock=join(root,'credential-import.lock');let fd;
    try{fd=openSync(lock,'wx',0o600);writeFileSync(fd,String(process.pid));}
    catch(error){if(error.code==='EEXIST')throw Error('另一项凭证导入正在进行，请稍后再试');throw error;}
    try{
      let state=await admin('/api/status');if(state.active_requests>0||state.state==='LAUNCHING')throw Error('正在生成或启动，请等待完成后重新抓取');
      let verified;
      try{
        const imported=await importCredentials(admin,cookies,{authUser,proxy});
        if(!chromeAuth)return imported;
        verified=imported?.account?.id;
      }
      catch(error){if(error.code!=='account_exists'||typeof error.accountId!=='string')throw error;verified=error.accountId;}
      if(chromeAuth&&(!verified||chromeAuth.source?.email?.toLowerCase()!==verified.toLowerCase()))throw Error('Chrome 与已验证账号身份不一致，未保存 OAuth 材料');
      const {accounts}=await admin('/api/accounts'),account=accounts.find(row=>row.id.toLowerCase()===verified.toLowerCase());
      if(!account)throw Error('已验证账号不在当前账号列表中，未更新凭证');
      const paths=findAccount(root,account.id),next=credentialState(cookies);
      if(chromeAuth)next.aistudio2api=chromeAuth;
      state=await admin('/api/status');if(state.active_requests>0||!['STOPPED','RUNNING'].includes(state.state))throw Error('正在生成或启动，请等待完成后重新抓取');
      const wasRunning=state.state==='RUNNING';let stopped=false,changed=false,original;
      try{
        if(wasRunning){await admin('/api/control/stop',{method:'POST',timeoutMs:30000});stopped=true;}
        const idle=await admin('/api/status');if(idle.state!=='STOPPED'||idle.active_requests>0)throw Error('生成服务未停止，未更新凭证');
        plain(paths.directory,true);plain(paths.configPath);plain(paths.storagePath);
        original={config:readFileSync(paths.configPath,'utf8'),storage:readFileSync(paths.storagePath,'utf8')};
        const config=JSON.parse(original.config),storage=JSON.parse(original.storage);
        if(config.label.toLowerCase()!==account.id.toLowerCase())throw Error('账号身份已改变，未更新凭证');
        const backupRoot=join(root,'credential-backups');mkdirSync(backupRoot,{recursive:true,mode:0o700});plain(backupRoot,true);
        writeFileSync(join(backupRoot,randomUUID()+'.json'),JSON.stringify({version:1,accountId:account.id,createdAt:new Date().toISOString(),...original})+'\n',{mode:0o600,flag:'wx'});
        // Preserve existing auth extensions and origin data; only replace cookies
        // and the verified Google session slot. No account deletion/recreation.
        atomicWrite(paths.storagePath,JSON.stringify({...storage,...next},null,2)+'\n');changed=true;
        if((config.auth_user??0)!==authUser)atomicWrite(paths.configPath,JSON.stringify({...config,auth_user:authUser},null,2)+'\n');
        if(wasRunning)await admin('/api/control/start',{method:'POST',timeoutMs:180000});
        return {updated:true,accountId:account.id};
      }catch{
        try{
          if(changed){await admin('/api/control/stop',{method:'POST',timeoutMs:30000});atomicWrite(paths.storagePath,original.storage);atomicWrite(paths.configPath,original.config);}
          if(stopped&&wasRunning)await admin('/api/control/start',{method:'POST',timeoutMs:180000});
        }catch{throw Error('凭证更新未完成，恢复服务也未成功；原凭证备份保留在 .headless/credential-backups，请检查运行时状态');}
        throw Error('凭证更新未完成，原凭证与配置已保留或恢复，请检查运行时状态');
      }
    }finally{closeSync(fd);unlinkSync(lock);}
  };
}
