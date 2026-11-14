import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createManager,menuStatus} from './portable-manager.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const colors={title:'225;195;154',key:'159;193;202',ink:'229;226;219',muted:'149;155;162',good:'166;196;168',line:'70;75;82'};
const colored=(process.stdout.isTTY||process.env.MEOW_MENU_COLOR==='1')&&!('NO_COLOR'in process.env)&&process.env.TERM!=='dumb';
const esc=String.fromCharCode(27);
const paint=(key,value)=>colored?`${esc}[38;2;${colors[key]}m${value}${esc}[0m`:value;
const row=(key,label)=>console.log('   '+paint('key',key)+'  '+paint('ink',label));
export function releaseNotes(){console.log(`MEOW-FM · 2.0.2

• 普通模型默认等待 180 秒，抗截断首个有效正文默认等待 1000 秒。
• 修正不完整网段误放行，以及超大超时数值导致立即超时的问题。
• 保留 Windows 更新占用目录时的逐文件备份与失败回滚。
• 旧版卡在目录改名失败时，可先应用仓库下载页的更新器修复补丁，再选 2。
• 一次启动同时提供本机和同 Wi-Fi 手机入口，无需切换。
• 保留本机 8765、手机 8766；两边默认密钥均为 mmdb。
• 终端菜单精简为五项，更多功能按 1–8 连续编号。
• 新增完整账号导入教程，整理账号管理页和手机排版。
• 局域网启动失败时保留本机服务，可重试手机入口。
• 保留已有配置、账号凭证和生成行为。

旧安装保留自定义超时；调整方法见 docs/USAGE.md。
升级后请重新打开菜单。网页模式还需在油猴确认脚本更新，并刷新 AI Studio。
自定义密钥保持不变；本项目不附带外网地址或外网专用密钥。`);}
async function main(){
  const mode=process.argv[2]??'home';if(mode==='notes'){releaseNotes();return;}
  const manager=createManager({root});const version=JSON.parse(readFileSync(new URL('../package.json',import.meta.url))).version;
  console.log('\n  '+paint('title',`MEOW-FM · v${version}`));console.log('  '+paint('line','────────────────────────────────'));
  if(mode==='more'){
    for(const [i,label]of ['连接地址与状态','查看日志','重启后台','停止后台','安装 / 更新浏览器脚本','执行模式','启动与守护设置','修复与依赖'].entries())row(String(i+1),label);
  }else{
    try{const info=await manager.status(),summary=menuStatus(info);console.log('  '+paint(summary.ready?'good':'muted',summary.text.replaceAll('\n','\n  ')));}
    catch{console.log('  '+paint('muted','状态暂不可读 · 更多 → 连接地址与状态'));}
    console.log('');for(const [i,label]of ['启动 / 继续使用','更新全部','账号管理与教程','更多','更新说明'].entries())row(String(i+1),label);
  }
  console.log('');row('0',mode==='more'?'返回':'退出');console.log('  '+paint('line','────────────────────────────────'));
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])main().catch(error=>{console.error('菜单显示失败：'+error.message);process.exitCode=1;});
