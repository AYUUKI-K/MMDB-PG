import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import {createRelay} from '../server.mjs';
import {fromOpenAI,toWire} from '../protocol.mjs';
import {envelopePayload,ANSWER_TOOL} from '../anti-truncation.mjs';
import {nextTurn} from '../continuation.mjs';
import {generationSummary} from '../metrics.mjs';

const request={messages:[{role:'user',content:'Hello'}],temperature:1,top_p:0.9,max_tokens:65535};
const contentFrame=parts=>[[[[parts,'model']]]];
const thought=Array(15).fill(null);thought[1]='THOUGHT_SUMMARY';thought[12]=true;thought[14]='opaque-signature';
const tool=Array(11).fill(null);tool[10]=[ANSWER_TOOL,[[['content',[null,null,'FINAL_ANSWER']]]]];
const finish=[[[null,1]]];

test('other models retain unspecified effort and all modes preserve prompt binding',()=>{
  const original=structuredClone(request),body=fromOpenAI(request);
  for(const payload of [toWire('test',body),envelopePayload('test',body)]){
    assert.deepEqual(payload.wire[3][16],[1]);
    assert.equal(payload.wire[3][3],65535);assert.equal(payload.wire[3][4],1);assert.equal(payload.wire[3][5],0.9);
    assert.equal(payload.wire[1].at(-1)[1],'user');
    assert.equal(payload.binding,payload.wire[1].flatMap(turn=>turn[0].map(part=>part[1])).join(' '));
  }
  assert.equal(toWire('test',body).binding,'Hello');assert.deepEqual(request,original);
  assert.deepEqual(envelopePayload('test',nextTurn(body,'partial')).wire[3][16],[1]);
});

test('4A explicitly uses medium without setting a numeric budget, including tool and continuation modes',()=>{
  const body=fromOpenAI({...request,model:'pg-gemini-4-argon'});
  for(const encode of [toWire,envelopePayload])for(const input of [body,nextTurn(body,'partial')]){
    const result=encode('gemini-4-argon',input);
    assert.deepEqual(result.wire[3][16],[1,null,null,2]);
    assert.equal(result.wire[3][3],65535);
    assert.equal(generationSummary(result).thinkingLevel,'medium');
    assert.equal(generationSummary(result).includeThoughts,true);
    assert.equal(result.wire[1].at(-1)[1],'user');
  }
});

test('explicit OpenAI and native thinking levels override 4A fallback without changing summary opt-out',()=>{
  const options=[
    [fromOpenAI({...request,reasoning_effort:'low'}),1],
    [fromOpenAI({...request,reasoning_effort:'high'}),3],
    [fromOpenAI({...request,reasoning_effort:'max'}),3],
    [fromOpenAI({...request,reasoning_effort:'auto'}),2],
    [fromOpenAI({...request,reasoning_effort:'low',extra_body:{google:{thinking_config:{thinking_level:'HIGH'}}}}),3],
    [{contents:[{parts:[{text:'hi'}]}],generationConfig:{thinkingConfig:{thinkingLevel:'THINKING_LEVEL_LOW'}}},1],
    [{contents:[{parts:[{text:'hi'}]}],generation_config:{thinking_config:{thinking_level:'medium'}}},2],
  ];
  for(const [body,level] of options)for(const encode of [toWire,envelopePayload]){
    assert.deepEqual(encode('gemini-4-argon',body).wire[3][16],[1,null,null,level]);
    assert.deepEqual(encode('gemini-4-argon',nextTurn(body,'partial')).wire[3][16],[1,null,null,level]);
  }
  const off=toWire('gemini-4-argon',fromOpenAI({...request,include_reasoning:false,reasoning_effort:'high'}));
  assert.deepEqual(off.wire[3][16],[0,null,null,3]);
  assert.equal(generationSummary(off).includeThoughts,false);assert.equal(generationSummary(off).thinkingLevel,'high');
});

test('explicit summary opt-out and Build-compatible options survive both transports and continuation',()=>{
  const variants=[
    fromOpenAI({...request,include_reasoning:false}),
    fromOpenAI({...request,extra_body:{google:{thinking_config:{include_thoughts:false}}}}),
    {contents:[{parts:[{text:'Hello'}]}],generationConfig:{thinkingConfig:{includeThoughts:false}}},
    {contents:[{parts:[{text:'Hello'}]}],generation_config:{thinking_config:{include_thoughts:false}}},
  ];
  for(const body of variants)for(const encode of [toWire,envelopePayload]){
    assert.deepEqual(encode('test',body).wire[3][16],[0]);
    assert.deepEqual(encode('test',nextTurn(body,'partial')).wire[3][16],[0]);
  }
  const explicit=fromOpenAI({...request,include_reasoning:false,extra_body:{google:{thinking_config:{include_thoughts:true}}}});
  assert.deepEqual(toWire('test',explicit).wire[3][16],[1]);
});

