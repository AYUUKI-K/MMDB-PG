import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {MMDB_VERSION} from '../src/shared/version.js';
import {panelPreview} from './panel-preview.mjs';
const base=new URL('../',import.meta.url);
const output=new URL('dist/',base);
const manifest=JSON.parse(readFileSync(new URL('package.json',base),'utf8'));
if(manifest.version!==MMDB_VERSION)throw Error('package.json and src/shared/version.js must have the same version');
mkdirSync(output,{recursive:true});
const modules=['shared/version.js','browser/tavern-theme.js','browser/panel-window.js','browser/panel.js','browser/session.js','browser/recovery.js','browser/executor.js','browser/bootstrap.js'].map(name=>readFileSync(new URL('src/'+name,base),'utf8').replace(/^import .* from ['"].+['"];?\r?$/gm,'').replace(/^export /gm,''));
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
// @match        http://127.0.0.1/*
// @match        http://localhost/*
// @match        https://127.0.0.1/*
// @match        https://localhost/*
// @include      /^https?:\\/\\/(?:192\\.168\\.\\d{1,3}\\.\\d{1,3}|10\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}|172\\.(?:1[6-9]|2\\d|3[01])\\.\\d{1,3}\\.\\d{1,3})(?::\\d+)?\\//
// @run-at       document-start
// @grant        unsafeWindow
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// @noframes
// ==/UserScript==
`;
writeFileSync(new URL('local-pg.user.js',output),header+'\n(function(){\n"use strict";\n'+modules.join('\n')+'\nif(location.hostname==="aistudio.google.com")bootBridge(()=>startMMDB({port:"__LOCAL_PG_PORT__",key:"__LOCAL_PG_KEY__"}));else startTavernThemeSync();\n})();\n');
const panel=readFileSync(new URL('src/browser/panel.js',base),'utf8');
const floating=readFileSync(new URL('src/browser/panel-window.js',base),'utf8');
const theme=readFileSync(new URL('src/browser/tavern-theme.js',base),'utf8');
writeFileSync(new URL('preview.html',output),panelPreview(MMDB_VERSION,panel,floating,theme));
console.log('Built MMDB userscript and preview.');
