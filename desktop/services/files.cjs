'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
const exists = async p => !!(await fs.lstat(p).catch(e => { if (e.code === 'ENOENT') return null; throw e; }));
const inside = (parent, child) => { const r = path.relative(parent, child); return r === '' || (!r.startsWith('..' + path.sep) && r !== '..' && !path.isAbsolute(r)); };
async function noLinks(p) {
  const absolute = path.resolve(p); const root = path.parse(absolute).root;
  let current = root;
  for (const part of absolute.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const stat = await fs.lstat(current).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
    if (stat?.isSymbolicLink()) throw new Error('拒绝符号链接或目录联接，请选择真实目录。');
  }
  return absolute;
}
async function privateDir(p) {
  await noLinks(p); await fs.mkdir(p, { recursive: true, mode: 0o700 });
  if (process.platform === 'win32') {
    const { stdout } = await exec('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { windowsHide: true });
    const sid = stdout.match(/S-1-5-[\d-]+/)?.[0];
    if (!sid) throw new Error('无法确定当前用户的访问权限。');
    await exec('icacls.exe', [p, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F'], { windowsHide: true });
  } else await fs.chmod(p, 0o700);
}
async function atomicJson(p, value) {
  const tmp = p + '.' + crypto.randomUUID() + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), { mode: 0o600, flag: 'wx' });
  await fs.rename(tmp, p);
}
async function sha(p, size) {
  if (size !== undefined && size <= 8 * 1024 * 1024) return crypto.createHash('sha256').update(await fs.readFile(p)).digest('hex');
  const hash = crypto.createHash('sha256');
  const { createReadStream } = require('node:fs');
  for await (const block of createReadStream(p)) hash.update(block);
  return hash.digest('hex');
}
function safeError(error) {
  // Do not forward arbitrary backend messages, YAML source or third-party errors.
  const codes = { EACCES: '权限不足，请选择当前用户可写的目录。', EPERM: '文件被占用或权限不足。', ENOSPC: '磁盘空间不足，请腾出空间后重试。', ENOENT: '缺少文件或运行依赖，请检查安装位置。', EADDRINUSE: '端口被其他程序占用，请重试。' };
  return codes[error?.code] || (error?.safe ? error.message : '操作失败。请查看诊断状态；原数据不会被迁移覆盖。');
}
function fail(message) { const e = new Error(message); e.safe = true; return e; }
module.exports = { fs, path, exists, inside, noLinks, privateDir, atomicJson, sha, safeError, fail, exec };
