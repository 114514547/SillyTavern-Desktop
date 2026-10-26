const test=require('node:test');
const assert=require('node:assert/strict');
const modulePromise=import('../desktop/extensions/desktop-writing/character-manager-data.mjs');
const card=()=>({name:'Role',avatar:'role.png',chat:'keep-chat',description:'Original',personality:'Quiet',scenario:'Port',first_mes:'Hello',mes_example:'Example',fav:false,talkativeness:.5,
    data:{name:'Role',description:'Original',personality:'Quiet',scenario:'Port',first_mes:'Hello',mes_example:'Example',creator:'Author',character_version:'1',creator_notes:'Notes',tags:['old'],alternate_greetings:['Second'],system_prompt:'',post_history_instructions:'',character_book:{entries:[{content:'keep book'}]},extensions:{fav:false,talkativeness:.5,world:'World',depth_prompt:{prompt:'Depth',depth:4,role:'system',plugin_key:'keep'},plugin:{secret:'keep plugin'}}}});
const merge=(a,b)=>{const result=structuredClone(a);for(const [key,value]of Object.entries(b)){result[key]=value&&typeof value==='object'&&!Array.isArray(value)?merge(result[key]||{},value):structuredClone(value);}return result;};

test('draft reads real V2 fields and extension settings',async()=>{
    const {characterDraft}=await modulePromise,draft=characterDraft(card());assert.equal(draft.name,'Role');assert.equal(draft.creator,'Author');assert.equal(draft.depth_prompt,'Depth');assert.deepEqual(draft.alternate_greetings,['Second']);
});
test('partial edits preserve all unedited character, worldbook, and extension data',async()=>{
    const {characterDraft,characterPatch}=await modulePromise,original=card(),base=characterDraft(original),draft=structuredClone(base);draft.description='Revised';draft.creator_notes='New notes';
    const {patch,changed}=characterPatch(base,draft,base),stored=merge(original,patch);
    assert.deepEqual(new Set(changed),new Set(['description','creator_notes']));assert.equal(stored.description,'Revised');assert.equal(stored.data.description,'Revised');assert.equal(stored.creatorcomment,'New notes');
    assert.equal(stored.chat,'keep-chat');assert.deepEqual(stored.data.character_book,original.data.character_book);assert.deepEqual(stored.data.extensions,original.data.extensions);assert.deepEqual(stored.data.alternate_greetings,['Second']);assert.equal('name' in patch,false);
});
test('removing tags and alternate greetings replaces arrays without losing unrelated fields',async()=>{
    const {characterDraft,characterPatch}=await modulePromise,c=card(),base=characterDraft(c),draft={...base,tags:[],alternate_greetings:[]};const {patch}=characterPatch(base,draft,base),stored=merge(c,patch);
    assert.deepEqual(stored.data.tags,[]);assert.deepEqual(stored.data.alternate_greetings,[]);assert.equal(stored.data.creator,'Author');
});
test('conflicting edits are rejected while unrelated remote updates are preserved',async()=>{
    const {characterDraft,characterPatch}=await modulePromise,base=characterDraft(card()),draft={...base,description:'Mine'},current={...base,description:'Someone else'};
    assert.throws(()=>characterPatch(base,draft,current),/其他位置修改/);current.description=base.description;current.creator='Remote author';const {patch}=characterPatch(base,draft,current);assert.equal('creator' in patch.data,false);
});
test('depth prompt edits merge at the changed key and keep plugin extensions',async()=>{
    const {characterDraft,characterPatch}=await modulePromise,c=card(),base=characterDraft(c),draft={...base,depth:8};const stored=merge(c,characterPatch(base,draft,base).patch);
    assert.deepEqual(stored.data.extensions.depth_prompt,{prompt:'Depth',depth:8,role:'system',plugin_key:'keep'});assert.equal(stored.data.extensions.world,'World');
});
test('name changes, invalid ranges, and native deletion sentinels cannot enter a normal save',async()=>{
    const {characterDraft,characterPatch}=await modulePromise,base=characterDraft(card());
    for(const value of [{name:'New name'},{talkativeness:2},{depth:-1},{depth_role:'invalid'},{creator_notes:'__@@UNSET@@__'},{tags:['__@@UNSET@@__']}])assert.throws(()=>characterPatch(base,{...base,...value},base));
});
test('saving reads back before reporting success and never posts on a conflict',async()=>{
    const {CharacterCards,characterDraft}=await modulePromise;let stored=card(),writes=0;
    const service=new CharacterCards({ctx:()=>({getRequestHeaders:()=>({})}),request:async(url,options)=>{if(url.endsWith('/get'))return{ok:true,json:async()=>structuredClone(stored)};assert.ok(url.endsWith('/merge-attributes'));writes++;stored=merge(stored,JSON.parse(options.body));return{ok:true,text:async()=>'OK'};}});
    const base=characterDraft(stored),draft={...base,description:'Saved'};const result=await service.save('role.png',base,draft);assert.equal(result.data.description,'Saved');assert.equal(writes,1);
    await assert.rejects(service.save('role.png',base,{...base,description:'Other'}),/其他位置修改/);assert.equal(writes,1);
});
test('HTTP failures and ignored saves retain the caller draft and fail explicitly',async()=>{
    const {CharacterCards,characterDraft}=await modulePromise,base=characterDraft(card()),draft={...base,first_mes:'New greeting'};
    const bad=new CharacterCards({ctx:()=>({getRequestHeaders:()=>({})}),request:async()=>({ok:false,status:500})});await assert.rejects(bad.save('role.png',base,draft),/HTTP 500/);
    const ignored=new CharacterCards({ctx:()=>({getRequestHeaders:()=>({})}),request:async url=>url.endsWith('/get')?{ok:true,json:async()=>card()}:{ok:true,text:async()=>'OK'}});
    await assert.rejects(ignored.save('role.png',base,draft),/尚未确认保存/);assert.equal(draft.first_mes,'New greeting');assert.equal(base.first_mes,'Hello');
});
