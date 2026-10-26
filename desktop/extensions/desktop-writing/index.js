import { doNewChat, extension_prompt_types, extension_prompt_roles, isGenerating } from '/script.js';
import { Popup, POPUP_TYPE, POPUP_RESULT } from '/scripts/popup.js';
import { getWorldInfoPrompt, selected_world_info, world_info } from '/scripts/world-info.js';
import { getChatCompletionModel } from '/scripts/openai.js';
import { openGroupById } from '/scripts/group-chats.js';
import { WritingStore, RECOVERY } from './store.mjs';
import { clone, uid, validate, newProject, newChapter, checkpoint, transcript, exportText, applyCandidate, budgetPrompt, importedProject, MAX_BYTES } from './model.mjs';
import { inlineDiff } from './inline-diff.mjs';
import { Discussion } from './discussion.mjs';
import { WritingLayout } from './layout.mjs';
import { WritingTask, createTokenCounter, generateWriting, publicError, WritingRequestError } from './generation.mjs';
import { LocalAgentUI } from './agent-ui.mjs';
import { RoleplayUI } from './roleplay-ui.mjs';
import {profileBank,selectedProfile,collectedReasoning,savedReasoning} from './assistant-options.mjs';
import {resolveAssistant} from './assistant-runtime.mjs';
import {renderAssistantSettings,reasoningPanel,generationPanel} from './assistant-ui.mjs';
import { SettingsDialog } from './settings-dialog.mjs';
import {ModernShell} from './modern-shell.mjs';
import {icon} from './icons.mjs';
import {DesktopTheme} from './theme.mjs';

