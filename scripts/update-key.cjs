'use strict';
const crypto=require('node:crypto');
const {fs,path,exists,privateDir,atomicJson}=require('../desktop/services/files.cjs');
const root=path.resolve(__dirname,'..');
(async()=>{
  const dir=path.join(root,'.release');await privateDir(dir);const file=path.join(dir,'update-private.pem');
  const policyFile=path.join(root,'resources/update-policy.json');const policy=JSON.parse(await fs.readFile(policyFile,'utf8'));
  if(await exists(file)){
    if(crypto.createPublicKey(await fs.readFile(file)).export({type:'spki',format:'pem'})!==policy.publicKey)throw new Error('Key mismatch.');
    console.log('Existing release signing key preserved.');return;
  }
  if(policy.publicKey)throw new Error('Pinned key already exists; recover the original private key instead of rotating it.');
  const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519');
  await fs.writeFile(file,privateKey.export({type:'pkcs8',format:'pem'}),{flag:'wx',mode:0o600});
  policy.publicKey=publicKey.export({type:'spki',format:'pem'});await atomicJson(policyFile,policy);
  console.log('Release signing key generated privately; public verification key embedded.');
})().catch(()=>{console.error('Release key setup failed; no key material printed.');process.exitCode=1;});
