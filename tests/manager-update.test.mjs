import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {managerWorkerOwned,stopManagerWorkers} from '../tools/manager-update.mjs';
import {acquireRuntimeLock} from '../runtime-manager/src/headless-lock.mjs';
test('update worker ownership requires Node, exact script argument and matching data root',()=>{
  const root=join(tmpdir(),'MMDB 中文'),script=join(root,'runtime-manager','src','portal.mjs'),data=join(root,'.headless'),record={executable:'node.exe',args:['node',script,data]};assert(managerWorkerOwned(record,script,data));
  assert(!managerWorkerOwned({...record,args:['node','other.mjs',script,data]},script,data));assert(!managerWorkerOwned({...record,executable:'other.exe'},script,data));assert(!managerWorkerOwned({...record,args:['node',script,join(root,'elsewhere')]},script,data));
});
test('idle update stops supervisor before portal, refuses a busy lease and never signals a foreign PID',async t=>{
  const root=mkdtempSync(join(tmpdir(),'manager-update-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const data=join(root,'.headless');mkdirSync(data);const records=new Map(),killed=[];
  for(const [pid,receipt,name] of [[100,'supervisor-status.json','supervisor.mjs'],[101,'manager.json','portal.mjs']]){writeFileSync(join(data,receipt),JSON.stringify({pid}));records.set(pid,{executable:'node.exe',args:['node',join(root,'runtime-manager','src',name),...(pid===100?['--watch']:[]),data]});}
  const options={inspect:pid=>records.get(pid),signal:pid=>{killed.push(pid);records.delete(pid);}};
  const release=await acquireRuntimeLock(join(data,'operation.lock'));await assert.rejects(stopManagerWorkers(root,options),/正在生成/);assert.deepEqual(killed,[]);release();
  assert.equal((await stopManagerWorkers(root,options)).wasOpen,true);assert.deepEqual(killed,[100,101]);
  records.set(101,{executable:'node.exe',args:['node','unrelated.mjs',data]});await assert.rejects(stopManagerWorkers(root,options),/归属不符/);assert.deepEqual(killed,[100,101]);
});
