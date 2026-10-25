import {performanceReport} from '../tools/performance-report.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import {AttemptTrace,readUsage,generationSummary} from '../src/server/metrics.mjs';
import {createRelay} from '../src/server/server.mjs';
import {envelopePayload,ANSWER_TOOL} from '../src/server/anti-truncation.mjs';
import {toWire,decodeFrame,openAIUsage} from '../src/server/protocol.mjs';

test('unreported thinking tokens remain unknown while explicit zero stays zero',()=>{
  assert.deepEqual(readUsage([2,3,5]),{promptTokenCount:2,candidatesTokenCount:3,totalTokenCount:5});
  const wire=[2,3,5];wire[9]=0;assert.equal(readUsage(wire).thoughtsTokenCount,0);
  assert.equal(readUsage([null,null,null]),undefined);
  const decoded=decodeFrame([null,null,[2,3,5]]).usageMetadata;
  assert.equal(decoded.thoughtsTokenCount,undefined);assert.equal(openAIUsage(decoded),undefined);
});
test('retry and continuation timelines preserve unknown usage and cumulative frame counters',()=>{
  const trace=new AttemptTrace();trace.begin(0,0,'initial');trace.phase('request-sent',10);
  trace.phase('network-retry',20);trace.phase('proof',22);trace.phase('request-sent',25);trace.phase('headers',40,200);
  trace.data(41);trace.frame({promptTokenCount:2,candidatesTokenCount:1},undefined);
  trace.frame({promptTokenCount:2,candidatesTokenCount:3,totalTokenCount:5,thoughtsTokenCount:0},'MAX_TOKENS');
  trace.body(8,42);trace.end('continued',45);trace.begin(45,1,'continuation');
  trace.frame({promptTokenCount:4,candidatesTokenCount:6,totalTokenCount:10,thoughtsTokenCount:0},'STOP');trace.end('finished',70);
  const result=trace.snapshot();assert.equal(result.attempts.length,3);
  assert.equal(result.attempts[0].status,'connection-failed');assert.equal(result.attempts[1].usage.candidatesTokenCount,3);
  assert.equal(result.attempts[1].responseHeadersMs,40);assert.equal(result.attempts[1].requestSentMs,25);
  assert.equal(result.attempts[2].round,1);assert.equal(result.usage,undefined);assert.equal(result.usageComplete,false);
});
test('compact tool contract preserves history, user tail, schema and ordinary generation parameters',()=>{
  for(const role of ['user','model']){
    const body={contents:[{role,parts:[{text:'Context with requested output length.'}]}],systemInstruction:{parts:[{text:'Original instructions.'}]},generationConfig:{temperature:1,topP:0.9,maxOutputTokens:65535}};
    const before=structuredClone(body),legacy=envelopePayload('test',body),compact=envelopePayload('test',body,{style:'compact'});
    assert.deepEqual(body,before);assert.deepEqual(compact.wire[3],toWire('test',body).wire[3]);
    assert.deepEqual(generationSummary(compact),generationSummary(legacy));assert.equal(compact.wire[1].at(-1)[1],'user');
    assert.equal(compact.wire[5][0][0][1],'Original instructions.');assert.deepEqual(compact.wire[1][0][0][0],[null,body.contents[0].parts[0].text]);
    assert.equal(compact.wire[6][0][1][0][0],ANSWER_TOOL);assert.deepEqual(compact.wire[6][0][1][0][2][7],['content']);
    assert.equal(compact.binding,compact.wire[1].flatMap(turn=>turn[0].map(part=>part[1])).join(' '));
    assert.ok(JSON.stringify(compact.wire).length<JSON.stringify(legacy.wire).length);
  }
});
test('core separates failed attempts and usage snapshots across provider-default continuation rounds',async t=>{
  const app=createRelay({apiKey:'mmdb',models:['test'],timeoutMs:1500,maxContinuations:1,toolPromptStyle:'compact'});
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');t.after(()=>app.close());
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const ws=new WebSocket(base.replace('http:','ws:')+'/api/build/ws',{origin:'https://aistudio.google.com'});await once(ws,'open');
  const registered=once(ws,'message');ws.send(JSON.stringify({type:'register',executorType:'playground',apiKey:'mmdb',clientVersion:'mmdb-1.2.0'}));await registered;
  let round=0;
  ws.on('message',data=>{
    const msg=JSON.parse(data);if(msg.type!=='request')return;
    assert.equal(msg.allowNetworkRetry,round===0);
    const progress=phase=>ws.send(JSON.stringify({type:'progress',requestId:msg.requestId,phase,httpStatus:200,prompt:'PRIVATE'}));
    progress('request-sent');if(round===0){progress('network-retry');progress('proof');progress('request-sent');}progress('headers');
    const p=Array(11).fill(null);p[10]=[ANSWER_TOOL,[[['content',[null,null,round?' second':'first']]]]];
    const frame=[[[[[p],'model']]]];frame[2]=[2,1,3];
    const usage=[2,3,5];usage[9]=0;
    const finish=[[[null,round?1:2]],null,usage];
    ws.send(JSON.stringify({type:'stream-chunk',requestId:msg.requestId,chunkBody:JSON.stringify([[frame,finish]])}));
    ws.send(JSON.stringify({type:'stream-end',requestId:msg.requestId}));round++;
  });
  const response=await fetch(base+'/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer mmdb','Content-Type':'application/json'},body:JSON.stringify({model:'pg-test-抗截断',messages:[{role:'user',content:'PRIVATE'}]})});
  const result=await response.json();assert.equal(result.choices[0].message.content,'first second');assert.equal(result.usage,undefined);assert.equal(result.mmdb.usageComplete,false);
  const row=(await(await fetch(base+'/v1/status',{headers:{Authorization:'Bearer mmdb'}})).json()).recent[0];
  assert.equal(row.toolPromptStyle,'compact');assert.equal(row.rounds,1);assert.equal(row.networkRetries,1);assert.equal(row.attempts.length,3);
  assert.equal(row.attempts[1].usage.candidatesTokenCount,3);assert.equal(row.attempts[2].usage.thoughtsTokenCount,0);
  assert.equal(row.usageComplete,false);assert.equal(row.usage,undefined);
  assert.equal(row.generation.maxOutputTokens,'provider-default');assert.equal(row.generation.thinkingConfigSent,false);assert.ok(!JSON.stringify(row).includes('PRIVATE'));
});


test('performance report separates modes and excludes retries, continuations and unknown settings',()=>{
  const base={model:'gemini-test',status:'finished',rounds:0,networkRetries:0,generation:{temperature:1,thinkingConfigSent:false},elapsedMs:100,bodyChars:100};
  const rows=[base,{...base,elapsedMs:200,usage:{candidatesTokenCount:8}}, {...base,networkRetries:1,elapsedMs:9999},{...base,rounds:1},{...base,generation:undefined},{...base,model:'gemini-test-抗截断',toolPromptStyle:'compact',elapsedMs:300}];
  const report=performanceReport(rows);assert.equal(report.excluded,3);assert.equal(report.groups.length,2);
  assert.equal(report.groups[0].samples,2);assert.equal(report.groups[0].medianElapsedMs,150);assert.equal(report.groups[0].medianThoughtTokens,null);
  assert.equal(report.groups[1].style,'compact');assert.equal(report.groups[1].medianElapsedMs,300);
});
