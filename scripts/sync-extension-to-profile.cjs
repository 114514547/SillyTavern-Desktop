'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const repoExt = path.join(__dirname, '..', 'desktop', 'extensions', 'desktop-writing');
const profileExt = 'C:\\Users\\wang\\AppData\\Local\\SillyTavernDesktop\\backend\\versions\\1.19.0-06bde939\\26e4cd79-6225-4136-b620-584cef4ee81d\\public\\scripts\\extensions\\desktop-writing';

console.log('Syncing from:', repoExt);
console.log('Syncing to:', profileExt);

if (!fs.existsSync(profileExt)) {
  fs.mkdirSync(profileExt, { recursive: true });
}

const files = fs.readdirSync(repoExt);
const hashes = {};

for (const file of files) {
  const src = path.join(repoExt, file);
  const dest = path.join(profileExt, file);
  if (fs.statSync(src).isFile()) {
    const data = fs.readFileSync(src);
    fs.writeFileSync(dest, data);
    hashes[file] = crypto.createHash('sha256').update(data).digest('hex');
    console.log('  Synced:', file);
  }
}

const bundleMeta = {
  owner: 'org.sillytavern.desktop.writing',
  hashes,
  syncedAt: new Date().toISOString()
};

fs.writeFileSync(path.join(profileExt, '.desktop-bundle.json'), JSON.stringify(bundleMeta, null, 2));
console.log('Updated .desktop-bundle.json');

// Clear Electron HTTP Cache and Code Cache
const shellDir = 'C:\\Users\\wang\\AppData\\Local\\SillyTavernDesktop\\shell';
for (const cacheFolder of ['Cache', 'Code Cache', 'GPUCache']) {
  const target = path.join(shellDir, cacheFolder);
  if (fs.existsSync(target)) {
    try {
      fs.rmSync(target, { recursive: true, force: true });
      console.log('Cleared cache folder:', cacheFolder);
    } catch (e) {
      console.log('Could not remove (might be in use by running process):', cacheFolder, e.message);
    }
  }
}
console.log('Done synchronization and cache flush.');
