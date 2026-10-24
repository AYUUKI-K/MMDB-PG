import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const importLine = "import {isMMDBJSONResponse,forwardMMDBJSON} from '../../mmdb-json-keepalive.mjs';\n";
const anchor = "        console.debug('Chat Completion request:', requestBody);";
const insertion = '\n        // MMDB JSON keepalive: preserve transport bytes through non-stream buffering.\n'
  + '        if (request.body.chat_completion_source === CHAT_COMPLETION_SOURCES.CUSTOM && isMMDBJSONResponse(fetchResponse, requestBody)) {\n'
  + '            return await forwardMMDBJSON(fetchResponse, response, controller.signal);\n'
  + '        }\n';

export function installSTKeepAlive(directory) {
  const root=resolve(directory),target=resolve(root,'src/endpoints/backends/chat-completions.js');
  const helper=resolve(root,'src/mmdb-json-keepalive.mjs');
  const source=readFileSync(target,'utf8'),newline=source.includes('\r\n')?'\r\n':'\n';
  let text=source.replaceAll('\r\n','\n');
  const content=readFileSync(new URL('./st-json-keepalive.mjs',import.meta.url),'utf8');
  if(existsSync(helper)&&readFileSync(helper,'utf8')!==content)throw Error('已有不同内容的 MMDB 兼容文件，未覆盖。');
  const count=(value,part)=>value.split(part).length-1;
  if(text.includes(importLine)||text.includes(insertion)){
    if(count(text,importLine)!==1||count(text,insertion)!==1)throw Error('已有不完整或重复的 MMDB 补丁，未修改。');
    writeFileSync(helper,content);return 'already-installed';
  }
  if(count(text,anchor)!==1)throw Error('酒馆版本不匹配：无法唯一定位自定义生成入口，未修改。');
  const from=text.indexOf(anchor);
  const fetchLine='        const fetchResponse = await fetch(endpointUrl, config);';
  const position=text.indexOf(fetchLine,from);
  const next=text.indexOf('        if (request.body.stream)',position);
  if(position<0||next<0||next-position>300)throw Error('酒馆生成结构不匹配，未修改。');
  // Insert after fetch, before either buffering or the normal streaming branch.
  text=importLine+text.slice(0,position+fetchLine.length)+'\n'+insertion+text.slice(position+fetchLine.length);
  writeFileSync(helper,content);
  writeFileSync(target,text.replaceAll('\n',newline));
  return 'installed';
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  if(process.argv.length!==3)throw Error('用法：node tools/install-st-keepalive.mjs "酒馆目录"');
  console.log(installSTKeepAlive(process.argv[2]));
  console.log('重启酒馆后生效。仅处理有 MMDB 标记的 pg- 非流式响应，不改聊天配置。');
}
