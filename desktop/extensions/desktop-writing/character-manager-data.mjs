const textKeys=['description','personality','scenario','first_mes','mes_example','creator','character_version','creator_notes','system_prompt','post_history_instructions'];
const legacyKeys=new Set(['description','personality','scenario','first_mes','mes_example']);
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function characterDraft(card){
    const data=card.data||{},ext=data.extensions||{},draft={name:card.name||data.name||'',tags:[...(data.tags||card.tags||[])],alternate_greetings:[...(data.alternate_greetings||[])],fav:!!(ext.fav??card.fav),talkativeness:Number(ext.talkativeness??card.talkativeness??.5),depth_prompt:ext.depth_prompt?.prompt||'',depth:Number(ext.depth_prompt?.depth??4),depth_role:ext.depth_prompt?.role||'system'};
    for(const key of textKeys)draft[key]=String(data[key]??(key==='creator_notes'?card.creatorcomment:card[key])??'');
    return draft;
}
export function characterPatch(base,draft,current){
    if(draft.name!==base.name)throw Error('请使用“重命名角色”修改名称，以保留聊天和关联资料。');
    const patch={data:{}},changed=Object.keys(base).filter(key=>!equal(base[key],draft[key]));
    for(const key of changed){
        if(!equal(current[key],base[key])&&!equal(current[key],draft[key]))throw Error('“'+key+'”已在其他位置修改。请先保留当前内容，再重新载入角色。');
        const value=draft[key];
        if(value==='__@@UNSET@@__'||(Array.isArray(value)&&value.includes('__@@UNSET@@__')))throw Error('字段包含原生接口的保留值，未保存。');
        if(textKeys.includes(key)){
            if(typeof value!=='string')throw Error('角色字段格式不正确。');patch.data[key]=value;
            if(legacyKeys.has(key))patch[key]=value;if(key==='creator_notes')patch.creatorcomment=value;
        }else if(['tags','alternate_greetings'].includes(key)){
            if(!Array.isArray(value)||!value.every(x=>typeof x==='string'))throw Error('标签或开场白格式不正确。');patch.data[key]=[...value];if(key==='tags')patch.tags=[...value];
        }else{
            patch.data.extensions??={};
            if(key==='fav'){patch.fav=!!value;patch.data.extensions.fav=!!value;}
            if(key==='talkativeness'){
                if(!Number.isFinite(value)||value<0||value>1)throw Error('群聊发言倾向须在 0 到 1 之间。');patch.talkativeness=value;patch.data.extensions.talkativeness=value;
            }
            if(['depth_prompt','depth','depth_role'].includes(key)){
                if(!Number.isInteger(draft.depth)||draft.depth<0||draft.depth>1000)throw Error('提示注入深度须为 0 到 1000 的整数。');
                if(!['system','user','assistant'].includes(draft.depth_role))throw Error('提示注入身份无效。');
                const names={depth_prompt:'prompt',depth:'depth',depth_role:'role'};patch.data.extensions.depth_prompt??={};patch.data.extensions.depth_prompt[names[key]]=value;
            }
        }
    }
    return {patch,changed};
}
export class CharacterCards{
    constructor({ctx,request=globalThis.fetch.bind(globalThis)}){Object.assign(this,{ctx,request});}
    async call(path,body,{form=false,format='json'}={}){
        const response=await this.request('/api/characters/'+path,{method:'POST',headers:this.ctx().getRequestHeaders(form?{omitContentType:true}:undefined),body:form?body:JSON.stringify(body)});
        if(!response.ok)throw Error('角色操作未完成（HTTP '+response.status+'），请检查连接后重试。');
        if(format==='response')return response;if(format==='text')return response.text();
        const result=await response.json();if(result?.error)throw Error('酒馆未能完成角色操作。');return result;
    }
    async read(avatar){const card=await this.call('get',{avatar_url:avatar});if(!card||typeof card.name!=='string')throw Error('角色卡读取失败，未加载不完整内容。');return card;}
    async save(avatar,base,draft){
        const fresh=await this.read(avatar),{patch,changed}=characterPatch(base,draft,characterDraft(fresh));
        if(!changed.length)return fresh;
        await this.call('merge-attributes',{avatar,...patch},{format:'text'});
        const stored=await this.read(avatar),values=characterDraft(stored);
        if(changed.some(key=>!equal(values[key],draft[key])))throw Error('部分字段尚未确认保存。编辑内容已保留，请重新检查。');
        return stored;
    }
    async create(name){
        const form=new FormData();form.append('ch_name',name);form.append('fav','false');form.append('talkativeness','0.5');
        const avatar=await this.call('create',form,{form:true,format:'text'});if(!avatar.endsWith('.png'))throw Error('角色创建结果无效，请刷新角色列表检查。');return avatar;
    }
    async import(file){
        const type=file.name.split('.').at(-1).toLowerCase();if(!['png','json','yaml','yml','charx','byaf'].includes(type))throw Error('请选择 PNG、JSON、YAML、CHARX 或 BYAF 角色卡。');
        const form=new FormData();form.append('avatar',file);form.append('file_type',type);form.append('user_name',this.ctx().name1||'User');
        const result=await this.call('import',form,{form:true});if(typeof result.file_name!=='string')throw Error('未能导入角色卡，请检查文件。');return result.file_name+'.png';
    }
    async cover(avatar,file){const form=new FormData();form.append('avatar_url',avatar);form.append('avatar',file);await this.call('edit-avatar',form,{form:true,format:'text'});}
}
