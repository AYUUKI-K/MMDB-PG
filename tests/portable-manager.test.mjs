import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,mkdirSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:net';
import {createManager,commandBelongsToRoot,dependencyState,menuStatus,changeBackend,inspectProcess} from '../tools/portable-manager.mjs';
import {bindManager,dataDirectoryFor} from '../tools/manager-paths.mjs';

test('menu distinguishes backend, browser and unresponsive-page states without exposing secrets',()=>{
  assert.deepEqual({...menuStatus({running:false}),text:undefined},{backend:'stopped',browser:'unknown',executionBackend:'browser',ready:false,mode:'none',text:undefined});
  assert.equal(menuStatus({running:true,mode:'lan',executorOnline:false}).browser,'disconnected');
  const connected=menuStatus({running:true,mode:'lan',executorOnline:true,apiKey:'private-menu-key'});assert.equal(connected.backend,'running');assert.equal(connected.mode,'lan');assert.equal(connected.browser,'connected');assert(!JSON.stringify(connected).includes('private-menu-key'));
  assert.equal(menuStatus({running:true,executorOnline:true,page:{state:'unresponsive'}}).browser,'unresponsive');
  const unavailable=menuStatus({running:true,statusError:'private-key'});assert.equal(unavailable.backend,'unavailable');assert.equal(unavailable.browser,'unknown');assert(!unavailable.text.includes('private-key'));
  const mismatch=menuStatus({running:true,executorOnline:true,version:'1.7.15',serviceVersion:'1.7.14',executorVersion:'1.7.13',pending:2});assert.match(mismatch.text,/2 个请求/);assert.match(mismatch.text,/后台仍为 v1.7.14/);assert.match(mismatch.text,/浏览器脚本 v1.7.13/);
  assert.match(menuStatus({running:true,executorOnline:true,version:'1.18.0',serviceVersion:'1.18.0',executorVersion:'mmdb-1.7.16'}).text,/浏览器脚本 v1.7.16/);
  assert.doesNotMatch(menuStatus({running:true,executorOnline:true,version:'1.18.0',serviceVersion:'1.18.0',executorVersion:'mmdb-1.18.0'}).text,/选 3 确认/);
});

test('headless menu distinguishes PG readiness, account faults and independent runtime without browser advice',()=>{
  const info={running:true,executionBackend:'headless',executorOnline:true,version:'1.18.0',executorVersion:'0.2.18',runtime:{online:true,state:'RUNNING',ready:true,enabledAccounts:1,accountState:'ready',accountId:'private@example.test'}};
  const ready=menuStatus(info);assert.equal(ready.ready,true);assert.equal(ready.browser,'unused');
  assert.match(ready.text,/独立运行时 · 已就绪 · 已启用 1 个账号/);assert.doesNotMatch(ready.text,/private@|Meow|浏览器脚本/);
  const stopped=menuStatus({...info,running:false});assert.equal(stopped.ready,false);assert.match(stopped.text,/反代 未启动/);assert.match(stopped.text,/独立运行时 · 已就绪/);
  for(const [patch,hint] of [[{online:false},/未连接/],[{enabledAccounts:0},/没有启用账号/],[{accountState:'auth_required'},/凭证已失效/],[{accountState:'cooldown'},/额度冷却中/],[{state:'STOPPED'},/生成服务已停止/],[{state:'LAUNCHING'},/启动中/]]){
    const summary=menuStatus({...info,executorOnline:false,runtime:{...info.runtime,ready:false,...patch}});assert.equal(summary.ready,false);assert.match(summary.text,hint);assert.doesNotMatch(summary.text,/Meow|油猴|浏览器脚本/);
  }
  assert.match(menuStatus({...info,configuredBackend:'browser'}).text,/后端配置已改变/);
});

