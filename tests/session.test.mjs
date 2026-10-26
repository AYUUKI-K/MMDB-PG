import {generateWithRecovery} from '../src/browser/recovery.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {GooglePageSession} from '../src/browser/session.js';
function setup(t){
  let value='',calls=0;
  class Textarea{get value(){return value;}set value(v){value=v;}getClientRects(){return [{}];}dispatchEvent(){}}
  const input=new Textarea();
  const previousDocument=globalThis.document,previousStyle=globalThis.getComputedStyle;
  globalThis.document={querySelectorAll:()=>[input]};globalThis.getComputedStyle=()=>({visibility:'visible'});
  t.after(()=>{globalThis.document=previousDocument;globalThis.getComputedStyle=previousStyle;});
  const page={Headers,Event,HTMLTextAreaElement:Textarea,crypto:webcrypto,location:{href:'https://aistudio.google.com/prompts/new_chat'},fetch:async()=>{calls++;return new Response('stream-result');},default_MakerSuite:{async proof(service,digest){/* page generator: yield */return service.snapshot({content:digest});}}};
  const session=new GooglePageSession(page,()=>{});session.service={snapshot:async()=> '!test-proof'};session.snapshot=digest=>session.service.snapshot({content:digest});session.proofOK=true;session.headers={'x-goog-api-key':'test-public-header'};t.after(()=>session.destroy());
  return {page,session,input,calls:()=>calls,payload:{wire:['models/test'],binding:'hello'}};
}

test('catalog uses the captured endpoint and headers without touching the prompt or generating a proof',async t=>{
  const {session,input}=setup(t);input.value='preserved draft';let proofs=0;
  session.endpoint='https://alkalimakersuite-pa.clients6.google.com/$rpc/google.internal.alkali.applications.makersuite.v1.MakerSuiteService/GenerateContent';
  session.headers={'x-goog-api-key':'public','x-goog-authuser':'1','x-aistudio-g1-tier':'captured-tier'};
  session.snapshot=async()=>{proofs++;return '!proof';};
  session.fetch=async(url,options)=>{assert.ok(url.endsWith('/ListModels'));assert.equal(options.body,'[]');assert.equal(options.credentials,'include');assert.equal(options.headers['x-goog-authuser'],'1');assert.equal(options.headers['x-aistudio-g1-tier'],'captured-tier');return new Response('[[]]');};
  assert.equal(await session.listModels(new AbortController().signal),'[[]]');assert.equal(proofs,0);assert.equal(input.value,'preserved draft');
});

test('snapshot discovery accepts Promise and alternate field spellings but still validates the native result',async t=>{
  for(const candidate of [
    function(service,digest){return Promise.resolve(service.snapshot({content:digest}));},
    async function(service,digest){return service.snapshot({Bcc:{content:digest}});},
    function(service,digest){return Promise.resolve(service.snapshot({e9b:digest}));}
  ]){
    const {page,session}=setup(t);session.hooked=false;session.proofOK=false;
    page.default_MakerSuite={candidate};session.discover();
    await page.default_MakerSuite.candidate({snapshot:()=> 'not-a-proof'},'digest');
    assert.equal(session.ready,false);
    const service={snapshot:()=> '!observed-native-proof'};
    await page.default_MakerSuite.candidate(service,'digest');
    assert.equal(session.ready,true);assert.equal(session.service,service);
    assert.equal(await session.snapshot('fresh-digest'),'!observed-native-proof');
  }
});

test('optional empty proof requires an observed native GenerateContent request and remains optional only in that context',async t=>{
  const {page,session,payload}=setup(t);
  const service={snapshot:async()=>''};
  await page.default_MakerSuite.proof(service,'digest');
  assert.equal(session.ready,false);
  const endpoint='https://alkalimakersuite-pa.clients6.google.com/$rpc/google.internal.alkali.applications.makersuite.v1.MakerSuiteService/GenerateContent';
  await page.fetch(endpoint,{headers:{'x-goog-api-key':'public'},body:JSON.stringify(['models/test',[],null,null,''])});
  assert.equal(session.ready,true);
  let wire;session.fetch=async(_url,options)=>{wire=JSON.parse(options.body);return new Response('ok');};
  await session.generate(payload,new AbortController().signal,()=>{});assert.equal(wire[4],'');
  await page.fetch(endpoint,{headers:{'x-goog-api-key':'public'},body:JSON.stringify(['models/test',[],null,null,'!native'])});
  assert.equal(session.ready,false);
});

