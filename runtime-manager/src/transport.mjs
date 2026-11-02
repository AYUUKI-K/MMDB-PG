import {ApiError} from './errors.mjs';
const invalid=()=>new ApiError(502,'独立运行时返回了不支持或不完整的数据','headless_protocol_error');
export function runtimeError(status){
  const code=status===429?'upstream_quota_exhausted':status===401?'headless_auth_required':status===403?'headless_access_denied':'headless_upstream_error';
  const message=status===429?'独立运行时暂无可用额度，请查看账号冷却状态':status===401?'独立运行时认证或账号登录已失效，请在本地管理页检查':`独立运行时返回 HTTP ${status}，请在本地管理页查看详情`;
  return new ApiError(status>=400&&status<=599?status:502,message,code);
}

export async function readRuntimeSSE(response,onEvent){
  if(!response.ok){await response.body?.cancel();throw runtimeError(response.status);}
  if(!response.body||!/^text\/event-stream(?:;|$)/i.test(response.headers.get('content-type')??'')){await response.body?.cancel();throw invalid();}
  const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});
  let buffer='',bytes=0,complete=false;
  const dispatch=block=>{
    const data=block.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).replace(/^ /,'')).join('\n');
    if(!data||data==='[DONE]')return;
    let value;try{value=JSON.parse(data);}catch{throw invalid();}onEvent(value);
  };
  try{
    for(;;){const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>32*1024*1024)throw invalid();buffer+=decoder.decode(value,{stream:true});buffer=buffer.replace(/\r\n/g,'\n');let end;while((end=buffer.indexOf('\n\n'))>=0){dispatch(buffer.slice(0,end));buffer=buffer.slice(end+2);}}
    buffer+=decoder.decode();if(buffer.trim())throw invalid();complete=true;
  }finally{if(!complete)await reader.cancel().catch(()=>{});reader.releaseLock();}
}
