'use strict';
const startupStarted=performance.now(),startupPhases=[];
const {app,BrowserWindow,Menu,dialog,shell,ipcMain,clipboard,screen,net}=require('electron');
const {pathToFileURL}=require('node:url');
const {fs,path,exists,privateDir,atomicJson,safeError,fail}=require('./services/files.cjs');
const {inspect,discover}=require('./services/installation.cjs');
const {snapshot,plan}=require('./services/backup.cjs');
const {Managed}=require('./services/managed.cjs');
const {Lifecycle}=require('./services/lifecycle.cjs');
const {localURL,httpsURL,trustedSender}=require('./services/security.cjs');
const {Updates}=require('./services/updates.cjs');
const {NsisUpdater}=require('electron-updater');
const {installWritingExtension}=require('./services/writing-extension.cjs');
const {LocalWorkspace,snapshotWorkspaceState}=require('./services/local-workspace.cjs');
const {createProtectionHandler}=require('./services/writing-protection.cjs');
const {createHash}=require('node:crypto');
const updatePolicy=require('../resources/update-policy.json');
const manifest=require('../vendor/manifest.json');
startupMark('main-imports-ready');
const customHome=process.argv.find(s=>s.startsWith('--desktop-home='))?.slice('--desktop-home='.length);
// Explicit opt-in for isolated automation. No window is shown or focused, even during startup failure.
const backgroundTest=!!customHome && process.argv.includes('--desktop-background-test') && process.env.ST_DESKTOP_BACKGROUND_TEST==='1';
if(backgroundTest){
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.__desktopTestWindowEvents=[];
  app.on('browser-window-created',(_event,w)=>{for(const name of ['show','focus'])w.on(name,()=>app.__desktopTestWindowEvents.push(name));});
  for(const name of ['showMessageBox','showOpenDialog','showSaveDialog','showMessageBoxSync','showOpenDialogSync','showSaveDialogSync','showErrorBox'])dialog[name]=()=>{throw new Error('Native dialog blocked during background test: '+name);};
}
const home=path.resolve(customHome || path.join(process.env.LOCALAPPDATA||app.getPath('appData'),'SillyTavernDesktop'));
app.setPath('userData',path.join(home,'shell'));
app.setName('SillyTavern Desktop');
app.setAppUserModelId('org.sillytavern.desktop.personal');
app.enableSandbox();
const single=app.requestSingleInstanceLock();
if(!single){app.quit();}else{void bootstrap();}
let window,updateWindow,updater,selected,current,lastAttempt,lifecycle,managed,readyWebContents,busy=false,quitting=false,switching=false,closing=false;
let currentStatus='准备就绪。',settings={},candidates=[];
let settingsLoaded=false;
let startupReady=false,resolveStartup;
const startupPreparation=new Promise(resolve=>{resolveStartup=resolve;});
function startupMark(phase,durationMs,metrics){const values={};for(const key of ['cpuUserMs','cpuSystemMs','stdoutBytes','stderrBytes'])if(Number.isFinite(metrics?.[key])&&metrics[key]>=0&&metrics[key]<1e12)values[key]=Math.round(metrics[key]);startupPhases.push({phase,elapsedMs:Math.round(performance.now()-startupStarted),...(Number.isFinite(durationMs)&&durationMs>=0?{durationMs:Math.round(durationMs)}:{}),...(Object.keys(values).length?{metrics:values}:{})});}
let startupTraceQueue=Promise.resolve();
function saveStartupTrace(){const value={schema:2,version:app.getVersion(),date:new Date().toISOString(),scope:'main-process-entry',phases:startupPhases.slice()};startupTraceQueue=startupTraceQueue.catch(()=>{}).then(()=>atomicJson(path.join(home,'startup-latest.json'),value));return startupTraceQueue;}
const workspaceServices=new Map();
const logs=[];
const launcher=pathToFileURL(path.join(__dirname,'ui/index.html')).href;
const updatesPage=pathToFileURL(path.join(__dirname,'ui/updates.html')).href;
const resources=app.isPackaged?process.resourcesPath:path.join(__dirname,'../build');
const settingsPath=path.join(home,'settings.json');
function status(s){currentStatus=s;logs.push(`${new Date().toISOString()} ${s}`);if(logs.length>150)logs.shift();if(window && !window.isDestroyed() && window.webContents.getURL()===launcher)window.webContents.send('launcher:status',s);}
function info(i){return {root:i.root,version:i.version,mode:i.mode,configPath:i.configPath,dataRoot:i.dataRoot,remoteWasEnabled:i.remoteWasEnabled,pluginEnabled:i.pluginEnabled};}
function bounds(){
  const b=settings.bounds;
  if(!b || !Number.isFinite(b.width)||!Number.isFinite(b.height))return {width:1100,height:830};
  const box={width:Math.max(800,Math.min(b.width,3840)),height:Math.max(650,Math.min(b.height,2160))};
  if(Number.isFinite(b.x)&&Number.isFinite(b.y) && screen.getAllDisplays().some(d=>b.x<d.workArea.x+d.workArea.width-100 && b.x+b.width>d.workArea.x+100 && b.y<d.workArea.y+d.workArea.height-100 && b.y+b.height>d.workArea.y+100)){box.x=b.x;box.y=b.y;}
  return box;
}
async function external(url){
  if(!httpsURL(url))return;
  const {response}=await dialog.showMessageBox(window,{type:'question',buttons:['取消','在系统浏览器打开'],defaultId:0,cancelId:0,title:'打开外部链接',message:'是否在系统浏览器打开这个 HTTPS 链接？',detail:url});
  if(response===1)await shell.openExternal(url);
}
function createWindow(isLauncher,origin){
  const w=new BrowserWindow({...bounds(),minWidth:800,minHeight:650,title:'SillyTavern Desktop',icon:path.join(__dirname,'../resources/icon.ico'),backgroundColor:'#0e0e11',show:false,focusable:!backgroundTest,skipTaskbar:backgroundTest,autoHideMenuBar:!isLauncher,
    ...(process.platform === 'win32' && !backgroundTest ? {
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: '#1a1a1e',
        symbolColor: '#e2e2e6',
        height: 40,
      },
    } : process.platform === 'darwin' && !backgroundTest ? {
      titleBarStyle: 'hiddenInset',
    } : {}),
    webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,allowRunningInsecureContent:false,
      ...(backgroundTest?{backgroundThrottling:false,offscreen:true}:{}),
      preload:path.join(__dirname,isLauncher?'preload.cjs':'workspace-preload.cjs')}});
  w.webContents.setWindowOpenHandler(({url})=>{void external(url);return {action:'deny'};});
  w.webContents.on('will-navigate',(event,url)=>{if(isLauncher?url!==launcher:!localURL(url,origin)){event.preventDefault();void external(url);}});
  w.webContents.on('will-redirect',(event,url)=>{if(isLauncher?url!==launcher:!localURL(url,origin))event.preventDefault();});
  w.webContents.on('will-attach-webview',event=>event.preventDefault());
  w.webContents.session.setPermissionRequestHandler((_wc,permission,callback)=>callback(permission==='clipboard-sanitized-write' && localURL(_wc.getURL(),origin)));
  w.webContents.session.setPermissionCheckHandler((_wc,permission)=>permission==='clipboard-sanitized-write' && !!_wc && localURL(_wc.getURL(),origin));
  w.once('ready-to-show',()=>{if(!backgroundTest)w.show();});
  w.on('close',event=>{
    if(switching||quitting)return;
    event.preventDefault();void shutdown();
  });
  w.webContents.on('render-process-gone',()=>{if(!quitting)void recover('界面进程已退出，后端将先安全停止。');});
  return w;
}
async function showLauncher(){
  switching=true;const old=window;window=createWindow(true);if(updateWindow&&!updateWindow.isDestroyed())updateWindow.setParentWindow(window);await window.loadURL(launcher);old?.destroy();switching=false;menu();
}
async function prepareWritingLeave(){
  if(!window || window.isDestroyed() || window.webContents.getURL()===launcher)return;
  let timer;
  const saved=await Promise.race([
    window.webContents.executeJavaScript('window.SillyTavernDesktopWriting?.prepareToLeave?.() ?? true').catch(()=>false),
    new Promise(resolve=>{timer=setTimeout(()=>resolve(false),45000);})
  ]).finally(()=>clearTimeout(timer));
  if(!saved)throw fail('创作草稿未能保存，已取消关闭。请在工作区重试保存后再关闭。');
}
async function recover(message){if(current && lifecycle?.active)await prepareWritingLeave();current=null;await lifecycle?.stop();status(message);await showLauncher();}
async function save(){await atomicJson(settingsPath,settings);}
function setupWorkspace(){
  ipcMain.handle('workspace:startupReady',event=>{
    const origin=lifecycle?.active?.url;
    if(!origin || event.sender!==window?.webContents || event.senderFrame!==window.webContents.mainFrame || !localURL(event.senderFrame.url,origin))return {ok:false};
    if(readyWebContents!==event.sender){readyWebContents=event.sender;startupMark('frontend-interactive');void saveStartupTrace().catch(()=>{});}
    event.sender.send('workspace:ui-ready');
    return {ok:true};
  });
  ipcMain.handle('workspace:writingProtection',createProtectionHandler(()=>({active:lifecycle?.active,window,selected})));
  ipcMain.handle('workspace:appMenu',event=>{
    const origin=lifecycle?.active?.url;
    if(!origin || event.sender!==window?.webContents || event.senderFrame!==window.webContents.mainFrame || !localURL(event.senderFrame.url,origin))return {ok:false};
    Menu.getApplicationMenu()?.popup({window});return {ok:true};
  });
  const actions=['state','choose','select','list','read','search','propose','proposal','pending','apply','history','restore','saveThread','deleteThread','removeProject','saveNotes','notesStatus','saveProject'];
  for(const action of actions)ipcMain.handle('workspace:'+action,async(event,arg)=>{
    const active=lifecycle?.active;
    if(!active?.url || !selected || event.sender!==window?.webContents || event.senderFrame!==window.webContents.mainFrame || !localURL(event.senderFrame.url,active.url))return {ok:false,error:'拒绝未知页面的本地文档请求。'};
    try{
      const key=createHash('sha256').update(selected.dataRoot.toLowerCase()).digest('hex');
      if(!workspaceServices.has(key))workspaceServices.set(key,new LocalWorkspace({home:path.join(home,'agent',key),protectedRoots:[home,resources]}));
      const service=workspaceServices.get(key);await service.load();
      let value;
      if(action==='choose'){
        const result=await dialog.showOpenDialog(window,{title:'选择本地设定工作区',properties:['openDirectory'],buttonLabel:'连接此文件夹'});
        if(result.canceled)return {ok:true,value:null};
        if(window?.webContents!==event.sender || lifecycle.active!==active)throw fail('工作区已切换，请重新选择文件夹。');
        value=await service.connect(result.filePaths[0]);
      }else if(action==='select')value=await service.select(arg?.id??null);
      else if(action==='proposal')value=await service.proposal(arg?.id);
      else value=await service[action](arg||{});
      return {ok:true,value};
    }catch(error){return {ok:false,error:safeError(error)};}
  });
}
async function launch(profile){
  lastAttempt=profile;
  status('正在核对安装和数据路径…');
  const i=await inspect(profile.root,profile);
  startupMark('installation-inspected');
  if(profile.kind==='managed' && profile.backupRoot)i.allowLegacyMigration=true;
  selected=i;
  let active;
  const progressTrace=setInterval(()=>{void saveStartupTrace().catch(()=>{});},5000);progressTrace.unref();
  try{active=await lifecycle.start(i,{useStartupCache:profile.kind==='managed'&&process.env.ST_DESKTOP_DISABLE_STARTUP_CACHE!=='1'});}catch(error){startupMark('backend-start-failed');await saveStartupTrace().catch(()=>{});throw error;}finally{clearInterval(progressTrace);}
  startupMark('backend-ready');
  switching=true;const old=window;window=createWindow(false,active.url);
  try{await window.loadURL(active.url);}catch(e){window.destroy();window=old;switching=false;await lifecycle.stop();throw e;}
  startupMark('frontend-loaded');void saveStartupTrace().catch(()=>{});
  current=profile;
  if(settings.current && JSON.stringify(settings.current)!==JSON.stringify(profile))settings.previous=settings.current;
  settings.current=profile;await save();
  old?.destroy();switching=false;status('原版酒馆已启动；仅监听本机，CSRF 保护已启用。');menu();
  await recordUpdateCompletion();
  return {migration:profile.migration};
}
async function exclusive(fn){
  if(busy)throw fail('已有操作进行中，请等待。');busy=true;
  try{return await fn();}finally{busy=false;}
}
function handler(name,fn){ipcMain.handle('launcher:'+name,async(event,arg)=>{
  if(!trustedSender(event,window,launcher))return {ok:false,error:'拒绝未知页面的桌面请求。'};
  if(!startupReady&&!['state','copy-logs','open-data','updates'].includes(name))return {ok:false,error:'正在准备运行环境，请稍候。'};
  try{return {ok:true,value:await fn(arg)};}catch(e){const error=safeError(e);status(error);return {ok:false,error};}
});}
function options(arg){
  if(!arg||typeof arg!=='object')throw fail('路径选项无效。');
  for(const key of ['root','configPath','dataRoot'])if(arg[key]!==undefined && (typeof arg[key]!=='string'||arg[key].length>32760))throw fail('路径参数无效。');
  return {mode:arg.mode||'standalone',configPath:arg.configPath||undefined,dataRoot:arg.dataRoot||undefined};
}
async function shutdown(){
  if(quitting||closing)return;closing=true;
  try{await prepareWritingLeave();}catch(e){
    if(backgroundTest){status(safeError(e));closing=false;return;}
    const {response}=await dialog.showMessageBox(window,{type:'warning',title:'小说草稿尚未保存',message:safeError(e),detail:'可先导出完整作品包。选择放弃退出将丢弃尚未保存到服务器的修改，已保存的数据保留。',buttons:['返回继续处理','放弃未保存内容并退出'],defaultId:0,cancelId:0});
    if(response!==1){closing=false;return;}
  }
  quitting=true;
  updater?.cancel();
  if(window&&!window.isDestroyed()){settings.bounds=window.getNormalBounds();window.hide();}
  await lifecycle?.stop();if(settingsLoaded)await save().catch(()=>{});app.exit(0);
}
function menu(){if(!startupReady){Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'酒馆',submenu:[{label:'退出',click:()=>void shutdown()}]}]));return;}Menu.setApplicationMenu(Menu.buildFromTemplate([
  {label:'酒馆',submenu:[{label:'重新加载界面',accelerator:'Ctrl+R',click:()=>void prepareWritingLeave().then(()=>window?.webContents.reloadIgnoringCache()).catch(e=>dialog.showMessageBox(window,{type:'error',message:safeError(e)}))},
    {label:'返回启动设置（先停止服务）',click:()=>void exclusive(()=>recover('服务已停止，可选择其他安装。')).catch(e=>status(safeError(e)))},
    {label:'打开用户数据目录',click:()=>void shell.openPath(selected?.dataRoot||home)},
    {label:'复制诊断状态',click:()=>clipboard.writeText(logs.join('\n'))},
    {label:'创建完整校验备份（先停止服务）',click:()=>void exclusive(async()=>{if(!selected)throw fail('请先选择安装。');const p=current;await recover('服务已停止，正在备份…');const b=await snapshot(selected,path.join(home,'backups'),status);const local=await snapshotWorkspaceState(path.join(home,'agent'),path.join(home,'backups/local-workspaces'));await dialog.showMessageBox(window,{title:'备份完成',message:`已校验 ${b.manifest.count+(local?.count||0)} 个文件。`,detail:`备份含私人数据和密钥，请妥善保管。\n${b.root}${local?'\n本地工作区记录：'+local.root:''}`});if(p)await launch(p);}).catch(e=>status(safeError(e)))},
    {label:'返回上一次可用配置',enabled:!!settings.previous,click:()=>void exclusive(async()=>{const p=settings.previous;if(!p)throw fail('没有上一次可用配置。');await recover('正在恢复上一次可用配置…');await launch(p);}).catch(e=>status(safeError(e)))},
    {type:'separator'},{label:'退出',accelerator:'Alt+F4',click:()=>void shutdown()}]},
  {label:'编辑',submenu:[{role:'undo',label:'撤销'},{role:'redo',label:'重做'},{type:'separator'},{role:'cut',label:'剪切'},{role:'copy',label:'复制'},{role:'paste',label:'粘贴'},{role:'selectAll',label:'全选'}]},
  {label:'视图',submenu:[{role:'resetZoom',label:'实际大小'},{role:'zoomIn',label:'放大'},{role:'zoomOut',label:'缩小'},{role:'togglefullscreen',label:'全屏'}]},
  {label:'帮助',submenu:[{label:'软件更新',click:()=>void openUpdates()},
    {label:'查看酒馆上游版本（不自动升级）',click:()=>void checkUpdates()},
    {label:'关于 / 许可证',click:()=>void dialog.showMessageBox(window,{title:'SillyTavern Desktop',message:`桌面外壳 ${app.getVersion()} · 未签名个人构建`,detail:`SillyTavern ${manifest.version}\n提交 ${manifest.commit}\nNode ${manifest.nodeVersion} x64\nAGPL-3.0；上游版权归原作者。\n应用 resources 内提供上游对应源码归档和第三方许可；本项目源码随交付提供。\n软件更新源：${updatePolicy.repository}\n发布清单使用 Ed25519 签名，与 Windows Authenticode 签名不同。`})}]}]));}
