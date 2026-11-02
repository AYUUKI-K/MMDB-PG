import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {openManagerPage} from '../src/browser-opener.mjs';
const url='http://127.0.0.1:12345/#'+'a'.repeat(64);

test('Windows launcher waits for OS handoff and keeps the private URL out of command arguments',async()=>{
  const child=new EventEmitter();let settled=false;
  const pending=openManagerPage(url,{platform:'win32',spawnImpl:(command,args,options)=>{
    assert.equal(command,'powershell.exe');assert(!args.join(' ').includes(url));assert.equal(options.env.MMDB_MANAGER_URL,url);assert.equal(options.windowsHide,true);return child;
  }}).then(()=>settled=true);
  await Promise.resolve();assert.equal(settled,false);child.emit('spawn');await Promise.resolve();assert.equal(settled,false);
  child.emit('close',0);await pending;assert.equal(settled,true);
});

test('browser launch errors and nonzero exit remain visible failures without leaking raw messages',async()=>{
  for(const kind of ['error','exit','throw']){
    const pending=openManagerPage(url,{spawnImpl:()=>{
      if(kind==='throw')throw Error('PRIVATE');const child=new EventEmitter();queueMicrotask(()=>kind==='error'?child.emit('error',Error('PRIVATE')):child.emit('close',1));return child;
    }});
    await assert.rejects(pending,error=>/浏览器/.test(error.message)&&!error.message.includes('PRIVATE')&&!error.message.includes(url));
  }
});

test('launch timeout ends only the opener helper; invalid URLs never start a process',async()=>{
  let killed=0;const child=new EventEmitter();child.kill=()=>killed++;
  await assert.rejects(openManagerPage(url,{spawnImpl:()=>child,timeoutMs:10}),/超时/);assert.equal(killed,1);
  await assert.rejects(openManagerPage('https://example.test',{spawnImpl:()=>{throw Error('should not run');}}),/地址无效/);
});
