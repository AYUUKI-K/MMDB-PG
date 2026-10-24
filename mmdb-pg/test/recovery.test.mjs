import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateWithRecovery} from '../src/recovery.js';
const network=()=>Object.assign(new Error('connection'),{code:'upstream_connection_failed'});
const run=(session,options={},signal=new AbortController().signal,chunk=()=>{},progress=()=>{})=>generateWithRecovery(session,{},signal,chunk,progress,{retry:true,delayMs:1,...options});
test('pre-response connection failure retries once and delivers only the successful response',async()=>{
  let calls=0,body='',retries=0;
  await run({generate:async(p,s,chunk)=>{if(++calls===1)throw network();chunk('answer');}}, {},undefined,text=>body+=text,phase=>{if(phase==='network-retry')retries++;});
  assert.equal(calls,2);assert.equal(body,'answer');assert.equal(retries,1);
});
test('second connection failure ends without an unbounded retry',async()=>{
  let calls=0;await assert.rejects(run({generate:async()=>{calls++;throw network();}}),{code:'upstream_connection_failed'});assert.equal(calls,2);
});
test('HTTP quota, permission, tool errors and data already received never retry',async()=>{
  for(const code of ['upstream_http_error','tool_not_used','executor_error']){
    let calls=0;await assert.rejects(run({generate:async()=>{calls++;throw Object.assign(new Error('failure'),{code});}}),{code});assert.equal(calls,1);
  }
  let calls=0;await assert.rejects(run({generate:async(p,s,chunk)=>{calls++;chunk('partial');throw network();}}));assert.equal(calls,1);
});
test('cancelling retry backoff does not issue another generation',async()=>{
  const controller=new AbortController();let calls=0;
  await assert.rejects(run({generate:async()=>{calls++;throw network();}},{delayMs:1000},controller.signal,()=>{},()=>controller.abort()),{name:'AbortError'});
  assert.equal(calls,1);
});
test('ordinary mode is not opted into connection retries',async()=>{
  let calls=0;await assert.rejects(run({generate:async()=>{calls++;throw network();}},{retry:false}));assert.equal(calls,1);
});

test('long pre-response failures never replay a generation, short failures still can',async()=>{
  for(const elapsed of [29999,30000,148205]){
    let calls=0,time=0,skipped=false;
    const session={generate:async()=>{calls++;time=elapsed;throw network();}};
    await assert.rejects(run(session,{now:()=>time,retryWindowMs:30000},undefined,()=>{},phase=>{if(phase==='retry-skipped')skipped=true;}),{code:'upstream_connection_failed'});
    assert.equal(calls,elapsed<30000?2:1);assert.equal(skipped,elapsed>=30000);
  }
});

 test('a 275 second pre-response failure can recover once under the relay deadline',async()=>{
  let calls=0,body='';
  await run({generate:async(p,s,chunk)=>{if(++calls===1)throw Object.assign(network(),{requestWaitMs:275000});chunk('recovered');}}, {},undefined,text=>body+=text);
  assert.equal(calls,2);assert.equal(body,'recovered');
});
