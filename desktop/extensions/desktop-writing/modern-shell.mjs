import {icon} from './icons.mjs';
export class ModernShell{
 constructor(hooks){Object.assign(this,hooks);this.mount();}
 mount(){
  const tools=document.getElementById('dw-global-tools');
  const button=document.createElement('button');button.type='button';button.className='menu_button dw-palette-trigger';button.id='dw-command-palette-btn';button.title='搜索命令 · Ctrl+K';button.setAttribute('aria-label','搜索命令');button.append(icon('fa-magnifying-glass'));const label=document.createElement('span');label.textContent='命令罗盘';const key=document.createElement('kbd');key.textContent='Ctrl+K';button.append(label,key);button.onclick=()=>this.open();tools.prepend(button);
  this.badge=document.createElement('button');this.badge.type='button';this.badge.id='dw-model-badge';this.badge.className='menu_button';this.badge.onclick=()=>this.settings('models');tools.insertBefore(this.badge,document.getElementById('dw-settings-modal-btn'));
  this.dialog=document.createElement('dialog');this.dialog.id='dw-command-palette';this.dialog.setAttribute('aria-label','命令罗盘');this.dialog.innerHTML='<header><input type="search" placeholder="搜索命令、章节或讨论…" aria-label="搜索命令" autocomplete="off"><kbd>Esc</kbd></header><div class="dw-command-results" role="listbox" aria-label="可用命令"></div><footer>↑ ↓ 选择 · Enter 执行 · Esc 关闭</footer>';document.body.append(this.dialog);
  this.input=this.dialog.querySelector('input');this.results=this.dialog.querySelector('.dw-command-results');this.input.oninput=()=>this.filter();
  this.input.addEventListener('keydown',e=>{const rows=[...this.results.children];if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();this.selected=(this.selected+(e.key==='ArrowDown'?1:-1)+rows.length)%Math.max(1,rows.length);this.highlight();}else if(e.key==='Enter'){e.preventDefault();rows[this.selected]?.click();}});
  window.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();this.dialog.open?this.dialog.close():this.open();}else if((e.ctrlKey||e.metaKey)&&e.key===','){e.preventDefault();void this.settings();}});
  this.dialog.addEventListener('close',()=>this.focusBefore?.focus());
  const c=this.ctx();for(const event of ['SETTINGS_UPDATED','CHATCOMPLETION_MODEL_CHANGED','CHATCOMPLETION_SOURCE_CHANGED','GENERATION_ENDED'])if(c.eventTypes[event])c.eventSource.on(c.eventTypes[event],()=>this.refresh());this.refresh();
 }
 refresh(){const c=this.ctx(),model=this.model();this.badge.textContent=model||'配置模型';this.badge.title='模型连接：'+(c.onlineStatus||'未连接');this.badge.dataset.connected=String(!!c.onlineStatus&&c.onlineStatus!=='no_connection');}
 open(){if(document.querySelector('dialog[open]'))return;this.focusBefore=document.activeElement;this.items=this.commands();this.dialog.showModal();this.input.value='';this.filter();this.input.focus();}
 filter(){const query=this.input.value.trim().toLocaleLowerCase();this.filtered=this.items.filter(x=>x.label.toLocaleLowerCase().includes(query)).slice(0,60);this.results.replaceChildren();this.selected=0;for(const item of this.filtered){const b=document.createElement('button');b.type='button';b.setAttribute('role','option');b.textContent=item.label;b.onclick=()=>{this.dialog.close();void Promise.resolve().then(item.run).catch(()=>globalThis.toastr?.warning('操作未完成，请检查当前任务状态。'));};this.results.append(b);}if(!this.filtered.length){const empty=document.createElement('p');empty.textContent='没有匹配的命令';this.results.append(empty);}this.highlight();}
 highlight(){[...this.results.querySelectorAll('button')].forEach((n,i)=>{n.setAttribute('aria-selected',String(i===this.selected));if(i===this.selected)n.scrollIntoView({block:'nearest'});});}
}