function fixture(t){
  const root=mkdtempSync(join(tmpdir(),'MMDB 菜单 test '));t.after(()=>rmSync(root,{recursive:true,force:true}));
  writeFileSync(join(root,'package.json'),JSON.stringify({name:'mmdb-pg',version:'1.4.1'}));
  return root;
}
test('standalone binding reuses the existing data directory and preserves an explicit user binding',t=>{
  const root=fixture(t);mkdirSync(join(root,'runtime-manager'));const data=join(root,'private-runtime');bindManager(root,data);assert.equal(dataDirectoryFor(root),data);
  const saved=readFileSync(join(root,'runtime-manager','manager.config.json'),'utf8');bindManager(root,join(root,'different'));assert.equal(readFileSync(join(root,'runtime-manager','manager.config.json'),'utf8'),saved);
});
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
test('an inaccessible Termux PID blocks changes on an occupied port and permits recovery once the port is free',async t=>{
  const root=fixture(t),listener=createServer();
  await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));
  t.after(()=>{if(listener.listening)listener.close();});
  const port=listener.address().port,pid=0x7fffffff,pidFile=join(root,'runtime.pid');
  writeFileSync(join(root,'config.json'),JSON.stringify({port}));
  writeFileSync(pidFile,String(pid));
  const guard=join(root,'.headless','supervision.json');
  mkdirSync(join(root,'.headless'));writeFileSync(guard,'{"enabled":true,"wanted":true}');
  let probeCode='EPERM';
  t.mock.method(process,'kill',(target,signal)=>{
    assert.equal(target,pid);assert.equal(signal,0);
    throw Object.assign(Error(probeCode),{code:probeCode});
  });
  const manager=createManager({root,env:{},inspect:target=>inspectProcess(target,'android'),signal:()=>assert.fail('unexpected signal')});
  for(const action of [manager.status,manager.ready,manager.stop,manager.restart,()=>manager.setBackend('headless')]){
    await assert.rejects(action(),new RegExp(`PID ${pid}.*EPERM.*端口 ${port} 已被占用`));
  }
  assert.equal(JSON.parse(readFileSync(guard)).wanted,true);
  await new Promise(resolve=>listener.close(resolve));
  assert.equal(menuStatus(await manager.status()).backend,'stopped');
  await assert.rejects(manager.playgroundTarget(),/后台未运行/);
  assert.equal(readFileSync(pidFile,'utf8'),String(pid));
  probeCode='EINVAL';
  await assert.rejects(manager.status(),{code:'EINVAL'});
  probeCode='ESRCH';
  assert.equal(inspectProcess(pid,'android'),null);
});
test('stopping refuses unrelated processes and never signals them',async t=>{
  const root=fixture(t);writeFileSync(join(root,'runtime.pid'),'123');let signals=0;
  const manager=createManager({root,env:{},inspect:()=>({executable:'node',args:['node','another-project.mjs']}),signal:()=>signals++});
  await assert.rejects(manager.stop(),/其他程序或目录/);assert.equal(signals,0);assert.equal(existsSync(join(root,'.manager.lock')),false);
  await assert.rejects(manager.restart(),/其他程序或目录/);assert.equal(signals,0);
});

