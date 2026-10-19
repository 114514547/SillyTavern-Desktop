'use strict';
const {_electron:electron}=require('playwright-core');const crypto=require('node:crypto');const http=require('node:http');const assert=require('node:assert/strict');const {once}=require('node:events');
const {fs,path}=require('../desktop/services/files.cjs');const {fixture}=require('../tests/helpers.cjs');
const root=path.resolve(__dirname,'..'),home=path.join(root,'test-results','更新 中文 空格 '+Date.now());
let app,server;
(async()=>{
  await fs.mkdir(home,{recursive:true});
  const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519');const backend=require('../vendor/manifest.json');
  const policy={repository:'114514547/SillyTavern-Desktop',channel:'stable',publicKey:publicKey.export({type:'spki',format:'pem'})};
  const bytes=Buffer.alloc(2*1024*1024,0x53);const sha512=crypto.createHash('sha512').update(bytes).digest('base64');
  const payload={schema:1,repository:policy.repository,channel:'stable',platform:'win32',arch:'x64',version:'0.2.1',releaseDate:new Date().toISOString(),backend:{version:backend.version,commit:backend.commit},notes:'本地合成发布：验证签名、真实下载器、进度、校验和备份。不会执行测试安装包。',artifact:{name:'SillyTavern-Desktop-Setup-x64.exe',size:bytes.length,sha512}};
  const raw=Buffer.from(JSON.stringify(payload)),envelope=JSON.stringify({payload:raw.toString('base64'),signature:crypto.sign(null,raw,privateKey).toString('base64')});
  server=http.createServer((req,res)=>{
    if(req.url.startsWith('/desktop-update.json')){res.end(envelope);return;}
    if(req.url.startsWith('/latest.yml')){res.end(`version: 0.2.1\nfiles:\n  - url: ${payload.artifact.name}\n    sha512: ${sha512}\n    size: ${bytes.length}\npath: ${payload.artifact.name}\nsha512: ${sha512}\nreleaseDate: '${payload.releaseDate}'\n`);return;}
    if(req.url.startsWith('/'+payload.artifact.name)){res.setHeader('Content-Length',bytes.length);let offset=0;const timer=setInterval(()=>{if(offset>=bytes.length){clearInterval(timer);res.end();return;}res.write(bytes.subarray(offset,offset+65536));offset+=65536;},30);res.on('close',()=>clearInterval(timer));return;}
    res.statusCode=404;res.end();
  });server.listen(0,'127.0.0.1');await once(server,'listening');
  const config={home,policy,backend,source:await fixture(),feed:`http://127.0.0.1:${server.address().port}/`};const configFile=path.join(home,'fixture.json');await fs.writeFile(configFile,JSON.stringify(config));
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  app=await electron.launch({executablePath:require('electron'),args:[path.join(root,'tests/fixtures/update-engine.cjs'),configFile],env,timeout:30000});
  const page=await app.firstWindow();await page.waitForSelector('#check');await page.click('#check');
  await page.waitForSelector('#download:not([hidden])',{timeout:30000});
  assert.ok((await page.locator('#version').textContent()).includes('0.2.1'));
  await page.screenshot({path:path.join(root,'test-results/update-available.png')});
  await page.click('#download');await page.waitForSelector('#install:not([hidden])',{timeout:60000});
  await page.screenshot({path:path.join(root,'test-results/update-downloaded.png')});
  await page.click('#install');
  const deadline=Date.now()+20000;let result;
  while(Date.now()<deadline){result=JSON.parse(await fs.readFile(path.join(home,'result.json'),'utf8').catch(()=>'null'));if(result)break;await new Promise(r=>setTimeout(r,200));}
  assert.equal(result?.passed,true);assert.equal(result.autoInstallOnQuit,false);assert.equal(result.autoDownload,false);assert.equal(result.hasBackup,true);assert.equal(result.actualInstallerExecuted,false);
  await fs.writeFile(path.join(root,'test-results/updates-engine.json'),JSON.stringify({date:new Date().toISOString(),...result,checks:['signed-manifest','real-NsisUpdater-metadata','real-HTTP-download','SHA512-verification','Chinese-update-UI','backup-before-handoff','no-auto-install-on-quit','installer-handoff-intercepted-for-safety']},null,2));
  console.log('Real NSIS update download + backup handoff smoke passed. Test installer was not executed.');
})().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(async()=>{if(app)await app.close().catch(()=>{});if(server)await new Promise(r=>server.close(r));});
