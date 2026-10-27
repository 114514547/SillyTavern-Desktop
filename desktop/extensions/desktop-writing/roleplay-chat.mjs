import {RoleplayRuntime} from './roleplay-runtime.mjs';
import {icon} from './icons.mjs';
import {Popup,POPUP_RESULT} from '/scripts/popup.js';
const el=(tag,text,cls)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
const button=(label,work,glyph)=>{const b=el('button',undefined,'rp-chat-button');b.type='button';b.title=label;b.setAttribute('aria-label',label);if(glyph)b.append(icon(glyph));b.append(el('span',label));b.onclick=work;return b;};
const mediaUrl=value=>{if(typeof value!=='string'||!value)return '';try{const url=new URL(value,location.href);return ['http:','https:','blob:'].includes(url.protocol)||url.protocol==='data:'&&/^data:(image|audio|video)\//i.test(value)?url.href:'';}catch{return '';}};
export class RoleplayChat{
    constructor({ctx,busy,status,onChatToNovel}){Object.assign(this,{ctx,busy,status,onChatToNovel});this.runtime=new RoleplayRuntime({ctx,busy});this.rows=new Map();this.limit=80;}
    get locked(){return this.runtime.locked;}
    get editing(){return !!this.editor;}
    mount(parent){
        this.host=el('section',undefined,'rp-conversation');this.host.id='dw-rp-conversation';this.host.setAttribute('aria-label','角色对话');
        this.log=el('div',undefined,'rp-chat-log');this.log.setAttribute('role','log');this.log.setAttribute('aria-label','聊天记录');this.more=button('显示更早的消息',()=>{this.limit+=80;this.render();});
        this.form=el('form',undefined,'rp-composer');this.input=el('textarea');this.input.rows=2;this.input.placeholder='说点什么，继续故事…';this.input.setAttribute('aria-label','聊天输入');this.input.value=this.runtime.input?.value||'';
        this.input.addEventListener('input',()=>{this.runtime.setDraft(this.input.value);this.resize();});this.input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&e.keyCode!==229){e.preventDefault();e.stopPropagation();this.form.requestSubmit();}});
        const tools=el('div',undefined,'rp-composer-tools'),left=el('div'),right=el('div');
        this.continueButton=button('续写',()=>void this.run(()=>this.runtime.continue()),'fa-feather-pointed');this.regenerateButton=button('重新生成',()=>void this.run(()=>this.runtime.regenerate()),'fa-rotate-right');
        left.append(this.continueButton,this.regenerateButton,button('原生兼容视图',()=>this.setLegacy(true),'fa-sliders'));
        this.stopButton=button('停止',()=>this.runtime.stop(),'fa-xmark');this.sendButton=el('button',undefined,'rp-chat-button rp-send');this.sendButton.type='submit';this.sendButton.setAttribute('aria-label','发送');this.sendButton.append(icon('fa-arrow-up'));right.append(this.stopButton,this.sendButton);tools.append(left,right);this.form.append(this.input,tools);this.hint=el('small','Enter 发送 · Shift+Enter 换行','rp-composer-hint');this.host.append(this.more,this.log,this.form,this.hint);parent.append(this.host);
        this.form.onsubmit=e=>{e.preventDefault();void this.run(()=>this.runtime.send());};
        this.runtime.input?.addEventListener('input',()=>this.syncDraft());
        const c=this.ctx();for(const name of ['CHAT_CHANGED','CHAT_LOADED','MESSAGE_SENT','MESSAGE_RECEIVED','MESSAGE_UPDATED','MESSAGE_EDITED','MESSAGE_DELETED','MESSAGE_SWIPED','MESSAGE_SWIPE_DELETED','USER_MESSAGE_RENDERED','CHARACTER_MESSAGE_RENDERED','STREAM_TOKEN_RECEIVED','STREAM_REASONING_DONE','GENERATION_STARTED','GENERATION_ENDED','GENERATION_STOPPED','IMAGE_SWIPED'])if(c.eventTypes[name])c.eventSource.on(c.eventTypes[name],()=>this.schedule());
        const back=document.createElement('button');back.id='dw-rp-modern-back';back.type='button';back.className='menu_button';back.textContent='返回新对话界面';back.hidden=true;back.onclick=()=>this.setLegacy(false);document.getElementById('dw-global-tools').prepend(back);this.back=back;
        this.nativeRoot=document.getElementById('sheld');this.setLegacy(false);this.render();window.addEventListener('resize',()=>this.resize());document.addEventListener('desktop-theme-changed',()=>this.resize());
    }
    syncDraft(){const value=this.runtime.input?.value||'';if(this.input.value!==value)this.input.value=value;this.resize();}
    resize(){this.input.style.height='auto';this.input.style.height=Math.min(200,Math.max(64,this.input.scrollHeight))+'px';}
    setLegacy(active){document.body.classList.toggle('dw-rp-native',active);this.back.hidden=!active;if(this.nativeRoot){this.nativeRoot.inert=!active;this.nativeRoot.setAttribute('aria-hidden',String(!active));}if(!active){this.syncDraft();this.schedule();}}
    schedule(){if(this.frame)return;this.frame=requestAnimationFrame(()=>{this.frame=null;this.render();});}
    async run(work){try{if(this.editor)throw Error('请先保存或取消消息编辑。');const pending=work();this.renderControls();await pending;}catch(error){this.status(error.message||'聊天操作未完成，请重试。',true);}finally{this.render();}}
    async beforeLeave(){if(!this.editor)return true;if(this.editor.saving){this.status('消息正在保存，请稍候。',true);return false;}const result=await Popup.show.confirm('消息尚未保存','保存后继续，或放弃这次消息编辑。',{okButton:'保存并继续',cancelButton:'继续编辑',customButtons:[{text:'放弃修改',result:2}]});if(result===2){this.cancelEdit();return true;}if(result===POPUP_RESULT.AFFIRMATIVE)return this.saveEdit();return false;}
    startEdit(id,message){this.runtime.assertIdle();if(this.editor)throw Error('请先结束当前消息编辑。');const row=this.rows.get(message);this.editor={key:this.runtime.key,id,message,before:message.mes,text:message.mes||'',row};row.body.hidden=true;row.tools.hidden=true;const panel=el('div',undefined,'rp-message-editor'),text=el('textarea');text.value=this.editor.text;text.setAttribute('aria-label','编辑消息原文');text.oninput=()=>{this.editor.text=text.value;};text.onkeydown=e=>{if(e.isComposing)return;if(e.key==='Enter'){e.stopPropagation();if(e.ctrlKey||e.metaKey){e.preventDefault();void this.saveEdit();}}else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();e.stopPropagation();void this.saveEdit();}else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();this.cancelEdit();}};const actions=el('div');actions.append(button('取消',()=>this.cancelEdit()),button('保存消息',()=>void this.saveEdit(),'fa-floppy-disk'));panel.append(text,actions);row.element.append(panel);this.editor.panel=panel;text.focus();this.renderControls();}
    cancelEdit(){if(this.editor){this.editor.panel.remove();this.editor.row.body.hidden=false;this.editor.row.tools.hidden=false;this.editor=null;}this.render();}
    async saveEdit(){const edit=this.editor;if(!edit)return true;if(edit.saving)return false;edit.saving=true;this.renderControls();try{await this.runtime.edit({...edit,text:edit.text});this.cancelEdit();this.status('消息修改已提交保存。');return true;}catch(error){this.status(error.message||'消息未能保存，编辑草稿已保留。',true);return false;}finally{edit.saving=false;this.renderControls();}}
    createRow(id,message){
        const element=el('article',undefined,'rp-message');element.dataset.speaker=message.is_user?'user':message.is_system?'system':'assistant';
        const name=el('header',message.name||'消息','rp-message-name'),body=el('div',undefined,'rp-message-body'),extras=el('div',undefined,'rp-message-extras'),tools=el('footer',undefined,'rp-message-tools');element.append(name,body,extras,tools);const row={id,element,body,name,extras,tools,signature:''};
        tools.append(button('复制',()=>void navigator.clipboard.writeText(message.mes||'').catch(()=>this.status('复制失败，请手动选择文本复制。',true)),'fa-copy'),button('编辑',()=>{try{this.startEdit(row.id,message);}catch(error){this.status(error.message,true);}},'fa-file-pen'),button('从这里创建分支',()=>void this.run(()=>this.runtime.branch(this.runtime.key,row.id,message)),'fa-code-compare'),button('删除',()=>void this.run(async()=>{const key=this.runtime.key,id=row.id;if(await Popup.show.confirm('删除消息','删除此消息及其关联的工具消息？此操作不能撤销。')===POPUP_RESULT.AFFIRMATIVE)await this.runtime.remove(key,id,message);}),'fa-trash'));
        return row;
    }
    render(){
        if(!this.host)return;const c=this.ctx(),key=this.runtime.key;
        if(key!==this.key){this.key=key;this.rows.clear();this.log.replaceChildren();this.limit=80;this.syncDraft();if(this.editor){this.editor.panel.prepend(el('p','聊天已切换，请复制保留这份编辑草稿，或取消本次编辑。'));this.host.insertBefore(this.editor.panel,this.form);this.status('原消息编辑草稿已保留，未覆盖其他聊天。',true);}}
        const nearBottom=this.log.scrollHeight-this.log.scrollTop-this.log.clientHeight<100,live=new Set(),start=Math.max(0,c.chat.length-this.limit);this.more.hidden=start===0;
        for(let id=start;id<c.chat.length;id++){
            const message=c.chat[id];live.add(message);let row=this.rows.get(message);if(!row){row=this.createRow(id,message);this.rows.set(message,row);}row.id=id;row.element.dataset.messageIndex=id;row.element.dataset.speaker=message.is_user?'user':message.is_system?'system':'assistant';
            const process=c.streamingProcessor,streaming=process&&!process.isFinished&&process.messageId===id&&process.type!=='impersonate';
            const text=streaming?(process.continueMessage||'')+(process.result||''):message.extra?.display_text??message.mes??'',reasoning=message.extra?.reasoning||'';
            const signature=JSON.stringify([text,reasoning,message.name,message.is_user,message.is_system,message.swipe_id,message.swipes?.length,message.extra?.media,message.extra?.file]);
            if(row.signature!==signature&&this.editor?.message!==message){row.signature=signature;row.name.textContent=message.name||'消息';row.body.innerHTML=this.runtime.format({...message,mes:text,extra:{...message.extra,display_text:text}},id);row.extras.replaceChildren();
                if(reasoning&&c.chatCompletionSettings?.show_thoughts){const details=el('details'),summary=el('summary','模型返回的思考'),pre=el('pre',reasoning);details.append(summary,pre);row.extras.append(details);}
                for(const media of message.extra?.media||[]){const url=mediaUrl(media?.url);if(!url)continue;const type=String(media.type||'');const node=el(type.includes('video')?'video':type.includes('audio')?'audio':'img');node.src=url;if(node.tagName!=='IMG')node.controls=true;else node.alt='消息附件';row.extras.append(node);}
                if(message.extra?.file?.url&&mediaUrl(message.extra.file.url)){const link=el('a',message.extra.file.name||'文件附件');link.href=mediaUrl(message.extra.file.url);link.download=message.extra.file.name||'附件';row.extras.append(link);}
                if(!message.is_user&&message.swipes?.length>1){const picker=el('select');picker.setAttribute('aria-label','选择候选回复');for(let i=0;i<message.swipes.length;i++){const option=el('option','候选 '+(i+1)+' / '+message.swipes.length);option.value=i;picker.append(option);}picker.value=message.swipe_id??0;picker.onchange=()=>void this.run(()=>this.runtime.chooseReply(row.id,Number(picker.value)));row.extras.append(picker);}
            }
            const existing=this.log.children[id-start];if(existing!==row.element)this.log.insertBefore(row.element,existing||null);
        }
        for(const [message,row]of this.rows)if(!live.has(message)&&this.editor?.message!==message){row.element.remove();this.rows.delete(message);}
        this.renderControls();if(nearBottom)this.log.scrollTop=this.log.scrollHeight;
    }
    renderControls(){const pending=this.locked||this.busy?.(),disabled=pending||this.editing;this.sendButton.disabled=disabled;this.continueButton.disabled=disabled;this.regenerateButton.disabled=disabled;this.stopButton.hidden=!this.runtime.generating;this.input.disabled=disabled;for(const row of this.rows.values())for(const control of row.element.querySelectorAll('.rp-message-tools button,.rp-message-extras select'))control.disabled=disabled;if(this.editor)for(const control of this.editor.panel.querySelectorAll('textarea,button'))control.disabled=!!this.editor.saving;}
}
