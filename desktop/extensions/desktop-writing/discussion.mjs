import {icon as uiIcon} from './icons.mjs';
import { Popup, POPUP_TYPE, POPUP_RESULT } from '/scripts/popup.js';
import {resolveAssistant} from './assistant-runtime.mjs';
import {collectedReasoning,savedReasoning} from './assistant-options.mjs';
import {renderProse,reasoningPanel,updateReasoning,generationPanel} from './assistant-ui.mjs';
import { clone, uid, newChapter, newConversation, discussionPrompt, applyCandidate, textRevision, excerptContent, checkpoint } from './model.mjs';
import { WritingTask, createTokenCounter, generateWriting, publicError, WritingRequestError } from './generation.mjs';
import { inlineDiff } from './inline-diff.mjs';

const el = (tag, text, className) => { const result = document.createElement(tag); if (text !== undefined) result.textContent = text; if (className) result.className = className; return result; };
const option = (value, text) => { const result = el('option', text); result.value = value; return result; };
function button(label, icon) { const b = el('button', undefined, 'menu_button menu_button_icon interactable'); b.type = 'button'; if (icon) b.append(uiIcon(icon)); b.append(el('span',icon?label.replace(/^[^\p{L}\p{N}]+/u,''):label)); return b; }
export class Discussion {
    constructor(hooks) { Object.assign(this, hooks); this.job = null; this.lastId = null; this.errors = new Map();this.reasoningCache=new WeakMap(); }
    current() { const p = this.project(); return p?.conversations.find(x => x.id === p.currentConversationId); }
    mount(parent) {
        this.root = el('section'); this.root.id = 'dw-discussion';
        this.root.innerHTML = '<div class="dw-discussion-tools flex-container"><div class="dw-discussion-brand"><span>💬</span><span>AI 创作讨论副驾</span></div><select id="dw-conversation" class="text_pole" aria-label="创作讨论"></select></div><div id="dw-discussion-log" role="log" aria-label="创作对话记录"></div><div id="dw-discussion-note" role="status"></div><div id="dw-discussion-context" aria-label="本次参考内容"></div><div id="dw-discussion-composer" class="flex-container"><div class="dw-discussion-quick-chips"><button type="button" class="dw-chip" data-quick="write">⚡ 写下一段</button><button type="button" class="dw-chip" data-quick="crossroads">🎯 召唤推演</button></div><textarea id="dw-discussion-input" class="text_pole" rows="3" maxlength="120000" aria-label="创作对话输入" placeholder="与 AI 讨论剧情、人物动机，或提出本章的写作要求…\nEnter 发送，Shift+Enter 换行；打出 ?? 唤出十字路口"></textarea></div>';
        parent.append(this.root);
        this.crossroads=el('section');this.crossroads.id='dw-crossroads-panel';this.crossroads.setAttribute('aria-label','剧情推演十字路口');document.getElementById('dw-main')?.append(this.crossroads);
        this.scene=el('details');this.scene.id='dw-scene-reference';this.scene.open=true;
        const summary=el('summary','本章大纲与参考');
        const sceneContent=el('div',undefined,'dw-scene-content');
        const outline=el('pre',undefined,'dw-outline-pre');sceneContent.append(outline);
        this.scene.append(summary,sceneContent);this.root.append(this.scene);
        const sceneGrip=el('div',undefined,'dw-row-resizer');sceneGrip.tabIndex=0;sceneGrip.setAttribute('role','separator');sceneGrip.setAttribute('aria-label','调整场景参考高度');sceneGrip.setAttribute('aria-orientation','horizontal');this.scene.before(sceneGrip);
        const setHeight=h=>{const maxHeight=Math.max(80,this.root.clientHeight-60);const height=Math.max(80,Math.min(maxHeight,h));this.scene.style.flexBasis=height+'px';sceneGrip.setAttribute('aria-valuenow',Math.round(height));};
        sceneGrip.onpointerdown=e=>{if(e.button!==0)return;e.preventDefault();const start=e.clientY,height=this.scene.getBoundingClientRect().height;sceneGrip.setPointerCapture(e.pointerId);sceneGrip.onpointermove=v=>setHeight(height+start-v.clientY);sceneGrip.onpointerup=sceneGrip.onpointercancel=()=>{sceneGrip.onpointermove=null;};};sceneGrip.onkeydown=e=>{if(['ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();setHeight(this.scene.getBoundingClientRect().height+(e.key==='ArrowUp'?20:-20));}};
        this.log = this.root.querySelector('#dw-discussion-log'); this.input = this.root.querySelector('#dw-discussion-input'); this.picker = this.root.querySelector('#dw-conversation'); this.note = this.root.querySelector('#dw-discussion-note');
        const create = button('＋ 新讨论', 'fa-plus'); create.id = 'dw-new-conversation'; create.onclick = () => this.guard(async () => {
            const p = this.project(); if (!p) { await this.ensureProject(); return; } if (p.conversations.length >= 100) throw new Error('当前作品已达到 100 个讨论，请新建作品继续。');
            const title = await Popup.show.input('新建创作讨论', '讨论名称', '新的创作讨论'); if (!title?.trim()) return;
            const conversation = newConversation(title.trim().slice(0, 300)); p.conversations.push(conversation); p.currentConversationId = conversation.id; this.dirty(); this.render(); await this.save();
        });
        const crossroads = button('🎯 剧情推演 (Ctrl+J)', 'fa-compass'); crossroads.id = 'dw-call-crossroads'; crossroads.title = '快捷键 Ctrl+J：召唤剧情十字路口四选一'; crossroads.onclick = () => this.guard(() => this.triggerCrossroads());
        this.root.querySelector('.dw-discussion-tools').append(create, crossroads);
        this.sendButton = button('发送 ➔', 'fa-paper-plane'); this.sendButton.id = 'dw-discussion-send'; this.sendButton.onclick = () => this.guard(() => this.send());
        this.stopButton = button('停止', 'fa-stop'); this.stopButton.id = 'dw-discussion-stop'; this.stopButton.onclick = () => this.stop();
        this.root.querySelector('#dw-discussion-composer').append(this.sendButton, this.stopButton);
        this.root.querySelectorAll('.dw-chip').forEach(btn => {
            btn.onclick = () => {
                if (btn.dataset.quick === 'write') {
                    this.input.value = '请结合本章大纲与已有正文，为下一段提供候选稿。';
                    this.input.focus();
                    void this.guard(() => this.send());
                } else if (btn.dataset.quick === 'crossroads') {
                    this.triggerCrossroads();
                }
            };
        });
        this.picker.onchange = () => { const p = this.project(); if (!p) return; p.currentConversationId = this.picker.value; this.dirty(); this.render(); };
        this.input.oninput = () => {
            const c = this.current(); if (!c || !this.isReady()) return; c.draft = this.input.value; this.dirty();
            if (this.input.value.endsWith('??') || this.input.value.endsWith('？？')) {
                this.input.value = this.input.value.replace(/(\?\?|？？)$/, '');
                this.triggerCrossroads();
            }
        };
        this.input.addEventListener('keydown', event => {
            if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); this.guard(() => this.send()); }
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); this.guard(() => this.save()); }
        });
        this.render();
    }
    triggerCrossroads() {
        const p = this.project();
        if (!p) throw new Error('请先创建作品和章节。');
        const existing = (this.crossroads||this.log).querySelector('.dw-crossroads-box');
        if (existing) {
            existing.scrollIntoView({ behavior: 'smooth',block:'nearest' });
            return;
        }
        const box = el('div', undefined, 'dw-crossroads-box');
        const header = el('div', undefined, 'dw-crossroads-header');
        header.innerHTML = '<div class="dw-crossroads-title"><i class="fa-solid fa-compass" aria-hidden="true"></i> <span>剧情十字路口：下一幕走向四选一</span></div>';
        const closeBtn = el('button', '✕', 'dw-crossroads-close');
        closeBtn.type = 'button';
        closeBtn.onclick = () => box.remove();
        header.append(closeBtn);
        const ch = this.chapter();
        const chTitle = ch?.title || '本章';
        const recentText = (ch?.text || '').trim();
        const lastSnippet = recentText.length > 80 ? recentText.slice(-80).replace(/\s+/g, ' ') : recentText;
        const contextHint = lastSnippet ? `（接续前文“${lastSnippet.slice(-30)}…”）` : '';
        const tip = el('p', `为《${chTitle}》选择一种推演方法，或输入自己的走向，再交给模型结合正文展开：`, 'dw-crossroads-tip');
        const optionsContainer = el('div', undefined, 'dw-crossroads-options');
        const branches = [
            { code: 'A', title: '守序顺行', badge: '逻辑稳健', tagClass: 'dw-badge-a', desc: `顺承《${chTitle}》当前情节发展${contextHint}，双方按既定动机与理性博弈推进，揭示下一步关键行动与事实真相。` },
            { code: 'B', title: '意外断裂', badge: '引爆危机', tagClass: 'dw-badge-b', desc: `在《${chTitle}》关键时刻突生异变${contextHint}，外部不可抗力（如警笛破门、突发搜查或第三方偷袭）骤然介入，打断对话转入生死协同。` },
            { code: 'C', title: '暗线收束', badge: '伏笔呼应', tagClass: 'dw-badge-c', desc: `借由当前场景的道具或线索，早先埋下的暗线被当场揭晓，个人动机与主线阴谋在此刻严密咬合。` },
            { code: 'D', title: '极端反转', badge: '戏剧颠覆', tagClass: 'dw-badge-d', desc: `局面突现致命反转${contextHint}，原有的信任基石瓦解或其中一方突发险情（如暗藏剧毒、身份倒置），在紧迫危局中倒逼终极抉择！` }
        ];
        branches.forEach(b => {
            const card = el('button', undefined, 'dw-crossroads-card');card.type='button';
            const head=el('div',undefined,'dw-crossroads-card-head');head.append(el('span',`选项 ${b.code} · ${b.title}`,'dw-crossroads-card-title'),el('span',b.badge,'dw-crossroads-card-badge '+b.tagClass));card.append(head,el('div',b.desc,'dw-crossroads-card-body'));
            card.onclick = () => {
                box.remove();
                this.input.value = `【剧情十字路口探讨 · 选项 ${b.code}（${b.title}）】\n走向构想：${b.desc}\n请结合《${chTitle}》的大纲与前文，顺承此走向为本章起草正文剧情，直接推进接下来的具体场景发展、角色行动与关键对话。`;
                this.input.focus();
                void this.guard(() => this.send());
            };
            optionsContainer.append(card);
        });
        const customDiv = el('div', undefined, 'dw-crossroads-custom');
        customDiv.innerHTML = '<div class="dw-crossroads-custom-label"><span>作者自定走向或融合</span><small>按回车或点击采纳</small></div>';
        const customRow = el('div', undefined, 'dw-crossroads-custom-row');
        const customInput = el('input', undefined, 'text_pole');
        customInput.placeholder = '自定走向，例如：双方突然发现第三方势力的秘密介入…';
        const customSubmit = el('button', '采纳', 'menu_button dw-crossroads-custom-btn');
        customSubmit.type = 'button';
        const doSubmit = () => {
            const val = customInput.value.trim();
            if (!val) return;
            box.remove();
            this.input.value = `【剧情十字路口探讨 · 选项 D（作者自定）】\n走向构想：${val}\n请结合当前章节大纲与正文，推演接下来的具体场景发展、人物对话与动作细节。`;
            this.input.focus();
            void this.guard(() => this.send());
        };
        customSubmit.onclick = doSubmit;
        customInput.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); doSubmit(); } };
        customRow.append(customInput, customSubmit);
        customDiv.append(customRow);
        optionsContainer.append(customDiv);
        box.append(header, tip, optionsContainer);
        (this.crossroads||this.log).append(box);
        box.scrollIntoView({ behavior: 'smooth',block:'nearest' });
    }
    async attachExcerpt(chapter, selection) {
        if (!this.isReady()) throw new Error('作品尚未成功读取。');
        const conversation = this.current(); if (!conversation || !chapter) throw new Error('请先创建作品和章节。');
        const text = selection.original.slice(selection.start, selection.end);
        if (!text.trim()) throw new Error('请先在正文中选中要讨论的片段。');
        if (text.length > 120000) throw new Error('选段过长，请缩小到 12 万字以内。');
        conversation.excerpt = { chapterId: chapter.id, title: chapter.title, text, start: selection.start, end: selection.end, revision: await textRevision(selection.original) };
        this.dirty(); this.renderContext();
    }
    renderContext() {
        const box = this.root.querySelector('#dw-discussion-context'); box.replaceChildren();
        const p = this.project(), chapter = this.chapter(), conversation = this.current();
        box.append(el('small', chapter && p?.useChapter !== false ? '参考当前章：' + chapter.title : '未启用当前章参考'));
        if(p)box.append(el('small',' · 预设：'+this.assistant().name+' · 角色卡'+(p.useCharacter?'开':'关')+' / 世界书'+(p.useWorld?'开':'关')));
        if (!conversation?.excerpt) return;
        const details = el('details'); details.id = 'dw-excerpt-reference';
        details.append(el('summary', '已引用选段 · ' + conversation.excerpt.title + ' · ' + conversation.excerpt.text.length + ' 字'), el('pre', conversation.excerpt.text));
        const remove = button('移除选段', 'fa-xmark'); remove.id = 'dw-remove-excerpt';
        remove.onclick = () => { conversation.excerpt = null; this.dirty(); this.renderContext(); };
        box.append(details, remove);
    }
    async guard(task) { try { await task(); } catch (error) { globalThis.toastr?.error(error.message || '讨论操作失败，内容已保留。', '创作对话'); } }
    stop() { if (!this.job) return; this.job.cancelled = true; this.job.task.cancel(); this.renderMessages(); }
    updatePending(job) {
        if (this.job !== job || job.conversation !== this.current()) return;
        const row = this.log.querySelector('.dw-discussion-pending'); if (!row) return;
        const nearBottom = this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight < 100;
        row.querySelector('p').textContent = job.phase;
        if (job.task.text) {
            let preview = row.querySelector('.mes_text');
            if (!preview) { preview = el('div', undefined, 'mes_text'); row.append(preview); }
            preview.innerHTML = renderProse(job.task.text);
        }
        updateReasoning(row,collectedReasoning(job.task),job.task.assistant?.profile.showReasoning);
        if (nearBottom) this.log.scrollTop = this.log.scrollHeight;
    }
    render() {
        const p = this.project(), c = this.current();
        if(this.scene)this.scene.querySelector('pre').textContent=this.chapter?.()?.outline||p?.instructions||'尚未填写本章大纲。可从“大纲与参考”补充场景、人物与写作要求。';
        this.picker.replaceChildren(...(p?.conversations || []).map(x => option(x.id, x.title))); if (c) this.picker.value = c.id;
        const id = p && c ? p.id + '/' + c.id : null;
        if (id !== this.lastId || this.input.value !== (c?.draft || '')) this.input.value = c?.draft || '';
        const moved = id !== this.lastId; this.lastId = id;
        this.input.disabled = !c; this.sendButton.disabled = !c || this.busy(); this.root.querySelector('#dw-new-conversation').disabled = !this.isReady();
        this.renderMessages(moved); this.renderContext();
    }
    renderMessages(forceBottom = false) {
        const p = this.project(), c = this.current(); const nearBottom = this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight < 100;
        this.log.replaceChildren();
        if (!c?.messages.length) this.log.append(el('p', p ? '可以从一个大纲、一个人物，或者一句“我想写这样的故事”开始。这里的讨论不会自动改动章节正文。' : '先创建一部作品，即可开始与 AI 讨论和写作。'));
        for (const message of c?.messages || []) {
            const row = el('article', undefined, 'mes dw-discussion-message'); row.dataset.discussionMessage = message.id; row.setAttribute('is_user', String(message.role === 'user')); row.setAttribute('is_system', 'false');
            const avatar = el('div', undefined, 'avatar'); const icon = el('i', undefined, 'fa-solid ' + (message.role === 'user' ? 'fa-user' : 'fa-feather-pointed')); icon.setAttribute('aria-hidden', 'true'); avatar.append(icon);
            const block = el('div', undefined, 'mes_block'); const name = el('div', undefined, 'ch_name'); name.append(el('span', message.role === 'user' ? '你' : '创作助手', 'name_text'));
            const text = el('div', undefined, 'mes_text');
            text.innerHTML = renderProse(message.text);
            block.append(name, text);if(message.generationInfo)block.append(generationPanel(message.generationInfo));if((message.reasoning||this.reasoningCache.get(message))&&this.assistant().showReasoning)block.append(reasoningPanel(message.reasoning||this.reasoningCache.get(message),{incomplete:message.incomplete}));
            if (message.incomplete) block.prepend(el('small', '未完成草稿 · 可复制、采用或重试回复'));
            if (message.role === 'user' && message.excerpt) {
                const quoted = el('details', undefined, 'dw-message-excerpt');
                quoted.append(el('summary', '引用正文 · ' + message.excerpt.title), el('pre', message.excerpt.text)); block.append(quoted);
            }
            if (message.role === 'assistant') {
                const tools = el('div', undefined, 'dw-discussion-message-tools flex-container'); const adopt = button('采用到章节', 'fa-file-pen'); adopt.dataset.adoptMessage = message.id;
                adopt.onclick = () => this.guard(() => this.adopt(p, c, message));
                const copy = button('复制', 'fa-copy'); copy.onclick = () => this.guard(() => navigator.clipboard.writeText(message.text)); tools.append(adopt, copy); block.append(tools);
                if (message.omitted) block.append(el('small', '本次受上下文预算限制，未发送较早的 ' + message.omitted + ' 条讨论记录。'));
            }
            row.append(avatar, block);this.log.append(row);
        }
        const pending = !!this.job && this.job.conversation === c;
        if (pending) {
            const row = el('div', undefined, 'dw-discussion-pending'); row.append(el('p', this.job.cancelled ? '正在停止本次回复…' : this.job.phase || '正在准备回复…'));
            if (this.job.task.text) { const preview = el('div', undefined, 'mes_text'); preview.innerHTML = renderProse(this.job.task.text); row.append(preview); }
            this.log.append(row);
        }
        if (!pending && (c?.messages.at(-1)?.role === 'user' || c?.messages.at(-1)?.incomplete)) { const retry = button('重试回复', 'fa-rotate-right'); retry.id = 'dw-discussion-retry'; retry.disabled = this.busy(); retry.onclick = () => this.guard(() => this.send(true)); this.log.append(retry); }
        this.stopButton.hidden = !this.job; this.note.textContent = c ? (this.errors.get(c.id) || '') : '';
        if (forceBottom || nearBottom) this.log.scrollTop = this.log.scrollHeight;
    }
    async send(retry = false) {
        if (!this.isReady()) throw new Error('作品尚未成功读取，请稍后重试。');
        if (this.busy()) throw new Error('已有生成任务，请等待完成或点击停止。');
        if (!this.project()) { await this.ensureProject(); this.render(); return; }
        const p = this.project(), c = this.current(), chapter = this.chapter(), api = this.ctx();
        if (api.onlineStatus === 'no_connection' && (!api.mainApi || api.mainApi === 'none')) throw new Error('请先通过酒馆顶部原生 API 连接按钮配置模型。无需导入角色卡即可创作。');
        if (retry) { if (c.messages.length >= 2000) throw new Error('当前讨论已很长，请新建讨论继续，旧记录已保留。'); if (c.messages.filter(x => !x.incomplete).at(-1)?.role !== 'user') throw new Error('没有等待回复的消息。'); }
        else {
            const input = this.input.value.trim(); if (!input) return;
            if (c.messages.length >= 1998) throw new Error('当前讨论已很长，请新建讨论继续，旧记录将保留。');
            c.messages.push({ id: uid(), role: 'user', text: input, at: new Date().toISOString(), targetChapterId: chapter?.id, ...(c.excerpt ? { excerpt: clone(c.excerpt) } : {}) });
            if (c.messages.length === 1 && c.title === '创作讨论') c.title = input.split('\n')[0].slice(0, 40);
            c.draft = ''; c.excerpt = null; this.input.value = ''; this.dirty();
        }
        const user = c.messages.filter(x => !x.incomplete).at(-1);
        const chosenProfile=this.assistant();const config = clone({ instructions: p.instructions, useCharacter: p.useCharacter, useWorld: p.useWorld, useWorkspace:p.useWorkspace, useWorkspaceNotes:p.useWorkspaceNotes, workspaceRootId:p.workspaceRootId, workspaceFiles:p.workspaceFiles });const chapterReference=p.useChapter===false||!chapter?'':chapter.title+'\n'+chapter.outline+'\n'+chapter.text;
        const job = { project: p, conversation: c, cancelled: false, phase: '' };
        job.task = new WritingTask(phase => { job.phase = phase; if (this.job === job) this.renderMessages(); });
        this.job = job; this.setBusy(true); this.errors.delete(c.id); this.render();
        try {
            // Persist the user turn before making a potentially paid request.
            job.task.assistant=await resolveAssistant(api,chosenProfile,job.task);
            job.task.stage('正在保存当前问题…'); await job.task.wait(this.save(), 65000);
            const history = clone(c.messages.filter(x => !x.incomplete)); config.referenceContext=job.task.assistant.context;
            job.task.stage('正在读取角色与世界书…'); const reference = await job.task.wait(this.reference(config, excerptContent(history.at(-1))));
            const context=chapterReference;
            job.task.stage('正在整理上下文…');
            const count = createTokenCounter(api, job.task);
            const built = await job.task.wait(discussionPrompt({ messages: history, preferences: config.instructions, reference, chapter: context, count, assistantInstructions:job.task.assistant.instructions, budget:job.task.assistant.input }));
            if (job.cancelled) return;
            job.task.stage('正在等待模型响应…'); let lastPaint = 0;
            const result = await generateWriting(api, { assistant:job.task.assistant, prompt: built.messages, trimNames: false }, job.task, (text, thinking) => {
                job.phase = text ? '正在接收回复 · ' + text.length + ' 字' : thinking ? '模型正在推理，等待正文…' : '正在等待模型响应…';
                if (this.job === job && Date.now() - lastPaint > 80) { lastPaint = Date.now(); this.updatePending(job); }
            });
            if (job.cancelled) return;
            if (typeof result !== 'string' || !result.trim()) throw new WritingRequestError('模型没有返回内容，请重试回复。');
            const genInfo=job.task.assistant.info?{...job.task.assistant.info,...(job.task.usage?{usage:job.task.usage}:{})}:null;
            let recordText = result;
            const lastUserText = history.at(-1)?.text || '';
            const isNegativeWrite = /(?:不|不用|不要|别|无需)(?:写|草拟|续写|创作|起草|生成)(?:正文)?/.test(lastUserText) || /(?:仅|只|先)讨论/.test(lastUserText);
            const isWriteIntent = !isNegativeWrite && (
                /(?:写|草拟|续写|创作|起草|生成)(?:第[0-9一二三四五六七八九十百]+章|开头|正文|本章)/.test(lastUserText) ||
                /(?:直接|帮我|请)?(?:接续|写出|写入|生成|起草|续写)(?:下一[段节章]|该[段节章]|正文)/.test(lastUserText) ||
                /【剧情十字路口探讨/.test(lastUserText)
            );
            if (isWriteIntent && chapter) {
                const originalText = chapter.text || '';
                const separator = originalText.trim() ? '\n\n' : '';
                chapter.text = originalText + separator + result.trim();
                checkpoint(chapter, 'AI 创作直接写入正文');
                const bodyEl = document.getElementById('dw-body');
                if (bodyEl) { bodyEl.value = chapter.text; bodyEl.dispatchEvent(new Event('input', { bubbles: true })); }
                this.dirty();
                recordText = `✍️ **正文已直接写入中间画布**（新增 ${result.trim().length} 字，本章共 ${chapter.text.length} 字），已自动创建检查点。\n\n> 你可以直接在中间画布中阅读、排版与微调修改。`;
            }
            c.messages.push({ id: uid(), role: 'assistant', text: recordText, rawText: result, generationInfo:genInfo, reasoning:savedReasoning(job.task), at: new Date().toISOString(), targetChapterId: chapter?.id, omitted: built.omitted, ...(history.at(-1).excerpt ? { excerpt: clone(history.at(-1).excerpt) } : {}) });
            this.reasoningCache.set(c.messages.at(-1),collectedReasoning(job.task));job.replyRecorded = true; this.dirty(); job.task.stage('正在保存回复…'); await job.task.wait(this.save(), 65000);
        } catch (error) {
            job.task.cancel(error);
            if ((job.task.text.trim()||job.task.reasoning) && !job.replyRecorded) {
                const incompleteGenInfo=job.task.assistant?.info?{...job.task.assistant.info,...(job.task.usage?{usage:job.task.usage}:{})}:null;
                c.messages.push({ id: uid(), role: 'assistant', text: job.task.text||'本轮只收到接口思考内容，未收到正文。', reasoning:savedReasoning(job.task), generationInfo:incompleteGenInfo, incomplete: true, at: new Date().toISOString(), targetChapterId: chapter?.id, ...(user.excerpt ? { excerpt: clone(user.excerpt) } : {}) });
                this.reasoningCache.set(c.messages.at(-1),collectedReasoning(job.task));this.dirty(); void this.save().catch(() => {});
            }
            const message = job.cancelled ? '已停止。问题和已收到的草稿已保留，可重试回复。' : publicError(error, job.phase + '未能完成，请检查连接后重试；当前记录已保留。');
            if (job.cancelled && job.replyRecorded) this.errors.delete(c.id); else this.errors.set(c.id, message);
            if (!job.cancelled) throw new WritingRequestError(message);
        }
        finally { job.task.cancel(); if (this.job === job) { this.job = null; this.setBusy(false); this.render(); } }
    }
    async adopt(p, conversation, message) {
        if (!p.chapters.length) return;
        const box = el('div', undefined, 'dw-popup'); box.append(el('h3', '采用讨论内容到章节'));
        const target = el('select', undefined, 'text_pole'); target.setAttribute('aria-label', '采用目标章节'); p.chapters.forEach(ch => target.append(option(ch.id, ch.title)));
        const preferred = message.excerpt?.chapterId || message.targetChapterId;
        target.value = p.chapters.some(ch => ch.id === preferred) ? preferred : p.currentChapterId;
        target.append(option('__new__', '新建章节…'));
        const title = el('input', undefined, 'text_pole'); title.setAttribute('aria-label', '新章节标题'); title.placeholder = '新章节标题'; title.maxLength = 300; title.hidden = true;
        const placement = el('select', undefined, 'text_pole'); placement.setAttribute('aria-label', '采用方式');
        const text = el('textarea', undefined, 'text_pole dw-candidate'); text.value = message.text; text.setAttribute('aria-label', '采用的正文');
        const preview = el('section', undefined, 'dw-adoption-preview'); preview.hidden = true; preview.setAttribute('aria-label', '选段替换差量对比');
        const updatePreview = () => {
            preview.hidden = placement.value !== 'replace'; preview.replaceChildren();
            if (preview.hidden) return;
            const diff = inlineDiff(message.excerpt.text, text.value), content = el('div', undefined, 'dw-inline-diff');
            for (const part of diff.parts) content.append(el(part.type === 'delete' ? 'del' : part.type === 'insert' ? 'ins' : 'span', part.text));
            preview.append(el('small', '删除内容有红底删除线，新增内容以绿底标出。'), content);
            if (diff.simplified) preview.append(el('small', '改动较多，已合并显示连续差异；原文与候选均完整保留。'));
        };
        const updatePlacement = () => {
            title.hidden = target.value !== '__new__'; placement.replaceChildren(option('append', '追加到目标章节末尾'));
            if (message.excerpt?.chapterId === target.value) placement.append(option('replace', '替换当时引用的选段（校验原文）'));
            updatePreview();
        };
        target.onchange = updatePlacement; updatePlacement();
        placement.onchange = updatePreview;
        text.oninput = updatePreview;
        box.append(target, title, placement, preview, text, el('small', '可先删去分析或修改措辞。原讨论保留，采用前自动保存正文历史；引用后改过正文时，会阻止替换。'));
        if (await new Popup(box, POPUP_TYPE.CONFIRM, '', { wide: true, okButton: '采用正文', cancelButton: '保留讨论' }).show() !== POPUP_RESULT.AFFIRMATIVE) return;
        if (!text.value.trim()) throw new Error('采用的正文为空。');
        let chapter;
        if (target.value === '__new__') {
            if (!title.value.trim()) throw new Error('请填写新章节标题。');
            if (p.chapters.length >= 2000) throw new Error('当前作品已达到章节数量上限。');
            chapter = newChapter(title.value.trim());
        } else chapter = p.chapters.find(ch => ch.id === target.value);
        if (!chapter) throw new Error('目标章节已变化，请重新选择。');
        let selection = null;
        if (placement.value === 'replace') {
            const x = message.excerpt;
            const original = chapter.text;
            if (!x || chapter.id !== x.chapterId || await textRevision(original) !== x.revision || chapter.text !== original) throw new Error('正文已变化，已停止替换。请重新引用，或改为追加。');
            selection = { ...x, original };
        }
        applyCandidate(chapter, text.value, selection, placement.value === 'replace', { type: 'writing-chat', conversationId: conversation.id, messageId: message.id, at: new Date().toISOString() });
        if (target.value === '__new__') p.chapters.push(chapter);
        this.dirty(); await this.save(); this.showChapter(p.id, chapter.id);
    }
}
