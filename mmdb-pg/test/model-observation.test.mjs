import {test} from 'node:test';
import assert from 'node:assert/strict';
import {relayFixture,frame,finish} from './helpers.mjs';
import {generationDiagnosticText} from '../src/panel.js';
import {diagnosticHistory} from '../diagnostics.mjs';

for(const native of [false,true])for(const stream of [false,true])test(`model evidence never echoes the request as a verified provider identity (${native?'Gemini':'OpenAI'}, stream=${stream})`,async t=>{
  const f=await relayFixture(t);
  const received=f.nextRequest();
  const settled=new Promise(resolve=>{const listener=raw=>{const msg=JSON.parse(raw);if(msg.type==='settled'){f.ws.off('message',listener);resolve(msg);}};f.ws.on('message',listener);});
  const path=native?`/v1beta/models/pg-test:${stream?'streamGenerateContent':'generateContent'}`:undefined;
  const response=f.call(native?{contents:[{parts:[{text:'Synthetic model observation.'}]}],model:undefined,messages:undefined}:{model:'pg-test',stream},undefined,path);
  const job=await received;
  assert.deepEqual(job.modelIdentity,{requested:'test',sent:'models/test',reported:null,verification:'unavailable'});
  const last=finish();last[4]='gemini-flash-lite-unverified';
  f.deliver(job,[frame([[null,'I am a different model.']]),last]);
  const res=await response;assert.equal(res.status,200);const body=await res.text();
  assert.ok(!body.includes('"modelVersion"'));assert.ok(!body.includes('gemini-flash-lite-unverified'));
  const message=await settled,row=(await f.status()).recent[0];
  assert.deepEqual(row.modelIdentity,job.modelIdentity);assert.deepEqual(message.diagnostics.modelIdentity,job.modelIdentity);
  assert.equal(message.diagnostics.usage.promptTokenCount,2);assert.equal(message.diagnostics.usage.thoughtsTokenCount,0);
  assert.equal(message.diagnostics.finishReason,'STOP');
  assert.ok(!JSON.stringify(row).includes('I am a different model.'));
});

test('model metadata allowlist retains unknown identity and strips arbitrary fields',()=>{
  const history=diagnosticHistory();
  history.add({modelIdentity:{requested:'gemini-test-抗截断',sent:'models/gemini-test',reported:'UNVERIFIED',verification:'unavailable',prompt:'PRIVATE'}});
  assert.deepEqual(history.recent[0].modelIdentity,{requested:'gemini-test-抗截断',sent:'models/gemini-test',reported:null,verification:'unavailable'});
  history.add({modelIdentity:{requested:'PRIVATE WITH SPACES',sent:'models/test',verification:'unavailable'}});
  assert.equal(history.recent[0].modelIdentity,undefined);
});

test('panel observation text separates missing counters, zero and continuation input totals',()=>{
  assert.match(generationDiagnosticText({usage:{thoughtsTokenCount:0}}),/输入 未知 \/ 思考 0/);
  const text=generationDiagnosticText({rounds:1,usage:{promptTokenCount:30},attempts:[{round:0,usage:{promptTokenCount:10}},{round:1,usage:{promptTokenCount:20}}],modelIdentity:{sent:'models/test',reported:'untrusted-model'}});
  assert.match(text,/输入 30/);assert.match(text,/首轮输入 10，续写 1 次/);assert.ok(!text.includes('untrusted-model'));
  assert.ok(!generationDiagnosticText({modelIdentity:{sent:'<script>PRIVATE</script>'},finishReason:'PRIVATE TEXT'}).includes('PRIVATE'));
});
