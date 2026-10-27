import {saveSettings} from '/script.js';

export const sameValue=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export async function saveSettingsConfirmed(ctx,expected){
    expected=structuredClone(expected);
    await saveSettings();
    const response=await fetch('/api/settings/get',{method:'POST',headers:ctx().getRequestHeaders(),body:'{}'});
    if(!response.ok)throw Error('无法确认配置是否保存，当前编辑已保留，请重试。');
    let stored;try{const result=await response.json();stored=typeof result.settings==='string'?JSON.parse(result.settings):result.settings;}catch{throw Error('保存结果格式不正确，请重新载入设置。');}
    if(!stored||expected.some(([path,value])=>!sameValue(path.reduce((node,key)=>node?.[key],stored),value)))throw Error('配置尚未确认保存，当前编辑已保留，请重试。');
}
