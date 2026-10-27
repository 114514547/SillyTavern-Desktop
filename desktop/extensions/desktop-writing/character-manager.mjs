import {icon} from './icons.mjs';
import {CharacterCards,characterDraft} from './character-manager-data.mjs';
import {world_names} from '/scripts/world-info.js';

const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const control=(text,action,glyph,cls='')=>{const n=el('button',undefined,'cm-button '+cls);n.type='button';n.dataset.cmAction=action;if(glyph)n.append(icon(glyph));n.append(el('span',text));return n;};
const thumb=avatar=>'/thumbnail?type=avatar&file='+encodeURIComponent(avatar);
const changed=(a,b)=>JSON.stringify(a)!==JSON.stringify(b);

export class CharacterManager{
    constructor({ctx,busy=()=>false,close,openNative,openWorld,status}){
        Object.assign(this,{ctx,busy,close,openNative,openWorld});this.cards=new CharacterCards({ctx});this.tab='profile';this.opening=0;this.filter='all';this.handlers=[];this.serial=0;this.avatarVersion=0;
        this.status=(text,error=false)=>{this.message=text;this.messageError=error;status(text,error);this.syncState();};
    }
    get dirty(){return !!this.draft&&changed(this.base,this.draft);}
    $(query){return this.host.querySelector(query);}
    async guard(work){try{return await work();}catch(error){this.status(error.message||'角色操作未完成，请重试。',true);return false;}}
    async mount(parent){
        this.host=el('div',undefined,'cm-workspace');
        this.host.innerHTML=`<aside class="cm-library" aria-label="角色库"><header><div class="cm-library-title"><strong>角色库</strong><small data-count></small></div><label class="cm-search"><input type="search" placeholder="搜索角色、标签…" aria-label="搜索角色与标签"></label><div class="cm-library-actions"></div></header><div class="cm-filters"><div></div><select aria-label="角色排序"><option value="recent">最近使用</option><option value="name">名称排序</option></select></div><div class="cm-list"></div><footer><small data-list-count></small><button type="button" class="cm-button cm-quiet" data-cm-action="native">更多管理</button></footer></aside>
        <section class="cm-editor" aria-label="角色详情"><div class="cm-identity"><button type="button" class="cm-cover" data-cm-action="cover" title="更换封面"><img alt="角色封面"><span>更换封面</span></button><div class="cm-identity-info"><div class="cm-name-line"><h3></h3><button type="button" class="cm-button cm-quiet" data-cm-action="rename" aria-label="重命名角色">重命名</button></div><div class="cm-subtitle"></div><div class="cm-tags"></div></div><div class="cm-identity-actions"></div></div>
        <nav class="cm-tabs" role="tablist" aria-label="角色编辑分页"></nav>
        <div class="cm-body"><div class="cm-pages">
        <section data-page="profile" role="tabpanel" id="dw-cm-profile" aria-labelledby="dw-cm-tab-profile"><h3>让角色鲜明起来</h3><p class="cm-hint">集中编辑人物设定，卡片资料随时在右侧查看。</p><div class="cm-short-fields"><label class="cm-field"><span>性格摘要</span><input data-field="personality" placeholder="简短、明确的人物性格"></label><label class="cm-field"><span>群聊发言倾向 <small>0–1</small></span><input type="number" min="0" max="1" step="0.05" data-field="talkativeness"></label></div><label class="cm-field cm-block"><span>角色描述 <small>外貌 · 经历 · 动机</small></span><textarea rows="9" data-field="description" placeholder="这个人是谁，以及他为什么会成为现在的样子。"></textarea><small data-counter="description"></small></label><label class="cm-field cm-block"><span>当前场景 <small>故事从哪里开始</small></span><textarea rows="5" data-field="scenario" placeholder="时间、地点，以及你们此刻正在面对的事。"></textarea><small data-counter="scenario"></small></label></section>
        <section data-page="opening" role="tabpanel" id="dw-cm-opening" aria-labelledby="dw-cm-tab-opening" hidden><h3>一句话，进入故事</h3><p class="cm-hint">编辑开场白，同时查看对话中的文字预览。</p><div class="cm-opening-tools"><select aria-label="选择开场白"></select><div></div></div><div class="cm-opening-grid"><label class="cm-field"><span>开场白</span><textarea rows="14" data-opening placeholder="角色对你说的第一句话……"></textarea></label><div class="cm-preview"><small>新对话 · 文字预览</small><div class="cm-preview-name"></div><div class="cm-preview-content"></div></div></div><label class="cm-field cm-block"><span>对话示例 <small>语气 · 节奏 · 表达方式</small></span><textarea rows="6" data-field="mes_example" placeholder="&lt;START&gt;&#10;{{user}}：……&#10;{{char}}：……"></textarea></label></section>
        <section data-page="advanced" role="tabpanel" id="dw-cm-advanced" aria-labelledby="dw-cm-tab-advanced" hidden><h3>更多控制，更少干扰</h3><p class="cm-hint">留空的覆盖项继续使用原生默认行为。</p><label class="cm-field"><span>角色专用系统提示</span><textarea rows="5" data-field="system_prompt"></textarea></label><label class="cm-field cm-block"><span>历史消息后的补充指令</span><textarea rows="5" data-field="post_history_instructions"></textarea></label><label class="cm-field cm-block"><span>深度提示</span><textarea rows="4" data-field="depth_prompt"></textarea></label><div class="cm-short-fields"><label class="cm-field"><span>注入深度</span><input type="number" min="0" max="1000" step="1" data-field="depth"></label><label class="cm-field"><span>注入身份</span><select data-field="depth_role"><option value="system">系统</option><option value="user">用户</option><option value="assistant">助手</option></select></label></div><p class="cm-hint">扩展专用字段和其他未编辑的数据保持原样。</p></section>
        </div><aside class="cm-support"><section><h4>卡片资料</h4><label class="cm-field"><span>作者</span><input data-field="creator" placeholder="未署名"></label><label class="cm-field"><span>版本</span><input data-field="character_version" placeholder="未设版本"></label><label class="cm-field"><span>卡片标签</span><input data-tags placeholder="用逗号分隔"></label></section><section><h4>关联世界书</h4><div data-world></div><button type="button" class="cm-button cm-quiet" data-cm-action="world">管理关联</button></section><section><details open><summary>创作者注释</summary><textarea rows="6" data-field="creator_notes" aria-label="创作者注释" placeholder="使用建议或版本说明……"></textarea></details></section><section><h4>内容概览</h4><div class="cm-stats"></div></section></aside></div>
        <footer class="cm-footer"><span role="status" data-save-status></span><div></div></footer></section><div class="cm-empty" hidden>选择一个角色，开始编辑。</div>`;
        parent.append(this.host);
        this.$('.cm-library-actions').append(control('新建角色','new','fa-plus'),control('导入','import','fa-download'));
        this.$('.cm-filters>div').append(control('全部','all',null,'cm-quiet'),control('收藏','favorites',null,'cm-quiet'));
        this.$('.cm-identity-actions').append(control('收藏','favorite',null,'cm-quiet'),control('开始对话','chat','fa-comments','cm-primary'),control('更多','more','fa-bars'));
        for(const [key,label]of [['profile','角色设定'],['opening','开场与示例'],['advanced','高级配置']]){const b=control(label,'tab');b.dataset.tab=key;b.id='dw-cm-tab-'+key;b.setAttribute('role','tab');b.setAttribute('aria-controls','dw-cm-'+key);this.$('.cm-tabs').append(b);}
        this.$('.cm-opening-tools>div').append(control('添加开场白','add-opening','fa-plus','cm-quiet'),control('移除','remove-opening',null,'cm-quiet'));
        this.$('.cm-footer>div').append(control('撤销本次修改','discard',null,'cm-quiet'),control('保存修改','save','fa-floppy-disk','cm-primary'));
        this.$('.cm-search input').oninput=()=>this.renderList();this.$('.cm-filters select').onchange=()=>this.renderList();
        this.$('.cm-opening-tools>select').onchange=e=>{this.opening=Number(e.target.value);this.renderOpening();};
        this.host.addEventListener('input',e=>{const n=e.target;if(!this.draft||this.working)return;if(n.dataset.field){this.draft[n.dataset.field]=n.type==='number'?Number(n.value):n.value;this.changed();}else if(n.hasAttribute('data-tags')){this.draft.tags=n.value.split(/[,，]/).map(x=>x.trim()).filter(Boolean);this.changed();}else if(n.hasAttribute('data-opening')){if(this.opening===0)this.draft.first_mes=n.value;else this.draft.alternate_greetings[this.opening-1]=n.value;this.changed();}});
        this.host.addEventListener('change',e=>{if(e.target.matches('select[data-field]')){this.draft[e.target.dataset.field]=e.target.value;this.changed();}});
        this.host.addEventListener('click',e=>{const n=e.target.closest('[data-cm-action]');if(n)void this.guard(()=>this.action(n.dataset.cmAction,n));});
        this.host.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();e.stopPropagation();void this.guard(()=>this.save());}if(e.target.closest('.cm-tabs')&&['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const tabs=[...this.host.querySelectorAll('.cm-tabs button')],i=tabs.indexOf(e.target),next=tabs[e.key==='Home'?0:e.key==='End'?2:(i+(e.key==='ArrowRight'?1:2))%3];this.setTab(next.dataset.tab);next.focus();}});
        this.file=el('input');this.file.type='file';this.file.hidden=true;this.file.accept='.png,.json,.yaml,.yml,.charx,.byaf';this.host.append(this.file);this.file.onchange=()=>void this.guard(()=>this.importFiles());
        this.coverFile=el('input');this.coverFile.type='file';this.coverFile.hidden=true;this.coverFile.accept='image/png,image/jpeg,image/webp';this.host.append(this.coverFile);this.coverFile.onchange=()=>void this.guard(()=>this.changeCover());
        const c=this.ctx();for(const name of ['CHARACTER_EDITED','CHARACTER_DUPLICATED','CHARACTER_DELETED','CHARACTER_PAGE_LOADED'])if(c.eventTypes[name]){const handler=()=>{if(!this.disposed&&!this.working&&!this.activating){this.renderList();if(!this.dirty){const characters=this.ctx().characters,avatar=characters.some(ch=>ch?.avatar===this.avatar)?this.avatar:characters.find(Boolean)?.avatar;if(avatar)void this.guard(()=>this.load(avatar));else this.empty();}}};c.eventSource.on(c.eventTypes[name],handler);this.handlers.push([c.eventTypes[name],handler]);}
        this.setTab('profile');this.renderList();const avatar=c.characters[c.characterId]?.avatar||c.characters.find(Boolean)?.avatar;if(avatar)await this.load(avatar);else this.empty();
    }
    empty(){this.draft=null;this.base=null;this.avatar=null;this.$('.cm-editor').hidden=true;this.$('.cm-empty').hidden=false;}
    renderList(){
        if(this.disposed)return;const query=this.$('.cm-search input').value.trim().toLocaleLowerCase();const all=this.ctx().characters.filter(Boolean),list=all.filter(ch=>{const d=ch.data||{},fav=!!(d.extensions?.fav??ch.fav);return(this.filter!=='favorites'||fav)&&[ch.name,d.creator,...(d.tags||ch.tags||[])].join(' ').toLocaleLowerCase().includes(query);});
        list.sort(this.$('.cm-filters select').value==='name'?(a,b)=>a.name.localeCompare(b.name,'zh-CN'):(a,b)=>(Number(b.date_last_chat)||0)-(Number(a.date_last_chat)||0));const root=this.$('.cm-list');root.replaceChildren();
        for(const ch of list){const b=control('','select');b.dataset.avatar=ch.avatar;b.className='cm-role';b.setAttribute('aria-pressed',String(ch.avatar===this.avatar));const img=el('img');img.src=thumb(ch.avatar);img.alt='';img.loading='lazy';const info=el('span',undefined,'cm-role-copy');info.append(el('strong',ch.name),el('small',(ch.data?.tags||ch.tags||[]).join(' · ')||'角色卡'));b.replaceChildren(img,info);if(ch.data?.extensions?.fav??ch.fav)b.append(el('span','☆','cm-star'));root.append(b);}
        if(!list.length)root.append(el('p',query?'没有匹配的角色。':'暂无角色，可新建或导入。','cm-hint'));
        this.$('[data-count]').textContent=String(all.length).padStart(2,'0');this.$('[data-list-count]').textContent=list.length+' / '+all.length+' 个角色';
        for(const b of this.host.querySelectorAll('.cm-filters [data-cm-action]'))b.setAttribute('aria-pressed',String(b.dataset.cmAction===this.filter));
    }
    async load(avatar){
        const serial=++this.serial;this.working=true;this.syncState();
        try{const card=await this.cards.read(avatar);if(this.disposed||serial!==this.serial)return;this.avatar=avatar;this.card=card;this.base=characterDraft(card);this.draft=structuredClone(this.base);this.opening=0;this.$('.cm-editor').hidden=false;this.$('.cm-empty').hidden=true;
            this.populate();this.renderList();this.status('角色修改通过原生接口保存。');
        }catch(error){if(!this.draft&&!this.disposed){this.empty();this.$('.cm-empty').textContent=error.message;}throw error;}
        finally{if(serial===this.serial){this.working=false;this.syncState();}}
    }
    populate(){for(const n of this.host.querySelectorAll('[data-field]'))n.value=this.draft[n.dataset.field];this.$('[data-tags]').value=this.draft.tags.join(', ');this.updateIdentity();this.renderOpening();}
    updateIdentity(){
        if(!this.draft)return;this.$('.cm-name-line h3').textContent=this.draft.name;this.$('.cm-cover img').src=thumb(this.avatar)+'&v='+this.avatarVersion;
        this.$('.cm-subtitle').textContent=(this.draft.creator||'未署名')+' · '+(this.draft.character_version?'v'+this.draft.character_version:'未设版本');
        this.$('.cm-tags').replaceChildren(...this.draft.tags.map(tag=>el('span',tag)));
        const favorite=this.$('[data-cm-action=favorite]');favorite.setAttribute('aria-pressed',String(this.draft.fav));favorite.querySelector('span').textContent=this.draft.fav?'已收藏':'收藏';
        const world=this.$('[data-world]'),select=el('select');world.classList.add('cm-field');select.dataset.field='world';select.setAttribute('aria-label','角色关联世界书');
        for(const name of ['',...new Set([...(world_names||[]),this.draft.world].filter(Boolean))]){const option=el('option',name||'未关联');option.value=name;select.append(option);}select.value=this.draft.world;world.replaceChildren(select);
        this.$('[data-cm-action=world]').textContent='打开世界书设置';
    }
    syncState(){
        if(!this.host||this.disposed)return;const pending=!!(this.working||this.activating);for(const n of this.host.querySelectorAll('input:not([type=file]),textarea,select,button'))n.disabled=pending;
        const save=this.$('[data-cm-action=save]'),discard=this.$('[data-cm-action=discard]');save.disabled=pending||!this.dirty;discard.disabled=pending||!this.dirty;
        this.$('[data-save-status]').textContent=pending?'正在处理…':this.message|| (this.dirty?'有未保存的修改':'已载入 · 修改后点击保存');this.$('[data-save-status]').classList.toggle('cm-dirty',this.dirty);this.$('[data-save-status]').classList.toggle('cm-error',!!this.messageError);
        if(this.draft){for(const n of this.host.querySelectorAll('[data-counter]'))n.textContent=this.draft[n.dataset.counter].length+' 字';const stats=this.$('.cm-stats');stats.replaceChildren();for(const [label,value]of [['设定字数',String(this.draft.description.length+this.draft.personality.length+this.draft.scenario.length)],['开场白',String(this.draft.alternate_greetings.length+1)]]){const row=el('div');row.append(el('span',label),el('span',value));stats.append(row);}}
    }
    changed(){this.message='';this.messageError=false;this.updateIdentity();this.updatePreview();this.syncState();}
    setTab(tab){this.tab=tab;for(const n of this.host.querySelectorAll('.cm-tabs button')){const active=n.dataset.tab===tab;n.setAttribute('aria-selected',String(active));n.tabIndex=active?0:-1;}for(const n of this.host.querySelectorAll('[data-page]'))n.hidden=n.dataset.page!==tab;this.$('.cm-pages').scrollTop=0;}
    renderOpening(){if(!this.draft)return;const texts=[this.draft.first_mes,...this.draft.alternate_greetings];this.opening=Math.max(0,Math.min(this.opening,texts.length-1));const select=this.$('.cm-opening-tools>select');select.replaceChildren(...texts.map((_,i)=>{const o=el('option',i===0?'默认开场白':'其他开场白 '+i);o.value=String(i);return o;}));select.value=String(this.opening);this.$('[data-opening]').value=texts[this.opening];this.$('[data-cm-action=remove-opening]').hidden=this.opening===0;this.updatePreview();this.syncState();}
    updatePreview(){if(!this.draft)return;this.$('.cm-preview-name').textContent=this.draft.name;const text=this.opening===0?this.draft.first_mes:this.draft.alternate_greetings[this.opening-1];this.$('.cm-preview-content').textContent=(text||'开场白预览会显示在这里。').replaceAll('{{char}}',this.draft.name).replaceAll('{{user}}',this.ctx().name1||'User');}
    async beforeLeave(){
        if(this.working||this.activating){this.status('正在处理角色操作，请稍候。',true);return false;}if(!this.dirty)return true;
        const c=this.ctx(),result=await c.callGenericPopup(el('p','当前角色有未保存的修改。保存后继续，或放弃本次修改。'),c.POPUP_TYPE.CONFIRM,'',{okButton:'保存并继续',cancelButton:'取消',customButtons:[{text:'放弃修改',result:2}]});
        if(result===c.POPUP_RESULT.AFFIRMATIVE){await this.save();return !this.dirty;}if(result===2){this.draft=structuredClone(this.base);this.message='';this.messageError=false;this.populate();return true;}return false;
    }
    assertIdle(){if(this.busy())throw Error('请先结束当前生成，再修改角色卡或切换对话。');if(this.working||this.activating)throw Error('角色操作正在进行，请稍候。');}
    async save(){
        this.assertIdle();if(!this.dirty)return;this.working=true;this.syncState();
        try{const stored=await this.cards.save(this.avatar,this.base,this.draft);if(this.disposed)return;this.card=stored;this.base=characterDraft(stored);this.draft=structuredClone(this.base);const c=this.ctx();await c.getOneCharacter(this.avatar);
            await c.eventSource.emit(c.eventTypes.CHARACTER_EDITED,{detail:{id:c.characters.findIndex(ch=>ch?.avatar===this.avatar),character:stored}});this.renderList();this.updateIdentity();this.status('角色修改已保存。');
        }finally{this.working=false;this.syncState();}
    }
    async activate(){
        this.assertIdle();const c=this.ctx();if(document.getElementById('send_textarea')?.value.trim())throw Error('聊天输入框还有未发送内容，请先发送或保留后再切换角色。');if(document.querySelector('#chat .edit_textarea'))throw Error('请先完成当前消息编辑。');
        this.activating=true;this.syncState();
        try{if(c.characterId!==undefined||c.groupId)await c.saveChat();const id=this.ctx().characters.findIndex(ch=>ch?.avatar===this.avatar);if(id<0)throw Error('角色卡已变化，请重新选择。');await this.ctx().selectCharacterById(id,{switchMenu:false});
            if(this.ctx().groupId||this.ctx().characters[this.ctx().characterId]?.avatar!==this.avatar)throw Error('原生服务暂未完成角色切换，请稍后重试。');
        }finally{this.activating=false;this.syncState();}
    }
    async settle(){this.assertIdle();return this.beforeLeave();}
    async action(action,node){
        if(this.working||this.activating)return;
        if(action==='tab'){this.setTab(node.dataset.tab);return;}
        if(action==='all'||action==='favorites'){this.filter=action;this.renderList();return;}
        if(action==='select'){if(node.dataset.avatar!==this.avatar&&await this.beforeLeave())await this.load(node.dataset.avatar);return;}
        if(action==='save')return this.save();
        if(action==='favorite'){this.draft.fav=!this.draft.fav;this.changed();return;}
        if(action==='add-opening'){this.draft.alternate_greetings.push('');this.opening=this.draft.alternate_greetings.length;this.renderOpening();this.changed();return;}
        if(action==='remove-opening'){if(this.opening){this.draft.alternate_greetings.splice(this.opening-1,1);this.opening--;this.renderOpening();this.changed();}return;}
        if(action==='discard'){const c=this.ctx(),yes=await c.callGenericPopup(el('p','撤销当前角色尚未保存的修改？'),c.POPUP_TYPE.CONFIRM);if(yes===c.POPUP_RESULT.AFFIRMATIVE)await this.load(this.avatar);return;}
        if(action==='more'){this.showMore(node);return;}
        if(action==='new')return this.create();
        if(action==='import'){if(await this.settle())this.file.click();return;}
        if(action==='cover'){if(await this.settle())this.coverFile.click();return;}
        if(action==='native'){if(!await this.settle())return;if(this.avatar){await this.activate();(await import('/script.js')).select_selected_character(this.ctx().characterId,{switchMenu:false});}return this.openNative();}
        if(action==='chat'){if(!await this.settle())return;await this.activate();return this.close();}
        if(action==='world'){if(await this.settle())return this.openWorld?.();return;}
        if(action==='rename')return this.rename();
        if(action==='duplicate'){if(!await this.settle())return;this.working=true;this.syncState();let avatar;try{avatar=await(await import('/script.js')).duplicateCharacter({avatar:this.avatar});}finally{this.working=false;this.syncState();}if(avatar)await this.load(avatar);return;}
        if(action==='export-json'||action==='export-png')return this.export(action==='export-json'?'json':'png');
        if(action==='delete')return this.delete();
    }
    showMore(anchor){
        this.menu?.remove();const menu=el('div',undefined,'cm-more-menu');menu.setAttribute('role','menu');
        for(const [label,action]of [['重命名角色','rename'],['复制角色卡','duplicate'],['导出 JSON','export-json'],['导出 PNG','export-png'],['更多原生功能','native'],['删除角色卡','delete']]){const b=control(label,action);b.setAttribute('role','menuitem');b.onclick=e=>{e.stopPropagation();menu.remove();void this.guard(()=>this.action(action,b));};menu.append(b);}
        this.host.append(menu);this.menu=menu;const r=anchor.getBoundingClientRect(),h=this.host.getBoundingClientRect();menu.style.right=Math.max(8,h.right-r.right)+'px';menu.style.top=Math.max(8,r.bottom-h.top+6)+'px';menu.querySelector('button').focus();
        menu.onkeydown=e=>{if(e.key==='Escape'){menu.remove();anchor.focus();}if(['ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();const items=[...menu.children],i=items.indexOf(document.activeElement);items[(i+(e.key==='ArrowDown'?1:items.length-1))%items.length].focus();}};
        const outside=e=>{if(!menu.contains(e.target)){menu.remove();document.removeEventListener('pointerdown',outside,true);}};document.addEventListener('pointerdown',outside,true);this.menuCleanup?.();this.menuCleanup=()=>document.removeEventListener('pointerdown',outside,true);
    }
    async create(){
        if(!await this.settle())return;const c=this.ctx(),name=await c.callGenericPopup(el('p','为新角色起一个名字。'),c.POPUP_TYPE.INPUT,'');if(typeof name!=='string'||!name.trim())return;this.working=true;this.syncState();let avatar;
        try{avatar=await this.cards.create(name.trim());await c.getCharacters();}finally{this.working=false;this.syncState();}await this.load(avatar);this.setTab('profile');
    }
    async importFiles(){
        const file=this.file.files[0];this.file.value='';if(!file)return;if(!await this.settle())return;this.working=true;this.syncState();let avatar;
        try{avatar=await this.cards.import(file);await this.ctx().getCharacters();}finally{this.working=false;this.syncState();}await this.load(avatar);
    }
    async changeCover(){
        const file=this.coverFile.files[0];this.coverFile.value='';if(!file)return;if(!await this.settle())return;this.working=true;this.syncState();
        try{await this.cards.cover(this.avatar,file);this.avatarVersion=Date.now();const c=this.ctx();await c.getOneCharacter(this.avatar);await c.eventSource.emit(c.eventTypes.CHARACTER_EDITED,{detail:{id:c.characters.findIndex(ch=>ch?.avatar===this.avatar),character:c.characters.find(ch=>ch?.avatar===this.avatar)}});}finally{this.working=false;this.syncState();}await this.load(this.avatar);
    }
    async rename(){
        if(!await this.settle())return;await this.activate();const c=this.ctx(),old=this.avatar,native=await import('/script.js');this.working=true;this.syncState();
        try{if(!await native.renameCharacter())return;this.avatar=this.ctx().characters[this.ctx().characterId]?.avatar||old;}
        finally{this.working=false;this.syncState();}await this.load(this.avatar);
    }
    async export(format){
        if(!await this.settle())return;const response=await this.cards.call('export',{avatar_url:this.avatar,format},{format:'response'}),blob=await response.blob(),url=URL.createObjectURL(blob),link=el('a');link.href=url;link.download=this.draft.name.replace(/[\\/:*?"<>|]/g,'_')+'.'+format;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);this.status('角色卡已导出。');
    }
    async delete(){
        if(!await this.settle())return;const c=this.ctx(),content=el('div');content.append(el('p','删除角色卡“'+this.draft.name+'”？此操作无法恢复。'));
        const label=el('label'),check=el('input');check.type='checkbox';label.append(check,el('span','同时删除该角色的全部聊天记录（含归档对话）'));content.append(label,el('p','默认保留聊天记录。','cm-hint'));
        const yes=await c.callGenericPopup(content,c.POPUP_TYPE.CONFIRM,'',{okButton:'删除角色卡',cancelButton:'取消'});if(yes!==c.POPUP_RESULT.AFFIRMATIVE)return;await this.activate();this.working=true;this.syncState();
        try{if(!await(await import('/script.js')).deleteCharacter(this.avatar,{deleteChats:check.checked}))throw Error('角色卡未删除。');}finally{this.working=false;this.syncState();}
        this.renderList();const avatar=this.ctx().characters.find(Boolean)?.avatar;if(avatar)await this.load(avatar);else this.empty();this.status('角色卡已删除。');
    }
    dispose(){this.disposed=true;this.serial++;this.menu?.remove();this.menuCleanup?.();for(const [event,handler]of this.handlers)this.ctx().eventSource.removeListener(event,handler);}
}
