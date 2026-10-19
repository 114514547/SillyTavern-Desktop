'use strict';
const crypto=require('node:crypto');
const {pipeline}=require('node:stream/promises');
const {createWriteStream}=require('node:fs');
const yauzl=require('yauzl');
const {fs,path,exists,noLinks,privateDir,atomicJson,sha,fail}=require('./files.cjs');
const {destination,verify,restoreSnapshot,LEGACY}=require('./backup.cjs');
async function unzip(zipPath,target) {
  await noLinks(target);
  if((await fs.readdir(target)).length)throw fail('安装资源只能展开到全新空目录。');
  const zip=await new Promise((r,j)=>yauzl.open(zipPath,{lazyEntries:true},(e,z)=>e?j(e):r(z)));
  return new Promise((resolve,reject)=>{
    zip.on('error',reject);zip.on('end',resolve);
    zip.on('entry',entry=>void(async()=>{
      if(entry.fileName.endsWith('/')){zip.readEntry();return;}
      if(((entry.externalFileAttributes>>>16)&0o170000)===0o120000)throw fail('安装资源包含不允许的符号链接。');
      const dest=destination(target,entry.fileName);await fs.mkdir(path.dirname(dest),{recursive:true});
      const input=await new Promise((r,j)=>zip.openReadStream(entry,(e,s)=>e?j(e):r(s)));
      await pipeline(input,createWriteStream(dest,{flags:'wx',mode:0o600}));zip.readEntry();
    })().catch(e=>{zip.close();reject(e);}));
    zip.readEntry();
  });
}
class Managed {
  constructor({home,resources,manifest,onStatus=()=>{}}){Object.assign(this,{home,resources,manifest,onStatus});}
  async initialize(){await privateDir(this.home);}
  async node(){
    const root=path.join(this.resources,'runtime');
    const m=JSON.parse(await fs.readFile(path.join(root,'manifest.json'),'utf8'));
    const node=path.join(root,'node.exe');
    if(m.version!==this.manifest.nodeVersion || await sha(node)!==m.sha256)throw fail('随包 Node 运行时校验失败，请重新安装。');
    return node;
  }
  async create(backupRoot=null){
    this.onStatus('正在校验离线安装资源…');
    const index=JSON.parse(await fs.readFile(path.join(this.resources,'backend-files.json'),'utf8'));
    if(index.commit!==this.manifest.commit || await sha(path.join(this.resources,'backend.zip'))!==index.zipSha256)throw fail('后端安装包校验失败。');
    const id=crypto.randomUUID();
    const version=this.manifest.version+'-'+this.manifest.commit.slice(0,8);
    const backend=path.join(this.home,'backend/versions',version,id);
    const profileRoot=path.join(this.home,'profiles',id);
    await privateDir(backend);await privateDir(profileRoot);
    this.onStatus('正在展开固定版本的后端与全部运行依赖…');
    await unzip(path.join(this.resources,'backend.zip'),backend);await verify(backend,index.files);
    let migration=null;
    if(backupRoot){
      const restored=path.join(profileRoot,'restored');
      migration=await restoreSnapshot(backupRoot,restored,this.onStatus);
      if(await exists(path.join(restored,'data')))await fs.rename(path.join(restored,'data'),path.join(profileRoot,'data'));
      if(await exists(path.join(restored,'config.yaml')))await fs.rename(path.join(restored,'config.yaml'),path.join(profileRoot,'config.yaml'));
      const resources=path.join(restored,'resources');
      if(await exists(resources)){
        // Copy only recognized extension/resource roots onto a NEW private backend.
        // Source installation and retained backup are never touched.
        await fs.cp(resources,backend,{recursive:true,force:true});
      }
      // Upstream will migrate legacy public resources only inside this private copy.
      // Avoid silent merges between legacy and current user data.
      if(await exists(path.join(backend,'public/characters')) && await exists(path.join(profileRoot,'data/default-user/characters')))
        throw fail('源目录同时包含旧版和新版角色目录，拒绝自动合并。备份已保留，请先在原版整理。');
    }
    const configPath=path.join(profileRoot,'config.yaml'),dataRoot=path.join(profileRoot,'data');
    if(!(await exists(configPath)))await fs.copyFile(path.join(backend,'default/config.yaml'),configPath);
    await fs.mkdir(dataRoot,{recursive:true});
    if(await exists(path.join(backend,'dist/_webpack')))await fs.cp(path.join(backend,'dist/_webpack'),path.join(dataRoot,'_webpack'),{recursive:true,force:false});
    // Do not let migrated relative paths redirect writes to old installation data.
    // config is retained verbatim; the supported CLI dataRoot override is absolute.
    const profile={id,kind:'managed',root:backend,mode:'standalone',configPath,dataRoot,version:this.manifest.version,
      backupRoot,migration:migration?{sourceRoot:migration.sourceRoot,sourceData:migration.sourceData,count:migration.count,verified:true}:null};
    await atomicJson(path.join(profileRoot,'profile.json'),profile);
    return profile;
  }
  async list(){
    const list=[];
    for(const id of await fs.readdir(path.join(this.home,'profiles')).catch(()=>[])){
      try{list.push(JSON.parse(await fs.readFile(path.join(this.home,'profiles',id,'profile.json'),'utf8')));}catch{}
    }
    return list;
  }
}
module.exports={Managed,unzip};
