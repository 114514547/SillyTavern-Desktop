const test=require('node:test');
const assert=require('node:assert/strict');
const modulePromise=import('../desktop/extensions/desktop-writing/roleplay-projects.mjs');

async function fixture(){
    const {RoleplayProjects,projectKey}=await modulePromise;
    const c={characters:[{avatar:'role.png',name:'Original',chat:'old'}],groups:[],characterId:undefined,groupId:null,
        getRequestHeaders:()=>({}),getCurrentChatId:()=>c.chatId,extensionSettings:{},saveSettingsDebounced:()=>{}};
    globalThis.SillyTavern={getContext:()=>c};
    const files=new Map([['old',[{chat_metadata:{integrity:'original'}},{mes:'old message'}]],['live',[{chat_metadata:{}},{mes:'live message'}]]]);
    let remote,failSave=false,failDelete=false,busy=false;const deleted=[];
    const request=async(url,options)=>{
        const body=JSON.parse(options.body);let data;
        if(url==='/api/settings/get')data={settings:{extension_settings:{desktop_ui_v1:{roleplayProjects:structuredClone(remote)}}}};
        else if(url==='/api/characters/chats')data=Object.fromEntries([...files].map(([name])=>[name,{file_name:name+'.jsonl',chat_items:1}]));
        else if(url==='/api/chats/get'||url==='/api/chats/group/get')data=structuredClone(files.get(body.file_name||body.id)||[]);
        else if(url==='/api/chats/save'||url==='/api/chats/group/save'){files.set(body.file_name||body.id,structuredClone(body.chat));data={ok:true};}
        else if(url==='/api/characters/merge-attributes')data={ok:true};
        else if(url==='/api/groups/edit')data={ok:true};
        else if(url==='/api/chats/delete'||url==='/api/chats/group/delete'){
            if(failDelete)return {ok:false,status:500,json:async()=>({})};
            const name=body.chatfile?.replace(/\.jsonl$/,'')||body.id;files.delete(name);deleted.push(name);data={ok:true};
        }else throw Error('Unexpected request: '+url);
        return {ok:true,status:200,json:async()=>data};
    };
    const service=new RoleplayProjects({ctx:()=>c,request,busy:()=>busy,native:async()=>({saveSettings:async()=>{if(!failSave)remote=structuredClone(service.state);}})});
    return {service,c,files,deleted,entity:service.entity(projectKey('role.png')),failSave:value=>failSave=value,failDelete:value=>failDelete=value,setBusy:value=>busy=value,stale:()=>remote.archive=[]};
}

test('archive and restore preserve chat files and the real character name',async()=>{
    const f=await fixture(),{service:s,entity:e}=f;
    await s.commit(()=>s.update(e.key,{name:'Project alias'}));
    await s.archive(e,[{file:'old'}],'project');
    assert.equal(s.project(e.key).hiddenArchive,s.state.archive[0].id);
    assert.equal(s.state.archive[0].name,'Project alias');assert.equal(f.files.size,2);assert.equal(f.c.characters[0].name,'Original');assert.deepEqual(f.deleted,[]);
    await s.restore(s.state.archive[0].id);assert.equal(s.project(e.key).hiddenArchive,null);assert.equal(s.archived(e.key,'old'),false);assert.equal(f.files.size,2);
});

test('native character rename migrates project aliases and archive owners without touching chat data',async()=>{
    const f=await fixture(),s=f.service;
    await s.commit(()=>s.update(f.entity.key,{name:'Project alias',titles:{old:'Conversation alias'}}));
    await s.archive(f.entity,[{file:'old'}],'project');const at=s.state.archive[0].at;
    f.c.characters[0].avatar='renamed.png';await s.renameOwner('role.png','renamed.png');
    assert.equal(s.state.projects['c:role.png'],undefined);assert.equal(s.project('c:renamed.png').name,'Project alias');
    assert.equal(s.project('c:renamed.png').titles.old,'Conversation alias');assert.equal(s.state.archive[0].key,'c:renamed.png');assert.equal(s.state.archive[0].owner,'renamed.png');assert.equal(s.state.archive[0].at,at);assert.equal(f.files.size,2);assert.deepEqual(f.deleted,[]);
});

