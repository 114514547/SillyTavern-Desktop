const number = value => Number.isFinite(value) && value >= 0 ? value : undefined;
export function normalizeUsage(value) {
    if (!value || typeof value !== 'object') return null;
    const input = number(value.prompt_tokens), output = number(value.completion_tokens);
    const hit = number(value.prompt_cache_hit_tokens) ?? number(value.prompt_tokens_details?.cached_tokens);
    const miss = number(value.prompt_cache_miss_tokens) ?? (input !== undefined && hit !== undefined && hit <= input ? input - hit : undefined);
    return [input, output, hit, miss].some(n => n !== undefined) ? { input, output, hit, miss } : null;
}
function summarize(task) {
    const records = task.usageRequests, reported = records.filter(record => record.usage);
    const summary = { requests: records.length, reportedRequests: reported.length, partial: reported.length !== records.length };
    for (const field of ['input', 'output', 'hit', 'miss']) {
        const known = reported.filter(record => record.usage[field] !== undefined);
        if (known.length) summary[field] = known.reduce((sum, record) => sum + record.usage[field], 0);
        if (known.length !== records.length) (summary.unknownFields ??= []).push(field);
    }
    if (summary.unknownFields?.some(field => field === 'input' || field === 'output')) summary.partial = true;
    task.usage = summary;
}
export function beginUsage(task) {
    const record = { usage: null };
    (task.usageRequests ??= []).push(record); summarize(task);
    return record;
}
export function recordUsage(task, record, value) {
    const usage = normalizeUsage(value);
    if (!usage) return;
    // A stream may report cumulative snapshots more than once. Replace this
    // request's snapshot; only distinct requests contribute to the task total.
    record.usage = usage; summarize(task);
}
export function startPerformance(task){
    task.performanceStarted??=performance.now();
    return task.performance??={version:1,totalMs:0,modelRequests:0,modelMs:0,toolCalls:0,toolOperations:0,toolMs:0,toolTypes:{},fileLoads:0,cacheReuses:0,duplicateReads:0,compactions:0,tokenizerRequests:0,tokenizerCacheHits:0,tokenizerBoundChecks:0,tokenizerEstimated:false,readConcurrency:3};
}
export function finishPerformance(task){const stats=startPerformance(task);stats.totalMs=Math.round(performance.now()-task.performanceStarted);return structuredClone(stats);}
