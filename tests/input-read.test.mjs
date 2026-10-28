import {test} from 'node:test';
import assert from 'node:assert/strict';
import {InputRead,INPUT_TOOL} from '../src/server/input-read.mjs';
import {toWire} from '../src/server/protocol.mjs';
import {relayFixture,frame,finish,toolPart,usage} from './helpers.mjs';

const input='秘密测试标记：蓝色纸伞 ☂\n请泡一杯茉莉花茶。';
const requestId=payload=>JSON.parse(payload.wire[1][0][0][0][1].match(/request_id ("[^"]+")/)[1]);
const readPart=(id,signature='synthetic-signature')=>{const p=Array(15).fill(null);p[10]=[INPUT_TOOL,[[['request_id',[null,null,id]]]],'call-read'];p[14]=signature;return p;};

test('real read callback binds one snapshot; payload preserves history, signatures, prefill and input',()=>{
  const body={contents:[{role:'user',parts:[{text:'earlier'}]},{role:'model',parts:[{text:'history'}]},{role:'user',parts:[{text:input}]},{role:'model',parts:[{text:'prefill'}]}]};
  const before=structuredClone(body),reader=new InputRead(body,{id:'test-id'}),initial=reader.initialPayload('test');
  assert.ok(!JSON.stringify(initial).includes(input));assert.throws(()=>reader.answerPayload(body,x=>toWire('test',x)));
  reader.decode(readPart(reader.id)[10],{thoughtSignature:'synthetic-signature'});reader.complete('STOP');
  const output=reader.answerPayload(body,x=>toWire('test',x));
  assert.deepEqual(body,before);assert.equal(output.wire[1][0][0][0][1],'earlier');assert.equal(output.wire[1][3][0][0][1],'prefill');
  assert.equal(output.wire[1][4][0][0][14],'synthetic-signature');
  assert.equal(output.wire[1][5][0][0][11][1][0][1][1][2],input);
  assert.ok(!output.binding.includes(input));assert.equal(output.binding,output.wire[1].flatMap(t=>t[0].map(p=>p[1]??'')).join(' '));
  assert.throws(()=>reader.decode(readPart(reader.id)[10]));
});

test('stream and JSON expose only the final reply after an actual input tool round',async t=>{
  for(const stream of [false,true])for(const extended of [false,true])await t.test(`${stream}/${extended}`,async t=>{
    const f=await relayFixture(t,{inputRead:true});let requests=0;
    f.ws.on('message',raw=>{const msg=JSON.parse(raw);if(msg.type!=='request')return;requests++;const p=JSON.parse(msg.requestBody);
      if(requests===1){assert.ok(!JSON.stringify(p).includes(input));f.deliver(msg,[frame([readPart(requestId(p))]),finish()]);}
      else{assert.equal(p.wire[1].filter(turn=>turn[0].some(part=>part[11])).length,1);assert.ok(JSON.stringify(p).includes('蓝色纸伞'));f.deliver(msg,[frame([extended?toolPart('茉莉花茶来了。'):[null,'茉莉花茶来了。']]),finish()]);}
    });
    const response=await f.call({model:extended?'pg-test-抗截断':'pg-test',stream,messages:[{role:'user',content:input}]});assert.equal(response.status,200);const raw=await response.text();assert.ok(raw.includes('茉莉花茶来了。'));assert.ok(!raw.includes('蓝色纸伞'));assert.ok(!raw.includes('synthetic-signature'));assert.equal(requests,2);
    if(stream)assert.equal((raw.match(/\[DONE\]/g)??[]).length,1);else{const value=JSON.parse(raw);assert.equal(value.mmdb.inputReadCompleted,true);assert.equal(value.usage.prompt_tokens,4);assert.equal(value.usage.completion_tokens,6);}
    const s=await f.status();assert.equal(s.pending,0);assert.equal(s.recent[0].inputReadCompleted,true);assert.equal(s.recent[0].inputReadCalls,1);assert.equal(s.recent[0].attempts.length,2);assert.ok(!JSON.stringify(s).includes('蓝色纸伞'));
    assert.deepEqual(s.recent[0].requestCounts,{total:2,inputRead:1,answer:1,continuation:0,retry:0});assert.equal(s.requestTotals.total,2);
  });
});

test('wrong ID, ordinary answer, duplicate calls and incomplete input read never start answer generation',async t=>{
  for(const kind of ['wrong','plain','duplicate','length','no-call'])await t.test(kind,async t=>{
    const f=await relayFixture(t,{inputRead:true});let requests=0;
    f.ws.on('message',raw=>{const msg=JSON.parse(raw);if(msg.type!=='request')return;requests++;const p=JSON.parse(msg.requestBody),id=requestId(p);
      const part=kind==='plain'?[null,'must not leak']:readPart(kind==='wrong'?'wrong-id':id);
      const frames=kind==='no-call'?[]:[frame([part])];if(kind==='duplicate')frames.push(frame([part]));f.deliver(msg,[...frames,finish(kind==='length'?2:1)]);
    });
    const response=await f.call({messages:[{role:'user',content:input}]});assert.equal(response.status,502);assert.ok((await response.json()).error);assert.equal(requests,1);assert.equal((await f.status()).pending,0);
  });
});

test('abort while reading sends cancel and does not start the answer',async t=>{
  const f=await relayFixture(t,{inputRead:true}),controller=new AbortController();let requests=0,cancelled=false;
  f.ws.on('message',raw=>{const m=JSON.parse(raw);if(m.type==='request')requests++;if(m.type==='cancel')cancelled=true;});
  const next=f.nextRequest(),call=f.call({},controller.signal);await next;controller.abort();await assert.rejects(call);
  for(let i=0;i<30&&(await f.status()).pending;i++)await new Promise(r=>setTimeout(r,10));
  assert.equal(requests,1);assert.equal((await f.status()).pending,0);assert.equal(cancelled,true);
});

test('native output continuation keeps the real read history and accounts for the prelude separately',async t=>{
  const f=await relayFixture(t,{inputRead:true,nativeContinuation:true});await f.catalog();let requests=0,initialContents;
  f.ws.on('message',raw=>{const m=JSON.parse(raw);if(m.type!=='request')return;requests++;const p=JSON.parse(m.requestBody);
    if(requests===1)f.deliver(m,[frame([readPart(requestId(p))]),finish(1,undefined,usage(2,3))]);
    else if(requests===2){initialContents=p.wire[1];f.deliver(m,[frame([toolPart('first')]),finish(22,'native-token',usage(10,4))]);}
    else{assert.deepEqual(p.wire[1],initialContents);assert.equal(p.wire[16],'native-token');f.deliver(m,[frame([toolPart(' second')]),finish(1,undefined,usage(10,5))]);}
  });
  const res=await(await f.call({max_tokens:65536})).json();assert.equal(res.choices[0].message.content,'first second');assert.equal(res.usage.prompt_tokens,12);assert.equal(res.usage.completion_tokens,12);assert.equal(res.usage.total_tokens,24);assert.equal(requests,3);
});

test('old clients can change native continuation without disabling input reading',async t=>{
  const f=await relayFixture(t,{inputRead:true});
  const res=await fetch(f.base+'/v1/experiments',{method:'POST',headers:f.headers,body:JSON.stringify({nativeContinuation:true})});
  assert.equal(res.status,200);assert.deepEqual((await res.json()).settings,{nativeContinuation:true,inputRead:true,inputReadSynthetic:false});
});

test('overlapping requests keep tool results isolated even when reads complete in reverse order',async t=>{
  const f=await relayFixture(t,{inputRead:true});const reads=[],results=[];
  f.ws.on('message',raw=>{const msg=JSON.parse(raw);if(msg.type!=='request')return;const p=JSON.parse(msg.requestBody);
    if(!msg.requestId.endsWith('-answer')){
      reads.push({msg,id:requestId(p)});
      if(reads.length===2)for(const read of [...reads].reverse())f.deliver(read.msg,[frame([readPart(read.id)]),finish()]);
    }else{
      const fields=p.wire[1].flatMap(turn=>turn[0]).find(part=>part[11])[11][1][0];
      const values=Object.fromEntries(fields.map(([key,value])=>[key,value[2]]));results.push(values);
      assert.equal(values.request_id,reads.find(read=>read.msg.logicalRequestId===msg.logicalRequestId).id);
      f.deliver(msg,[frame([toolPart(values.input)]),finish()]);
    }
  });
  const values=await Promise.all(['input A','input B'].map(async content=>(await(await f.call({messages:[{role:'user',content}]})).json()).choices[0].message.content));
  assert.deepEqual(values,['input A','input B']);assert.equal(new Set(results.map(r=>r.request_id)).size,2);assert.equal((await f.status()).pending,0);
});

test('a prompt continuation retains one read result and spends only the answer token budget',async t=>{
  const f=await relayFixture(t,{inputRead:true});let requests=0;
  f.ws.on('message',raw=>{const m=JSON.parse(raw);if(m.type!=='request')return;requests++;const p=JSON.parse(m.requestBody);
    if(requests===1)f.deliver(m,[frame([readPart(requestId(p))]),finish(1,undefined,usage(2,900))]);
    else{
      assert.equal(p.wire[1].flatMap(t=>t[0]).filter(part=>part[11]).length,1);
      assert.ok(JSON.stringify(p).includes('蓝色纸伞'));
      if(requests===2)f.deliver(m,[frame([toolPart('第一句。')]),finish(2,undefined,usage(2,10))]);
      else{assert.equal(p.wire[3][3],502);f.deliver(m,[frame([toolPart('接着第二句。')]),finish()]);}
    }
  });
  const result=await(await f.call({max_tokens:512,messages:[{role:'user',content:input}]})).json();
  assert.equal(result.choices[0].message.content,'第一句。接着第二句。');assert.equal(requests,3);assert.equal(result.mmdb.continuations,1);
});

test('timeout in the answer phase cancels its own request and clears the complete flow',async t=>{
  const f=await relayFixture(t,{inputRead:true,maxRequestMs:200});let answer,cancel;
  f.ws.on('message',raw=>{const m=JSON.parse(raw);if(m.type==='cancel')cancel=m.requestId;if(m.type!=='request')return;
    if(m.requestId.endsWith('-answer'))answer=m.requestId;
    else f.deliver(m,[frame([readPart(requestId(JSON.parse(m.requestBody)))]),finish()]);
  });
  const response=await f.call();assert.equal(response.status,504);assert.equal((await response.json()).error.code,'request_deadline');
  await new Promise(resolve=>setTimeout(resolve,20));assert.equal(cancel,answer);assert.ok(answer);assert.equal((await f.status()).pending,0);
});
