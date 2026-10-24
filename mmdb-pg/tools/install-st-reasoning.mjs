// MIT License — MMDB contributors. Offline, targeted SillyTavern compatibility fix.
import {readFileSync,writeFileSync,copyFileSync,existsSync,constants,renameSync,unlinkSync,realpathSync} from 'node:fs';
import {createInterface} from 'node:readline/promises';
import {homedir} from 'node:os';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';

const original='if (OPENAI_REASONING_EFFORT_MODELS.includes(request.body.model)) {';
const replacement='if (OPENAI_REASONING_EFFORT_MODELS.includes(request.body.model) || (request.body.chat_completion_source === CHAT_COMPLETION_SOURCES.CUSTOM && /^pg-gemini-[a-zA-Z0-9._-]+(?:-抗截断)?$/.test(request.body.model))) {';
const marker='// MMDB PG reasoning: forward the selected effort for pg-gemini models only.';
const assignment="bodyParams['reasoning_effort'] = OPENAI_FIXED_REASONING_EFFORT[request.body.model] ?? OPENAI_REASONING_EFFORT_MAP[request.body.reasoning_effort] ?? request.body.reasoning_effort;";
const count=(text,part)=>text.split(part).length-1;

export function patchSource(source) {
  const newline=source.includes('\r\n')?'\r\n':'\n';
  let text=source.replaceAll('\r\n','\n');
  const installed=text.includes(marker)||text.includes(replacement);
  const condition=installed?replacement:original;
  if(installed&&(count(text,marker)!==1||count(text,replacement)!==1||count(text,original)!==0))throw Error('已有不完整或重复的推理强度补丁，未修改。');
  if(count(text,condition)!==1)throw Error('酒馆版本结构不匹配，未修改。');
  const at=text.indexOf(condition);
  const before=text.slice(Math.max(0,at-450),at);
  if(!before.includes('if (request.body.reasoning_effort && [CHAT_COMPLETION_SOURCES.CUSTOM, CHAT_COMPLETION_SOURCES.OPENAI].includes(request.body.chat_completion_source))')||!text.slice(at,at+condition.length+350).includes(assignment))throw Error('无法确认酒馆推理参数入口，未修改。');
  if(installed)return {source,changed:false};
  text=text.slice(0,at)+marker+'\n            '+replacement+text.slice(at+original.length);
  return {source:text.replaceAll('\n',newline),changed:true};
}

export function install(directory) {
  const root=resolve(directory),target=resolve(root,'src/endpoints/backends/chat-completions.js');
  if(!existsSync(target))throw Error('没有找到酒馆源码，请指定 SillyTavern 根目录。');
  const before=readFileSync(target,'utf8'),result=patchSource(before);
  if(!result.changed)return 'already-installed';
  // Parse only: no SillyTavern startup, imports, network or generation calls.
  const checked=spawnSync(process.execPath,['--input-type=module','--check'],{input:result.source,encoding:'utf8'});
  if(checked.status!==0)throw Error('补丁后的语法检查失败，未修改酒馆文件。');
  const backup=target+'.mmdb-reasoning.bak';
  if(existsSync(backup)&&readFileSync(backup,'utf8')!==before)throw Error('已有另一份备份，未覆盖。请先妥善保存 '+backup);
  if(!existsSync(backup))copyFileSync(target,backup,constants.COPYFILE_EXCL);
  const temporary=target+'.mmdb-reasoning.tmp';
  if(existsSync(temporary))throw Error('已有补丁临时文件，未覆盖。');
  try{writeFileSync(temporary,result.source,{encoding:'utf8',flag:'wx'});renameSync(temporary,target);}
  catch(error){if(existsSync(temporary))unlinkSync(temporary);throw error;}
  return 'installed';
}

// Android /sdcard is an alias of /storage/emulated/0. Match canonical paths.
if(process.argv[1]&&existsSync(process.argv[1])&&import.meta.url===pathToFileURL(realpathSync(process.argv[1])).href){
  try{
    let directory=process.argv[2];
    if(process.argv.length>3)throw Error('用法：node tools/install-st-reasoning.mjs "酒馆根目录"');
    if(!directory&&process.stdin.isTTY){
      const cli=createInterface({input:process.stdin,output:process.stdout});
      try{directory=(await cli.question('酒馆根目录（回车使用 ~/SillyTavern）：')).trim()||resolve(homedir(),'SillyTavern');}
      finally{cli.close();}
    }
    if(!directory)throw Error('用法：node tools/install-st-reasoning.mjs "酒馆根目录"');
    const result=install(directory);
    console.log(result==='installed'?'补丁已写入：重启酒馆并通过本机检查后，才能确认转发生效。':'补丁已安装，无需重复修改。');
    console.log('重启酒馆后生效。选“极高”时，4A 使用支持的最高档 high。');
    console.log('此补丁不修改角色卡、预设、聊天、密钥或其他提供商。酒馆升级覆盖源码后需重新安装。');
  }catch(error){console.error(error.message);process.exitCode=1;}
}
