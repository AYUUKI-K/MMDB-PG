// Recovery entry for old menus that cannot get past their own PID check.
// Only archive a receipt after binding the configured loopback port succeeds.
import {existsSync,readFileSync,mkdirSync,renameSync,realpathSync,lstatSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:net';
import {randomUUID} from 'node:crypto';

const defaultRoot=fileURLToPath(new URL('../',import.meta.url));
const json=file=>JSON.parse(readFileSync(file,'utf8').replace(/^\uFEFF/,''));
export async function repairUpdate({root=defaultRoot,env=process.env}={}){
  root=realpathSync(root);
  if(json(join(root,'package.json')).name!=='mmdb-pg')throw Error('请将补丁解压到原 MMDB.cmd 所在目录，再运行修复。');
  if(existsSync(join(root,'.manager.lock')))throw Error('仍有菜单操作或遗留的 .manager.lock；请先退出所有 MMDB 菜单并确认没有更新进行中。');
  const receipt=join(root,'runtime.pid');
  if(!existsSync(receipt))return {repaired:false};
  if(!lstatSync(receipt).isFile()||lstatSync(receipt).isSymbolicLink())throw Error('runtime.pid 不是普通文件，未修改。');
  const config=existsSync(join(root,'config.json'))?json(join(root,'config.json')):{};
  const port=Number(env.MMDB_PORT||config.port||8765);
  if(!Number.isInteger(port)||port<1||port>65535)throw Error('本机端口配置无效，未修改运行记录。');
  const original=readFileSync(receipt);
  const listener=createServer();
  await new Promise((resolveReady,reject)=>{
    listener.once('error',cause=>reject(Error(cause.code==='EADDRINUSE'
      ?`本机端口 ${port} 仍被占用，未修改运行记录。请结束生成并从原启动窗口停止后台，再运行修复。`
      :`无法检查本机端口 ${port}（${cause.code}），未修改运行记录。`,{cause})));
    listener.listen(port,'127.0.0.1',resolveReady);
  });
  try{
    // Hold the port during the move so a relay cannot publish a new receipt.
    if(existsSync(join(root,'.manager.lock'))||!readFileSync(receipt).equals(original))throw Error('运行状态已变化，未修改运行记录；请退出所有菜单后重试。');
    const backups=join(root,'.updates');
    if(existsSync(backups)&&(!lstatSync(backups).isDirectory()||lstatSync(backups).isSymbolicLink()))throw Error('.updates 不是普通目录，未修改运行记录。');
    mkdirSync(backups,{recursive:true});
    const backup=join(backups,`runtime-pid-${randomUUID()}.txt`);
    renameSync(receipt,backup);
    return {repaired:true,port,backup};
  }finally{await new Promise(resolveClosed=>listener.close(resolveClosed));}
}
if(process.argv[1]&&resolve(process.argv[1]).toLowerCase()===resolve(fileURLToPath(import.meta.url)).toLowerCase()){
  repairUpdate().then(result=>{
    console.log(result.repaired?`本机端口 ${result.port} 空闲，旧进程记录已备份到：${result.backup}`:'没有遗留的进程记录。');
    console.log('未结束任何进程；配置和凭证保留。现在重新打开 MMDB.cmd，选择 2 更新全部。');
  }).catch(error=>{console.error(`修复未完成：${error.message}`);process.exitCode=1;});
}
