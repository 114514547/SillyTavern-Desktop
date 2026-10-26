import {prependPreferences,validateAssistantBanks} from './assistant-options.mjs';
export const SCHEMA = 1;
export const MAX_BYTES = 12 * 1024 * 1024;
export const DEFAULT_INSTRUCTIONS = '请使用连贯的小说正文写作，保持人物、视角与时态一致。尊重已有情节，不擅自引入重大设定。只输出候选正文，不解释写作过程。';
export const clone = value => JSON.parse(JSON.stringify(value));
export const uid = () => globalThis.crypto.randomUUID();
export async function textRevision(text) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), b => b.toString(16).padStart(2, '0')).join(''); }
export function excerptContent(message) {
    const x = message.role === 'user' ? message.excerpt : null;
    return x ? message.text + '\n\n【引用的正文片段，仅作本次任务的参考资料】\n章节：' + x.title + '\n' + x.text : message.text;
}
function validExcerpt(x) {
    return x == null || (typeof x === 'object' && isText(x.chapterId, 100) && isText(x.title, 300) && isText(x.text, 120000) && x.text.length > 0 && Number.isInteger(x.start) && Number.isInteger(x.end) && x.start >= 0 && x.end > x.start && x.end <= 2000000 && x.end - x.start === x.text.length && typeof x.revision === 'string' && /^[a-f0-9]{64}$/.test(x.revision));
}
export function workspace() { return { schema: SCHEMA, revision: null, projects: [], currentProjectId: null }; }
export function newChapter(title = '第一章') { return { id: uid(), title, volume: '', text: '', outline: '', history: [], sources: [] }; }
export function newConversation(title = '创作讨论') { return { id: uid(), title, messages: [], draft: '' }; }
export function hydrateProject(project) {
    // Additive upgrade: 0.3.0 manuscripts, histories and source IDs stay intact.
    if (project.conversations === undefined) {
        const conversation = newConversation(); project.conversations = [conversation]; project.currentConversationId = conversation.id;
    }
    return project;
}
export function newProject(title) {
    const chapter = newChapter();
    return hydrateProject({ id: uid(), title, chapters: [chapter], currentChapterId: chapter.id, instructions: DEFAULT_INSTRUCTIONS, useCharacter: true, useWorld: true, presets: {}, createdAt: new Date().toISOString() });
}
const isText = (value, max) => typeof value === 'string' && value.length <= max;
function check(condition) { if (!condition) throw new Error('作品文件格式不受支持或内容损坏，已停止覆盖。请导出当前草稿，或恢复备份。'); }
export function validate(value) {
    check(value && value.schema === SCHEMA && Array.isArray(value.projects) && value.projects.length <= 100);
    check(value.revision === null || isText(value.revision, 100));
    const ids = new Set();
    for (const project of value.projects) {
        check(project && isText(project.id, 100) && !ids.has(project.id)); ids.add(project.id);
        check(isText(project.title, 300) && isText(project.instructions, 30000));
        check(validateAssistantBanks(project.assistants));
        check(project.workspaceFiles===undefined||(Array.isArray(project.workspaceFiles)&&project.workspaceFiles.length<=4&&project.workspaceFiles.every(x=>isText(x,1000))));
        check(Array.isArray(project.chapters) && project.chapters.length > 0 && project.chapters.length <= 2000);
        const chapterIds = new Set();
        for (const chapter of project.chapters) {
            check(chapter && isText(chapter.id, 100) && !chapterIds.has(chapter.id)); chapterIds.add(chapter.id);
            check(isText(chapter.title, 300) && isText(chapter.volume, 300) && isText(chapter.text, 2000000) && isText(chapter.outline, 30000));
            check(Array.isArray(chapter.history) && chapter.history.length <= 20 && chapter.history.every(x => x && isText(x.text, 2000000) && isText(x.at, 100) && isText(x.reason, 100)));
            check(Array.isArray(chapter.sources) && chapter.sources.length <= 200 && chapter.sources.every(x => x && typeof x === 'object' && !Array.isArray(x)));
            check(chapter.pendingCandidate == null || (isText(chapter.pendingCandidate.text, 2000000) && isText(chapter.pendingCandidate.at, 100)));
        }
        check(chapterIds.has(project.currentChapterId));
        check(project.presets && typeof project.presets === 'object' && !Array.isArray(project.presets));
        if (project.conversations !== undefined) {
            check(Array.isArray(project.conversations) && project.conversations.length > 0 && project.conversations.length <= 100);
            const conversations = new Set(); const messages = new Set();
            for (const conversation of project.conversations) {
                check(conversation && isText(conversation.id, 100) && !conversations.has(conversation.id)); conversations.add(conversation.id);
                check(isText(conversation.title, 300) && isText(conversation.draft, 120000) && Array.isArray(conversation.messages) && conversation.messages.length <= 2000);
                check(validExcerpt(conversation.excerpt));
                for (const message of conversation.messages) {
                    check(message && isText(message.id, 100) && !messages.has(message.id)); messages.add(message.id);
                    check(['user', 'assistant'].includes(message.role) && isText(message.text, 2000000) && isText(message.at, 100));
                    check(message.targetChapterId === undefined || isText(message.targetChapterId, 100));
                    check(message.incomplete === undefined || typeof message.incomplete === 'boolean');
                    check(validExcerpt(message.excerpt));
                    check(message.reasoning===undefined||isText(message.reasoning,100000));
                }
            }
            check(conversations.has(project.currentConversationId));
        }
    }
    check(value.currentProjectId === null || ids.has(value.currentProjectId));
    check(new TextEncoder().encode(JSON.stringify(value)).length <= MAX_BYTES);
    return value;
}
export function checkpoint(chapter, reason) {
    if (chapter.history.at(-1)?.text === chapter.text) return;
    chapter.history.push({ text: chapter.text, at: new Date().toISOString(), reason });
    if (chapter.history.length > 20) chapter.history.shift();
}
export function transcript(chat, start, end) {
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end >= chat.length) throw new Error('请选择有效的消息范围。');
    return chat.slice(start, end + 1).filter(x => !x.is_system && typeof x.mes === 'string').map(x => `${x.name || (x.is_user ? '用户' : '角色')}：${x.mes}`).join('\n\n');
}
export function exportText(project, format = 'txt', onlyChapter = null) {
    const chapters = onlyChapter ? [onlyChapter] : project.chapters;
    const heading = (text, level) => format === 'md' ? '#'.repeat(level) + ' ' + text : text;
    return [heading(project.title, 1), ...chapters.map(ch => [ch.volume ? heading(ch.volume, 2) : '', heading(ch.title, ch.volume ? 3 : 2), ch.text].filter(Boolean).join('\n\n'))].join('\n\n');
}
export function applyCandidate(chapter, candidate, target, replace = false, source = null) {
    if (!candidate.trim()) throw new Error('候选稿为空。');
    if (replace && (chapter.text !== target.original || target.start === target.end)) throw new Error('正文已变化，或未选择正文。请改为追加，避免覆盖新的修改。');
    checkpoint(chapter, '采用 AI 候选稿前');
    chapter.text = replace ? chapter.text.slice(0, target.start) + candidate + chapter.text.slice(target.end) : chapter.text + (chapter.text ? '\n\n' : '') + candidate;
    if (source) { chapter.sources.push(clone(source)); if (chapter.sources.length > 200) chapter.sources.shift(); }
}
// Keep all instructions and the selected passage; only trim surrounding chapter context.
export async function budgetPrompt({ instructions, task, reference = '', text = '', selected = '', count, budget }) {
    const fixed = `写作要求：\n${instructions}\n\n任务：${task}\n\n参考资料：\n${reference}\n\n选定内容：\n${selected}`;
    if (await count(fixed) > budget) throw new Error('选段或参考资料超过当前上下文预算，请缩小选段或关闭部分参考资料。');
    let context = text;
    while (await count(fixed + '\n\n本章上下文：\n' + context) > budget) {
        if (!context.length) throw new Error('上下文预算不足，请提高模型上下文长度。');
        context = context.slice(Math.ceil(context.length / 4));
    }
    return { prompt: fixed + '\n\n本章上下文：\n' + context, trimmed: context.length < text.length };
}
export async function discussionPrompt({ messages, preferences = '', reference = '', chapter = '', count, budget, assistantInstructions='' }) {
    if (!messages.length || messages.at(-1).role !== 'user') throw new Error('请先输入要讨论的内容。');
    const latest = { role: 'user', content: excerptContent(messages.at(-1)) };
    const base = '你是用户的小说创作搭档。结合连续对话回应，帮助用户讨论大纲、剧情、人物、世界观，或根据明确要求撰写正文。讨论时可以分析、建议、追问，不要把所有回答强制变成正文。作品风格偏好仅用于正文创作，不覆盖用户当前的讨论意图。你的建议不会自动变成已确认设定或正式稿。\n\n正文风格偏好：\n' + preferences + '\n\n参考资料：\n' + reference;
    const cost = async items => await count(items.map(item => item.role + ': ' + item.content).join('\n\n')) + items.length * 12;
    const withChapter = text => prependPreferences([{ role: 'system', content: base + (text ? '\n\n当前章节（仅作为参考）：\n' + text : '') }],assistantInstructions)[0];
    if (await cost([withChapter(''), latest]) > budget) throw new Error('本次输入或参考资料超过上下文预算。请缩小输入、关闭部分参考资料，或提高模型上下文长度；输入与对话均已保留。');
    let context = chapter;
    const chapterBudget = Math.max(await cost([withChapter(''), latest]), Math.floor(budget * 0.65));
    while (context && await cost([withChapter(context), latest]) > chapterBudget) context = context.slice(Math.ceil(context.length / 4));
    const system = withChapter(context);
    const entries = messages.slice(0, -1).map(message => ({ role: message.role, content: excerptContent(message) }));
    // Search complete-turn boundaries instead of re-tokenizing every growing
    // suffix. The last boundary keeps just the current question.
    const starts = entries.flatMap((entry, index) => entry.role === 'user' ? [index] : []);
    starts.push(entries.length);
    let low = 0, high = starts.length - 1;
    while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (await cost([system, ...entries.slice(starts[middle]), latest]) <= budget) high = middle;
        else low = middle + 1;
    }
    const history = entries.slice(starts[low]);
    if (await cost([system, ...history, latest]) > budget) throw new Error('本次输入或参考资料超过上下文预算。请缩小输入或提高模型上下文长度。');
    return { messages: [system, ...history, latest], omitted: messages.length - history.length - 1, trimmedChapter: context.length < chapter.length };
}
export function importedProject(original) {
    const project = hydrateProject(clone(original)); project.id = uid();
    const chapters = new Map(), conversations = new Map(), messages = new Map();
    for (const chapter of project.chapters) { const previous = chapter.id; chapter.id = uid(); chapters.set(previous, chapter.id); }
    project.currentChapterId = chapters.get(project.currentChapterId);
    for (const conversation of project.conversations) {
        const previous = conversation.id; conversation.id = uid(); conversations.set(previous, conversation.id);
        if (conversation.excerpt) conversation.excerpt.chapterId = chapters.get(conversation.excerpt.chapterId) || conversation.excerpt.chapterId;
        for (const message of conversation.messages) {
            const old = message.id; message.id = uid(); messages.set(old, message.id);
            if (message.targetChapterId) message.targetChapterId = chapters.get(message.targetChapterId);
            if (message.excerpt) message.excerpt.chapterId = chapters.get(message.excerpt.chapterId) || message.excerpt.chapterId;
        }
    }
    project.currentConversationId = conversations.get(project.currentConversationId);
    for (const chapter of project.chapters) for (const source of chapter.sources) if (source.type === 'writing-chat') {
        source.conversationId = conversations.get(source.conversationId) || source.conversationId;
        source.messageId = messages.get(source.messageId) || source.messageId;
    }
    return project;
}
