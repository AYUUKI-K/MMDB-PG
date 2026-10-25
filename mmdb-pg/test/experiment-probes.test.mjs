import {test} from 'node:test';
import assert from 'node:assert/strict';
import {relayFixture,frame,toolPart,finish} from './helpers.mjs';
import {probePayload} from '../experiment-probes.mjs';
test('probes use fixed prompts and isolate candidate flags from the baseline',()=>{
  const baseline=probePayload('test','tool-auto'),forced=probePayload('test','tool-any');
  assert.deepEqual(baseline.wire[1],forced.wire[1]);assert.deepEqual(baseline.wire[6],forced.wire[6]);assert.equal(baseline.wire[13][1],undefined);assert.equal(forced.wire[13][1][0],2);
  assert.throws(()=>probePayload('test','raw-wire'));
});
test('probe returns shape/timing metadata without body, call ID or continuation token',async t=>{
  const f=await relayFixture(t);
  f.ws.on('message',raw=>{const msg=JSON.parse(raw);if(msg.type!=='request')return;const part=toolPart('PRIVATE_BODY');part[10][2]='PRIVATE_ID';f.deliver(msg,[frame([part]),finish(1,'PRIVATE_TOKEN')]);});
  const r=await fetch(f.base+'/v1/experiments/probe',{method:'POST',headers:f.headers,body:JSON.stringify({model:'test',experiment:'tool-any'})}),result=await r.json();
  assert.equal(result.outcome,'completed');assert.equal(result.argumentFrames,1);assert.equal(result.continuationTokenObserved,true);assert.ok(!JSON.stringify(result).includes('PRIVATE'));assert.equal((await f.status()).pending,0);
});

test('active probes lock generation and settings, cancellation releases the executor',async t=>{
  const f=await relayFixture(t),controller=new AbortController();
  const dispatched=f.nextRequest();
  const work=fetch(f.base+'/v1/experiments/probe',{method:'POST',headers:f.headers,body:JSON.stringify({model:'test',experiment:'tool-auto'}),signal:controller.signal}).catch(()=>null);
  await dispatched;
  assert.equal((await f.call()).status,409);
  assert.equal((await fetch(f.base+'/v1/experiments',{method:'POST',headers:f.headers,body:'{"nativeContinuation":true}'})).status,409);
  const cancelled=new Promise(resolve=>{const handler=raw=>{if(JSON.parse(raw).type==='cancel'){f.ws.off('message',handler);resolve();}};f.ws.on('message',handler);});
  controller.abort();await work;await cancelled;
  assert.equal((await f.status()).pending,0);
  f.ws.on('message',raw=>{const msg=JSON.parse(raw);if(msg.type==='request')f.deliver(msg,[frame([toolPart('after cancellation')]),finish()]);});
  assert.equal((await(await f.call()).json()).choices[0].message.content,'after cancellation');
});

test('a probe with no terminal state cannot report completion',async t=>{
  const f=await relayFixture(t);
  f.ws.on('message',raw=>{const msg=JSON.parse(raw);if(msg.type==='request')f.deliver(msg,[frame([toolPart('partial')])]);});
  const response=await fetch(f.base+'/v1/experiments/probe',{method:'POST',headers:f.headers,body:'{"model":"test","experiment":"tool-any"}'}),result=await response.json();
  assert.equal(result.outcome,'failed');assert.equal(result.errorCode,'probe_incomplete');
});

test('provider generation failures are not successful capability probes',async t=>{
  const f=await relayFixture(t);
  f.ws.on('message',raw=>{const msg=JSON.parse(raw);if(msg.type==='request')f.deliver(msg,[finish(3)]);});
  const result=await(await fetch(f.base+'/v1/experiments/probe',{method:'POST',headers:f.headers,body:'{"model":"test","experiment":"tool-any"}'})).json();
  assert.equal(result.outcome,'failed');assert.equal(result.errorCode,'upstream_generation_failed');
});
