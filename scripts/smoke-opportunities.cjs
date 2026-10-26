'use strict';
// Full native frontend, headless Edge, isolated data and a local mock model.
// The preload IPC is represented by the same tested main-process handler.
const fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),{once}=require('node:events');
const {chromium}=require('playwright-core');
const root=path.resolve(__dirname,'..'),home=process.env.ST_OPPORTUNITY_TEST_HOME?path.resolve(process.env.ST_OPPORTUNITY_TEST_HOME):path.join(root,'test-results','opportunities-'+Date.now());
if(!home.startsWith(path.join(root,'test-results')+path.sep)||!path.basename(home).startsWith('opportunities-'))throw new Error('Isolated opportunity test home required.');
const {Managed}=require('../desktop/services/managed.cjs'),{Lifecycle}=require('../desktop/services/lifecycle.cjs'),{inspect}=require('../desktop/services/installation.cjs');
const {installWritingExtension}=require('../desktop/services/writing-extension.cjs'),{LocalWorkspace}=require('../desktop/services/local-workspace.cjs'),{createProtectionHandler}=require('../desktop/services/writing-protection.cjs');
const manifest=require('../vendor/manifest.json'),checks=[],errors=[];let browser,lifecycle,page,release,mode='draft';
const opening='合成候选开头。<img src=x onerror=alert(1)>',ending='\n合成候选结尾。';
const event=value=>'data: '+JSON.stringify(value)+'\n\n';
const mock=http.createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;
  if(req.url.endsWith('/models')){res.setHeader('content-type','application/json');res.end(JSON.stringify({data:[{id:'opportunity-fixture'}]}));return;}
  const request=JSON.parse(body);res.setHeader('content-type','text/event-stream');res.setHeader('cache-control','no-cache');res.flushHeaders();
  const usage=(input,output)=>({prompt_tokens:input,completion_tokens:output,prompt_tokens_details:{cached_tokens:input*.8}});
  if(mode==='agent'){
    const tool=request.messages.some(message=>message.role==='tool');
    if(!tool)res.write(event({choices:[{delta:{tool_calls:[{index:0,id:'list-1',type:'function',function:{name:'list_files',arguments:'{"path":""}'}}]},finish_reason:'tool_calls'}]}));
    else res.write(event({choices:[{delta:{content:'已查看合成目录，整轮统计包含两次模型请求。'},finish_reason:'stop'}]}));
    await new Promise(resolve=>setTimeout(resolve,40));
    res.write(event({choices:[],usage:usage(tool?2000:1000,tool?30:20)}));res.end('data: [DONE]\n\n');return;
  }
  res.write(event({choices:[{delta:{content:opening}}]}));
  await new Promise(resolve=>{release=resolve;res.once('close',resolve);});release=null;
  if(res.destroyed)return;
  res.write(event({choices:[{delta:{content:ending},finish_reason:'stop'}]}));
  await new Promise(resolve=>setTimeout(resolve,40));
  if(res.destroyed)return;
  res.write(event({choices:[],usage:usage(1000,20)}));res.end('data: [DONE]\n\n');
});
async function configure(){await page.evaluate(url=>{const c=window.SillyTavern.getContext();window.jQuery('#main_api').val('openai').trigger('change');return import('/scripts/openai.js').then(async module=>{Object.assign(module.oai_settings,{chat_completion_source:'custom',custom_url:url,custom_model:'opportunity-fixture',stream_openai:true});(await import('/script.js')).setOnlineStatus('valid');});},'http://127.0.0.1:'+mock.address().port+'/v1');}
async function main(){
  await fs.mkdir(home,{recursive:true});mock.listen(0,'127.0.0.1');await once(mock,'listening');
  const managed=new Managed({home,resources:path.join(root,'build'),manifest});await managed.initialize();const profile=(await managed.list())[0]||await managed.create();
  lifecycle=new Lifecycle({node:await managed.node(),services:path.join(root,'desktop/services'),preferredPort:0,onPhase:phase=>console.log('phase: '+phase),prepare:i=>installWritingExtension({root:i.root,source:path.join(root,'desktop/extensions/desktop-writing'),backupRoot:path.join(home,'extension-backups')})});
  const active=await lifecycle.start(await inspect(profile.root,profile),{skipExternalCheck:true});
  browser=await chromium.launch({channel:'msedge',headless:true,args:['--noerrdialogs','--disable-breakpad','--disable-gpu']});
  const context=await browser.newContext({viewport:{width:1400,height:900},locale:'zh-CN'});
  await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin!==active.url)return route.abort();if(['/api/horde/status','/api/horde/text-models'].includes(url.pathname))return route.fulfill({json:[]});return route.continue();});
  const local=new LocalWorkspace({home:path.join(home,'agent'),protectedRoots:[home,path.join(root,'build')]});await local.load();
  const documents=path.join(root,'test-results','opportunity-documents-'+Date.now());await fs.mkdir(documents);await fs.writeFile(path.join(documents,'合成设定.md'),'这里是用于测试的合成资料。');await local.connect(documents);
  const frame={url:active.url+'/'},contents={mainFrame:frame,session:{fetch:async url=>{const response=await context.request.get(url);return Response.json(await response.json(),{status:response.status()});}}};
  const handle=createProtectionHandler(()=>({active,selected:active.i,window:{webContents:contents}}));
  await context.exposeBinding('__localWorkspace',async(source,{action,arg})=>{
    if(action==='writingProtection'){frame.url=source.frame.url();return handle({sender:contents,senderFrame:source.frame===source.page.mainFrame()?frame:{url:source.frame.url()}},arg);}
    try { return {ok:true,value:action==='appMenu'?null:await local[action](arg||{})}; }catch(error){return {ok:false,error:error.safe?error.message:'合成工作区操作失败'};}
  });
  await context.addInitScript(()=>{window.localWorkspace=Object.fromEntries(['state','select','list','read','search','pending','saveThread','notesStatus','saveNotes','saveProject','appMenu','writingProtection'].map(action=>[action,arg=>window.__localWorkspace({action,arg})]));});
  page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));await page.goto(active.url);
  const onboarding=page.locator('dialog[open]').filter({has:page.locator('.onboarding')});
  await Promise.race([onboarding.waitFor({timeout:90000}),page.locator('#dw-modebar').waitFor({timeout:90000})]);
  if(await onboarding.isVisible()){await onboarding.locator('.popup-input').fill('合成验证');await onboarding.locator('.popup-button-ok').click();}
  await page.waitForSelector('#dw-modebar',{timeout:90000});await page.waitForFunction(()=>document.getElementById('dw-save').textContent==='已保存');await configure();
  await page.locator('#dw-modebar [data-mode=writing]').click();await page.locator('[data-dw-action=new-project]').click();await page.locator('dialog[open] .popup-input').fill('技术机会合成验收');await page.locator('dialog[open] .popup-button-ok').click();
  await page.locator('#dw-viewbar [data-view=body]').click();await page.locator('#dw-body').fill('合成原正文，采用前不能改变。');await page.locator('[data-dw-action=save]').click();
  await page.waitForFunction(()=>document.getElementById('dw-save').textContent==='已保存');
  await page.evaluate(()=>{for(const id of ['dw-use-character','dw-use-world']){const box=document.getElementById(id);if(box.checked){box.checked=false;box.dispatchEvent(new Event('change',{bubbles:true}));}}});
  await page.locator('[data-dw-action=continue]').click();await page.waitForFunction(opening=>document.getElementById('dw-draft-preview-text').value===opening,opening,{timeout:45000});
  assert.equal(await page.locator('#dw-draft-preview-text').getAttribute('readonly'),'');assert.equal(await page.locator('#dw-body').inputValue(),'合成原正文，采用前不能改变。');assert.equal(await page.locator('#dw-draft-preview img').count(),0);
  await page.screenshot({path:path.join(home,'draft-streaming.png')});checks.push('read-only-live-preview-before-completion-with-escaped-markup');
  await page.setViewportSize({width:600,height:800});const narrow=await page.locator('#dw-draft-preview-text').boundingBox();assert.ok(narrow&&narrow.x>=0&&narrow.x+narrow.width<=601);await page.screenshot({path:path.join(home,'draft-streaming-narrow.png')});await page.setViewportSize({width:1400,height:900});checks.push('live-preview-fits-narrow-window');
  release();await page.locator('dialog[open] .dw-candidate').waitFor({timeout:45000});assert.equal(await page.locator('.dw-candidate').inputValue(),opening+ending);
  assert.match(await page.locator('dialog[open] .dw-generation-info').textContent(),/输入 1000/);assert.equal(await page.locator('#dw-draft-preview').isVisible(),false);
  await page.locator('dialog[open] .popup-button-cancel').click();assert.equal(await page.locator('#dw-body').inputValue(),'合成原正文，采用前不能改变。');checks.push('separate-usage-trailer-visible-and-cancel-never-adopts');
  await page.locator('[data-dw-action=continue]').click();await page.waitForFunction(opening=>document.getElementById('dw-draft-preview-text').value===opening,opening);await page.locator('[data-dw-action=stop]').click();
  await page.waitForFunction(()=>document.getElementById('dw-draft-preview').hidden);assert.equal(await page.locator('#dw-body').inputValue(),'合成原正文，采用前不能改变。');await page.waitForFunction(()=>document.getElementById('dw-save').textContent==='已保存');checks.push('stop-hides-preview-and-preserves-unfinished-candidate');
  await page.locator('[data-dw-action=continue]').click();await page.waitForFunction(opening=>document.getElementById('dw-draft-preview-text').value===opening,opening);release();await page.locator('dialog[open] .dw-candidate').waitFor({timeout:45000});await page.locator('dialog[open] .popup-button-ok').click();
  const adopted='合成原正文，采用前不能改变。\n\n'+opening+ending;await page.waitForFunction(expected=>document.getElementById('dw-body').value===expected,adopted);await page.waitForFunction(()=>document.getElementById('dw-save').textContent==='已保存');checks.push('explicit-adoption-appends-only-after-confirmation');
  mode='agent';await page.locator('#dw-modebar [data-mode=agent]').click();await page.locator('#agent-input').fill('查看当前目录并回答');await page.locator('#agent-form').evaluate(form=>form.requestSubmit());
  await page.waitForFunction(()=>document.querySelector('#dw-agent')?.shadowRoot?.querySelector('#agent-log')?.textContent.includes('整轮统计包含两次'));
  await page.waitForFunction(()=>document.querySelector('#dw-agent')?.shadowRoot?.querySelector('#agent-log')?.textContent.includes('本轮模型请求 2 次'));
  assert.match(await page.locator('#agent-log .dw-generation-info').textContent(),/输入 3000/);checks.push('agent-two-model-calls-show-aggregate-usage-in-ui');
  await page.locator('#dw-modebar [data-mode=writing]').click();await page.waitForFunction(()=>document.getElementById('dw-save').textContent==='已保存');
  const report=await page.evaluate(async()=>{const headers=window.SillyTavern.getContext().getRequestHeaders(),response=await fetch('/api/data-maid/report',{method:'POST',headers});if(!response.ok)throw new Error('report failed');const report=await response.json();const files=report.report.files.filter(file=>['desktop-writing-workspace-v1.json','desktop-writing-recovery-v1.json'].includes(file.name));if(files.length!==2)throw new Error('expected only two synthetic manuscripts');const removed=await fetch('/api/data-maid/delete',{method:'POST',headers,body:JSON.stringify({token:report.token,hashes:files.map(file=>file.hash)})});return {status:removed.status,names:files.map(file=>file.name)};});assert.equal(report.status,204);
  await page.reload();await page.waitForSelector('#dw-modebar',{timeout:60000});await page.waitForFunction(()=>document.getElementById('dw-save').textContent==='已保存');await page.locator('#dw-modebar [data-mode=writing]').click();await page.locator('#dw-viewbar [data-view=body]').click();assert.equal(await page.locator('#dw-body').inputValue(),adopted);checks.push('actual-data-maid-delete-of-two-fixture-files-recovers-from-verified-checkpoint');
  await page.locator('[data-dw-action=save]').click();await page.waitForFunction(()=>document.getElementById('dw-save').textContent==='已保存');
  const saved=JSON.parse(await fs.readFile(path.join(active.i.dataRoot,'default-user/user/files/desktop-writing-workspace-v1.json'),'utf8'));
  assert.equal(saved.projects.find(project=>project.id===saved.currentProjectId).chapters[0].text,adopted);checks.push('explicit-save-recreates-missing-primary-after-recovery');
  assert.deepEqual(errors,[]);await fs.writeFile(path.join(home,'result.json'),JSON.stringify({passed:true,headless:true,electron:false,checks,errors},null,2));console.log(JSON.stringify({passed:true,checks,output:home}));
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;}).finally(async()=>{release?.();await browser?.close().catch(()=>{});await lifecycle?.stop().catch(()=>{});mock.closeAllConnections();mock.close();});
