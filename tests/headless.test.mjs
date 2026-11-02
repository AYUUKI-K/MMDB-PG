import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {toWire,fromOpenAI,decodeFrame} from '../src/server/protocol.mjs';
import {envelopePayload,ANSWER_TOOL} from '../src/server/anti-truncation.mjs';
import {InputRead,INPUT_TOOL} from '../src/server/input-read.mjs';
import {headlessRequest,headlessFrame,readRuntimeSSE} from '../src/server/headless-protocol.mjs';
import {validateRuntimeConnection} from '../src/server/headless-executor.mjs';
import {createRelay} from '../src/server/server.mjs';
import {WebSocket} from 'ws';
import {readConfig} from '../src/server/config.mjs';
import {setExecutionBackend,runtimeAdmin,initializeRuntime,readRuntimeSettings} from '../src/server/headless-runtime.mjs';
import {runtimeInspector,assertRuntimeReady,setAccountEnabled,probeRuntime,importCredentials} from '../src/server/headless-operations.mjs';
import {createHeadlessManager} from '../src/server/headless-manager.mjs';
import {verifyRuntimeArchive,runtimeRelease} from '../tools/headless-install.mjs';

const key='synthetic-runtime-key-123456789';
const done=(parts=[{text:'ok'}],finishReason='STOP')=>({candidates:[{index:0,content:{role:'model',parts},finishReason}],usageMetadata:{promptTokenCount:2,candidatesTokenCount:3,thoughtsTokenCount:0,totalTokenCount:5}});
const event=value=>`data: ${JSON.stringify(value)}\n\n`;
async function fixture(t,respond,extra={}){
  const calls=[];
  const runtimeState={state:'RUNNING',ready:true,accounts:[{id:'fixture@example.invalid',enabled:true,state:'ready',models:['test']}]};
  const runtime=http.createServer(async(req,res)=>{
    if(req.url.startsWith('/api/')){
      if(req.url==='/api/auth/login'){res.writeHead(200,{'Content-Type':'application/json','Set-Cookie':'aistudio_admin=synthetic; Path=/api; HttpOnly'});res.end('{}');return;}
      assert.equal(req.headers.cookie,'aistudio_admin=synthetic');res.setHeader('Content-Type','application/json');res.end(JSON.stringify(req.url==='/api/accounts'?{accounts:runtimeState.accounts}:{state:runtimeState.state,ready:runtimeState.ready}));return;
    }
    assert.equal(req.headers.authorization,`Bearer ${key}`);assert.match(req.url,/^\/v1beta\/models\/test:streamGenerateContent\?alt=sse$/);
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const body=JSON.parse(Buffer.concat(chunks));calls.push(body);await respond(req,res,body,calls.length);
  });
  runtime.listen(0,'127.0.0.1');await once(runtime,'listening');
  const app=createRelay({apiKey:'test',models:['test'],timeoutMs:3000,toolFirstByteTimeoutMs:3000,queueTimeoutMs:3000,maxRequestMs:5000,maxContinuations:1,executionBackend:'headless',headless:{url:`http://127.0.0.1:${runtime.address().port}`,apiKey:key},...extra});
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
  t.after(()=>{app.close();app.server.closeAllConnections();runtime.closeAllConnections();runtime.close();});
  const base=`http://127.0.0.1:${app.server.address().port}`,headers={Authorization:'Bearer test','Content-Type':'application/json'};
  return {calls,app,base,headers,runtimeState,call:(body={},signal)=>fetch(base+'/v1/chat/completions',{method:'POST',headers,body:JSON.stringify({model:'pg-test',messages:[{role:'user',content:'synthetic fixture'}],...body}),signal})};
}
function output(res,value){res.writeHead(200,{'Content-Type':'text/event-stream'});res.end(event(value));}

