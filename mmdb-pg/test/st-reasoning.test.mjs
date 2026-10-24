import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,copyFileSync,mkdtempSync,mkdirSync,rmSync,symlinkSync,unlinkSync,rmdirSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import vm from 'node:vm';
import {patchSource,install} from '../tools/install-st-reasoning.mjs';
import {fromOpenAI,toWire} from '../protocol.mjs';

const fixture=`function forward(request,bodyParams) {
        if (request.body.reasoning_effort && [CHAT_COMPLETION_SOURCES.CUSTOM, CHAT_COMPLETION_SOURCES.OPENAI].includes(request.body.chat_completion_source)) {
            if (OPENAI_REASONING_EFFORT_MODELS.includes(request.body.model)) {
                bodyParams['reasoning_effort'] = OPENAI_FIXED_REASONING_EFFORT[request.body.model] ?? OPENAI_REASONING_EFFORT_MAP[request.body.reasoning_effort] ?? request.body.reasoning_effort;
            }
        }
        return bodyParams;
}
`;
function directory(t){
  const root=mkdtempSync(join(tmpdir(),'mmdb-st-reasoning-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  mkdirSync(join(root,'src/endpoints/backends'),{recursive:true});
  return {root,target:join(root,'src/endpoints/backends/chat-completions.js')};
}
test('targeted ST forwarding carries high to PG without changing unrelated providers',()=>{
  const source=patchSource(fixture).source;
  const scope={CHAT_COMPLETION_SOURCES:{CUSTOM:'custom',OPENAI:'openai'},OPENAI_REASONING_EFFORT_MODELS:['gpt-test'],OPENAI_FIXED_REASONING_EFFORT:{},OPENAI_REASONING_EFFORT_MAP:{}};
  vm.createContext(scope);vm.runInContext(source,scope);
  for(const model of ['pg-gemini-4-argon','pg-gemini-4-argon-抗截断']){
    const params=scope.forward({body:{model,chat_completion_source:'custom',reasoning_effort:'high'}},{});
    assert.equal(params.reasoning_effort,'high');
    const body=fromOpenAI({model,messages:[{role:'user',content:'offline'}],...params});
    assert.deepEqual(toWire('gemini-4-argon',body).wire[3][16],[1,null,null,3]);
  }
  for(const [model,provider] of [['other','custom'],['pg-gemini-4-argon','openai']])assert.equal(scope.forward({body:{model,chat_completion_source:provider,reasoning_effort:'high'}},{}).reasoning_effort,undefined);
  assert.equal(scope.forward({body:{model:'gpt-test',chat_completion_source:'openai',reasoning_effort:'high'}},{}).reasoning_effort,'high');
});
test('installer preserves source backups and CRLF, refuses unknown/partial structures, and does not stack',t=>{
  const {root,target}=directory(t),original=fixture.replaceAll('\n','\r\n');writeFileSync(target,original);
  assert.equal(install(root),'installed');assert.equal(readFileSync(target+'.mmdb-reasoning.bak','utf8'),original);
  const changed=readFileSync(target,'utf8');assert.ok(!changed.replaceAll('\r\n','').includes('\n'));
  assert.equal(install(root),'already-installed');assert.equal(readFileSync(target,'utf8'),changed);
  assert.throws(()=>patchSource(fixture+fixture));assert.throws(()=>patchSource('unknown source'));
  assert.throws(()=>patchSource(changed.replace('// MMDB PG reasoning:','// partial marker:')));
});
test('CLI runs through directory aliases such as Android /sdcard, instead of silently doing nothing',t=>{
  const {root,target}=directory(t);writeFileSync(target,fixture);
  const storage=join(root,'storage');mkdirSync(storage);
  const alias=join(root,'sdcard');symlinkSync(storage,alias,process.platform==='win32'?'junction':'dir');
  t.after(()=>{if(existsSync(alias)){if(process.platform==='win32')rmdirSync(alias);else unlinkSync(alias);}});
  copyFileSync(fileURLToPath(new URL('../tools/install-st-reasoning.mjs',import.meta.url)),join(storage,'fix.mjs'));
  for(const message of ['补丁已写入','补丁已安装']){
    const result=spawnSync(process.execPath,[join(alias,'fix.mjs'),root],{encoding:'utf8',timeout:5000});
    assert.equal(result.status,0,result.stderr);assert.ok(result.stdout.includes(message),result.stdout);
  }
  assert.ok(readFileSync(target,'utf8').includes('// MMDB PG reasoning:'));
});
