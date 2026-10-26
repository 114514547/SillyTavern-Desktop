'use strict';
const { _electron: electron } = require('playwright-core');
const { hiddenLaunch, assertHidden, captureHidden, resizeHidden, waitForBackend } = require('./hidden-electron.cjs');
const fs = require('node:fs/promises'), path = require('node:path'), assert = require('node:assert/strict'), http = require('node:http'), { once } = require('node:events');
const project = path.resolve(__dirname, '..'), output = path.join(project, 'test-results'), packaged = !!process.argv[2];
const executable = packaged ? path.resolve(process.argv[2]) : require('electron');
const fixture = path.join(output, '本地工作区验收 ' + Date.now()), documents = path.join(fixture, '系列 设定');
let home, app, page, hang = false, aborted = 0; const requests = [], errors = [];
const server = http.createServer(async (req, res) => {
  let body = ''; for await (const part of req) body += part;
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  const input = JSON.parse(body); requests.push(input);
  if (hang) { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.flushHeaders(); const timer = setInterval(() => res.write(': keep-alive\n\n'), 50); res.on('close', () => { clearInterval(timer); aborted++; }); return; }
  const lastUser = input.messages.findLastIndex(m => m.role === 'user' && !m.content?.startsWith('[提示')), question = input.messages[lastUser]?.content || '', recent = input.messages.slice(lastUser + 1);
  const results = recent.filter(m => m.role === 'tool').map(m => JSON.parse(m.content));
  let message;
  const call = (name, args) => ({ role: 'assistant', content: null, tool_calls: [{ id: 'fixture-' + requests.length, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
  if (question.includes('长文回归')) message = !input.tools?.length ? { role:'assistant',content:'已读主设定，其他文件尚未核对。' + '这里根据已读资料给出完整分析，保留具体动机、约束和待确认事项。'.repeat(40) } : call('read_file',{path:'长设定.md',offset:0,limit:8000});
  else if (question.includes('介绍你自己')) message = { role:'assistant',content:'我是帮助讨论设定与查阅资料的助手。' };
  else if (!input.tools?.length) message = { role: 'assistant', content: '可以先讨论设定，无需创建小说或连接文件夹。' };
  else if (question.includes('新建')) message = results.some(r => r.proposalId) ? { role: 'assistant', content: '新文档建议已生成，等待你保存。' } : call('create_file', { path: '整理结果.md', content: '# 人物结论\n她保护姐姐留下的线人。' });
  else if (question.includes('越界')) message = results.length ? { role: 'assistant', content: '越界读取已被工作区边界阻止。' } : call('read_file', { path: '../outside.txt', offset: 0, limit: 100 });
  else if (question.includes('搜索')) message = results.length ? { role: 'assistant', content: '已找到与线人有关的设定片段。' } : call('search_files', { query: '线人', path: '' });
  else if (!results.length) message = call('list_files', { path: '' });
  else if (!results.some(r => r.revision)) message = call('read_file', { path: '人物.md', offset: 0, limit: 1500 });
  else if (question.includes('修改') && !results.some(r => r.proposalId)) message = call('propose_edit', { path: '人物.md', revision: results.find(r => r.revision).revision, before: '她是药师。', after: '她是医师，保护姐姐留下的线人。' });
  else message = { role: 'assistant', content: question.includes('修改') ? '已生成修改建议，尚未写入本地文件。' : '根据人物档案，她隐瞒经历是为了保护线人。' };
  if (!input.stream) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }] })); return; }
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const write = (delta, finish_reason = null) => res.write('data: ' + JSON.stringify({ choices: [{ delta, finish_reason }] }) + '\n\n');
  write({ reasoning_content: 'SYNTHETIC_AGENT_REASONING' });
  if (message.tool_calls) { const c = message.tool_calls[0], cut = Math.floor(c.function.arguments.length / 2); write({ tool_calls: [{ index: 0, id: c.id, type: 'function', function: { name: c.function.name, arguments: c.function.arguments.slice(0, cut) } }] }); write({ tool_calls: [{ index: 0, function: { arguments: c.function.arguments.slice(cut) } }] }, 'tool_calls'); }
  else write({ content: message.content }, 'stop'); res.end('data: [DONE]\n\n');
});
async function start() {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ executablePath: executable, ...hiddenLaunch([...(packaged ? [] : [project]), '--desktop-home=' + home], env), timeout: 60000 });
  await assertHidden(app); page = await waitForBackend(app); page.on('pageerror', e => errors.push(e.message));
  await page.waitForSelector('#dw-modebar', { timeout: 90000 });
  await page.waitForFunction(() => document.getElementById('dw-agent')?.shadowRoot?.querySelector('#agent-thread-title'));
  await page.locator('#dw-modebar [data-mode="agent"]').click();
  await page.evaluate(async url => {
    const script = await import('/script.js'); window.jQuery('#main_api').val('openai').trigger('change');
    const native = await import('/scripts/openai.js'); Object.assign(native.oai_settings, { chat_completion_source: 'deepseek', deepseek_model: 'deepseek-flash', stream_openai: true, show_thoughts: true, openai_max_context: 1000000, openai_max_tokens: 300, reverse_proxy: url, proxy_password: 'synthetic-agent-test-key' }); script.setOnlineStatus('valid');
  }, 'http://127.0.0.1:' + server.address().port);
  await assertHidden(app);
}
const agent = selector => page.locator('#dw-agent').locator(selector);
async function send(text) { await agent('#agent-input').fill(text); await agent('#agent-send').click(); }
async function finished() {
  await page.waitForFunction(() => { const root = document.getElementById('dw-agent').shadowRoot; return !root.querySelector('#agent-pending') && !root.querySelector('#agent-send').disabled; }, null, { timeout: 60000 });
  if ((await agent('#agent-status').textContent()).match(/失败|未完成|超过|上限/)) throw new Error(await agent('#agent-status').textContent());
}
async function nativeConfirmation() {
  await page.waitForFunction(() => document.querySelector('dialog[open]') || document.getElementById('dw-agent').shadowRoot.querySelector('#agent-log [data-role="assistant"]'), null, { timeout: 15000 });
  if (await page.locator('dialog[open]').count()) await page.locator('dialog[open] .popup-button-ok').last().click();
}
async function main() {
  await fs.mkdir(documents, { recursive: true }); await fs.writeFile(path.join(documents, '人物.md'), '她是药师。\n她保护线人，但不愿说谎。'); await fs.writeFile(path.join(fixture, 'outside.txt'), 'OUTSIDE-PRIVATE-CONTENT'); await fs.writeFile(path.join(documents, 'secrets.json'), 'SYNTHETIC-SECRET-NOT-FOR-MODEL');
  const record = JSON.parse(await fs.readFile(path.join(output, 'discussion-packaged.json'), 'utf8').catch(() => fs.readFile(path.join(output, 'discussion.json'), 'utf8'))), seedHome = process.env.ST_AGENT_TEST_HOME || record.home;
  if (!path.resolve(seedHome).startsWith(output + path.sep)) throw new Error('Only a project-isolated test home is allowed.');
  const seed = JSON.parse(await fs.readFile(path.join(seedHome, 'settings.json'), 'utf8')); home = path.join(fixture, 'app-home'); await fs.mkdir(home, { recursive: true }); await fs.writeFile(path.join(home, 'settings.json'), JSON.stringify({ current: seed.current }));
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); await start();
  await agent('[data-action="new"]').click(); await send('先讨论设定，不连接文件夹。'); await nativeConfirmation(); await finished(); assert.match(await agent('#agent-log').innerText(), /无需创建小说/);
  await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, documents);
  await agent('[data-action="choose"]').click(); await agent('#agent-workspace').filter({ hasText: '系列 设定' }).waitFor();
  assert.equal(await agent('#agent-viewer').isVisible(), false); console.log('Passed: no-novel discussion and native folder grant.');
  await fs.writeFile(path.join(documents,'长设定.md'),'设定内容与具体动机。'.repeat(637).slice(0,6364));
  await send('长文回归：请充分分析设定。'); await finished();
  const finalText = await agent('.agent-message[data-role="assistant"] .agent-message-text').last().innerText(); assert.ok(finalText.length>1000,'long final answer must reach the UI');
  await agent('.agent-message[data-role="assistant"] details summary').last().click();const recordText=await agent('.agent-message[data-role="assistant"]').last().innerText(); assert.match(recordText,/0–6364 \/ 6364/);assert.match(recordText,/重复范围已跳过/);
  assert.ok(requests.every(r=>r.max_tokens===4096));assert.equal(await page.evaluate(async()=> (await import('/scripts/openai.js')).oai_settings.openai_max_tokens),300);
  await agent('[data-action="settings"]').click();await agent('input[aria-label="Agent 最大输出（含模型思考，tokens）"]').fill('8192');await agent('input[aria-label="Agent 最大输出（含模型思考，tokens）"]').press('Tab');await agent('[data-action="close-drawer"]').click();
  await send('结合人物档案，确认独立参数。');await finished();assert.equal(requests.at(-1).max_tokens,8192);
  console.log('Passed: native 300-token roleplay limit isolated, 6364-character read, duplicate guard, long final answer and Agent output setting.');
  await send('结合人物档案分析她的动机。'); await finished(); assert.match(await agent('#agent-log').innerText(), /根据人物档案/);
  assert.ok(requests.some(r => r.messages.some(m => m.role === 'tool' && m.content.includes('她保护线人')))); assert.ok(requests.some(r => r.model === 'deepseek-flash' && r.stream));
  await agent('.agent-citations [data-file="人物.md"]').first().click(); await agent('#agent-viewer').waitFor(); assert.match(await agent('#agent-doc').innerText(), /药师/); await agent('[data-action="close-viewer"]').first().click();
  await page.evaluate(() => { const style = document.createElement('style'); style.id = 'synthetic-plugin'; style.textContent = '.mes, .mes_text { display:none !important; }'; document.head.append(style); });
  assert.equal(await agent('.agent-message').first().isVisible(), true); assert.ok(!(await agent('#agent-log').innerText()).includes('SYNTHETIC_AGENT_REASONING'));
  await captureHidden(app, page, path.join(output, packaged ? 'agent-packaged.png' : 'agent-native.png'));
  await agent('#agent-write').check(); await send('请修改人物档案，将药师的动机写清楚。'); await finished();
  assert.match(await fs.readFile(path.join(documents, '人物.md'), 'utf8'), /她是药师/);
  await agent('[data-proposal]').last().click(); assert.equal(await agent('.agent-after').isVisible(), true); await agent('[data-action="apply"]').click(); await agent('#agent-status').filter({ hasText: '已保存：人物.md' }).waitFor(); assert.match(await fs.readFile(path.join(documents, '人物.md'), 'utf8'), /她是医师/);
  console.log('Passed: native DeepSeek tool loop, cited file viewing, style separation and explicit document save.');
  await agent('[data-action="close-viewer"]').first().click(); await agent('.agent-citations [data-file="人物.md"]').first().click(); await agent('[data-action="history"]').click(); await agent('[data-restore]').first().click(); await agent('[data-action="apply"]').click(); await agent('#agent-status').filter({ hasText: '已保存：人物.md' }).waitFor(); assert.match(await fs.readFile(path.join(documents, '人物.md'), 'utf8'), /她是药师/);
  await agent('[data-action="close-viewer"]').first().click(); await send('请修改人物档案。'); await finished(); await agent('[data-proposal]').last().click(); await fs.writeFile(path.join(documents, '人物.md'), '外部编辑器的新内容。'); await agent('[data-action="apply"]').click(); await agent('#agent-status').filter({ hasText: '原文已经变化' }).waitFor(); assert.equal(await fs.readFile(path.join(documents, '人物.md'), 'utf8'), '外部编辑器的新内容。'); await agent('[data-action="close-viewer"]').first().click();
  await send('新建一份整理结果文档。'); await finished(); await agent('[data-proposal]').last().click(); assert.equal(await fs.stat(path.join(documents, '整理结果.md')).then(() => true).catch(() => false), false); await agent('[data-action="apply"]').click(); await agent('#agent-status').filter({ hasText: '已保存：整理结果.md' }).waitFor(); assert.match(await fs.readFile(path.join(documents, '整理结果.md'), 'utf8'), /人物结论/); await agent('[data-action="close-viewer"]').first().click();
  await send('搜索有关线人的设定。'); await finished(); await send('测试越界读取。'); await finished(); assert.equal(await fs.readFile(path.join(fixture, 'outside.txt'), 'utf8'), 'OUTSIDE-PRIVATE-CONTENT'); assert.ok(!JSON.stringify(requests).includes('OUTSIDE-PRIVATE-CONTENT')); assert.ok(!JSON.stringify(requests).includes('SYNTHETIC-SECRET-NOT-FOR-MODEL'));
  hang = true; const before = requests.length; await send('请等待，测试停止。'); const deadline = Date.now() + 10000; while (requests.length === before && Date.now() < deadline) await new Promise(r => setTimeout(r, 30)); const started = Date.now(); await agent('#agent-stop').click(); await agent('#agent-send').waitFor({ state: 'visible' }); await page.waitForFunction(() => !document.getElementById('dw-agent').shadowRoot.querySelector('#agent-send').disabled, null, { timeout: 2500 }); assert.ok(Date.now() - started < 2500); hang = false;
  await send('你好，介绍你自己');await finished();assert.ok(!requests.at(-1).messages.some(m=>m.role==='user'&&m.content.includes('请等待，测试停止')));
  await agent('#agent-input').fill('重启后保留的设定追问'); await page.evaluate(() => window.SillyTavernDesktopWriting.prepareToLeave());
  await resizeHidden(app, page, { width: 390, height: 800 }); assert.equal(await page.evaluate(() => { const host = document.getElementById('dw-agent'); return host.shadowRoot.querySelector('#agent-app').scrollWidth <= host.clientWidth + 1; }), true);
  await assertHidden(app); await app.close(); app = null; await start(); assert.equal(await agent('#agent-input').inputValue(), '重启后保留的设定追问'); assert.match(await agent('#agent-workspace').textContent(), /系列 设定/); assert.ok(aborted >= 1);
  await page.evaluate(() => { document.getElementById('synthetic-plugin')?.remove(); }); await page.locator('#dw-modebar [data-mode="writing"]').click(); assert.equal(await page.locator('#dw-writer').isVisible(), true); await page.locator('#dw-modebar [data-mode="rp"]').click(); assert.equal(await page.locator('#dw-agent').isVisible(), false);
  assert.deepEqual(errors.filter(e => /desktop-writing|localWorkspace|does not provide an export|Cannot read properties/.test(e)), []);
  await page.evaluate(async () => { const o = await import('/scripts/openai.js'); o.oai_settings.reverse_proxy = ''; o.oai_settings.proxy_password = ''; }); await assertHidden(app); await app.close(); app = null;
  const checks = ['independent-4096-and-8192-output-with-native-300-unchanged', 'long-document-ranges-and-duplicate-guard', 'final-synthesis-over-1000-characters', 'no-novel-required', 'native-folder-picker-grant', 'native-DeepSeek-streamed-tool-calls', 'discover-and-read-before-answer', 'cited-file-preview', 'shadow-DOM-style-isolation', 'no-reasoning-as-prose', 'proposal-does-not-write', 'explicit-save-and-original-backup', 'history-restore-with-preview', 'external-edit-conflict-blocked', 'new-file-proposal-and-save', 'literal-document-search', 'path-escape-blocked', 'credential-files-excluded', 'immediate-stop-closes-request', 'thread-draft-and-folder-survive-restart', 'narrow-layout', 'novel-and-RP-modes-retained', 'hidden-no-focus-or-show'];
  await fs.writeFile(path.join(output, packaged ? 'agent-packaged.json' : 'agent.json'), JSON.stringify({ version: require('../package.json').version, date: new Date().toISOString(), home, packaged, hidden: true, passed: true, checks }, null, 2)); console.log('Local Agent smoke passed (' + (packaged ? 'packaged' : 'development') + ').');
}
main().catch(async error => { console.error(error.stack); if (page) { console.error('Agent status:', await agent('#agent-status').textContent().catch(() => 'unavailable')); await captureHidden(app, page, path.join(output, 'agent-failure.png')).catch(() => {}); } if (app) await app.close().catch(() => {}); process.exitCode = 1; }).finally(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
