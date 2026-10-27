import {default_user_avatar,setUserName} from '/script.js';
import * as personas from '/scripts/personas.js';
import {saveSettingsConfirmed,sameValue} from './settings-data.mjs';

export function personaDraft(settings,id){const d=settings.persona_descriptions?.[id]||{};return {name:settings.personas?.[id]||'',title:d.title||'',description:d.description||'',position:d.position??0,depth:d.depth??2,role:d.role??0,lorebook:d.lorebook||''};}
function validate(id,draft){
    if(typeof id!=='string'||!id||/[\\/\0]/.test(id)||['.','..','__proto__','constructor','prototype'].includes(id))throw Error('身份文件标识无效，未导入。');
    if(typeof draft.name!=='string'||!draft.name.trim()||['title','description','lorebook'].some(key=>typeof draft[key]!=='string'))throw Error('身份名称或描述格式不正确。');
    if(![0,1,2,3,4,9].includes(draft.position)||![0,1,2].includes(draft.role)||!Number.isInteger(draft.depth)||draft.depth<0||draft.depth>9999)throw Error('身份注入位置、深度或身份类型无效。');
}
export class PersonaLibrary{
    constructor(ctx){this.ctx=ctx;}
    get settings(){return this.ctx().powerUserSettings;}
    async avatars(){const response=await fetch('/api/avatars/get',{method:'POST',headers:this.ctx().getRequestHeaders({omitContentType:true})});if(!response.ok)throw Error('无法读取身份头像列表，请重试。');const list=await response.json();if(!Array.isArray(list))throw Error('身份头像列表格式无效。');return list;}
    async defaultAvatar(id){
        const source=await fetch(default_user_avatar);if(!source.ok)throw Error('默认身份头像读取失败，未创建身份。');
        const form=new FormData();form.append('avatar',new File([await source.blob()],'avatar.png',{type:'image/png'}));form.append('overwrite_name',id);
        const response=await fetch('/api/avatars/upload',{method:'POST',headers:this.ctx().getRequestHeaders({omitContentType:true}),body:form});if(!response.ok)throw Error('身份头像保存失败，请重试。');
    }
    async save(id,base,draft){
        validate(id,draft);const s=this.settings,current=personaDraft(s,id),changed=Object.keys(base).filter(key=>!sameValue(base[key],draft[key]));
        for(const key of changed)if(!sameValue(current[key],base[key])&&!sameValue(current[key],draft[key]))throw Error('身份资料已在其他位置更新，请保留编辑内容后重新载入。');
        const merged={...current,...Object.fromEntries(changed.map(key=>[key,draft[key]]))};validate(id,merged);
        const oldName=s.personas?.[id];s.personas??={};s.persona_descriptions??={};s.personas[id]=merged.name.trim();
        const {name,...description}=merged;s.persona_descriptions[id]={...s.persona_descriptions[id],...description};
        if(id===personas.user_avatar){setUserName(s.personas[id]);Object.assign(s,{persona_description:merged.description,persona_description_position:merged.position,persona_description_depth:merged.depth,persona_description_role:merged.role,persona_description_lorebook:merged.lorebook});personas.setPersonaDescription();}
        await this.persist([id]);const c=this.ctx();
        if(oldName&&oldName!==s.personas[id]&&c.eventTypes.PERSONA_RENAMED)await c.eventSource.emit(c.eventTypes.PERSONA_RENAMED,{avatarId:id,oldName,newName:s.personas[id]});
        if(c.eventTypes.PERSONA_UPDATED)await c.eventSource.emit(c.eventTypes.PERSONA_UPDATED,id);
    }
    async persist(ids){const s=this.settings;await saveSettingsConfirmed(this.ctx,ids.flatMap(id=>[[['power_user','personas',id],s.personas[id]],[['power_user','persona_descriptions',id],s.persona_descriptions[id]]]));}
    async create(name){
        const id=crypto.randomUUID()+'.png',draft={name:name.trim(),title:'',description:'',position:0,depth:2,role:0,lorebook:''};validate(id,draft);
        await this.defaultAvatar(id);await personas.initPersona(id,draft.name,'','');await this.persist([id]);return id;
    }
    async backup(file){
        let data;try{data=JSON.parse(await file.text());}catch{throw Error('请选择有效的身份备份 JSON 文件。');}
        if(!data||!data.personas||!data.persona_descriptions||Array.isArray(data.personas)||Array.isArray(data.persona_descriptions)||typeof data.personas!=='object'||typeof data.persona_descriptions!=='object')throw Error('身份备份格式不正确。');
        const entries=Object.keys(data.personas).map(id=>{const descriptor=data.persona_descriptions[id]||{};if(typeof descriptor!=='object'||Array.isArray(descriptor))throw Error('身份描述格式不正确，未导入。');const draft=personaDraft(data,id);validate(id,draft);return {id,draft,descriptor};});
        return {entries,defaultPersona:typeof data.default_persona==='string'?data.default_persona:null};
    }
    async restore(plan,{useDefault=false}={}){
        const avatars=await this.avatars(),s=this.settings,added=[];s.personas??={};s.persona_descriptions??={};
        for(const {id,draft,descriptor}of plan.entries){if(Object.hasOwn(s.personas,id))continue;if(!avatars.includes(id))await this.defaultAvatar(id);const {name,...description}=draft;s.personas[id]=name.trim();s.persona_descriptions[id]={...descriptor,...description};added.push(id);}
        if(useDefault&&plan.defaultPersona&&Object.hasOwn(s.personas,plan.defaultPersona))s.default_persona=plan.defaultPersona;
        await this.persist(plan.entries.map(e=>e.id));
        if(useDefault)await saveSettingsConfirmed(this.ctx,[[['power_user','default_persona'],s.default_persona]]);
        const c=this.ctx();for(const id of added)if(c.eventTypes.PERSONA_CREATED)await c.eventSource.emit(c.eventTypes.PERSONA_CREATED,{avatarId:id,name:s.personas[id],description:s.persona_descriptions[id].description,title:s.persona_descriptions[id].title});
        return added;
    }
    async setDefault(id,value){if(value)this.settings.default_persona=id;else this.settings.default_persona=null;await saveSettingsConfirmed(this.ctx,[[['power_user','default_persona'],this.settings.default_persona]]);personas.setPersonaDescription();}
}