const ctx = () => globalThis.SillyTavern.getContext();
const $id = id => document.getElementById(id);
const SCENE_KEY = 'desktop-writing-scene';
let store, mode = 'rp', ready = false, initialized = false, uiReady = false, generating = false, switching = false, saveTimer, selectedRange = null;
let writingLayout, discussion, draftTask, localAgent, roleplay, settingsDialog, modernShell;
function toggleFocusMode(){
    if(mode==='rp'){roleplay.toggleZen();return;}
    const active=document.body.classList.toggle('dw-zen-mode');
    if(mode==='agent')localAgent.layout.setZen(active);else setWritingView(active?'body':'workbench');
}
function draftPreview(text = '', visible = true, force = false) {
    const panel=$id('dw-draft-preview'), field=$id('dw-draft-preview-text');
    if(!panel||!field)return;
    panel.hidden=!visible;
    const now=Date.now();if(!force&&field.value&&now-(panel.lastPaint||0)<100)return;
    panel.lastPaint=now;
    const atEnd=field.scrollHeight-field.scrollTop-field.clientHeight<40;
    if(field.value!==text){field.value=text;if(atEnd)field.scrollTop=field.scrollHeight;}
}
const notify = message => globalThis.toastr?.error(message, '小说写作');
const project = () => store?.data.projects.find(p => p.id === store.data.currentProjectId);
const chapter = () => project()?.chapters.find(c => c.id === project().currentChapterId);
function assistantBank(lane){return profileBank(project(),lane,lane==='draft'?'正文写作':'小说讨论');}
function renderWritingSettings(){if(!project())return;for(const lane of ['discussion','draft']){const box=$id('dw-profile-'+lane);if(!box)continue;box.replaceChildren();renderAssistantSettings(box,{bank:assistantBank(lane),draft:lane==='draft',busy:generating,change:dirty,preview:p=>resolveAssistant(ctx(),p)});}}
function renderWorkspaceReference(){
    const box=$id('dw-workspace-reference'),p=project();if(!box||!p)return;box.replaceChildren();const picker=node('select',undefined,'text_pole');picker.setAttribute('aria-label','关联的本地设定工作区');picker.append(option('','不关联本地文件夹'));for(const root of localAgent?.data.roots||[])picker.append(option(root.id,root.name));picker.value=p.workspaceRootId||'';picker.onchange=()=>{p.workspaceRootId=picker.value||null;p.workspaceFiles=[];p.useWorkspace=!!picker.value;dirty();renderWorkspaceReference();};box.append(field('关联的本地设定工作区',picker));
    for(const [key,label]of [['useWorkspace','参考关联的本地资料'],['useWorkspaceNotes','参考作者确认的项目摘要']]){const input=node('input');input.type='checkbox';input.checked=!!p[key];input.onchange=()=>{p[key]=input.checked;dirty();};box.append(field(label,input));}
    for(const file of p.workspaceFiles||[]){const row=node('div'),open=button(file,'open-reference'),remove=button('移除','remove-reference');open.onclick=()=>void guarded(async()=>{await localAgent.selectRoot(p.workspaceRootId);await changeMode('agent');await localAgent.openFile(file);});remove.onclick=()=>{p.workspaceFiles=p.workspaceFiles.filter(x=>x!==file);dirty();renderWorkspaceReference();};row.append(open,remove);box.append(row);}
    const manage=button('在本地工作区选择与引用文件','manage-workspace');manage.onclick=()=>void guarded(async()=>{await changeMode('agent');localAgent.drawer='files';localAgent.renderDrawer();});box.append(manage,node('small','从本地工作区的文档预览点击“引用到当前作品”。最多 4 份，每份最多引用 12000 字符；不会自动发送整个文件夹。'));
}
async function assistantDialog(){
    if(!await ensureProject())return;const owner=project(),box=node('div',undefined,'dw-popup'),lane=node('select',undefined,'text_pole'),content=node('div');lane.append(option('discussion','小说讨论'),option('draft','正文写作'));box.append(field('配置用途',lane),content);
    const draw=()=>{content.replaceChildren();renderAssistantSettings(content,{bank:profileBank(owner,lane.value,lane.value==='draft'?'正文写作':'小说讨论'),draft:lane.value==='draft',busy:generating,change:dirty,preview:p=>resolveAssistant(ctx(),p)});};lane.onchange=draw;draw();
    await new Popup(box,POPUP_TYPE.TEXT,'',{wide:true,okButton:'关闭设置',allowVerticalScrolling:true}).show();renderWritingSettings();discussion.renderContext();await save();
}
const escapeHtml = str => String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function node(tag, text, className) { const result = document.createElement(tag); if (text !== undefined) result.textContent = text; if (className) result.className = className; return result; }
function option(value, text) { const result = node('option', text); result.value = value; return result; }
function field(label, input) { const result = node('label'); result.append(node('span', label), input); return result; }
function formatCount(len) {
    if (!len) return '0 字 | 预计阅读 1 分钟';
    const mins = Math.max(1, Math.round(len / 400));
    return `${len.toLocaleString()} 字 | 预计阅读 ${mins} 分钟`;
}
function button(text, action, glyph = '') { const result = node('button', undefined, 'menu_button menu_button_icon interactable'); result.type = 'button'; result.dataset.dwAction = action; if (glyph) result.append(icon(glyph)); result.append(node('span', glyph ? text.replace(/^[^\p{L}\p{N}]+/u,'') : text)); return result; }
function status(text) { if ($id('dw-save')) $id('dw-save').textContent = text; }
function dirty() { store.dirty(); clearTimeout(saveTimer); saveTimer = setTimeout(() => { void save().catch(() => {}); }, 700); }
async function save() { clearTimeout(saveTimer); return store.flush(); }
async function guarded(task) { try { await task(); } catch (error) { notify(error.message || '操作失败，当前草稿已保留。'); } }
function download(name, data, type = 'text/plain;charset=utf-8') {
    const url = URL.createObjectURL(new Blob([data], { type })); const link = node('a'); link.href = url; link.download = name.replace(/[<>:"/\\|?*]/g, '_'); link.click(); setTimeout(() => URL.revokeObjectURL(url), 3000);
}
function exportBundle() { download('酒馆写作-作品包-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(store.data, null, 2), 'application/json'); }
function setWritingView(view) {
    writingLayout.setView(view);
}
function filterChapters() {
    const search = $id('dw-chapter-search').value.trim().toLocaleLowerCase();
    for (const b of $id('dw-chapters').children) b.hidden = !b.textContent.toLocaleLowerCase().includes(search);
}
function renderReferences() {
    const p = project(), ch = chapter(), c = ctx();
    $id('dw-current-chapter').textContent = ch ? '当前章节：' + ch.title : '尚未创建章节';
    $id('dw-character-summary').textContent = p?.useCharacter ? '角色卡：' + (c.characters[c.characterId]?.name || '未选择（可以直接创作）') : '角色卡参考已关闭';
    $id('dw-world-summary').textContent = p?.useWorld ? '世界书：根据对话内容按原生规则激活' : '世界书参考已关闭';
    discussion.renderContext();
}
function render() {
    const p = project(), ch = chapter();
    const picker = $id('dw-project'); picker.replaceChildren(...store.data.projects.map(x => option(x.id, x.title)));
    if (p) picker.value = p.id;
    $id('dw-document').hidden = !ch; $id('dw-actions').hidden = !ch; $id('dw-empty').hidden = !!ch;
    $id('dw-instructions').value = p?.instructions || '';
    $id('dw-use-character').checked = p?.useCharacter ?? true; $id('dw-use-world').checked = p?.useWorld ?? true;
    $id('dw-use-chapter').checked = p?.useChapter ?? true;
    const nav = $id('dw-chapters'); nav.replaceChildren();
    for (const item of p?.chapters || []) {
        const b = button((item.volume ? item.volume + ' / ' : '') + item.title, 'chapter'); b.dataset.chapterId = item.id; b.setAttribute('aria-current', String(ch?.id === item.id)); nav.appendChild(b);
    }
    if (ch) { $id('dw-title').value = ch.title; $id('dw-volume').value = ch.volume; $id('dw-body').value = ch.text; $id('dw-outline').value = ch.outline; }
    $id('dw-count').textContent = ch ? formatCount(ch.text.length) : '';
    document.querySelector('[data-dw-action="recover-candidate"]').hidden = !ch?.pendingCandidate;
    const contextTitle = $id('dw-context-title');
    if (contextTitle) {
        if (mode === 'writing' && p) {
            contextTitle.innerHTML = `<span class="dw-context-book">《${escapeHtml(p.title || '未命名作品')}》</span>${ch ? `<span class="dw-context-sep">·</span><span class="dw-context-chapter">${escapeHtml((ch.volume ? ch.volume + ' / ' : '') + ch.title)}</span>` : ''}`;
            contextTitle.hidden = false;
        } else {
            contextTitle.hidden = true;
        }
    }
    filterChapters(); discussion.render(); renderReferences(); writingLayout.apply();renderWritingSettings();renderWorkspaceReference();
}
async function changeMode(next) {
    if (switching || next === mode) return;
    if(document.body.classList.contains('dw-zen-mode'))toggleFocusMode();
    if (settingsDialog && await settingsDialog.close() === false) return;
    switching = true;
    try {
        if (generating || isGenerating()) globalThis.toastr?.info('生成过程中可以查看另一工作区；本次生成继续使用启动时的配置。');
        mode = next;
        document.body.classList.toggle('dw-writing', mode === 'writing');
        document.body.classList.toggle('dw-agent-mode', mode === 'agent');
        document.body.classList.remove('dw-native-tools-open');
        $id('dw-save').hidden = mode !== 'writing';
        const chatToNovelBtn = document.querySelector('#dw-modebar [data-dw-action="chat-to-novel"]');
        if (chatToNovelBtn) chatToNovelBtn.hidden = mode !== 'rp' || !ctx()?.chatMetadata?.desktopWritingSource;
        roleplay?.setActive(mode === 'rp');
        $id('dw-writer').hidden = mode !== 'writing';
        if (localAgent) { localAgent.host.hidden = mode !== 'agent'; if (mode === 'agent') localAgent.render(); }
        document.querySelectorAll('#dw-modebar [data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
        const contextTitle = $id('dw-context-title');
        if (contextTitle) {
            const p = project(), ch = chapter();
            if (mode === 'writing' && p) {
                contextTitle.innerHTML = `<span class="dw-context-book">《${escapeHtml(p.title || '未命名作品')}》</span>${ch ? `<span class="dw-context-sep">·</span><span class="dw-context-chapter">${escapeHtml((ch.volume ? ch.volume + ' / ' : '') + ch.title)}</span>` : ''}`;
                contextTitle.hidden = false;
            } else {
                contextTitle.hidden = true;
            }
        }
    } finally { switching = false; }
}
function captureSelection() { const editor = $id('dw-body'); selectedRange = { start: editor.selectionStart, end: editor.selectionEnd, original: editor.value, projectId: project()?.id, chapterId: chapter()?.id }; }
async function ensureProject() {
    if (project()) return true;
    return createProject();
}
async function createProject() {
    if (store.data.projects.length >= 100) throw new Error('当前已达到 100 部作品，请使用作品包拆分到其他配置。');
    const name = await Popup.show.input('新建作品', '作品名称', '未命名作品'); if (!name?.trim()) return false;
    const p = newProject(name.trim().slice(0, 300)); store.data.projects.push(p); store.data.currentProjectId = p.id; dirty(); render(); await save(); return true;
}
async function projectOptions() {
    if (!await ensureProject()) return;
    const p = project(); const box = node('div', undefined, 'dw-popup');
    const title = node('input', undefined, 'text_pole'); title.value = p.title; title.maxLength = 300;
    box.append(field('作品名称', title), node('small', '导出的作品包包含正文与历史版本，请作为私人文件保管。'));
    const result = await new Popup(box, POPUP_TYPE.CONFIRM, '', { okButton: '保存名称', cancelButton: '取消', customButtons: [{ text: '导出作品包', action: exportBundle }] }).show();
    if (result === POPUP_RESULT.AFFIRMATIVE && title.value.trim()) { p.title = title.value.trim(); dirty(); render(); }
}
async function chapterAction(action) {
    if (!await ensureProject()) return;
    const p = project(), ch = chapter();
    if (action === 'add') {
        const title = await Popup.show.input('新建章节', '章节标题', '新章节'); if (!title?.trim()) return;
        const next = newChapter(title.trim().slice(0, 300)); p.chapters.push(next); p.currentChapterId = next.id;
    } else if (action === 'delete') {
        if (generating) throw new Error('请等待候选稿生成结束，再删除章节。');
        if (!ch || p.chapters.length < 2) throw new Error('请至少保留一个章节。');
        if (await Popup.show.confirm('删除章节', '请先确认已有作品包备份。确定删除当前章节及其历史版本？') !== POPUP_RESULT.AFFIRMATIVE) return;
        p.chapters.splice(p.chapters.indexOf(ch), 1); p.currentChapterId = p.chapters[0].id;
    } else if (action === 'up' || action === 'down') {
        const from = p.chapters.indexOf(ch); const to = from + (action === 'up' ? -1 : 1); if (to < 0 || to >= p.chapters.length) return;
        [p.chapters[from], p.chapters[to]] = [p.chapters[to], p.chapters[from]];
    }
    selectedRange = null; dirty(); render(); await save();
}
async function importBundle(data = null) {
    if (!data) {
        const input = node('input'); input.type = 'file'; input.accept = '.json,application/json';
        const file = await new Promise(resolve => { input.onchange = () => resolve(input.files[0]); input.oncancel = () => resolve(null); input.click(); });
        if (!file) return; if (file.size > MAX_BYTES) throw new Error('作品包超过 12 MB，请拆分后导入。'); data = JSON.parse(await file.text());
    }
    validate(data);
    if (store.data.projects.length + data.projects.length > 100) throw new Error('导入后将超过 100 部作品，请拆分作品包。');
    if (await Popup.show.confirm('导入作品包', '将作为新作品导入，不覆盖当前作品。继续？') !== POPUP_RESULT.AFFIRMATIVE) return;
    for (const original of data.projects) {
        const p = importedProject(original); p.title = (p.title + '（导入）').slice(0, 300);
        store.data.projects.push(p); store.data.currentProjectId = p.id;
    }
    dirty(); render(); await save();
}
async function showHistory() {
    const ch = chapter(); if (!ch) return;
    const box = node('div', undefined, 'dw-popup'); const picker = node('select', undefined, 'text_pole');
    ch.history.forEach((h, index) => picker.appendChild(option(String(index), new Date(h.at).toLocaleString() + ' · ' + h.reason)));
    if (!ch.history.length) { await Popup.show.text('历史版本', '尚无历史版本。可先保存快照；采用 AI 候选前也会自动保存。'); return; }
    const preview = node('textarea', undefined, 'text_pole'); preview.readOnly = true; preview.value = ch.history[0].text;
    picker.onchange = () => { preview.value = ch.history[Number(picker.value)].text; };
    box.append(picker, preview);
    if (await new Popup(box, POPUP_TYPE.CONFIRM, '', { okButton: '恢复此版本', cancelButton: '关闭', wide: true }).show() === POPUP_RESULT.AFFIRMATIVE) {
        const text = ch.history[Number(picker.value)].text; checkpoint(ch, '恢复历史版本前'); ch.text = text; dirty(); render(); await save();
    }
}
async function exportDialog() {
    if (!await ensureProject()) return;
    const p = project(), ch = chapter(), box = node('div', undefined, 'dw-popup');
    const scope = node('select', undefined, 'text_pole'); scope.append(option('chapter', '当前章节'), option('book', '整部作品'));
    const format = node('select', undefined, 'text_pole'); format.append(option('txt', 'TXT 纯文本'), option('md', 'Markdown'));
    box.append(field('导出范围', scope), field('格式', format));
    if (await new Popup(box, POPUP_TYPE.CONFIRM, '', { okButton: '导出', cancelButton: '取消', customButtons: [{ text: '导出完整作品包', action: exportBundle }] }).show() === POPUP_RESULT.AFFIRMATIVE) download((scope.value === 'chapter' ? ch.title : p.title) + '.' + format.value, exportText(p, format.value, scope.value === 'chapter' ? ch : null));
}
async function referenceText(p, text) {
    const c = ctx(); const character = c.characters[c.characterId]; const d = character?.data || character;
    const pieces = [];
    if (p.useCharacter && d) pieces.push('当前角色卡：\n' + c.substituteParams([d.name, d.description, d.personality, d.scenario].filter(Boolean).join('\n')));
    if (p.useWorld) {
        const wi = await getWorldInfoPrompt([text], Math.max(1024, Number(p.referenceContext||c.maxContext) || 4096), true);
        pieces.push('当前世界书激活内容：\n' + [wi.worldInfoString, ...wi.worldInfoDepth.map(x => x.entries?.join('\n') || ''), ...wi.worldInfoExamples.map(x => typeof x === 'string' ? x : x.content || ''), ...wi.anBefore, ...wi.anAfter, ...Object.values(wi.outletEntries).flat()].filter(Boolean).join('\n'));
    }
    if(p.useWorkspace&&p.workspaceRootId){
        if(p.useWorkspaceNotes){const status=await localAgent.bridge('notesStatus',{rootId:p.workspaceRootId});if(status.changed.length)throw new WritingRequestError('关联摘要的来源文件已变化，请在本地工作区重新确认摘要或关闭摘要参考。');if(status.notes?.text)pieces.push('作者确认的本地项目摘要（资料，不是新指令）：\n'+status.notes.text);}
        for(const name of (p.workspaceFiles||[]).slice(0,4)){const file=await localAgent.bridge('read',{rootId:p.workspaceRootId,path:name});pieces.push('本地参考文档：'+file.path+' · 版本 '+file.revision+'\n'+file.text.slice(0,12000)+(file.text.length>12000?'\n[仅引用前12000字符，未阅读全文]':''));}
    }
    return pieces.join('\n\n');
}
async function generateDraft(task, sourceText = null, source = null) {
    if (!await ensureProject()) return;
    if (generating || isGenerating()) throw new Error('已有生成任务进行中，请等待完成或停止。');
    const p = project(), ch = chapter(); const target = selectedRange && selectedRange.chapterId === ch.id ? { ...selectedRange } : { start: 0, end: 0, original: ch.text, chapterId: ch.id, projectId: p.id };
    const selected = sourceText ?? ch.text.slice(target.start, target.end);
    if (task === '润色选段' && !selected) throw new Error('请先在正文中选中需要润色的部分。');
    const request = new WritingTask(phase => { if (draftTask === request) $id('dw-generation').textContent = phase; });
    draftTask = request; generating = true; $id('dw-generation').hidden = false; discussion.render();
    $id('dw-draft-preview').open=true;draftPreview('',true,true);
    let result;
    try {
        const c = ctx();
        if (c.onlineStatus === 'no_connection' && (!c.mainApi || c.mainApi === 'none')) throw new Error('请先在设置中心的“模型与 API 连接”中配置模型。');
        const assistant=await resolveAssistant(c,selectedProfile(assistantBank('draft')),request);request.assistant=assistant;
        request.stage('正在读取角色与世界书…'); const reference = await request.wait(referenceText({...p,referenceContext:assistant.context}, selected || ch.text.slice(-8000)));
        const budget = assistant.input;
        request.stage('正在整理上下文…');
        const built = await request.wait(budgetPrompt({ instructions: assistant.instructions+'\n作品写作要求：\n'+p.instructions, task, reference: reference + (ch.outline ? '\n本章大纲：' + ch.outline : ''), text: ch.text, selected, count: createTokenCounter(c, request), budget }));
        if (built.trimmed) $id('dw-generation').textContent = '本章过长，仅使用末尾上下文；选段与写作要求完整保留。';
        request.stage('正在等待模型响应…');
        result = await generateWriting(c, { assistant, prompt: built.prompt, systemPrompt: '你是一位小说写作助手。请根据写作要求只输出候选正文。', trimNames: false }, request, (text, thinking) => { if (draftTask === request) { $id('dw-generation').textContent = text ? '正在接收候选稿 · ' + text.length + ' 字' : thinking ? '模型正在推理，等待正文…' : '正在等待模型响应…';draftPreview(text); } });
        if (typeof result !== 'string' || !result.trim()) throw new WritingRequestError('模型未返回候选正文，原文保持不变。');
    } catch (error) {
        request.cancel(error);
        if (request.text.trim()) { ch.pendingCandidate = { text: request.text, at: new Date().toISOString() }; dirty(); render(); void save().catch(() => {}); }
        if (error.name === 'AbortError') { globalThis.toastr?.info(request.text ? '已停止，可点击“未完成草稿”查看已收到的内容。' : '已停止本次生成，原正文保留。'); return; }
        throw new WritingRequestError(publicError(error));
    } finally { request.cancel(); if (draftTask === request) { draftPreview('',false,true);draftTask = null; generating = false; $id('dw-generation').hidden = true; discussion.render(); } }
    // Capture the original project/chapter. A mode or chapter switch never redirects the result.
    const box = node('div', undefined, 'dw-popup'); box.append(node('h3', '候选稿 · ' + p.title + ' / ' + ch.title));
    if(request.assistant)box.append(generationPanel({...request.assistant.info,usage:request.usage}));if(request.assistant?.profile.showReasoning&&request.reasoning)box.append(reasoningPanel(collectedReasoning(request)));
    const original = node('textarea', undefined, 'text_pole'); original.readOnly = true; original.value = selected || target.original.slice(-2000);
    const candidate = node('textarea', undefined, 'text_pole dw-candidate'); candidate.value = result;
    const placement = node('select', undefined, 'text_pole'); placement.append(option('append', '追加到原目标章节末尾'));
    const isSelectionTask = !source && target.start !== target.end;
    if (isSelectionTask) placement.append(option('replace', '替换当时选中的正文（会校验原文）'));
    if (isSelectionTask && task === '润色选段') placement.value = 'replace';
    const preview = node('section', undefined, 'dw-adoption-preview');
    const updatePreview = () => {
        preview.hidden = placement.value !== 'replace';
        preview.replaceChildren();
        if (preview.hidden) return;
        const diff = inlineDiff(selected || '', candidate.value);
        const content = node('div', undefined, 'dw-inline-diff');
        for (const part of diff.parts) content.append(node(part.type === 'delete' ? 'del' : part.type === 'insert' ? 'ins' : 'span', part.text));
        preview.append(node('small', '选段替换差量对比（红底删除线，绿底新增）：'), content);
        if (diff.simplified) preview.append(node('small', '改动较多，已合并显示连续差异；原文与候选均完整保留。'));
    };
    placement.onchange = updatePreview;
    candidate.oninput = updatePreview;
    updatePreview();
    box.append(field('原始选段 / 上下文', original), field('候选正文（可修改）', candidate), placement.children.length > 1 ? field('采用方式', placement) : placement, preview, node('small', '采用前自动保存历史版本。不会修改原聊天，也不会自动更新作品设定。'));
    const accepted = await new Popup(box, POPUP_TYPE.CONFIRM, '', { wide: true, okButton: '采用候选稿', cancelButton: '保留原文', allowVerticalScrolling: true }).show();
    if (accepted !== POPUP_RESULT.AFFIRMATIVE) return;
    if (!store.data.projects.includes(p) || !p.chapters.includes(ch)) throw new Error('目标章节已被删除，请复制候选稿到保留的章节。');
    applyCandidate(ch, candidate.value, target, placement.value === 'replace', source);
    dirty(); render(); setWritingView(writingLayout.mobile.matches ? 'body' : 'workbench'); await save(); await changeMode('writing');
}
async function recoverCandidate() {
    const p = project(), ch = chapter(); if (!ch?.pendingCandidate) return;
    const box = node('div', undefined, 'dw-popup'), text = node('textarea', undefined, 'text_pole dw-candidate'); text.value = ch.pendingCandidate.text;
    box.append(node('h3', '未完成候选稿'), text, node('small', '停止或中断时保存的内容，尚未成为章节正文。可编辑后追加，也可关闭并继续保留。'));
    if (await new Popup(box, POPUP_TYPE.CONFIRM, '', { wide: true, okButton: '追加到正文', cancelButton: '继续保留' }).show() !== POPUP_RESULT.AFFIRMATIVE) return;
    if (!store.data.projects.includes(p) || !p.chapters.includes(ch)) throw new Error('目标章节已变化。');
    applyCandidate(ch, text.value, null, false, { type: 'unfinished-generation', at: ch.pendingCandidate.at }); ch.pendingCandidate = null; dirty(); render(); await save();
}
async function chatToNovel(messageIndex = null) {
    if (!await ensureProject()) return;
    const c = ctx(); const originalChatId = c.getCurrentChatId(); if (!c.chat.length) throw new Error('当前聊天没有可转换的内容。');
    const box = node('div', undefined, 'dw-popup'); const start = node('input', undefined, 'text_pole'); const end = node('input', undefined, 'text_pole');
    for (const input of [start, end]) { input.type = 'number'; input.min = '1'; input.max = String(c.chat.length); }
    start.value = String(messageIndex === null ? Math.max(1, c.chat.length - 3) : messageIndex + 1); end.value = String(messageIndex === null ? c.chat.length : messageIndex + 1);
    const chapters = node('select', undefined, 'text_pole'); project().chapters.forEach(ch => chapters.append(option(ch.id, ch.title))); chapters.value = chapter().id;
    box.append(node('h3', '聊天片段改写为小说'), field('起始消息（从 1 开始）', start), field('结束消息', end), field('目标章节', chapters), node('small', '使用当前选中的回复分支，跳过系统消息。需要调用已连接的模型，结果先预览。'));
    if (await new Popup(box, POPUP_TYPE.CONFIRM, '', { okButton: '生成候选稿', cancelButton: '取消' }).show() !== POPUP_RESULT.AFFIRMATIVE) return;
    if (ctx().getCurrentChatId() !== originalChatId) throw new Error('聊天已经切换，请重新选择消息。');
    const from = Number(start.value) - 1, to = Number(end.value) - 1; const text = transcript(c.chat, from, to); if (!text.trim()) throw new Error('选段没有可使用的对话。');
    project().currentChapterId = chapters.value; selectedRange = null; dirty(); render();
    await generateDraft('把以下角色扮演对话改写为连贯的小说正文。去掉聊天标签与场外讨论，保留有价值的台词与行动，不虚构未经提供的重大事件。', text, { type: 'chat', chatId: c.getCurrentChatId(), avatar: c.characters[c.characterId]?.avatar || null, from, to, excerpt: text, at: new Date().toISOString() });
}
function updateScenePrompt() {
    const c = ctx(); const scene = c.chatMetadata?.desktopWritingSource;
    c.setExtensionPrompt(SCENE_KEY, scene?.prompt || '', extension_prompt_types.IN_PROMPT, 0, false, extension_prompt_roles.SYSTEM);
    const b = document.querySelector('#dw-modebar [data-dw-action="chat-to-novel"]');
    if (b) b.hidden = mode !== 'rp' || !scene;
}
async function novelToChat() {
    const p = project(), ch = chapter(); if (!p || !ch) throw new Error('请先创建作品并写入正文。');
    captureSelection(); const selection = selectedRange; const excerpt = ch.text.slice(selection.start, selection.end); if (!excerpt.trim()) throw new Error('请先在正文中选中要进入扮演的片段。');
    if (generating || isGenerating()) throw new Error('请等待当前生成任务结束。');
    const c = ctx(); const originalChatId = c.getCurrentChatId(); if (c.characterId === undefined || c.groupId) throw new Error('请先在角色管理中选择一个角色；目前暂不创建群聊分支。');
    const character = c.characters[c.characterId]; const box = node('div', undefined, 'dw-popup'); const preview = node('textarea', undefined, 'text_pole'); preview.value = excerpt; preview.readOnly = true;
    const state = node('textarea', undefined, 'text_pole'); state.placeholder = '可填写时间、地点、由你扮演谁，以及人物此时已经知道的信息。';
    box.append(node('h3', '从选段开始扮演'), node('p', 'AI 角色：' + character.name + '；用户身份沿用酒馆当前用户角色。'), preview, field('场景补充', state), node('small', '将创建新聊天并保留原聊天。仅带入正文到选段结束处；角色卡、已启用世界书仍沿用酒馆配置，请排除其中的未来剧情。'));
    if (await new Popup(box, POPUP_TYPE.CONFIRM, '', { okButton: '创建并进入扮演', cancelButton: '取消', wide: true }).show() !== POPUP_RESULT.AFFIRMATIVE) return;
    if (c.characterId !== ctx().characterId || originalChatId !== ctx().getCurrentChatId()) throw new Error('聊天已变化，请重新创建场景。');
    const built = await budgetPrompt({ instructions: '这是从小说创建的独立试演分支。以给定场景为准，角色扮演新产生的事件尚未成为小说正文。', task: '从选定的小说场景继续角色扮演。', reference: '作品：' + p.title + '\n章节：' + ch.title + '\n场景补充：' + state.value, text: ch.text.slice(0, selection.end), selected: excerpt, count: createTokenCounter(c, new WritingTask()), budget: Math.max(256, Math.floor((Number(c.maxContext) || 4096) * 0.4)) });
    const prompt = built.prompt;
    checkpoint(ch, '创建扮演分支前'); dirty(); await save();
    await c.saveChat(); await doNewChat({ deleteCurrentChat: false });
    const next = ctx();
    if (next.characterId !== c.characterId || next.getCurrentChatId() === originalChatId) throw new Error('未能创建独立聊天，已保留原聊天且停止写入场景。请稍后再试。');
    next.chatMetadata.desktopWritingSource = { projectId: p.id, chapterId: ch.id, revision: store.data.revision, excerpt, at: new Date().toISOString(), prompt };
    // The fresh chat belongs to this branch. Replace only its default greeting, never an existing chat.
    next.chat.splice(0); const message = { name: '小说场景', is_user: false, is_system: true, mes: excerpt, send_date: new Date().toISOString(), extra: { desktopWritingScene: true } }; next.chat.push(message); await next.printMessages(); updateScenePrompt(); await next.saveChat(); await changeMode('rp');
    globalThis.toastr?.success('已创建新的扮演分支，原聊天和小说正文保留。');
}
function decorateMessages() {
    document.querySelectorAll('#chat .mes[mesid]').forEach(message => {
        if (message.querySelector('.dw-message-to-novel') || message.getAttribute('is_system') === 'true') return;
        const parent = message.querySelector('.extraMesButtons') || message.querySelector('.mes_buttons'); if (!parent) return;
        const b = node('button', undefined, 'mes_button dw-message-to-novel fa-solid fa-file-pen interactable'); b.type = 'button'; b.title = '改写到小说'; b.setAttribute('aria-label', '改写到小说');
        b.onclick = event => { event.stopPropagation(); void guarded(() => chatToNovel(Number(message.getAttribute('mesid')))); }; parent.appendChild(b);
    });
}
function buildUI() {
    const bar = node('div', undefined, 'flex-container'); bar.id = 'dw-modebar';
    const brand = node('div', undefined, 'dw-brand'); brand.id = 'dw-brand';
    brand.innerHTML = '<span class="dw-brand-dot"></span><span class="dw-brand-title">ST DESKTOP</span>';
    const rp = button('角色扮演', 'mode', 'fa-comments'); rp.dataset.mode = 'rp'; rp.setAttribute('aria-pressed', 'true');
    const writing = button('小说写作', 'mode', 'fa-file-pen'); writing.dataset.mode = 'writing'; writing.setAttribute('aria-pressed', 'false');
    const agent = button('本地工作区', 'mode', 'fa-folder-open'); agent.dataset.mode = 'agent'; agent.setAttribute('aria-pressed', 'false');
    const modeNav = node('nav', undefined, 'dw-mode-nav'); modeNav.id = 'dw-mode-nav';
    modeNav.append(writing, rp, agent);
    const contextTitle = node('div', undefined, 'dw-context-title'); contextTitle.id = 'dw-context-title'; contextTitle.hidden = true;
    const saveStatus = node('span', '正在读取作品…'); saveStatus.id = 'dw-save'; saveStatus.setAttribute('role', 'status');
    const chatToNovelBtn = button('聊天转正文', 'chat-to-novel', 'fa-arrow-right-arrow-left');
    bar.append(brand, modeNav, contextTitle, chatToNovelBtn, saveStatus);
    const tools = node('div'); tools.id = 'dw-global-tools';
    const zenBtn = button('专注', 'zen-mode', 'fa-expand'); zenBtn.id = 'dw-zen-btn'; zenBtn.title = '快捷键 F10：专注模式';
    tools.append(zenBtn);
    document.body.classList.add('dw-desktop');
    const theme=new DesktopTheme();
    settingsDialog = new SettingsDialog({ctx,theme,busy:()=>generating||isGenerating(),getUsage:()=>{const last=mode==='agent'?localAgent?.thread?.messages.filter(m=>m.role==='assistant').at(-1):mode==='writing'?discussion?.current()?.messages?.filter(m=>m.role==='assistant').at(-1):null;return last?.usage||last?.generationInfo?.usage;},
        prepareNative:()=>roleplay?.suspendForSettings(),
        openAgentSettings:async()=>{await changeMode('agent');localAgent.drawer='settings';localAgent.renderDrawer();}});
    const unifiedSettings = button('酒馆设置', 'unified-settings', 'fa-gear'); unifiedSettings.id = 'dw-settings-modal-btn'; unifiedSettings.title = '酒馆设置 · Ctrl+,';
    tools.append(unifiedSettings);
    if(globalThis.localWorkspace?.appMenu){const appMenu=button('应用菜单','app-menu','fa-bars');appMenu.title='酒馆、编辑、视图、帮助（也可按 Alt 键）';tools.append(appMenu);}
    bar.append(tools);
    const writer = node('section'); writer.id = 'dw-writer'; writer.hidden = true;
    writer.innerHTML = `<div id="dw-projectbar" class="flex-container"><select id="dw-project" class="text_pole" aria-label="当前作品"></select></div>
        <div id="dw-workbench">
          <aside id="dw-navigation" aria-label="章节与参考资料">
            <select id="dw-navigation-tab" class="text_pole" aria-label="左栏内容"><option value="chapters">章节目录</option><option value="references">大纲与参考</option></select>
            <div id="dw-chapter-panel"><input id="dw-chapter-search" class="text_pole" type="search" aria-label="搜索章节" placeholder="搜索章节或卷名"><div id="dw-chaptertools" class="flex-container"></div><div id="dw-chapters"></div></div>
            <div id="dw-references" hidden><p id="dw-current-chapter"></p><div id="dw-prompt"><label>作品写作要求<textarea id="dw-instructions" class="text_pole" maxlength="30000"></textarea></label><label>本章大纲<textarea id="dw-outline" class="text_pole" maxlength="30000"></textarea></label><label class="checkbox_label"><input id="dw-use-character" type="checkbox"><span>参考当前角色卡</span></label><p id="dw-character-summary"></p><label class="checkbox_label"><input id="dw-use-world" type="checkbox"><span>参考当前启用的世界书</span></label><p id="dw-world-summary"></p><small>点击右上角“酒馆设置”可管理角色、世界书和模型。</small></div></div>
          </aside>
          <div class="dw-resizer" data-pane="left" role="separator" aria-label="调整目录宽度" aria-orientation="vertical" aria-valuemin="170" aria-valuemax="340" tabindex="0"></div>
          <section id="dw-main" aria-label="章节文稿"><div id="dw-selection-floating-bar" hidden><button type="button" class="menu_button interactable" data-dw-float-action="discuss-selection"><i class="fa-solid fa-quote-left" aria-hidden="true"></i><span>引用讨论</span></button><button type="button" class="menu_button interactable" data-dw-float-action="rewrite"><i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i><span>润色选段</span></button><button type="button" class="menu_button interactable" data-dw-float-action="novel-to-chat"><i class="fa-solid fa-comments" aria-hidden="true"></i><span>试演分支</span></button><button type="button" class="menu_button interactable dw-float-crossroads" data-dw-float-action="crossroads"><i class="fa-solid fa-compass" aria-hidden="true"></i><span>剧情推演</span></button></div><div id="dw-empty">从“新作品”开始创作，也可以先在右侧讨论大纲和人物。</div><div id="dw-document"><div id="dw-heading"><input id="dw-volume" class="text_pole" placeholder="所属卷（可选）" aria-label="所属卷" maxlength="300"><input id="dw-title" class="text_pole" placeholder="章节标题" aria-label="章节标题" maxlength="300"></div><textarea id="dw-body" class="text_pole" aria-label="小说正文" placeholder="在这里写作。选中一段后，可交给右侧 AI 讨论或修改。"></textarea><span id="dw-count"></span></div><div id="dw-generation" role="status" hidden></div><div id="dw-actions" class="flex-container"></div></section>
          <div class="dw-resizer" data-pane="right" role="separator" aria-label="调整对话宽度" aria-orientation="vertical" aria-valuemin="28" aria-valuemax="60" tabindex="0"></div>
        </div>`;
    const sheld = $id('sheld'); sheld.prepend(writer); sheld.prepend(bar);
    const preview=node('details');preview.id='dw-draft-preview';preview.hidden=true;
    preview.append(node('summary','候选稿实时预览 · 仅预览，采用后才修改正文'));
    const previewText=node('textarea',undefined,'text_pole');previewText.id='dw-draft-preview-text';previewText.readOnly=true;previewText.setAttribute('aria-label','候选稿实时预览');previewText.rows=6;preview.append(previewText);$id('dw-generation').after(preview);
    roleplay = new RoleplayUI({ctx,busy:()=>generating||isGenerating(),getWorld:()=>({selected_world_info,world_info}),getModel:c=>c.mainApi==='openai'?getChatCompletionModel():({textgenerationwebui:'文本补全',kobold:'Kobold',koboldhorde:'Kobold Horde',novel:'NovelAI'}[c.mainApi]||c.mainApi),
        openSettings:key=>settingsDialog.open(key==='model'?'models':key==='preset'?'params':key),
        selectPreset:async value=>{const manager=ctx().getPresetManager();if(!manager)throw new Error('当前接口没有原生预设管理器。');await manager.selectPreset(value);},
        openGroup:openGroupById,onChatToNovel:()=>chatToNovel(),
    });roleplay.mount(sheld);roleplay.setActive(true);saveStatus.hidden=true;bar.querySelector('[data-dw-action="chat-to-novel"]').hidden=true;
    localAgent = new LocalAgentUI({ ctx, busy: () => generating || isGenerating(), setBusy: value => { generating = value; discussion?.render(); }, reference: referenceText });
    localAgent.mount(sheld);
    modernShell=new ModernShell({ctx,model:()=>ctx().mainApi==='openai'?getChatCompletionModel():'当前原生连接',settings:tab=>settingsDialog.open(tab),commands:()=>[
        ...[['writing','小说写作'],['rp','角色扮演'],['agent','本地工作区']].map(([key,label])=>({label:'切换到 '+label,run:()=>changeMode(key)})),
        ...[['models','连接与模型'],['params','生成参数'],['world','世界书'],['appearance','外观与主题'],['background','聊天背景'],['extensions','扩展与正则'],['persona','用户身份'],['character','角色卡管理'],['format','提示格式']].map(([key,label])=>({label:'设置 · '+label,run:()=>settingsDialog.open(key)})),
        {label:'本地工作区 · 展开/收起文档栏',run:async()=>{await changeMode('agent');localAgent.layout.toggleFiles();}},
        {label:'本地工作区 · 展开/收起项目栏',run:async()=>{await changeMode('agent');localAgent.layout.toggleProjects();}},
        {label:'小说 · 新作品',run:async()=>{await changeMode('writing');$id('dw-projectbar').querySelector('[data-dw-action="new-project"]').click();}},
        ...(project()?.chapters||[]).map(ch=>({label:'章节 · '+ch.title,run:async()=>{await changeMode('writing');project().currentChapterId=ch.id;dirty();render();}})),
        ...(localAgent.data.threads||[]).map(t=>({label:'讨论 · '+t.title,run:async()=>{await changeMode('agent');if(localAgent.data.currentRoot!==t.rootId)await localAgent.selectRoot(t.rootId);localAgent.shadow.querySelector('[data-thread="'+t.id+'"]')?.click();}})),
    ]});
    localAgent.onReference=async(rootId,name)=>{const p=project();if(!p)throw new Error('请先在小说模式创建或选择作品。');if(p.workspaceRootId!==rootId)p.workspaceFiles=[];p.workspaceFiles??=[];if(!p.workspaceFiles.includes(name)){if(p.workspaceFiles.length>=4)throw new Error('当前作品最多引用4份文件，请先移除不需要的引用。');p.workspaceFiles.push(name);}p.workspaceRootId=rootId;p.useWorkspace=true;dirty();await save();renderWorkspaceReference();};
    localAgent.onAdopt=async text=>{const p=project(),ch=chapter();if(!p||!ch)throw new Error('请先在小说模式选择作品和章节。');applyCandidate(ch,text,null,false,{type:'agent-discussion',rootId:localAgent.root?.id,at:new Date().toISOString()});dirty();render();await save();localAgent.message('已追加到章节：'+ch.title+'；采用前的正文已保留历史。');};
    const viewbar = node('div', undefined, 'flex-container'); viewbar.id = 'dw-viewbar';
    const workbenchView = button('🍱 三栏创作', 'view', 'fa-table-columns'); workbenchView.dataset.view = 'workbench';
    const chatView = button('💬 专注对话', 'view', 'fa-comments'); chatView.dataset.view = 'discussion';
    const bodyView = button('📄 专注正文', 'view', 'fa-file-lines'); bodyView.dataset.view = 'body';
    viewbar.append(workbenchView, chatView, bodyView, button('📑 目录', 'navigation', 'fa-list'), button('📖 大纲与参考', 'references', 'fa-book-open'),button('⚙ 预设与思考','assistant-settings','fa-sliders'));
    const writingToolbar=node('div');writingToolbar.id='dw-writing-toolbar';$id('dw-projectbar').before(writingToolbar);writingToolbar.append($id('dw-projectbar'),viewbar);
    discussion = new Discussion({ project, chapter, ctx, dirty, save, ensureProject, reference: referenceText, assistant:()=>selectedProfile(assistantBank('discussion')), busy: () => generating || isGenerating(), setBusy: value => { generating = value; }, isReady: () => ready, showChapter: (projectId, chapterId) => {
        store.data.currentProjectId = projectId; project().currentChapterId = chapterId; selectedRange = null; dirty(); render(); setWritingView(writingLayout.mobile.matches ? 'body' : 'workbench'); void guarded(() => changeMode('writing'));
    } });
    discussion.mount($id('dw-workbench'));
    const includeChapter = node('label', undefined, 'checkbox_label');
    for(const lane of ['discussion','draft']){const details=node('details'),title=node('summary',lane==='discussion'?'小说讨论预设与思考':'正文写作预设与思考'),box=node('div');box.id='dw-profile-'+lane;details.append(title,box);$id('dw-prompt').append(details);}
    const workspaceBox=node('details');workspaceBox.append(node('summary','关联本地设定资料'));const workspaceFields=node('div');workspaceFields.id='dw-workspace-reference';workspaceBox.append(workspaceFields);$id('dw-prompt').append(workspaceBox);
    const includeInput = node('input'); includeInput.type = 'checkbox'; includeInput.id = 'dw-use-chapter'; includeInput.checked = true;
    includeChapter.append(includeInput, node('span', '对话参考当前章节正文与大纲')); $id('dw-use-world').closest('label').after(includeChapter);
    $id('dw-projectbar').append(button('✨ 新作品', 'new-project', 'fa-plus'), button('📁 作品', 'project-options', 'fa-book'), button('📥 导入', 'import', 'fa-file-import'), button('📤 导出', 'export', 'fa-download'));
    $id('dw-chaptertools').append(button('＋ 新章', 'add', 'fa-plus'), button('↑ 上移', 'up', 'fa-arrow-up'), button('↓ 下移', 'down', 'fa-arrow-down'));
    $id('dw-actions').append(button('💬 交给 AI 讨论', 'discuss-selection', 'fa-quote-left'), button('💾 保存', 'save', 'fa-floppy-disk'), button('📸 快照', 'snapshot', 'fa-camera'), button('⏳ 历史', 'history', 'fa-clock-rotate-left'), button('⚡ AI 续写', 'continue', 'fa-feather-pointed'), button('🪄 润色选段', 'rewrite', 'fa-wand-magic-sparkles'), button('🎭 从选段扮演', 'novel-to-chat', 'fa-comments'), button('⏹ 停止生成', 'stop', 'fa-stop'), button('🗑 删除章节', 'delete', 'fa-trash'));
    const recoveryButton = button('📄 未完成草稿', 'recover-candidate', 'fa-file-lines'); recoveryButton.hidden = true; $id('dw-actions').append(recoveryButton);
    writingLayout = new WritingLayout({ save: value => { if (ready) { store.data.layout = value; dirty(); } } });
    $id('dw-navigation-tab').onchange = () => writingLayout.apply();
    $id('dw-chapter-search').oninput = filterChapters;
    const actions = {
        'assistant-settings':assistantDialog,
        'new-project': createProject, 'project-options': projectOptions, import: () => importBundle(), export: exportDialog,
        add: () => chapterAction('add'), up: () => chapterAction('up'), down: () => chapterAction('down'), delete: () => chapterAction('delete'),
        navigation: () => writingLayout.toggleNavigation(), references: () => writingLayout.showReferences(),
        'discuss-selection': async () => { captureSelection(); const ch = chapter(); const selection = selectedRange; await discussion.attachExcerpt(ch, selection); setWritingView('workbench'); $id('dw-discussion-input').focus(); },
        save: () => save(), snapshot: async () => { if (chapter()) { checkpoint(chapter(), '手动快照'); dirty(); await save(); } }, history: showHistory,
        continue: () => generateDraft('续写本章末尾，保持上下文连贯，只输出新增加的正文。'), rewrite: () => generateDraft('润色选段'),
        'novel-to-chat': novelToChat, 'chat-to-novel': () => chatToNovel(), stop: () => { draftTask?.cancel(); discussion.stop(); }, 'recover-candidate': recoverCandidate,
        'crossroads': () => { captureSelection(); setWritingView('workbench'); discussion.triggerCrossroads(); },
        'zen-mode': toggleFocusMode,
        chapter: async event => { project().currentChapterId = event.target.closest('[data-chapter-id]').dataset.chapterId; selectedRange = null; dirty(); render(); setWritingView(writingLayout.mobile.matches ? 'body' : 'workbench'); },
    };
    for (const container of [bar, writer]) container.addEventListener('click', event => {
        const b = event.target.closest('[data-dw-action]'); if (!b) return;
        if (b.dataset.dwAction === 'mode') { void guarded(() => changeMode(b.dataset.mode)); return; }
        if (b.dataset.dwAction === 'unified-settings') { settingsDialog?.open(); return; }
        if (b.dataset.dwAction === 'native-settings') { settingsDialog?.open();return; }
        if (b.dataset.dwAction === 'app-menu') { void guarded(()=>globalThis.localWorkspace?.appMenu());return; }
        if (b.dataset.dwAction === 'view') { setWritingView(b.dataset.view); return; }
        if (!ready) { notify('作品文件尚未成功读取，请修复读取问题后重试。'); return; }
        void guarded(() => actions[b.dataset.dwAction]?.(event));
    });
    $id('dw-project').onchange = async event => { await guarded(async () => { store.data.currentProjectId = event.target.value; selectedRange = null; dirty(); render(); await save(); }); };
    for (const [id, key, chapterLevel] of [['dw-title', 'title', true], ['dw-volume', 'volume', true], ['dw-body', 'text', true], ['dw-outline', 'outline', true], ['dw-instructions', 'instructions', false]]) $id(id).addEventListener('input', event => {
        if (!ready) return; const target = chapterLevel ? chapter() : project(); if (!target) return; target[key] = event.target.value; dirty();
        if (id === 'dw-body') $id('dw-count').textContent = formatCount(target.text.length);
        if (id === 'dw-title' || id === 'dw-volume') { const b = document.querySelector('#dw-chapters [data-chapter-id="' + CSS.escape(target.id) + '"] span'); if (b) b.textContent = (target.volume ? target.volume + ' / ' : '') + target.title; }
        if (id === 'dw-title' || id === 'dw-volume') { filterChapters(); renderReferences(); }
    });
    for (const [id, key] of [['dw-use-character', 'useCharacter'], ['dw-use-world', 'useWorld'], ['dw-use-chapter', 'useChapter']]) $id(id).onchange = event => { if (project()) { project()[key] = event.target.checked; dirty(); renderReferences(); } };
    const floatingBar = $id('dw-selection-floating-bar');
    floatingBar.addEventListener('mousedown', e => e.preventDefault());
    floatingBar.addEventListener('click', event => {
        floatingBar.hidden = true;
        const b = event.target.closest('[data-dw-float-action]');
        if (!b || !ready) return;
        void guarded(() => actions[b.dataset.dwFloatAction]?.(event));
    });
    const updateFloatingBar = mouseEvent => {
        const editor = $id('dw-body');
        if (!editor || !floatingBar) return;
        const start = editor.selectionStart, end = editor.selectionEnd;
        if (start === null || end === null || end - start < 2) {
            floatingBar.hidden = true;
            return;
        }
        const main = $id('dw-main');
        if (!main) return;
        const mainRect = main.getBoundingClientRect();
        let left, top;
        if (mouseEvent && mouseEvent.clientX && mouseEvent.clientY) {
            left = mouseEvent.clientX - mainRect.left;
            top = mouseEvent.clientY - mainRect.top - 14;
        } else {
            const editorRect = editor.getBoundingClientRect();
            left = (editorRect.left + editorRect.width / 2) - mainRect.left;
            top = (editorRect.top + 36) - mainRect.top;
        }
        floatingBar.style.left = Math.max(120, Math.min(mainRect.width - 120, left)) + 'px';
        floatingBar.style.top = Math.max(16, Math.min(mainRect.height - 36, top)) + 'px';
        floatingBar.hidden = false;
    };
    $id('dw-body').addEventListener('mousedown', () => { floatingBar.hidden = true; });
    $id('dw-body').addEventListener('scroll', () => { floatingBar.hidden = true; });
    $id('dw-body').addEventListener('input', () => { floatingBar.hidden = true; });
    $id('dw-body').addEventListener('mouseup', e => { captureSelection(); updateFloatingBar(e); });
    $id('dw-body').addEventListener('keyup', e => {
        captureSelection();
        if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End') updateFloatingBar();
        else floatingBar.hidden = true;
    });
    $id('dw-body').addEventListener('select', captureSelection);
    $id('dw-body').addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void guarded(save); } });
    window.addEventListener('keydown', e => {
        if (e.key === 'F10' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && mode !== 'rp' && !document.querySelector('dialog[open]')) {
            e.preventDefault();
            toggleFocusMode();
        }
        if ((e.ctrlKey || e.metaKey) && (e.key === 'j' || e.key === 'J') && mode === 'writing') {
            e.preventDefault();
            setWritingView('workbench');
            discussion.triggerCrossroads();
        }
    });
}
async function initialize() {
    if (initialized) return; initialized = true; buildUI();
    const protection=globalThis.localWorkspace?.writingProtection?async arg=>{const response=await globalThis.localWorkspace.writingProtection(arg);if(!response?.ok)throw new Error(response?.error||'小说保护副本操作失败，请重试保存。');return response.value;}:null;
    store = new WritingStore({ headers: () => ctx().getRequestHeaders(), onStatus: status, protection, lock: task => navigator.locks ? navigator.locks.request('desktop-writing-save-v1', task) : task() });
    globalThis.SillyTavernDesktopWriting = Object.freeze({ get ready() { return uiReady; }, prepareToLeave: async () => { try { if (store.unsaved) await save(); return await localAgent.prepareToLeave(); } catch { return false; } }, settingsDialog });
    window.addEventListener('beforeunload', event => { if (store.unsaved || localAgent.unsaved || localAgent.editorDirty || localAgent.job) { event.preventDefault(); event.returnValue = ''; void save().catch(() => {}); void localAgent.prepareToLeave(); } });
    document.addEventListener('click', event => {
        if (generating && event.target.closest('#send_but, #option_regenerate, #option_continue, .swipe_right')) {
            event.preventDefault(); event.stopImmediatePropagation(); globalThis.toastr?.warning('请先完成或停止写作生成，再发送扮演消息。');
        }
    }, true);
    $id('send_textarea')?.addEventListener('keydown', event => { if (generating && event.key === 'Enter') { event.preventDefault(); event.stopImmediatePropagation(); } }, true);
    try { await store.load(); writingLayout.restore(store.data.layout); ready = true; render();if(store.restored)globalThis.toastr?.info('原小说存档缺失，已读取校验保护副本。下次保存将恢复主存档，原正文未自动改写。'); }
    catch {
        const recovery = button('导出恢复文件', 'recovery', 'fa-download'); recovery.onclick = () => { void guarded(async () => { const data = await store.read(RECOVERY); if (!data) throw new Error('未找到恢复文件。'); download('写作恢复作品包.json', JSON.stringify(data, null, 2), 'application/json'); }); }; $id('dw-modebar').appendChild(recovery);
    }
    let agentLoaded = true;
    await localAgent.load().catch(error => { agentLoaded = false; localAgent.message(error.message || '本地工作区未能载入，请重启后重试。', true); });
    renderWorkspaceReference();
    const c = ctx(); c.eventSource.on(c.eventTypes.CHAT_CHANGED, () => { updateScenePrompt(); decorateMessages(); if (ready) renderReferences(); });
    for (const name of ['CHARACTER_MESSAGE_RENDERED', 'USER_MESSAGE_RENDERED', 'MESSAGE_UPDATED', 'MESSAGE_SWIPED']) if (c.eventTypes[name]) c.eventSource.on(c.eventTypes[name], decorateMessages);
    updateScenePrompt(); decorateMessages();
    modernShell?.refresh();
    if (ready && agentLoaded) { uiReady = true; void globalThis.localWorkspace?.startupReady?.().catch(() => {}); }
}
ctx().eventSource.on(ctx().eventTypes.APP_READY, () => guarded(initialize));
