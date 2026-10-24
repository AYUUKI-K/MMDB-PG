// ==UserScript==
// @name         MMDB 本地桥
// @namespace    mmdb.local.bridge
// @version      1.2.13
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

(function(){
"use strict";
const MMDB_VERSION='1.2.13';

// MMDB interface, implemented for this project. No remote fonts or UI libraries.
function mountBridgePanel(actions, initial = {}) {
  const host = document.createElement('mmdb-local-bridge');
  const root = host.attachShadow({mode: 'open'});
  const cat = `<svg viewBox="0 0 40 40" fill="none" aria-hidden="true"><path d="M9 17 8 7l10 6a21 21 0 0 1 7 0l8-6-1 12c5 12-2 16-12 16S4 30 9 17Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M13 23h1m12 0h1m-9 5 2 2 2-2M5 25h5m20 0h5" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><path d="m19 5 2-2 2 2-2 3-2-3Z" fill="currentColor"/></svg>`;
  const markup = `<style>
    :host{--paper:#fffafd;--ink:#482c3e;--muted:#806075;--line:#efd9e5;--soft:#fff0f7;--brand:#a53670;--onbrand:#fff;--good:var(--brand);--warn:#87601e;--bad:#b33453;display:block;position:fixed;right:20px;bottom:20px;width:292px;max-width:calc(100% - 24px);font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--ink);z-index:2147483640;color-scheme:light;pointer-events:none;text-align:left}
    :host([theme=dark]){--paper:#20151e;--ink:#ffeaf5;--muted:#d4b5c9;--line:#573649;--soft:#32202d;--brand:#f3adcf;--onbrand:#351225;--warn:#edc68a;--bad:#ffafc0;color-scheme:dark}
    *{box-sizing:border-box}button,input{font:inherit}button{cursor:pointer;min-height:44px;border:1px solid var(--line);border-radius:14px;background:var(--paper);color:var(--ink);padding:10px 14px;touch-action:manipulation;transition:background .16s,transform .16s}button:hover{background:var(--soft)}button:active{transform:translateY(1px)}button:disabled{cursor:wait;opacity:.6}button:focus-visible,input:focus-visible,summary:focus-visible{outline:3px solid var(--brand);outline-offset:3px}[hidden]{display:none!important}
    article{pointer-events:auto;width:100%;max-height:calc(100dvh - 40px);border:1px solid var(--line);border-radius:25px;background:var(--paper);box-shadow:0 14px 44px #54213c26;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:var(--line) transparent}
    header{padding:10px 12px 8px;display:flex;align-items:center;gap:8px;background:linear-gradient(135deg,var(--soft),var(--paper));border-radius:24px 24px 0 0;touch-action:none;user-select:none;cursor:grab}.mark{width:36px;height:36px;display:grid;place-items:center;color:var(--brand);background:var(--paper);border:1px solid var(--line);border-radius:13px;flex-shrink:0}.mark svg{width:29px;height:29px}.brand{flex:1;min-width:0}.brand strong{font-size:15px;font-weight:750;letter-spacing:1px;display:block}.brand small{display:block;font-size:11px;color:var(--muted);letter-spacing:.5px;margin-top:1px}.icon{width:44px;flex-shrink:0;padding:0;display:grid;place-items:center}.quiet{background:transparent;border-color:transparent;font-size:23px;font-weight:400}
    main{padding:0 12px 12px}.statuses{display:flex;gap:7px;flex-wrap:wrap}.tag{border:1px solid var(--line);border-radius:20px;padding:4px 8px;font-size:11px;display:inline-flex;align-items:center;gap:6px;color:var(--muted);background:var(--paper)}.dot{width:6px;height:6px;border-radius:50%;background:var(--warn);flex-shrink:0}.tag[data-ok=true]{color:var(--good);background:var(--soft)}.tag[data-ok=true] .dot{background:var(--good)}
    .greeting{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:10px}.headline{font-size:18px;line-height:1.35;letter-spacing:-.5px;font-weight:720;margin:0}.spark{color:var(--brand);font-size:18px;font-weight:500;flex-shrink:0}.hint{font-size:12px;line-height:1.65;color:var(--muted);margin:5px 0 10px;min-height:20px}
    .metrics{display:grid;grid-template-columns:1fr 1fr;gap:9px}.metric{border:1px solid var(--line);background:var(--soft);border-radius:12px;padding:7px 9px;display:flex;align-items:baseline;gap:5px;flex-wrap:wrap}.metric span{font-size:11px;color:var(--muted)}.metric b{font-size:19px;font-weight:650;font-variant-numeric:tabular-nums;line-height:1.3}.metric em{font-size:11px;font-style:normal;color:var(--muted);margin-left:0}
    .model{font-size:11px;overflow-wrap:anywhere;color:var(--muted);margin:8px 1px 0;line-height:1.6}.model::before{content:'模型 / ';color:var(--brand)}.error{background:var(--soft);border:1px solid var(--line);border-left:3px solid var(--bad);padding:10px 12px;border-radius:12px;margin-top:10px;color:var(--bad);font-size:12px;overflow-wrap:anywhere}.error:empty{display:none}.row{display:flex;align-items:center;gap:8px}.buttons{margin-top:9px}.buttons button{min-width:0}.primary{flex:1;background:var(--brand);border-color:var(--brand);color:var(--onbrand);font-weight:600}.primary:hover{background:var(--brand);filter:brightness(.96)}
    .form{padding:12px;border-top:1px dashed var(--line);background:var(--soft)}label{font-size:12px;color:var(--muted);display:block;margin-bottom:6px}input{width:100%;min-width:0;min-height:44px;border:1px solid var(--line);border-radius:12px;padding:10px;background:var(--paper);color:var(--ink)}.field{margin-bottom:12px}.form p{font-size:12px;line-height:1.65;color:var(--muted);margin:10px 0 0}.form .row button{white-space:nowrap}
    details{border-top:1px dashed var(--line);padding:0 12px}summary{min-height:46px;display:flex;align-items:center;gap:8px;cursor:pointer;list-style:none;font-size:12px;color:var(--muted)}summary::-webkit-details-marker{display:none}summary span{margin-left:auto;font-variant-numeric:tabular-nums}summary::after{content:'＋';color:var(--brand);font-size:17px}details[open] summary::after{content:'−'}.events{list-style:none;margin:0;padding:0 0 12px;max-height:160px;overflow:auto}.events li{border-top:1px solid var(--line);padding:8px 0;font-size:12px;overflow-wrap:anywhere}.events time{font-size:11px;color:var(--muted);margin-right:8px}
    .sub{border-top:1px solid var(--line);padding:3px 9px;display:flex;align-items:center;justify-content:space-between;gap:4px;color:var(--muted);font-size:11px}.sub .row{gap:2px}.sub button{border:0;background:transparent;font-size:12px;min-height:44px;padding:8px}.note{padding:0 16px 12px;color:var(--warn);font-size:12px}
    :host([data-compact=true]){width:max-content}:host([data-dragging=true]) header,:host([data-dragging=true]) .compact{cursor:grabbing}.compact{pointer-events:auto;display:flex;align-items:center;gap:10px;margin-left:auto;width:max-content;max-width:100%;padding:5px 12px 5px 8px;background:var(--paper);border:1px solid var(--line);border-radius:24px;box-shadow:0 8px 28px #54213c26;min-height:48px;touch-action:none;user-select:none;cursor:grab}.compact svg{width:27px;height:27px;color:var(--brand);flex-shrink:0}.compact-copy{display:flex;flex-direction:column;align-items:flex-start;gap:1px}.compact strong{font-size:13px;letter-spacing:.5px}.compact-status{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--muted)}
    :host([data-busy=true]) .spark{animation:twinkle 1.8s ease-in-out infinite}:host([data-busy=true]) .compact .dot{animation:twinkle 1.8s ease-in-out infinite}@keyframes twinkle{50%{opacity:.4}}
    @media(max-width:600px){:host{right:max(12px,env(safe-area-inset-right));bottom:max(12px,env(safe-area-inset-bottom));width:min(292px,calc(100vw - 24px))}article{max-height:min(76dvh,640px);border-radius:24px}header{padding:10px 12px 8px}main{padding:0 12px 12px}.brand strong{font-size:15px}.headline{font-size:18px}.hint{margin-bottom:10px}.metric{padding:7px 9px}input{font-size:16px}.form{padding:12px}.sub{padding:3px 9px}.compact{min-height:48px}.events{max-height:120px}}
    @media(max-height:500px){article{max-height:calc(100dvh - 24px)}}
    @media(prefers-reduced-motion:reduce){button{transition:none}:host([data-busy=true]) .spark,:host([data-busy=true]) .compact .dot{animation:none}}
  </style>
  <article aria-label="喵喵电波控制面板">
    <header tabindex="0" aria-label="面板标题，可拖动或用方向键移动" title="拖动标题移动面板；也可使用方向键"><div class="mark">${cat}</div><div class="brand"><strong>喵喵电波</strong><small>MMDB 本地反代</small></div><button class="icon quiet" id="fold" aria-label="收起面板">−</button></header>
    <div class="note" id="demo" hidden>界面预览 · 状态为演示数据</div>
    <main><div class="statuses"><span class="tag" id="bridgeTag"><i class="dot" aria-hidden="true"></i><span id="bridgeText">本地 · 待连接</span></span><span class="tag" id="sessionTag"><i class="dot" aria-hidden="true"></i><span id="sessionText">Google · 待引导</span></span></div>
      <div class="greeting"><h2 class="headline" id="headline" aria-live="polite">等待连接</h2><span class="spark" aria-hidden="true">✧</span></div><p class="hint" id="hint">在本页发送 hi，完成会话引导。</p>
      <div class="metrics"><div class="metric"><span>已送达</span><b id="completed">0</b><em>次</em></div><div class="metric"><span>请求耗时</span><b id="elapsed">—</b><em>秒</em></div></div>
      <p class="model" id="model">等待请求</p><div class="error" id="error" role="status"></div>
      <div class="row buttons"><button class="primary" id="connect">重新连接</button><button id="settingsToggle" aria-expanded="false">连接设置</button></div>
    </main>
    <form class="form" hidden id="settings"><div class="field"><label for="apiKey">个人密钥</label><div class="row"><input id="apiKey" type="password" autocomplete="off" spellcheck="false"><button type="button" class="icon" id="reveal" aria-label="显示或隐藏密钥">显</button></div></div><div class="field"><label for="base">本机 API 地址</label><input id="base" readonly></div><div class="row"><button class="primary" type="submit">保存并重连</button><button type="button" id="copy">复制地址</button></div><p>手机连接电脑时，请在酒馆填写电脑的局域网地址。</p></form>
    <details><summary>日志<span id="activityCount">0 条</span></summary><ol class="events" id="events"></ol></details>
    <footer class="sub"><span>v${MMDB_VERSION}</span><div class="row"><button id="move" title="切换到屏幕其他位置">换位置</button><button id="wake" aria-pressed="false">常亮：关</button><button id="theme">切换夜间</button></div></footer>
  </article>
  <button class="compact" id="unfold" aria-label="展开喵喵电波面板，可拖动或用方向键移动" title="点击展开，拖动移动位置" aria-expanded="false" hidden>${cat}<span class="compact-copy"><strong>喵喵电波</strong><span class="compact-status"><i class="dot" aria-hidden="true"></i><span id="compactText">待连接</span></span></span></button>`;
  // Build known static markup with DOM methods: no innerHTML / TrustedHTML policy.
  // User text and activity messages are always assigned through textContent.
  const styleEnd=markup.indexOf('</style>');
  const style=document.createElement('style');style.textContent=markup.slice(markup.indexOf('>')+1,styleEnd);root.append(style);
  const stack=[root],voidTags=new Set(['input','br']);
  for(const token of markup.slice(styleEnd+8).match(/<[^>]+>|[^<]+/g)??[]){
    if(!token.startsWith('<')){stack.at(-1).append(document.createTextNode(token));continue;}
    if(token.startsWith('</')){stack.pop();continue;}
    const match=/^<([\w-]+)([\s\S]*?)\/?\s*>$/.exec(token);if(!match)continue;
    const tag=match[1],parent=stack.at(-1);
    const node=tag==='svg'||parent.namespaceURI==='http://www.w3.org/2000/svg'?document.createElementNS('http://www.w3.org/2000/svg',tag):document.createElement(tag);
    for(const attribute of match[2].matchAll(/([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s]+)))?/g)){
      if(!attribute[1].startsWith('on'))node.setAttribute(attribute[1],attribute[2]??attribute[3]??attribute[4]??'');
    }
    parent.append(node);if(!voidTags.has(tag)&&!token.endsWith('/>'))stack.push(node);
  }
  // Keep the panel outside the application's body render lifecycle.
  document.documentElement.append(host);
  const el = id => root.getElementById(id);
  const view = {...initial};
  let theme = initial.theme ?? 'light';
  host.setAttribute('theme', theme);
  el('apiKey').value = initial.apiKey ?? 'mmdb';
  el('base').value = initial.baseURL ?? 'http://127.0.0.1:8765/v1';
  const positioning=attachPanelPosition(host,[root.querySelector('header'),el('unfold')],{position:initial.position,save:position=>actions.savePosition?.(position),tap:handle=>{if(handle!==el('unfold'))return false;setExpanded(true,true);return true;}});
  el('move').onclick=()=>positioning.cycle();
  function setExpanded(expanded, focus=false) {
    host.dataset.compact=String(!expanded);
    root.querySelector('article').hidden=!expanded;el('unfold').hidden=expanded;
    el('unfold').setAttribute('aria-expanded',String(expanded));
    positioning.place();
    if(focus)el(expanded?'fold':'unfold').focus();
  }
  el('fold').onclick=()=>setExpanded(false,true);
  el('unfold').onclick=()=>setExpanded(true,true);
  // Start as a small status pill on phones so the chat stays usable.
  setExpanded(!(initial.compact ?? window.matchMedia('(max-width:600px)').matches));
  el('settingsToggle').onclick = () => { const open = el('settings').hidden; el('settings').hidden = !open; el('settingsToggle').setAttribute('aria-expanded',String(open)); if(open) el('apiKey').focus(); };
  el('reveal').onclick = () => { el('apiKey').type = el('apiKey').type === 'password' ? 'text' : 'password'; };
  el('settings').onsubmit = async event => { event.preventDefault(); const key = el('apiKey').value.trim(); if (key.length < 4) { update({error:'密钥至少需要 4 个字符。'}); return; } await actions.saveKey?.(key); };
  el('connect').onclick = () => actions.reconnect?.();
  root.addEventListener('keydown',event=>{if(event.key==='Escape'&&!el('settings').hidden){el('settings').hidden=true;el('settingsToggle').setAttribute('aria-expanded','false');el('settingsToggle').focus();}});
  el('copy').onclick = async () => { try { await navigator.clipboard.writeText(el('base').value); addEvent('已复制本机 API 地址'); } catch { el('base').select(); addEvent('请手动复制选中的地址'); } };
  el('theme').onclick = () => { theme = theme === 'light' ? 'dark' : 'light'; host.setAttribute('theme',theme); el('theme').textContent = theme === 'light' ? '切换夜间' : '切换日间'; actions.saveTheme?.(theme); };
  el('theme').textContent = theme === 'light' ? '切换夜间' : '切换日间';
  el('wake').onclick = () => actions.toggleWake?.();
  const events = [];
  function addEvent(message) {
    events.unshift({message, time:new Date().toLocaleTimeString('zh-CN',{hour12:false})}); events.length = Math.min(events.length,40);
    el('events').replaceChildren(...events.map(item => { const li = document.createElement('li'); const time = document.createElement('time'); time.textContent = item.time; li.append(time,document.createTextNode(item.message)); return li; }));
    el('activityCount').textContent = `${events.length} 条`;
  }
  function update(patch) {
    Object.assign(view,patch);
    const connected = view.link === 'connected';
    const ready = view.session === true;
    el('bridgeTag').dataset.ok = String(connected); el('sessionTag').dataset.ok = String(ready);
    el('bridgeText').textContent = `本地 · ${connected ? '已连接' : view.link === 'connecting' ? '连接中' : '未连接'}`;
    el('sessionText').textContent = `Google · ${ready ? '已就绪' : '待引导'}`;
    el('headline').textContent = view.busy ? '正在生成' : view.error ? '连接提示' : connected && ready ? '连接正常' : '等待连接';
    const phaseHint={body:'已收到正文，正在交付酒馆。','network-retry':'连接中断，正在准备唯一一次重试。',preparing:'正在准备请求，可在酒馆中停止。',proof:'正在获取 Google 会话验证。','request-sent':'等待 Google 响应，尚未收到数据。',headers:'已收到响应头，等待响应数据。',streaming:'已收到上游数据，可在酒馆中停止。'};
    el('hint').textContent = view.busy ? phaseHint[view.phase]??'可在酒馆中停止生成。' : !ready ? '在本页发送 hi，完成会话引导。' : !connected ? '请启动反代，再重新连接。' : '保持页面打开即可。';
    el('completed').textContent = String(view.completed ?? 0); el('elapsed').textContent = view.elapsed == null ? '—' : String(Math.floor(view.elapsed));
    el('model').textContent = view.model ? view.model : '等待请求'; el('error').textContent = view.error ?? '';
    el('compactText').textContent = view.busy ? '生成中' : connected && ready ? '已就绪' : '待连接';
    if (view.wake !== undefined) { el('wake').setAttribute('aria-pressed',String(view.wake)); el('wake').textContent = `常亮：${view.wake ? '开' : '关'}`; }
    host.dataset.busy=String(!!view.busy);
    el('unfold').querySelector('.dot').style.background=connected&&ready?'var(--good)':'var(--warn)';
    el('demo').hidden = !view.demo;
  }
  update(initial);
  return {update,addEvent,host,destroy:()=>{positioning.destroy();host.remove();}};
}

