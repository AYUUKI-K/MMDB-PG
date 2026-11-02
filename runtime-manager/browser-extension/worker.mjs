import {createCaptureClient} from './capture.mjs';
import {hex,localOrigin} from './protocol.mjs';

const connections=async()=>(await chrome.storage.local.get('connections')).connections??{};
const capture=createCaptureClient({
  getConnection:async id=>(await connections())[id],
  getCookies:details=>chrome.cookies.getAll(details),
  claim:async ticket=>{
    const previous=(await chrome.storage.session.get('used')).used??{};
    if(previous[ticket.token])throw Error('该抓取请求已使用，请重新点击抓取');
    const used=Object.fromEntries(Object.entries(previous).filter(([,expires])=>expires>Date.now()));
    used[ticket.token]=ticket.expiresAt;await chrome.storage.session.set({used});
  }
});
async function external(message,sender){
  let origin;try{origin=new URL(sender.url).origin;}catch{throw Error('无效来源');}
  if(!localOrigin(origin)||sender.frameId!==0||sender.tab?.incognito)throw Error('仅接受本机管理页请求');
  if(message?.type==='status'){const pending=(await chrome.storage.session.get('pendingPair')).pendingPair;return {ok:true,paired:!!(await connections())[message.installationId],pending:pending?.installationId===message.installationId&&pending.expiresAt>Date.now()};}
  if(message?.type==='capture')return capture(message.ticket,sender);
  if(message?.type==='pair'){
    const pair=message.pair;
    if(pair?.version!==1||!hex(pair.installationId)||!hex(pair.secret)||pair.origin!==origin)throw Error('连接请求无效');
    const current=(await chrome.storage.session.get('pendingPair')).pendingPair;
    if(current?.expiresAt>Date.now())throw Error('已有连接确认窗口，请先处理该窗口');
    const id=crypto.randomUUID();await chrome.storage.session.set({pendingPair:{...pair,id,expiresAt:Date.now()+180000}});
    await chrome.windows.create({url:chrome.runtime.getURL('connect.html')+'#'+id,type:'popup',width:500,height:490});
    return {ok:true,pending:true};
  }
  throw Error('未知操作');
}
chrome.runtime.onMessageExternal.addListener((message,sender,respond)=>{
  external(message,sender).then(respond,error=>respond({ok:false,error:error.message}));return true;
});
async function internal(message,sender){
  if(sender.id!==chrome.runtime.id||sender.url?.split('#')[0]!==chrome.runtime.getURL('connect.html'))throw Error('无效来源');
  if(message.type==='forget'){await chrome.storage.local.remove('connections');return {ok:true};}
  const pending=(await chrome.storage.session.get('pendingPair')).pendingPair;
  const valid=pending?.id===message.id&&pending.expiresAt>Date.now();
  if(message.type==='inspect')return {ok:true,count:Object.keys(await connections()).length,pending:valid?{origin:pending.origin,installationId:pending.installationId}:null};
  if(!valid)throw Error('连接请求已过期，请回管理页重新连接');
  if(message.type==='approve'){
    const saved=await connections();saved[pending.installationId]={secret:pending.secret};await chrome.storage.local.set({connections:saved});
  }else if(message.type!=='cancel')throw Error('未知操作');
  await chrome.storage.session.remove('pendingPair');return {ok:true};
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  internal(message,sender).then(respond,error=>respond({ok:false,error:error.message}));return true;
});
