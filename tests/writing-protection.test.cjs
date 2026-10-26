'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {WritingProtection,userRoot,createProtectionHandler}=require('../desktop/services/writing-protection.cjs');
const {base}=require('./helpers.cjs');
const modules=Promise.all([import('../desktop/extensions/desktop-writing/store.mjs'),import('../desktop/extensions/desktop-writing/model.mjs')]);
async function setup(){
  await fs.mkdir(base,{recursive:true});const dataRoot=await fs.mkdtemp(path.join(base,'writing-protection-')),root=userRoot(dataRoot,'default-user');
  const directory=path.join(root,'user/files');await fs.mkdir(directory,{recursive:true});const service=new WritingProtection(root);let fail=false,writes=0;
  const protection=async arg=>{if(arg.action==='capture'){if(fail)throw new Error('fixture checkpoint failure');return service.capture(arg.revision);}return service.read(arg.recovery);};
  const request=async(url,opts={})=>{const name=url.split('/').at(-1);if(opts.method==='POST'){writes++;const body=JSON.parse(opts.body);await fs.writeFile(path.join(directory,body.name),Buffer.from(body.data,'base64'));return Response.json({});}try{return new Response(await fs.readFile(path.join(directory,name)));}catch(error){if(error.code==='ENOENT')return new Response('',{status:404});throw error;}};
  const [{WritingStore},m]=await modules,store=new WritingStore({headers:()=>({}),request,protection});await store.load();const project=m.newProject('合成作品');store.data.projects.push(project);store.data.currentProjectId=project.id;project.chapters[0].text='第一版';store.dirty();await store.flush();
  return {dataRoot,root,directory,service,store,project,m,request,protection,fail:value=>{fail=value;},writes:()=>writes};
}
test('verified checkpoint survives deletion of both loose files and restores without overwriting on load',async()=>{
  const f=await setup(),[{WritingStore,FILE,RECOVERY}]=await modules;
  f.project.chapters[0].text='第二版';f.store.dirty();await f.store.flush();const before=await fs.readFile(f.service.file);
  await fs.unlink(path.join(f.directory,FILE));await fs.unlink(path.join(f.directory,RECOVERY));
  const next=new WritingStore({headers:()=>({}),request:f.request,protection:f.protection});await next.load();assert.equal(next.restored,true);assert.equal(next.data.projects[0].chapters[0].text,'第二版');assert.deepEqual(await fs.readFile(f.service.file),before);assert.equal((await next.read(RECOVERY)).projects[0].chapters[0].text,'第一版');
  assert.equal(await fs.stat(path.join(f.directory,FILE)).catch(()=>null),null);
  await next.flush();assert.equal(JSON.parse(await fs.readFile(path.join(f.directory,FILE),'utf8')).projects[0].chapters[0].text,'第二版');assert.equal(next.unsaved,false);
});
test('failed checkpoint keeps dirty state and retries protection without rewriting the committed manuscript',async()=>{
  const f=await setup();f.fail(true);f.project.chapters[0].text='待保护的新稿';f.store.dirty();await assert.rejects(f.store.flush(),/checkpoint/);assert.equal(f.store.unsaved,true);
  const writes=f.writes();f.fail(false);await f.store.flush();assert.equal(f.writes(),writes);assert.equal(f.store.unsaved,false);assert.equal((await f.service.read()).projects[0].chapters[0].text,'待保护的新稿');
});
test('stale writer cannot resurrect an older checkpoint over a newer manuscript',async()=>{
  const f=await setup(),[{WritingStore,FILE}]=await modules;const stale=new WritingStore({headers:()=>({}),request:f.request,protection:f.protection});await stale.load();
  f.project.chapters[0].text='其他窗口的新稿';f.store.dirty();await f.store.flush();await fs.unlink(path.join(f.directory,FILE));stale.dirty();await assert.rejects(stale.flush(),/另一窗口/);assert.equal((await f.service.read()).projects[0].chapters[0].text,'其他窗口的新稿');
});
test('invalid current files, wrong revisions and damaged checkpoints are preserved and rejected',async()=>{
  const f=await setup(),[{FILE}]=await modules;const original=await fs.readFile(f.service.file);
  await assert.rejects(f.service.capture('wrong'),/版本/);assert.deepEqual(await fs.readFile(f.service.file),original);
  await fs.writeFile(path.join(f.directory,FILE),'{broken');await assert.rejects(f.service.capture(f.store.baseline),/损坏/);assert.deepEqual(await fs.readFile(f.service.file),original);
  await fs.writeFile(path.join(f.directory,FILE),Buffer.from([0xff,0xfe,0x7b]));await assert.rejects(f.service.capture(f.store.baseline),/UTF-8/);assert.deepEqual(await fs.readFile(f.service.file),original);
  const bad=JSON.parse(original);bad.current.text+=' ';await fs.writeFile(f.service.file,JSON.stringify(bad));await assert.rejects(f.service.read(),/校验/);
});
test('protection IPC rejects wrong origins and subframes, ignores supplied paths and isolates authenticated users',async()=>{
  const f=await setup();let account='default-user',fetches=0;const frame={url:'http://127.0.0.1:38443/'};
  const contents={mainFrame:frame,session:{fetch:async url=>{fetches++;assert.equal(url,'http://127.0.0.1:38443/api/users/me');return Response.json({handle:account});}}};
  const state={active:{url:'http://127.0.0.1:38443',i:{dataRoot:f.dataRoot}},selected:{},window:{webContents:contents}};
  const handle=createProtectionHandler(()=>state),event={sender:contents,senderFrame:frame};
  assert.equal((await handle({...event,senderFrame:{url:frame.url}},{action:'read'})).ok,false);assert.equal(fetches,0);
  frame.url='http://127.0.0.1:38444/';assert.equal((await handle(event,{action:'read'})).ok,false);frame.url=state.active.url+'/';
  const read=await handle(event,{action:'read',handle:'other-user',path:'C:/secret',root:f.dataRoot});assert.equal(read.ok,true);assert.equal(read.value.projects[0].title,'合成作品');
  account='other-user';assert.equal((await handle(event,{action:'read',handle:'default-user'})).value,null);
  account='../escape';assert.equal((await handle(event,{action:'read'})).ok,false);
  account='default-user';contents.session.fetch=async()=>{state.active={...state.active};return Response.json({handle:account});};assert.equal((await handle(event,{action:'read'})).ok,false);
});
test('full backup includes protection outside loose attachments and rejects linked checkpoint files',async()=>{
  const f=await setup(),{inventory}=require('../desktop/services/backup.cjs');
  assert.ok((await inventory(f.dataRoot)).some(file=>file.relative.endsWith('desktop-writing-protected/checkpoint-v1.json')));
  const linked=path.join(f.root,'hardlink.json');await fs.link(f.service.file,linked);await assert.rejects(f.service.read(),/链接/);
});
