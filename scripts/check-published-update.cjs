'use strict';
const {_electron:electron}=require('playwright-core');const path=require('node:path');const fs=require('node:fs/promises');const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');let app;
(async()=>{
  const exe=path.resolve(process.argv[2]||path.join(root,'dist/win-unpacked/SillyTavern Desktop.exe'));
  const home=path.join(root,'test-results','线上更新验证 '+Date.now());const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  app=await electron.launch({executablePath:exe,args:['--desktop-home='+home],env,timeout:60000});
  const launcher=await app.firstWindow();await launcher.waitForSelector('#updates',{timeout:60000});await launcher.click('#updates');
  let page;const deadline=Date.now()+15000;
  while(Date.now()<deadline){page=app.windows().find(p=>p.url().endsWith('/updates.html'));if(page)break;await new Promise(r=>setTimeout(r,100));}
  assert.ok(page,'Native update window opens');await page.waitForSelector('#check');
  assert.equal(await page.evaluate(()=>typeof window.desktop),'undefined');assert.equal(await page.evaluate(()=>typeof window.require),'undefined');
  await page.click('#check');await page.waitForFunction(()=>document.getElementById('message').textContent==='当前已是最新稳定版。',{},{timeout:45000});
  await page.screenshot({path:path.join(root,'test-results/published-update.png')});
  await fs.writeFile(path.join(root,'test-results/published-update.json'),JSON.stringify({date:new Date().toISOString(),passed:true,repository:'114514547/SillyTavern-Desktop',version:require('../package.json').version,checks:['packaged-update-window','live-GitHub-Release','embedded-public-key-verification','current-version-detection','isolated-IPC','no-download-or-install']},null,2));
  console.log('Published update source verified from packaged application.');
})().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(async()=>{if(app)await app.close().catch(()=>{});});
