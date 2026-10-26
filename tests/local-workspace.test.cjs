'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path'), crypto = require('node:crypto');
const { LocalWorkspace, relative, decode, encode, docxText } = require('../desktop/services/local-workspace.cjs');
async function setup() {
  const base = path.resolve(__dirname, '../test-results/agent-' + crypto.randomUUID()), folder = path.join(base, '设定 文档'); await fs.mkdir(folder, { recursive: true });
  const service = new LocalWorkspace({ home: path.join(base, 'private') }); const root = await service.connect(folder); return { service, root, base, folder };
}
test('project display name and Agent defaults persist without changing folder grants',async()=>{const{service,root,folder}=await setup();const{agentPresetDefaults}=await import('../desktop/extensions/desktop-writing/assistant-options.mjs');const value=await service.saveProject({rootId:root.id,name:'新的显示名',defaultAssistants:{agent:{schema:1,selected:1,presets:agentPresetDefaults()}}});assert.equal(value.path,folder);assert.equal(value.name,'新的显示名');assert.equal((await new LocalWorkspace({home:service.home}).state()).roots[0].defaultAssistants.agent.selected,1);await assert.rejects(service.saveProject({rootId:root.id,name:'过期名称'}),/已被修改/);assert.equal((await service.state()).roots[0].path,folder);});
test('workspace path boundary rejects traversal, drives, credentials, reserved names and links', async () => {
  for (const name of ['../a.txt', '/a.txt', 'D:/a.txt', 'a\\b.md', 'a:stream.txt', '.env', 'secrets.json', 'config.yaml', 'dir/.git/a.md', 'dir/../a.txt', 'NUL.txt', 'a./b.md', 'a//b.txt']) assert.throws(() => relative(name));
  const { service, root, folder, base } = await setup(); await fs.writeFile(path.join(base, 'outside.txt'), 'outside');
  await assert.rejects(service.read({ rootId: root.id, path: '../outside.txt' }));
  await fs.symlink(base, path.join(folder, 'junction'), 'junction'); await assert.rejects(service.list({ rootId: root.id, path: 'junction' }));
  await fs.link(path.join(base, 'outside.txt'), path.join(folder, 'linked.txt')); await assert.rejects(service.read({ rootId: root.id, path: 'linked.txt' }));
  assert.equal(await fs.readFile(path.join(base, 'outside.txt'), 'utf8'), 'outside'); await assert.rejects(service.connect(path.parse(folder).root));
});
test('read/search are bounded, skip credentials and persist folder grants without reading documents', async () => {
  const { service, root, folder } = await setup(); await fs.mkdir(path.join(folder, '人物')); await fs.writeFile(path.join(folder, '人物/角色.md'), '她是药师，保护线人。'); await fs.writeFile(path.join(folder, 'secrets.json'), 'PRIVATE-KEY');
  assert.equal((await service.list({ rootId: root.id })).entries.length, 1);
  const search = await service.search({ rootId: root.id, query: '药师' }); assert.equal(search.results[0].path, '人物/角色.md');
  assert.equal((await new LocalWorkspace({ home: service.home }).state()).currentRoot, root.id);
  await fs.writeFile(path.join(folder, 'oversize.txt'), 'a'.repeat(1024 * 1024 + 1)); await assert.rejects(service.read({ rootId: root.id, path: 'oversize.txt' }), /过大/);
  await assert.rejects(service.read({ rootId: root.id, path: 'secrets.json' }));
});