test('wire translation preserves text, tool declarations, nested schemas and tool history',()=>{
  const original=fromOpenAI({messages:[{role:'system',content:'system'},{role:'user',content:'question'},{role:'assistant',content:null,tool_calls:[{id:'call_a',type:'function',function:{name:'lookup',arguments:'{"nested":[true,3,null]}'}}]},{role:'tool',tool_call_id:'call_a',content:'answer'}],tools:[{type:'function',function:{name:'lookup',parameters:{type:'object',properties:{nested:{type:'array',items:{type:'string'},minItems:1,maxItems:3}},required:['nested']}}}],max_tokens:123,temperature:0});
  const converted=headlessRequest(toWire('test',original));
  assert.equal(converted.model,'test');assert.equal(converted.body.systemInstruction.parts[0].text,'system');
  assert.deepEqual(converted.body.contents[1].parts[0].functionCall.args,{nested:[true,3,null]});
  assert.equal(converted.body.contents[2].parts[0].functionResponse.response.result,'answer');
  assert.equal(converted.body.generationConfig.maxOutputTokens,123);assert.equal(converted.body.generationConfig.temperature,0);
  assert.deepEqual(converted.body.tools[0].functionDeclarations[0].parameters.properties.nested,{type:'ARRAY',items:{type:'STRING'},minItems:1,maxItems:3});
});
test('envelope and synthetic input history reach the runtime without loss',()=>{
  const body={contents:[{role:'user',parts:[{text:'private input'}]}]},reader=new InputRead(body,{synthetic:true});
  const result=headlessRequest(reader.answerPayload(body,value=>envelopePayload('test',value)));
  assert.equal(result.body.contents[2].parts[0].functionResponse.response.input,'private input');
  assert.equal(result.body.contents[1].parts[0].thoughtSignature,'skip_thought_signature_validator');
  assert.ok(result.body.tools.flatMap(group=>group.functionDeclarations).some(call=>call.name===ANSWER_TOOL));
});
test('native continuation and unknown wire fields fail explicitly',()=>{
  const payload=toWire('test',{contents:[{parts:[{text:'hello'}]}]});payload.wire[16]='private-token';
  assert.throws(()=>headlessRequest(payload),{code:'headless_protocol_error'});
});
test('response translation preserves unknown usage as unknown and rejects unsupported outputs',()=>{
  const frame=headlessFrame({candidates:[{content:{parts:[{text:'ok'}]},finishReason:'STOP'}],usageMetadata:{promptTokenCount:2}});
  assert.equal(decodeFrame(frame).usageMetadata.thoughtsTokenCount,undefined);
  assert.throws(()=>headlessFrame(done([{inlineData:{data:'private'}}])),{code:'headless_protocol_error'});
  assert.throws(()=>headlessFrame(done([], 'UNRECOGNIZED')),{code:'headless_protocol_error'});
  assert.throws(()=>headlessFrame({error:{code:429,message:'PRIVATE_COOKIE'}}),error=>error.status===429&&!error.message.includes('PRIVATE'));
});
test('SSE handles split CRLF and UTF-8 while rejecting truncated events',async()=>{
  const bytes=new TextEncoder().encode(': ping\r\n\r\n'+event(done([{text:'中文'}])).replaceAll('\n','\r\n'));
  const values=[];
  await readRuntimeSSE(new Response(new ReadableStream({start(controller){for(const byte of bytes)controller.enqueue(new Uint8Array([byte]));controller.close();}}),{headers:{'Content-Type':'text/event-stream'}}),value=>values.push(value));
  assert.equal(values[0].candidates[0].content.parts[0].text,'中文');
  await assert.rejects(readRuntimeSSE(new Response('data: {"candidates":', {headers:{'Content-Type':'text/event-stream'}}),()=>{}),{code:'headless_protocol_error'});
});
for(const stream of [false,true])test(`headless generation works with no browser connection (stream ${stream})`,async t=>{
  const f=await fixture(t,(_req,res)=>output(res,done([{text:'answer'}])));
  const response=await f.call({stream}),raw=await response.text();assert.equal(response.status,200);assert.match(raw,/answer/);
  if(stream)assert.equal(raw.match(/\[DONE\]/g).length,1);
  const status=await(await fetch(f.base+'/v1/status',{headers:f.headers})).json();assert.equal(status.pending,0);assert.equal(status.executionBackend,'headless');assert.equal(status.requestCountScope,'runtime-dispatch');assert.ok(!JSON.stringify(status).includes(key));
});
test('headless mode rejects all browser pages with a distinct code without affecting generation',async t=>{
  const f=await fixture(t,(_req,res)=>output(res,done([{text:'headless remains owner'}])));
  for(const sessionReady of [false,true,true]){
    const ws=new WebSocket(f.base.replace('http:','ws:')+'/api/build/ws');await once(ws,'open');
    const closed=once(ws,'close');ws.send(JSON.stringify({type:'register',executorType:'playground',apiKey:'test',protocolVersion:2,sessionReady,takeoverConnectionId:'headless'}));
    assert.equal((await closed)[0],4009);
  }
  assert.equal((await(await f.call()).json()).choices[0].message.content,'headless remains owner');
});
test('headless envelope and client tools use existing validators',async t=>{
  const f=await fixture(t,(_req,res,body)=>{
    const name=body.tools[0].functionDeclarations[0].name;
    output(res,done([{functionCall:{name,args:name===ANSWER_TOOL?{content:'envelope answer'}:{x:3},id:'call_1'}}]));
  });
  const envelope=await(await f.call({model:'pg-test-抗截断'})).json();assert.equal(envelope.choices[0].message.content,'envelope answer');
  const tools=await(await f.call({tools:[{type:'function',function:{name:'lookup',parameters:{type:'object',properties:{x:{type:'integer'}}}}}]})).json();assert.equal(tools.choices[0].finish_reason,'tool_calls');assert.equal(JSON.parse(tools.choices[0].message.tool_calls[0].function.arguments).x,3);
});
test('headless quota errors are bounded, sanitized and do not replay a partial answer',async t=>{
  const f=await fixture(t,(_req,res)=>{res.writeHead(200,{'Content-Type':'text/event-stream'});res.write(event({candidates:[{content:{parts:[{text:'partial'}]}}]}));res.end(event({error:{code:429,message:'PRIVATE_TOKEN'}}));});
  const response=await f.call({stream:true}),raw=await response.text();assert.match(raw,/partial/);assert.match(raw,/upstream_quota_exhausted/);assert.doesNotMatch(raw,/PRIVATE_TOKEN|\[DONE\]/);assert.equal(f.calls.length,1);
});
test('a missing finish frame is not marked successful',async t=>{
  const f=await fixture(t,(_req,res)=>output(res,{candidates:[{content:{parts:[{text:'incomplete'}]}}]}));
  const response=await f.call();assert.equal(response.status,502);assert.equal((await response.json()).error.code,'incomplete_upstream');
});
test('cancellation aborts the runtime HTTP request and releases the relay task',async t=>{
  let sent,closed;const requested=new Promise(resolve=>sent=resolve),disconnected=new Promise(resolve=>closed=resolve);
  const f=await fixture(t,(_req,res)=>{res.on('close',closed);sent();});
  const controller=new AbortController(),response=f.call({},controller.signal);await requested;controller.abort();await assert.rejects(response);await disconnected;
  for(let i=0;i<20;i++){const status=await(await fetch(f.base+'/v1/status',{headers:f.headers})).json();if(status.pending===0)return;await new Promise(resolve=>setTimeout(resolve,10));}assert.fail('task was not released');
});
test('runtime destinations cannot redirect credentials to a remote host',()=>{
  for(const url of ['https://example.com','http://localhost:1234','http://127.0.0.1:1234/private','http://user:pass@127.0.0.1:1234','http://127.0.0.1:1234/#x'])assert.throws(()=>validateRuntimeConnection({url,apiKey:key}));
  assert.equal(validateRuntimeConnection({url:'http://127.0.0.1:1234',apiKey:key}).url,'http://127.0.0.1:1234');
  assert.throws(()=>verifyRuntimeArchive(Buffer.from('not an executable'),'0'.repeat(64)),/校验失败/);assert.throws(()=>runtimeRelease('android','arm64'),/暂不支持/);
});
test('backend choice survives restart without rewriting unrelated settings',t=>{
  const dir=mkdtempSync(join(tmpdir(),'mmdb-headless-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const file=join(dir,'config.json');
  writeFileSync(file,JSON.stringify({apiKey:'preserved',models:['test'],custom:{x:1}}));setExecutionBackend('headless',file);const config=readConfig(file,{});assert.equal(config.executionBackend,'headless');assert.equal(config.apiKey,'preserved');assert.deepEqual(config.custom,{x:1});setExecutionBackend('browser',file);assert.equal(JSON.parse(readFileSync(file)).executionBackend,'browser');
});
test('manager protects credential import from cross-origin and unauthenticated requests',async t=>{
  let imports=0;const panel=await createHeadlessManager({settings:{},admin:async(path)=>{if(path.includes('import'))imports++;return path==='/api/accounts'?{accounts:[]}:{state:'STOPPED',ready:false};}});t.after(()=>panel.close());
  const url=new URL(panel.url),base=url.origin,key=url.hash.slice(1);
  assert.equal((await fetch(base+'/api/state')).status,401);
  assert.equal((await fetch(base+'/api/import',{method:'POST',headers:{Origin:'https://aistudio.google.com',Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:'{}'})).status,403);
  assert.equal(imports,0);assert.equal((await fetch(base+'/api/state',{headers:{Authorization:`Bearer ${key}`}})).status,200);
});
test('runtime admin authentication does not return upstream credential-bearing error text',async()=>{
  const admin=runtimeAdmin({url:'http://127.0.0.1:1234',apiKey:key,adminPassword:'private'},{fetchImpl:async()=>new Response('PRIVATE_COOKIE',{status:403})});
  await assert.rejects(admin('/api/status'),error=>!error.message.includes('PRIVATE_COOKIE'));
});

test('input read, signed tool history and prompt continuation survive the runtime bridge',async t=>{
  const f=await fixture(t,(_req,res,body,index)=>{
    if(index===1){
      const id=JSON.parse(body.contents[0].parts[0].text.match(/request_id ("[^"]+")/)[1]);
      output(res,done([{functionCall:{name:INPUT_TOOL,args:{request_id:id},id:'read-one'},thoughtSignature:'fixture-signature'}]));return;
    }
    assert.ok(body.contents.some(turn=>turn.parts.some(part=>part.functionCall?.id==='read-one'&&part.thoughtSignature==='fixture-signature')));
    assert.ok(body.contents.some(turn=>turn.parts.some(part=>part.functionResponse?.response.input==='synthetic fixture')));
    if(index===3)assert.equal(body.generationConfig.maxOutputTokens,509);
    output(res,done([{functionCall:{name:ANSWER_TOOL,args:{content:index===2?'第一句。':'接着第二句。'}}}],index===2?'MAX_TOKENS':'STOP'));
  },{inputRead:true});
  const result=await(await f.call({model:'pg-test-抗截断',max_tokens:512})).json();
  assert.equal(result.choices[0].message.content,'第一句。接着第二句。');assert.equal(result.mmdb.inputReadCompleted,true);assert.equal(result.mmdb.continuations,1);assert.equal(result.mmdb.requestCountScope,'runtime-dispatch');
  assert.deepEqual(result.mmdb.requestCounts,{total:3,inputRead:1,answer:1,continuation:1,retry:0});
  const status=await(await fetch(f.base+'/v1/status',{headers:f.headers})).json();assert.equal(status.recent[0].requestCountScope,'runtime-dispatch');assert.doesNotMatch(JSON.stringify(status),/fixture-signature|fixture@example/);
});
test('changing accounts between phases stops the logical request before its next dispatch',async t=>{
  const f=await fixture(t,(_req,res)=>{
    f.runtimeState.accounts[0].id='replacement@example.invalid';
    output(res,done([{functionCall:{name:ANSWER_TOOL,args:{content:'first part'}}}],'MAX_TOKENS'));
  });
  const response=await f.call({model:'pg-test-抗截断',max_tokens:512});assert.equal(response.status,409);assert.equal((await response.json()).error.code,'headless_account_changed');assert.equal(f.calls.length,1);
});
test('multiple enabled accounts, expiry and stopped state cannot appear ready or send a generation',async t=>{
  const f=await fixture(t,(_req,res)=>output(res,done()));
  for(const [change,code] of [
    [()=>f.runtimeState.accounts.push({id:'second',enabled:true,state:'ready'}),'headless_single_account_required'],
    [()=>{f.runtimeState.accounts.pop();f.runtimeState.accounts[0].state='auth_required';},'headless_auth_required'],
    [()=>{f.runtimeState.accounts[0].state='ready';f.runtimeState.ready=false;f.runtimeState.state='STOPPED';},'headless_not_ready']
  ]){
    change();const health=await(await fetch(f.base+'/health')).json();assert.equal(health.executorOnline,false);assert.doesNotMatch(JSON.stringify(health),/example.invalid/);
    assert.equal((await(await f.call()).json()).error.code,code);
  }
  assert.equal(f.calls.length,0);
});
test('native continuation is rejected explicitly before any runtime call',async t=>{
  const f=await fixture(t,(_req,res)=>output(res,done()),{nativeContinuation:true});
  const response=await f.call({model:'pg-test-抗截断'});assert.equal(response.status,400);assert.equal((await response.json()).error.code,'headless_native_continuation_unsupported');assert.equal(f.calls.length,0);
});
test('runtime configuration and local keys persist across initialization',t=>{
  const dir=mkdtempSync(join(tmpdir(),'mmdb-runtime-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const first=initializeRuntime(dir),again=initializeRuntime(dir);
  assert.deepEqual(again,first);assert.deepEqual(readRuntimeSettings(dir),first);
  const env=readFileSync(join(dir,'.env'),'utf8');assert.match(env,/WAA_BACKEND=spidermonkey/);assert.match(env,/LISTEN_ADDR=127\.0\.0\.1:/);assert.match(env,/REQUEST_BODY_LOG=false/);assert.match(env,/FIRST_EVENT_HEDGE=off/);
});
test('management cannot enable a second account or switch during active generation',async()=>{
  let active=1;const updates=[];const admin=async(path,request)=>{
    if(path==='/api/status')return {active_requests:active};
    if(path==='/api/accounts')return {accounts:[{id:'a',enabled:true},{id:'b',enabled:false}]};updates.push(request);
  };
  await assert.rejects(setAccountEnabled(admin,'a',false),/等待生成/);active=0;
  await assert.rejects(setAccountEnabled(admin,'b',true),/先停用/);assert.equal(updates.length,0);
  await setAccountEnabled(admin,'a',false);assert.equal(updates[0].body.enabled,false);
});
test('offline inspection and fixed probe never include upstream secret text',async()=>{
  const status=await runtimeInspector(async()=>{throw Error('PRIVATE');})();assert.equal(status.online,false);assert.throws(()=>assertRuntimeReady(status),{code:'headless_offline'});
  await assert.rejects(probeRuntime({url:'http://127.0.0.1:1234',apiKey:key},'test',{fetchImpl:async()=>new Response('PRIVATE_COOKIE',{status:401})}),error=>error.code==='headless_auth_required'&&!error.message.includes('PRIVATE'));
});

test('cookie import always asks the runtime to verify the session email',async()=>{
  let forwarded;
  await importCredentials(async(path,request)=>{assert.equal(path,'/api/accounts/import/cookies');forwarded=request.body;},'synthetic=value',{authUser:2,label:'unverified@example.invalid'});
  assert.equal(forwarded.label,'');assert.equal(forwarded.auth_user,2);assert.equal(forwarded.cookies,'synthetic=value');
});
