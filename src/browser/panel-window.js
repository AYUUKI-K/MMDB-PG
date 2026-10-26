// Move the live panel, not a snapshot: controls and status keep the same owner.
// Document PiP is always on top; the ordinary popup fallback is not.
export function createPanelWindow(host, {screen=window, changed=()=>{}, activity=()=>{}}={}) {
  const home=host.ownerDocument.documentElement;
  let child=null, opening=false, disposed=false;
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
      const pip=!popup && !!screen.documentPictureInPicture?.requestWindow;
      // Keep window creation in the click's user-activation scope.
      const target=pip
        ? await screen.documentPictureInPicture.requestWindow({width:360,height:580})
        : screen.open('', 'mmdb-panel', 'popup,width=360,height=580');
      if (!target) throw new Error('小窗被浏览器拦截，请允许此页面打开弹出窗口。');
      if (disposed) { target.close(); return; }
      child=target;
      const doc=target.document;
      doc.title='喵喵电波 · 反代状态';
      doc.documentElement.style.cssText='height:100%;background:transparent;';
      doc.body.style.cssText='margin:0;height:100%;overflow:hidden;';
      host.dataset.detached='true';
      doc.body.append(host);
      target.addEventListener('pagehide',restore);
      target.addEventListener('focus',activity);
      changed(true,pip?'pip':'popup');
    } catch (error) {
      restore();
      throw error;
    } finally { opening=false; }
  }
  const unload=()=>destroy();
  screen.addEventListener('pagehide',unload);
  function destroy() {
    disposed=true;
    restore();
    screen.removeEventListener('pagehide',unload);
  }
  return {open,restore,destroy};
}
