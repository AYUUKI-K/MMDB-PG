import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,mkdirSync,existsSync,rmSync,readdirSync,renameSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {deflateRawSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {crc32,unpackRelease,readRelease,updatePortable,resolveSource,SOURCE_REF_URL,SOURCE_RECEIPT} from '../tools/release-update.mjs';

function archive(version='1.7.5',extra={},prefix='mmdb-pg/') {
  const files={'package.json':JSON.stringify({name:'mmdb-pg',version}),'package-lock.json':'{}','build.mjs':'// build','launch.mjs':'// launch','server.mjs':'// server','tools/portable-manager.mjs':'// manager','README.md':'new readme',...extra};
  const local=[],central=[];let offset=0;
  for(const [path,text] of Object.entries(files)){
    const name=Buffer.from(prefix+path),data=Buffer.from(text),packed=deflateRawSync(data),crc=crc32(data);
    const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(8,8);header.writeUInt32LE(crc,14);header.writeUInt32LE(packed.length,18);header.writeUInt32LE(data.length,22);header.writeUInt16LE(name.length,26);
    const entry=Buffer.alloc(46);entry.writeUInt32LE(0x02014b50);entry.writeUInt16LE(8,10);entry.writeUInt32LE(crc,16);entry.writeUInt32LE(packed.length,20);entry.writeUInt32LE(data.length,24);entry.writeUInt16LE(name.length,28);entry.writeUInt32LE(offset,42);
    local.push(header,name,packed);central.push(entry,name);offset+=header.length+name.length+packed.length;
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(Object.keys(files).length,8);end.writeUInt16LE(Object.keys(files).length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,directory,end]);
}
function fixture(t){
  const base=mkdtempSync(join(tmpdir(),'MMDB update 测试 ')),root=join(base,'app');mkdirSync(root);
  t.after(()=>rmSync(base,{recursive:true,force:true}));
  writeFileSync(join(root,'package.json'),' {"name":"mmdb-pg","version":"1.7.4"}');
  writeFileSync(join(root,'README.md'),'old readme');writeFileSync(join(root,'config.json'),'private config');writeFileSync(join(root,'notes.txt'),'keep my notes');
  const source=join(base,'release.zip');writeFileSync(source,archive());
  let running=true,version='1.7.4';const events=[];
  const options={root,source,status:async()=>({version:JSON.parse(readFileSync(join(root,'package.json'))).version,running,pending:0,mode:'lan',serviceVersion:version}),
    stop:async()=>{events.push('stop');running=false;},start:async lan=>{events.push(lan?'start-lan':'start-local');running=true;version=JSON.parse(readFileSync(join(root,'package.json'))).version;},
    prepareApp:()=>events.push('prepare'),prepareScript:async()=>{events.push('script');return 'verified-script-url';}};
  return {base,root,source,options,events};
}
test('ZIP extraction accepts the public release and rejects traversal, private files, duplicate case and corrupted bytes',t=>{
  const {base}=fixture(t);
  assert.equal(crc32(Buffer.from('123456789')),0xcbf43926);
  unpackRelease(archive(),join(base,'ok'));
  assert.equal(JSON.parse(readFileSync(join(base,'ok/package.json'))).version,'1.7.5');
  for(const name of ['../escape','src/../../escape','config.json','src/NUL.txt','src/file:stream','src/dir./file','src/../file','readme.md']){
    assert.throws(()=>unpackRelease(archive('1.7.5',{[name]:'bad'}),join(base,'invalid')),/不安全|完整/);
  }
  const corrupt=archive();corrupt[30+'mmdb-pg/package.json'.length]^=0xff;
  assert.throws(()=>unpackRelease(corrupt,join(base,'corrupt')));
  assert.equal(existsSync(join(base,'escape')),false);
});
test('online download verifies the published checksum before returning a package',async()=>{
  const zip=archive(),digest=createHash('sha256').update(zip).digest('hex');
  const response=(data,url)=>{const r=new Response(data);Object.defineProperty(r,'url',{value:url});return r;};
  const fetcher=async url=>response(url.includes('.sha256')?digest+'  release.zip\n':zip,url);
  assert.deepEqual(await readRelease('https://example.test/release.zip',fetcher),zip);
  await assert.rejects(readRelease('https://example.test/release.zip',async url=>response(url.includes('.sha256')?'0'.repeat(64)+'  release.zip':zip,url)),/SHA-256/);
  await assert.rejects(readRelease('http://example.test/release.zip',fetcher),/HTTPS/);
});
test('update-all keeps configuration, backs up the old files and opens the matching script after LAN restart',async t=>{
  const {root,options,events}=fixture(t);
  assert.equal(await updatePortable(options),'verified-script-url');
  assert.deepEqual(events,['prepare','stop','start-lan','script']);
  assert.equal(readFileSync(join(root,'config.json'),'utf8'),'private config');
  assert.equal(readFileSync(join(root,'notes.txt'),'utf8'),'keep my notes');
  assert.equal(readFileSync(join(root,'README.md'),'utf8'),'new readme');
  const backup=readdirSync(join(root,'.updates')).find(name=>name.startsWith('backup-'));
  assert.equal(readFileSync(join(root,'.updates',backup,'README.md'),'utf8'),'old readme');
});
test('same version skips replacement but continues script installation; older packages never overwrite',async t=>{
  const {source,options,events}=fixture(t);writeFileSync(source,archive('1.7.4'));
  await updatePortable(options);assert.deepEqual(events,['script']);events.length=0;
  writeFileSync(source,archive('1.7.3'));
  await assert.rejects(updatePortable(options),/拒绝降级/);assert.deepEqual(events,[]);
});
test('busy generation, source checkout and failed preparation leave the original service intact',async t=>{
  const {root,options,events}=fixture(t);
  await assert.rejects(updatePortable({...options,status:async()=>({pending:1})}),/仍有生成/);
  mkdirSync(join(root,'.git'));
  await assert.rejects(updatePortable(options),/源码目录/);rmSync(join(root,'.git'),{recursive:true});
  await assert.rejects(updatePortable({...options,prepareApp:()=>{throw Error('build failed');}}),/build failed/);
  assert.deepEqual(events,[]);assert.equal(readFileSync(join(root,'README.md'),'utf8'),'old readme');
});
test('a partial file replacement failure restores the previous program and its running mode',async t=>{
  const {root,options,events}=fixture(t);let failed=false;
  await assert.rejects(updatePortable({...options,move:(from,to)=>{
    if(!failed&&from.includes('next')&&to===join(root,'README.md')){failed=true;throw Error('locked file');}
    renameSync(from,to);
  }}),/locked file/);
  assert.equal(readFileSync(join(root,'README.md'),'utf8'),'old readme');
  assert.equal(JSON.parse(readFileSync(join(root,'package.json'))).version,'1.7.4');
  assert.equal(events.at(-1),'start-lan');assert.ok(!events.includes('script'));
});
test('new backend startup failure rolls back; script failure after a healthy start leaves the new backend installed',async t=>{
  const a=fixture(t);let starts=0;
  await assert.rejects(updatePortable({...a.options,start:async lan=>{if(++starts===1)throw Error('new server failed');await a.options.start(lan);}}),/new server failed/);
  assert.equal(JSON.parse(readFileSync(join(a.root,'package.json'))).version,'1.7.4');
  const b=fixture(t);
  await assert.rejects(updatePortable({...b.options,prepareScript:async()=>{throw Error('browser step failed');}}),/browser step failed/);
  assert.equal(JSON.parse(readFileSync(join(b.root,'package.json'))).version,'1.7.5');
});
test('source updates pin one commit, filter repository-only files, and install changed commits at the same version',async t=>{
  const {root,options,events}=fixture(t),revision='a'.repeat(40),requests=[];
  const zip=archive('1.7.4',{'':'','downloads/old.zip':'archive','config.json':'must not replace user config'},`MMDB-PG-${revision}/`);
  const fetchImpl=async url=>{
    requests.push(url);
    const response=new Response(url===SOURCE_REF_URL?JSON.stringify({ref:'refs/heads/main',object:{type:'commit',sha:revision}}):zip);
    Object.defineProperty(response,'url',{value:url});return response;
  };
  await updatePortable({...options,source:'source',fetchImpl});
  assert.ok(requests[1].endsWith('/zip/'+revision));
  assert.deepEqual(events,['prepare','stop','start-lan','script']);
  assert.equal(JSON.parse(readFileSync(join(root,SOURCE_RECEIPT))).commit,revision);
  assert.equal(readFileSync(join(root,'config.json'),'utf8'),'private config');
  assert.equal(existsSync(join(root,'downloads')),false);
  events.length=0;requests.length=0;
  await updatePortable({...options,source:'source',fetchImpl});
  assert.deepEqual(events,['script']);assert.deepEqual(requests,[SOURCE_REF_URL]);
});
test('source metadata and archive must agree on an exact main commit',async t=>{
  const {base}=fixture(t),revision='b'.repeat(40);
  assert.throws(()=>unpackRelease(archive(),join(base,'wrong'),{revision}),/不安全/);
  const response=new Response(JSON.stringify({ref:'refs/heads/other',object:{type:'commit',sha:revision}}));
  Object.defineProperty(response,'url',{value:SOURCE_REF_URL});
  await assert.rejects(resolveSource(async()=>response),/main/);
});
