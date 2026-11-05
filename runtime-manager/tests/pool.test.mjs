import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,statSync,utimesSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setImmediate as tick} from 'node:timers/promises';
import {createAccountPool} from '../src/headless-pool.mjs';
import {createRuntimeWatchdog} from '../src/headless-watchdog.mjs';

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
  return {pool,root,admin,accounts,status,config,calls,now:()=>time,advance:ms=>time+=ms};
}
const error=status=>Object.assign(Error('synthetic'),{status});
async function selected(pool,id='one',extra={}){const lease=await pool.lease({model:'test',logicalId:id,...extra});const account=lease.accountId;lease.release();await pool.finish(id);return account;}

test('fill-first is persistent; exactly one upstream account is enabled, independent of pool membership',async t=>{
  const f=fixture(t);assert.equal(await selected(f.pool),'a@example.test');assert.equal(await selected(f.pool),'a@example.test');
  assert.equal(f.accounts.filter(a=>a.enabled).length,1);assert.equal((await f.pool.summary()).enabledAccounts,3);
  const restored=createAccountPool({root:f.root,admin:f.admin});assert.equal(await selected(restored),'a@example.test');
  assert.doesNotMatch(JSON.stringify(await restored.summary()),/@|PRIVATE/);
});
test('round-robin advances only new logical requests; an explicit continuation stays bound',async t=>{
  const f=fixture(t);await f.pool.configure({strategy:'round-robin'});
  assert.equal(await selected(f.pool),'a@example.test');assert.equal(await selected(f.pool),'b@example.test');
  assert.equal(await selected(f.pool,'continuation',{preferredId:'a@example.test'}),'a@example.test');
  assert.equal(await selected(f.pool),'b@example.test');
});
test('model quota cooldown survives restart, skips unavailable accounts, and expires without clearing other models',async t=>{
  const f=fixture(t),lease=await f.pool.lease({model:'test',logicalId:'quota'});assert.equal(await lease.failure(error(429)),true);lease.release();await f.pool.finish('quota');
  assert.equal(await selected(f.pool),'b@example.test');
  const other=await f.pool.lease({model:'other',logicalId:'other',preferredId:'a@example.test'});assert.equal(other.accountId,'a@example.test');other.release();await f.pool.finish('other');
  const restored=createAccountPool({root:f.root,admin:f.admin,now:()=>1000000});assert.equal(await selected(restored),'b@example.test');
  f.advance(61000);assert.equal(await selected(f.pool,'expired',{preferredId:'a@example.test'}),'a@example.test');
});
test('authentication failures isolate the actual expired login, not a local API-key rejection',async t=>{
  const f=fixture(t),lease=await f.pool.lease({model:'test',logicalId:'auth'});
  assert.equal(await lease.failure(error(401)),false);f.accounts[0].state='auth_required';assert.equal(await lease.failure(error(401)),true);lease.release();await f.pool.finish('auth');
  assert.equal(await selected(f.pool),'b@example.test');assert.equal((await f.pool.summary()).authRequiredAccounts,1);
});
test('pool changes and credential operations cannot interrupt a logical request between stages',async t=>{
  const f=fixture(t),lease=await f.pool.lease({model:'test',logicalId:'held'});lease.release();
  await assert.rejects(f.pool.membership('a@example.test',false),/正在生成/);await assert.rejects(f.pool.exclusive(async()=>({})),/正在生成/);
  await f.pool.finish('held');await f.pool.membership('a@example.test',false);assert.equal(await selected(f.pool),'b@example.test');
});
test('manual stop persists and watchdog respects it; explicit start resumes',async t=>{
  const f=fixture(t);await f.pool.control(false);await f.pool.recoverOnce();assert.equal(f.status.state,'STOPPED');
  await assert.rejects(selected(f.pool),{code:'headless_stopped'});await f.pool.control(true);assert.equal(f.status.state,'RUNNING');
});
test('backend switch preserves unrelated runtime secrets and resumes the previous service state',async t=>{
  const f=fixture(t);await f.pool.backend('camoufox');assert.equal(f.config.waa_backend,'camoufox');assert.equal(f.config.proxy_api_key,'PRIVATE');assert.equal(f.config.admin_auth_enabled,true);assert.equal(f.status.state,'RUNNING');
  await f.pool.control(false);await f.pool.backend('spidermonkey');assert.equal(f.status.state,'STOPPED');
});
test('a failed backend startup restores the prior backend before returning a sanitized error',async t=>{
  const f=fixture(t);const pool=createAccountPool({root:f.root,admin:async(path,options)=>{if(path==='/api/control/start'&&f.config.waa_backend==='camoufox')throw Error('PRIVATE_COOKIE');return f.admin(path,options);}});
  await assert.rejects(pool.backend('camoufox'),error=>/已恢复/.test(error.message)&&!error.message.includes('PRIVATE'));assert.equal(f.config.waa_backend,'spidermonkey');assert.equal(f.status.state,'RUNNING');
});

