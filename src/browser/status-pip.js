// Local status video: draw -> capture 1fps -> metadata -> play -> native PiP.
// This is our own status-card implementation. No fullscreen or WebView bridge.
export function statusPipSupport(screen=window) {
  const doc=screen.document;
  const api=typeof screen.HTMLVideoElement?.prototype?.requestPictureInPicture==='function'
    ||typeof doc?.createElement?.('video').requestPictureInPicture==='function';
  const capture=typeof screen.HTMLCanvasElement?.prototype?.captureStream==='function'
    ||typeof doc?.createElement?.('canvas').captureStream==='function';
  const enabled=doc?.pictureInPictureEnabled;
  // Some browsers expose the method without the optional capability flag.
  const reason=enabled===false?'浏览器报告画中画不可用或已被策略禁用。':!api?'浏览器没有提供网页画中画接口，用户脚本无法强行开启。':!capture?'浏览器不支持生成本地状态视频。':'';
  return {supported:!reason,reason,api,capture,enabled:typeof enabled==='boolean'?enabled:null};
}
export function supportsStatusPip(screen=window){return statusPipSupport(screen).supported;}

export function createStatusPip({screen=window,status=()=>({}),changed=()=>{}}={}) {
  const doc=screen.document;
  let current=null,opening=false,active=false,disposed=false,revision=0;
  function draw(frame=current){
    if(!frame)return;
    const c=frame.context,s=status(),w=frame.canvas.width,h=frame.canvas.height;
    c.fillStyle='#202b32';c.fillRect(0,0,w,h);
    c.fillStyle='#efba83';c.fillRect(24,24,5,h-48);
    c.font='600 22px "Segoe UI","Microsoft YaHei",sans-serif';c.fillText('MEWO-FM / 喵喵电波',46,48);
    c.font='600 36px "Segoe UI","Microsoft YaHei",sans-serif';c.fillStyle=s.error?'#ffa9ae':'#f0f3f5';
    c.fillText(s.error?'请检查 AI Studio':s.activating?'正在激活':s.busy?'正在生成':s.session&&s.link==='connected'?'电波已就绪':'等待连接',46,105);
    c.font='21px "Segoe UI","Microsoft YaHei",sans-serif';c.fillStyle='#c6d4dc';
    c.fillText(`本地 ${s.link==='connected'?'已连接':'未连接'} · Google ${s.session?'已激活':'待激活'}`,46,150);
    const seconds=Number.isFinite(s.elapsed)?Math.max(0,Math.floor(s.elapsed)):0;
    c.fillText(`耗时 ${seconds} 秒 · 已送达 ${Number.isSafeInteger(s.completed)?s.completed:0} 次`,46,190);
    c.font='18px "Segoe UI","Microsoft YaHei",sans-serif';c.fillStyle='#9cabb4';
    c.fillText(new Date().toLocaleTimeString('zh-CN',{hour12:false})+' · 请保留 AI Studio 页面',46,234);
  }
  function release(attempt){
    if(!attempt||attempt.released)return;
    attempt.released=true;attempt.cancel?.();attempt.removeMetadata?.();
    screen.clearInterval(attempt.timer);
    attempt.video?.removeEventListener('leavepictureinpicture',left);
    attempt.video?.removeEventListener('enterpictureinpicture',entered);
    if(attempt.video){attempt.video.pause();attempt.video.srcObject=null;attempt.video.remove();}
    for(const track of attempt.stream?.getTracks()??[])track.stop();
  }
  async function exitOwn(video){
    try{if(video&&doc.pictureInPictureElement===video)await doc.exitPictureInPicture();}catch{}
  }
  function entered(){if(current)current.entered=true;}
  function left(){if(current)void close();}
  function bounded(promise,attempt,milliseconds,message){
    return new Promise((resolve,reject)=>{
      let settled=false;
      const finish=(error,value)=>{if(settled)return;settled=true;screen.clearTimeout(timer);attempt.cancel=null;error?reject(error):resolve(value);};
      const timer=screen.setTimeout(()=>finish(Error(message)),milliseconds);
      attempt.cancel=()=>finish(Object.assign(Error('画中画已关闭'),{name:'AbortError'}));
      Promise.resolve(promise).then(value=>finish(null,value),error=>finish(error));
    });
  }
  async function metadata(attempt){
    const {video}=attempt;if(video.readyState>=1)return;
    const ready=new Promise((resolve,reject)=>{
      const loaded=()=>resolve(),failed=()=>reject(Error('状态视频无法加载。'));
      video.addEventListener('loadedmetadata',loaded);video.addEventListener('error',failed);
      attempt.removeMetadata=()=>{video.removeEventListener('loadedmetadata',loaded);video.removeEventListener('error',failed);};
    });
    try{await bounded(ready,attempt,3000,'状态视频尚未就绪，请再次点击画中画。');}
    finally{attempt.removeMetadata?.();attempt.removeMetadata=null;}
  }
  async function open(){
    if(disposed||opening||active)return;
    const support=statusPipSupport(screen);if(!support.supported)throw Error(support.reason);
    const own=++revision,attempt={};current=attempt;opening=true;
    try{
      attempt.canvas=doc.createElement('canvas');attempt.canvas.width=480;attempt.canvas.height=270;
      attempt.context=attempt.canvas.getContext('2d');if(!attempt.context)throw Error('无法绘制本地状态视频。');
      draw(attempt); // Give captureStream an initial frame before creating the track.
      attempt.stream=attempt.canvas.captureStream(1);
      const video=attempt.video=doc.createElement('video');video.muted=true;video.playsInline=true;
      video.style.cssText='position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none;';
      video.setAttribute('aria-hidden','true');video.tabIndex=-1;
      video.addEventListener('leavepictureinpicture',left);video.addEventListener('enterpictureinpicture',entered);
      video.srcObject=attempt.stream;doc.documentElement.append(video);
      await metadata(attempt);if(own!==revision||disposed)return;
      await bounded(video.play(),attempt,3000,'状态视频未能开始播放，请再次点击。');if(own!==revision||disposed)return;
      const request=video.requestPictureInPicture();
      // A native request can finish after cancellation; only close our own video.
      Promise.resolve(request).then(()=>{if(own!==revision||disposed)void exitOwn(video);},()=>{});
      await bounded(request,attempt,5000,'浏览器未完成画中画申请，请再次尝试。');
      if(own!==revision||disposed){await exitOwn(video);return;}
      if(doc.pictureInPictureElement!==video&&!attempt.entered)throw Error('浏览器没有确认画中画开启。');
      active=true;attempt.timer=screen.setInterval(()=>draw(),1000);changed(true,'video-pip');
    }catch(error){
      if(current===attempt)current=null;
      release(attempt);void exitOwn(attempt.video);
      if(own===revision&&!disposed)throw Error(error.name==='NotAllowedError'?'画中画申请被拒绝，请再次点击；仍失败时检查浏览器的系统画中画权限。':error.name==='NotSupportedError'?'此浏览器无法播放本地状态画中画，可继续使用后台保活。':error.message);
    }finally{if(own===revision)opening=false;}
  }
  async function close(){
    ++revision;opening=false;active=false;
    const previous=current;current=null;
    const video=previous?.video;
    video?.removeEventListener('leavepictureinpicture',left);
    const exiting=exitOwn(video);release(previous);
    if(!disposed)changed(false,'video-pip');await exiting;
  }
  const unload=()=>destroy();screen.addEventListener('pagehide',unload);
  function destroy(){disposed=true;void close();screen.removeEventListener('pagehide',unload);}
  return {open,close,refresh:()=>draw(),destroy,get active(){return active;}};
}
