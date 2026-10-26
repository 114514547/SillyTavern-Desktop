'use strict';
const {contextBridge,ipcRenderer}=require('electron');
// Available only on the bundled launcher, never on the SillyTavern web page.
contextBridge.exposeInMainWorld('desktop',Object.freeze({
  state:()=>ipcRenderer.invoke('launcher:state'),
  discover:()=>ipcRenderer.invoke('launcher:discover'),
  choose:()=>ipcRenderer.invoke('launcher:choose'),
  inspect:options=>ipcRenderer.invoke('launcher:inspect',options),
  plan:()=>ipcRenderer.invoke('launcher:plan'),
  run:mode=>ipcRenderer.invoke('launcher:run',mode),
  retry:()=>ipcRenderer.invoke('launcher:retry'),
  openUpdates:()=>ipcRenderer.invoke('launcher:updates'),
  profile:id=>ipcRenderer.invoke('launcher:profile',id),
  restore:()=>ipcRenderer.invoke('launcher:restore'),
  openData:()=>ipcRenderer.invoke('launcher:open-data'),
  copyLogs:()=>ipcRenderer.invoke('launcher:copy-logs'),
  onStatus:callback=>{ipcRenderer.on('launcher:status',(_e,s)=>callback(s));}
}));