test('unreadable live status refuses restart before changing supervision or signalling',async t=>{
  const root=fixture(t);writeFileSync(join(root,'runtime.pid'),'123');mkdirSync(join(root,'.headless'));
  const guard=join(root,'.headless','supervision.json'),original=JSON.stringify({enabled:true,wanted:true});writeFileSync(guard,original);let signals=0;
  const manager=createManager({root,env:{},inspect:()=>({executable:'node',args:['node',join(root,'launch.mjs')]}),signal:()=>signals++,fetchStatus:async()=>{throw Error('unreachable');}});
  await assert.rejects(manager.restart(),/状态不可读/);assert.equal(signals,0);assert.equal(readFileSync(guard,'utf8'),original);assert.equal(existsSync(join(root,'.manager.lock')),false);
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
  for(const name of ['MMDB.ps1','scripts/portable.ps1','tools/portable-manager.mjs','tools/manager-paths.mjs','tools/legacy-components.mjs'])writeFileSync(join(root,name),readFileSync(new URL('../'+name,import.meta.url)));
  for(const name of ['runtime-manager/package.json','browser-extension/manifest.json']){mkdirSync(join(root,name.split('/')[0]));writeFileSync(join(root,name),'{}');}
  const run=()=>spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',join(root,'MMDB.ps1'),'-Action','status'],{encoding:'utf8',windowsHide:true,timeout:20000});
  const success=run();assert.equal(success.status,0,success.stdout+success.stderr);
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

test('headless status and opening use the live backend; preparation never requests a userscript',async t=>{
  const root=fixture(t);writeFileSync(join(root,'runtime.pid'),'123');writeFileSync(join(root,'config.json'),'{"executionBackend":"browser"}');
  const state={executionBackend:'headless',executorOnline:false,pending:0,active:[],runtime:{online:true,ready:false,enabledAccounts:1,accountState:'auth_required',accountId:'private@example.test'}};
  const manager=createManager({root,env:{},inspect:()=>({executable:'node',args:['node',join(root,'launch.mjs')]}),fetchStatus:async()=>state});
  const info=await manager.status();assert.equal(info.executionBackend,'headless');assert.equal(info.configuredBackend,'browser');assert(!JSON.stringify(info).includes('private@'));
  assert.equal(await manager.playgroundTarget({pause:()=>{throw Error('must not wait for a browser');}}),'https://aistudio.google.com/prompts/new_chat');
  assert.equal(await manager.prepareScript(),'headless'); // Fixture has no build script or HTTP server.
  const output=[],original=console.log;console.log=value=>output.push(value);
  try{manager.printLinks({executionBackend:info.executionBackend});}finally{console.log=original;}
  assert.match(output.join('\n'),/主菜单 3/);assert.doesNotMatch(output.join('\n'),/local-pg|Meow/);
  writeFileSync(join(root,'config.json'),'{"executionBackend":"headless"}');state.executionBackend='browser';state.executorOnline=true;
  assert.equal((await manager.status()).executionBackend,'browser');assert.equal(await manager.playgroundTarget(),'disabled');
});

test('startup opening preference persists without altering keys, and repeated starts skip an already opened page',async t=>{
  const root=fixture(t);writeFileSync(join(root,'runtime.pid'),'123');writeFileSync(join(root,'config.json'),'{"apiKey":"private-test-key","executionBackend":"headless"}');
  const state={executionBackend:'headless',requestTotals:{startedAt:'one'}};
  const manager=createManager({root,env:{},inspect:()=>({executable:'node',args:['node',join(root,'launch.mjs')]}),fetchStatus:async()=>state});
  assert.equal(await manager.playgroundTarget(),'disabled');
  await manager.setOpenPlayground(true);assert.equal(readFileSync(join(root,'config.json'),'utf8').includes('private-test-key'),true);
  assert.equal(await manager.playgroundTarget(),'https://aistudio.google.com/prompts/new_chat');
  await manager.playgroundOpened();assert.equal(await manager.playgroundTarget(),'opened');
  state.requestTotals.startedAt='two';assert.equal(await manager.playgroundTarget(),'https://aistudio.google.com/prompts/new_chat');
  await manager.setOpenPlayground(false);assert.equal(await manager.playgroundTarget(),'disabled');
});

test('mode switching protects active requests and restores exact configuration and LAN mode on failure',async()=>{
  let raw='{"executionBackend":"browser","nativeContinuation":true,"inputReadSynthetic":true,"apiKey":"private-key"}',starts=[],stops=0,prepares=0;
  const state={running:true,mode:'lan',executionBackend:'browser',configuredBackend:'browser',pending:1};
  const ops={status:async()=>state,prepare:async()=>prepares++,read:()=>raw,write:value=>raw=value,stop:async()=>stops++,start:async lan=>starts.push(lan)};
  await assert.rejects(changeBackend('headless',ops),/生成/);assert.equal(prepares,0);assert.equal(stops,0);
  state.pending=0;const original=raw;
  ops.start=async lan=>{starts.push(lan);if(starts.length===1)throw Error('synthetic startup failure');};
  await assert.rejects(changeBackend('headless',ops),/已恢复/);assert.equal(raw,original);assert.deepEqual(starts,[true,true]);
  ops.start=async lan=>starts.push(lan);await changeBackend('headless',ops);
  let config=JSON.parse(raw);assert.equal(config.nativeContinuation,false);assert.equal(config.browserNativeContinuation,true);assert.equal(config.inputReadSynthetic,true);assert.equal(config.apiKey,'private-key');
  state.executionBackend=state.configuredBackend='headless';state.running=false;starts=[];stops=0;
  await changeBackend('browser',ops);config=JSON.parse(raw);assert.equal(config.nativeContinuation,true);assert.equal(stops,0);assert.equal(starts.length,0);
});

test('failed backend preparation and a newly busy service leave the original configuration untouched',async()=>{
  const state={running:true,executionBackend:'browser',configuredBackend:'browser',pending:0};let written=false,stopped=false;
  const ops={status:async()=>state,prepare:async()=>{throw Error('runtime missing');},read:()=>'{"executionBackend":"browser"}',write:()=>written=true,stop:async()=>stopped=true,start:async()=>{}};
  await assert.rejects(changeBackend('headless',ops),/runtime missing/);assert.equal(stopped,false);assert.equal(written,false);
  ops.prepare=async()=>{};ops.stop=async()=>{throw Error('new active request');};
  await assert.rejects(changeBackend('headless',ops),/new active request/);assert.equal(written,false);
});
test('stopped PG can inspect headless runtime read-only without starting a service',async t=>{
  const root=fixture(t);writeFileSync(join(root,'config.json'),'{"executionBackend":"headless"}');
  const manager=createManager({root,env:{},fetchRuntimeStatus:async()=>({online:true,ready:true,enabledAccounts:1,accountState:'ready',accountId:'private@example.test'})});
  const info=await manager.status();assert.equal(info.running,false);assert.equal(info.runtime.ready,true);assert.equal(info.runtime.accountId,undefined);
  assert.equal(existsSync(join(root,'.headless')),false);assert.equal(existsSync(join(root,'runtime.pid')),false);
});
