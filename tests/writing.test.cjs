'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs/promises'); const path = require('node:path');
const { installWritingExtension } = require('../desktop/services/writing-extension.cjs');
const model = import('../desktop/extensions/desktop-writing/model.mjs');
const storage = import('../desktop/extensions/desktop-writing/store.mjs');
function transport() {
  const files = new Map(); let failWrite = false;
  return { files, fail: value => { failWrite = value; }, request: async (url, options = {}) => {
    if (options.method === 'POST') {
      if (failWrite) return new Response('', { status: 500 });
      const body = JSON.parse(options.body); files.set(body.name, Buffer.from(body.data, 'base64').toString('utf8')); return Response.json({ path: 'user/files/' + body.name });
    }
    const key = url.split('/').at(-1); return files.has(key) ? new Response(files.get(key)) : new Response('', { status: 404 });
  } };
}
async function setup(t) {
  const { WritingStore } = await storage; const m = await model; const api = t || transport();
  const store = new WritingStore({ request: api.request, headers: () => ({ 'x-csrf-token': 'fixture' }) });
  await store.load(); const p = m.newProject('中文作品'); store.data.projects.push(p); store.data.currentProjectId = p.id; store.dirty();
  return { store, api, m, p, ch: p.chapters[0] };
}
test('writing Unicode persists, confirmed recovery is previous version, and restart reloads', async () => {
  const { store, api, ch } = await setup(); const { WritingStore, FILE, RECOVERY } = await storage;
  ch.text = '第一段。🌧️'; await store.flush(); const old = JSON.parse(api.files.get(FILE));
  ch.text += '\n第二段'; store.dirty(); await store.flush();
  assert.deepEqual(JSON.parse(api.files.get(RECOVERY)), old);
  const restarted = new WritingStore({ request: api.request, headers: () => ({}) }); await restarted.load();
  assert.equal(restarted.data.projects[0].chapters[0].text, '第一段。🌧️\n第二段'); assert.equal(store.unsaved, false);
});
test('failed save retains dirty draft and retries; failed read never overwrites', async () => {
  const { store, api, ch } = await setup(); api.fail(true); await assert.rejects(store.flush());
  assert.equal(store.unsaved, true); ch.text = '不能丢失'; api.fail(false); await store.flush(); assert.equal(store.unsaved, false);
  const { WritingStore, FILE } = await storage; api.files.set(FILE, '{corrupt');
  const broken = new WritingStore({ request: api.request, headers: () => ({}) }); await assert.rejects(broken.load()); broken.dirty(); await assert.rejects(broken.flush()); assert.equal(api.files.get(FILE), '{corrupt');
});
test('second writer cannot overwrite a newer revision', async () => {
  const { store, api, ch } = await setup(); const { WritingStore } = await storage; await store.flush();
  const second = new WritingStore({ request: api.request, headers: () => ({}) }); await second.load();
  ch.text = '窗口一'; store.dirty(); await store.flush(); second.data.projects[0].chapters[0].text = '窗口二'; second.dirty();
  await assert.rejects(second.flush(), /另一窗口/); assert.equal(second.unsaved, true);
});
test('candidate replacement rejects changed text; adoption records source and reversible history', async () => {
  const { m, ch } = await setup(); ch.text = '旧正文'; const target = { start: 0, end: 1, original: ch.text };
  ch.text = '我改过的正文'; assert.throws(() => m.applyCandidate(ch, '新', target, true), /正文已变化/);
  m.applyCandidate(ch, '新的段落', target, false, { chatId: 'fixture', from: 0, to: 1 });
  assert.equal(ch.history[0].text, '我改过的正文'); assert.ok(ch.text.endsWith('新的段落')); assert.equal(ch.sources[0].chatId, 'fixture');
});
test('export order, transcript range, and budget keep mandatory selected content', async () => {
  const { m, p, ch } = await setup(); ch.text = '正文一'; const next = m.newChapter('第二章'); next.text = '正文二'; p.chapters.push(next);
  assert.match(m.exportText(p, 'md'), /## 第一章[\s\S]*## 第二章/);
  assert.equal(m.transcript([{ name: 'A', mes: 'a' }, { is_system: true, mes: 'secret' }, { name: 'B', mes: 'b' }], 0, 2), 'A：a\n\nB：b');
  assert.throws(() => m.transcript([], -1, 9));
  const budgeted = await m.budgetPrompt({ instructions: '要求', task: '续写', selected: '必须保留', text: 'x'.repeat(3000), count: s => s.length, budget: 160 });
  assert.ok(budgeted.trimmed); assert.ok(budgeted.prompt.includes('必须保留')); assert.ok(budgeted.prompt.length <= 160);
  await assert.rejects(m.budgetPrompt({ instructions: '', task: '', selected: 'x'.repeat(300), count: s => s.length, budget: 100 }));
});
test('malformed imports and unknown schema are refused', async () => {
  const { store, m } = await setup(); const bad = m.clone(store.data); bad.schema = 99; assert.throws(() => m.validate(bad));
  const duplicate = m.clone(store.data); duplicate.projects[0].chapters.push(m.clone(duplicate.projects[0].chapters[0])); assert.throws(() => m.validate(duplicate));
});
test('0.3.0 manuscript upgrade adds discussions without altering chapters or writing a file on load', async () => {
  const { store, api, ch, m } = await setup(); const { WritingStore, FILE } = await storage;
  ch.text = '旧版的正式正文'; m.checkpoint(ch, '原快照');
  delete store.data.projects[0].conversations; delete store.data.projects[0].currentConversationId;
  await store.flush(); const before = api.files.get(FILE); const chapters = JSON.stringify(store.data.projects[0].chapters);
  const next = new WritingStore({ request: api.request, headers: () => ({}) }); await next.load();
  assert.equal(JSON.stringify(next.data.projects[0].chapters), chapters); assert.equal(next.data.projects[0].conversations.length, 1); assert.equal(next.unsaved, false); assert.equal(api.files.get(FILE), before);
});
test('discussion history and unsent draft persist; adopting a reply requires an explicit operation', async () => {
  const { store, api, p, ch, m } = await setup(); const { WritingStore } = await storage; const conversation = p.conversations[0];
  const user = { id: m.uid(), role: 'user', text: '给女主增加一个隐藏动机', at: new Date().toISOString() };
  const reply = { id: m.uid(), role: 'assistant', text: '她寻找来信，其实是为了归还一份旧债。', at: new Date().toISOString(), targetChapterId: ch.id };
  conversation.messages.push(user, reply); conversation.draft = '还没发送的追问'; store.dirty(); await store.flush();
  assert.equal(ch.text, '');
  const restarted = new WritingStore({ request: api.request, headers: () => ({}) }); await restarted.load();
  assert.equal(restarted.data.projects[0].conversations[0].draft, '还没发送的追问'); assert.deepEqual(restarted.data.projects[0].conversations[0].messages, [user, reply]);
  m.applyCandidate(ch, reply.text, null, false, { type: 'writing-chat', conversationId: conversation.id, messageId: reply.id });
  assert.equal(ch.text, reply.text); assert.equal(ch.history[0].text, ''); assert.equal(ch.sources[0].messageId, reply.id);
  const imported = m.importedProject(p); m.validate({ ...m.workspace(), projects: [imported], currentProjectId: imported.id });
  assert.notEqual(imported.id, p.id); assert.equal(imported.chapters[0].sources[0].conversationId, imported.conversations[0].id); assert.equal(imported.chapters[0].sources[0].messageId, imported.conversations[0].messages[1].id);
});
test('discussion prompt retains recent roles and user intent and reports omitted older context', async () => {
  const m = await model; const history = [{ role: 'user', text: '大纲：女主是一位药师' }, { role: 'assistant', text: '她可以有一位失联的老师' }, { role: 'user', text: '把老师改成姐姐，不要开始写正文' }];
  const built = await m.discussionPrompt({ messages: history, count: s => s.length, budget: 2000 });
  assert.deepEqual(built.messages.slice(1).map(x => x.role), ['user', 'assistant', 'user']); assert.ok(built.messages[0].content.includes('讨论时可以分析')); assert.equal(built.omitted, 0);
  const reduced = await m.discussionPrompt({ messages: [{ role: 'user', text: '很早的讨论'.repeat(1000) }, { role: 'assistant', text: '旧回复' }, ...history], chapter: '长篇正文'.repeat(1000), count: s => s.length, budget: 550 });
  assert.ok(reduced.omitted > 0); assert.ok(reduced.trimmedChapter); assert.equal(reduced.messages.at(-1).content, history.at(-1).text);
  await assert.rejects(m.discussionPrompt({ messages: [{ role: 'user', text: 'x'.repeat(1000) }], count: s => s.length, budget: 300 }));
});
test('bundled extension install preserves core, updates with backup, and refuses occupied namespace', async () => {
  const base = path.resolve(__dirname, '../test-results/writing-install-' + Date.now());
  const root = path.join(base, 'backend'), source = path.resolve(__dirname, '../desktop/extensions/desktop-writing'), backupRoot = path.join(base, 'backups');
  await fs.mkdir(path.join(root, 'public'), { recursive: true }); await fs.writeFile(path.join(root, 'public/index.html'), 'UPSTREAM');
  const target = await installWritingExtension({ root, source, backupRoot }); await installWritingExtension({ root, source, backupRoot });
  assert.equal(await fs.readFile(path.join(root, 'public/index.html'), 'utf8'), 'UPSTREAM');
  await fs.writeFile(path.join(target, 'index.js'), '// private old revision'); await installWritingExtension({ root, source, backupRoot });
  const backups = await fs.readdir(backupRoot); assert.equal(backups.length, 1); assert.equal(await fs.readFile(path.join(backupRoot, backups[0], 'index.js'), 'utf8'), '// private old revision');
  await fs.writeFile(path.join(target,'modern-agent.css'),'/* retired UI */');await installWritingExtension({root,source,backupRoot});
  await assert.rejects(fs.access(path.join(target,'modern-agent.css')));const retiredBackups=await fs.readdir(backupRoot);assert.equal(retiredBackups.length,2);
  assert.ok((await Promise.all(retiredBackups.map(n=>fs.readFile(path.join(backupRoot,n,'modern-agent.css'),'utf8').catch(()=>'')))).includes('/* retired UI */'));
  await fs.unlink(path.join(target, 'discussion.mjs')); await installWritingExtension({ root, source, backupRoot }); assert.ok((await fs.readFile(path.join(target, 'discussion.mjs'), 'utf8')).includes('class Discussion'));
  await fs.unlink(path.join(target, 'layout.mjs')); await installWritingExtension({ root, source, backupRoot }); assert.ok((await fs.readFile(path.join(target, 'layout.mjs'), 'utf8')).includes('class WritingLayout'));
  await fs.unlink(path.join(target, 'generation.mjs')); await installWritingExtension({ root, source, backupRoot }); assert.ok((await fs.readFile(path.join(target, 'generation.mjs'), 'utf8')).includes('class WritingTask'));
  await fs.writeFile(path.join(target, 'user-note.txt'), 'KEEP'); await assert.rejects(installWritingExtension({ root, source, backupRoot }), /额外文件/);
  assert.equal(await fs.readFile(path.join(target, 'user-note.txt'), 'utf8'), 'KEEP');
});

test('quoted passages survive saves and imports and stay mandatory in model context', async () => {
  const { store, api, p, ch, m } = await setup(); const { WritingStore } = await storage;
  ch.text = '前文。必须核对的原始选段。后文。';
  const excerpt = { chapterId: ch.id, title: ch.title, text: '必须核对的原始选段。', start: 3, end: 14, revision: await m.textRevision(ch.text) };
  excerpt.end = excerpt.start + excerpt.text.length;
  const conversation = p.conversations[0]; conversation.excerpt = excerpt; conversation.draft = '讨论这一段';
  store.data.layout = { view: 'workbench', left: 220, right: 42, navigation: true };
  ch.pendingCandidate = { text: '尚未写入正文的候选稿', at: new Date().toISOString() };
  conversation.messages.push({ id: m.uid(), role: 'user', text: '讨论这一段', excerpt: m.clone(excerpt), at: new Date().toISOString() });
  store.dirty(); await store.flush();
  const loaded = new WritingStore({ request: api.request, headers: () => ({}) }); await loaded.load();
  assert.deepEqual(loaded.data.projects[0].conversations[0].excerpt, excerpt);
  assert.deepEqual(loaded.data.layout, store.data.layout);
  assert.deepEqual(loaded.data.projects[0].chapters[0].pendingCandidate, ch.pendingCandidate);
  const imported = m.importedProject(p); m.validate({ ...m.workspace(), projects: [imported], currentProjectId: imported.id });
  assert.equal(imported.conversations[0].excerpt.chapterId, imported.chapters[0].id);
  assert.equal(imported.conversations[0].messages[0].excerpt.chapterId, imported.chapters[0].id);
  const built = await m.discussionPrompt({ messages: conversation.messages, count: text => text.length, budget: 1200 });
  assert.ok(built.messages.at(-1).content.includes(excerpt.text));
  const long = { ...conversation.messages[0], excerpt: { ...excerpt, text: '长选段'.repeat(1000) } };
  await assert.rejects(m.discussionPrompt({ messages: [long], count: text => text.length, budget: 400 }));
  const damaged = m.clone(store.data); damaged.projects[0].conversations[0].excerpt.start = -1; assert.throws(() => m.validate(damaged));
});

test('text revisions detect edits outside the quoted passage; bad layout storage falls back safely', async () => {
  const m = await model; const { layoutPreferences } = await import('../desktop/extensions/desktop-writing/layout.mjs');
  assert.notEqual(await m.textRevision('前文。选段。后文。'), await m.textRevision('新前文。选段。后文。'));
  assert.deepEqual(layoutPreferences(null), { view: 'workbench', left: 200, right: 28, navigation: true });
  assert.deepEqual(layoutPreferences({ view: '<bad>', left: -500, right: Infinity, navigation: false }), { view: 'workbench', left: 170, right: 28, navigation: false });
});

test('discussion packs long histories with logarithmic counts while keeping complete recent turns and quotes',async()=>{
  const m=await model,messages=[];for(let i=0;i<100;i++)messages.push({role:'user',text:'问题'+i+'问'.repeat(100)},{role:'assistant',text:'答复'+i+'答'.repeat(100)});messages.push({role:'user',text:'当前问题'});
  let calls=0;const count=text=>{calls++;return text.length;};
  const built=await m.discussionPrompt({messages,count,budget:100000});assert.equal(built.omitted,0);assert.equal(built.messages.length,202);assert.ok(calls<=12,'count calls: '+calls);
  calls=0;const limited=await m.discussionPrompt({messages,count,budget:1200});assert.ok(calls<=12);assert.equal(limited.messages[1].role,'user');assert.equal(limited.messages.at(-1).content,'当前问题');assert.ok(limited.messages.some(message=>message.content.startsWith('答复99')));assert.ok(limited.omitted>0);
  const actual=limited.messages.reduce((sum,message)=>sum+message.role.length+2+message.content.length,0)+(limited.messages.length-1)*2+limited.messages.length*12;assert.ok(actual<=1200);
});
