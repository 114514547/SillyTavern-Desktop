'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const net=require('node:net');const {once}=require('node:events');
const {fixture}=require('./helpers.cjs');const {fs,path,exists}=require('../desktop/services/files.cjs');const {inspect}=require('../desktop/services/installation.cjs');
const {Lifecycle,probe}=require('../desktop/services/lifecycle.cjs');
const services=path.resolve(__dirname,'../desktop/services');
test('busy port 8000, Chinese/spaced paths, authenticated readiness, private logs, graceful shutdown',{timeout:60000},async()=>{
  const root=await fixture();const installation=await inspect(root);const logs=[];
  const blocker=net.createServer();blocker.on('error',()=>{});blocker.listen(8000,'127.0.0.1');await new Promise(r=>{blocker.once('listening',r);blocker.once('error',r);});
  const lifecycle=new Lifecycle({node:process.execPath,services,onStatus:s=>logs.push(s)});
  try{
    const active=await lifecycle.start(installation,{skipExternalCheck:true,timeout:30000});assert.notEqual(active.port,8000);assert.equal(await probe(active.url),true);
    assert.ok(!logs.join().includes('TEST-SECRET'));assert.ok(!logs.join().includes('PRIVATE-CHAT'));
    assert.ok(await exists(path.join(installation.dataRoot,'.sillytavern-desktop.lock')));
    await lifecycle.stop();assert.equal(await probe(active.url),false);assert.equal(await fs.readFile(path.join(installation.dataRoot,'graceful-exit.txt'),'utf8'),'yes');
    assert.equal(await exists(path.join(installation.dataRoot,'.sillytavern-desktop.lock')),false);
  }finally{await lifecycle.stop();if(blocker.listening)await new Promise(r=>blocker.close(r));}
});
test('parent crash disconnects guardian and cleans up its child only',{timeout:60000},async()=>{
  const root=await fixture();const {fork}=require('node:child_process');
  const parent=fork(path.join(__dirname,'fixtures/crash-parent.cjs'),[root],{stdio:['ignore','ignore','ignore','ipc'],windowsHide:true});
  const [active]=await once(parent,'message');await once(parent,'exit');
  let alive=true;for(let n=0;n<50;n++){alive=await probe(active.url);if(!alive && !(await exists(path.join(root,'data/.sillytavern-desktop.lock'))))break;await new Promise(r=>setTimeout(r,200));}
  assert.equal(alive,false);assert.equal(await exists(path.join(root,'data/.sillytavern-desktop.lock')),false);assert.equal(await fs.readFile(path.join(root,'data/graceful-exit.txt'),'utf8'),'yes');
});
test('failed executable spawn releases data lock instead of hanging',{timeout:10000},async()=>{
  const i=await inspect(await fixture());const lifecycle=new Lifecycle({node:path.join(i.root,'missing-node.exe'),services});
  await assert.rejects(()=>lifecycle.start(i,{skipExternalCheck:true}));assert.equal(await exists(path.join(i.dataRoot,'.sillytavern-desktop.lock')),false);
});
test('reports missing imports without revealing raw paths or values',{timeout:15000},async()=>{
  const i=await inspect(await fixture());await fs.writeFile(path.join(i.root,'server.js'),"import './PRIVATE-SECRET-NOT-PRESENT.js';");const lifecycle=new Lifecycle({node:process.execPath,services});
  await assert.rejects(()=>lifecycle.start(i,{skipExternalCheck:true}),e=>e.message.includes('缺少后端运行依赖')&&!e.message.includes('PRIVATE-SECRET'));
  assert.equal(await exists(path.join(i.dataRoot,'.sillytavern-desktop.lock')),false);
});
test('bind conflict retries with a new lock and port',{timeout:30000},async()=>{
  const i=await inspect(await fixture());const server=path.join(i.root,'server.js');const original=await fs.readFile(server,'utf8');
  await fs.writeFile(server,"import fs0 from 'node:fs';if(!fs0.existsSync('./once-marker')){fs0.writeFileSync('./once-marker','1');console.error('EADDRINUSE');process.exit(1);}\n"+original);
  const lifecycle=new Lifecycle({node:process.execPath,services});try{const active=await lifecycle.start(i,{skipExternalCheck:true});assert.equal(await probe(active.url),true);}finally{await lifecycle.stop();}
  assert.equal(await exists(path.join(i.dataRoot,'.sillytavern-desktop.lock')),false);
});
