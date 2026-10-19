'use strict';
const crypto = require('node:crypto');
const { fs, path, noLinks, atomicJson, fail } = require('./files.cjs');
function alive(pid) { if (!Number.isInteger(pid) || pid <= 0) return true; try { process.kill(pid, 0); return true; } catch(e) { return e.code !== 'ESRCH'; } }
async function acquire(dataRoot) {
  await noLinks(dataRoot); await fs.mkdir(dataRoot, { recursive: true });
  const dir = path.join(dataRoot, '.sillytavern-desktop.lock');
  try { await fs.mkdir(dir); } catch(e) {
    if (e.code !== 'EEXIST') throw e;
    let owner;
    try { owner = JSON.parse(await fs.readFile(path.join(dir,'owner.json'), 'utf8')); } catch { throw fail('数据锁不完整。请确认旧服务已退出，再手动保留并移走 .sillytavern-desktop.lock。'); }
    if (alive(owner.pid) || alive(owner.appPid)) throw fail('这个数据目录正被另一桌面实例使用，请切换到已有窗口。');
    // Only known lock metadata is removed. Never recursively delete an unknown directory.
    await fs.unlink(path.join(dir,'owner.json')); await fs.rmdir(dir);
    return acquire(dataRoot);
  }
  const owner = { pid: process.pid, appPid: process.pid, token: crypto.randomUUID() };
  await atomicJson(path.join(dir,'owner.json'),owner);
  return { dir, ...owner };
}
async function handoff(lock, pid) { lock.pid = pid; await atomicJson(path.join(lock.dir,'owner.json'), { pid, appPid: lock.appPid, token:lock.token }); }
async function release(lock) {
  if (!lock) return;
  const file = path.join(lock.dir,'owner.json');
  const owner = JSON.parse(await fs.readFile(file,'utf8').catch(() => '{}'));
  if (owner.token !== lock.token) return;
  await fs.unlink(file); await fs.rmdir(lock.dir);
}
module.exports = { acquire, handoff, release, alive };
