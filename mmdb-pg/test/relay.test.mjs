import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {WebSocket} from 'ws';
import vm from 'node:vm';
import {createRelay} from '../server.mjs';
import {toWire, fromOpenAI, parseSparseJSON, FrameParser, decodeFrame, finishOpenAI} from '../protocol.mjs';

const key = 'pg-test-only-abcdefghijklmnopqrstuvwxyz';
const frame = text => [[[[[[null, text]], 'model']]]];
const finish = [[[null, 1]], null, [5, 2, 7, null, null, null, null, 0, null, 0]];
const raw = JSON.stringify([[frame('你好'), frame('世界'), finish]]);
async function setup(t, timeoutMs = 1000, extra = {}) {
  const app = createRelay({apiKey: key, models: ['gemini-test'], timeoutMs,...extra});
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const call = (path, body, auth = key) => fetch(base + path, {method: body ? 'POST' : 'GET', headers: {'Authorization': `Bearer ${auth}`, 'Content-Type': 'application/json'}, ...(body ? {body: JSON.stringify(body)} : {})});
  async function connect() {
    const ws = new WebSocket(base.replace('http:', 'ws:') + '/api/build/ws', {origin: 'https://aistudio.google.com'});
    await once(ws, 'open'); const reply = once(ws, 'message');
    ws.send(JSON.stringify({type: 'register', executorType: 'playground', apiKey: key}));
    assert.equal(JSON.parse((await reply)[0]).type, 'registered'); return ws;
  }
  return {app, base, call, connect};
}
const request = {model: 'pg-gemini-test', messages: [{role: 'user', content: 'hi'}]};
test('wire uses documented text slots and binds historical contents in order', () => {
  const payload = toWire('pg-gemini-test', fromOpenAI({...request, temperature: 0, messages: [{role: 'system', content: 'system'}, {role: 'user', content: 'one'}, {role: 'assistant', content: 'two'}, {role: 'user', content: 'three'}]}));
  assert.equal(payload.binding, 'one two three'); assert.deepEqual(payload.wire[1][0], [[[null, 'one']], 'user']);
  assert.deepEqual(payload.wire[5], [[[null, 'system']], 'user']); assert.equal(payload.wire[3][4], 0);
  assert.throws(() => fromOpenAI({...request, tools: []})); assert.throws(() => toWire('test', {contents: [{parts: [{inlineData: {}}]}]}));
});
test('sparse JSON and split Unicode/string delimiters decode correctly', () => {
  assert.deepEqual(parseSparseJSON('[,["[,]",,],]'), [null, ['[,]', null, null], null]);
  const got = []; const parser = new FrameParser(f => got.push(decodeFrame(f)));
  for (const c of raw) parser.push(c); parser.end();
  assert.equal(got.map(e => e.parts.map(p => p.text).join('')).join(''), '你好世界'); assert.equal(got.at(-1).finishReason, 'STOP');
  const broken = new FrameParser(() => {}); broken.push(raw.slice(0, -1)); assert.throws(() => broken.end());
});
test('auth, blocked web origin, offline and script provisioning', async t => {
  const {base, call} = await setup(t);
  assert.equal((await call('/v1/models', null, 'wrong')).status, 401);
  assert.equal((await call('/v1/models', null, 'é'.repeat(key.length))).status, 401);
  assert.equal((await fetch(base + '/health', {headers: {Origin: 'https://untrusted.example'}})).status, 403);
  assert.equal((await call('/v1/chat/completions', request)).status, 503);
  const script = await (await fetch(base + '/local-pg.user.js')).text();
  assert.ok(script.includes(key)); assert.ok(!script.includes('__LOCAL_PG_PORT__')); assert.ok(!script.includes('catiecli.sukaka.top'));
  const metaResponse=await fetch(base+'/local-pg.meta.js');const meta=await metaResponse.text();
  assert.equal(metaResponse.status,200);assert.equal(metaResponse.headers.get('cache-control'),'no-store');
  assert.ok(meta.includes(`@updateURL    ${base}/local-pg.meta.js`));
  assert.ok(meta.includes(`@downloadURL  ${base}/local-pg.user.js`));
  assert.ok(!meta.includes(key));assert.ok(!meta.includes('function'));assert.ok(meta.trim().endsWith('// ==/UserScript=='));
});

