'use strict';
// Real launcher HTML/CSS/JS with a mocked preload; headless Edge, no Electron/data/API.
const fs = require('node:fs/promises'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict'), { once } = require('node:events');
const { chromium } = require('playwright-core');
const root = path.resolve(__dirname, '..'), out = path.join(root, 'test-results/optimization-20261022');
let browser, server;
const checks = [], geometry = [], errors = [];
async function main() {
  await fs.mkdir(out, { recursive: true });
  const assets = Object.fromEntries(await Promise.all(['index.html', 'style.css', 'app.js'].map(async name => ['/' + name, await fs.readFile(path.join(root, 'desktop/ui', name))])));
  server = http.createServer((req, res) => { const name = req.url === '/' ? '/index.html' : req.url; res.writeHead(assets[name] ? 200 : 404, { 'content-type': name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html;charset=utf-8' }); res.end(assets[name] || ''); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--noerrdialogs', '--disable-breakpad', '--disable-gpu'] });
  async function open(profiles, currentProfileId = null, stateStatus = '准备就绪。') {
    const page = await browser.newPage({ viewport: { width: 1100, height: 780 } }); page.on('pageerror', error => errors.push(error.message));
    await page.clock.install();
    await page.addInitScript(({ profiles, currentProfileId, stateStatus }) => {
      window.calls = []; window.failure = null;
      const result = async (name, value) => { calls.push([name, value]); return window.failure ? { ok: false, error: window.failure } : { ok: true, value: {} }; };
      window.desktop = { state: async () => ({ ok: true, value: { profiles, currentProfileId, status: stateStatus } }), onStatus: callback => { window.emitStatus = callback; },
        profile: id => result('profile', id), run: mode => result('run', mode), retry: () => result('retry'), copyLogs: () => result('copyLogs'), openData: () => result('openData'), openUpdates: () => result('updates'), discover: async () => ({ ok: true, value: [] }) };
    }, { profiles, currentProfileId, stateStatus });
    await page.goto('http://127.0.0.1:' + server.address().port); await page.waitForFunction(() => !document.getElementById('fresh').disabled); return page;
  }
  const fresh = await open([]); assert.equal(await fresh.locator('#fresh').textContent(), '开始使用'); assert.equal(await fresh.locator('#startup-actions').isVisible(), false);
  await fresh.clock.fastForward(9000); assert.equal(await fresh.locator('#startup-actions').isVisible(), false); checks.push('idle-does-not-time-out');
  await fresh.locator('#fresh').click(); assert.deepEqual(await fresh.evaluate(() => calls.at(-1)), ['run', 'fresh']); await fresh.close(); checks.push('first-use-creates-workspace');
  const single = await open([{ id: 'one' }], 'one'); assert.equal(await single.locator('#fresh').textContent(), '继续创作（工作区 1）'); assert.equal(await single.locator('#profiles button').count(), 0);
  for (const viewport of [{ width: 1100, height: 780 }, { width: 1100, height: 830 }, { width: 800, height: 600 }]) {
    await single.setViewportSize(viewport); const size = await single.evaluate(() => ({ width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight })); geometry.push(size);
    assert.ok(size.scrollWidth <= size.width + 1, JSON.stringify(size)); if (viewport.width === 1100) assert.ok(size.scrollHeight <= size.height + 1, JSON.stringify(size));
  }
  await single.setViewportSize({ width: 1100, height: 780 }); await single.screenshot({ path: path.join(out, 'launcher-single.png') }); checks.push('single-workspace-and-default-window-geometry');
  await single.locator('#fresh').click(); assert.deepEqual(await single.evaluate(() => calls.at(-1)), ['profile', 'one']);
  await single.clock.fastForward(4000); await single.evaluate(() => emitStatus('正在初始化本地数据与扩展…')); await single.clock.fastForward(3999); assert.equal(await single.locator('#startup-actions').isVisible(), false);
  await single.clock.fastForward(2); assert.equal(await single.locator('#startup-actions').isVisible(), true); checks.push('timeout-is-total-startup-time-not-reset-by-phases');
  await single.evaluate(() => emitStatus('无法读取正在运行的 Node 服务。')); assert.equal(await single.locator('#startup-actions').isVisible(), true);
  await single.locator('#logs').click(); assert.deepEqual(await single.evaluate(() => calls.at(-1)), ['copyLogs', undefined]);
  await single.locator('#retry').click(); assert.equal(await single.locator('#startup-actions').isVisible(), false); await single.clock.fastForward(8001); assert.equal(await single.locator('#startup-actions').isVisible(), true);
  await single.screenshot({ path: path.join(out, 'launcher-timeout.png') }); checks.push('diagnostics-actions-and-retry-timer'); await single.close();
  const multiple = await open([{ id: 'one' }, { id: 'two' }], 'one'); assert.equal(await multiple.locator('#profiles button').count(), 2); await multiple.locator('#profiles button').nth(1).click(); assert.deepEqual(await multiple.evaluate(() => calls.at(-1)), ['profile', 'two']);
  await multiple.evaluate(() => { failure = '合成启动错误'; }); await multiple.locator('#fresh').click(); assert.equal(await multiple.locator('#startup-actions').isVisible(), true); assert.equal(await multiple.locator('#status').textContent(), '合成启动错误');
  await multiple.locator('#advanced-options summary').first().click(); assert.equal(await multiple.locator('#new-fresh').isVisible(), true); checks.push('multiple-workspaces-errors-and-advanced-options'); await multiple.close();
  const pending = await open([{ id: 'one' }], 'one', '正在加载酒馆核心组件…'); await pending.clock.fastForward(8001); assert.equal(await pending.locator('#startup-actions').isVisible(), true); await pending.close(); checks.push('automatic-startup-also-times-out');
  assert.deepEqual(errors, []); await fs.writeFile(path.join(out, 'launcher.json'), JSON.stringify({ passed: true, headless: true, checks, geometry, errors }, null, 2)); console.log(JSON.stringify({ passed: true, checks, geometry }));
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); });
