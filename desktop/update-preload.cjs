'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('updates',Object.freeze({
  state:()=>ipcRenderer.invoke('updates:state'),
  check:()=>ipcRenderer.invoke('updates:check'),
  download:()=>ipcRenderer.invoke('updates:download'),
  cancel:()=>ipcRenderer.invoke('updates:cancel'),
  install:()=>ipcRenderer.invoke('updates:install'),
  onState:callback=>ipcRenderer.on('updates:state-changed',(_event,state)=>callback(state))
}));
