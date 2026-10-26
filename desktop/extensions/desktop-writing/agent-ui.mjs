import { DOMPurify, showdown } from '/lib.js';
import { WritingTask, createTokenCounter, publicError, WritingRequestError } from './generation.mjs';
import { agentCompletion } from './agent-transport.mjs';
import { runAgent } from './agent-loop.mjs';
import {profileBank,selectedProfile,collectedReasoning,savedReasoning,updateReadingLedger,agentPresetDefaults} from './assistant-options.mjs';
import {AgentLayout} from './agent-layout.mjs';
import {icon} from './icons.mjs';
import {Popup,POPUP_RESULT} from '/scripts/popup.js';
import {resolveAssistant} from './assistant-runtime.mjs';
import {renderAssistantSettings,reasoningPanel,updateReasoning,generationPanel} from './assistant-ui.mjs';
const make = (tag, text, className) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (className) n.className = className; return n; };
const button = (label, action, glyph) => { const b = make('button', undefined, 'menu_button menu_button_icon interactable'); b.type = 'button'; b.dataset.action = action; if (glyph) b.append(icon(glyph)); b.append(make('span', label)); return b; };
const uid = () => crypto.randomUUID();
export class LocalAgentUI {
    constructor({ ctx, busy, setBusy, reference }) {
        Object.assign(this, { ctx, busy, setBusy, reference }); this.data = { roots: [], threads: [], currentRoot: null }; this.thread = null; this.job = null; this.pending = []; this.references = []; this.queue = Promise.resolve(); this.serial = 0; this.saved = 0; this.failed = false; this.drawer = ''; this.directory = ''; this.viewer = null; this.writable = false; this.reasoningCache=new WeakMap(); this.converter = new showdown.Converter({ tables: true, strikethrough: true, simplifiedAutoLink: true });
    }
    async bridge(action, arg) {
        if (!window.localWorkspace?.[action]) throw new WritingRequestError('此页面没有桌面本地工作区接口，请使用新版桌面程序。');
        const result = await window.localWorkspace[action](arg); if (!result.ok) throw new WritingRequestError(result.error); return result.value;
    }
    get root() { return this.data.roots.find(r => r.id === this.data.currentRoot) || null; }
    bank(){const fresh=!this.thread.assistants?.agent&&!this.thread.generation;const bank=profileBank(this.thread,'agent','设定讨论',this.thread.generation||{});if(fresh)bank.presets=agentPresetDefaults();return bank;}
    $(selector) { return this.shadow.querySelector(selector); }
    message(text, error = false) { this.$('#agent-status').textContent = text; this.$('#agent-status').classList.toggle('error', error); }
    async guard(work) { try { return await work(); } catch (error) { this.message(error.message || '操作未完成，请重试。', true); return null; } }
    markdown(text) {
        // Never invoke native MessageFormatter/regex/plugin hooks in local document discussions.
        const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return DOMPurify.sanitize(this.converter.makeHtml(escaped), { ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'del', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td'], ALLOWED_ATTR: [] });
    }
    mount(parent) {
        this.host = make('section'); this.host.id = 'dw-agent'; this.host.hidden = true; this.host.setAttribute('aria-label', '本地设定工作区'); parent.append(this.host);
        this.shadow = this.host.attachShadow({ mode: 'open' });
        const css = make('link'); css.rel = 'stylesheet'; css.href = new URL('./agent.css', import.meta.url).href; this.shadow.append(css);
        const app = make('div'); app.id = 'agent-app';
        app.innerHTML = `<header id="agent-toolbar"><button id="agent-workspace" class="menu_button" data-action="choose" type="button">＋ 选择本地文件夹</button><button class="menu_button" data-action="files" type="button" aria-expanded="false">文件</button><button class="menu_button" data-action="threads" type="button" aria-expanded="false">讨论记录</button><button class="menu_button" data-action="new" type="button">＋ 新讨论</button><button class="menu_button" data-action="settings" type="button">参考设置</button></header>
        <div id="agent-main"><dialog id="agent-drawer" hidden></dialog><section id="agent-viewer" aria-label="文档查看与修改" hidden><header><span id="agent-file-name"></span><button class="menu_button" data-action="close-viewer" type="button">收起</button></header><div id="agent-doc-tools"></div><div id="agent-doc"></div><div id="agent-doc-actions"></div></section>
        <section id="agent-chat" aria-label="设定讨论"><header id="agent-threadbar"><span id="agent-thread-title">新讨论</span><span id="agent-save-status"></span></header><div id="agent-log" role="log" aria-label="讨论内容"></div><form id="agent-form"><div id="agent-refs"></div><textarea id="agent-input" class="text_pole" rows="3" aria-label="本地工作区讨论输入" placeholder="讨论设定，或让我查阅、整理文档……\nEnter 发送，Shift+Enter 换行" maxlength="120000"></textarea><div id="agent-input-actions"><button class="menu_button" data-action="files" type="button">引用文件</button><label><input id="agent-write" type="checkbox">可提出文档修改</label><button id="agent-stop" class="menu_button" data-action="stop" type="button" hidden>停止</button><button id="agent-send" class="menu_button" type="submit">发送</button></div></form></section></div><footer id="agent-status" role="status" aria-live="polite">可先讨论想法，也可以选择本地设定文件夹，无需创建小说。</footer>`;
        this.shadow.append(app);this.layout=new AgentLayout(this);this.layout.mount();
        this.$('#agent-form').addEventListener('submit', e => { e.preventDefault(); void this.guard(() => this.send()); });
        this.$('#agent-input').addEventListener('input', e => { if (!this.thread) return; this.thread.draft = e.target.value; this.dirty(); });
        this.$('#agent-input').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); void this.guard(() => this.send()); } });
        this.$('#agent-write').addEventListener('change', e => { this.writable = e.target.checked; this.message(this.writable ? '可以提出修改建议；查看对照后，点击保存才会写入本地文档。' : '本轮仅讨论，不修改本地文件。'); });
        this.shadow.addEventListener('click', e => {
            this.closeContextMenu();
            const target = e.target.closest('button'); if (!target) return;
            if (this.applying||this.mutating) { this.message('正在保存或处理工作区操作，请稍候…'); return; }
            if (target.dataset.file) void this.guard(() => this.openFile(target.dataset.file));
            else if (target.dataset.attach) { if (!this.references.includes(target.dataset.attach)) this.references.push(target.dataset.attach); this.renderRefs(); }
            else if (target.dataset.remove) { this.references = this.references.filter(x => x !== target.dataset.remove); this.renderRefs(); }
            else if (target.dataset.directory !== undefined) { this.directory = target.dataset.directory; void this.guard(() => this.renderFiles()); }
            else if (target.dataset.proposal || target.dataset.pendingProposal) void this.guard(() => this.openProposal(target.dataset.proposal || target.dataset.pendingProposal));
            else if (target.dataset.thread) void this.guard(async () => { if (this.job||this.editorDirty) throw new WritingRequestError('请先停止生成，并保存或放弃文档编辑，再切换讨论。'); await this.flush(); this.thread = this.data.threads.find(t => t.id === target.dataset.thread); this.references = []; this.drawer = ''; this.render(); });
            else if (target.dataset.root) void this.guard(() => this.selectRoot(target.dataset.root === 'none' ? null : target.dataset.root));
            else if (target.dataset.restore) void this.guard(async () => { const proposal = await this.bridge('restore', { rootId: this.viewer.rootId, path: this.viewer.path, id: target.dataset.restore }); await this.openProposal(proposal.id); });
            else if (target.dataset.deleteThread) {
                e.stopPropagation();
                void this.guard(() => this.deleteThreadItem(target.dataset.deleteThread));
            }
            else if (target.dataset.removeRoot) {
                e.stopPropagation();
                void this.guard(() => this.removeRootItem(target.dataset.removeRoot));
            }
            else if (target.dataset.action) void this.guard(() => this.action(target.dataset.action));
        });
        window.addEventListener('click', () => this.closeContextMenu());
        this.shadow.addEventListener('keydown',e=>{
            if(e.key==='Escape'){this.closeContextMenu();return;}
            if(e.key==='ContextMenu'||(e.shiftKey&&e.key==='F10')){const row=e.target.closest('.agent-thread-row,.agent-project-row');if(!row)return;e.preventDefault();const r=row.getBoundingClientRect(),thread=row.querySelector('[data-thread]'),root=row.querySelector('[data-root]');this.showContextMenu({clientX:r.left+12,clientY:r.bottom},{type:thread?'thread':'root',id:thread?.dataset.thread||(root?.dataset.root==='none'?null:root?.dataset.root),title:thread?.textContent,name:root?.textContent});}
        });
    }
    showContextMenu(e, item) {
        this.closeContextMenu();
        const menu = make('div', undefined, 'agent-context-menu');
        this.contextMenu = menu;
        const title = make('div', item.title || item.name || '操作菜单', 'agent-context-menu-title');
        menu.append(title);
        if (item.type === 'thread') {
            const renameBtn = make('button', '✏️ 重命名讨论', 'agent-context-menu-item');
            renameBtn.onclick = () => {this.closeContextMenu();void this.guard(()=>this.renameThreadItem(item.id));};
            const exportBtn = make('button', '📤 导出 Markdown 记录', 'agent-context-menu-item');
            exportBtn.onclick = () => {
                this.closeContextMenu();
                const th = this.data.threads.find(t => t.id === item.id);
                if (!th) return;
                const md = `# ${th.title || '讨论记录'}\n\n` + (th.messages || []).map(m => `### ${m.role === 'user' ? '用户' : '设定助手'} (${m.at || ''})\n\n${m.text}\n`).join('\n---\n\n');
                const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${th.title || '讨论记录'}.md`;
                a.click();
                setTimeout(()=>URL.revokeObjectURL(url),3000);
                this.message(`已导出讨论“${th.title}”为 Markdown 文件。`);
            };
            const sep = make('div', undefined, 'agent-context-menu-sep');
            const delBtn = make('button', '🗑️ 删除此讨论', 'agent-context-menu-item danger');
            delBtn.onclick = () => {
                this.closeContextMenu();
                void this.guard(() => this.deleteThreadItem(item.id));
            };
            menu.append(renameBtn, exportBtn, sep, delBtn);
        } else if (item.type === 'root') {
            const newThBtn = make('button', '＋ 新建讨论', 'agent-context-menu-item');
            newThBtn.onclick = () => {
                this.closeContextMenu();
                void this.guard(async()=>{await this.selectRoot(item.id==='none'?null:item.id);await this.action('new');});
            };
            menu.append(newThBtn);
            if (item.id) {
                const sep = make('div', undefined, 'agent-context-menu-sep');
                const removeBtn = make('button', '✕ 解除系列绑定', 'agent-context-menu-item danger');
                removeBtn.onclick = () => {
                    this.closeContextMenu();
                    void this.guard(() => this.removeRootItem(item.id));
                };
                menu.append(sep, removeBtn);
            }
        }
        const x = Math.min(e.clientX, window.innerWidth - 180);
        const y = Math.min(e.clientY, window.innerHeight - 180);
        menu.style.left = x + 'px';
        menu.style.top = y + 'px';
        this.shadow.append(menu);
        menu.setAttribute('role','menu');const items=[...menu.querySelectorAll('button')];for(const item of items)item.setAttribute('role','menuitem');this.menuReturnFocus=this.shadow.activeElement;items[0]?.focus();
        menu.onkeydown=event=>{if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();const at=items.indexOf(this.shadow.activeElement),next=event.key==='Home'?0:event.key==='End'?items.length-1:(at+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;items[next]?.focus();}};
    }
    closeContextMenu() {
        if (this.contextMenu) {
            this.contextMenu.remove();
            this.contextMenu = null;
            this.menuReturnFocus?.focus();
        }
    }
    async renameThreadItem(id){
        if(this.job||this.editorDirty||this.applying)throw new WritingRequestError('请先结束生成并保存或放弃文档编辑。');
        await this.flush();const thread=this.data.threads.find(t=>t.id===id);if(!thread)return;
        const title=await Popup.show.input('重命名讨论','讨论名称',thread.title||'新讨论');if(!title?.trim())return;
        const candidate={...thread,title:title.trim().slice(0,200),customTitle:true};
        const revision=await this.bridge('saveThread',{thread:candidate,revision:thread.revision??null});Object.assign(thread,candidate,{revision});this.render();
    }
    async deleteThreadItem(id) {
        if(this.mutating||this.applying||this.editorDirty)throw new WritingRequestError('请先保存或放弃文档编辑，再删除讨论。');
        if (this.job && this.thread?.id === id) throw new WritingRequestError('请先停止当前生成，再删除讨论。');
        const th = this.data.threads.find(t => t.id === id);
        const title = th?.title || '此讨论';
        if (await Popup.show.confirm('删除讨论',make('p',`确定删除讨论“${title}”及其草稿吗？删除后不可恢复。`))!==POPUP_RESULT.AFFIRMATIVE) return;
        if(this.job||this.editorDirty||this.applying)throw new WritingRequestError('请先结束当前任务。');
        await this.flush();
        await this.bridge('deleteThread', { id,revision:th?.revision??null });
        this.data.threads = this.data.threads.filter(t => t.id !== id);
        if (this.thread?.id === id) {
            this.thread = this.data.threads.filter(t => t.rootId === this.data.currentRoot).sort((a, b) => (b.updated || '').localeCompare(a.updated || ''))[0] || this.newThread();
            this.dirty();
        }
        this.render();
        this.message(`讨论“${title}”已删除。`);
    }
    async removeRootItem(rootId) {
        if(this.mutating||this.applying||this.notesDraft!=null)throw new WritingRequestError('请先保存项目摘要或结束当前保存操作。');
        if (this.job && this.root?.id === rootId) throw new WritingRequestError('请先停止当前生成，再解除系列绑定。');
        if (this.data.currentRoot === rootId && this.editorDirty) throw new WritingRequestError('文档编辑尚未保存，请先保存或放弃编辑，再解除系列绑定。');
        const r = this.data.roots.find(x => x.id === rootId);
        const name = r?.name || '此系列';
        const cascadedCount = this.data.threads.filter(t => t.rootId === rootId).length;
        const confirmMsg = cascadedCount > 0
            ? `确定从工作区解除系列“${name}”的绑定吗？\n注意：该系列下的 ${cascadedCount} 个讨论记录也将一并从工作区移除。\n（放心：绝对不会删除您本地硬盘中的任何真实文件）`
            : `确定从工作区解除系列“${name}”的绑定吗？\n放心：绝对不会删除您本地硬盘中的任何真实文件。`;
        if (await Popup.show.confirm('移除系列与讨论',make('p',confirmMsg))!==POPUP_RESULT.AFFIRMATIVE) return;
        if(this.job||this.editorDirty||this.applying)throw new WritingRequestError('请先结束当前任务并保存或放弃文档编辑。');

        if (this.data.currentRoot === rootId) {
            await this.flush();
        }
        await this.bridge('removeProject', { rootId });
        this.data.roots = this.data.roots.filter(x => x.id !== rootId);
        this.data.threads = this.data.threads.filter(t => t.rootId !== rootId);
        if (this.data.currentRoot === rootId) {
            this.data.currentRoot = this.data.roots[0]?.id || null;
            this.thread = this.data.threads.filter(t => t.rootId === this.data.currentRoot).sort((a, b) => (b.updated || '').localeCompare(a.updated || ''))[0] || this.newThread();
            this.viewer = null;
            this.directory = '';
            this.references = [];
        }
        this.notesDraft=null;this.notesSources=null;await this.refreshPending();this.render();
        this.message(`系列“${name}”已从工作区解除绑定（本地文件完好）。`);
    }
    async load() { this.data = await this.bridge('state'); this.thread = this.data.threads.filter(t => t.rootId === this.data.currentRoot).sort((a, b) => (b.updated || '').localeCompare(a.updated || ''))[0] || this.newThread(); await this.refreshPending(); this.render(); }
    newThread() { const previous=this.thread?.rootId===this.data.currentRoot?this.thread:null;const config=previous?structuredClone({assistants:previous.assistants,generation:previous.generation,useCharacter:previous.useCharacter,useWorld:previous.useWorld,useNotes:previous.useNotes,instructions:previous.instructions}):{};const thread = { id: uid(), rootId: this.data.currentRoot, title: '新讨论', draft: '', messages: [], useCharacter: false, useWorld: false, instructions: '',...config,...(this.root?.defaultAssistants?{assistants:structuredClone(this.root.defaultAssistants)}:{}) }; this.data.threads.push(thread); return thread; }
    dirty() { this.serial++; this.$('#agent-save-status').textContent = '尚未保存'; clearTimeout(this.timer); this.timer = setTimeout(() => { void this.flush().catch(() => {}); }, 700); }
    get unsaved() { return this.serial !== this.saved; }
    async flush() {
        clearTimeout(this.timer);
        const work = async () => {
            while (this.unsaved) {
                const serial = this.serial, thread = this.thread, snapshot = structuredClone(thread);
                this.$('#agent-save-status').textContent = '正在保存…';
                const revision = await this.bridge('saveThread', { thread: snapshot, revision: thread.revision ?? null }); thread.revision = revision; this.saved = serial;
            }
            this.failed = false; this.$('#agent-save-status').textContent = this.thread?.revision ? '已保存' : ''; return true;
        };
        this.queue = this.queue.catch(() => {}).then(work).catch(error => { this.failed = true; this.$('#agent-save-status').textContent = '保存失败'; this.message(error.message, true); throw error; }); return this.queue;
    }
    async prepareToLeave() {
        if (this.editorDirty) { this.message('文档编辑尚未保存，请先保存或放弃编辑。', true); return false; }
        try {
            if (this.applyDone) await this.applyDone;
            if (this.job) { const job = this.job; job.task.cancel(); let timer; try { await Promise.race([job.done, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('等待停止超时')), 30000); })]); } finally { clearTimeout(timer); } }
            await this.flush(); return true;
        } catch { return false; }
    }
    renderRefs() {
        const parent = this.$('#agent-refs'),write=this.$('#agent-write-control'); parent.replaceChildren();this.layout?.renderControls();if(this.thread)parent.append(make('small',(this.writable?'可提出修改 · 保存前需确认':'仅讨论')+' · 角色卡'+(this.thread.useCharacter?'开':'关')+' / 世界书'+(this.thread.useWorld?'开':'关')));if(write)parent.append(write);
        for (const name of this.references) { const b = button(name + ' ×', 'remove'); b.dataset.remove = name; parent.append(b); }
    }
    render() {
        this.layout?.render();
        this.$('#agent-workspace').textContent = this.root ? '📂 ' + this.root.name : '项目';
        this.$('#agent-workspace').title = (this.root?.name ? this.root.name + ' · ' : '') + '展开或收起项目与讨论';
        this.$('#agent-input').value = this.thread?.draft || ''; this.$('#agent-write').checked = this.writable;this.$('#agent-write').disabled=!!this.job;
        this.$('#agent-send').disabled = this.busy() || !this.thread; this.$('#agent-stop').hidden = !this.job; this.renderMessages(); this.renderRefs(); this.renderDrawer();
        if (this.viewer) this.renderViewer();
    }
    renderMessages() {
        const log = this.$('#agent-log'), nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 100; log.replaceChildren();
        if (!this.thread?.messages.length) {
            const welcome = make('div', undefined, 'agent-welcome'); welcome.append(make('p', this.root ? '可以从这个系列的人物、历史或世界规则开始讨论。' : '聊设定、整理想法，或选择一个本地资料文件夹。'));this.layout.welcome(welcome);log.append(welcome);
        }
        for (const message of this.thread?.messages || []) {
            const row = make('article', undefined, 'agent-message'); row.dataset.role = message.role; row.append(make('div', message.role === 'user' ? '你' : '设定助手', 'agent-name'));
            if (message.incomplete) row.append(make('small', '未完成回复 · 未作为已确认上下文发送'));
            const body = make('div', undefined, 'agent-message-text'); body.innerHTML = this.markdown(message.text); row.append(body);
            if(message.generationInfo)row.append(generationPanel({...message.generationInfo,usage:message.usage??message.generationInfo.usage}));
            if((message.reasoning||this.reasoningCache.get(message))&&selectedProfile(this.bank()).showReasoning)row.append(reasoningPanel(message.reasoning||this.reasoningCache.get(message),{incomplete:message.incomplete}));
            if (message.records?.length) {
                const detail = make('details'), summary = make('summary', '操作记录 · ' + message.records.length + ' 项'); detail.append(summary);
                for (const record of message.records) {
                    const label = ({ read_file: '读取', list_files: '查看目录', search_files: '搜索', propose_edit: '修改建议', create_file: '新建建议' })[record.tool] || '工具';
                    const line = make('div', undefined, 'agent-record');
                    if (record.proposalId) { const b = button(label + '：' + record.path, 'proposal'); b.dataset.proposal = record.proposalId; line.append(b); }
                    else if (record.tool === 'read_file' && record.ok) { const range = Number.isInteger(record.offset) ? ` · 字符 ${record.offset}–${record.end} / ${record.totalCharacters}` : ''; const b = button('读取：' + record.path + range + (record.duplicate ? ' · 重复范围已跳过' : record.cached ? ' · 本轮快照' : ''), 'file'); b.dataset.file = record.path; line.append(b); }
                    else line.textContent = label + '：' + (record.ok ? record.query || record.path || '工作区根目录' : record.error || '操作未完成');
                    detail.append(line);
                } row.append(detail);
            }
            const citations = make('div', undefined, 'agent-citations');
            for (const citation of message.citations || []) { const b = button(citation.path, 'file', 'fa-file-lines'); b.dataset.file = citation.path; citations.append(b); }
            for (const record of message.records || []) if (record.proposalId) { const b = button('查看修改：' + record.path, 'proposal', 'fa-code-compare'); b.dataset.proposal = record.proposalId; citations.append(b); }
            if(message.role==='assistant'){if(this.root){const note=button('加入项目摘要草稿','notes-draft');note.onclick=()=>{this.notesDraft=message.text;this.notesSources=(message.citations||[]).filter(c=>c.revision).slice(0,20);this.drawer='settings';this.renderDrawer();this.shadow.querySelector('textarea[aria-label="作者确认的项目摘要"]')?.closest('details')?.setAttribute('open','');};citations.append(note);}if(this.onAdopt){const adopt=button('采用到当前小说章','adopt');adopt.onclick=()=>void this.guard(()=>this.onAdopt(message.text));citations.append(adopt);}}row.append(citations); log.append(row);
        }
        if (this.job) { const pending = make('div', undefined, 'agent-pending'); pending.id = 'agent-pending'; pending.append(make('p', this.job.phase, 'agent-phase')); const text = make('div', undefined, 'agent-pending-text'); text.innerHTML = this.markdown(this.job.task.text); pending.append(text); log.append(pending); }
        if (!this.job && (this.thread?.messages.at(-1)?.role === 'user' || this.thread?.messages.at(-1)?.incomplete)) log.append(button('重试回复', 'retry', 'fa-rotate-right'));
        if (nearBottom) log.scrollTop = log.scrollHeight;
    }
    renderDrawer() {
        const drawer=this.$('#agent-drawer');
        if(this.drawer==='files'){this.drawer='';this.layout.toggleFiles(true);}
        if(this.drawer==='threads'){this.drawer='';this.layout.projectsOpen=true;this.layout.sidebar.hidden=false;this.layout.leftGrip.hidden=false;}
        drawer.hidden=this.drawer!=='settings';if(drawer.hidden){if(drawer.open)drawer.close();return;}
        drawer.replaceChildren();const header=make('header');header.append(make('strong','Agent 预设与参考'),button('关闭','close-drawer'));drawer.append(header);this.renderSettings(drawer);if(!drawer.open)drawer.showModal();
    }
    async renderFiles(){return this.layout.renderFiles();}
    renderSettings(drawer) {
        if(this.root){const root=this.root,input=make('input',undefined,'text_pole');input.value=root.name;input.maxLength=100;input.setAttribute('aria-label','系列显示名称');drawer.append(input);for(const [label,defaults]of [['保存系列名称',false],['将当前预设库设为此项目默认',true]]){const save=button(label,'project-settings');save.disabled=!!this.job;save.onclick=()=>void this.guard(async()=>{if(this.job)throw new WritingRequestError('请先停止生成。');Object.assign(root,await this.bridge('saveProject',{rootId:root.id,name:input.value,revision:root.settingsRevision??null,...(defaults?{defaultAssistants:{agent:structuredClone(this.bank())}}:{})}));this.layout.renderSidebar();this.$('#agent-workspace').textContent='📂 '+root.name;this.message(defaults?'已保存项目默认预设；新讨论将沿用，其他项目保持独立。':'系列显示名称已保存，原文件夹没有改名。');});drawer.append(save);}}
        renderAssistantSettings(drawer,{bank:this.bank(),agent:true,busy:!!this.job,change:()=>{this.dirty();this.renderMessages();this.renderRefs();},preview:p=>resolveAssistant(this.ctx(),p)});this.renderNotes(drawer);
        drawer.append(make('small', '默认上下文 32768、最大输出 4096；输出上限最多占上下文的一半。请按接口实际支持范围设置。输出额度增加可能增加费用，但不会强制模型写满。角色扮演参数独立保留。'));
        const experimental=make('details');experimental.append(make('summary','实验功能 · 角色卡与世界书参考'));drawer.append(experimental);
        for (const [key, label] of [['useCharacter', '参考当前角色卡'], ['useWorld', '参考当前启用的世界书']]) {
            const wrapper = make('label'), input = make('input'); input.type = 'checkbox';input.setAttribute('aria-label',label); input.checked = !!this.thread[key];input.disabled=!!this.job; input.onchange = () => { this.thread[key] = input.checked; this.dirty();this.renderRefs(); }; wrapper.append(input, make('span', label)); experimental.append(wrapper);
        }
        const instructions = make('textarea', undefined, 'text_pole'); instructions.rows = 5; instructions.placeholder = '本组讨论的要求、文风或设定原则'; instructions.setAttribute('aria-label', '本组讨论要求'); instructions.value = this.thread.instructions || ''; instructions.maxLength = 10000; instructions.oninput = () => { this.thread.instructions = instructions.value; this.dirty(); }; drawer.append(instructions, make('small', '模型连接沿用顶部酒馆设置。参考仅在你启用后加入。每轮按需读取，资料片段随请求发给所配置的模型，不会自动索引或上传整个文件夹。'));
    }
    async refreshPending() { this.pending = this.root ? await this.bridge('pending', { rootId: this.root.id }) : []; }
    renderNotes(drawer){
        if(!this.root)return;const root=this.root,details=make('details'),summary=make('summary','项目摘要与阅读记录'),input=make('textarea',undefined,'text_pole');input.rows=6;input.maxLength=20000;input.setAttribute('aria-label','作者确认的项目摘要');input.value=this.notesDraft??root.notes?.text??'';input.oninput=()=>{this.notesDraft=input.value;};
        const save=button('保存确认摘要','save-notes');save.onclick=()=>void this.guard(async()=>{if(this.job)throw new Error('请先停止生成再修改摘要。');root.notes=await this.bridge('saveNotes',{rootId:root.id,text:input.value,revision:root.notes?.revision??null,sources:this.notesSources??root.notes?.sources??[]});this.notesDraft=null;this.notesSources=null;this.message('项目摘要已确认保存；原始设定文件没有修改。');});
        const enabled=make('input');enabled.type='checkbox';enabled.checked=!!this.thread.useNotes;enabled.onchange=()=>{this.thread.useNotes=enabled.checked;this.dirty();};const label=make('label');label.append(enabled,make('span','参考已确认的项目摘要'));
        details.append(summary,make('small','答复可先加入摘要草稿；只有你点击保存才成为已确认摘要。来源文件变化后，旧摘要会暂停引用。'),input,save,label);
        const progress=make('div');for(const entry of this.thread.reading||[]){const covered=(entry.ranges||[]).reduce((n,[a,b])=>n+b-a,0);progress.append(make('p',entry.path+' · 已读 '+covered+' / '+entry.totalCharacters+' 字符 · 版本 '+entry.revision.slice(0,8)));}details.append(progress);const manual=button('改为作者手写摘要（不绑定文件版本）','manual-notes');manual.onclick=()=>{this.notesSources=[];this.message('保存后该摘要由作者自行维护，不再检查来源版本。');};details.append(manual);drawer.append(details);
    }
    async selectRoot(id) {
        if (this.job) throw new WritingRequestError('请先停止当前生成，再切换工作区。'); if (this.editorDirty) throw new WritingRequestError('请先保存或放弃正在编辑的文档。');
        await this.flush(); await this.bridge('select', { id }); this.data.currentRoot = id; this.thread = this.data.threads.filter(t => t.rootId === id).sort((a, b) => (b.updated || '').localeCompare(a.updated || ''))[0] || this.newThread();
        this.notesDraft=null;this.notesSources=null;this.references = []; this.directory = ''; this.drawer = ''; this.viewer = null; this.renderViewer(); await this.refreshPending(); this.render();
    }
    async openFile(name) {
        if (this.editorDirty) throw new WritingRequestError('请先保存或放弃正在编辑的文档。'); if (!this.root) throw new WritingRequestError('请先连接文件夹。');
        const root = this.root, file = await this.bridge('read', { rootId: root.id, path: name }); if (root !== this.root) return;
        this.viewer = { ...file, rootId: root.id, mode: 'read' }; this.drawer = ''; this.renderDrawer(); this.renderViewer();
    }
    async openProposal(id) {
        if (this.editorDirty) throw new WritingRequestError('请先保存或放弃正在编辑的文档。');
        const proposal = await this.bridge('proposal', { id }); if (proposal.rootId !== this.root?.id) throw new WritingRequestError('这份建议属于另一工作区，请切换后查看。');
        this.viewer = { ...proposal, rootId: proposal.rootId, mode: 'proposal' }; this.drawer = ''; this.renderDrawer(); this.renderViewer();
    }
    renderViewer() {
        const viewer = this.viewer, panel = this.$('#agent-viewer'); panel.hidden = !viewer;this.layout.viewerChanged(); if (!viewer) return;
        this.$('#agent-file-name').textContent = viewer.path; const content = this.$('#agent-doc'), tools = this.$('#agent-doc-tools'), actions = this.$('#agent-doc-actions'); content.replaceChildren(); tools.replaceChildren(); actions.replaceChildren();
        if (viewer.mode === 'proposal') {
            content.append(make('small', viewer.status === 'pending' ? '待保存的修改对照 · 原文尚未改变' : '此建议已保存，显示当时的修改记录'));
            for (const [label, value, className] of [['修改前', viewer.original || '（新文件）', 'agent-before'], ['修改后', viewer.text, 'agent-after']]) { const section = make('section', undefined, className); section.append(make('h4', label), make('pre', value)); content.append(section); }
            if (viewer.status === 'pending') actions.append(button('保存修改', 'apply', 'fa-floppy-disk'), button('继续讨论', 'close-viewer'));
        } else if (viewer.mode === 'edit') {
            const input = make('textarea', undefined, 'text_pole'); input.id = 'agent-editor-input'; input.value = viewer.editText ?? viewer.text; input.setAttribute('aria-label', '编辑文档正文'); input.oninput = () => { viewer.editText = input.value; this.editorDirty = input.value !== viewer.text; }; content.append(input); actions.append(button('预览修改', 'preview-edit'), button('放弃编辑', 'discard-edit'));
        } else if (viewer.mode === 'history') {
            content.append(make('p', '点击历史版本可生成恢复对照，保存前仍可检查。'));
            for (const record of viewer.history) { const b = button(new Date(record.created).toLocaleString(), 'restore'); b.dataset.restore = record.id; content.append(b); }
            if (!viewer.history.length) content.append(make('p', '尚无可恢复历史。保存修改后会保留原文。'));
            actions.append(button('返回文档', 'reread'));
        } else {
            tools.append(button('加入本次参考', 'reference', 'fa-paperclip'));if(this.onReference){const cite=button('引用到当前作品','novel-ref');cite.onclick=()=>void this.guard(async()=>{await this.onReference(viewer.rootId,viewer.path);this.message('已引用到当前作品，小说模式开启关联资料后按需发送。');});tools.append(cite);} if (viewer.writable) tools.append(button('编辑', 'edit'), button('历史版本', 'history'));
            if(/\.md$/i.test(viewer.path)){const prose=make('div',undefined,'agent-document-markdown');prose.innerHTML=this.markdown(viewer.text);content.append(prose);}else content.append(make('pre', viewer.text)); if (!viewer.writable) content.prepend(make('small', 'DOCX 提取正文 · 只读，不保留排版与图片'));
        }
    }
    async action(action) {
        if(action==='projects'||action==='threads')this.layout.toggleProjects();
        else if(action==='files')this.layout.toggleFiles();
        else if(action==='model'){if(this.job)throw new WritingRequestError('请先停止生成再切换连接。');if(globalThis.SillyTavernDesktopWriting?.settingsDialog){globalThis.SillyTavernDesktopWriting.settingsDialog.open('models');}else{document.body.classList.add('dw-native-tools-open');document.getElementById('dw-native-settings')?.setAttribute('aria-expanded','true');document.getElementById('API-status-top')?.click();}}
        else if (action === 'settings') { this.drawer = this.drawer === action ? '' : action; this.renderDrawer(); }
        else if (action === 'close-drawer') { this.drawer = ''; this.renderDrawer(); }
        else if (action === 'stop') { this.job?.task.cancel(); this.message('正在停止本轮；已提出的修改建议会保留，但不会自动写入。'); }
        else if (action === 'retry') return this.send(true);
        else if (action === 'new') { if (this.job||this.editorDirty) throw new WritingRequestError('请先停止生成，并保存或放弃文档编辑。'); await this.flush(); this.thread = this.newThread(); this.references = []; this.drawer = '';this.dirty(); this.render(); }
        else if (action === 'choose') {
            if (this.job) throw new WritingRequestError('请先停止当前生成，再连接文件夹。'); if (this.editorDirty) throw new WritingRequestError('请先保存或放弃文档编辑。'); await this.flush();
            const entry = await this.bridge('choose'); if (!entry) return; this.data = await this.bridge('state'); await this.selectRoot(entry.id); this.message('已连接：' + entry.path + '。AI 实际查阅的内容会发送到当前模型。');
        } else if (action === 'close-viewer') { if (this.editorDirty) throw new WritingRequestError('请先预览修改或放弃编辑。'); this.viewer = null; this.renderViewer(); }
        else if (action === 'reference') { if (!this.references.includes(this.viewer.path)) this.references.push(this.viewer.path); this.renderRefs(); }
        else if (action === 'edit') { this.viewer.mode = 'edit'; this.renderViewer(); }
        else if (action === 'discard-edit') { this.viewer.mode = 'read'; delete this.viewer.editText; this.editorDirty = false; this.renderViewer(); }
        else if (action === 'preview-edit') {
            const v = this.viewer, proposal = await this.bridge('propose', { rootId: v.rootId, path: v.path, revision: v.revision, before: v.text, after: v.editText ?? v.text }); this.editorDirty = false; await this.openProposal(proposal.id); await this.refreshPending();
        } else if (action === 'apply') {
            if (this.applying) return; this.applying = true;
            this.applyDone = new Promise(resolve => { this.finishApply = resolve; });
            this.message('正在备份原文并保存修改…');
            try { const saved = await this.bridge('apply', { id: this.viewer.id }); this.viewer.status = 'applied'; this.renderViewer(); await this.refreshPending(); this.message('已保存：' + saved.path + ' · 修改前的版本已备份，可从“历史版本”恢复。'); } finally { this.applying = false; this.finishApply(); this.applyDone = null; }
        } else if (action === 'history') { this.viewer.history = await this.bridge('history', { rootId: this.viewer.rootId, path: this.viewer.path }); this.viewer.mode = 'history'; this.renderViewer(); }
        else if (action === 'reread') await this.openFile(this.viewer.path);
    }
    async send(retry = false) {
        if (this.busy()) throw new WritingRequestError('已有生成任务，请完成或停止后再发送。'); if (!this.thread) throw new WritingRequestError('工作区尚未载入。');
        const api = this.ctx(); if (api.onlineStatus === 'no_connection' && (!api.mainApi || api.mainApi === 'none')) throw new WritingRequestError('请先在顶部 API 连接中配置模型。');
        const thread = this.thread, root = this.root;
        if (thread.messages.length >= 990) throw new WritingRequestError('这组讨论已达到长度上限，请新建讨论，已有记录保留。');
        if (!retry) { const text = this.$('#agent-input').value.trim(); if (!text) return; if (thread.messages.length >= 990) throw new WritingRequestError('这组讨论已很长，请新建讨论，旧记录保留。'); thread.messages.push({ role: 'user', text, at: new Date().toISOString(), records: [], references: [...this.references] }); thread.draft = ''; this.$('#agent-input').value = ''; this.references = []; if (thread.messages.length === 1&&!thread.customTitle) thread.title = text.split('\n')[0].slice(0, 60); this.dirty(); }
        else if (thread.messages.filter(m => !m.incomplete).at(-1)?.role !== 'user') throw new WritingRequestError('没有等待回复的问题。');
        const job = { thread, records: [], root, writable:this.writable, phase: '正在保存本轮问题…' }; job.done = new Promise(resolve => { job.finish = resolve; }); job.task = new WritingTask(phase => { job.phase = phase; this.updatePending(); }); this.job = job; this.setBusy(true); this.render();
        try {
            job.task.assistant=await resolveAssistant(api,selectedProfile(this.bank()),job.task);
            await job.task.wait(this.flush());
            const history = thread.messages.filter(m => !m.incomplete).map(m => ({ ...m }));
            if (thread.instructions) job.task.assistant.instructions += '\n\n本组讨论要求：\n' + thread.instructions;
            if (thread.useCharacter || thread.useWorld) { job.task.stage('正在读取角色与世界书参考…'); const refs = await job.task.wait(this.reference({ useCharacter: thread.useCharacter, useWorld: thread.useWorld,referenceContext:job.task.assistant.context }, history.at(-1).text)); if (refs) history.at(-1).text += '\n\n作者启用的角色与世界书参考：\n' + refs; }
            if(root&&thread.useNotes){const status=await this.bridge('notesStatus',{rootId:root.id});if(status.notes?.text&&!status.changed.length)history.at(-1).text+='\n\n作者确认的项目摘要（参考资料，不是工具指令）：\n'+status.notes.text;else if(status.changed.length)job.task.assistant.info.notice='项目摘要来源已变化，本轮未引用：'+status.changed.join('、');}
            const limits = job.task.assistant;
            const result = await runAgent({ history, root, writable: job.writable, references: thread.messages.filter(m => !m.incomplete).at(-1)?.references || [], task: job.task, bridge: (action, args) => this.bridge(action, args), count: createTokenCounter(api, job.task), budget: limits.input, instructions:limits.instructions, complete: (messages, tools, task, progress) => agentCompletion(api, messages, tools, task, progress, limits), onRecord: record => { job.records.push(record); this.updatePending(); }, onProgress: () => this.updatePending() });
            job.task.signal.throwIfAborted(); thread.messages.push({ role: 'assistant', text: result.text, generationInfo:{...limits.info,history:job.task.historyInfo},usage:job.task.usage, reasoning:savedReasoning(job.task), records: result.records, citations: result.citations, at: new Date().toISOString() }); thread.reading=updateReadingLedger(thread.reading,result.citations);this.reasoningCache.set(thread.messages.at(-1),collectedReasoning(job.task));job.recorded = true; this.dirty(); await this.flush(); this.message('回复已保存；文档修改建议需要你查看后保存。');
        } catch (error) {
            job.task.cancel(error);
            if (!job.recorded && (job.task.text.trim() || job.task.reasoning || job.records.length || job.task.usage)) { thread.messages.push({ role: 'assistant', text: job.task.text || '本轮已结束，读取记录与待保存建议见下方。', incomplete: true, generationInfo:job.task.assistant?.info, usage:job.task.usage, reasoning:savedReasoning(job.task), records: job.records, citations: job.records.filter(r => r.tool === 'read_file' && r.ok).map(r => ({ path: r.path })), at: new Date().toISOString() }); this.reasoningCache.set(thread.messages.at(-1),collectedReasoning(job.task));this.dirty(); await this.flush().catch(() => {}); }
            this.message(error.name === 'AbortError' ? '已停止。未完成回复与修改建议保留，没有自动写入文档。' : publicError(error, '本轮未完成，请检查模型连接或工作区后重试。'), error.name !== 'AbortError');
        } finally { if (this.job === job) { this.job = null; this.setBusy(false); await this.refreshPending().catch(() => {}); this.render(); } job.finish(); }
    }
    updatePending() {
        if (!this.job) return; const row = this.$('#agent-pending'); if (!row) return;
        row.querySelector('.agent-phase').textContent = this.job.phase + (this.job.records.length ? ' · 已完成 ' + this.job.records.length + ' 项操作' : '');
        const now = Date.now(); if (!this.lastDraw || now - this.lastDraw > 100) { updateReasoning(row,collectedReasoning(this.job.task),this.job.task.assistant?.profile.showReasoning);row.querySelector('.agent-pending-text').innerHTML = this.markdown(this.job.task.text); this.lastDraw = now; }
    }
}
