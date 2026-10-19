'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const crypto=require('node:crypto');const {EventEmitter}=require('node:events');
const {fs,path,exists}=require('../desktop/services/files.cjs');const {fixture,base}=require('./helpers.cjs');
const {Updates}=require('../desktop/services/updates.cjs');
const {verifyEnvelope,repositoryBase,compareVersions}=require('../desktop/services/update-trust.cjs');
const {snapshot}=require('../desktop/services/backup.cjs');const {inspect}=require('../desktop/services/installation.cjs');
const backend={version:'1.19.0',commit:'a'.repeat(40)};
async function scenario({modify=()=>{},engineModify=()=>{}}={}){
  const {privateKey,publicKey}=crypto.generateKeyPairSync('ed25519');
  const home=path.join(base,'updater-'+crypto.randomUUID());await fs.mkdir(home,{recursive:true});const installer=path.join(home,'fixture.exe');await fs.writeFile(installer,'synthetic installer bytes');
  const data=await fs.readFile(installer);const policy={repository:'114514547/SillyTavern-Desktop',channel:'stable',publicKey:publicKey.export({type:'spki',format:'pem'})};
  const payload={schema:1,repository:policy.repository,channel:'stable',platform:'win32',arch:'x64',version:'0.2.1',releaseDate:new Date().toISOString(),backend,notes:'<img src=x onerror=alert(1)> is plain text',artifact:{name:'SillyTavern-Desktop-Setup-x64.exe',size:data.length,sha512:crypto.createHash('sha512').update(data).digest('base64')}};
  modify(payload);const raw=Buffer.from(JSON.stringify(payload));const envelope=JSON.stringify({payload:raw.toString('base64'),signature:crypto.sign(null,raw,privateKey).toString('base64')});
  const engine=new EventEmitter();engine.checkForUpdates=async()=>({isUpdateAvailable:true,updateInfo:{version:payload.version,files:[{url:payload.artifact.name,size:payload.artifact.size,sha512:payload.artifact.sha512}]},cancellationToken:{cancel(){}}});
  engine.downloadUpdate=async()=>{engine.emit('download-progress',{percent:50});return [installer];};engineModify(engine);
  const updater=new Updates({version:'0.2.0',home,backend,policy,fetchText:async()=>envelope,createEngine:()=>engine});
  return {home,installer,updater,policy,envelope,engine,payload};
}
test('signed release requires explicit download; ordinary quit auto-install disabled',async()=>{
  const s=await scenario();const state=await s.updater.check();assert.equal(state.stage,'available');assert.equal(s.engine.autoDownload,false);assert.equal(s.engine.autoInstallOnAppQuit,false);assert.equal(s.engine.disableWebInstaller,true);
  assert.equal(s.updater.installer,null);await s.updater.download();assert.equal(s.updater.view().stage,'downloaded');assert.equal(s.updater.view().percent,100);
});
test('bad or unsigned manifests are rejected before engine creation',async()=>{
  const s=await scenario();let called=false;s.updater.fetchText=async()=>s.envelope.replace('signature','invalid');s.updater.createEngine=()=>{called=true;return s.engine;};
  await assert.rejects(()=>s.updater.check(),/签名验证失败/);assert.equal(called,false);
});
test('cross-repository, unstable, mismatched architecture and backend versions are refused',async()=>{
  for(const modify of [p=>p.repository='attacker/repo',p=>p.version='0.3.0-beta.1',p=>p.arch='arm64',p=>p.backend={...backend,commit:'b'.repeat(40)},p=>p.artifact.name='../evil.exe']){
    const s=await scenario({modify});await assert.rejects(()=>s.updater.check());
  }
});
test('NSIS metadata tampering is rejected before downloading',async()=>{
  const s=await scenario({engineModify:engine=>{engine.checkForUpdates=async()=>({isUpdateAvailable:true,updateInfo:{version:'0.2.1',files:[{url:'https://evil.example/installer.exe'}]}});}});
  await assert.rejects(()=>s.updater.check(),/不一致/);assert.equal(s.updater.installer,null);
});
test('truncated and modified downloads cannot reach install',async()=>{
  const s=await scenario();await s.updater.check();await fs.writeFile(s.installer,'bad');await assert.rejects(()=>s.updater.download(),/校验失败/);
  let committed=false;await assert.rejects(()=>s.updater.install({prepare:async()=>[],commit:async()=>{committed=true;}}));assert.equal(committed,false);
});
test('backup failure prevents install and never writes completed pending state',async()=>{
  const s=await scenario();await s.updater.check();await s.updater.download();let committed=false;
  await assert.rejects(()=>s.updater.install({prepare:async()=>{throw new Error('injected failure');},commit:async()=>{committed=true;}}));
  assert.equal(committed,false);assert.equal(await exists(path.join(s.home,'updates/pending.json')),false);
});
test('real private backup and pending journal finish before installer handoff',async()=>{
  const s=await scenario(),i=await inspect(await fixture());await s.updater.check();await s.updater.download();let committed=false;
  await s.updater.install({prepare:async()=>{const b=await snapshot(i,path.join(s.home,'backups'),()=>{},{skipExternalCheck:true});return [{root:b.root,count:b.manifest.count}];},commit:async()=>{const pending=JSON.parse(await fs.readFile(path.join(s.home,'updates/pending.json'),'utf8'));assert.equal(pending.to,'0.2.1');assert.ok(await exists(path.join(pending.backup[0].root,'manifest.json')));committed=true;}});
  assert.equal(committed,true);
});
test('installer changed during backup is detected again before handoff',async()=>{
  const s=await scenario();await s.updater.check();await s.updater.download();let committed=false;
  await assert.rejects(()=>s.updater.install({prepare:async()=>{await fs.writeFile(s.installer,'tamper');return [];},commit:async()=>{committed=true;}}),/校验失败/);assert.equal(committed,false);
});
test('stable version comparison prevents downgrade and ignores same release',async()=>{
  assert.equal(compareVersions('0.10.0','0.2.0'),1);assert.throws(()=>compareVersions('v0.2.0','0.1.0'));
  const s=await scenario({modify:p=>{p.version='0.1.9';}});assert.equal((await s.updater.check()).stage,'current');assert.equal(s.updater.engine,null);
  for(const repo of ['user/repo/extra','https://github.com/a/b','../repo','user/a?token=x'])assert.throws(()=>repositoryBase(repo));
});
test('network failure stays recoverable and does not reveal arbitrary raw errors',async()=>{
  const s=await scenario();s.updater.fetchText=async()=>{throw new Error('PRIVATE-SECRET');};await assert.rejects(()=>s.updater.check());assert.equal(s.updater.view().stage,'error');assert.ok(!s.updater.view().message.includes('PRIVATE-SECRET'));
});