test('signed sessions never silently retry without a proof',async t=>{
  const {session,payload,calls}=setup(t);session.snapshot=async()=>'';
  await assert.rejects(session.generate(payload,new AbortController().signal,()=>{}),{code:'invalid_proof'});assert.equal(calls(),0);
});

test('capturing a new native request context updates the session without an email',async t=>{
  const {page,session}=setup(t);
  const endpoint='https://alkalimakersuite-pa.clients6.google.com/$rpc/google.internal.alkali.applications.makersuite.v1.MakerSuiteService/GenerateContent';
  await page.fetch(endpoint,{headers:{'x-goog-api-key':'public','x-goog-authuser':'0'}});
  assert.equal(session.ready,true);const revision=session.contextVersion;
  await page.fetch(endpoint,{headers:{'x-goog-api-key':'public','x-goog-authuser':'1'}});
  assert.equal(session.headers['x-goog-authuser'],'1');assert.equal(session.contextVersion,revision+1);assert.equal(session.ready,true);
});

test('changed account context invalidates a model catalog and in-flight generation',async t=>{
  const {session,payload,input}=setup(t);
  session.endpoint='https://alkalimakersuite-pa.clients6.google.com/$rpc/google.internal.alkali.applications.makersuite.v1.MakerSuiteService/GenerateContent';
  session.fetch=async()=>{session.contextVersion++;return new Response('[[]]');};
  await assert.rejects(session.listModels(new AbortController().signal),/会话已变化/);
  let delivered=false;await assert.rejects(session.generate(payload,new AbortController().signal,()=>delivered=true),{code:'session_changed'});assert.equal(delivered,false);assert.equal(input.value,'');
});

test('native continuation gets a new proof for the same original binding on every round',async t=>{
  const {session}=setup(t);let proofs=0;const requests=[];
  session.snapshot=async()=>`!proof-${++proofs}`;
  session.fetch=async(url,options)=>{requests.push(JSON.parse(options.body));return new Response('result');};
  const initial={wire:['models/test'],binding:'unchanged original contents'},next=structuredClone(initial);next.wire[16]='synthetic-token';
  for(const payload of [initial,next])await session.generate(payload,new AbortController().signal,()=>{});
  assert.equal(requests[0][4],'!proof-1');assert.equal(requests[1][4],'!proof-2');assert.equal(requests[1][16],'synthetic-token');assert.equal(initial.wire[4],undefined);assert.equal(next.wire[4],undefined);
});

test('headers followed by a failed first read get one bounded fresh-proof recovery',async t=>{
  const {session,payload}=setup(t);let calls=0,proofs=0,retries=0,text='';
  session.snapshot=async()=>{proofs++;return '!proof';};
  session.fetch=async()=>++calls===1?new Response(new ReadableStream({start(controller){controller.error(new TypeError('Failed to fetch'));}})):new Response('answer');
  await generateWithRecovery(session,payload,new AbortController().signal,chunk=>text+=chunk,phase=>{if(phase==='network-retry')retries++;},{retry:true,delayMs:1});
  assert.equal(calls,2);assert.equal(proofs,2);assert.equal(retries,1);assert.equal(text,'answer');
});

test('a failed reader after any bytes cannot replay the generation, even an incomplete UTF-8 character',async t=>{
  for(const bytes of [new TextEncoder().encode('partial'),new Uint8Array([0xe4])]){
    const {session,payload}=setup(t);let calls=0,reads=0;
    session.fetch=async()=>{calls++;return new Response(new ReadableStream({pull(controller){if(reads++)controller.error(new TypeError('Failed to fetch'));else controller.enqueue(bytes);}}));};
    await assert.rejects(generateWithRecovery(session,payload,new AbortController().signal,()=>{},()=>{},{retry:true,delayMs:1}),{code:'upstream_stream_disconnected'});
    assert.equal(calls,1);
  }
});

