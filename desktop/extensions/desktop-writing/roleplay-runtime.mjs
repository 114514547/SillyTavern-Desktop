import * as native from '/script.js';
import {branchChat} from '/scripts/bookmarks.js';
import {SWIPE_DIRECTION} from '/scripts/constants.js';
import {getRegexedString,regex_placement} from '/scripts/extensions/regex/engine.js';

// The upstream engine still owns prompts, generation, chat persistence, regex
// hooks and tool calls. All remaining DOM contracts are isolated here.
export class RoleplayRuntime{
    constructor({ctx,busy}){Object.assign(this,{ctx,busy});this.locked=false;}
    get input(){return document.getElementById('send_textarea');}
    get generating(){return native.isGenerating();}
    get key(){const c=this.ctx();return JSON.stringify([c.characters[c.characterId]?.avatar,c.groupId,c.getCurrentChatId()]);}
    assertIdle(){if(this.locked||this.busy?.()||native.isGenerating())throw Error('请先结束当前生成或消息操作。');}
    async act(work){this.assertIdle();this.locked=true;try{return await work();}finally{this.locked=false;}}
    setDraft(text){if(!this.input)throw Error('聊天引擎尚未就绪。');if(this.input.value===text)return;this.input.value=text;this.input.dispatchEvent(new Event('input',{bubbles:true}));}
    async send(){return this.act(async()=>{
        const c=this.ctx();if(c.characterId===undefined&&!c.groupId)throw Error('请先选择角色或群聊。');if(c.onlineStatus==='no_connection')throw Error('请先在连接设置中启用模型。');
        const text=this.input.value,key=this.key,size=c.chat.length;
        try{return await native.sendTextareaMessage();}catch(error){if(this.key===key&&this.ctx().chat.length===size&&!this.input.value)this.setDraft(text);throw error;}
    });}
    async continue(){return this.act(async()=>{if(this.input.value.trim())throw Error('请先发送或保留输入草稿，再续写当前回复。');if(!this.ctx().chat.length)throw Error('当前没有可续写的消息。');if(this.ctx().onlineStatus==='no_connection')throw Error('请先连接模型。');return native.Generate('continue');});}
    stop(){native.stopGeneration();}
    async ensureRendered(id){if(!document.querySelector('#chat .mes[mesid="'+id+'"]'))await native.showMoreMessages(Math.max(1,native.getFirstDisplayedMessageId()-id+1));}
    async regenerate(){return this.act(async()=>{
        const chat=this.ctx().chat,last=chat.at(-1);if(!last||last.is_user||last.is_system)throw Error('请先选择最后一条角色回复。');if(this.input.value.trim())throw Error('请先发送或保留输入草稿。');if(this.ctx().onlineStatus==='no_connection')throw Error('请先连接模型。');
        native.ensureSwipes(last);await this.ensureRendered(chat.length-1);
        // A regenerated reply becomes another swipe instead of deleting the
        // previous answer before the network request succeeds.
        return native.swipe(null,SWIPE_DIRECTION.RIGHT,{forceMesId:chat.length-1,forceSwipeId:last.swipes.length,forceDuration:0});
    });}
    async chooseReply(id,swipeId){return this.act(async()=>{
        const message=this.ctx().chat[id];if(!message||!Array.isArray(message.swipes)||!Number.isInteger(swipeId)||swipeId<0||swipeId>=message.swipes.length)throw Error('此候选回复已变化，请重新选择。');
        await this.ensureRendered(id);native.syncMesToSwipe(id);if(!native.syncSwipeToMes(id,swipeId))throw Error('候选回复无法切换。');native.updateMessageBlock(id,message);await this.ctx().eventSource.emit(this.ctx().eventTypes.MESSAGE_SWIPED,id);await native.saveChatConditional();
    });}
    async edit({key,id,message,before,text}){return this.act(async()=>{
        if(key!==this.key||this.ctx().chat[id]!==message||message.mes!==before)throw Error('消息已在其他位置更新，编辑草稿已保留，请重新核对。');
        await this.ensureRendered(id);if(key!==this.key||this.ctx().chat[id]!==message||message.mes!==before)throw Error('聊天已变化，未覆盖消息。');
        message.extra??={};const narrator=message.extra.type==='narrator',placement=message.is_user?regex_placement.USER_INPUT:narrator?regex_placement.SLASH_COMMAND:regex_placement.AI_OUTPUT;
        let processed=getRegexedString(text,placement,{characterOverride:narrator?undefined:message.name,isEdit:true});if(this.ctx().powerUserSettings.trim_spaces)processed=processed.trim();
        const bias=native.substituteParams(native.extractMessageBias(processed));processed=native.substituteParams(processed);if(bias)processed=native.removeMacros(processed);
        message.mes=processed;message.extra.bias=message.is_system||message.is_user||narrator?bias??null:null;delete message.extra.display_text;delete message.extra.token_count;this.ctx().chatMetadata.tainted=true;native.syncMesToSwipe(id);
        const c=this.ctx();await c.eventSource.emit(c.eventTypes.MESSAGE_EDITED,id);native.syncMesToSwipe(id);native.updateMessageBlock(id,message);await c.eventSource.emit(c.eventTypes.MESSAGE_UPDATED,id);await native.saveChatConditional();
    });}
    async remove(key,id,message){return this.act(async()=>{if(key!==this.key||this.ctx().chat[id]!==message)throw Error('聊天已变化，未删除消息。');await this.ensureRendered(id);if(key!==this.key||this.ctx().chat[id]!==message)throw Error('聊天已变化，未删除消息。');await native.deleteMessage(id,undefined,false,true);await native.saveChatConditional();});}
    async branch(key,id,message){return this.act(async()=>{if(this.input.value.trim())throw Error('输入框还有草稿，请先发送或保留。');if(key!==this.key||this.ctx().chat[id]!==message)throw Error('聊天已变化，请重新选择分支位置。');return branchChat(id,{swipeId:message.swipe_id??null});});}
    format(message,id){return native.messageFormatting(message.extra?.display_text??message.mes??'',message.name||'',!!message.is_system,!!message.is_user,id,{},false);}
}
