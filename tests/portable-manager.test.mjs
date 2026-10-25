import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,mkdirSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createManager,commandBelongsToRoot,dependencyState} from '../tools/portable-manager.mjs';

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
test('Windows official installer verifies downloads before offering an interactive install',{skip:process.platform!=='win32'},()=>{
  const script=fileURLToPath(new URL('portable-installer.ps1',import.meta.url));
  const output=execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',script],{encoding:'utf8',windowsHide:true,timeout:30000});
  assert.match(output,/PASS:/);
});