test('expiry uses archive time and rejects invalid identifiers',async()=>{
    const {archiveDue,ARCHIVE_RETENTION}=await modulePromise,f=await fixture();
    await f.service.archive(f.entity,[{file:'old'}]);const record=f.service.state.archive[0];
    assert.equal(archiveDue(record,record.at+ARCHIVE_RETENTION-1),false);assert.equal(archiveDue(record,record.at+ARCHIVE_RETENTION),true);
    assert.equal(archiveDue({...record,chats:[{file:'../live'}]},record.at+ARCHIVE_RETENTION),false);
    await assert.rejects(f.service.removeArchive(record.id,{expiredOnly:true}),/尚未到期/);assert.deepEqual(f.deleted,[]);
});

test('failed archive persistence rolls back and cannot delete any chat',async()=>{
    const f=await fixture();f.failSave(true);await assert.rejects(f.service.archive(f.entity,[{file:'old'}]),/未保存/);
    assert.equal(f.service.state.archive.length,0);assert.equal(f.files.size,2);assert.deepEqual(f.deleted,[]);
});

test('automatic expiry removes an overdue archive while preserving a newer one',async()=>{
    const f=await fixture(),{ARCHIVE_RETENTION}=await modulePromise,s=f.service;
    await s.archive(f.entity,[{file:'old'}]);const oldId=s.state.archive[0].id;
    await s.commit(()=>s.state.archive[0].at-=ARCHIVE_RETENTION+1000);
    await s.archive(f.entity,[{file:'live'}]);const newId=s.state.archive[1].id;
    await s.removeArchive(oldId,{expiredOnly:true});
    assert.deepEqual(f.deleted,['old']);assert.equal(s.state.archive[0].id,newId);assert.equal(f.files.has('live'),true);
});

test('permanent removal deletes only the explicitly archived file',async()=>{
    const f=await fixture();await f.service.archive(f.entity,[{file:'old'}]);await f.service.removeArchive(f.service.state.archive[0].id);
    assert.deepEqual(f.deleted,['old']);assert.equal(f.files.has('live'),true);assert.equal(f.c.characters[0].name,'Original');assert.equal(f.c.characters[0].chat,'live');assert.equal(f.service.state.archive.length,0);
});

test('active conversations, generation, and remotely restored archives block deletion',async()=>{
    const f=await fixture();await f.service.archive(f.entity,[{file:'old'}]);const id=f.service.state.archive[0].id;
    f.c.characterId=0;f.c.chatId='old';await assert.rejects(f.service.removeArchive(id),/正在打开/);
    f.c.characterId=undefined;f.setBusy(true);await assert.rejects(f.service.removeArchive(id),/结束当前生成/);
    f.setBusy(false);f.stale();await assert.rejects(f.service.removeArchive(id),/状态已变化/);assert.deepEqual(f.deleted,[]);
});

test('failed deletion retains archive and files so it can be retried',async()=>{
    const f=await fixture();await f.service.archive(f.entity,[{file:'old'}]);const id=f.service.state.archive[0].id;f.failDelete(true);
    await assert.rejects(f.service.removeArchive(id),/HTTP 500/);assert.equal(f.files.has('old'),true);assert.equal(f.service.state.archive[0].chats[0].file,'old');
    f.failDelete(false);await f.service.removeArchive(id);assert.deepEqual(f.deleted,['old']);
});

test('copy creates an independent file and leaves source integrity unchanged',async()=>{
    const f=await fixture(),name=await f.service.copy(f.entity,'old');assert.notEqual(name,'old');assert.equal(f.files.size,3);
    assert.equal(f.files.get('old')[0].chat_metadata.integrity,'original');assert.equal(f.files.get(name)[0].chat_metadata.integrity,undefined);
    assert.equal(f.files.get(name)[1].mes,'old message');assert.equal(f.service.title(f.entity.key,name),'old · 副本');
});

test('group deletion failure retains its chat list; shared group files are never deleted',async()=>{
    const f=await fixture(),{projectKey}=await modulePromise;f.c.groups.push({id:'g',name:'Group',chats:['old','live'],chat_id:'old'});const entity=f.service.entity(projectKey('g',true));
    await f.service.archive(entity,[{file:'old'}]);const id=f.service.state.archive[0].id;f.failDelete(true);
    await assert.rejects(f.service.removeArchive(id));assert.equal(entity.data.chats.includes('old'),true);
    f.failDelete(false);f.c.groups.push({id:'other',chats:['old']});await assert.rejects(f.service.removeArchive(id),/其他群聊引用/);assert.deepEqual(f.deleted,[]);
    f.c.groups.pop();await f.service.removeArchive(id);assert.deepEqual(f.deleted,['old']);assert.deepEqual(entity.data.chats,['live']);
});
