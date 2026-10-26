'use strict';
const crypto = require('node:crypto');
const { fs, path, noLinks, exists, sha, fail } = require('./files.cjs');
const NAMES = ['manifest.json', 'index.js', 'model.mjs', 'store.mjs', 'discussion.mjs', 'inline-diff.mjs', 'layout.mjs', 'generation.mjs', 'usage.mjs', 'style.css', 'agent-ui.mjs', 'agent-layout.mjs', 'roleplay-ui.mjs', 'agent-loop.mjs', 'agent-transport.mjs', 'agent-settings.mjs', 'assistant-options.mjs', 'assistant-runtime.mjs', 'assistant-ui.mjs', 'agent.css', 'settings-dialog.mjs'];
const OWNER = 'org.sillytavern.desktop.writing';
const RETIRED = ['modern-agent.css'];
NAMES.push('icons.mjs','design-system.css','modern-ui.css','modern-shell.mjs','native-ui.css','native-surfaces.mjs','theme.mjs','ui-preferences.mjs','roleplay-projects.mjs','character-manager.mjs','character-manager-data.mjs','character-manager.css');
// Install only a namespaced extension. Never patch upstream core files or user settings.
async function installWritingExtension({ root, source, backupRoot }) {
  const parent = path.join(root, 'public/scripts/extensions');
  const target = path.join(parent, 'desktop-writing');
  await noLinks(target); await noLinks(backupRoot);
  const manifest = JSON.parse(await fs.readFile(path.join(source, 'manifest.json'), 'utf8'));
  if (manifest.desktop_bundle !== OWNER) throw fail('内置写作扩展标识无效。');
  const hashes = Object.fromEntries(await Promise.all(NAMES.map(async name => [name, await sha(path.join(source, name))])));
  let previous = false, previousFiles = [];
  if (await exists(target)) {
    const installed = JSON.parse(await fs.readFile(path.join(target, '.desktop-bundle.json'), 'utf8').catch(() => '{}'));
    if (installed.owner !== OWNER) throw fail('写作扩展目录已被其他内容占用，请先保留该目录，再重试。');
    previousFiles = await fs.readdir(target);
    for (const entry of previousFiles) {
      if (![...NAMES, ...RETIRED, '.desktop-bundle.json'].includes(entry)) throw fail('写作扩展目录包含额外文件，已保留并停止覆盖。');
      await noLinks(path.join(target, entry));
    }
    if (!previousFiles.some(name=>RETIRED.includes(name)) && await Promise.all(NAMES.map(async name => await exists(path.join(target, name)) && await sha(path.join(target, name)) === hashes[name])).then(values => values.every(Boolean))) return target;
    previous = true;
  }
  await fs.mkdir(parent, { recursive: true });
  // Stage outside the extension discovery directory, including after an interrupted update.
  const stage = path.join(root, 'public/scripts', '.desktop-writing-stage-' + crypto.randomUUID());
  await fs.mkdir(stage);
  for (const name of NAMES) await fs.copyFile(path.join(source, name), path.join(stage, name));
  await fs.writeFile(path.join(stage, '.desktop-bundle.json'), JSON.stringify({ owner: OWNER, hashes }));
  if (previous) {
    await fs.mkdir(backupRoot, { recursive: true });
    const backup = path.join(backupRoot, crypto.randomUUID());
    await fs.cp(target, backup, { recursive: true, errorOnExist: true, force: false });
    for (const name of previousFiles) if (await sha(path.join(target, name)) !== await sha(path.join(backup, name))) throw fail('写作扩展备份校验失败，已停止替换。');
    const retired = path.join(root, 'public/scripts', '.desktop-writing-retired-' + crypto.randomUUID());
    await fs.rename(target, retired);
    try { await fs.rename(stage, target); } catch (error) { await fs.rename(retired, target); throw error; }
  } else await fs.rename(stage, target);
  return target;
}
module.exports = { installWritingExtension };
