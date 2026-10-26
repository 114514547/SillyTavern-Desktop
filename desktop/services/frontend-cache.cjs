'use strict';
// Receipts describe compiler inputs, never user settings/chats. Invalid receipts use native Webpack.
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {inside,noLinks,atomicJson}=require('./files.cjs');
const SCHEMA=1,MAX_FILES=10000,MAX_BYTES=128*1024*1024;
const hash=buffer=>crypto.createHash('sha256').update(buffer).digest('hex');
const relative=(root,file)=>path.relative(root,file).replaceAll('\\','/');
function safeRelative(value){return typeof value==='string'&&value.length>0&&!value.includes('\\')&&!value.includes(':')&&!value.includes('\0')&&!path.posix.isAbsolute(value)&&value.split('/').every(part=>part&&part!=='.'&&part!=='..');}
async function mapLimit(values,fn){
 const results=new Array(values.length);let index=0,failed=false,failure;
 await Promise.all(Array.from({length:Math.min(12,values.length)},async()=>{while(index<values.length&&!failed){const n=index++;try{results[n]=await fn(values[n]);}catch(error){failed=true;failure=error;}}}));
 if(failed)throw failure;
 return results;
}
async function fileHash(file,expectedSize,notAfter){
 const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>MAX_BYTES||(expectedSize!==undefined&&stat.size!==expectedSize)||(Number.isFinite(notAfter)&&stat.mtimeMs>notAfter))throw Error('Uncacheable frontend input');
 const value=hash(await fs.readFile(file));
 if(Number.isFinite(notAfter)){const after=await fs.lstat(file);if(after.size!==stat.size||after.mtimeMs!==stat.mtimeMs||after.ctimeMs!==stat.ctimeMs||after.ino!==stat.ino)throw Error('Frontend input changed during compilation');}
 return {size:stat.size,hash:value};
}
async function directoryHash(file,notAfter){const stat=await fs.lstat(file);if(!stat.isDirectory()||stat.isSymbolicLink()||(Number.isFinite(notAfter)&&stat.mtimeMs>notAfter))throw Error('Uncacheable frontend context');return hash(JSON.stringify((await fs.readdir(file,{withFileTypes:true})).map(e=>[e.name,e.isSymbolicLink()?'link':e.isDirectory()?'dir':'file']).sort((a,b)=>a[0].localeCompare(b[0],'en'))));}
async function checkParents(root,names){
 await noLinks(root);const dirs=new Set();for(const name of names){let dir=path.dirname(path.join(root,name));while(inside(root,dir)){dirs.add(dir);if(dir===root)break;dir=path.dirname(dir);}}
 await mapLimit([...dirs],async dir=>{const stat=await fs.lstat(dir).catch(e=>{if(e.code==='ENOENT')return null;throw e;});if(stat?.isSymbolicLink())throw Error('Linked frontend input');});
}
function receiptPath(dataRoot){return path.join(dataRoot,'_cache','desktop-startup','frontend','receipt.json');}
async function readFrontendCache({root,dataRoot}){
 try{
  const location=receiptPath(dataRoot);await noLinks(location);
  const stat=await fs.stat(location);if(stat.size>2*1024*1024)return null;
  const receipt=JSON.parse(await fs.readFile(location,'utf8'));
  return await validateFrontendReceipt({root,dataRoot,receipt});
 }catch{return null;}
}
async function validateFrontendReceipt({root,dataRoot,receipt,outputFile=null}){
 try{
  if(receipt.schema!==SCHEMA||!Array.isArray(receipt.files)||receipt.files.length<5||receipt.files.length>MAX_FILES||!Array.isArray(receipt.contexts)||!Array.isArray(receipt.missing)||receipt.contexts.length+receipt.missing.length>MAX_FILES)return null;
  if(!receipt.output||!/^_webpack\/[a-f0-9]{16}\/output\/lib\.js$/.test(receipt.output.relative)||!Number.isSafeInteger(receipt.output.size)||receipt.output.size<0||!/^([a-f0-9]{64})$/.test(receipt.output.hash))return null;
  const names=[...receipt.files.map(e=>e.relative),...receipt.contexts.map(e=>e.relative),...receipt.missing];
  if(!names.every(safeRelative)||new Set(receipt.files.map(e=>e.relative)).size!==receipt.files.length)return null;
  if(!['public/lib.js','webpack.config.js','package.json','package-lock.json','src/middleware/webpack-serve.js'].every(name=>receipt.files.some(entry=>entry.relative===name)))return null;
  let bytes=0;for(const entry of receipt.files){if(!Number.isSafeInteger(entry.size)||entry.size<0||!/^([a-f0-9]{64})$/.test(entry.hash))return null;bytes+=entry.size;}if(bytes>MAX_BYTES)return null;
  await checkParents(root,names);
  const valid=await mapLimit(receipt.files,async entry=>{const value=await fileHash(path.join(root,entry.relative),entry.size);return value.hash===entry.hash;});
  if(valid.includes(false))return null;
  for(const entry of receipt.contexts)if(await directoryHash(path.join(root,entry.relative))!==entry.hash)return null;
  for(const name of receipt.missing){try{await fs.lstat(path.join(root,name));return null;}catch(e){if(e.code!=='ENOENT'&&e.code!=='ENOTDIR')throw e;}}
  const output=outputFile||path.join(dataRoot,receipt.output.relative);await noLinks(output);const value=await fileHash(output,receipt.output.size);
  if(value.hash!==receipt.output.hash||value.size!==receipt.output.size)return null;
  return output;
 }catch{return null;}
}
async function readBundledFrontend({root,resources}){
 try{
  if(!resources)return null;const location=path.join(resources,'manifest.json');await noLinks(location);
  if((await fs.stat(location)).size>2*1024*1024)return null;
  const descriptor=JSON.parse(await fs.readFile(location,'utf8'));
  if(descriptor.schema!==1||descriptor.version!=='1.19.0'||descriptor.commit!=='06bde939fb1e9c4c8d8641d810f0a916b5bce127')return null;
  return await validateFrontendReceipt({root,dataRoot:resources,receipt:descriptor.receipt,outputFile:path.join(resources,'lib.js')});
 }catch{return null;}
}
async function createFrontendReceipt({root,dataRoot,stats,compiler}){
 try{
  if(!stats||stats.hasErrors()||!stats.compilation)return false;
  const output=path.join(compiler.options.output.path,compiler.options.output.filename);
  if(!inside(dataRoot,output))return false;
  const outputRelative=relative(dataRoot,output);if(!/^_webpack\/[a-f0-9]{16}\/output\/lib\.js$/.test(outputRelative))return false;
  const compilation=stats.compilation;
  const inputs=new Set([...compilation.fileDependencies,...['public/lib.js','webpack.config.js','package.json','package-lock.json','src/middleware/webpack-serve.js'].map(name=>path.join(root,name))]);
  const contexts=[...compilation.contextDependencies];const missing=[...compilation.missingDependencies];
  // External resolutions cannot be proven stable inside this managed backend.
  if([...contexts,...missing].some(file=>!inside(root,file)))return false;
  if(inputs.size+contexts.length+missing.length>MAX_FILES)return false;
  const fileNames=[];for(const file of inputs){const stat=await fs.lstat(file);if(stat.isDirectory()&&!stat.isSymbolicLink()&&(inside(root,file)||inside(file,root)))continue;if(!inside(root,file))return false;fileNames.push(relative(root,file));}
  const contextNames=contexts.map(file=>relative(root,file));const missingNames=missing.map(file=>relative(root,file));
  const names=[...fileNames,...contextNames,...missingNames];if(!names.every(safeRelative))return false;
  await checkParents(root,names);await noLinks(output);
  let bytes=0;
  const files=await mapLimit(fileNames.sort(),async name=>{const value=await fileHash(path.join(root,name),undefined,stats.startTime);bytes+=value.size;return {relative:name,...value};});
  if(bytes>MAX_BYTES)return false;
  const receipt={schema:SCHEMA,files,contexts:await mapLimit(contextNames.sort(),async name=>({relative:name,hash:await directoryHash(path.join(root,name),stats.startTime)})),missing:missingNames.sort(),output:{relative:outputRelative,...await fileHash(output)}};
  return receipt;
 }catch{return false;}
}
async function saveFrontendCache(options){
 try{const receipt=await createFrontendReceipt(options);if(!receipt)return false;const location=receiptPath(options.dataRoot);await noLinks(location);await fs.mkdir(path.dirname(location),{recursive:true});await atomicJson(location,receipt);return true;}catch{return false;}
}
module.exports={readFrontendCache,saveFrontendCache,receiptPath,createFrontendReceipt,readBundledFrontend};
