'use strict';
const crypto = require('node:crypto');
const { fs, path, inside, noLinks, exists, atomicJson, fail } = require('./files.cjs');
const { localURL } = require('./security.cjs');
const FILE = 'desktop-writing-workspace-v1.json', RECOVERY = 'desktop-writing-recovery-v1.json';
const LIMIT = 12 * 1024 * 1024, ARCHIVE_LIMIT = LIMIT * 4 + 4096;
const digest = text => crypto.createHash('sha256').update(text).digest('hex');
const model = import('../extensions/desktop-writing/model.mjs');
function userRoot(dataRoot, handle) {
  if (typeof handle !== 'string' || !handle || handle === '.' || handle === '..' || /[\\/:\x00-\x1f]/.test(handle)) throw fail('无法确认小说存档所属用户。');
  const root = path.resolve(dataRoot, handle);
  if (!inside(path.resolve(dataRoot), root)) throw fail('小说存档目录无效。');
  return root;
}
async function readText(file, limit) {
  await noLinks(file);
  if (!(await exists(file))) return null;
  const handle = await fs.open(file, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > limit) throw fail('小说保护副本含链接或超过容量限制，已停止覆盖。');
    const chunks = []; let size = 0;
    while (true) {
      const block = Buffer.alloc(Math.min(65536, limit + 1 - size));
      const { bytesRead } = await handle.read(block, 0, block.length, size);
      if (!bytesRead) break;
      size += bytesRead; if (size > limit) throw fail('小说存档读取期间超过容量限制。');
      chunks.push(block.subarray(0, bytesRead));
    }
    await noLinks(file);
    try { return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)); }
    catch { throw fail('小说存档不是有效 UTF-8，已保留原文件并停止保护副本覆盖。'); }
  } finally { await handle.close(); }
}
async function document(text) {
  try { return (await model).validate(JSON.parse(text)); }
  catch { throw fail('小说存档或保护副本损坏，已停止覆盖。请保留文件并导出当前作品。'); }
}
class WritingProtection {
  constructor(root) { this.root = root; this.directory = path.join(root, 'desktop-writing-protected'); this.file = path.join(this.directory, 'checkpoint-v1.json'); this.queue = Promise.resolve(); }
  async read(recovery = false) {
    const text = await readText(this.file, ARCHIVE_LIMIT); if (text === null) return null;
    let archive; try { archive = JSON.parse(text); } catch { throw fail('小说保护副本损坏，已停止恢复。'); }
    if (archive.schema !== 1 || !archive.current) throw fail('小说保护副本校验失败，已停止恢复。');
    for (const item of [archive.current, archive.recovery].filter(item => item !== null)) {
      if (!item || typeof item.text !== 'string' || Buffer.byteLength(item.text) > LIMIT || digest(item.text) !== item.hash) throw fail('小说保护副本校验失败，已停止恢复。');
      await document(item.text);
    }
    const item = recovery ? archive.recovery : archive.current;
    return item ? document(item.text) : null;
  }
  capture(revision) {
    const work = async () => {
      const source = path.join(this.root, 'user/files', FILE), recovery = path.join(this.root, 'user/files', RECOVERY);
      const text = await readText(source, LIMIT);
      if (text === null) throw fail('小说主存档不存在，未覆盖已有保护副本。');
      const data = await document(text);
      if ((revision !== null && typeof revision !== 'string') || data.revision !== revision) throw fail('小说存档版本已变化，未覆盖保护副本。请重新载入后重试。');
      const previous = await readText(recovery, LIMIT); if (previous !== null) await document(previous);
      const archive = { schema: 1, current: { text, hash: digest(text) }, recovery: previous === null ? null : { text: previous, hash: digest(previous) } };
      // Read and validate an existing checkpoint before replacing it, so damaged
      // protection data is preserved for inspection rather than silently lost.
      await this.read();
      await noLinks(this.directory); await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
      await noLinks(this.file);
      if (await readText(source, LIMIT) !== text) throw fail('小说存档在保护前已变化，请重试保存。');
      await atomicJson(this.file, archive);
      const written = await this.read();
      if (written?.revision !== revision) throw fail('小说保护副本写入校验失败，请重试保存。');
      return { revision };
    };
    const pending = this.queue.catch(() => {}).then(work); this.queue = pending; return pending;
  }
}
function createProtectionHandler(getState) {
  const services = new Map();
  return async (event, arg) => {
    const initial = getState(), active = initial.active, contents = initial.window?.webContents;
    const authorized = () => {
      const current = getState();
      return !!active?.url && current.active === active && current.selected && event.sender === contents && current.window?.webContents === contents && event.senderFrame === contents.mainFrame && localURL(event.senderFrame.url, active.url);
    };
    if (!authorized()) return { ok: false, error: '拒绝未知页面的小说保护请求。' };
    try {
      if (!['read', 'capture'].includes(arg?.action)) throw fail('未知小说保护操作。');
      // Identity comes from the authenticated session, never a page-supplied
      // handle, root or path. Recheck the window/profile after the async lookup.
      const response = await contents.session.fetch(active.url + '/api/users/me', { cache: 'no-store', credentials: 'include', redirect: 'error', signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw fail('无法确认当前登录用户，小说保护操作已停止。');
      const profile = await response.json(); if (!authorized()) throw fail('工作区已切换，请重新载入小说。');
      const root = userRoot(active.i.dataRoot, profile.handle);
      if (!services.has(root)) services.set(root, new WritingProtection(root));
      const service = services.get(root), value = arg.action === 'read' ? await service.read(arg.recovery === true) : await service.capture(arg.revision);
      return { ok: true, value };
    } catch (error) { return { ok: false, error: require('./files.cjs').safeError(error) }; }
  };
}
module.exports = { WritingProtection, userRoot, createProtectionHandler };
