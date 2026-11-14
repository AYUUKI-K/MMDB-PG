import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readConfig} from '../src/server/config.mjs';
import {RequestDeadlines} from '../src/server/deadlines.mjs';

test('new installs wait 1000 seconds for first content without changing queue or total deadlines',t=>{
  const dir=mkdtempSync(join(tmpdir(),'mmdb-timeout-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const file=join(dir,'config.json'),config=readConfig(file,{});
  assert.equal(config.timeoutMs,1000000);assert.equal(config.toolFirstByteTimeoutMs,1000000);
  assert.equal(config.queueTimeoutMs,120000);assert.equal(config.maxRequestMs,1800000);
  for(const extended of [false,true]){
    const deadlines=new RequestDeadlines(config,{extended});
    deadlines.data(600000,false);assert.equal(deadlines.next().at,1000000);
    deadlines.data(700000,true);assert.equal(deadlines.next().at,1700000);
    deadlines.data(900000,true);assert.equal(deadlines.next().at,1800000);assert.equal(deadlines.next().code,'request_deadline');
  }
  assert.equal(JSON.parse(readFileSync(file,'utf8')).timeoutMs,1000000);
});

test('timeout configuration cannot overflow the Node timer or rewrite a custom waiting budget',t=>{
  const dir=mkdtempSync(join(tmpdir(),'mmdb-timeout-range-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const file=join(dir,'config.json');
  for(const timeoutMs of [600000,1234567,7200000]){
    const original=JSON.stringify({timeoutMs,toolFirstByteTimeoutMs:456789,apiKey:'unchanged-test-key'});writeFileSync(file,original);
    const config=readConfig(file,{});assert.equal(config.timeoutMs,timeoutMs);assert.equal(config.toolFirstByteTimeoutMs,456789);assert.equal(readFileSync(file,'utf8'),original);
  }
  for(const timeoutMs of [99,100.5,2147483648,Number.MAX_SAFE_INTEGER,'1000000',null]){
    writeFileSync(file,JSON.stringify({timeoutMs}));assert.throws(()=>readConfig(file,{}),/timeoutMs/);
  }
});

test('1.2.x persisted user-tail configuration starts with the new default contract without rewriting user settings',t=>{
  const dir=mkdtempSync(join(tmpdir(),'mmdb-config-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const file=join(dir,'config.json');
  const saved={apiKey:'preserved-test-key',port:18765,toolPromptStyle:'tail-user',models:['gemini-4-argon'],maxContinuations:1,accountCooldownMs:'retired',custom:{keep:true}};
  const original=JSON.stringify(saved,null,2);
  writeFileSync(file,original);
  const loaded=readConfig(file,{});
  assert.equal(loaded.toolPromptStyle,'legacy');
  for(const key of ['apiKey','port','models','maxContinuations','custom'])assert.deepEqual(loaded[key],saved[key]);
  assert.equal(loaded.inputRead,false);
  assert.equal(loaded.inputReadSynthetic,false);
  assert.equal(loaded.accountCooldownMs,undefined);
  assert.equal(loaded.nativeContinuation,false);
  assert.equal(readFileSync(file,'utf8'),original);
  for(const style of ['legacy','compact']){
    writeFileSync(file,JSON.stringify({...saved,toolPromptStyle:style}));
    assert.equal(readConfig(file,{}).toolPromptStyle,style);
  }
  writeFileSync(file,JSON.stringify({...saved,toolPromptStyle:'unknown-style'}));
  assert.throws(()=>readConfig(file,{}),/toolPromptStyle/);
});
