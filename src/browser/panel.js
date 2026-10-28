// A quiet connection monitor for RP. Static markup never enters innerHTML.
export function mountBridgePanel(actions, initial = {}) {
  const host=document.createElement('mmdb-local-bridge');
  const root=host.attachShadow({mode:'open'});
  const cat=`<svg viewBox="0 0 40 40" fill="none" aria-hidden="true"><path d="M9 17 8 7l10 6a21 21 0 0 1 7 0l8-6-1 12c5 12-2 16-12 16S4 30 9 17Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M13 23h1m12 0h1m-9 5 2 2 2-2M5 25h5m20 0h5" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>`;
  const markup=`<style>
    :host{--panel:#f8f9fa;--ink:#292e32;--secondary:#58636d;--muted:#747f88;--line:#dee2e5;--inset:#eef0f2;--accent:#485660;--on-accent:#fff;--panel-font:"Segoe UI","Microsoft YaHei",sans-serif;--panel-radius:16px;--control-radius:8px;--panel-shadow:0 8px 32px #14191e1a;--signal:#397d56;--warn:#986321;--bad:#ae3f48;display:block;position:fixed;width:336px;max-width:calc(100% - 24px);font:14px/1.5 var(--panel-font);color:var(--ink);z-index:2147483640;color-scheme:light;pointer-events:none;text-align:left;-webkit-font-smoothing:antialiased}
    :host([theme=dark]){--panel:#292e32;--ink:#e2e7e9;--secondary:#a2afb8;--muted:#a2afb8;--line:#485159;--inset:#24292d;--accent:#c1cbd2;--on-accent:#252b30;--signal:#9bccac;--warn:#e6be7d;--bad:#f1a1a6;color-scheme:dark}
    *{box-sizing:border-box}[hidden]{display:none!important}button,input{font:inherit}button{cursor:pointer;min-height:44px;border:1px solid var(--line);border-radius:var(--control-radius);background:transparent;color:var(--ink);padding:8px 12px;touch-action:manipulation}button:hover{background:var(--inset)}button:active{transform:translateY(1px)}button:disabled{cursor:not-allowed;opacity:.5}button:focus-visible,input:focus-visible,summary:focus-visible,header:focus-visible{outline:2px solid var(--accent);outline-offset:3px}svg{display:block}
    article{pointer-events:auto;width:100%;max-height:calc(100dvh - 24px);border:1px solid var(--line);border-radius:var(--panel-radius);background:var(--panel);box-shadow:var(--panel-shadow);overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:var(--line) transparent}
    header{display:flex;align-items:center;gap:8px;padding:8px 12px 4px 16px;cursor:grab;touch-action:none;user-select:none}.mark{color:var(--accent);flex-shrink:0}.mark svg{width:28px;height:28px}.brand{flex:1;min-width:0}.brand strong{font-size:14px;letter-spacing:.4px;font-weight:650}.brand small{font-size:10px;color:var(--muted);margin-left:8px;letter-spacing:1px}.icon{width:44px;flex-shrink:0;padding:0;display:grid;place-items:center}.quiet{border-color:transparent;color:var(--secondary)}.icon svg{width:18px;height:18px}
    main{padding:12px 20px 20px}.status-heading{display:flex;align-items:center;gap:10px}.dot{width:7px;height:7px;background:var(--warn);border-radius:50%;flex-shrink:0}.status-heading .dot{width:9px;height:9px}h2{font-size:23px;line-height:1.3;letter-spacing:-.5px;font-weight:650;margin:0}.hint{color:var(--secondary);font-size:12px;line-height:1.7;margin:8px 0 16px;text-wrap:pretty}.route{display:flex;gap:16px;color:var(--muted);font-size:11px;margin-bottom:16px}.route span{display:flex;align-items:center;gap:6px}.route .dot{width:5px;height:5px}.route [data-ok=true]{color:var(--secondary)}.route [data-ok=true] .dot{background:var(--signal)}
    .row{display:flex;align-items:center;gap:8px}.buttons>button{flex:1;min-width:0;white-space:nowrap}.primary{background:var(--accent);color:var(--on-accent);border-color:var(--accent);font-weight:600}.primary:hover{background:var(--accent);filter:brightness(.95)}.minor{font-size:11px;font-weight:400;opacity:.8;margin-left:4px}.metrics{display:flex;align-items:baseline;gap:20px;margin-top:16px;color:var(--muted);font-size:11px}.metrics b{font-weight:600;color:var(--ink);font-size:15px;margin:0 4px;font-variant-numeric:tabular-nums}.model{margin:8px 0 0;font-size:11px;color:var(--muted);overflow-wrap:anywhere}.model span{color:var(--secondary)}
    .features{padding:0 20px 16px}.feature{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;min-height:60px;cursor:pointer}.feature+.feature{border-top:1px solid var(--line)}.feature strong{display:block;font-size:13px;font-weight:550}.feature small{display:block;font-size:11px;color:var(--secondary);margin-top:3px}.feature input{appearance:none;flex:0 0 36px;width:36px;height:22px;margin:0;padding:2px;border:1px solid var(--muted);border-radius:16px;background:var(--inset);cursor:pointer}.feature input::before{content:'';display:block;width:16px;height:16px;border-radius:50%;background:var(--muted);transition:transform .15s}.feature input:checked{background:var(--accent);border-color:var(--accent)}.feature input:checked::before{background:var(--on-accent);transform:translateX(14px)}.feature input:disabled{opacity:.45;cursor:not-allowed}.feedback{font-size:11px;color:var(--secondary);margin:4px 0 0}.feedback:empty{display:none}
    details{border-top:1px solid var(--line);padding:0 20px}summary{display:flex;align-items:center;gap:8px;min-height:48px;font-size:12px;color:var(--secondary);cursor:pointer;list-style:none}summary::-webkit-details-marker{display:none}summary::after{content:'›';font-size:20px;line-height:1;transform:rotate(90deg);color:var(--muted)}details[open]>summary::after{transform:rotate(-90deg)}summary>span{margin-left:auto;max-width:165px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:var(--muted)}
    form{margin:0;padding:0 0 16px}.field{margin-bottom:12px}.field>label{display:block;font-size:12px;color:var(--secondary);margin-bottom:6px}input:not([type=checkbox]){width:100%;min-width:0;min-height:44px;border:1px solid var(--line);border-radius:var(--control-radius);padding:10px 12px;background:var(--inset);color:var(--ink)}.field small{display:block;font-size:11px;color:var(--secondary);margin-top:6px}.field .row input{flex:1}.wide{width:100%}.error{font-size:12px;color:var(--bad);line-height:1.6;overflow-wrap:anywhere;margin:12px 0}.error:empty{display:none}.events{list-style:none;margin:0;padding:0 0 16px;max-height:192px;overflow:auto}.events li{font-size:12px;padding:8px 0;overflow-wrap:anywhere}.events li+li{border-top:1px solid var(--line)}.events time{color:var(--muted);font-size:10px;display:block;font-variant-numeric:tabular-nums;margin-bottom:2px}.empty{font-size:12px;color:var(--muted);margin:0 0 16px}.log-tools{justify-content:space-between;padding-bottom:8px}.log-tools small{font-size:11px;color:var(--muted)}.log-tools button{font-size:12px}.footer{border-top:1px solid var(--line);padding:4px 12px;display:flex;align-items:center;justify-content:space-between;gap:4px}.footer small{color:var(--muted);font-size:10px}.footer button{padding:8px;font-size:11px}.footer .row{gap:0}.note{margin:0 20px 8px;font-size:11px;color:var(--warn)}
    :host([data-compact=true]){width:max-content}.compact{pointer-events:auto;display:flex;align-items:center;gap:8px;min-height:48px;width:max-content;max-width:100%;padding:8px 14px 8px 10px;background:var(--panel);border:1px solid var(--line);border-radius:var(--control-radius);box-shadow:var(--panel-shadow);touch-action:none;user-select:none;cursor:grab}.compact svg{width:24px;height:24px;color:var(--accent)}.compact strong{font-size:12px;font-weight:600}.compact-copy{display:flex;align-items:center;gap:8px}.compact-status{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--secondary)}:host([data-dragging=true]) header,:host([data-dragging=true]) .compact{cursor:grabbing}:host([data-busy=true]) #signal,:host([data-busy=true]) .compact .dot{animation:pulse 1.6s ease-in-out infinite}@keyframes pulse{50%{opacity:.35}}
    :host([data-detached=true]){position:static!important;display:block;width:100%!important;max-width:none!important;height:100%;pointer-events:auto;background:var(--panel)}:host([data-detached=true]) article{height:100%;max-height:100dvh!important;border:0;border-radius:0;box-shadow:none}:host([data-detached=true]) header{cursor:default;touch-action:auto}:host([data-detached=true]) #fold,:host([data-detached=true]) #move{display:none}
    @media(max-width:600px){:host{width:min(336px,calc(100vw - 24px))}input:not([type=checkbox]){font-size:16px}article{max-height:calc(100dvh - 24px)}}
    @media(prefers-reduced-motion:reduce){.feature input::before{transition:none}:host([data-busy=true]) #signal,:host([data-busy=true]) .compact .dot{animation:none}}
  </style>
  <article aria-label="喵喵电波控制面板">
    <header tabindex="0" aria-label="拖动标题或用方向键移动面板" title="拖动或用方向键移动"><div class="mark">${cat}</div><div class="brand"><strong>喵喵电波</strong><small>MMDB</small></div><button class="icon quiet" id="fold" aria-label="收起面板"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 12h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button></header>
    <p class="note" id="demo" hidden>界面预览 · 演示数据</p>
    <main><div class="status-heading"><i class="dot" id="signal" aria-hidden="true"></i><h2 id="headline" aria-live="polite">等待激活</h2></div><p class="hint" id="hint">点击下方按钮，在 AI Studio 发送 Meow。</p>
      <div class="route"><span id="sessionTag"><i class="dot" aria-hidden="true"></i><span id="sessionText">Google 待激活</span></span><span id="bridgeTag"><i class="dot" aria-hidden="true"></i><span id="bridgeText">本地未连接</span></span></div>
      <div class="row buttons"><button id="activate" class="primary" title="在当前标签页新建对话并发送 Meow"><span id="activateText">一键激活</span><span class="minor">Meow</span></button><button id="popout" title="独立显示面板，切到酒馆时继续查看">悬浮窗 ↗</button></div>
      <p class="feedback" id="windowFeedback" role="status"></p><button id="popupFallback" class="wide" hidden>改用独立小窗</button>
      <div class="error" id="error" role="status"></div>
      <div class="metrics"><span>已送达<b id="completed">0</b>次</span><span>耗时<b id="elapsed">—</b>秒</span></div>
      <p class="model" id="requestCountRow" aria-live="polite">本轮上游 <span id="requestCount">—</span> 次 · 启动累计 <span id="requestTotal">—</span> 次</p>
      <p class="model" id="modelRow" hidden>请求模型 <span id="model"></span></p>
    </main>
    <section class="features" aria-label="生成设置">
      <label class="feature" for="inputRead"><span><strong>工具读取输入</strong><small id="inputReadHint">读取最后一条用户消息，额外调用一次</small></span><input id="inputRead" type="checkbox" role="switch" aria-describedby="featureFeedback"></label>
      <label class="feature" for="inputReadSynthetic"><span><strong>合成读取记录</strong><small>省去一次输入读取请求</small></span><input id="inputReadSynthetic" type="checkbox" role="switch" aria-describedby="syntheticFeedback"></label>
      <p class="feedback" id="syntheticFeedback">先开启工具读取输入。</p>
      <label class="feature" for="nativeContinuation"><span><strong>原生续写</strong><small>支持的抗截断模型自动接续长回复</small></span><input id="nativeContinuation" type="checkbox" role="switch" aria-describedby="featureFeedback"></label>
      <p class="feedback" id="featureFeedback" role="status"></p>
    </section>
    <details id="settings"><summary>连接设置</summary>
      <form id="keyForm"><div class="field"><label for="apiKey">反代密钥</label><div class="row"><input id="apiKey" type="password" autocomplete="off" spellcheck="false"><button type="button" class="quiet" id="reveal" aria-label="显示密钥" aria-pressed="false">显示</button></div></div><div class="field"><label for="base">本机 API 地址</label><div class="row"><input id="base" readonly><button type="button" id="copy">复制</button></div></div><button class="wide" type="submit">保存密钥</button></form>
      <button class="wide" id="connect">重新连接本地服务</button><p class="hint">手机酒馆请填写电脑的局域网地址。</p><p class="hint" id="themeHelp"></p>
      <label class="feature" for="keepAlive"><span><strong>后台保活</strong><small>默认开启，减少切到酒馆后的后台暂停</small></span><input id="keepAlive" type="checkbox" role="switch" aria-describedby="keepAliveFeedback"></label><p class="feedback" id="keepAliveFeedback" style="margin-bottom:12px" role="status"></p>
    </details>
    <details id="log"><summary>最近活动<span id="activityCount">暂无记录</span></summary><div class="row log-tools"><small>仅保留最近 40 条</small><button class="quiet" id="clearLog">清空</button></div><p class="empty" id="emptyLog">连接与生成记录会显示在这里。</p><ol class="events" id="events"></ol></details>
    <footer class="footer"><small>v${MMDB_VERSION}</small><div class="row"><button class="quiet" id="move">移位</button><button class="quiet" id="wake" title="防止屏幕熄灭；后台运行请使用连接设置中的后台保活" aria-pressed="false">常亮 关</button><button class="quiet" id="theme">深色</button></div></footer>
  </article>
  <button class="compact" id="unfold" aria-label="展开喵喵电波面板" title="点击展开，拖动移动位置" aria-expanded="false" hidden>${cat}<span class="compact-copy"><strong>喵喵电波</strong><span class="compact-status"><i class="dot" aria-hidden="true"></i><span id="compactText">待激活</span></span></span></button>`;
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
  document.documentElement.append(host);
  const el=id=>root.getElementById(id),view={...initial},events=[];
  let theme=initial.theme??'dark';
  let themeMode=['tavern','light','dark'].includes(initial.themeMode)?initial.themeMode:'tavern';
  host.setAttribute('theme',theme);
  el('apiKey').value=initial.apiKey??'mmdb';
  el('base').value=initial.baseURL??'http://127.0.0.1:8765/v1';
  const positioning=attachPanelPosition(host,[root.querySelector('header'),el('unfold')],{position:initial.position,save:position=>actions.savePosition?.(position),tap:handle=>{if(handle!==el('unfold'))return false;setExpanded(true,true);return true;}});
  function setExpanded(expanded,focus=false){
    host.dataset.compact=String(!expanded);root.querySelector('article').hidden=!expanded;el('unfold').hidden=expanded;
    el('unfold').setAttribute('aria-expanded',String(expanded));positioning.place();
    if(focus)el(expanded?'fold':'unfold').focus();
  }
  const pageWindow=initial.pageWindow??window;
  function renderWindowControls(detached,kind=getPanelWindowMode(pageWindow)){
    const inline=kind==='inline';
    el('popout').textContent=kind==='video-pip'?(detached?'关闭画中画':'画中画 ↗'):detached?'收回面板 ↙':inline?'页内悬浮':'悬浮窗 ↗';
    el('popout').setAttribute('aria-pressed',String(detached));
    el('popout').title=kind==='video-pip'?(detached?'关闭画中画，保留页内面板':'以视频画中画显示反代实时状态'):detached?'将面板收回 AI Studio 页面':inline?'收为可拖动的页内状态条':'独立显示面板，切到酒馆时继续查看';
    el('windowFeedback').textContent=kind==='video-pip'?(detached?'画中画已开启 · 返回桌面或酒馆，保留 AI Studio 页面。':'画中画使用本地状态视频，操作请返回本页面。'):detached?(kind==='pip'?'已置顶 · AI Studio 页面请保持打开':'独立小窗 · 需保持可见，不自动置顶'):inline?statusPipSupport(pageWindow).reason+' 可继续使用后台保活。':'';
    el('popupFallback').hidden=true;
  }
  const floating=createPanelWindow(host,{screen:pageWindow,status:()=>view,activity:()=>actions.resume?.(),changed:(detached,kind)=>{
    renderWindowControls(detached,kind);
    setExpanded(kind!=='inline');
    el(kind==='inline'?'unfold':'popout').focus();
    actions.resume?.();
  }});
  renderWindowControls(false);
  async function openWindow(popup=false){
    if(floating.videoActive){await floating.closeVideo();return;}
    if(host.dataset.detached==='true'){floating.restore();return;}
    el('popout').disabled=true;el('windowFeedback').textContent='正在打开小窗…';
    try{await floating.open({popup});}
    catch(error){
      if(getPanelWindowMode(pageWindow,{popup:true})==='inline'){
        renderWindowControls(false);
        setExpanded(true);
        el('windowFeedback').textContent=`${error.message} 已保留页内面板，可再次尝试。`;
      }else{el('windowFeedback').textContent='悬浮窗未能打开，可尝试独立小窗。';el('popupFallback').hidden=false;}
    }finally{el('popout').disabled=false;}
  }
  el('popout').onclick=()=>openWindow();el('popupFallback').onclick=()=>openWindow(true);
  el('move').onclick=()=>positioning.cycle();
  el('fold').onclick=()=>setExpanded(false,true);el('unfold').onclick=()=>setExpanded(true,true);
  setExpanded(!(initial.compact??window.matchMedia('(max-width:600px)').matches));
  el('reveal').onclick=()=>{const show=el('apiKey').type==='password';el('apiKey').type=show?'text':'password';el('reveal').textContent=show?'隐藏':'显示';el('reveal').setAttribute('aria-label',show?'隐藏密钥':'显示密钥');el('reveal').setAttribute('aria-pressed',String(show));};
  el('keyForm').onsubmit=async event=>{event.preventDefault();const key=el('apiKey').value.trim();if(key.length<4){update({error:'密钥至少需要 4 个字符。'});return;}await actions.saveKey?.(key);};
  el('connect').onclick=()=>actions.reconnect?.();
  el('activate').onclick=()=>actions.activate?.();
  root.addEventListener('keydown',event=>{if(event.key==='Escape'){if(el('settings').open){el('settings').open=false;el('settings').querySelector('summary').focus();}else if(host.dataset.detached!=='true')setExpanded(false,true);}});
  el('copy').onclick=async()=>{try{await (host.ownerDocument.defaultView?.navigator??navigator).clipboard.writeText(el('base').value);el('copy').textContent='已复制';}catch{el('base').focus();el('base').select();el('copy').textContent='请复制';}};
  function applyTheme(){
    const shared=themeMode==='tavern'?normalizeTavernTheme(view.tavernTheme):null;
    for(const name of Object.keys(TAVERN_THEME_PROPERTIES))host.style.removeProperty(name);
    if(shared)for(const [name,value] of Object.entries(shared.values))host.style.setProperty(name,value);
    host.setAttribute('theme',shared?.scheme??(themeMode==='tavern'?theme:themeMode));
    el('theme').textContent=themeMode==='tavern'?'跟随酒馆':themeMode==='light'?'浅色':'深色';
    el('theme').title='点击切换：跟随酒馆 → 浅色 → 深色';
    el('themeHelp').textContent=themeMode==='tavern'?(shared?'外观已同步酒馆，切换酒馆美化后自动更新。':'等待酒馆主题：在同一浏览器中打开或刷新酒馆页面，并启用此脚本。'):'当前使用固定配色，可在底部切回“跟随酒馆”。';
  }
  el('theme').onclick=()=>{const modes=['tavern','light','dark'];themeMode=modes[(modes.indexOf(themeMode)+1)%3];applyTheme();actions.saveThemeMode?.(themeMode);};
  el('wake').onclick=()=>actions.toggleWake?.();
  el('keepAlive').onchange=()=>actions.setKeepAlive?.(el('keepAlive').checked);
  for(const name of ['nativeContinuation','inputRead','inputReadSynthetic'])el(name).onchange=()=>{const enabled=el(name).checked;update({});actions.saveExperiments?.({[name]:enabled});};
  function renderEvents(){
    el('events').replaceChildren(...events.map(item=>{const li=document.createElement('li'),time=document.createElement('time');time.textContent=item.time;li.append(time,document.createTextNode(item.message));return li;}));
    el('activityCount').textContent=events.length?`${events.length} 条`:'暂无记录';el('emptyLog').hidden=events.length>0;el('clearLog').disabled=!events.length;
  }
  function addEvent(message){if(!message||events[0]?.message===message)return;events.unshift({message,time:new Date().toLocaleTimeString('zh-CN',{hour12:false})});events.length=Math.min(events.length,40);renderEvents();}
  el('clearLog').onclick=()=>{events.length=0;renderEvents();};
  function update(patch){
    Object.assign(view,patch);
    if(Object.hasOwn(patch,'tavernTheme'))applyTheme();
    const connected=view.link==='connected',ready=view.session===true,busy=!!view.busy,activating=!!view.activating;
    el('bridgeTag').dataset.ok=String(connected);el('sessionTag').dataset.ok=String(ready);
    el('bridgeText').textContent=`本地${connected?'已连接':view.link==='connecting'?'连接中':'未连接'}`;
    el('sessionText').textContent=`Google ${ready?'已就绪':'待激活'}`;
    el('headline').textContent=activating?'正在激活':busy?'正在生成':view.error?'需要处理':!ready?'等待激活':connected?'可以开始 RP':'等待本地连接';
    const phaseHint={body:'正在将回复送达酒馆。','network-retry':'连接中断，正在重试。',preparing:'正在准备本轮请求。',proof:'正在验证会话。','request-sent':'等待 Google 响应。',headers:'等待回复内容。',streaming:'正在接收回复，可在酒馆停止。'};
    el('hint').textContent=activating?'正在新建对话并发送 Meow，请稍候。':busy?(phaseHint[view.phase]??'可在酒馆停止生成。'):!ready?'新建 AI Studio 对话并发送 Meow。':!connected?'启动本地服务后重连。':'连接已就绪，随时回到你的故事。';
    el('activateText').textContent=activating?'激活中…':ready?'重新激活':'一键激活';
    el('activate').disabled=busy||activating;
    el('activate').classList.toggle('primary',!ready);
    el('popout').classList.toggle('primary',ready);
    el('signal').style.background=view.error?'var(--bad)':connected&&ready?'var(--signal)':'var(--warn)';
    el('connect').disabled=busy||activating||!ready;
    el('keyForm').querySelector('button[type=submit]').disabled=busy||activating;
    el('completed').textContent=String(view.completed??0);el('elapsed').textContent=view.elapsed==null?'—':String(Math.floor(view.elapsed));
    el('requestCount').textContent=Number.isSafeInteger(view.requestCounts?.total)?String(view.requestCounts.total):'—';
    el('requestTotal').textContent=Number.isSafeInteger(view.requestTotals?.total)?String(view.requestTotals.total):'—';
    el('requestCountRow').title='仅统计本后台观测到的生成请求（含失败、重试、续写和能力探测）。不含 Meow 与网页手动生成；累计在后台重启后归零。';
    el('model').textContent=view.model??'';el('modelRow').hidden=!view.model;el('error').textContent=view.error??'';
    el('compactText').textContent=activating?'激活中':busy?`${Math.floor(view.elapsed??0)}s · 生成中`:view.error?'需处理':!ready?'待激活':connected?'已就绪':'未连接';
    el('unfold').querySelector('.dot').style.background=el('signal').style.background;
    if(view.wake!==undefined){el('wake').setAttribute('aria-pressed',String(view.wake));el('wake').textContent=`常亮 ${view.wake?'开':'关'}`;}
    el('keepAlive').checked=view.keepAliveEnabled!==false;
    el('keepAliveFeedback').textContent=view.keepAliveEnabled===false?'已关闭后台保活。':({active:'后台保活运行中。',starting:'正在启动后台保活…',unsupported:'此浏览器不支持后台保活，请保持 AI Studio 窗口可见。',unavailable:'后台保活暂不可用，将自动重试；可保持 AI Studio 窗口可见。'}[view.keepAliveState]??'默认随页面启用。');
    host.dataset.busy=String(busy||activating);el('demo').hidden=!view.demo;
    const features=view.experiments;
    for(const name of ['nativeContinuation','inputRead','inputReadSynthetic']){
      el(name).checked=features?.settings?.[name]===true;
      el(name).disabled=!connected||!features?.availability?.[name]?.available||busy||activating||!!features?.busy||!!view.experimentSaving||(name==='inputReadSynthetic'&&features?.settings?.inputRead!==true);
    }
    el('inputReadHint').textContent=features?.settings?.inputReadSynthetic===true?'本地提供本轮输入，不额外发起读取请求':'读取最后一条用户消息，额外调用一次';
    el('syntheticFeedback').textContent=!features?.settings?.inputRead?'先开启工具读取输入。':features?.settings?.inputReadSynthetic?'已开启：通常每轮只请求一次，续写另计。':'开启后省去读取请求，保留工具结果格式。';
    el('featureFeedback').textContent=view.experimentSaving?'正在保存…':view.experimentError||(!connected?'连接后可修改':!features?'请更新本地服务':busy||features.busy?'生成结束后可修改':'');
  }
  update(initial);applyTheme();renderEvents();
  return {update,addEvent,host,destroy:()=>{floating.destroy();positioning.destroy();host.remove();}};
}

