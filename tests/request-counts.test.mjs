import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AttemptTrace,cleanRequestCounts} from '../src/server/metrics.mjs';
import {relayFixture,frame,toolPart,finish} from './helpers.mjs';
import {generationDiagnosticText} from '../src/browser/panel.js';

const zero={total:0,inputRead:0,answer:0,continuation:0,retry:0};
test('counts track observed sends, deduplicate progress and exclude proof/queued work',()=>{
  const trace=new AttemptTrace();trace.begin(0,0,'input-read');trace.phase('queued',1);trace.phase('proof',2);
  assert.deepEqual(trace.snapshot().requestCounts,zero);
  trace.phase('request-sent',3);trace.phase('request-sent',4);trace.phase('headers',5,200);trace.data(6);
  trace.end('finished',7);trace.begin(8,0,'initial');trace.phase('request-sent',9);
  trace.phase('network-retry',10);assert.equal(trace.snapshot().requestCounts.total,2);
  trace.phase('proof',11);trace.phase('request-sent',12);trace.end('finished',13);trace.begin(14,1,'continuation');trace.data(15);
  assert.deepEqual(trace.snapshot().requestCounts,{total:4,inputRead:1,answer:1,continuation:1,retry:1});
  assert.equal(cleanRequestCounts({...zero,total:1}),undefined);assert.equal(cleanRequestCounts({...zero,answer:-1}),undefined);
});

test('proof failures count zero; failed HTTP attempts count once and update cumulative totals',async t=>{
  const f=await relayFixture(t);let sent=0;
  f.ws.on('message',raw=>{const m=JSON.parse(raw);if(m.type!=='request')return;sent++;
    f.send(m,{type:'progress',phase:'proof'});
    if(sent===2){f.send(m,{type:'progress',phase:'request-sent'});f.send(m,{type:'progress',phase:'headers',httpStatus:429});}
    f.send(m,{type:'error',status:sent===1?503:429,error:{code:sent===1?'invalid_proof':'upstream_http_error',message:'test failure'}});
  });
  assert.equal((await f.call()).status,503);assert.equal((await f.status()).recent[0].requestCounts.total,0);
  assert.equal((await f.call()).status,429);const status=await f.status();assert.equal(status.requestTotals.total,1);assert.equal(status.requestTotals.answer,1);assert.equal(status.recent[0].requestCounts.total,1);
});

test('retry is counted only when sent, stale events cannot double count, totals are not successful replies',async t=>{
  const f=await relayFixture(t);
  f.ws.on('message',raw=>{const m=JSON.parse(raw);if(m.type!=='request')return;
    f.send(m,{type:'progress',phase:'request-sent'});
    f.send(m,{type:'progress',phase:'network-retry',attemptIndex:1});
    f.send(m,{type:'progress',phase:'request-sent',attemptIndex:0}); // stale
    f.send(m,{type:'progress',phase:'request-sent',attemptIndex:1});
    f.send(m,{type:'progress',phase:'request-sent',attemptIndex:1}); // duplicate
    f.deliver({...m,attemptIndex:1},[frame([toolPart('ok')]),finish()]);
  });
  const result=await(await f.call()).json();assert.deepEqual(result.mmdb.requestCounts,{...zero,total:2,answer:1,retry:1});
  const status=await f.status();assert.equal(status.requestTotals.total,2);assert.equal(status.recent.length,1);
  assert.match(generationDiagnosticText(status.recent[0]),/上游 2 次（读取 0 \/ 正文 1 \/ 续写 0 \/ 重试 1）/);
});

test('queued cancellation counts zero and capability probes are included separately',async t=>{
  const f=await relayFixture(t),controller=new AbortController();
  const next=f.nextRequest(),call=f.call({},controller.signal);const m=await next;
  f.send(m,{type:'progress',phase:'queued'});assert.equal((await f.status()).active[0].requestCounts.total,0);
  controller.abort();await assert.rejects(call);
  for(let i=0;i<30&&(await f.status()).pending;i++)await new Promise(r=>setTimeout(r,10));
  assert.equal((await f.status()).requestTotals.total,0);
  f.ws.on('message',raw=>{const m=JSON.parse(raw);if(m.type!=='request')return;f.send(m,{type:'progress',phase:'request-sent'});f.send(m,{type:'progress',phase:'headers',httpStatus:200});f.deliver(m,[frame([toolPart('probe')]),finish()]);});
  const probe=await fetch(f.base+'/v1/experiments/probe',{method:'POST',headers:f.headers,body:'{"model":"test","experiment":"tool-auto"}'});
  assert.equal((await probe.json()).upstreamRequests,1);const s=await f.status();assert.equal(s.requestTotals.total,1);assert.equal(s.requestTotals.probe,1);assert.equal(s.requestTotals.answer,0);
});
