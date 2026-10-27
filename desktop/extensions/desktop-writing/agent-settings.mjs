// Agent limits are separate from roleplay's usually short reply setting.
export const AGENT_TOOL_BUDGET = 32;
export function agentLimits(settings = {}) {
    const bounded = (value, fallback, min, max) => Number.isFinite(Number(value)) && Number(value) >= min ? Math.min(max, Math.floor(Number(value))) : fallback;
    const context = bounded(settings.context, 32768, 8192, 1000000);
    const output = Math.min(bounded(settings.output, 4096, 512, 16384), Math.floor(context / 2));
    return { context, output, input: Math.floor((context - output - 512) * .9) };
}