test('parser exceptions are not misclassified as retryable transport failures',async t=>{
  const {session,payload,calls}=setup(t);const error=Object.assign(new Error('parser rejected frame'),{code:'invalid_upstream'});
  await assert.rejects(generateWithRecovery(session,payload,new AbortController().signal,()=>{throw error;},()=>{},{retry:true,delayMs:1}),error);
  assert.equal(calls(),1);
});
test('new session preserves user drafts and does not contact Google',async t=>{
  const {session,input,payload,calls}=setup(t);input.value='my draft';await assert.rejects(session.generate(payload,new AbortController().signal,()=>{}),/草稿/);assert.equal(input.value,'my draft');assert.equal(calls(),0);
});
test('early abort stops before fetch and the next generation works',async t=>{
  const {session,input,payload,calls}=setup(t);const controller=new AbortController();controller.abort();await assert.rejects(session.generate(payload,controller.signal,()=>{}),{name:'AbortError'});assert.equal(calls(),0);
  let text='';await session.generate(payload,new AbortController().signal,chunk=>text+=chunk);assert.equal(text,'stream-result');assert.equal(input.value,'');assert.equal(calls(),1);
});
test('abort while proof is preparing clears only its own input',async t=>{
  const {session,input,payload,calls}=setup(t);const controller=new AbortController();let resolveProof;const waiting=new Promise(resolve=>resolveProof=resolve);session.snapshot=()=>waiting;
  const work=session.generate(payload,controller.signal,()=>{});await new Promise(resolve=>setTimeout(resolve,5));controller.abort();resolveProof('!proof');await assert.rejects(work,{name:'AbortError'});assert.equal(input.value,'');assert.equal(calls(),0);
  session.snapshot=async()=> '!proof';await session.generate(payload,new AbortController().signal,()=>{});assert.equal(calls(),1);
});
test('cleanup never deletes a draft typed during generation',async t=>{
  const {session,input,payload}=setup(t);session.fetch=async()=>{input.value='new draft';return new Response('ok');};await session.generate(payload,new AbortController().signal,()=>{});assert.equal(input.value,'new draft');
});

test('session reports proof, request, headers and actual first data separately without prompt or credentials',async t=>{
  const {session,payload}=setup(t);const phases=[];let release,firstChunk;
  const ready=new Promise(resolve=>firstChunk=resolve);
  session.fetch=async()=>new Response(new ReadableStream({start(controller){release=()=>{controller.enqueue(new TextEncoder().encode('BODY'));controller.close();};firstChunk();}}));
  const work=session.generate(payload,new AbortController().signal,()=>{},(phase,details={})=>phases.push({phase,...details}));
  await ready;await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(phases.map(p=>p.phase),['proof','request-sent','headers']);release();await work;
  assert.deepEqual(phases,[{phase:'proof'},{phase:'request-sent'},{phase:'headers',httpStatus:200},{phase:'streaming'}]);assert.ok(!JSON.stringify(phases).includes(payload.binding));
});

test('cancelled proof does not hold the serial executor until the proof promise resolves',async t=>{
  const {session,input,payload,calls}=setup(t);const controller=new AbortController();let entered;
  const ready=new Promise(resolve=>entered=resolve);session.snapshot=()=>{entered();return new Promise(()=>{});};
  const work=session.generate(payload,controller.signal,()=>{});await ready;controller.abort();await assert.rejects(work,{name:'AbortError'});assert.equal(input.value,'');assert.equal(calls(),0);
  session.snapshot=async()=> '!next-proof';await session.generate(payload,new AbortController().signal,()=>{});assert.equal(calls(),1);
});

test('page-realm source and multiple exports are observed until a real proof is seen',async t=>{
  const {page,session}=setup(t);session.destroy();
  const nativeBridge=function(service,digest){return service.snapshot({content:digest});};
  nativeBridge.toString=()=> 'function(s,c){return helper(function*(){return yield s.snapshot({content:c})})}';
  // A sandbox toString sees the bridge body, which has no generator signature.
  assert.equal(Function.prototype.toString.call(nativeBridge).includes('yield'),false);
  const unrelated=async function(s,c){/* yield */return s.snapshot({content:c});};
  page.default_MakerSuite={other:unrelated,actual:nativeBridge,alias:nativeBridge};
  const statuses=[],messages=[];
  const observed=new GooglePageSession(page,ready=>statuses.push(ready),message=>messages.push(message));t.after(()=>observed.destroy());
  assert.equal(observed.hooked,true);assert.equal(observed.ready,false);
  const service={snapshot:async()=> '!verified'};
  await page.default_MakerSuite.actual(service,'digest');
  await page.fetch('https://alkalimakersuite-pa.clients6.google.com/$rpc/google.internal.alkali.applications.makersuite.v1.MakerSuiteService/GenerateContent',{headers:{'x-goog-api-key':'public-header'}});
  assert.equal(observed.ready,true);assert.equal(await observed.snapshot('next'),'!verified');assert.equal(statuses.at(-1),true);
  assert.equal(observed.hooked,true);
  assert.ok(!messages.some(message=>message.includes('入口')));
  assert.ok(messages.every(message=>!message.includes('public-header')));
});

