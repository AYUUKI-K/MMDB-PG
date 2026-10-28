// A local, silent video status card for browsers without Document PiP.
// Only explicit status fields are painted: never prompts, responses or credentials.
export function supportsStatusPip(screen=window) {
  return screen.document?.pictureInPictureEnabled===true
    && typeof screen.HTMLVideoElement?.prototype?.requestPictureInPicture==='function'
    && typeof screen.HTMLCanvasElement?.prototype?.captureStream==='function';
}

export function createStatusPip({screen=window,status=()=>({}),changed=()=>{}}={}) {
  const doc=screen.document;
  let resource=null,disposed=false,opening=false,active=false;
  function paint() {
    if(!resource)return;
    const {canvas,context:c}=resource,s=status();
    c.fillStyle='#24292d';c.fillRect(0,0,canvas.width,canvas.height);
    c.font='600 24px "Segoe UI",sans-serif';c.fillStyle='#c1cbd2';c.fillText('MEWO-FM / 喵喵电波',28,44);
    c.font='600 36px "Segoe UI",sans-serif';c.fillStyle=s.error?'#f1a1a6':'#e2e7e9';
    c.fillText(s.error?'需要检查页面':s.activating?'正在激活':s.busy?'正在生成':s.session&&s.link==='connected'?'已就绪':'等待连接',28,105);
    c.font='22px "Segoe UI",sans-serif';c.fillStyle='#c1cbd2';
    c.fillText(`本地 ${s.link==='connected'?'已连接':s.link==='connecting'?'连接中':'未连接'} · Google ${s.session?'已激活':'待激活'}`,28,151);
    const seconds=Number.isFinite(s.elapsed)?Math.max(0,Math.floor(s.elapsed)):0;
    c.fillText(`耗时 ${seconds} 秒 · 已送达 ${Number.isSafeInteger(s.completed)?s.completed:0} 次`,28,190);
    c.font='18px "Segoe UI",sans-serif';c.fillStyle='#a2afb8';
    c.fillText(s.keepAliveEnabled===false?'后台保活已关闭':s.keepAliveState==='active'?'后台保活运行中':'请保持 AI Studio 页面打开',28,235);
  }
  function release() {
    const previous=resource;resource=null;
    if(!previous)return;
    previous.cancel?.();screen.clearInterval(previous.timer);screen.clearTimeout(previous.idle);
    previous.video.removeEventListener('leavepictureinpicture',leave);
    previous.video.pause();previous.video.srcObject=null;
    for(const track of previous.stream.getTracks())track.stop();
    previous.video.remove();
  }
  function leave(){active=false;release();if(!disposed)changed(false,'video-pip');}
  function prepare() {
    if(disposed||resource||!supportsStatusPip(screen))return;
    const canvas=doc.createElement('canvas');canvas.width=480;canvas.height=270;
    const context=canvas.getContext('2d');
    if(!context)throw Error('无法创建画中画状态卡。');
    const stream=canvas.captureStream(1),video=doc.createElement('video');
    resource={canvas,context,stream,video};
    video.muted=true;video.playsInline=true;video.autoplay=true;
    video.setAttribute('aria-hidden','true');video.tabIndex=-1;
    video.style.cssText='position:fixed;left:-10000px;top:0;width:2px;height:2px;pointer-events:none;';
    video.addEventListener('leavepictureinpicture',leave);
    try{
      doc.documentElement.append(video);video.srcObject=stream;paint();
      resource.timer=screen.setInterval(paint,1000);
      resource.idle=screen.setTimeout(()=>{if(!opening&&!active)release();},10000);
      // Muted playback may preload metadata; its promise must not delay a click.
      Promise.resolve(video.play()).catch(()=>{});
    }catch(error){release();throw error;}
  }
  async function open() {
    if(disposed||opening||active)return;
    opening=true;
    try{
      if(!supportsStatusPip(screen))throw Error('此浏览器未开放视频画中画，请使用支持画中画的安卓浏览器并开启系统画中画权限。');
      prepare();const current=resource,{video}=current;
      if(video.readyState<1)await new Promise((resolve,reject)=>{
        const done=error=>{screen.clearTimeout(timer);video.removeEventListener('loadedmetadata',loaded);video.removeEventListener('error',failed);current.cancel=null;error?reject(error):resolve();};
        const loaded=()=>done(),failed=()=>done(Error('状态视频未能加载，请重试。'));
        const timer=screen.setTimeout(()=>done(Error('状态卡尚未就绪，请再次点击画中画。')),2500);
        current.cancel=()=>done(Error('画中画已关闭。'));
        video.addEventListener('loadedmetadata',loaded);video.addEventListener('error',failed);
      });
      if(disposed||resource!==current)return;
      // Request in the user's activation scope, without awaiting play().
      Promise.resolve(video.play()).catch(()=>{});
      await video.requestPictureInPicture();
      if(disposed||resource!==current){
        if(doc.pictureInPictureElement===video)await doc.exitPictureInPicture();
        return;
      }
      if(doc.pictureInPictureElement!==video){leave();return;}
      active=true;changed(true,'video-pip');
    }catch(error){
      release();
      if(!disposed)throw Error(({
        NotAllowedError:'画中画未获允许，请再次点击；仍失败时开启浏览器的系统画中画权限。',
        NotSupportedError:'此浏览器无法将状态视频放入画中画，请更换支持的浏览器。',
        SecurityError:'画中画被浏览器或页面策略拦截，请检查浏览器权限。',
        InvalidStateError:'状态视频尚未就绪，请再次点击画中画。',
      })[error.name]??error.message);
    }finally{opening=false;}
  }
  async function close() {
    const video=resource?.video;active=false;
    // Do not exit an unrelated video player's PiP.
    let exiting;
    try{if(video&&doc.pictureInPictureElement===video)exiting=doc.exitPictureInPicture();}catch{}
    release();if(!disposed)changed(false,'video-pip');
    try{await exiting;}catch{}
  }
  const unload=()=>destroy();screen.addEventListener('pagehide',unload);
  function destroy(){disposed=true;void close();screen.removeEventListener('pagehide',unload);}
  return {open,close,prepare,refresh:paint,destroy,get active(){return active;}};
}