// Position against the visible viewport, including the mobile soft keyboard.
// Store normalized coordinates so a saved desktop position cannot strand the
// control off-screen after rotation or when opening the page on a phone.
function attachPanelPosition(host,handles,{position,save=()=>{},tap=()=>false,screen=window}={}) {
  const valid=value=>value&&Number.isFinite(value.x)&&Number.isFinite(value.y)&&value.x>=0&&value.x<=1&&value.y>=0&&value.y<=1;
  let anchor=valid(position)?{x:position.x,y:position.y}:screen.matchMedia('(max-width:600px)').matches?{x:0,y:.35}:{x:1,y:1};
  let drag=null,suppressClickUntil=0,suppressedHandle=null,touchClick=null;
  const subscriptions=[];
  const on=(target,type,handler,options)=>{target?.addEventListener(type,handler,options);subscriptions.push(()=>target?.removeEventListener(type,handler,options));};
  const bounds=()=>{
    const visual=screen.visualViewport;
    const width=visual?.width??screen.innerWidth,height=visual?.height??screen.innerHeight;
    const left=(visual?.offsetLeft??0)+12,top=(visual?.offsetTop??0)+12;
    host.style.maxWidth=`${Math.max(44,width-24)}px`;
    const article=host.shadowRoot?.querySelector('article');if(article)article.style.maxHeight=`${Math.max(44,height-24)}px`;
    const rect=host.getBoundingClientRect();
    return {left,top,width:Math.max(0,width-24-rect.width),height:Math.max(0,height-24-rect.height)};
  };
  const clamp=(n,max)=>Math.max(0,Math.min(max,n));
  const write=(x,y)=>{host.style.left=`${x}px`;host.style.top=`${y}px`;host.style.right='auto';host.style.bottom='auto';};
  const place=()=>{const b=bounds();write(b.left+b.width*anchor.x,b.top+b.height*anchor.y);};
  const move=(x,y)=>{
    const b=bounds(),dx=clamp(x-b.left,b.width),dy=clamp(y-b.top,b.height);
    anchor={x:b.width?dx/b.width:anchor.x,y:b.height?dy/b.height:anchor.y};write(b.left+dx,b.top+dy);
  };
  const commit=()=>{try{save({...anchor});}catch{}};
  const finish=(event,cancelled=false)=>{
    if(!drag||event.pointerId!==drag.id)return;
    const previous=drag;drag=null;host.dataset.dragging='false';
    if(previous.moved){suppressedHandle=previous.handle;suppressClickUntil=Date.now()+500;if(cancelled){anchor=previous.anchor;place();}else commit();}
    // Some mobile engines omit the compatibility click after a touch drag.
    // A stationary touch activates explicitly; ignore only its duplicate click.
    else if(!cancelled&&['touch','pen'].includes(event.pointerType)&&tap(previous.handle)){suppressedHandle=previous.handle;suppressClickUntil=Date.now()+500;touchClick={id:event.pointerId,until:suppressClickUntil};event.preventDefault();}
    try{previous.handle.releasePointerCapture(previous.id);}catch{}
  };
  for(const handle of handles){
    on(handle,'pointerdown',event=>{
      if(event.isPrimary===false||event.button!==0||drag)return;
      const control=event.target.closest?.('button,input,select,textarea,a,summary');if(control&&control!==handle)return;
      const rect=host.getBoundingClientRect();
      drag={id:event.pointerId,handle,x:event.clientX,y:event.clientY,left:rect.left,top:rect.top,anchor:{...anchor},moved:false};
    });
    on(handle,'lostpointercapture',event=>{if(event.target===handle)finish(event,true);});
    on(handle,'click',event=>{if(handle===suppressedHandle&&Date.now()<suppressClickUntil){event.preventDefault();event.stopImmediatePropagation();}},true);
    on(handle,'keydown',event=>{
      if(event.target!==handle||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;
      event.preventDefault();const step=event.shiftKey?48:16,rect=host.getBoundingClientRect();
      move(rect.left+(event.key==='ArrowRight'?step:event.key==='ArrowLeft'?-step:0),rect.top+(event.key==='ArrowDown'?step:event.key==='ArrowUp'?-step:0));commit();
    });
  }
  // Opening on touch-up can hide the pill before the browser emits its click.
  // Stop only that gesture's click, even if retargeted to a newly exposed button.
  on(screen,'pointerdown',()=>{touchClick=null;},true);
  on(screen,'click',event=>{if(touchClick&&Date.now()<touchClick.until&&event.pointerId===touchClick.id&&['touch','pen'].includes(event.pointerType)){touchClick=null;event.preventDefault();event.stopImmediatePropagation();}},true);
  on(screen,'pointermove',event=>{
    if(!drag||event.pointerId!==drag.id)return;
    const dx=event.clientX-drag.x,dy=event.clientY-drag.y;
    if(!drag.moved&&Math.hypot(dx,dy)<6)return;
    if(!drag.moved)try{drag.handle.setPointerCapture(event.pointerId);}catch{}
    drag.moved=true;host.dataset.dragging='true';event.preventDefault();move(drag.left+dx,drag.top+dy);
  });
  on(screen,'pointerup',event=>finish(event));on(screen,'pointercancel',event=>finish(event,true));
  on(screen,'resize',place);on(screen.visualViewport,'resize',place);on(screen.visualViewport,'scroll',place);
  const observer=screen.ResizeObserver?new screen.ResizeObserver(()=>{if(!drag)place();}):null;observer?.observe(host);
  place();
  return {place,cycle(){const presets=[{x:0,y:.35},{x:1,y:.35},{x:0,y:0},{x:1,y:0}];const index=presets.findIndex(p=>Math.abs(p.x-anchor.x)<.01&&Math.abs(p.y-anchor.y)<.01);anchor=presets[(index+1)%presets.length];place();commit();},destroy(){observer?.disconnect();for(const remove of subscriptions)remove();}};
}

// Browser integration written for MMDB. Protocol facts: see THIRD_PARTY.md.
// Refresh only the Google signature forms we understand. Never log cookie or
// signature values, and preserve unknown auth schemes/extensions verbatim.
async function requestHeaders(page,captured) {
  const headers=Object.fromEntries(Object.entries(captured).filter(([name])=>!name.startsWith('x-goog-ext-')));
  const cookies=new Map(String(page.document?.cookie??'').split(';').flatMap(item=>{
    const i=item.indexOf('=');return i<0?[]:[[item.slice(0,i).trim(),item.slice(i+1)]];
  }));
  const schemes={SAPISIDHASH:'SAPISID',SAPISID1PHASH:'__Secure-1PAPISID',SAPISID3PHASH:'__Secure-3PAPISID'};
  const origin=new URL(page.location.href).origin;
  const timestamp=Math.floor(Date.now()/1000);
  let refreshed=false;
  if(headers.authorization){
    const tokens=headers.authorization.split(/\s+/);
    for(let i=0;i+1<tokens.length;i+=2){
      const cookie=cookies.get(schemes[tokens[i]]);
      if(!cookie||!/^\d+_[a-f0-9]{40}$/i.test(tokens[i+1]))continue;
      const bytes=await page.crypto.subtle.digest('SHA-1',new TextEncoder().encode(`${timestamp} ${cookie} ${origin}`));
      tokens[i+1]=`${timestamp}_${Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('')}`;
      refreshed=true;
    }
    headers.authorization=tokens.join(' ');
  }
  return {headers,refreshed};
}
class GooglePageSession {
  constructor(page, changed, report = () => {}) {
    this.page = page; this.changed = changed; this.headers = {}; this.proofOK = false;
    const notices = new Set();
    this.report = message => { if (!notices.has(message)) { notices.add(message); report(message); } };
    this.fetch = page.fetch.bind(page); this.restore = [];
    const target = url => { try { const u = new URL(url, page.location.href); return u.origin === 'https://alkalimakersuite-pa.clients6.google.com' && !u.username && !u.password && u.pathname === '/$rpc/google.internal.alkali.applications.makersuite.v1.MakerSuiteService/GenerateContent' ? u.href : null; } catch { return null; } };
    const record = (url, headers) => {
      const endpoint=target(url);if (!endpoint) return;
      const incoming = new page.Headers(headers ?? {});
      const current={};
      // Preserve the actual page's benefit tier and visit context along with
      // its authentication. Never invent a tier or merge a previous account.
      for (const [name,value] of incoming) if (['authorization','x-client-data','x-user-agent','x-same-domain'].includes(name) || name.startsWith('x-goog-') || name.startsWith('x-aistudio-')) current[name] = value;
      this.headers=current;this.endpoint=endpoint;
      this.report(this.headers['x-goog-api-key'] ? '已识别页面生成请求，公共请求头已就绪' : '已识别页面生成请求，仍等待必要的公共请求头');
      this.report(this.headers['x-aistudio-g1-tier'] ? '已同步当前网页的会员与访问标识' : '本次网页请求未携带会员等级标识');
      this.changed(this.ready);
    };
    const original = page.fetch;
    const wrapper = function(input, options) {
      try { record(typeof input === 'string' ? input : input?.url ?? input?.href, options?.headers ?? input?.headers); }
      catch { session.report('页面请求头暂未识别；页面原请求将继续发送'); }
      return original.apply(this,arguments);
    };
    const session = this;
    page.fetch = wrapper;
    this.restore.push(()=>{if(page.fetch===wrapper)page.fetch=original;});
    const proto = page.XMLHttpRequest?.prototype;
    if (proto) {
      const open = proto.open, setHeader = proto.setRequestHeader, send = proto.send;
      const requests = new WeakMap();
      const patchedOpen = function(method,url,...options) { requests.set(this,{url:String(url),headers:{}}); return open.call(this,method,url,...options); };
      const patchedHeader = function(name,value) { const entry=requests.get(this); if(entry)entry.headers[name]=value; return setHeader.call(this,name,value); };
      const patchedSend = function() { const entry=requests.get(this); try { if(entry)record(entry.url,entry.headers); } catch { session.report('页面请求头暂未识别；页面原请求将继续发送'); } return send.apply(this,arguments); };
      proto.open=patchedOpen;proto.setRequestHeader=patchedHeader;proto.send=patchedSend;
      this.restore.push(()=>{if(proto.open===patchedOpen)proto.open=open;if(proto.setRequestHeader===patchedHeader)proto.setRequestHeader=setHeader;if(proto.send===patchedSend)proto.send=send;});
    }
    this.watch = setInterval(()=>this.discover(),100); this.discover();
  }
  get ready() { return this.proofOK && !!this.service && !!this.headers['x-goog-api-key']; }
  discover() {
    if(this.hooked)return;
    const exports = this.page.default_MakerSuite;
    if(!exports){this.report('等待 AI Studio 页面组件加载');return;}
    // Use the page function's own toString across the userscript/page boundary.
    // The sandbox Function.prototype may only describe a native proxy wrapper.
    const matches=Object.keys(exports).filter(key=>{try {const fn=exports[key];if(typeof fn!=='function')return false;const code=fn.toString();return /\.snapshot\s*\(/.test(code)&&code.includes('content')&&code.includes('yield');}catch{return false;}});
    if(!matches.length){this.report('页面组件已加载，正在查找会话验证入口');return;}
    const session=this;
    // Observe all matching exports (including aliases); use the one the page
    // actually calls and validates instead of requiring one unique match.
    for(const key of matches){
      const original=exports[key];
      const interceptor=function(...args) {
        const context=this, service=args[0];
        const output=original.apply(context,args);
        Promise.resolve(output).then(proof=>{
          const valid=typeof proof==='string'&&proof.startsWith('!')&&service!=null;
          if(valid){session.service=service;session.snapshot=digest=>original.call(context,service,digest);session.proofOK=true;session.report('Google 会话验证已就绪');session.changed(session.ready);}
          else session.report('页面未返回有效会话验证，请确认本页能正常生成');
        },()=>session.report('本次页面会话验证失败，请稍后再试'));
        return output;
      };
      exports[key]=interceptor;
      this.restore.push(()=>{if(exports[key]===interceptor)exports[key]=original;});
    }
    this.hooked=true;
    this.report(`已安装会话捕获（${matches.length} 个入口），请在本页手动发送 hi`);
    clearInterval(this.watch);
  }
  async generate(payload,signal,chunk,progress=()=>{}) {
    const check=()=>{if(signal.aborted)throw new DOMException('用户已停止生成','AbortError');};
    check();
    if(!this.ready)throw Object.assign(new Error('请先在 AI Studio 手动发送 hi，等待页面正常回复。'),{status:503,code:'session_not_ready'});
    if(!Array.isArray(payload.wire)||typeof payload.binding!=='string')throw Object.assign(new Error('本地请求格式无效'),{status:400,code:'invalid_payload'});
    const binding=payload.binding;
    let reader;
    try {
      // Like the current Playground executor, sign binding directly. Rewriting
      // the page composer is unnecessary and couples generation to Angular UI.
      const bytes=await this.page.crypto.subtle.digest('SHA-256',new TextEncoder().encode(binding));
      const digest=Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
      check();
      progress('proof');
      let timeout,onAbort;
      const proof=await Promise.race([
        this.snapshot(digest),
        new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Object.assign(new Error('等待 Google 会话验证超时，请刷新页面并发送 hi。'),{status:504,code:'proof_timeout'})),15000);}),
        new Promise((_,reject)=>{onAbort=()=>reject(new DOMException('用户已停止生成','AbortError'));signal.addEventListener('abort',onAbort,{once:true});if(signal.aborted)onAbort();})
      ]).finally(()=>{clearTimeout(timeout);if(onAbort)signal.removeEventListener('abort',onAbort);});
      check();
      if(typeof proof!=='string'||!proof.startsWith('!'))throw Object.assign(new Error('Google 会话验证未就绪，请刷新页面并发送 hi。'),{status:503,code:'invalid_proof'});
      const wire=structuredClone(payload.wire);wire[4]=proof;
      const {headers,refreshed}=await requestHeaders(this.page,this.headers);
      check();
      progress('request-sent');
      const requestStarted=performance.now();
      let response;
      try { response=await this.fetch(this.endpoint ?? 'https://alkalimakersuite-pa.clients6.google.com/$rpc/google.internal.alkali.applications.makersuite.v1.MakerSuiteService/GenerateContent', {method:'POST',credentials:'include',headers:{...headers,'content-type':'application/json+protobuf'},body:JSON.stringify(wire),signal}); }
      catch(error){
        check();
        if(error?.name==='TypeError')throw Object.assign(new Error('浏览器请求 Google 失败，尚未收到响应头；本地连接仍可用。原因尚未确定，已记录页面运行状态。'),{status:502,code:'upstream_connection_failed',failurePhase:'before-headers',requestWaitMs:Math.max(0,Math.round(performance.now()-requestStarted)),authRefreshed:refreshed});
        throw error;
      }
      check();
      progress('headers',{httpStatus:response.status});
      if(!response.ok)throw Object.assign(new Error(`Google 返回 HTTP ${response.status}，请确认网页正常生成，并检查反代会话是否同步。`),{status:response.status,code:'upstream_http_error'});
      if(!response.body)throw Object.assign(new Error('Google 未返回可读取的响应流'),{status:502,code:'empty_response'});
      reader=response.body.getReader();const decoder=new TextDecoder();let first=true,receivedBytes=false;
      for(;;){
        let data;
        try { data=await reader.read(); }
        catch(error){
          check();
          // Classify only a reader failure, never an exception from chunk parsing.
          // Headers alone are not generated data: a no-data failure may use the
          // existing single recovery attempt; never replay a partial response.
          throw Object.assign(new Error(!receivedBytes?'Google 已返回响应头，但数据连接中断，尚未收到生成数据。':'接收 Google 数据时连接中断，未把不完整回复标为成功。请检查网络或代理连接。'),{status:502,code:!receivedBytes?'upstream_connection_failed':'upstream_stream_disconnected',failurePhase:!receivedBytes?'before-data':'during-data',requestWaitMs:Math.max(0,Math.round(performance.now()-requestStarted))});
        }
        check();const {done,value}=data;if(done)break;receivedBytes ||= value.byteLength>0;const text=decoder.decode(value,{stream:true});if(text){if(first){first=false;progress('streaming');}chunk(text);}
      }
      const tail=decoder.decode();if(tail)chunk(tail);check();
    } finally {
      if(reader){if(signal.aborted)await reader.cancel().catch(()=>{});reader.releaseLock();}
    }
  }
  destroy(){clearInterval(this.watch);for(const undo of this.restore.reverse())undo();}
}

