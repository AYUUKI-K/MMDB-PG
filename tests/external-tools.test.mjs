import {test} from 'node:test';
import assert from 'node:assert/strict';
import {relayFixture,frame,finish} from './helpers.mjs';
import {fromOpenAI,toWire} from '../src/server/protocol.mjs';
import {encodeStruct} from '../src/server/tool-history.mjs';
import {decodeStruct,ExternalToolCalls} from '../src/server/external-tools.mjs';

const declaration={type:'function',function:{name:'lookup',description:'Look up a value',parameters:{type:'object',properties:{query:{type:'string'},count:{type:'integer'}},required:['query'],additionalProperties:false}}};
const request={model:'pg-test',messages:[{role:'user',content:'Look up cats'}],tools:[declaration]};
const tool=(name='lookup',args={query:'猫 🐈\n"test"',count:2},id='provider-id',signature='provider-signature')=>{
  const part=Array(15).fill(null);part[10]=[name,args===undefined?null:encodeStruct(args),id];part[14]=signature;return part;
};
const chunks=raw=>raw.split('\n').filter(line=>line.startsWith('data: {')).map(line=>JSON.parse(line.slice(6)));

test('tool declaration, choice and typed history encode without mutating the request',()=>{
  const before=structuredClone(request),payload=toWire('test',fromOpenAI(request));
  assert.deepEqual(request,before);assert.equal(payload.wire[6][0][1][0][0],'lookup');assert.equal(payload.wire[6][0][1][0][2][0],6);
  assert.equal(payload.binding,'Look up cats');
  assert.equal(toWire('test',fromOpenAI({...request,tool_choice:'none'})).wire[6],null);
  const required=toWire('test',fromOpenAI({...request,tool_choice:{type:'function',function:{name:'lookup'}}}));
  assert.match(required.wire[5][0][0][1],/requires a function call/);
  const values=JSON.parse('{"__proto__":{"safe":true},"null":null,"number":-1.5,"bool":false,"array":[1,"猫",null,{"nested":[]}]}');
  assert.deepEqual(decodeStruct(encodeStruct(values)),values);assert.equal({}.safe,undefined);
});

for(const model of ['pg-test','pg-test-抗截断'])for(const stream of [false,true]){
  test(`external calls return intact and round-trip tool results: ${model}, stream=${stream}`,async t=>{
    const f=await relayFixture(t,{inputRead:true,inputReadSynthetic:true,nativeContinuation:true});let dispatched=0;
    f.ws.on('message',raw=>{
      const msg=JSON.parse(raw);if(msg.type!=='request')return;dispatched++;
      const payload=JSON.parse(msg.requestBody);assert.equal(msg.allowNetworkRetry,false);
      assert.equal(payload.wire[6][0][1][0][0],'lookup');assert.ok(!payload.binding.includes('mmdb_emit_answer'));assert.ok(!payload.binding.includes('mmdb_read_input'));
      if(dispatched===1)f.deliver(msg,[frame([tool()]),finish()]);
      else{
        const call=payload.wire[1][1][0][0],result=payload.wire[1][2][0][0];
        assert.equal(call[14],'provider-signature');assert.equal(call[10][2],'provider-id');
        assert.deepEqual(decodeStruct(result[11][1]),{result:'Exact result\n{"x":1}'});
        f.deliver(msg,[frame([[null,'Final answer']]),finish()]);
      }
    });
    const response=await f.call({...request,model,stream,stream_options:{include_usage:true}});assert.equal(response.status,200);
    let call;
    if(stream){const data=chunks(await response.text()),toolChunk=data.find(c=>c.choices[0]?.delta.tool_calls);call=toolChunk.choices[0].delta.tool_calls[0];assert.equal(call.index,0);assert.equal(data.find(c=>c.choices[0]?.finish_reason)?.choices[0].finish_reason,'tool_calls');assert.ok(data.some(c=>c.usage));}
    else{const data=await response.json();assert.equal(data.choices[0].finish_reason,'tool_calls');assert.equal(data.choices[0].message.content,null);assert.equal(data.mmdb.antiTruncationSkipped,model.endsWith('抗截断'));assert.equal(data.mmdb.inputReadSkipped,true);call=data.choices[0].message.tool_calls[0];}
    delete call.index;assert.equal(call.id,'provider-id');assert.equal(call.extra_content.google.thought_signature,'provider-signature');assert.equal(JSON.parse(call.function.arguments).query,'猫 🐈\n"test"');
    const follow=await f.call({...request,model,messages:[...request.messages,{role:'assistant',content:null,tool_calls:[call]},{role:'tool',tool_call_id:call.id,content:'Exact result\n{"x":1}'}]});
    assert.equal(follow.status,200);assert.equal((await follow.json()).choices[0].message.content,'Final answer');assert.equal(dispatched,2);
    assert.equal((await f.status()).experiments.settings.inputRead,true);
  });
}

