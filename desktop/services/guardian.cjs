'use strict';
const {spawn}=require('node:child_process');
const {release}=require('./lock.cjs');
const {PHASES}=require('./startup-runtime.cjs');
let child,lock,stopping=false;const phases=new Set();
const outputBytes={stdout:0,stderr:0};
const send=m=>{if(process.connected)process.send(m);};
async function stop(){
  if(stopping)return;stopping=true;
  if(child?.pid && child.exitCode===null && child.signalCode===null){
    const exited=new Promise(r=>child.once('exit',r));
    if(child.connected)child.send({type:'shutdown'});
    const timer=setTimeout(()=>child.kill(),9000); // Direct child handle, never a process-name kill.
    await exited;clearTimeout(timer);
  }
  await release(lock).catch(()=>{});send({type:'stopped'});process.exit(0);
}
process.on('disconnect',()=>void stop());
process.on('message',m=>{
  if(m?.type==='shutdown'){void stop();return;}
  if(m?.type!=='start'||child||stopping)return;
  lock=m.lock;
  child=spawn(process.execPath,[m.runner,...m.args],{cwd:m.cwd,windowsHide:true,stdio:['ignore','pipe','pipe','ipc'],env:{...process.env,NODE_ENV:'production',ELECTRON_RUN_AS_NODE:undefined,ST_DESKTOP_STARTUP_CACHE:m.cacheDataRoot?'1':'0',ST_DESKTOP_CACHE_DATA_ROOT:m.cacheDataRoot||'',ST_DESKTOP_FRONTEND_RESOURCES:m.frontendResources||''}});
  // Backend stdout/stderr can contain secrets or chat text. Drop raw bytes entirely.
  // Retain only fixed diagnostic codes. Never persist arbitrary third-party output.
  const watch=(stream,key)=>{let tail='';stream.on('data',b=>{outputBytes[key]+=b.length;const s=tail+b.toString();tail=s.slice(-100);for(const [text,code] of [['EADDRINUSE','port-conflict'],['ERR_MODULE_NOT_FOUND','missing-dependency'],['EACCES','permission-denied'],['ENOSPC','disk-full'],['webpack','frontend-build'],['A critical error has occurred while starting the server:','native-start-failed']]) if(s.includes(text))send({type:'diagnostic',code});for(const [text,phase]of [['Node version:','node-entry'],['SillyTavern 1.','native-setup'],['webpack','native-frontend-build'],['SillyTavern is listening on','native-listening']])if(s.includes(text)&&!phases.has(phase)){phases.add(phase);send({type:'phase',phase});}});};
  watch(child.stdout,'stdout');watch(child.stderr,'stderr');
  child.on('message',m=>{if(m?.type==='diagnostic' && ['missing-dependency','permission-denied','disk-full'].includes(m.code))send({type:'diagnostic',code:m.code});if(m?.type==='phase'&&PHASES.has(m.phase)){const metrics={stdoutBytes:outputBytes.stdout,stderrBytes:outputBytes.stderr};for(const key of ['cpuUserMs','cpuSystemMs'])if(Number.isFinite(m.metrics?.[key])&&m.metrics[key]>=0&&m.metrics[key]<1e9)metrics[key]=Math.round(m.metrics[key]);send({type:'phase',phase:m.phase,metrics,...(Number.isFinite(m.durationMs)&&m.durationMs>=0&&m.durationMs<3600000?{durationMs:Math.round(m.durationMs)}:{})});}});
  child.once('spawn',()=>send({type:'spawned',pid:child.pid}));
  child.once('error',()=>{send({type:'failed'});void stop();});
  child.once('exit',(code)=>{if(!stopping){send({type:'backend-exit',code});void stop();}});
});
