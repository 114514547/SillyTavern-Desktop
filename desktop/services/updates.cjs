'use strict';
const {fs,path,privateDir,atomicJson,fail,safeError}=require('./files.cjs');
const {repositoryBase,verifyEnvelope,verifyEngineInfo,verifyInstaller,compareVersions}=require('./update-trust.cjs');
class Updates{
  constructor({version,home,policy,backend,fetchText,createEngine,onChange=()=>{},testFeed=null}){
    Object.assign(this,{version,home,policy,backend,fetchText,createEngine,onChange,testFeed});
    this.state={stage:'idle',currentVersion:version,repository:policy.repository,message:'点击检查更新，不会自动下载或安装。',percent:0};this.running=false;this.engine=null;
  }
  view(){return {...this.state};}
  change(state){Object.assign(this.state,state);this.onChange(this.view());}
  async operation(fn){if(this.running)throw fail('更新操作正在进行，请稍候。');this.running=true;try{return await fn();}catch(e){const message=safeError(e);this.change({stage:'error',message});throw e;}finally{this.running=false;}}
  async check(){return this.operation(async()=>{
    this.payload=null;this.installer=null;this.result=null;this.cancelled=false;this.change({stage:'checking',message:'正在连接正式发布源并验证签名…',percent:0,notes:'',version:null});
    const base=repositoryBase(this.policy.repository);
    if(this.testFeed&&!/^http:\/\/127\.0\.0\.1:\d+\/$/.test(this.testFeed))throw fail('本地测试源无效。');
    const text=await this.fetchText(this.testFeed?this.testFeed+'desktop-update.json':base+'latest/download/desktop-update.json');
    const p=verifyEnvelope(text,this.policy,this.backend);
    if(compareVersions(p.version,this.version)<=0){this.change({stage:'current',message:'当前已是最新稳定版。',version:p.version,notes:p.notes});return this.view();}
    const url=this.testFeed||base+`download/v${p.version}/`;
    this.engine=this.createEngine(url);
    this.engine.autoDownload=false;this.engine.autoInstallOnAppQuit=false;this.engine.allowPrerelease=false;this.engine.allowDowngrade=false;this.engine.disableWebInstaller=true;
    this.engine.logger={info(){},warn(){},error(){},debug(){}};
    this.engine.on('error',()=>{});
    this.engine.on('download-progress',progress=>{if(this.state.stage==='downloading')this.change({percent:Math.max(0,Math.min(100,Number(progress.percent)||0)),message:'正在下载更新…'});});
    this.result=await this.engine.checkForUpdates();
    if(!this.result?.isUpdateAvailable)throw fail('发布源暂时未就绪，请稍后重新检查。');
    verifyEngineInfo(this.result.updateInfo,p);this.payload=p;
    this.change({stage:'available',version:p.version,notes:p.notes,bytes:p.artifact.size,message:'发现新版本。确认后才会下载，现有酒馆继续运行。'});return this.view();
  });}
  async download(){return this.operation(async()=>{
    if(this.state.stage!=='available'||!this.payload||!this.engine)throw fail('请先检查并选择有效的新版本。');
    this.change({stage:'downloading',message:'正在下载更新…',percent:0});
    let files;
    try{files=await this.engine.downloadUpdate(this.result.cancellationToken);}catch(e){if(this.cancelled){this.change({stage:'available',message:'下载已取消，可以重新检查后再下载。',percent:0});this.payload=null;throw fail('下载已取消，请重新检查更新。');}throw fail('更新下载失败，请检查网络后重试；酒馆继续使用当前版本。');}
    if(!Array.isArray(files)||files.length!==1)throw fail('下载返回了不受支持的安装资源。');
    await verifyInstaller(files[0],this.payload);this.installer=files[0];
    this.change({stage:'downloaded',percent:100,message:'下载与签名校验完成。请先保存编辑内容，再选择备份并更新。'});return this.view();
  });}
  cancel(){if(this.state.stage==='downloading'){this.cancelled=true;this.result?.cancellationToken?.cancel();}}
  async install({prepare,commit}){return this.operation(async()=>{
    if(this.state.stage!=='downloaded'||!this.installer||!this.payload)throw fail('尚无已校验的更新包。');
    await verifyInstaller(this.installer,this.payload);this.change({stage:'installing',message:'正在停止后端并创建完整校验备份…'});
    const backup=await prepare();
    const dir=path.join(this.home,'updates');await privateDir(dir);
    await atomicJson(path.join(dir,'pending.json'),{schema:1,from:this.version,to:this.payload.version,created:new Date().toISOString(),backup,installer:this.installer});
    // Recheck after potentially long backups before handing over to NSIS.
    await verifyInstaller(this.installer,this.payload);
    this.change({stage:'installing',message:'备份完成，正在启动更新安装程序…'});
    await commit(this.engine);return this.view();
  });}
}
module.exports={Updates};
