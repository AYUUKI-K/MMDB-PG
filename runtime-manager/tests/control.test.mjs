import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Script} from 'node:vm';
import {mkdtempSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setImmediate as tick} from 'node:timers/promises';
import {createHeadlessManager,managerHTML} from '../src/headless-manager.mjs';
import {superviseStep,supervisionSettings,pauseSupervision,disableSupervision,loginScript,startupCommand} from '../src/supervisor.mjs';
import {managerSettings} from '../src/settings.mjs';
import {acquireRuntimeLock} from '../src/headless-lock.mjs';

test('Chrome OAuth import requires local authorization, validates email and never returns importer credentials',async t=>{
  let email;const panel=await createHeadlessManager({settings:{},admin:async()=>({}),importChrome:async value=>{email=value;return {refresh_token:'PRIVATE_REFRESH'};}});t.after(panel.close);
  const url=new URL(panel.url),headers={'Content-Type':'application/json',Authorization:'Bearer '+url.hash.slice(1)};
  const post=(body,extra={})=>fetch(url.origin+'/api/chrome/import',{method:'POST',headers:{...headers,...extra},body:JSON.stringify(body)});
  assert.equal((await post({email:'a@example.test'},{Authorization:'Bearer wrong'})).status,401);
  assert.equal((await post({email:'a@example.test'},{Origin:'https://other.test'})).status,403);
  assert.equal((await post({email:'--flag'})).status,400);assert.equal(email,undefined);
  const started=await post({email:'A@example.test',chromeAuth:{oauth:{refresh_token:'INJECTED'}}});assert.equal(started.status,202);const job=await started.json();await tick();assert.equal(email,'a@example.test');
  const result=await fetch(url.origin+'/api/job',{method:'POST',headers,body:JSON.stringify(job)}).then(r=>r.json());assert.equal(result.state,'succeeded');assert.doesNotMatch(JSON.stringify(result),/PRIVATE|INJECTED|refresh_token/);
});

test('control page script parses and management jobs retain authorization and reject overlap',async t=>{
  new Script(managerHTML.match(/<script>([\s\S]*)<\/script>/)[1]);
  let resolveJob,calls=0;
  const panel=await createHeadlessManager({admin:async()=>({}),settings:{},pool:{backend:()=>{calls++;return new Promise(resolve=>resolveJob=resolve);}}});
  t.after(panel.close);const url=new URL(panel.url),headers={Authorization:'Bearer '+url.hash.slice(1),'Content-Type':'application/json'};
  const post=(path,body,extra={})=>fetch(url.origin+path,{method:'POST',headers:{...headers,...extra},body:JSON.stringify(body)});
  assert.equal((await post('/api/backend',{backend:'camoufox'},{Authorization:'Bearer wrong'})).status,401);
  assert.equal((await post('/api/backend',{backend:'camoufox'},{Origin:'https://other.test'})).status,403);
  const first=await post('/api/backend',{backend:'camoufox'});assert.equal(first.status,202);const job=await first.json();await tick();
  assert.equal((await post('/api/backend',{backend:'spidermonkey'})).status,400);assert.equal(calls,1);
  assert.equal((await (await post('/api/job',{id:job.id})).json()).state,'running');resolveJob();await tick();
  assert.equal((await (await post('/api/job',{id:job.id})).json()).state,'succeeded');
});

test('supervision only resumes a missing headless relay and respects manual pause and mode',async()=>{
  let starts=0;const settings={enabled:true,wanted:true,lan:true};let current={running:false};
  const input={settings:()=>settings,backend:()=>'headless',status:async()=>current,ready:async lan=>{assert.equal(lan,true);starts++;}};
  await superviseStep(input);assert.equal(starts,1);current.running=true;await superviseStep(input);assert.equal(starts,1);
  current.running=false;settings.wanted=false;assert.equal(await superviseStep(input),false);assert.equal(starts,1);
  settings.wanted=true;assert.equal(await superviseStep({...input,backend:()=>'browser'}),false);assert.equal(starts,1);
});

test('manual pause persists, standalone defaults need no MMDB files, and startup commands quote Unicode paths without secrets',async t=>{
  const root=mkdtempSync(join(tmpdir(),'manager 中文 '));t.after(()=>rmSync(root,{recursive:true,force:true}));
  assert.deepEqual(supervisionSettings(root),{enabled:false,wanted:false,lan:false});
  writeFileSync(join(root,'supervision.json'),JSON.stringify({enabled:true,wanted:true,lan:true}));pauseSupervision(root);assert.equal(supervisionSettings(root).wanted,false);await disableSupervision(root);assert.equal(supervisionSettings(root).enabled,false);
  assert.deepEqual(managerSettings(root),{dataDirectory:join(root,'.runtime'),integrationModule:null});
  const script=loginScript(root,'C:\\Program Files\\node.exe');assert(script.includes('""C:\\Program Files\\node.exe""'));assert(script.includes(root));assert.match(script,/, 0, False/);assert.doesNotMatch(script,/Cookie|apiKey|password/);assert(startupCommand(root).endsWith('login-start.vbs"'));
});

test('operation lock rejects concurrent mutation, supports cancellation, and releases for the next caller',async t=>{
  const root=mkdtempSync(join(tmpdir(),'manager-lock-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const path=join(root,'operation.lock');
  const release=await acquireRuntimeLock(path);await assert.rejects(acquireRuntimeLock(path),/正在生成/);
  const controller=new AbortController(),waiter=acquireRuntimeLock(path,{signal:controller.signal,waitMs:10000});controller.abort();await assert.rejects(waiter,{name:'AbortError'});release();
  const next=await acquireRuntimeLock(path);next();
});

test('account verification uses an authenticated job and returns only sanitized results',async t=>{
  let verified=[];const panel=await createHeadlessManager({admin:async()=>({}),settings:{},pool:{verify:async id=>{verified.push(id);}}});t.after(panel.close);
  const url=new URL(panel.url),headers={'Content-Type':'application/json',Authorization:'Bearer '+url.hash.slice(1)};
  const post=(path,body,auth=headers)=>fetch(url.origin+path,{method:'POST',headers:auth,body:JSON.stringify(body)});
  assert.equal((await post('/api/verify-account',{id:'account'},{'Content-Type':'application/json'})).status,401);assert.equal(verified.length,0);
  const start=await post('/api/verify-account',{id:'account'});assert.equal(start.status,202);const job=await start.json();await tick();assert.deepEqual(verified,['account']);
  assert.equal((await (await post('/api/job',job)).json()).state,'succeeded');
});
