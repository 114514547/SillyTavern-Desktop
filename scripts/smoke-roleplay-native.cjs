'use strict';
// Full pinned frontend + isolated real backend, headless Edge only; no Electron or model calls.
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(process.argv.find(x=>x.startsWith('--root='))?.slice(7)||path.join(__dirname,'..'));
const {chromium}=require(path.join(root,'node_modules/playwright-core'));
const {Managed}=require(path.join(root,'desktop/services/managed.cjs')),{Lifecycle}=require(path.join(root,'desktop/services/lifecycle.cjs'));
const {inspect}=require(path.join(root,'desktop/services/installation.cjs')),{installWritingExtension}=require(path.join(root,'desktop/services/writing-extension.cjs'));
const manifest=require(path.join(root,'vendor/manifest.json')),probe=process.argv.includes('--probe');
const home=path.resolve(root,process.argv.find(x=>x.startsWith('--home='))?.slice(7)||'test-results/rp-native-20261022'),out=path.join(home,probe?'before':'after');
let browser,lifecycle,page;const errors=[],blocked=[],checks=[],samples=[];
const drawers={preset:'ai-config-button',model:'sys-settings-button',format:'advanced-formatting-button',world:'WI-SP-button',appearance:'user-settings-button',background:'backgrounds-button',extensions:'extensions-settings-button',persona:'persona-management-button',character:'rightNavHolder'};
async function snapshot(label){
 const data=await page.evaluate(({drawers,label})=>{
  const p=document.querySelector('#'+drawers[document.querySelector('#dw-rp-rail [aria-pressed="true"]')?.dataset.rpAction]+' > .drawer-content');if(!p)return {label,missing:true};
  const rect=p.getBoundingClientRect(),style=getComputedStyle(p),visible=n=>{const r=n.getBoundingClientRect(),s=getComputedStyle(n);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';};
  const h=p.querySelector('h3'),hr=h?.getBoundingClientRect();
  return {label,id:p.id,width:rect.width,clientWidth:p.clientWidth,scrollWidth:p.scrollWidth,transition:style.transitionDuration,heading:hr?{width:hr.width,height:hr.height}:null,
   outerOverflow:style.overflowY,scrollHeight:p.scrollHeight,clientHeight:p.clientHeight,
   nestedSettingScrollers:[...p.querySelectorAll('.scrollableInner,.scrollableInnerFull')].filter(visible).filter(n=>/auto|scroll/.test(getComputedStyle(n).overflowY)&&n.scrollHeight>n.clientHeight+1).map(n=>n.id||n.className),
   overflow:[...p.querySelectorAll('*')].filter(visible).filter(n=>{const r=n.getBoundingClientRect();return r.right>rect.right+2||r.left<rect.left-2;}).slice(0,15).map(n=>({id:n.id,tag:n.tagName,cls:n.className?.baseVal||n.className,width:Math.round(n.getBoundingClientRect().width)})),
   columns:['ContextSettings','InstructSettingsColumn','SystemPromptColumn','UI-Theme-Block','UI-Customization','power-user-options-block','persona-management-block'].map(id=>{const n=p.querySelector('#'+id),r=n?.getBoundingClientRect();return r?{id,width:r.width,x:r.x,y:r.y}:null;}).filter(Boolean)};
 },{drawers,label});samples.push(data);return data;
}
async function tab(name){const panel=page.locator('#'+drawers[name]+' > .drawer-content.dw-rp-docked.openDrawer');if(!await panel.isVisible())await page.locator('#dw-rp-rail [data-rp-action='+name+']').click();await panel.waitFor({state:'visible'});await page.waitForTimeout(420);}
async function verifyAdoption(){
 const adoptionChecks=[];
 await page.locator('#dw-modebar [data-mode=writing]').click();
 async function open(){
  await page.evaluate(async()=>{
   const base='/scripts/extensions/desktop-writing/',{Discussion}=await import(base+'discussion.mjs'),m=await import(base+'model.mjs');
   const p=m.newProject('合成差量测试'),chapter=p.chapters[0],conversation=p.conversations[0];chapter.text='前文。女药师抬头。后文。';
   const quoted='女药师抬头。',start=chapter.text.indexOf(quoted),message={id:m.uid(),text:'女药师低头。',excerpt:{chapterId:chapter.id,title:chapter.title,text:quoted,start,end:start+quoted.length,revision:await m.textRevision(chapter.text)}};
   const fixture=window.adoptionFixture={p,chapter,conversation,message,original:chapter.text,saves:0,dirty:0,done:false,error:null};
   const discussion=new Discussion({dirty:()=>fixture.dirty++,save:async()=>{fixture.saves++;},showChapter:()=>{}});
   fixture.promise=discussion.adopt(p,conversation,message).catch(error=>{fixture.error=error.message;}).finally(()=>{fixture.done=true;});
  });
  await page.getByLabel('采用方式',{exact:true}).waitFor();
 }
 async function finish(confirm){await page.locator('dialog[open] '+(confirm?'.popup-button-ok':'.popup-button-cancel')).last().click();await page.waitForFunction(()=>adoptionFixture.done);}
 await open();await page.getByLabel('采用方式',{exact:true}).selectOption('replace');
 assert.equal(await page.locator('.dw-inline-diff del').textContent(),'抬');assert.equal(await page.locator('.dw-inline-diff ins').textContent(),'低');assert.equal(await page.getByLabel('采用的正文',{exact:true}).isVisible(),false);
 await page.locator('.dw-popup details summary').click();await page.getByLabel('采用的正文',{exact:true}).fill('<img src=x onerror=alert(1)>女药师低头。');
 assert.equal(await page.locator('.dw-inline-diff img').count(),0);assert.ok((await page.locator('.dw-inline-diff').textContent()).includes('<img'));
 await page.getByLabel('采用的正文',{exact:true}).fill('女药师低头。');await page.screenshot({path:path.join(out,'adoption-diff.png')});await finish(true);
 const adopted=await page.evaluate(()=>({text:adoptionFixture.chapter.text,history:adoptionFixture.chapter.history[0].text,source:adoptionFixture.chapter.sources[0].type,saves:adoptionFixture.saves,error:adoptionFixture.error}));
 assert.deepEqual(adopted,{text:'前文。女药师低头。后文。',history:'前文。女药师抬头。后文。',source:'writing-chat',saves:1,error:null});adoptionChecks.push('live-safe-inline-diff-and-snapshot-adoption');
 await open();await page.getByLabel('采用方式',{exact:true}).selectOption('replace');await page.evaluate(()=>{adoptionFixture.chapter.text='其他编辑器的新正文';});await finish(true);
 const stale=await page.evaluate(()=>({text:adoptionFixture.chapter.text,history:adoptionFixture.chapter.history.length,saves:adoptionFixture.saves,error:adoptionFixture.error}));assert.equal(stale.text,'其他编辑器的新正文');assert.equal(stale.history,0);assert.equal(stale.saves,0);assert.match(stale.error,/正文已变化/);adoptionChecks.push('stale-revision-refuses-replacement');
 await open();await page.getByLabel('采用方式',{exact:true}).selectOption('replace');await page.getByLabel('采用目标章节',{exact:true}).selectOption('__new__');assert.equal(await page.getByLabel('选段替换差量对比',{exact:true}).isVisible(),false);await finish(false);
 assert.deepEqual(await page.evaluate(()=>({chapters:adoptionFixture.p.chapters.length,saves:adoptionFixture.saves,text:adoptionFixture.chapter.text})),{chapters:1,saves:0,text:'前文。女药师抬头。后文。'});adoptionChecks.push('target-switch-hides-diff-and-cancel-never-writes');
 await open();await finish(true);assert.equal(await page.evaluate(()=>adoptionFixture.chapter.text),'前文。女药师抬头。后文。\n\n女药师低头。');adoptionChecks.push('append-mode-still-works');
 await open();await page.getByLabel('采用目标章节',{exact:true}).selectOption('__new__');await page.getByLabel('新章节标题',{exact:true}).fill('新章节');await finish(true);assert.equal(await page.evaluate(()=>adoptionFixture.p.chapters[1].text),'女药师低头。');adoptionChecks.push('new-chapter-mode-still-works');
 assert.deepEqual(errors,[]);await fs.writeFile(path.join(out,'adoption.json'),JSON.stringify({passed:true,headless:true,scope:'Real pinned native Popup and current Discussion; synthetic in-memory project; no manuscript persistence or model calls',checks:adoptionChecks,errors},null,2));console.log(JSON.stringify({adoption:true,passed:true,checks:adoptionChecks}));
}
async function main(){
 await fs.mkdir(out,{recursive:true});
 const managed=new Managed({home,resources:path.join(root,'build'),manifest});await managed.initialize();
 const profile=(await managed.list())[0]||await managed.create();
 lifecycle=new Lifecycle({node:await managed.node(),services:path.join(root,'desktop/services'),prepare:i=>installWritingExtension({root:i.root,source:path.join(root,'desktop/extensions/desktop-writing'),backupRoot:path.join(home,'extension-backups')})});
 const active=await lifecycle.start(await inspect(profile.root,profile),{skipExternalCheck:true});
 browser=await chromium.launch({channel:'msedge',headless:true,args:['--noerrdialogs','--disable-breakpad','--disable-gpu']});
 const context=await browser.newContext({viewport:{width:1400,height:900},locale:'zh-CN',reducedMotion:'no-preference'});
 await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin!==active.url||/\/generate(?:$|\?)/.test(u.pathname)){blocked.push(u.origin===active.url?u.pathname:'external');return route.abort();}if(['/api/horde/status','/api/horde/text-models'].includes(u.pathname))return route.fulfill({status:200,contentType:'application/json',body:u.pathname.endsWith('/status')?'{"ok":false}':'[]'});return route.continue();});
 page=await context.newPage();page.on('pageerror',e=>{errors.push(e.message);console.error(e.stack||e.message);});page.on('response',r=>{if(r.status()>=500)console.error('HTTP '+r.status()+' '+new URL(r.url()).pathname);});
 await page.goto(active.url);await page.locator('dialog[open], #dw-rp-rail').first().waitFor({timeout:90000});
 for(let i=0;i<80;i++){if(await page.locator('#dw-rp-rail').isVisible())break;const ok=page.locator('dialog[open] .popup-button-ok').last();if(await ok.isVisible()){await ok.click();console.log('Accepted isolated fresh-profile welcome.');}await page.waitForTimeout(500);}
 await page.locator('#dw-rp-rail').waitFor({timeout:30000});await page.locator('#dw-agent').waitFor({state:'attached'});console.log('Full native UI ready (isolated, headless).');
 if(process.argv.includes('--adoption-only')){await verifyAdoption();return;}
 // Use the real fast-UI toggle to enable upstream's normal CSS transitions (default fresh data disables them).
 await page.evaluate(async()=>{const {power_user}=await import('/scripts/power-user.js');if(power_user.fast_ui_mode){document.querySelector('#fast_ui_mode').click();}});
 assert.equal(await page.locator('body').evaluate(n=>n.classList.contains('no-blur')),false);
 await page.waitForTimeout(500);
 await page.evaluate(drawers=>{
  window.rpParents=Object.fromEntries(Object.values(drawers).map(id=>[id,document.querySelector('#'+id+' > .drawer-content').parentElement]));window.rpChat=document.querySelector('#chat');window.rpForm=document.querySelector('#form_sheld');window.rpLeaks=[];window.rpFrames=0;
  function frame(){window.rpFrames++;const dock=document.querySelector('#dw-rp-settings').getBoundingClientRect();for(const id of Object.keys(rpParents)){const n=document.querySelector('#'+id+' > .drawer-content'),r=n.getBoundingClientRect(),s=getComputedStyle(n);if(r.width&&r.height>2&&s.display!=='none'&&s.visibility!=='hidden'&&(r.left<dock.left-2||r.right>dock.right+2)&&document.body.classList.contains('dw-rp-mode')&&!document.body.classList.contains('dw-native-tools-open')){if(rpLeaks.length<50)rpLeaks.push({id,x:r.x,y:r.y,width:r.width,height:r.height,classes:n.className});}}window.rpFrame=requestAnimationFrame(frame);}frame();
 },drawers);
 const nativeTransition=await page.locator('#Backgrounds').evaluate(n=>getComputedStyle(n).transitionDuration);assert.ok(nativeTransition.split(',').some(x=>parseFloat(x)>0));checks.push('normal-native-animation-enabled');
 for(const name of ['format','preset','format','background','extensions','persona','appearance','world','format','model','character','preset']){await tab(name);await snapshot(name+'-250');}
 await tab('format');await page.screenshot({path:path.join(out,'format-250.png')});
 await tab('preset');await page.screenshot({path:path.join(out,'preset-single-scroll-250.png')});await tab('format');
 // Keep a real textarea's unsaved edit and original control object through tab switches.
 await page.evaluate(()=>{window.rpText=document.querySelector('#context_story_string');rpText.value='SYNTHETIC_UNSAVED_LAYOUT_TEXT';});
 for(const width of [250,320,480,640]){
  await page.locator('#dw-rp-resize').focus();await page.keyboard.press('Home');for(let i=250;i<width;i+=10)await page.keyboard.press('ArrowLeft');
  for(const name of ['format','appearance','persona','background','extensions','world','preset','model','character']){await tab(name);await snapshot(name+'-'+width);}
 }
 await page.locator('#dw-rp-resize').focus();await page.keyboard.press('Home');
 if(!probe){
  await tab('background');const before=await page.locator('#bg_menu_content .bg_example').first().evaluate(n=>n.getBoundingClientRect().width);await page.locator('#bg_thumb_zoom_in').click();await page.locator('#bg_thumb_zoom_in').click();const zoomed=await page.locator('#bg_menu_content .bg_example').first().evaluate(n=>n.getBoundingClientRect().width);assert.ok(zoomed>before,'native thumbnail zoom remains effective');await page.locator('#bg_thumb_zoom_out').click();await page.locator('#bg_thumb_zoom_out').click();checks.push('native-background-thumbnail-zoom');
  await tab('format');await page.evaluate(()=>{const p=document.querySelector('#AdvancedFormatting');p.style.setProperty('transition-duration','333ms','important');window.rpInline=p.getAttribute('style');});await tab('world');assert.equal(await page.locator('#AdvancedFormatting').getAttribute('style'),await page.evaluate(()=>rpInline));checks.push('inline-transition-longhand-preserved');
 }
 await tab('background');await page.screenshot({path:path.join(out,'background-250.png')});
 await tab('persona');await page.screenshot({path:path.join(out,'persona-250.png')});
 await tab('appearance');await page.screenshot({path:path.join(out,'appearance-250.png')});
 await page.locator('#dw-rp-settings [data-rp-action=right-close]').click();await page.waitForTimeout(420);assert.equal(await page.locator('#dw-rp-settings').isVisible(),false);assert.equal(await page.locator('.dw-rp-docked').count(),0);await tab('format');checks.push('collapse-and-reopen');
 // Real native editor expansion event chain and original text area are retained.
 if(!probe){await page.locator('#AdvancedFormatting .editor_maximize[data-for=context_story_string]').click();await page.locator('dialog[open] textarea.maximized_textarea').waitFor();await page.locator('dialog[open] .popup-button-ok').last().click();checks.push('native-expanded-template-editor');}
 for(const mode of ['writing','agent']){
  await page.locator('#dw-modebar [data-mode='+mode+']').click();await page.waitForTimeout(450);assert.equal(await page.locator('#dw-rp-rail').isVisible(),false);assert.equal(await page.locator('.dw-rp-docked').count(),0);
  await page.locator('#dw-modebar [data-mode=rp]').click();await page.locator('#AdvancedFormatting.dw-rp-docked').waitFor({state:'visible'});await page.waitForTimeout(420);
 }checks.push('real-novel-and-agent-mode-switches');
 await page.locator('#dw-rp-rail [data-rp-action=legacy]').click();await page.waitForTimeout(420);assert.equal(await page.locator('.dw-rp-docked').count(),0);await page.locator('#dw-rp-legacy-return').click();await page.locator('#AdvancedFormatting.dw-rp-docked').waitFor({state:'visible'});await page.waitForTimeout(420);checks.push('native-fallback-and-return');
 // Rapid requests while a native opener is pending, then close/switch modes.
 await page.evaluate(()=>{for(const key of ['background','world','extensions','format'])document.querySelector('#dw-rp-rail [data-rp-action='+key+']').click();});await page.waitForTimeout(1000);await page.locator('#AdvancedFormatting.dw-rp-docked').waitFor({state:'visible'});checks.push('rapid-consecutive-switches');
 for(const viewport of [{width:1024,height:850},{width:800,height:850},{width:390,height:850}]){await page.setViewportSize(viewport);for(const name of ['format','appearance','persona','background']){await tab(name);await snapshot(name+'-viewport-'+viewport.width);}if(viewport.width<=800){await page.locator('#dw-rp-header [data-rp-action=sidebar]').click();assert.equal(await page.locator('#dw-rp-library').isVisible(),false);await page.locator('#dw-rp-header [data-rp-action=sidebar]').click();assert.equal(await page.locator('#dw-rp-library').isVisible(),true);}assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}checks.push('viewport-1024-800-390-and-sidebar-toggle');
 await page.setViewportSize({width:1400,height:900});
 const integrity=await page.evaluate(drawers=>({parents:Object.keys(rpParents).every(id=>document.querySelector('#'+id+' > .drawer-content').parentElement===rpParents[id]),chat:rpChat===document.querySelector('#chat')&&rpChat.parentElement.id==='sheld',composer:rpForm===document.querySelector('#form_sheld')&&rpForm.parentElement.id==='sheld',text:rpText===document.querySelector('#context_story_string')&&rpText.value==='SYNTHETIC_UNSAVED_LAYOUT_TEXT'}),drawers);
 assert.ok(Object.values(integrity).every(Boolean),JSON.stringify(integrity));checks.push('native-parents-chat-composer-and-unsaved-text-preserved');
 const animation=await page.evaluate(()=>{cancelAnimationFrame(rpFrame);return {frames:rpFrames,leaks:rpLeaks};});
 const validation={panelsStayInColumn:animation.leaks.length===0,noHorizontalOverflow:samples.every(x=>x.scrollWidth<=x.clientWidth+1),noNestedSettingsScrollers:samples.every(x=>x.nestedSettingScrollers.length===0),generationPanelOwnsScroll:samples.filter(x=>/^preset-/.test(x.label)).every(x=>x.outerOverflow==='auto'&&x.scrollHeight>x.clientHeight),readableHeadings:samples.filter(x=>/^(format|appearance|persona)-(250|320|480)$/.test(x.label)).every(x=>x.heading.width>=80&&x.heading.height<65),singleColumns:samples.filter(x=>/^(format|appearance)-(250|320|480)$/.test(x.label)).every(x=>x.columns.every(c=>c.width>x.clientWidth*.8)),noPageErrors:errors.length===0};
 if(!probe)for(const [name,passed]of Object.entries(validation))if(passed)checks.push(name);
 const report={date:new Date().toISOString(),passed:!probe&&Object.values(validation).every(Boolean),probe,headless:true,engine:'Edge; no Electron',scope:'Fresh isolated full native frontend and real local backend; normal animations; no model API or formal data',home,nativeTransition,checks,integrity,animation,samples,errors,blocked,validation};
 await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({probe,checks:checks.length,frames:animation.frames,leaks:animation.leaks.slice(0,3),overflow:samples.filter(x=>x.scrollWidth>x.clientWidth+1).map(x=>({label:x.label,width:x.clientWidth,scroll:x.scrollWidth,overflow:x.overflow.slice(0,5)})),errors},null,2));
 if(!probe)for(const [name,passed]of Object.entries(validation))assert.ok(passed,name);
}
main().catch(async e=>{console.error(e.stack);if(page)await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();if(lifecycle)await lifecycle.stop();});

