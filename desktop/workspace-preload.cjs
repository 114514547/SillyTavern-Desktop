'use strict';
const { contextBridge, ipcRenderer } = require('electron');
// This cover is installed before the upstream page can paint. The desktop
// extension uncovers it only after its own navigation and workspaces mount.
let startupCover, startupStyle, startupTimer;
function mountStartupCover() {
  if (!document.documentElement) return false;
  startupStyle = document.createElement('style');
  startupStyle.textContent = `html{background:#0e0e11!important}body{opacity:0!important;visibility:hidden!important;pointer-events:none!important}
    #dw-startup{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;background:#0e0e11;color:#e9e9ef;font:15px/1.8 "Segoe UI","Microsoft YaHei",sans-serif;text-align:center;visibility:visible;opacity:1;pointer-events:auto}
    #dw-startup section{max-width:420px;padding:32px}#dw-startup strong{color:#c9a76b;font-size:18px;letter-spacing:.08em}#dw-startup p{margin:14px 0;color:#adb0bf}#dw-startup button{border:1px solid #282834;border-radius:7px;background:#1c1c24;color:#e9e9ef;padding:8px 18px;font:inherit;cursor:pointer}#dw-startup [hidden]{display:none!important}`;
  startupCover = document.createElement('div'); startupCover.id = 'dw-startup';
  startupCover.setAttribute('role', 'status'); startupCover.setAttribute('aria-live', 'polite');
  startupCover.innerHTML = '<section><strong>ST DESKTOP</strong><p>正在准备创作工作区…</p><button type="button" hidden>重新加载</button></section>';
  startupCover.querySelector('button').addEventListener('click', () => location.reload());
  document.documentElement.prepend(startupStyle); document.documentElement.append(startupCover);
  startupTimer = setTimeout(() => {
    startupCover.querySelector('p').textContent = '工作区仍在加载。可以继续等待；若长时间没有变化，请重新加载。';
    startupCover.querySelector('button').hidden = false;
  }, 45000);
  return true;
}
const startupObserver = new MutationObserver(() => { if (mountStartupCover()) startupObserver.disconnect(); });
// Existing installations may require the upstream login screen before loading
// the application. Do not wait for the desktop extension on that separate page.
if (['/', '/index.html'].includes(location.pathname) && !mountStartupCover()) startupObserver.observe(document, { childList: true, subtree: true });
ipcRenderer.on('workspace:ui-ready', () => {
  clearTimeout(startupTimer); startupObserver.disconnect(); startupCover?.remove(); startupStyle?.remove();
});
// A narrow document API; no filesystem paths can grant a root from the page.
const names = ['state', 'choose', 'select', 'list', 'read', 'search', 'propose', 'proposal', 'pending', 'apply', 'history', 'restore', 'saveThread', 'deleteThread', 'removeProject', 'saveNotes', 'notesStatus', 'saveProject', 'appMenu', 'writingProtection', 'startupReady'];
contextBridge.exposeInMainWorld('localWorkspace', Object.freeze(Object.fromEntries(names.map(name => [name, value => ipcRenderer.invoke('workspace:' + name, value)]))));
