import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
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
  return {pool,root,admin,accounts,status,config,calls,advance:ms=>time+=ms};
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
