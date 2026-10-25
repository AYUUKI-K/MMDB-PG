import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {relayFixture,request,toolPart,frame,finish,usage} from './helpers.mjs';

test('generation failures never become successful stop/filter responses in either public API',async t=>{
  const f=await relayFixture(t);let code;
  f.ws.on('message',raw=>{const msg=JSON.parse(raw);if(msg.type==='request')f.deliver(msg,[finish(code)]);});
  for(code of [5,6,10,12,13,15,16,18,19,22])for(const native of [false,true]){
    const response=native?await f.call({contents:[{parts:[{text:'fixture'}]}],model:undefined,messages:undefined},undefined,'/v1beta/models/pg-test:generateContent'):await f.call({model:'pg-test'});
    assert.equal(response.status,502,`${code}, native=${native}`);
    const result=await response.json();assert.equal(result.error.code,code===22?'native_continuation_unavailable':'upstream_generation_failed');assert.equal(result.choices,undefined);assert.equal(result.candidates,undefined);
  }
});

test('a late generation failure after heartbeat is an error object or SSE error without DONE',async t=>{
  const f=await relayFixture(t,{streamKeepAliveMs:15});
  for(const stream of [false,true]){
    const dispatched=f.nextRequest(),work=f.call({stream});const msg=await dispatched;
    const response=await work;assert.equal(response.status,200);
    f.deliver(msg,[finish(10)]);
    const raw=await response.text();assert.match(raw,/upstream_generation_failed/);assert.doesNotMatch(raw,/\[DONE\]|"finish_reason":"stop"/);
    if(!stream)assert.equal(JSON.parse(raw).error.code,'upstream_generation_failed');
  }
});

test('mixed tool and ordinary text fails both within one frame and after a tool frame',async t=>{
  const f=await relayFixture(t);let separate;
  f.ws.on('message',raw=>{const msg=JSON.parse(raw);if(msg.type==='request')f.deliver(msg,[...(separate?[frame([toolPart('visible')]),frame([[null,'discarded-tail']])]:[frame([toolPart('visible'),[null,'discarded-tail']])]),finish()]);});
  for(separate of [false,true])for(const stream of [false,true]){
    const response=await f.call({stream}),raw=await response.text();
    assert.match(raw,/mixed_tool_output/);assert.doesNotMatch(raw,/discarded-tail|\[DONE\]|"finish_reason":"stop"/);
    assert.equal((await f.status()).recent[0].status,'failed');
  }
});

test('empty and whitespace tool arguments cannot count as a successful answer',async t=>{
  const f=await relayFixture(t);let text,code;
  f.ws.on('message',raw=>{const msg=JSON.parse(raw);if(msg.type==='request')f.deliver(msg,[frame([toolPart(text)]),finish(code)]);});
  for(text of ['', ' \n\t'])for(code of [1,2]){
    const response=await f.call();assert.equal(response.status,502);assert.equal((await response.json()).error.code,'empty_tool_envelope');
  }
});

test('usage after finish is retained as a snapshot, without counting earlier snapshots twice',async t=>{
  const f=await relayFixture(t);
  f.ws.on('message',raw=>{const msg=JSON.parse(raw);if(msg.type==='request'){
    const early=frame([[null,'answer']]);early[2]=usage(2,1);
    f.deliver(msg,[early,finish(1,undefined,null),[null,null,usage(2,5)]]);
  }});
  for(const stream of [false,true]){
    const response=await f.call({model:'pg-test',stream,stream_options:{include_usage:true}}),raw=await response.text();
    if(stream){assert.match(raw,/"total_tokens":7/);assert.equal((raw.match(/\[DONE\]/g)||[]).length,1);}
    else assert.equal(JSON.parse(raw).usage.total_tokens,7);
    assert.equal((await f.status()).recent[0].usage.totalTokenCount,7);
  }
});

test('finish frame alone does not commit success before the transport closes cleanly',async t=>{
  const f=await relayFixture(t);
  f.ws.on('message',raw=>{const msg=JSON.parse(raw);if(msg.type==='request'){
    f.send(msg,{type:'stream-chunk',chunkBody:JSON.stringify([[frame([[null,'partial']]),finish()]])});
  }});
  const response=await f.call({model:'pg-test',stream:true});f.ws.close();const raw=await response.text();
  assert.match(raw,/executor_disconnected/);assert.doesNotMatch(raw,/\[DONE\]|"finish_reason":"stop"/);
});

test('a completely missing usage round keeps public and diagnostic totals incomplete',async t=>{
  const f=await relayFixture(t);let count=0;
  f.ws.on('message',raw=>{const msg=JSON.parse(raw);if(msg.type==='request'){count++;f.deliver(msg,[frame([toolPart(`part ${count}`)]),finish(count===1?2:1,undefined,count===1?null:usage())]);}});
  const result=await(await f.call()).json(),row=(await f.status()).recent[0];
  assert.equal(count,2);assert.equal(result.usage,undefined);assert.equal(result.mmdb.usageComplete,false);assert.equal(row.usage,undefined);assert.equal(row.usageComplete,false);
});
