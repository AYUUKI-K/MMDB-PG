import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {updatePortable} from '../tools/release-update.mjs';

function fixture(t) {
  const dir=mkdtempSync(join(tmpdir(),'MMDB Git 测试 '));
  t.after(()=>rmSync(dir,{recursive:true,force:true,maxRetries:4}));
  const env={...process.env,GIT_CONFIG_GLOBAL:join(dir,'test.gitconfig'),GIT_CONFIG_NOSYSTEM:'1'};
  const git=(cwd,...args)=>execFileSync('git',['-C',cwd,'-c','user.name=Updater Test','-c','user.email=test@example.invalid',...args],
    {env,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();
  const seed=join(dir,'source'),root=join(dir,'clone'),remote=join(dir,'remote.git');
  git(dir,'init','--bare','--initial-branch=stable',remote);
  git(dir,'init','--initial-branch=stable',seed);
  const manifest=version=>JSON.stringify({name:'mmdb-pg',version});
  mkdirSync(join(seed,'tools'));
  for(const path of ['package-lock.json','build.mjs','server.mjs','launch.mjs','tools/portable-manager.mjs'])writeFileSync(join(seed,path),'');
  writeFileSync(join(seed,'.gitignore'),'config.json\nnode_modules/\ndist/\n.updates/\n.manager.lock\n');
  writeFileSync(join(seed,'package.json'),manifest('1.0.0'));
  writeFileSync(join(seed,'README.md'),'old');
  git(seed,'add','.');git(seed,'commit','-m','first');git(seed,'remote','add','publish',remote);
  git(seed,'push','-u','publish','stable');
  git(dir,'clone','--origin','team',remote,root);
  writeFileSync(join(root,'config.json'),'local config');
  writeFileSync(join(seed,'package.json'),manifest('1.0.1'));
  writeFileSync(join(seed,'README.md'),'new');
  git(seed,'commit','-am','update');git(seed,'push');
  let live='1.0.0',running=true;
  const events=[];
  const options={root,env,
    status:async()=>({version:JSON.parse(readFileSync(join(root,'package.json'))).version,pending:0,running,mode:'lan',serviceVersion:live}),
    stop:async()=>{events.push('stop');running=false;},
    prepareApp:next=>{
      assert.equal(readFileSync(join(next,'README.md'),'utf8'),'new');
      events.push('build');mkdirSync(join(next,'dist'));writeFileSync(join(next,'dist','asset'),'fresh');
    },
    start:async lan=>{assert.equal(lan,true);events.push('start');live='1.0.1';running=true;},
    prepareScript:async()=>{events.push('script');return 'ready';},
  };
  return {git,root,seed,options,events,previous:git(root,'rev-parse','HEAD'),target:git(seed,'rev-parse','HEAD')};
}

test('menu update fast-forwards the configured upstream, installs built assets and skips a second restart',async t=>{
  const {root,git,options,events,target}=fixture(t);
  assert.equal(await updatePortable(options),'ready');
  assert.equal(git(root,'rev-parse','HEAD'),target);
  assert.equal(git(root,'branch','--show-current'),'stable');
  assert.equal(git(root,'status','--porcelain'),'');
  assert.equal(readFileSync(join(root,'dist','asset'),'utf8'),'fresh');
  assert.equal(readFileSync(join(root,'config.json'),'utf8'),'local config');
  await updatePortable(options);
  assert.deepEqual(events,['build','stop','start','script','script']);
});

test('dirty, staged and untracked files are reported before fetch; local commits and detached HEAD remain intact',async t=>{
  const {root,git,options,events,previous}=fixture(t);
  writeFileSync(join(root,'README.md'),'my edit');
  writeFileSync(join(root,'draft.md'),'my staged draft');git(root,'add','draft.md');
  writeFileSync(join(root,'笔记.txt'),'my note');
  await assert.rejects(updatePortable(options),error=>['本地改动','README.md','draft.md','笔记.txt'].every(part=>error.message.includes(part)));
  assert.equal(git(root,'rev-parse','team/stable'),previous);
  git(root,'add','.');git(root,'commit','-m','local edits');
  const local=git(root,'rev-parse','HEAD');
  await assert.rejects(updatePortable(options),/本地提交/);
  assert.equal(git(root,'rev-parse','HEAD'),local);
  git(root,'branch','--unset-upstream');
  await assert.rejects(updatePortable(options),/上游/);
  git(root,'switch','--detach',local);
  await assert.rejects(updatePortable(options),/分离 HEAD/);
  assert.deepEqual(events,[]);
});

test('build failure and edits made during preparation keep the running checkout intact',async t=>{
  const {root,git,options,events,previous}=fixture(t);
  await assert.rejects(updatePortable({...options,prepareApp:()=>{throw Error('build failed');}}),/build failed/);
  await assert.rejects(updatePortable({...options,prepareApp:()=>writeFileSync(join(root,'README.md'),'edited during build')}),/本地改动/);
  assert.equal(readFileSync(join(root,'README.md'),'utf8'),'edited during build');
  assert.equal(git(root,'rev-parse','HEAD'),previous);
  assert.deepEqual(events,[]);
});

test('fast-forward refuses an upstream file that collides with ignored local configuration',async t=>{
  const {root,seed,git,options,previous}=fixture(t);
  writeFileSync(join(seed,'config.json'),'upstream');
  git(seed,'add','-f','config.json');git(seed,'commit','-m','conflicting config');git(seed,'push');
  await assert.rejects(updatePortable(options),/冲突/);
  assert.equal(git(root,'rev-parse','HEAD'),previous);
  assert.equal(readFileSync(join(root,'config.json'),'utf8'),'local config');
});
