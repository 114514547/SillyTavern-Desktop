'use strict';
// Read-only code import probe. The native main body is stopped before app/storage/server setup.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {pathToFileURL}=require('node:url');const {registerHooks,createRequire}=require('node:module');
const {inside}=require('../desktop/services/files.cjs');
const {PINS}=require('../desktop/services/startup-runtime.cjs');
const root=path.resolve(process.argv[2]),fixture=path.resolve(process.argv[3]);
if(!inside(path.resolve(__dirname,'../test-results'),fixture))throw Error('Synthetic test-results fixture required');
fs.mkdirSync(fixture,{recursive:true});fs.copyFileSync(path.resolve(__dirname,'../vendor/upstream/default/config.yaml'),path.join(fixture,'config.yaml'));
globalThis.DATA_ROOT=path.join(fixture,'data');globalThis.COMMAND_LINE_ARGS={};
const target=path.join(root,'src/server-main.js'),targetURL=pathToFileURL(target).href;
const bytes=fs.readFileSync(target);if(crypto.createHash('sha256').update(bytes).digest('hex')!==PINS['src/server-main.js'])throw Error('Only pinned native main can be probed');
const wall=performance.now(),cpu=process.cpuUsage(),counters={},marks=[];
function count(name,ms){const n=counters[name]??={calls:0,totalMs:0,maxMs:0};n.calls++;n.totalMs+=ms;n.maxMs=Math.max(n.maxMs,ms);}
for(const name of ['readFileSync','statSync','lstatSync','readdirSync','existsSync']){const fn=fs[name];fs[name]=function(...args){const begin=performance.now();try{return fn.apply(this,args);}finally{count('fs.'+name,performance.now()-begin);}};}
registerHooks({resolve(specifier,context,next){const begin=performance.now();try{return next(specifier,context);}finally{count('resolve',performance.now()-begin);}},load(url,context,next){const begin=performance.now();const result=next(url,context);count('load',performance.now()-begin);if(url===targetURL){const source=Buffer.from(result.source).toString();return {...result,source:source.replace('// Work around a node',"throw Object.assign(new Error('PROBE_STOP'),{code:'PROBE_STOP'});\n// Work around a node")};}return result;}});
(async()=>{
 let begin=performance.now();const util=await import(pathToFileURL(path.join(root,'src/util.js')).href);util.setConfigFilePath(path.join(fixture,'config.yaml'));marks.push({phase:'entry-util-import',ms:Math.round(performance.now()-begin)});
 begin=performance.now();try{await import(targetURL);throw Error('Probe stop not reached');}catch(e){if(e.code!=='PROBE_STOP')throw e;}marks.push({phase:'core-import-without-main-body',ms:Math.round(performance.now()-begin)});
 begin=performance.now();const req=createRequire(path.join(root,'package.json')),webpack=req('webpack');const compiler=webpack({mode:'production',entry:path.join(root,'public/lib.js'),output:{path:path.join(fixture,'output'),filename:'lib.js'},experiments:{outputModule:true},cache:false});marks.push({phase:'webpack-constructor-only',ms:Math.round(performance.now()-begin)});await new Promise(resolve=>compiler.close(resolve));
 const usage=process.cpuUsage(cpu);const result={marks,totalMs:Math.round(performance.now()-wall),cpuUserMs:Math.round(usage.user/1000),cpuSystemMs:Math.round(usage.system/1000),counters:Object.fromEntries(Object.entries(counters).map(([k,v])=>[k,{calls:v.calls,totalMs:Math.round(v.totalMs),maxMs:Math.round(v.maxMs)}])),serverStarted:false,userConfigRead:false};
 fs.writeFileSync(path.join(fixture,'report.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
})().catch(e=>{console.error(JSON.stringify({probeFailed:true,code:e.code||e.name}));process.exitCode=1;});
