// Install page observers as soon as the document root exists, before the app
// caches its request helpers. Do not wait for DOMContentLoaded to install hooks.
export function bootBridge(start, documentNode = document, schedule = setTimeout) {
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
