import {doNavbarIconClick} from '/script.js';
import {getChatCompletionModel} from '/scripts/openai.js';
import {ROLEPLAY_DRAWERS} from './roleplay-ui.mjs';
import {icon} from './icons.mjs';
import {enhanceNativeSurface,interceptNativeDrawers} from './native-surfaces.mjs';
import {CharacterManager} from './character-manager.mjs';
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const tabs=[['account','连接与用量','fa-comments'],['models','模型与 API 连接','fa-sliders'],['params','通用与生成参数','fa-sliders'],['agent','Agent 预设','fa-folder-open'],['format','提示格式与预设','fa-file-lines'],['world','世界书','fa-book-open'],['appearance','外观与主题','fa-gear'],['background','聊天背景','fa-file-lines'],['extensions','扩展与正则','fa-code-compare'],['persona','用户身份','fa-comments'],['character','角色卡管理','fa-comments']];
const sourceModel={openai:'model_openai_select',deepseek:'model_deepseek_select',claude:'model_claude_select',openrouter:'model_openrouter_select',makersuite:'model_google_select',custom:'custom_model_id'};
export class SettingsDialog{
 constructor(hooks={}){Object.assign(this,hooks);this.ctx??=()=>globalThis.SillyTavern.getContext();this.currentTab='account';this.serial=0;this.buildDOM();}
 get isOpen(){return this.element.open;}
 buildDOM(){
  this.element=el('dialog',undefined,'dw-settings-dialog');this.element.id='dw-settings-modal';this.element.setAttribute('aria-labelledby','dw-settings-title');
  this.element.innerHTML='<header class="dw-settings-header"><div><strong id="dw-settings-title">酒馆设置</strong><span class="dw-settings-subtitle">SillyTavern Desktop 统一控制台</span></div><button type="button" class="dw-settings-close-btn" aria-label="关闭设置面板"></button></header><div class="dw-settings-body"><nav class="dw-settings-nav" aria-label="设置分类" role="tablist"></nav><section class="dw-settings-content" id="dw-settings-content" role="tabpanel" tabindex="0"></section></div><footer class="dw-settings-footer"><span id="dw-settings-status" role="status" aria-live="polite">修改通过原生接口生效</span><button type="button" class="dw-settings-native-btn">完整原生界面</button></footer>';
  this.element.querySelector('.dw-settings-close-btn').append(icon('fa-xmark'));
  for(const [key,title,glyph]of tabs){const b=el('button',undefined,'dw-settings-nav-item');b.type='button';b.dataset.tab=key;b.id='dw-settings-tab-'+key;b.setAttribute('role','tab');b.setAttribute('aria-controls','dw-settings-content');b.append(icon(glyph),el('span',title));b.onclick=()=>void this.run(()=>this.switchTab(key));this.element.querySelector('nav').append(b);}
  this.content=this.element.querySelector('.dw-settings-content');document.body.append(this.element);
  this.element.querySelector('.dw-settings-close-btn').onclick=()=>this.close();
  this.element.querySelector('.dw-settings-native-btn').textContent='完成';
  this.element.querySelector('.dw-settings-native-btn').onclick=()=>this.close();
  this.releaseEntrypoints=interceptNativeDrawers({mapping:ROLEPLAY_DRAWERS,dialog:this});
  this.element.addEventListener('cancel',e=>{e.preventDefault();this.close();});this.element.addEventListener('close',()=>this.cleanup());
  this.element.addEventListener('click',e=>{if(e.target===this.element){const r=this.element.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)this.close();}});
  this.element.querySelector('nav').addEventListener('keydown',e=>{if(!['ArrowDown','ArrowUp','Home','End'].includes(e.key))return;e.preventDefault();const buttons=[...this.element.querySelectorAll('.dw-settings-nav > [role=tab]')],at=buttons.indexOf(document.activeElement),next=e.key==='Home'?0:e.key==='End'?buttons.length-1:(at+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;buttons[next].focus();buttons[next].click();});
 }
 showStatus(text,error=false){const n=this.element.querySelector('#dw-settings-status');n.textContent=text;n.classList.toggle('error',error);}
 async run(work){try{return await work();}catch(error){const text=error.message||'操作未完成，请结束生成或检查连接后重试。';if(this.characterManager)this.characterManager.status(text,true);else this.showStatus(text,true);return false;}}
 async open(tab='account'){
  if(!this.isOpen){this.returnFocus=document.activeElement;this.resumeNative=this.prepareNative?.();this.element.showModal();document.body.classList.add('dw-settings-open');}
  await this.run(()=>tab==='group'?this.showNative('character',++this.serial):this.switchTab(tab));this.element.querySelector('.dw-settings-nav > [aria-selected=true]')?.focus();
 }
 async close(){return this.run(async()=>{if(this.characterManager&&!await this.characterManager.beforeLeave())return false;if(this.isOpen)this.element.close();this.cleanup();return true;});}
 releaseCharacter(){this.characterManager?.dispose();this.characterManager=null;delete this.element.dataset.characterManager;}
 cleanup(){if(!document.body.classList.contains('dw-settings-open'))return;this.serial++;this.releaseCharacter();this.releaseNative();document.body.classList.remove('dw-settings-open');this.content.replaceChildren();const resume=this.resumeNative;this.resumeNative=null;resume?.();const target=this.returnFocus?.isConnected&&this.returnFocus.getClientRects().length?this.returnFocus:document.getElementById('dw-settings-modal-btn');target?.focus();}
 async switchTab(key){
  if(!tabs.some(t=>t[0]===key))key='account';if(this.characterManager&&!await this.characterManager.beforeLeave())return false;this.releaseCharacter();this.currentTab=key;const ticket=++this.serial;this.releaseNative();this.content.replaceChildren();
  for(const b of this.element.querySelectorAll('.dw-settings-nav > [role=tab]')){const active=b.dataset.tab===key;b.classList.toggle('active',active);b.setAttribute('aria-selected',String(active));b.tabIndex=active?0:-1;}
  this.content.setAttribute('aria-labelledby','dw-settings-tab-'+key);this.showStatus(key==='agent'?'Agent 参数与角色扮演相互独立':'修改通过原生控件生效，关闭面板保留已修改值');
  if(key==='account')return this.account();if(key==='models')return this.models(ticket);
  if(key==='params'){if(this.ctx().mainApi==='openai')return this.parameters();return this.showNative('preset',ticket);}
  if(key==='appearance')return this.appearance();
  if(key==='character'){
   this.element.dataset.characterManager='true';
   this.characterManager=new CharacterManager({ctx:this.ctx,busy:this.busy,close:()=>this.close(),openNative:()=>this.showNative('character',++this.serial),status:(text,error)=>this.showStatus(text,error)});
   return this.characterManager.mount(this.content);
  }
  if(key==='agent'){this.content.append(el('h3','Agent 预设与参考'),el('p','每组讨论独立保存预设、思考与参考开关。'));this.action(this.content,'打开当前讨论的预设',()=>{this.close();this.openAgentSettings?.();});return;}
  return this.showNative(key,ticket);
 }
 card(title){const n=el('div',undefined,'dw-settings-card-item');if(title)n.append(el('h3',title));this.content.append(n);return n;}
 appearance(){
  const card=this.card();this.theme?.render(card);
  this.action(this.content,'更多偏好与原有配置',()=>this.showNative('appearance',++this.serial));
 }
 action(parent,text,work){const b=el('button',text,'dw-btn-action');b.type='button';b.onclick=()=>void this.run(work);parent.append(b);return b;}
 field(parent,text,input){const label=el('label',undefined,'dw-field-group');input.setAttribute('aria-label',text);input.disabled=!!this.busy?.();label.append(el('span',text,'dw-field-label'),input);parent.append(label);return input;}
 nativeValue(id,value,event='input'){
  if(this.busy?.())throw Error('busy');const n=document.getElementById(id);if(!n)throw Error('missing control');
  if(n.type==='checkbox')n.checked=!!value;else n.value=value;
  if(n.tagName==='SELECT'&&n.value!==String(value))throw Error('unsupported model');globalThis.jQuery(n).trigger(event);this.showStatus('已应用，正在由酒馆保存…');
 }
 async confirmSaved(fields){
  const c=this.ctx(),script=await import('/script.js');await script.saveSettings();
  // Native saveSettings catches errors; confirm requested fields before displaying success.
  const response=await fetch('/api/settings/get',{method:'POST',headers:c.getRequestHeaders(),body:'{}'});if(!response.ok)throw Error('readback failed');
  const data=await response.json(),stored=typeof data.settings==='string'?JSON.parse(data.settings):data.settings;
  if(!stored||!Object.entries(fields).every(([key,value])=>stored.oai_settings?.[key]===value))throw Error('not persisted');this.showStatus('已确认保存');
 }
 account(){
  const c=this.ctx(),s=c.chatCompletionSettings||{},card=this.card(),row=el('div',undefined,'dw-account-row'),avatar=el('div',undefined,'dw-account-avatar');avatar.append(icon('fa-comments'));const info=el('div',undefined,'dw-account-info');
  info.append(el('strong',c.mainApi==='openai'?s.chat_completion_source:'当前接口：'+c.mainApi),el('small',c.mainApi==='openai'?getChatCompletionModel():'沿用原生模型选择'));row.append(avatar,info,el('span',c.onlineStatus&&c.onlineStatus!=='no_connection'?'已连接':'未连接','dw-account-badge'));card.append(row);
  const metric=this.card('当前工作区最近一轮用量'),usage=this.getUsage?.(),grid=el('div',undefined,'dw-usage-grid');
  for(const [name,value]of [['输入 tokens',usage?.input],['输出 tokens',usage?.output],['缓存命中',usage?.hit]]){const box=el('div',undefined,'dw-usage-box');box.append(el('strong',value==null?'—':value.toLocaleString()),el('small',name));grid.append(box);}metric.append(grid,el('p','仅展示接口实际返回的统计；余额与充值由提供商管理。','dw-field-hint'));this.action(card,'配置连接与模型',()=>this.switchTab('models'));
 }
 async models(ticket){
  const c=this.ctx(),s=c.chatCompletionSettings||{},card=this.card('API 接口提供商'),main=document.getElementById('main_api'),api=el('select',undefined,'text_pole dw-input');for(const o of main?.options||[])api.append(o.cloneNode(true));api.value=main?.value||'';
  this.field(card,'接口类型',api);api.onchange=()=>void this.run(async()=>{this.nativeValue('main_api',api.value,'change');await this.switchTab('models');});
  if(c.mainApi!=='openai'){this.action(card,'打开此接口的完整设置',()=>this.showNative('model',++this.serial));return;}
  const source=document.getElementById('chat_completion_source'),providers=el('select',undefined,'text_pole dw-input');for(const o of source?.options||[])providers.append(o.cloneNode(true));providers.value=s.chat_completion_source;
  this.field(card,'聊天补全提供商',providers);providers.onchange=()=>void this.run(async()=>{this.nativeValue('chat_completion_source',providers.value,'change');await this.switchTab('models');});
  const grid=el('div',undefined,'dw-provider-grid');for(const [value,label]of [['deepseek','DeepSeek 官方'],['openai','OpenAI / 代理'],['custom','自定义兼容接口']]){const b=this.action(grid,label,async()=>{this.nativeValue('chat_completion_source',value,'change');await this.switchTab('models');});b.classList.toggle('active',s.chat_completion_source===value);}card.append(grid);
  const secrets=await import('/scripts/secrets.js');if(ticket!==this.serial||!this.isOpen)return;const secretKey=secrets.SECRET_KEYS[s.chat_completion_source?.toUpperCase()];
  if(secretKey){const key=el('input',undefined,'text_pole dw-input');key.type='password';key.autocomplete='off';key.placeholder=secrets.secret_state?.[secretKey]?'已配置，留空保持原样':'输入新密钥，留空不修改';this.field(card,'API 密钥',key);
   this.action(card,'保存新密钥',async()=>{if(!key.value.trim()){this.showStatus('密钥未修改');return;}if(this.busy?.())throw Error('busy');const id=await secrets.writeSecret(secretKey,key.value.trim());if(!id)throw Error('key not saved');key.value='';key.placeholder='已配置，留空保持原样';this.showStatus('密钥已保存到本地用户配置');});}
  const fields={chat_completion_source:s.chat_completion_source};
  for(const [label,id,prop,type]of [['反向代理端点','openai_reverse_proxy','reverse_proxy','url'],['代理口令','openai_proxy_access_key','proxy_password','password'],...(s.chat_completion_source==='custom'?[['自定义 API 地址','custom_api_url_text','custom_url','url']]:[])]){const input=el('input',undefined,'text_pole dw-input');input.type=type;input.autocomplete='off';input.value=s[prop]||'';this.field(card,label,input);input.onchange=()=>void this.run(()=>{this.nativeValue(id,input.value);fields[prop]=input.value;});}
  const modelId=sourceModel[s.chat_completion_source],original=document.getElementById(modelId);
  if(original){const model=el(original.tagName==='SELECT'?'select':'input',undefined,'text_pole dw-input');if(model.tagName==='SELECT')for(const o of original.options)model.append(o.cloneNode(true));model.value=original.value;this.field(card,'模型标识',model);model.onchange=()=>void this.run(()=>{this.nativeValue(modelId,model.value,model.tagName==='SELECT'?'change':'input');fields[s.chat_completion_source==='makersuite'?'google_model':s.chat_completion_source+'_model']=model.value;});}else card.append(el('p','此提供商的模型和凭据由完整连接面板管理。','dw-field-hint'));
  this.action(card,'确认保存连接设置',()=>this.confirmSaved(fields));this.action(card,'连接 / 刷新模型',()=>{if(this.busy?.())throw Error('busy');document.getElementById('api_button_openai')?.click();this.showStatus('连接结果以酒馆状态为准');});this.action(card,'完整连接选项与密钥管理',()=>this.showNative('model',++this.serial));
 }
 parameters(){
  const card=this.card('上下文与生成参数 · 角色扮演'),s=this.ctx().chatCompletionSettings,fields={};
  for(const [id,prop,label]of [['openai_max_context','openai_max_context','上下文容量'],['openai_max_tokens','openai_max_tokens','最大输出'],['temp_openai','temp_openai','温度']]){const original=document.getElementById(id);if(!original)continue;const row=el('div',undefined,'dw-parameter'),input=el('input',undefined,'text_pole dw-input'),range=el('input',undefined,'dw-slider');input.type='number';range.type='range';for(const n of [input,range]){n.min=original.min;n.max=original.max;n.step=original.step;n.value=s[prop]??original.value;}
   this.field(row,label,input);row.append(range);card.append(row);range.setAttribute('aria-label',label+'滑块');const change=n=>void this.run(()=>{this.nativeValue(id,n.value);input.value=original.value;range.value=original.value;fields[prop]=Number(original.value);});input.onchange=()=>change(input);range.oninput=()=>change(range);}
  const stream=el('input');stream.type='checkbox';stream.checked=!!s.stream_openai;this.field(card,'流式传输',stream);stream.onchange=()=>void this.run(()=>{this.nativeValue('stream_toggle',stream.checked,'change');fields.stream_openai=stream.checked;});card.append(el('p','小说与 Agent 使用各自独立的参数，不会被这里覆盖。','dw-field-hint'));this.action(card,'确认保存参数',()=>this.confirmSaved(fields));this.action(card,'完整生成参数与预设',()=>this.showNative('preset',++this.serial));
 }
 async showNative(key,ticket){
  if(this.characterManager&&!await this.characterManager.beforeLeave())return false;this.releaseCharacter();
  const tab=key==='model'?'models':key==='preset'?'params':key;
  this.currentTab=tab;for(const b of this.element.querySelectorAll('.dw-settings-nav > [role=tab]')){const active=b.dataset.tab===tab;b.classList.toggle('active',active);b.setAttribute('aria-selected',String(active));b.tabIndex=active?0:-1;}
  this.content.setAttribute('aria-labelledby','dw-settings-tab-'+tab);
  this.releaseNative();this.content.replaceChildren();const holder=document.getElementById('top-settings-holder'),drawer=document.getElementById(ROLEPLAY_DRAWERS[key]);if(!holder||!drawer)throw Error('missing native panel');
  const mark=document.createComment('native settings return point');holder.before(mark);this.nativeState={holder,mark,panels:[...holder.querySelectorAll(':scope > .drawer')].map(n=>({node:n,selected:n.hasAttribute('data-dw-settings-active'),panel:n.querySelector(':scope > .drawer-content'),panelClass:n.querySelector(':scope > .drawer-content')?.className,icon:n.querySelector('.drawer-icon'),iconClass:n.querySelector('.drawer-icon')?.className}))};
  const host=el('div',undefined,'dw-settings-native-host');if(key==='character'){const back=this.action(this.content,'返回角色工作台',()=>this.switchTab('character'));back.classList.add('dw-character-return');}this.content.append(host);host.append(holder);for(const item of this.nativeState.panels){item.node.toggleAttribute('data-dw-settings-active',item.node===drawer);if(item.node!==drawer){item.panel?.classList.remove('openDrawer');item.panel?.classList.add('closedDrawer');}}
  this.nativeState.dropdowns=[];for(const select of holder.querySelectorAll('select')){const instance=globalThis.jQuery(select).data('select2');if(instance?.dropdown?.$dropdownParent){this.nativeState.dropdowns.push([select,instance.dropdown,instance.dropdown.$dropdownParent]);instance.dropdown.$dropdownParent=globalThis.jQuery(this.element);}}
  const panel=drawer.querySelector(':scope > .drawer-content');panel?.classList.add('dw-settings-native-panel');
  if(!panel?.classList.contains('openDrawer'))await doNavbarIconClick.call(drawer.querySelector(':scope > .drawer-toggle'));if(ticket!==this.serial||!this.isOpen)return;
  this.nativeState.disposeSurface=enhanceNativeSurface(panel,host);this.showStatus('设置直接读写酒馆配置；可查找字段或跳转分区');
 }
 releaseNative(){const state=this.nativeState;if(!state)return;this.restoringNative=true;this.nativeState=null;state.disposeSurface?.();for(const [select,dropdown,parent]of state.dropdowns||[]){globalThis.jQuery(select).select2('close');dropdown.$dropdownParent=parent;}for(const item of state.panels){item.node.toggleAttribute('data-dw-settings-active',item.selected);if(item.panel)item.panel.className=item.panelClass;if(item.icon)item.icon.className=item.iconClass;}state.mark.replaceWith(state.holder);queueMicrotask(()=>{this.restoringNative=false;});}
 // Compatibility API: observe native state, never probe remote URLs or overwrite onlineStatus.
 performHealthCheck(){if(this.isOpen&&this.currentTab==='account'){this.content.replaceChildren();this.account();}return Promise.resolve(this.ctx().onlineStatus!=='no_connection');}
}
