import {COOKIE_URL,hex,localOrigin,validTicket,ticketText} from './protocol.mjs';

export async function verifyTicket(ticket,origin,secret,cryptoImpl=crypto,now=Date.now()){
  if(!hex(secret)||!validTicket(ticket,origin,now))return false;
  const bytes=value=>Uint8Array.from(value.match(/../g),v=>parseInt(v,16));
  const key=await cryptoImpl.subtle.importKey('raw',bytes(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  return cryptoImpl.subtle.verify('HMAC',key,bytes(ticket.proof),new TextEncoder().encode(ticketText(ticket)));
}
export function cookieHeader(cookies){
  const selected=new Map();
  for(const cookie of cookies){
    if(!['google.com','aistudio.google.com'].includes(cookie.domain?.replace(/^\./,''))||cookie.partitionKey)continue;
    if(!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(cookie.name)||typeof cookie.value!=='string'||/[;\r\n\0]/.test(cookie.value))continue;
    if(!selected.has(cookie.name))selected.set(cookie.name,cookie.value);
  }
  if(!selected.size)throw Error('未找到 Google 登录 Cookie，请在当前浏览器登录 AI Studio 后重试');
  return [...selected].map(([name,value])=>`${name}=${value}`).join('; ');
}
export function createCaptureClient({getConnection,claim,getCookies,fetchImpl=fetch,cryptoImpl=crypto,now=Date.now}){
  const inFlight=new Set();
  return async(ticket,sender)=>{
    const origin=sender?.origin??new URL(sender?.url).origin;
    if(!localOrigin(origin)||sender.frameId!==0||sender.tab?.incognito)throw Error('只允许本机账号管理页面发起抓取');
    const connection=await getConnection(ticket?.installationId);
    if(!connection||!await verifyTicket(ticket,origin,connection.secret,cryptoImpl,now()))throw Error('扩展尚未连接此管理服务，请先点击连接扩展');
    if(inFlight.has(ticket.token))throw Error('该抓取请求已使用，请重新点击抓取');
    inFlight.add(ticket.token);
    try{
      await claim(ticket);
      const cookies=cookieHeader(await getCookies({url:COOKIE_URL}));
      let response;
      try{response=await fetchImpl(ticket.origin+'/api/browser/import',{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+ticket.token,'Content-Type':'application/json'},body:JSON.stringify({cookies}),signal:AbortSignal.timeout(15000)});}
      catch{throw Error('本机管理服务连接失败，请重新打开菜单 11');}
      if(!response.ok){await response.body?.cancel();throw Error('本机管理服务未接受凭证，请重新点击抓取');}
      // Cookies never leave this function through messaging, storage, or logs.
      return {ok:true,submitted:true};
    }finally{inFlight.delete(ticket.token);}
  };
}
