import {icon} from './icons.mjs';
export class ModernShell{
 constructor(hooks){Object.assign(this,hooks);this.createFrame();this.mount();}
 createFrame(){
  this.root=document.createElement('div');this.root.id='dw-app';
  this.bar=document.createElement('header');this.bar.id='dw-modebar';this.bar.setAttribute('aria-label','应用导航');
  const brand=document.createElement('div');brand.className='dw-brand';brand.innerHTML='<span class="dw-brand-dot"></span><span class="dw-brand-title">ST DESKTOP</span>';
  const nav=document.createElement('nav');nav.id='dw-mode-nav';nav.setAttribute('aria-label','创作工作区');
  for(const [key,label,glyph]of [['writing','小说写作','fa-file-pen'],['rp','角色扮演','fa-comments'],['agent','本地工作区','fa-folder-open']]){const b=this.frameButton(label,'mode',glyph);b.dataset.mode=key;nav.append(b);}
  const title=document.createElement('div');title.id='dw-context-title';title.hidden=true;
  const transfer=this.frameButton('聊天转正文','chat-to-novel','fa-arrow-right-arrow-left');transfer.hidden=true;
  const saved=document.createElement('span');saved.id='dw-save';saved.setAttribute('role','status');saved.textContent='正在读取作品…';saved.hidden=true;
  const tools=document.createElement('div');tools.id='dw-global-tools';
  const focus=this.frameButton('专注','zen-mode','fa-expand');focus.id='dw-zen-btn';focus.title='快捷键 F10：专注模式';
  const settings=this.frameButton('酒馆设置','unified-settings','fa-gear');settings.id='dw-settings-modal-btn';settings.title='酒馆设置 · Ctrl+,';
  this.taskBadge=this.frameButton('','active-task','fa-clock-rotate-left');this.taskBadge.hidden=true;this.taskBadge.setAttribute('role','status');this.taskBadge.onclick=()=>void this.activeTask?.run();
  tools.append(this.taskBadge,focus,settings);
  if(globalThis.localWorkspace?.appMenu){const menu=this.frameButton('应用菜单','app-menu','fa-bars');menu.title='酒馆、编辑、视图、帮助（也可按 Alt 键）';tools.append(menu);}
  this.bar.append(brand,nav,title,transfer,saved,tools);
  this.pages=document.createElement('main');this.pages.id='dw-workspaces';this.pages.setAttribute('aria-label','创作工作区内容');
  this.root.append(this.bar,this.pages);document.body.append(this.root);this.setMode('rp');
 }
 frameButton(label,action,glyph){const b=document.createElement('button');b.type='button';b.className='menu_button';b.dataset.dwAction=action;b.append(icon(glyph));const text=document.createElement('span');text.textContent=label;b.append(text);return b;}
 setMode(mode){this.root.dataset.mode=mode;this.pages.hidden=false;for(const b of this.bar.querySelectorAll('[data-mode]'))b.setAttribute('aria-pressed',String(b.dataset.mode===mode));this.refreshTasks();}
 async reveal(){
  // APP_READY follows extension/style loading. Allow the mounted layout to
  // settle before asking the preload to remove its startup cover.
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  const result=await globalThis.localWorkspace?.startupReady?.();
  if(result&& !result.ok)throw new Error('桌面界面尚未获准显示，请重新加载。');
 }
 mount(){
  const tools=document.getElementById('dw-global-tools');
  this.theme?.renderFontControls(tools);
  const button=document.createElement('button');button.type='button';button.className='menu_button dw-palette-trigger';button.id='dw-command-palette-btn';button.title='搜索命令 · Ctrl+K';button.setAttribute('aria-label','搜索命令');button.append(icon('fa-magnifying-glass'));const label=document.createElement('span');label.textContent='命令罗盘';const key=document.createElement('kbd');key.textContent='Ctrl+K';button.append(label,key);button.onclick=()=>this.open();tools.prepend(button);
  this.badge=document.createElement('button');this.badge.type='button';this.badge.id='dw-model-badge';this.badge.className='menu_button';this.badge.onclick=()=>this.settings('models');tools.insertBefore(this.badge,document.getElementById('dw-settings-modal-btn'));
  this.dialog=document.createElement('dialog');this.dialog.id='dw-command-palette';this.dialog.setAttribute('aria-label','命令罗盘');this.dialog.innerHTML='<header><input type="search" placeholder="搜索命令、章节或讨论…" aria-label="搜索命令" autocomplete="off"><kbd>Esc</kbd></header><div class="dw-command-results" role="listbox" aria-label="可用命令"></div><footer>↑ ↓ 选择 · Enter 执行 · Esc 关闭</footer>';document.body.append(this.dialog);
  this.input=this.dialog.querySelector('input');this.results=this.dialog.querySelector('.dw-command-results');this.input.oninput=()=>this.filter();
  this.input.addEventListener('keydown',e=>{const rows=[...this.results.children];if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();this.selected=(this.selected+(e.key==='ArrowDown'?1:-1)+rows.length)%Math.max(1,rows.length);this.highlight();}else if(e.key==='Enter'){e.preventDefault();rows[this.selected]?.click();}});
  window.addEventListener('keydown',e=>{if(e.defaultPrevented)return;if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();this.dialog.open?this.dialog.close():this.open();}else if((e.ctrlKey||e.metaKey)&&e.key===','){e.preventDefault();void this.settings();}});
  this.dialog.addEventListener('close',()=>this.focusBefore?.focus());
  const c=this.ctx();for(const event of ['SETTINGS_UPDATED','CHATCOMPLETION_MODEL_CHANGED','CHATCOMPLETION_SOURCE_CHANGED','GENERATION_STARTED','GENERATION_ENDED','GENERATION_STOPPED'])if(c.eventTypes[event])c.eventSource.on(c.eventTypes[event],()=>this.refresh());this.refresh();
 }
 refreshTasks(){this.activeTask=this.task?.();this.taskBadge.hidden=!this.activeTask;if(this.activeTask){this.taskBadge.querySelector('span').textContent=this.activeTask.label;this.taskBadge.title=this.activeTask.label+' · 点击返回任务';}}
 refresh(){this.refreshTasks();const c=this.ctx(),model=this.model();this.badge.textContent=model||'配置模型';this.badge.title='模型连接：'+(c.onlineStatus||'未连接');this.badge.dataset.connected=String(!!c.onlineStatus&&c.onlineStatus!=='no_connection');}
 open(){if(document.querySelector('dialog[open]'))return;this.focusBefore=document.activeElement;this.items=this.commands();this.dialog.showModal();this.input.value='';this.filter();this.input.focus();}
 filter(){const query=this.input.value.trim().toLocaleLowerCase();this.filtered=this.items.filter(x=>x.label.toLocaleLowerCase().includes(query)).slice(0,60);this.results.replaceChildren();this.selected=0;for(const item of this.filtered){const b=document.createElement('button');b.type='button';b.setAttribute('role','option');b.textContent=item.label;b.onclick=()=>{this.dialog.close();void Promise.resolve().then(item.run).catch(()=>globalThis.toastr?.warning('操作未完成，请检查当前任务状态。'));};this.results.append(b);}if(!this.filtered.length){const empty=document.createElement('p');empty.textContent='没有匹配的命令';this.results.append(empty);}this.highlight();}
 highlight(){[...this.results.querySelectorAll('button')].forEach((n,i)=>{n.setAttribute('aria-selected',String(i===this.selected));if(i===this.selected)n.scrollIntoView({block:'nearest'});});}
}
