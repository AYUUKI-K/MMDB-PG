import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setImmediate as tick} from 'node:timers/promises';
import {createAuthMetadata} from '../src/account-auth.mjs';
import {runtimeAdmin} from '../src/headless-runtime.mjs';

test('credential inspection returns only verified identity capability, invalidates changed files and rejects corrupt state',t=>{
  const root=mkdtempSync(join(tmpdir(),'mmdb-auth-metadata-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const directory=join(root,'auth','account');mkdirSync(directory,{recursive:true});
  writeFileSync(join(directory,'account.json'),JSON.stringify({label:'test@example.invalid'}));
  const path=join(directory,'storage-state.json'),write=extension=>writeFileSync(path,JSON.stringify({cookies:[{value:'PRIVATE_COOKIE'}],aistudio2api:extension}));
  const metadata=createAuthMetadata(root);write();assert.equal(metadata().get('test@example.invalid'),'cookie_only');
  write({source:{browser:'chrome',email:'test@example.invalid'},oauth:{gaia_id:'123',refresh_token:'PRIVATE_REFRESH_TOKEN'}});
  assert.equal(metadata().get('test@example.invalid'),'saved_oauth');assert.doesNotMatch(JSON.stringify([...metadata()]),/PRIVATE|gaia_id|refresh_token/);
  write({source:{browser:'chrome',email:'test@example.invalid'}});assert.equal(metadata().get('test@example.invalid'),'chrome_source');
  write({source:{browser:'chrome',email:'other@example.invalid'},oauth:{gaia_id:'123',refresh_token:'PRIVATE_REFRESH_TOKEN'}});assert.equal(metadata().get('test@example.invalid'),'cookie_only');
  writeFileSync(path,'corrupt');assert.equal(metadata().size,0);
});

const settings={url:'http://127.0.0.1:1234',apiKey:'x'.repeat(32),adminPassword:'private-test'};
test('concurrent management reads share login and query, with independent returned objects and no stale mutation cache',async()=>{
  let logins=0,reads=0,finish;const admin=runtimeAdmin(settings,{fetchImpl:async(url,options)=>{
    if(url.endsWith('/login')){logins++;return new Response('{}',{headers:{'Set-Cookie':'aistudio_admin=session'}});}
    if(options.method==='GET'){reads++;await new Promise(resolve=>finish=resolve);return Response.json({ready:reads});}
    return Response.json({ok:true});
  }});
  const one=admin('/api/status'),two=admin('/api/status');await tick();assert.equal(logins,1);assert.equal(reads,1);finish();const [a,b]=await Promise.all([one,two]);a.ready=99;assert.equal(b.ready,1);
  const old=admin('/api/status');await tick();const oldFinish=finish;await admin('/api/control/start',{method:'POST'});const next=admin('/api/status');await tick();assert.equal(reads,3);finish();oldFinish();await Promise.all([old,next]);assert.equal(logins,1);
});

test('concurrent expired management sessions trigger one reauthentication, never expose raw upstream errors',async()=>{
  let logins=0;const admin=runtimeAdmin(settings,{fetchImpl:async(url,options)=>{
    if(url.endsWith('/login')){logins++;await tick();return new Response('{}',{headers:{'Set-Cookie':'aistudio_admin='+logins}});}
    if(options.headers.Cookie==='aistudio_admin=1')return new Response('PRIVATE_COOKIE',{status:401});
    return Response.json({ok:true});
  }});
  await Promise.all([admin('/api/status'),admin('/api/accounts')]);assert.equal(logins,2);
});
