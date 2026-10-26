'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),asar=require('@electron/asar');
const root=path.resolve(__dirname,'..'),version=require('../package.json').version,artifactDir=path.resolve(root,process.argv[2]||'dist'),archive=path.join(artifactDir,'win-unpacked/resources/app.asar');if(!artifactDir.toLowerCase().startsWith(path.join(root,'dist').toLowerCase()))throw Error('Artifact directory required.');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
(async()=>{
 let checked=0;async function walk(dir){for(const e of await fs.readdir(path.join(root,dir),{withFileTypes:true})){const name=path.join(dir,e.name);if(e.isDirectory())await walk(name);else{assert.equal(hash(await fs.readFile(path.join(root,name))),hash(asar.extractFile(archive,name)),name);checked++;}}}await walk('desktop');
 assert.equal(JSON.parse(asar.extractFile(archive,'package.json')).version,version);
 const extras=['guardian.cjs','runner.cjs','lock.cjs','files.cjs','startup-runtime.cjs','frontend-cache.cjs'];for(const name of extras)assert.equal(hash(await fs.readFile(path.join(root,'desktop/services',name))),hash(await fs.readFile(path.join(artifactDir,'win-unpacked/resources/supervisor',name))),name);
 for(const name of ['manifest.json','lib.js','lib.js.LICENSE.txt'])assert.equal(hash(await fs.readFile(path.join(root,'build/frontend',name))),hash(await fs.readFile(path.join(artifactDir,'win-unpacked/resources/frontend',name))),name);
 const name='SillyTavern-Desktop-Setup-x64.exe',bytes=await fs.readFile(path.join(artifactDir,name));
 const result={version,date:new Date().toISOString(),desktopFiles:checked,supervisorFiles:extras.length,installer:{name,bytes:bytes.length,sha256:hash(bytes)},passed:true};
 await fs.writeFile(path.join(root,'test-results','package-'+version+'.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
