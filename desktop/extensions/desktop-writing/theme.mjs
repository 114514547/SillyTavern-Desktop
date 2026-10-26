import {readUIPreference, writeUIPreference} from './ui-preferences.mjs';

export const THEME_DEFAULTS = Object.freeze({
    version: 1, name: '曜黑 · 香槟金',
    colors: Object.freeze({base:'#0e0e11', panel:'#141418', card:'#1c1c24', hover:'#262632', input:'#121216', border:'#282834', accent:'#c9a76b', text:'#e2e2e8', muted:'#8b8b9a'}),
    font:'system', fontSize:13, proseSize:15, radius:10, blur:20, density:'comfortable', motion:true, legacyCss:false,
});
const colorTokens = {base:'bg-base',panel:'bg-panel',card:'bg-card',hover:'bg-hover',input:'bg-input',border:'border',accent:'accent-gold',text:'text-main',muted:'text-muted'};
const fonts = {system:'-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif',serif:'"Noto Serif SC","Songti SC",SimSun,serif',mono:'Consolas,"Cascadia Code","Microsoft YaHei",monospace'};
const own = (object,key) => Object.hasOwn(object,key);
export function validateTheme(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1) throw Error('主题格式或版本不受支持。');
    if (Object.keys(value).some(key=>!own(THEME_DEFAULTS,key))) throw Error('主题包含不支持的设置。');
    const result=structuredClone(THEME_DEFAULTS);
    if (typeof value.name!=='string' || !value.name.trim() || value.name.length>60) throw Error('主题名称须为 1–60 个字符。');
    result.name=value.name.trim();
    if (!value.colors || typeof value.colors!=='object' || Array.isArray(value.colors) || Object.keys(value.colors).some(key=>!own(colorTokens,key))) throw Error('主题颜色字段无效。');
    for (const key of Object.keys(colorTokens)) {
        if (typeof value.colors[key]!=='string' || !/^#[0-9a-f]{6}$/i.test(value.colors[key])) throw Error('颜色须为六位十六进制色值。');
        result.colors[key]=value.colors[key].toLowerCase();
    }
    for (const [key,min,max] of [['fontSize',12,16],['proseSize',14,22],['radius',4,18],['blur',0,24]]) {
        if (!Number.isInteger(value[key]) || value[key]<min || value[key]>max) throw Error('主题尺寸超出支持范围。');
        result[key]=value[key];
    }
    if (typeof value.font!=='string' || !own(fonts,value.font) || !['comfortable','compact'].includes(value.density) || typeof value.motion!=='boolean' || (value.legacyCss!==undefined&&typeof value.legacyCss!=='boolean')) throw Error('主题排版或动效设置无效。');
    result.font=value.font;result.density=value.density;result.motion=value.motion;result.legacyCss=value.legacyCss??false;
    return result;
}
export class DesktopTheme {
    constructor() {
        try {this.value=validateTheme(readUIPreference('theme',THEME_DEFAULTS));}
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
        for(const [key,value] of Object.entries({font:fonts[t.font],'ui-size':t.fontSize+'px','prose-size':t.proseSize+'px',radius:t.radius+'px',blur:t.blur+'px','control-height':t.density==='compact'?'28px':'32px'})) root.style.setProperty('--dw-'+key,value);
        root.dataset.dwMotion=String(t.motion);root.dataset.dwDensity=t.density;
        this.applyLegacyCSS();
        document.dispatchEvent(new CustomEvent('desktop-theme-changed'));
    }
    update(value) {this.value=validateTheme(value);this.apply();writeUIPreference('theme',this.value);}
    render(parent) {
        const make=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
        parent.append(make('h3','外观与主题'),make('p','主题统一应用于角色扮演、小说和本地工作区。原生主题文件与配置继续保留。','dw-field-hint'));
        const status=make('p','','dw-theme-status');status.setAttribute('role','status');
        const edit=(key,value)=>{try{const next=structuredClone(this.value);if(key.startsWith('colors.'))next.colors[key.slice(7)]=value;else next[key]=value;this.update(next);status.textContent='已应用；由当前酒馆配置保存。';}catch(error){status.textContent=error.message;}};
        const grid=make('div',undefined,'dw-theme-grid');
        const field=(label,input)=>{const row=make('label',undefined,'dw-field-group');row.append(make('span',label),input);grid.append(row);};
        const name=make('input');name.value=this.value.name;name.maxLength=60;name.onchange=()=>edit('name',name.value);field('主题名称',name);
        for(const [key,label] of [['base','主背景'],['panel','面板'],['card','卡片'],['hover','悬停'],['input','输入区'],['border','边框'],['accent','强调色'],['text','正文文字'],['muted','次要文字']]) {
            const input=make('input');input.type='color';input.value=this.value.colors[key];input.oninput=()=>edit('colors.'+key,input.value);field(label,input);
        }
        for(const [key,label,options]of [['font','界面字体',[['system','系统字体'],['serif','衬线字体'],['mono','等宽字体']]],['density','界面密度',[['comfortable','舒适'],['compact','紧凑']]]]) {
            const select=make('select');for(const [value,text]of options){const o=make('option',text);o.value=value;select.append(o);}select.value=this.value[key];select.onchange=()=>edit(key,select.value);field(label,select);
        }
        for(const [key,label,min,max]of [['fontSize','界面字号',12,16],['proseSize','阅读字号',14,22],['radius','面板圆角',4,18],['blur','材质模糊',0,24]]) {
            const input=make('input');input.type='number';input.min=min;input.max=max;input.value=this.value[key];input.onchange=()=>edit(key,Number(input.value));field(label,input);
        }
        const motion=make('input');motion.type='checkbox';motion.checked=this.value.motion;motion.onchange=()=>edit('motion',motion.checked);field('界面动效（遵循系统减少动效设置）',motion);
        const legacy=make('input');legacy.type='checkbox';legacy.checked=this.value.legacyCss;legacy.onchange=()=>edit('legacyCss',legacy.checked);field('兼容原生自定义 CSS（可能改变布局）',legacy);
        parent.append(grid);
        const tools=make('div',undefined,'dw-theme-tools');
        const action=(text,run)=>{const b=make('button',text,'dw-btn-action');b.type='button';b.onclick=run;tools.append(b);};
        action('导出主题',()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(this.value,null,2)],{type:'application/json'}));const a=make('a');a.href=url;a.download='desktop-theme.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
        const file=make('input');file.type='file';file.accept='.json,application/json';file.hidden=true;
        file.onchange=async()=>{const f=file.files[0];if(!f)return;try{if(f.size>65536)throw Error('主题文件不能超过 64 KB。');const value=validateTheme(JSON.parse(await f.text()));this.update(value);parent.replaceChildren();this.render(parent);}catch(error){status.textContent=error.message;}finally{file.value='';}};
        action('导入主题',()=>file.click());action('恢复黑金主题',()=>{this.update(THEME_DEFAULTS);parent.replaceChildren();this.render(parent);});
        parent.append(tools,file,status);
    }
}
