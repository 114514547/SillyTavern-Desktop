'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const path=require('node:path');const fs=require('node:fs/promises');const http=require('node:http');const {once}=require('node:events');
const {Managed}=require('../../desktop/services/managed.cjs');const {Lifecycle}=require('../../desktop/services/lifecycle.cjs');const {inspect}=require('../../desktop/services/installation.cjs');
const manifest=require('../../vendor/manifest.json');
const {snapshot,plan}=require('../../desktop/services/backup.cjs');
test('bundled upstream: CSRF, card/world import, presets, mock API, chat and restart persistence',{timeout:360000},async()=>{
  const home=path.resolve(__dirname,'../../test-results/真实后端 中文 '+Date.now());
  const logs=[];const managed=new Managed({home,resources:path.resolve(__dirname,'../../build'),manifest,onStatus:s=>logs.push(s)});
  await managed.initialize();const profile=await managed.create();
  const runtime=await managed.node();const lifecycle=new Lifecycle({node:runtime,services:path.resolve(__dirname,'../../desktop/services'),onStatus:s=>logs.push(s)});
  const mock=http.createServer(async(req,res)=>{for await(const _ of req){}res.setHeader('Content-Type','application/json');res.end(JSON.stringify({id:'desktop-test',choices:[{message:{role:'assistant',content:'模拟回复成功'},finish_reason:'stop'}]}));});
  mock.listen(0,'127.0.0.1');await once(mock,'listening');
  let active=await lifecycle.start(await inspect(profile.root,profile),{skipExternalCheck:true});
  let jar=new Map(),token;
  async function request(endpoint,body,csrf=true){
    const headers={};if(jar.size)headers.Cookie=[...jar].map(([k,v])=>k+'='+v).join('; ');if(token&&csrf)headers['x-csrf-token']=token;
    const options={headers,signal:AbortSignal.timeout(30000)};
    if(body!==undefined){options.method='POST';if(body instanceof FormData)options.body=body;else{headers['content-type']='application/json';options.body=JSON.stringify(body);}}
    const r=await fetch(active.url+endpoint,options);
    for(const cookie of r.headers.getSetCookie()){const pair=cookie.split(';')[0];const n=pair.indexOf('=');jar.set(pair.slice(0,n),pair.slice(n+1));}
    return r;
  }
  async function json(endpoint,body){const r=await request(endpoint,body);assert.equal(r.status,200,endpoint+' status');return r.json();}
  try{
    token=(await json('/csrf-token')).token;assert.notEqual(token,'disabled');assert.equal((await request('/api/settings/get',{},false)).status,403);
    assert.ok((await (await request('/')).text()).includes('send_textarea'));
    const original=await json('/api/settings/get',{});const settings=JSON.parse(original.settings);settings.desktop_test_marker='persisted';
    await json('/api/settings/save',settings);
    const card=new FormData();card.set('file_type','json');card.set('avatar',new Blob([JSON.stringify({name:'桌面测试角色',description:'synthetic fixture',personality:'',scenario:'',first_mes:'你好',mes_example:''})],{type:'application/json'}),'card.json');
    const imported=await json('/api/characters/import',card);assert.ok(imported.file_name && !imported.error,'character import');
    const avatar=imported.file_name.endsWith('.png')?imported.file_name:imported.file_name+'.png';
    const world=new FormData();world.set('avatar',new Blob([JSON.stringify({entries:{0:{uid:0,key:['test'],content:'synthetic world',comment:'test',constant:false}}})],{type:'application/json'}),'desktop-world.json');
    const importedWorld=await json('/api/worldinfo/import',world);assert.equal(importedWorld.name,'desktop-world');
    await json('/api/presets/save',{apiId:'openai',name:'Desktop Test',preset:{temperature:0.25}});
    const answer=await json('/api/backends/chat-completions/generate',{chat_completion_source:'custom',custom_url:`http://127.0.0.1:${mock.address().port}/v1`,model:'fixture',messages:[{role:'user',content:'synthetic prompt'}],stream:false,max_tokens:16,temperature:0.25});
    assert.equal(answer.choices?.[0]?.message?.content,'模拟回复成功','mock API round trip');
    await json('/api/chats/save',{avatar_url:avatar,file_name:'desktop-test',force:true,chat:[{user_name:'User',character_name:'桌面测试角色',chat_metadata:{}},{name:'桌面测试角色',is_user:false,mes:answer.choices[0].message.content}]});
    await lifecycle.stop();
    active=await lifecycle.start(await inspect(profile.root,profile),{skipExternalCheck:true});jar=new Map();token=(await json('/csrf-token')).token;
    const persisted=await json('/api/settings/get',{});assert.equal(JSON.parse(persisted.settings).desktop_test_marker,'persisted');assert.ok(persisted.world_names.includes('desktop-world'));assert.ok(persisted.openai_setting_names.includes('Desktop Test'));
    const chat=await json('/api/chats/get',{avatar_url:avatar,file_name:'desktop-test'});assert.equal(chat[1].mes,'模拟回复成功');
    await lifecycle.stop();
    const source=await inspect(profile.root,profile);const before=await plan(source);
    const backup=await snapshot(source,path.join(home,'backups'),s=>logs.push(s),{skipExternalCheck:true});
    const copied=await managed.create(backup.root);
    assert.deepEqual((await plan(source)).files,before.files,'Backup and managed copy leave synthetic source unchanged');
    active=await lifecycle.start(await inspect(copied.root,copied),{skipExternalCheck:true});jar=new Map();token=(await json('/csrf-token')).token;
    assert.equal(JSON.parse((await json('/api/settings/get',{})).settings).desktop_test_marker,'persisted');
    assert.equal((await json('/api/chats/get',{avatar_url:avatar,file_name:'desktop-test'}))[1].mes,'模拟回复成功');
    assert.notEqual(copied.dataRoot,source.dataRoot);assert.equal(copied.migration.verified,true);
    assert.ok(!logs.join().includes('synthetic prompt'));assert.ok(!logs.join().includes('模拟回复成功'));
    await fs.writeFile(path.resolve(__dirname,'../../test-results/real-backend.json'),JSON.stringify({date:new Date().toISOString(),home,profile,copied,passed:true,checks:['CSRF-403','original-UI','JSON-card-import','world-import','preset-save','mock-API-reply','chat-save','restart-persistence','verified-migration-to-new-profile','source-unchanged-after-migration','copied-chat-and-settings-readable','private-status-logs']},null,2));
  }finally{await lifecycle.stop();await new Promise(r=>mock.close(r));}
});
