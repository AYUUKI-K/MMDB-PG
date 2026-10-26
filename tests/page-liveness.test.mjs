import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {createPageLiveness} from '../src/server/page-liveness.mjs';
import {relayFixture,frame,toolPart,finish} from './helpers.mjs';

test('page replies, not socket pongs, establish liveness; stale replies are rejected and recovery is measured',()=>{
  let time=0,pulse,cleared=false;const messages=[];
  const live=createPageLiveness(m=>messages.push(m),{now:()=>time,schedule:fn=>{pulse=fn;return 1;},cancel:()=>cleared=true});
  const first=messages[0];assert.equal(live.snapshot().state,'checking');
  assert.equal(live.acknowledge({nonce:'forged'}),false);
  time=45000;pulse();assert.equal(messages.length,1);assert.equal(live.snapshot().state,'unresponsive');
  assert.ok(live.acknowledge({...first,visibility:'hidden',keepAlive:'active',secret:'PRIVATE'}));
  assert.deepEqual(live.snapshot(),{state:'responsive',lastResponseMs:0,roundTripMs:45000,visibility:'hidden',keepAlive:'active'});
  time+=15000;pulse();assert.equal(messages.length,2);assert.equal(live.acknowledge(first),false);
  live.destroy();pulse();assert.ok(cleared);assert.equal(messages.length,2);
});

test('new executors negotiate a JS heartbeat, reject other connections and expose only bounded metadata',async t=>{
  const f=await relayFixture(t);
  // Reconnect with heartbeat support and observe the registration and challenge.
  const closed=once(f.ws,'close');f.ws.close();await closed;
  const {WebSocket}=await import('ws');
  const ws=new WebSocket(f.base.replace('http:','ws:')+'/api/build/ws');await once(ws,'open');
  let registration;const ping=new Promise(resolve=>ws.on('message',raw=>{const m=JSON.parse(raw);if(m.type==='registered')registration=m;if(m.type==='page-ping')resolve(m);}));
  ws.send(JSON.stringify({type:'register',executorType:'playground',apiKey:'test',protocolVersion:2,pageHeartbeat:1}));
  const probe=await ping;
  ws.send(JSON.stringify({type:'page-pong',connectionId:'other',nonce:probe.nonce}));
  await delay(15);assert.equal((await f.status()).page.state,'checking');
  ws.send(JSON.stringify({type:'page-pong',connectionId:registration.connectionId,nonce:probe.nonce,visibility:'hidden',keepAlive:'active',url:'PRIVATE'}));
  for(let i=0;i<50&&(await f.status()).page.state!=='responsive';i++)await delay(10);
  const page=(await f.status()).page;assert.equal(page.state,'responsive');assert.equal(page.visibility,'hidden');assert.equal(page.keepAlive,'active');assert.equal(page.url,undefined);
});

test('a detected unresponsive page fails new calls without dispatch or replay, while legacy pages remain compatible',async t=>{
  const f=await relayFixture(t);let time=0,requests=0;
  const owner=[...f.app.wss.clients][0];
  owner.pageLiveness=createPageLiveness(()=>{},{now:()=>time,schedule:()=>1,cancel(){}});
  f.ws.on('message',raw=>{const m=JSON.parse(raw);if(m.type==='request'){requests++;f.deliver(m,[frame([toolPart('once')]),finish()]);}});
  time=45000;
  const failed=await f.call();assert.equal(failed.status,503);assert.equal((await failed.json()).error.code,'executor_unresponsive');assert.equal(requests,0);
  owner.pageLiveness.destroy();owner.pageLiveness=null;
  assert.equal((await f.status()).page.state,'unsupported');assert.equal((await f.call()).status,200);assert.equal(requests,1);
});

test('heartbeat staleness does not cancel, extend or replay an already dispatched generation',async t=>{
  const f=await relayFixture(t);let time=0;
  const owner=[...f.app.wss.clients][0];
  owner.pageLiveness=createPageLiveness(()=>{},{now:()=>time,schedule:()=>1,cancel(){}});
  const dispatched=f.nextRequest(),work=f.call();const request=await dispatched;
  time=45000;assert.equal((await f.status()).page.state,'unresponsive');
  assert.equal((await f.status()).pending,1);
  f.deliver(request,[frame([toolPart('same generation')]),finish()]);
  assert.equal((await(await work).json()).choices[0].message.content,'same generation');
  assert.equal((await f.status()).pending,0);
});
