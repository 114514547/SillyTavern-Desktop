import {element as el,settingsButton as button,settingsTabs as tabs} from './settings-controls.mjs';

// Arrange original controls, retaining their IDs, handlers and enclosing native roots.
export function mountNativeWorkspace(panel,key){
    const cleanups=[],added=[],classes=[],moves=[];
    const add=(parent,node,before=null)=>{parent.insertBefore(node,before);added.push(node);return node;};
    const decorate=(node,cls)=>{if(node&&!node.classList.contains(cls)){node.classList.add(cls);classes.push([node,cls]);}};
    const listen=(node,event,handler)=>{node.addEventListener(event,handler);cleanups.push(()=>node.removeEventListener(event,handler));};
    const observe=(node,work)=>{const observer=new MutationObserver(work);observer.observe(node,{subtree:true,childList:true});cleanups.push(()=>observer.disconnect());};
    const labelActions=()=>{
        const labels={world_import_button:'导入',world_popup_export:'导出',world_popup_name_button:'重命名',world_duplicate:'复制',world_popup_delete:'删除世界书',world_popup_new:'添加条目',world_refresh:'刷新',world_backfill_memos:'补全标题',world_apply_current_sorting:'应用排序',persona_rename_button:'重命名',sync_name_button:'同步消息名称',persona_lore_button:'关联世界书',persona_set_image_button:'更换头像',persona_duplicate_button:'复制身份',persona_delete_button:'删除身份',persona_grid_toggle:'切换视图'};
        for(const [id,text]of Object.entries(labels)){const node=panel.querySelector('#'+id);if(!node||node.hasAttribute('data-sc-label'))continue;node.dataset.scLabel=text;cleanups.push(()=>delete node.dataset.scLabel);}
        for(const [type,text]of [['update','保存'],['rename','重命名'],['new','另存为'],['restore','恢复'],['delete','删除']])for(const node of panel.querySelectorAll(`[data-preset-manager-${type}]`)){node.dataset.scLabel=text;cleanups.push(()=>delete node.dataset.scLabel);}
    };
    if(key==='format'){
        const columns=['ContextSettings','InstructSettingsColumn','SystemPromptColumn'].map(id=>panel.querySelector('#'+id)).filter(Boolean),parent=columns[0]?.parentElement;
        if(parent){decorate(parent,'sc-format-columns');const library=add(parent,el('aside',undefined,'sc-format-library'),parent.firstChild),types=el('div',undefined,'sc-format-types'),search=el('input'),list=el('div',undefined,'sc-format-presets');search.type='search';search.placeholder='查找模板…';search.setAttribute('aria-label','查找格式模板');library.append(types,search,list);let active=columns.find(n=>n.id==='SystemPromptColumn')||columns[0];
            const names={ContextSettings:'上下文模板',InstructSettingsColumn:'指令格式',SystemPromptColumn:'系统提示与其他'},selectFor=column=>column.querySelector('select[data-preset-manager-for]');
            const draw=()=>{types.replaceChildren();list.replaceChildren();for(const column of columns){const b=button(names[column.id],()=>{active=column;search.value='';draw();},'sc-collection-item');b.setAttribute('aria-pressed',String(column===active));types.append(b);column.classList.toggle('sc-native-selected',column===active);}
                const select=selectFor(active);if(!select){list.append(el('p','此分区没有可选模板。','sc-hint'));return;}for(const option of select.options){if(option.hidden||option.disabled||!option.textContent.toLocaleLowerCase().includes(search.value.toLocaleLowerCase()))continue;const b=button(option.textContent,()=>{select.value=option.value;globalThis.jQuery(select).trigger('change');draw();},'sc-collection-item');b.setAttribute('aria-pressed',String(option.value===select.value));list.append(b);}if(!list.children.length)list.append(el('p','没有匹配的模板。','sc-hint'));
            };search.oninput=draw;for(const column of columns){const select=selectFor(column);if(select){listen(select,'change',draw);observe(select,draw);}}draw();cleanups.push(()=>columns.forEach(n=>n.classList.remove('sc-native-selected')));
        }
    }
    if(key==='world'){
        const root=panel.querySelector('#wi-holder'),popup=panel.querySelector('#world_popup'),entries=panel.querySelector('#world_popup_entries_list');
        if(root&&popup&&entries){decorate(root,'sc-world-root');decorate(popup,'sc-world-editor');const nav=add(root,tabs([['entries','世界书与条目'],['activation','全局启用与扫描']], 'entries',id=>{root.classList.toggle('sc-world-activation',id==='activation');for(const b of nav.children){b.setAttribute('aria-selected',String(b.dataset.tab===id));b.tabIndex=b.dataset.tab===id?0:-1;}}),root.firstChild);
            const library=add(popup,el('aside',undefined,'sc-world-index'),entries),title=el('header','条目目录'),list=el('div',undefined,'sc-collection');library.append(title,list);let selected='',last='',adding=false,previousIds=new Set();
            const rows=()=>[...entries.querySelectorAll(':scope>.world_entry')];
            const select=(row,remember=true)=>{const id=row.getAttribute('uid');if(remember)selected=id;for(const entry of rows())entry.classList.toggle('sc-entry-selected',entry===row);for(const b of list.querySelectorAll('button'))b.setAttribute('aria-pressed',String(b.dataset.uid===id));const content=row.querySelector('.inline-drawer-content');if(content&&getComputedStyle(content).display==='none')row.querySelector('.inline-drawer-toggle')?.click();};
            const draw=()=>{const all=rows();if(adding){const created=all.find(row=>!previousIds.has(row.getAttribute('uid')));if(created){selected=created.getAttribute('uid');adding=false;}}const fingerprint=all.map(row=>row.getAttribute('uid')+':'+(row.querySelector('[name=comment]')?.value||'')).join('|');if(fingerprint!==last||!list.children.length){last=fingerprint;list.replaceChildren();for(const row of all){const id=row.getAttribute('uid'),name=row.querySelector('[name=comment]')?.value?.trim()||'未命名条目 '+id;const b=button(name,()=>select(row),'sc-collection-item');b.dataset.uid=id;list.append(b);}if(!all.length)list.append(el('p','选择世界书，或添加新条目。','sc-empty'));}if(all.length){const chosen=all.find(row=>row.getAttribute('uid')===selected);select(chosen||all[0],!!chosen||!selected);}};
            const create=panel.querySelector('#world_popup_new');if(create)listen(create,'click',()=>{adding=true;previousIds=new Set(rows().map(row=>row.getAttribute('uid')));});observe(entries,draw);listen(entries,'input',e=>{if(e.target.name==='comment')draw();});const choose=panel.querySelector('#world_editor_select');if(choose)listen(choose,'change',()=>{selected='';last='';adding=false;});draw();cleanups.push(()=>{root.classList.remove('sc-world-activation');rows().forEach(row=>row.classList.remove('sc-entry-selected'));});
        }
    }
    if(key==='persona'){
        decorate(panel,'sc-native-persona');const current=panel.querySelector('.persona_management_current_persona');
        if(current){const description=panel.querySelector('#persona_description'),position=panel.querySelector('.persona_management_description_position_container');if(description&&position){decorate(description,'sc-persona-description');decorate(position,'sc-persona-injection');}}
    }
    if(key==='extensions'){
        const roots=[...panel.querySelectorAll('#extensions_settings,#extensions_settings2')],parent=roots[0]?.parentElement;
        if(parent){decorate(parent,'sc-extension-columns');const library=add(parent,el('aside',undefined,'sc-extension-library'),parent.firstChild),search=el('input'),list=el('div',undefined,'sc-collection');library.append(el('strong','扩展与工具'));search.type='search';search.placeholder='查找扩展、正则…';search.setAttribute('aria-label','查找扩展设置');library.append(search,list);let selected=null,last='';
            const modules=()=>roots.flatMap(root=>[...root.children]).filter(n=>n.querySelector('input,textarea,select,.inline-drawer-header')||n.matches('.inline-drawer'));
            const select=node=>{selected=node;for(const item of modules())item.classList.toggle('sc-extension-selected',item===node);for(const b of list.querySelectorAll('button'))b.setAttribute('aria-pressed',String(b._surface===node));const header=node.matches('.inline-drawer')?node.querySelector(':scope>.inline-drawer-header'):node.querySelector('.inline-drawer-header'),content=header?.parentElement.querySelector(':scope>.inline-drawer-content');if(content&&getComputedStyle(content).display==='none')(header.querySelector('.inline-drawer-toggle')||header).click();};
            const draw=()=>{const all=modules(),names=all.map(n=>(n.querySelector('.inline-drawer-header,h3,h4')||n).textContent.trim().replace(/\s+/g,' ').slice(0,65)),fingerprint=names.join('|')+search.value;all.forEach(node=>decorate(node,'sc-extension-module'));if(fingerprint!==last||!list.children.length){last=fingerprint;list.replaceChildren();all.forEach((node,i)=>{if(!names[i].toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase()))return;const b=button(names[i]||'扩展设置',()=>select(node),'sc-collection-item');b._surface=node;list.append(b);});if(!list.children.length)list.append(el('p','没有匹配的扩展。','sc-empty'));}if(all.length)select(all.includes(selected)?selected:all.find(n=>n.querySelector('.regex_settings')||n.matches('.regex_settings'))||all[0]);};
            const legacyNodes=[...parent.children].filter(n=>n!==library&&n!==roots[0]&&n!==roots[1]&&n!==parent.querySelector(':scope>.flex-container'));
            if(legacyNodes.length){const legacy=add(parent,el('details',undefined,'sc-extension-legacy'));legacy.append(el('summary','兼容 Extras API · 旧扩展接口'));for(const node of legacyNodes){const mark=document.createComment('native extension control');node.before(mark);moves.push([node,mark]);legacy.append(node);}}
            search.oninput=draw;for(const root of roots)observe(root,draw);draw();cleanups.push(()=>modules().forEach(n=>n.classList.remove('sc-extension-selected')));
        }
    }
    if(key==='background')decorate(panel,'sc-background-gallery');
    if(key==='appearance')decorate(panel,'sc-appearance-native');
    labelActions();
    return()=>{for(const cleanup of cleanups)cleanup();for(const [node,mark]of moves)mark.replaceWith(node);for(const [node,cls]of classes)node.classList.remove(cls);for(const node of added)node.remove();};
}
