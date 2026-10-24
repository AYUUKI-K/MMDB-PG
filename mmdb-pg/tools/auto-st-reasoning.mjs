import {existsSync,readFileSync,writeFileSync,realpathSync} from 'node:fs';
import {homedir} from 'node:os';
import {resolve,dirname,join,isAbsolute} from 'node:path';
import {createInterface} from 'node:readline/promises';
import {install} from './install-st-reasoning.mjs';

export function findSillyTaverns(relayRoot,home=homedir()){
  // Bounded, known locations only. Never scan drives or unrelated projects.
  const candidates=[join(home,'SillyTavern'),join(home,'GitHub','SillyTavern'),join(home,'Documents','GitHub','SillyTavern'),relayRoot];
  let parent=relayRoot;
  for(let i=0;i<3;i++){parent=dirname(parent);candidates.push(join(parent,'SillyTavern'));}
  return [...new Set(candidates.filter(isSillyTavern).map(p=>realpathSync(p)))];
}
function isSillyTavern(directory){
  try{return existsSync(join(directory,'server.js'))&&existsSync(join(directory,'src/endpoints/backends/chat-completions.js'))&&JSON.parse(readFileSync(join(directory,'package.json'),'utf8').replace(/^\uFEFF/,'')).name?.toLowerCase()==='sillytavern';}
  catch{return false;}
}
function selectedPath(value,home){
  const input=value.trim().replace(/^"(.*)"$/,'$1');
  if(input==='~')return home;
  return resolve(input.startsWith('~/')||input.startsWith('~\\')?join(home,input.slice(2)):input);
}
export async function autoInstallST({relayRoot,home=homedir(),env=process.env,interactive=!!(process.stdin.isTTY&&process.stdout.isTTY),ask,log=console.log}={}){
  const file=join(relayRoot,'st-path.json');
  let cli;
  const question=async text=>{
    if(ask)return ask(text);
    cli??=createInterface({input:process.stdin,output:process.stdout});
    return cli.question(text);
  };
  try{
    let saved;
    if(existsSync(file)){
      const value=JSON.parse(readFileSync(file,'utf8'));
      if(value.mode==='skip'&&!env.MMDB_ST_DIR){log('酒馆补丁：已选择跨设备／跳过。需要重新检测时删除 st-path.json。');return {status:'skipped'};}
      if(typeof value.directory==='string'&&isAbsolute(value.directory))saved=value.directory;
    }
    let directory=env.MMDB_ST_DIR||saved;
    if(directory&&!isSillyTavern(selectedPath(directory,home))){
      log('酒馆补丁：指定或保存的目录无效，请重新选择酒馆根目录。');
      if(!interactive)return {status:'invalid-path'};
      directory=undefined;
    }
    if(!directory){
      const found=findSillyTaverns(relayRoot,home);
      if(found.length===1)directory=found[0];
      else{
        log(found.length?'找到多份本机酒馆，请选择需要安装补丁的一份：':'未在常用位置找到本机酒馆。电脑反代连接手机酒馆时，请在手机上运行补丁。');
        found.forEach((p,i)=>log(`${i+1}. ${p}`));
        if(!interactive){log('反代继续启动。可用 MMDB_ST_DIR 指定路径，或运行 Fix-ST-Reasoning.cmd / bash fix-st-reasoning.sh。');return {status:'not-selected'};}
        const answer=(await question('输入酒馆根目录或上面的序号（直接回车：跳过并记住选择）：')).trim();
        if(!answer){writeFileSync(file,JSON.stringify({mode:'skip'},null,2)+'\n');return {status:'skipped'};}
        directory=/^[1-9]\d*$/.test(answer)?found[Number(answer)-1]:answer;
      }
    }
    if(!directory)throw Error('没有选择有效目录。');
    directory=selectedPath(directory,home);
    if(!isSillyTavern(directory))throw Error('该目录不是可识别的 SillyTavern 根目录。');
    directory=realpathSync(directory);
    const status=install(directory);
    try{writeFileSync(file,JSON.stringify({directory},null,2)+'\n');}catch{log('无法保存酒馆路径；本次补丁检查不受影响。');}
    log(status==='installed'?`酒馆推理强度补丁已自动安装：${directory}\n如果酒馆正在运行，请重启酒馆后生效。`:`酒馆推理强度补丁已存在，无需重复安装：${directory}`);
    return {status,directory};
  }catch(error){
    log(`酒馆补丁未完成：${error.message}\n反代继续运行；可稍后运行手动补丁。`);
    return {status:'failed'};
  }finally{cli?.close();}
}
