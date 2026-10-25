import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readConfig} from '../config.mjs';

test('1.2.x persisted user-tail configuration starts with the new default contract without rewriting user settings',t=>{
  const dir=mkdtempSync(join(tmpdir(),'mmdb-config-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const file=join(dir,'config.json');
  const saved={apiKey:'preserved-test-key',port:18765,toolPromptStyle:'tail-user',models:['gemini-4-argon'],maxContinuations:1,custom:{keep:true}};
  const original=JSON.stringify(saved,null,2);
  writeFileSync(file,original);
  const loaded=readConfig(file,{});
  assert.equal(loaded.toolPromptStyle,'legacy');
  for(const key of ['apiKey','port','models','maxContinuations','custom'])assert.deepEqual(loaded[key],saved[key]);
  assert.equal(loaded.inputRead,false);
  assert.equal(loaded.nativeContinuation,false);
  assert.equal(readFileSync(file,'utf8'),original);
  for(const style of ['legacy','compact']){
    writeFileSync(file,JSON.stringify({...saved,toolPromptStyle:style}));
    assert.equal(readConfig(file,{}).toolPromptStyle,style);
  }
  writeFileSync(file,JSON.stringify({...saved,toolPromptStyle:'unknown-style'}));
  assert.throws(()=>readConfig(file,{}),/toolPromptStyle/);
});
