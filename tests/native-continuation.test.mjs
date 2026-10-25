import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {decodeModelCatalog,modelCapability,CATALOG_TTL_MS,supportsNativeContinuation} from '../src/server/capabilities.mjs';
import {AttemptTrace} from '../src/server/metrics.mjs';
import {relayFixture,catalogRow,frame,toolPart,finish,usage} from './helpers.mjs';

test('catalog enables native continuation only from exact capabilities and fresh scoped evidence',()=>{
  const catalog=decodeModelCatalog(JSON.stringify([[catalogRow({aliases:[['models/alias']]}),catalogRow({id:'no-tools',flags:[91]}),catalogRow({id:'no-limits',input:null})]]));
  const owner={catalog,catalogAt:10};
  assert.equal(supportsNativeContinuation(modelCapability(owner,'test',10)),true);
  assert.equal(supportsNativeContinuation(modelCapability(owner,'alias',10)),true);
  assert.equal(supportsNativeContinuation(modelCapability(owner,'no-tools',10)),false);
  assert.equal(supportsNativeContinuation(modelCapability(owner,'no-limits',10)),false);
  assert.equal(modelCapability(owner,'test',10+CATALOG_TTL_MS),undefined);
  assert.equal(modelCapability({},'test',10),undefined);
  assert.throws(()=>decodeModelCatalog('[null,[7,"permission"]]'),{code:'invalid_model_catalog'});
  assert.throws(()=>decodeModelCatalog('['),{code:'invalid_model_catalog'});
  const ambiguous=decodeModelCatalog(JSON.stringify([[catalogRow(),catalogRow()]]));assert.equal(ambiguous.get('test'),null);
});

test('native continuation is opt-in and cannot be inferred from model name or an old executor',async t=>{
  for(const [enabled,capable,protocol] of [[false,true,2],[true,false,2],[true,true,1]])await t.test(`${enabled}/${capable}/${protocol}`,async t=>{
    const f=await relayFixture(t,{nativeContinuation:enabled},protocol);
    if(protocol===2)await f.catalog([catalogRow({flags:capable?[10,91]:[10]})]);
    f.ws.on('message',raw=>{const msg=JSON.parse(raw);if(msg.type!=='request')return;const payload=JSON.parse(msg.requestBody);assert.equal(payload.wire[3][45],undefined);assert.equal(payload.wire[10],1);f.deliver(msg,[frame([toolPart('normal envelope')]),finish()]);});
    const result=await(await f.call()).json();assert.equal(result.mmdb.continuationMode,'prompt');
  });
});

test('native continuation reuses contents and binding, carries only the token, and emits one final completion',async t=>{
  for(const stream of [false,true])await t.test(`stream=${stream}`,async t=>{
    const f=await relayFixture(t,{nativeContinuation:true});await f.catalog();let first,count=0;
    f.ws.on('message',raw=>{
      const msg=JSON.parse(raw);if(msg.type!=='request')return;count++;const payload=JSON.parse(msg.requestBody);
      assert.equal(msg.allowNetworkRetry,false);assert.equal(payload.wire[3][45],1);assert.equal(payload.wire[10],null);
      if(count===1){first=payload;assert.equal(payload.wire[3][3],32768);f.deliver(msg,[frame([toolPart('first')]),finish(22,'PRIVATE_CONTINUATION_TOKEN')]);}
      else {assert.equal(count,2);assert.equal(payload.wire[3][3],65536);assert.equal(payload.wire[16],'PRIVATE_CONTINUATION_TOKEN');assert.deepEqual(payload.wire[1],first.wire[1]);assert.deepEqual(payload.wire[5],first.wire[5]);assert.deepEqual(payload.wire[6],first.wire[6]);assert.equal(payload.binding,first.binding);f.deliver(msg,[frame([toolPart(' second')]),finish(1,undefined,usage(2,5))]);}
    });
    const response=await f.call({stream,max_tokens:65536,stream_options:{include_usage:true}}),raw=await response.text();assert.equal(count,2);
    assert.doesNotMatch(raw,/PRIVATE_CONTINUATION_TOKEN|CONTINUATION/);
    if(stream){assert.equal((raw.match(/\[DONE\]/g)||[]).length,1);assert.match(raw,/"total_tokens":10/);assert.doesNotMatch(raw,/"finish_reason":"length"/);}
    else {const result=JSON.parse(raw);assert.equal(result.choices[0].message.content,'first second');assert.equal(result.usage.prompt_tokens,2);assert.equal(result.usage.completion_tokens,8);assert.equal(result.usage.total_tokens,10);assert.equal(result.mmdb.continuationMode,'native');}
    const status=await f.status();assert.equal(status.recent[0].usage.totalTokenCount,10);assert.equal(status.recent[0].continuationMode,'native');assert.ok(!JSON.stringify(status).includes('PRIVATE_CONTINUATION_TOKEN'));
  });
});

