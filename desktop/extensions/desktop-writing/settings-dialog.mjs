import {doNavbarIconClick} from '/script.js';
import {getChatCompletionModel} from '/scripts/openai.js';
import {ConnectionSettingsWorkspace} from './connection-settings.mjs';
import {WorldWorkspace} from './world-workspace.mjs';
import {PresetWorkspace} from './preset-workspace.mjs';
import {showWorldEditor} from '/scripts/world-info.js';

import {ROLEPLAY_DRAWERS} from './roleplay-ui.mjs';
import {icon} from './icons.mjs';
import {enhanceNativeSurface,interceptNativeDrawers} from './native-surfaces.mjs';
import {CharacterManager} from './character-manager.mjs';
import {AgentSettingsWorkspace} from './agent-settings-ui.mjs';
import {PersonaSettingsWorkspace} from './persona-settings.mjs';
import {settingsTabs} from './settings-controls.mjs';
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const tabs=[['account','连接与用量','fa-comments'],['models','模型与 API 连接','fa-sliders'],['params','通用与生成参数','fa-sliders'],['agent','创作预设','fa-folder-open'],['format','提示格式与预设','fa-file-lines'],['world','世界书','fa-book-open'],['persona','用户身份','fa-comments'],['character','角色卡管理','fa-comments'],['appearance','外观与主题','fa-gear'],['background','聊天背景','fa-file-lines'],['extensions','扩展与正则','fa-code-compare']];
const pageHints={account:'连接状态与接口实际返回的用量。',models:'集中管理提供商、端点、密钥与模型。',params:'常用参数优先，采样细节按需调整；仅影响角色扮演。',agent:'统一编辑 Agent、小说讨论与正文写作的独立预设。',format:'选择模板后直接编辑，原生宏与格式规则保持生效。',world:'在同一工作区选择世界书、查找条目并编辑规则。',persona:'身份资料与当前使用的身份分开选择。',character:'集中管理人物设定、开场白与卡片资料。',appearance:'统一角色扮演、小说与本地工作区的外观。',background:'选择背景并管理分组，调整对话中的展示方式。',extensions:'按扩展选择功能，正则与其他配置各自独立展示。'};
export class SettingsDialog{
 constructor(hooks={}){Object.assign(this,hooks);this.ctx??=()=>globalThis.SillyTavern.getContext();this.currentTab='account';this.serial=0;this.buildDOM();}
 get isOpen(){return this.element.open;}
 buildDOM(){
  this.element=el('dialog',undefined,'dw-settings-dialog');this.element.id='dw-settings-modal';this.element.setAttribute('aria-labelledby','dw-settings-title');
  this.element.innerHTML='<header class="dw-settings-header"><div><strong id="dw-settings-title">酒馆设置</strong><span class="dw-settings-subtitle">SillyTavern Desktop</span></div><div class="dw-settings-header-tools"><button type="button" class="dw-settings-back" hidden>返回设置分类</button><label class="dw-settings-search"><input type="search" placeholder="查找设置分类…" aria-label="查找设置分类"><kbd>Ctrl K</kbd></label><button type="button" class="dw-settings-close-btn" aria-label="关闭设置面板"></button></div></header><div class="dw-settings-body"><nav class="dw-settings-nav" aria-label="设置分类" role="tablist"></nav><section class="dw-settings-content" id="dw-settings-content" role="tabpanel" tabindex="0"><header class="dw-settings-page-heading"><div><small></small><h2></h2><p></p></div></header><div class="dw-settings-page-body"></div></section></div><footer class="dw-settings-footer"><span id="dw-settings-status" role="status" aria-live="polite">修改通过原生接口生效</span><div class="dw-settings-footer-actions"><button type="button" class="dw-settings-save">保存当前设置</button><button type="button" class="dw-settings-native-btn">完成</button></div></footer>';
  this.element.querySelector('.dw-settings-back').onclick=()=>void this.run(()=>this.switchTab('account'));
  this.element.querySelector('.dw-settings-close-btn').append(icon('fa-xmark'));
  const fontTools=this.theme?.renderFontControls(this.element.querySelector('.dw-settings-header-tools'));if(fontTools)this.element.querySelector('.dw-settings-header-tools').insertBefore(fontTools,this.element.querySelector('.dw-settings-search'));
  for(const [key,title,glyph]of tabs){if(['account','agent','appearance'].includes(key))this.element.querySelector('nav').append(el('div',key==='account'?'连接与生成':key==='agent'?'创作与资料':'界面与工具','dw-settings-nav-group'));const b=el('button',undefined,'dw-settings-nav-item');b.type='button';b.dataset.tab=key;b.id='dw-settings-tab-'+key;b.setAttribute('role','tab');b.setAttribute('aria-controls','dw-settings-content');b.append(icon(glyph),el('span',title));b.onclick=()=>void this.run(()=>this.switchTab(key));this.element.querySelector('nav').append(b);}
  this.panel=this.element.querySelector('.dw-settings-content');this.content=this.element.querySelector('.dw-settings-page-body');document.body.append(this.element);
  const search=this.element.querySelector('.dw-settings-search input');search.oninput=()=>{const q=search.value.trim().toLocaleLowerCase();for(const b of this.element.querySelectorAll('.dw-settings-nav-item'))b.hidden=!!q&&![b.textContent,pageHints[b.dataset.tab]].join(' ').toLocaleLowerCase().includes(q);for(const group of this.element.querySelectorAll('.dw-settings-nav-group'))group.hidden=!!q;};search.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();this.element.querySelector('.dw-settings-nav-item:not([hidden])')?.click();}else if(e.key==='Escape'&&search.value){e.preventDefault();e.stopPropagation();search.value='';search.dispatchEvent(new Event('input'));}};
  this.element.querySelector('.dw-settings-close-btn').onclick=()=>this.close();
  this.element.querySelector('.dw-settings-native-btn').textContent='完成';
  this.element.querySelector('.dw-settings-native-btn').onclick=()=>this.close();
  this.element.querySelector('.dw-settings-save').onclick=()=>void this.run(()=>this.saveCurrent());
  this.releaseEntrypoints=interceptNativeDrawers({mapping:ROLEPLAY_DRAWERS,dialog:this});
  this.element.addEventListener('cancel',e=>{e.preventDefault();this.close();});this.element.addEventListener('close',()=>this.cleanup());
  this.element.addEventListener('click',e=>{if(e.target===this.element){const r=this.element.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)this.close();}});
  this.element.querySelector('nav').addEventListener('keydown',e=>{if(!['ArrowDown','ArrowUp','Home','End'].includes(e.key))return;e.preventDefault();const buttons=[...this.element.querySelectorAll('.dw-settings-nav > [role=tab]:not([hidden])')];if(!buttons.length)return;const at=buttons.indexOf(document.activeElement),next=e.key==='Home'?0:e.key==='End'?buttons.length-1:(at+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;buttons[next].focus();buttons[next].click();});
  this.element.addEventListener('keydown',e=>{if(!(e.ctrlKey||e.metaKey)||e.isComposing)return;if(e.key.toLowerCase()==='k'){e.preventDefault();search.focus();search.select();}if(e.key.toLowerCase()==='s'){e.preventDefault();void this.run(()=>this.saveCurrent());}});
 }
 showStatus(text,error=false){const n=this.element.querySelector('#dw-settings-status');n.textContent=text;n.classList.toggle('error',error);}
 async run(work){try{return await work();}catch(error){const text=error.message||'操作未完成，请结束生成或检查连接后重试。';if(this.characterManager)this.characterManager.status(text,true);else this.showStatus(text,true);return false;}}
 async open(tab='account'){
  if(!this.isOpen){this.returnFocus=document.activeElement;this.resumeNative=this.prepareNative?.();this.element.showModal();document.body.classList.add('dw-settings-open');}
  await this.run(()=>tab==='group'?this.showNative('character',++this.serial):this.switchTab(tab));this.element.querySelector('.dw-settings-nav > [aria-selected=true]')?.focus();
 }
 async beforeLeave(){if(this.worldWorkspace&&!await this.worldWorkspace.beforeLeave())return false;if(this.presetWorkspace&&!await this.presetWorkspace.beforeLeave())return false;if(this.characterManager&&!await this.characterManager.beforeLeave())return false;if(this.personaWorkspace&&!await this.personaWorkspace.beforeLeave())return false;if(this.connectionWorkspace&&!await this.connectionWorkspace.beforeLeave())return false;if(this.agentWorkspace&&!await this.agentWorkspace.beforeLeave())return false;return true;}
 async openCreative(scope='agent'){await this.open('agent');if(this.agentWorkspace){this.agentWorkspace.scope=scope;this.agentWorkspace.tab='modules';this.agentWorkspace.moduleId=null;this.agentWorkspace.render();}}
 async close(){return this.run(async()=>{if(!await this.beforeLeave())return false;if(this.isOpen)this.element.close();this.cleanup();return true;});}
 async saveCurrent(){if(this.worldWorkspace)return this.worldWorkspace.save();if(this.presetWorkspace)return this.presetWorkspace.save();if(this.element.contains(document.activeElement))document.activeElement.blur();if(this.characterManager)return this.characterManager.save();if(this.personaWorkspace)return this.personaWorkspace.save();if(this.connectionWorkspace)return this.connectionWorkspace.save();if(this.agentWorkspace)return this.agentWorkspace.save();const script=await import('/script.js');await script.saveSettings();this.showStatus('已提交当前配置；修改通过酒馆保存');}
 releaseWorkspaces(){this.worldWorkspace?.dispose();this.worldWorkspace=null;this.presetWorkspace?.dispose();this.presetWorkspace=null;this.connectionWorkspace?.dispose();this.connectionWorkspace=null;this.agentWorkspace?.dispose();this.agentWorkspace=null;this.personaWorkspace?.dispose();this.personaWorkspace=null;}
 releaseCharacter(){this.characterManager?.dispose();this.characterManager=null;}
 cleanup(){if(!document.body.classList.contains('dw-settings-open'))return;this.serial++;this.releaseCharacter();this.releaseWorkspaces();this.releaseNative();document.body.classList.remove('dw-settings-open');this.content.replaceChildren();const resume=this.resumeNative;this.resumeNative=null;resume?.();const target=this.returnFocus?.isConnected&&this.returnFocus.getClientRects().length?this.returnFocus:document.getElementById('dw-settings-modal-btn');target?.focus();}
 async switchTab(key){
  if(!tabs.some(t=>t[0]===key))key='account';if(!await this.beforeLeave())return false;this.releaseCharacter();this.releaseWorkspaces();this.currentTab=key;const ticket=++this.serial;this.releaseNative();this.content.replaceChildren();this.setPage(key);
  for(const b of this.element.querySelectorAll('.dw-settings-nav > [role=tab]')){const active=b.dataset.tab===key;b.classList.toggle('active',active);b.setAttribute('aria-selected',String(active));b.tabIndex=active?0:-1;}
  this.panel.setAttribute('aria-labelledby','dw-settings-tab-'+key);this.showStatus(key==='agent'?'预设与参考按讨论独立保存':'原生选项自动生效；角色卡与身份资料编辑后点击保存');
  if(key==='account')return this.account();if(key==='models')return this.models(ticket);
  if(key==='params'||key==='format'){this.presetWorkspace=new PresetWorkspace({ctx:this.ctx,busy:this.busy,status:(text,error)=>this.showStatus(text,error),format:key==='format',openNative:()=>this.showNative(key==='format'?'format':'preset',++this.serial)});return this.presetWorkspace.mount(this.content);}
  if(key==='world'){this.worldWorkspace=new WorldWorkspace({ctx:this.ctx,busy:this.busy,status:(text,error)=>this.showStatus(text,error),openNative:async()=>{const name=this.worldWorkspace.name;await this.showNative('world',++this.serial);if(name&&this.isOpen)await showWorldEditor(name);}});return this.worldWorkspace.mount(this.content);}
  if(key==='appearance')return this.appearance();
  if(key==='character'){
   this.characterManager=new CharacterManager({ctx:this.ctx,busy:this.busy,close:()=>this.close(),openNative:()=>this.showNative('character',++this.serial),openWorld:()=>this.switchTab('world'),status:(text,error)=>this.showStatus(text,error)});
   return this.characterManager.mount(this.content);
  }
  if(key==='agent'){const agent=this.getAgent?.();if(!agent)throw Error('本地工作区尚未准备完成，请稍后重试。');this.agentWorkspace=new AgentSettingsWorkspace({agent,writing:this.getWritingSettings?.(),status:(text,error)=>this.showStatus(text,error),busy:this.busy});this.agentWorkspace.mount(this.content);return;}
  if(key==='persona'){this.personaWorkspace=new PersonaSettingsWorkspace({ctx:this.ctx,busy:this.busy,status:(text,error)=>this.showStatus(text,error),openNative:()=>this.showNative('persona',++this.serial)});return this.personaWorkspace.mount(this.content);}
  return this.showNative(key,ticket);
 }
 setPage(key,native=false){this.element.querySelector('.dw-settings-back').hidden=key!=='character';this.element.dataset.page=key;this.element.dataset.native=String(native);const heading=this.element.querySelector('.dw-settings-page-heading');heading.querySelector('small').textContent=['account','models','params'].includes(key)?'连接与生成':['agent','format','world','persona','character'].includes(key)?'创作与资料':'界面与工具';heading.querySelector('h2').textContent=tabs.find(t=>t[0]===key)?.[1]||'酒馆设置';heading.querySelector('p').textContent=pageHints[key]||'';}
 card(title){const n=el('div',undefined,'dw-settings-card-item');if(title)n.append(el('h3',title));this.content.append(n);return n;}
 appearance(){
  const card=this.card();this.theme?.render(card);
  this.action(this.content,'更多偏好与原有配置',()=>this.showNative('appearance',++this.serial));
 }
 action(parent,text,work){const b=el('button',text,'dw-btn-action');b.type='button';b.onclick=()=>void this.run(work);parent.append(b);return b;}
 account(){
  const c=this.ctx(),s=c.chatCompletionSettings||{},card=this.card(),row=el('div',undefined,'dw-account-row'),avatar=el('div',undefined,'dw-account-avatar');avatar.append(icon('fa-comments'));const info=el('div',undefined,'dw-account-info');
  info.append(el('strong',c.mainApi==='openai'?s.chat_completion_source:'当前接口：'+c.mainApi),el('small',c.mainApi==='openai'?getChatCompletionModel():'沿用原生模型选择'));row.append(avatar,info,el('span',c.onlineStatus&&c.onlineStatus!=='no_connection'?(c.onlineStatus.includes('尚未验证')?'待验证':'已连接'):'未连接','dw-account-badge'));card.append(row);
  const metric=this.card('当前工作区最近一轮用量'),usage=this.getUsage?.(),grid=el('div',undefined,'dw-usage-grid');
  for(const [name,value]of [['输入 tokens',usage?.input],['输出 tokens',usage?.output],['缓存命中',usage?.hit]]){const box=el('div',undefined,'dw-usage-box');box.append(el('strong',value==null?'—':value.toLocaleString()),el('small',name));grid.append(box);}metric.append(grid,el('p','仅展示接口实际返回的统计；余额与充值由提供商管理。','dw-field-hint'));this.action(card,'配置连接与模型',()=>this.switchTab('models'));
 }
 models(){this.connectionWorkspace=new ConnectionSettingsWorkspace({ctx:this.ctx,busy:this.busy,status:(text,error)=>this.showStatus(text,error),openNative:()=>this.showNative('model',++this.serial)});this.connectionWorkspace.mount(this.content);}
 async showNative(key,ticket){
  if(!await this.beforeLeave())return false;this.releaseCharacter();this.releaseWorkspaces();
  const tab=key==='model'?'models':key==='preset'?'params':key;
  this.currentTab=tab;for(const b of this.element.querySelectorAll('.dw-settings-nav > [role=tab]')){const active=b.dataset.tab===tab;b.classList.toggle('active',active);b.setAttribute('aria-selected',String(active));b.tabIndex=active?0:-1;}
  this.panel.setAttribute('aria-labelledby','dw-settings-tab-'+tab);this.setPage(tab,true);
  if(['model','preset'].includes(key)){const response=await fetch('/api/settings/get',{method:'POST',headers:this.ctx().getRequestHeaders(),body:'{}'});if(!response.ok)throw Error('完整连接设置载入失败，请重试。');const data=await response.json();if(ticket!==this.serial||!this.isOpen)return;if(this.ctx().mainApi==='openai'){const native=await import('/scripts/openai.js');native.loadOpenAISettings(data,{...native.oai_settings});}const selector=document.getElementById('main_api');if(selector)selector.value=this.ctx().mainApi;}
  this.releaseNative();this.content.replaceChildren();const holder=document.getElementById('top-settings-holder'),drawer=document.getElementById(ROLEPLAY_DRAWERS[key]);if(!holder||!drawer)throw Error('missing native panel');
  const mark=document.createComment('native settings return point');holder.before(mark);this.nativeState={holder,mark,panels:[...holder.querySelectorAll(':scope > .drawer')].map(n=>({node:n,selected:n.hasAttribute('data-dw-settings-active'),panel:n.querySelector(':scope > .drawer-content'),panelClass:n.querySelector(':scope > .drawer-content')?.className,icon:n.querySelector('.drawer-icon'),iconClass:n.querySelector('.drawer-icon')?.className}))};
  const host=el('div',undefined,'dw-settings-native-host');if(['character','persona','model','preset','appearance'].includes(key)){const back=this.action(this.content,'返回'+(tabs.find(t=>t[0]===tab)?.[1]||'设置'),()=>this.switchTab(tab));back.classList.add('dw-character-return');}this.content.append(host);host.append(holder);for(const item of this.nativeState.panels){item.node.toggleAttribute('data-dw-settings-active',item.node===drawer);if(item.node!==drawer){item.panel?.classList.remove('openDrawer');item.panel?.classList.add('closedDrawer');}}
  const nativeState=this.nativeState;nativeState.dropdowns=[];const ownDropdown=select=>{const instance=globalThis.jQuery(select).data('select2');if(instance?.dropdown?.$dropdownParent&&!nativeState.dropdowns.some(([node])=>node===select)){nativeState.dropdowns.push([select,instance.dropdown,instance.dropdown.$dropdownParent]);instance.dropdown.$dropdownParent=globalThis.jQuery(this.element);}};for(const select of holder.querySelectorAll('select'))ownDropdown(select);globalThis.jQuery(holder).on('select2:opening.dwSettings','select',function(){ownDropdown(this);});
  const panel=drawer.querySelector(':scope > .drawer-content');panel?.classList.add('dw-settings-native-panel');
  if(!panel?.classList.contains('openDrawer'))await doNavbarIconClick.call(drawer.querySelector(':scope > .drawer-toggle'));if(ticket!==this.serial||!this.isOpen)return;
  this.nativeState.disposeSurface=enhanceNativeSurface(panel,host,key);this.showStatus('设置直接读写酒馆配置；子操作关闭后保留当前设置页');
 }
 releaseNative(){const state=this.nativeState;if(!state)return;this.restoringNative=true;this.nativeState=null;globalThis.jQuery(state.holder).off('.dwSettings');state.disposeSurface?.();for(const [select,dropdown,parent]of state.dropdowns||[]){if(globalThis.jQuery(select).data('select2')?.dropdown===dropdown){globalThis.jQuery(select).select2('close');dropdown.$dropdownParent=parent;}}for(const item of state.panels){item.node.toggleAttribute('data-dw-settings-active',item.selected);if(item.panel)item.panel.className=item.panelClass;if(item.icon)item.icon.className=item.iconClass;}state.mark.replaceWith(state.holder);queueMicrotask(()=>{this.restoringNative=false;});}
 // Compatibility API: observe native state, never probe remote URLs or overwrite onlineStatus.
 performHealthCheck(){if(this.isOpen&&this.currentTab==='account'){this.content.replaceChildren();this.account();}return Promise.resolve(this.ctx().onlineStatus!=='no_connection');}
}
