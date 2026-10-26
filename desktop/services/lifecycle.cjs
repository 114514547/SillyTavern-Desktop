'use strict';
const { spawn } = require('node:child_process');
const net = require('node:net');
const http = require('node:http');
const { once } = require('node:events');
const { path, fail, exec, exists } = require('./files.cjs');
const { acquire,handoff,release } = require('./lock.cjs');
const { argsFor, assertNoExternalServer } = require('./installation.cjs');
const {PHASES}=require('./startup-runtime.cjs');
async function freePort() {
  const server=net.createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const port=server.address().port;
  await new Promise((r,j)=>server.close(e=>e?j(e):r()));return port;
}
function isPortAvailable(port) {
  return new Promise(resolve=>{
    const server=net.createServer();
    server.once('error',()=>resolve(false));
    server.once('listening',()=>{server.close(()=>resolve(true));});
    server.listen(port,'127.0.0.1');
  });
}
async function allocatePort(attempt=0,preferred=38443) {
  if(attempt===0 && preferred && Number.isInteger(preferred) && preferred>0 && preferred<=65535){
    if(await isPortAvailable(preferred))return preferred;
  }
  return freePort();
}
function ownsListener(output,port,pid) {
  // netstat includes IPv4 and IPv6. Reject wildcard / additional listeners too.
  const listeners=[];
  for(const line of output.split(/\r?\n/)){
    const columns=line.trim().split(/\s+/);
    if(columns[0]!=='TCP' || columns.length!==5)continue;
    const local=columns[1].match(/^(.*):(\d+)$/);
    if(!local || Number(local[2])!==port)continue;
    if(columns[3]!=='LISTENING' || !['0.0.0.0:0','[::]:0'].includes(columns[2]))continue;
    listeners.push({address:local[1],pid:Number(columns[4])});
  }
  return listeners.length===1 && listeners[0].address==='127.0.0.1' && listeners[0].pid===pid;
}
async function listenerOwned(port,pid) {
  if(process.platform!=='win32')return true;
  // The equivalent CIM query can take several seconds on every launch.
  // Use the system executable, retain the same strict loopback / owner check.
  try{
    const {stdout}=await exec(path.join(process.env.SystemRoot||'C:/Windows','System32/netstat.exe'),['-ano'],{windowsHide:true,timeout:15000,maxBuffer:4*1024*1024});
    return ownsListener(stdout,port,pid);
  }catch{ /* Fall back when the system tool is unavailable; never skip validation. */ }
  const {stdout}=await exec('powershell.exe',['-NoProfile','-NonInteractive','-Command',`@(Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object LocalAddress,OwningProcess) | ConvertTo-Json -Compress`],{windowsHide:true,timeout:15000});
  let list=JSON.parse(stdout||'[]');if(!Array.isArray(list))list=[list];
  return list.length===1 && Number(list[0].OwningProcess)===pid && list[0].LocalAddress==='127.0.0.1';
}
function probe(url) {
  return new Promise(resolve=>{
    const req=http.get(url+'/csrf-token',{timeout:2000,agent:false},res=>{let body='';res.on('data',b=>{if(body.length<65536)body+=b;});res.on('end',()=>{try{const token=JSON.parse(body).token;resolve(res.statusCode===200 && typeof token==='string' && token!=='disabled');}catch{resolve(false);}});});
    req.on('error',()=>resolve(false));req.on('timeout',()=>{req.destroy();resolve(false);});
  });
}
class Lifecycle {
  constructor({node,services,prepare,preferredPort=38443,frontendResources=null,onPhase=()=>{},onStatus=()=>{},onExit=()=>{}}){Object.assign(this,{node,services,prepare,preferredPort,frontendResources,onPhase,onStatus,onExit});this.active=null;this.stopping=false;}
  async start(i,{skipExternalCheck=false,timeout=120000,useStartupCache=false,finishGrace=30000}={}) {
    if(this.active)throw fail('服务已经运行。');
    if(!i.allowLegacyMigration && await exists(path.join(i.root,'public/characters')))throw fail('检测到旧版 public/characters。直接启动会触发上游移动数据；请选择创建独立副本，或先用原版完成迁移。');
    if(!skipExternalCheck){this.onStatus('正在检查后台是否重复运行…');await assertNoExternalServer(i);}
    this.onPhase('external-process-check');
    let lock=await acquire(i.dataRoot);
    try{
      this.onStatus('正在准备写作组件…');
      await this.prepare?.(i);
      this.onPhase('extension-prepared');
      for(let attempt=0;attempt<3;attempt++){
        const port=await allocatePort(attempt,this.preferredPort);let pid=0,diagnostic='',ended=false,finishing=false;
        this.onStatus('正在启动本机酒馆后台…');
        const guard=spawn(this.node,[path.join(this.services,'guardian.cjs')],{cwd:i.root,detached:true,windowsHide:true,stdio:['ignore','ignore','ignore','ipc'],env:{...process.env,ELECTRON_RUN_AS_NODE:undefined}});
        this.active={guard,lock,i,port};
        guard.on('error',()=>{ended=true;diagnostic='spawn-error';});
        guard.on('exit',()=>{ended=true;if(!this.stopping)this.onExit();});
        guard.on('message',m=>{if(m.type==='spawned')pid=m.pid;if(m.type==='diagnostic'){diagnostic=m.code;if(m.code==='native-start-failed')ended=true;}if(m.type==='phase'&&(['node-entry','native-setup','native-frontend-build','native-listening'].includes(m.phase)||PHASES.has(m.phase))){this.onPhase(m.phase,m.durationMs,m.metrics);if(m.phase==='webpack-run-end')finishing=true;if(m.phase==='node-entry')this.onStatus('正在加载酒馆核心组件…');if(m.phase==='native-setup')this.onStatus('正在初始化本地数据与扩展…');if(m.phase==='frontend-compile-start')this.onStatus('正在准备界面资源…');if(m.phase==='webpack-close-start')this.onStatus('界面资源已编译，正在完成缓存收尾…');}if(['failed','backend-exit'].includes(m.type))ended=true;});
        await once(guard,'spawn');await handoff(lock,guard.pid);
        guard.send({type:'start',runner:path.join(this.services,'runner.cjs'),args:argsFor(i,port),cwd:i.root,lock,cacheDataRoot:useStartupCache?i.dataRoot:null,frontendResources:useStartupCache?this.frontendResources:null});this.onPhase('backend-spawned');
        const url=`http://127.0.0.1:${port}`,deadline=Date.now()+timeout;
        let lastOwnCheck=0;
        const finishDeadline=deadline+Math.max(0,Math.min(Number.isFinite(finishGrace)?finishGrace:0,60000));
        while((Date.now()<deadline || (finishing&&Date.now()<finishDeadline)) && !ended){
          if(pid && await probe(url)){
            this.onPhase('backend-http-ready');
            this.onStatus('正在核验回环监听地址与进程归属…');
            if(await listenerOwned(port,pid)){this.active.url=url;this.active.pid=pid;return this.active;}
            throw fail('监听服务归属或回环地址校验失败，已停止连接。');
          }
          if(diagnostic==='frontend-build' && Date.now()-lastOwnCheck>5000){this.onStatus(finishing?'界面资源已编译，正在完成缓存收尾…':'正在准备原版前端资源…');lastOwnCheck=Date.now();}
          await new Promise(r=>setTimeout(r,350));
        }
        await this.stop(false);
        if(diagnostic==='port-conflict' && attempt<2){lock=await acquire(i.dataRoot);continue;}
        const descriptions={'missing-dependency':'缺少后端运行依赖。请修复安装，或选择独立模式。','permission-denied':'后端没有读写权限。','disk-full':'磁盘空间不足。','native-start-failed':'酒馆核心初始化失败，已停止后台。请检查配置与依赖，阶段计时已保留。'};
        throw fail(descriptions[diagnostic]||'后端启动失败或超时。请检查配置、权限和插件；未连接其他本地服务。');
      }
    }catch(e){await this.stop();await release(lock);throw e;}
  }
  async stop(releaseLock=true){
    const a=this.active;if(!a)return;this.stopping=true;
    if(a.guard.pid && a.guard.exitCode===null && a.guard.signalCode===null){
      const done=once(a.guard,'exit').catch(()=>{});
      if(a.guard.connected)a.guard.send({type:'shutdown'});
      // Guardian bounds its child shutdown at 9 seconds and releases the lock.
      await done;
    }
    if(releaseLock)await release(a.lock);
    this.active=null;this.stopping=false;
  }
}
module.exports={Lifecycle,freePort,allocatePort,isPortAvailable,listenerOwned,ownsListener,probe};
