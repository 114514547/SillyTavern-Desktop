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
    const seconds=ms=>(ms/1000).toFixed(2)+' 秒';
    if(info.performance)summaryText+=' · '+seconds(info.performance.totalMs)+' · 模型 '+info.performance.modelRequests+' 次';
    if(info.usage){
        const u=info.usage;
        if(Number.isFinite(u.hit)&&u.hit>0&&!u.unknownFields?.includes('hit')&&!u.unknownFields?.includes('input')){
            const total=(u.hit||0)+(u.miss||0)||u.input||0;
            const pct=total>0?Math.round((u.hit/total)*100):0;
            summaryText+=' · 缓存命中 '+pct+'% ('+u.hit+'/'+total+')';
        }
    }
    let body='模型：'+(info.source||'未知')+' / '+(info.model||'未知')+'\n参数：'+(info.parameters||'未知')+'\n上下文 / 输出：'+(info.context||'原生')+' / '+(info.output||'原生')+'\n继承的提示词条目：'+(info.entries?.join('、')||'无')+(info.notice?'\n'+info.notice:'');
    if(info.usage){
        const u=info.usage;
        const value=key=>u[key]===undefined?'未知':(u.unknownFields?.includes(key)?'至少 ':'')+u[key];
        body+='\nToken 统计：输入 '+value('input')+'（缓存命中 '+value('hit')+' / 未命中 '+value('miss')+'）· 输出 '+value('output');
        if(u.requests)body+='\n本轮模型请求 '+u.requests+' 次 · 已返回统计 '+u.reportedRequests+' 次'+(u.partial?'；合计不完整，缺失部分未按零计算。':'');
    }
    if(info.performance){
        const p=info.performance;
        body+='\n\n任务耗时：'+seconds(p.totalMs)+'\n模型请求：'+p.modelRequests+' 次 · 累计 '+seconds(p.modelMs)+'\n工具调用：'+p.toolCalls+' 次 · 操作额度 '+p.toolOperations+'/32 · 累计 '+seconds(p.toolMs)+'（并发调用分别计时，包含排队）';
        body+='\n工具分布：'+(Object.entries(p.toolTypes).map(([name,n])=>name+' × '+n).join('、')||'未调用');
        body+='\n文档读取接口：'+p.fileLoads+' 次 · 结果复用 '+p.cacheReuses+' 次 · 重复读取范围 '+p.duplicateReads+' 次\n上下文裁剪：'+p.compactions+' 次';
        body+='\n容量检查：Tokenizer请求 '+p.tokenizerRequests+' 次 · 命中本地计数缓存 '+p.tokenizerCacheHits+' 次 · 保守上界检查 '+p.tokenizerBoundChecks+' 次'+(p.tokenizerEstimated?' · Tokenizer不可用后按UTF-8字节保守估算':'');
        body+='\n容量检查采用本地GPT估算并预留安全余量；Token用量与缓存命中仅采用接口返回值。';
        if(!info.usage)body+='\nToken 统计：输入 未知 · 缓存命中 未知 · 输出 未知（接口未提供）';
    }
    d.append(el('summary',summaryText),el('pre',body));
    return d;
}
export function renderAssistantSettings(parent,{bank,change,busy=false,draft=false,edit}) {
    const panel=el('section');panel.className='dw-assistant-summary';
    const label=el('label'),select=el('select');select.setAttribute('aria-label',draft?'正文写作预设':'小说讨论预设');
    for(const [i,p]of bank.presets.entries()){const option=el('option',p.name);option.value=i;select.append(option);}select.value=bank.selected;select.disabled=busy;
    select.onchange=()=>{bank.selected=Number(select.value);change();};label.append(el('span','当前预设'),select);
    const open=el('button','编辑预设与参考');open.type='button';open.onclick=()=>void edit?.();
    panel.append(label,open,el('small','在统一创作配置中编辑提示模块、参数与参考范围。'));parent.append(panel);
}
