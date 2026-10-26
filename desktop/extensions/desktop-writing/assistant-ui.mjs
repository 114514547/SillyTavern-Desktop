import {assistantProfile,selectedProfile,importProfile,exportProfile,agentPresetDefaults} from './assistant-options.mjs';
import {DOMPurify,showdown} from '/lib.js';
const converter=new showdown.Converter({tables:true,strikethrough:true,literalMidWordUnderscores:true});
export function renderProse(text){const escaped=String(text).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');return DOMPurify.sanitize(converter.makeHtml(escaped),{ALLOWED_TAGS:['p','br','strong','em','del','code','pre','blockquote','ul','ol','li','h1','h2','h3','h4','hr','table','thead','tbody','tr','th','td'],ALLOWED_ATTR:[]});}
const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
export function reasoningPanel(text, {incomplete=false}={}) {
    if(!text)return null;const d=el('details');d.className='dw-reasoning';d.append(el('summary','接口返回的思考内容'+(incomplete?' · 未完成':'')),el('pre',text));return d;
}
export function updateReasoning(parent,text,show,incomplete=false){let panel=parent.querySelector('.dw-reasoning');if(!show||!text){panel?.remove();return;}if(!panel){panel=reasoningPanel(text,{incomplete});parent.append(panel);}else panel.querySelector('pre').textContent=text;}
export function generationPanel(info){
    if(!info)return null;
    const d=el('details');
    d.className='dw-generation-info';
    let summaryText='本次配置 · '+(info.name||'默认预设')+' · '+(info.model||'');
    if(info.usage){
        const u=info.usage;
        if(Number.isFinite(u.hit)&&u.hit>0&&!u.unknownFields?.includes('hit')&&!u.unknownFields?.includes('input')){
            const total=(u.hit||0)+(u.miss||0)||u.input||0;
            const pct=total>0?Math.round((u.hit/total)*100):0;
            summaryText+=' · 缓存命中 '+pct+'% ('+u.hit+'/'+total+')';
        }
    }
    let body='模型：'+info.source+' / '+info.model+'\n参数：'+info.parameters+'\n上下文 / 输出：'+(info.context||'原生')+' / '+(info.output||'原生')+'\n继承的提示词条目：'+(info.entries?.join('、')||'无')+(info.notice?'\n'+info.notice:'');
    if(info.usage){
        const u=info.usage;
        const value=key=>u[key]===undefined?'未知':(u.unknownFields?.includes(key)?'至少 ':'')+u[key];
        body+='\nToken 统计：输入 '+value('input')+'（缓存命中 '+value('hit')+' / 未命中 '+value('miss')+'）· 输出 '+value('output');
        if(u.requests)body+='\n本轮模型请求 '+u.requests+' 次 · 已返回统计 '+u.reportedRequests+' 次'+(u.partial?'；合计不完整，缺失部分未按零计算。':'');
    }
    d.append(el('summary',summaryText),el('pre',body));
    return d;
}
export function renderAssistantSettings(parent,{bank,change,busy=false,preview,agent=false,draft=false}) {
    const panel=el('fieldset');panel.className='dw-assistant-settings';panel.append(el('legend','独立预设与模型参数'));parent.append(panel);
    const select=el('select');select.className='text_pole';select.setAttribute('aria-label','独立预设');bank.presets.forEach((p,i)=>{const o=el('option',p.name);o.value=i;select.append(o);});select.value=bank.selected;
    const redraw=()=>{panel.remove();renderAssistantSettings(parent,{bank,change,busy,preview,agent,draft});};select.onchange=()=>{bank.selected=Number(select.value);change();redraw();};panel.append(select);
    const p=selectedProfile(bank), set=(key,value)=>{try{bank.presets[bank.selected]=assistantProfile({...bank.presets[bank.selected],[key]:value});status.textContent='';change();return true;}catch(e){status.textContent=e.message;return false;}};
    const button=(label,run,target=panel)=>{const b=el('button',label);b.type='button';b.className='menu_button';b.onclick=()=>{try{run();}catch(e){status.textContent=e.message;}};target.append(b);return b;};
    const status=el('small');status.setAttribute('role','status');
    button('复制为新预设',()=>{if(bank.presets.length>=30)throw new Error('最多保存 30 套预设。');bank.presets.push({...selectedProfile(bank),name:p.name+' 副本'});bank.selected=bank.presets.length-1;change();redraw();});
    button('删除此预设',()=>{if(bank.presets.length===1)throw new Error('至少保留一套预设。');bank.presets.splice(bank.selected,1);bank.selected=0;change();redraw();});
    const field=(label,input,target=panel)=>{const row=el('label');row.append(el('span',label),input);input.setAttribute('aria-label',label);target.append(row);return input;};
    const name=el('input');name.className='text_pole';name.maxLength=100;name.value=p.name;field('预设名称',name).onchange=()=>{set('name',name.value||'未命名预设');select.options[bank.selected].textContent=bank.presets[bank.selected].name;};
    const experimental=el('details');experimental.className='dw-experimental';experimental.append(el('summary','实验功能 · 原生角色扮演预设继承'+(p.inheritPreset||p.inheritParameters?'（已启用）':'（关闭）')),el('small','默认关闭。仅有限复用原生文本和参数；社区脚本、动态插槽与复杂宏不保证等价。'));
    for(const [key,label]of [['inheritPreset','继承当前原生预设的启用文本条目'],['inheritParameters','继承原生采样参数和输出上限'],['showReasoning','显示接口返回的思考内容'],['saveReasoning','将接口思考内容保存在讨论记录']].filter(([key])=>!draft||key!=='saveReasoning')){const input=el('input');input.type='checkbox';input.checked=p[key];field(label,input,key.startsWith('inherit')?experimental:panel).onchange=()=>{set(key,input.checked);if(key==='inheritParameters')redraw();};}
    const mode=el('select');mode.className='text_pole';for(const [value,label]of [['inherit','沿用原生模型思考设置'],['on','向接口请求开启思考'],['off','向接口请求关闭思考']]){const o=el('option',label);o.value=value;mode.append(o);}mode.value=p.reasoning;field('模型思考请求',mode).onchange=()=>set('reasoning',mode.value);
    const prompt=el('textarea');prompt.className='text_pole';prompt.rows=5;prompt.maxLength=30000;prompt.value=p.prompt;field('独立预设提示词',prompt).oninput=()=>set('prompt',prompt.value);
    if(agent||p.modules.length){
        const modules=el('section');modules.className='dw-preset-modules';modules.append(el('h4','Agent 独立模块'),el('small','按顺序组合启用的模块，不执行酒馆宏、正则或插件。文风模块按需启用。'));
        const update=(id,patch)=>{const next=selectedProfile(bank).modules.map(m=>m.id===id?{...m,...patch}:m);return set('modules',next);};
        for(const m of p.modules){const box=el('details');box.className='dw-preset-module';box.dataset.module=m.id;box.append(el('summary',(m.enabled?'启用':'关闭')+' · '+m.group+' · '+m.name));
            const enabled=el('input');enabled.type='checkbox';enabled.checked=m.enabled;field('启用模块',enabled,box).onchange=()=>{update(m.id,{enabled:enabled.checked});box.querySelector('summary').textContent=(enabled.checked?'启用':'关闭')+' · '+m.group+' · '+m.name;};
            const title=el('input');title.className='text_pole';title.maxLength=100;title.value=m.name;field('模块名称',title,box).onchange=()=>{if(update(m.id,{name:title.value}))redraw();};
            const group=el('select');group.className='text_pole';for(const name of new Set(['方法','表达','文风','自定义',m.group])){const o=el('option',name);o.value=name;group.append(o);}group.value=m.group;field('模块分组',group,box).onchange=()=>{if(update(m.id,{group:group.value}))redraw();};
            const body=el('textarea');body.className='text_pole';body.rows=6;body.maxLength=8000;body.value=m.text;field('模块内容',body,box).oninput=()=>update(m.id,{text:body.value});
            for(const [label,delta]of [['上移',-1],['下移',1]])button(label,()=>{const next=selectedProfile(bank).modules,i=next.findIndex(x=>x.id===m.id),j=i+delta;if(j<0||j>=next.length)return;[next[i],next[j]]=[next[j],next[i]];if(set('modules',next))redraw();},box);
            button('删除模块',()=>{if(set('modules',selectedProfile(bank).modules.filter(x=>x.id!==m.id)))redraw();},box);modules.append(box);
        }
        button('添加模块',()=>{if(set('modules',[...selectedProfile(bank).modules,{id:crypto.randomUUID(),name:'新模块',group:'自定义',enabled:true,text:''}]))redraw();},modules);
        const template=el('select');template.className='text_pole';const defaults=agentPresetDefaults();defaults.forEach((p,i)=>{const o=el('option',p.name);o.value=i;template.append(o);});field('内置 Agent 模板',template,modules);
        button('从模板新增预设',()=>{if(bank.presets.length>=30)throw new Error('最多保存 30 套预设。');bank.presets.push(defaults[Number(template.value)]);bank.selected=bank.presets.length-1;change();redraw();},modules);panel.append(modules);
    }
    for(const [key,label,min,max,step]of [['context',agent?'Agent 上下文容量（tokens）':'上下文容量（tokens）',8192,1000000,1],['output',agent?'Agent 最大输出（含模型思考，tokens）':'最大输出（含模型思考，tokens）',128,32768,1],['temperature','温度',0,2,.05],['topP','Top P',.001,1,.01]]){const input=el('input');input.type='number';input.className='text_pole';Object.assign(input,{min,max,step,value:p[key],disabled:p.inheritParameters});field(label,input).onchange=()=>{set(key,Number(input.value));input.value=bank.presets[bank.selected][key];};}
    const file=el('input');file.type='file';file.accept='.json,application/json';file.hidden=true;panel.append(file);file.onchange=async()=>{try{const f=file.files[0];if(!f)return;if(f.size>150000)throw new Error('独立预设文件过大。');const imported=importProfile(JSON.parse(await f.text()));if(bank.presets.length>=30)throw new Error('预设数量已达上限。');bank.presets.push(imported);bank.selected=bank.presets.length-1;change();redraw();}catch(e){status.textContent=e.message;}finally{file.value='';}};
    button('导入独立预设',()=>file.click());button('导出独立预设',()=>{const a=el('a');const url=URL.createObjectURL(new Blob([JSON.stringify(exportProfile(selectedProfile(bank)),null,2)],{type:'application/json'}));a.href=url;a.download='创作预设.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
    const report=el('pre');report.className='dw-assistant-preview';report.hidden=true;
    button('查看本次预设与参数',async()=>{try{const r=await preview(selectedProfile(bank));report.textContent=JSON.stringify(r.info,null,2)+'\n\n'+(r.instructions||'未继承原生提示词，独立提示词为空。');report.hidden=false;}catch(e){status.textContent=e.message;}});
    panel.append(experimental,el('small','独立模块与角色扮演预设分开保存。实验继承仅展开普通宏，不复刻 RP 深度注入或插件脚本。显示思考仅使用接口实际返回的内容。'),report,status);
    if(busy)for(const input of panel.querySelectorAll('input,button,select,textarea'))input.disabled=true;
    if(draft)panel.append(el('small','正文候选的思考只在本次候选预览中显示，不随章节正文保存。'));
}
