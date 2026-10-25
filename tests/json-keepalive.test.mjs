import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {WebSocket} from 'ws';
import {createRelay} from '../src/server/server.mjs';
import {createLANGateway} from '../src/server/lan-gateway.mjs';
import {isMMDBJSONResponse,forwardMMDBJSON} from '../tools/st-json-keepalive.mjs';
import {installSTKeepAlive} from '../tools/install-st-keepalive.mjs';

const request={model:'pg-gemini-test',messages:[{role:'user',content:'hi'}],stream:false};
const frame=text=>[[[[[[null,text]],'model']]]];
const finish=[[[null,1]]];
async function setup(t,extra={}){
  const app=createRelay({apiKey:'test',models:['gemini-test'],timeoutMs:800,streamKeepAliveMs:25,...extra});
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');t.after(()=>app.close());
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const ws=new WebSocket(base.replace('http:','ws:')+'/api/build/ws',{origin:'https://aistudio.google.com'});await once(ws,'open');
  const registered=once(ws,'message');ws.send(JSON.stringify({type:'register',executorType:'playground',apiKey:'test'}));await registered;
  const call=()=>fetch(base+'/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer test','Content-Type':'application/json'},body:JSON.stringify(request)});
  return {app,base,ws,call};
}

test('non-stream sends whitespace before completion, then one valid JSON answer',async t=>{
  const {ws,call}=await setup(t);const received=once(ws,'message');const work=call();const msg=JSON.parse((await received)[0]);
  const response=await work;assert.equal(response.headers.get('x-mmdb-response'),'json-whitespace-v1');
  const reader=response.body.getReader(),decoder=new TextDecoder();let text=decoder.decode((await reader.read()).value);assert.match(text,/^\s+$/);
  ws.send(JSON.stringify({type:'response',requestId:msg.requestId,rawResponse:JSON.stringify([[frame('answer'),finish]])}));
  for(;;){const data=await reader.read();if(data.done)break;text+=decoder.decode(data.value);}
  assert.equal(JSON.parse(text).choices[0].message.content,'answer');assert.doesNotMatch(text,/data:|\[DONE\]/);
});

test('a late error after JSON keepalive remains a valid error object and does not extend deadline',async t=>{
  const {ws,call}=await setup(t,{timeoutMs:170});const received=once(ws,'message');const started=Date.now(),work=call();await received;
  const cancelled=once(ws,'message');const response=await work;assert.equal(response.status,200);const body=await response.json();
  assert.equal(body.error.code,'timeout');assert.ok(Date.now()-started<650);
  assert.equal(JSON.parse((await cancelled)[0]).type,'cancel');
});

test('errors before first heartbeat retain their HTTP error status',async t=>{
  const {ws,call}=await setup(t,{streamKeepAliveMs:1000});
  ws.on('message',raw=>{const msg=JSON.parse(raw);if(msg.type==='request')ws.send(JSON.stringify({type:'error',requestId:msg.requestId,status:429,error:{code:'quota',message:'quota'}}));});
  const response=await call();assert.equal(response.status,429);assert.equal((await response.json()).error.code,'quota');
});

test('client cancellation after a JSON heartbeat still cancels the executor',async t=>{
  const {base,ws}=await setup(t);const controller=new AbortController(),received=once(ws,'message');
  const response=await fetch(base+'/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer test','Content-Type':'application/json'},body:JSON.stringify(request),signal:controller.signal});await received;
  const cancel=once(ws,'message');controller.abort();await assert.rejects(response.text());
  assert.equal(JSON.parse((await cancel)[0]).type,'cancel');const status=await(await fetch(base+'/v1/status',{headers:{Authorization:'Bearer test'}})).json();assert.equal(status.recent[0]?.errorCode,'client_disconnected');
});

test('ST compatibility forwards the real keepalive before the final object, including late errors',async t=>{
  for(const result of [{choices:[{message:{content:'answer'}}]},{error:{code:'timeout',message:'upstream stalled'}}]){
    let release;const held=new Promise(resolve=>release=resolve);
    const upstream=new Response(new ReadableStream({async start(controller){controller.enqueue(new TextEncoder().encode(' \n'));await held;controller.enqueue(new TextEncoder().encode(JSON.stringify(result)));controller.close();}}),{headers:{'Content-Type':'application/json','X-MMDB-Response':'json-whitespace-v1'}});
    const server=http.createServer((req,res)=>{forwardMMDBJSON(upstream,res,new AbortController().signal).catch(()=>res.destroy());});
    server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();server.close();});
    const response=await fetch(`http://127.0.0.1:${server.address().port}`),reader=response.body.getReader(),decoder=new TextDecoder();
    let text=decoder.decode((await reader.read()).value);assert.match(text,/^\s+$/);release();
    for(;;){const data=await reader.read();if(data.done)break;text+=decoder.decode(data.value);}
    assert.deepEqual(JSON.parse(text),result);
    assert.equal(isMMDBJSONResponse(upstream,request),true);
    assert.equal(isMMDBJSONResponse(upstream,{...request,stream:true}),false);
    assert.equal(isMMDBJSONResponse(upstream,{...request,model:'unrelated'}),false);
    assert.equal(isMMDBJSONResponse(new Response('{}',{headers:{'Content-Type':'application/json'}}),request),false);
  }
});

