// Use the pinned upstream setup command for Chrome/Windows cryptography. Never
// expose its output or OAuth values to HTTP clients, diagnostic logs or argv.
import {readFileSync,readdirSync,lstatSync,mkdtempSync,rmSync,realpathSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {runtimeExecutable} from './headless-runtime.mjs';

export const chromeOAuthSupported=()=>process.platform==='win32'&&process.arch==='x64';
export function chromeEmail(value){
  if(typeof value!=='string'||!/^[-a-zA-Z0-9.!#$%&'*+/=?^_`{|}~]{1,128}@[a-zA-Z0-9.-]{1,190}$/.test(value.trim()))throw Error('请填写要导入的 Google 账号邮箱');
  return value.trim().toLowerCase();
}
function plain(file,directory=false){const stat=lstatSync(file);if(stat.isSymbolicLink()||(directory?!stat.isDirectory():!stat.isFile()))throw Error('Chrome 导入文件无效');return file;}
function read(file){try{plain(file);if(lstatSync(file).size>2*1024*1024)throw Error();return JSON.parse(readFileSync(file,'utf8'));}catch{throw Error('Chrome 导入文件不可读，未保存 OAuth 材料');}}
export function runChromeSetup(executable,email,directory,{proxy=''}={}){
  const allowed=new Set(['systemroot','windir','systemdrive','userprofile','localappdata','appdata','programfiles','programfiles(x86)','programw6432','path','temp','tmp','http_proxy','https_proxy','all_proxy','no_proxy']);
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>allowed.has(key.toLowerCase())));
  Object.assign(env,{AISTUDIO_AUTH_STATES:join(directory,'auth'),PROXY:proxy,REQUEST_TIMEOUT:'60s',LOG_FILE:'false',REQUEST_BODY_LOG:'false'});
  return new Promise((resolve,reject)=>{
    const child=spawn(executable,['setup','--email',email],{cwd:directory,env,stdio:'ignore',windowsHide:true});
    let timedOut=false;
    const timer=setTimeout(()=>{timedOut=true;child.kill();},120000);
    child.once('error',()=>{clearTimeout(timer);reject(Error('无法启动 Chrome 导入，请检查运行时安装'));});
    child.once('close',code=>{
      clearTimeout(timer);
      if(code===0&&!timedOut)resolve();
      else reject(Error(timedOut?'Chrome 导入超时，请检查 Google 连接后重试':'未能从本机 Chrome 获取有效 OAuth：请在此 Windows 用户的 Chrome 中登录该邮箱，并确认可访问 AI Studio；仅网页登录或 Edge 登录可能没有所需材料'));
    });
  });
}
export function createChromeOAuthImporter({root,admin,importAccount,supported=chromeOAuthSupported(),runSetup=runChromeSetup}){
  return async value=>{
    if(!supported)throw Error('Chrome OAuth 导入目前只支持 Windows x64；其他平台可使用浏览器扩展导入 Cookie');
    const email=chromeEmail(value),executable=runtimeExecutable(root);
    const receipt=read(join(root,'installation.json'));
    if(receipt.version!=='v0.2.18'||createHash('sha256').update(readFileSync(plain(executable))).digest('hex')!==receipt.executableSHA256)throw Error('运行时执行文件与固定版本安装记录不一致，未读取 Chrome');
    const status=await admin('/api/status');
    if(status.active_requests>0||!['RUNNING','STOPPED'].includes(status.state))throw Error('正在生成或启动，请结束后再获取 OAuth');
    const [{accounts},config]=await Promise.all([admin('/api/accounts'),admin('/api/config')]);
    const existing=accounts.find(row=>row.id?.toLowerCase()===email);
    const proxy=existing?.proxy||config.active_proxy||config.proxy||'';
    if(typeof proxy!=='string')throw Error('运行时代理配置无效，未读取 Chrome');
    // root is the existing private runtime directory. Temp files inherit its ACL.
    const base=realpathSync(plain(root,true)),directory=mkdtempSync(join(base,'chrome-oauth-'));
    try{
      await runSetup(executable,email,directory,{proxy});
      const auth=plain(join(directory,'auth'),true),entries=readdirSync(auth,{withFileTypes:true}).filter(entry=>entry.name!=='.leases');
      if(entries.length!==1||!entries[0].isDirectory()||entries[0].isSymbolicLink())throw Error('Chrome 导入未得到唯一账号，未保存凭证');
      const account=plain(join(auth,entries[0].name),true),config=read(join(account,'account.json')),state=read(join(account,'storage-state.json'));
      const extension=state.aistudio2api,source=extension?.source,oauth=extension?.oauth;
      if(config.label?.toLowerCase()!==email||source?.browser!=='chrome'||source.email?.toLowerCase()!==email||typeof source.profile!=='string'||!source.profile||typeof oauth?.gaia_id!=='string'||!/^\d+$/.test(oauth.gaia_id)||typeof oauth.refresh_token!=='string'||!oauth.refresh_token||!Array.isArray(state.cookies)||!state.cookies.length)throw Error('Chrome 未返回该邮箱的完整 OAuth 材料，原凭证保留');
      // Verify the cookie identity separately: setup's stored label is based on
      // Chrome discovery, and must not substitute for Google's actual identity.
      const cookies=JSON.stringify({cookies:state.cookies});
      const checked=await admin('/api/accounts/import/cookies/discover',{method:'POST',body:{cookies,proxy},timeoutMs:180000});
      if(!Array.isArray(checked.accounts)||checked.accounts.length!==1||checked.accounts[0].email?.toLowerCase()!==email||checked.accounts[0].auth_user!==0||checked.accounts[0].signed_out)throw Error('Chrome 与 Google 验证的账号不一致，原凭证保留');
      await importAccount(cookies,{authUser:0,chromeAuth:extension,proxy:existing?.proxy||''});
      return {ok:true,accountId:email};
    }finally{
      // Delete only our newly-created direct child, never a Chrome profile.
      if(dirname(resolve(directory))!==base||realpathSync(plain(directory,true))!==resolve(directory))throw Error('临时凭证目录校验失败，未清理');
      rmSync(directory,{recursive:true,force:true,maxRetries:5,retryDelay:100});
    }
  };
}
