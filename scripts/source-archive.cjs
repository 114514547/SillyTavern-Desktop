'use strict';
const {spawnSync}=require('node:child_process');const fs=require('node:fs');const path=require('node:path');
const root=path.resolve(__dirname,'..');fs.mkdirSync(path.join(root,'dist'),{recursive:true});
const output=path.join(root,'dist/SillyTavern-Desktop-source.zip');if(fs.existsSync(output))fs.unlinkSync(output);
const evidence=['launcher.png','sillytavern.png','packaged-launcher.png','packaged-sillytavern.png','update-available.png','update-downloaded.png','published-update.png'].map(name=>'test-results/'+name).filter(p=>fs.existsSync(path.join(root,p)));
const result=spawnSync(require('7zip-bin').path7za,['a','-tzip',output,'desktop','scripts','tests','vendor/manifest.json','resources','.github','LICENSE','build/SillyTavern-source.zip','build/runtime/manifest.json','build/backend-files.json','package.json','package-lock.json','electron-builder.yml','.npmrc','.gitignore','README.zh-CN.md','MIGRATION.md','RELEASE_NOTES.md','TECHNICAL_DECISIONS.md','TEST_RESULTS.md','UPDATE.md',...evidence,'-mx=5','-bso0'],{cwd:root,stdio:'inherit',windowsHide:true});process.exitCode=result.status||0;
if(result.status===0){
  const stage=path.join(root,'build/release-evidence');fs.mkdirSync(path.join(stage,'test-results'),{recursive:true});const records=[];
  for(const name of ['desktop-dev.json','desktop-packaged.json','real-backend.json','desktop-audit.json','upstream-audit.json','updates-engine.json','published-update.json']){
    const source=path.join(root,'test-results',name);if(!fs.existsSync(source))continue;
    const data=JSON.parse(fs.readFileSync(source,'utf8'));
    const clean=JSON.stringify(data,(_key,value)=>typeof value==='string'?value.replaceAll(root,'<project>').replaceAll(root.replaceAll('\\','/'),'<project>').replaceAll(require('node:os').homedir(),'<user>'):value,2);
    fs.writeFileSync(path.join(stage,'test-results',name),clean);records.push('test-results/'+name);
  }
  if(records.length){const appended=spawnSync(require('7zip-bin').path7za,['a','-tzip',output,...records,'-mx=5','-bso0'],{cwd:stage,stdio:'inherit',windowsHide:true});process.exitCode=appended.status||0;}
}
