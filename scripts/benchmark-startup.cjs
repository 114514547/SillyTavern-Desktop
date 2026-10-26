'use strict';
const { _electron: electron } = require('playwright-core');
const { hiddenLaunch, assertHidden, waitForBackend } = require('./hidden-electron.cjs');
const fs = require('node:fs/promises'), path = require('node:path');
const project = path.resolve(__dirname, '..'), output = path.join(project, 'test-results');
const executable = process.argv[2] ? path.resolve(process.argv[2]) : require('electron');
const label = process.env.ST_STARTUP_LABEL || 'development';
if (!/^[\da-z.-]+$/.test(label)) throw new Error('Invalid record label.');
let app;
(async () => {
  const seed = JSON.parse(await fs.readFile(path.join(output, 'agent-packaged.json'), 'utf8'));
  if (!path.resolve(seed.home).startsWith(output + path.sep)) throw new Error('Isolated home required.');
  const runs = [];
  for (let index = 0; index < 3; index++) {
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const start = performance.now();
    app = await electron.launch({ executablePath: executable, ...hiddenLaunch([...(process.argv[2] ? [] : [project]), '--desktop-home=' + seed.home], env), timeout: 90000 });
    const launcher = await app.firstWindow(); await launcher.waitForLoadState('domcontentloaded'); const firstWindowMs = Math.round(performance.now() - start);
    const page = await waitForBackend(app); const backendWindowMs = Math.round(performance.now() - start);
    await page.waitForFunction(()=>window.SillyTavernDesktopWriting?.ready===true,undefined,{timeout:90000}); const usableMs = Math.round(performance.now() - start);
    const navigation = await page.evaluate(() => { const n = performance.getEntriesByType('navigation')[0]; return { domContentLoadedMs: Math.round(n.domContentLoadedEventEnd), loadMs: Math.round(n.loadEventEnd) }; });
    await assertHidden(app); await app.close(); app = null;
    let trace = null; try { trace = JSON.parse(await fs.readFile(path.join(seed.home, 'startup-latest.json'), 'utf8')); } catch {}
    runs.push({ firstWindowMs, backendWindowMs, usableMs, navigation, trace }); console.log(JSON.stringify({ run: index + 1, ...runs.at(-1) }));
  }
  await fs.writeFile(path.join(output, 'startup-' + label + '.json'), JSON.stringify({ date: new Date().toISOString(), label, scope: 'isolated-warm-profile-hidden-full-application', runs }, null, 2));
})().catch(async error => { console.error(error.message); if (app) await app.close().catch(() => {}); process.exitCode = 1; });
