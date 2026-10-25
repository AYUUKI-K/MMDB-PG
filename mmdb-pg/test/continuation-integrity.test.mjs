import {test} from 'node:test';
import assert from 'node:assert/strict';
import {relayFixture,toolPart,frame,finish,usage} from './helpers.mjs';

const overlap='这是一段足够长的接缝文字，用于验证续写重述上一段时，只保留一次原文和原来的格式。\n';
const contentFromSSE=raw=>raw.split('\n').filter(line=>line.startsWith('data: {')).map(line=>JSON.parse(line.slice(6))).map(chunk=>chunk.choices?.[0]?.delta?.content??'').join('');

test('prompt continuation removes an exact long seam across tool frames in both response modes',async t=>{
  for(const stream of [false,true])await t.test(`stream=${stream}`,async t=>{
    const f=await relayFixture(t);let count=0;
    f.ws.on('message',raw=>{const msg=JSON.parse(raw);if(msg.type!=='request')return;count++;
      f.deliver(msg,count===1?[frame([toolPart('开头。\n'+overlap)]),finish(2)]:[frame([toolPart(overlap.slice(0,12))]),frame([toolPart(overlap.slice(12)+'接着写新的段落。')]),finish()]);
    });
    const response=await f.call({stream}),raw=await response.text();
    assert.equal(response.status,200);assert.equal(count,2);
    assert.equal(stream?contentFromSSE(raw):JSON.parse(raw).choices[0].message.content,'开头。\n'+overlap+'接着写新的段落。');
    const row=(await f.status()).recent[0];assert.equal(row.continuationOverlapChars,overlap.length);assert.ok(!JSON.stringify(row).includes(overlap));
  });
});

test('a repeated continuation fails without re-emitting the repeated body or requesting another round',async t=>{
  for(const stream of [false,true])await t.test(`stream=${stream}`,async t=>{
    const f=await relayFixture(t);let count=0;
    f.ws.on('message',raw=>{const msg=JSON.parse(raw);if(msg.type==='request'){count++;f.deliver(msg,[frame([toolPart('SAME_BODY')]),finish(2)]);}});
    const response=await f.call({stream}),raw=await response.text();assert.equal(count,2);assert.match(raw,/continuation_no_progress/);assert.doesNotMatch(raw,/\[DONE\]|"finish_reason":"stop"/);
    if(stream)assert.equal(contentFromSSE(raw),'SAME_BODY');else assert.equal(response.status,502);
    assert.equal((await f.status()).recent[0].bodyChars,'SAME_BODY'.length);
  });
});

test('a failed continuation transport never commits its buffered tool body',async t=>{
  const f=await relayFixture(t);let count=0;
  f.ws.on('message',raw=>{const msg=JSON.parse(raw);if(msg.type!=='request')return;count++;
    if(count===1)f.deliver(msg,[frame([toolPart('first')]),finish(2)]);
    else {f.send(msg,{type:'stream-chunk',chunkBody:JSON.stringify([[frame([toolPart('UNVERIFIED_TAIL')]),finish()]])});f.send(msg,{type:'error',status:502,error:{code:'upstream_stream_disconnected',message:'fixture disconnect'}});}
  });
  const raw=await(await f.call({stream:true})).text();assert.equal(contentFromSSE(raw),'first');assert.match(raw,/upstream_stream_disconnected/);assert.doesNotMatch(raw,/UNVERIFIED_TAIL|\[DONE\]/);
});

test('explicit output budget is shared by prompt rounds, including thinking tokens',async t=>{
  const f=await relayFixture(t);const limits=[];
  f.ws.on('message',raw=>{const msg=JSON.parse(raw);if(msg.type!=='request')return;limits.push(JSON.parse(msg.requestBody).wire[3][3]);
    const n=limits.length,u=usage(2,n===1?30:n===2?35:20);u[9]=5;u[2]+=5;
    f.deliver(msg,[frame([toolPart(`round ${n}\n`)]),finish(n<3?2:1,undefined,u)]);
  });
  const result=await(await f.call({max_tokens:999,max_completion_tokens:100})).json();
  assert.deepEqual(limits,[100,65,25]);assert.equal(result.choices[0].message.content,'round 1\nround 2\nround 3\n');assert.equal(result.usage.completion_tokens,100);
});

