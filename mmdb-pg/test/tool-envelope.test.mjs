import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import {createRelay} from '../server.mjs';
import {ANSWER_TOOL,envelopePayload,AnswerEnvelope} from '../anti-truncation.mjs';

const toolPart=(text,name=ANSWER_TOOL)=>{const p=Array(11).fill(null);p[10]=[name,[[['content',[null,null,text]]]]];return p;};
const frame=parts=>[[[[parts,'model']]]];
const end=reason=>[[[null,reason]],null,[2,3,5]];
async function fixture(t){
  const app=createRelay({port:0,apiKey:'mmdb',models:['test'],timeoutMs:2000,maxContinuations:1});
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');t.after(()=>app.close());
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const ws=new WebSocket(base.replace('http:','ws:')+'/api/build/ws',{origin:'https://aistudio.google.com'});
  await once(ws,'open');const registered=once(ws,'message');ws.send(JSON.stringify({type:'register',executorType:'playground',apiKey:'mmdb',clientVersion:'mmdb-1.1.0'}));await registered;
  const call=(extra={},signal)=>fetch(base+'/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer mmdb','Content-Type':'application/json'},body:JSON.stringify({model:'pg-test-抗截断',messages:[{role:'user',content:'answer'}],...extra}),signal});
  const deliver=(id,frames)=>{ws.send(JSON.stringify({type:'stream-chunk',requestId:id,chunkBody:JSON.stringify([frames])}));ws.send(JSON.stringify({type:'stream-end',requestId:id}));};
  return {base,ws,call,deliver};
}

test('tool transport declares an object/string schema, retains system and never mutates input',()=>{
  const body={contents:[{role:'user',parts:[{text:'hi'}]}],systemInstruction:{parts:[{text:'original system'}]}};
  const original=structuredClone(body);const payload=envelopePayload('test',body);
  assert.deepEqual(body,original);assert.ok(payload.binding.startsWith('hi '));assert.ok(payload.binding.includes(ANSWER_TOOL));
  const decl=payload.wire[6][0][1][0];assert.equal(decl[0],ANSWER_TOOL);assert.equal(decl[2][0],6);assert.equal(decl[2][6][0][0],'content');assert.equal(decl[2][6][0][1][0],1);assert.ok(decl[2][6][0][1][2]);assert.deepEqual(decl[2][7],['content']);
  assert.deepEqual(payload.wire[5],[[[null,'original system']],'user']);
  assert.deepEqual(payload.wire[1].at(-1),[[[null,'Submit your complete answer through mmdb_emit_answer. For a long answer, call it multiple times in order, with about 1000 characters per call. Continue until the answer is complete; do not repeat earlier sections or output answer text outside the tool.']],'user']);
});

test('assistant prefill remains intact but the tool request ends on a user delivery turn with matching WAA binding',()=>{
  const body={contents:[{role:'user',parts:[{text:'Write a desktop tidy-up guide.'}]},{role:'model',parts:[{text:'<article>'}]}]};
  const original=structuredClone(body),payload=envelopePayload('test',body),turns=payload.wire[1];
  assert.deepEqual(body,original);assert.equal(turns.length,3);assert.deepEqual(turns[1],[[[null,'<article>']],'model']);assert.equal(turns[2][1],'user');
  assert.ok(turns[2][0][0][1].includes(ANSWER_TOOL));assert.equal(payload.binding,turns.flatMap(turn=>turn[0].map(part=>part[1])).join(' '));
  const again=envelopePayload('test',body);assert.deepEqual(again,payload);
});

test('protobuf tool arguments decode exact Unicode and reject unknown tools and non-string body',()=>{
  const decoder=new AnswerEnvelope();const text='中文 🐈\n"引号" \\ 路径';
  assert.deepEqual(decoder.decode(toolPart(text)[10]),{text});
  assert.throws(()=>decoder.decode(toolPart('bad','unknown')[10]),{code:'unexpected_tool_call'});
  assert.throws(()=>new AnswerEnvelope().decode([ANSWER_TOOL,[[['content',[null,123]]]]]),{code:'invalid_tool_envelope'});
  const streaming=new AnswerEnvelope();assert.equal(streaming.decode([ANSWER_TOOL]),null);assert.deepEqual(streaming.decode([null,[[['content',[null,null,'tail']]]]]),{text:'tail'});
});

