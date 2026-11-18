import {test} from 'node:test';
import assert from 'node:assert/strict';
import {catalogRow, finish, frame, relayFixture, toolPart} from './helpers.mjs';
import {toWire,fromOpenAI} from '../src/server/protocol.mjs';
import {headlessRequest} from '../src/server/headless-protocol.mjs';
import {InputRead} from '../src/server/input-read.mjs';
import {nextTurn} from '../src/server/continuation.mjs';
import {selectableModels} from '../src/server/capabilities.mjs';

test('model selectors round trip through both APIs, including anti-truncation and catalog-specific levels', async t => {
  const model = 'gemini-4-argon';
  const f = await relayFixture(t, {models:[model]});
  const row = catalogRow({id:'new-chat',flags:[1,10]});
  row[71] = [null,null,null,null,null,3,[1,3,5]];
  await f.catalog([row]);
  const ids = (await (await fetch(f.base+'/v1/models',{headers:f.headers})).json()).data.map(m=>m.id);
  const names = (await (await fetch(f.base+'/v1beta/models',{headers:f.headers})).json()).models.map(m=>m.name);
  assert.deepEqual(names, ids.map(id=>'models/'+id));
  assert.ok(ids.includes('pg-new-chat(xhigh)'));
  assert.ok(!ids.includes('pg-new-chat(medium)'));
  assert.ok(!ids.includes('pg-new-chat-抗截断(high)'));
  assert.ok(!ids.includes('pg-gemini-4-argon(xhigh)'));
  for (const native of [false,true]) {
    const id = native ? 'pg-gemini-4-argon-抗截断(high)' : 'pg-new-chat(xhigh)';
    assert.ok(ids.includes(id));
    const pending = f.nextRequest();
    const response = native ? fetch(f.base+'/v1beta/models/'+encodeURIComponent(id)+':generateContent',{
      method:'POST', headers:f.headers, body:JSON.stringify({contents:[{parts:[{text:'hello'}]}],
        generation_config:{temperature:0,thinking_config:{thinking_level:'low',include_thoughts:false}}})
    }) : f.call({model:id,reasoning_effort:'low'});
    const job = await pending;
    const {wire} = JSON.parse(job.requestBody);
    assert.equal(wire[0], native ? 'models/'+model : 'models/new-chat');
    assert.deepEqual(wire[3][16], [native ? 0 : 1, null, null, native ? 3 : 6]);
    f.deliver(job, [frame(native ? [toolPart('reply')] : [[null,'reply']]),finish()]);
    assert.equal((await response).status,200);
    const record = (await f.status()).recent[0];
    assert.equal(record.modelIdentity.requested, id.slice(3));
    assert.equal(record.generation.thinkingLevel, native ? 'high' : 'xhigh');
  }
});

test('explicit effort reaches the independent runtime, input reader and continuation payloads', () => {
  const model = 'gemini-3.1-pro-preview';
  const request = {model, messages:[{role:'user',content:'hello'}]};
  const body = fromOpenAI({...request,reasoning_effort:'medium'});
  const reader = new InputRead(body);
  for (const payload of [toWire(model,body), reader.initialPayload(model), toWire(model,nextTurn(body,'continued',100))]) {
    assert.deepEqual(headlessRequest(payload).body.generationConfig.thinkingConfig, {includeThoughts:true,thinkingLevel:'MEDIUM'});
  }
  for (const effort of [undefined,null,'auto']) {
    assert.equal(toWire(model,fromOpenAI({...request,reasoning_effort:effort})).wire[3].length,14);
  }
  for (const [effort,budget] of [['none',0],['low',1024],['medium',8192],['high',24576]]) {
    const legacy = {...request,model:'gemini-2.5-flash',reasoning_effort:effort};
    assert.equal(headlessRequest(toWire(legacy.model,fromOpenAI(legacy))).body.generationConfig.thinkingConfig.thinkingBudget,budget);
  }
  const native = toWire(model,{contents:body.contents,generation_config:{thinking_config:{thinking_budget:-1,include_thoughts:false}}});
  assert.deepEqual(headlessRequest(native).body.generationConfig.thinkingConfig,{includeThoughts:false,thinkingBudget:-1});
  const models = ['gemini-4-hydrogen'];
  assert.ok(selectableModels(null,models,false).includes('pg-gemini-4-hydrogen(xhigh)'));
  assert.ok(!selectableModels(null,models,true).includes('pg-gemini-4-hydrogen(xhigh)'));
});

test('invalid efforts and conflicting native settings fail before dispatch', async t => {
  const f = await relayFixture(t);
  for (const effort of ['typo',{},'xhigh']) {
    assert.equal((await f.call({model:'pg-gemini-4-argon',reasoning_effort:effort})).status,400);
  }
  for (const thinkingConfig of [{thinkingLevel:'LOW',thinkingBudget:1},{thinkingBudget:-2},{includeThoughts:1}]) {
    assert.throws(()=>toWire('test',{contents:[{parts:[{text:'hello'}]}],generationConfig:{thinkingConfig}}),{status:400});
  }
});
