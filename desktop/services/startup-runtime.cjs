'use strict';
const path=require('node:path');
const crypto=require('node:crypto');
const {fileURLToPath}=require('node:url');
const nodeModule=require('node:module');
const {readFrontendCache,saveFrontendCache,readBundledFrontend}=require('./frontend-cache.cjs');
// Runtime adapters apply only to these exact, pinned 1.19.0 files. No upstream file is edited.
const PINS={
 'server.js':'65d4c3b751e3b9402d2f70c43a769081a53c778dc1509340e8d3fef192338a26',
 'src/server-main.js':'70816e313749d66ba023e3b0491a6475e4028bba6149c027f5d2ea96726e3b97',
 'src/middleware/webpack-serve.js':'12226d17d5f88b504594e76d50cb9d0176d72dcb9b22dda04b8ca7a0a5437318',
 'webpack.config.js':'7c5d96f3b63e77713346fd66775d7f7fe9919d86ce171837a3b63ff28d3f47ff',
 'src/util.js':'ef8750f2a885010946ffe52f7f91c86a5e596a0f881fbcc5679901dc9da81f68',
};
const TASKS=['config-parse','core-import','user-storage','app-setup','setDnsResolutionOrder','ensurePublicDirectoriesExist','migrateUserData','migrateSystemPrompts','migratePublicOverrides','verifySecuritySettings','version-query','webpack-version-query','user-directories','group-migration','default-content','character-cache','settings-backup','statistics','plugins','frontend-compile'];
const PHASES=new Set(['runner-entry','startup-instrumentation-unavailable','startup-instrumentation-skipped','node-compile-cache-enabled','node-compile-cache-unavailable','core-body-entered','webpack-constructor-start','webpack-constructor-end','webpack-run-end','webpack-close-start','webpack-close-end','frontend-cache-write-start','frontend-cache-write-end','frontend-bundled-check-start','frontend-bundled-check-end','frontend-bundled-hit','managed-version-info','frontend-cache-check-start','frontend-cache-check-end','frontend-cache-hit','frontend-cache-miss','frontend-cache-saved','frontend-cache-unavailable',...TASKS.flatMap(name=>[name+'-start',name+'-end',name+'-failed'])]);
const SYMBOL='sillytavern.desktop.startup.v1';
const API='globalThis[Symbol.for('+JSON.stringify(SYMBOL)+')]';
function mark(phase,durationMs){
 if(!PHASES.has(phase)||!process.connected)return;
 try{const cpu=process.cpuUsage();process.send({type:'phase',phase,metrics:{cpuUserMs:Math.round(cpu.user/1000),cpuSystemMs:Math.round(cpu.system/1000)},...(Number.isFinite(durationMs)?{durationMs:Math.round(durationMs)}:{})},()=>{});}catch{ /* Diagnostics never prevent startup/shutdown. */ }
}
function measure(phase,fn){
 mark(phase+'-start');const start=performance.now();
 try{const result=fn();if(result?.then)return result.then(value=>{mark(phase+'-end',performance.now()-start);return value;},error=>{mark(phase+'-failed',performance.now()-start);throw error;});mark(phase+'-end',performance.now()-start);return result;}
 catch(error){mark(phase+'-failed',performance.now()-start);throw error;}
}
function replace(source,from,to){if(!source.includes(from)||source.indexOf(from)!==source.lastIndexOf(from))throw Error('Unsupported upstream anchor');return source.replace(from,to);}
function transform(relative,source,{cachedOutput=null,cacheEnabled=false,bundled=false,managedVersion=false}={}){
 const digest=crypto.createHash('sha256').update(source).digest('hex');
 if(PINS[relative]!==digest)return null;
 let text=source.toString().replaceAll('\r\n','\n');
 if(relative==='server.js'){
  text=replace(text,'const cliArgs = new CommandLineParser().parse(process.argv);',`const cliArgs = ${API}.measure('config-parse',()=>new CommandLineParser().parse(process.argv));`);
  text=replace(text,"await import('./src/server-main.js');",`await ${API}.measure('core-import',()=>import('./src/server-main.js'));`);
 }else if(relative==='src/server-main.js'){
  text=replace(text,'// Work around a node',`${API}.mark('core-body-entered');\n// Work around a node`);
  text=replace(text,'const version = await getVersion();',`const version = await ${API}.measure('version-query',()=>getVersion());`);
  const tasks=[['getUserDirectoriesList()','user-directories'],['migrateGroupChatsMetadataFormat(directories)','group-migration'],['checkForNewContent(directories)','default-content'],['diskCache.verify(directories)','character-cache'],['settingsInit()','settings-backup'],['statsInit()','statistics'],['loadPlugins(app, pluginsDirectory)','plugins'],['webpackMiddleware.runWebpackCompiler({ pruneCache: true })','frontend-compile']];
  for(const [call,phase] of tasks)text=replace(text,'await '+call,`await ${API}.measure('${phase}',()=>${call})`);
  text=replace(text,'initUserStorage(globalThis.DATA_ROOT)\n',`${API}.measure('user-storage',()=>initUserStorage(globalThis.DATA_ROOT))\n`);
  for(const name of ['setDnsResolutionOrder','ensurePublicDirectoriesExist','migrateUserData','migrateSystemPrompts','migratePublicOverrides','verifySecuritySettings'])text=replace(text,'.then('+name+')',`.then(value=>${API}.measure('${name}',()=>${name}(value)))`);
  text=replace(text,'const app = express();',`${API}.mark('app-setup-start');\nconst app = express();`);
  text=replace(text,'// User storage module needs',`${API}.mark('app-setup-end');\n// User storage module needs`);
 }else if(relative==='webpack.config.js'){
  text=replace(text,'const appVersion = await getVersion();',`const appVersion = await ${API}.measure('webpack-version-query',()=>getVersion());`);
 }else if(relative==='src/middleware/webpack-serve.js'){
  if(cachedOutput)return `import path from 'node:path';\nexport default function getWebpackServeMiddleware(){\nfunction middleware(req,res,next){const parsed=path.parse(req.path);if(req.method==='GET'&&parsed.dir==='/'&&parsed.base==='lib.js')return res.sendFile(${JSON.stringify(cachedOutput)});next();}\nmiddleware.runWebpackCompiler=async()=>{${API}.mark('${bundled?'frontend-bundled-hit':'frontend-cache-hit'}');};return middleware;}\n`;
  text=replace(text,'const compiler = webpack(publicLibConfig);',`${API}.mark('webpack-constructor-start');\nconst compiler = webpack(publicLibConfig);\n${API}.mark('webpack-constructor-end');`);
  text=replace(text,'const output = stats?.toString(publicLibConfig.stats);',`${API}.mark('webpack-run-end');\nconst output = stats?.toString(publicLibConfig.stats);`);
  text=replace(text,'compiler.close(() => {\n                    resolve();\n                });',`${API}.mark('webpack-close-start');\ncompiler.close(() => {\n${API}.mark('webpack-close-end');\n${cacheEnabled?API+'.saveFrontend(stats,compiler).finally(resolve);':'resolve();'}\n});`);
 }else if(relative==='src/util.js'&&managedVersion){
  const begin=text.indexOf('export async function getVersion() {'),end=text.indexOf('\n}\n',begin)+3;if(begin<0||end<3)throw Error('Unsupported version anchor');
  text=text.slice(0,begin)+`export async function getVersion() { return { ...${API}.managedVersion }; }`+text.slice(end);
 }
 return text;
}
async function installStartupRuntime({target,dataRoot,cacheEnabled=false,frontendResources=null}){
 mark('runner-entry');
 if(typeof nodeModule.registerHooks!=='function'){mark('startup-instrumentation-unavailable');return;}
 const root=path.dirname(path.resolve(target));
 const compatible=await Promise.all(Object.entries(PINS).map(async([file,digest])=>{try{const source=await require('node:fs/promises').readFile(path.join(root,file));return crypto.createHash('sha256').update(source).digest('hex')===digest;}catch{return false;}}));
 if(compatible.includes(false)){mark('startup-instrumentation-skipped');return;}
 if(cacheEnabled&&dataRoot){
  try{
   const dir=path.join(dataRoot,'_cache','desktop-startup','node');await require('./files.cjs').noLinks(dir);
   const result=nodeModule.enableCompileCache(dir);const status=nodeModule.constants.compileCacheStatus;
   mark(result.status===status.ENABLED||result.status===status.ALREADY_ENABLED?'node-compile-cache-enabled':'node-compile-cache-unavailable');
  }catch{mark('node-compile-cache-unavailable');}
 }
 let cachedOutput=null;
 if(cacheEnabled&&dataRoot){mark('frontend-cache-check-start');cachedOutput=await readFrontendCache({root,dataRoot});mark('frontend-cache-check-end');if(!cachedOutput)mark('frontend-cache-miss');}
 let bundled=false;
 if(cacheEnabled&&!cachedOutput&&frontendResources){mark('frontend-bundled-check-start');cachedOutput=await readBundledFrontend({root,resources:frontendResources});bundled=!!cachedOutput;mark('frontend-bundled-check-end');}
 let managedVersion=null;
 if(cacheEnabled){try{const fs=require('node:fs/promises');const git=await fs.lstat(path.join(root,'.git')).catch(e=>{if(e.code==='ENOENT')return null;throw e;});const pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));if(!git&&pkg.version==='1.19.0'){managedVersion={agent:'SillyTavern:1.19.0:Cohee#1207',pkgVersion:'1.19.0',gitRevision:null,gitBranch:null,commitDate:null,isLatest:true};mark('managed-version-info');}}catch{ /* Git-backed or unknown installs retain native version discovery. */ }}
 const runtime={mark,measure,managedVersion,async saveFrontend(stats,compiler){mark('frontend-cache-write-start');const saved=await saveFrontendCache({root,dataRoot,stats,compiler});mark('frontend-cache-write-end');mark(saved?'frontend-cache-saved':'frontend-cache-unavailable');}};
 Object.defineProperty(globalThis,Symbol.for(SYMBOL),{value:runtime,configurable:true});
 try{nodeModule.registerHooks({load(url,context,next){
  const result=next(url,context);if(!url.startsWith('file:'))return result;
  const relative=path.relative(root,fileURLToPath(url)).replaceAll('\\','/');if(!PINS[relative])return result;
  try{const source=Buffer.from(result.source);const transformed=transform(relative,source,{cachedOutput,cacheEnabled:cacheEnabled&&!!dataRoot,bundled,managedVersion:!!managedVersion});if(transformed!==null)return {...result,source:transformed};}catch{ /* Unknown source or adapter failure must use the native implementation. */ }
  mark('startup-instrumentation-skipped');return result;
 }});}catch{mark('startup-instrumentation-unavailable');}
}
module.exports={installStartupRuntime,PHASES,PINS,transform};
