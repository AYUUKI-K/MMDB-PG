// Pool membership is separate from the upstream enabled flag. Only the leased
// account is enabled upstream: the public Gemini API cannot pin an account.
import {readFileSync,writeFileSync,renameSync,existsSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {ApiError} from './errors.mjs';
import {acquireRuntimeLock,processAlive} from './headless-lock.mjs';
import {createCallDiagnostics} from './call-diagnostics.mjs';

const defaults=()=>({version:1,strategy:'fill-first',autoRecover:true,runWanted:true,members:{},lastByModel:{},sessions:{},switches:0});
const normalized=model=>String(model??'').replace(/^models\//,'');
const validID=id=>typeof id==='string'&&id.length>0&&id.length<=320&&!['__proto__','constructor','prototype'].includes(id);
export function createAccountPool({root,admin,recover,now=Date.now,diagnostics=createCallDiagnostics({root,now})}){
  const file=join(root,'pool.json'),lockFile=join(root,'operation.lock'),completed=new Set();let recoveryFlight;
  mkdirSync(root,{recursive:true,mode:0o700});
  function activity(){try{const rows=JSON.parse(readFileSync(join(root,'pool-activity.json'),'utf8'));return Array.isArray(rows)?rows.slice(-30):[];}catch{return [];}}
  function record(type,model){diagnostics.record(type,{source:'pool',model});try{const rows=activity();rows.push({at:now(),type,...(/^[-a-zA-Z0-9._]{1,160}$/.test(model??'')?{model}:{})});const target=join(root,'pool-activity.json'),temp=target+'.'+randomUUID()+'.tmp';writeFileSync(temp,JSON.stringify(rows.slice(-30)),{mode:0o600});renameSync(temp,target);}catch{}}
  function read(accounts=[]){
    let value=defaults();
    if(existsSync(file)){
      value=JSON.parse(readFileSync(file,'utf8'));if(value.version!==1||!value.members||!value.sessions||!value.lastByModel||!['fill-first','round-robin'].includes(value.strategy))throw Error('账号池配置不可读，请检查本机 pool.json');
    }
    const initial=!existsSync(file);
    for(const row of accounts)if(validID(row.id)&&!Object.hasOwn(value.members,row.id))value.members[row.id]={enabled:initial?row.enabled===true:false,authRequired:false,cooldowns:{}};
    for(const [id,session] of Object.entries(value.sessions))if(!processAlive(session.pid)||session.pid===process.pid&&completed.has(id))delete value.sessions[id];
    return value;
  }
  function save(value){const temp=file+'.'+randomUUID()+'.tmp';writeFileSync(temp,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});renameSync(temp,file);}
  async function runtime(){const [status,result]=await Promise.all([admin('/api/status',{timeoutMs:5000}),admin('/api/accounts',{timeoutMs:5000})]);return {status,accounts:result.accounts};}
  const locked=async(fn,options)=>{const release=await acquireRuntimeLock(lockFile,options);try{return await fn();}finally{release();}};
  function cooldown(member,model){return Math.max(member.cooldowns?.['*']?.until??0,member.cooldowns?.[normalized(model)]?.until??0);}
  function usable(row,member,model){return member?.enabled&&!member.authRequired&&row.state!=='auth_required'&&cooldown(member,model)<=now()&&(!model||!row.models?.length||row.models.map(normalized).includes(normalized(model)));}
  function absorbCooldowns(value,rows){
    for(const row of rows){const member=value.members[row.account_id],until=Date.parse(row.until);if(!member||!Number.isFinite(until)||until<=now()||row.channel&&row.channel!=='playground')continue;
      const scope=normalized(row.model_id||row.scope?.replace(/^playground:/,'')||'*');
      if(until>(member.cooldowns[scope]?.until??0))member.cooldowns[scope]={until,reason:'quota',failures:member.cooldowns[scope]?.failures??0};
    }
  }
  async function summary({privateView=false}={}){
    try{
      const {status,accounts}=await runtime(),value=read(accounts);
      const enabled=accounts.filter(row=>value.members[row.id]?.enabled),ready=enabled.filter(row=>usable(row,value.members[row.id]));
      const deadlines=enabled.flatMap(row=>Object.values(value.members[row.id].cooldowns??{}).map(c=>c.until)).filter(time=>time>now());
      const result={online:true,state:status.state,ready:status.state==='RUNNING'&&status.ready===true&&ready.length>0,enabledAccounts:enabled.length,readyAccounts:ready.length,
        authRequiredAccounts:enabled.filter(row=>value.members[row.id].authRequired||row.state==='auth_required').length,coolingAccounts:enabled.filter(row=>Object.values(value.members[row.id].cooldowns??{}).some(c=>c.until>now())).length,
        activeRequests:Math.max(status.active_requests??0,Object.keys(value.sessions).length),strategy:value.strategy,autoRecover:value.autoRecover,runWanted:value.runWanted,nextRetryAt:deadlines.length?Math.min(...deadlines):null,switches:value.switches};
      if(privateView){result.accounts=accounts.map(row=>{const member=value.members[row.id];return {id:row.id,label:row.label,diagnosticRef:diagnostics.account(row.id),models:row.models,enabled:member.enabled,selected:row.enabled&&member.enabled,
        state:!member.enabled?'disabled':member.authRequired||row.state==='auth_required'?'auth_required':cooldown(member,'')>now()?'cooldown':row.enabled?row.state==='disabled'?'ready':row.state:'standby',
        cooldowns:Object.entries(member.cooldowns??{}).filter(([,entry])=>entry.until>now()).map(([model,entry])=>({model,until:entry.until,reason:entry.reason}))};});result.camoufox=status.camoufox??{ready:false};result.backend=(await admin('/api/config')).waa_backend;result.activity=activity();}
      return result;
    }catch{let settings;try{settings=read();}catch{}return {online:false,state:'OFFLINE',ready:false,enabledAccounts:0,readyAccounts:0,autoRecover:settings?.autoRecover??false,runWanted:settings?.runWanted??false};}
  }
  function idle(status,value){if(status.active_requests>0||Object.keys(value.sessions).length||status.state==='LAUNCHING')throw Error('正在生成或启动，请结束后再修改账号池');}
  async function configure(patch){return locked(async()=>{
    const {status,accounts}=await runtime(),value=read(accounts);idle(status,value);
    if(patch.strategy!==undefined){if(!['fill-first','round-robin'].includes(patch.strategy))throw Error('轮换策略无效');value.strategy=patch.strategy;}
    if(patch.autoRecover!==undefined){if(typeof patch.autoRecover!=='boolean')throw Error('自动恢复设置无效');value.autoRecover=patch.autoRecover;}
    save(value);record('strategy-saved');return summary({privateView:true});
  });}
  async function membership(id,enabled){if(!validID(id)||typeof enabled!=='boolean')throw Error('账号信息无效');return locked(async()=>{
    const {status,accounts}=await runtime(),value=read(accounts);idle(status,value);if(!accounts.some(row=>row.id===id))throw Error('账号不存在');
    value.members[id].enabled=enabled;save(value);record(enabled?'account-enabled':'account-disabled');
    if(!enabled){const row=accounts.find(row=>row.id===id);if(row.enabled)await setRuntimeEnabled(row,false);}
  });}
  async function setRuntimeEnabled(row,enabled){await admin('/api/accounts/'+encodeURIComponent(row.id),{method:'PUT',body:{label:row.label||row.id,enabled,proxy:row.proxy??'',locale:row.locale??'zh-CN',timezone:row.timezone??'Asia/Shanghai'}});}
  async function selectRuntime(accounts,id){
    // Disable others before enabling the target, even after an interrupted import.
    for(const row of accounts)if(row.enabled&&row.id!==id)await setRuntimeEnabled(row,false);
    const chosen=accounts.find(row=>row.id===id);if(!chosen.enabled)await setRuntimeEnabled(chosen,true);
    const verify=await admin('/api/accounts');if(verify.accounts.filter(row=>row.enabled).length!==1||!verify.accounts.some(row=>row.id===id&&row.enabled))throw Error('账号绑定未生效，未发送生成请求');
  }
  async function lease({model,logicalId,preferredId,excluded=new Set(),signal,dispatchId,attempt,stage,retryReason}){
    const context={requestId:logicalId,dispatchId,attempt,stage,model,source:'pool'};
    const release=await acquireRuntimeLock(lockFile,{signal,waitMs:120000});
    try{
      signal?.throwIfAborted();let {status,accounts}=await runtime();const value=read(accounts);
      if(!value.runWanted)throw new ApiError(503,'生成服务已手动停止，请在账号管理中启动','headless_stopped');
      if(status.active_requests>0)throw new ApiError(409,'独立运行时已有其他生成任务','headless_busy');
      try{absorbCooldowns(value,(await admin('/api/cooldowns')).cooldowns??[]);}catch{}
      const candidates=accounts.filter(row=>usable(row,value.members[row.id],model)&&!excluded.has(row.id));
      let chosen;
      if(preferredId){chosen=candidates.find(row=>row.id===preferredId);if(!chosen)throw new ApiError(409,'本轮绑定账号已不可用；为避免重复或跨账号续写，本轮已停止','headless_account_changed');}
      else{
        const last=value.lastByModel[model];chosen=value.strategy==='fill-first'?candidates.find(row=>row.id===last):undefined;
        if(!chosen&&candidates.length){const index=value.strategy==='round-robin'?candidates.findIndex(row=>row.id===last):-1;chosen=candidates[(index+1)%candidates.length];}
      }
      if(!chosen){save(value);const enabled=accounts.filter(row=>value.members[row.id]?.enabled);
        diagnostics.record('pool-unavailable',{...context,reason:enabled.length?'no-eligible-account':'no-enabled-account'});
        throw new ApiError(enabled.length?429:503,enabled.length?'账号池暂无可用账号：请查看登录、模型支持及冷却状态；冷却到期后自动恢复':'账号池没有启用账号，请在账号管理中启用','headless_pool_unavailable');}
      await selectRuntime(accounts,chosen.id);signal?.throwIfAborted();
      if(status.state==='STOPPED'&&value.autoRecover){await admin('/api/control/start',{method:'POST',timeoutMs:180000});status=await admin('/api/status');}
      if(status.state!=='RUNNING')throw new ApiError(503,'独立运行时尚未就绪，请稍后重试','headless_not_ready');
      if(value.lastByModel[model]&&value.lastByModel[model]!==chosen.id){value.switches++;record('account-switch',model);}
      const previous=value.lastByModel[model],reason=retryReason??(preferredId?'continuation-bound':previous===chosen.id?'sticky':value.strategy==='round-robin'?'round-robin':previous?'previous-unavailable':'first-available');
      diagnostics.record('account-selected',{...context,accountId:chosen.id,fromAccountId:previous,reason});
      value.lastByModel[model]=chosen.id;value.sessions[logicalId]={pid:process.pid,accountId:chosen.id};save(value);
      let failureReason;
      return {accountId:chosen.id,release,get failureReason(){return failureReason;},
        async failure(error){
          if(![401,403,429].includes(error.status))return false;
          const member=value.members[chosen.id];
          const current=(await admin('/api/accounts')).accounts.find(row=>row.id===chosen.id);
          if(error.status===401&&current?.state!=='auth_required')return false; // A proxy API-key rejection is not an expired Google login.
          if(current?.state==='auth_required'){member.authRequired=true;}
          else{const previous=member.cooldowns[model],failures=(previous?.failures??0)+1;
            member.cooldowns[model]={until:now()+Math.min(30*60*1000,60000*2**Math.min(failures-1,5)),reason:error.status===429?'quota':'access',failures};
            try{absorbCooldowns(value,(await admin('/api/cooldowns')).cooldowns??[]);}catch{}
          }
          failureReason=member.authRequired?'auth-required':error.status===429?'quota':'access-denied';
          diagnostics.record(member.authRequired?'account-auth-required':'account-cooldown',{...context,accountId:chosen.id,reason:failureReason,httpStatus:error.status,retryAt:member.cooldowns[model]?.until});
          save(value);record(member.authRequired?'login-required':'model-cooldown',model);return true;
        }
      };
    }catch(error){release();throw error;}
  }
  async function finish(logicalId){if(!existsSync(file))return;completed.add(logicalId);try{await locked(()=>{const value=read();delete value.sessions[logicalId];save(value);},{waitMs:3600000});}finally{completed.delete(logicalId);}}
  async function exclusive(fn,{signal,waitMs=0}={}){return locked(async()=>{
    const {status,accounts}=await runtime(),value=read(accounts);idle(status,value);save(value);
    const result=await fn();const fresh=await runtime(),next=read(fresh.accounts);
    // Successful credential refresh clears only the matching account's local failure state.
    const id=result?.account?.id??result?.accountId;
    if(id&&next.members[id]){next.members[id].authRequired=false;next.members[id].cooldowns={};}
    save(next);return result;
  },{signal,waitMs});}
  async function control(start){return locked(async()=>{
    if(start&&recover)await recover();
    const {status,accounts}=await runtime(),value=read(accounts);idle(status,value);value.runWanted=start;save(value);
    if(!start){await admin('/api/control/stop',{method:'POST'});record('service-stopped');return;}
    const chosen=accounts.find(row=>usable(row,value.members[row.id]));if(!chosen)throw Error('请先启用一个可用账号');
    await selectRuntime(accounts,chosen.id);await admin('/api/control/start',{method:'POST',timeoutMs:180000});record('service-started');
  });}
  async function recoverOnce({force=false}={}){
    if(recoveryFlight)return recoveryFlight;
    recoveryFlight=(async()=>{
      const value=read();if(!force&&(!value.autoRecover||!value.runWanted))return;
      await locked(async()=>{const current=read();if(Object.keys(current.sessions).length)return;
        if(recover){const result=await recover();if(result?.started)record('runtime-recovered');}const {status,accounts}=await runtime(),fresh=read(accounts);
        if(status.state==='STOPPED'&&fresh.runWanted){const row=accounts.find(row=>usable(row,fresh.members[row.id]));if(row){record('recovery-started');await selectRuntime(accounts,row.id);await admin('/api/control/start',{method:'POST',timeoutMs:180000});record('recovery-succeeded');}}
        save(fresh);
      });
    })().catch(error=>{if(error.code==='runtime_busy'&&!force)return;record('recovery-failed');throw error;}).finally(()=>recoveryFlight=undefined);return recoveryFlight;
  }
  async function backend(choice){if(!['spidermonkey','camoufox'].includes(choice))throw Error('会话验证后端无效');return exclusive(async()=>{
    const original=await admin('/api/config'),status=await admin('/api/status');if(original.waa_backend===choice)return {ok:true};
    const running=status.state==='RUNNING';
    await admin('/api/control/stop',{method:'POST',timeoutMs:30000});
    try{
      await admin('/api/config',{method:'PUT',body:{...original,waa_backend:choice}});
      if(running){await admin('/api/control/start',{method:'POST',timeoutMs:900000});const current=await admin('/api/status');if(current.state!=='RUNNING'||!current.ready)throw Error('新后端未就绪');}
      record(choice==='camoufox'?'camoufox-enabled':'lightweight-enabled');return {ok:true};
    }catch{
      try{await admin('/api/control/stop',{method:'POST',timeoutMs:30000});await admin('/api/config',{method:'PUT',body:original});if(running)await admin('/api/control/start',{method:'POST',timeoutMs:180000});}
      catch{throw Error('后端切换失败，自动恢复未完成；请检查本机运行时');}
      record('backend-restored');throw Error('新后端未能启动，已恢复原后端；请检查 Camoufox 下载和网络连接');
    }
  });}
  async function login(id){if(id!==undefined&&!validID(id))throw Error('账号信息无效');return exclusive(async()=>{
    if(id){const {accounts}=await runtime();if(!accounts.some(row=>row.id===id))throw Error('账号不存在');}
    return admin(id?'/api/accounts/'+encodeURIComponent(id)+'/login':'/api/accounts',{method:'POST',body:id?{}:{locale:'zh-CN',timezone:'Asia/Shanghai'},timeoutMs:900000});
  });}
  return {summary,configure,membership,lease,finish,exclusive,control,recoverOnce,backend,login,read,diagnostics};
}
