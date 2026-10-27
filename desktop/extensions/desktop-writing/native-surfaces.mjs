import {mountNativeWorkspace} from './native-settings-workspaces.mjs';
// Keep native controls and their handlers; the category itself provides navigation.
export function enhanceNativeSurface(panel, host, key) {
    const disposeWorkspace=mountNativeWorkspace(panel,key);
    host.classList.add('dw-native-surface');
    return ()=>{disposeWorkspace();host.classList.remove('dw-native-surface');};
}

export function interceptNativeDrawers({mapping,dialog}) {
    const byHolder=Object.fromEntries(Object.entries(mapping).map(([key,id])=>[id,key]));
    const tab=key=>key==='model'?'models':key==='preset'?'params':key;
    const capture=event=>{
        const toggle=event.target.closest?.('#top-settings-holder > .drawer > .drawer-toggle');
        if(!toggle||dialog.isOpen)return;
        const key=byHolder[toggle.parentElement.id];if(!key)return;
        event.preventDefault();event.stopImmediatePropagation();void dialog.open(tab(key));
    };
    document.addEventListener('click',capture,true);
    // Native code can call doNavbarIconClick directly without dispatching a click event.
    const observer=new MutationObserver(records=>{
        if(dialog.isOpen||dialog.restoringNative)return;
        for(const r of records){const panel=r.target,key=byHolder[panel.parentElement?.id];
            if(key&&panel.matches('.drawer-content.openDrawer')&&!r.oldValue?.split(/\s+/).includes('openDrawer')){void dialog.open(tab(key));break;}
        }
    });
    const holder=document.getElementById('top-settings-holder');
    if(holder)observer.observe(holder,{subtree:true,attributes:true,attributeFilter:['class'],attributeOldValue:true});
    return ()=>{document.removeEventListener('click',capture,true);observer.disconnect();};
}
