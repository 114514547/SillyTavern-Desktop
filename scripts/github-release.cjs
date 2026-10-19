'use strict';
// Maintainer tool only. Credentials remain in memory and are never printed or saved.
const {execFileSync}=require('node:child_process');const fs=require('node:fs/promises');const path=require('node:path');
const policy=require('../resources/update-policy.json');const root=path.resolve(__dirname,'..');
async function main(){
  let credential;
  try{credential=execFileSync('git',['credential','fill'],{input:'protocol=https\nhost=github.com\n\n',encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','ignore'],env:{...process.env,GCM_INTERACTIVE:'Never',GIT_TERMINAL_PROMPT:'0'}});}catch{throw new Error('Existing GitHub credential is not available.');}
  const token=credential.split(/\r?\n/).find(l=>l.startsWith('password='))?.slice(9);credential=null;
  if(!token)throw new Error('No stored GitHub credential.');
  async function api(url,{method='GET',body,raw=false,contentType='application/json'}={}){
    const target=new URL(url.startsWith('https://')?url:'https://api.github.com'+url);
    if(target.protocol!=='https:'||!['api.github.com','uploads.github.com'].includes(target.hostname))throw new Error('Refused unknown GitHub API host.');
    const response=await fetch(target,{method,signal:AbortSignal.timeout(raw?600000:30000),headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','Content-Type':contentType},body:body===undefined?undefined:raw?body:JSON.stringify(body)});
    if(!response.ok)throw new Error('GitHub API '+response.status+' ('+method+')');
    if(response.status===204)return null;return response.json();
  }
  const user=await api('/user');if(user.login!==policy.repository.split('/')[0])throw new Error('Authenticated GitHub account does not match release owner.');
  const mode=process.argv[2],repo='/repos/'+policy.repository;
  if(mode==='create'){
    let present=await fetch('https://api.github.com'+repo,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)});
    if(present.status===404){await api('/user/repos',{method:'POST',body:{name:policy.repository.split('/')[1],description:'Windows desktop wrapper for original SillyTavern, with signed app updates and local data backups.',private:false,auto_init:false,has_issues:true}});console.log('Public repository created: '+policy.repository);}else if(present.ok)console.log('Repository already exists: '+policy.repository);else throw new Error('Cannot inspect release repository.');
  }else if(mode==='secret'){
    const sodium=require('libsodium-wrappers');await sodium.ready;
    const publicKey=await api(repo+'/actions/secrets/public-key');
    const secret=await fs.readFile(path.join(root,'.release/update-private.pem'));
    const encrypted=sodium.crypto_box_seal(secret,sodium.from_base64(publicKey.key,sodium.base64_variants.ORIGINAL));
    await api(repo+'/actions/secrets/ST_UPDATE_SIGNING_KEY',{method:'PUT',body:{encrypted_value:sodium.to_base64(encrypted,sodium.base64_variants.ORIGINAL),key_id:publicKey.key_id}});
    secret.fill(0);console.log('Release signing secret configured in GitHub Actions; no secret printed.');
  }else if(mode==='publish'){
    const version=require('../package.json').version;
    const release=await api(repo+'/releases',{method:'POST',body:{tag_name:'v'+version,target_commitish:'main',name:'SillyTavern Desktop '+version,body:await fs.readFile(path.join(root,'RELEASE_NOTES.md'),'utf8'),draft:true,prerelease:false}});
    const files=['SillyTavern-Desktop-Setup-x64.exe','SillyTavern-Desktop-Setup-x64.exe.blockmap','latest.yml','desktop-update.json','SillyTavern-Desktop-source.zip'];
    for(const file of files){await api(release.upload_url.split('{')[0]+'?name='+encodeURIComponent(file),{method:'POST',raw:true,contentType:'application/octet-stream',body:await fs.readFile(path.join(root,'dist',file))});console.log('Uploaded '+file);}
    await api(repo+'/releases/'+release.id,{method:'PATCH',body:{draft:false,make_latest:'true'}});console.log('Published https://github.com/'+policy.repository+'/releases/tag/v'+version);
  }else throw new Error('Expected create, secret, or publish.');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
