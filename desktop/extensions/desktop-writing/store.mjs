import { MAX_BYTES, clone, uid, validate, workspace, hydrateProject } from './model.mjs';
export const FILE = 'desktop-writing-workspace-v1.json';
export const RECOVERY = 'desktop-writing-recovery-v1.json';
export class WritingStore {
    constructor({ request = globalThis.fetch.bind(globalThis), headers, lock = task => task(), onStatus = () => {}, protection = null }) {
        Object.assign(this, { request, headers, lock, onStatus, protection });
        this.data = workspace(); this.baseline = null; this.confirmed = null; this.loaded = false; this.serial = 0; this.saved = 0; this.queue = Promise.resolve(); this.failed = false;
    }
    async read(name, protectedFallback = true) {
        const response = await this.request('/user/files/' + name, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
        if (response.status === 404) {
            const data = protectedFallback && this.protection ? await this.protection({ action: 'read', recovery: name === RECOVERY }) : null;
            if (data) { validate(data); if (name === FILE) this.restored = true; }
            return data;
        }
        if (!response.ok) throw new Error('无法读取作品文件。请检查酒馆服务后重试，当前草稿不会覆盖服务器文件。');
        const text = await response.text();
        if (new TextEncoder().encode(text).length > MAX_BYTES) throw new Error('作品文件过大，已停止自动覆盖。');
        return validate(JSON.parse(text));
    }
    async load() {
        try {
            const data = await this.read(FILE);
            if (data && this.protection && !this.restored) await this.protection({ action: 'capture', revision: data.revision });
            this.data = data || workspace(); this.confirmed = data ? clone(data) : null; this.baseline = data?.revision ?? null; this.loaded = true;
            this.data.projects.forEach(hydrateProject);
            this.onStatus('已保存'); return this.data;
        } catch (error) { this.failed = true; this.onStatus(error.message); throw error; }
    }
    dirty() { this.serial++; this.onStatus('尚未保存'); }
    get unsaved() { return this.serial !== this.saved; }
    async write(name, data) {
        const text = JSON.stringify(validate(data));
        const bytes = new TextEncoder().encode(text); let binary = '';
        for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        const response = await this.request('/api/files/upload', { method: 'POST', headers: this.headers(), signal: AbortSignal.timeout(30000), body: JSON.stringify({ name, data: btoa(binary) }) });
        if (!response.ok) throw new Error('作品保存失败。请保持窗口打开并重试，也可导出作品包。');
    }
    async protectPending() {
        if (!this.protectionPending) return;
        const { revision, serial } = this.protectionPending;
        await this.protection({ action: 'capture', revision });
        this.saved = serial; this.protectionPending = null; this.restored = false;
    }
    async flush() {
        const work = async () => {
            if (!this.loaded) throw new Error('作品尚未成功读取，已禁止覆盖保存。');
            if (this.restored && !this.unsaved) this.dirty();
            await this.protectPending();
            while (this.unsaved) {
                await this.lock(async () => {
                    const remote = await this.read(FILE, false);
                    const protectedData = !remote && this.baseline !== null && this.protection ? await this.protection({ action: 'read' }) : null;
                    if ((remote?.revision ?? protectedData?.revision ?? null) !== this.baseline) throw new Error('检测到另一窗口更新了作品，已停止覆盖。请先导出当前作品包，再重新载入。');
                    const serial = this.serial; const next = clone(this.data); next.revision = uid(); validate(next);
                    this.onStatus('正在保存…');
                    if (this.confirmed) await this.write(RECOVERY, this.confirmed);
                    await this.write(FILE, next);
                    this.baseline = next.revision; this.data.revision = next.revision; this.confirmed = next;
                    if (this.protection) { this.protectionPending = { revision: next.revision, serial }; await this.protectPending(); }
                    else this.saved = serial;
                    this.restored = false;
                });
            }
            this.failed = false; this.onStatus('已保存'); return true;
        };
        this.queue = this.queue.catch(() => {}).then(work).catch(error => { this.failed = true; this.onStatus(error.message); throw error; });
        return this.queue;
    }
}
