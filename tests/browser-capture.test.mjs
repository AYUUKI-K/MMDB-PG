import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createBrowserCapture,loadCaptureIdentity} from '../src/server/headless-browser-capture.mjs';
import {createHeadlessManager} from '../src/server/headless-manager.mjs';
import {createCaptureClient,verifyTicket,cookieHeader} from '../browser-extension/capture.mjs';
import {EXTENSION_ID,EXTENSION_ORIGIN,COOKIE_URL} from '../browser-extension/protocol.mjs';

test('extension has a stable ID, narrow Google/loopback hosts and no content scripts or history access',()=>{
  const manifest=JSON.parse(readFileSync(new URL('../browser-extension/manifest.json',import.meta.url)));
  const id=[...createHash('sha256').update(Buffer.from(manifest.key,'base64')).digest('hex').slice(0,32)].map(x=>String.fromCharCode(97+parseInt(x,16))).join('');
  assert.equal(id,EXTENSION_ID);assert.deepEqual(manifest.permissions,['cookies','storage']);
  assert.deepEqual(manifest.host_permissions,['https://*.google.com/*','http://127.0.0.1/*']);assert.equal(manifest.content_scripts,undefined);assert.equal(manifest.incognito,'not_allowed');
});
test('pairing identity survives restart without being placed in public info',t=>{
  const root=mkdtempSync(join(tmpdir(),'mmdb-browser-pair-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const first=loadCaptureIdentity(root);assert.deepEqual(loadCaptureIdentity(root),first);
  assert(!JSON.stringify(createBrowserCapture({identity:first}).info()).includes(first.secret));
});
test('capture tickets bind origin, Google account slot, expiry and installation; consumed tickets cannot replay',async()=>{
  let now=Date.now();const capture=createBrowserCapture({now:()=>now}),origin='http://127.0.0.1:12345',pair=capture.pair(origin),ticket=capture.issue(origin,2);
  assert(await verifyTicket(ticket,origin,pair.secret,crypto,now));
  for(const patch of [{origin:'http://127.0.0.1:12346'},{authUser:1},{token:'a'.repeat(64)},{installationId:'b'.repeat(64)},{expiresAt:now-1}])assert.equal(await verifyTicket({...ticket,...patch},origin,pair.secret,crypto,now),false);
  assert.equal(await verifyTicket(ticket,origin,'c'.repeat(64),crypto,now),false);
  assert.throws(()=>capture.issue(origin,100),/账号序号/);assert.throws(()=>capture.pair('https://example.test'),/无效/);
  capture.accept(ticket.token);assert.throws(()=>capture.accept(ticket.token),/过期或已使用/);assert.throws(()=>capture.issue(origin,0),/正在导入/);
  capture.finish(ticket.token);assert.deepEqual(capture.result(ticket.token),{state:'succeeded'});
  const expired=capture.issue(origin,0);now+=61000;assert.throws(()=>capture.accept(expired.token),/过期或已使用/);
});
test('cookie conversion includes HttpOnly cookies but excludes other domains, partitioned cookies and header injection',()=>{
  assert.equal(cookieHeader([
    {name:'SID',value:'private-synthetic',domain:'.google.com',httpOnly:true},
    {name:'SID',value:'less-specific',domain:'.google.com'},
    {name:'APP',value:'app-cookie',domain:'aistudio.google.com'},
    {name:'SECRET',value:'unrelated',domain:'.example.com'},
    {name:'PART',value:'third-party',domain:'.google.com',partitionKey:{}},
    {name:'BAD',value:'unsafe\r\n',domain:'.google.com'}
  ]),'SID=private-synthetic; APP=app-cookie');
  assert.throws(()=>cookieHeader([]),/未找到 Google 登录/);
});
test('unpaired, forged, remote and iframe requests never read cookies; capture sends only to the paired loopback server',async()=>{
  const capture=createBrowserCapture(),origin='http://127.0.0.1:12345',pair=capture.pair(origin),ticket=capture.issue(origin,3),used=new Set();let reads=0,request;
  const client=createCaptureClient({getConnection:async id=>id===pair.installationId?pair:null,claim:async value=>{if(used.has(value.token))throw Error('used');used.add(value.token);},getCookies:async details=>{reads++;assert.deepEqual(details,{url:COOKIE_URL});return [{name:'SID',value:'private-synthetic',domain:'.google.com',httpOnly:true}];},fetchImpl:async(url,init)=>{request={url,init};return new Response('{}',{status:202});}});
  const sender={url:origin+'/',origin,frameId:0,tab:{incognito:false}};
  for(const [value,source] of [[{...ticket,proof:'d'.repeat(64)},sender],[{...ticket,installationId:'e'.repeat(64)},sender],[ticket,{...sender,origin:'https://example.test'}],[ticket,{...sender,frameId:1}],[ticket,{...sender,tab:{incognito:true}}]])await assert.rejects(client(value,source));
  assert.equal(reads,0);
  const result=await client(ticket,sender);assert.deepEqual(result,{ok:true,submitted:true});assert(!JSON.stringify(result).includes('private-synthetic'));
  assert.equal(reads,1);assert.equal(request.url,origin+'/api/browser/import');assert.equal(request.init.redirect,'error');assert.equal(request.init.headers.Authorization,'Bearer '+ticket.token);assert.equal(JSON.parse(request.init.body).cookies,'SID=private-synthetic');
  await assert.rejects(client(ticket,sender));assert.equal(reads,1);
});
test('extension pairing needs its own confirmation UI; detection and pairing do not read browser cookies',async()=>{
  const stored={local:{},session:{}},listeners={},windows=[];let reads=0;
  const storage=area=>({get:async key=>({[key]:structuredClone(stored[area][key])}),set:async patch=>Object.assign(stored[area],structuredClone(patch)),remove:async key=>{delete stored[area][key];}});
  const original=globalThis.chrome;
  globalThis.chrome={storage:{local:storage('local'),session:storage('session')},cookies:{getAll:async()=>{reads++;return [];}},windows:{create:async info=>windows.push(info)},runtime:{id:EXTENSION_ID,getURL:path=>EXTENSION_ORIGIN+'/'+path,onMessageExternal:{addListener:fn=>listeners.external=fn},onMessage:{addListener:fn=>listeners.internal=fn}}};
  try{
    await import('../browser-extension/worker.mjs');
    const invoke=(kind,message,sender)=>new Promise(resolve=>listeners[kind](message,sender,resolve));
    const origin='http://127.0.0.1:23456',capture=createBrowserCapture(),pair=capture.pair(origin),sender={url:origin+'/',frameId:0};
    assert.equal((await invoke('external',{type:'status',installationId:pair.installationId},sender)).paired,false);
    assert.equal((await invoke('external',{type:'pair',pair},sender)).pending,true);assert.equal(windows.length,1);assert(windows[0].url.startsWith(EXTENSION_ORIGIN+'/connect.html#'));
    assert.equal(Object.keys(stored.local.connections??{}).length,0);assert.equal(reads,0);
    const id=stored.session.pendingPair.id;
    assert.equal((await invoke('internal',{type:'approve',id},sender)).ok,false);
    const trusted={id:EXTENSION_ID,url:EXTENSION_ORIGIN+'/connect.html#'+id};
    const pending=await invoke('internal',{type:'inspect',id},trusted);assert(pending.pending);assert(!JSON.stringify(pending).includes(pair.secret));
    assert.equal((await invoke('internal',{type:'approve',id},trusted)).ok,true);
    assert.equal((await invoke('external',{type:'status',installationId:pair.installationId},sender)).paired,true);assert.equal(reads,0);
    assert.equal((await invoke('internal',{type:'forget'},trusted)).ok,true);assert.equal(Object.keys(stored.local.connections??{}).length,0);
  }finally{globalThis.chrome=original;}
});
test('manager authorizes pairing, isolates extension CORS, imports once asynchronously and surfaces verification errors',async t=>{
  let busy=false,fail=false,imports=0,forwarded;
  const admin=async(path,request)=>{
    if(path==='/api/status')return {active_requests:busy?1:0};
    if(path==='/api/accounts/import/cookies'){imports++;forwarded=request.body;if(fail)throw Error('会话验证失败');return {};}
    throw Error('unexpected API');
  };
  const capture=createBrowserCapture(),panel=await createHeadlessManager({admin,settings:{},capture});t.after(panel.close);
  const url=new URL(panel.url),origin=url.origin,key=url.hash.slice(1);
  const call=(path,body,token=key,extra={})=>fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});
  assert.equal((await call('/api/browser/pair',{},'wrong')).status,401);
  assert.equal((await call('/api/browser/pair',{},key,{Origin:EXTENSION_ORIGIN})).status,403);
  const pair=await (await call('/api/browser/pair',{})).json();assert(pair.secret);
  const info=await(await call('/api/browser/info')).json();assert.equal(info.extensionId,EXTENSION_ID);assert(!JSON.stringify(info).includes(pair.secret));
  const preflight=await fetch(origin+'/api/browser/import',{method:'OPTIONS',headers:{Origin:EXTENSION_ORIGIN}});assert.equal(preflight.status,204);assert.equal(preflight.headers.get('Access-Control-Allow-Origin'),EXTENSION_ORIGIN);
  assert.equal((await call('/api/browser/import',{cookies:'SID=synthetic'},'x',{Origin:'https://example.test'})).status,403);
  const ticket=await(await call('/api/browser/ticket',{authUser:2})).json();
  const submitted=await call('/api/browser/import',{cookies:'SID=synthetic',authUser:9},ticket.token,{Origin:EXTENSION_ORIGIN});assert.equal(submitted.status,202);assert(!JSON.stringify(await submitted.json()).includes('synthetic'));
  let result;
  for(let i=0;i<30;i++){result=await(await call('/api/browser/result',{ticket:ticket.token})).json();if(result.state!=='importing')break;await new Promise(resolve=>setTimeout(resolve,10));}
  assert.equal(result.state,'succeeded');assert.equal(imports,1);assert.equal(forwarded.auth_user,2);assert.equal(forwarded.label,'');
  assert.equal((await call('/api/browser/import',{cookies:'SID=synthetic'},ticket.token,{Origin:EXTENSION_ORIGIN})).status,400);assert.equal(imports,1);
  for(const state of ['busy','failed']){
    busy=state==='busy';fail=state==='failed';const next=await(await call('/api/browser/ticket',{authUser:0})).json();
    await call('/api/browser/import',{cookies:'SID=synthetic'},next.token,{Origin:EXTENSION_ORIGIN});
    for(let i=0;i<30;i++){result=await(await call('/api/browser/result',{ticket:next.token})).json();if(result.state!=='importing')break;await new Promise(resolve=>setTimeout(resolve,10));}
    assert.equal(result.state,'failed');assert.match(result.error,busy?/正在生成/:/会话验证失败/);
  }
});
