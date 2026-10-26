'use strict';
// Build-time only. Produce a verified frontend artifact so runtime need not bootstrap Webpack.
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const {createFrontendReceipt}=require('../desktop/services/frontend-cache.cjs');
const {sha,atomicJson}=require('../desktop/services/files.cjs');
async function prepareFrontend({resources,stage}){
 const index=JSON.parse(await fs.readFile(path.join(resources,'backend-files.json'),'utf8'));
 const webpack=(await import(pathToFileURL(path.join(stage,'node_modules/webpack/lib/index.js')).href)).default;
 const config=(await import(pathToFileURL(path.join(stage,'webpack.config.js')).href)).default;
 let options;const previous=process.cwd();try{process.chdir(stage);options=config({forceDist:true});}finally{process.chdir(previous);}options.context=stage;
 const compiler=webpack(options);
 const stats=await new Promise((resolve,reject)=>compiler.run((error,stats)=>compiler.close(closeError=>{if(error||closeError||!stats||stats.hasErrors())reject(Error('Frontend resource build failed'));else resolve(stats);} )));
 const receipt=await createFrontendReceipt({root:stage,dataRoot:path.join(stage,'dist'),stats,compiler});assert.ok(receipt,'Compilation graph must be self-contained');
 const files=new Map(index.files.map(entry=>[entry.relative,entry]));
 for(const entry of receipt.files){const expected=files.get(entry.relative);assert.ok(expected&&expected.hash===entry.hash&&expected.size===entry.size,'Frontend input differs from packaged backend: '+entry.relative);}
 const bundled=index.files.find(entry=>/^dist\/_webpack\/[a-f0-9]{16}\/output\/lib\.js$/.test(entry.relative)&&entry.hash===receipt.output.hash&&entry.size===receipt.output.size);assert.ok(bundled,'Compiled frontend must match the existing backend bundle');
 const output=path.join(compiler.options.output.path,compiler.options.output.filename);assert.equal(await sha(output),bundled.hash);
 const dest=path.join(resources,'frontend');await fs.mkdir(dest,{recursive:true});await fs.copyFile(output,path.join(dest,'lib.js'));
 const license=output+'.LICENSE.txt';await fs.copyFile(license,path.join(dest,'lib.js.LICENSE.txt'));
 await atomicJson(path.join(dest,'manifest.json'),{schema:1,version:index.version,commit:index.commit,receipt});
 return {files:receipt.files.length,bytes:receipt.files.reduce((n,f)=>n+f.size,0),sha256:receipt.output.hash};
}
module.exports={prepareFrontend};
if(require.main===module){const root=path.resolve(__dirname,'..');prepareFrontend({resources:path.join(root,'build'),stage:path.join(root,'build/backend')}).then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(error.message);process.exitCode=1;});}
