import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readdirSync,readFileSync,writeFileSync,appendFileSync,utimesSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Script} from 'node:vm';
import {createCallDiagnostics} from '../src/call-diagnostics.mjs';
import {createHeadlessManager} from '../src/headless-manager.mjs';
import {diagnosticsHTML} from '../src/diagnostics-page.mjs';

function setup(t,options={}){const root=mkdtempSync(join(tmpdir(),'mmdb-diagnostics-'));t.after(()=>rmSync(root,{recursive:true,force:true}));return {root,log:createCallDiagnostics({root,...options})};}
test('journal stores only metadata, stable account HMACs and fresh export aliases',t=>{
  const {root,log}=setup(t);const requestId='request-private',accountId='private@example.test',secret='cookie=DO_NOT_RECORD';
  log.record('request-start',{requestId,source:'mmdb',body:secret,headers:{Authorization:secret}});
  log.record('request-configured',{requestId,model:'gemini-test',generation:{temperature:1,secret},images:{count:1,bytes:25,base64:secret}});
  log.record('account-selected',{requestId,accountId,reason:'quota',url:'https://secret.test/'+secret});
  log.record('request-sent',{requestId,accountId});log.record('request-finish',{requestId,status:'finished',usage:{totalTokenCount:12,text:secret},usageComplete:true,elapsedMs:100});
  const raw=readdirSync(join(root,'diagnostics')).filter(f=>f.endsWith('.jsonl')).map(f=>readFileSync(join(root,'diagnostics',f),'utf8')).join('');assert(!raw.includes(secret));assert(!raw.includes(accountId));
  assert.equal(log.account(accountId),createCallDiagnostics({root}).account(accountId));
  const detail=log.detail(requestId);assert.equal(detail.dispatches,1);assert.equal(detail.usage.totalTokenCount,12);assert.equal(detail.events.at(-1).type,'request-finish');
  const exported=log.exportJSONL({requestId});assert(!exported.includes(accountId));assert(!exported.includes(requestId));assert(!exported.includes(log.account(accountId)));assert(!exported.includes('"pid"'));assert(exported.includes('account-1'));
});
test('query filters request timelines, preserves unknown usage and paginates a stable snapshot',t=>{
  let time=Date.now();const {log}=setup(t,{now:()=>time});for(let i=0;i<5;i++){log.record('request-start',{requestId:'r'+i,model:i%2?'m2':'m1'});log.record('account-selected',{requestId:'r'+i,accountId:'a',reason:'quota'});log.record('request-finish',{requestId:'r'+i,status:i===0?'failed':'finished',elapsedMs:i*100,code:i===0?'timeout':undefined});time++;}
  assert.equal(log.query({model:'m1'}).summary.total,3);assert.equal(log.query({q:'quota'}).summary.total,5);assert.equal(log.query().summary.usageReported,0);assert.equal(log.query().summary.p95,400);
  const first=log.query({limit:2});log.record('request-start',{requestId:'new'});const second=log.query({limit:2,snapshot:first.snapshot,after:first.next});assert.deepEqual(first.rows.map(r=>r.id),['r4','r3']);assert.deepEqual(second.rows.map(r=>r.id),['r2','r1']);
  assert.equal(log.query({status:'failed'}).rows[0].code,'timeout');
});
test('cross-writer journals survive partial/corrupt lines and detect interrupted requests',t=>{
  const {root,log}=setup(t,{alive:()=>false}),other=createCallDiagnostics({root});log.record('request-start',{requestId:'interrupted'});other.record('request-start',{requestId:'another'});
  const file=join(root,'diagnostics',readdirSync(join(root,'diagnostics')).find(f=>f.endsWith('.jsonl')));appendFileSync(file,'not json\n{"partial":');
  assert.equal(log.query().rows.length,2);assert.equal(log.query().corrupt,1);assert(log.query().rows.every(r=>r.status==='interrupted'));assert.equal(log.detail('absent'),null);
});
test('rotation removes only journal segments and enforces time and space limits',t=>{
  const {root,log}=setup(t,{segmentBytes:300});for(let i=0;i<12;i++)log.record('test',{requestId:'r'+i});const dir=join(root,'diagnostics'),files=readdirSync(dir).filter(f=>f.endsWith('.jsonl'));assert(files.length>1);
  const old=join(dir,files[0]);utimesSync(old,new Date(0),new Date(0));writeFileSync(join(dir,'keep.txt'),'keep');log.configure({days:1,maxMiB:10});assert(!existsSync(old));assert(existsSync(join(dir,'keep.txt')));
  const huge=join(dir,'events-2026-01-01-1-aaaa.jsonl');writeFileSync(huge,Buffer.alloc(11*1024*1024));assert(log.storage().bytes<=10*1024*1024);assert.throws(()=>log.configure({days:0,maxMiB:10}));
});
test('logging failure is fail-open and surfaced by storage health',t=>{const {root}=setup(t);writeFileSync(join(root,'diagnostics'),'blocked');const log=createCallDiagnostics({root});assert.doesNotThrow(()=>log.record('request-start',{requestId:'one'}));assert(log.storage().lastError);});
test('diagnostics API and exports require the manager token and same origin',async t=>{
  new Script(diagnosticsHTML.match(/<script>([\s\S]*)<\/script>/)[1]);const {log}=setup(t);log.record('request-start',{requestId:'one'});
  const panel=await createHeadlessManager({admin:async()=>({}),settings:{},pool:{diagnostics:log}});t.after(panel.close);const url=new URL(panel.url),headers={Authorization:'Bearer '+url.hash.slice(1),'Content-Type':'application/json'};
  const post=(path,extra={})=>fetch(url.origin+'/api/diagnostics/'+path,{method:'POST',headers:{...headers,...extra},body:'{}'});
  assert.equal((await post('query',{Authorization:'bad'})).status,401);assert.equal((await post('export',{Origin:'https://other.test'})).status,403);
  assert.equal((await(await post('query')).json()).rows.length,1);const exported=await post('export');assert.match(exported.headers.get('content-type'),/ndjson/);assert.equal(JSON.parse((await exported.text()).split('\n')[0]).metadataOnly,true);
  const page=await fetch(url.origin+'/diagnostics');assert.equal(page.status,200);assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'none'/);
});
