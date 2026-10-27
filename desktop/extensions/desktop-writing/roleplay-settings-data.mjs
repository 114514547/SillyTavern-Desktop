import * as world from '/scripts/world-info.js';
import * as openai from '/scripts/openai.js';
import {getPresetManager} from '/scripts/preset-manager.js';
import {cancelStatusCheck,setOnlineStatus} from '/script.js';
import {sameValue,saveSettingsConfirmed} from './settings-data.mjs';
const names={openai:['openai_settings','openai_setting_names'],kobold:['koboldai_settings','koboldai_setting_names'],novel:['novelai_settings','novelai_setting_names'],textgenerationwebui:['textgenerationwebui_presets','textgenerationwebui_preset_names'],context:['context'],instruct:['instruct'],sysprompt:['sysprompt']};
export function checkedRecordName(name){if(typeof name!=='string'||!name.trim()||name!==name.trim()||/[<>:"/\\|?*\u0000-\u001f]/.test(name)||/[. ]$/.test(name)||new TextEncoder().encode(name).length>250)throw Error('名称含不支持的字符、首尾空格或过长，未保存文件。');return name;}
export const roleplayParameterFields=[['temp_openai','温度',0,.05],['openai_max_tokens','最大输出',1,1],['openai_max_context','上下文容量',512,1],['top_p_openai','Top P',0,.01],['freq_pen_openai','频率惩罚',-2,.05],['pres_pen_openai','存在惩罚',-2,.05]];
export async function setRoleplayParameter(ctx,key,value){
    const definition=roleplayParameterFields.find(([name])=>name===key);if(ctx().mainApi!=='openai')throw Error('请在当前接口的完整参数页调整。');
    if(key!=='stream_openai'&&(!definition||!Number.isFinite(value)||value<definition[2]||['openai_max_tokens','openai_max_context'].includes(key)&&!Number.isInteger(value)))throw Error('参数超出有效范围。');
    openai.oai_settings[key]=value;await saveSettingsConfirmed(ctx,[[['oai_settings',key],value]]);
}
export async function settingsRequest(ctx,path,body){const response=await fetch(path,{method:'POST',headers:ctx().getRequestHeaders(),body:JSON.stringify(body)});if(!response.ok)throw Error('资料操作失败（HTTP '+response.status+'），当前编辑已保留。');try{return await response.json();}catch{throw Error('资料返回格式无效，请重新载入。');}}
export function presetRecords(data,api){const [valuesKey,namesKey]=names[api]||[],values=data[valuesKey]||[],labels=data[namesKey]||[];return values.map((item,index)=>{let preset;try{preset=typeof item==='string'?JSON.parse(item):item;}catch{throw Error('某个预设文件的 JSON 格式无效。');}return {name:labels[index]||preset.name||'未命名预设 '+index,value:index,preset};});}
export class RoleplayPresets{
    constructor(ctx,api='openai'){this.ctx=ctx;this.api=api==='koboldhorde'?'kobold':api;}
    async list(){const data=await settingsRequest(this.ctx,'/api/settings/get',{});this.records=presetRecords(data,this.api);return this.records;}
    remember(record,select=false){
        const manager=getPresetManager(this.api);if(!manager)return;const {presets,preset_names}=manager.getPresetList(),keyed=manager.isKeyedApi();let index=keyed?preset_names.indexOf(record.name):preset_names[record.name];
        if(index===undefined||index<0){index=presets.length;if(keyed)preset_names.push(record.name);else preset_names[record.name]=index;}presets[index]=structuredClone(record.preset);
        // Mirror metadata for extensions using the legacy PresetManager. No
        // change/input event is dispatched; applying data is handled above.
        const element=manager.select?.[0],value=String(keyed?record.name:index);if(element){if(![...element.options].some(o=>o.value===value))element.add(new Option(record.name,value));if(select)element.value=value;}
    }
    async save(name,base,draft,{create=false}={}){
        checkedRecordName(name);
        if(!draft||typeof draft!=='object'||Array.isArray(draft))throw Error('预设需要是 JSON 对象。');
        if(this.api==='openai'&&draft.prompts!==undefined&&(!Array.isArray(draft.prompts)||draft.prompts.some(p=>!p||typeof p.identifier!=='string')||new Set(draft.prompts.map(p=>p.identifier)).size!==draft.prompts.length))throw Error('提示条目编号缺失、重复或格式无效。');
        if(draft.prompt_order!=null&&(!Array.isArray(draft.prompt_order)||draft.prompt_order.some(group=>!group||!Array.isArray(group.order)||group.order.some(item=>typeof item?.identifier!=='string'))))throw Error('提示词顺序配置格式无效。');
        const fresh=(await this.list()).find(record=>record.name===name);if(create&&fresh)throw Error('已有同名预设，请使用其他名称。');if(!create&&(!fresh||!sameValue(fresh.preset,base)))throw Error('预设已在其他位置变化，未覆盖文件；请先导出当前编辑。');
        const result=await settingsRequest(this.ctx,'/api/presets/save',{apiId:this.api,name,preset:draft});
        const stored=(await this.list()).find(record=>record.name===result.name);if(!stored||!sameValue(stored.preset,draft))throw Error('预设尚未确认保存，请保留当前编辑。');this.remember(stored);return stored;
    }
    async apply(record){
        const c=this.ctx(),manager=getPresetManager(this.api);if(!manager)throw Error('当前接口的预设业务尚未就绪。');
        if(this.api!=='openai'||!Array.isArray(record.preset.prompts)){manager.updateList(record.name,structuredClone(record.preset));if(this.api==='openai')await openai.getPresetApplicationPromise();await saveSettingsConfirmed(this.ctx,[]);return;}
        const settings=openai.oai_settings,preset=structuredClone(record.preset),before=settings.preset_settings_openai;
        if(c.eventTypes.OAI_PRESET_CHANGED_BEFORE)await c.eventSource.emit(c.eventTypes.OAI_PRESET_CHANGED_BEFORE,{preset,presetName:record.name,presetNameBefore:before,settings,settingsToUpdate:openai.settingsToUpdate,savePreset:(name,data)=>this.save(name,null,data,{create:!this.records.some(r=>r.name===name)})});
        const applied={};for(const [key,[,property,,connection]]of Object.entries(openai.settingsToUpdate)){if(connection&&!settings.bind_preset_to_connection)continue;if(key==='extensions'){settings.extensions=preset.extensions||{};applied.extensions=settings.extensions;}else if(preset[key]!==undefined){settings[property]=structuredClone(preset[key]);applied[property]=settings[property];}}
        // PromptManager owns prompt ordering and placeholders; its preset event
        // listeners remain authoritative rather than duplicating that engine.
        settings.preset_settings_openai=record.name;applied.preset_settings_openai=record.name;
        if(settings.bind_preset_to_connection){cancelStatusCheck('Roleplay preset connection changed');setOnlineStatus('no_connection');}
        await saveSettingsConfirmed(this.ctx,Object.entries(applied).map(([key,value])=>[['oai_settings',key],value]));this.remember(record,true);
        if(c.eventTypes.OAI_PRESET_CHANGED_AFTER)await c.eventSource.emit(c.eventTypes.OAI_PRESET_CHANGED_AFTER);
        if(c.eventTypes.PRESET_CHANGED)await c.eventSource.emit(c.eventTypes.PRESET_CHANGED,{apiId:'openai',name:record.name});
    }
}
export class WorldBooks{
    constructor(ctx){this.ctx=ctx;}
    async list(){const rows=await settingsRequest(this.ctx,'/api/worldinfo/list',{});if(!Array.isArray(rows))throw Error('世界书目录格式无效。');return rows.map(row=>row.file_id);}
    async read(name){const data=await settingsRequest(this.ctx,'/api/worldinfo/get',{name});if(!data?.entries||typeof data.entries!=='object'||Array.isArray(data.entries))throw Error('世界书未找到，或条目格式不正确。');return data;}
    async save(name,base,draft,{create=false}={}){
        checkedRecordName(name);
        const exists=(await this.list()).includes(name);if(create&&exists)throw Error('世界书名称已存在，未覆盖。');if(!create&&(!exists||!sameValue(await this.read(name),base)))throw Error('世界书已在其他位置更新，未覆盖；请先导出当前编辑。');
        // Verify the disk write before publishing it to the scanning cache.
        const response=await fetch('/api/worldinfo/edit',{method:'POST',headers:this.ctx().getRequestHeaders(),body:JSON.stringify({name,data:draft})});if(!response.ok)throw Error('世界书未保存，当前编辑已保留。');
        const saved=await this.read(name);if(!sameValue(saved,draft))throw Error('世界书尚未确认保存，请保留当前编辑。');world.worldInfoCache.set(name,structuredClone(saved));await this.ctx().eventSource.emit(this.ctx().eventTypes.WORLDINFO_UPDATED,name,saved);await world.updateWorldInfoList();return saved;
    }
    async activate(settings,selected){world.world_info.globalSelect=[...selected];world.updateWorldInfoSettings(structuredClone(settings),[...selected]);await saveSettingsConfirmed(this.ctx,[[['world_info_settings'],world.getWorldInfoSettings()]]);const c=this.ctx();if(c.eventTypes.WORLDINFO_SETTINGS_UPDATED)await c.eventSource.emit(c.eventTypes.WORLDINFO_SETTINGS_UPDATED);}
}