// Retry only a connection failure before response data, once, with a new proof.
// A request may already have reached Google; this can consume another generation.
async function generateWithRecovery(session,payload,signal,chunk,progress,{retry=false,delayMs=1500,retryWindowMs=Infinity,now=()=>performance.now()}={}) {
  let received=false;
  const started=now();
  const check=()=>{if(signal.aborted)throw new DOMException('用户已停止生成','AbortError');};
  for(let attempt=0;attempt<2;attempt++){
    check();
    try {
      return await session.generate(payload,signal,text=>{if(text)received=true;chunk(text);},progress);
    } catch(error){
      check();
      if(!retry||attempt||received||error.code!=='upstream_connection_failed')throw error;
      // The relay owns the overall deadline; retry never resets that budget.
      // An explicitly supplied retry window can still opt out of late replay.
      if(now()-started>=retryWindowMs){
        progress('retry-skipped');
        error.message+=' 本次已长时间等待，未自动重复提交；请检查网络或代理后重试。';
        throw error;
      }
      progress('network-retry');
      await new Promise((resolve,reject)=>{
        const abort=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);reject(new DOMException('用户已停止生成','AbortError'));};
        const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},delayMs);
        signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
      });
    }
  }
}

// MMDB executor: bounded serial work, per-connection ownership, no offline replay.
function startMMDB(options={}) {
  if(document.querySelector('mmdb-local-bridge'))return;
  const page=typeof unsafeWindow==='undefined'?window:unsafeWindow;
  const port=Number(options.port)||8765;
  const saved=(key,fallback)=>typeof GM_getValue==='function'?GM_getValue(`mmdb.${key}`,fallback):fallback;
  const persist=(key,value)=>{if(typeof GM_setValue==='function')GM_setValue(`mmdb.${key}`,value);};
  let key=saved('key',options.key?.startsWith('__')?'mmdb':options.key||'mmdb');
  let activeRequest;
  let socket,reconnectTimer,wakeLock,wakeWanted=false,stopped=false,chain=Promise.resolve(),completed=0;
  const jobs=new Map();
  const ui=mountBridgePanel({
    reconnect:()=>{clearTimeout(reconnectTimer);disconnect();connect();},
    saveKey:value=>{key=value;persist('key',value);disconnect();connect();ui.addEvent('连接设置已保存');ui.update({error:''});},
    saveTheme:value=>persist('theme',value),
    savePosition:value=>persist('position',value),
    toggleWake:async()=>{
      wakeWanted=!wakeWanted;
      if(!wakeWanted){await wakeLock?.release();wakeLock=null;ui.update({wake:false});return;}
      if(!navigator.wakeLock){wakeWanted=false;ui.addEvent('此浏览器不支持屏幕常亮，请在系统设置中保持页面运行');return;}
      try{wakeLock=await navigator.wakeLock.request('screen');ui.update({wake:true});wakeLock.addEventListener('release',()=>{wakeLock=null;ui.update({wake:false});});}
      catch{wakeWanted=false;ui.addEvent('屏幕常亮未获准，请保持当前标签页可见');}
    }
  },{apiKey:key,baseURL:`http://127.0.0.1:${port}/v1`,theme:saved('theme','light'),position:saved('position',null)});
  const tell=(owner,message)=>{if(owner?.readyState===1)owner.send(JSON.stringify(message));};
  const session=new GooglePageSession(page,ready=>{ui.update({session:ready});if(ready)connect();},message=>ui.addEvent(message));
  function disconnect(){if(socket){const previous=socket;socket=null;previous.close();for(const job of jobs.values())if(job.owner===previous)job.controller.abort();}ui.update({link:'disconnected'});}
  function connect(){
    if(stopped||!session?.ready||socket?.readyState===0||socket?.readyState===1)return;
    clearTimeout(reconnectTimer);ui.update({link:'connecting'});
    const owner=new WebSocket(`ws://127.0.0.1:${port}/api/build/ws`);socket=owner;
    owner.onopen=()=>tell(owner,{type:'register',executorType:'playground',apiKey:key,clientVersion:`mmdb-${MMDB_VERSION}`});
    owner.onmessage=event=>{
      let msg;try{msg=JSON.parse(event.data);}catch{return;}
      if(msg.type==='registered'){ui.update({link:'connected',error:''});ui.addEvent('已连接本地服务');return;}
      if(msg.type==='body-start'){if(msg.requestId===activeRequest){ui.update({phase:'body'});ui.addEvent('已收到正文，正在交付酒馆');}return;}
      if(msg.type==='cancel'){jobs.get(msg.requestId)?.controller.abort();return;}
      if(msg.type==='settled'){
        if(msg.requestId===activeRequest&&Number.isFinite(msg.elapsedMs))ui.update({busy:false,elapsed:msg.elapsedMs/1000});
        if(msg.status==='finished'){completed++;ui.update({completed,error:''});ui.addEvent('生成完成，已确认上游结束状态');}
        else if(msg.status==='cancelled')ui.addEvent('已停止生成');
        else{ui.update({error:msg.message||'本次生成失败'});ui.addEvent(msg.message||'生成失败');}
        return;
      }
      if(msg.type!=='request')return;
      if(jobs.size>=8){tell(owner,{type:'error',requestId:msg.requestId,status:429,error:{code:'executor_busy',message:'页面队列已满，请稍后重试'}});return;}
      const job={owner,controller:new page.AbortController(),receivedAt:performance.now(),elapsedMs:Number(msg.elapsedMs)||0};jobs.set(msg.requestId,job);
      tell(owner,{type:'progress',requestId:msg.requestId,phase:'queued'});
      chain=chain.catch(()=>{}).then(async()=>{
        if(job.controller.signal.aborted||owner!==socket||owner.readyState!==1)return;
        activeRequest=msg.requestId;const elapsed=()=>Math.max(0,job.elapsedMs+performance.now()-job.receivedAt)/1000;ui.update({busy:true,phase:'preparing',model:msg.model,rounds:msg.round??0,elapsed:elapsed(),error:''});ui.addEvent(msg.round?`继续生成，第 ${msg.round} 次续写`:'收到酒馆请求，正在准备');
        const phaseText={'network-retry':'Google 连接在收到数据前中断，重新验证后重试一次（可能额外消耗额度）','retry-skipped':'等待较久后上游连接失败，已停止自动重复提交',preparing:'正在准备请求',proof:'正在获取 Google 会话验证','request-sent':'请求已发起，等待 Google 响应',headers:'已收到 Google 响应头，等待响应数据',streaming:'已收到首个 Google 数据块'};
        const progress=(phase,details={})=>{tell(owner,{type:'progress',requestId:msg.requestId,phase,...details});ui.update({phase});if(phaseText[phase])ui.addEvent(phaseText[phase]);};
        progress('preparing');
        let lastTick=performance.now(),maxTimerGapMs=0;
        const ticker=setInterval(()=>{const now=performance.now();maxTimerGapMs=Math.max(maxTimerGapMs,Math.round(now-lastTick));lastTick=now;ui.update({elapsed:elapsed()});},1000);
        try{
          const payload=JSON.parse(msg.requestBody);
          await generateWithRecovery(session,payload,job.controller.signal,text=>tell(owner,{type:'stream-chunk',requestId:msg.requestId,chunkBody:text}),progress,{retry:msg.allowNetworkRetry===true});
          if(!job.controller.signal.aborted)tell(owner,{type:'stream-end',requestId:msg.requestId});
        }catch(error){tell(owner,{type:'error',requestId:msg.requestId,status:job.controller.signal.aborted?499:error.status||502,error:{code:job.controller.signal.aborted?'cancelled':error.code||'executor_error',message:job.controller.signal.aborted?'用户已停止生成':error.message||'浏览器执行失败',failurePhase:error.failurePhase,requestWaitMs:error.requestWaitMs,pageVisibility:document.visibilityState,browserOnline:navigator.onLine,maxTimerGapMs:Math.max(maxTimerGapMs,Math.round(performance.now()-lastTick)),authRefreshed:error.authRefreshed}});}
        finally{clearInterval(ticker);ui.update({busy:false,elapsed:elapsed()});}
      }).finally(()=>jobs.delete(msg.requestId));
    };
    owner.onclose=event=>{
      for(const job of jobs.values())if(job.owner===owner)job.controller.abort();
      if(socket!==owner)return;socket=null;ui.update({link:'disconnected'});
      if(event.code===1008||event.code===4008){ui.update({error:event.code===4008?'另一个 AI Studio 执行器已连接，请停用旧脚本或关闭重复标签页。':'连接被拒绝，请确认面板密钥与本地配置一致。'});return;}
      if(!stopped)reconnectTimer=setTimeout(connect,2000);
    };
    owner.onerror=()=>ui.update({error:'无法连接本地服务，请确认启动窗口仍在运行。'});
  }
  document.addEventListener('visibilitychange',async()=>{if(document.visibilityState==='visible'){connect();if(wakeWanted&&navigator.wakeLock&&!wakeLock)try{wakeLock=await navigator.wakeLock.request('screen');ui.update({wake:true});}catch{}}});
  page.addEventListener('pagehide',()=>{stopped=true;clearTimeout(reconnectTimer);disconnect();session.destroy();wakeLock?.release();},{once:true});
  ui.addEvent('请在本页手动发送 hi，完成 Google 会话引导');
  return {ui,session,stop:()=>{stopped=true;clearTimeout(reconnectTimer);disconnect();session.destroy();ui.destroy();}};
}

// Install page observers as soon as the document root exists, before the app
// caches its request helpers. Do not wait for DOMContentLoaded to install hooks.
function bootBridge(start, documentNode = document, schedule = setTimeout) {
  function attempt() {
    if (!documentNode.documentElement) { schedule(attempt, 25); return; }
    try { start(); }
    catch (error) {
      console.error('[MMDB]', error);
      const note = documentNode.createElement('div');
      note.textContent = 'MMDB 启动失败：' + error.message;
      note.style.cssText = 'position:fixed;bottom:12px;right:12px;z-index:2147483647;background:#fff3f9;color:#81224e;padding:16px;border:1px solid #d9a6bd;border-radius:12px;font:14px system-ui;max-width:320px';
      documentNode.documentElement.append(note);
    }
  }
  attempt();
}

bootBridge(()=>startMMDB({port:"__LOCAL_PG_PORT__",key:"__LOCAL_PG_KEY__"}));
})();