test('actual tool frames become ordinary assistant text for streaming and non-streaming callers',async t=>{
  for(const stream of [false,true])await t.test(`stream=${stream}`,async t=>{
    const {base,ws,call,deliver}=await fixture(t);const text='正文 🐾\n保留格式';
    ws.on('message',data=>{const msg=JSON.parse(data);if(msg.type!=='request')return;const payload=JSON.parse(msg.requestBody);assert.equal(payload.wire[6][0][1][0][0],ANSWER_TOOL);deliver(msg.requestId,[frame([toolPart(text)]),end(1)]);});
    const result=await call({stream});assert.equal(result.status,200);
    if(stream){const raw=await result.text();const chunks=raw.split('\n').filter(line=>line.startsWith('data: {')).map(line=>JSON.parse(line.slice(6)));assert.equal(chunks.map(chunk=>chunk.choices[0]?.delta?.content??'').join(''),text);assert.ok(!raw.includes(ANSWER_TOOL));assert.equal((raw.match(/\[DONE\]/g)??[]).length,1);}
    else{const body=await result.json();assert.equal(body.choices[0].message.role,'assistant');assert.equal(body.choices[0].message.content,text);assert.equal(body.choices[0].message.tool_calls,undefined);assert.equal(body.mmdb.transport,'tool-envelope');assert.equal(body.mmdb.toolObserved,true);}
    const status=await(await fetch(base+'/v1/status',{headers:{Authorization:'Bearer mmdb'}})).json();assert.equal(status.recent[0].toolObserved,true);
  });
});

test('tool text reaches SSE before upstream completion and stops without a false DONE on disconnect',async t=>{
  const {ws,call}=await fixture(t);
  ws.on('message',data=>{const msg=JSON.parse(data);if(msg.type!=='request')return;ws.send(JSON.stringify({type:'stream-chunk',requestId:msg.requestId,chunkBody:'[['+JSON.stringify(frame([toolPart('first')]))}));});
  const response=await call({stream:true});const reader=response.body.getReader();const first=new TextDecoder().decode((await reader.read()).value);assert.ok(first.includes('first'));ws.close();
  let rest='';for(;;){const {done,value}=await reader.read();if(done)break;rest+=new TextDecoder().decode(value);}
  assert.ok(rest.includes('error'));assert.ok(!rest.includes('[DONE]'));
});

test('MAX_TOKENS continuation keeps the tool declaration and unwraps each round once',async t=>{
  const {ws,call,deliver}=await fixture(t);let requests=0;
  ws.on('message',data=>{const msg=JSON.parse(data);if(msg.type!=='request')return;requests++;const payload=JSON.parse(msg.requestBody);assert.equal(payload.wire[6][0][1][0][0],ANSWER_TOOL);if(requests===2)assert.ok(payload.binding.includes('first'));deliver(msg.requestId,[frame([toolPart(requests===1?'first':' second')]),end(requests===1?2:1)]);});
  const result=await(await call()).json();assert.equal(result.choices[0].message.content,'first second');assert.equal(result.mmdb.continuations,1);assert.equal(result.mmdb.toolObserved,true);assert.equal(requests,2);
});

test('ordinary model requests contain no tool; unknown/empty tool returns fail explicitly',async t=>{
  const {ws,call,deliver}=await fixture(t);let mode='normal';
  ws.on('message',data=>{const msg=JSON.parse(data);if(msg.type!=='request')return;const payload=JSON.parse(msg.requestBody);
    if(mode==='normal'){assert.equal(payload.wire[6],null);deliver(msg.requestId,[frame([[null,'normal']]),end(1)]);}
    else if(mode==='unknown')deliver(msg.requestId,[frame([toolPart('wrong','unknown')]),end(1)]);
    else{const p=Array(11).fill(null);p[10]=[ANSWER_TOOL];deliver(msg.requestId,[frame([p]),end(1)]);}
  });
  assert.equal((await(await call({model:'pg-test'})).json()).choices[0].message.content,'normal');
  mode='unknown';const unknown=await call();assert.equal(unknown.status,502);assert.equal((await unknown.json()).error.code,'unexpected_tool_call');
  mode='empty';const empty=await call();assert.equal(empty.status,502);assert.equal((await empty.json()).error.code,'empty_tool_envelope');
});