test('parallel calls, generated IDs and Gemini response parts preserve structured arguments',async t=>{
  const f=await relayFixture(t);
  f.ws.on('message',raw=>{const msg=JSON.parse(raw);if(msg.type==='request')f.deliver(msg,[frame([tool('lookup',{query:'one'},null),tool('lookup',{query:'two'},null)]),finish()]);});
  for(const stream of [false,true]){
    const response=await fetch(f.base+`/v1beta/models/pg-test:${stream?'streamGenerateContent':'generateContent'}`,{method:'POST',headers:f.headers,body:JSON.stringify({contents:[{role:'user',parts:[{text:'look up'}]}],tools:[{functionDeclarations:[declaration.function]}]})});
    assert.equal(response.status,200);const data=stream?chunks(await response.text()).at(-1):await response.json();
    const parts=data.candidates[0].content.parts;assert.equal(parts.length,2);assert.notEqual(parts[0].functionCall.id,parts[1].functionCall.id);assert.equal(parts[1].functionCall.args.query,'two');
  }
});

test('SSE does not expose executable calls before upstream completion',async t=>{
  const f=await relayFixture(t);let task;
  f.ws.on('message',raw=>{const msg=JSON.parse(raw);if(msg.type!=='request')return;task=msg;f.send(msg,{type:'stream-chunk',chunkBody:'[['+JSON.stringify(frame([[null,'Checking'],tool()]))});});
  const response=await f.call({...request,stream:true});const reader=response.body.getReader();
  const first=new TextDecoder().decode((await reader.read()).value);assert.match(first,/Checking/);assert.ok(!first.includes('tool_calls'));
  f.send(task,{type:'stream-chunk',chunkBody:','+JSON.stringify(finish(2))+']]'});f.send(task,{type:'stream-end'});
  let rest='';for(;;){const next=await reader.read();if(next.done)break;rest+=new TextDecoder().decode(next.value);}
  assert.match(rest,/incomplete_external_tool_call/);assert.ok(!rest.includes('"tool_calls"'));assert.ok(!rest.includes('[DONE]'));
});

for(const [name,body,parts,code] of [
  ['required without call',{tool_choice:'required'},[[null,'No call']],'tool_choice_not_honored'],
  ['disabled tool',{tool_choice:'none'},[tool()],'invalid_external_tool_call'],
  ['undeclared name',{},[tool('wrong')],'invalid_external_tool_call'],
  ['parallel disabled',{parallel_tool_calls:false},[tool(),tool('lookup',{query:'two'},'second')],'parallel_tools_not_honored'],
])test(name,async t=>{const f=await relayFixture(t);f.ws.on('message',raw=>{const msg=JSON.parse(raw);if(msg.type==='request')f.deliver(msg,[frame(parts),finish()]);});const r=await f.call({...request,...body});assert.equal(r.status,502);assert.equal((await r.json()).error.code,code);});

test('invalid contracts and incomplete histories fail before dispatch',async t=>{
  const f=await relayFixture(t);let dispatched=0;f.ws.on('message',raw=>{if(JSON.parse(raw).type==='request')dispatched++;});
  for(const body of [
    {tools:[{type:'custom',name:'unsupported'}]},
    {tools:[{...declaration,function:{...declaration.function,strict:true}}]},
    {tools:[{...declaration,function:{...declaration.function,parameters:{$ref:'#/missing'}}}]},
    {tools:[declaration,declaration]},
    {tool_choice:{type:'function',function:{name:'undeclared'}}},
    {tools:[],tool_choice:'required'},
    {parallel_tool_calls:'false'},
    {messages:[{role:'assistant',content:null,tool_calls:[{id:'missing-result',type:'function',function:{name:'lookup',arguments:'{}'}}]}]},
    {messages:[{role:'tool',tool_call_id:'missing-call',content:'no call'}]},
  ]){const r=await f.call({...request,...body});assert.equal(r.status,400);await r.arrayBuffer();}
  assert.equal(dispatched,0);
});

test('name-only frames can complete later; conflicting args or missing finish never become calls',()=>{
  const policy={allowed:new Set(['lookup']),mode:'AUTO'},calls=new ExternalToolCalls(policy);
  calls.decode(['lookup',null,'one'],{partIndex:0});calls.decode([null,encodeStruct({query:'one'}),'one'],{partIndex:0,thoughtSignature:'sig'});
  assert.equal(calls.finish('STOP')[0].thoughtSignature,'sig');
  assert.throws(()=>calls.decode(['lookup',encodeStruct({query:'other'}),'one'],{partIndex:0}),{code:'invalid_external_tool_call'});
  assert.throws(()=>calls.finish('MAX_TOKENS'),{code:'incomplete_external_tool_call'});
});