test('search supports Chinese AND/OR queries, ranks concise relevant documents and keeps the IPC shape', async () => {
  const { service, root, folder } = await setup();
  await fs.writeFile(path.join(folder, 'a-冗长.md'), '林风的武器设定：长剑。' + '天气晴朗。'.repeat(400));
  await fs.writeFile(path.join(folder, 'z-精确.md'), '林风的武器是一把长剑。这里补充人物设定。');
  await fs.writeFile(path.join(folder, '另一位.md'), '沈舟的武器是一把长弓。');
  const query = value => service.search({ rootId: root.id, query: value });
  const result = await query('林风 武器 设定');
  assert.deepEqual(Object.keys(result).sort(), ['limited', 'results', 'scanned']);
  assert.deepEqual(Object.keys(result.results[0]).sort(), ['path', 'snippet']);
  assert.deepEqual(result.results.map(r => r.path), ['z-精确.md', 'a-冗长.md']); assert.equal(result.scanned, 3);
  assert.deepEqual((await query('林风 AND 武器 与 设定')).results, result.results);
  assert.equal((await query('不存在 武器')).results.length, 0);
  for (const value of ['林风 OR 长弓', '林风 或 长弓', '林风|长弓']) assert.equal((await query(value)).results.length, 3);
  await assert.rejects(query('|'), /文字或数字/);
});

test('search normalizes mixed Chinese/Latin terms and restricts results to the requested directory and root', async () => {
  const { service, root, folder, base } = await setup(); await fs.mkdir(path.join(folder, '武库'));
  await fs.writeFile(path.join(folder, '武库/武器.md'), '林风使用ＡＫ４７步枪，补充武器设定。');
  await fs.writeFile(path.join(folder, '角色.md'), '林风使用AK47步枪。');
  assert.equal((await service.search({ rootId: root.id, path: '武库', query: 'ak47 步枪' })).results[0].path, '武库/武器.md');
  assert.equal((await service.search({ rootId: root.id, query: 'AK47' })).results.length, 2);
  const other = path.join(base, '其他系列'); await fs.mkdir(other); await fs.writeFile(path.join(other, '设定.md'), '林风持剑。'); const otherRoot = await service.connect(other);
  assert.equal((await service.search({ rootId: otherRoot.id, query: 'AK47' })).results.length, 0);
  await assert.rejects(service.search({ rootId: root.id, query: '武器', path: '../' }));
});

test('search reuses unchanged documents but refreshes external edits, additions, deletion and confirmed writes', async () => {
  const { service, root, folder } = await setup(), file = path.join(folder, '设定.md'); await fs.writeFile(file, '女主是药师。');
  const read = service.read.bind(service); let reads = 0; service.read = async options => { reads++; return read(options); };
  const search = query => service.search({ rootId: root.id, query });
  assert.equal((await search('药师')).results.length, 1); assert.equal(reads, 1);
  assert.equal((await search('女主')).results.length, 1); assert.equal(reads, 1);
  await fs.writeFile(file, '女主是医师。'); assert.equal((await search('药师')).results.length, 0); assert.equal((await search('医师')).results.length, 1); assert.equal(reads, 2);
  const original = await read({ rootId: root.id, path: '设定.md' }); const proposal = await service.propose({ rootId: root.id, path: original.path, revision: original.revision, before: '医师', after: '侦探' }); await service.apply({ id: proposal.id });
  assert.equal((await search('侦探')).results.length, 1); assert.equal((await search('医师')).results.length, 0);
  await fs.writeFile(path.join(folder, '新增.md'), '女主是侦探。'); assert.equal((await search('侦探')).results.length, 2);
  await fs.unlink(file); assert.equal((await search('侦探')).results.length, 1);
});

test('cached search never exposes a file replaced by a link or a directory replaced by a junction', async () => {
  const { service, root, folder, base } = await setup(); await fs.mkdir(path.join(folder, '子目录')); await fs.writeFile(path.join(folder, '子目录/设定.md'), '安全缓存词');
  await service.search({ rootId: root.id, query: '缓存词' });
  const outside = path.join(base, '外部'); await fs.mkdir(outside); await fs.writeFile(path.join(outside, '设定.md'), '外部秘密词');
  await fs.unlink(path.join(folder, '子目录/设定.md')); await fs.link(path.join(outside, '设定.md'), path.join(folder, '子目录/设定.md'));
  assert.equal((await service.search({ rootId: root.id, query: '缓存词 OR 秘密词' })).results.length, 0);
  await fs.unlink(path.join(folder, '子目录/设定.md')); await fs.rmdir(path.join(folder, '子目录')); await fs.symlink(outside, path.join(folder, '子目录'), 'junction');
  assert.equal((await service.search({ rootId: root.id, query: '秘密词' })).results.length, 0);
  await assert.rejects(service.search({ rootId: root.id, path: '子目录', query: '秘密词' }));
});

