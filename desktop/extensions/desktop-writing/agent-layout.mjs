import {readUIPreference,writeUIPreference} from './ui-preferences.mjs';
import {icon} from './icons.mjs';
import {generationPanel} from './assistant-ui.mjs';
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
    constructor(owner){this.ui=owner;const panels=readUIPreference('agentPanels',{});this.fileOpen=panels.files!==false;this.projectsOpen=panels.projects!==false;}
    mount(){
        const u=this.ui,$=s=>u.$(s),main=$('#agent-main');this.inspectorTab='files';
        this.sidebar=el('nav',undefined,'agent-sidebar');this.sidebar.id='agent-sidebar';this.sidebar.setAttribute('aria-label','项目与讨论');
        const head=el('header',undefined,'agent-sidebar-header'),titleRow=el('div',undefined,'agent-sidebar-title-row'),tools=el('div',undefined,'agent-sidebar-tools');titleRow.append(el('span','项目与讨论','agent-sidebar-title'));
        const newThread=$('[data-action=new]');newThread.className='menu_button agent-tool-btn';newThread.replaceChildren(icon('fa-plus'));newThread.title='新建讨论';newThread.setAttribute('aria-label',newThread.title);
        const choose=button('','choose');choose.className='menu_button agent-tool-btn';choose.append(icon('fa-folder-open'));choose.title='连接本地资料文件夹';choose.setAttribute('aria-label',choose.title);
        tools.append(newThread,choose);titleRow.append(tools);head.append(titleRow);this.projects=el('div',undefined,'agent-projects-scroll');this.sidebar.append(head,this.projects);main.prepend(this.sidebar);
        this.right=el('aside');this.right.id='agent-files-panel';this.right.setAttribute('aria-label','文件与预览');const rightHead=el('header',undefined,'agent-files-header');this.inspectorTabs=el('nav',undefined,'agent-inspector-tabs');this.inspectorTabs.setAttribute('role','tablist');
        for(const [key,label]of [['files','文件'],['reads','查阅'],['context','上下文']]){const tab=button(label);tab.dataset.inspector=key;tab.setAttribute('role','tab');tab.onclick=()=>this.inspect(key);this.inspectorTabs.append(tab);}const close=button('','files');close.className='menu_button agent-tool-btn';close.append(icon('fa-xmark'));close.title='收起文件与预览';close.setAttribute('aria-label',close.title);rightHead.append(this.inspectorTabs,close);
        this.filter=el('input',undefined,'text_pole agent-filter-input');this.filter.placeholder='筛选当前目录文件名';this.filter.setAttribute('aria-label','筛选文件名');this.filter.oninput=()=>this.filterFiles();this.files=el('div');this.files.id='agent-files';this.info=el('div',undefined,'agent-inspector-info');
        const viewer=$('#agent-viewer');viewer.querySelector('header [data-action=close-viewer]')?.remove();const back=button('返回文件','close-viewer');back.className='menu_button agent-viewer-back';back.prepend(icon('fa-arrow-left'));viewer.querySelector('header').prepend(back);const searchForm=el('form',undefined,'agent-content-search'),query=el('input',undefined,'text_pole'),scope=el('select',undefined,'text_pole'),submit=el('button','全文搜索','menu_button');
        query.type='search';query.placeholder='搜索文档内容';query.setAttribute('aria-label','全文搜索关键词');query.maxLength=200;
        for(const [value,label]of [['directory','当前目录'],['workspace','整个授权工作区']]){const item=el('option',label);item.value=value;scope.append(item);}scope.setAttribute('aria-label','全文搜索范围');submit.type='submit';searchForm.append(query,scope,submit);
        this.searchResults=el('div',undefined,'agent-search-results');this.searchResults.setAttribute('role','status');
        searchForm.onsubmit=e=>{e.preventDefault();void u.guard(async()=>{if(!u.root)throw Error('请先选择授权工作区。');if(!query.value.trim())throw Error('请输入全文搜索关键词。');const root=u.root,directory=u.directory,marker=crypto.randomUUID();this.searchMarker=marker;submit.disabled=true;this.searchResults.textContent='正在搜索文档内容…';try{const found=await u.bridge('search',{rootId:root.id,path:scope.value==='workspace'?'':directory,query:query.value.trim()});if(this.searchMarker!==marker||u.root!==root||u.directory!==directory)return;this.searchResults.replaceChildren(el('p',found.results.length+' 条结果'+(found.limited?' · 结果或扫描范围已截断，请缩小范围':'')+' · 已扫描 '+found.scanned+' 个文件'));for(const result of found.results){const row=button('');row.append(el('strong',result.path),el('span',result.snippet));row.onclick=()=>void u.guard(()=>u.openFile(result.path));this.searchResults.append(row);}}catch(error){if(this.searchMarker===marker)this.searchResults.textContent=error.message;throw error;}finally{submit.disabled=false;}});};
        this.searchForm=searchForm;this.right.append(rightHead,this.filter,searchForm,this.searchResults,this.files,viewer,this.info);main.append(this.right);
        const chat=$('#agent-chat');main.insertBefore(chat,this.right);this.resize(this.sidebar,'left',180,420,248);this.resize(this.right,'right',270,650,340);
        const bar=$('#agent-threadbar');this.leftToggle=button('','projects');this.leftToggle.className='menu_button agent-panel-toggle';this.leftToggle.append(icon('fa-panel-left'));this.leftToggle.setAttribute('aria-controls','agent-sidebar');this.rightToggle=button('','files');this.rightToggle.className='menu_button agent-panel-toggle';this.rightToggle.append(icon('fa-panel-right'));this.rightToggle.setAttribute('aria-controls','agent-files-panel');
        const title=el('div',undefined,'agent-heading');this.crumb=el('small');this.rename=el('input',undefined,'text_pole');this.rename.id='agent-thread-name';this.rename.maxLength=200;this.rename.setAttribute('aria-label','讨论名称');this.rename.onchange=()=>{if(!u.thread||u.job)return;u.thread.title=this.rename.value.trim()||'新讨论';u.thread.customTitle=true;u.dirty();this.renderSidebar();};title.append(this.crumb,this.rename);
        const hiddenWorkspace=$('#agent-workspace');hiddenWorkspace.hidden=true;const oldTitle=$('#agent-thread-title');oldTitle.hidden=true;const saveState=$('#agent-save-status');saveState.setAttribute('role','status');const topNew=button('','new');topNew.className='menu_button agent-tool-btn';topNew.append(icon('fa-plus'));topNew.title='新建讨论';topNew.setAttribute('aria-label',topNew.title);const more=button('');more.className='menu_button agent-tool-btn';more.append(icon('fa-ellipsis'));more.title='讨论操作';more.setAttribute('aria-label',more.title);more.dataset.agentMenu='true';more.onclick=()=>{if(!u.thread)return;const r=more.getBoundingClientRect();u.showContextMenu({clientX:r.left,clientY:r.bottom+5},{type:'thread',id:u.thread.id,title:u.thread.title});};
        const settings=$('[data-action=settings]');$('#agent-toolbar').remove();bar.replaceChildren(this.leftToggle,title,topNew,more,this.rightToggle,oldTitle,saveState,hiddenWorkspace);
        const actions=$('#agent-input-actions'),form=$('#agent-form'),dock=el('div');dock.id='agent-dock-footer';this.controls=el('div');this.controls.id='agent-controls';
        const files=actions.querySelector('[data-action=files]');files.dataset.action='attach-files';files.replaceChildren(icon('fa-paperclip'));files.title='引用资料';files.setAttribute('aria-label',files.title);files.className='menu_button agent-tool-btn';
        const write=actions.querySelector('label');write.hidden=true;form.append(write);this.permission=button('仅讨论','permissions');this.permission.id='agent-permission';this.preset=settings;this.preset.replaceChildren(icon('fa-sliders'),el('span','预设'));this.preset.title='编辑当前用途的预设与参考';this.model=button('当前模型','model');this.model.id='agent-model';this.model.title='选择或配置模型连接';this.controls.append(files,this.permission,this.preset);
        actions.prepend(this.model);dock.append(this.controls,actions);this.metrics=el('small');this.metrics.id='agent-metrics';form.append(dock,this.metrics);chat.append($('#agent-status'));
        const send=$('#agent-send');send.replaceChildren(icon('fa-arrow-up'));send.setAttribute('aria-label','发送');send.title='发送 · Enter';$('#agent-input').rows=2;$('#agent-input').placeholder='讨论设定，或让我查阅这份资料…';$('#agent-input').addEventListener('input',()=>this.resizeInput());
        window.addEventListener('resize',()=>this.resizeInput());document.addEventListener('desktop-theme-changed',()=>this.resizeInput());
        u.shadow.addEventListener('keydown',e=>{if(e.altKey&&['BracketLeft','BracketRight'].includes(e.code)){e.preventDefault();e.code==='BracketLeft'?this.toggleProjects():this.toggleFiles();}const nav=e.target.closest('.agent-inspector-tabs');if(nav&&['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const all=[...nav.children],at=all.indexOf(e.target),next=e.key==='Home'?0:e.key==='End'?all.length-1:(at+(e.key==='ArrowRight'?1:all.length-1))%all.length;all[next].click();all[next].focus();}});
        u.shadow.addEventListener('click',e=>{const n=e.target.closest('[data-starter]');if(n){$('#agent-input').value=n.dataset.starter;u.thread.draft=n.dataset.starter;u.dirty();this.resizeInput();$('#agent-input').focus();}});
        const media=matchMedia('(max-width:800px)'),responsive=()=>{if(media.matches){if(!this.wideLayout)this.wideLayout={projects:this.projectsOpen,files:this.fileOpen};if(this.projectsOpen)this.toggleProjects();this.toggleFiles(false);}else if(this.wideLayout){const previous=this.wideLayout;this.wideLayout=null;if(this.projectsOpen!==previous.projects)this.toggleProjects();this.toggleFiles(previous.files);}};media.addEventListener('change',responsive);responsive();this.syncPanels();this.renderInspector();
    }
    resizeInput(){const input=this.ui.$('#agent-input');input.style.height='auto';input.style.height=Math.max(54,Math.min(180,input.scrollHeight))+'px';}
    syncPanels(){this.sidebar.hidden=!this.projectsOpen;this.leftGrip.hidden=!this.projectsOpen;this.right.hidden=!this.fileOpen;this.rightGrip.hidden=!this.fileOpen;for(const [button,open,label]of [[this.leftToggle,this.projectsOpen,'项目与讨论'],[this.rightToggle,this.fileOpen,'文件与预览']]){if(!button)continue;button.setAttribute('aria-expanded',String(open));button.title=(open?'收起':'展开')+label;button.setAttribute('aria-label',button.title);}}
    inspect(tab,message){this.inspectorTab=tab;if(message)this.inspectedMessage=message;this.fileOpen=true;this.right.hidden=false;this.rightGrip.hidden=false;this.syncPanels();this.renderInspector();if(tab==='files')void this.ui.guard(()=>this.renderFiles());}
    get inspection(){const u=this.ui;if(this.inspectedMessage&&u.thread?.messages.includes(this.inspectedMessage))return this.inspectedMessage;if(u.job)return{records:u.job.records,citations:u.job.task.citations,text:u.job.task.text,contextInfo:u.job.task.contextInfo,generationInfo:u.job.task.assistant?.info,usage:u.job.task.usage,performance:{...u.job.task.performance,totalMs:Math.round(performance.now()-u.job.task.performanceStarted)}};return u.thread?.messages.filter(m=>m.role==='assistant').at(-1)||{};}
    sources(message){const sources=new Map();for(const citation of message.citations||[])sources.set(citation.path,{...citation});for(const record of message.records||[])if(record.tool==='read_file'&&record.ok&&!sources.has(record.path))sources.set(record.path,{path:record.path,totalCharacters:record.totalCharacters});return [...sources.values()];}
    showActions(anchor,items){const u=this.ui;u.closeContextMenu();const menu=el('div',undefined,'agent-context-menu');u.contextMenu=menu;u.menuReturnFocus=anchor;menu.setAttribute('role','menu');for(const [text,work]of items){const b=button(text);b.className='agent-context-menu-item';b.setAttribute('role','menuitem');b.onclick=()=>{u.closeContextMenu();void u.guard(work);};menu.append(b);}u.shadow.append(menu);const r=anchor.getBoundingClientRect();menu.style.left=Math.max(8,Math.min(innerWidth-menu.offsetWidth-8,r.left))+'px';menu.style.top=Math.max(8,Math.min(innerHeight-menu.offsetHeight-8,r.bottom+5))+'px';menu.querySelector('button')?.focus();}
    readingSummary(message){const sources=this.sources(message),full=sources.filter(s=>s.ranges?.[0]?.[0]===0&&s.ranges[0][1]===s.totalCharacters).length,details=el('details',undefined,'agent-reading-summary');details.append(el('summary','查阅 '+sources.length+' 份 · 完整覆盖 '+full+' 份 · '+(message.records?.length||0)+' 项操作'));const body=el('div',undefined,'agent-inline-sources');for(const source of sources){const b=button(source.path,'file');b.dataset.file=source.path;b.prepend(icon('fa-file-lines'));body.append(b);}const open=button('在侧栏查看完整记录');open.onclick=()=>this.inspect('reads',message);body.append(open);details.append(body);return details;}
    renderInspector(){
        const u=this.ui,files=this.inspectorTab==='files';if(!this.info)return;for(const tab of this.inspectorTabs.children){const selected=tab.dataset.inspector===this.inspectorTab;tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;}this.searchForm.hidden=!files||!!u.viewer;this.searchResults.hidden=!files||!!u.viewer;this.filter.hidden=!files||!!u.viewer;this.files.hidden=!files||!!u.viewer;u.$('#agent-viewer').hidden=!files||!u.viewer;this.info.hidden=files;if(files)return;
        const m=this.inspection,sources=this.sources(m);this.info.replaceChildren();
        if(this.inspectorTab==='reads'){this.info.append(el('h3','本轮查阅'),el('p',sources.length+' 份资料 · '+(m.records?.length||0)+' 项操作','agent-inspector-hint'));for(const source of sources){const row=el('div',undefined,'agent-source-row'),b=button(source.path,'file');b.dataset.file=source.path;b.prepend(icon('fa-file-lines'));row.append(b);if(source.ranges?.length){const count=source.ranges.reduce((n,[a,b])=>n+b-a,0);row.append(el('small','已读取 '+count+' / '+source.totalCharacters+' 字符'));}else row.append(el('small','读取范围见操作记录'));this.info.append(row);}const records=el('details',undefined,'agent-operation-list');records.append(el('summary','展开操作记录'));for(const record of m.records||[]){const row=el('div',undefined,'agent-record');row.append(el('strong',({list_files:'查看目录',read_file:'读取',read_multiple_files:'批量读取',search_files:'搜索',propose_edit:'修改建议',create_file:'新建建议'})[record.tool]||'工具'),el('span',record.ok?record.path||record.query||'工作区根目录':record.error||'未完成'));if(record.proposalId){const b=button('查看修改对照','proposal');b.dataset.proposal=record.proposalId;row.append(b);}records.append(row);}this.info.append(records);if(!sources.length&&!m.records?.length)this.info.append(el('p','当前讨论尚无查阅记录。','agent-inspector-hint'));return;}
        const index=u.thread?.messages.indexOf(m),before=index>=0?u.thread.messages.slice(0,index):u.thread?.messages||[],question=before.filter(n=>n.role==='user').at(-1)?.text;
        const block=(title,text)=>{const box=el('section',undefined,'agent-context-card');box.append(el('h4',title),el('p',text));this.info.append(box);return box;};this.info.append(el('h3','当前上下文'));block('本轮问题',question||'尚未发送问题。');if(m.contextInfo){block('本轮请求',m.contextInfo.questionRetained?'本轮请求保留了原问题，旧对话按容量裁剪。':'未记录原问题保留状态。');block('工具额度',m.contextInfo.toolsUsed+' / '+m.contextInfo.toolLimit+(m.contextInfo.finishing?' · 已进入收尾阶段':''));if(m.contextInfo.compactedFiles?.length)block('请求中已缩短的资料片段',m.contextInfo.compactedFiles.join('\n'));}else this.info.append(el('p','旧回复未记录上下文裁剪详情，上方显示的是讨论记录中的原问题。','agent-inspector-hint'));if(m.text)block('答复摘录',m.text.slice(0,600)+(m.text.length>600?'…':''));if(m.generationInfo||m.performance)this.info.append(generationPanel({...m.generationInfo,usage:m.usage,performance:m.performance}));
    }
    resize(panel,key,min,max,initial){
        const u=this.ui,grip=el('div');grip.className='agent-resizer';grip.tabIndex=0;grip.setAttribute('role','separator');grip.setAttribute('aria-label',key==='left'?'调整项目栏宽度':'调整文档栏宽度');grip.setAttribute('aria-orientation','vertical');
        let width=initial;try{width=Math.max(min,Math.min(max,Number(readUIPreference('agentWidth-'+key,initial,'desktop-agent-'+key))||initial));}catch{}
        grip.setAttribute('aria-valuemin',min);grip.setAttribute('aria-valuemax',max);
        const apply=value=>{width=Math.max(min,Math.min(max,value));panel.style.flexBasis=width+'px';grip.setAttribute('aria-valuenow',width);};apply(width);
        const save=()=>writeUIPreference('agentWidth-'+key,width);
        if(key==='left')panel.after(grip);else panel.before(grip);this[key+'Grip']=grip;
        grip.onpointerdown=e=>{const x=e.clientX,start=width;grip.setPointerCapture(e.pointerId);grip.onpointermove=v=>apply(start+(v.clientX-x)*(key==='left'?1:-1));const finish=()=>{grip.onpointermove=null;save();};grip.onpointerup=finish;grip.onpointercancel=finish;grip.onlostpointercapture=finish;};grip.onkeydown=e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();apply(width+(e.key==='ArrowRight'?12:-12)*(key==='left'?1:-1));save();}};
    }
    toggleProjects(){this.projectsOpen=!this.projectsOpen;this.sidebar.hidden=!this.projectsOpen;this.leftGrip.hidden=!this.projectsOpen;this.syncPanels();if(!this.wideLayout&&!this.beforeZen)writeUIPreference('agentPanels',{projects:this.projectsOpen,files:this.fileOpen});}
    setZen(enabled){
        if(enabled&&!this.beforeZen){this.beforeZen={projects:this.projectsOpen,files:this.fileOpen};if(this.projectsOpen)this.toggleProjects();this.toggleFiles(false);}
        else if(!enabled&&this.beforeZen){const previous=this.beforeZen;this.beforeZen=null;if(this.projectsOpen!==previous.projects)this.toggleProjects();this.toggleFiles(previous.files);}
    }
    toggleFiles(open=!this.fileOpen){this.fileOpen=open;this.right.hidden=!open;this.rightGrip.hidden=!open;this.syncPanels();if(!this.wideLayout&&!this.beforeZen)writeUIPreference('agentPanels',{projects:this.projectsOpen,files:this.fileOpen});if(open){this.renderInspector();void this.ui.guard(()=>this.renderFiles());}}
    renderSidebar(){
        const u=this.ui;this.projects.replaceChildren();
        for(const root of [null,...u.data.roots]){
            const group=el('section',undefined,'agent-project-group');
            const row=el('div',undefined,'agent-project-row');
            const pick=button('');pick.append(icon(root?'fa-folder-open':'fa-comments'),el('span',root?root.name:'独立讨论'));
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
                del.dataset.agentMenu='true';del.onclick=()=>{const r=del.getBoundingClientRect();u.showContextMenu({clientX:r.left,clientY:r.bottom+5},{type:'root',id:root.id,name:root.name});};
                del.title='项目操作';
                del.setAttribute('aria-label', '项目操作');
                del.className='agent-item-del menu_button';
                del.append(icon('fa-ellipsis'));
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
                    del.dataset.agentMenu='true';del.onclick=()=>{const r=del.getBoundingClientRect();u.showContextMenu({clientX:r.left,clientY:r.bottom+5},{type:'thread',id:t.id,title:t.title||'新讨论'});};
                    del.title='讨论操作';
                    del.setAttribute('aria-label', '讨论操作');
                    del.className='agent-item-del menu_button';
                    del.append(icon('fa-ellipsis'));
                    tr.append(n,del);
                    threadList.append(tr);
                }
                group.append(threadList);
            }
            this.projects.append(group);
        }
    }
    render(){this.renderSidebar();this.rename.value=this.ui.thread?.title||'新讨论';this.crumb.textContent=this.ui.root?.name||'独立讨论';this.rename.disabled=!!this.ui.job;this.syncPanels();this.renderInspector();void this.ui.guard(()=>this.renderFiles());}
    renderControls(){
        const u=this.ui;if(!u.thread)return;const profile=u.bank().presets[u.bank().selected];this.preset.replaceChildren(icon('fa-sliders'),el('span',profile.name));this.permission.textContent=u.writable?'可提出修改':'仅讨论';this.permission.disabled=!!u.job;this.model.disabled=!!u.job;
        const last=u.thread.messages.filter(m=>m.role==='assistant').at(-1),history=last?.generationInfo?.history,p=last?.performance,usage=last?.usage;
        const token=key=>usage?.[key]===undefined?'未知':(usage.unknownFields?.includes(key)?'至少 ':'')+usage[key];
        this.metrics.textContent=[p?(p.totalMs/1000).toFixed(1)+' 秒 · 模型 '+p.modelRequests+' 次 · 工具 '+p.toolCalls+' 次':'',usage?'输入 '+token('input')+' · 缓存 '+token('hit')+' · 输出 '+token('output')+' tokens':p?'Token：接口未提供':''].filter(Boolean).join(' · ');
        this.metrics.hidden=!p&&!usage;this.metrics.title=history?'上轮带入历史 '+history.kept+'/'+history.total+' 组；回复操作菜单可查看性能明细':'回复操作菜单可查看性能明细';
        const thread=u.thread;void import('/scripts/openai.js').then(n=>{if(u.thread===thread)this.model.textContent=u.ctx().mainApi==='openai'?n.getChatCompletionModel():'当前原生连接';}).catch(()=>{});
    }
    async renderFiles(){
        const u=this.ui,root=u.root,marker=crypto.randomUUID();const searchScope=JSON.stringify([root?.id,u.directory]);if(this.searchScope!==searchScope){this.searchScope=searchScope;this.searchMarker=null;this.searchResults.replaceChildren();}this.fileRender=marker;if(!this.fileOpen||this.inspectorTab!=='files')return;this.files.replaceChildren();
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
            const n=button('');n.append(icon(f.type==='directory'?'fa-folder-open':'fa-file-lines'),el('span',f.name));
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
    viewerChanged(){const u=this.ui,changed=this.viewerSelection!==u.viewer;this.viewerSelection=u.viewer;if(u.viewer&&changed){this.inspectorTab='files';this.fileOpen=true;this.right.hidden=false;this.rightGrip.hidden=false;}this.right.classList.toggle('has-document',!!u.viewer);this.syncPanels();this.renderInspector();}
    welcome(parent){for(const text of ['梳理这个系列的资料结构','结合资料讨论人物动机','检查设定之间的矛盾']){const n=button(text);n.dataset.starter=text;parent.append(n);}}
}
