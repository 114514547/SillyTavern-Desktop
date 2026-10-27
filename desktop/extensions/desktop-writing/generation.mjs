import {reasoningText,AssistantConfigurationError} from './assistant-options.mjs';
import {resolveAssistant} from './assistant-runtime.mjs';
import {beginUsage,recordUsage} from './usage.mjs';
export class WritingRequestError extends Error {}
export function abortError() { return new DOMException('已停止本次生成。', 'AbortError'); }
export function waitFor(promise, signal, timeout, message = '本步骤等待超时，请重试。') {
    return new Promise((resolve, reject) => {
        let timer;
        const finish = (fn, value) => { clearTimeout(timer); signal?.removeEventListener('abort', stop); fn(value); };
        const stop = () => finish(reject, signal.reason || abortError());
        Promise.resolve(promise).then(value => finish(resolve, value), error => finish(reject, error));
        if (signal?.aborted) { stop(); return; }
        signal?.addEventListener('abort', stop, { once: true });
        timer = setTimeout(() => finish(reject, new WritingRequestError(message)), timeout);
    });
}
export class WritingTask {
    constructor(update = () => {}) { this.controller = new AbortController(); this.signal = this.controller.signal; this.update = update; this.phase = ''; this.text = ''; this.reasoning=''; this.reasoningRounds=[]; }
    stage(text) { this.signal.throwIfAborted(); this.phase = text; this.update(text); }
    cancel(reason = abortError()) { this.controller.abort(reason); }
    wait(promise, timeout = 30000) { return waitFor(promise, this.signal, timeout, this.phase + '等待超时，请重试。'); }
}
// The bundled GPT tokenizer is available offline. It is an estimate for other models;
// the caller reserves context headroom. Never trigger a model-specific tokenizer download.
export function createTokenCounter(api, task, { request = globalThis.fetch.bind(globalThis), timeout = 2000, onEstimate = () => {} } = {}) {
    const cache = new Map(); let fallback = false,cacheCharacters=0;
    const counter=async text => {
        task.signal.throwIfAborted();
        if (cache.has(text)){if(task.performance)task.performance.tokenizerCacheHits++;return cache.get(text);}
        let count;
        if (!fallback) {
            const controller = new AbortController();
            const stop = () => controller.abort(task.signal.reason);
            task.signal.addEventListener('abort', stop, { once: true });
            try {
                if(task.performance)task.performance.tokenizerRequests++;
                count = await waitFor((async () => {
                    const response = await request('/api/tokenizers/openai/count?model=gpt-4o', { method: 'POST', headers: api.getRequestHeaders(), body: JSON.stringify([{ role: 'user', content: text }]), signal: controller.signal });
                    if (!response.ok) throw new Error('Tokenizer unavailable');
                    const result = await response.json();
                    if (!Number.isFinite(result.token_count) || result.token_count < 0) throw new Error('Invalid token count');
                    return result.token_count;
                })(), task.signal, timeout);
            } catch (error) {
                if (task.signal.aborted) throw error;
                fallback = true;if(task.performance)task.performance.tokenizerEstimated=true;onEstimate();
            } finally { task.signal.removeEventListener('abort', stop); controller.abort(); }
        }
        // Byte count is deliberately conservative when even the local tokenizer is unavailable.
        count ??= new TextEncoder().encode(text).length;
        cache.set(text, count);cacheCharacters+=text.length;while(cache.size>32||cacheCharacters>2000000){const oldest=cache.keys().next().value;cacheCharacters-=oldest.length;cache.delete(oldest);}return count;
    };
    // UTF-8 bytes are a conservative upper bound for the bundled byte tokenizer.
    // Small inputs need no tokenizer HTTP request; larger inputs still use the
    // existing GPT estimate and the caller's model-agnostic safety margin.
    counter.fits=async(text,budget)=>{task.signal.throwIfAborted();if(cache.has(text))return await counter(text)<=budget;if(text.length*3+32<=budget||new TextEncoder().encode(text).length+32<=budget){if(task.performance)task.performance.tokenizerBoundChecks++;return true;}return await counter(text)<=budget;};
    return counter;
}
function statusError(status) {
    const messages = { 400: '请求参数或模型设置不被服务接受。', 401: 'API 身份验证失败，请检查密钥配置。', 402: '模型服务提示余额不足。', 403: '模型服务拒绝访问。', 404: '模型或接口路径不存在。', 429: '模型服务限流，请稍后重试。' };
    return new WritingRequestError('模型请求失败（HTTP ' + status + '）：' + (messages[status] || '服务暂时不可用，请检查连接后重试。'));
}
function plainContent(value) { return typeof value === 'string' ? value : Array.isArray(value) ? value.map(x => typeof x?.text === 'string' ? x.text : '').join('') : ''; }
export async function readCompletion(response, task, { idleMs = 120000, trailerMs = 2000, progress = () => {}, stream = false, usageRecord = beginUsage(task) } = {}) {
    task.signal.throwIfAborted();
    if (!response.ok) { void response.body?.cancel().catch(() => {}); throw statusError(response.status === 400 && /unauthorized/i.test(response.statusText) ? 401 : response.status); }
    const contentType = response.headers.get('content-type') || '';
    // The pinned ST forwarder pipes SSE bytes without forwarding Content-Type.
    // Honor the negotiated request mode, while accepting an explicit JSON fallback.
    if (contentType.includes('application/json') || (!stream && !contentType.includes('text/event-stream'))) {
        const data = await task.wait(response.json(), idleMs);
        if (data.error) throw new WritingRequestError('模型服务返回错误，请检查连接、模型与额度后重试。');
        recordUsage(task,usageRecord,data.usage);
        const choice=data.choices?.[0]||{message:data.message,finish_reason:data.finish_reason==='MAX_TOKENS'?'length':data.finish_reason};
        task.reasoning=reasoningText(choice.message).slice(0,200000);task.text=plainContent(choice.message?.content)||plainContent(choice.text);progress(task.text,!!task.reasoning);
        if(choice.finish_reason==='length')throw new WritingRequestError('回复达到输出长度上限，已保留为未完成草稿；请提高本模式最大输出。模型思考也会占用输出额度。');
        if(choice.message?.refusal)throw new WritingRequestError('模型返回了拒绝答复，未生成正文。');
        const result = plainContent(choice.message?.content) || plainContent(choice.text);
        if (!result.trim()) throw new WritingRequestError(task.reasoning ? '模型只返回了推理内容，没有正文。请提高最大输出长度，或关闭深度思考后重试。' : '模型未返回正文，请检查模型设置后重试。');
        return result;
    }
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let buffer = '', lines = [], complete = false, meaningful = Date.now(), finishReason;
    const event = () => {
        const data = lines.join('\n'); lines = [];
        if (!data.trim()) return;
        if (data.trim() === '[DONE]') { complete = true; return; }
        let parsed; try { parsed = JSON.parse(data); } catch { throw new WritingRequestError('模型返回了无法解析的流式数据，请检查接口是否兼容。'); }
        if (parsed.error) throw new WritingRequestError('模型流式请求返回错误，请检查连接、模型与额度。');
        recordUsage(task,usageRecord,parsed.usage);
        const choice = parsed.choices?.[0], delta = choice?.delta;
        const text = plainContent(delta?.content);
        const reasoning=reasoningText(delta);
        if (text || reasoning || choice?.finish_reason) meaningful = Date.now();
        if(reasoning){task.reasoning+=reasoning;if(task.reasoning.length>200000)throw new WritingRequestError('接口思考内容过长，已停止本轮。');}
        if (text) { task.text += text; progress(task.text, false); }
        else if (reasoning) progress(task.text, true);
        if(delta?.refusal)throw new WritingRequestError('模型返回了拒绝答复，已保留收到的草稿。');
        if (task.text.length > 2000000) { task.text = task.text.slice(0, 2000000); throw new WritingRequestError('回复超过单条消息长度上限，已保留已收到的草稿。'); }
        if (choice?.finish_reason) finishReason = choice.finish_reason;
    };
    try {
        while (true) {
            const remaining = (finishReason ? Math.min(idleMs,trailerMs) : idleMs) - (Date.now() - meaningful);
            if (remaining <= 0) { if(finishReason)break;throw new WritingRequestError('模型长时间没有返回有效内容，已结束等待。请重试或检查连接。'); }
            let packet;
            try { packet=await task.wait(reader.read(),remaining); }
            catch(error){if(finishReason&&!task.signal.aborted&&error instanceof WritingRequestError)break;throw error;}
            const { done, value } = packet;
            task.signal.throwIfAborted();
            buffer += decoder.decode(value, { stream: !done });
            if (buffer.length > 4000000) throw new WritingRequestError('单个流式事件过大，已结束等待。');
            let newline;
            while ((newline = buffer.indexOf('\n')) >= 0) {
                const line = buffer.slice(0, newline).replace(/\r$/, ''); buffer = buffer.slice(newline + 1);
                if (!line) event(); else if (line.startsWith('data:')) lines.push(line.slice(5).replace(/^ /, ''));
            }
            if (done) {
                if (buffer.startsWith('data:')) lines.push(buffer.slice(5).trimStart());
                if (lines.length) event();
                break;
            }
            if (complete) break;
        }
    } finally { void reader.cancel().catch(() => {}); }
    if (!complete && !finishReason) throw new WritingRequestError('流式连接中途断开，已收到的部分会保留为未完成草稿。');
    if(finishReason==='length')throw new WritingRequestError('回复达到输出长度上限，已保留为未完成草稿；请提高本模式最大输出。模型思考也会占用输出额度。');
    if (!task.text.trim()) throw new WritingRequestError('模型没有返回正文。若使用思考模式，请提高最大输出长度后重试。');
    return task.text;
}
export async function generateWriting(api, params, task, progress = () => {}) {
    task.signal.throwIfAborted();
    if (api.mainApi === 'openai') {
        const native = await task.wait(import('/scripts/openai.js'));
        {
            const assistant=params.assistant||await resolveAssistant(api,{},task);task.assistant=assistant;
            const messages = Array.isArray(params.prompt) ? params.prompt : [ ...(params.systemPrompt ? [{ role: 'system', content: params.systemPrompt }] : []), { role: 'user', content: params.prompt } ];
            const { generate_data } = await task.wait(native.createGenerationParameters(assistant.settings, assistant.model, 'quiet', messages));
            generate_data.stream = Boolean(assistant.settings.stream_openai);delete generate_data.stop;delete generate_data.tools;delete generate_data.tool_choice;
            // Keep the native provider/proxy/model settings. The backend owns all API secrets.
            const usageRecord=beginUsage(task);
            const response = await task.wait(fetch('/api/backends/chat-completions/generate', { method: 'POST', headers: api.getRequestHeaders(), body: JSON.stringify(generate_data), signal: task.signal }), 120000);
            return await readCompletion(response, task, { progress, stream: generate_data.stream, usageRecord });
        }
    }
    task.signal.throwIfAborted();
    const stop = () => api.stopGeneration(); task.signal.addEventListener('abort', stop, { once: true });
    try { const {assistant,...raw}=params;if(assistant&&!assistant.profile.inheritParameters)raw.responseLength=assistant.output;return await task.wait(api.generateRaw(raw), 120000); }
    finally { task.signal.removeEventListener('abort', stop); }
}
export function publicError(error, fallback = '本次请求失败，请检查连接和模型设置后重试。') {
    return error instanceof WritingRequestError || error instanceof AssistantConfigurationError ? error.message : /^(本次输入或参考资料超过上下文预算|选段或参考资料超过当前上下文预算|上下文预算不足|作品保存失败|检测到另一窗口更新了作品|无法读取作品文件|作品尚未成功读取)/.test(error?.message || '') ? error.message.slice(0, 400) : fallback;
}
