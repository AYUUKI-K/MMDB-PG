import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {diagnosticHistory} from '../diagnostics.mjs';

test('page lifecycle failure metadata stays bounded and excludes credentials',()=>{
  const history=diagnosticHistory();
  history.add({pageVisibility:'hidden',browserOnline:true,maxTimerGapMs:65000,authRefreshed:true,cookie:'PRIVATE',authorization:'PRIVATE',headers:{secret:'PRIVATE'}});
  assert.deepEqual(history.recent[0],{pageVisibility:'hidden',browserOnline:true,authRefreshed:true,maxTimerGapMs:65000});
  history.add({pageVisibility:'PRIVATE',browserOnline:'PRIVATE',maxTimerGapMs:-1,authRefreshed:'PRIVATE'});
  assert.deepEqual(history.recent[0],{});
});

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
  history.add({id:'test',generation:{temperature:1,maxOutputTokens:65535,thinkingConfigSent:true,thinkingLevel:'medium',includeThoughts:true,body:'PRIVATE'},usage:{promptTokenCount:1,thoughtsTokenCount:0,secret:'PRIVATE'},usageComplete:false,attempts:[{index:1,round:0,reason:'initial',status:'finished',requestSentMs:5,prompt:'PRIVATE',usage:{candidatesTokenCount:8,secret:'PRIVATE'}}]});
  const raw=readFileSync(file,'utf8');assert.ok(!raw.includes('PRIVATE'));
  const row=diagnosticHistory(file).recent[0];assert.equal(row.usage.thoughtsTokenCount,0);assert.equal(row.usage.totalTokenCount,undefined);
  assert.equal(row.generation.thinkingConfigSent,true);assert.equal(row.generation.thinkingLevel,'medium');assert.equal(row.generation.includeThoughts,true);assert.equal(row.attempts[0].usage.candidatesTokenCount,8);assert.equal(row.attempts[0].requestSentMs,5);
});

test('reasoning structure survives reopening without retaining upstream text or signatures',t=>{
  const dir=mkdtempSync(join(tmpdir(),'mmdb-reasoning-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const file=join(dir,'diagnostics.log'),history=diagnosticHistory(file);
  history.add({reasoning:{requestEffort:'high',rawThoughtChars:12,decodedThoughtChars:12,forwardedThoughtChars:12,partShapes:[{slots:'1:s,12:b,14:s',count:1},{slots:'PRIVATE',count:1}],text:'PRIVATE',signature:'PRIVATE'}});
  const raw=readFileSync(file,'utf8');assert.ok(!raw.includes('PRIVATE'));
  const row=diagnosticHistory(file).recent[0].reasoning;
  assert.equal(row.requestEffort,'high');assert.equal(row.forwardedThoughtChars,12);assert.deepEqual(row.partShapes,[{slots:'1:s,12:b,14:s',count:1}]);
});