test('script provisioning encodes quotes and replacement metacharacters in a local key',async t=>{
  const special='test-"-\\-$&-${literal}';
  const {base}=await setup(t,1000,{apiKey:special});
  const script=await(await fetch(base+'/local-pg.user.js')).text();
  assert.doesNotThrow(()=>new vm.Script(script));assert.ok(script.includes('key:'+JSON.stringify(special)));assert.ok(!script.includes('__LOCAL_PG_KEY__'));
});
test('OpenAI and Gemini end-to-end through mock WS executor', async t => {
  const {call, connect} = await setup(t); const ws = await connect();
  ws.on('message', data => { const m = JSON.parse(data); if (m.type !== 'request') return; assert.equal(JSON.parse(m.requestBody).wire[0], 'models/gemini-test'); ws.send(JSON.stringify({type: 'response', requestId: m.requestId, rawResponse: raw})); });
  const result = await (await call('/v1/chat/completions', request)).json();
  assert.equal(result.choices[0].message.content, '你好世界'); assert.equal(result.usage.total_tokens, 7);
  const gemini = await (await call('/v1beta/models/pg-gemini-test:generateContent', {contents: [{parts: [{text: 'hi'}]}]})).json();
  assert.equal(gemini.candidates[0].content.parts.map(p => p.text).join(''), '你好世界');
});
test('SSE delivers a frame before final Google response, then DONE and usage', async t => {
  const {call, connect} = await setup(t); const ws = await connect(); let id;
  ws.on('message', data => { const m = JSON.parse(data); if (m.type !== 'request') return; id = m.requestId; ws.send(JSON.stringify({type: 'stream-chunk', requestId: id, chunkBody: '[[' + JSON.stringify(frame('实时'))})); });
  const res = await call('/v1/chat/completions', {...request, stream: true, stream_options: {include_usage: true}});
  const reader = res.body.getReader(); const first = new TextDecoder().decode((await reader.read()).value);
  assert.ok(first.includes('实时')); assert.ok(!first.includes('[DONE]'));
  ws.send(JSON.stringify({type: 'stream-chunk', requestId: id, chunkBody: ',' + JSON.stringify(finish) + ']]'}));
  ws.send(JSON.stringify({type: 'stream-end', requestId: id}));
  let rest = ''; for (;;) { const item = await reader.read(); if (item.done) break; rest += new TextDecoder().decode(item.value); }
  assert.ok(rest.includes('[DONE]')); assert.ok(rest.includes('total_tokens'));
});
test('upstream error and disconnected executor fail waiting HTTP requests', async t => {
  const {call, connect} = await setup(t); const ws = await connect();
  ws.on('message', data => { const m = JSON.parse(data); if (m.type === 'request') ws.send(JSON.stringify({type: 'error', requestId: m.requestId, status: 429, error: {code: 'quota', message: 'quota reached'}})); });
  assert.equal((await call('/v1/chat/completions', request)).status, 429);
  ws.removeAllListeners('message'); ws.on('message', data => { if (JSON.parse(data).type === 'request') ws.close(); });
  assert.equal((await call('/v1/chat/completions', request)).status, 502);
});
test('timeout cancels browser work and client abort clears pending request', async t => {
  const {app, base, call, connect} = await setup(t, 120); const ws = await connect();
  const cancelled = once(ws, 'message').then(async ([data]) => { assert.equal(JSON.parse(data).type, 'request'); return JSON.parse((await once(ws, 'message'))[0]); });
  assert.equal((await call('/v1/chat/completions', request)).status, 504); assert.equal((await cancelled).type, 'cancel');
  const controller = new AbortController(); const received = once(ws, 'message');
  const work = fetch(base + '/v1/chat/completions', {method: 'POST', headers: {Authorization: `Bearer ${key}`, 'Content-Type': 'application/json'}, body: JSON.stringify(request), signal: controller.signal}).catch(e => e);
  await received; const cancel = once(ws, 'message'); controller.abort(); await work;
  assert.equal(JSON.parse((await cancel)[0]).type, 'cancel');
  assert.equal((await (await fetch(base + '/health')).json()).pending, 0);
});
test('partial upstream stream emits error without successful DONE', async t => {
  const {call, connect} = await setup(t); const ws = await connect();
  ws.on('message', data => { const m = JSON.parse(data); if (m.type !== 'request') return; ws.send(JSON.stringify({type: 'stream-chunk', requestId: m.requestId, chunkBody: '[[' + JSON.stringify(frame('partial'))})); ws.send(JSON.stringify({type: 'stream-end', requestId: m.requestId})); });
  const text = await (await call('/v1/chat/completions', {...request, stream: true})).text(); assert.ok(text.includes('error')); assert.ok(!text.includes('[DONE]'));
});

