'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
function hiddenLaunch(args, env) {
  return { args: [...args, '--desktop-background-test'], env: { ...env, ST_DESKTOP_BACKGROUND_TEST: '1' } };
}
async function assertHidden(app) {
  const state = await app.evaluate(({ app, BrowserWindow }) => ({
    events: app.__desktopTestWindowEvents,
    windows: BrowserWindow.getAllWindows().map(w => ({ visible: w.isVisible(), focused: w.isFocused() })),
  }));
  assert.deepEqual(state.events, [], 'No show/focus event allowed during hidden automation.');
  assert.ok(state.windows.every(w => !w.visible && !w.focused), 'All test windows must stay invisible and unfocused.');
}
async function captureHidden(app, page, file) {
  await page.waitForLoadState('load');
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const png = await app.evaluate(async ({ BrowserWindow }, url) => {
    const window = BrowserWindow.getAllWindows().find(w => w.webContents.getURL() === url);
    if (!window) throw new Error('Hidden test window not found.');
    const image = await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
    return image.toPNG().toString('base64');
  }, page.url());
  await fs.writeFile(file, Buffer.from(png, 'base64')); await assertHidden(app);
}
async function resizeHidden(app, page, viewport) {
  await app.evaluate(({ BrowserWindow }, { url, viewport }) => {
    const window = BrowserWindow.getAllWindows().find(w => w.webContents.getURL() === url);
    window.setMinimumSize(0, 0); window.setContentSize(viewport.width, viewport.height);
  }, { url: page.url(), viewport });
  await page.setViewportSize(viewport); await assertHidden(app);
}
async function waitForBackend(app, timeout = 180000) {
  const deadline = Date.now() + timeout; let retries = 0;
  while (Date.now() < deadline) {
    const pages = app.windows(), backend = pages.find(p => p.url().startsWith('http://127.0.0.1:'));
    if (backend) return backend;
    const launcher = pages.find(p => p.url().startsWith('file:'));
    if (launcher) {
      const status = await launcher.locator('#status').textContent({ timeout: 1000 }).catch(() => '');
      if (/无法读取正在运行的 Node 服务|监听服务归属或回环地址校验失败/.test(status) && retries < 2 && await launcher.locator('#retry').isEnabled().catch(() => false)) {
        retries++; console.log('Retrying isolated hidden backend identity check (' + retries + ').'); await launcher.locator('#retry').click();
      } else if (/操作失败|无法读取正在运行|检测到已有|权限不足|启动失败|监听服务归属/.test(status)) throw new Error('Hidden backend startup: ' + status);
    }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  throw new Error('Timed out waiting for isolated hidden backend.');
}
module.exports = { hiddenLaunch, assertHidden, captureHidden, resizeHidden, waitForBackend };
