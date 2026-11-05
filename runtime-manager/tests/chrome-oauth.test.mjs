import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createChromeOAuthImporter} from '../src/chrome-oauth.mjs';
import {runtimeExecutable} from '../src/headless-runtime.mjs';

function fixture(t,{busy=false,identity='test@example.test',malformed=false,oauth=true,setupError=false}={}){
  const root=mkdtempSync(join(tmpdir(),'chrome-oauth-test-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const binary=Buffer.alloc(3*1024*1024,1); // Executables exceed the credential JSON size limit.
  writeFileSync(runtimeExecutable(root),binary);
  writeFileSync(join(root,'installation.json'),JSON.stringify({version:'v0.2.18',executableSHA256:createHash('sha256').update(binary).digest('hex')}));
  let runs=0;const imports=[],calls=[];
  const options={root,supported:true,
    runSetup:async(executable,email,directory,{proxy})=>{
      assert.equal(proxy,'http://private-proxy.invalid:8080');
      runs++;assert.equal(executable,runtimeExecutable(root));assert.equal(email,'test@example.test');assert(directory.startsWith(root));
      const account=join(directory,'auth','single');mkdirSync(account,{recursive:true});
      mkdirSync(join(directory,'auth','.leases'));writeFileSync(join(directory,'auth','.leases','single.lock'),'');
      writeFileSync(join(account,'account.json'),JSON.stringify({label:email}));
      writeFileSync(join(account,'storage-state.json'),malformed?'PRIVATE_INVALID_JSON':JSON.stringify({cookies:[{name:'SID',value:'PRIVATE_COOKIE',domain:'.google.com'}],aistudio2api:{source:{browser:'chrome',profile:'Default',email},...(oauth?{oauth:{gaia_id:'123',refresh_token:'PRIVATE_REFRESH',wrapped_binding_key:'PRIVATE_BINDING'}}:{})}}));
      if(setupError)throw Error('synthetic timeout');
    },
    admin:async(path,request)=>{calls.push(path);if(path==='/api/status')return {state:'RUNNING',active_requests:busy?1:0};if(path==='/api/accounts')return {accounts:[{id:'test@example.test',proxy:'http://private-proxy.invalid:8080'}]};if(path==='/api/config')return {};assert.equal(path,'/api/accounts/import/cookies/discover');assert.doesNotMatch(JSON.stringify(request),/PRIVATE_REFRESH|PRIVATE_BINDING|aistudio2api/);return {accounts:[{email:identity,auth_user:0}]};},
    importAccount:async(...args)=>imports.push(args)};
  return {root,options,imports,calls,runs:()=>runs,run:createChromeOAuthImporter(options)};
}
test('Chrome capture scopes to the requested email, verifies cookie identity, keeps OAuth on disk/backend and cleans staging',async t=>{
  const f=fixture(t);const result=await f.run(' Test@Example.Test ');assert.deepEqual(result,{ok:true,accountId:'test@example.test'});assert.equal(f.runs(),1);assert.equal(f.imports.length,1);
  assert.doesNotMatch(f.imports[0][0],/PRIVATE_REFRESH|PRIVATE_BINDING/);assert.equal(f.imports[0][1].chromeAuth.oauth.refresh_token,'PRIVATE_REFRESH');
  assert(!readdirSync(f.root).some(name=>name.startsWith('chrome-oauth-')));
});
test('Chrome failure, missing OAuth, malformed storage and mismatched identity never commit and always remove staging',async t=>{
  for(const patch of [{identity:'other@example.test'},{malformed:true},{oauth:false},{setupError:true}]){
    const f=fixture(t,patch);await assert.rejects(f.run('test@example.test'),error=>{assert.doesNotMatch(error.message,/PRIVATE_/);return true;});assert.equal(f.imports.length,0);assert(!readdirSync(f.root).some(name=>name.startsWith('chrome-oauth-')));
  }
});
test('unsupported platform, invalid email, busy generation and modified executable refuse before reading Chrome',async t=>{
  const f=fixture(t,{busy:true});await assert.rejects(f.run('test@example.test'),/正在生成/);assert.equal(f.runs(),0);
  const g=fixture(t);await assert.rejects(createChromeOAuthImporter({...g.options,supported:false})('test@example.test'),/Windows/);
  await assert.rejects(g.run('--email other@example.test'),/邮箱/);
  writeFileSync(runtimeExecutable(g.root),'changed');await assert.rejects(g.run('test@example.test'),/安装记录/);assert.equal(g.runs(),0);assert.equal(g.imports.length,0);
});
