// Navigation around original controls: no cloning, renaming, or replacement of their handlers.
export function enhanceNativeSurface(panel, host) {
    host.classList.add('dw-native-surface');
    const toolbar=document.createElement('div');toolbar.className='dw-native-toolbar';
    const search=document.createElement('input');search.type='search';search.placeholder='查找当前页面的设置…';search.setAttribute('aria-label','查找当前页面的设置');
    const jump=document.createElement('select');jump.setAttribute('aria-label','跳转到设置分区');
    const first=document.createElement('option');first.textContent='跳转到分区';first.value='';jump.append(first);
    const headings=[...panel.querySelectorAll('h3,h4,.inline-drawer-header,.standoutHeader')].filter(n=>n.textContent.trim()).filter((n,i,all)=>!all.some(other=>other!==n&&other.contains(n)));
    headings.forEach((n,i)=>{const o=document.createElement('option');o.value=String(i);o.textContent=n.textContent.trim().replace(/\s+/g,' ').slice(0,70);jump.append(o);});
    const results=document.createElement('div');results.className='dw-native-search-results';results.hidden=true;results.setAttribute('role','region');results.setAttribute('aria-label','设置查找结果');
    let highlighted;
    const reveal=n=>{
        const parents=[];for(let parent=n.parentElement;parent&&parent!==panel;parent=parent.parentElement)if(parent.matches('.inline-drawer'))parents.unshift(parent);
        for(const parent of parents){const header=parent.querySelector(':scope>.inline-drawer-header'),content=parent.querySelector(':scope>.inline-drawer-content');if(header&&content&&getComputedStyle(content).display==='none')(header.querySelector('.inline-drawer-toggle')||header).click();}
        highlighted?.classList.remove('dw-setting-highlight');highlighted=n;n.classList.add('dw-setting-highlight');n.scrollIntoView({behavior:'auto',block:'center'});
        const focus=n.matches('input,select,textarea,button')?n:n.htmlFor?document.getElementById(n.htmlFor):n.querySelector('input:not([type=hidden]),select,textarea,button');focus?.focus({preventScroll:true});
    };
    jump.onchange=()=>{if(jump.value!=='')reveal(headings[Number(jump.value)]);};
    search.oninput=()=>{
        const query=search.value.trim().toLocaleLowerCase();results.replaceChildren();results.hidden=!query;if(!query)return;
        // Re-scan so plugin-generated fields and current API-specific settings are included.
        const candidates=[...panel.querySelectorAll('label,h3,h4,.inline-drawer-header,[data-i18n]')];
        const matches=candidates.filter(n=>n.textContent.trim()&&n.textContent.toLocaleLowerCase().includes(query)&&n.textContent.length<240).filter((n,i,all)=>!all.some(other=>other!==n&&n.contains(other))).slice(0,30);
        for(const n of matches){const b=document.createElement('button');b.type='button';b.textContent=n.textContent.trim().replace(/\s+/g,' ');b.onclick=()=>reveal(n);results.append(b);}
        if(!matches.length)results.textContent='当前页面未找到匹配项。可切换左侧分类继续查找。';
    };
    toolbar.append(search,jump);host.prepend(toolbar,results);
    return ()=>{highlighted?.classList.remove('dw-setting-highlight');toolbar.remove();results.remove();host.classList.remove('dw-native-surface');};
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