test('exhausted or unknown explicit budgets stop with length instead of silently resetting the allowance',async t=>{
  for(const mode of ['exhausted','missing-thinking','no-usage'])await t.test(mode,async t=>{
    const f=await relayFixture(t);let count=0;const counters=mode==='no-usage'?null:usage(2,100);if(mode==='missing-thinking')counters[9]=null;
    f.ws.on('message',raw=>{const msg=JSON.parse(raw);if(msg.type==='request'){count++;f.deliver(msg,[frame([toolPart(`part ${count}`)]),finish(2,undefined,counters)]);}});
    const result=await(await f.call({max_tokens:100})).json();assert.equal(count,1);assert.equal(result.choices[0].finish_reason,'length');assert.equal(result.mmdb.continuations,0);
    assert.equal((await f.status()).recent[0].continuationStop,mode==='exhausted'?'output_budget':'unknown_usage');
  });
});

test('budget uses the final usage snapshot, including usage after a finish frame',async t=>{
  const f=await relayFixture(t);const limits=[];
  f.ws.on('message',raw=>{const msg=JSON.parse(raw);if(msg.type!=='request')return;limits.push(JSON.parse(msg.requestBody).wire[3][3]);
    f.deliver(msg,limits.length===1?[frame([toolPart('first')]),finish(2,undefined,usage(2,20)),[null,null,usage(2,70)]]:[frame([toolPart(' second')]),finish()]);
  });
  assert.equal((await f.call({max_tokens:100})).status,200);assert.deepEqual(limits,[100,30]);
});

test('an unreported failed transport attempt cannot disappear from an explicit output budget',async t=>{
  const f=await relayFixture(t);let count=0;
  f.ws.on('message',raw=>{const msg=JSON.parse(raw);if(msg.type!=='request')return;count++;
    f.send(msg,{type:'progress',phase:'network-retry',attemptIndex:1});
    f.deliver({...msg,attemptIndex:1},[frame([toolPart('first')]),finish(2)]);
  });
  const result=await(await f.call({max_tokens:100})).json(),row=(await f.status()).recent[0];
  assert.equal(count,1);assert.equal(result.choices[0].finish_reason,'length');assert.equal(result.usage,undefined);assert.equal(row.attempts.length,2);assert.equal(row.continuationStop,'unknown_usage');
});

test('tool call identity cannot change within an answer or expose IDs in diagnostics',async t=>{
  for(const change of [false,true])await t.test(`change=${change}`,async t=>{
    const f=await relayFixture(t);
    f.ws.on('message',raw=>{const msg=JSON.parse(raw);if(msg.type!=='request')return;
      const first=toolPart(undefined),second=toolPart('answer',null);first[10][2]='PRIVATE_CALL_A';second[10][2]=change?'PRIVATE_CALL_B':'PRIVATE_CALL_A';
      f.deliver(msg,[frame([first]),frame([second]),finish()]);
    });
    const response=await f.call(),raw=await response.text();assert.equal(response.status,change?502:200);if(change)assert.match(raw,/multiple_tool_calls/);
    assert.doesNotMatch(raw,/PRIVATE_CALL/);assert.ok(!JSON.stringify(await f.status()).includes('PRIVATE_CALL'));
  });
});

test('multiple tool calls, invalid names, unknown argument extensions and calls after finish fail explicitly',async t=>{
  for(const mode of ['multiple','name','extension','after-finish'])await t.test(mode,async t=>{
    const f=await relayFixture(t);
    f.ws.on('message',raw=>{const msg=JSON.parse(raw);if(msg.type!=='request')return;
      const part=toolPart('answer');if(mode==='name')part[10][0]=17;if(mode==='extension')part[10][3]=[['$.content','unhandled']];
      f.deliver(msg,mode==='multiple'?[frame([part,toolPart('another')]),finish()]:mode==='after-finish'?[frame([part]),finish(),frame([toolPart(undefined)])]:[frame([part]),finish()]);
    });
    const response=await f.call();assert.equal(response.status,502);assert.ok((await response.json()).error);
  });
});
