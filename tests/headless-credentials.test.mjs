import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,readdirSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCredentialImporter,credentialState} from '../src/server/headless-credentials.mjs';
import {runtimeAdmin} from '../src/server/headless-runtime.mjs';

const duplicate=id=>Object.assign(Error('sanitized conflict'),{code:'account_exists',accountId:id});
function fixture(t,{state='RUNNING',busy=false,failStart=false,identity='a@example.test',duplicateError=duplicate(identity)}={}){
  const root=mkdtempSync(join(tmpdir(),'mmdb-credential-update-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const folder=join(root,'auth','opaque-account-directory');mkdirSync(folder,{recursive:true});
  const config=JSON.stringify({label:'a@example.test',enabled:true,proxy:'preserved-proxy',locale:'zh-CN',timezone:'Asia/Shanghai',auth_user:0,custom:'keep'}),storage=JSON.stringify({cookies:[{name:'SID',value:'old-cookie',domain:'.google.com',path:'/'}],origins:[{origin:'https://aistudio.google.com',localStorage:[]}],aistudio2api:{source:{email:'a@example.test'},oauth:{refresh_token:'test-existing-oauth'}}});
  writeFileSync(join(folder,'account.json'),config);writeFileSync(join(folder,'storage-state.json'),storage);writeFileSync(join(folder,'runtime-state.json'),'keep cooldowns and resources');
  const calls=[];let starts=0;
  const admin=async(path,request)=>{
    calls.push(path);
    if(path==='/api/status')return {state,active_requests:busy?1:0};
    if(path==='/api/accounts/import/cookies'){assert.equal(request.body.label,'');throw duplicateError;}
    if(path==='/api/accounts')return {accounts:[{id:'a@example.test',enabled:true}]};
    if(path==='/api/control/stop'){state='STOPPED';return {state};}
    if(path==='/api/control/start'){starts++;if(failStart&&starts===1)throw Error('synthetic startup failure');state='RUNNING';return {state};}
    throw Error('unexpected route');
  };
  return {root,folder,config,storage,calls,admin,importer:createCredentialImporter({root,admin}),state:()=>state};
}
test('runtime conflict parsing preserves only a verified duplicate identity and never reflects raw upstream errors',async()=>{
  const key='a'.repeat(64);
  for(const [code,message,expected] of [['account_exists','账户已存在: a@example.test','a@example.test'],['account_exists','PRIVATE_COOKIE',undefined],['other_conflict','账户已存在: a@example.test',undefined]]){
    const admin=runtimeAdmin({url:'http://127.0.0.1:1234',apiKey:key,adminPassword:key},{fetchImpl:async url=>url.endsWith('/login')?new Response('{}',{headers:{'Set-Cookie':'aistudio_admin=test'}}):new Response(JSON.stringify({error:{code,message}}),{status:409})});
    await assert.rejects(admin('/api/accounts/import/cookies'),error=>{assert.equal(error.accountId,expected);assert.doesNotMatch(error.message,/a@example|PRIVATE/);assert.doesNotMatch(JSON.stringify(error),/a@example|PRIVATE/);return true;});
  }
});
test('existing account refresh preserves identity, flags, OAuth metadata and runtime history, and saves a private backup',async t=>{
  const f=fixture(t);const imported=await f.importer('SID=new-cookie; __Host-Test=host',{authUser:2});assert.equal(imported.updated,true);assert.equal(typeof imported.accountId,'string');
  const current=JSON.parse(readFileSync(join(f.folder,'storage-state.json'))),config=JSON.parse(readFileSync(join(f.folder,'account.json')));
  assert.equal(current.cookies[0].value,'new-cookie');assert.equal(current.cookies[1].domain,'aistudio.google.com');assert.deepEqual(current.aistudio2api,JSON.parse(f.storage).aistudio2api);assert.deepEqual(current.origins,JSON.parse(f.storage).origins);
  assert.deepEqual(config,{...JSON.parse(f.config),auth_user:2});assert.equal(readFileSync(join(f.folder,'runtime-state.json'),'utf8'),'keep cooldowns and resources');
  const backups=readdirSync(join(f.root,'credential-backups'));assert.equal(backups.length,1);const backup=JSON.parse(readFileSync(join(f.root,'credential-backups',backups[0])));assert.equal(backup.storage,f.storage);assert.equal(backup.config,f.config);
  assert.equal(f.state(),'RUNNING');assert(f.calls.indexOf('/api/control/stop')<f.calls.indexOf('/api/control/start'));assert(!f.calls.some(path=>path.includes('/delete')||path==='/api/accounts/a%40example.test'));
  assert.equal(existsSync(join(f.root,'credential-import.lock')),false);
});
test('busy service, a different verified identity and non-duplicate conflicts never stop service or overwrite credentials',async t=>{
  for(const options of [{busy:true},{identity:'b@example.test'},{duplicateError:Error('unrelated conflict')}]){
    const f=fixture(t,options);await assert.rejects(f.importer('SID=new-cookie'));
    assert.equal(readFileSync(join(f.folder,'storage-state.json'),'utf8'),f.storage);assert(!f.calls.includes('/api/control/stop'));assert.equal(existsSync(join(f.root,'credential-backups')),false);assert.equal(existsSync(join(f.root,'credential-import.lock')),false);
  }
});
test('failed restart restores both old credential/config bytes and resumes the original service',async t=>{
  const f=fixture(t,{failStart:true});await assert.rejects(f.importer('SID=new-cookie',{authUser:3}),/原凭证与配置已保留或恢复/);
  assert.equal(readFileSync(join(f.folder,'storage-state.json'),'utf8'),f.storage);assert.equal(readFileSync(join(f.folder,'account.json'),'utf8'),f.config);assert.equal(f.state(),'RUNNING');assert.equal(f.calls.filter(path=>path==='/api/control/start').length,2);
});
test('a deliberately stopped service remains stopped after credentials are updated',async t=>{
  const f=fixture(t,{state:'STOPPED'});await f.importer('SID=new-cookie');assert.equal(f.state(),'STOPPED');assert(!f.calls.includes('/api/control/start'));assert(!f.calls.includes('/api/control/stop'));
});
test('credential formats preserve expiry, HttpOnly, domain and Google origin data',()=>{
  const json=credentialState(JSON.stringify({cookies:[{name:'SID',value:'new',domain:'.google.com',path:'/',expirationDate:2000000000,httpOnly:true,secure:true,sameSite:'no_restriction'},{name:'other',value:'ignore',domain:'example.test'}],origins:[{origin:'https://aistudio.google.com',localStorage:[]},{origin:'https://example.test',localStorage:[]}]}));
  assert.equal(json.cookies.length,1);assert.equal(json.cookies[0].expires,2000000000);assert.equal(json.cookies[0].httpOnly,true);assert.equal(json.cookies[0].sameSite,'None');assert.equal(json.origins.length,1);
  const netscape=credentialState('#HttpOnly_.google.com\tTRUE\t/\tTRUE\t0\tSID\tnew');assert.equal(netscape.cookies[0].httpOnly,true);assert.equal(netscape.cookies[0].expires,-1);
  assert.throws(()=>credentialState('SID=new\r\nHeader: injected'),/一行/);assert.throws(()=>credentialState('missing equals'),/格式/);
});
