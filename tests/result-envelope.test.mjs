import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {relayFixture,frame,finish,toolPart} from './helpers.mjs';
import {InputRead,INPUT_TOOL} from '../src/server/input-read.mjs';
import {envelopePayload,ANSWER_TOOL} from '../src/server/anti-truncation.mjs';
import {decodeStruct} from '../src/server/external-tools.mjs';
import {headlessRequest} from '../src/server/headless-protocol.mjs';
import {readConfig,saveExperimentalConfig} from '../src/server/config.mjs';

const result='<table-update>\n{"rows":[["茶 🐈",2]],"text":"a\\b"}\n</table-update>';
const events=raw=>raw.split('\n').filter(line=>line.startsWith('data: {')).map(line=>JSON.parse(line.slice(6)));
const answer=(data,google,stream)=>google?data.candidates?.[0]?.content?.parts.filter(p=>!p.thought).map(p=>p.text??'').join('')??'':data.choices?.[0]?.[stream?'delta':'message']?.content??'';
const call=(f,{google=false,stream=false,model='pg-test'}={})=>google?fetch(`${f.base}/v1beta/models/${encodeURIComponent(model)}:${stream?'streamGenerateContent':'generateContent'}`,{method:'POST',headers:f.headers,body:JSON.stringify({contents:[{role:'user',parts:[{text:'task'}]}]})}):f.call({model,stream});

for(const outputEnvelope of ['auto','required'])for(const google of [false,true])for(const stream of [false,true]){
  test(`ordinary result envelope preserves exact task output (${outputEnvelope}, Gemini=${google}, stream=${stream})`,async t=>{
    const f=await relayFixture(t,{outputEnvelope});let requests=0;
    f.ws.on('message',raw=>{const msg=JSON.parse(raw);if(msg.type!=='request')return;requests++;
      const payload=JSON.parse(msg.requestBody);
      assert.equal(payload.wire[6][0][1][0][0],ANSWER_TOOL);
      assert.match(JSON.stringify(payload.wire[5]),/JSON、表格更新指令/);
      assert.equal(payload.wire[13][1],undefined); // No speculative PG force field.
      f.deliver(msg,[frame([toolPart(result)]),finish()]);
    });
    const response=await call(f,{google,stream});assert.equal(response.status,200);
    const raw=await response.text(),data=stream?events(raw):[JSON.parse(raw)];
    assert.equal(data.map(row=>answer(row,google,stream)).join(''),result);assert.equal(requests,1);
    const row=(await f.status()).recent[0];assert.equal(row.outputKind,'tool');assert.equal(row.outputDelivery,'complete');assert.equal(row.continuationMode,'none');
  });
}

for(const stream of [false,true])test(`auto accepts only complete plain answers; required and anti-truncation remain strict (${stream})`,async t=>{
  const f=await relayFixture(t,{outputEnvelope:'auto'});
  f.ws.on('message',raw=>{const msg=JSON.parse(raw);if(msg.type==='request')f.deliver(msg,[frame([[null,result]]),finish()]);});
  const response=await call(f,{stream});assert.equal(response.status,200);
  const raw=await response.text();assert.equal((stream?events(raw):[JSON.parse(raw)]).map(row=>answer(row,false,stream)).join(''),result);
  assert.equal((await f.status()).recent[0].outputKind,'plain');
  assert.equal((await call(f,{stream,model:'pg-test-抗截断'})).status,502);
  await fetch(f.base+'/v1/experiments',{method:'POST',headers:f.headers,body:'{"outputEnvelope":"required"}'});
  const rejected=await call(f,{stream});assert.equal(rejected.status,502);assert.equal((await rejected.json()).error.code,'tool_not_used');
});

