import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {WebSocket} from 'ws';
import {relayFixture,toolPart,frame,finish} from './helpers.mjs';

async function connect(f,fields={}){
  const ws=new WebSocket(f.base.replace('http:','ws:')+'/api/build/ws');
  await once(ws,'open');
  ws.send(JSON.stringify({type:'register',executorType:'playground',apiKey:'test',clientVersion:'mmdb-1.7.3',protocolVersion:2,...fields}));
  return ws;
}
const quota={type:'error',status:429,error:{code:'upstream_http_error',message:'Google HTTP 429'}};

for(const kind of ['http','rpc'])for(const protocol of [1,2])test(`${kind} quota errors return directly and a manual retry is immediately allowed (protocol ${protocol})`,async t=>{
  const f=await relayFixture(t,{},protocol);let calls=0;
  f.ws.on('message',raw=>{
    const m=JSON.parse(raw);if(m.type!=='request')return;
    if(++calls===1)f.send(m,kind==='http'?quota:{type:'response',rawResponse:JSON.stringify([null,[8,'Quota limit',[]]])});
    else f.deliver(m,[frame([toolPart('answer')]),finish()]);
  });
  const failed=await f.call();assert.equal(failed.status,429);
  const error=(await failed.json()).error;
  assert.equal(error.code,kind==='http'?'upstream_http_error':'upstream_quota_exhausted');
  assert.equal(error.message,kind==='http'?'Google HTTP 429':'Google RPC 8: Quota limit');
  assert.equal(calls,1);assert.equal((await f.status()).pending,0);
  assert.equal((await f.call()).status,200);assert.equal(calls,2);
});

test('another page cannot take over the connected page or receive its requests',async t=>{
  const f=await relayFixture(t),other=await connect(f);
  assert.equal((await once(other,'close'))[0],4008);
  f.ws.on('message',raw=>{const m=JSON.parse(raw);if(m.type==='request')f.deliver(m,[frame([toolPart('answer')]),finish()]);});
  const replies=await Promise.all([f.call(),f.call(),f.call()]);
  assert.ok(replies.every(res=>res.status===200));
});

test('disconnect fails in-flight work and a manually connected page serves new requests',async t=>{
  const f=await relayFixture(t),next=f.nextRequest(),response=f.call();
  await next;const closed=once(f.ws,'close');f.ws.close();await closed;
  assert.equal((await response).status,502);assert.equal((await f.status()).pending,0);
  const offline=await f.call();assert.equal(offline.status,503);
  const ws=await connect(f),registration=JSON.parse((await once(ws,'message'))[0]);
  assert.equal(registration.type,'registered');let calls=0;
  ws.on('message',raw=>{
    const m=JSON.parse(raw);if(m.type!=='request')return;calls++;
    const send=value=>ws.send(JSON.stringify({requestId:m.requestId,logicalRequestId:m.logicalRequestId,connectionId:registration.connectionId,attemptIndex:m.attemptIndex,...value}));
    send({type:'stream-chunk',chunkBody:JSON.stringify([[frame([toolPart('new page')]),finish()]])});send({type:'stream-end'});
  });
  const result=await f.call();assert.equal((await result.json()).choices[0].message.content,'new page');assert.equal(calls,1);
});

test('legacy email fields and account records are ignored and never exposed',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'mmdb-retired-accounts-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const file=join(dir,'accounts.json'),saved=JSON.stringify({version:1,accounts:[{email:'private@example.com',cooldowns:{test:Date.now()+900000}}]});
  writeFileSync(file,saved);
  const f=await relayFixture(t,{accountsPath:file,accountCooldownMs:900000});
  const closed=once(f.ws,'close');f.ws.close();await closed;
  const ws=await connect(f,{accountEmail:'private@example.com',accountId:'legacy-slot'});
  const registration=JSON.parse((await once(ws,'message'))[0]);assert.equal(registration.type,'registered');
  const status=await f.status();assert.equal(status.executorOnline,true);
  assert.equal(status.accounts,undefined);assert.equal(status.accountStrategy,undefined);
  assert.ok(!JSON.stringify(status).includes('private@example.com'));assert.equal(readFileSync(file,'utf8'),saved);
});

test('capability validation still blocks chat on the connected page',async t=>{
  const f=await relayFixture(t),next=f.nextRequest();
  const probing=fetch(f.base+'/v1/experiments/probe',{method:'POST',headers:f.headers,body:JSON.stringify({model:'test',experiment:'tool-auto'})});
  const probe=await next;
  assert.equal((await f.call()).status,409);
  f.deliver(probe,[frame([toolPart('answer')]),finish()]);assert.equal((await probing).status,200);
});