test('unavailable pools distinguish login, model support, quota, access and disabled accounts',async t=>{
  const f=fixture(t);
  for(const row of f.accounts)row.state='auth_required';
  await assert.rejects(selected(f.pool),e=>e.status===401&&e.code==='headless_auth_required'&&e.retryAt===undefined);
  await assert.rejects(f.pool.lease({model:'absent',logicalId:'absent'}),{status:400,code:'headless_model_unsupported'});
  for(const row of f.accounts)row.state='ready';
  const state=f.pool.read();for(const member of Object.values(state.members))member.cooldowns.test={until:f.now()+45000,reason:'quota'};
  writeFileSync(join(f.root,'pool.json'),JSON.stringify(state));
  await assert.rejects(selected(f.pool),e=>e.status===429&&e.retryAt===f.now()+45000);
  for(const member of Object.values(state.members))member.cooldowns.test.reason='access';
  writeFileSync(join(f.root,'pool.json'),JSON.stringify(state));await assert.rejects(selected(f.pool),{status:403,code:'headless_access_denied'});
  for(const member of Object.values(state.members))member.enabled=false;
  writeFileSync(join(f.root,'pool.json'),JSON.stringify(state));await assert.rejects(selected(f.pool),{status:503,code:'headless_no_enabled_accounts'});
});

test('unready recovery waits for a sustained idle failure, respects cooldowns and never overrides a manual stop',async t=>{
  const f=fixture(t);f.status.ready=false;
  await f.pool.recoverOnce();assert.equal(f.calls.filter(([p])=>p==='/api/control/stop').length,0);
  f.advance(30000);await f.pool.recoverOnce();assert.equal(f.calls.filter(([p])=>p==='/api/control/stop').length,0);
  f.advance(30000);await f.pool.recoverOnce();assert.equal(f.calls.filter(([p])=>p==='/api/control/stop').length,1);assert.equal(f.status.ready,true);
  await f.pool.control(false);const count=f.calls.length;await f.pool.recoverOnce({force:true});assert.equal(f.calls.length,count);assert.equal(f.status.state,'STOPPED');
});

test('recovery does not restart during generation, startup, login failure or quota cooldown',async t=>{
  const f=fixture(t);f.status.ready=false;
  for(const setup of [()=>f.status.active_requests=1,()=>{f.status.active_requests=0;f.status.state='LAUNCHING';},()=>{f.status.state='RUNNING';for(const row of f.accounts)row.state='auth_required';},()=>{for(const row of f.accounts)row.state='cooldown';}]){
    setup();f.advance(120000);await f.pool.recoverOnce({force:true});f.advance(120000);await f.pool.recoverOnce({force:true});
  }
  assert.equal(f.calls.filter(([p])=>p==='/api/control/start'||p==='/api/control/stop').length,0);
});

test('recovery attempt budget persists across managers and limits a failing runtime',async t=>{
  const f=fixture(t);f.status.state='STOPPED';f.status.ready=false;let starts=0;
  const admin=async(path,options)=>{if(path==='/api/control/start'){starts++;throw Error('PRIVATE_COOKIE');}return f.admin(path,options);};
  for(let i=0;i<3;i++){const pool=createAccountPool({root:f.root,admin,now:f.now});await assert.rejects(pool.recoverOnce({force:true}));f.advance(120000*2**i);}
  const restored=createAccountPool({root:f.root,admin,now:f.now});await restored.recoverOnce({force:true});assert.equal(starts,3);assert.equal((await restored.summary({privateView:true})).recovery.reason,'recovery-limited');
  assert.doesNotMatch(readFileSync(join(f.root,'recovery.json'),'utf8'),/PRIVATE/);
});

test('two managers share check scheduling and healthy checks do not rewrite the pool',async t=>{
  const f=fixture(t);await f.pool.recoverOnce();const poolFile=join(f.root,'pool.json');utimesSync(poolFile,new Date(1000),new Date(1000));const stamp=statSync(poolFile).mtimeMs;
  const other=createAccountPool({root:f.root,admin:f.admin,now:f.now}),count=f.calls.length;
  await other.recoverOnce();assert.equal(f.calls.length,count);
  f.advance(15000);await other.recoverOnce();assert(f.calls.length>count);assert.equal(statSync(poolFile).mtimeMs,stamp);
});

