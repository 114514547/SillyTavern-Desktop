'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const modulePromise=import('../desktop/extensions/desktop-writing/roleplay-ui.mjs');
test('three-pane preferences upgrade old sidebar-only data and clamp invalid widths and tabs',async()=>{
 const {roleplayLayout}=await modulePromise;
 assert.deepEqual(roleplayLayout({sidebar:false}),{sidebar:false,rightOpen:true,rightTab:'preset',rightWidth:250});
 assert.deepEqual(roleplayLayout({rightOpen:false,rightTab:'extensions',rightWidth:900},false),{sidebar:false,rightOpen:false,rightTab:'extensions',rightWidth:640});
 assert.deepEqual(roleplayLayout({rightTab:'__proto__',rightWidth:NaN}),{sidebar:true,rightOpen:true,rightTab:'preset',rightWidth:250});
 assert.equal(roleplayLayout({rightWidth:-2}).rightWidth,250);assert.equal(roleplayLayout(null,false).sidebar,false);
});
test('native chat metadata is normalized without previews, duplicate sessions or unsafe paths',async()=>{
 const {roleplayChats}=await modulePromise;
 assert.deepEqual(roleplayChats({a:{file_name:'故事一.jsonl',last_mes:2,chat_items:4,preview_message:'PRIVATE'},b:{file_name:'故事二.jsonl',last_mes:3},c:{file_name:'../other'},d:{file_name:'故事一.jsonl'},e:{file_name:''}}),[{file:'故事二',items:0,updated:3},{file:'故事一',items:4,updated:2}]);
 assert.deepEqual(roleplayChats({error:true}),[]);assert.deepEqual(roleplayChats(null),[]);
});
test('world book count deduplicates configured scopes and does not claim activation',async()=>{
 const {roleplayBooks}=await modulePromise,c={characterId:0,characters:[{avatar:'林雾.png',data:{extensions:{world:'人物'}}},{avatar:'沈舟.png',data:{extensions:{world:'港口'}}}],chatMetadata:{world_info:'聊天'},powerUserSettings:{persona_description_lorebook:'身份'}};
 const world={selected_world_info:['城门','人物'],world_info:{charLore:[{name:'林雾',extraBooks:['补充','城门']}]}};
 assert.deepEqual(roleplayBooks(c,world),['城门','人物','聊天','身份','补充']);
 c.groupId='g';c.groups=[{id:'g',members:['沈舟.png']}];assert.deepEqual(roleplayBooks(c,world),['城门','人物','聊天','身份','港口']);
});
test('all nine adapters and statically imported APIs exist in the pinned native frontend',async()=>{
 const {ROLEPLAY_DRAWERS}=await modulePromise,root=path.join(__dirname,'../build/backend/public');
 const html=await fs.readFile(path.join(root,'index.html'),'utf8');assert.equal(Object.keys(ROLEPLAY_DRAWERS).length,9);
 for(const id of Object.values(ROLEPLAY_DRAWERS))assert.ok(html.includes('id="'+id+'"'),'Native drawer '+id);
 for(const id of ['option_select_chat','option_start_new_chat','settings_preset_openai'])assert.ok(html.includes('id="'+id+'"'),id);
 for(const [file,name]of [['script.js','doNavbarIconClick'],['scripts/openai.js','getPresetApplicationPromise'],['scripts/group-chats.js','openGroupById']])assert.match(await fs.readFile(path.join(root,file),'utf8'),new RegExp('export (?:async )?function '+name+'\\('));
});
