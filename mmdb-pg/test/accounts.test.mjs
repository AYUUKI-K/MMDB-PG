import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import {relayFixture,toolPart,frame,finish} from './helpers.mjs';

async function second(t,f,id='profile-b:0'){
  const ws=new WebSocket(f.base.replace('http:','ws:')+'/api/build/ws');
  await once(ws,'open');const ready=once(ws,'message');
  ws.send(JSON.stringify({type:'register',executorType:'playground',apiKey:'test',clientVersion:'mmdb-1.6.0',protocolVersion:2,accountId:id}));
  const registered=JSON.parse((await ready)[0]);assert.equal(registered.type,'registered');
  const send=(msg,value)=>ws.send(JSON.stringify({requestId:msg.requestId,logicalRequestId:msg.logicalRequestId,connectionId:registered.connectionId,attemptIndex:msg.attemptIndex??0,...value}));
  return {ws,send,deliver:(msg)=>{send(msg,{type:'stream-chunk',chunkBody:JSON.stringify([[frame([toolPart('answer')]),finish()]])});send(msg,{type:'stream-end'});}};
}
const quota={type:'error',status:429,error:{code:'upstream_http_error',message:'Google HTTP 429'}};
test('local accounts alternate independent requests and retain response ownership',async t=>{
  const f=await relayFixture(t),b=await second(t,f);let aCalls=0,bCalls=0;
  f.ws.on('message',raw=>{const m=JSON.parse(raw);if(m.type==='request'){aCalls++;f.deliver(m,[frame([toolPart('answer')]),finish()]);}});
  b.ws.on('message',raw=>{const m=JSON.parse(raw);if(m.type==='request'){bCalls++;b.deliver(m);}});
  for(let i=0;i<4;i++)assert.equal((await f.call()).status,200);
  assert.equal(aCalls,2);assert.equal(bCalls,2);
  assert.equal((await f.status()).accounts.length,2);
});
test('an upstream 429 before data transfers once and ignores former owner output',async t=>{
  const f=await relayFixture(t),b=await second(t,f);let aCalls=0,bCalls=0;
  f.ws.on('message',raw=>{const m=JSON.parse(raw);if(m.type==='request'){aCalls++;f.send(m,quota);f.deliver(m,[frame([toolPart('stale')]),finish()]);}});
  b.ws.on('message',raw=>{const m=JSON.parse(raw);if(m.type==='request'){bCalls++;b.deliver(m);}});
  const res=await f.call();assert.equal(res.status,200);assert.equal((await res.json()).choices[0].message.content,'answer');
  assert.equal((await f.call()).status,200);assert.equal(aCalls,1);assert.equal(bCalls,2);
  const status=await f.status();assert.equal(status.accounts[0].cooldowns[0].model,'test');
  assert.equal(status.recent.at(-1)?.status??status.recent[0]?.status,'finished');
});
test('quota exhaustion stops after all accounts and cooling requests do not call Google',async t=>{
  const f=await relayFixture(t),b=await second(t,f);let calls=0;
  for(const [ws,send] of [[f.ws,f.send],[b.ws,b.send]])ws.on('message',raw=>{const m=JSON.parse(raw);if(m.type==='request'){calls++;send(m,quota);}});
  assert.equal((await f.call()).status,429);assert.equal(calls,2);
  const res=await f.call();assert.equal(res.status,429);assert.equal((await res.json()).error.code,'accounts_unavailable');assert.equal(calls,2);
});
for(const kind of ['network','queue','partial'])test(`${kind} failure does not replay on another account`,async t=>{
  const f=await relayFixture(t),b=await second(t,f);let otherCalls=0;
  b.ws.on('message',raw=>{if(JSON.parse(raw).type==='request')otherCalls++;});
  f.ws.on('message',raw=>{const m=JSON.parse(raw);if(m.type!=='request')return;
    if(kind==='partial')f.send(m,{type:'stream-chunk',chunkBody:'['});
    f.send(m,kind==='network'?{type:'error',status:502,error:{code:'upstream_connection_failed'}}:kind==='queue'?{...quota,error:{code:'executor_busy'}}:quota);
  });
  assert.equal((await f.call()).status,kind==='network'?502:429);assert.equal(otherCalls,0);
});
test('closing one page leaves another account online',async t=>{
  const f=await relayFixture(t),b=await second(t,f);const closed=once(f.ws,'close');f.ws.close();await closed;
  b.ws.on('message',raw=>{const m=JSON.parse(raw);if(m.type==='request')b.deliver(m);});
  assert.equal((await f.call()).status,200);assert.equal((await f.status()).accounts.length,1);
});
test('same profile account cannot occupy two pool slots',async t=>{
  const f=await relayFixture(t);await second(t,f,'same-profile:1');
  const ws=new WebSocket(f.base.replace('http:','ws:')+'/api/build/ws');await once(ws,'open');const closed=once(ws,'close');
  ws.send(JSON.stringify({type:'register',executorType:'playground',apiKey:'test',accountId:'same-profile:1'}));
  assert.equal((await closed)[0],4008);
});

test('quota cooldown follows an account across reconnection and expires',async t=>{
  const f=await relayFixture(t,{accountCooldownMs:180}),b=await second(t,f,'stable-b:0');let calls=0;
  f.ws.on('message',raw=>{const m=JSON.parse(raw);if(m.type==='request')f.deliver(m,[frame([toolPart('answer')]),finish()]);});
  b.ws.on('message',raw=>{const m=JSON.parse(raw);if(m.type==='request'){calls++;b.send(m,quota);}});
  assert.equal((await f.call()).status,200);assert.equal((await f.call()).status,200);assert.equal(calls,1);
  const closed=once(b.ws,'close');b.ws.close();await closed;
  const reconnected=await second(t,f,'stable-b:0');let resumed=0;
  reconnected.ws.on('message',raw=>{const m=JSON.parse(raw);if(m.type==='request'){resumed++;reconnected.deliver(m);}});
  assert.equal((await f.call()).status,200);assert.equal(resumed,0);
  await new Promise(resolve=>setTimeout(resolve,200));
  assert.equal((await f.call()).status,200);assert.equal(resumed,1);
});

test('quota cooldown applies to the failing model rather than every model',async t=>{
  const f=await relayFixture(t),b=await second(t,f);let other=0;
  for(const [ws,send,deliver] of [[f.ws,f.send,m=>f.deliver(m,[frame([toolPart('answer')]),finish()])],[b.ws,b.send,b.deliver]])ws.on('message',raw=>{
    const m=JSON.parse(raw);if(m.type!=='request')return;
    if(m.model==='test')send(m,quota);else{other++;deliver(m);}
  });
  assert.equal((await f.call()).status,429);
  assert.equal((await f.call({model:'pg-other-抗截断'})).status,200);assert.equal(other,1);
});

test('account failover retains the original logical request deadline',async t=>{
  const f=await relayFixture(t,{maxRequestMs:140}),b=await second(t,f);let bRequest;
  f.ws.on('message',raw=>{const m=JSON.parse(raw);if(m.type==='request')setTimeout(()=>f.send(m,quota),80);});
  b.ws.on('message',raw=>{const m=JSON.parse(raw);if(m.type==='request')bRequest=m;});
  const started=Date.now(),res=await f.call();assert.equal(res.status,504);
  assert.equal((await res.json()).error.code,'request_deadline');assert.ok(bRequest);assert.ok(Date.now()-started<220);
  assert.equal((await f.status()).pending,0);
});
