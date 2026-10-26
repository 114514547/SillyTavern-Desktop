'use strict';
const crypto = require('node:crypto');
const native = require('node:fs');
const yauzl = require('yauzl');
const { fs, path, privateDir, atomicJson, noLinks, inside, fail, exists } = require('./files.cjs');
const TEXT = new Set(['.md', '.markdown', '.txt', '.json', '.yaml', '.yml', '.toml', '.csv']);
const MAX_FILE = 1024 * 1024, MAX_TEXT = 240000, MAX_STATE = 16 * 1024 * 1024;
const SEARCH_CHARACTERS = 4 * MAX_FILE, SEARCH_POSTINGS = 100000;
const wordSegmenter = new Intl.Segmenter('zh', { granularity: 'word' });
function searchTerms(text, query = false) {
  const normalized = text.normalize('NFKC').toLocaleLowerCase(), terms = [];
  const add = word => {
    for (const match of word.matchAll(/[\p{Script=Han}]+|(?:(?!\p{Script=Han})[\p{L}\p{N}_])+/gu)) {
      const value = match[0];
      if (/^\p{Script=Han}/u.test(value)) {
        const chars = Array.from(value);
        if (!query || chars.length === 1) for (const char of chars) terms.push('c:' + char);
        for (let i = 0; i < chars.length - 1; i++) terms.push('c:' + chars[i] + chars[i + 1]);
      } else terms.push('w:' + value);
    }
  };
  if (query) { for (const part of wordSegmenter.segment(normalized)) if (part.isWordLike) add(part.segment); }
  else add(normalized);
  return terms;
}
function searchQuery(query) {
  const groups = query.split(/\s+OR\s+|\s+或\s+|\|/iu).map(part => [...new Set(searchTerms(part.replace(/\bAND\b|(?:^|\s)与(?=\s|$)|&/giu, ' '), true))]).filter(group => group.length);
  if (!groups.length) throw fail('搜索词需包含文字或数字；空格/AND 为同时匹配，OR/或/| 为任一匹配。');
  return { groups, terms: [...new Set(groups.flat())] };
}
const searchStamp = stat => [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs, stat.mode].join(':');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
async function readHandle(handle, limit) {
  const chunks = []; let size = 0;
  while (true) { const buffer = Buffer.alloc(Math.min(65536, limit + 1 - size)); const { bytesRead } = await handle.read(buffer, 0, buffer.length, size); if (!bytesRead) break; size += bytesRead; if (size > limit) throw fail('文件读取过程中超过大小上限，请拆分后重试。'); chunks.push(buffer.subarray(0, bytesRead)); }
  return Buffer.concat(chunks);
}
async function boundedFile(target, limit = MAX_FILE) { const handle = await fs.open(target, 'r'); try { return await readHandle(handle, limit); } finally { await handle.close(); } }
const blocked = name => name.startsWith('.') || /^(?:node_modules|vendor|dist|build|backups|secrets?(?:\..*)?|credentials?(?:\..*)?|config\.ya?ml)$/i.test(name);
function relative(value = '', empty = false) {
  if (typeof value !== 'string' || value.length > 1000 || (!value && !empty) || value.includes('\\') || value.includes(':') || value.includes('\0') || path.posix.isAbsolute(value)) throw fail('请选择工作区内的相对文件路径。');
  if (!value && empty) return '';
  const parts = value.split('/');
  if (parts.some(p => !p || p === '.' || p === '..' || blocked(p) || /[<>"|?*\x00-\x1f]/.test(p) || /[. ]$/.test(p) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) throw fail('此路径不属于可操作的工作区文档。');
  return parts.join('/');
}
function decode(bytes) {
  let encoding = 'utf8', bom = false, text;
  try {
    if (bytes[0] === 255 && bytes[1] === 254) { encoding = 'utf16le'; bom = true; text = new TextDecoder('utf-16le', { fatal: true }).decode(bytes.subarray(2)); }
    else if (bytes[0] === 254 && bytes[1] === 255) { encoding = 'utf16be'; bom = true; text = new TextDecoder('utf-16be', { fatal: true }).decode(bytes.subarray(2)); }
    else { bom = bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191; text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  } catch { throw fail('文档编码暂不支持，请另存为 UTF-8 或 UTF-16 后再读取。'); }
  if (text.includes('\0')) throw fail('此文件包含二进制内容，不能按文本处理。');
  return { text: text.replace(/\r\n/g, '\n'), encoding, bom, crlf: text.includes('\r\n') };
}
function encode(text, format) {
  if (format.crlf) text = text.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
  let body = Buffer.from(text, format.encoding === 'utf8' ? 'utf8' : 'utf16le');
  if (format.encoding === 'utf16be') body.swap16();
  if (format.bom) body = Buffer.concat([Buffer.from(format.encoding === 'utf8' ? [239, 187, 191] : format.encoding === 'utf16be' ? [254, 255] : [255, 254]), body]);
  return body;
}
async function docxText(bytes) {
  const zip = await new Promise((resolve, reject) => yauzl.fromBuffer(bytes, { lazyEntries: true }, (e, z) => e ? reject(e) : resolve(z)));
  return new Promise((resolve, reject) => {
    let found = false, entries = 0;
    zip.on('error', reject); zip.on('end', () => { if (!found) reject(fail('DOCX 中没有可读取的正文。')); });
    zip.on('entry', entry => {
      if (++entries > 2000) { zip.close(); reject(fail('DOCX 压缩包条目过多。')); return; }
      if (entry.fileName !== 'word/document.xml') { zip.readEntry(); return; }
      found = true;
      if (entry.uncompressedSize > 4 * MAX_FILE) { zip.close(); reject(fail('DOCX 正文过大，请拆分文档。')); return; }
      zip.openReadStream(entry, (error, stream) => {
        if (error) { zip.close(); reject(error); return; }
        const chunks = []; let size = 0;
        stream.on('error', reject);
        stream.on('data', chunk => { size += chunk.length; if (size > 4 * MAX_FILE) { stream.destroy(fail('DOCX 正文过大。')); zip.close(); } else chunks.push(chunk); });
        stream.on('end', () => {
          zip.close(); const xml = Buffer.concat(chunks).toString('utf8'); let text = '';
          const entities = value => value.replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi, entity => {
            const named = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
            if (named[entity]) return named[entity];
            const code = entity[2] === 'x' ? parseInt(entity.slice(3, -1), 16) : Number(entity.slice(2, -1));
            return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
          });
          for (const token of xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:(?:tab|br)\b[^>]*\/>|<\/w:p>/g)) text += token[1] !== undefined ? entities(token[1]) : token[0].startsWith('<w:tab') ? '\t' : '\n';
          if (text.length > MAX_TEXT) reject(fail('文档正文过长，请拆分后读取。')); else resolve(text.trim());
        });
      });
    }); zip.readEntry();
  });
}
class LocalWorkspace {
  constructor({ home, protectedRoots = [] }) { this.home = home; this.protectedRoots = [home, ...protectedRoots].map(p => path.resolve(p)); this.queue = Promise.resolve(); this.initialized = null; this.data = null; this.searchIndex = null; }
  async load() {
    if (!this.initialized) this.initialized = (async () => {
      await privateDir(this.home); const file = path.join(this.home, 'state-v1.json');
      if (await exists(file)) {
        const stat = await fs.stat(file); if (stat.size > MAX_STATE) throw fail('本地讨论记录过大，已停止覆盖。');
        const data = JSON.parse(await fs.readFile(file, 'utf8'));
        if (data.schema !== 1 || !Array.isArray(data.roots) || !Array.isArray(data.threads)) throw fail('本地工作区记录损坏，已保留原文件。');
        this.data = data;
      } else this.data = { schema: 1, roots: [], threads: [], currentRoot: null };
    })().catch(error => { this.initialized = null; throw error; });
    await this.initialized;
  }
  async serial(work) { const result = this.queue.catch(() => {}).then(async () => { await this.load(); return work(); }); this.queue = result.catch(() => {}); return result; }
  async persist() { if (Buffer.byteLength(JSON.stringify(this.data)) > MAX_STATE) throw fail('讨论记录超过容量上限，请新建另一工作区。'); await atomicJson(path.join(this.home, 'state-v1.json'), this.data); }
  root(id) { const root = this.data.roots.find(r => r.id === id); if (!root) throw fail('本地文件夹尚未连接，请先选择工作区。'); return root; }
  async state() { await this.load(); return structuredClone(this.data); }
  async connect(folder) {
    return this.serial(async () => {
      const resolved = await noLinks(folder); const stat = await fs.stat(resolved);
      if (!stat.isDirectory() || resolved === path.parse(resolved).root || this.protectedRoots.some(protectedRoot => inside(resolved, protectedRoot) || inside(protectedRoot, resolved))) throw fail('请选择单个系列的资料文件夹，不能选择整个磁盘、软件目录或其上层目录。');
      let entry = this.data.roots.find(r => r.path.toLowerCase() === resolved.toLowerCase());
      if (!entry) { if (this.data.roots.length >= 50) throw fail('本地工作区已达到 50 个。'); entry = { id: crypto.randomUUID(), name: path.basename(resolved), path: resolved }; this.data.roots.push(entry); }
      this.data.currentRoot = entry.id; await this.persist(); return structuredClone(entry);
    });
  }
  async select(id) { return this.serial(async () => { if (id !== null) this.root(id); this.data.currentRoot = id; await this.persist(); return id; }); }
  async saveProject({rootId,name,defaultAssistants,revision=null}) {
    return this.serial(async()=>{
      const root=this.root(rootId);if((root.settingsRevision??null)!==revision)throw fail('系列设置已被修改，请重新载入。');
      if(typeof name!=='string'||!name.trim()||name.length>100)throw fail('系列名称需为 1–100 个字符。');
      const {validateAssistantBanks,assistantProfile}=await import('../extensions/desktop-writing/assistant-options.mjs');
      if(defaultAssistants!==undefined&&(!validateAssistantBanks(defaultAssistants)||!defaultAssistants.agent))throw fail('项目默认预设无效。');
      const previous={name:root.name,defaultAssistants:root.defaultAssistants,settingsRevision:root.settingsRevision};root.name=name.trim();
      if(defaultAssistants){const bank=defaultAssistants.agent;root.defaultAssistants={agent:{schema:1,selected:bank.selected,presets:bank.presets.map(p=>assistantProfile(p))}};}
      root.settingsRevision=crypto.randomUUID();try{await this.persist();}catch(error){Object.assign(root,previous);throw error;}return structuredClone(root);
    });
  }
  async saveNotes({rootId,text,sources=[],revision=null}) {
    return this.serial(async()=>{
      const root=this.root(rootId);if(typeof text!=='string'||text.length>20000||!Array.isArray(sources)||sources.length>20)throw fail('项目摘要最多 2 万字符、20 份来源。');
      if((root.notes?.revision??null)!==revision)throw fail('项目摘要已被另一窗口修改，请重新载入。');
      for(const source of sources){relative(source.path);if(!/^[a-f0-9]{64}$/.test(source.revision))throw fail('摘要来源版本无效。');}
      const previous=root.notes;root.notes={text,sources:sources.map(s=>({path:s.path,revision:s.revision})),revision:crypto.randomUUID(),updated:new Date().toISOString()};
      try{await this.persist();}catch(e){root.notes=previous;throw e;}return structuredClone(root.notes);
    });
  }
  async notesStatus({rootId}) {
    await this.load();const notes=structuredClone(this.root(rootId).notes||null),changed=[];
    for(const source of notes?.sources||[])try{if((await this.read({rootId,path:source.path})).revision!==source.revision)changed.push(source.path);}catch{changed.push(source.path);}
    return {notes,changed};
  }
  async target(id, name, { create = false } = {}) {
    await this.load(); const root = this.root(id); relative(name);
    await noLinks(root.path); const target = path.resolve(root.path, ...name.split('/'));
    if (!inside(root.path, target) || target === root.path) throw fail('文件路径超出已选择的工作区。');
    await noLinks(target);
    const stat = await fs.lstat(target).catch(e => { if (e.code === 'ENOENT' && create) return null; throw e; });
    if (stat && (!stat.isFile() || stat.nlink !== 1)) throw fail('只允许操作普通文档，不处理链接或特殊文件。');
    return { root, target, stat };
  }
  async read({ rootId, path: name }) {
    const extension = path.extname(name || '').toLowerCase();
    if (!TEXT.has(extension) && extension !== '.docx') throw fail('首版支持 Markdown、TXT、JSON、YAML、TOML、CSV；DOCX 仅可读取。');
    const { target, stat } = await this.target(rootId, name);
    if (stat.size > (extension === '.docx' ? 20 * MAX_FILE : MAX_FILE)) throw fail('文档过大，请拆分后读取。');
    const handle = await fs.open(target, native.constants.O_RDONLY);
    let bytes;
    try { const current = await handle.stat(); if (current.ino !== stat.ino || current.nlink !== 1 || current.size !== stat.size) throw fail('文件刚刚发生变化，请重试读取。'); bytes = await readHandle(handle, extension === '.docx' ? 20 * MAX_FILE : MAX_FILE); }
    finally { await handle.close(); }
    await noLinks(target);
    if (bytes.length > (extension === '.docx' ? 20 * MAX_FILE : MAX_FILE)) throw fail('文档过大，请拆分后读取。');
    const decoded = extension === '.docx' ? { text: await docxText(bytes), encoding: 'docx', bom: false, crlf: false } : decode(bytes);
    if (decoded.text.length > MAX_TEXT) throw fail('文档正文过长，请拆分后读取。');
    return { path: name, text: decoded.text, revision: hash(bytes), writable: TEXT.has(extension), format: { encoding: decoded.encoding, bom: decoded.bom, crlf: decoded.crlf } };
  }
  async list({ rootId, path: directory = '' }) {
    await this.load(); relative(directory, true); const root = this.root(rootId), folder = path.resolve(root.path, directory || '.');
    await noLinks(root.path); await noLinks(folder); if (!inside(root.path, folder)) throw fail('目录超出工作区。');
    const entries = await fs.readdir(folder, { withFileTypes: true }); const result = [];
    for (const entry of entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))) {
      if (blocked(entry.name) || entry.isSymbolicLink()) continue;
      const name = directory ? directory + '/' + entry.name : entry.name;
      try { relative(name); } catch { continue; }
      if (entry.isDirectory() || (entry.isFile() && (TEXT.has(path.extname(entry.name).toLowerCase()) || path.extname(entry.name).toLowerCase() === '.docx'))) result.push({ path: name, name: entry.name, type: entry.isDirectory() ? 'directory' : 'file', writable: TEXT.has(path.extname(entry.name).toLowerCase()) });
      if (result.length === 200) break;
    }
    return { entries: result, limited: result.length === 200 };
  }
  async search({ rootId, query, path: directory = '' }) {
    if (typeof query !== 'string' || !query.trim() || query.length > 100) throw fail('搜索词需为 1–100 个字符。');
    const parsed = searchQuery(query); relative(directory, true); await this.load();
    const scope = JSON.stringify([rootId, this.root(rootId).path, directory]), previous = this.searchIndex?.scope === scope ? this.searchIndex : null;
    const queue = [directory], documents = new Map(); let scanned = 0, directories = 0, characters = 0, postings = 0, limited = false;
    // Revalidate the directory tree and file handles even on cache hits. No watcher,
    // persisted document index or bypass of the existing folder/link checks.
    while (queue.length && scanned < 100 && directories < 40) {
      directories++;
      const listing = await this.list({ rootId, path: queue.shift() });
      limited ||= listing.limited;
      for (const entry of listing.entries) {
        if (entry.type === 'directory') { if (entry.path.split('/').length < 6) queue.push(entry.path); else limited = true; continue; }
        if (scanned >= 100) { limited = true; break; } scanned++;
        try {
          const { target, stat } = await this.target(rootId, entry.path), stamp = searchStamp(stat);
          let document = previous?.documents.get(entry.path);
          if (document?.stamp === stamp) {
            const handle = await fs.open(target, native.constants.O_RDONLY);
            try { const current = await handle.stat(); if (searchStamp(current) !== stamp || current.nlink !== 1) throw fail('文件刚刚发生变化，请重试读取。'); }
            finally { await handle.close(); }
            await noLinks(target);
          } else {
            const file = await this.read({ rootId, path: entry.path });
            const current = await fs.lstat(target); if (searchStamp(current) !== stamp) throw fail('文件刚刚发生变化，请重试读取。');
            const frequencies = new Map();
            for (const term of searchTerms(file.text)) frequencies.set(term, (frequencies.get(term) || 0) + 1);
            for (const term of searchTerms(entry.path)) frequencies.set(term, (frequencies.get(term) || 0) + 3);
            document = { stamp, text: file.text, frequencies, length: [...frequencies.values()].reduce((n, count) => n + count, 0) };
          }
          if (characters + document.text.length > SEARCH_CHARACTERS || postings + document.frequencies.size > SEARCH_POSTINGS) { limited = true; continue; }
          characters += document.text.length; postings += document.frequencies.size; documents.set(entry.path, document);
        } catch { /* Skip unreadable, linked or changing documents; never serve stale cached text. */ }
      }
    }
    limited ||= queue.length > 0 || scanned >= 100 || directories >= 40;
    let index = previous;
    if (!index || documents.size !== index.documents.size || [...documents].some(([name, document]) => index.documents.get(name) !== document)) {
      const inverted = new Map(); let length = 0;
      for (const [name, document] of documents) {
        length += document.length;
        for (const [term, frequency] of document.frequencies) { if (!inverted.has(term)) inverted.set(term, new Map()); inverted.get(term).set(name, frequency); }
      }
      index = { scope, documents, inverted, average: length / (documents.size || 1) || 1 };
    }
    this.searchIndex = index;
    const candidates = new Set();
    for (const group of parsed.groups) {
      const lists = group.map(term => index.inverted.get(term) || new Map()).sort((a, b) => a.size - b.size);
      for (const name of lists[0].keys()) if (lists.every(list => list.has(name))) candidates.add(name);
    }
    const ranked = [...candidates].map(name => {
      const document = index.documents.get(name); let score = 0;
      for (const term of parsed.terms) {
        const list = index.inverted.get(term), frequency = list?.get(name); if (!frequency) continue;
        const idf = Math.log(1 + (documents.size - list.size + .5) / (list.size + .5));
        score += idf * frequency * 2.2 / (frequency + 1.2 * (.25 + .75 * document.length / index.average));
      }
      return { name, score };
    }).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    const results = ranked.slice(0, 20).map(({ name }) => {
      const text = index.documents.get(name).text, lower = text.toLocaleLowerCase();
      const offsets = parsed.terms.map(term => lower.indexOf(term.slice(2))).filter(offset => offset >= 0), offset = offsets.length ? Math.min(...offsets) : -1;
      return { path: name, snippet: offset >= 0 ? text.slice(Math.max(0, offset - 60), offset + 180) : text ? text.slice(0, 180) : '文件名匹配' };
    });
    return { results, scanned, limited: limited || ranked.length >= 20 };
  }
  async propose({ rootId, path: name, revision, before, after, content }) {
    return this.serial(async () => {
      relative(name); if (!TEXT.has(path.extname(name).toLowerCase())) throw fail('此格式暂不支持写入，请另存为 Markdown 或 TXT。');
      const target = await this.target(rootId, name, { create: true }); let text, original = null;
      if (target.stat) {
        original = await this.read({ rootId, path: name });
        if (revision !== original.revision) throw fail('文件已被其他编辑器修改，请重新读取后再提出修改。');
        if (typeof before !== 'string' || typeof after !== 'string' || (original.text ? !before || original.text.split(before).length !== 2 : before !== '')) throw fail('替换片段必须在原文中准确且唯一，不能猜测或整篇覆盖。');
        text = original.text ? original.text.replace(before, () => after) : after;
      } else { if (revision !== null || typeof content !== 'string') throw fail('新文件必须明确提供正文和空版本号。'); text = content; }
      if (!text.trim() || text.includes('\0') || text.length > MAX_TEXT || Buffer.byteLength(text) > MAX_FILE) throw fail('候选文档为空、含二进制内容或过大。');
      if (original?.text === text) throw fail('这份建议没有改变文档内容。');
      const proposal = { id: crypto.randomUUID(), rootId, path: name, revision: original?.revision ?? null, original: original?.text ?? '', text, created: new Date().toISOString(), status: 'pending' };
      await fs.mkdir(path.join(this.home, 'proposals'), { recursive: true }); await atomicJson(path.join(this.home, 'proposals', proposal.id + '.json'), proposal);
      return proposal;
    });
  }
  async proposal(id) {
    if (typeof id !== 'string' || !/^[\da-f-]{36}$/.test(id)) throw fail('修改建议编号无效。');
    const file = path.join(this.home, 'proposals', id + '.json');
    if ((await fs.stat(file)).size > 4 * MAX_FILE) throw fail('修改建议过大。');
    return JSON.parse(await fs.readFile(file, 'utf8'));
  }
  async pending({ rootId }) {
    await this.load(); this.root(rootId); const result = [];
    for (const name of (await fs.readdir(path.join(this.home, 'proposals')).catch(() => [])).slice(-200)) {
      try { const proposal = await this.proposal(name.replace(/\.json$/, '')); if (proposal.rootId === rootId && proposal.status === 'pending') result.push({ id: proposal.id, rootId, path: proposal.path, status: proposal.status, created: proposal.created }); } catch { /* Preserve unknown files without opening paths from them. */ }
    }
    return result;
  }
  async apply({ id }) {
    return this.serial(async () => {
      const proposal = await this.proposal(id); if (proposal.status !== 'pending') throw fail('这份修改已经处理过，请刷新文档。');
      const { rootId, path: name } = proposal; const target = await this.target(rootId, name, { create: true });
      let format = { encoding: 'utf8', bom: false, crlf: false }, original = null;
      if (proposal.revision !== null) {
        const current = await this.read({ rootId, path: name }); if (current.revision !== proposal.revision) throw fail('原文已经变化，已阻止覆盖。请重新读取并生成修改建议。'); format = current.format; original = await boundedFile(target.target);
        if (hash(original) !== proposal.revision) throw fail('原文已经变化，已阻止覆盖。');
      } else if (target.stat) throw fail('同名文件已经存在，已阻止覆盖。');
      const parent = path.dirname(target.target); await noLinks(parent); if (!(await fs.stat(parent)).isDirectory()) throw fail('请先选择已经存在的目标子目录。');
      const backupId = crypto.randomUUID(), backupRoot = path.join(this.home, 'backups', backupId); await fs.mkdir(backupRoot, { recursive: true });
      if (original) { await fs.writeFile(path.join(backupRoot, 'original.bin'), original, { flag: 'wx', mode: 0o600 }); if (hash(await fs.readFile(path.join(backupRoot, 'original.bin'))) !== proposal.revision) throw fail('原文备份校验失败，未写入修改。'); }
      const bytes = encode(proposal.text, format);
      const journal = { schema: 1, rootId, path: name, originalRevision: proposal.revision, resultRevision: hash(bytes), created: new Date().toISOString(), format, completed: false };
      await atomicJson(path.join(backupRoot, 'manifest.json'), journal);
      const stage = path.join(parent, '.desktop-agent-' + crypto.randomUUID() + '.tmp');
      try {
        const handle = await fs.open(stage, 'wx', target.stat ? target.stat.mode & 0o777 : 0o600);
        try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
        await noLinks(target.target);
        if (proposal.revision === null) { await fs.link(stage, target.target); await fs.unlink(stage); }
        else {
          const current = await this.target(rootId, name); if (current.stat.nlink !== 1 || hash(await boundedFile(current.target)) !== proposal.revision) throw fail('原文在保存前发生变化，已阻止覆盖。');
          await fs.rename(stage, target.target);
        }
      } finally { await fs.unlink(stage).catch(() => {}); }
      journal.completed = true; await atomicJson(path.join(backupRoot, 'manifest.json'), journal); proposal.status = 'applied'; proposal.backupId = backupId; await atomicJson(path.join(this.home, 'proposals', id + '.json'), proposal);
      return { path: name, revision: journal.resultRevision, backupId };
    });
  }
  async history({ rootId, path: name }) {
    await this.load(); this.root(rootId); relative(name); const records = [];
    for (const id of await fs.readdir(path.join(this.home, 'backups')).catch(() => [])) {
      if (!/^[\da-f-]{36}$/.test(id)) continue;
      try { const info = JSON.parse(await fs.readFile(path.join(this.home, 'backups', id, 'manifest.json'), 'utf8')); if (info.completed && info.rootId === rootId && info.path === name && info.originalRevision) records.push({ id, path: name, created: info.created }); } catch { /* Incomplete journals are retained but cannot be restored. */ }
    }
    return records.sort((a, b) => b.created.localeCompare(a.created)).slice(0, 50);
  }
  async restore({ rootId, path: name, id }) {
    if (!/^[\da-f-]{36}$/.test(id || '')) throw fail('历史编号无效。');
    const directory = path.join(this.home, 'backups', id), info = JSON.parse(await fs.readFile(path.join(directory, 'manifest.json'), 'utf8'));
    if (!info.completed || info.rootId !== rootId || info.path !== name || !info.originalRevision) throw fail('此历史版本不属于当前文档。');
    const bytes = await fs.readFile(path.join(directory, 'original.bin')); if (hash(bytes) !== info.originalRevision) throw fail('历史原文校验失败。');
    const current = await this.read({ rootId, path: name });
    return this.propose({ rootId, path: name, revision: current.revision, before: current.text, after: decode(bytes).text });
  }
  async saveThread({ thread, revision = null }) {
    return this.serial(async () => {
      if (!thread || typeof thread.id !== 'string' || !/^[\da-f-]{36}$/.test(thread.id) || typeof thread.title !== 'string' || thread.title.length > 200 || typeof thread.draft !== 'string' || thread.draft.length > 120000 || !Array.isArray(thread.messages) || thread.messages.length > 1000 || (thread.rootId !== null && !this.data.roots.some(r => r.id === thread.rootId))) throw fail('讨论记录格式不正确或超过容量上限。');
      for (const message of thread.messages) if (!['user', 'assistant'].includes(message.role) || typeof message.text !== 'string' || message.text.length > 240000 || !Array.isArray(message.records || []) || (message.records || []).length > 40) throw fail('讨论消息格式不正确。');
      const index = this.data.threads.findIndex(t => t.id === thread.id), previous = this.data.threads[index];
      if ((previous?.revision ?? null) !== revision) throw fail('另一窗口已经更新讨论，已停止覆盖，请重新载入。');
      if (index < 0 && this.data.threads.length >= 100) throw fail('讨论已达到 100 组，请整理旧讨论。');
      const saved = structuredClone(thread); saved.revision = crypto.randomUUID(); saved.updated = new Date().toISOString();
      const candidate = structuredClone(this.data); if (index < 0) candidate.threads.push(saved); else candidate.threads[index] = saved;
      if (Buffer.byteLength(JSON.stringify(candidate)) > MAX_STATE) throw fail('讨论记录超过容量上限，已停止覆盖。');
      const old = this.data; this.data = candidate; try { await this.persist(); } catch (e) { this.data = old; throw e; } return saved.revision;
    });
  }
  async deleteThread({ id }) {
    return this.serial(async () => {
      if (typeof id !== 'string' || !id) throw fail('讨论编号无效。');
      const candidate = structuredClone(this.data);
      const index = candidate.threads.findIndex(t => t.id === id);
      if (index >= 0) {
        candidate.threads.splice(index, 1);
        const old = this.data;
        this.data = candidate;
        try {
          await this.persist();
        } catch (e) {
          this.data = old;
          throw e;
        }
      }
      return { ok: true, id };
    });
  }
  async removeProject({ rootId }) {
    return this.serial(async () => {
      if (typeof rootId !== 'string' || !rootId) throw fail('系列编号无效。');
      const candidate = structuredClone(this.data);
      const index = candidate.roots.findIndex(r => r.id === rootId);
      if (index >= 0) {
        candidate.roots.splice(index, 1);
        if (candidate.currentRoot === rootId) {
          candidate.currentRoot = candidate.roots[0]?.id || null;
        }
        candidate.threads = candidate.threads.filter(t => t.rootId !== rootId);
        const old = this.data;
        this.data = candidate;
        try {
          await this.persist();
        } catch (e) {
          this.data = old;
          throw e;
        }
      }
      return { ok: true, rootId };
    });
  }
}
async function snapshotWorkspaceState(source, backupsRoot) {
  if (!(await exists(source))) return null;
  const { inventory, copyFiles } = require('./backup.cjs');
  if (inside(source, backupsRoot)) throw fail('工作区记录备份不能位于源目录内。');
  const before = await inventory(source, '', false), root = path.join(backupsRoot, crypto.randomUUID()); await privateDir(root);
  await copyFiles(before, path.join(root, 'payload'));
  const after = await inventory(source, '', false);
  if (JSON.stringify(before) !== JSON.stringify(after)) throw fail('工作区记录在备份时发生变化，已停止更新。');
  await atomicJson(path.join(root, 'manifest.json'), { schema: 1, type: 'local-workspace-state', created: new Date().toISOString(), files: before.map(({ source: _source, ...record }) => record) });
  return { type: 'local-workspace-state', root, count: before.length };
}
module.exports = { LocalWorkspace, relative, decode, encode, docxText, snapshotWorkspaceState };
