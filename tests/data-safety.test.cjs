'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const crypto=require('node:crypto');
const {fixture,base}=require('./helpers.cjs');
const {fs,path,exists,sha}=require('../desktop/services/files.cjs');
const {inspect,argsFor}=require('../desktop/services/installation.cjs');
const {snapshot,plan,restoreSnapshot,destination,inventory}=require('../desktop/services/backup.cjs');
const {acquire,release}=require('../desktop/services/lock.cjs');
test('detects explicit custom paths, preserves YAML, and keeps global semantics',async()=>{
  const root=await fixture();const original='dataRoot: ./自定义 数据\nlisten: true\n';await fs.writeFile(path.join(root,'config.yaml'),original);
  const i=await inspect(root);assert.equal(i.dataRoot,path.join(root,'自定义 数据'));assert.equal(i.remoteWasEnabled,true);
  const args=argsFor(i,12345);assert.ok(args.includes('--disableCsrf'));assert.ok(!args.includes('--global'));assert.equal(await fs.readFile(path.join(root,'config.yaml'),'utf8'),original);
  const global=await inspect(root,{mode:'global'});assert.equal(global.dataRoot,path.join(process.env.LOCALAPPDATA,'SillyTavern','Data','data'));assert.ok(argsFor(global,12345).includes('--global'));assert.ok(!argsFor(global,12345).includes('--dataRoot'));
});
test('backs up all users and extensions by hash; source is unchanged; restores without overwrites',async()=>{
  const root=await fixture();const i=await inspect(root);const before=await plan(i);
  const backups=path.join(base,'backups-'+crypto.randomUUID());const b=await snapshot(i,backups,()=>{},{skipExternalCheck:true});
  assert.equal(b.manifest.count,before.count);assert.ok(b.manifest.files.some(f=>f.relative.endsWith('second-user/secrets.json')));assert.ok(b.manifest.files.some(f=>f.relative.includes('third-party/example')));
  assert.deepEqual((await plan(i)).files,before.files);
  const dest=path.join(base,'restore-'+crypto.randomUUID());await restoreSnapshot(b.root,dest);
  assert.equal(await sha(path.join(dest,'data/second-user/secrets.json')),await sha(path.join(root,'data/second-user/secrets.json')));
  await assert.rejects(()=>restoreSnapshot(b.root,dest),/拒绝覆盖/);
  await fs.writeFile(path.join(b.root,'payload/data/second-user/secrets.json'),'tampered');
  await assert.rejects(()=>restoreSnapshot(b.root,path.join(base,'tampered-'+crypto.randomUUID())),/校验失败/);
});
test('stops after mid-copy failure; does not change source or commit a backup',async()=>{
  const root=await fixture();for(let n=0;n<110;n++)await fs.writeFile(path.join(root,'data','item-'+n),String(n));
  const i=await inspect(root);const before=await plan(i);const backups=path.join(base,'failure-'+crypto.randomUUID());
  await assert.rejects(()=>snapshot(i,backups,()=>{throw new Error('injected I/O failure');},{skipExternalCheck:true}));
  assert.deepEqual((await plan(i)).files,before.files);
  const folders=await fs.readdir(backups);assert.equal(folders.length,1);assert.equal(await exists(path.join(backups,folders[0],'manifest.json')),false);
});
test('locks refuse a second writer and reject path traversal',async()=>{
  const root=await fixture();const lock=await acquire(path.join(root,'data'));
  await assert.rejects(()=>acquire(path.join(root,'data')),/另一桌面实例/);await release(lock);
  for(const attack of ['../bad','/absolute','C:/escape','data/../../escape','data\\bad','data/file:stream','data//bad'])assert.throws(()=>destination(root,attack));
});
test('malformed YAML is rejected without leaking its source',async()=>{
  const root=await fixture();await fs.writeFile(path.join(root,'config.yaml'),'password: [SECRET');
  await assert.rejects(()=>inspect(root),e=>!e.message.includes('SECRET')&&e.message.includes('无法解析'));
});
test('symlinks and junctions are refused',async t=>{
  const root=await fixture();const target=path.join(root,'data/link');
  try{await fs.symlink(path.join(root,'plugins'),target,'junction');}catch(e){if(e.code==='EPERM'){t.skip('Windows junction permission unavailable');return;}throw e;}
  await assert.rejects(()=>inventory(path.join(root,'data')),/链接/);
});
