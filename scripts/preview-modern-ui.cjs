'use strict';
// Isolated full native frontend; never opens Electron or uses formal data/model APIs.
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright-core');
const {Managed}=require('../desktop/services/managed.cjs'),{Lifecycle}=require('../desktop/services/lifecycle.cjs');
const {inspect}=require('../desktop/services/installation.cjs'),{installWritingExtension}=require('../desktop/services/writing-extension.cjs');
const {inside,noLinks}=require('../desktop/services/files.cjs');
const root=path.resolve(__dirname,'..'),folder=path.resolve(root,process.argv.find(a=>a.startsWith('--output='))?.slice(9)||'test-results/ui-modern-20261023');
const reference=process.argv.includes('--reference'),before=process.argv.includes('--before');
let browser,lifecycle,currentPage;
async function main(){
 assert.ok(inside(path.join(root,'test-results'),folder)&&folder!==path.join(root,'test-results'),'Preview output must be an isolated test-results folder');await noLinks(folder);await fs.mkdir(folder,{recursive:true});
 browser=await chromium.launch({channel:'msedge',headless:true,args:['--noerrdialogs','--disable-breakpad']});
 if(reference){
  const page=await browser.newPage({viewport:{width:1600,height:1000},locale:'zh-CN'});
  await page.route('https://www.gstatic.com/antigravity/web/dev/tailwindcss.min.js',route=>route.fulfill({path:path.join(folder,'reference-tailwind.js'),contentType:'text/javascript'}));
  await page.goto('file:///'+path.join(root,'sillytavern_ui_demo.html').replaceAll('\\','/'));
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('#agent-left-col')).width==='240px');
  await page.waitForTimeout(1500);
  for(const mode of ['agent','rp','writing']){await page.evaluate(m=>switchMode(m),mode);await page.screenshot({path:path.join(folder,'reference-'+mode+'.png')});}
  await page.evaluate(()=>openSettingsModal());await page.screenshot({path:path.join(folder,'reference-settings.png')});
  console.log('Reference screenshots saved.');return;
 }
 const home=path.join(folder,'isolated-home');
 const managed=new Managed({home,resources:path.join(root,'build'),manifest:require('../vendor/manifest.json')});await managed.initialize();
 const profile=(await managed.list())[0]||await managed.create();
 for(const key of ['root','dataRoot','configPath']){assert.ok(inside(home,path.resolve(profile[key])),'Preview profile must remain in its isolated home');await noLinks(profile[key]);}
 const startupPhases=[];
 lifecycle=new Lifecycle({node:await managed.node(),services:path.join(root,'desktop/services'),preferredPort:0,frontendResources:process.argv.includes('--frontend-bundle')?path.join(root,'build/frontend'):null,onPhase:(phase,durationMs)=>startupPhases.push({phase,...(Number.isFinite(durationMs)?{durationMs}:{})}),prepare:i=>installWritingExtension({root:i.root,source:path.join(root,'desktop/extensions/desktop-writing'),backupRoot:path.join(home,'extension-backups')})});
 const backendStarted=performance.now();
 const active=await lifecycle.start(await inspect(profile.root,profile),{skipExternalCheck:true,useStartupCache:process.argv.includes('--startup-cache')});
 const backendReadyMs=Math.round(performance.now()-backendStarted);
 if(process.argv.includes('--expect-cache-hit')){assert.ok(startupPhases.some(p=>p.phase==='frontend-cache-hit'));assert.ok(!startupPhases.some(p=>p.phase==='webpack-constructor-start'));}
 if(process.argv.includes('--expect-bundled-hit')){assert.ok(startupPhases.some(p=>p.phase==='frontend-bundled-hit'));assert.ok(!startupPhases.some(p=>p.phase==='webpack-constructor-start'));}
 const context=await browser.newContext({viewport:{width:1600,height:1000},locale:'zh-CN',reducedMotion:'no-preference'});
 const errors=[],blocked=[],checks=[];
 await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin!==active.url||/\/generate(?:$|\?)/.test(u.pathname)){blocked.push(u.pathname);return route.abort();}if(/^\/api\/backends\/.*\/status/.test(u.pathname))return route.fulfill({status:200,contentType:'application/json',body:'{"data":[]}'});if(['/api/horde/status','/api/horde/text-models'].includes(u.pathname))return route.fulfill({status:200,contentType:'application/json',body:u.pathname.endsWith('status')?'{"ok":false}':'[]'});return route.continue();});
 // Real workspace service over a synthetic browser bridge. No system chooser or Electron.
 const {LocalWorkspace}=require('../desktop/services/local-workspace.cjs');const service=new LocalWorkspace({home:path.join(folder,'synthetic-agent')});
 const docs=path.join(folder,'synthetic-docs');await fs.mkdir(docs,{recursive:true});await fs.writeFile(path.join(docs,'Characters.md'),'# 人物设定\n\n林澈是负责守护灯塔的药师。\n\n- 动机：保护同伴\n- 冲突：职责与自由');
 await service.load();const entry=await service.connect(docs);
 let thread=(await service.state()).threads[0];if(!thread){thread={id:require('node:crypto').randomUUID(),rootId:entry.id,title:'梳理这个系列的资料结构',draft:'',messages:[{role:'user',text:'请结合资料分析林澈的动机。',records:[]},{role:'assistant',text:'林澈的行动可以从职责与自由之间的冲突展开。\n\n先核对人物经历，再让每次选择产生可以追溯的后果。',records:[],usage:{input:1200,output:240,hit:800}}]};await service.saveThread({thread});}
 await context.exposeBinding('workspaceCall',async(_source,action,arg)=>{try{const allowed=['state','select','list','read','search','pending','proposal','saveThread','deleteThread','removeProject','saveProject','saveNotes','notesStatus','propose','apply','history','restore'];if(!allowed.includes(action))throw Error('Not allowed in fixture');const value=action==='select'?await service.select(arg.id):action==='proposal'?await service.proposal(arg.id):await service[action](arg||{});return {ok:true,value};}catch(e){return {ok:false,error:e.message};}});
 await context.addInitScript(()=>{window.localWorkspace=Object.fromEntries(['state','select','list','read','search','pending','proposal','saveThread','deleteThread','removeProject','saveProject','saveNotes','notesStatus','propose','apply','history','restore'].map(name=>[name,arg=>window.workspaceCall(name,arg)]));});
 const page=await context.newPage();currentPage=page;page.on('pageerror',e=>errors.push(e.message));
 const frontendStarted=performance.now();await page.goto(active.url);
 for(let i=0;i<120;i++){if(await page.locator('#dw-modebar').count())break;const ok=page.locator('dialog[open] .popup-button-ok').last();if(await ok.isVisible())await ok.click();await page.waitForTimeout(500);}
 await page.locator('#dw-modebar').waitFor({timeout:60000});await page.waitForFunction(()=>document.querySelector('#dw-agent')?.shadowRoot?.querySelector('#agent-thread-name'));
 await page.waitForFunction(()=>window.SillyTavernDesktopWriting?.ready===true,undefined,{timeout:60000});checks.push('writing-and-agent-initialization-complete');
 const frontendReadyMs=Math.round(performance.now()-frontendStarted);
 const prefix=before?'before-':'after-';
 for(const mode of ['agent','rp','writing']){
  await page.locator('#dw-modebar [data-mode='+mode+']').click();await page.waitForTimeout(400);
  if(mode==='agent'){await page.locator('#dw-agent').locator('[data-file="Characters.md"]').click();}
  if(mode==='rp'&&await page.locator('#dw-rp-list [data-rp-action=character-select]').count()){await page.locator('#dw-rp-list [data-rp-action=character-select]').first().click();await page.waitForTimeout(500);}
  if(mode==='writing')await page.evaluate(async()=>{const {newProject}=await import('/scripts/extensions/desktop-writing/model.mjs');const p=newProject('星穹余晖');p.chapters[0].title='逆光交锋';p.chapters[0].text='薄雾从长廊尽头涌来。\n\n林澈放慢脚步，掌心的灯火照亮了墙上斑驳的刻痕。她认得这些字迹，却第一次觉得它们如此陌生。\n\n“如果守护意味着永远不能离开，”她问，“那么自由又该是什么？”';const sel=document.querySelector('#dw-project');if(!sel.options.length){document.querySelector('[data-dw-action="new-project"]').click();}}).catch(()=>{});
  // A new-project input is supplied only for isolated synthetic data.
  if(mode==='writing'&&await page.locator('dialog[open] .popup-input').count()){await page.locator('dialog[open] .popup-input').fill('星穹余晖');await page.locator('dialog[open] .popup-button-ok').last().click();await page.waitForTimeout(300);await page.locator('#dw-title').fill('逆光交锋');await page.locator('#dw-body').fill('薄雾从长廊尽头涌来。\n\n林澈放慢脚步，掌心的灯火照亮了墙上斑驳的刻痕。她认得这些字迹，却第一次觉得它们如此陌生。\n\n“如果守护意味着永远不能离开，”她问，“那么自由又该是什么？”');}
  if(mode==='writing'){await page.locator('#dw-title').fill('逆光交锋');await page.locator('#dw-body').fill('薄雾从长廊尽头涌来。\n\n林澈放慢脚步，掌心的灯火照亮了墙上斑驳的刻痕。她认得这些字迹，却第一次觉得它们如此陌生。\n\n“如果守护意味着永远不能离开，”她问，“那么自由又该是什么？”');await page.locator('#dw-title').blur();await page.locator('#dw-body').blur();await page.locator('#dw-call-crossroads').click();await page.waitForTimeout(200);}
  if(mode==='writing')await page.locator('#dw-main').evaluate(n=>n.scrollTop=0);
  await page.screenshot({path:path.join(folder,prefix+mode+'.png')});
 }
 await page.locator('#dw-settings-modal-btn').click();await page.waitForTimeout(400);await page.screenshot({path:path.join(folder,prefix+'settings.png')});
 if(!before&&process.argv.includes('--verify')){
  const {verifyModernUI}=require('./verify-modern-ui.cjs');await verifyModernUI({page,checks,service,entry,folder,active});
 }
 if(process.argv.includes('--rebuild')){
  const {verifyUIRebuild}=require('./verify-ui-rebuild.cjs');await verifyUIRebuild({page,checks,service,entry,folder,active});
 }
 await fs.writeFile(path.join(folder,prefix+'report.json'),JSON.stringify({errors,checks,blockedExternalRequests:blocked.length,isolated:true,electron:false,backendReadyMs,frontendReadyMs,startupPhases},null,2));
 console.log(JSON.stringify({errors,checks,folder}));assert.deepEqual(errors,[]);
}
main().catch(async e=>{console.error(e.stack);if(currentPage){await currentPage.screenshot({path:path.join(folder,'verification-failure.png')}).catch(()=>{});console.log(await currentPage.evaluate(()=>({dialogOpen:document.querySelector('#dw-settings-modal')?.open,status:document.querySelector('#dw-settings-status')?.textContent,labels:[...document.querySelectorAll('#dw-settings-modal .dw-field-label')].map(n=>n.textContent)})).catch(()=>({})));}process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();if(lifecycle)await lifecycle.stop();});
