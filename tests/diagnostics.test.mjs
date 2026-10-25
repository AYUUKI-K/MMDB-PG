import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {diagnosticHistory} from '../src/server/diagnostics.mjs';

test('diagnostic history persists only metadata, remains bounded, and survives reopening',t=>{
  const dir=mkdtempSync(join(tmpdir(),'mmdb-diagnostics-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const file=join(dir,'diagnostics.log'),history=diagnosticHistory(file);
  for(let i=0;i<55;i++)history.add({id:String(i),model:'test',status:'finished',streamRequested:true,firstBodyMs:20,bodyChars:2,prompt:'PRIVATE_TEXT',content:'PRIVATE_BODY',authorization:'PRIVATE_SECRET'});
  const raw=readFileSync(file,'utf8');assert.ok(!raw.includes('PRIVATE'));assert.equal(history.recent.length,50);
  const restored=diagnosticHistory(file);assert.equal(restored.recent.length,50);assert.equal(restored.recent[0].id,'54');assert.equal(restored.recent[0].streamRequested,true);
});


test('nested performance records persist only whitelisted numeric usage and parameter metadata',t=>{
  const dir=mkdtempSync(join(tmpdir(),'mmdb-metrics-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const file=join(dir,'diagnostics.log'),history=diagnosticHistory(file);
  history.add({id:'test',generation:{temperature:1,maxOutputTokens:65535,thinkingConfigSent:false,body:'PRIVATE'},usage:{promptTokenCount:1,thoughtsTokenCount:0,secret:'PRIVATE'},usageComplete:false,attempts:[{index:1,round:0,reason:'initial',status:'finished',requestSentMs:5,prompt:'PRIVATE',usage:{candidatesTokenCount:8,secret:'PRIVATE'}}]});
  const raw=readFileSync(file,'utf8');assert.ok(!raw.includes('PRIVATE'));
  const row=diagnosticHistory(file).recent[0];assert.equal(row.usage.thoughtsTokenCount,0);assert.equal(row.usage.totalTokenCount,undefined);
  assert.equal(row.generation.thinkingConfigSent,false);assert.equal(row.attempts[0].usage.candidatesTokenCount,8);assert.equal(row.attempts[0].requestSentMs,5);
});
