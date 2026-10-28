import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {WebSocket} from 'ws';
import {createRelay} from '../src/server/server.mjs';
import {saveExperimentalConfig} from '../src/server/config.mjs';
import {experimentSettings} from '../src/shared/experiments.js';

async function setup(t,extra={}) {
  const app=createRelay({apiKey:'test',models:['gemini-test'],timeoutMs:1000,...extra});
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');t.after(()=>app.close());
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const call=(body,key='test',path='/v1/experiments')=>fetch(base+path,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const ws=new WebSocket(base.replace('http:','ws:')+'/api/build/ws');await once(ws,'open');
  const messages=[];ws.on('message',data=>messages.push(JSON.parse(data)));
  const registered=once(ws,'message');ws.send(JSON.stringify({type:'register',executorType:'playground',apiKey:'test',protocolVersion:2}));
  const connectionId=JSON.parse((await registered)[0]).connectionId;
  const next=type=>new Promise(resolve=>{const handler=data=>{const message=JSON.parse(data);if(message.type===type){ws.off('message',handler);resolve(message);}};ws.on('message',handler);});
  return {app,call,ws,messages,connectionId,next};
}

test('experiment settings reject unverified switches and non-booleans',()=>{
  assert.deepEqual(experimentSettings(),{nativeContinuation:false,inputRead:false,inputReadSynthetic:false});
  for(const value of [null,[],{nativeContinuation:'true'},{forceToolCall:true},{streamToolArguments:false}])assert.throws(()=>experimentSettings(value));
});

test('saving a native switch preserves credentials and unrelated config fields',t=>{
  const dir=mkdtempSync(join(tmpdir(),'mmdb-experiment-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const file=join(dir,'config.json'),original={apiKey:'test-secret',port:8765,models:['custom'],userValue:{unchanged:true}};
  writeFileSync(file,JSON.stringify(original));saveExperimentalConfig({nativeContinuation:true},file);
  assert.deepEqual(JSON.parse(readFileSync(file,'utf8')),{...original,nativeContinuation:true});
  saveExperimentalConfig({nativeContinuation:false},file);
  assert.equal(JSON.parse(readFileSync(file,'utf8')).nativeContinuation,false);
  saveExperimentalConfig({inputRead:true},file);
  assert.deepEqual(JSON.parse(readFileSync(file,'utf8')),{...original,nativeContinuation:false,inputRead:true});
  saveExperimentalConfig({nativeContinuation:true},file);
  assert.equal(JSON.parse(readFileSync(file,'utf8')).inputRead,true);
  saveExperimentalConfig({inputReadSynthetic:true},file);
  assert.equal(JSON.parse(readFileSync(file,'utf8')).inputReadSynthetic,true);
  assert.equal(JSON.parse(readFileSync(file,'utf8')).apiKey,original.apiKey);
});

test('authenticated HTTP and owned WS share authoritative persisted settings',async t=>{
  const saved=[];const {call,ws,next,connectionId}=await setup(t,{persistExperiments:settings=>saved.push(settings)});
  assert.equal((await call(undefined,'wrong')).status,401);
  assert.equal((await call({forceToolCall:true})).status,400);
  assert.equal((await call()).status,200);
  let reply=next('experiments');const posted=await call({nativeContinuation:true});
  assert.equal(posted.status,200);assert.equal((await reply).settings.nativeContinuation,true);assert.equal(saved.length,1);
  // A message belonging to an obsolete connection must not change the setting.
  ws.send(JSON.stringify({type:'experiments:set',connectionId:'old',settings:{nativeContinuation:false}}));
  reply=next('experiments');ws.send(JSON.stringify({type:'experiments:set',connectionId,settings:{nativeContinuation:false}}));
  assert.equal((await reply).settings.nativeContinuation,false);assert.equal(saved.length,2);
  assert.equal((await (await call()).json()).settings.nativeContinuation,false);
});

test('failed persistence keeps prior setting, and active requests lock settings',async t=>{
  let fail=true;const {call,ws,next,connectionId}=await setup(t,{persistExperiments:()=>{if(fail)throw Error('disk failed');}});
  const failed=await call({nativeContinuation:true});assert.equal(failed.status,500);assert.equal((await (await call()).json()).settings.nativeContinuation,false);
  fail=false;
  const dispatched=next('request');const work=call({model:'pg-gemini-test',messages:[{role:'user',content:'hi'}]},'test','/v1/chat/completions');
  const request=await dispatched;
  assert.equal((await call({nativeContinuation:true})).status,409);
  assert.equal((await (await call()).json()).busy,true);
  const settled=next('experiments');ws.send(JSON.stringify({...request,type:'error',connectionId,status:502,error:{message:'synthetic failure'}}));
  assert.equal((await work).status,502);assert.equal((await settled).busy,false);
  assert.equal((await call({nativeContinuation:true})).status,200);
});
