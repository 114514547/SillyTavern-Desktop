'use strict';
// Audit-only instrumentation in a fresh synthetic backend. Never loaded by the app.
const fs=require('node:fs');
const path=require('node:path');
const {fileURLToPath}=require('node:url');
const {registerHooks}=require('node:module');
const root=path.resolve(process.env.ST_DESKTOP_PROFILE_ROOT);
const output=process.env.ST_DESKTOP_PROFILE_OUTPUT;
const {inside}=require('../desktop/services/files.cjs');
const testRoot=path.resolve(__dirname,'../test-results');
if(!inside(testRoot,root)||!output||!inside(testRoot,path.resolve(output)))throw Error('Startup audit requires an isolated test-results root and output');
const started=performance.now();
const write=fs.appendFileSync.bind(fs);
const counters={};
function record(phase,extra={}){write(output,JSON.stringify({phase,elapsedMs:Math.round(performance.now()-started),...extra})+'\n');}
function count(name,ms){const c=counters[name]??={count:0,totalMs:0,maxMs:0};c.count++;c.totalMs+=ms;c.maxMs=Math.max(c.maxMs,ms);}
globalThis.__desktopStartupMeasure=(phase,fn)=>{
 record(phase+'-start');const begin=performance.now();
 try{const result=fn();if(result?.then)return result.finally(()=>record(phase+'-end',{durationMs:Math.round(performance.now()-begin)}));record(phase+'-end',{durationMs:Math.round(performance.now()-begin)});return result;}
 catch(error){record(phase+'-failed');throw error;}
};
globalThis.__desktopStartupMark=record;
for(const name of ['readFileSync','statSync','lstatSync','readdirSync','existsSync']){
 const original=fs[name];fs[name]=function(...args){const begin=performance.now();try{return original.apply(this,args);}finally{count('fs.'+name,performance.now()-begin);}};
}
function replace(source,from,to){if(!source.includes(from))throw Error('Unexpected upstream profiling anchor');return source.replace(from,to);}
registerHooks({
 resolve(specifier,context,next){const begin=performance.now();try{return next(specifier,context);}finally{count('module.resolve',performance.now()-begin);}},
 load(url,context,next){
  const begin=performance.now();const result=next(url,context);count('module.load',performance.now()-begin);
  if(!url.startsWith('file:'))return result;
  const relative=path.relative(root,fileURLToPath(url)).replaceAll('\\','/');
  if(!['server.js','src/server-main.js','src/middleware/webpack-serve.js'].includes(relative))return result;
  let source=(typeof result.source==='string'?result.source:Buffer.from(result.source).toString('utf8')).replaceAll('\r\n','\n');
  if(relative==='server.js'){
   source=replace(source,'const cliArgs = new CommandLineParser().parse(process.argv);',"const cliArgs = globalThis.__desktopStartupMeasure('config-parse',()=>new CommandLineParser().parse(process.argv));");
   source=replace(source,"await import('./src/server-main.js');","await globalThis.__desktopStartupMeasure('core-import',()=>import('./src/server-main.js'));");
  }
  if(relative==='src/server-main.js'){
   source=replace(source,'// Work around a node',"globalThis.__desktopStartupMark('core-body-entered');\n// Work around a node");
   source=replace(source,'const version = await getVersion();',"const version = await globalThis.__desktopStartupMeasure('version-query',()=>getVersion());");
   const tasks=[['getUserDirectoriesList()','user-directories'],['migrateGroupChatsMetadataFormat(directories)','group-migration'],['checkForNewContent(directories)','default-content'],['diskCache.verify(directories)','character-cache'],['settingsInit()','settings-backup'],['statsInit()','statistics'],['loadPlugins(app, pluginsDirectory)','plugins'],['webpackMiddleware.runWebpackCompiler({ pruneCache: true })','frontend-compile']];
   for(const [call,phase] of tasks)source=replace(source,'await '+call,"await globalThis.__desktopStartupMeasure('"+phase+"',()=>"+call+')');
   source=replace(source,'initUserStorage(globalThis.DATA_ROOT)\n',"globalThis.__desktopStartupMeasure('user-storage',()=>initUserStorage(globalThis.DATA_ROOT))\n");
   for(const name of ['setDnsResolutionOrder','ensurePublicDirectoriesExist','migrateUserData','migrateSystemPrompts','migratePublicOverrides','verifySecuritySettings'])source=replace(source,'.then('+name+')',".then(value=>globalThis.__desktopStartupMeasure('"+name+"',()=>"+name+'(value)))');
   source=replace(source,'const app = express();',"globalThis.__desktopStartupMark('app-setup-start');\nconst app = express();");
   source=replace(source,'// User storage module needs',"globalThis.__desktopStartupMark('app-setup-end');\n// User storage module needs");
  }
  if(relative==='src/middleware/webpack-serve.js'){
   source=replace(source,'const compiler = webpack(publicLibConfig);',"globalThis.__desktopStartupMark('webpack-constructor-start');\nconst compiler = webpack(publicLibConfig);\nglobalThis.__desktopStartupMark('webpack-constructor-end');");
   source=replace(source,'const output = stats?.toString(publicLibConfig.stats);',"globalThis.__desktopStartupMark('webpack-run-end');\nconst output = stats?.toString(publicLibConfig.stats);");
  }
  return {...result,source};
 }
});
record('runner-profile-ready');
process.on('exit',()=>{record('io-summary',{counters:Object.fromEntries(Object.entries(counters).map(([key,c])=>[key,{count:c.count,totalMs:Math.round(c.totalMs),maxMs:Math.round(c.maxMs)}]))});});
