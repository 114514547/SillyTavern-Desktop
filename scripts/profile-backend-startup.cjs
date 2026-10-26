'use strict';
// Never launches Electron or uses an existing profile. Reports synthetic backend timings only.
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const {Managed}=require('../desktop/services/managed.cjs');
const {inspect}=require('../desktop/services/installation.cjs');
const {installWritingExtension}=require('../desktop/services/writing-extension.cjs');
const {inside,noLinks}=require('../desktop/services/files.cjs');
const root=path.resolve(__dirname,'..');
const resume=process.argv.find(arg=>arg.startsWith('--resume='))?.slice(9);
const bundled=process.argv.includes('--bundled');
const optimized=process.argv.includes('--cache')||bundled;
const native=process.argv.includes('--native');
const direct=optimized||native;
const folder=resume?path.resolve(root,resume):path.join(root,'test-results','startup-review-'+Date.now());
assert.ok(folder.startsWith(path.join(root,'test-results')+path.sep),'Only isolated test-results profiles may be resumed');
let lifecycle;
async function main(){
 await noLinks(folder);await fs.mkdir(folder,{recursive:true});
 const backup=path.join(folder,'source-before');
 if(!resume){await fs.mkdir(backup);for(const relative of ['desktop/services','desktop/main.cjs','scripts/prepare-vendor.cjs','electron-builder.yml'])await fs.cp(path.join(root,relative),path.join(backup,relative),{recursive:true});}
 const services=direct?path.join(root,'desktop/services'):path.join(folder,'profile-services');
 if(!direct){await fs.cp(path.join(backup,'desktop/services'),services,{recursive:true});const runner=path.join(services,'runner.cjs');await fs.writeFile(runner,"require("+JSON.stringify(path.join(__dirname,'startup-profile-hook.cjs'))+");\n"+await fs.readFile(runner,'utf8'));}
 const home=path.join(folder,'isolated-home');const managed=new Managed({home,resources:path.join(root,'build'),manifest:require('../vendor/manifest.json')});
 await managed.initialize();const begin=performance.now();const profile=resume?(await managed.list())[0]:await managed.create();const provisioningMs=resume?null:Math.round(performance.now()-begin);
 assert.ok(profile,'An isolated profile must exist to resume');
 for(const key of ['root','dataRoot','configPath']){assert.ok(inside(home,path.resolve(profile[key])),'Profile paths must remain in this isolated home');await noLinks(profile[key]);}
 process.env.ST_DESKTOP_PROFILE_ROOT=profile.root;
 const {Lifecycle}=require(path.join(services,'lifecycle.cjs'));const reports=[];
 for(const label of direct?['run-1','run-2','run-3']:['first','repeat']){
  process.env.ST_DESKTOP_PROFILE_OUTPUT=path.join(folder,label+'-'+Date.now()+'-detail.jsonl');const phases=[];const start=performance.now();
  lifecycle=new Lifecycle({node:await managed.node(),services,preferredPort:0,frontendResources:bundled?path.join(root,'build/frontend'):null,prepare:i=>installWritingExtension({root:i.root,source:path.join(root,'desktop/extensions/desktop-writing'),backupRoot:path.join(home,'extension-backups')}),onPhase:(phase,durationMs,metrics)=>phases.push({phase,elapsedMs:Math.round(performance.now()-start),...(Number.isFinite(durationMs)?{durationMs}:{}),...(metrics?{metrics}:{})})});
  const active=await lifecycle.start(await inspect(profile.root,profile),{skipExternalCheck:true,useStartupCache:optimized});
  const readyMs=Math.round(performance.now()-start);assert.equal((await fetch(active.url+'/csrf-token')).status,200);
  const library=await fetch(active.url+'/lib.js');assert.equal(library.status,200);const libraryHash=require('node:crypto').createHash('sha256').update(Buffer.from(await library.arrayBuffer())).digest('hex');
  await lifecycle.stop();lifecycle=null;
  const detail=direct?null:(await fs.readFile(process.env.ST_DESKTOP_PROFILE_OUTPUT,'utf8')).trim().split('\n').map(line=>JSON.parse(line));
  reports.push({label,readyMs,libraryHash,phases,detail});
  if(bundled){assert.ok(phases.some(p=>p.phase==='frontend-bundled-hit'));assert.ok(!phases.some(p=>p.phase==='webpack-constructor-start'));}
  console.log(JSON.stringify({label,readyMs,libraryHash,cache:phases.filter(p=>p.phase.startsWith('frontend-cache')||p.phase==='frontend-bundled-hit').map(p=>p.phase)}));
 }
 const report=path.join(folder,(optimized?'optimized-':native?'native-':'baseline-')+Date.now()+'.json');
 await fs.writeFile(report,JSON.stringify({date:new Date().toISOString(),provisioningMs,isolated:true,electron:false,cacheEnabled:optimized,bundled,instrumentation:direct?'production':'audit',scope:'isolated-backend-not-full-desktop-or-os-cold-start',profile,reports},null,2));
 console.log('Report: '+report);
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;}).finally(async()=>{await lifecycle?.stop();});
