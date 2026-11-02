import {openManagerPage} from './src/browser-opener.mjs';
import {runtimeRoot,runtimeAdmin,readRuntimeSettings} from './src/headless-runtime.mjs';
import {createAccountPool} from './src/headless-pool.mjs';
const action=process.argv[2]??'open';
try {
  if(Number(process.versions.node.split('.')[0])<22)throw Error('需要 Node.js 22 或更新版本');
  if(action==='install'){
    const {installRuntime}=await import('./src/install.mjs');const result=await installRuntime();console.log(`运行时 ${result.version} 已准备好，运行 npm start 打开控制台。`);
  }else if(action==='open'||action==='url'){
    const {installRuntime}=await import('./src/install.mjs');await installRuntime();
    const {ensureManager}=await import('./src/portal.mjs');const panel=await ensureManager();
    if(action==='url')console.log(panel.url);
    else {
      console.log('独立控制台已就绪，正在打开默认浏览器…');
      try{await openManagerPage(panel.url);console.log('已请求默认浏览器打开控制台。如果没有看到页面，可复制下方地址打开。');}
      finally{console.log(`\n本机管理地址（仅供本机使用）：\n${panel.url}\n\n关闭此窗口或管理页后，后台继续运行。`);}
    }
  }else if(action==='status')console.log(JSON.stringify(await createAccountPool({root:runtimeRoot(),admin:runtimeAdmin(readRuntimeSettings())}).summary(),null,2));
  else throw Error('用法：node cli.mjs <open|url|status|install>');
}catch(error){console.error(error.message);process.exitCode=1;}
