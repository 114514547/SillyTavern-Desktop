'use strict';
const { _electron: electron } = require('playwright-core');
const { hiddenLaunch, assertHidden, captureHidden, waitForBackend } = require('./hidden-electron.cjs');
const fs = require('node:fs/promises'); const path = require('node:path'); const http = require('node:http'); const { once } = require('node:events'); const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), output = path.join(root, 'test-results'); const packaged = !!process.argv[2];
const executable = packaged ? path.resolve(process.argv[2]) : require('electron'); const reuse = !!process.env.ST_WRITING_TEST_HOME;
const home = reuse ? path.resolve(process.env.ST_WRITING_TEST_HOME) : path.join(output, '创作对话验收 中文 ' + Date.now());
if (!home.startsWith(output + path.sep)) throw new Error('Isolated test home required.');
let app, page, fail = false, delay = 0; const requests = [], errors = [];
const first = '大纲：女主是一位药师，她为寻找失踪的姐姐来到雾城。先和我讨论剧情。';
const reply1 = '姐姐失踪前留下了一封信。可以让女主先寻找寄信人，再逐步发现姐姐的秘密。';
const second = '她为什么要隐瞒自己的身份？先讨论，不写正文。';
const reply2 = '可以让她隐瞒身份，是为了保护姐姐留下的线人。这个动机能推动后续调查。';
const mock = http.createServer(async (req, res) => {
    let body = ''; for await (const part of req) body += part;
    res.setHeader('Content-Type', 'application/json');
    if (req.url.endsWith('/models')) return res.end(JSON.stringify({ data: [{ id: 'discussion-fixture' }] }));
    const parsed = JSON.parse(body); requests.push(parsed);
    if (fail) { res.statusCode = 503; return res.end(JSON.stringify({ error: { message: 'Synthetic temporary failure' } })); }
    const latest = parsed.messages.at(-1).content;
    const content = latest === first ? reply1 : latest === second ? reply2 : '可以继续围绕人物动机展开讨论。';
    const timer = setTimeout(() => res.end(JSON.stringify({ id: 'discussion-fixture', choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }] })), delay);
    res.on('close', () => clearTimeout(timer));
});
async function ok() { await page.locator('dialog[open] .popup-button-ok').last().click(); }
async function start(initial = false) {
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    app = await electron.launch({ executablePath: executable, ...hiddenLaunch([...(packaged ? [] : [root]), '--desktop-home=' + home], env), timeout: 60000 });
    await assertHidden(app);
    if (initial && !reuse) {
        const launcher = await app.firstWindow(); await launcher.waitForSelector('#fresh', { timeout: 60000 });
        assert.equal(await launcher.locator('#advanced-options').evaluate(e => e.open), false); assert.equal(await launcher.locator('#fresh').textContent(), '开始使用');
        await captureHidden(app, launcher, path.join(output, 'launcher-simple.png')); await launcher.click('#fresh');
    }
    page = await waitForBackend(app);
    assert.ok(page); page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => { void d.accept().catch(() => {}); });
    await page.waitForSelector('#preloader', { state: 'detached', timeout: 90000 });
    if (initial && !reuse) { const onboarding = page.locator('dialog[open]').filter({ has: page.locator('.onboarding') }); await onboarding.waitFor(); await onboarding.locator('.popup-input').fill('Discussion Test'); await ok(); }
    await page.waitForSelector('#dw-modebar', { timeout: 90000 }); await page.waitForFunction(() => document.getElementById('dw-save').textContent === '已保存');
    await page.locator('#dw-modebar [data-mode="writing"]').click();
    if (!await page.locator('#dw-discussion').isVisible()) await page.locator('#dw-viewbar [data-view="discussion"]').click();
    await page.locator('#dw-discussion').waitFor({ state: 'visible' });
    await assertHidden(app);
}
async function send(text) { await page.locator('#dw-discussion-input').fill(text); await page.locator('#dw-discussion-send').click(); }
async function count(role) { return page.locator('#dw-discussion-log .mes[is_user="' + (role === 'user') + '"]').count(); }
async function done(total) { await page.waitForFunction(n => document.querySelectorAll('#dw-discussion-log .mes[is_user="false"]').length === n && !document.querySelector('.dw-discussion-pending'), total, { timeout: 60000 }); }
async function configure() {
    await page.evaluate(async url => {
        const script = await import('/script.js'); script.setCharacterId(undefined);
        window.jQuery('#main_api').val('openai').trigger('change'); const openai = await import('/scripts/openai.js');
        Object.assign(openai.oai_settings, { chat_completion_source: 'custom', custom_url: url, custom_model: 'discussion-fixture', stream_openai: false }); script.setOnlineStatus('valid');
    }, 'http://127.0.0.1:' + mock.address().port + '/v1');
}
async function main() {
    mock.listen(0, '127.0.0.1'); await once(mock, 'listening'); await start(true);
    const previous = await page.locator('#dw-project').inputValue();
    await page.locator('[data-dw-action="new-project"]').click(); await page.locator('dialog[open] .popup-input').fill('创作对话验收'); await ok();
    await page.waitForFunction(id => document.getElementById('dw-project').value !== id && document.getElementById('dw-save').textContent === '已保存', previous);
    await page.evaluate(async url => {
        const script = await import('/script.js'); script.setCharacterId(undefined);
        window.jQuery('#main_api').val('openai').trigger('change'); const openai = await import('/scripts/openai.js');
        Object.assign(openai.oai_settings, { chat_completion_source: 'custom', custom_url: url, custom_model: 'discussion-fixture', stream_openai: false }); script.setOnlineStatus('valid');
    }, 'http://127.0.0.1:' + mock.address().port + '/v1');
    assert.equal(await page.evaluate(() => window.SillyTavern.getContext().characterId), undefined);
    await send(first); await done(1); await send(second); await done(2);
    assert.ok(requests[1].messages.some(m => m.role === 'user' && m.content === first)); assert.ok(requests[1].messages.some(m => m.role === 'assistant' && m.content === reply1)); assert.equal(requests[1].messages.at(-1).content, second);
    assert.equal(await count('user'), 2); console.log('Passed: native-style multi-turn discussion without a character card.');
    const conversationId = await page.locator('#dw-conversation').inputValue();
    await page.locator('#dw-discussion-input').fill('暂存的追问'); await page.locator('#dw-modebar [data-mode="rp"]').click(); await page.locator('#dw-modebar [data-mode="writing"]').click(); assert.equal(await page.locator('#dw-discussion-input').inputValue(), '暂存的追问');
    await page.locator('#dw-viewbar [data-view="body"]').click(); assert.equal(await page.locator('#dw-body').inputValue(), ''); await page.locator('#dw-viewbar [data-view="discussion"]').click();
    await captureHidden(app, page, path.join(output, packaged ? 'discussion-packaged.png' : 'discussion-native.png'));
    await page.locator('[data-adopt-message]').first().click(); await page.locator('dialog[open] .dw-candidate').fill('姐姐失踪前，只留下一封没有署名的信。'); await ok();
    await page.waitForFunction(() => document.getElementById('dw-body').value === '姐姐失踪前，只留下一封没有署名的信。' && !document.getElementById('dw-main').hidden);
    await page.locator('#dw-viewbar [data-view="discussion"]').click();
    await page.locator('#dw-new-conversation').click(); await page.locator('dialog[open] .popup-input').fill('人物设计'); await ok();
    await page.waitForFunction(id => document.getElementById('dw-conversation').value !== id, conversationId); assert.equal(await count('assistant'), 0);
    await page.locator('#dw-conversation').selectOption(conversationId); assert.equal(await count('assistant'), 2); assert.equal(await page.locator('#dw-discussion-input').inputValue(), '暂存的追问');
    fail = true; await send('讨论她的另一个动机'); await page.locator('#dw-discussion-retry').waitFor({ timeout: 60000 }); assert.equal(await count('user'), 3);
    fail = false; await page.locator('#dw-discussion-retry').click(); await done(3); assert.equal(await count('user'), 3);
    delay = 5000; const before = requests.length; await send('这是一条用于测试停止生成的消息');
    const deadline = Date.now() + 10000; while (requests.length === before && Date.now() < deadline) await new Promise(r => setTimeout(r, 50));
    await page.locator('#dw-discussion-stop').click(); await page.locator('#dw-discussion-retry').waitFor({ timeout: 20000 }); assert.equal(await count('assistant'), 3); delay = 0;
    console.log('Passed: explicit chapter adoption, independent discussions, retry without duplicate turns, cancellation.');
    await page.locator('#dw-viewbar [data-view="workbench"]').click();
    await page.locator('.dw-resizer[data-pane="left"]').press('Home'); await page.locator('.dw-resizer[data-pane="left"]').press('ArrowRight');
    await page.locator('#dw-viewbar [data-view="discussion"]').click();
    await page.locator('#dw-discussion-input').fill('未发送的追问：姐姐是否知道真相？'); await app.close(); app = null;
    await start(); assert.equal(await page.locator('#dw-discussion-input').inputValue(), '未发送的追问：姐姐是否知道真相？'); assert.equal(await count('assistant'), 3); assert.equal(await count('user'), 4);
    assert.equal(await page.locator('#dw-workbench').evaluate(e => e.style.getPropertyValue('--dw-navigation-width')), '180px');
    await page.locator('#dw-viewbar [data-view="body"]').click(); assert.equal(await page.locator('#dw-body').inputValue(), '姐姐失踪前，只留下一封没有署名的信。');
    const settings = JSON.parse(await fs.readFile(path.join(home, 'settings.json'), 'utf8'));
    const saved = JSON.parse(await fs.readFile(path.join(settings.current.dataRoot, 'default-user/user/files/desktop-writing-workspace-v1.json'), 'utf8'));
    const p = saved.projects.find(x => x.id === saved.currentProjectId); assert.equal(p.chapters[0].sources[0].type, 'writing-chat'); assert.equal(p.conversations.length, 2); assert.equal(saved.layout.left, 180);
    assert.deepEqual(errors.filter(e => /desktop-writing|does not provide an export|Cannot read properties/.test(e)), []);
    const workbench = await require('./workbench-checks.cjs')({ app, page, output, packaged, configure, send, done, requests, assertHidden });
    const generation = await require('./generation-checks.cjs')({ page, send, done });
    assert.deepEqual(errors.filter(e => /desktop-writing|does not provide an export|Cannot read properties/.test(e)), []);
    await assertHidden(app); await app.close(); app = null;
    await fs.writeFile(path.join(output, packaged ? 'discussion-packaged.json' : 'discussion.json'), JSON.stringify({ version: require('../package.json').version, date: new Date().toISOString(), home, packaged, passed: true, hidden: true, checks: ['default-three-pane-view', 'no-character-required', 'multi-turn-role-history', 'discussion-does-not-edit-prose', 'explicit-adoption-and-history', 'independent-conversations', 'mode-switch-retains-input', 'failed-request-retains-turn', 'retry-without-duplicate-user', 'cancel-without-phantom-answer', 'close-flushes-unsent-draft', 'restart-retains-chat-and-prose', ...workbench, ...generation] }, null, 2));
    console.log('Discussion smoke passed (' + (packaged ? 'packaged' : 'development') + ').');
}
main().catch(async error => { console.error(error.stack); if (page) { console.error('Status:', await page.locator('#dw-save').textContent().catch(() => 'unavailable')); console.error('Notifications:', await page.evaluate(() => document.getElementById('toast-container')?.innerText || 'none').catch(() => 'none')); await page.screenshot({ path: path.join(output, 'discussion-failure.png') }).catch(() => {}); } if (app) await app.close().catch(() => {}); process.exitCode = 1; }).finally(() => new Promise(resolve => mock.close(resolve)));
