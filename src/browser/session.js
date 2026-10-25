// Browser integration written for MMDB. Protocol facts: see THIRD_PARTY.md.
export class GooglePageSession {
  constructor(page, changed, report = () => {}, readAccountEmail = () => null) {
    this.page = page; this.changed = changed; this.headers = {}; this.proofOK = false; this.contextVersion = 0;
    this.readAccountEmail=readAccountEmail;this.accountEmail=null;
    this.requestCount=0;this.proofCount=0;this.proofMode='signed';this.nativeProofMode=null;
    const notices = new Set();
    this.report = message => { if (!notices.has(message)) { notices.add(message); report(message); } };
    this.fetch = page.fetch.bind(page); this.restore = [];
    const target = url => { try { const u = new URL(url, page.location.href); return u.origin === 'https://alkalimakersuite-pa.clients6.google.com' && !u.username && !u.password && u.pathname === '/$rpc/google.internal.alkali.applications.makersuite.v1.MakerSuiteService/GenerateContent' ? u.href : null; } catch { return null; } };
    const record = (url, headers, body) => {
      const endpoint=target(url);if (!endpoint) return;
      this.requestCount++;
      this.nativeProofMode=null;
      // The current page may intentionally disable WAA and return an empty
      // proof. Accept that mode only after observing it on a native request,
      // never from a local preference or a guessed fallback after failure.
      if(typeof body==='string'&&body.length<=4*1024*1024)try{
        const wire=JSON.parse(body);
        if(Array.isArray(wire)&&typeof wire[0]==='string'&&wire[0].startsWith('models/')&&Array.isArray(wire[1])&&(wire[4]===''||wire[4]==null))this.nativeProofMode='optional';
      }catch{}
      const incoming = new page.Headers(headers ?? {});
      const current={};
      // Preserve the actual page's benefit tier and visit context along with
      // its authentication. Never invent a tier or merge a previous account.
      for (const [name,value] of incoming) if (['authorization','x-client-data','x-user-agent','x-same-domain'].includes(name) || name.startsWith('x-goog-') || name.startsWith('x-aistudio-')) current[name] = value;
      const accountEmail=this.readAccountEmail();
      if(JSON.stringify(current)!==JSON.stringify(this.headers)||this.endpoint!==endpoint||accountEmail!==this.accountEmail)this.contextVersion++;
      this.accountEmail=accountEmail;
      this.headers=current;this.endpoint=endpoint;
      this.changed(this.ready);
    };
    const original = page.fetch;
    const wrapper = function(input, options) {
      try { record(typeof input === 'string' ? input : input?.url ?? input?.href, options?.headers ?? input?.headers,options?.body); }
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
      const patchedSend = function(body) { const entry=requests.get(this); try { if(entry)record(entry.url,entry.headers,body); } catch { session.report('页面请求头暂未识别；页面原请求将继续发送'); } return send.apply(this,arguments); };
      proto.open=patchedOpen;proto.setRequestHeader=patchedHeader;proto.send=patchedSend;
      this.restore.push(()=>{if(proto.open===patchedOpen)proto.open=open;if(proto.setRequestHeader===patchedHeader)proto.setRequestHeader=setHeader;if(proto.send===patchedSend)proto.send=send;});
    }
    this.watch = setInterval(()=>this.discover(),100); this.discover();
  }
  get ready() { return this.proofOK && !!this.service && !!this.headers['x-goog-api-key'] && (!this.accountEmail||this.readAccountEmail()===this.accountEmail) && (this.proofMode!=='optional'||this.nativeProofMode==='optional'); }
  discover() {
    if(this.hooked)return;
    const exports = this.page.default_MakerSuite;
    if(!exports)return;
    // Use the page function's own toString across the userscript/page boundary.
    // The sandbox Function.prototype may only describe a native proxy wrapper.
    const matches=Object.keys(exports).filter(key=>{try {const fn=exports[key];if(typeof fn!=='function')return false;const code=fn.toString();return /\.snapshot\s*\(/.test(code)&&code.includes('content')&&code.includes('yield');}catch{return false;}});
    if(!matches.length)return;
    const session=this;
    // Observe all matching exports (including aliases); use the one the page
    // actually calls and validates instead of requiring one unique match.
    for(const key of matches){
      const original=exports[key];
      const interceptor=function(...args) {
        const context=this, service=args[0];
        const output=original.apply(context,args);
        Promise.resolve(output).then(proof=>{
          const valid=typeof proof==='string'&&(proof.startsWith('!')||proof==='')&&service!=null;
          if(valid){session.service=service;session.snapshot=digest=>original.call(context,service,digest);session.proofMode=proof===''?'optional':'signed';session.proofOK=true;session.proofCount++;session.changed(session.ready);}
          else session.report('页面未返回有效会话验证，请确认本页能正常生成');
        },()=>session.report('本次页面会话验证失败，请稍后再试'));
        return output;
      };
      exports[key]=interceptor;
      this.restore.push(()=>{if(exports[key]===interceptor)exports[key]=original;});
    }
    this.hooked=true;
    clearInterval(this.watch);
  }
  textarea() {
    const inputs=Array.from(document.querySelectorAll('ms-prompt-box textarea')).filter(el=>el.getClientRects().length && getComputedStyle(el).visibility!=='hidden');
    if(inputs.length!==1)throw Object.assign(new Error('找不到唯一的 AI Studio 输入框，请回到 Playground 新对话。'),{status:503,code:'prompt_unavailable'});
    return inputs[0];
  }
  fill(input,value) {
    const setter=Object.getOwnPropertyDescriptor(this.page.HTMLTextAreaElement.prototype,'value')?.set;
    if(!setter)throw new Error('浏览器不支持输入框同步');
    setter.call(input,value);
    input.dispatchEvent(new this.page.Event('input',{bubbles:true}));
    input.dispatchEvent(new this.page.Event('change',{bubbles:true}));
  }
  runButton(input) {
    const buttons=Array.from(input.closest('ms-prompt-box')?.querySelectorAll('ms-run-button button')??[]).filter(el=>el.getClientRects().length);
    if(buttons.length!==1)throw new Error('未找到发送按钮，请回到 AI Studio Playground。');
    return buttons[0];
  }
  isRun(button) {return /^(Run|运行|发送)$/.test(button.querySelector('.run-button-label')?.textContent?.trim()??'');}
  async newConversation(signal,{timeoutMs=15000,pollMs=100}={}) {
    const check=()=>{if(signal?.aborted)throw new DOMException('已停止激活','AbortError');};
    check();
    const input=this.textarea();
    if(input.value.trim())throw new Error('AI Studio 输入框有未发送的草稿，请先处理草稿。');
    if(input.disabled||!this.isRun(this.runButton(input)))throw new Error('AI Studio 正在生成，请结束后再激活。');
    const empty=()=>/\/prompts\/new_chat\/?$/.test(new URL(this.page.location.href).pathname)&&document.querySelectorAll('ms-chat-turn').length===0;
    if(empty())return;
    // Use the native SPA action: no reload, new browser tab, or history deletion.
    const buttons=Array.from(document.querySelectorAll('ms-header button[data-test-clear="outside"]')).filter(el=>el.getClientRects().length&&el.getAttribute('aria-disabled')!=='true'&&!el.disabled);
    if(buttons.length!==1)throw new Error('未找到新建对话按钮，请先在 AI Studio 新建对话。');
    buttons[0].click();
    const deadline=Date.now()+timeoutMs;
    for(;;){
      check();
      if(empty()){
        let next;try{next=this.textarea();}catch{}
        if(next){
          if(next.value.trim())throw new Error('新对话中已有草稿，已取消自动发送。');
          if(!next.disabled&&this.isRun(this.runButton(next)))return;
        }
      }
      if(Date.now()>=deadline)throw new Error('未能新建对话，请处理 AI Studio 页面提示后重试。');
      await new Promise(resolve=>setTimeout(resolve,pollMs));
    }
  }
  async activate(signal,{timeoutMs=60000,pollMs=100}={}) {
    if(this.activating)throw new Error('正在激活，请稍候。');
    this.discover();
    if(!this.hooked)throw new Error('AI Studio 仍在加载，请稍后再点激活。');
    this.activating=true;
    try{await this.newConversation(signal,{timeoutMs:Math.min(timeoutMs,15000),pollMs});}
    catch(error){this.activating=false;throw error;}
    let input;
    try{input=this.textarea();}catch(error){this.activating=false;throw error;}
    const original=input.value;
    if(original.trim()){this.activating=false;throw new Error('AI Studio 输入框有未发送的草稿，请先处理草稿。');}
    // Verified against the live Playground on 2026-10-25. Scope to this prompt
    // box, so an old turn's rerun button can never be clicked accidentally.
    const button=()=>this.runButton(input),isRun=el=>this.isRun(el);
    const available=el=>!el.disabled&&el.getAttribute('aria-disabled')!=='true';
    const requests=this.requestCount,proofs=this.proofCount,deadline=Date.now()+timeoutMs;
    let sent=false;
    const check=()=>{
      if(signal?.aborted)throw new DOMException('已停止激活','AbortError');
      if(this.textarea()!==input)throw new Error('AI Studio 页面已变化，请重新激活。');
      if(Date.now()>=deadline)throw new Error('激活等待超时，请检查 AI Studio 是否完成回复。');
    };
    try {
      if(input.disabled||!isRun(button()))throw new Error('AI Studio 正在生成，请结束后再激活。');
      check();this.fill(input,'Meow');
      for(;;){
        check();
        if(input.value!=='Meow')throw new Error('输入内容已变化，已取消发送。');
        const run=button();
        if(!isRun(run))throw new Error('页面已开始生成，请稍后再激活。');
        if(available(run)){run.click();sent=true;break;}
        await new Promise(resolve=>setTimeout(resolve,pollMs));
      }
      for(;;){
        check();
        if(this.requestCount>requests&&this.proofCount>proofs&&this.ready&&isRun(button())&&!input.disabled)return;
        await new Promise(resolve=>setTimeout(resolve,pollMs));
      }
    } finally {
      this.activating=false;
      if(!sent&&input.value==='Meow')this.fill(input,original);
    }
  }
  async listModels(signal) {
    if(!this.ready||!this.endpoint)throw new Error('模型目录需要已就绪的页面会话');
    const revision=this.contextVersion,url=new URL(this.endpoint);
    url.pathname=url.pathname.replace(/\/GenerateContent$/,'/ListModels');
    const response=await this.fetch(url.href,{method:'POST',credentials:'include',headers:{...this.headers,'content-type':'application/json+protobuf'},body:'[]',signal});
    if(!response.ok||!response.body)throw new Error('模型目录请求失败');
    const reader=response.body.getReader(),decoder=new TextDecoder();let raw='',bytes=0,complete=false;
    try {
      for(;;){const {done,value}=await reader.read();if(done){complete=true;break;}bytes+=value.byteLength;if(bytes>1024*1024)throw new Error('模型目录过大');raw+=decoder.decode(value,{stream:true});}
      raw+=decoder.decode();
      if(signal.aborted||revision!==this.contextVersion)throw new Error('页面会话已变化');
      return raw;
    }finally{if(!complete)await reader.cancel().catch(()=>{});reader.releaseLock();}
  }
  async generate(payload,signal,chunk,progress=()=>{}) {
    const revision=this.contextVersion;
    const check=()=>{if(signal.aborted)throw new DOMException('用户已停止生成','AbortError');if(revision!==this.contextVersion||(this.accountEmail&&this.readAccountEmail()!==this.accountEmail))throw Object.assign(new Error('页面账号或请求上下文已变化，请重新发起生成'),{status:409,code:'session_changed'});};
    check();
    if(!this.ready)throw Object.assign(new Error('请先点击面板的一键激活，等待 AI Studio 完成回复。'),{status:503,code:'session_not_ready'});
    if(!Array.isArray(payload.wire)||typeof payload.binding!=='string')throw Object.assign(new Error('本地请求格式无效'),{status:400,code:'invalid_payload'});
    const input=this.textarea();
    const run=input.closest?.('ms-prompt-box')?.querySelector('ms-run-button button');
    const label=run?.querySelector('.run-button-label')?.textContent?.trim();
    if(this.activating||input.disabled||(run&&!/^(Run|运行|发送)$/.test(label??'')))throw Object.assign(new Error('AI Studio 正在生成，请结束后再从酒馆发送。'),{status:409,code:'prompt_busy'});
    if(input.value.trim())throw Object.assign(new Error('AI Studio 输入框中有草稿，请先发送或自行清空。'),{status:409,code:'prompt_busy'});
    const binding=payload.binding;
    const normal=value=>value.replace(/\r\n?/g,'\n');
    let reader,complete=false;
    try {
      this.fill(input,binding);
      if(normal(input.value)!==normal(binding))throw Object.assign(new Error('输入框内容未能同步'),{status:503,code:'prompt_sync_failed'});
      check();
      const bytes=await this.page.crypto.subtle.digest('SHA-256',new TextEncoder().encode(binding));
      const digest=Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
      check();
      progress('proof');
      let timeout,onAbort;
      const proof=await Promise.race([
        this.snapshot(digest),
        new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Object.assign(new Error('等待 Google 会话验证超时，请刷新页面后点击一键激活。'),{status:504,code:'proof_timeout'})),15000);}),
        new Promise((_,reject)=>{onAbort=()=>reject(new DOMException('用户已停止生成','AbortError'));signal.addEventListener('abort',onAbort,{once:true});if(signal.aborted)onAbort();})
      ]).finally(()=>{clearTimeout(timeout);if(onAbort)signal.removeEventListener('abort',onAbort);});
      check();
      if(typeof proof!=='string'||!(proof.startsWith('!')||(proof===''&&this.proofMode==='optional'&&this.nativeProofMode==='optional')))throw Object.assign(new Error('Google 会话验证未就绪，请刷新页面后点击一键激活。'),{status:503,code:'invalid_proof'});
      const wire=structuredClone(payload.wire);wire[4]=proof;
      progress('request-sent');
      let response;
      try { response=await this.fetch(this.endpoint ?? 'https://alkalimakersuite-pa.clients6.google.com/$rpc/google.internal.alkali.applications.makersuite.v1.MakerSuiteService/GenerateContent', {method:'POST',credentials:'include',headers:{...this.headers,'content-type':'application/json+protobuf'},body:JSON.stringify(wire),signal}); }
      catch(error){
        check();
        if(error?.name==='TypeError')throw Object.assign(new Error('连接 Google 时中断，尚未收到响应。请检查当前网络或代理连接。'),{status:502,code:'upstream_connection_failed'});
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
          throw Object.assign(new Error(!receivedBytes?'Google 已返回响应头，但数据连接中断，尚未收到生成数据。':'接收 Google 数据时连接中断，未把不完整回复标为成功。请检查网络或代理连接。'),{status:502,code:!receivedBytes?'upstream_connection_failed':'upstream_stream_disconnected'});
        }
        check();const {done,value}=data;if(done){complete=true;break;}receivedBytes ||= value.byteLength>0;const text=decoder.decode(value,{stream:true});if(text){if(first){first=false;progress('streaming');}chunk(text);}
      }
      const tail=decoder.decode();if(tail)chunk(tail);check();
    } finally {
      if(reader){if(!complete)await reader.cancel().catch(()=>{});reader.releaseLock();}
      // Never erase text the user changed while the request was running.
      if(normal(input.value)===normal(binding))this.fill(input,'');
    }
  }
  destroy(){clearInterval(this.watch);for(const undo of this.restore.reverse())undo();}
}
