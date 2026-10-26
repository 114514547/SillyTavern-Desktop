'use strict';
const {_electron:electron}=require('playwright-core');
const {hiddenLaunch,assertHidden,captureHidden}=require('./hidden-electron.cjs');
const assert=require('node:assert/strict');const path=require('node:path');const fs=require('node:fs/promises');const {spawn}=require('node:child_process');const {once}=require('node:events');
const root=path.resolve(__dirname,'..');const result=path.join(root,'test-results');
const executable=process.argv[2]?path.resolve(process.argv[2]):require('electron');
const packaged=!!process.argv[2];
const home=path.join(result,(packaged?'安装版':'开发版')+' 中文 空格 '+Date.now());
const argv=[...(!packaged?[root]:[]),'--desktop-home='+home];
const env={...process.env,PATH:[path.join(process.env.SystemRoot,'System32'),path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0'),process.env.SystemRoot].join(';')};delete env.ELECTRON_RUN_AS_NODE;
let app;
const hidden=hiddenLaunch(argv,env);
async function main(){
  await fs.mkdir(result,{recursive:true});
  app=await electron.launch({executablePath:executable,...hidden,timeout:60000});
  let first=await app.firstWindow();await first.waitForSelector('#fresh',{timeout:60000});
  assert.equal(await first.locator('#advanced-options').evaluate(element=>element.open),false);assert.equal(await first.locator('#fresh').textContent(),'开始使用');
  await captureHidden(app,first,path.join(result,packaged?'packaged-launcher.png':'launcher.png'));
  await first.click('#fresh');
  let page;
  const deadline=Date.now()+360000;
  while(Date.now()<deadline){page=app.windows().find(p=>p.url().startsWith('http://127.0.0.1:'));if(page)break;await new Promise(r=>setTimeout(r,500));}
  if(!page){const status=await first.locator('#status').textContent().catch(()=>'Window unavailable');throw new Error('Backend did not open: '+status);}
  await page.waitForLoadState('domcontentloaded');await page.waitForSelector('#send_textarea',{timeout:90000});
  await page.waitForSelector('#preloader',{state:'detached',timeout:90000});
  await page.waitForSelector('.splash-screen',{state:'detached',timeout:90000});
  const onboarding=page.locator('dialog[open]').filter({has:page.locator('.onboarding')});
  await onboarding.waitFor({state:'visible',timeout:30000});
  await page.evaluate(()=>{window.__desktopAppReady=false;const c=window.SillyTavern.getContext();c.eventSource.once(c.eventTypes.APP_READY,()=>{window.__desktopAppReady=true;});});
  await onboarding.locator('.popup-input').fill('Desktop Test');
  await onboarding.locator('.popup-button-ok').click();
  await page.waitForFunction(()=>window.__desktopAppReady,{},{timeout:90000});
  await page.waitForFunction(async()=>{const c=window.SillyTavern.getContext();const r=await fetch('/api/settings/get',{method:'POST',headers:c.getRequestHeaders(),body:'{}'});return JSON.parse((await r.json()).settings).username==='Desktop Test';},{},{timeout:30000});
  assert.equal(await page.evaluate(()=>typeof window.require),'undefined');assert.equal(await page.evaluate(()=>typeof window.desktop),'undefined');
  const prefs=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(w=>w.webContents.getLastWebPreferences()));
  assert.equal(prefs.length,1);assert.equal(prefs[0].sandbox,true);assert.equal(prefs[0].contextIsolation,true);assert.equal(prefs[0].nodeIntegration,false);assert.equal(prefs[0].webSecurity,true);
  const url=page.url();
  await captureHidden(app,page,path.join(result,packaged?'packaged-sillytavern.png':'sillytavern.png'));
  // A second EXE should activate this window and exit without a second backend.
  const second=spawn(executable,hidden.args,{env:hidden.env,windowsHide:true,stdio:'ignore'});const exit=once(second,'exit');await Promise.race([exit,new Promise((_,j)=>setTimeout(()=>j(new Error('Second instance did not exit')),20000))]);
  assert.equal((await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length)),1);
  // External protocol and untrusted IPC are blocked. Never send a real API key.
  assert.equal(await page.evaluate(()=>window.open('file:///C:/Windows/win.ini')),null);
  const origin=new URL(url).origin;
  await assertHidden(app);await app.close();app=null;
  await new Promise(r=>setTimeout(r,500));
  assert.equal(await fetch(origin,{signal:AbortSignal.timeout(1500)}).then(()=>true).catch(()=>false),false);
  const settings=JSON.parse(await fs.readFile(path.join(home,'settings.json'),'utf8'));
  assert.ok(settings.current.dataRoot.startsWith(home));
  app=await electron.launch({executablePath:executable,...hidden,timeout:60000});
  const restartDeadline=Date.now()+150000;let restarted;
  while(Date.now()<restartDeadline){restarted=app.windows().find(p=>p.url().startsWith('http://127.0.0.1:'));if(restarted)break;await new Promise(r=>setTimeout(r,500));}
  assert.ok(restarted,'Remembered profile restarts offline with bundled Node');
  await restarted.waitForSelector('#preloader',{state:'detached',timeout:90000});
  // Exercise mode A through the real launcher IPC, using only this synthetic installation.
  await app.evaluate(({Menu})=>Menu.getApplicationMenu().items[0].submenu.items.find(i=>i.label.startsWith('返回启动设置')).click());
  let setup;const setupDeadline=Date.now()+30000;
  while(Date.now()<setupDeadline){setup=app.windows().find(p=>p.url().startsWith('file:'));if(setup)break;await new Promise(r=>setTimeout(r,250));}
  assert.ok(setup,'Return to launcher after stopping backend');await setup.waitForSelector('#existing',{state:'attached'});await setup.waitForFunction(()=>document.getElementById('fresh').textContent==='继续使用');await setup.locator('#advanced-options').evaluate(element=>{element.open=true;});
  await setup.evaluate(async p=>{const r=await window.desktop.inspect({root:p.root,mode:'standalone',configPath:p.configPath,dataRoot:p.dataRoot});if(!r.ok)throw new Error(r.error);selection(r.value);},settings.current);
  await setup.click('#existing');let existing;const existingDeadline=Date.now()+150000;
  while(Date.now()<existingDeadline){existing=app.windows().find(p=>p.url().startsWith('http://127.0.0.1:'));if(existing)break;await new Promise(r=>setTimeout(r,500));}
  assert.ok(existing,'Existing installation starts through actual launcher');await existing.waitForSelector('#preloader',{state:'detached',timeout:90000});
  await assertHidden(app);await app.close();app=null;
  await fs.writeFile(path.join(result,packaged?'desktop-packaged.json':'desktop-dev.json'),JSON.stringify({version:require('../package.json').version,date:new Date().toISOString(),packaged,executable,home,hidden:true,checks:['original-ui-APP_READY','synthetic-onboarding','UI-settings-persistence','bundled-node-without-PATH-node-git-npm','sandbox','contextIsolation','no-nodeIntegration','no-frontend-desktop-IPC','one-window','second-instance-exits','block-file-popup','graceful-close','remembered-profile-restart','existing-installation-via-launcher'],passed:true},null,2));
  console.log('Desktop smoke passed: '+(packaged?'packaged executable':'development Electron'));
}
main().catch(async e=>{console.error(e.message);if(app)await app.close().catch(()=>{});process.exitCode=1;});
