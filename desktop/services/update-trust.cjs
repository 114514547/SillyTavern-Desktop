'use strict';
const crypto=require('node:crypto');
const {createReadStream}=require('node:fs');
const {fs,fail,noLinks}=require('./files.cjs');
const ARTIFACT='SillyTavern-Desktop-Setup-x64.exe';
function versionParts(s){
  if(typeof s!=='string'||!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(s))throw fail('更新版本格式无效，仅接受正式稳定版。');
  const p=s.split('.').map(Number);if(p.some(n=>!Number.isSafeInteger(n)||n>2147483647))throw fail('更新版本超出有效范围。');return p;
}
function compareVersions(a,b){const x=versionParts(a),y=versionParts(b);for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]>y[i]?1:-1;return 0;}
function repositoryBase(repository){
  if(typeof repository!=='string'||! /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(repository))throw fail('更新仓库名称无效。');
  return `https://github.com/${repository}/releases/`;
}
function verifyEnvelope(text,policy,backend){
  if(typeof text!=='string'||Buffer.byteLength(text)>256*1024)throw fail('更新清单过大或格式无效。');
  let envelope,payload;
  try{
    envelope=JSON.parse(text);
    if(typeof envelope.payload!=='string'||typeof envelope.signature!=='string'||!policy.publicKey)throw new Error();
    const raw=Buffer.from(envelope.payload,'base64'),signature=Buffer.from(envelope.signature,'base64');
    if(signature.length!==64||!crypto.verify(null,raw,policy.publicKey,signature))throw new Error();
    payload=JSON.parse(raw.toString('utf8'));
  }catch{throw fail('更新清单签名验证失败，已拒绝下载。');}
  versionParts(payload.version);
  if(payload.schema!==1||payload.channel!=='stable'||payload.channel!==policy.channel||payload.repository!==policy.repository||payload.platform!=='win32'||payload.arch!=='x64')throw fail('更新清单的渠道、仓库或系统架构不匹配。');
  const a=payload.artifact;
  if(!a||a.name!==ARTIFACT||!Number.isSafeInteger(a.size)||a.size<=0||a.size>2*1024**3||typeof a.sha512!=='string'||!/^[A-Za-z0-9+/]{86}==$/.test(a.sha512))throw fail('更新安装包描述无效。');
  if(typeof payload.notes!=='string'||payload.notes.length>32000||!Number.isFinite(Date.parse(payload.releaseDate)))throw fail('更新说明格式无效。');
  if(payload.backend?.commit!==backend.commit||payload.backend?.version!==backend.version)throw fail('此版本改变了酒馆本体基线，需要单独迁移；当前不会自动安装。');
  return payload;
}
function verifyEngineInfo(info,payload){
  const f=info?.files;
  if(info?.version!==payload.version||!Array.isArray(f)||f.length!==1||f[0].url!==payload.artifact.name||f[0].sha512!==payload.artifact.sha512||f[0].size!==payload.artifact.size||info.packages||f[0].isAdminRightsRequired===true)throw fail('下载源的版本信息与签名清单不一致。');
}
async function verifyInstaller(file,payload){
  await noLinks(file);
  const stat=await fs.stat(file);if(!stat.isFile()||stat.size!==payload.artifact.size)throw fail('更新安装包大小校验失败。');
  const hash=crypto.createHash('sha512');for await(const b of createReadStream(file))hash.update(b);
  if(hash.digest('base64')!==payload.artifact.sha512)throw fail('更新安装包校验失败，已停止安装。');
}
module.exports={ARTIFACT,versionParts,compareVersions,repositoryBase,verifyEnvelope,verifyEngineInfo,verifyInstaller};
