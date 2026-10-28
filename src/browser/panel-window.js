import {supportsStatusPip,createStatusPip} from './status-pip.js';
// Desktop moves the live panel. Mobile uses a silent video status card.
// Document PiP is always on top; the ordinary popup fallback is not.
export function getPanelWindowMode(screen=window, {popup=false}={}) {
  if (!popup && typeof screen.documentPictureInPicture?.requestWindow==='function') return 'pip';
  const navigator=screen.navigator??{};
  // Mobile browsers can ignore popup dimensions and open a full-size tab.
  // Include touch-only desktop-site mode, but keep popups on mouse-driven PCs.
  const mobile=navigator.userAgentData?.mobile===true
    || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent??'')
    || (navigator.maxTouchPoints>0 && screen.matchMedia?.('(pointer: coarse)').matches && screen.matchMedia?.('(hover: none)').matches);
  return mobile?(!popup&&supportsStatusPip(screen)?'video-pip':'inline'):'popup';
}

export function createPanelWindow(host, {screen=window, changed=()=>{}, activity=()=>{},status=()=>({})}={}) {
  const home=host.ownerDocument.documentElement;
  let child=null, opening=false, disposed=false;
  const video=createStatusPip({screen,status,changed});
  function restore() {
    if (!child) return;
    const previous=child;
    child=null;
    previous.removeEventListener('pagehide', restore);
    previous.removeEventListener('focus',activity);
    host.dataset.detached='false';
    if (!disposed) { home.append(host); changed(false); }
    if (!previous.closed) previous.close();
  }
  async function open({popup=false}={}) {
    if (disposed || opening) return;
    if (child && !child.closed) { child.focus(); return; }
    opening=true;
    try {
      const kind=getPanelWindowMode(screen,{popup});
      if(kind==='video-pip'){await video.open();return;}
      if (kind==='inline') { changed(false,kind); return; }
      const pip=kind==='pip';
      // Keep window creation in the click's user-activation scope.
      const target=pip
        ? await screen.documentPictureInPicture.requestWindow({width:360,height:580})
        : screen.open('', 'mmdb-panel', 'popup,width=360,height=580');
      if (!target) throw new Error('小窗被浏览器拦截，请允许此页面打开弹出窗口。');
      if (disposed) { target.close(); return; }
      child=target;
      const doc=target.document;
      doc.title='喵喵电波 · 反代状态';
      let viewport=doc.querySelector('meta[name="viewport"]');
      if (!viewport) { viewport=doc.createElement('meta');viewport.name='viewport';doc.head.append(viewport); }
      viewport.content='width=device-width,initial-scale=1';
      doc.documentElement.style.cssText='height:100%;background:transparent;';
      doc.body.style.cssText='margin:0;height:100%;overflow:hidden;';
      host.dataset.detached='true';
      doc.body.append(host);
      target.addEventListener('pagehide',restore);
      target.addEventListener('focus',activity);
      changed(true,kind);
    } catch (error) {
      restore();
      throw error;
    } finally { opening=false; }
  }
  const unload=()=>destroy();
  screen.addEventListener('pagehide',unload);
  function destroy() {
    disposed=true;
    video.destroy();
    restore();
    screen.removeEventListener('pagehide',unload);
  }
  return {open,restore,destroy,prepare:()=>{if(getPanelWindowMode(screen)==='video-pip')video.prepare();},refresh:video.refresh,closeVideo:video.close,get videoActive(){return video.active;}};
}
