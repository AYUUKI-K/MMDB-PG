const el=id=>document.getElementById(id),id=location.hash.slice(1);
async function api(type){const result=await chrome.runtime.sendMessage({type,id});if(!result?.ok)throw Error(result?.error??'扩展连接失败');return result;}
const say=(message,error=false)=>{el('feedback').textContent=message;el('feedback').dataset.error=String(error);};
async function refresh(){const result=await api('inspect');el('pair').hidden=!result.pending;el('home').hidden=!!result.pending;if(result.pending){el('origin').textContent=result.pending.origin;el('identity').textContent='管理服务标识：'+result.pending.installationId.slice(0,12);}else el('count').textContent=`已连接 ${result.count} 份管理服务`;say('');}
for(const type of ['approve','cancel','forget'])el(type).onclick=async()=>{el(type).disabled=true;try{await api(type);await refresh();say(type==='approve'?'连接完成，请回账号管理页一键导入。':type==='cancel'?'已取消连接。':'已断开连接，账号凭证仍保留在 MMDB。');}catch(error){say(error.message,true);}finally{el(type).disabled=false;}};
refresh().catch(error=>say(error.message,true));
