import { assistantProfile, nativePromptEntries, assistantInstructions,AssistantConfigurationError,usesNativeStreamSchema } from './assistant-options.mjs';
export async function resolveAssistant(api, value, task) {
    const profile=assistantProfile(value), wait=p=>task?task.wait(p):p;
    if(api.mainApi!=='openai') {
        if(profile.inheritPreset)throw new AssistantConfigurationError('继承原生提示词当前支持聊天补全预设；请切换聊天补全接口或使用独立预设。');
        const context=Math.max(2048,Number(api.maxContext)||4096),output=Math.min(profile.output,Math.floor(context/2));
        return {profile,instructions:assistantInstructions(profile),input:Math.max(256,Math.floor((context-output-512)*.9)),context,output,info:{name:profile.name,model:'当前原生连接',source:api.mainApi,entries:[],context,output:profile.inheritParameters?'原生':output,parameters:'采样与上下文沿用原生；不支持接口思考字段显示'}};
    }
    const native=await wait(import('/scripts/openai.js')), original=native.oai_settings, settings={...original};
    const context=profile.inheritParameters?Math.max(2048,Number(original.openai_max_context)||4096):profile.context;
    const output=Math.min(profile.inheritParameters?Math.max(1,Number(original.openai_max_tokens)||300):profile.output,Math.floor(context/2));
    Object.assign(settings,{openai_max_context:context,openai_max_tokens:output});
    if(!profile.inheritParameters)Object.assign(settings,{temp_openai:profile.temperature,top_p_openai:profile.topP,freq_pen_openai:0,pres_pen_openai:0});
    if(profile.reasoning!=='inherit')settings.show_thoughts=profile.reasoning==='on';
    const manager=native.promptManager;
    if(profile.inheritPreset&&!manager?.activeCharacter)throw new AssistantConfigurationError('原生提示词列表尚未就绪，无法继承；请选择原生预设后重试或关闭继承。');
    const entries=profile.inheritPreset?nativePromptEntries(original.prompts,manager.getPromptOrderForCharacter(manager.activeCharacter),s=>api.substituteParams(s)):[];
    const model=native.getChatCompletionModel();
    const info={name:profile.name,model,source:original.chat_completion_source,entries:entries.map(e=>e.name),parameters:profile.inheritParameters?'继承原生参数':'独立参数',context,output,temperature:settings.temp_openai,topP:settings.top_p_openai,reasoning:profile.reasoning};
    if(profile.inheritPreset&&!entries.length)info.notice='原生预设没有启用的非占位文本条目。';
    const isReasoningActive = profile.reasoning==='on' || (profile.reasoning==='inherit' && settings.show_thoughts);
    if (isReasoningActive && output < 2048) {
        info.notice = (info.notice ? info.notice + '\n' : '') + '已启用思考模式：由于模型思考过程会占用输出额度，建议将最大输出设为 2048 以上，防止思考耗尽 token 导致正文截断。';
    }
    if(usesNativeStreamSchema(settings.chat_completion_source)){settings.stream_openai=false;info.notice=(info.notice?info.notice+'\n':'')+'此来源使用原生流协议，小说使用兼容的非流式回包；思考字段能否返回取决于原生后端。Agent 工具需使用 DeepSeek、OpenAI 或兼容协议。';}
    return {profile,settings,model,context,output,input:Math.max(256,Math.floor((context-output-512)*.9)),instructions:assistantInstructions(profile,entries),info};
}
