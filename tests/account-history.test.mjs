import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {accountHistory,emailAccountId} from '../src/server/accounts.mjs';
import {normalizeAccountEmail} from '../src/shared/account-email.js';

test('email records and model cooldowns survive restart without credentials',t=>{
  const dir=mkdtempSync(join(tmpdir(),'mmdb-accounts-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const file=join(dir,'accounts.json');
  const store=accountHistory(file),until=Date.now()+900000,email='first@example.com';
  store.states.set(emailAccountId(email),{email,password:'must-not-be-saved',cookies:'must-not-be-saved',cooldowns:new Map([['test',until],['expired',Date.now()-1]])});
  store.states.set('legacy:profile:0',{cooldowns:new Map([['test',until]])});store.save();
  const raw=readFileSync(file,'utf8');assert.ok(!raw.includes('must-not-be-saved'));assert.ok(!raw.includes('legacy'));assert.ok(!raw.includes('expired'));
  const restarted=accountHistory(file);assert.equal(restarted.states.size,1);assert.equal(restarted.states.get(emailAccountId(email)).cooldowns.get('test'),until);
});

test('corrupt records fail closed to an empty local registry and invalid fields are discarded',t=>{
  const dir=mkdtempSync(join(tmpdir(),'mmdb-accounts-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const file=join(dir,'accounts.json');
  writeFileSync(file,'{broken');assert.equal(accountHistory(file).states.size,0);
  writeFileSync(file,JSON.stringify({version:1,accounts:[{email:'invalid',cooldowns:{}},{email:' Valid@Example.com ',cooldowns:{expired:1,unbounded:Date.now()+2*86400000,test:Date.now()+10000}}]}));
  const store=accountHistory(file);assert.equal(store.states.size,1);assert.deepEqual([...store.states.get(emailAccountId('valid@example.com')).cooldowns.keys()],['test']);
});

test('email normalization rejects injected text and does not merge custom-domain aliases',()=>{
  assert.equal(normalizeAccountEmail(' Primary.Name@Example.com '),'primary.name@example.com');
  assert.notEqual(normalizeAccountEmail('primary.name@example.com'),normalizeAccountEmail('primaryname@example.com'));
  for(const value of [null,'','x@y','x@@example.com','<x@example.com>','x\n@example.com','x..y@example.com','x@-example.com'])assert.equal(normalizeAccountEmail(value),null);
});