test('ranked search scans beyond the first twenty matches and reports traversal caps', async () => {
  const { service, root, folder } = await setup();
  for (let i = 0; i < 24; i++) await fs.writeFile(path.join(folder, `a-${i}.md`), '武器设定。' + '天气。'.repeat(100));
  await fs.writeFile(path.join(folder, 'z-best.md'), '武器设定。');
  const result = await service.search({ rootId: root.id, query: '武器' }); assert.equal(result.scanned, 25); assert.equal(result.results.length, 20); assert.equal(result.limited, true); assert.equal(result.results[0].path, 'z-best.md');
  for (let i = 0; i < 85; i++) await fs.writeFile(path.join(folder, `b-${i}.md`), '其他正文');
  const capped = await service.search({ rootId: root.id, query: '其他正文' }); assert.equal(capped.scanned, 100); assert.equal(capped.limited, true);
});

test('author-confirmed project notes are separate from originals and become stale after source edits',async()=>{
 const {service,root,folder}=await setup();await fs.writeFile(path.join(folder,'设定.md'),'原始设定');const source=await service.read({rootId:root.id,path:'设定.md'});assert.equal((await service.notesStatus({rootId:root.id})).notes,null);const notes=await service.saveNotes({rootId:root.id,text:'作者已确认的项目摘要',sources:[{path:source.path,revision:source.revision}]});assert.deepEqual((await service.notesStatus({rootId:root.id})).changed,[]);assert.equal(await fs.readFile(path.join(folder,'设定.md'),'utf8'),'原始设定');await fs.writeFile(path.join(folder,'设定.md'),'外部更新');assert.deepEqual((await service.notesStatus({rootId:root.id})).changed,['设定.md']);await assert.rejects(service.saveNotes({rootId:root.id,text:'覆盖',revision:null}),/另一窗口/);await assert.rejects(service.saveNotes({rootId:root.id,text:'x',revision:notes.revision,sources:[{path:'../outside.md',revision:source.revision}]}));assert.equal((await new LocalWorkspace({home:service.home}).state()).roots[0].notes.text,notes.text);
});
test('proposals never write until applied; stale revisions are refused, backups verified, restore remains a proposal', async () => {
  const { service, root, folder } = await setup(), name = '人物.md', target = path.join(folder, name); await fs.writeFile(target, '\ufeff她是药师。\r\n她不愿说谎。\r\n');
  const read = await service.read({ rootId: root.id, path: name });
  const proposal = await service.propose({ rootId: root.id, path: name, revision: read.revision, before: '她不愿说谎。', after: '她保持沉默，以保护线人。' });
  assert.match(await fs.readFile(target, 'utf8'), /不愿说谎/); const saved = await service.apply({ id: proposal.id });
  const result = await fs.readFile(target); assert.equal(result[0], 239); assert.ok(result.toString('utf8').includes('\r\n')); assert.match(result.toString('utf8'), /保护线人/);
  assert.deepEqual(await fs.readFile(path.join(service.home, 'backups', saved.backupId, 'original.bin')), Buffer.from('\ufeff她是药师。\r\n她不愿说谎。\r\n'));
  await assert.rejects(service.apply({ id: proposal.id }), /已经处理/);
  const history = await service.history({ rootId: root.id, path: name }); assert.equal(history.length, 1);
  const restore = await service.restore({ rootId: root.id, path: name, id: history[0].id }); assert.match(await fs.readFile(target, 'utf8'), /保护线人/);
  await service.apply({ id: restore.id }); assert.equal(await fs.readFile(target, 'utf8'), '\ufeff她是药师。\r\n她不愿说谎。\r\n');
  const stale = await service.propose({ rootId: root.id, path: name, revision: (await service.read({ rootId: root.id, path: name })).revision, before: '药师', after: '医师' }); await fs.writeFile(target, '外部编辑器的新版本'); await assert.rejects(service.apply({ id: stale.id }), /变化/); assert.equal(await fs.readFile(target, 'utf8'), '外部编辑器的新版本');
});
test('create is no-overwrite, existing empty files can be edited, and ambiguous patches are refused', async () => {
  const { service, root, folder } = await setup(); const proposal = await service.propose({ rootId: root.id, path: '新设定.md', revision: null, content: '# 世界规则\n正文' });
  await fs.writeFile(path.join(folder, '新设定.md'), 'external'); await assert.rejects(service.apply({ id: proposal.id }), /已经存在/);
  const next = await service.propose({ rootId: root.id, path: '新建.txt', revision: null, content: 'new document' }); await service.apply({ id: next.id }); assert.equal(await fs.readFile(path.join(folder, '新建.txt'), 'utf8'), 'new document');
  await fs.writeFile(path.join(folder, '空文档.txt'), ''); const empty = await service.read({ rootId: root.id, path: '空文档.txt' }); const patch = await service.propose({ rootId: root.id, path: empty.path, revision: empty.revision, before: '', after: '填入正文' }); await service.apply({ id: patch.id }); assert.equal(await fs.readFile(path.join(folder, '空文档.txt'), 'utf8'), '填入正文');
  await fs.writeFile(path.join(folder, '重复.md'), '相同 相同'); const repeated = await service.read({ rootId: root.id, path: '重复.md' }); await assert.rejects(service.propose({ rootId: root.id, path: repeated.path, revision: repeated.revision, before: '相同', after: '修改' }), /唯一/);
});
test('Unicode BOM and CRLF survive writes; invalid encodings are rejected without modification', () => {
  for (const format of [{ encoding: 'utf8', bom: true, crlf: true }, { encoding: 'utf16le', bom: true, crlf: true }, { encoding: 'utf16be', bom: true, crlf: false }]) { const bytes = encode('中文设定\n下一行', format); const decoded = decode(bytes); assert.equal(decoded.text, '中文设定\n下一行'); assert.equal(decoded.encoding, format.encoding); assert.deepEqual(encode(decoded.text, decoded), bytes); }
  assert.throws(() => decode(Buffer.from([0xff, 0xfe, 0x41])), /编码/); assert.throws(() => decode(Buffer.from('binary\0text')), /二进制/);
});
test('threads persist independently of novels, reject stale saves, and keep pending proposals across restart', async () => {
  const { service, root } = await setup(); const thread = { id: crypto.randomUUID(), rootId: root.id, title: '设定讨论', draft: '未发送', messages: [{ role: 'user', text: '讨论人物', records: [] }] };
  const revision = await service.saveThread({ thread }); await assert.rejects(service.saveThread({ thread }), /另一窗口/); thread.revision = revision;
  const loaded = new LocalWorkspace({ home: service.home }); assert.equal((await loaded.state()).threads[0].draft, '未发送');
  const proposal = await service.propose({ rootId: root.id, path: '新文档.md', revision: null, content: '正文' }); assert.equal((await loaded.pending({ rootId: root.id }))[0].id, proposal.id);
  await service.select(null); assert.equal((await service.state()).currentRoot, null);
});
test('DOCX extraction reads only document text and never expands files into the workspace', async () => {
  const { base, service, root, folder } = await setup(); const input = path.join(base, 'docx-source'); await fs.mkdir(path.join(input, 'word'), { recursive: true }); await fs.writeFile(path.join(input, 'word/document.xml'), '<w:document><w:p><w:r><w:t>中文 &amp; 设定</w:t></w:r></w:p><w:p><w:r><w:t>第二段</w:t></w:r></w:p></w:document>');
  const { exec } = require('../desktop/services/files.cjs'); const output = path.join(folder, '设定.docx'); await exec(require('7zip-bin').path7za, ['a', '-tzip', output, 'word/document.xml', '-bso0'], { cwd: input, windowsHide: true });
  const file = await service.read({ rootId: root.id, path: '设定.docx' }); assert.equal(file.text, '中文 & 设定\n第二段'); assert.equal(file.writable, false); assert.equal(await docxText(await fs.readFile(output)), file.text);
  await assert.rejects(service.propose({ rootId: root.id, path: file.path, revision: file.revision, before: '中文', after: '修改' }), /不支持写入/);
});

