import {readUIPreference,writeUIPreference} from './ui-preferences.mjs';
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const button=(text,action)=>{const n=el('button',text,'menu_button');n.type='button';if(action)n.dataset.action=action;return n;};

export const SVG_PLUS = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>`;
export const SVG_FOLDER_PLUS = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path><line x1="12" y1="11" x2="12" y2="17"></line><line x1="9" y1="14" x2="15" y2="14"></line></svg>`;
export const SVG_ANGLES_LEFT = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="11 17 6 12 11 7"></polyline><polyline points="18 17 13 12 18 7"></polyline></svg>`;
export const SVG_ANGLES_RIGHT = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="13 17 18 12 13 7"></polyline><polyline points="6 17 11 12 6 7"></polyline></svg>`;
export const SVG_TRASH = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>`;
export const SVG_XMARK = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
export const SVG_ARROW_UP = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline></svg>`;

export class AgentLayout {
    constructor(owner){this.ui=owner;this.fileOpen=true;this.projectsOpen=true;}
    mount(){
        const u=this.ui,$=s=>u.$(s),main=$('#agent-main'),toolbar=$('#agent-toolbar');
        this.sidebar=el('nav',undefined,'agent-sidebar');this.sidebar.id='agent-sidebar';this.sidebar.setAttribute('aria-label','项目与讨论');
        const head=el('header',undefined,'agent-sidebar-header');
        const titleRow=el('div',undefined,'agent-sidebar-title-row');
        titleRow.append(el('span','项目与讨论','agent-sidebar-title'));
        const tools=el('div',undefined,'agent-sidebar-tools');
        const newThreadBtn=$('[data-action="new"]');
        newThreadBtn.className='menu_button agent-tool-btn';
        newThreadBtn.title='新建讨论';
        newThreadBtn.setAttribute('aria-label', '新建讨论');
        newThreadBtn.innerHTML=SVG_PLUS;
        const addSeriesBtn=button('','choose');
        addSeriesBtn.className='menu_button agent-tool-btn';
        addSeriesBtn.title='＋ 添加本地系列文件夹';
        addSeriesBtn.setAttribute('aria-label', '添加本地系列文件夹');
        addSeriesBtn.innerHTML=SVG_FOLDER_PLUS;
        const collapseBtn=button('','projects');
        collapseBtn.className='menu_button agent-tool-btn';
        collapseBtn.title='收起侧边栏';
        collapseBtn.setAttribute('aria-label', '收起侧边栏');
        collapseBtn.innerHTML=SVG_ANGLES_LEFT;
        tools.append(newThreadBtn,addSeriesBtn,collapseBtn);
        titleRow.append(tools);
        head.append(titleRow);
        this.projects=el('div',undefined,'agent-projects-scroll');
        this.sidebar.append(head,this.projects);main.prepend(this.sidebar);
        this.sidebar.append($('#agent-status'));

        this.right=el('aside');this.right.id='agent-files-panel';this.right.setAttribute('aria-label','本地文档');
        const rightHeader=el('header',undefined,'agent-files-header');
        const rfTitle=el('span','本地文档','agent-files-title');
        const rfCollapse=button('','files');
        rfCollapse.className='menu_button agent-tool-btn';
        rfCollapse.title='收起文档栏';
        rfCollapse.setAttribute('aria-label', '收起文档栏');
        rfCollapse.innerHTML=SVG_ANGLES_RIGHT;
        rightHeader.append(rfTitle,rfCollapse);
        this.filter=el('input',undefined,'text_pole agent-filter-input');
        this.filter.placeholder='🔍 筛选当前目录文件名';this.filter.setAttribute('aria-label','筛选文件名');this.filter.oninput=()=>this.filterFiles();
        this.files=el('div');this.files.id='agent-files';this.right.append(rightHeader,this.filter,this.files,$('#agent-viewer'));main.append(this.right);
        this.viewerGrip=el('div',undefined,'agent-row-resizer');this.viewerGrip.tabIndex=0;this.viewerGrip.setAttribute('role','separator');this.viewerGrip.setAttribute('aria-label','调整文档预览高度');this.viewerGrip.setAttribute('aria-orientation','horizontal');$('#agent-viewer').before(this.viewerGrip);
        const viewer=$('#agent-viewer');let viewerHeight=320;
        const viewerHead=viewer.querySelector('header'),maximize=button('↕'),fold=button('▾');maximize.title='全高展开或还原文档预览';maximize.setAttribute('aria-label',maximize.title);fold.title='折叠或展开文档预览';fold.setAttribute('aria-label',fold.title);viewerHead.append(maximize,fold);
        maximize.onclick=()=>{this.right.dataset.viewerMax=String(this.right.dataset.viewerMax!=='true');this.right.dataset.viewerCollapsed='false';};fold.onclick=()=>{this.right.dataset.viewerCollapsed=String(this.right.dataset.viewerCollapsed!=='true');this.right.dataset.viewerMax='false';};
        const applyHeight=value=>{viewerHeight=Math.max(90,Math.min(Math.max(90,this.right.clientHeight-40),value));viewer.style.flexBasis=viewerHeight+'px';this.viewerGrip.setAttribute('aria-valuenow',Math.round(viewerHeight));};
        this.viewerGrip.onpointerdown=e=>{if(e.button!==0)return;e.preventDefault();const start=e.clientY,height=viewer.getBoundingClientRect().height;this.viewerGrip.setPointerCapture(e.pointerId);this.viewerGrip.onpointermove=v=>applyHeight(height+start-v.clientY);this.viewerGrip.onpointerup=this.viewerGrip.onpointercancel=()=>{this.viewerGrip.onpointermove=null;};};
        this.viewerGrip.onkeydown=e=>{if(['ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();applyHeight(viewerHeight+(e.key==='ArrowUp'?20:-20));}};
        const chat=$('#agent-chat');main.insertBefore(chat,this.right);
        this.resize(this.sidebar,'left',180,420,240);this.resize(this.right,'right',270,650,340);
        $('#agent-workspace').dataset.action='projects';$('#agent-workspace').title='展开或收起项目与讨论';$('[data-action="threads"]').remove();
        const settings=$('[data-action="settings"]');settings.textContent='预设与参考';
        const actions=$('#agent-input-actions');
        const form=$('#agent-form');

        const dockFooter=el('div',undefined,'agent-dock-footer');
        dockFooter.id='agent-dock-footer';

        this.controls=el('div',undefined,'agent-controls');
        this.controls.id='agent-controls';
        this.preset=el('select',undefined,'text_pole agent-pill-select');
        this.preset.setAttribute('aria-label','当前 Agent 预设');
        this.preset.onchange=()=>{u.bank().selected=Number(this.preset.value);u.dirty();u.renderRefs();};
        this.model=button('当前模型','model');this.model.id='agent-model';this.model.title='点击切换或配置模型';
        this.thinking=el('select',undefined,'text_pole agent-pill-select');
        this.thinking.setAttribute('aria-label','当前思考模式');
        for(const [v,t]of [['inherit','思考：沿用连接'],['on','思考：开启'],['off','思考：关闭']]){const o=el('option',t);o.value=v;this.thinking.append(o);}
        this.thinking.onchange=()=>{u.bank().presets[u.bank().selected].reasoning=this.thinking.value;u.dirty();};

        const filesBtn=actions.querySelector('[data-action="files"]');
        this.controls.append(this.model,this.preset,this.thinking,settings);
        if(filesBtn)this.controls.append(filesBtn);

        this.metrics=el('small',undefined,'agent-metrics');
        this.metrics.id='agent-metrics';
        actions.prepend(this.metrics);
        const write=actions.querySelector('label');if(write){write.id='agent-write-control';$('#agent-refs').append(write);}

        dockFooter.append(this.controls,actions);
        form.append(dockFooter);

        this.rename=el('input',undefined,'text_pole');this.rename.id='agent-thread-name';this.rename.maxLength=200;this.rename.setAttribute('aria-label','讨论名称');this.rename.onchange=()=>{if(!u.thread||u.job)return;u.thread.title=this.rename.value.trim()||'新讨论';u.thread.customTitle=true;u.dirty();this.renderSidebar();};const oldTitle=$('#agent-thread-title');oldTitle.hidden=true;oldTitle.before(this.rename);
        $('#agent-threadbar').prepend(toolbar);
        this.rootName=el('input',undefined,'text_pole');this.rootName.maxLength=100;this.rootName.setAttribute('aria-label','系列显示名称');
        const drawer=$('#agent-drawer');drawer.setAttribute('role','dialog');drawer.setAttribute('aria-label','Agent 预设与参考设置');
        drawer.addEventListener('cancel',e=>{e.preventDefault();u.drawer='';u.renderDrawer();});
        u.shadow.addEventListener('keydown',e=>{if(e.key==='Escape'&&u.drawer==='settings'){u.drawer='';u.renderDrawer();}});
        u.shadow.addEventListener('click',e=>{const n=e.target.closest('[data-starter]');if(n){$('#agent-input').value=n.dataset.starter;u.thread.draft=n.dataset.starter;u.dirty();$('#agent-input').focus();}});
        const media=matchMedia('(max-width:800px)'),responsive=()=>{
            if(media.matches){if(!this.wideLayout)this.wideLayout={projects:this.projectsOpen,files:this.fileOpen};if(this.projectsOpen)this.toggleProjects();this.toggleFiles(false);}
            else if(this.wideLayout){const previous=this.wideLayout;this.wideLayout=null;if(this.projectsOpen!==previous.projects)this.toggleProjects();this.toggleFiles(previous.files);}
        };media.addEventListener('change',responsive);responsive();
    }
    resize(panel,key,min,max,initial){
        const u=this.ui,grip=el('div');grip.className='agent-resizer';grip.tabIndex=0;grip.setAttribute('role','separator');grip.setAttribute('aria-label',key==='left'?'调整项目栏宽度':'调整文档栏宽度');grip.setAttribute('aria-orientation','vertical');
        let width=initial;try{width=Math.max(min,Math.min(max,Number(readUIPreference('agentWidth-'+key,initial,'desktop-agent-'+key))||initial));}catch{}
        const apply=value=>{width=Math.max(min,Math.min(max,value));panel.style.flexBasis=width+'px';grip.setAttribute('aria-valuenow',width);};apply(width);
        const save=()=>writeUIPreference('agentWidth-'+key,width);
        if(key==='left')panel.after(grip);else panel.before(grip);this[key+'Grip']=grip;
        grip.onpointerdown=e=>{const x=e.clientX,start=width;grip.setPointerCapture(e.pointerId);grip.onpointermove=v=>apply(start+(v.clientX-x)*(key==='left'?1:-1));grip.onpointerup=()=>{grip.onpointermove=null;save();};};grip.onkeydown=e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();apply(width+(e.key==='ArrowRight'?12:-12)*(key==='left'?1:-1));save();}};
    }
    toggleProjects(){this.projectsOpen=!this.projectsOpen;this.sidebar.hidden=!this.projectsOpen;this.leftGrip.hidden=!this.projectsOpen;}
    setZen(enabled){
        if(enabled&&!this.beforeZen){this.beforeZen={projects:this.projectsOpen,files:this.fileOpen};if(this.projectsOpen)this.toggleProjects();this.toggleFiles(false);}
        else if(!enabled&&this.beforeZen){const previous=this.beforeZen;this.beforeZen=null;if(this.projectsOpen!==previous.projects)this.toggleProjects();this.toggleFiles(previous.files);}
    }
    toggleFiles(open=!this.fileOpen){this.fileOpen=open;this.right.hidden=!open;this.rightGrip.hidden=!open;if(open)void this.ui.guard(()=>this.renderFiles());}
    renderSidebar(){
        const u=this.ui;this.projects.replaceChildren();
        for(const root of [null,...u.data.roots]){
            const group=el('section',undefined,'agent-project-group');
            const row=el('div',undefined,'agent-project-row');
            const pick=button((root?'📂 ':'💭 ')+(root?root.name:'独立讨论'));
            pick.dataset.root=root?.id||'none';
            pick.setAttribute('aria-pressed',String((root?.id||null)===u.data.currentRoot));
            pick.title=root?.path||'不连接资料文件夹';
            pick.className='agent-project-btn menu_button';
            row.append(pick);
            row.oncontextmenu = e => {
                e.preventDefault();
                e.stopPropagation();
                u.showContextMenu(e, { type: 'root', id: root?.id || null, name: root?.name || '独立讨论' });
            };
            if(root){
                const del=button('');
                del.dataset.removeRoot=root.id;
                del.title='移除系列绑定（不会删除本地文件）';
                del.setAttribute('aria-label', '移除系列绑定');
                del.className='agent-item-del menu_button';
                del.innerHTML=SVG_XMARK;
                row.append(del);
            }
            group.append(row);
            if((root?.id||null)===u.data.currentRoot){
                const threads=u.data.threads.filter(t=>t.rootId===(root?.id||null)).sort((a,b)=>(b.updated||'').localeCompare(a.updated||''));
                const threadList=el('div',undefined,'agent-threads-container');
                for(const t of threads){
                    const tr=el('div',undefined,'agent-thread-row');
                    const n=button(t.title||'新讨论');
                    n.dataset.thread=t.id;
                    n.setAttribute('aria-pressed',String(t===u.thread));
                    n.className='agent-project-thread menu_button';
                    tr.oncontextmenu = e => {
                        e.preventDefault();
                        e.stopPropagation();
                        u.showContextMenu(e, { type: 'thread', id: t.id, title: t.title || '新讨论' });
                    };
                    const del=button('');
                    del.dataset.deleteThread=t.id;
                    del.title='删除此讨论';
                    del.setAttribute('aria-label', '删除此讨论');
                    del.className='agent-item-del menu_button';
                    del.innerHTML=SVG_TRASH;
                    tr.append(n,del);
                    threadList.append(tr);
                }
                group.append(threadList);
            }
            this.projects.append(group);
        }
    }
    render(){this.renderSidebar();this.rename.value=this.ui.thread?.title||'新讨论';this.ui.$('#agent-thread-title').textContent=this.rename.value;this.rename.disabled=!!this.ui.job;void this.ui.guard(()=>this.renderFiles());}
    renderControls(){
        const u=this.ui;if(!u.thread)return;const bank=u.bank();this.preset.replaceChildren();bank.presets.forEach((p,i)=>{const n=el('option',p.name);n.value=i;this.preset.append(n);});this.preset.value=bank.selected;this.preset.disabled=!!u.job;this.thinking.value=bank.presets[bank.selected].reasoning;this.thinking.disabled=!!u.job;this.model.disabled=!!u.job;
        const last=u.thread.messages.filter(m=>m.role==='assistant').at(-1),history=last?.generationInfo?.history;this.metrics.textContent=(history?`上轮带入历史 ${history.kept}/${history.total} 组 · `:'')+(last?.usage?`本次输入 ${last.usage.input??'—'} · 缓存命中 ${last.usage.hit??'未提供'} · 输出 ${last.usage.output??'—'} tokens`: '缓存统计：接口未提供');
        const thread=u.thread;void import('/scripts/openai.js').then(n=>{if(u.thread===thread)this.model.textContent=u.ctx().mainApi==='openai'?'模型：'+n.getChatCompletionModel():'模型：当前原生连接';}).catch(()=>{});
    }
    async renderFiles(){
        const u=this.ui,root=u.root,marker=crypto.randomUUID();this.fileRender=marker;if(!this.fileOpen)return;this.files.replaceChildren();
        if(!root){this.files.append(el('p','选择左侧系列后，可在这里浏览本地文档。','agent-files-empty'));return;}
        const listing=await u.bridge('list',{rootId:root.id,path:u.directory});if(this.fileRender!==marker||u.root!==root)return;
        this.files.replaceChildren();
        const breadcrumb=el('div',undefined,'agent-files-breadcrumb');
        const path=el('span',root.name+(u.directory?' / '+u.directory:''),'agent-files-path');
        path.title=root.path;
        breadcrumb.append(path);
        if(u.directory){
            const back=button('返回上级');
            back.className='agent-files-back menu_button';
            back.dataset.directory=u.directory.split('/').slice(0,-1).join('/');
            back.innerHTML=SVG_ARROW_UP + ' <span>返回上级</span>';
            breadcrumb.append(back);
        }
        this.files.append(breadcrumb);
        const listContainer=el('div',undefined,'agent-file-tree');
        for(const f of listing.entries){
            const row=el('div',undefined,'agent-file-row');
            const n=button((f.type==='directory'?'📁 ':'📄 ')+f.name);
            n.className='agent-file-btn menu_button';
            row.dataset.filename=f.name.toLocaleLowerCase();
            if(f.type==='directory')n.dataset.directory=f.path;
            else n.dataset.file=f.path;
            row.append(n);
            if(f.type==='file'){
                const attach=button('');
                attach.className='agent-file-attach menu_button';
                attach.title='引用到当前问题';
                attach.dataset.attach=f.path;
                attach.innerHTML=SVG_PLUS;
                row.append(attach);
            }
            listContainer.append(row);
        }
        this.files.append(listContainer);
        if(!listing.entries.length)this.files.append(el('p','此目录暂无支持的文本文件。','agent-files-empty'));
        if(listing.limited)this.files.append(el('small','目录展示已截断，可进入子目录继续查找。'));
        if(u.pending.length){
            const d=el('details',undefined,'agent-pending-details');
            d.open=true;
            d.append(el('summary','待保存修改 · '+u.pending.length));
            for(const p of u.pending){
                const n=button(p.path);
                n.dataset.pendingProposal=p.id;
                d.append(n);
            }
            this.files.append(d);
        }
        this.filterFiles();
    }
    filterFiles(){const query=this.filter.value.trim().toLocaleLowerCase();for(const row of this.files.querySelectorAll('[data-filename]'))row.hidden=!row.dataset.filename.includes(query);}
    viewerChanged(){const u=this.ui;this.viewerGrip.hidden=!u.viewer;this.right.classList.toggle('has-document',!!u.viewer);if(u.viewer){this.fileOpen=true;this.right.hidden=false;this.rightGrip.hidden=false;}}
    welcome(parent){for(const text of ['梳理这个系列的资料结构','结合资料讨论人物动机','检查设定之间的矛盾']){const n=button(text);n.dataset.starter=text;parent.append(n);}}
}