test('complete delivery rejects invalid/mixed/truncated results without leaking buffered text or retrying',async t=>{
  const plain=frame([[null,'PRIVATE_PLAIN']]),tool=frame([toolPart('PRIVATE_TOOL')]);
  for(const [name,frames,code] of [
    ['plain then tool',[plain,tool,finish()],'mixed_tool_output'],
    ['tool then plain',[tool,plain,finish()],'mixed_tool_output'],
    ['same frame',[frame([[null,'PRIVATE_PLAIN'],toolPart('PRIVATE_TOOL')]),finish()],'mixed_tool_output'],
    ['empty',[finish()],'empty_tool_envelope'],
    ['name only',[frame([toolPart()]),finish()],'empty_tool_envelope'],
    ['unknown',[frame([toolPart('PRIVATE_TOOL','wrong')]),finish()],'unexpected_tool_call'],
    ['multiple',[frame([toolPart('PRIVATE_TOOL'),toolPart('PRIVATE_TOOL')]),finish()],'multiple_tool_calls'],
    ['length tool',[tool,finish(2)],'incomplete_tool_output'],
    ['length plain',[plain,finish(2)],'incomplete_tool_output'],
    ['safety',[tool,finish(3)],'incomplete_tool_output'],
    ['missing finish',[tool],'incomplete_upstream'],
    ['duplicate finish',[tool,finish(),finish()],'invalid_upstream'],
  ])await t.test(name,async t=>{
    const f=await relayFixture(t,{outputEnvelope:'auto'});let count=0;
    f.ws.on('message',raw=>{const msg=JSON.parse(raw);if(msg.type==='request'){count++;f.deliver(msg,frames);}});
    for(const stream of [false,true]){
      const response=await call(f,{stream}),raw=await response.text();assert.equal(response.status,502);assert.equal(JSON.parse(raw).error.code,code);
      assert.doesNotMatch(raw,/PRIVATE|\[DONE\]/);
    }
    assert.equal(count,2);assert.equal((await f.status()).pending,0);
  });
});

test('complete mode sends only heartbeats until transport completion, including late failures',async t=>{
  for(const success of [false,true])await t.test(String(success),async t=>{
    const f=await relayFixture(t,{outputEnvelope:'required',streamKeepAliveMs:10}),next=f.nextRequest();
    const work=call(f,{stream:true}),msg=await next;
    f.send(msg,{type:'stream-chunk',chunkBody:'[['+JSON.stringify(frame([toolPart('BUFFERED_RESULT')]))+','});
    const response=await work,reader=response.body.getReader();
    const first=new TextDecoder().decode((await reader.read()).value);assert.match(first,/: mmdb-waiting/);assert.doesNotMatch(first,/BUFFERED_RESULT|content|DONE/);
    if(success){f.send(msg,{type:'stream-chunk',chunkBody:JSON.stringify(finish())+']]'});f.send(msg,{type:'stream-end'});}
    else f.send(msg,{type:'error',status:502,error:{code:'late_failure',message:'synthetic disconnect'}});
    let raw='';for(;;){const part=await reader.read();if(part.done)break;raw+=new TextDecoder().decode(part.value);}
    if(success){assert.match(raw,/BUFFERED_RESULT/);assert.match(raw,/\[DONE\]/);}
    else{assert.match(raw,/late_failure/);assert.doesNotMatch(raw,/BUFFERED_RESULT|\[DONE\]/);assert.equal((await f.status()).recent[0].firstClientTextMs,undefined);}
  });
});

