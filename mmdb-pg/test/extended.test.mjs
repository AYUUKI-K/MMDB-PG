import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {WebSocket} from 'ws';
import {createRelay} from '../server.mjs';
import {createLANGateway} from '../lan-gateway.mjs';
import {readConfig} from '../config.mjs';
const textFrame=text=>[[[[[[null,text]],'model']]]];
const toolFrame=text=>{const part=Array(11).fill(null);part[10]=['mmdb_emit_answer',[[['content',[null,null,text]]]]];return [[[[[part],'model']]]];};
const ending=reason=>[[[null,reason]],null,[3,2,5,null,null,null,null,null,null,1]];
const response=(text,reason=1,tool=true)=>JSON.stringify([[(tool?toolFrame:textFrame)(text),ending(reason)]]);
const body={model:'pg-test-抗截断',messages:[{role:'user',content:'write a test'}]};
async function fixture(t,maxContinuations=2){
  const app=createRelay({port:0,apiKey:'mmdb',models:['test'],timeoutMs:1200,maxContinuations});
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');t.after(()=>app.close());
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const ws=new WebSocket(base.replace('http:','ws:')+'/api/build/ws',{origin:'https://aistudio.google.com'});
  await once(ws,'open');const registered=once(ws,'message');ws.send(JSON.stringify({type:'register',executorType:'playground',apiKey:'mmdb'}));await registered;
  const call=(data=body,signal)=>fetch(base+'/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer mmdb','Content-Type':'application/json'},body:JSON.stringify(data),signal});
  const deliver=(msg,raw)=>{ws.send(JSON.stringify({type:'stream-chunk',requestId:msg.requestId,chunkBody:raw}));ws.send(JSON.stringify({type:'stream-end',requestId:msg.requestId}));};
  return {app,base,ws,call,deliver};
}
test('mmdb default persists, existing keys remain intact, environment overrides are temporary',t=>{
  const dir=mkdtempSync(join(tmpdir(),'mmdb-config-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const file=join(dir,'config.json');
  assert.equal(readConfig(file,{}).apiKey,'mmdb');
  const config=JSON.parse(readFileSync(file,'utf8'));config.apiKey='existing-personal-key';writeFileSync(file,JSON.stringify(config));
  assert.equal(readConfig(file,{}).apiKey,'existing-personal-key');
  assert.equal(readConfig(file,{MMDB_API_KEY:'test',MMDB_PORT:'8767'}).apiKey,'test');
  assert.equal(JSON.parse(readFileSync(file,'utf8')).apiKey,'existing-personal-key');
  assert.throws(()=>readConfig(file,{MMDB_API_KEY:'x'}));
});
test('ordinary models never continue, anti-truncation models continue only after explicit MAX_TOKENS',async t=>{
  for(const stream of [false,true])await t.test(`stream=${stream}`,async t=>{
    const {ws,call,deliver,base}=await fixture(t);let requests=0;
    ws.on('message',data=>{const msg=JSON.parse(data);if(msg.type!=='request')return;requests++;const payload=JSON.parse(msg.requestBody);
      assert.equal(payload.wire[0],'models/test');
      if(requests===2){assert.ok(payload.binding.includes('first'));assert.ok(payload.binding.includes('继续'));}
      deliver(msg,response(requests===1?'first':' second',requests===1?2:1));
    });
    const res=await call({...body,stream});assert.equal(res.status,200);
    if(stream){const raw=await res.text();assert.equal((raw.match(/\[DONE\]/g)||[]).length,1);assert.ok(raw.includes('first'));assert.ok(raw.includes(' second'));assert.ok(!raw.includes('"finish_reason":"length"'));}
    else{const result=await res.json();assert.equal(result.choices[0].message.content,'first second');assert.equal(result.choices[0].finish_reason,'stop');assert.equal(result.mmdb.continuations,1);assert.equal(result.usage.total_tokens,10);}
    assert.equal(requests,2);
    const status=await (await fetch(base+'/v1/status',{headers:{Authorization:'Bearer mmdb'}})).json();assert.equal(status.recent[0].rounds,1);assert.equal(status.recent[0].status,'finished');assert.ok(Object.values(status.recent[0]).every(value=>typeof value!=='string'||!value.includes('first')));
  });
});

test('model lists expose only ordinary and Chinese anti-truncation names in both API formats',async t=>{
  const {base}=await fixture(t);
  const headers={Authorization:'Bearer mmdb'};
  const openai=await(await fetch(base+'/v1/models',{headers})).json();
  assert.deepEqual(openai.data.map(model=>model.id),['pg-test','pg-test-抗截断']);
  const native=await(await fetch(base+'/v1beta/models',{headers})).json();
  assert.deepEqual(native.models.map(model=>model.name),['models/pg-test','models/pg-test-抗截断']);
});

test('Chinese suffix is decoded on the native Gemini endpoint and stripped before dispatch',async t=>{
  const {base,ws,deliver}=await fixture(t);
  ws.on('message',data=>{const msg=JSON.parse(data);if(msg.type!=='request')return;assert.equal(msg.model,'test');assert.equal(JSON.parse(msg.requestBody).wire[0],'models/test');deliver(msg,response('native-ok'));});
  const result=await fetch(base+'/v1beta/models/'+encodeURIComponent('pg-test-抗截断')+':generateContent',{method:'POST',headers:{Authorization:'Bearer mmdb','Content-Type':'application/json'},body:JSON.stringify({contents:[{role:'user',parts:[{text:'hi'}]}]})});
  assert.equal(result.status,200);assert.ok((await result.text()).includes('native-ok'));
});
test('continuation is bounded and exhausted budget retains length finish reason',async t=>{
  const {ws,call,deliver}=await fixture(t,1);let requests=0;
  ws.on('message',data=>{const msg=JSON.parse(data);if(msg.type==='request'){requests++;deliver(msg,response('part',2));}});
  const result=await(await call()).json();assert.equal(requests,2);assert.equal(result.choices[0].finish_reason,'length');assert.equal(result.mmdb.continuations,1);
});
test('normal model and content-blocked long model do not automatically retry',async t=>{
  const {ws,call,deliver}=await fixture(t);let requests=0,blocked=false;
  ws.on('message',data=>{const msg=JSON.parse(data);if(msg.type==='request'){requests++;deliver(msg,blocked?JSON.stringify([[[null,[4,null,'blocked']]]]):response('part',2,false));}});
  const normal=await(await call({...body,model:'pg-test'})).json();assert.equal(normal.choices[0].finish_reason,'length');assert.equal(requests,1);
  blocked=true;const denied=await call();assert.equal(denied.status,400);assert.equal((await denied.json()).error.code,'upstream_prompt_blocked');assert.equal(requests,2);
});
test('cancelling a continuation cancels its current ID and later requests still work',async t=>{
  const {ws,call,deliver,base}=await fixture(t);const controller=new AbortController();let count=0,secondId;let resolveSecond;const second=new Promise(resolve=>resolveSecond=resolve);
  ws.on('message',data=>{const msg=JSON.parse(data);if(msg.type!=='request')return;count++;if(count===1)deliver(msg,response('first',2));else if(count===2){secondId=msg.requestId;resolveSecond();}else deliver(msg,response('next-ok',1,false));});
  const pending=call(body,controller.signal).catch(error=>error);await second;
  const cancelled=once(ws,'message');controller.abort();await pending;assert.equal(JSON.parse((await cancelled)[0]).requestId,secondId);
  assert.equal((await(await fetch(base+'/health')).json()).pending,0);
  deliver({requestId:secondId},response('stale ignored'));
  assert.equal((await(await call({...body,model:'pg-test'})).json()).choices[0].message.content,'next-ok');
});
test('quota RPC code 8 is reported as 429 and never auto-retried',async t=>{
  const {ws,call,deliver}=await fixture(t);let count=0;
  ws.on('message',data=>{const msg=JSON.parse(data);if(msg.type==='request'){count++;deliver(msg,JSON.stringify([null,[8,'Quota limit',[]]]));}});
  const result=await call();assert.equal(result.status,429);assert.equal((await result.json()).error.code,'upstream_quota_exhausted');assert.equal(count,1);
});

test('phone-style LAN cancellation before first output clears core work and permits the next request',async t=>{
  const {ws,deliver,app}=await fixture(t);
  const gateway=createLANGateway({address:'127.0.0.1',allowedCIDR:'127.0.0.0/8',apiKey:'mmdb',upstreamPort:app.server.address().port});
  gateway.listen(0,'127.0.0.1');await once(gateway,'listening');t.after(()=>{gateway.closeAllConnections();gateway.close();});
  const base=`http://127.0.0.1:${gateway.address().port}`;let count=0;
  ws.on('message',data=>{const msg=JSON.parse(data);if(msg.type==='request'&&++count>1)deliver(msg,response('LAN_NEXT_OK',1,false));});
  const controller=new AbortController(),received=once(ws,'message');
  const work=fetch(base+'/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer mmdb','Content-Type':'application/json'},body:JSON.stringify({...body,model:'pg-test'}),signal:controller.signal}).catch(error=>error);
  const first=JSON.parse((await received)[0]);const cancelled=once(ws,'message');controller.abort();await work;
  const cancellation=JSON.parse((await cancelled)[0]);assert.equal(cancellation.type,'cancel');assert.equal(cancellation.requestId,first.requestId);
  const next=await fetch(base+'/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer mmdb','Content-Type':'application/json'},body:JSON.stringify({...body,model:'pg-test'})});
  assert.equal(next.status,200);assert.equal((await next.json()).choices[0].message.content,'LAN_NEXT_OK');
});
