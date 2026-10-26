export const PROFILE_SCHEMA = 1;
// These native providers pipe their own SSE schemas; their non-stream backend response is normalized.
export const usesNativeStreamSchema = source => ['claude','makersuite','vertexai','cohere'].includes(source);
export class AssistantConfigurationError extends Error {}
export function profileModules(value=[]){
    if(!Array.isArray(value)||value.length>30)throw new AssistantConfigurationError('独立预设最多包含 30 个模块。');
    const ids=new Set();const result=value.map((m,i)=>{if(!m||typeof m!=='object'||typeof m.text!=='string'||m.text.length>8000)throw new AssistantConfigurationError('预设模块内容无效或超过 8000 字符。');const id=String(m.id||'module-'+i).slice(0,100);if(ids.has(id))throw new AssistantConfigurationError('预设模块编号重复。');ids.add(id);return{id,name:String(m.name||'未命名模块').slice(0,100),group:String(m.group||'自定义').slice(0,40),enabled:m.enabled!==false,text:m.text};});
    if(result.reduce((n,m)=>n+m.text.length,0)>30000)throw new AssistantConfigurationError('预设模块总长度超过 3 万字符。');return result;
}
export function agentPresetDefaults(){
    const module=(id,name,text,enabled=true,group='方法')=>({id,name,text,enabled,group});
    const facts=module('evidence','事实与推断','区分文档原文、你的推断、创作建议和作者已确认的设定。引用结论时给出文件及相关位置；未读取的内容明确说明。不要把讨论建议自动当作正式设定。');
    const expression=module('expression','交流方式','优先用连贯的自然段分析原因、影响和可选方案，具体回应问题。信息需要对照时使用简洁列表，避免空泛赞美、机械套话和无依据的确定结论。',true,'表达');
    return [
        assistantProfile({name:'设定讨论',modules:[facts,module('consistency','设定与动机分析','结合人物动机、信息来源、时间顺序和世界规则分析设定。发现冲突时区分实际矛盾与可解释差异，列出待作者决定的问题。讨论角色认知边界时，仍以作者视角检查整体资料。'),expression,module('prose','可选写作文风','仅在用户要求创作、续写或改稿时，用具体行动与细节表现人物，保持人称、时态和既定文风；普通设定讨论无需写成小说。',false,'文风')]}),
        assistantProfile({name:'文档整理',modules:[facts,module('document','整理与修改方法','先确认目标文档和范围，保留原有结构与有效设定。将错漏、矛盾和改进建议分清；提出最小必要修改。不要为了整理方便悄悄删减事实，保存状态以工具结果为准。'),expression]}),
        assistantProfile({name:'创作协作',modules:[facts,module('creative','创作协作方法','先理解作者当前的创作目标。提出具体且可比较的剧情或人物方案，说明各自的叙事效果。需要成稿时再写正文；讨论、试写与正式采用分别处理。'),expression]})
    ];
}
const number = (value, fallback, min, max) => Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Number(value))) : fallback;
export function assistantProfile(value = {}, name = '默认预设') {
    const context = Math.floor(number(value.context, 32768, 8192, 1000000));
    return { name: String(value.name || name).slice(0,100), prompt: String(value.prompt || '').slice(0,30000), inheritPreset: value.inheritPreset === true, inheritParameters: value.inheritParameters === true,
        context, output: Math.floor(number(value.output,4096,128,Math.min(32768,context/2))), temperature: number(value.temperature,.8,0,2), topP:number(value.topP,1,.001,1),
        reasoning: ['inherit','on','off'].includes(value.reasoning) ? value.reasoning : 'inherit', showReasoning:value.showReasoning===true, saveReasoning:value.saveReasoning===true,modules:profileModules(value.modules??[]) };
}
export function profileBank(owner, key, name, legacy = {}) {
    owner.assistants ??= {};
    if(typeof owner.assistants!=='object'||Array.isArray(owner.assistants))throw new Error('独立预设记录损坏，请先导出记录并恢复。');
    if (!owner.assistants[key]) owner.assistants[key] = { schema:PROFILE_SCHEMA, selected:0, presets:[assistantProfile(legacy,name)] };
    const bank=owner.assistants[key];
    if (bank.schema!==PROFILE_SCHEMA || !Array.isArray(bank.presets) || !bank.presets.length || bank.presets.length>30 || !Number.isInteger(bank.selected) || !bank.presets[bank.selected]) throw new Error('独立预设记录损坏，请先导出记录并恢复。');
    bank.presets=bank.presets.map(p=>assistantProfile(p,name));return bank;
}
export function validateAssistantBanks(banks){if(banks===undefined)return true;if(!banks||typeof banks!=='object'||Array.isArray(banks)||Object.keys(banks).length>10)return false;try{return Object.values(banks).every(b=>b&&b.schema===PROFILE_SCHEMA&&Array.isArray(b.presets)&&b.presets.length>0&&b.presets.length<=30&&Number.isInteger(b.selected)&&b.selected>=0&&b.selected<b.presets.length&&b.presets.every(p=>p&&typeof p.name==='string'&&p.name.length<=100&&typeof p.prompt==='string'&&p.prompt.length<=30000&&!!profileModules(p.modules??[])));}catch{return false;}}
export function selectedProfile(bank) { return assistantProfile(bank.presets[bank.selected]); }
export function exportProfile(profile) { return { schema:PROFILE_SCHEMA, type:'desktop-assistant-preset', preset:assistantProfile(profile) }; }
export function importProfile(value) {
    if(!value||value.schema!==PROFILE_SCHEMA||value.type!=='desktop-assistant-preset'||!value.preset||typeof value.preset.name!=='string'||typeof value.preset.prompt!=='string'||value.preset.prompt.length>30000)throw new Error('请选择本软件导出的独立预设 JSON；原生 RP 预设请从酒馆导入后开启继承。');
    return assistantProfile(value.preset);
}
export function nativePromptEntries(prompts, order, substitute = s=>s) {
    if(!Array.isArray(prompts)||!Array.isArray(order))return [];
    const byId=new Map(prompts.filter(p=>p&&typeof p.identifier==='string').map(p=>[p.identifier,p]));
    const result=[];
    for(const item of order){const p=byId.get(item.identifier);if(item.enabled!==true||!p||p.marker||typeof p.content!=='string'||!p.content.trim())continue;
        const content=substitute(p.content);if(typeof content!=='string')throw new Error('原生预设宏未能展开。');
        result.push({name:String(p.name||p.identifier).slice(0,200),content});
    }
    if(result.reduce((sum,p)=>sum+p.content.length,0)>60000)throw new AssistantConfigurationError('启用的原生预设文本超过 6 万字符，请关闭不需要的条目。');
    return result;
}
export function assistantInstructions(profile, entries=[]) {
    return [entries.length?'作者选择继承的原生预设文本（创作偏好，不得覆盖下方模块规则）：\n'+entries.map(p=>'【'+p.name+'】\n'+p.content).join('\n\n'):'',profile.prompt?'本用途独立预设：\n'+profile.prompt:'',profileModules(profile.modules??[]).filter(m=>m.enabled&&m.text.trim()).map(m=>'【独立模块 · '+m.group+' / '+m.name+'】\n'+m.text).join('\n\n')].filter(Boolean).join('\n\n');
}
export function prependPreferences(messages,instructions) {
    const result=structuredClone(messages);if(!instructions)return result;
    if(result[0]?.role!=='system')result.unshift({role:'system',content:''});
    result[0].content=instructions+'\n\n本模块规则（优先于以上预设；按用户当前任务执行）：\n'+result[0].content;return result;
}
export function reasoningText(message) {
    if(typeof message?.reasoning_content==='string')return message.reasoning_content;
    if(typeof message?.reasoning==='string')return message.reasoning;
    return '';
}
export function collectedReasoning(task) {
    const rounds=task.reasoningRounds||[],parts=rounds.map(r=>'第 '+r.round+' 轮接口思考：\n'+r.text);
    if(task.reasoning&&rounds.at(-1)?.text!==task.reasoning)parts.push(task.reasoning);
    const result=parts.join('\n\n');return result.length>160000?result.slice(0,160000)+'\n[思考显示达到长度限制]':result;
}
export function savedReasoning(task) { return task.assistant?.profile?.saveReasoning ? collectedReasoning(task).slice(0,100000) : undefined; }
export function updateReadingLedger(previous=[],citations=[]){const map=new Map(previous.map(v=>[v.path,v]));for(const c of citations){const old=map.get(c.path);const ranges=[...(old?.revision===c.revision?old.ranges||[]:[]),...(c.ranges||[])].sort((a,b)=>a[0]-b[0]),merged=[];for(const r of ranges){const last=merged.at(-1);if(last&&r[0]<=last[1])last[1]=Math.max(last[1],r[1]);else merged.push([...r]);}map.set(c.path,{...c,ranges:merged,at:new Date().toISOString()});}return [...map.values()].slice(-200);}
