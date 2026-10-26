'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..');
const manifest=require('../vendor/manifest.json');
const {inventory,verify}=require('../desktop/services/backup.cjs');
const {sha,exists}=require('../desktop/services/files.cjs');
const stage=path.join(root,'build/backend');
const build=path.join(root,'build');
const upstream=path.join(root,'vendor/upstream');
async function run(file,args,cwd=root){
  return new Promise((resolve,reject)=>{const child=spawn(file,args,{cwd,windowsHide:true,stdio:'inherit'});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(`${path.basename(file)} failed: ${code}`)));});
}
async function get(url,target){
  if(await exists(target))return;
  const r=await fetch(url,{signal:AbortSignal.timeout(300000)});if(!r.ok)throw new Error('Download failed '+r.status);
  await fs.writeFile(target,Buffer.from(await r.arrayBuffer()));
}
async function main(){
  if(process.platform!=='win32'||process.arch!=='x64')throw new Error('Build on Windows x64.');
  await fs.mkdir(build,{recursive:true});
  // Electron 44 installs its binary lazily; builder's electronDist needs it first.
  if(!(await exists(path.join(root,'node_modules/electron/dist/electron.exe'))))await run(process.execPath,[path.join(root,'node_modules/electron/install.js')]);
  if(!(await exists(path.join(upstream,'package.json')))){
    await fs.mkdir(upstream,{recursive:true});
    await run('git',['init',upstream]);
    await run('git',['remote','add','origin',manifest.repository],upstream);
    await run('git',['-c','http.sslBackend=openssl','fetch','--depth','1','origin',manifest.commit],upstream);
    await run('git',['checkout','--detach',manifest.commit],upstream);
  }
  const {execFileSync}=require('node:child_process');
  const gitScope=['-c',`safe.directory=${upstream.replaceAll('\\','/')}`];
  const commit=execFileSync('git',[...gitScope,'rev-parse','HEAD'],{cwd:upstream,encoding:'utf8',windowsHide:true}).trim();
  if(commit!==manifest.commit)throw new Error('Upstream commit mismatch.');
  const npmCLI=process.env.npm_execpath || path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
  if(!(await exists(path.join(upstream,'node_modules/express/package.json'))))await run(process.execPath,[npmCLI,'ci','--omit=dev','--ignore-scripts','--registry=https://registry.npmjs.org','--no-audit','--no-fund'],upstream);
  const zipTool=require('7zip-bin').path7za;
  const runtime=path.join(build,'runtime');await fs.mkdir(runtime,{recursive:true});
  const name=`node-v${manifest.nodeVersion}-win-x64.zip`;
  const archive=path.join(build,name);
  const sumsPath=path.join(build,`node-v${manifest.nodeVersion}-SHASUMS256.txt`);
  console.log('Downloading and verifying official Node runtime…');
  await get(`https://nodejs.org/dist/v${manifest.nodeVersion}/${name}`,archive);
  await get(`https://nodejs.org/dist/v${manifest.nodeVersion}/SHASUMS256.txt`,sumsPath);
  const expected=(await fs.readFile(sumsPath,'utf8')).split(/\r?\n/).find(l=>l.trim().endsWith(' '+name))?.split(/\s+/)[0];
  if(!expected||await sha(archive)!==expected)throw new Error('Official Node archive SHA-256 mismatch.');
  await run(zipTool,['e',archive,`node-v${manifest.nodeVersion}-win-x64/node.exe`,`node-v${manifest.nodeVersion}-win-x64/LICENSE`,`-o${runtime}`,'-y','-bso0']);
  await fs.writeFile(path.join(runtime,'manifest.json'),JSON.stringify({version:manifest.nodeVersion,arch:'x64',platform:'win32',archiveSha256:expected,sha256:await sha(path.join(runtime,'node.exe')),source:`https://nodejs.org/dist/v${manifest.nodeVersion}/`},null,2));
  const outZip=path.join(build,'backend.zip'),indexPath=path.join(build,'backend-files.json');
  const lockSha=await sha(path.join(upstream,'package-lock.json'));
  const previous=JSON.parse(await fs.readFile(indexPath,'utf8').catch(()=>'{}'));
  if(previous.commit===commit && previous.lockSha256===lockSha && await exists(outZip) && await sha(outZip)===previous.zipSha256){console.log('Verified existing backend bundle.');}
  else{
    if(await exists(stage))throw new Error('An incomplete build/backend exists. Preserve or remove this build-only directory before retrying.');
    console.log('Staging clean upstream and production dependencies…');
    await fs.cp(upstream,stage,{recursive:true,filter:src=>!['.git','data','config.yaml','backups'].includes(path.relative(upstream,src).split(path.sep)[0])});
    // Compile in the exact .git-free context used by the installed backend.
    console.log('Precompiling frontend (offline runtime needs no npm)…');
    const code=`import webpack from ${JSON.stringify(pathToFileURL(path.join(stage,'node_modules/webpack/lib/index.js')).href)}; import config from ${JSON.stringify(pathToFileURL(path.join(stage,'webpack.config.js')).href)}; const compiler=webpack(config({forceDist:true})); compiler.run((e,s)=>{if(e||s.hasErrors()){console.error(e||s.toString());process.exitCode=1;} compiler.close(()=>{});});`;
    await run(path.join(runtime,'node.exe'),['--input-type=module','-e',code],stage);
    console.log('Hashing staged files…');
    const files=(await inventory(stage,'',false)).map(({source,...f})=>f);
    await run(zipTool,['a','-tzip',outZip,'.','-mx=5','-bso0'],stage);
    await fs.writeFile(indexPath,JSON.stringify({schema:1,version:manifest.version,commit,lockSha256:lockSha,zipSha256:await sha(outZip),files},null,2));
  }
  if(!(await exists(stage)))await fs.cp(upstream,stage,{recursive:true,filter:src=>!['.git','data','config.yaml','backups'].includes(path.relative(upstream,src).split(path.sep)[0])});
  await require('./prepare-frontend.cjs').prepareFrontend({resources:build,stage});
  await run('git',[...gitScope,'archive','--format=zip',`--output=${path.join(build,'SillyTavern-source.zip')}`,manifest.commit],upstream);
  const notices=[`SillyTavern ${manifest.version}\n${manifest.repository}\nCommit ${manifest.commit}\nAGPL-3.0\n\n`+await fs.readFile(path.join(upstream,'LICENSE'),'utf8'), '\n\nNODE.JS RUNTIME\n'+await fs.readFile(path.join(runtime,'LICENSE'),'utf8')];
  const deps=await inventory(path.join(upstream,'node_modules'),'',true);
  for(const f of deps.filter(f=>/(?:^|\/)(?:licen[cs]e|copying|notice)(?:\.[^/]*)?$/i.test(f.relative))){
    if(f.size<300000)notices.push('\n\nDEPENDENCY '+f.relative+'\n'+await fs.readFile(f.source,'utf8'));
  }
  await fs.writeFile(path.join(build,'THIRD-PARTY-NOTICES.txt'),notices.join('\n'));
  await fs.mkdir(path.join(root,'resources'),{recursive:true});
  await fs.copyFile(path.join(upstream,'LICENSE'),path.join(root,'resources/LICENSE.txt'));
  if(!(await exists(path.join(root,'resources/icon.ico'))))await run('powershell.exe',['-NoProfile','-NonInteractive','-File',path.join(root,'scripts/make-icon.ps1')]);
  console.log('Offline Windows x64 resources ready.');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