test('prompt-feedback rejection reports the actual reason and leaves the next request usable', async t => {
  const {call, connect} = await setup(t); const ws = await connect();
  const rejected = JSON.stringify([[ [null, [4, null, 'synthetic upstream explanation'], [], null, null, null, null, 'response-id'] ]]);
  let blocked = true;
  ws.on('message', data => {
    const msg = JSON.parse(data); if (msg.type !== 'request') return;
    ws.send(JSON.stringify({type:'stream-chunk', requestId:msg.requestId, chunkBody:blocked ? rejected : raw}));
    ws.send(JSON.stringify({type:'stream-end', requestId:msg.requestId}));
  });
  for (const streaming of [true, false]) {
    const response = await call('/v1/chat/completions', {...request, stream:streaming});
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error.code, 'upstream_prompt_blocked');
    assert.match(body.error.message, /PROHIBITED_CONTENT/);
    assert.doesNotMatch(body.error.message, /缺少完成状态|synthetic upstream explanation/);
    assert.equal((await (await call('/health')).json()).pending, 0);
  }
  const native = await call('/v1beta/models/pg-gemini-test:generateContent', {contents:[{parts:[{text:'hi'}]}]});
  assert.equal(native.status, 400);
  assert.equal((await native.json()).error.code, 'upstream_prompt_blocked');
  blocked = false;
  const next = await call('/v1/chat/completions', request);
  assert.equal(next.status, 200);
  assert.equal((await next.json()).choices[0].message.content, '你好世界');
});

test('finish reasons retain explicit terminal codes and never invent a missing finish', () => {
  for (const [code, reason] of [[6,'LANGUAGE'],[7,'BLOCKLIST'],[8,'PROHIBITED_CONTENT'],[9,'SPII'],[10,'MALFORMED_FUNCTION_CALL'],[19,'PROVIDER_19']]) {
    assert.equal(decodeFrame([[[null,code]]]).finishReason, reason);
  }
  assert.throws(()=>finishOpenAI('PROVIDER_19'),{code:'upstream_generation_failed'});
  assert.throws(()=>finishOpenAI('LANGUAGE'),{code:'upstream_generation_failed'});
  assert.equal(decodeFrame([[[null,22]]]).finishReason,'CONTINUATION');
  assert.equal(decodeFrame(frame('partial')).finishReason, undefined);
  assert.equal(decodeFrame([[[null,0]]]).finishReason, undefined);
});

test('continuous executor data outlives the idle timeout for streaming and non-streaming clients', async t => {
  for (const streaming of [true, false]) await t.test(`stream=${streaming}`, async t => {
    const {call, connect} = await setup(t, 500); const ws = await connect();
    const received = once(ws, 'message');
    const responsePromise = call('/v1/chat/completions', {...request, stream: streaming});
    const msg = JSON.parse((await received)[0]);
    const chunk = text => ws.send(JSON.stringify({type:'stream-chunk',requestId:msg.requestId,chunkBody:text}));
    chunk('[[' + JSON.stringify(frame('start')));
    // Total generation exceeds 500 ms, but every inter-chunk gap stays well below it.
    for (let i=0; i<4; i++) { await delay(180); chunk(',' + JSON.stringify(frame(' next'))); }
    chunk(',' + JSON.stringify(finish) + ']]');
    ws.send(JSON.stringify({type:'stream-end',requestId:msg.requestId}));
    const response = await responsePromise;
    assert.equal(response.status,200);
    if (streaming) { const text=await response.text(); assert.ok(text.includes('[DONE]')); assert.ok(!text.includes('"error"')); }
    else assert.equal((await response.json()).choices[0].message.content,'start next next next next');
  });
});

