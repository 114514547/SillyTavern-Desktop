'use strict';
const { _electron: electron } = require('playwright-core');
const { hiddenLaunch, assertHidden, captureHidden, waitForBackend } = require('./hidden-electron.cjs');
const assert = require('node:assert/strict'); const fs = require('node:fs/promises'); const path = require('node:path'); const http = require('node:http'); const { once } = require('node:events');
const root = path.resolve(__dirname, '..'); const output = path.join(root, 'test-results');
const executable = process.argv[2] ? path.resolve(process.argv[2]) : require('electron');
const packaged = !!process.argv[2]; const reuse = !!process.env.ST_WRITING_TEST_HOME; const home = reuse ? path.resolve(process.env.ST_WRITING_TEST_HOME) : path.join(output, '写作验收 中文 ' + Date.now());
if (!home.startsWith(output + path.sep)) throw new Error('Test home must be inside this project test-results directory.');
const argv = [...(!packaged ? [root] : []), '--desktop-home=' + home];
let app; let page; const errors = []; let requests = [];
const mock = http.createServer(async (req, res) => {
  let body = ''; for await (const part of req) body += part; if (body) requests.push(JSON.parse(body));
  res.setHeader('Content-Type', 'application/json');
  if (req.url.endsWith('/models')) return res.end(JSON.stringify({ data: [{ id: 'writing-fixture' }] }));
  res.end(JSON.stringify({ id: 'writing-fixture', choices: [{ message: { role: 'assistant', content: '守门人让出了灯下的一小块干地。林舟收起信，终于向前迈了一步。' }, finish_reason: 'stop' }] }));
});
async function openApp(first = false) {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ executablePath: executable, ...hiddenLaunch(argv, env), timeout: 60000 });
  await assertHidden(app);
  if (first && !reuse) { const setup = await app.firstWindow(); await setup.waitForSelector('#fresh', { timeout: 60000 }); await setup.click('#fresh'); }
  page = await waitForBackend(app);
  assert.ok(page, 'real backend window'); page.on('pageerror', error => errors.push(error.stack || error.message)); page.on('dialog', dialog => { void dialog.accept().catch(() => {}); });
  await page.waitForSelector('#preloader', { state: 'detached', timeout: 90000 });
  if (first && !reuse) {
    const onboarding = page.locator('dialog[open]').filter({ has: page.locator('.onboarding') }); await onboarding.waitFor({ timeout: 45000 });
    await onboarding.locator('.popup-input').fill('Writing Test'); await onboarding.locator('.popup-button-ok').click();
  }
  await page.waitForSelector('#dw-modebar', { timeout: 90000 });
  await page.waitForFunction(() => document.getElementById('dw-save').textContent === '已保存', {}, { timeout: 45000 });
  await page.evaluate(() => { window.__writingToasts = []; new MutationObserver(() => { for (const e of document.querySelectorAll('#toast-container .toast-message')) if (!window.__writingToasts.includes(e.textContent)) window.__writingToasts.push(e.textContent); }).observe(document.body, { childList: true, subtree: true }); });
  console.log('Ready: native writing extension loaded.');
}
async function popupOK() { await page.locator('dialog[open] .popup-button-ok').last().click(); }
async function main() {
  await fs.mkdir(output, { recursive: true }); mock.listen(0, '127.0.0.1'); await once(mock, 'listening');
  await openApp(true);
  await page.locator('#dw-modebar [data-mode="writing"]').click();
  await page.locator('#dw-writer').waitFor({ state: 'visible' });
  await page.locator('#dw-viewbar [data-view="body"]').click();
  const beforeProject = await page.locator('#dw-project').inputValue();
  await page.locator('[data-dw-action="new-project"]').click(); await page.locator('dialog[open] .popup-input').fill('验收作品'); await popupOK();
  await page.waitForFunction(previous => document.getElementById('dw-project').value !== previous && document.getElementById('dw-save').textContent === '已保存', beforeProject);
  await page.locator('#dw-body').fill('雨还没有停。林舟将那封信递了过去。');
  await page.locator('#dw-title').fill('第一章 · 城门'); await page.locator('#dw-volume').fill('第一卷');
  await page.locator('[data-dw-action="save"]').click(); await page.waitForFunction(() => document.getElementById('dw-save').textContent === '已保存');
  await page.locator('[data-dw-action="snapshot"]').click();
  await page.locator('#dw-modebar [data-mode="rp"]').click(); await page.locator('#dw-writer').waitFor({ state: 'hidden' }); await page.locator('#dw-modebar [data-mode="writing"]').click(); await page.locator('#dw-writer').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#dw-body').inputValue(), '雨还没有停。林舟将那封信递了过去。');
  await captureHidden(app, page, path.join(output, packaged ? 'writing-packaged.png' : 'writing-native.png'));
  console.log('Passed: chapter editing, save, snapshot, mode switch.');
  const imported = await page.evaluate(async () => {
    const c = window.SillyTavern.getContext(); const card = new FormData(); card.set('file_type', 'json');
    card.set('avatar', new Blob([JSON.stringify({ name: '守门人验收', description: 'CHARACTER_SENTINEL 守门人识得信封上的旧印。', personality: '寡言', scenario: '城门交涉', first_mes: '谁在那里？', mes_example: '' })], { type: 'application/json' }), 'card.json');
    const response = await fetch('/api/characters/import', { method: 'POST', headers: { 'x-csrf-token': c.getRequestHeaders()['X-CSRF-Token'] || c.getRequestHeaders()['x-csrf-token'] }, body: card }); return response.json();
  });
  assert.ok(imported.file_name);
  await page.evaluate(async () => {
    const c = window.SillyTavern.getContext(); const world = new FormData();
    world.set('avatar', new Blob([JSON.stringify({ entries: { 0: { uid: 0, key: ['林舟'], content: 'WORLD_SENTINEL 雾城入夜关闭城门。', comment: '写作验收', constant: true, disable: false, position: 0, order: 100, probability: 100, useProbability: false } } })], { type: 'application/json' }), 'writing-fixture-world.json');
    const response = await fetch('/api/worldinfo/import', { method: 'POST', headers: { 'x-csrf-token': c.getRequestHeaders()['X-CSRF-Token'] || c.getRequestHeaders()['x-csrf-token'] }, body: world }); if (!response.ok) throw new Error('World import failed');
  });
  // Reload so the original character library discovers the imported fixture.
  assert.equal(await page.evaluate(() => window.SillyTavernDesktopWriting.prepareToLeave()), true);
  await page.reload(); await page.waitForSelector('#dw-modebar', { timeout: 60000 }); await page.waitForFunction(() => document.getElementById('dw-save').textContent === '已保存');
  await page.evaluate(async name => { const c = window.SillyTavern.getContext(); const id = c.characters.findIndex(x => x.name === name); if (id < 0) throw new Error('Fixture character missing'); await c.selectCharacterById(id); }, '守门人验收');
  await page.waitForFunction(() => window.SillyTavern.getContext().characterId !== undefined);
  await page.evaluate(async url => {
    window.jQuery('#main_api').val('openai').trigger('change');
    const openai = await import('/scripts/openai.js'); openai.oai_settings.chat_completion_source = 'custom'; openai.oai_settings.custom_url = url; openai.oai_settings.custom_model = 'writing-fixture'; openai.oai_settings.stream_openai = false;
    const script = await import('/script.js'); script.setOnlineStatus('valid');
    const wi = await import('/scripts/world-info.js'); wi.selected_world_info.splice(0, wi.selected_world_info.length, 'writing-fixture-world');
  }, 'http://127.0.0.1:' + mock.address().port + '/v1');
  await page.locator('#dw-modebar [data-mode="writing"]').click();
  await page.locator('#dw-viewbar [data-view="body"]').click();
  await page.locator('[data-dw-action="continue"]').click();
  await page.locator('dialog[open] .dw-candidate').waitFor({ timeout: 60000 });
  console.log('Passed: real native generation returned candidate.');
  assert.ok(requests.some(r => JSON.stringify(r.messages).includes('CHARACTER_SENTINEL')), 'real native API uses card');
  assert.ok(requests.some(r => JSON.stringify(r.messages).includes('雨还没有停')), 'real native API uses chapter');
  assert.ok(requests.some(r => JSON.stringify(r.messages).includes('WORLD_SENTINEL')), 'real native API uses world info');
  await captureHidden(app, page, path.join(output, 'writing-candidate.png')); await popupOK();
  await page.waitForFunction(() => document.getElementById('dw-body').value.includes('终于向前'));
  await page.locator('#dw-body').evaluate(editor => { editor.focus(); editor.setSelectionRange(0, 8); editor.dispatchEvent(new Event('select')); });
  await page.locator('[data-dw-action="novel-to-chat"]').click(); await page.locator('dialog[open]').last().waitFor(); await popupOK();
  await page.waitForFunction(() => !!window.SillyTavern.getContext().chatMetadata.desktopWritingSource && !document.body.classList.contains('dw-writing'), {}, { timeout: 45000 });
  await page.waitForFunction(() => !document.querySelector('dialog[open]'));
  const branch = await page.evaluate(() => { const c = window.SillyTavern.getContext(); return { source: c.chatMetadata.desktopWritingSource, prompt: c.extensionPrompts['desktop-writing-scene'], id: c.getCurrentChatId() }; });
  assert.ok(branch.source.revision); assert.ok(branch.prompt.value.includes('独立试演分支')); assert.ok(branch.source.excerpt);
  console.log('Passed: novel excerpt opened a separate native chat.');
  await page.evaluate(async () => { const c = window.SillyTavern.getContext(); const m = { name: '守门人验收', is_user: false, is_system: false, mes: '“站到灯下来。”他侧过身。', send_date: new Date().toISOString() }; c.chat.push(m); c.addOneMessage(m); await c.saveChat(); });
  await page.locator('#dw-modebar [data-dw-action="chat-to-novel"]').click(); await popupOK(); await page.locator('dialog[open] .dw-candidate').waitFor({ timeout: 60000 }); await popupOK();
  await page.locator('[data-dw-action="save"]').click(); await page.waitForFunction(() => document.getElementById('dw-save').textContent === '已保存');
  const exported = path.join(home, 'writing-export.txt');
  await app.evaluate(({ BrowserWindow }, file) => { globalThis.__writingDownload = null; BrowserWindow.getAllWindows()[0].webContents.session.once('will-download', (_event, item) => { item.setSavePath(file); item.once('done', (_e, state) => { globalThis.__writingDownload = { state, name: item.getFilename() }; }); }); }, exported);
  await page.locator('[data-dw-action="export"]').click(); await popupOK();
  let downloadResult; const downloadDeadline = Date.now() + 30000;
  while (Date.now() < downloadDeadline) { downloadResult = await app.evaluate(() => globalThis.__writingDownload); if (downloadResult) break; await new Promise(r => setTimeout(r, 200)); }
  assert.equal(downloadResult?.state, 'completed'); assert.ok((await fs.readFile(exported, 'utf8')).includes('终于向前')); console.log('Passed: actual native TXT download.');
  const core = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences()); assert.equal(core.sandbox, true); assert.equal(core.nodeIntegration, false);
  const settings = JSON.parse(await fs.readFile(path.join(home, 'settings.json'), 'utf8')); const file = path.join(settings.current.dataRoot, 'default-user/user/files/desktop-writing-workspace-v1.json');
  const saved = JSON.parse(await fs.readFile(file, 'utf8')); assert.equal(saved.projects.find(p => p.id === saved.currentProjectId).chapters[0].sources.length, 1);
  await page.locator('#dw-body').fill((await page.locator('#dw-body').inputValue()) + '\n关闭前尚未手动保存的文字。');
  await assertHidden(app); await app.close(); app = null;
  await openApp(); await page.locator('#dw-modebar [data-mode="writing"]').click(); await page.locator('#dw-viewbar [data-view="body"]').click(); assert.ok((await page.locator('#dw-body').inputValue()).includes('终于向前')); assert.ok((await page.locator('#dw-body').inputValue()).includes('关闭前尚未手动保存'));
  const nativeStyles = await page.evaluate(() => { const b = document.querySelector('#dw-modebar button'); return { classes: b.className, background: getComputedStyle(b).backgroundColor, theme: getComputedStyle(document.documentElement).getPropertyValue('--SmartThemeBodyColor') }; });
  assert.ok(nativeStyles.classes.includes('menu_button')); assert.ok(nativeStyles.theme);
  await assertHidden(app); await app.close(); app = null;
  const extensionErrors = errors.filter(e => /desktop-writing|does not provide an export|Cannot read properties/.test(e)); assert.deepEqual(extensionErrors, []);
  await fs.writeFile(path.join(output, packaged ? 'writing-packaged.json' : 'writing.json'), JSON.stringify({ version: require('../package.json').version, date: new Date().toISOString(), home, packaged, passed: true, hidden: true, requests: requests.length, checks: ['native-ST-controls', 'project-chapter-edit', 'autosave', 'mode-preserves-draft', 'snapshot', 'real-native-generation-mock-API', 'card-reference', 'native-world-info-reference', 'candidate-adoption', 'novel-to-new-RP-with-source', 'RP-to-prose-with-provenance', 'TXT-export', 'sandbox', 'restart-persistence'], nativeStyles }, null, 2));
  console.log('Writing smoke passed (' + (packaged ? 'packaged' : 'development') + ').');
}
main().catch(async error => { console.error(error.stack); if (page) { console.error('Writing state:', await page.locator('#dw-save').textContent().catch(() => 'unavailable')); console.error('Test notifications:', await page.evaluate(() => window.__writingToasts).catch(() => [])); await page.screenshot({ path: path.join(output, 'writing-failure.png') }).catch(() => {}); } if (app) await app.close().catch(() => {}); process.exitCode = 1; }).finally(() => new Promise(resolve => mock.close(resolve)));