test('application update snapshot includes local discussions/proposals but never copies connected folders', async () => {
  const { service, root, folder, base } = await setup(); await fs.writeFile(path.join(folder, '外部设定.md'), 'EXTERNAL-WORKSPACE');
  await service.propose({ rootId: root.id, path: '待保存.md', revision: null, content: '候选稿' });
  const { snapshotWorkspaceState } = require('../desktop/services/local-workspace.cjs'); const backup = await snapshotWorkspaceState(service.home, path.join(base, 'backup'));
  const metadata = JSON.parse(await fs.readFile(path.join(backup.root, 'manifest.json'), 'utf8'));
  assert.ok(metadata.files.some(f => f.relative === 'state-v1.json')); assert.ok(metadata.files.some(f => f.relative.startsWith('proposals/'))); assert.ok(!metadata.files.some(f => f.relative.includes('外部设定')));
  assert.equal(await fs.readFile(path.join(folder, '外部设定.md'), 'utf8'), 'EXTERNAL-WORKSPACE');
});

test('backup failure prevents any write to the original document', async () => {
  const { service, root, folder } = await setup(); const file = path.join(folder, '正文.md'); await fs.writeFile(file, '必须保留的原文');
  const current = await service.read({ rootId: root.id, path: '正文.md' }); const proposal = await service.propose({ rootId: root.id, path: current.path, revision: current.revision, before: current.text, after: '候选修改' });
  await fs.writeFile(path.join(service.home, 'backups'), 'blocking fixture'); await assert.rejects(service.apply({ id: proposal.id })); assert.equal(await fs.readFile(file, 'utf8'), '必须保留的原文'); assert.equal((await service.proposal(proposal.id)).status, 'pending');
});

