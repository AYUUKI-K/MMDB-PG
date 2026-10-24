import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,readdirSync,copyFileSync,cpSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import http from 'node:http';
import {setTimeout as delay} from 'node:timers/promises';
import {autoInstallST,findSillyTaverns} from '../tools/auto-st-reasoning.mjs';

const fixture=`function forward(request,bodyParams) {
 if (request.body.reasoning_effort && [CHAT_COMPLETION_SOURCES.CUSTOM, CHAT_COMPLETION_SOURCES.OPENAI].includes(request.body.chat_completion_source)) {
   if (OPENAI_REASONING_EFFORT_MODELS.includes(request.body.model)) {
     bodyParams['reasoning_effort'] = OPENAI_FIXED_REASONING_EFFORT[request.body.model] ?? OPENAI_REASONING_EFFORT_MAP[request.body.reasoning_effort] ?? request.body.reasoning_effort;
   }
 }
}`;
function environment(t){
 const root=mkdtempSync(join(tmpdir(),'mmdb-auto-st-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const home=join(root,'home'),relayRoot=join(home,'mmdb-pg');mkdirSync(relayRoot,{recursive:true});
 return {root,home,relayRoot,env:{},interactive:false,log:()=>{}};
}
function st(directory,source=fixture){
 mkdirSync(join(directory,'src/endpoints/backends'),{recursive:true});
 writeFileSync(join(directory,'server.js'),'');writeFileSync(join(directory,'package.json'),'{"name":"sillytavern"}');
 const file=join(directory,'src/endpoints/backends/chat-completions.js');writeFileSync(file,source);return file;
}
test('one local ST is patched automatically, backed up and remembered without stacking',async t=>{
 const options=environment(t),directory=join(options.home,'SillyTavern'),file=st(directory);
 assert.equal((await autoInstallST(options)).status,'installed');
 const first=readFileSync(file,'utf8');assert.ok(first.includes('MMDB PG reasoning:'));assert.equal(readFileSync(file+'.mmdb-reasoning.bak','utf8'),fixture);
 assert.equal(JSON.parse(readFileSync(join(options.relayRoot,'st-path.json'),'utf8')).directory,directory);
 assert.equal((await autoInstallST(options)).status,'already-installed');assert.equal(readFileSync(file,'utf8'),first);
});
test('multiple local copies require selection and modify only the selected copy',async t=>{
 const options=environment(t),first=join(options.home,'SillyTavern'),second=join(options.home,'GitHub/SillyTavern');
 const a=st(first),b=st(second);assert.equal(findSillyTaverns(options.relayRoot,options.home).length,2);
 assert.equal((await autoInstallST(options)).status,'not-selected');assert.equal(readFileSync(a,'utf8'),fixture);assert.equal(readFileSync(b,'utf8'),fixture);
 assert.equal((await autoInstallST({...options,interactive:true,ask:async()=> '2'})).status,'installed');
 assert.equal(readFileSync(a,'utf8'),fixture);assert.ok(readFileSync(b,'utf8').includes('MMDB PG reasoning:'));
});
test('custom paths are accepted and a remote-device skip is remembered',async t=>{
 const options=environment(t),custom=join(options.root,'custom/SillyTavern');st(custom);
 assert.equal((await autoInstallST({...options,interactive:true,ask:async()=>`"${custom}"`})).status,'installed');
 const remote=environment(t);assert.equal((await autoInstallST({...remote,interactive:true,ask:async()=>''})).status,'skipped');
 assert.equal((await autoInstallST({...remote,interactive:true,ask:async()=>{throw Error('should not prompt');}})).status,'skipped');
});
test('unsupported versions and invalid explicit paths never trigger fallback edits',async t=>{
 const options=environment(t),directory=join(options.home,'SillyTavern'),file=st(directory,'unknown source');
 assert.equal((await autoInstallST(options)).status,'failed');assert.equal(readFileSync(file,'utf8'),'unknown source');assert.ok(!existsSync(file+'.mmdb-reasoning.bak'));
 writeFileSync(file,fixture);assert.equal((await autoInstallST({...options,env:{MMDB_ST_DIR:join(options.root,'missing')}})).status,'invalid-path');assert.equal(readFileSync(file,'utf8'),fixture);
});

test('real portable launch entry auto-installs after binding and still serves HTTP',async t=>{
 const options=environment(t),directory=join(options.root,'SillyTavern'),file=st(directory);
 const source=fileURLToPath(new URL('../',import.meta.url));
 // Child checkout stays beneath the test package so ws resolves from its parent.
 const childRoot=mkdtempSync(join(source,'.launch-test-'));
 for(const name of readdirSync(source))if(name.endsWith('.mjs')||name==='package.json')copyFileSync(join(source,name),join(childRoot,name));
 cpSync(join(source,'src'),join(childRoot,'src'),{recursive:true});mkdirSync(join(childRoot,'tools'));
 for(const name of ['auto-st-reasoning.mjs','install-st-reasoning.mjs'])copyFileSync(join(source,'tools',name),join(childRoot,'tools',name));
 const reserve=http.createServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');const port=reserve.address().port;await new Promise(r=>reserve.close(r));
 const child=spawn(process.execPath,[resolve(childRoot,'launch.mjs')],{cwd:childRoot,env:{...process.env,MMDB_PORT:String(port),MMDB_ST_DIR:directory},stdio:['ignore','pipe','pipe'],windowsHide:true});
 let output='';child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>output+=data);
 t.after(async()=>{
   if(child.exitCode===null&&child.signalCode===null){const ended=once(child,'exit');child.kill('SIGKILL');await ended;}
   rmSync(childRoot,{recursive:true,force:true});
 });
 let ready=false;
 for(let i=0;i<100;i++){
   try{const response=await fetch(`http://127.0.0.1:${port}/health`,{signal:AbortSignal.timeout(200)});ready=response.ok&&readFileSync(file,'utf8').includes('MMDB PG reasoning:');}catch{}
   if(ready)break;await delay(25);
 }
 assert.ok(ready,output);assert.equal(readFileSync(file+'.mmdb-reasoning.bak','utf8'),fixture);
});