test('complete anti-truncation retains prompt/native continuation and commits only after final STOP',async t=>{
  for(const nativeContinuation of [false,true])for(const fail of [false,true])await t.test(`${nativeContinuation}/${fail}`,async t=>{
    const f=await relayFixture(t,{outputEnvelope:'auto',completeToolOutput:true,nativeContinuation});if(nativeContinuation)await f.catalog();let requests=0;
    f.ws.on('message',raw=>{const msg=JSON.parse(raw);if(msg.type!=='request')return;requests++;
      if(requests===1)f.deliver(msg,[frame([toolPart('FIRST_RESULT')]),finish(nativeContinuation?22:2,nativeContinuation?'next':undefined)]);
      else if(fail)f.send(msg,{type:'error',status:429,error:{message:'quota',code:'upstream_quota_exhausted'}});
      else f.deliver(msg,[frame([toolPart('SECOND_RESULT')]),finish()]);
    });
    const response=await f.call({stream:true,max_tokens:nativeContinuation?65536:512}),raw=await response.text();assert.equal(requests,2);
    if(fail){assert.doesNotMatch(raw,/FIRST_RESULT|SECOND_RESULT|\[DONE\]/);assert.match(raw,/upstream_quota_exhausted/);}
    else{assert.equal(events(raw).map(row=>answer(row,false,true)).join(''),'FIRST_RESULTSECOND_RESULT');assert.equal((await f.status()).recent[0].rounds,1);}
  });
  const f=await relayFixture(t,{completeToolOutput:true,maxContinuations:0});
  f.ws.on('message',raw=>{const msg=JSON.parse(raw);if(msg.type==='request')f.deliver(msg,[frame([toolPart('PRIVATE_LIMIT')]),finish(2)]);});
  const response=await f.call();assert.equal(response.status,502);assert.equal((await response.json()).error.code,'incomplete_tool_output');
});

test('cancel while output is buffered cancels its own task without publishing or replaying it',async t=>{
  const f=await relayFixture(t,{outputEnvelope:'auto',streamKeepAliveMs:10}),controller=new AbortController(),next=f.nextRequest();let count=0;
  f.ws.on('message',raw=>{if(JSON.parse(raw).type==='request')count++;});
  const work=f.call({model:'pg-test',stream:true},controller.signal),msg=await next;
  f.send(msg,{type:'stream-chunk',chunkBody:'[['+JSON.stringify(frame([toolPart('PRIVATE_CANCEL')]))+','});
  const response=await work,reader=response.body.getReader();await reader.read();controller.abort();await assert.rejects(reader.read());
  for(let i=0;i<30&&(await f.status()).pending;i++)await new Promise(resolve=>setTimeout(resolve,10));
  const status=await f.status();assert.equal(status.pending,0);assert.equal(status.recent[0].status,'cancelled');assert.equal(status.recent[0].firstClientTextMs,undefined);assert.equal(count,1);
});

test('grouped input preserves media, system instructions and prefill without mutating source or duplicating history',()=>{
  const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=';
  const body={systemInstruction:{parts:[{text:'SYSTEM_STAYS_SYSTEM'}]},contents:[{role:'user',parts:[{text:'old'}]},{role:'model',parts:[{text:'history'}]},{role:'user',parts:[{text:'INPUT_A'},{inlineData:{mimeType:'image/png',data:png}}]},{role:'user',parts:[{text:'INPUT_B'}]},{role:'model',parts:[{text:'prefill'}]}]};
  const before=structuredClone(body);
  for(const synthetic of [false,true])for(const scope of ['last','turn']){
    const read=new InputRead(body,{synthetic,scope});
    if(!synthetic){read.decode([INPUT_TOOL,[[['request_id',[null,null,read.id]]]],'read-id'],{thoughtSignature:'real-signature'});read.complete('STOP');}
    const payload=read.answerPayload(body,b=>envelopePayload('test',b)),converted=headlessRequest(payload).body;
    const pairs=converted.contents.flatMap(turn=>turn.parts).filter(part=>part.functionResponse);
    assert.equal(pairs.length,1);assert.equal(pairs[0].functionResponse.response.input,scope==='turn'?'INPUT_A\n\nINPUT_B':'INPUT_B');
    assert.equal(read.turns,scope==='turn'?2:1);assert.deepEqual(body,before);
    assert.equal(converted.contents.flatMap(turn=>turn.parts).filter(part=>part.inlineData).length,1);
    assert.equal(converted.systemInstruction.parts[0].text,'SYSTEM_STAYS_SYSTEM');
    const prefill=converted.contents.findIndex(turn=>turn.parts.some(part=>part.text==='prefill'));
    assert.equal(converted.contents[prefill+1].parts[0].functionCall.name,INPUT_TOOL);
    assert.match(converted.contents.at(-1).parts[0].text,/mmdb_emit_answer/);
    assert.equal(converted.toolConfig,undefined);
  }
});