test('malformed summary switches fail locally instead of accidentally enabling them',()=>{
  for(const value of ['false',0,null,[]])assert.throws(()=>fromOpenAI({...request,include_reasoning:value}),{status:400});
  for(const value of [null,false,[],{includeThoughts:'false'},{include_thoughts:0},{thinkingBudget:8192},{includeThoughts:true,include_thoughts:false}]){
    assert.throws(()=>toWire('test',{contents:[{parts:[{text:'hi'}]}],generationConfig:{thinkingConfig:value}}),{status:400});
  }
  for(const value of [null,0,'typo','none'])assert.throws(()=>fromOpenAI({...request,reasoning_effort:value}),{status:400});
  assert.throws(()=>toWire('gemini-4-argon',{contents:[{parts:[{text:'hi'}]}],generationConfig:{thinkingConfig:{thinkingLevel:'high',thinking_level:'low'}}}),{status:400});
});

async function setup(t){
  const app=createRelay({apiKey:'mmdb',models:['test','gemini-4-argon'],timeoutMs:2000,maxContinuations:0});
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');t.after(()=>app.close());
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const ws=new WebSocket(base.replace('http:','ws:')+'/api/build/ws',{origin:'https://aistudio.google.com'});
  await once(ws,'open');const ack=once(ws,'message');ws.send(JSON.stringify({type:'register',executorType:'playground',apiKey:'mmdb'}));await ack;
  const call=(path,body)=>fetch(base+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer mmdb','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  const send=(msg,raw)=>ws.send(JSON.stringify({type:'stream-chunk',requestId:msg.requestId,chunkBody:raw}));
  const end=msg=>ws.send(JSON.stringify({type:'stream-end',requestId:msg.requestId}));
  return {ws,call,send,end};
}

test('OpenAI and native Gemini preserve separate thoughts and answers in ordinary and tool modes',async t=>{
  for(const extended of [false,true])for(const native of [false,true])await t.test(`${extended?'tool':'plain'} ${native?'Gemini':'OpenAI'}`,async t=>{
    const {ws,call,send,end}=await setup(t);
    ws.on('message',data=>{
      const msg=JSON.parse(data);if(msg.type!=='request')return;
      assert.deepEqual(JSON.parse(msg.requestBody).wire[3][16],[1,null,null,2]);
      send(msg,JSON.stringify([[contentFrame([thought]),contentFrame([extended?tool:[null,'FINAL_ANSWER']]),finish]]));end(msg);
    });
    const model='pg-gemini-4-argon'+(extended?'-抗截断':'');
    const res=await call(native?`/v1beta/models/${encodeURIComponent(model)}:generateContent`:'/v1/chat/completions',native?{contents:[{parts:[{text:'hi'}]}]}:{...request,model});
    assert.equal(res.status,200);const body=await res.json();
    if(native)assert.deepEqual(body.candidates[0].content.parts,[{text:'THOUGHT_SUMMARY',thought:true,thoughtSignature:'opaque-signature'},{text:'FINAL_ANSWER'}]);
    else assert.deepEqual(body.choices[0].message,{role:'assistant',content:'FINAL_ANSWER',reasoning_content:'THOUGHT_SUMMARY'});
    const row=(await(await call('/v1/status')).json()).recent[0];
    assert.equal(row.thoughtChars,'THOUGHT_SUMMARY'.length);assert.equal(row.bodyChars,'FINAL_ANSWER'.length);
    assert.equal(row.generation.thinkingConfigSent,true);
    assert.equal(row.generation.thinkingLevel,'medium');assert.equal(row.generation.includeThoughts,true);
    assert.ok(!JSON.stringify(row).includes('THOUGHT_SUMMARY'));assert.ok(!JSON.stringify(row).includes('opaque-signature'));
  });
});

test('streaming forwards thoughts before the final answer arrives, including anti-truncation',async t=>{
  for(const extended of [false,true])for(const native of [false,true])await t.test(`${extended?'tool':'plain'} ${native?'Gemini':'OpenAI'}`,async t=>{
    const {ws,call,send,end}=await setup(t);let current;
    ws.on('message',data=>{
      const msg=JSON.parse(data);if(msg.type!=='request')return;current=msg;
      assert.deepEqual(JSON.parse(msg.requestBody).wire[3][16],[1,null,null,2]);
      send(msg,'[['+JSON.stringify(contentFrame([thought])));
    });
    const model='pg-gemini-4-argon'+(extended?'-抗截断':'');
    const res=await call(native?`/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent`:'/v1/chat/completions',native?{contents:[{parts:[{text:'hi'}]}]}:{...request,model,stream:true});
    assert.equal(res.status,200);const reader=res.body.getReader(),decoder=new TextDecoder();let first='';
    while(!first.includes('THOUGHT_SUMMARY')){const item=await reader.read();assert.equal(item.done,false);first+=decoder.decode(item.value);}
    assert.ok(!first.includes('FINAL_ANSWER'));assert.ok(!first.includes('[DONE]'));
    if(!native)assert.ok(first.includes('"reasoning_content":"THOUGHT_SUMMARY"'));
    send(current,','+JSON.stringify(contentFrame([extended?tool:[null,'FINAL_ANSWER']]))+','+JSON.stringify(finish)+']]');end(current);
    let rest='';for(;;){const item=await reader.read();if(item.done)break;rest+=decoder.decode(item.value);}
    assert.ok(rest.includes('FINAL_ANSWER'));assert.ok(!rest.includes('"error"'));
    if(!native)assert.ok(rest.includes('[DONE]'));
  });
});