async function openUpdates(){
  if(updateWindow&&!updateWindow.isDestroyed()){if(!backgroundTest){updateWindow.show();updateWindow.focus();}return;}
  updateWindow=new BrowserWindow({width:850,height:720,minWidth:700,minHeight:600,parent:window,title:'SillyTavern Desktop · 软件更新',show:!backgroundTest,focusable:!backgroundTest,skipTaskbar:backgroundTest,icon:path.join(__dirname,'../resources/icon.ico'),webPreferences:{preload:path.join(__dirname,'update-preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,allowRunningInsecureContent:false}});
  updateWindow.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  updateWindow.webContents.on('will-navigate',(e,url)=>{if(url!==updatesPage)e.preventDefault();});
  updateWindow.webContents.on('will-redirect',e=>e.preventDefault());
  updateWindow.webContents.on('will-attach-webview',e=>e.preventDefault());
  updateWindow.on('closed',()=>{updateWindow=null;});
  await updateWindow.loadURL(updatesPage);
}
async function fetchUpdateText(url){
  try{
    const response=await net.fetch(url,{signal:AbortSignal.timeout(20000),cache:'no-store',credentials:'omit'});
    if(response.status===404)throw fail('更新仓库尚未发布正式版本，请稍后再试。');
    if(!response.ok)throw fail('更新服务暂时不可用，请稍后重试。');
    let text='';for await(const chunk of response.body){text+=Buffer.from(chunk).toString('utf8');if(Buffer.byteLength(text)>256*1024)throw fail('更新清单过大，已拒绝处理。');}return text;
  }catch(e){if(e.safe)throw e;throw fail('无法连接更新服务，请检查网络或系统代理；当前软件可以继续使用。');}
}
async function prepareUpdate(){
  await prepareWritingLeave();
  const profiles=[...await managed.list(),settings.current,settings.previous].filter(Boolean);
  if(selected)profiles.push({...info(selected),kind:'existing'});
  if(window&&!window.isDestroyed())settings.bounds=window.getNormalBounds();
  await lifecycle.stop();current=null;
  await showLauncher();await save();
  const checkpoint=path.join(home,'updates');await privateDir(checkpoint);
  await atomicJson(path.join(checkpoint,'settings-before-update.json'),settings);
  const seen=new Set(),backups=[];
  for(const profile of profiles){
    const i=await inspect(profile.root,profile),key=[i.root,i.dataRoot,i.configPath].join('\0').toLowerCase();if(seen.has(key))continue;seen.add(key);
    const b=await snapshot(i,path.join(home,'backups'),s=>{status(s);updater.change({message:s});});backups.push({dataRoot:i.dataRoot,root:b.root,count:b.manifest.count});
  }
  const localBackup=await snapshotWorkspaceState(path.join(home,'agent'),path.join(home,'backups/local-workspaces'));if(localBackup)backups.push(localBackup);
  return backups;
}
async function recordUpdateCompletion(){
  const file=path.join(home,'updates/pending.json');
  if(!(await exists(file)))return;
  const pending=JSON.parse(await fs.readFile(file,'utf8'));
  if(pending.schema!==1||pending.to!==app.getVersion())return;
  await atomicJson(path.join(home,'updates/last-completed.json'),{...pending,completed:new Date().toISOString()});
  await fs.unlink(file);
}
function setupUpdates(){
  updater=new Updates({version:app.getVersion(),home,policy:updatePolicy,backend:manifest,fetchText:fetchUpdateText,createEngine:url=>{
    const engine=new NsisUpdater({provider:'generic',url,useMultipleRangeRequest:false});
    return engine;
  },onChange:state=>{if(updateWindow&&!updateWindow.isDestroyed())updateWindow.webContents.send('updates:state-changed',state);}});
  for(const [name,action]of Object.entries({state:()=>updater.view(),check:()=>updater.check(),download:()=>updater.download(),cancel:()=>{updater.cancel();return updater.view();},install:()=>exclusive(async()=>{
    if(!app.isPackaged)throw fail('开发模式不执行系统安装，请使用打包后的安装版。');
    const {response}=await dialog.showMessageBox(updateWindow||window,{type:'question',title:'备份并更新',message:'请先保存正在编辑的内容。确认后将关闭酒馆页面、备份配置和数据，再安装更新。',detail:customHome?'你使用了自定义数据目录。安装完成后请用原启动方式打开，以保留启动参数。':'完成后将重新启动。酒馆本体和个人数据目录不会被替换。',buttons:['取消','已保存，备份并更新'],defaultId:0,cancelId:0});
    if(response!==1)return updater.view();
    return updater.install({prepare:prepareUpdate,commit:async engine=>{
      if(updateWindow&&!updateWindow.isDestroyed())updateWindow.hide();
      await save();quitting=true;window?.hide();
      engine.once('error',()=>{quitting=false;if(!backgroundTest){window?.show();if(updateWindow&&!updateWindow.isDestroyed())updateWindow.show();}updater.change({stage:'error',message:'安装程序未能启动。备份已保留，请重新打开软件后重试。'});});
      engine.quitAndInstall(true,!customHome);
    }});
  })}))ipcMain.handle('updates:'+name,async(event)=>{
    if(!trustedSender(event,updateWindow,updatesPage))return {ok:false,error:'拒绝未知页面的更新请求。'};
    try{return {ok:true,value:await action()};}catch(e){return {ok:false,error:safeError(e)};}
  });
}
async function checkUpdates(){
  try{
    const r=await fetch('https://api.github.com/repos/SillyTavern/SillyTavern/releases/latest',{signal:AbortSignal.timeout(10000),headers:{'User-Agent':'SillyTavern-Desktop'}});
    if(!r.ok)throw new Error();const release=await r.json();
    await dialog.showMessageBox(window,{title:'后端更新',message:`当前内置：${manifest.version}；官方最新：${String(release.tag_name).slice(0,80)}`,detail:'仅检查版本，不会自动安装。更新前请停止服务并创建完整备份。第三方插件兼容性需要确认；可继续使用当前固定版本。桌面外壳暂无配置发布源。'});
  }catch{await dialog.showMessageBox(window,{title:'检查更新',message:'无法连接官方更新源。离线启动不受影响。'});}
}
async function bootstrap(){
  await app.whenReady();
  startupMark('electron-ready');
  try{
    await privateDir(home);settings=JSON.parse(await fs.readFile(settingsPath,'utf8').catch(()=>'{}'));
    settingsLoaded=true;if(quitting)return;
    startupMark('settings-loaded');
    managed=new Managed({home,resources,manifest,onStatus:status});
    setupUpdates();
    setupWorkspace();
    handler('state',async()=>{await startupPreparation;return {status:currentStatus,candidates,profiles:await managed.list(),currentProfileId:settings.current?.kind==='managed'?settings.current.id:null};});
    handler('discover',async()=>{candidates=await discover();return candidates;});
    handler('choose',()=>exclusive(async()=>{const {canceled,filePaths}=await dialog.showOpenDialog(window,{title:'选择现有 SillyTavern 安装文件夹',properties:['openDirectory']});if(canceled)return null;selected=await inspect(filePaths[0]);return info(selected);}));
    handler('inspect',arg=>exclusive(async()=>{const opts=options(arg);const root=arg.root||selected?.root;if(!root)throw fail('请先选择安装文件夹。');selected=await inspect(root,opts);return info(selected);}));
    handler('plan',()=>exclusive(async()=>{if(!selected)throw fail('请先选择原安装。');const p=await plan(selected);return {...p,files:p.files.map(({source,...f})=>f)};}));
    handler('run',mode=>exclusive(async()=>{
      if(!['existing','fresh','copy'].includes(mode))throw fail('未知运行模式。');
      let p;
      if(mode==='existing'){if(!selected)throw fail('请先选择原安装。');p={...info(selected),kind:'existing'};}
      else if(mode==='fresh')p=await managed.create();
      else{if(!selected)throw fail('请先选择原安装并查看备份清单。');status('正在锁定源数据并创建完整备份…');const b=await snapshot(selected,path.join(home,'backups'),status);p=await managed.create(b.root);}
      return launch(p);
    }));
    handler('profile',id=>exclusive(async()=>{if(typeof id!=='string')throw fail('配置 ID 无效。');const p=(await managed.list()).find(p=>p.id===id);if(!p)throw fail('独立配置不存在。');return launch(p);}));
    handler('retry',()=>exclusive(async()=>{if(!lastAttempt)throw fail('尚无启动任务，请先选择安装。');return launch(lastAttempt);}));
    handler('updates',()=>openUpdates());
    handler('restore',()=>exclusive(async()=>{const r=await dialog.showOpenDialog(window,{title:'选择备份 manifest.json 所在文件夹',defaultPath:path.join(home,'backups'),properties:['openDirectory']});if(r.canceled)return;const p=await managed.create(r.filePaths[0]);return launch(p);}));
    handler('open-data',()=>shell.openPath(selected?.dataRoot||home));handler('copy-logs',()=>clipboard.writeText(logs.join('\n')));
    await showLauncher();
    startupMark('launcher-loaded');
    status('正在校验本地运行环境…');
    const node=await managed.node();startupMark('runtime-verified');
    lifecycle=new Lifecycle({node,services:app.isPackaged?path.join(resources,'supervisor'):path.join(__dirname,'services'),frontendResources:path.join(resources,'frontend'),prepare:i=>installWritingExtension({root:i.root,source:path.join(__dirname,'extensions/desktop-writing'),backupRoot:path.join(home,'extension-backups')}),onPhase:startupMark,onStatus:status,onExit:()=>{if(current && !quitting)void recover('后端意外退出，已返回启动设置。').catch(()=>{});}});
    startupReady=true;resolveStartup();menu();
    status('准备就绪。');void saveStartupTrace().catch(()=>{});
    if(settings.current){try{await exclusive(()=>launch(settings.current));}catch(e){status(safeError(e));}}
    else await recordUpdateCompletion();
  }catch(e){if(backgroundTest)console.error(safeError(e));else await dialog.showMessageBox({type:'error',title:'SillyTavern Desktop 启动失败',message:safeError(e),detail:'请重新安装完整应用。配置和用户数据不会被删除。'});app.exit(1);}
}
app.on('second-instance',()=>{if(window&&!backgroundTest){if(window.isMinimized())window.restore();window.show();window.focus();}});
app.on('before-quit',e=>{if(!quitting){e.preventDefault();void shutdown();}});