// Observed HTTP attempts and provider token counters are separate measurements.
export function generationDiagnosticText(value){
  const usage=value?.usage,parts=[];
  for(const [key,label] of [['promptTokenCount','输入'],['thoughtsTokenCount','思考'],['candidatesTokenCount','输出']])if(Number.isSafeInteger(usage?.[key])&&usage[key]>=0)parts.push(`${label} ${usage[key]}`);
  const rounds=Number.isSafeInteger(value?.rounds)&&value.rounds>0?`续写 ${value.rounds} 次`:'';
  const counts=value?.requestCounts;
  const requests=Number.isSafeInteger(counts?.total)?`上游 ${counts.total} 次（读取 ${counts.inputRead??0} / 正文 ${counts.answer??0} / 续写 ${counts.continuation??0} / 重试 ${counts.retry??0}）`:'';
  const mode=value?.inputReadMode==='synthetic'?'合成读取':value?.inputReadMode==='real'?'真实读取':'';
  return [requests,mode,parts.length?parts.join(' / ')+' token':'',rounds].filter(Boolean).join(' · ');
}

// Position against the visible viewport, including the mobile soft keyboard.
// Store normalized coordinates so a saved desktop position cannot strand the
// control off-screen after rotation or when opening the page on a phone.
export function attachPanelPosition(host,handles,{position,save=()=>{},tap=()=>false,screen=window}={}) {
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
  const place=()=>{if(host.dataset.detached==='true')return;const b=bounds();write(b.left+b.width*anchor.x,b.top+b.height*anchor.y);};
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
      if(host.dataset.detached==='true'||event.isPrimary===false||event.button!==0||drag)return;
      const control=event.target.closest?.('button,input,select,textarea,a,summary');if(control&&control!==handle)return;
      const rect=host.getBoundingClientRect();
      drag={id:event.pointerId,handle,x:event.clientX,y:event.clientY,left:rect.left,top:rect.top,anchor:{...anchor},moved:false};
    });
    on(handle,'lostpointercapture',event=>{if(event.target===handle)finish(event,true);});
    on(handle,'click',event=>{if(handle===suppressedHandle&&Date.now()<suppressClickUntil){event.preventDefault();event.stopImmediatePropagation();}},true);
    on(handle,'keydown',event=>{
      if(host.dataset.detached==='true'||event.target!==handle||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;
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
