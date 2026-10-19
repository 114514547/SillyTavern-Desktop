'use strict';
const {spawn}=require('node:child_process');
const {release}=require('./lock.cjs');
let child,lock,stopping=false;
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
  child=spawn(process.execPath,[m.runner,...m.args],{cwd:m.cwd,windowsHide:true,stdio:['ignore','pipe','pipe','ipc'],env:{...process.env,NODE_ENV:'production',ELECTRON_RUN_AS_NODE:undefined}});
  // Backend stdout/stderr can contain secrets or chat text. Drop raw bytes entirely.
  // Retain only fixed diagnostic codes. Never persist arbitrary third-party output.
  const watch=stream=>{let tail='';stream.on('data',b=>{const s=tail+b.toString();tail=s.slice(-80);for(const [text,code] of [['EADDRINUSE','port-conflict'],['ERR_MODULE_NOT_FOUND','missing-dependency'],['EACCES','permission-denied'],['ENOSPC','disk-full'],['webpack','frontend-build']]) if(s.includes(text))send({type:'diagnostic',code});});};
  watch(child.stdout);watch(child.stderr);
  child.on('message',m=>{if(m?.type==='diagnostic' && ['missing-dependency','permission-denied','disk-full'].includes(m.code))send(m);});
  child.once('spawn',()=>send({type:'spawned',pid:child.pid}));
  child.once('error',()=>{send({type:'failed'});void stop();});
  child.once('exit',(code)=>{if(!stopping){send({type:'backend-exit',code});void stop();}});
});
