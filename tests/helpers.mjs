import {once} from 'node:events';
import {WebSocket} from 'ws';
import {createRelay} from '../src/server/server.mjs';
import {ANSWER_TOOL} from '../src/server/anti-truncation.mjs';

export const request={model:'pg-test-抗截断',messages:[{role:'user',content:'synthetic fixture'}]};
export const toolPart=(text,name=ANSWER_TOOL)=>{const part=Array(11).fill(null);part[10]=text===undefined?[name]:[name,[[['content',[null,null,text]]]]];return part;};
export const frame=parts=>[[[[parts,'model']]]];
export const usage=(input=2,output=3)=>[input,output,input+output,null,null,null,null,0,null,0];
export function finish(code=1,token,counters=usage()) {
  const candidate=[null,code];if(token!==undefined)candidate[8]=token;
  return [[candidate],null,counters];
}
export function catalogRow({id='test',flags=[10,91],input=262144,output=65536,aliases=[]}={}){
  const row=Array(65).fill(null);row[0]=`models/${id}`;row[3]='Synthetic model';row[5]=input;row[6]=output;row[7]=['generateContent'];row[56]=aliases;row[64]=flags;return row;
}
export async function relayFixture(t,extra={},protocolVersion=2){
  const app=createRelay({apiKey:'test',models:['test'],timeoutMs:1500,toolFirstByteTimeoutMs:1500,queueTimeoutMs:1500,maxContinuations:2,...extra});
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');t.after(()=>app.close());
  const base=`http://127.0.0.1:${app.server.address().port}`,headers={Authorization:'Bearer test','Content-Type':'application/json'};
  const ws=new WebSocket(base.replace('http:','ws:')+'/api/build/ws',{origin:'https://aistudio.google.com'});await once(ws,'open');
  const ready=once(ws,'message');ws.send(JSON.stringify({type:'register',executorType:'playground',apiKey:'test',clientVersion:'mmdb-1.3.0',protocolVersion}));
  const {connectionId}=JSON.parse((await ready)[0]);
  const send=(msg,value)=>ws.send(JSON.stringify({requestId:msg.requestId,logicalRequestId:msg.logicalRequestId,connectionId,attemptIndex:msg.attemptIndex??0,...value}));
  const deliver=(msg,frames)=>{send(msg,{type:'stream-chunk',chunkBody:JSON.stringify([frames])});send(msg,{type:'stream-end'});};
  const call=(body={},signal,path='/v1/chat/completions')=>fetch(base+path,{method:'POST',headers,body:JSON.stringify({...request,...body}),signal});
  const status=async()=>await(await fetch(base+'/v1/status',{headers})).json();
  const catalog=async(rows=[catalogRow()],sessionRevision=0)=>{
    ws.send(JSON.stringify({type:'model-catalog',connectionId,sessionRevision,raw:JSON.stringify([rows])}));
    // WS and HTTP are distinct connections: wait for an observable catalog update.
    for(let i=0;i<50;i++){if((await status()).catalog.state==='ready')return;await new Promise(resolve=>setTimeout(resolve,10));}
    throw Error('catalog was not accepted');
  };
  const nextRequest=()=>new Promise(resolve=>{const handler=raw=>{const msg=JSON.parse(raw);if(msg.type==='request'){ws.off('message',handler);resolve(msg);}};ws.on('message',handler);});
  return {app,base,headers,ws,connectionId,send,deliver,call,status,catalog,nextRequest};
}