test('plain text never silently substitutes for the selected tool transport',async t=>{
  const {ws,call,deliver}=await fixture(t);
  ws.on('message',data=>{const msg=JSON.parse(data);if(msg.type==='request')deliver(msg.requestId,[frame([[null,'plain-fallback-must-not-leak']]),end(1)]);});
  for(const stream of [false,true]){
    const response=await call({stream});assert.equal(response.status,502);const raw=await response.text();assert.ok(raw.includes('tool_not_used'));assert.ok(!raw.includes('plain-fallback-must-not-leak'));assert.ok(!raw.includes('[DONE]'));
  }
});

test('tool-only mismatch fails and cancels on the first plain body without waiting for upstream end',async t=>{
  const {base,ws,call}=await fixture(t);let cancelled=false;
  ws.on('message',data=>{const msg=JSON.parse(data);if(msg.type==='cancel')cancelled=true;if(msg.type==='request')ws.send(JSON.stringify({type:'stream-chunk',requestId:msg.requestId,chunkBody:'[['+JSON.stringify(frame([[null,'PLAIN_BODY_DO_NOT_LOG']]))}));});
  const response=await call({stream:true});assert.equal(response.status,502);assert.equal((await response.json()).error.code,'tool_not_used');
  const status=await(await fetch(base+'/v1/status',{headers:{Authorization:'Bearer mmdb'}})).json();
  const record=status.recent[0];assert.equal(status.pending,0);assert.equal(record.plainTextChunks,1);assert.equal(record.plainTextChars,'PLAIN_BODY_DO_NOT_LOG'.length);assert.equal(record.toolGuard,'segmented-tool-v2');assert.equal(record.bodyChars,0);assert.equal(record.finishReason,undefined);assert.ok(!JSON.stringify(status).includes('PLAIN_BODY_DO_NOT_LOG'));
  await new Promise(resolve=>setImmediate(resolve));assert.equal(cancelled,true);
});

test('an interrupted open tool string returns an error instead of successful completion',async t=>{
  const {base,ws,call}=await fixture(t);
  ws.on('message',data=>{const msg=JSON.parse(data);if(msg.type!=='request')return;const raw=JSON.stringify([[frame([toolPart('PARTIAL_BODY_THAT_IS_NOT_COMPLETE')]),end(1)]]);const cut=raw.indexOf('PARTIAL_BODY')+7;ws.send(JSON.stringify({type:'stream-chunk',requestId:msg.requestId,chunkBody:raw.slice(0,cut)}));ws.send(JSON.stringify({type:'stream-end',requestId:msg.requestId}));});
  const response=await call({stream:true});const raw=await response.text();assert.ok(!raw.includes('PARTIAL'));assert.ok(raw.includes('invalid_upstream'));assert.ok(!raw.includes('[DONE]'));
  const status=await(await fetch(base+'/v1/status',{headers:{Authorization:'Bearer mmdb'}})).json();assert.equal(status.recent[0].status,'failed');assert.equal(status.recent[0].errorCode,'invalid_upstream');assert.ok(!JSON.stringify(status).includes('PARTIAL'));
});

// The final panel time must use the core request lifetime, including executor wait.
test('settled reports total elapsed time after delayed executor work',async t=>{
  const {ws,call,deliver}=await fixture(t);
  const settled=new Promise(resolve=>ws.on('message',data=>{const message=JSON.parse(data);if(message.type==='settled')resolve(message);}));
  ws.on('message',data=>{const message=JSON.parse(data);if(message.type==='request'){assert.ok(message.elapsedMs>=0);setTimeout(()=>deliver(message.requestId,[frame([toolPart('done')]),end(1)]),55);}});
  assert.equal((await call()).status,200);
  const message=await settled;assert.equal(message.status,'finished');assert.ok(message.elapsedMs>=45);
});

 test('multiple tool calls preserve section order in both client formats',async t=>{
  for(const stream of [false,true])await t.test(`segmented stream=${stream}`,async t=>{
    const {ws,call,deliver}=await fixture(t);
    ws.on('message',data=>{const msg=JSON.parse(data);if(msg.type==='request')deliver(msg.requestId,[frame([toolPart('section one'),toolPart(' section two')]),frame([toolPart(' section three')]),end(1)]);});
    const response=await call({stream});
    if(!stream)assert.equal((await response.json()).choices[0].message.content,'section one section two section three');
    else{
      const text=await response.text();
      const chunks=text.split('\n').filter(line=>line.startsWith('data: {')).map(line=>JSON.parse(line.slice(6)));
      assert.equal(chunks.map(row=>row.choices?.[0]?.delta?.content??'').join(''),'section one section two section three');
    }
  });
});
