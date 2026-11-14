import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,mkdirSync,existsSync,rmSync,readdirSync,renameSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {deflateRawSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {crc32,unpackRelease,readRelease,updatePortable,resolveSource,SOURCE_ARCHIVE_URL,SOURCE_RECEIPT} from '../tools/release-update.mjs';

function archive(version='1.7.5',extra={},prefix='mmdb-pg/',comment='') {
  const files={'package.json':JSON.stringify({name:'mmdb-pg',version}),'package-lock.json':'{}','build.mjs':'// build','launch.mjs':'// launch','server.mjs':'// server','tools/portable-manager.mjs':'// manager','README.md':'new readme',...extra};
  const local=[],central=[];let offset=0;
  for(const [path,text] of Object.entries(files)){
    const name=Buffer.from(prefix+path),data=Buffer.from(text),packed=deflateRawSync(data),crc=crc32(data);
    const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(8,8);header.writeUInt32LE(crc,14);header.writeUInt32LE(packed.length,18);header.writeUInt32LE(data.length,22);header.writeUInt16LE(name.length,26);
    const entry=Buffer.alloc(46);entry.writeUInt32LE(0x02014b50);entry.writeUInt16LE(8,10);entry.writeUInt32LE(crc,16);entry.writeUInt32LE(packed.length,20);entry.writeUInt32LE(data.length,24);entry.writeUInt16LE(name.length,28);entry.writeUInt32LE(offset,42);
    local.push(header,name,packed);central.push(entry,name);offset+=header.length+name.length+packed.length;
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(Object.keys(files).length,8);end.writeUInt16LE(Object.keys(files).length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  const footer=Buffer.from(comment);end.writeUInt16LE(footer.length,20);
  return Buffer.concat([...local,directory,end,footer]);
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
function scriptFixture(t){
  const f=fixture(t);
  const previous={'scripts/portable.ps1':'old menu','scripts/nested/start.ps1':'old start','scripts/retired/legacy.ps1':'obsolete script',[SOURCE_RECEIPT]:'old receipt'};
  for(const [name,text] of Object.entries(previous)){
    const target=join(f.root,name);mkdirSync(join(target,'..'),{recursive:true});writeFileSync(target,text);
  }
  writeFileSync(f.source,archive('1.7.5',{'scripts/portable.ps1':'new menu','scripts/nested/start.ps1':'new start','scripts/new/stop.ps1':'new stop'}));
  return {...f,previous};
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

test('standalone manager updates preserve instance configuration and runtime data in place',async t=>{
  const f=fixture(t),project=join(f.root,'runtime-manager');mkdirSync(join(project,'.runtime'),{recursive:true});
  writeFileSync(join(project,'manager.config.json'),'private binding');writeFileSync(join(project,'.runtime','credential.json'),'private credential');writeFileSync(join(project,'package.json'),'old manager');
  writeFileSync(f.source,archive('1.7.5',{'runtime-manager/package.json':'new manager','runtime-manager/src/test.mjs':'export const ok=true;'}));
  await updatePortable(f.options);assert.equal(readFileSync(join(project,'package.json'),'utf8'),'new manager');assert.equal(readFileSync(join(project,'manager.config.json'),'utf8'),'private binding');assert.equal(readFileSync(join(project,'.runtime','credential.json'),'utf8'),'private credential');
});

test('updater rejects standalone private settings and credential trees inside archives',t=>{
  const f=fixture(t);for(const name of ['runtime-manager/manager.config.json','runtime-manager/.runtime/auth/state.json'])assert.throws(()=>unpackRelease(archive('1.7.5',{[name]:'secret'}),join(f.base,'private')),/私有数据/);
});
test('source archives ignore standalone Git metadata without admitting private dotfiles',t=>{
  const f=fixture(t),revision='a'.repeat(40),dest=join(f.base,'metadata');
  unpackRelease(archive('1.7.5',{'runtime-manager/.gitignore':'.runtime/\n','runtime-manager/package.json':'public'},'MMDB-PG-main/',revision),dest,{revision,branch:true});
  assert.equal(existsSync(join(dest,'runtime-manager/.gitignore')),false);
  assert.equal(readFileSync(join(dest,'runtime-manager/package.json'),'utf8'),'public');
  for(const path of ['runtime-manager/.env','runtime-manager/.runtime/credential.json'])assert.throws(()=>unpackRelease(archive('1.7.5',{[path]:'secret'},'MMDB-PG-main/',revision),join(f.base,'private-source'),{revision,branch:true}),/私有数据/);
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

test('updates replace files within occupied directories and back up obsolete files',async t=>{
  const f=scriptFixture(t),occupied=new Set(['scripts','scripts/nested','scripts/retired'].map(name=>join(f.root,name)));
  await updatePortable({...f.options,move:(from,to)=>{
    if(occupied.has(from))throw Object.assign(Error('directory in use'),{code:'EPERM'});
    renameSync(from,to);
  }});
  assert.equal(readFileSync(join(f.root,'scripts/portable.ps1'),'utf8'),'new menu');
  assert.equal(readFileSync(join(f.root,'scripts/nested/start.ps1'),'utf8'),'new start');
  assert.equal(readFileSync(join(f.root,'scripts/new/stop.ps1'),'utf8'),'new stop');
  assert.equal(existsSync(join(f.root,'scripts/retired/legacy.ps1')),false);
  const backup=readdirSync(join(f.root,'.updates')).find(name=>name.startsWith('backup-'));
  for(const [name,text] of Object.entries(f.previous))assert.equal(readFileSync(join(f.root,'.updates',backup,name),'utf8'),text);
  assert.equal(readFileSync(join(f.root,'config.json'),'utf8'),'private config');
  assert.deepEqual(f.events,['prepare','stop','start-lan','script']);
});

test('Windows updates succeed while a live process holds a nested scripts directory', {skip:process.platform!=='win32',timeout:15000},async t=>{
  const f=scriptFixture(t);
  const holder=spawn(process.execPath,['-e','process.stdout.write("ready");process.stdin.resume();'],{cwd:join(f.root,'scripts/nested'),windowsHide:true,stdio:['pipe','pipe','pipe']});
  const closed=once(holder,'close');
  try{
    await once(holder.stdout,'data');
    let locked;
    try{renameSync(join(f.root,'scripts'),join(f.base,'locked-scripts'));renameSync(join(f.base,'locked-scripts'),join(f.root,'scripts'));}catch(error){locked=error;}
    assert.ok(['EPERM','EBUSY','EACCES'].includes(locked?.code),'fixture must reproduce the Windows directory lock');
    await updatePortable(f.options);
    assert.equal(holder.exitCode,null);
    assert.equal(readFileSync(join(f.root,'scripts/nested/start.ps1'),'utf8'),'new start');
    assert.equal((await f.options.status()).serviceVersion,'1.7.5');
  }finally{holder.stdin.end();await closed;}
});

test('nested replacement and startup failures restore overwritten and obsolete files plus the receipt',async t=>{
  for(const failure of ['replace','start']){
    const f=scriptFixture(t);let failed=false;
    await assert.rejects(updatePortable({...f.options,move:(from,to)=>{
      if(failure==='replace'&&!failed&&from.includes('next')&&to===join(f.root,'scripts/nested/start.ps1')){failed=true;throw Error('locked script');}
      renameSync(from,to);
    },start:async lan=>{
      if(failure==='start'&&!failed){failed=true;throw Error('new server failed');}
      await f.options.start(lan);
    }}),/locked script|new server failed/);
    for(const [name,text] of Object.entries(f.previous))assert.equal(readFileSync(join(f.root,name),'utf8'),text);
    assert.equal(existsSync(join(f.root,'scripts/new/stop.ps1')),false);
    assert.equal((await f.options.status()).serviceVersion,'1.7.4');
    assert.equal((await f.options.status()).running,true);
    assert.ok(!f.events.includes('script'));
    assert.ok(!readdirSync(join(f.root,'.updates')).some(name=>name.startsWith('stage-')));
  }
});

test('nested local directory links are rejected before stopping or modifying either tree',async t=>{
  const f=fixture(t),external=join(f.base,'external');mkdirSync(external);mkdirSync(join(f.root,'scripts'));
  writeFileSync(join(external,'start.ps1'),'outside installation');
  symlinkSync(external,join(f.root,'scripts/nested'),process.platform==='win32'?'junction':'dir');
  writeFileSync(f.source,archive('1.7.5',{'scripts/nested/start.ps1':'new start'}));
  await assert.rejects(updatePortable(f.options),/路径包含链接/);
  assert.deepEqual(f.events,['prepare']);
  assert.equal(readFileSync(join(external,'start.ps1'),'utf8'),'outside installation');
  assert.equal((await f.options.status()).running,true);
});
test('same version skips replacement but continues script installation; older packages never overwrite',async t=>{
  const {source,options,events}=fixture(t);writeFileSync(source,archive('1.7.4'));
  await updatePortable(options);assert.deepEqual(events,['script']);events.length=0;
  writeFileSync(source,archive('1.7.3'));
  await assert.rejects(updatePortable(options),/拒绝降级/);assert.deepEqual(events,[]);
});
test('headless updates preserve credentials and refuse packages lacking the independent backend before stopping PG',async t=>{
  const {root,source,options,events}=fixture(t);
  mkdirSync(join(root,'.headless'));writeFileSync(join(root,'.headless','private-test.txt'),'test-only credentials');
  const status=async()=>({...await options.status(),executionBackend:'headless'});
  await assert.rejects(updatePortable({...options,status}),/不包含独立后端/);assert.deepEqual(events,[]);
  writeFileSync(source,archive('1.7.5',{'src/server/headless-runtime.mjs':'// independent backend'}));
  await updatePortable({...options,status});
  assert.deepEqual(events,['prepare','stop','start-lan','script']);
  assert.equal(readFileSync(join(root,'.headless','private-test.txt'),'utf8'),'test-only credentials');
});
test('busy generation, source checkout and failed preparation leave the original service intact',async t=>{
  const {root,options,events}=fixture(t);
  await assert.rejects(updatePortable({...options,status:async()=>({pending:1})}),/仍有生成/);
  mkdirSync(join(root,'.git'));
  await assert.rejects(updatePortable(options),/源码目录/);rmSync(join(root,'.git'),{recursive:true});
  await assert.rejects(updatePortable({...options,prepareApp:()=>{throw Error('build failed');}}),/build failed/);
  assert.deepEqual(events,[]);assert.equal(readFileSync(join(root,'README.md'),'utf8'),'old readme');
});
test('a partially completed shutdown restores the original service without replacing files',async t=>{
  const {root,options,events}=fixture(t);
  await assert.rejects(updatePortable({...options,stop:async()=>{await options.stop();throw Error('manager worker busy');}}),/manager worker busy/);
  assert.deepEqual(events,['prepare','stop','start-lan']);
  assert.equal(readFileSync(join(root,'README.md'),'utf8'),'old readme');
  assert.equal((await options.status()).running,true);
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
test('source updates work with the API unavailable, identify the downloaded commit and reuse only identical commits',async t=>{
  const {root,options,events}=fixture(t),requests=[];let revision='a'.repeat(40);
  const fetchImpl=async url=>{
    requests.push(url);
    const target=new URL(url),allowed=target.origin+target.pathname===SOURCE_ARCHIVE_URL;
    const zip=archive('1.7.4',{'':'','downloads/old.zip':'archive','config.json':'must not replace user config'},'MMDB-PG-main/',revision);
    const response=allowed?new Response(zip):new Response('API rate limit exceeded',{status:403});
    Object.defineProperty(response,'url',{value:url});return response;
  };
  await updatePortable({...options,source:'source',fetchImpl});
  assert.equal(requests.length,1);assert.ok(requests[0].startsWith(SOURCE_ARCHIVE_URL+'?_mmdb='));
  assert.deepEqual(events,['prepare','stop','start-lan','script']);
  assert.equal(JSON.parse(readFileSync(join(root,SOURCE_RECEIPT))).commit,revision);
  assert.equal(readFileSync(join(root,'config.json'),'utf8'),'private config');
  assert.equal(existsSync(join(root,'downloads')),false);
  events.length=0;requests.length=0;
  await updatePortable({...options,source:'source',fetchImpl});
  assert.deepEqual(events,['script']);assert.equal(requests.length,1);
  revision='b'.repeat(40);events.length=0;
  await updatePortable({...options,source:'source',fetchImpl});
  assert.deepEqual(events,['prepare','stop','start-lan','script']);
  assert.equal(JSON.parse(readFileSync(join(root,SOURCE_RECEIPT))).commit,revision);
  assert.ok(requests.every(url=>url.startsWith(SOURCE_ARCHIVE_URL+'?')));
});
test('branch snapshots require a valid commit comment and matching prefix, while pinned archives remain compatible',async t=>{
  const {base}=fixture(t),revision='b'.repeat(40);
  assert.throws(()=>unpackRelease(archive(),join(base,'wrong'),{revision}),/不安全/);
  unpackRelease(archive('1.7.4',{},`MMDB-PG-${revision}/`),join(base,'pinned'),{revision});
  for(const comment of ['',revision+'\n','not-a-commit']){
    const response=new Response(archive('1.7.4',{},'MMDB-PG-main/',comment));
    Object.defineProperty(response,'url',{value:SOURCE_ARCHIVE_URL});
    await assert.rejects(resolveSource(async()=>response),/提交标识/);
  }
  assert.throws(()=>unpackRelease(archive('1.7.4',{},'MMDB-PG-main/','a'.repeat(40)),join(base,'mismatch'),{revision,branch:true}),/不一致/);
  assert.throws(()=>unpackRelease(archive('1.7.4',{},'Other-main/',revision),join(base,'prefix'),{revision,branch:true}),/不安全/);
});
test('source download errors and malformed commit comments do not stop or replace the existing app',async t=>{
  const {root,options,events}=fixture(t);
  for(const response of [new Response('forbidden',{status:403}),new Response(archive('1.7.5',{},'MMDB-PG-main/'))]){
    Object.defineProperty(response,'url',{value:SOURCE_ARCHIVE_URL});
    await assert.rejects(updatePortable({...options,source:'source',fetchImpl:async()=>response}),/HTTP 403|提交标识/);
    assert.deepEqual(events,[]);
    assert.equal(readFileSync(join(root,'config.json'),'utf8'),'private config');
    assert.equal(JSON.parse(readFileSync(join(root,'package.json'))).version,'1.7.4');
  }
});
