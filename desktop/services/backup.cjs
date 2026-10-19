'use strict';
const crypto = require('node:crypto');
const { fs, path, exists, inside, noLinks, privateDir, sha, atomicJson, fail } = require('./files.cjs');
const { acquire, release } = require('./lock.cjs');
const { assertNoExternalServer } = require('./installation.cjs');
const CACHE = new Set(['.sillytavern-desktop.lock', '.git', '_webpack', '_cache', 'node_modules/.cache']);
const LEGACY = ['assets','backgrounds','characters','chats','context','group chats','groups','instruct','KoboldAI Settings','movingUI','NovelAI Settings','OpenAI Settings','QuickReplies','TextGen Settings','themes','user','User Avatars','worlds','settings.json','stats.json'];
async function inventory(root, prefix = '', exclude = true) {
  await noLinks(root);
  if (!(await exists(root))) return [];
  const files = [];
  async function walk(source, relative) {
    if (exclude && (relative.split(path.sep).some(s => CACHE.has(s)) || /^\.(?:lock|tmp)$/.test(path.basename(relative)))) return;
    const st = await fs.lstat(source);
    if (st.isSymbolicLink() || (!st.isFile() && !st.isDirectory())) throw fail('迁移发现链接或特殊文件，已停止。请先整理成真实文件副本。');
    if (st.isDirectory()) {
      for (const name of (await fs.readdir(source)).sort()) await walk(path.join(source,name),path.join(relative,name));
    } else files.push({ source, relative: path.join(prefix,relative).replaceAll('\\','/'), size: st.size, hash: null });
  }
  const st = await fs.lstat(root);
  if (st.isDirectory()) { for (const name of (await fs.readdir(root)).sort()) await walk(path.join(root,name),name); }
  else await walk(root,'');
  let next=0;
  await Promise.all(Array.from({length:Math.min(12,files.length)},async()=>{while(next<files.length){const f=files[next++];f.hash=await sha(f.source,f.size);}}));
  return files;
}
async function plan(i) {
  const roots = [{ source:i.dataRoot, target:'data' },{ source:i.configPath, target:'config.yaml' },
    {source:path.join(i.root,'plugins'),target:'resources/plugins'},
    {source:path.join(i.root,'public/scripts/extensions/third-party'),target:'resources/public/scripts/extensions/third-party'},
    ...['public/css/user.css','public/user.css','secrets.json','thumbnails','vectors'].map(p => ({source:path.join(i.root,p),target:'resources/'+p})),
    ...LEGACY.map(p => ({source:path.join(i.root,'public',p),target:'resources/public/'+p}))];
  const files=[];
  for(const r of roots) files.push(...await inventory(r.source,r.target));
  const seen = new Set();
  for (const f of files) { const key=f.relative.toLowerCase(); if(seen.has(key)) throw fail('备份目标存在大小写冲突。'); seen.add(key); }
  return { sourceRoot:i.root, sourceData:i.dataRoot, sourceConfig:i.configPath, version:i.version, files,
    count:files.length, bytes:files.reduce((s,f)=>s+f.size,0), warning:'备份含 API 密钥和私人聊天，请勿上传或分享。' };
}
function destination(root, relative) {
  if (typeof relative !== 'string' || relative.includes('\\') || relative.split('/').some(s => !s || s==='..' || s==='.' || /[:\x00-\x1f]/.test(s)) || path.isAbsolute(relative)) throw fail('清单包含不安全路径。');
  const result=path.resolve(root,relative); if(!inside(root,result)) throw fail('清单路径越界。'); return result;
}
async function verify(root, files) {
  await noLinks(root);
  const checked=new Set([path.resolve(root)]);
  async function check(p){
    if(checked.has(p))return;
    if(!inside(root,p))throw fail('文件路径越界。');
    await check(path.dirname(p));
    if((await fs.lstat(p)).isSymbolicLink())throw fail('校验发现链接，已停止。');
    checked.add(p);
  }
  for (const f of files) {
    const p=destination(root,f.relative); await check(p); const st=await fs.stat(p);
    if(!st.isFile() || st.size!==f.size || await sha(p,f.size)!==f.hash) throw fail('文件哈希校验失败，已停止切换。');
  }
}
async function copyFiles(files, root, onProgress=()=>{}) {
  let count=0;
  for(const f of files) {
    await noLinks(f.source);
    const dest=destination(root,f.relative); await noLinks(dest); await fs.mkdir(path.dirname(dest),{recursive:true});
    await fs.copyFile(f.source,dest,require('node:fs').constants.COPYFILE_EXCL);
    if(++count%100===0) onProgress(`已复制 ${count}/${files.length} 个文件`);
  }
  await verify(root,files);
}
async function snapshot(i, backupsRoot, onProgress=()=>{}, options={}) {
  if(!options.skipExternalCheck) await assertNoExternalServer(i);
  const lock=await acquire(i.dataRoot);
  try {
    const p=await plan(i);
    if(inside(i.dataRoot,backupsRoot) || inside(i.root,backupsRoot)) throw fail('备份目录不能位于源安装或源数据目录内。');
    await privateDir(backupsRoot);
    const capacity=await fs.statfs(backupsRoot); if(Number(capacity.bavail)*Number(capacity.bsize)<p.bytes*3+256*1024*1024) throw fail('磁盘空间不足以同时保留备份和迁移副本。');
    const id=new Date().toISOString().replaceAll(/[:.]/g,'-')+'-'+crypto.randomUUID().slice(0,8);
    const root=path.join(backupsRoot,id); await privateDir(root);
    await copyFiles(p.files,path.join(root,'payload'),onProgress);
    const after=await plan(i);
    if(JSON.stringify(p.files)!==JSON.stringify(after.files)) throw fail('备份期间源文件发生变化。请关闭原酒馆后重试；当前备份未提交。');
    const manifest={schema:1,id,created:new Date().toISOString(),...p,files:p.files.map(({source,...rest})=>rest)};
    await atomicJson(path.join(root,'manifest.json'),manifest);
    onProgress(`备份校验通过，共 ${p.count} 个文件`);
    return {root,manifest};
  } finally { await release(lock); }
}
async function restoreSnapshot(backupRoot, destinationRoot, onProgress=()=>{}) {
  await noLinks(backupRoot); await noLinks(destinationRoot);
  if(await exists(destinationRoot)) throw fail('恢复目标已经存在，拒绝覆盖。请选择新目录。');
  const manifest=JSON.parse(await fs.readFile(path.join(backupRoot,'manifest.json'),'utf8'));
  if(manifest.schema!==1 || !Array.isArray(manifest.files)) throw fail('备份清单格式不受支持。');
  await verify(path.join(backupRoot,'payload'),manifest.files);
  await privateDir(destinationRoot);
  await copyFiles(manifest.files.map(f=>({...f,source:destination(path.join(backupRoot,'payload'),f.relative)})),destinationRoot,onProgress);
  return manifest;
}
module.exports={inventory,plan,destination,verify,copyFiles,snapshot,restoreSnapshot,LEGACY};