test('thread and project deletion safely cleans up state without affecting local files', async () => {
  const { service, root, folder } = await setup();
  const thread = { id: crypto.randomUUID(), rootId: root.id, title: '可删除讨论', draft: '', messages: [] };
  await service.saveThread({ thread });
  assert.equal((await service.state()).threads.length, 1);
  await service.deleteThread({ id: thread.id });
  assert.equal((await service.state()).threads.length, 0);

  await service.removeProject({ rootId: root.id });
  assert.equal((await service.state()).roots.length, 0);
  assert.equal(await fs.stat(folder).then(() => true).catch(() => false), true);
});

test('thread and project deletion rolls back memory state when persist fails', async () => {
  const { service, root, folder } = await setup();
  const thread = { id: crypto.randomUUID(), rootId: root.id, title: '保留讨论', draft: '', messages: [] };
  await service.saveThread({ thread });
  assert.equal(service.data.threads.length, 1);
  assert.equal(service.data.roots.length, 1);

  const originalPersist = service.persist;
  service.persist = async () => { throw new Error('Disk failure'); };

  await assert.rejects(service.deleteThread({ id: thread.id }), /Disk failure/);
  assert.equal(service.data.threads.length, 1, 'thread memory must be rolled back on delete failure');

  await assert.rejects(service.removeProject({ rootId: root.id }), /Disk failure/);
  assert.equal(service.data.roots.length, 1, 'root memory must be rolled back on remove failure');
  assert.equal(service.data.threads.length, 1, 'cascaded threads must not be wiped when remove fails');

  service.persist = originalPersist;
});

