import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,mkdirSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createManager,commandBelongsToRoot,dependencyState,menuStatus} from '../tools/portable-manager.mjs';

test('menu distinguishes backend, browser and unresponsive-page states without exposing secrets',()=>{
  assert.deepEqual({...menuStatus({running:false}),text:undefined},{backend:'stopped',browser:'unknown',mode:'none',text:undefined});
  assert.equal(menuStatus({running:true,mode:'lan',executorOnline:false}).browser,'disconnected');
  const connected=menuStatus({running:true,mode:'lan',executorOnline:true,apiKey:'private-menu-key'});assert.equal(connected.backend,'running');assert.equal(connected.mode,'lan');assert.equal(connected.browser,'connected');assert(!JSON.stringify(connected).includes('private-menu-key'));
  assert.equal(menuStatus({running:true,executorOnline:true,page:{state:'unresponsive'}}).browser,'unresponsive');
  const unavailable=menuStatus({running:true,statusError:'private-key'});assert.equal(unavailable.backend,'unavailable');assert.equal(unavailable.browser,'unknown');assert(!unavailable.text.includes('private-key'));
  const mismatch=menuStatus({running:true,executorOnline:true,version:'1.7.15',serviceVersion:'1.7.14',executorVersion:'1.7.13',pending:2});assert.match(mismatch.text,/2 个请求/);assert.match(mismatch.text,/后台仍为 v1.7.14/);assert.match(mismatch.text,/浏览器脚本 v1.7.13/);
  assert.match(menuStatus({running:true,executorOnline:true,version:'1.18.0',serviceVersion:'1.18.0',executorVersion:'mmdb-1.7.16'}).text,/浏览器脚本 v1.7.16/);
  assert.doesNotMatch(menuStatus({running:true,executorOnline:true,version:'1.18.0',serviceVersion:'1.18.0',executorVersion:'mmdb-1.18.0'}).text,/选 3 确认/);
});

function fixture(t){
  const root=mkdtempSync(join(tmpdir(),'MMDB 菜单 test '));t.after(()=>rmSync(root,{recursive:true,force:true}));
  writeFileSync(join(root,'package.json'),JSON.stringify({name:'mmdb-pg',version:'1.4.1'}));
  return root;
}
test('ownership requires the actual script argument, including spaces and Unicode',()=>{
  const root=join(tmpdir(),'MMDB 中文 portable');
  assert.equal(commandBelongsToRoot({executable:'node.exe',commandLine:'"C:\\Program Files\\nodejs\\node.exe" "'+join(root,'launch.mjs')+'" --background'},root),true);
  assert.equal(commandBelongsToRoot({executable:'node.exe',args:['node','other.mjs',join(root,'launch.mjs')],cwd:root},root),false);
  assert.equal(commandBelongsToRoot({executable:'node.exe',args:['node',join(root+'-other','launch.mjs')]},root),false);
  assert.equal(commandBelongsToRoot({executable:'browser.exe',args:['browser',join(root,'launch.mjs')]},root),false);
  assert.equal(commandBelongsToRoot({executable:'node.exe',args:['node','launch.mjs']},root),false);
});
test('status is read-only before installation',async t=>{
  const root=fixture(t),manager=createManager({root,env:{}});
  assert.equal((await manager.status()).running,false);assert.equal(dependencyState(root).ready,false);
  assert.equal(existsSync(join(root,'config.json')),false);
});
test('stopping refuses unrelated processes and never signals them',async t=>{
  const root=fixture(t);writeFileSync(join(root,'runtime.pid'),'123');let signals=0;
  const manager=createManager({root,env:{},inspect:()=>({executable:'node',args:['node','another-project.mjs']}),signal:()=>signals++});
  await assert.rejects(manager.stop(),/其他程序或目录/);assert.equal(signals,0);assert.equal(existsSync(join(root,'.manager.lock')),false);
});
test('active generation blocks stop and dependency installation without modifying config',async t=>{
  const root=fixture(t),config='{"apiKey":"do-not-replace","port":8765}';writeFileSync(join(root,'runtime.pid'),'123');writeFileSync(join(root,'config.json'),config);let signals=0;
  const manager=createManager({root,env:{},inspect:()=>({executable:'node',args:['node',join(root,'launch.mjs')]}),signal:()=>signals++,fetchStatus:async()=>({pending:1})});
  await assert.rejects(manager.stop(),/还有生成/);await assert.rejects(manager.install(),/后台正在运行/);
  assert.equal(signals,0);assert.equal(readFileSync(join(root,'config.json'),'utf8'),config);
});
test('successful stop clears only its matching PID and preserves user data',async t=>{
  const root=fixture(t);writeFileSync(join(root,'runtime.pid'),'123');writeFileSync(join(root,'config.json'),'{}');let alive=true;
  const manager=createManager({root,env:{},inspect:()=>alive?{executable:'node',args:['node',join(root,'launch.mjs')]}:null,signal:()=>{alive=false;},fetchStatus:async()=>({pending:0})});
  await manager.stop();assert.equal(existsSync(join(root,'runtime.pid')),false);assert.equal(readFileSync(join(root,'config.json'),'utf8'),'{}');
});
test('a second menu operation cannot enter an existing management lock',async t=>{
  const root=fixture(t);writeFileSync(join(root,'.manager.lock'),'owner');
  await assert.rejects(createManager({root,env:{}}).install(),/已有菜单操作/);
  assert.equal(readFileSync(join(root,'.manager.lock'),'utf8'),'owner');
});
test('missing or mismatched dependencies block start before creating a background process',async t=>{
  const root=fixture(t),ws=join(root,'node_modules/ws');mkdirSync(ws,{recursive:true});
  writeFileSync(join(root,'package-lock.json'),JSON.stringify({packages:{'node_modules/ws':{version:'8.22.0'}}}));writeFileSync(join(ws,'package.json'),'{"version":"8.0.0"}');
  assert.equal(dependencyState(root).ready,false);await assert.rejects(createManager({root,env:{}}).start(),/依赖尚未就绪/);
  assert.equal(existsSync(join(root,'portable-service.log')),false);
});

