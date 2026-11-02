import {ApiError} from './errors.mjs';
import {readRuntimeSSE,runtimeError} from './transport.mjs';

export function runtimeInspector(admin){
  return async()=>{
    try{
      const [status,result]=await Promise.all([admin('/api/status',{timeoutMs:3000}),admin('/api/accounts',{timeoutMs:3000})]);
      const enabled=result.accounts.filter(row=>row.enabled);
      const account=enabled.length===1?enabled[0]:null;
      return {online:true,state:status.state,ready:status.ready===true&&!!account&&['ready','busy'].includes(account.state),enabledAccounts:enabled.length,accountState:account?.state??null,accountId:account?.id??null};
    }catch{return {online:false,state:'OFFLINE',ready:false,enabledAccounts:0,accountState:null};}
  };
}
export function assertRuntimeReady(status){
  if(!status.online)throw new ApiError(503,'独立运行时未连接，请运行 npm run headless -- start','headless_offline');
  if(status.enabledAccounts!==1)throw new ApiError(503,'当前验证阶段需要恰好一个启用账号，请在本地管理页调整','headless_single_account_required');
  if(status.accountState==='auth_required')throw new ApiError(401,'账号登录已失效，请在本地管理页重新导入凭证','headless_auth_required');
  if(status.accountState==='cooldown')throw new ApiError(429,'当前账号额度冷却中，请在本地管理页查看状态','upstream_quota_exhausted');
  if(!status.ready)throw new ApiError(503,'独立运行时尚未就绪，请在本地管理页启动生成服务并检查账号状态','headless_not_ready');
}
export async function probeRuntime(settings,model,{fetchImpl=fetch}={}){
  if(typeof model!=='string'||!/^[-a-zA-Z0-9._]{1,160}$/.test(model))throw Error('请指定有效模型名称');
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),180000);
  let content='',finish;
  try{
    const response=await fetchImpl(`${settings.url}/v1beta/models/${model}:streamGenerateContent?alt=sse`,{method:'POST',redirect:'error',headers:{Authorization:`Bearer ${settings.apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({contents:[{role:'user',parts:[{text:'Reply with exactly MMDB_HEADLESS_OK and nothing else.'}]}],generationConfig:{maxOutputTokens:256}}),signal:controller.signal});
    await readRuntimeSSE(response,value=>{if(value.error)throw runtimeError(Number.isInteger(value.error.code)?value.error.code:502);const candidate=value.candidates?.[0];content+=(candidate?.content?.parts??[]).filter(part=>!part.thought).map(part=>part.text??'').join('');finish=candidate?.finishReason??finish;});
    if(finish!=='STOP'||content.trim()!=='MMDB_HEADLESS_OK')throw Error('测试未收到完整的预期回复，尚不能确认直连成功');
    return {ok:true,model,finishReason:finish};
  }catch(error){if(error instanceof TypeError||error.name==='AbortError')throw Error('直连测试连接失败或超时，请检查账号和运行时状态');throw error;}
  finally{clearTimeout(timeout);}
}
export async function importCredentials(admin,cookies,{authUser=0}={}){
  if(typeof cookies!=='string'||!cookies.trim()||Buffer.byteLength(cookies)>900*1024)throw Error('凭证不能为空，且必须小于 900 KiB');
  if(!Number.isSafeInteger(authUser)||authUser<0||authUser>99)throw Error('账号序号无效');
  // v0.2.18 treats label as the account email. An empty label forces server-side
  // session verification; caller-supplied remarks must never bypass that check.
  return admin('/api/accounts/import/cookies',{method:'POST',body:{cookies,label:'',auth_user:authUser,locale:'zh-CN',timezone:'Asia/Shanghai'},timeoutMs:180000});
}
export async function setAccountEnabled(admin,id,enabled){
  if(typeof id!=='string'||!id||id.length>320||typeof enabled!=='boolean')throw Error('账号信息无效');
  const status=await admin('/api/status');
  if(status.active_requests>0)throw Error('请等待生成完成后再切换账号');
  const {accounts}=await admin('/api/accounts');
  const account=accounts.find(row=>row.id===id);if(!account)throw Error('账号不存在');
  if(enabled&&accounts.some(row=>row.id!==id&&row.enabled))throw Error('当前为单账号验证阶段，请先停用其他账号');
  await admin('/api/accounts/'+encodeURIComponent(id),{method:'PUT',body:{label:account.id,enabled,proxy:account.proxy??'',locale:account.locale??'zh-CN',timezone:account.timezone??'Asia/Shanghai'}});
}