test('a native intermediate name-only frame can be completed with unnamed arguments on the next round',async t=>{
  const f=await relayFixture(t,{nativeContinuation:true});await f.catalog();let count=0;
  f.ws.on('message',raw=>{const msg=JSON.parse(raw);if(msg.type!=='request')return;count++;
    f.deliver(msg,count===1?[frame([toolPart(undefined)]),finish(22,'next')]:[frame([toolPart('complete',null)]),finish()]);
  });
  const result=await(await f.call()).json();assert.equal(count,2);assert.equal(result.choices[0].message.content,'complete');
});

test('native token failures and exhausted budgets fail explicitly without prompt replay',async t=>{
  for(const mode of ['missing','repeat','budget','limit'])await t.test(mode,async t=>{
    const f=await relayFixture(t,{nativeContinuation:true,maxContinuations:mode==='budget'?0:3});await f.catalog();let count=0;
    f.ws.on('message',raw=>{const msg=JSON.parse(raw);if(msg.type!=='request')return;count++;f.deliver(msg,[frame([toolPart('part')]),finish(22,mode==='missing'?undefined:'same-token')]);});
    const response=await f.call({max_tokens:mode==='limit'?32768:131072}),result=await response.json();
    assert.equal(response.status,502);assert.equal(result.error.code,({missing:'missing_continuation_token',repeat:'repeated_continuation_token',budget:'continuation_budget_exhausted',limit:'continuation_budget_exhausted'})[mode]);assert.equal(count,mode==='repeat'?2:1);
  });
});

test('MAX_TOKENS needs a token on its own frame and remaining native output budget',async t=>{
  for(const sameFrame of [false,true])await t.test(`sameFrame=${sameFrame}`,async t=>{
    const f=await relayFixture(t,{nativeContinuation:true});await f.catalog();let count=0;
    f.ws.on('message',raw=>{const msg=JSON.parse(raw);if(msg.type!=='request')return;count++;
      if(count===1){const text=frame([toolPart('part')]);text[0][0][8]='earlier-token';f.deliver(msg,[text,finish(2,sameFrame?'finish-token':undefined)]);}
      else f.deliver(msg,[frame([toolPart('end')]),finish()]);
    });
    const result=await(await f.call({max_tokens:65536})).json();assert.equal(count,sameFrame?2:1);assert.equal(result.choices[0].finish_reason,sameFrame?'stop':'length');
  });
});

test('native usage does not invent unreported tool or failed-attempt costs',()=>{
  const trace=new AttemptTrace({nativeContinuation:true});trace.begin(0,0,'initial');trace.frame({promptTokenCount:2,candidatesTokenCount:3,totalTokenCount:5,thoughtsTokenCount:0},'CONTINUATION');trace.end('continued',1);trace.begin(1,1,'continuation');trace.frame({promptTokenCount:2,candidatesTokenCount:5,totalTokenCount:7,thoughtsTokenCount:0,toolUsePromptTokenCount:0},'STOP');
  const result=trace.snapshot();assert.equal(result.usage.promptTokenCount,2);assert.equal(result.usage.candidatesTokenCount,8);assert.equal(result.usage.totalTokenCount,undefined);assert.equal(result.usageComplete,false);
});

test('account revision cancels old work and stale catalogs cannot re-enable native continuation',async t=>{
  const f=await relayFixture(t,{nativeContinuation:true});await f.catalog();
  const dispatched=f.nextRequest(),work=f.call();const msg=await dispatched;
  assert.equal(JSON.parse(msg.requestBody).wire[3][45],1);
  f.ws.send(JSON.stringify({type:'catalog-invalidated',connectionId:f.connectionId,sessionRevision:1}));
  const response=await work;assert.equal(response.status,409);assert.equal((await response.json()).error.code,'session_changed');
  f.ws.send(JSON.stringify({type:'model-catalog',connectionId:f.connectionId,sessionRevision:0,raw:JSON.stringify([[catalogRow()]])}));
  const pong=once(f.ws,'pong');f.ws.ping();await pong;
  assert.equal((await f.status()).catalog.state,'unavailable');
  f.ws.on('message',raw=>{const msg=JSON.parse(raw);if(msg.type==='request'){assert.equal(JSON.parse(msg.requestBody).wire[3][45],undefined);f.deliver(msg,[frame([toolPart('new context')]),finish()]);}});
  assert.equal((await(await f.call()).json()).mmdb.continuationMode,'prompt');
});
