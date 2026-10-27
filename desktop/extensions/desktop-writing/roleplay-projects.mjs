import {readUIPreference,writeUIPreference} from './ui-preferences.mjs';

// Archives remain indefinitely, including records created by older versions.
const KEY='roleplayProjects';
const safeName=value=>typeof value==='string'&&value.length>0&&!/[\\/\u0000-\u001f]/.test(value)&&value!=='.'&&value!=='..';
export const projectKey=(owner,group=false)=>(group?'g:':'c:')+owner;
export function validArchive(record){
    return !!record&&typeof record.id==='string'&&safeName(record.owner)&&typeof record.group==='boolean'
        &&record.key===projectKey(record.owner,record.group)&&['project','chat'].includes(record.kind)
        &&Number.isFinite(record.at)&&record.at>0&&Array.isArray(record.chats)
        &&record.chats.every(chat=>safeName(chat.file));
}
export function archiveDue(){ return false; }

// Only display metadata lives here. Native chat files remain the source of truth.
export class RoleplayProjects{
    constructor({ctx,request=globalThis.fetch.bind(globalThis),native=()=>import('/script.js'),busy=()=>false}){
        Object.assign(this,{ctx,request,native,busy});
        const saved=readUIPreference(KEY,null);
        this.state=saved?.version===1?saved:{version:1,avatars:false,projects:{},archive:[]};
        this.state.projects??={};this.state.archive??=[];
    }
    project(key){return this.state.projects[key]||{name:'',titles:{},collapsed:true,hiddenArchive:null};}
    update(key,patch){this.state.projects[key]={...this.project(key),...patch};}
    archived(key,file){return this.state.archive.some(a=>validArchive(a)&&a.key===key&&a.chats.some(t=>t.file===file));}
    title(key,file){return this.project(key).titles?.[file]||file;}
    async remoteState(){
        const data=await this.post('/api/settings/get',{});
        const settings=typeof data.settings==='string'?JSON.parse(data.settings):data.settings;
        return settings?.extension_settings?.desktop_ui_v1?.[KEY];
    }
    async commit(change){
        const before=structuredClone(this.state);
        try{
            change();
            if(!writeUIPreference(KEY,this.state))throw Error('无法保存角色项目配置。');
            await (await this.native()).saveSettings();
            if(JSON.stringify(await this.remoteState())!==JSON.stringify(this.state))throw Error('项目配置尚未保存，请重试；未删除聊天文件。');
        }catch(error){this.state=before;writeUIPreference(KEY,before);throw error;}
    }
    async post(url,body){
        const response=await this.request(url,{method:'POST',headers:this.ctx().getRequestHeaders(),body:JSON.stringify(body)});
        if(!response.ok)throw Error('酒馆操作失败（HTTP '+response.status+'），请检查连接后重试。');
        // This native endpoint returns plain "OK", unlike the chat endpoints.
        if(url==='/api/characters/merge-attributes')return {ok:true};
        const value=await response.json();if(value?.error)throw Error('酒馆未完成此操作，请重试。');return value;
    }
    entity(key){
        const c=this.ctx();
        if(key.startsWith('g:')){const data=c.groups.find(g=>String(g.id)===key.slice(2));return data?{key,owner:String(data.id),group:true,data,name:data.name}:null;}
        const id=c.characters.findIndex(ch=>ch?.avatar===key.slice(2)),data=c.characters[id];
        return data?{key,owner:data.avatar,group:false,id,data,name:data.name}:null;
    }
    current(key,file){
        const c=this.ctx(),keyNow=c.groupId?projectKey(String(c.groupId),true):projectKey(c.characters[c.characterId]?.avatar||'');
        return key===keyNow&&(file===undefined||file===c.getCurrentChatId?.());
    }
    async chats(entity){
        if(entity.group)return (entity.data.chats||[]).filter(safeName).map(file=>({file}));
        const data=await this.post('/api/characters/chats',{avatar_url:entity.owner});
        if(!data||typeof data!=='object')throw Error('未能读取角色对话列表。');
        return Object.values(data).filter(t=>typeof t?.file_name==='string').map(t=>({file:t.file_name.replace(/\.jsonl$/i,''),items:Number(t.chat_items)||0})).filter(t=>safeName(t.file));
    }
    async archive(entity,chats,kind='chat'){
        const record={id:crypto.randomUUID(),key:entity.key,owner:entity.owner,group:entity.group,kind,
            name:this.project(entity.key).name||entity.name,at:Date.now(),chats:chats.map(t=>({file:t.file,title:this.title(entity.key,t.file)}))};
        if(!validArchive(record))throw Error('对话标识无效，未归档。');
        await this.commit(()=>{this.state.archive.push(record);if(kind==='project')this.update(entity.key,{hiddenArchive:record.id,collapsed:true});});
    }
    async restore(id){
        const record=this.state.archive.find(a=>a.id===id);if(!validArchive(record))throw Error('归档记录不可用。');
        if(!this.entity(record.key))throw Error('对应的角色卡或群聊已不存在，请先恢复角色卡或群聊。');
        await this.commit(()=>{
            this.state.archive=this.state.archive.filter(a=>a.id!==id);
            const p=this.project(record.key),titles={...p.titles};for(const chat of record.chats)titles[chat.file]=chat.title;
            this.update(record.key,{titles,collapsed:false,hiddenArchive:null,...(p.hiddenArchive===id?{name:record.name}:{})});
        });
    }
    async renameOwner(oldAvatar,newAvatar){
        const oldKey=projectKey(oldAvatar),key=projectKey(newAvatar),project=this.state.projects[oldKey];
        if(!project&&!this.state.archive.some(a=>a.key===oldKey))return;
        if(project){const target=this.project(key);this.state.projects[key]={...target,...project,titles:{...target.titles,...project.titles}};delete this.state.projects[oldKey];}
        for(const archive of this.state.archive)if(archive.key===oldKey){archive.key=key;archive.owner=newAvatar;}
        // The native rename has already moved the card/chats. Keep the new identities even if saving is temporarily unavailable.
        writeUIPreference(KEY,this.state);await(await this.native()).saveSettings();
        if(JSON.stringify(await this.remoteState())!==JSON.stringify(this.state))throw Error('角色已重命名，项目关联尚待保存。请保持软件打开并重试保存设置。');
    }
    async copy(entity,file){
        if(this.busy())throw Error('请先结束当前生成。');
        const data=await this.post(entity.group?'/api/chats/group/get':'/api/chats/get',entity.group?{id:file}:{avatar_url:entity.owner,file_name:file});
        if(!Array.isArray(data)||!data.length)throw Error('原对话为空或未保存，无法复制。');
        const copy=structuredClone(data),newFile='RP-'+crypto.randomUUID();
        if(copy[0]?.chat_metadata)delete copy[0].chat_metadata.integrity;
        if((await this.post(entity.group?'/api/chats/group/save':'/api/chats/save',entity.group?{id:newFile,chat:copy}:{avatar_url:entity.owner,file_name:newFile,chat:copy})).ok!==true)throw Error('对话复制失败。');
        if(entity.group){
            const next={...entity.data,chats:[...(entity.data.chats||[]),newFile]};
            if((await this.post('/api/groups/edit',next)).ok!==true)throw Error('副本已保存，但群聊列表更新失败。');Object.assign(entity.data,next);
        }
        await this.commit(()=>this.update(entity.key,{titles:{...this.project(entity.key).titles,[newFile]:this.title(entity.key,file)+' · 副本'}}));
        return newFile;
    }
    async removeArchive(id,{expiredOnly=false}={}){
        const record=this.state.archive.find(a=>a.id===id);
        if(!validArchive(record)||(expiredOnly&&!archiveDue(record)))throw Error('归档尚未到期或记录不可用。');
        if(this.busy())throw Error('请先结束当前生成。');
        const entity=this.entity(record.key);if(!entity)throw Error('对应角色或群聊不存在，已暂停清理。');
        if(record.chats.some(t=>this.current(record.key,t.file)))throw Error('归档中的对话正在打开，请先关闭再清理。');
        const remote=await this.remoteState(),stored=remote?.archive?.find(a=>a.id===id);
        if(JSON.stringify(stored)!==JSON.stringify(record))throw Error('归档状态已变化，已暂停删除，请重新打开软件。');
        const existing=await this.chats(entity);
        for(const chat of [...record.chats]){
            if(this.busy()||this.current(record.key,chat.file))throw Error('对话正在使用，已暂停清理。');
            if(entity.group&&this.ctx().groups.some(g=>String(g.id)!==entity.owner&&g.chats?.includes(chat.file)))throw Error('此对话仍被其他群聊引用，已保留。');
            let exists=existing.some(t=>t.file===chat.file);
            if(entity.group){const data=await this.post('/api/chats/group/get',{id:chat.file});if(!Array.isArray(data))throw Error('群聊文件读取失败，已暂停清理。');exists=data.length>0;}
            if(exists){
                // Detach the native last-chat pointer before deleting it, so opening a character cannot recreate it.
                if(entity.group){
                    if(entity.data.chat_id===chat.file){
                        const next={...entity.data,chat_id:entity.data.chats.find(file=>file!==chat.file&&!this.archived(entity.key,file))||'RP-'+crypto.randomUUID()};
                        if((await this.post('/api/groups/edit',next)).ok!==true)throw Error('群聊列表保存失败，未继续删除。');Object.assign(entity.data,next);
                    }
                }else if(entity.data.chat===chat.file){
                    const next=existing.find(t=>t.file!==chat.file&&!this.archived(entity.key,t.file))?.file||'RP-'+crypto.randomUUID();
                    await this.post('/api/characters/merge-attributes',{avatar:entity.owner,chat:next});entity.data.chat=next;
                }
                if(this.busy()||this.current(record.key,chat.file))throw Error('对话正在使用，已暂停清理。');
                const result=await this.post(entity.group?'/api/chats/group/delete':'/api/chats/delete',entity.group?{id:chat.file}:{avatar_url:entity.owner,chatfile:chat.file+'.jsonl'});
                if(result.ok!==true)throw Error('永久删除未完成，归档记录已保留。');
            }
            if(entity.group&&entity.data.chats.includes(chat.file)){
                const next={...entity.data,chats:entity.data.chats.filter(file=>file!==chat.file)};
                if((await this.post('/api/groups/edit',next)).ok!==true)throw Error('文件已清理，但群聊列表保存失败，请重试。');Object.assign(entity.data,next);
            }
            // Persist progress after each file; interrupted cleanup cannot lose the rest of a project.
            await this.commit(()=>{record.chats=record.chats.filter(t=>t.file!==chat.file);const p=this.project(record.key),titles={...p.titles};delete titles[chat.file];this.update(record.key,{titles});});
        }
        await this.commit(()=>{this.state.archive=this.state.archive.filter(a=>a.id!==id);});
    }
}
