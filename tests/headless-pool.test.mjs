import {test} from 'node:test';
import '../runtime-manager/tests/chrome-oauth.test.mjs';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setImmediate as tick} from 'node:timers/promises';
import {createAccountPool} from '../src/server/headless-pool.mjs';
import {createHeadlessExecutor} from '../src/server/headless-executor.mjs';
import {headlessRequest} from '../src/server/headless-protocol.mjs';
import {toWire} from '../src/server/protocol.mjs';
import {createRuntimeWatchdog} from '../src/server/headless-watchdog.mjs';
import http from 'node:http';
import {once} from 'node:events';
import {createRelay} from '../src/server/server.mjs';

function fixture(t){
  const root=mkdtempSync(join(tmpdir(),'mmdb-pool-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const accounts=['a@example.test','b@example.test','c@example.test'].map(id=>({id,enabled:true,state:'ready',models:['test','other']}));
  const status={state:'RUNNING',ready:true,active_requests:0},config={waa_backend:'spidermonkey',proxy_api_key:'PRIVATE',admin_auth_enabled:true,listen_addr:'127.0.0.1:18767'},calls=[];let time=1000000;
  const admin=async(path,options={})=>{
    calls.push([path,options]);if(path==='/api/status')return {...status};if(path==='/api/accounts'&&!options.method)return {accounts:structuredClone(accounts)};
    if(path==='/api/config'){if(options.method)Object.assign(config,options.body);return {...config};}
    if(path==='/api/cooldowns')return {cooldowns:[]};
    if(path==='/api/control/start'){status.state='RUNNING';status.ready=true;return {...status};}
    if(path==='/api/control/stop'){status.state='STOPPED';status.ready=false;return {...status};}
    if(path.startsWith('/api/accounts/')&&options.method==='PUT'){const row=accounts.find(row=>row.id===decodeURIComponent(path.slice('/api/accounts/'.length)));Object.assign(row,options.body);return {account:{...row}};}
    throw Error('Unexpected test operation: '+path);
  };
  const pool=createAccountPool({root,admin,now:()=>time});
  return {pool,root,admin,accounts,status,config,calls,advance:ms=>time+=ms};
}
const error=status=>Object.assign(Error('synthetic'),{status});
async function selected(pool,id='one',extra={}){const lease=await pool.lease({model:'test',logicalId:id,...extra});const account=lease.accountId;lease.release();await pool.finish(id);return account;}

import '../runtime-manager/tests/pool.test.mjs';
import '../runtime-manager/tests/control.test.mjs';
import '../runtime-manager/tests/auth.test.mjs';

const wire=()=>JSON.stringify(toWire('test',{contents:[{role:'user',parts:[{text:'test'}]}]}));
const answer=text=>new Response('data: '+JSON.stringify({candidates:[{content:{role:'model',parts:[{text}]},finishReason:'STOP'}]})+'\n\n',{headers:{'Content-Type':'text/event-stream'}});
async function executorFixture(t,respond){
  const f=fixture(t),messages=[],requests=[];
  const executor=createHeadlessExecutor({url:'http://127.0.0.1:18767',apiKey:'x'.repeat(32)},m=>messages.push(m),{pool:f.pool,inspect:()=>f.pool.summary(),fetchImpl:async(_url,options)=>{const active=f.accounts.filter(a=>a.enabled);assert.equal(active.length,1);requests.push(active[0].id);assert.equal(JSON.parse(options.body).contents[0].parts[0].text,'test');return respond(active[0],requests.length);}});
  t.after(()=>executor.close());
  const send=(id,logicalId=id)=>executor.send(JSON.stringify({type:'request',requestId:id,logicalRequestId:logicalId,requestBody:wire()}));
  const completed=async id=>{for(let i=0;i<200;i++){const found=messages.find(m=>m.requestId===id&&['error','stream-end'].includes(m.type));if(found)return found;await tick();}throw Error('executor did not settle');};
  return {...f,executor,messages,requests,send,completed};
}
test('quota before any event rotates within the same request, preserving bounded attempt identities',async t=>{
  const f=await executorFixture(t,(_account,n)=>n===1?new Response('',{status:429}):answer('ok'));f.send('one');assert.equal((await f.completed('one')).type,'stream-end');
  assert.deepEqual(f.requests,['a@example.test','b@example.test']);assert.equal(f.messages.filter(m=>m.phase==='account-switch').length,1);assert.equal(f.messages.at(-1).attemptIndex,1);f.executor.finishLogicalRequest('one');
});
test('no account switch or replay occurs after partial content or between successful stages',async t=>{
  const f=await executorFixture(t,(_account,n)=>n===1?answer('stage one'):new Response('',{status:429}));f.send('first','logical');assert.equal((await f.completed('first')).type,'stream-end');f.send('second','logical');assert.equal((await f.completed('second')).type,'error');assert.deepEqual(f.requests,['a@example.test','a@example.test']);f.executor.finishLogicalRequest('logical');
  const partial=await executorFixture(t,()=>new Response('data: {"candidates":[{"content":{"parts":[{"text":"partial"}]}}]}\n\ndata: {"error":{"code":429}}\n\n',{headers:{'Content-Type':'text/event-stream'}}));partial.send('partial');assert.equal((await partial.completed('partial')).type,'error');assert.equal(partial.requests.length,1);partial.executor.finishLogicalRequest('partial');
});
test('ambiguous network failures are not replayed on another account',async t=>{
  const f=await executorFixture(t,()=>{throw new TypeError('network lost');});f.send('one');assert.equal((await f.completed('one')).type,'error');assert.equal(f.requests.length,1);f.executor.finishLogicalRequest('one');
});
test('watchdog uses bounded backoff, one in-flight recovery, and stops scheduling after close',async()=>{
  let scheduled=[],resolve,now=0;
  const watch=createRuntimeWatchdog(()=>new Promise(done=>resolve=done),{schedule:(fn,ms)=>{scheduled.push([fn,ms]);return scheduled.length;},cancel(){},now:()=>now});
  const first=watch.tick();assert.equal(watch.tick(),first);await tick();resolve();await first;assert.equal(scheduled.at(-1)[1],15000);watch.close();assert.equal(watch.status().state,'stopped');
  const fail=createRuntimeWatchdog(async()=>{throw Error('offline');},{schedule:(fn,ms)=>{scheduled.push([fn,ms]);return 1;},cancel(){},now:()=>now});await fail.tick();assert.equal(scheduled.at(-1)[1],30000);await fail.tick();assert.equal(scheduled.at(-1)[1],60000);fail.close();
});

test('MMDB relay accepts account-switch attempts and delivers one response with accurate dispatch counts',async t=>{
  const f=fixture(t);let calls=0;
  const runtime=http.createServer(async(req,res)=>{for await(const _ of req){}calls++;if(calls===1){res.writeHead(429);res.end();return;}res.writeHead(200,{'Content-Type':'text/event-stream'});res.end('data: '+JSON.stringify({candidates:[{content:{role:'model',parts:[{text:'relay pool ok'}]},finishReason:'STOP'}]})+'\n\n');});
  runtime.listen(0,'127.0.0.1');await once(runtime,'listening');
  const app=createRelay({apiKey:'relay-test',models:['test'],timeoutMs:3000,queueTimeoutMs:3000,maxRequestMs:5000,executionBackend:'headless',headless:{url:`http://127.0.0.1:${runtime.address().port}`,apiKey:'x'.repeat(32)},headlessPool:f.pool});
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');t.after(()=>{app.close();app.server.closeAllConnections();runtime.closeAllConnections();runtime.close();});
  const response=await fetch(`http://127.0.0.1:${app.server.address().port}/v1/chat/completions`,{method:'POST',headers:{Authorization:'Bearer relay-test','Content-Type':'application/json'},body:JSON.stringify({model:'pg-test',messages:[{role:'user',content:'fixture'}]})});
  const value=await response.json();assert.equal(response.status,200);assert.equal(value.choices[0].message.content,'relay pool ok');assert.equal(calls,2);assert.deepEqual(value.mmdb.requestCounts,{total:2,inputRead:0,answer:1,continuation:0,retry:1});
  const requestId=response.headers.get('x-mmdb-request-id'),detail=f.pool.diagnostics.detail(requestId);assert.equal(detail.status,'finished');assert.equal(detail.dispatches,2);assert.equal(detail.switches,1);assert(detail.events.some(e=>e.type==='account-cooldown'&&e.reason==='quota'));assert(detail.events.some(e=>e.type==='account-selected'&&e.reason==='quota'));assert.equal(detail.usageComplete,false);
  for(let i=0;i<10&&Object.keys(f.pool.read().sessions).length;i++)await tick();assert.equal(Object.keys(f.pool.read().sessions).length,0);
});

test('relay reports expired logins separately and exposes retry timing only for cooldowns',async t=>{
  const f=fixture(t);for(const row of f.accounts)row.state='auth_required';
  const app=createRelay({apiKey:'relay-test',models:['test'],timeoutMs:3000,queueTimeoutMs:3000,maxRequestMs:5000,executionBackend:'headless',headless:{url:'http://127.0.0.1:18767',apiKey:'x'.repeat(32)},headlessPool:f.pool});
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');t.after(()=>{app.close();app.server.closeAllConnections();});
  const call=()=>fetch(`http://127.0.0.1:${app.server.address().port}/v1/chat/completions`,{method:'POST',headers:{Authorization:'Bearer relay-test','Content-Type':'application/json'},body:JSON.stringify({model:'pg-test',messages:[{role:'user',content:'fixture'}]})});
  const login=await call();assert.equal(login.status,401);assert.equal(login.headers.get('retry-after'),null);assert.equal((await login.json()).error.code,'headless_auth_required');
  for(const row of f.accounts)row.state='ready';const state=f.pool.read(),retryAt=Date.now()+60000;
  for(const member of Object.values(state.members))member.cooldowns.test={until:retryAt,reason:'quota'};writeFileSync(join(f.root,'pool.json'),JSON.stringify(state));
  const cooldown=await call(),body=await cooldown.json();assert.equal(cooldown.status,429);assert.equal(body.error.retryAt,retryAt);assert(Number(cooldown.headers.get('retry-after'))>0);assert.doesNotMatch(JSON.stringify(body),/example/);
});
