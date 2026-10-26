import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,copyFileSync,rmSync,existsSync} from 'node:fs';
import {rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {createManager,dependencyState} from '../tools/portable-manager.mjs';

test('script workflow prepares a cold install, reuses a busy service, and rejects an unavailable script',async t=>{
  const root=mkdtempSync(join(tmpdir(),'MMDB 首次使用 '));
  const probe=createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));
  const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
  for(const name of ['package.json','package-lock.json'])copyFileSync(new URL('../'+name,import.meta.url),join(root,name));
  const version=JSON.parse(readFileSync(join(root,'package.json'),'utf8')).version;
  const config=JSON.stringify({port,apiKey:'workflow-test-only'});
  writeFileSync(join(root,'config.json'),config);
  writeFileSync(join(root,'build.mjs'),`import fs from 'node:fs';
fs.writeFileSync(new URL('script.js',import.meta.url),'// ==UserScript==\\n// @version      ${version}\\n// ==/UserScript==\\n');`);
  writeFileSync(join(root,'launch.mjs'),`import fs from 'node:fs';import http from 'node:http';
const here=name=>new URL(name,import.meta.url);
const server=http.createServer((req,res)=>{
  if(req.url.startsWith('/local-pg.user.js')){if(fs.existsSync(here('bad.flag'))){res.statusCode=503;res.end('not ready');}else res.end(fs.readFileSync(here('script.js')));return;}
  if(req.headers.authorization!=='Bearer workflow-test-only'){res.statusCode=401;res.end();return;}
  res.end(JSON.stringify({version:'${version}',pending:fs.existsSync(here('busy.flag'))?1:0,active:[]}));
});
server.listen(${port},'127.0.0.1',()=>fs.writeFileSync(here('runtime.pid'),String(process.pid)));
process.on('SIGTERM',()=>server.close());`);
  const manager=createManager({root,env:{...process.env,MMDB_PORT:String(port),MMDB_API_KEY:'workflow-test-only',npm_config_offline:'true'}});
  t.after(async()=>{
    rmSync(join(root,'busy.flag'),{force:true});
    // Windows may release the stopped child's working-directory handle later.
    try{await manager.stop();}finally{await rm(root,{recursive:true,force:true,maxRetries:20,retryDelay:100});}
  });
  assert.equal(dependencyState(root).ready,false);
  const url=await manager.prepareScript();
  assert.equal(url,`http://127.0.0.1:${port}/local-pg.user.js?v=${version}`);
  assert.equal(dependencyState(root).ready,true);
  const pid=readFileSync(join(root,'runtime.pid'),'utf8');
  writeFileSync(join(root,'busy.flag'),'1');
  await manager.prepareScript();
  assert.equal(readFileSync(join(root,'runtime.pid'),'utf8'),pid,'script update restarted an active service');
  assert.equal(readFileSync(join(root,'config.json'),'utf8'),config);
  writeFileSync(join(root,'bad.flag'),'1');
  await assert.rejects(manager.prepareScript(),/脚本尚未就绪/);
  assert.equal(readFileSync(join(root,'runtime.pid'),'utf8'),pid);
  assert.equal(existsSync(join(root,'.manager.lock')),false);
  rmSync(join(root,'busy.flag'));
  await manager.stop();
  assert.equal(existsSync(join(root,'runtime.pid')),false);
});