test('ST forwarder propagates a broken body without successful JSON completion',async t=>{
  let breakStream;const upstream=new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode(' \n'));breakStream=()=>controller.error(Error('connection lost'));}}));
  const server=http.createServer((req,res)=>{forwardMMDBJSON(upstream,res,new AbortController().signal).catch(()=>{});});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();server.close();});
  const response=await fetch(`http://127.0.0.1:${server.address().port}`);const body=response.text();breakStream();await assert.rejects(body);
});

test('relay, LAN and ST hops keep a non-streaming HTTP client alive past its idle timeout',async t=>{
  const {app,ws}=await setup(t);let completed=false;
  const gateway=createLANGateway({address:'127.0.0.1',allowedCIDR:'127.0.0.0/8',apiKey:'test',upstreamPort:app.server.address().port});
  gateway.listen(0,'127.0.0.1');await once(gateway,'listening');t.after(()=>{gateway.closeAllConnections();gateway.close();});
  const base=`http://127.0.0.1:${gateway.address().port}`;
  ws.on('message',raw=>{const msg=JSON.parse(raw);if(msg.type!=='request')return;setTimeout(()=>{completed=true;ws.send(JSON.stringify({type:'response',requestId:msg.requestId,rawResponse:JSON.stringify([[frame('delayed answer'),finish]])}));},300);});
  const st=http.createServer(async(req,res)=>{
    try{
      const upstream=await fetch(base+'/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer test','Content-Type':'application/json'},body:JSON.stringify(request)});
      assert.equal(isMMDBJSONResponse(upstream,request),true);await forwardMMDBJSON(upstream,res,new AbortController().signal);
    }catch(error){res.destroy(error);}
  });st.listen(0,'127.0.0.1');await once(st,'listening');t.after(()=>{st.closeAllConnections();st.close();});
  let firstWhilePending=false,chunks=0;
  const text=await new Promise((resolve,reject)=>{
    const client=http.get(`http://127.0.0.1:${st.address().port}`,response=>{
      let body='';response.setEncoding('utf8');response.on('data',chunk=>{chunks++;if(!completed)firstWhilePending=true;body+=chunk;});response.on('end',()=>resolve(body));response.on('error',reject);
    });client.setTimeout(120,()=>client.destroy(Error('test client idle timeout')));client.on('error',reject);
  });
  assert.ok(firstWhilePending);assert.ok(chunks>2);assert.equal(JSON.parse(text).choices[0].message.content,'delayed answer');
});

test('ST installer is guarded, preserves CRLF, and is idempotent',()=>{
  const root=mkdtempSync(join(tmpdir(),'mmdb-st-'));try{
    const dir=join(root,'src/endpoints/backends');mkdirSync(dir,{recursive:true});const file=join(dir,'chat-completions.js');
    const fixture="import fetch from 'node-fetch';\nasync function generate(){\n        console.debug('Chat Completion request:', requestBody);\n        const fetchResponse = await fetch(endpointUrl, config);\n        if (request.body.stream) return response.end();\n}\n".replaceAll('\n','\r\n');writeFileSync(file,fixture);
    assert.equal(installSTKeepAlive(root),'installed');const patched=readFileSync(file,'utf8');assert.ok(patched.includes('isMMDBJSONResponse'));assert.ok(!patched.replaceAll('\r\n','').includes('\n'));
    assert.equal(installSTKeepAlive(root),'already-installed');assert.equal(readFileSync(file,'utf8'),patched);
    writeFileSync(file,fixture+fixture);assert.throws(()=>installSTKeepAlive(root),/唯一定位/);assert.equal(readFileSync(file,'utf8'),fixture+fixture);
  }finally{assert.ok(root.startsWith(join(tmpdir(),'mmdb-st-')));rmSync(root,{recursive:true,force:true});}
});
