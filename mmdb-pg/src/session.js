// Browser integration written for MMDB. Protocol facts: see THIRD_PARTY.md.
export class GooglePageSession {
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
  async generate(payload,signal,chunk,progress=()=>{}) {
    const check=()=>{if(signal.aborted)throw new DOMException('用户已停止生成','AbortError');};
    check();
    if(!this.ready)throw Object.assign(new Error('请先在 AI Studio 手动发送 hi，等待页面正常回复。'),{status:503,code:'session_not_ready'});
    if(!Array.isArray(payload.wire)||typeof payload.binding!=='string')throw Object.assign(new Error('本地请求格式无效'),{status:400,code:'invalid_payload'});
    const input=this.textarea();
    if(input.value.trim())throw Object.assign(new Error('AI Studio 输入框中有草稿，请先发送或自行清空。'),{status:409,code:'prompt_busy'});
    const binding=payload.binding;
    const normal=value=>value.replace(/\r\n?/g,'\n');
    let reader;
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
        new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Object.assign(new Error('等待 Google 会话验证超时，请刷新页面并发送 hi。'),{status:504,code:'proof_timeout'})),15000);}),
        new Promise((_,reject)=>{onAbort=()=>reject(new DOMException('用户已停止生成','AbortError'));signal.addEventListener('abort',onAbort,{once:true});if(signal.aborted)onAbort();})
      ]).finally(()=>{clearTimeout(timeout);if(onAbort)signal.removeEventListener('abort',onAbort);});
      check();
      if(typeof proof!=='string'||!proof.startsWith('!'))throw Object.assign(new Error('Google 会话验证未就绪，请刷新页面并发送 hi。'),{status:503,code:'invalid_proof'});
      const wire=structuredClone(payload.wire);wire[4]=proof;
      progress('request-sent');
      const requestStarted=performance.now();
      let response;
      try { response=await this.fetch(this.endpoint ?? 'https://alkalimakersuite-pa.clients6.google.com/$rpc/google.internal.alkali.applications.makersuite.v1.MakerSuiteService/GenerateContent', {method:'POST',credentials:'include',headers:{...this.headers,'content-type':'application/json+protobuf'},body:JSON.stringify(wire),signal}); }
      catch(error){
        check();
        if(error?.name==='TypeError')throw Object.assign(new Error('浏览器到 Google 的请求连接失败，尚未收到响应头。请检查网络或代理连接。'),{status:502,code:'upstream_connection_failed',failurePhase:'before-headers',requestWaitMs:Math.max(0,Math.round(performance.now()-requestStarted))});
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
      // Never erase text the user changed while the request was running.
      if(normal(input.value)===normal(binding))this.fill(input,'');
    }
  }
  destroy(){clearInterval(this.watch);for(const undo of this.restore.reverse())undo();}
}
