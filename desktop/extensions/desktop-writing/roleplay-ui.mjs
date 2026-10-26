// Original chat nodes, native settings and native storage stay authoritative.
import {readUIPreference,writeUIPreference} from './ui-preferences.mjs';
import {RoleplayProjects,projectKey,validArchive,archiveDue,ARCHIVE_RETENTION} from './roleplay-projects.mjs';
export const ROLEPLAY_DRAWERS = Object.freeze({
    preset:'ai-config-button', model:'sys-settings-button', format:'advanced-formatting-button',
    world:'WI-SP-button', appearance:'user-settings-button', background:'backgrounds-button',
    extensions:'extensions-settings-button', persona:'persona-management-button', character:'rightNavHolder',
});
const DRAWER_TITLES={preset:'生成参数与调节',model:'连接与模型',format:'高级提示格式',world:'世界书',appearance:'界面与主题',background:'聊天背景',extensions:'扩展与正则',persona:'用户身份',character:'角色卡管理'};
export function roleplayLayout(value,wide=true){
    const p=value&&typeof value==='object'?value:{};
    return {sidebar:typeof p.sidebar==='boolean'?p.sidebar:wide,rightOpen:p.rightOpen!==false,rightTab:Object.hasOwn(ROLEPLAY_DRAWERS,p.rightTab)?p.rightTab:'preset',rightWidth:Number.isFinite(p.rightWidth)?Math.max(250,Math.min(640,p.rightWidth)):250};
}
export function roleplayChats(value) {
    if (!value || typeof value !== 'object' || value.error) return [];
    const seen=new Set();
    return Object.values(value).flatMap(item=>{
        if(typeof item?.file_name!=='string')return [];
        const file=item.file_name.replace(/\.jsonl$/i,'');
        if(!file || /[\\/\u0000-\u001f]/.test(file) || seen.has(file))return [];
        seen.add(file);return [{file,items:Number(item.chat_items)||0,updated:Number(item.last_mes)||Date.parse(item.last_mes)||0}];
    }).sort((a,b)=>b.updated-a.updated || b.file.localeCompare(a.file));
}
export function roleplayBooks(context,world={}) {
    const names=new Set(),add=value=>{if(typeof value==='string'&&value.trim())names.add(value);};
    (world.selected_world_info||[]).forEach(add);add(context.chatMetadata?.world_info);add(context.powerUserSettings?.persona_description_lorebook);
    const group=context.groups?.find(g=>String(g.id)===String(context.groupId));
    const characters=group?(context.characters||[]).filter(c=>group.members?.includes(c.avatar)):[context.characters?.[context.characterId]];
    for(const c of characters.filter(Boolean)){add(c.data?.extensions?.world);const key=c.avatar?.replace(/\.[^.]+$/,'');world.world_info?.charLore?.find(x=>x.name===key)?.extraBooks?.forEach(add);}
    return [...names];
}
const element=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const button=(text,action)=>{const n=element('button',text,'menu_button menu_button_icon interactable');n.type='button';if(action)n.dataset.rpAction=action;return n;};
export class RoleplayUI {
    constructor({ctx,openSettings,getWorld=()=>({}),getModel=()=>'',selectPreset,openGroup,request=globalThis.fetch.bind(globalThis),busy=()=>false,onChatToNovel=()=>{}}) {
        Object.assign(this,{ctx,openSettings,getWorld,getModel,selectPreset,openGroup,request,busy,onChatToNovel});
        this.projects=new RoleplayProjects({ctx,request,busy});this.projectChats=new Map();this.loadingProjects=new Map();this.active=false;this.pending=false;this.limit=100;this.chats=[];
        const prefs=readUIPreference('roleplayLayout',null,'desktop-roleplay-layout-v1');
        Object.assign(this,roleplayLayout(prefs,!matchMedia('(max-width:800px)').matches));
        this.rightEntire=prefs?.rightEntire!==false;this.zen=false;if(this.openSettings)this.rightTab='preset';
    }
    mount(sheld){
        this.sheld=sheld;this.header=element('header');this.header.id='dw-rp-header';
        this.toggle=button('☰','sidebar');this.toggle.setAttribute('aria-label','展开或收起角色与会话');this.toggle.setAttribute('aria-controls','dw-rp-library');
        this.title=button('选择角色开始故事 ▾','history');this.title.id='dw-rp-title';
        this.controls=element('div');this.controls.id='dw-rp-controls';
        this.preset=element('select',undefined,'text_pole');this.preset.setAttribute('aria-label','角色扮演原生预设');
        const presetLabel=element('label','预设');presetLabel.append(this.preset);this.preset.onchange=()=>void this.guard(async()=>{if(this.busy()||this.pending||this.selectingPreset)throw new Error('请先结束当前操作，再切换预设。');this.selectingPreset=true;this.preset.disabled=true;try{await this.selectPreset(this.preset.value);}finally{this.selectingPreset=false;this.refreshControls();}});
        this.model=button('模型 ▾','model');this.world=button('世界书 ▾','world');this.controls.append(presetLabel,this.model,this.world);this.parametersToggle=button('参数','parameters-toggle');this.parametersToggle.setAttribute('aria-controls','dw-rp-settings');this.header.append(this.toggle,this.title,this.controls,this.parametersToggle);
        this.library=element('aside');this.library.id='dw-rp-library';this.library.setAttribute('aria-label','角色与会话');
        const libraryHeading=element('header',undefined,'dw-rp-pane-heading');libraryHeading.append(element('span','角色项目'),button('⋯','library-menu'));
        this.persona=button('我的身份','persona');const actions=element('div',undefined,'dw-rp-row');actions.append(button('添加 / 管理角色','character'),button('已归档','archives'));
        this.search=element('input',undefined,'text_pole');this.search.type='search';this.search.placeholder='搜索角色项目与对话';this.search.setAttribute('aria-label','搜索角色与会话');this.search.oninput=()=>{this.renderLibrary();clearTimeout(this.searchTimer);this.searchTimer=setTimeout(()=>void this.guard(()=>this.searchProjects()),180);};
        this.list=element('div');this.list.id='dw-rp-list';
        this.status=element('small');this.status.id='dw-rp-status';this.status.setAttribute('role','status');this.status.setAttribute('aria-live','polite');
        const footer=element('div',undefined,'dw-rp-library-footer');footer.append(button('完整会话管理','history'),button('聊天转正文','novel'),this.status);
        this.library.append(libraryHeading,this.search,this.list,actions,footer,this.persona);
        this.right=element('aside');this.right.id='dw-rp-settings';this.right.setAttribute('aria-label','角色扮演原生设置');
        this.rightHeading=element('header',undefined,'dw-rp-pane-heading');this.rightTitle=element('span');this.rightHeading.append(this.rightTitle,button('收起 ›','right-close'));this.right.append(this.rightHeading);
        this.rightRestore=element('button','◀','dw-rp-restore-handle');this.rightRestore.type='button';this.rightRestore.id='dw-rp-right-restore';this.rightRestore.title='展开生成参数';this.rightRestore.setAttribute('aria-label','展开生成参数');this.rightRestore.setAttribute('aria-controls','dw-rp-settings');this.rightRestore.onclick=()=>void this.guard(()=>this.toggleEntireRight());document.body.append(this.rightRestore);
        this.resizeHandle=element('div');this.resizeHandle.id='dw-rp-resize';this.resizeHandle.tabIndex=0;this.resizeHandle.setAttribute('role','separator');this.resizeHandle.setAttribute('aria-label','调整角色扮演设置宽度');this.resizeHandle.setAttribute('aria-orientation','vertical');this.resizeHandle.setAttribute('aria-valuemin','250');this.resizeHandle.setAttribute('aria-valuemax','640');this.right.append(this.resizeHandle);
        this.resizeHandle.ondblclick=()=>{this.setWidth(250);this.persistLayout();};
        this.resizeHandle.onpointerdown=e=>{const start=e.clientX,width=this.rightWidth;this.resizeHandle.setPointerCapture(e.pointerId);this.resizeHandle.onpointermove=v=>this.setWidth(width+start-v.clientX);const finish=()=>{this.resizeHandle.onpointermove=null;this.persistLayout();};this.resizeHandle.onpointerup=finish;this.resizeHandle.onpointercancel=finish;};
        this.resizeHandle.onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();this.setWidth(e.key==='Home'?250:e.key==='End'?640:this.rightWidth+(e.key==='ArrowLeft'?10:-10));this.persistLayout();}};
        this.empty=element('div','选择一个角色，开始新的故事。');this.empty.id='dw-rp-empty';this.empty.hidden=true;sheld.append(this.header,this.library,this.right,this.empty);
        for(const root of [this.header,this.library,this.right])root.addEventListener('click',e=>{const n=e.target.closest('[data-rp-action]');if(n)void this.guard(()=>this.action(n));});
        window.addEventListener('keydown',e=>{if(e.key==='F10'&&!e.shiftKey&&!e.ctrlKey&&!e.altKey&&!e.metaKey&&this.active){e.preventDefault();void this.guard(()=>this.toggleZen());}});
        this.list.addEventListener('contextmenu',e=>{const row=e.target.closest('[data-rp-chat],[data-rp-project]');if(row){e.preventDefault();this.showProjectMenu(row.dataset.rpProject,row.dataset.rpChat,e.clientX,e.clientY);}});
        this.list.addEventListener('keydown',e=>{if(e.key==='ContextMenu'||(e.shiftKey&&e.key==='F10')){const row=e.target.closest('[data-rp-chat],[data-rp-project]');if(row){e.preventDefault();const r=row.getBoundingClientRect();this.showProjectMenu(row.dataset.rpProject,row.dataset.rpChat,r.left,r.bottom);}}});
        document.addEventListener('pointerdown',e=>{if(this.menu&&!this.menu.contains(e.target))this.closeMenu();});
        document.addEventListener('keydown',e=>{if(e.key==='Escape')this.closeMenu();});
        void this.guard(()=>this.cleanupArchives());
        const c=this.ctx();
        for(const name of ['CHAT_CHANGED','CHAT_CREATED','CHAT_DELETED','CHAT_RENAMED','CHARACTER_EDITED','CHARACTER_DELETED','CHARACTER_DUPLICATED','CHARACTER_PAGE_LOADED','GROUP_UPDATED','GROUP_CHAT_DELETED','GROUP_CHAT_CREATED'])if(c.eventTypes[name])c.eventSource.on(c.eventTypes[name],()=>this.refresh());
        if(c.eventTypes.CHARACTER_RENAMED)c.eventSource.on(c.eventTypes.CHARACTER_RENAMED,(oldAvatar,newAvatar)=>this.guard(async()=>{await this.projects.renameOwner(oldAvatar,newAvatar);const key=projectKey(oldAvatar),next=projectKey(newAvatar);if(this.projectChats.has(key)){this.projectChats.set(next,this.projectChats.get(key));this.projectChats.delete(key);}}));
        for(const name of ['SETTINGS_UPDATED','OAI_PRESET_CHANGED_AFTER','PRESET_CHANGED','CHATCOMPLETION_SOURCE_CHANGED','CHATCOMPLETION_MODEL_CHANGED','WORLDINFO_SETTINGS_UPDATED','WORLDINFO_UPDATED','GENERATION_STARTED','GENERATION_ENDED','GENERATION_STOPPED'])if(c.eventTypes[name])c.eventSource.on(c.eventTypes[name],()=>this.refreshControls());
        document.addEventListener('change',e=>{if(e.target.closest('#top-settings-holder')){clearTimeout(this.changeTimer);this.changeTimer=setTimeout(()=>this.refreshControls(),120);}});
        for(const name of ['GENERATION_ENDED','GENERATION_STOPPED'])if(c.eventTypes[name])c.eventSource.on(c.eventTypes[name],()=>{this.refresh();void this.guard(()=>this.cleanupArchives());});
        const apiIcon=document.getElementById('API-status-top');if(apiIcon){this.connectionObserver=new MutationObserver(()=>this.refreshControls());this.connectionObserver.observe(apiIcon,{attributes:true,attributeFilter:['class','title']});}
    }
    setActive(active){
        this.active=active;document.body.classList.toggle('dw-rp-mode',active);if(!active){this.closeMenu();this.archiveDialog?.close();this.empty.hidden=true;}this.header.hidden=!active;this.applySidebar(false);this.applyRight();
        if(active){this.refresh();if(this.rightOpen&&this.rightEntire){if(this.rightTab==='preset')this.quickParameters();else void this.guard(()=>this.native(this.rightTab));}}else{this.quick?.remove();this.quick=null;}
    }
    async guard(task){try{return await task();}catch(error){this.status.textContent=error?.name==='AbortError'?'':(error?.message||'操作失败，请重新打开设置中心重试。');globalThis.toastr?.warning(this.status.textContent,'角色与会话');}}
    native(name){return this.openSettings?.(name)??Promise.resolve();}
    applyRight(){
        this.rightRestore.hidden=!this.active||this.rightEntire;
        this.sheld.dataset.rpRight=String(this.active&&this.rightOpen);
        this.sheld.dataset.rpRightEntire=String(this.active&&this.rightEntire);
        this.sheld.style.setProperty('--dw-rp-panel-width',this.rightWidth+'px');
        this.right.hidden=!this.active||!this.rightOpen||!this.rightEntire;
        
        this.rightTitle.textContent=DRAWER_TITLES[this.rightTab];this.parametersToggle.setAttribute('aria-expanded',String(this.active&&this.rightOpen&&this.rightEntire));
        this.resizeHandle.setAttribute('aria-valuenow',this.rightWidth);
    }
    toggleEntireRight(){
        this.rightEntire=!this.rightEntire;
        if(this.rightEntire){this.rightOpen=true;this.rightTab='preset';this.quickParameters();}
        this.applyRight();
        this.persistLayout();
    }
    toggleZen(){
        this.zen=!this.zen;
        document.body.classList.toggle('dw-zen-mode',this.zen);
        if(this.zen){
            this.savedSidebar=this.sidebar;
            this.savedRightEntire=this.rightEntire;
            if(this.sidebar){this.sidebar=false;this.applySidebar(false);}
            if(this.rightEntire){this.rightEntire=false;this.applyRight();}
        }else{
            if(this.savedSidebar!==undefined){this.sidebar=this.savedSidebar;this.applySidebar(false);}
            if(this.savedRightEntire!==undefined){this.rightEntire=this.savedRightEntire;this.applyRight();}
        }
        this.persistLayout();
    }
    setWidth(value){this.rightWidth=Math.max(250,Math.min(640,value));this.applyRight();}
    suspendForSettings(){
        return ()=>{if(this.active&&this.rightOpen&&this.rightEntire){this.quickParameters();this.refreshControls();}};
    }
    quickParameters(){
        this.quick?.remove();const c=this.ctx();this.quick=element('div',undefined,'dw-rp-quick');this.right.append(this.quick);
        const ids=c.mainApi==='openai'?['temp_openai','openai_max_tokens','openai_max_context']:c.mainApi==='novel'?['temp_novel','amount_gen','max_context']:c.mainApi==='textgenerationwebui'?['temp_textgenerationwebui','amount_gen','max_context']:['temp','amount_gen','max_context'];
        for(const [index,label]of ['创造力 / 温度','最大回复长度','上下文容量'].entries()){
            const native=document.getElementById(ids[index]);if(!native)continue;const field=element('label',undefined,'dw-rp-parameter'),title=element('span',label),row=element('div',undefined,'dw-rp-parameter-value'),range=element('input'),number=element('input');range.type='range';number.type='number';
            for(const n of [range,number]){n.min=native.min;n.max=native.max;n.step=native.step;n.value=native.value;n.setAttribute('aria-label',label+(n===range?'滑块':'数值'));n.disabled=this.busy();}
            const change=n=>{if(this.busy())return;native.value=n.value;globalThis.jQuery(native).trigger('input');range.value=native.value;number.value=native.value;};range.oninput=()=>change(range);number.onchange=()=>change(number);row.append(title,number);field.append(row,range);this.quick.append(field);
        }
        if(c.mainApi==='openai'){const label=element('label',undefined,'dw-rp-quick-check'),check=element('input');check.type='checkbox';check.checked=!!c.chatCompletionSettings.stream_openai;check.onchange=()=>{if(this.busy())return;globalThis.jQuery('#stream_toggle').prop('checked',check.checked).trigger('change');};label.append(check,element('span','流式传输'));this.quick.append(label);}
        const full=element('button','更多参数与预设','menu_button');full.type='button';full.onclick=()=>void globalThis.SillyTavernDesktopWriting?.settingsDialog?.open('params');this.quick.append(full);const settings=button('角色 · 世界书 · 全部设置','all-settings');this.quick.append(settings);this.applyRight();
    }
    persistLayout(){writeUIPreference('roleplayLayout',{sidebar:this.sidebar,rightOpen:this.rightOpen,rightTab:this.rightTab,rightWidth:this.rightWidth,rightEntire:this.rightEntire});}
    syncPreset(){
        const c=this.ctx(),api=c.mainApi==='koboldhorde'?'kobold':c.mainApi;
        const source=[...document.querySelectorAll('#top-settings-holder select[data-preset-manager-for]')].find(n=>n.dataset.presetManagerFor.split(',').includes(api));
        const signature=source?JSON.stringify([api,[...source.options].map(o=>[o.value,o.textContent,o.disabled])]):'';
        if(signature!==this.presetSignature||!this.preset.options.length){this.presetSignature=signature;this.preset.replaceChildren();if(source){for(const o of source.options)this.preset.append(o.cloneNode(true));}else{const o=element('option','当前接口：打开参数');o.value='';this.preset.append(o);}}
        if(source)this.preset.value=source.value;this.preset.disabled=!source||this.busy()||this.pending||this.selectingPreset;
    }
    refreshControls(){
        if(!this.active)return;
        const c=this.ctx(),character=c.characters?.[c.characterId],group=c.groups?.find(g=>String(g.id)===String(c.groupId));
        const currentKey=group?projectKey(String(group.id),true):character?projectKey(character.avatar):'';const name=this.projects.project(currentKey).name||group?.name||character?.name||'未选择角色',chat=c.getCurrentChatId?.();this.empty.hidden=!!(character||group);document.body.classList.toggle('dw-rp-empty',!(character||group));this.title.setAttribute('aria-label',name);this.title.textContent=name+' ▾';this.title.dataset.chat=chat||'';this.title.title=group?'群聊会话管理':(character?'打开当前角色的完整会话管理':'先选择角色，或打开原生角色管理');
        this.syncPreset();this.preset.title=this.preset.selectedOptions[0]?.textContent||'当前原生预设';
        const model=this.getModel(c)||'当前连接';this.model.textContent='模型 · '+model;this.model.title='API 与模型连接 · '+(c.onlineStatus==='no_connection'?'未连接':(c.onlineStatus||'状态请查看原生面板'));this.model.dataset.connected=String(!!c.onlineStatus&&c.onlineStatus!=='no_connection');
        const books=roleplayBooks(c,this.getWorld());this.world.textContent='世界书 · '+books.length;this.world.title='已绑定的全局、角色、聊天及用户身份世界书（非本轮命中数）'+(books.length?'：'+books.join('、'):'');
        this.persona.textContent='我的身份：'+(c.name1||'当前用户')+' ▾';
    }
    currentEntity(){
        const c=this.ctx();return c.groupId?this.projects.entity(projectKey(String(c.groupId),true)):c.characters[c.characterId]?this.projects.entity(projectKey(c.characters[c.characterId].avatar)):null;
    }
    refresh(){
        if(!this.active)return;const selected=this.currentEntity();if(selected&&!this.projects.state.projects[selected.key])this.projects.update(selected.key,{collapsed:false});this.refreshControls();this.renderLibrary();void this.guard(()=>this.loadChats());
        const entity=this.currentEntity();
        if(entity&&!this.pending&&this.projects.project(entity.key).hiddenArchive){
            void this.guard(()=>this.mutate(()=>this.openEntity(entity,null,true)));
        }else if(entity&&!this.pending&&this.projects.archived(entity.key,this.ctx().getCurrentChatId?.())){
            void this.guard(()=>this.mutate(async()=>{if(!await (await import('/script.js')).closeCurrentChat())throw Error('请先结束生成。');}));
        }
    }
    renderLibrary(){
        if(!this.active)return;const c=this.ctx(),query=this.search.value.trim().toLocaleLowerCase();this.list.replaceChildren();
        this.library.dataset.avatars=String(this.projects.state.avatars===true);
        const entities=[...(c.characters||[]).filter(Boolean).map(ch=>this.projects.entity(projectKey(ch.avatar))),...(c.groups||[]).map(g=>this.projects.entity(projectKey(String(g.id),true)))].filter(Boolean);
        let count=0;
        for(const entity of entities){
            const prefs=this.projects.project(entity.key);if(prefs.hiddenArchive)continue;
            const name=prefs.name||entity.name,rows=(this.projectChats.get(entity.key)||[]).filter(t=>!this.projects.archived(entity.key,t.file));
            const matches=name.toLocaleLowerCase().includes(query),filtered=rows.filter(t=>matches||this.projects.title(entity.key,t.file).toLocaleLowerCase().includes(query));
            if(query&&!matches&&!filtered.length)continue;if(++count>this.limit)break;
            const section=element('section',undefined,'dw-rp-project'),row=element('div',undefined,'dw-rp-project-row');row.dataset.rpProject=entity.key;
            const expanded=query?true:!prefs.collapsed,fold=button(expanded?'▾':'▸','project-fold');fold.dataset.key=entity.key;fold.setAttribute('aria-label',(expanded?'折叠':'展开')+name);fold.setAttribute('aria-expanded',String(expanded));
            const pick=button('','project-open');pick.dataset.key=entity.key;pick.setAttribute('aria-pressed',String(this.projects.current(entity.key)));
            const avatar=entity.group?element('span','群','dw-rp-project-avatar'):element('img',undefined,'dw-rp-project-avatar');if(!entity.group){avatar.src='/thumbnail?type=avatar&file='+encodeURIComponent(entity.owner);avatar.alt='';avatar.loading='lazy';}
            pick.append(avatar,element('span',name,'dw-rp-project-name'));pick.title=name;const tools=element('div',undefined,'dw-rp-project-tools');
            for(const [text,action,label]of [['＋','project-new','新建对话'],['⋯','project-menu','项目操作']]){const b=button(text,action);b.dataset.key=entity.key;b.setAttribute('aria-label',label+' · '+name);tools.append(b);}
            row.append(fold,pick,tools);section.append(row);
            if(expanded){
                for(const chat of filtered){const line=element('div',undefined,'dw-rp-chat-row');line.dataset.rpProject=entity.key;line.dataset.rpChat=chat.file;
                    const open=button(this.projects.title(entity.key,chat.file),'project-chat');open.dataset.key=entity.key;open.dataset.file=chat.file;open.title=this.projects.title(entity.key,chat.file);open.setAttribute('aria-current',String(this.projects.current(entity.key,chat.file)));
                    const archive=button('⌑','chat-archive');archive.dataset.key=entity.key;archive.dataset.file=chat.file;archive.setAttribute('aria-label','归档对话');archive.title='归档对话';
                    const more=button('⋯','chat-menu');more.dataset.key=entity.key;more.dataset.file=chat.file;more.setAttribute('aria-label','对话操作');line.append(open,archive,more);section.append(line);
                }
                if(!filtered.length)section.append(element('small',this.loadingProjects.has(entity.key)?'正在读取…':'暂无对话，点击 ＋ 开始。','dw-rp-tree-hint'));
            }
            this.list.append(section);
        }
        if(count>this.limit)this.list.append(button('显示更多项目','more'));
        if(!count)this.list.append(element('p',query?'没有匹配的项目或对话。':'从“添加 / 管理角色”开始。','dw-rp-tree-hint'));
    }
    async loadProject(entity){
        if(!entity)return;if(this.loadingProjects.has(entity.key))return this.loadingProjects.get(entity.key);
        const task=(async()=>{const rows=await this.projects.chats(entity);this.projectChats.set(entity.key,rows);if(this.projects.current(entity.key))this.chats=rows;})();
        this.loadingProjects.set(entity.key,task);
        try{return await task;}finally{this.loadingProjects.delete(entity.key);this.renderLibrary();}
    }
    async searchProjects(){
        const query=this.search.value.trim();if(!query)return;
        const c=this.ctx(),entities=[...c.characters.filter(Boolean).map(ch=>this.projects.entity(projectKey(ch.avatar))),...c.groups.map(g=>this.projects.entity(projectKey(String(g.id),true)))];
        for(const e of entities.slice(0,this.limit)){if(query!==this.search.value.trim())break;if(e&&!this.projectChats.has(e.key)&&!this.projects.project(e.key).hiddenArchive)await this.loadProject(e);}
    }
    async loadChats(){
        const entity=this.currentEntity();if(entity)await this.loadProject(entity);
        for(const key of Object.keys(this.projects.state.projects)){const e=this.projects.entity(key);if(e&&!this.projects.project(key).collapsed&&!this.projects.project(key).hiddenArchive&&key!==entity?.key)await this.loadProject(e);}
    }
    closeMenu(){this.menu?.remove();this.menu=null;}
    showMenu(items,x,y){
        this.closeMenu();const menu=element('div',undefined,'dw-rp-context-menu');menu.setAttribute('role','menu');this.menu=menu;
        for(const [label,run]of items){const b=button(label);b.setAttribute('role','menuitem');b.onclick=()=>{this.closeMenu();void this.guard(run);};menu.append(b);}
        document.body.append(menu);const rect=menu.getBoundingClientRect();menu.style.left=Math.max(8,Math.min(x,innerWidth-rect.width-8))+'px';menu.style.top=Math.max(8,Math.min(y,innerHeight-rect.height-8))+'px';
        menu.addEventListener('keydown',e=>{const buttons=[...menu.querySelectorAll('button')],at=buttons.indexOf(document.activeElement);if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();buttons[e.key==='Home'?0:e.key==='End'?buttons.length-1:(at+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();}});menu.querySelector('button')?.focus();
    }
    showProjectMenu(key,file,x,y){
        const e=this.projects.entity(key);if(!e)return;
        this.showMenu(file?[
            ['重命名对话',()=>this.renameProjectItem(e,file)],['复制对话',()=>this.mutate(async()=>{const name=await this.projects.copy(e,file);await this.loadProject(e);await this.openEntity(e,name);})],['归档对话',()=>this.archiveItem(e,file)],
        ]:[[e.group?'管理群聊':'管理角色卡',()=>this.mutate(async()=>{await this.openEntity(e);if(e.group)await this.openSettings?.('group');else await this.native('character');})],['重命名项目',()=>this.renameProjectItem(e)],['归档角色项目',()=>this.archiveItem(e)]],x,y);
    }
    async inputName(title,value){const c=this.ctx();const result=await c.callGenericPopup(element('p',title),c.POPUP_TYPE.INPUT,value);if(typeof result!=='string'||!result.trim())return null;if(result.trim().length>120)throw Error('名称不能超过 120 个字符。');return result.trim();}
    async renameProjectItem(entity,file){
        const name=await this.inputName(file?'重命名对话（仅修改显示标题）':'重命名角色项目（不修改角色卡名称）',file?this.projects.title(entity.key,file):this.projects.project(entity.key).name||entity.name);if(!name)return;
        await this.mutate(()=>this.projects.commit(()=>{const p=this.projects.project(entity.key);this.projects.update(entity.key,file?{titles:{...p.titles,[file]:name}}:{name});}));
    }
    async selectEntity(entity){
        const fresh=this.projects.entity(entity.key);if(!fresh)throw Error('角色或群聊已变化，请重新选择。');
        if(!this.projects.current(entity.key)){if(fresh.group){if(!await this.openGroup(fresh.owner))throw Error('群聊暂未完成切换。');}else await this.ctx().selectCharacterById(fresh.id,{switchMenu:false});}
        if(!this.projects.current(entity.key))throw Error('角色暂未完成切换，请重试。');
    }
    async openEntity(entity,file,create=false){
        await this.selectEntity(entity);entity=this.projects.entity(entity.key);await this.loadProject(entity);const p=this.projects.project(entity.key),hidden=!!p.hiddenArchive;
        if(create||hidden){await this.createChat(entity);}
        else{const rows=this.projectChats.get(entity.key)||[];const target=file||(!this.projects.archived(entity.key,this.ctx().getCurrentChatId?.())?this.ctx().getCurrentChatId?.():rows.find(t=>!this.projects.archived(entity.key,t.file))?.file);
            if(target&&this.projects.archived(entity.key,target))throw Error('此对话已归档，请从归档区恢复。');
            if(target){if(entity.group)await this.ctx().openGroupChat(entity.owner,target);else await this.ctx().openCharacterChat(target);}else await this.createChat(entity);
            this.projects.update(entity.key,{collapsed:false});writeUIPreference('roleplayProjects',this.projects.state);
        }
        await this.loadProject(entity);
    }
    async createChat(entity){
        const previous=this.ctx().getCurrentChatId?.();await (await import('/script.js')).doNewChat();
        const file=this.ctx().getCurrentChatId?.();if(!file||file===previous)throw Error('原生服务未创建新对话，请退出角色卡编辑状态后重试。');
        await this.ctx().saveChat();
        await this.projects.commit(()=>this.projects.update(entity.key,{hiddenArchive:null,collapsed:false,titles:{...this.projects.project(entity.key).titles,[file]:'新对话'}}));
    }
    async mutate(task){
        await this.switchTo(task);this.renderLibrary();
    }
    async archiveItem(entity,file){
        const c=this.ctx();if(this.busy()||this.pending)throw Error('请先结束当前生成或操作，再归档。');
        const result=await c.callGenericPopup(element('p',file?'归档此对话？30 天内可恢复，到期永久删除。':'归档此角色项目及其现有对话？角色卡保留，30 天内可恢复，到期永久删除对话。'),c.POPUP_TYPE.CONFIRM);
        if(result!==c.POPUP_RESULT.AFFIRMATIVE)return;
        await this.mutate(async()=>{
            const rows=await this.projects.chats(entity),visible=rows.filter(t=>!this.projects.archived(entity.key,t.file)),chosen=file?visible.filter(t=>t.file===file):visible;
            if(file&&!chosen.length)throw Error('此对话已变化，请刷新后重试。');
            if(this.projects.current(entity.key)&&(!file||this.projects.current(entity.key,file))){const current=this.ctx(),saved=await this.projects.post(entity.group?'/api/chats/group/get':'/api/chats/get',entity.group?{id:current.getCurrentChatId()}:{avatar_url:entity.owner,file_name:current.getCurrentChatId()});if(!Array.isArray(saved)||JSON.stringify(saved.slice(1))!==JSON.stringify(current.chat))throw Error('当前对话尚未确认保存，未归档，请重试。');if(!await (await import('/script.js')).closeCurrentChat())throw Error('未能关闭当前对话，请先停止生成。');}
            await this.projects.archive(entity,chosen,file?'chat':'project');
        });
    }
    async cleanupArchives(){
        if(this.cleaning||this.pending||this.busy())return;const due=this.projects.state.archive.filter(a=>archiveDue(a));if(!due.length)return;this.cleaning=true;this.pending=true;this.closeMenu();
        try{let failed=0;for(const a of due){if(a.chats.some(t=>this.projects.current(a.key,t.file)))continue;try{await this.projects.removeArchive(a.id,{expiredOnly:true});}catch{failed++;}}if(failed)throw Error(failed+' 项到期归档暂未清理，已保留记录，可在归档区重试。');}
        finally{this.cleaning=false;this.pending=false;this.refreshControls();this.renderLibrary();}
    }
    showArchives(){
        this.archiveDialog?.remove();const dialog=element('dialog',undefined,'dw-rp-archives');this.archiveDialog=dialog;dialog.setAttribute('aria-label','已归档的角色项目与对话');
        const header=element('header');header.append(element('strong','已归档'));const close=button('关闭');close.onclick=()=>dialog.close();header.append(close);dialog.append(header,element('p','归档保留 30 天，到期后在下次启动时永久清理。','dw-rp-tree-hint'));
        const list=element('div');dialog.append(list);document.body.append(dialog);
        const render=()=>{list.replaceChildren();for(const a of this.projects.state.archive.filter(validArchive)){
            const row=element('div',undefined,'dw-rp-archive-row'),info=element('div');info.append(element('strong',a.kind==='project'?a.name:(a.chats[0]?.title||'对话')),element('small',(a.kind==='project'?'角色项目 · '+a.chats.length+' 个对话':a.name)+' · 剩余 '+Math.max(0,Math.ceil((a.at+ARCHIVE_RETENTION-Date.now())/86400000))+' 天'));
            const restore=button('恢复');restore.onclick=()=>void this.guard(async()=>{if(this.busy()||this.pending)throw Error('请先结束当前操作。');await this.mutate(()=>this.projects.restore(a.id));render();});
            const remove=button('永久删除');remove.classList.add('dw-danger-action');remove.onclick=()=>void this.guard(async()=>{const c=this.ctx(),yes=await c.callGenericPopup(element('p','永久删除这些归档对话？此操作无法恢复，角色卡不受影响。'),c.POPUP_TYPE.CONFIRM);if(yes!==c.POPUP_RESULT.AFFIRMATIVE)return;await this.mutate(()=>this.projects.removeArchive(a.id));render();});
            row.append(info,restore,remove);list.append(row);
        }if(!list.childElementCount)list.append(element('p','没有已归档内容。','dw-rp-tree-hint'));};render();dialog.showModal();
    }
    async switchTo(task){
        if(this.pending||this.busy())throw new Error('请先结束当前生成，再切换角色或故事。');
        if(document.getElementById('send_textarea')?.value.trim())throw new Error('输入框还有未发送内容，请先发送或清空后再切换；草稿未改动。');
        if(document.querySelector('#chat .edit_textarea'))throw new Error('请先完成当前消息编辑，再切换故事。');
        this.pending=true;
        try{const c=this.ctx();if(c.characterId!==undefined||c.groupId)await c.saveChat();await task();this.refresh();if(matchMedia('(max-width:800px)').matches){this.sidebar=false;this.applySidebar();}}
        finally{this.pending=false;this.refreshControls();this.renderLibrary();}
    }
    applySidebar(persist=true){this.library.hidden=!this.active||!this.sidebar;this.sheld.dataset.rpSidebar=String(this.sidebar);this.toggle.setAttribute('aria-expanded',String(this.sidebar));if(persist)this.persistLayout();}
    async action(n){
        const action=n.dataset.rpAction,c=this.ctx();if(this.pending)throw Error('正在保存或清理归档，请稍候。');
        if(action==='library-menu'){const r=n.getBoundingClientRect();this.showMenu([['添加 / 管理角色',()=>this.native('character')],['已归档',()=>this.showArchives()],[this.projects.state.avatars?'关闭悬浮头像':'开启悬浮头像',()=>this.mutate(()=>this.projects.commit(()=>{this.projects.state.avatars=!this.projects.state.avatars;}))]],r.left,r.bottom);}
        else if(action==='archives')this.showArchives();
        else if(action==='project-fold'){const key=n.dataset.key;this.projects.update(key,{collapsed:!this.projects.project(key).collapsed});writeUIPreference('roleplayProjects',this.projects.state);this.renderLibrary();if(!this.projects.project(key).collapsed)await this.loadProject(this.projects.entity(key));}
        else if(action==='project-menu'||action==='chat-menu'){const r=n.getBoundingClientRect();this.showProjectMenu(n.dataset.key,n.dataset.file,r.left,r.bottom);}
        else if(action==='chat-archive')await this.archiveItem(this.projects.entity(n.dataset.key),n.dataset.file);
        else if(action==='project-open'||action==='project-new'||action==='project-chat')await this.mutate(()=>this.openEntity(this.projects.entity(n.dataset.key),n.dataset.file,action==='project-new'));
        else if(action==='sidebar'){this.sidebar=!this.sidebar;this.applySidebar();if(this.sidebar)await this.loadChats();}
        else if(action==='right-close'){this.rightEntire=false;this.applyRight();this.persistLayout();}
        else if(action==='parameters-toggle'){if(!this.rightEntire||!this.rightOpen){this.rightEntire=true;this.rightOpen=true;this.rightTab='preset';this.quickParameters();}else this.rightEntire=false;this.applyRight();this.persistLayout();}
        else if(action==='all-settings'){await this.openSettings?.('models');}
        else if(action==='preset'){this.rightTab='preset';this.rightOpen=true;this.quickParameters();this.applyRight();this.persistLayout();}
        else if(ROLEPLAY_DRAWERS[action])await this.native(action);
        else if(action==='history'){if(this.busy())throw new Error('请先结束当前生成，再打开会话管理。');if(c.characterId===undefined&&!c.groupId)await this.native('character');else document.getElementById('option_select_chat')?.click();}
        else if(action==='new'){if(c.characterId===undefined&&!c.groupId)throw new Error('请先选择角色或群聊。');await this.mutate(()=>this.openEntity(this.currentEntity(),null,true));}
        else if(action==='novel')await this.onChatToNovel();
        else if(action==='more'){this.limit+=100;this.renderLibrary();await this.searchProjects();}
    }
}
