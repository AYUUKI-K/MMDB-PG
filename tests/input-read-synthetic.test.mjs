import {test} from 'node:test';
import assert from 'node:assert/strict';
import {InputRead,INPUT_TOOL} from '../src/server/input-read.mjs';
import {toWire} from '../src/server/protocol.mjs';
import {relayFixture,frame,toolPart,finish} from './helpers.mjs';

const input='合成读取测试：请回复蓝色茶杯。';
const counts={total:1,inputRead:0,answer:1,continuation:0,retry:0};
const resultOf=payload=>payload.wire[1].flatMap(t=>t[0]).find(p=>p[11])?.[11];

test('synthetic history preserves context and per-request identity without recording a real tool call',()=>{
  const body={contents:[{role:'user',parts:[{text:'history'}]},{role:'model',parts:[{text:'earlier answer'}]},{role:'user',parts:[{text:input}]},{role:'model',parts:[{text:'prefill'}]}]};
  const before=structuredClone(body),reader=new InputRead(body,{synthetic:true}),other=new InputRead(body,{synthetic:true});
  const payload=reader.answerPayload(body,b=>toWire('test',b));
  assert.deepEqual(body,before);assert.equal(reader.calls,0);assert.equal(reader.mode,'synthetic');
  assert.notEqual(reader.id,other.id);assert.notEqual(reader.callId,other.callId);
  assert.equal(payload.wire[1][0][0][0][1],'history');assert.equal(payload.wire[1][3][0][0][1],'prefill');
  const call=payload.wire[1][4][0][0];assert.equal(call[10][0],INPUT_TOOL);assert.equal(call[14],'skip_thought_signature_validator');
  assert.equal(call[10][2],resultOf(payload)[2]);assert.ok(JSON.stringify(resultOf(payload)).includes(input));
  assert.ok(!payload.binding.includes(input));assert.equal(payload.binding,payload.wire[1].flatMap(t=>t[0].map(p=>p[1]??'')).join(' '));
});

test('synthetic input uses one generation in plain/tool output and JSON/SSE, with honest usage and counts',async t=>{
  for(const extended of [false,true])for(const stream of [false,true])await t.test(`${extended}/${stream}`,async t=>{
    const f=await relayFixture(t,{inputRead:true,inputReadSynthetic:true});let sent=0;
    f.ws.on('message',raw=>{const m=JSON.parse(raw);if(m.type!=='request')return;sent++;
      const p=JSON.parse(m.requestBody);assert.ok(JSON.stringify(resultOf(p)).includes(input));assert.equal(m.allowNetworkRetry,false);
      for(let i=0;i<2;i++)f.send(m,{type:'progress',phase:'request-sent'}); // Duplicate notification is not a second request.
      f.deliver(m,[frame([extended?toolPart('蓝色茶杯'):[null,'蓝色茶杯']]),finish()]);
    });
    const response=await f.call({model:extended?'pg-test-抗截断':'pg-test',stream,messages:[{role:'user',content:input}]});
    assert.equal(response.status,200);const raw=await response.text();assert.ok(raw.includes('蓝色茶杯'));assert.equal(sent,1);
    if(stream){const events=raw.split('\n').filter(s=>s.startsWith('data: {')).map(s=>JSON.parse(s.slice(6)));assert.deepEqual(events.find(e=>e.mmdb)?.mmdb.requestCounts,counts);}
    else{const result=JSON.parse(raw);assert.deepEqual(result.mmdb.requestCounts,counts);assert.equal(result.mmdb.inputReadMode,'synthetic');assert.equal(result.mmdb.inputReadCompleted,false);assert.equal(result.usage.prompt_tokens,2);}
    const status=await f.status();assert.deepEqual(status.recent[0].requestCounts,counts);assert.equal(status.requestTotals.total,1);
    assert.equal(status.recent[0].inputReadCalls,0);assert.equal(status.recent[0].attempts.length,1);assert.ok(!JSON.stringify(status).includes(input));
  });
});

test('signature rejection consumes one attempt and never falls back to a real read',async t=>{
  const f=await relayFixture(t,{inputRead:true,inputReadSynthetic:true});let sent=0;
  f.ws.on('message',raw=>{const m=JSON.parse(raw);if(m.type!=='request')return;sent++;f.send(m,{type:'progress',phase:'request-sent'});f.deliver(m,[finish(18)]);});
  const response=await f.call();assert.equal(response.status,502);assert.match((await response.json()).error.message,/MISSING_THOUGHT_SIGNATURE/);
  const s=await f.status();assert.equal(sent,1);assert.equal(s.pending,0);assert.equal(s.requestTotals.total,1);assert.deepEqual(s.recent[0].requestCounts,counts);
});

test('synthetic history survives native and prompt continuation without another input read',async t=>{
  for(const native of [false,true])await t.test(String(native),async t=>{
    const f=await relayFixture(t,{inputRead:true,inputReadSynthetic:true,nativeContinuation:native});if(native)await f.catalog();
    let sent=0,original;
    f.ws.on('message',raw=>{const m=JSON.parse(raw);if(m.type!=='request')return;sent++;const p=JSON.parse(m.requestBody);
      if(sent===1)original=resultOf(p);else assert.deepEqual(resultOf(p),original);
      assert.equal(p.wire[1].flatMap(t=>t[0]).filter(p=>p[11]).length,1);assert.equal(m.allowNetworkRetry,false);
      f.deliver(m,[frame([toolPart(sent===1?'第一句。':'第二句。')]),finish(sent===1?(native?22:2):1,sent===1&&native?'next-token':undefined)]);
    });
    const result=await(await f.call({max_tokens:native?100000:512})).json();assert.equal(result.choices[0].message.content,'第一句。第二句。');assert.equal(sent,2);
    assert.deepEqual(result.mmdb.requestCounts,{...counts,total:2,continuation:1});
  });
});

test('synthetic preference is inert when input reading is off and survives old partial settings updates',async t=>{
  const f=await relayFixture(t,{inputRead:false,inputReadSynthetic:true});
  f.ws.on('message',raw=>{const m=JSON.parse(raw);if(m.type!=='request')return;assert.equal(resultOf(JSON.parse(m.requestBody)),undefined);f.deliver(m,[frame([toolPart('ok')]),finish()]);});
  assert.equal((await(await f.call()).json()).mmdb.inputReadMode,'off');
  const response=await fetch(f.base+'/v1/experiments',{method:'POST',headers:f.headers,body:'{"nativeContinuation":true}'});
  assert.equal((await response.json()).settings.inputReadSynthetic,true);
});
