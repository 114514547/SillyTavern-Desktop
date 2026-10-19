'use strict';
const crypto=require('node:crypto');const yaml=require('yaml');
const {fs,path}=require('../desktop/services/files.cjs');
const {ARTIFACT,verifyEnvelope,verifyEngineInfo,verifyInstaller}=require('../desktop/services/update-trust.cjs');
const root=path.resolve(__dirname,'..');
(async()=>{
  const pkg=require('../package.json'),policy=require('../resources/update-policy.json'),backend=require('../vendor/manifest.json');
  const privateKey=process.env.ST_UPDATE_SIGNING_KEY || await fs.readFile(path.join(root,'.release/update-private.pem'),'utf8');
  if(crypto.createPublicKey(privateKey).export({type:'spki',format:'pem'})!==policy.publicKey)throw new Error('Signing key does not match pinned public key.');
  const latest=yaml.parse(await fs.readFile(path.join(root,'dist/latest.yml'),'utf8'));
  const p={schema:1,repository:policy.repository,channel:'stable',platform:'win32',arch:'x64',version:pkg.version,releaseDate:new Date().toISOString(),backend:{version:backend.version,commit:backend.commit},notes:(await fs.readFile(path.join(root,'RELEASE_NOTES.md'),'utf8')).slice(0,30000),artifact:{name:ARTIFACT,size:latest.files?.[0]?.size,sha512:latest.files?.[0]?.sha512}};
  verifyEngineInfo(latest,p);await verifyInstaller(path.join(root,'dist',ARTIFACT),p);
  const raw=Buffer.from(JSON.stringify(p));const envelope=JSON.stringify({payload:raw.toString('base64'),signature:crypto.sign(null,raw,privateKey).toString('base64')},null,2);
  verifyEnvelope(envelope,policy,backend);await fs.writeFile(path.join(root,'dist/desktop-update.json'),envelope);
  console.log('Signed stable update manifest for '+pkg.version+'. Private key excluded.');
})().catch(e=>{console.error('Release signing failed: '+e.message);process.exitCode=1;});
