import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtempSync,writeFileSync,readFileSync} from 'node:fs';
import {rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {isManagerURL} from '../tools/headless-portal.mjs';

test('account management URLs reject off-host, malformed and non-HTTP targets',()=>{
  const key='a'.repeat(64);assert(isManagerURL(`http://127.0.0.1:12345/#${key}`));
  for(const value of [`http://localhost:12345/#${key}`,`http://127.0.0.1:99999/#${key}`,`http://127.0.0.1:12345/@other#${key}`,`http://127.0.0.1:12345/?x#${key}`,`https://127.0.0.1:12345/#${key}`,undefined])assert.equal(isManagerURL(value),false);
});
test('account portal survives caller exit, reuses concurrent openings, and recovers a stale receipt without PG or Google',async t=>{
  const root=mkdtempSync(join(tmpdir(),'MMDB 管理 portal ')),calls=[];let panel;
  const runtime=http.createServer((req,res)=>{
    calls.push(req.url);res.setHeader('Content-Type','application/json');
    if(req.url==='/api/auth/login'){res.setHeader('Set-Cookie','aistudio_admin=test-only; HttpOnly');res.end('{}');}
    else if(req.url==='/api/status')res.end(JSON.stringify({state:'STOPPED',ready:false}));
    else if(req.url==='/api/accounts')res.end(JSON.stringify({accounts:[]}));
    else {res.statusCode=404;res.end('{}');}
  });
  await new Promise(resolve=>runtime.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{
    if(panel?.pid)try{process.kill(panel.pid,'SIGTERM');}catch{}
    runtime.closeAllConnections();await new Promise(resolve=>runtime.close(resolve));
    await rm(root,{recursive:true,force:true,maxRetries:20,retryDelay:100});
  });
  writeFileSync(join(root,'control.json'),JSON.stringify({version:1,url:`http://127.0.0.1:${runtime.address().port}`,apiKey:'a'.repeat(64),adminPassword:'b'.repeat(64)}));
  const moduleURL=new URL('../tools/headless-portal.mjs',import.meta.url).href;
  const open=()=>new Promise((resolve,reject)=>{
    const code=`import {ensureManager} from ${JSON.stringify(moduleURL)}; console.log(JSON.stringify(await ensureManager(process.argv[1])));`;
    const child=spawn(process.execPath,['--input-type=module','-e',code,root],{windowsHide:true,stdio:['ignore','pipe','pipe']});
    let out='',err='';child.stdout.on('data',chunk=>out+=chunk);child.stderr.on('data',chunk=>err+=chunk);child.once('error',reject);
    child.once('exit',code=>code===0?resolve(JSON.parse(out)):reject(Error(err||`launcher exit ${code}`)));
  });
  // Stale receipts must not cause navigation or credential transmission off loopback.
  writeFileSync(join(root,'manager.json'),JSON.stringify({pid:123,url:'https://example.test/#'+'c'.repeat(64)}));
  panel=await open();assert(isManagerURL(panel.url));
  const [a,b]=await Promise.all([open(),open()]);assert.deepEqual(a,panel);assert.deepEqual(b,panel);
  assert.deepEqual(JSON.parse(readFileSync(join(root,'manager.json'),'utf8')),panel);
  const url=new URL(panel.url),headers={Authorization:'Bearer '+url.hash.slice(1)};
  const before=calls.length;
  assert.equal((await fetch(url.origin+'/api/health')).status,401);
  assert.equal((await fetch(url.origin+'/api/health',{headers:{...headers,Origin:'https://example.test'}})).status,403);
  const health=await (await fetch(url.origin+'/api/health',{headers})).json();assert.equal(health.pid,panel.pid);assert.equal(health.service,'mmdb-headless-manager');
  assert.equal(calls.length,before,'health probes must not call the runtime or generate');
  assert(calls.every(path=>['/api/auth/login','/api/status','/api/accounts'].includes(path)),'background recovery only inspects account state when the pool is empty');
});