test('a stream that stalls after progress still times out and cancels the executor', async t => {
  const {call, connect} = await setup(t, 180); const ws = await connect();
  const received = once(ws,'message');
  const responsePromise=call('/v1/chat/completions',{...request,stream:true});
  const msg=JSON.parse((await received)[0]);
  const cancelled=once(ws,'message');
  ws.send(JSON.stringify({type:'stream-chunk',requestId:msg.requestId,chunkBody:'[['+JSON.stringify(frame('partial'))}));
  const text=await (await responsePromise).text();
  assert.ok(text.includes('"code":"timeout"'));assert.ok(!text.includes('[DONE]'));
  assert.equal(JSON.parse((await cancelled)[0]).type,'cancel');
});

test('tool first-byte wait survives the ordinary idle limit; SSE comments do not invent content or reset deadlines',async t=>{
  const {base,call,connect}=await setup(t,120,{toolFirstByteTimeoutMs:500,streamKeepAliveMs:25});const ws=await connect();
  const received=once(ws,'message');const work=call('/v1/chat/completions',{...request,model:'pg-gemini-test-抗截断',stream:true});
  const msg=JSON.parse((await received)[0]);
  const response=await work,reader=response.body.getReader();let all=new TextDecoder().decode((await reader.read()).value);assert.ok(all.includes(': mmdb-waiting'));assert.ok(!all.includes('data:'));
  await delay(180);
  const status=await(await call('/v1/status')).json();assert.equal(status.pending,1);assert.equal(status.active[0].firstByteWaitMs,500);assert.equal(status.active[0].upstreamBytes,0);assert.equal(status.active[0].bodyChars,0);
  const p=Array(11).fill(null);p[10]=['mmdb_emit_answer',[[['content',[null,null,'TOOL_AFTER_WAIT']]]]];
  ws.send(JSON.stringify({type:'stream-chunk',requestId:msg.requestId,chunkBody:JSON.stringify([[[[[[[p],'model']]]],finish]])}));ws.send(JSON.stringify({type:'stream-end',requestId:msg.requestId}));
  for(;;){const {done,value}=await reader.read();if(done)break;all+=new TextDecoder().decode(value);}
  assert.ok(all.includes('TOOL_AFTER_WAIT'));assert.ok(all.includes('[DONE]'));assert.ok(!all.includes('"error"'));
});

test('progress is metadata only; heartbeats and phase updates cannot postpone a no-data timeout',async t=>{
  const {call,connect}=await setup(t,100,{toolFirstByteTimeoutMs:240,streamKeepAliveMs:20});const ws=await connect();
  const received=once(ws,'message');const work=call('/v1/chat/completions',{...request,model:'pg-gemini-test-抗截断',stream:true});const msg=JSON.parse((await received)[0]);
  let i=0;const timer=setInterval(()=>ws.send(JSON.stringify({type:'progress',requestId:msg.requestId,phase:i++%2?'request-sent':'headers',httpStatus:200,body:'PRIVATE_NOT_LOGGED'})),30);t.after(()=>clearInterval(timer));
  const response=await work;const raw=await response.text();clearInterval(timer);assert.ok(raw.includes(': mmdb-waiting'));assert.ok(raw.includes('upstream_first_byte_timeout'));assert.ok(!raw.includes('[DONE]'));assert.ok(!raw.includes('PRIVATE_NOT_LOGGED'));
  const status=await(await call('/v1/status')).json();assert.equal(status.pending,0);assert.equal(status.recent[0].upstreamBytes,0);assert.equal(status.recent[0].upstreamHttpStatus,200);assert.ok(status.recent[0].elapsedMs<1000);assert.ok(!JSON.stringify(status).includes('PRIVATE_NOT_LOGGED'));
});
