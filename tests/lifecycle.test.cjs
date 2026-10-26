'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const net=require('node:net');const {once}=require('node:events');
const {fixture}=require('./helpers.cjs');const {fs,path,exists}=require('../desktop/services/files.cjs');const {inspect}=require('../desktop/services/installation.cjs');
const {Lifecycle,probe,ownsListener}=require('../desktop/services/lifecycle.cjs');
const services=path.resolve(__dirname,'../desktop/services');

test('only exact, separate desktop supervisor commands pass the external backend classifier',()=>{
 const {separateDesktopBackend,argsFor}=require('../desktop/services/installation.cjs'); const own={root:'C:/own/backend',dataRoot:'C:/own/data',configPath:'C:/own/config.yaml'};
 const other={root:'D:/other/backend',dataRoot:'D:/other/data',configPath:'D:/other/config.yaml',mode:'standalone'};
 const command=i=>['C:/runtime/node.exe','C:/app/services/runner.cjs',...argsFor(i,12345)].map(a=>'"'+a+'"').join(' ');
 assert.equal(separateDesktopBackend(command(other),own),true);
 for(const c of [command(own),command({...other,dataRoot:own.dataRoot}),command({...other,dataRoot:own.dataRoot+'/child'}),command({...other,configPath:own.configPath}),command(other)+' --dataRoot C:/own/data',command(other)+' --global',command(other)+' --configPath=C:/own/config.yaml',command(other).slice(0,-1),command(other).replace('C:/app/services/runner.cjs','runner.cjs'),command(other).replace('"--listen" "false"','"--listen" "true"')]) assert.equal(separateDesktopBackend(c,own),false,c);
});

test('fast listener query preserves exact loopback ownership and rejects additional bindings',()=>{
  const row=(address='127.0.0.1',pid=123,port=4567)=>`  TCP    ${address}:${port}    ${address.includes(':')?'[::]:0':'0.0.0.0:0'}    LISTENING    ${pid}`;
  const own=row();
  assert.equal(ownsListener('Active Connections\r\n'+own+'\r\n'+row('0.0.0.0',456,5678),4567,123),true);
  for(const output of ['',row('127.0.0.1',456),row('0.0.0.0'),row('[::]'),row('[::1]'),own+'\n'+row('0.0.0.0'),own+'\n'+row('[::1]'),own+'\n'+own,own.replace('LISTENING','ESTABLISHED'),own.replace('0.0.0.0:0','127.0.0.1:90'),own.replace('123','unknown'),own.replace('TCP','UDP')]){
    assert.equal(ownsListener(output,4567,123),false,output);
  }
  assert.equal(ownsListener(row('127.0.0.1',123,14567),4567,123),false,'port suffix is not a match');
});
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

test('native startup caught errors fail promptly instead of waiting for the full timeout',{timeout:10000},async()=>{
 const i=await inspect(await fixture());await fs.writeFile(path.join(i.root,'server.js'),"console.error('A critical error has occurred while starting the server: PRIVATE-STARTUP-DETAIL');setInterval(()=>{},1000);");const l=new Lifecycle({node:process.execPath,services});const start=Date.now();await assert.rejects(()=>l.start(i,{skipExternalCheck:true,timeout:30000}),e=>e.message.includes('核心初始化失败')&&!e.message.includes('PRIVATE'));assert.ok(Date.now()-start<5000);assert.equal(await exists(path.join(i.dataRoot,'.sillytavern-desktop.lock')),false);
});
test('completed compilation gets bounded finishing grace while stalled startup still times out',{timeout:15000},async()=>{
 const i=await inspect(await fixture());const file=path.join(i.root,'server.js'),original=await fs.readFile(file,'utf8');
 await fs.writeFile(file,"process.send?.({type:'phase',phase:'webpack-run-end'});await new Promise(r=>setTimeout(r,1100));\n"+original);
 const l=new Lifecycle({node:process.execPath,services,preferredPort:0});const start=Date.now();try{assert.equal(await probe((await l.start(i,{skipExternalCheck:true,timeout:800,finishGrace:1400})).url),true);assert.ok(Date.now()-start>800);}finally{await l.stop();}
 await fs.writeFile(file,"process.send?.({type:'phase',phase:'webpack-run-end'});setInterval(()=>{},1000);");const failed=Date.now();await assert.rejects(()=>l.start(i,{skipExternalCheck:true,timeout:400,finishGrace:300}));assert.ok(Date.now()-failed<2500);assert.equal(await exists(path.join(i.dataRoot,'.sillytavern-desktop.lock')),false);
});
test('bind conflict retries with a new lock and port',{timeout:30000},async()=>{
  const i=await inspect(await fixture());const server=path.join(i.root,'server.js');const original=await fs.readFile(server,'utf8');
  await fs.writeFile(server,"import fs0 from 'node:fs';if(!fs0.existsSync('./once-marker')){fs0.writeFileSync('./once-marker','1');console.error('EADDRINUSE');process.exit(1);}\n"+original);
  const lifecycle=new Lifecycle({node:process.execPath,services});try{const active=await lifecycle.start(i,{skipExternalCheck:true});assert.equal(await probe(active.url),true);}finally{await lifecycle.stop();}
  assert.equal(await exists(path.join(i.dataRoot,'.sillytavern-desktop.lock')),false);
});