test('grouped synthetic input survives prompt continuation and reports its effective scope',async t=>{
  const f=await relayFixture(t,{inputRead:true,inputReadSynthetic:true,inputReadScope:'turn',completeToolOutput:true});let count=0;
  f.ws.on('message',raw=>{const msg=JSON.parse(raw);if(msg.type!=='request')return;count++;
    const payload=JSON.parse(msg.requestBody),results=payload.wire[1].flatMap(turn=>turn[0]).filter(part=>part[11]);
    assert.equal(results.length,1);assert.equal(decodeStruct(results[0][11][1]).input,'A\n\nB');
    f.deliver(msg,[frame([toolPart(count===1?'first':'second')]),finish(count===1?2:1)]);
  });
  const response=await f.call({messages:[{role:'system',content:'system'},{role:'user',content:'A'},{role:'user',content:'B'},{role:'assistant',content:'prefill'}]}),data=await response.json();
  assert.equal(response.status,200);assert.equal(data.choices[0].message.content,'firstsecond');assert.equal(data.mmdb.inputReadTurns,2);assert.equal(data.mmdb.inputReadScope,'turn');assert.equal(data.mmdb.requestCounts.inputRead,0);assert.equal(count,2);
});

test('external declarations and histories bypass all new wrapping settings',async t=>{
  const f=await relayFixture(t,{inputRead:true,inputReadSynthetic:true,inputReadScope:'turn',outputEnvelope:'required',completeToolOutput:true,nativeContinuation:true});
  f.ws.on('message',raw=>{const msg=JSON.parse(raw);if(msg.type!=='request')return;
    const payload=JSON.parse(msg.requestBody);assert.doesNotMatch(JSON.stringify(payload),/mmdb_emit_answer|mmdb_read_input/);assert.equal(msg.allowNetworkRetry,false);
    f.deliver(msg,[frame([[null,'external answer']]),finish()]);
  });
  for(const extra of [
    {tools:[{type:'function',function:{name:'lookup'}}]},
    {messages:[{role:'user',content:'lookup'},{role:'assistant',tool_calls:[{id:'one',type:'function',function:{name:'lookup',arguments:'{}'}}]},{role:'tool',tool_call_id:'one',content:'value'}]},
  ]){
    const response=await f.call(extra),data=await response.json();assert.equal(response.status,200);assert.equal(data.mmdb.outputEnvelope,'off');assert.equal(data.mmdb.outputEnvelopeSkipped,true);assert.equal(data.mmdb.antiTruncationSkipped,true);assert.equal(data.mmdb.inputReadSkipped,true);assert.equal(data.mmdb.continuationMode,'none');
  }
});

test('new settings persist, keep old defaults and survive updates from old clients',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'mmdb-result-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const file=join(dir,'config.json');writeFileSync(file,JSON.stringify({apiKey:'private',inputRead:true}));
  const old=readConfig(file,{});assert.equal(old.outputEnvelope,'off');assert.equal(old.inputReadScope,'last');assert.equal(old.completeToolOutput,false);
  const f=await relayFixture(t,{persistExperiments:settings=>saveExperimentalConfig(settings,file)});
  const update=body=>fetch(f.base+'/v1/experiments',{method:'POST',headers:f.headers,body:JSON.stringify(body)});
  assert.equal((await update({outputEnvelope:'auto',inputReadScope:'turn',completeToolOutput:true})).status,200);
  assert.equal((await update({nativeContinuation:true})).status,200);
  const saved=readConfig(file,{});assert.equal(saved.outputEnvelope,'auto');assert.equal(saved.inputReadScope,'turn');assert.equal(saved.completeToolOutput,true);assert.equal(saved.apiKey,'private');
  const before=readFileSync(file,'utf8');assert.equal((await update({outputEnvelope:'unknown'})).status,400);assert.equal(readFileSync(file,'utf8'),before);
});
