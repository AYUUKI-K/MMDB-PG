import {spawnSync} from 'node:child_process';
import {existsSync,realpathSync} from 'node:fs';
import {resolve} from 'node:path';

// Keep the fetched commit pinned while dependencies are built and PG is stopped.
// Git owns all tracked files (including deletions, permissions and .git metadata).
export function planGitUpdate(root, env) {
  function run(args, hint, {binary = false, optional = false} = {}) {
    const result = spawnSync('git', ['-C',root,...args], {
      env:{...env,GIT_TERMINAL_PROMPT:'0'}, windowsHide:true, timeout:120000,
      encoding:binary ? 'buffer' : 'utf8', maxBuffer:binary ? 50*1024*1024 : 4*1024*1024,
    });
    if (result.error?.code === 'ENOENT') throw Error('找不到 Git，请安装 Git 并重新打开菜单。');
    if (optional && !result.error && result.status === 1) return null;
    if (result.error || result.status !== 0) throw Error(hint);
    return binary ? result.stdout : result.stdout.trimEnd();
  }
  function clean() {
    const changes = run(['-c','core.quotePath=false','status','--porcelain=v1','--untracked-files=normal','--ignore-submodules=none'], '无法检查 Git 工作区，请运行 git status 查看状态。');
    if (changes) throw Error('检测到本地改动，更新已暂停。请先提交、暂存到 stash 或移走未跟踪文件，再选 2。\n'+changes);
    const operations = ['MERGE_HEAD','CHERRY_PICK_HEAD','REVERT_HEAD','rebase-merge','rebase-apply','sequencer','BISECT_START'];
    const paths = run(['rev-parse',...operations.flatMap(name=>['--git-path',name])], '无法检查 Git 操作状态。');
    if (paths.split(/\r?\n/).some(path=>existsSync(resolve(root,path)))) throw Error('Git 操作尚未结束，请先完成当前操作再选 2。');
  }
  const currentBranch = () => run(['symbolic-ref','--quiet','HEAD'], '当前是分离 HEAD，请先切换到要更新的分支。');
  const head = () => run(['rev-parse','--verify','HEAD^{commit}'], '无法读取当前 Git 提交。');
  const top = run(['rev-parse','--show-toplevel'], '无法识别安装目录的 Git 工作区。');
  if (realpathSync(top) !== root) throw Error('Git 工作区根目录与安装目录不一致。请在克隆的安装目录运行菜单。');
  clean();
  const branch = currentBranch(), previous = head();
  const tracking = run(['for-each-ref','--format=%(refname)%00%(upstream)%00%(upstream:remotename)%00%(upstream:remoteref)',branch], '无法读取当前分支的上游。')
    .split(/\r?\n/).map(row=>row.split('\0')).find(([name])=>name===branch);
  const [,upstream,remote,remoteRef] = tracking ?? [];
  if (!remote || !remoteRef?.startsWith('refs/heads/') || !upstream?.startsWith('refs/remotes/')) {
    throw Error('当前分支没有跟踪远程分支，请先设置 Git 上游再选 2。');
  }
  console.log(`正在检查 Git 上游 ${remote}/${remoteRef.slice(11)}…`);
  run(['fetch','--no-tags','--no-recurse-submodules','--',remote,`+${remoteRef}:${upstream}`], 'Git 获取上游失败，请检查网络、远程分支与 Git 访问权限。');
  const revision = run(['rev-parse','--verify',upstream+'^{commit}'], '无法读取上游提交。');
  if (run(['merge-base','--is-ancestor',previous,revision], '无法核对 Git 提交历史。', {optional:true}) === null) {
    throw Error('当前分支含上游没有的本地提交，无法快进到上游版本。请先处理分支差异再选 2。');
  }
  function verify() {
    clean();
    if (currentBranch() !== branch || head() !== previous) throw Error('更新期间 Git 分支或提交发生变化，请重新选 2。');
  }
  return {previous,revision,verify,
    archive:()=>run(['archive','--format=zip',`--prefix=MMDB-PG-${revision}/`,revision], '无法读取 Git 更新快照。', {binary:true}),
    advance() {
      verify();
      run(['merge','--ff-only','--no-autostash','--no-overwrite-ignore',revision], 'Git 快进失败，请运行 git status 并检查是否有文件与上游冲突。');
    },
  };
}
