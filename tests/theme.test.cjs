'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const theme=import('../desktop/extensions/desktop-writing/theme.mjs');
test('theme schema round trips the supported design contract without executable CSS',async()=>{
    const {THEME_DEFAULTS,validateTheme}=await theme;
    const result=validateTheme(JSON.parse(JSON.stringify(THEME_DEFAULTS)));
    assert.deepEqual(result,THEME_DEFAULTS);result.colors.accent='#123456';
    assert.equal(THEME_DEFAULTS.colors.accent,'#c9a76b');
    for(const invalid of [null,{...result,version:2},{...result,font:'__proto__'},{...result,fontSize:100},{...result,colors:{...result.colors,accent:'url(https://example.invalid)'}},{...result,customCss:'body{display:none}'},JSON.parse('{"version":1,"__proto__":{"polluted":true}}')])assert.throws(()=>validateTheme(invalid));
    assert.equal({}.polluted,undefined);
});
test('UI preferences survive a new browser origin through profile settings',async()=>{
    const {readUIPreference,writeUIPreference}=await import('../desktop/extensions/desktop-writing/ui-preferences.mjs');
    const original=globalThis.SillyTavern;let saved=0;const settings={};
    globalThis.SillyTavern={getContext:()=>({extensionSettings:settings,saveSettingsDebounced:()=>saved++})};
    try{writeUIPreference('roleplayLayout',{rightWidth:320});const copy=readUIPreference('roleplayLayout',{});copy.rightWidth=600;assert.equal(readUIPreference('roleplayLayout',{}).rightWidth,320);assert.equal(saved,1);}
    finally{if(original===undefined)delete globalThis.SillyTavern;else globalThis.SillyTavern=original;}
});
test('legacy custom CSS can be paused and restored without changing its contents',async()=>{
    const {DesktopTheme}=await theme,previous=globalThis.document;
    const style={dataset:{},media:'screen',textContent:'/* existing user CSS */',getAttribute:()=> 'screen'};
    globalThis.document={getElementById:()=>style};
    try{const manager=Object.create(DesktopTheme.prototype);manager.value={legacyCss:false};manager.applyLegacyCSS();assert.equal(style.media,'not all');manager.value.legacyCss=true;manager.applyLegacyCSS();assert.equal(style.media,'screen');assert.equal(style.textContent,'/* existing user CSS */');}
    finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}
});
