import { WritingRequestError } from './generation.mjs';
import { agentLimits, AGENT_TOOL_BUDGET } from './agent-settings.mjs';
import {reasoningText} from './assistant-options.mjs';
import {beginUsage,recordUsage,startPerformance} from './usage.mjs';
export async function readAgentResponse(response, task, progress = () => {}, stream = false, usageRecord = beginUsage(task)) {
    if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        const code = response.status === 400 && /unauthorized/i.test(response.statusText) ? 401 : response.status;
        const reasons = { 400: '模型参数或工具调用不被接口支持', 401: '密钥验证失败', 402: '余额不足', 403: '接口拒绝访问', 404: '接口路径或模型不存在', 429: '请求限流' };
        throw new WritingRequestError('Agent 请求失败（HTTP ' + code + '）：' + (reasons[code] || '模型服务暂时不可用') + '。');
    }
    let result = { role: 'assistant', content: '', reasoning_content: '', tool_calls: [] }, finish,characters=0;
    const accept = (data, delta = false) => {
        if (data.error) throw new WritingRequestError('模型服务返回错误，请检查连接和工具调用支持。');
        recordUsage(task,usageRecord,data.usage);
        const choice = data.choices?.[0], message = delta ? choice?.delta : choice?.message;
        if (!message && !choice?.finish_reason) return;
        if (typeof message?.content === 'string'){result.content += message.content;characters+=message.content.length;}
        const reasoning=reasoningText(message);if(reasoning){result.reasoning_content+=reasoning;characters+=reasoning.length;}
        task.reasoning=result.reasoning_content;
        if(message?.refusal)throw new WritingRequestError('模型返回了拒绝答复，本轮工具未执行。');
        for (let index = 0; index < (message?.tool_calls || []).length; index++) {
            const call = message.tool_calls[index], slot = delta ? call.index : index;
            if (!Number.isInteger(slot) || slot < 0) throw new WritingRequestError('接口返回了无效的工具序号，本批请求尚未执行，请重试。');
            if (slot >= AGENT_TOOL_BUDGET) throw new WritingRequestError('模型一次返回的工具请求超过 '+AGENT_TOOL_BUDGET+' 个，本批尚未执行；请重试并要求分批查阅。');
            const target = result.tool_calls[slot] ||= { id: '', type: 'function', function: { name: '', arguments: '' } };
            if (call.id){target.id += call.id;characters+=call.id.length;}
            if (call.function?.name){target.function.name += call.function.name;characters+=call.function.name.length;}
            if (call.function?.arguments){target.function.arguments += call.function.arguments;characters+=call.function.arguments.length;}
        }
        if (characters > 400000) throw new WritingRequestError('模型回复或工具参数过长，已结束等待。');
        if (choice?.finish_reason) finish = choice.finish_reason;
        task.text = result.content; progress(result.content, !!reasoning);
    };
    const json = response.headers.get('content-type')?.includes('application/json') || !stream;
    if (json) accept(await task.wait(response.json(), 120000));
    else {
        const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '', lines = [], doneEvent = false, meaningful = Date.now();
        const event = () => {
            const text = lines.join('\n'); lines = []; if (!text.trim()) return;
            if (text.trim() === '[DONE]') { doneEvent = true; return; }
            let data; try { data = JSON.parse(text); } catch { throw new WritingRequestError('模型返回的流式工具数据无法解析。'); }
            const delta = data.choices?.[0]?.delta;
            if (delta?.content || reasoningText(delta) || delta?.tool_calls || data.choices?.[0]?.finish_reason) meaningful = Date.now();
            accept(data, true);
        };
        try {
            while (!doneEvent) {
                const remaining = 120000 - (Date.now() - meaningful); if (remaining <= 0) throw new WritingRequestError('模型长时间未返回有效内容，已结束本轮。');
                const { value, done } = await task.wait(reader.read(), remaining); task.signal.throwIfAborted(); buffer += decoder.decode(value, { stream: !done });
                if (buffer.length > 500000) throw new WritingRequestError('单个流式事件过大。');
                let end;
                while ((end = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, end).replace(/\r$/, ''); buffer = buffer.slice(end + 1); if (!line) event(); else if (line.startsWith('data:')) lines.push(line.slice(5).trimStart()); }
                if (done) { if (buffer.startsWith('data:')) lines.push(buffer.slice(5).trimStart()); if (lines.length) event(); if (!finish && !doneEvent) throw new WritingRequestError('连接中途断开，已收到的文字保留为未完成回复。'); break; }
            }
        } finally { void reader.cancel().catch(() => {}); }
    }
    result.tool_calls = result.tool_calls.filter(Boolean);
    // Never execute even a syntactically valid prefix of a truncated tool batch.
    // The loop can regenerate that batch, or continue an ordinary answer instead.
    if (finish === 'length') {
        if (!result.content.trim() && !result.tool_calls.length) throw new WritingRequestError('模型输出达到长度上限，但未产生正文；读取进度已保留。思考也占用输出，请提高最大输出后继续任务。');
        result.truncated = true;
        result.truncatedTools = result.tool_calls.length > 0;
        delete result.tool_calls;
        return result;
    }
    if (!result.content.trim() && !result.tool_calls.length) throw new WritingRequestError('模型没有返回正文或工具请求，请检查最大回复长度与工具支持。');
    if (!result.reasoning_content) delete result.reasoning_content;
    if (!result.tool_calls.length) delete result.tool_calls;
    return result;
}
export async function agentCompletion(api, messages, tools, task, progress = () => {}, settings = {}) {
    if (api.mainApi !== 'openai') throw new WritingRequestError('本地 Agent 首版需要聊天补全接口，请在顶部选择 DeepSeek、OpenAI 或自定义兼容接口。');
    const native = await task.wait(import('/scripts/openai.js'));
    const limits = agentLimits(settings), snapshot=task.assistant;
    const nativeSettings=snapshot?.settings||{...native.oai_settings,openai_max_tokens:limits.output,openai_max_context:limits.context};
    if(['claude','makersuite','vertexai','cohere'].includes(nativeSettings.chat_completion_source))throw new WritingRequestError('本地 Agent 工具目前需要 DeepSeek、OpenAI 或兼容协议；此原生来源的工具流格式尚未适配。小说可以使用兼容的非流式正文。');
    const { generate_data } = await task.wait(native.createGenerationParameters(nativeSettings, snapshot?.model||native.getChatCompletionModel(), 'quiet', messages));
    Object.assign(generate_data, { messages, tools, tool_choice: tools.length ? 'auto' : undefined, stream: Boolean(nativeSettings.stream_openai) });
    delete generate_data.json_schema;
    delete generate_data.stop; // Roleplay stop strings must not silently end document analysis.
    const usageRecord=beginUsage(task),stats=startPerformance(task),started=performance.now();
    stats.modelRequests++;
    try{
        const response = await task.wait(fetch('/api/backends/chat-completions/generate', { method: 'POST', headers: api.getRequestHeaders(), body: JSON.stringify(generate_data), signal: task.signal }), 120000);
        return await readAgentResponse(response, task, progress, generate_data.stream, usageRecord);
    }finally{stats.modelMs+=Math.round(performance.now()-started);}
}
