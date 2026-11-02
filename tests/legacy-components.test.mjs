import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,mkdirSync,rmSync,existsSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {COMPONENT_BUNDLE,publicComponent,restoreLegacyComponents,readComponentBundle} from '../tools/legacy-components.mjs';
const payload=readFileSync(new URL('../tools/legacy-components.json',import.meta.url),'utf8');
function fixture(t){const root=mkdtempSync(join(tmpdir(),'MMDB legacy '));t.after(()=>rmSync(root,{recursive:true,force:true}));mkdirSync(join(root,'tools'));writeFileSync(join(root,'package.json'),JSON.stringify({version:JSON.parse(payload).version}));writeFileSync(join(root,COMPONENT_BUNDLE),payload);return root;}
test('legacy components restore all public source without changing credentials or a complete source checkout',t=>{
  const root=fixture(t);mkdirSync(join(root,'runtime-manager/.runtime'),{recursive:true});writeFileSync(join(root,'runtime-manager/manager.config.json'),'private binding');writeFileSync(join(root,'runtime-manager/.runtime/account.json'),'private credentials');
  const expected=readComponentBundle(root);assert(restoreLegacyComponents(root));
  for(const file of expected)assert.equal(readFileSync(join(root,file.path),'utf8'),file.text);
  assert.equal(readFileSync(join(root,'runtime-manager/manager.config.json'),'utf8'),'private binding');assert.equal(readFileSync(join(root,'runtime-manager/.runtime/account.json'),'utf8'),'private credentials');
  writeFileSync(join(root,'runtime-manager/README.md'),'local source edit');assert.equal(restoreLegacyComponents(root),false);assert.equal(readFileSync(join(root,'runtime-manager/README.md'),'utf8'),'local source edit');
});
test('legacy component validation rejects corrupt, private and traversal payloads before writing any component',t=>{
  for(const name of ['runtime-manager/manager.config.json','runtime-manager/.runtime/auth.json','runtime-manager/../escape','browser-extension/cookies.json','runtime-manager/src/NUL.mjs'])assert.equal(publicComponent(name),false,name);
  for(const change of [data=>data.version='0.0.0',data=>data.files[0].text+='corrupt',data=>{const text='private';data.files.push({path:'runtime-manager/manager.config.json',text,sha256:createHash('sha256').update(text).digest('hex')});}]){
    const root=fixture(t),data=JSON.parse(payload);change(data);writeFileSync(join(root,COMPONENT_BUNDLE),JSON.stringify(data));assert.throws(()=>restoreLegacyComponents(root));assert.equal(existsSync(join(root,'runtime-manager/package.json')),false);
  }
});
test('legacy component expansion refuses directory links instead of writing outside the installation',t=>{
  const root=fixture(t),outside=join(root,'outside');mkdirSync(outside);symlinkSync(outside,join(root,'runtime-manager'),process.platform==='win32'?'junction':'dir');assert.throws(()=>restoreLegacyComponents(root),/链接/);assert.equal(existsSync(join(outside,'package.json')),false);
});
