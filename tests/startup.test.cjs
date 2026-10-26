'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path');
const {readFrontendCache,saveFrontendCache,receiptPath,createFrontendReceipt,readBundledFrontend}=require('../desktop/services/frontend-cache.cjs');
const {transform,PINS,PHASES}=require('../desktop/services/startup-runtime.cjs');
async function fixture(){
 const folder=path.resolve(__dirname,'../test-results/startup-unit-'+require('node:crypto').randomUUID());const root=path.join(folder,'backend'),dataRoot=path.join(folder,'data');
 const inputs=['public/lib.js','webpack.config.js','package.json','package-lock.json','src/middleware/webpack-serve.js','node_modules/example/index.js'];
 for(const file of inputs){await fs.mkdir(path.dirname(path.join(root,file)),{recursive:true});await fs.writeFile(path.join(root,file),'synthetic '+file);}
 const context=path.join(root,'node_modules/example');const missing=path.join(root,'node_modules/example/optional.js');
 const output=path.join(dataRoot,'_webpack/0123456789abcdef/output');await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'lib.js'),'export const synthetic=true;');
 const stats={hasErrors:()=>false,compilation:{fileDependencies:inputs.map(file=>path.join(root,file)),contextDependencies:[context],missingDependencies:[missing]}};
 const compiler={options:{output:{path:output,filename:'lib.js'}}};return {root,dataRoot,stats,compiler,inputs};
}
test('verified frontend receipt invalidates on source, output, context and missing-dependency changes',async()=>{
 const f=await fixture();assert.equal(await saveFrontendCache(f),true);const output=path.join(f.compiler.options.output.path,'lib.js');assert.equal(await readFrontendCache(f),output);
 const source=path.join(f.root,f.inputs[0]);const original=await fs.readFile(source);await fs.writeFile(source,'changed source');assert.equal(await readFrontendCache(f),null);await fs.writeFile(source,original);assert.equal(await readFrontendCache(f),output);
 const originalOutput=await fs.readFile(output);await fs.writeFile(output,'changed output');assert.equal(await readFrontendCache(f),null);await fs.writeFile(output,originalOutput);
 const added=path.join(f.root,'node_modules/example/new.js');await fs.writeFile(added,'new module');assert.equal(await readFrontendCache(f),null);await fs.unlink(added);
 const missing=f.stats.compilation.missingDependencies[0];await fs.writeFile(missing,'now exists');assert.equal(await readFrontendCache(f),null);await fs.unlink(missing);assert.equal(await readFrontendCache(f),output);
});
test('bad or escaped receipts and failed compilations never become cache hits',async()=>{
 const f=await fixture();assert.equal(await readFrontendCache(f),null);assert.equal(await saveFrontendCache({...f,stats:{hasErrors:()=>true}}),false);
 assert.equal(await saveFrontendCache(f),true);const location=receiptPath(f.dataRoot);const receipt=JSON.parse(await fs.readFile(location,'utf8'));
 for(const mutation of [r=>r.schema=99,r=>r.files[0].relative='../outside',r=>r.files[0].relative='C:/outside',r=>r.output.relative='../lib.js',r=>r.files[0].size=-1,r=>r.files[0].hash='bad',r=>r.files.push(r.files[0])]){const value=structuredClone(receipt);mutation(value);await fs.writeFile(location,JSON.stringify(value));assert.equal(await readFrontendCache(f),null);}
 await fs.writeFile(location,'invalid json');assert.equal(await readFrontendCache(f),null);
 const external=path.resolve(f.root,'../outside.js');await fs.writeFile(external,'external compiler dependency');f.stats.compilation.fileDependencies.push(external);assert.equal(await saveFrontendCache(f),false);
});
test('linked compiler inputs cannot be used by a frontend cache receipt',async()=>{
 const f=await fixture();assert.equal(await saveFrontendCache(f),true);const from=path.join(f.root,'node_modules/example'),to=path.join(f.root,'elsewhere');await fs.rename(from,to);await fs.symlink(to,from,process.platform==='win32'?'junction':'dir');assert.equal(await readFrontendCache(f),null);
});
test('inputs changed after compilation began cannot produce a reusable receipt',async()=>{
 const f=await fixture();f.stats.startTime=Date.now()-10000;assert.equal(await saveFrontendCache(f),false);assert.equal(await readFrontendCache(f),null);
});
test('shipped artifact works before any runtime compilation and rejects corruption or changed inputs',async()=>{
 const f=await fixture(),resources=path.join(f.root,'../shipped');await fs.mkdir(resources);const receipt=await createFrontendReceipt(f);assert.ok(receipt);
 await fs.copyFile(path.join(f.compiler.options.output.path,'lib.js'),path.join(resources,'lib.js'));
 await fs.writeFile(path.join(resources,'manifest.json'),JSON.stringify({schema:1,version:'1.19.0',commit:'06bde939fb1e9c4c8d8641d810f0a916b5bce127',receipt}));
 assert.equal(await readFrontendCache(f),null);assert.equal(await readBundledFrontend({root:f.root,resources}),path.join(resources,'lib.js'));
 await fs.appendFile(path.join(resources,'lib.js'),'broken');assert.equal(await readBundledFrontend({root:f.root,resources}),null);
 await fs.copyFile(path.join(f.compiler.options.output.path,'lib.js'),path.join(resources,'lib.js'));await fs.appendFile(path.join(f.root,'public/lib.js'),'updated');assert.equal(await readBundledFrontend({root:f.root,resources}),null);
});
test('runtime adapters match every pinned source and leave modified upstream untouched',async()=>{
 for(const relative of Object.keys(PINS)){
  const source=await fs.readFile(path.resolve(__dirname,'../vendor/upstream',relative));const adapted=transform(relative,source,{cacheEnabled:true});assert.equal(typeof adapted,'string',relative);assert.equal(transform(relative,Buffer.concat([source,Buffer.from('\n// modified')])),null);
  if(relative==='src/middleware/webpack-serve.js'){const cached=transform(relative,source,{cachedOutput:'C:\\synthetic\\lib.js',cacheEnabled:true});assert.ok(cached.includes('sendFile'));assert.ok(!cached.includes("import webpack"));assert.ok(adapted.includes('saveFrontend'));}
 }
 assert.equal(PHASES.has('PRIVATE-STARTUP-DETAIL'),false);
 const util=await fs.readFile(path.resolve(__dirname,'../vendor/upstream/src/util.js'));assert.match(transform('src/util.js',util,{managedVersion:true}),/export async function getVersion\(\) \{ return \{/);assert.ok(transform('src/util.js',util).includes('const git = simpleGit'));
});