test('account verification clears only authentication failure and records real successful checks',async t=>{
  const f=fixture(t);await f.pool.recoverOnce();const state=f.pool.read(),id=f.accounts[0].id;
  state.members[id].authRequired=true;state.members[id].cooldowns.test={until:f.now()+60000,reason:'quota'};writeFileSync(join(f.root,'pool.json'),JSON.stringify(state));
  const pool=createAccountPool({root:f.root,now:f.now,admin:async(path,options)=>path.endsWith('/refresh')?{account:{id,state:'ready'}}:f.admin(path,options)});
  await pool.verify(id);const member=pool.read().members[id];assert.equal(member.authRequired,false);assert.equal(member.auth.verifiedBy,'runtime-check');assert.equal(member.auth.lastVerifiedAt,f.now());assert.equal(member.cooldowns.test.until,f.now()+60000);
  const before=member.auth.lastVerifiedAt;f.advance(15000);await pool.summary({privateView:true});assert.equal(pool.read().members[id].auth.lastVerifiedAt,before);
});

test('automatic login recovery is bounded, only uses known renewal sources and never sends chat',async t=>{
  const f=fixture(t),id=f.accounts[0].id;for(const row of f.accounts)row.state='auth_required';let checks=0;
  const admin=async(path,options)=>{if(path.endsWith('/refresh')){checks++;throw Object.assign(Error('PRIVATE_REFRESH_TOKEN'),{status:401});}assert(!path.includes('GenerateContent'));return f.admin(path,options);};
  const authMetadata=()=>new Map([[id,'saved_oauth'],[f.accounts[1].id,'cookie_only']]);
  const pool=createAccountPool({root:f.root,admin,now:f.now,authMetadata});
  await pool.recoverOnce();assert.equal(checks,1);f.advance(15000);await pool.recoverOnce();assert.equal(checks,1);
  for(let i=0;i<3;i++){f.advance(600000);await pool.recoverOnce();}assert.equal(checks,3);
  const auth=(await pool.summary({privateView:true})).accounts[0].auth;assert.equal(auth.failures,3);assert.equal(auth.lastFailure,'authentication-required');assert.equal(auth.lastVerifiedAt,null);
  assert.doesNotMatch(JSON.stringify(await pool.summary({privateView:true})),/PRIVATE/);
});

test('verification and recovery cannot interrupt a request between generation stages',async t=>{
  const f=fixture(t),lease=await f.pool.lease({model:'test',logicalId:'active'});lease.verified();lease.release();
  await assert.rejects(f.pool.verify(f.accounts[0].id),/正在生成/);const calls=f.calls.length;await f.pool.recoverOnce();assert.equal(f.calls.length,calls);
  assert.equal(f.pool.read().members[f.accounts[0].id].auth.verifiedBy,'generation');await f.pool.finish('active');
});

test('successful automatic verification recovers the matching login without resetting quota or other accounts',async t=>{
  const f=fixture(t),id=f.accounts[0].id;for(const row of f.accounts)row.state='auth_required';
  const pool=createAccountPool({root:f.root,now:f.now,authMetadata:()=>new Map([[id,'chrome_source']]),admin:async(path,options)=>{
    if(path.endsWith('/refresh')){f.accounts[0].state='ready';return {account:{id,state:'ready'}};}return f.admin(path,options);
  }});
  await pool.recoverOnce();const state=pool.read();assert.equal(state.members[id].authRequired,false);assert.equal(state.members[id].auth.lastVerifiedAt,f.now());
  assert.equal((await pool.summary()).authRequiredAccounts,2);assert.equal(await selected(pool),id);
});

test('upstream authentication recovery releases local isolation without inventing a new verification time',async t=>{
  const f=fixture(t),id=f.accounts[0].id,lease=await f.pool.lease({model:'test',logicalId:'auth-recovered'});lease.verified();const verifiedAt=f.now();
  f.accounts[0].state='auth_required';await lease.failure(error(401));lease.release();await f.pool.finish('auth-recovered');
  f.advance(60000);f.accounts[0].state='ready';assert.equal(await selected(f.pool),id);
  assert.equal(f.pool.read().members[id].authRequired,false);assert.equal(f.pool.read().members[id].auth.lastVerifiedAt,verifiedAt);
});
