'use strict';
const assert=require('node:assert/strict'),path=require('node:path');
exports.verifyUIRebuild=async({page,checks,folder})=>{
    await page.evaluate(()=>globalThis.toastr?.clear());
    const modal=page.locator('#dw-settings-modal');if(await modal.isVisible())await page.keyboard.press('Escape');
    await page.evaluate(()=>{window.rebuildOriginals={holder:document.getElementById('top-settings-holder'),holderParent:document.getElementById('top-settings-holder').parentElement,fields:[...document.querySelectorAll('#top-settings-holder input,#top-settings-holder select,#top-settings-holder textarea')].map(node=>({node,parent:node.parentElement})),chat:document.getElementById('chat'),form:document.getElementById('form_sheld')};});
    for(const key of ['preset','model','format','world','appearance','background','extensions','persona','character']){
        await page.evaluate(async key=>{const dialog=SillyTavernDesktopWriting.settingsDialog;await dialog.open();await dialog.showNative(key,++dialog.serial);},key);
        assert.ok(await modal.locator('.dw-native-toolbar').isVisible());
        const fit=await modal.locator('.dw-settings-content').evaluate(n=>({client:n.clientWidth,scroll:n.scrollWidth,overflow:[...n.querySelectorAll('*')].filter(x=>x.getClientRects().length&&x.getBoundingClientRect().right>n.getBoundingClientRect().right).slice(0,8).map(x=>({id:x.id,class:x.className,width:x.getBoundingClientRect().width}))}));assert.ok(fit.scroll<=fit.client+2,key+' horizontal fit '+JSON.stringify(fit));
        await page.screenshot({path:path.join(folder,'rebuild-settings-'+key+'.png')});
        await page.keyboard.press('Escape');
    }
    for(const width of [1050,800]){
        await page.setViewportSize({width,height:1000});
        for(const key of ['preset','model','format','world','appearance','background','extensions','persona','character']){
            await page.evaluate(async key=>{const dialog=SillyTavernDesktopWriting.settingsDialog;await dialog.open();await dialog.showNative(key,++dialog.serial);},key);
            const fit=await modal.locator('.dw-settings-content').evaluate(n=>({client:n.clientWidth,scroll:n.scrollWidth}));assert.ok(fit.scroll<=fit.client+2,key+' native fit at '+width+' '+JSON.stringify(fit));await page.keyboard.press('Escape');
        }
    }
    await page.setViewportSize({width:1600,height:1000});
    assert.ok(await page.evaluate(()=>rebuildOriginals.fields.every(x=>x.node.isConnected&&x.node.parentElement===x.parent)&&rebuildOriginals.holder.parentElement===rebuildOriginals.holderParent&&rebuildOriginals.chat===document.getElementById('chat')&&rebuildOriginals.chat.parentElement.id==='sheld'&&rebuildOriginals.form.parentElement.id==='sheld'));
    checks.push('all-nine-native-surfaces-fit-and-retain-original-controls-and-parents');
    await page.evaluate(()=>SillyTavernDesktopWriting.settingsDialog.open('world'));
    const lookup=modal.getByLabel('查找当前页面的设置',{exact:true}),heading=await modal.locator('#WorldInfo h3').first().innerText();await lookup.fill(heading.trim());await modal.locator('.dw-native-search-results button').first().click();assert.equal(await modal.locator('.dw-setting-highlight').count(),1);await lookup.fill('');await page.keyboard.press('Escape');checks.push('native-setting-search-reveals-original-field');
    await page.evaluate(async()=>{const dialog=SillyTavernDesktopWriting.settingsDialog;await dialog.open('world');const world=await import('/scripts/world-info.js');const name='UI-Rebuild-Synthetic-Book-'+crypto.randomUUID();if(!await world.createNewWorldInfo(name))throw Error('Synthetic world creation failed');await world.showWorldEditor(name);});
    await modal.locator('#world_popup_new').click();
    const row=modal.locator('#world_popup_entries_list .world_entry').first();await row.waitFor();const entry=row.locator('textarea[name=content]').first();if(!await entry.isVisible())await row.locator('.inline-drawer-toggle').first().click();await entry.waitFor();await entry.fill('SYNTHETIC_WORLD_ENTRY');await entry.dispatchEvent('input');
    const dynamicFit=await modal.locator('.dw-settings-content').evaluate(n=>n.scrollWidth<=n.clientWidth+2);assert.ok(dynamicFit,'dynamic world entry fits');
    await page.screenshot({path:path.join(folder,'rebuild-world-entry.png')});await page.keyboard.press('Escape');checks.push('dynamic-native-world-entry-editing-and-layout');
    await page.locator('#dw-modebar [data-mode=rp]').click();await page.locator('#dw-rp-rail [data-rp-action=world]').click();assert.ok(await modal.isVisible());await page.keyboard.press('Escape');
    assert.equal(await page.locator('.dw-rp-docked').count(),0);assert.equal(await page.locator('#dw-native-settings').isVisible(),false);assert.equal(await page.locator('#dw-rp-rail [data-rp-action=preset] span').isVisible(),false);
    checks.push('complex-rp-actions-open-modern-dialog-without-old-drawer-or-label-leaks');
    await page.evaluate(async()=>{const toggle=document.querySelector('#extensions-settings-button>.drawer-toggle'),panel=toggle.parentElement.querySelector('.drawer-content');panel.classList.remove('openDrawer');panel.classList.add('closedDrawer');const native=await import('/script.js');await native.doNavbarIconClick.call(toggle);});
    await modal.waitFor({state:'visible'});assert.equal(await modal.locator('.dw-settings-nav > [aria-selected=true]').getAttribute('data-tab'),'extensions');await page.keyboard.press('Escape');checks.push('programmatic-native-drawer-entry-routes-to-modern-dialog');
    await page.locator('#dw-settings-modal-btn').click();await modal.locator('[data-tab=appearance]').click();
    assert.equal(await modal.locator('.dw-settings-nav > [aria-selected=true]').getAttribute('data-tab'),'appearance');
    await page.screenshot({path:path.join(folder,'rebuild-theme.png')});
    const accent=modal.getByLabel('强调色',{exact:true});await accent.fill('#6db9a3');await accent.dispatchEvent('input');
    const colors=await page.evaluate(()=>({document:getComputedStyle(document.documentElement).getPropertyValue('--dw-accent-gold'),agent:getComputedStyle(document.getElementById('dw-agent').shadowRoot.querySelector('#agent-chat')).getPropertyValue('--dw-accent-gold'),stored:SillyTavern.getContext().extensionSettings.desktop_ui_v1.theme.colors.accent}));assert.deepEqual(colors,{document:'#6db9a3',agent:'#6db9a3',stored:'#6db9a3'});
    const persisted=await page.evaluate(async()=>{const script=await import('/script.js');await script.saveSettings();const response=await fetch('/api/settings/get',{method:'POST',headers:SillyTavern.getContext().getRequestHeaders(),body:'{}'});if(!response.ok)return null;const result=await response.json(),settings=typeof result.settings==='string'?JSON.parse(result.settings):result.settings;return settings?.extension_settings?.desktop_ui_v1?.theme?.colors?.accent;});assert.equal(persisted,'#6db9a3');checks.push('theme-persists-through-native-settings-save-and-readback');
    await modal.getByRole('button',{name:'恢复黑金主题',exact:true}).click();await page.keyboard.press('Escape');checks.push('theme-applies-to-document-shadow-and-profile-state');
    await page.locator('#dw-modebar [data-mode=agent]').click();const sidebarBefore=await page.locator('#dw-agent').locator('#agent-sidebar').isVisible();await page.keyboard.press('F10');assert.equal(await page.locator('#dw-agent').locator('#agent-sidebar').isVisible(),false);await page.keyboard.press('F10');assert.equal(await page.locator('#dw-agent').locator('#agent-sidebar').isVisible(),sidebarBefore);checks.push('agent-focus-mode-restores-sidebars');
    await page.locator('#dw-modebar [data-mode=writing]').click();
    assert.equal(await page.locator('#dw-scene-reference').getByText('张力 82%',{exact:true}).count(),0);
    const grip=page.locator('[aria-label="调整场景参考高度"]');await grip.focus();const before=await page.locator('#dw-scene-reference').evaluate(n=>n.getBoundingClientRect().height);await page.keyboard.press('ArrowUp');const after=await page.locator('#dw-scene-reference').evaluate(n=>n.getBoundingClientRect().height);assert.ok(after>before,'scene resize is effective');
    for(const width of [1600,1280,1050,800]){await page.setViewportSize({width,height:1000});for(const mode of ['rp','agent','writing']){await page.locator('#dw-modebar [data-mode='+mode+']').click();await page.waitForTimeout(100);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),mode+' viewport '+width);if(mode==='writing'&&width>900){const geometry=await page.evaluate(()=>{const m=document.querySelector('#dw-main').getBoundingClientRect(),d=document.querySelector('#dw-actions').getBoundingClientRect();return d.left>=m.left-1&&d.right<=m.right+1;});assert.ok(geometry,'manuscript dock stays inside column');}}}
    await page.setViewportSize({width:1600,height:1000});await page.locator('#dw-modebar [data-mode=writing]').click();await page.locator('#dw-viewbar [data-view=body]').click();
    const center=await page.evaluate(()=>{const a=document.querySelector('#dw-actions').getBoundingClientRect(),m=document.querySelector('#dw-main').getBoundingClientRect();return Math.abs((a.left+a.width/2)-(m.left+m.width/2));});assert.ok(center<2,'body focus dock centered');
    checks.push('all-modes-responsive-dock-contained-scene-resize-real-data-only');
    await page.locator('#dw-viewbar [data-view=workbench]').click();
};