test('LAN addresses are displayed only for LAN mode, separately from loopback and without credentials',t=>{
  const root=fixture(t),output=[],original=console.log;
  writeFileSync(join(root,'config.json'),JSON.stringify({port:18765,apiKey:'private-test-key'}));
  writeFileSync(join(root,'lan-config.json'),JSON.stringify({address:'192.168.1.23',port:18766,allowedCIDR:'192.168.1.0/24'}));
  console.log=(line)=>output.push(line);
  try{
    const manager=createManager({root,env:{}});
    manager.printLinks();assert.doesNotMatch(output.join('\n'),/192\.168\.1\.23/);
    output.length=0;manager.printLinks({lan:true});
    assert.match(output.join('\n'),/http:\/\/127\.0\.0\.1:18765\/v1/);
    assert.match(output.join('\n'),/手机酒馆地址：http:\/\/192\.168\.1\.23:18766\/v1/);
    assert.doesNotMatch(output.join('\n'),/private-test-key/);
  }finally{console.log=original;}
});
test('Windows official installer verifies downloads before offering an interactive install',{skip:process.platform!=='win32'},()=>{
  const script=fileURLToPath(new URL('portable-installer.ps1',import.meta.url));
  const output=execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',script],{encoding:'utf8',windowsHide:true,timeout:30000});
  assert.match(output,/PASS:/);
});
test('Windows menus open the verified script URL only after preparation succeeds',{skip:process.platform!=='win32'},()=>{
  const script=fileURLToPath(new URL('menu-workflow.ps1',import.meta.url));
  const output=execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',script],{encoding:'utf8',windowsHide:true,timeout:30000});
  assert.match(output,/PASS:/);
});

test('Windows portable CLI propagates a failed operation and preserves a successful exit',{skip:process.platform!=='win32'},t=>{
  const root=fixture(t);mkdirSync(join(root,'scripts'));mkdirSync(join(root,'tools'));
  for(const name of ['MMDB.ps1','scripts/portable.ps1','tools/portable-manager.mjs'])writeFileSync(join(root,name),readFileSync(new URL('../'+name,import.meta.url)));
  const run=()=>spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',join(root,'MMDB.ps1'),'-Action','status'],{encoding:'utf8',windowsHide:true,timeout:20000});
  assert.equal(run().status,0);
  writeFileSync(join(root,'package.json'),'{"name":"other-project"}');
  const failed=run();assert.equal(failed.status,1);assert.match(failed.stdout+failed.stderr,/操作未完成/);
});
test('Playground opening waits for reconnect, skips connected pages, and fails closed on status errors',async t=>{
  const root=fixture(t);writeFileSync(join(root,'runtime.pid'),'123');let calls=0,pauses=0,fail=false;
  const manager=createManager({root,env:{},inspect:()=>({executable:'node',args:['node',join(root,'launch.mjs')]}),fetchStatus:async()=>{
    if(fail)throw Error('status unavailable');return {executorOnline:++calls>=3};
  }});
  assert.equal(await manager.playgroundTarget({pause:async()=>pauses++}),'connected');
  assert.equal(calls,3);assert.equal(pauses,2);
  assert.equal(await manager.playgroundTarget({pause:async()=>pauses++}),'connected');assert.equal(pauses,2);
  calls=0;assert.match(await manager.playgroundTarget({attempts:1}),/^https:\/\/aistudio.google.com\//);
  fail=true;await assert.rejects(manager.playgroundTarget(),/status unavailable/);
});
