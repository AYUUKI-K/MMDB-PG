import {readFileSync,statSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {runtimeRoot,readRuntimeSettings,runtimeAdmin,ensureRuntime,setExecutionBackend} from '../src/server/headless-runtime.mjs';
import {installRuntime} from './headless-install.mjs';
import {readConfig} from '../src/server/config.mjs';
import {probeRuntime} from '../src/server/headless-operations.mjs';
import {createCredentialImporter} from '../src/server/headless-credentials.mjs';
import {createAccountPool} from '../src/server/headless-pool.mjs';
const mask=value=>String(value??'').replace(/^(.).*(@.*)$/,'$1***$2');
export async function main(args=process.argv.slice(2)){
  const [action,...rest]=args,root=runtimeRoot();
  if(action==='install'){const result=await installRuntime(root);console.log(`独立运行时 ${result.version} ${result.installed?'安装完成':'已安装'}。下一步：npm run headless -- manage`);return;}
  if(action==='enable'||action==='disable'){readConfig();if(action==='enable')readRuntimeSettings(root);setExecutionBackend(action==='enable'?'headless':'browser');console.log(`已选择${action==='enable'?'独立运行时':'浏览器'}后端，重启 PG 后生效。`);return;}
  if(action==='start'){const {admin}=await ensureRuntime(root);console.log(JSON.stringify(await admin('/api/status')));return;}
  if(action==='manage-url'){const {ensureManager}=await import('./headless-portal.mjs');console.log((await ensureManager(root)).url);return;}
  if(action==='manage'){const {createHeadlessManager}=await import('../src/server/headless-manager.mjs');const {createBrowserCapture,loadCaptureIdentity}=await import('../src/server/headless-browser-capture.mjs');const {admin,settings}=await ensureRuntime(root);const pool=createAccountPool({root,admin,recover:()=>ensureRuntime(root)}),importer=createCredentialImporter({root,admin});const panel=await createHeadlessManager({admin,settings,pool,capture:createBrowserCapture({identity:loadCaptureIdentity(root)}),importAccount:(...args)=>pool.exclusive(()=>importer(...args))});console.log(`本地账号管理：${panel.url}\n保留此终端；Ctrl+C 关闭管理页服务。`);for(const signal of ['SIGINT','SIGTERM'])process.once(signal,panel.close);return;}
  const settings=readRuntimeSettings(root),admin=runtimeAdmin(settings),pool=createAccountPool({root,admin,recover:()=>ensureRuntime(root)});
  if(action==='status'){console.log(JSON.stringify(await pool.summary(),null,2));return;}
  if(action==='stop'){await pool.control(false);console.log('已手动停止生成服务；自动恢复不会拉起它。');return;}
  if(action==='run'){await pool.control(true);console.log('生成服务启动请求已提交，可用 status 检查。');return;}
  if(action==='list'){const result=await pool.summary({privateView:true});console.log(JSON.stringify((result.accounts??[]).map(row=>({...row,id:undefined,label:undefined,account:mask(row.id)})),null,2));return;}
  if(action==='strategy'){await pool.configure({strategy:rest[0]});console.log('账号池策略已保存。');return;}
  if(action==='backend'){await pool.backend(rest[0]);console.log('会话验证后端已更新。');return;}
  if(action==='login'){await pool.login(rest[0]);console.log('账号登录已保存，请在管理页启用。');return;}
  if(action==='recover'){await pool.recoverOnce({force:true});console.log('运行时恢复检查已完成。');return;}
  if(action==='import'){
    const [file,slot='0']=rest;if(!file)throw Error('用法：npm run headless -- import <Cookie 或 storage-state 文件路径> [账号序号]');
    if(statSync(file).size>900*1024)throw Error('凭证文件过大');
    const importer=createCredentialImporter({root,admin});await pool.exclusive(()=>importer(readFileSync(file,'utf8'),{authUser:Number(slot)}));console.log('凭证已在本机保存，请在管理页启用新账号。');return;
  }
  if(action==='probe'){const logicalId='cli-probe-'+process.pid,lease=await pool.lease({model:rest[0],logicalId});try{const result=await probeRuntime(settings,rest[0]);lease.verified?.();console.log(JSON.stringify(result,null,2));}catch(error){await lease.failure(error);throw error;}finally{lease.release();await pool.finish(logicalId);}return;}
  throw Error('用法：npm run headless -- <install|manage|manage-url|start|status|list|import 文件 [账号序号]|run|probe 模型|enable|disable|stop|strategy fill-first或round-robin|backend spidermonkey或camoufox|login [账号ID]|recover>');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error(error?.message??'独立运行时操作失败');process.exitCode=1;});
