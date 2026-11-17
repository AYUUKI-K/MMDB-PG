import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createManager,menuStatus} from './portable-manager.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const colors={title:'225;195;154',key:'159;193;202',ink:'229;226;219',muted:'149;155;162',good:'166;196;168',line:'70;75;82'};
const colored=(process.stdout.isTTY||process.env.MEOW_MENU_COLOR==='1')&&!('NO_COLOR'in process.env)&&process.env.TERM!=='dumb';
const esc=String.fromCharCode(27);
const paint=(key,value)=>colored?`${esc}[38;2;${colors[key]}m${value}${esc}[0m`:value;
const row=(key,label)=>console.log('   '+paint('key',key)+'  '+paint('ink',label));
export function releaseNotes(){console.log(`MEOW-FM · 2.0.8

• 更多 → 8 新增“备用安装网页脚本”；菜单 2 和 3 继续使用原安装流程。
• 油猴官网中转页卡住时，备用方式先准备并校验脚本，再显示从油猴内部安装的步骤。
• Windows 尝试自动复制地址；复制失败仍可手动复制。步骤附 Dashboard、Utilities 和 Install / Import from URL 英文对照。

2.0.7：

• 修复网页脚本启动提示 EXPERIMENT_DEFAULTS is not defined。
• 修复面板预览缺少共享设置；补充打包产物的启动检查。
• 更新后在油猴确认新版 MMDB 本地桥，再刷新 AI Studio；也可选 3 重新安装网页脚本。

2.0.6：

• 输入读取范围默认改为最后一组连续用户消息，工具读取输入仍由原开关控制。
• 抗截断完整交付默认开启，全部续写正常完成后才交付正文。
• 已保存的明确选择保留；可在“输入与结果封装”中改回最后一条或逐帧交付。

2.0.5：

• 普通模型新增自动／必须工具的结果封装，完整校验后交付，保留原任务格式。
• 抗截断可选全部续写完成后交付；输入可合并读取最后一组连续用户消息。
• 新设置默认保持原行为，在面板“输入与结果封装”开启；独立模式可用配置或设置接口。
• 必须工具仍采用提示要求和返回校验，外部工具请求继续旁路。

2.0.4：

• 默认模型加入 Gemini 4 Hydrogen 与抗截断入口；旧默认配置自动补齐，自定义模型列表保留。
• 主菜单按网页模式常用流程重排，脚本安装和连接地址更容易找到。
• 独立模式切换与账号管理合并；连接页补充手机 LAN 用法和故障重试提示。

2.0.3：

• 修复 Windows 进程查询受限时被旧运行记录阻塞的问题。
• 旧菜单已提示“无法确认进程状态”时，先应用修复补丁并运行 Repair-Update.cmd，再选 2。
• 修复入口仅在本机端口空闲时备份旧记录，配置和凭证保留。
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
    for(const [i,label]of ['独立模式与账号管理','查看日志','重启后台','停止后台','启动与守护设置','修复与依赖','更新说明','备用安装网页脚本'].entries())row(String(i+1),label);
  }else{
    try{const info=await manager.status(),summary=menuStatus(info);console.log('  '+paint(summary.ready?'good':'muted',summary.text.replaceAll('\n','\n  ')));}
    catch{console.log('  '+paint('muted','状态暂不可读 · 选 4 检查连接'));}
    console.log('');for(const [i,label]of ['启动 / 继续使用','更新全部','安装 / 更新网页脚本','连接地址与使用说明','更多'].entries())row(String(i+1),label);
  }
  console.log('');row('0',mode==='more'?'返回':'退出');console.log('  '+paint('line','────────────────────────────────'));
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])main().catch(error=>{console.error('菜单显示失败：'+error.message);process.exitCode=1;});
