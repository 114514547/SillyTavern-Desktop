import {readUIPreference, writeUIPreference} from './ui-preferences.mjs';

export const THEME_DEFAULTS = Object.freeze({
    version: 2, name: '曜黑 · 香槟金',
    colors: Object.freeze({base:'#0e0e11', panel:'#141418', card:'#1c1c24', hover:'#262632', input:'#121216', border:'#282834', accent:'#c9a76b', text:'#e9e9ef', muted:'#adb0bf'}),
    font:'system', fontSize:15, proseSize:17, radius:10, blur:20, density:'comfortable', motion:true, legacyCss:false,
});
const colorTokens = {base:'bg-base',panel:'bg-panel',card:'bg-card',hover:'bg-hover',input:'bg-input',border:'border',accent:'accent-gold',text:'text-main',muted:'text-muted'};
const fonts = {system:'-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif',serif:'"Noto Serif SC","Songti SC",SimSun,serif',mono:'Consolas,"Cascadia Code","Microsoft YaHei",monospace'};
const own = (object,key) => Object.hasOwn(object,key);
export function validateTheme(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || ![1,2].includes(value.version)) throw Error('主题格式或版本不受支持。');
    if (Object.keys(value).some(key=>!own(THEME_DEFAULTS,key))) throw Error('主题包含不支持的设置。');
    const result=structuredClone(THEME_DEFAULTS);
    if (typeof value.name!=='string' || !value.name.trim() || value.name.length>60) throw Error('主题名称须为 1–60 个字符。');
    result.name=value.name.trim();
    if (!value.colors || typeof value.colors!=='object' || Array.isArray(value.colors) || Object.keys(value.colors).some(key=>!own(colorTokens,key))) throw Error('主题颜色字段无效。');
    for (const key of Object.keys(colorTokens)) {
        if (typeof value.colors[key]!=='string' || !/^#[0-9a-f]{6}$/i.test(value.colors[key])) throw Error('颜色须为六位十六进制色值。');
        result.colors[key]=value.colors[key].toLowerCase();
    }
    for (const [key,min,max] of [['fontSize',12,20],['proseSize',14,26],['radius',4,18],['blur',0,24]]) {
        if (!Number.isInteger(value[key]) || value[key]<min || value[key]>max) throw Error('主题尺寸超出支持范围。');
        result[key]=value[key];
    }
    // Upgrade only the old baseline values; keep custom typography and colors.
    if(value.version===1){if(value.fontSize===13)result.fontSize=15;if(value.proseSize===15)result.proseSize=17;if(result.colors.text==='#e2e2e8')result.colors.text=THEME_DEFAULTS.colors.text;if(result.colors.muted==='#8b8b9a')result.colors.muted=THEME_DEFAULTS.colors.muted;}
    if (typeof value.font!=='string' || !own(fonts,value.font) || !['comfortable','compact'].includes(value.density) || typeof value.motion!=='boolean' || (value.legacyCss!==undefined&&typeof value.legacyCss!=='boolean')) throw Error('主题排版或动效设置无效。');
    result.font=value.font;result.density=value.density;result.motion=value.motion;result.legacyCss=value.legacyCss??false;
    return result;
}
export class DesktopTheme {
    constructor() {
        try {const stored=readUIPreference('theme',THEME_DEFAULTS);this.value=validateTheme(stored);if(stored.version===1)writeUIPreference('theme',this.value);}
        catch {this.value=structuredClone(THEME_DEFAULTS);}
        this.apply();
        this.legacyObserver=new MutationObserver(records=>{if(records.some(r=>[...r.addedNodes].some(n=>n.id==='custom-style')))this.applyLegacyCSS();});
        this.legacyObserver.observe(document.head,{childList:true});
    }
    applyLegacyCSS(){
        const style=document.getElementById('custom-style');if(!style)return;
        if(!Object.hasOwn(style.dataset,'desktopOriginalMedia'))style.dataset.desktopOriginalMedia=style.getAttribute('media')||'';
        style.media=this.value.legacyCss?style.dataset.desktopOriginalMedia:'not all';
    }
    apply() {
        const root=document.documentElement,t=this.value;
        for(const [key,token] of Object.entries(colorTokens)) root.style.setProperty('--dw-'+token,t.colors[key]);
        for(const [key,value] of Object.entries({font:fonts[t.font],'ui-size':t.fontSize+'px','prose-size':t.proseSize+'px',radius:t.radius+'px',blur:t.blur+'px','control-height':Math.max(28,t.fontSize+(t.density==='compact'?12:18))+'px','text-dim':`color-mix(in srgb,${t.colors.muted} 88%,${t.colors.base})`})) root.style.setProperty('--dw-'+key,value);
        root.dataset.dwMotion=String(t.motion);root.dataset.dwDensity=t.density;
        this.applyLegacyCSS();
        for(const control of this.fontControls||[]){if(control.isConnected)control.refresh();else this.fontControls.delete(control);}
        for(const input of document.querySelectorAll('[data-dw-theme-field]'))if(input!==document.activeElement)input.value=t[input.dataset.dwThemeField];
        document.dispatchEvent(new CustomEvent('desktop-theme-changed'));
    }
    update(value) {this.value=validateTheme(value);this.apply();writeUIPreference('theme',this.value);}
    renderFontControls(parent){
        const group=document.createElement('div');group.className='dw-font-controls';group.setAttribute('role','group');group.setAttribute('aria-label','字体大小');
        const action=(text,label,work)=>{const b=document.createElement('button');b.type='button';b.textContent=text;b.title=label;b.setAttribute('aria-label',label);b.onclick=work;group.append(b);return b;};
        const adjust=delta=>this.update({...this.value,fontSize:Math.max(12,Math.min(20,this.value.fontSize+delta)),proseSize:Math.max(14,Math.min(26,this.value.proseSize+delta))});
        const smaller=action('A−','减小界面与阅读字号',()=>adjust(-1)),reset=action('','恢复默认字号：界面15，阅读17',()=>this.update({...this.value,fontSize:15,proseSize:17})),larger=action('A+','增大界面与阅读字号',()=>adjust(1));
        group.refresh=()=>{reset.textContent=String(this.value.fontSize);reset.title=`界面 ${this.value.fontSize}px · 阅读 ${this.value.proseSize}px；点击恢复默认`;smaller.disabled=this.value.fontSize===12&&this.value.proseSize===14;larger.disabled=this.value.fontSize===20&&this.value.proseSize===26;};group.refresh();parent.append(group);this.fontControls??=new Set();this.fontControls.add(group);return group;
    }
    render(parent) {
        const make=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
        parent.append(make('h3','外观与主题'),make('p','主题统一应用于角色扮演、小说和本地工作区。原生主题文件与配置继续保留。','dw-field-hint'));
        const status=make('p','','dw-theme-status');status.setAttribute('role','status');
        const edit=(key,value)=>{try{const next=structuredClone(this.value);if(key.startsWith('colors.'))next.colors[key.slice(7)]=value;else next[key]=value;this.update(next);status.textContent='已应用；由当前酒馆配置保存。';}catch(error){status.textContent=error.message;}};
        const choices=make('div',undefined,'dw-theme-choices');
        for(const [name,color]of [['曜黑 · 香槟金','#c9a76b'],['曜黑 · 灰绿','#8fb8a7'],['曜黑 · 雾蓝','#91a9cd']]){const b=make('button',undefined,'dw-theme-choice'),swatch=make('span');b.type='button';swatch.style.backgroundColor=color;b.append(swatch,make('strong',name));b.setAttribute('aria-pressed',String(this.value.colors.accent===color));b.onclick=()=>{this.update({...this.value,name,colors:{...this.value.colors,accent:color}});parent.replaceChildren();this.render(parent);};choices.append(b);}parent.append(choices);
        const grid=make('div',undefined,'dw-theme-grid');
        const field=(label,input)=>{const row=make('label',undefined,'dw-field-group');row.append(make('span',label),input);grid.append(row);};
        const name=make('input');name.value=this.value.name;name.maxLength=60;name.onchange=()=>edit('name',name.value);field('主题名称',name);
        const custom=make('details',undefined,'dw-theme-custom'),colors=make('div',undefined,'dw-theme-grid');custom.append(make('summary','自定义主题颜色'),colors);
        for(const [key,label] of [['base','主背景'],['panel','面板'],['card','卡片'],['hover','悬停'],['input','输入区'],['border','边框'],['accent','强调色'],['text','正文文字'],['muted','次要文字']]) {
            const input=make('input');input.type='color';input.value=this.value.colors[key];input.oninput=()=>edit('colors.'+key,input.value);const row=make('label',undefined,'dw-field-group');row.append(make('span',label),input);colors.append(row);
        }
        for(const [key,label,options]of [['font','界面字体',[['system','系统字体'],['serif','衬线字体'],['mono','等宽字体']]],['density','界面密度',[['comfortable','舒适'],['compact','紧凑']]]]) {
            const select=make('select');for(const [value,text]of options){const o=make('option',text);o.value=value;select.append(o);}select.value=this.value[key];select.onchange=()=>edit(key,select.value);field(label,select);
        }
        for(const [key,label,min,max]of [['fontSize','界面字号',12,20],['proseSize','阅读字号',14,26],['radius','面板圆角',4,18],['blur','材质模糊',0,24]]) {
            const input=make('input');input.type='number';input.min=min;input.max=max;input.value=this.value[key];input.dataset.dwThemeField=key;input.onchange=()=>edit(key,Number(input.value));field(label,input);
        }
        const motion=make('input');motion.type='checkbox';motion.checked=this.value.motion;motion.onchange=()=>edit('motion',motion.checked);field('界面动效（遵循系统减少动效设置）',motion);
        const legacy=make('input');legacy.type='checkbox';legacy.checked=this.value.legacyCss;legacy.onchange=()=>edit('legacyCss',legacy.checked);field('兼容原生自定义 CSS（可能改变布局）',legacy);
        const layout=make('div',undefined,'dw-theme-editor-layout'),form=make('section'),preview=make('aside',undefined,'dw-theme-preview');form.append(grid,custom);preview.append(make('small','当前排版预览'),make('h4','让阅读回到内容本身'),make('p','主题会同步应用到角色扮演、小说与本地工作区。调整字体、字号和密度时，可在这里直接查看阅读效果。'),make('blockquote','清楚的层级，适当的留白，随时可找到的操作。'));layout.append(form,preview);parent.append(layout);
        const tools=make('div',undefined,'dw-theme-tools');
        const action=(text,run)=>{const b=make('button',text,'dw-btn-action');b.type='button';b.onclick=run;tools.append(b);};
        action('导出主题',()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(this.value,null,2)],{type:'application/json'}));const a=make('a');a.href=url;a.download='desktop-theme.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
        const file=make('input');file.type='file';file.accept='.json,application/json';file.hidden=true;
        file.onchange=async()=>{const f=file.files[0];if(!f)return;try{if(f.size>65536)throw Error('主题文件不能超过 64 KB。');const value=validateTheme(JSON.parse(await f.text()));this.update(value);parent.replaceChildren();this.render(parent);}catch(error){status.textContent=error.message;}finally{file.value='';}};
        action('导入主题',()=>file.click());action('恢复黑金主题',()=>{this.update(THEME_DEFAULTS);parent.replaceChildren();this.render(parent);});
        parent.append(tools,file,status);
    }
}
