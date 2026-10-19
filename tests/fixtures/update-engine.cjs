'use strict';
const {app,BrowserWindow,ipcMain}=require('electron');const {NsisUpdater}=require('electron-updater');
const {pathToFileURL}=require('node:url');const path=require('node:path');const fs=require('node:fs/promises');
const {Updates}=require('../../desktop/services/updates.cjs');const {trustedSender}=require('../../desktop/services/security.cjs');
const {snapshot}=require('../../desktop/services/backup.cjs');const {inspect}=require('../../desktop/services/installation.cjs');
const config=JSON.parse(require('node:fs').readFileSync(process.argv.find(value=>value.endsWith('fixture.json')),'utf8'));
app.setPath('userData',path.join(config.home,'shell'));app.getVersion=()=> '0.2.0';app.enableSandbox();
let win;
app.whenReady().then(async()=>{
  const url=pathToFileURL(path.resolve(__dirname,'../../desktop/ui/updates.html')).href;
  const updater=new Updates({version:'0.2.0',home:config.home,policy:config.policy,backend:config.backend,testFeed:config.feed,fetchText:async value=>(await fetch(value)).text(),createEngine:feed=>{
    const engine=new NsisUpdater({provider:'generic',url:feed,useMultipleRangeRequest:false});engine.forceDevUpdateConfig=true;engine.disableDifferentialDownload=true;
    const devConfig=path.join(config.home,'dev-app-update.yml');require('node:fs').writeFileSync(devConfig,'updaterCacheDirName: isolated-update-test\n');
    Object.defineProperty(engine.app,'appUpdateConfigPath',{value:devConfig});Object.defineProperty(engine.app,'baseCachePath',{value:path.join(config.home,'cache')});return engine;
  },onChange:state=>win?.webContents.send('updates:state-changed',state)});
  for(const [name,fn]of Object.entries({state:()=>updater.view(),check:()=>updater.check(),download:()=>updater.download(),cancel:()=>{updater.cancel();return updater.view();},install:()=>updater.install({prepare:async()=>{
    const i=await inspect(config.source);const backup=await snapshot(i,path.join(config.home,'backups'),()=>{},{skipExternalCheck:true});return [{root:backup.root,count:backup.manifest.count}];
  },commit:async engine=>{
    const pending=JSON.parse(await fs.readFile(path.join(config.home,'updates/pending.json'),'utf8'));
    await fs.writeFile(path.join(config.home,'result.json'),JSON.stringify({passed:engine instanceof NsisUpdater,autoInstallOnQuit:engine.autoInstallOnAppQuit,autoDownload:engine.autoDownload,hasBackup:!!pending.backup[0]?.root,to:pending.to,actualInstallerExecuted:false},null,2));
  }})}))ipcMain.handle('updates:'+name,async event=>{
    if(!trustedSender(event,win,url))return {ok:false,error:'bad sender'};
    try{return {ok:true,value:await fn()};}catch(e){return {ok:false,error:e.message};}
  });
  win=new BrowserWindow({width:850,height:720,webPreferences:{preload:path.resolve(__dirname,'../../desktop/update-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});await win.loadURL(url);
});
app.on('window-all-closed',()=>app.quit());
