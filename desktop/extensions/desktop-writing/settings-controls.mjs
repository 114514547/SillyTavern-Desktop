export const element=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
export function settingsButton(text,work,cls=''){
    const b=element('button',text,'sc-button '+cls);b.type='button';b.onclick=work;return b;
}
export function settingsField(text,value,change,{area=false,type='text',options,min,max,step,maxLength,rows=6,hint,disabled=false}={}){
    const label=element('label',undefined,'sc-field'),input=element(options?'select':area?'textarea':'input');
    label.append(element('span',text));input.setAttribute('aria-label',text);
    if(options)for(const option of options){const [v,t]=Array.isArray(option)?option:[option,option],o=element('option',t);o.value=v;input.append(o);}
    else if(area)input.rows=rows;else input.type=type;
    for(const [key,v]of Object.entries({min,max,step,maxLength}))if(v!==undefined)input[key]=v;
    input.value=value??'';input.disabled=disabled;
    input.addEventListener(options?'change':area?'input':'change',()=>change(type==='number'?Number(input.value):input.value,input));
    label.append(input);if(hint)label.append(element('small',hint,'sc-hint'));return label;
}
export function settingsToggle(text,hint,value,change,disabled=false){
    const label=element('label',undefined,'sc-toggle'),copy=element('span'),input=element('input');
    copy.append(element('strong',text));if(hint)copy.append(element('small',hint));input.type='checkbox';input.checked=!!value;input.disabled=disabled;input.setAttribute('aria-label',text);input.onchange=()=>change(input.checked);label.append(copy,input);return label;
}
export function settingsTabs(items,selected,change){
    const nav=element('nav',undefined,'sc-tabs');nav.setAttribute('role','tablist');
    for(const [id,text]of items){const b=settingsButton(text,()=>change(id));b.dataset.tab=id;b.setAttribute('role','tab');b.setAttribute('aria-selected',String(id===selected));b.tabIndex=id===selected?0:-1;nav.append(b);}
    nav.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;const all=[...nav.children],at=all.indexOf(document.activeElement);if(at<0)return;e.preventDefault();const surface=nav.closest('.dw-settings-page-body'),next=all[e.key==='Home'?0:e.key==='End'?all.length-1:(at+(e.key==='ArrowRight'?1:all.length-1))%all.length];next.click();surface?.querySelector(`.sc-tabs [data-tab="${next.dataset.tab}"]`)?.focus();};return nav;
}
export function settingsCard(title,...children){const card=element('section',undefined,'sc-card');if(title)card.append(element('h3',title));card.append(...children);return card;}
export function settingsGrid(...children){const grid=element('div',undefined,'sc-grid');grid.append(...children);return grid;}