test('capture errors never prevent the original page request',async t=>{
  const {page,session,calls}=setup(t);session.destroy();page.Headers=class{constructor(){throw Error('boundary error');}};
  const observed=new GooglePageSession(page,()=>{});t.after(()=>observed.destroy());
  await page.fetch('https://alkalimakersuite-pa.clients6.google.com/$rpc/google.internal.alkali.applications.makersuite.v1.MakerSuiteService/GenerateContent',{headers:{}});
  assert.equal(calls(),1);
});

test('relay preserves the real page benefit tier, visit context and account selector',async t=>{
  const {page,session,payload}=setup(t);
  const endpoint='https://alkalimakersuite-pa.clients6.google.com/$rpc/google.internal.alkali.applications.makersuite.v1.MakerSuiteService/GenerateContent?authuser=1';
  const headers={'x-goog-api-key':'page-key','x-goog-authuser':'1','x-aistudio-g1-tier':'TIER1','x-aistudio-visit-id':'page-visit','x-user-agent':'grpc-web','authorization':'page-auth','x-unrelated':'excluded'};
  await page.fetch(endpoint,{headers});
  let outgoing;
  session.fetch=async(url,options)=>{outgoing={url,options};return new Response('ok');};
  await session.generate(payload,new AbortController().signal,()=>{});
  assert.equal(outgoing.url,endpoint);
  for(const name of ['x-goog-authuser','x-aistudio-g1-tier','x-aistudio-visit-id','x-user-agent','authorization'])assert.equal(outgoing.options.headers[name],headers[name]);
  assert.equal(outgoing.options.headers['x-unrelated'],undefined);
  assert.equal(outgoing.options.credentials,'include');
  // The next request replaces the context: a missing tier is never inherited.
  await page.fetch(endpoint.replace('authuser=1','authuser=0'),{headers:{'x-goog-api-key':'next-page-key','x-goog-authuser':'0'}});
  await session.generate(payload,new AbortController().signal,()=>{});
  assert.equal(outgoing.options.headers['x-goog-authuser'],'0');
  assert.equal(outgoing.options.headers['x-aistudio-g1-tier'],undefined);
  assert.equal(outgoing.options.headers.authorization,undefined);
});

test('non-Google and lookalike HTTP requests cannot replace the captured account context',async t=>{
  const {page,session}=setup(t);const suffix='/$rpc/google.internal.alkali.applications.makersuite.v1.MakerSuiteService/GenerateContent';
  await page.fetch('https://alkalimakersuite-pa.clients6.google.com'+suffix,{headers:{'x-goog-api-key':'real-page-key','x-aistudio-g1-tier':'TIER1'}});
  for(const origin of ['http://alkalimakersuite-pa.clients6.google.com','https://unrelated.example','https://alkalimakersuite-pa.clients6.google.com:8443'])await page.fetch(origin+suffix,{headers:{'x-goog-api-key':'other-key','x-aistudio-g1-tier':'TIER2'}});
  assert.equal(session.headers['x-goog-api-key'],'real-page-key');assert.equal(session.headers['x-aistudio-g1-tier'],'TIER1');
});


test('connection recovery obtains a fresh proof and restores the draft between attempts',async t=>{
  const {session,input,payload}=setup(t);let proofs=0;const sent=[];
  session.snapshot=async()=>`!proof-${++proofs}`;
  session.fetch=async(url,options)=>{sent.push(JSON.parse(options.body)[4]);if(sent.length===1)throw new TypeError('Failed to fetch');return new Response('answer');};
  let body='';await generateWithRecovery(session,payload,new AbortController().signal,text=>body+=text,()=>{},{retry:true,delayMs:1});
  assert.deepEqual(sent,['!proof-1','!proof-2']);assert.equal(body,'answer');assert.equal(input.value,'');
});

test('HTTP errors remain HTTP errors and do not enter connection recovery',async t=>{
  const {session,payload}=setup(t);let calls=0;
  session.fetch=async()=>{calls++;return new Response('',{status:429});};
  await assert.rejects(generateWithRecovery(session,payload,new AbortController().signal,()=>{},()=>{},{retry:true,delayMs:1}),{code:'upstream_http_error',status:429});
  assert.equal(calls,1);
});
