import {readFileSync,writeFileSync} from 'node:fs';
import {MMDB_VERSION} from './src/version.js';
const base=new URL('.',import.meta.url);
const modules=['version.js','panel.js','session.js','recovery.js','executor.js','bootstrap.js'].map(name=>readFileSync(new URL('src/'+name,base),'utf8').replace(/^export /gm,''));
const header=`// ==UserScript==
// @name         MMDB 本地桥
// @namespace    mmdb.local.bridge
// @version      ${MMDB_VERSION}
// @updateURL    http://127.0.0.1:__LOCAL_PG_PORT__/local-pg.meta.js
// @downloadURL  http://127.0.0.1:__LOCAL_PG_PORT__/local-pg.user.js
// @description  连接个人本地后端与 AI Studio，支持文本流式生成和状态诊断。
// @author       MMDB contributors
// @license      MIT
// @match        https://aistudio.google.com/*
// @run-at       document-start
// @grant        unsafeWindow
// @grant        GM_getValue
// @grant        GM_setValue
// @noframes
// ==/UserScript==
`;
writeFileSync(new URL('local-pg.user.js',base),header+'\n(function(){\n"use strict";\n'+modules.join('\n')+'\nbootBridge(()=>startMMDB({port:"__LOCAL_PG_PORT__",key:"__LOCAL_PG_KEY__"}));\n})();\n');
const panel=readFileSync(new URL('src/panel.js',base),'utf8');
writeFileSync(new URL('preview.html',base),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="require-trusted-types-for 'script'"><meta name="viewport" content="width=device-width,initial-scale=1"><title>喵喵电波 · 界面预览</title><style>body{margin:0;background:#fff3f9;color:#3b2533;font:16px/1.7 system-ui,sans-serif;padding:6vw;box-sizing:border-box}main{max-width:740px}h1{font-size:clamp(36px,6vw,72px);line-height:1.1;letter-spacing:-2px;margin:16px 0 24px}p{max-width:490px;color:#795a6b}.kicker{font:12px monospace;letter-spacing:3px}button{padding:12px 20px;border-radius:30px;background:#a7356c;border:0;color:white;font:inherit;cursor:pointer}svg.art{width:min(60vw,500px);opacity:.8;margin-top:36px}@media(max-width:600px){main{padding-bottom:500px}h1{max-width:280px}}</style><main><span class="kicker">面板预览</span><h1>喵喵电波。<br>轻轻连接。</h1><p>一个留在自己设备上的轻量连接器。独立界面，清晰状态，电脑与安卓使用同一套源码。</p><p>右下角是可操作的界面预览，连接状态均为演示数据，不会调用 Google 或修改正在运行的后端。</p><button id="simulate">预览生成状态</button><svg class="art" viewBox="0 0 500 160" fill="none" aria-hidden="true"><path d="M30 100H160Q200 100 200 60V30Q200 10 230 10H270Q300 10 300 40V120Q300 150 330 150H470" stroke="#a7356c" stroke-width="2"/><circle cx="30" cy="100" r="8" fill="#a7356c"/><circle cx="470" cy="150" r="8" fill="#a7356c"/><path d="M30 120H130Q180 120 180 80V30Q180 0 230 0" stroke="#d9a6bd" stroke-dasharray="5 6"/></svg></main><script type="module">const MMDB_VERSION=${JSON.stringify(MMDB_VERSION)};${panel}\nlet active=false;const ui=mountBridgePanel({reconnect:()=>ui.addEvent('预览：重新连接'),saveKey:()=>ui.addEvent('预览：设置不会被保存'),toggleWake:()=>ui.addEvent('预览：常亮功能需在真实页面启用')},{demo:true,link:'connected',session:true,completed:12,elapsed:28,model:'pg-gemini-3.8-flash',apiKey:'mmdb'});ui.addEvent('已连接本地服务');ui.addEvent('Google 会话已就绪');document.getElementById('simulate').onclick=()=>{active=!active;ui.update({busy:active,elapsed:active?7:28});ui.addEvent(active?'预览：电波正在发送':'演示生成结束');};</script></html>`);
console.log('Built MMDB userscript and preview.');
