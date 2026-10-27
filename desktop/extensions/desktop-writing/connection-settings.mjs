import * as native from '/scripts/openai.js';
import * as secrets from '/scripts/secrets.js';
import {changeMainAPI,setOnlineStatus,resultCheckStatus,cancelStatusCheck,substituteParams} from '/script.js';
import {Popup,POPUP_RESULT} from '/scripts/popup.js';
import {element as el,settingsButton as button,settingsField as field,settingsGrid as grid} from './settings-controls.mjs';
import {saveSettingsConfirmed,sameValue} from './settings-data.mjs';

const sources=Object.values(native.chat_completion_sources);
const labels={openai:'OpenAI',claude:'Claude',openrouter:'OpenRouter',makersuite:'Google Gemini',vertexai:'Vertex AI',custom:'自定义兼容接口',deepseek:'DeepSeek',azure_openai:'Azure OpenAI',xai:'xAI',zai:'Z.AI',siliconflow:'SiliconFlow',workers_ai:'Cloudflare Workers AI',minimax:'MiniMax'};
const apis=[['openai','聊天补全'],['textgenerationwebui','文本补全 / 本地模型'],['kobold','KoboldAI'],['koboldhorde','AI Horde'],['novel','NovelAI']];
const modelKey=source=>source==='makersuite'?'google_model':source==='custom'?'custom_model':source+'_model';
const proxySources=new Set(['claude','openai','mistralai','makersuite','vertexai','deepseek','xai','zai','moonshot']);
const noCatalog=new Set(['claude','ai21','vertexai','perplexity','zai','minimax']);
function fields(source){
    const list=[[modelKey(source),'模型标识','text']];
    if(proxySources.has(source))list.push(['reverse_proxy','反向代理端点（可选）','url'],['proxy_password','代理口令','password']);
    if(source==='custom')list.push(['custom_url','兼容接口地址','url'],['custom_include_headers','附加请求头','area']);
    if(source==='azure_openai')list.push(['azure_base_url','Azure 端点','url'],['azure_deployment_name','部署名称','text'],['azure_api_version','API 版本','text']);
    if(source==='workers_ai')list.push(['workers_ai_account_id','Cloudflare Account ID','text']);
    if(source==='vertexai')list.push(['vertexai_express_project_id','Google Cloud 项目 ID（Express）','text'],['vertexai_region','区域','text']);
    return list;
}
export class ConnectionSettingsWorkspace{
    constructor({ctx,busy,status,openNative}){Object.assign(this,{ctx,busy,status,openNative});this.catalog=new Map();}
    get settings(){return native.oai_settings;}
    secretKey(){return this.source==='vertexai'&&this.settings.vertexai_auth_mode==='full'?secrets.SECRET_KEYS.VERTEXAI_SERVICE_ACCOUNT:secrets.SECRET_KEYS[this.source.toUpperCase()];}
    get dirty(){return this.ctx().mainApi==='openai'&&(!!this.keyInput?.value.trim()||!sameValue(this.base,this.draft));}
    load(source=this.settings.chat_completion_source){this.source=source;this.base={chat_completion_source:this.settings.chat_completion_source};for(const [key]of fields(source))this.base[key]=this.settings[key]??'';this.draft={...this.base,chat_completion_source:source};}
    mount(parent){this.host=el('div',undefined,'sc-workspace');parent.append(this.host);this.load();this.render();}
    dispose(){this.disposed=true;this.controller?.abort();if(this.keyInput)this.keyInput.value='';}
    assertIdle(){if(this.busy?.()||this.working)throw Error('请先结束生成或当前连接操作。');}
    async run(work){try{this.assertIdle();return await work();}catch(error){if(!this.disposed)this.status(error.message||'连接操作未完成，请重试。',true);return false;}}
    async beforeLeave(){
        if(this.working){this.status('连接操作正在进行，请稍候。',true);return false;}
        if(!this.dirty)return true;
        const result=await Popup.show.confirm('保存连接修改？','保存后继续，或放弃本次编辑。密钥留空不会修改已有密钥。',{okButton:'保存并继续',cancelButton:'继续编辑',customButtons:[{text:'放弃修改',result:2}]});
        if(result===POPUP_RESULT.AFFIRMATIVE)return !!await this.save();
        if(result===2){if(this.keyInput)this.keyInput.value='';this.load();return true;}return false;
    }
    sync(){if(this.saveButton)this.saveButton.disabled=!!this.busy?.()||!!this.working||!this.dirty;}
    setWorking(value){this.working=value;for(const control of this.host.querySelectorAll('input,textarea,select,button'))control.disabled=value||!!this.busy?.();this.sync();}
    render(){
        if(this.disposed)return;this.host.replaceChildren();this.keyInput=null;this.saveButton=null;
        const library=el('aside',undefined,'sc-library'),head=el('header'),list=el('div',undefined,'sc-collection'),detail=el('section',undefined,'sc-detail'),body=el('div',undefined,'sc-editor-scroll');head.append(el('strong','连接提供商'));
        head.append(field('接口类型',this.ctx().mainApi,(value,input)=>void this.run(async()=>{if(!await this.beforeLeave()){input.value=this.ctx().mainApi;return;}if(!apis.some(([id])=>id===value))throw Error('不支持的接口类型。');changeMainAPI(value);await saveSettingsConfirmed(this.ctx,[[['main_api'],value]]);this.render();}),{options:apis}));library.append(head,list);detail.append(body);this.host.append(library,detail);
        if(this.ctx().mainApi!=='openai'){body.append(el('h3',apis.find(([id])=>id===this.ctx().mainApi)?.[1]||'当前接口'),el('p','此接口的专用参数继续由完整连接页面管理。','sc-hint'),button('打开当前接口设置',()=>void this.run(async()=>{if(await this.beforeLeave())return this.openNative();})));return;}
        for(const source of sources){const b=button(labels[source]||source,()=>void this.run(async()=>{if(source===this.source)return;if(!await this.beforeLeave())return;this.load(source);this.render();}),'sc-collection-item');b.setAttribute('aria-pressed',String(source===this.source));list.append(b);}
        body.append(el('h3',labels[this.source]||this.source),el('p','保存并使用当前连接；模型名称可直接填写，也可连接后从返回的目录选择。','sc-hint'));
        const secretKey=this.secretKey();
        if(secretKey){const label=field(secretKey===secrets.SECRET_KEYS.VERTEXAI_SERVICE_ACCOUNT?'服务账号 JSON':'API 密钥','',()=>this.sync(),{type:'password'});this.keyInput=label.querySelector('input');this.keyInput.autocomplete='new-password';this.keyInput.placeholder=secrets.secret_state[secretKey]?'已配置，留空保持原样':'输入密钥，留空不修改';this.keyInput.addEventListener('input',()=>this.sync());body.append(label);}
        const address=el('div',undefined,'sc-grid');body.append(address);
        for(const [key,title,type]of fields(this.source)){
            const label=field(title,this.draft[key],value=>{this.draft[key]=value;this.sync();},{type:type==='area'?'text':type,area:type==='area',rows:4});address.append(label);
            const editor=label.querySelector('input,textarea');editor.autocomplete=type==='password'?'new-password':'off';editor.addEventListener('input',()=>{this.draft[key]=editor.value;this.sync();});
            if(key===modelKey(this.source)){const input=label.querySelector('input'),options=el('datalist');options.id='dw-connection-models';input.setAttribute('list',options.id);for(const model of this.catalog.get(this.source)||[]){const o=el('option');o.value=model.id;o.label=model.name||model.id;options.append(o);}label.append(options);}
        }
        const actions=el('footer',undefined,'sc-local-footer');this.saveButton=button('保存并使用此连接',()=>void this.save(),'sc-primary');actions.append(this.saveButton,button('连接 / 刷新模型',()=>void this.run(()=>this.connect())),button('完整连接选项',()=>void this.run(async()=>{if(await this.beforeLeave())return this.openNative();})));detail.append(actions);this.sync();
        if(this.source==='custom')actions.append(button('直接使用（不验证模型目录）',()=>void this.run(async()=>{if(!await this.save())return;setOnlineStatus('已配置（尚未验证）');resultCheckStatus();this.status('已启用兼容连接，未验证模型目录；请发送消息确认实际可用性。');})));
        if(this.working||this.busy?.())for(const input of this.host.querySelectorAll('input,textarea,select,button'))input.disabled=true;
    }
    async save(){return this.run(async()=>{
        if(this.ctx().mainApi!=='openai'){await saveSettingsConfirmed(this.ctx,[[['main_api'],this.ctx().mainApi]]);this.status('当前接口类型已确认保存。');return true;}
        const source=this.source,draft={...this.draft},keyValue=this.keyInput?.value.trim()||'',settings=this.settings;
        if(!sources.includes(source))throw Error('不支持的连接提供商。');
        for(const [key,title,type]of fields(source)){
            if(type==='url'&&draft[key]){let url;try{url=new URL(draft[key]);}catch{throw Error('请填写有效的'+title+'。');}if(!['http:','https:'].includes(url.protocol))throw Error('接口地址需要使用 HTTP 或 HTTPS。');}
            if(!sameValue(settings[key]??'',this.base[key])&&!sameValue(settings[key]??'',draft[key]))throw Error('连接配置已在其他位置修改，请保留本次编辑后重新载入。');
        }
        if(source==='custom'&&!draft.custom_url?.trim())throw Error('请填写兼容接口地址。');
        if(!sameValue(settings.chat_completion_source,this.base.chat_completion_source)&&settings.chat_completion_source!==source)throw Error('连接提供商已在其他位置切换，请重新载入。');
        this.setWorking(true);
        try{
            const secretKey=this.secretKey();
            if(keyValue&&secretKey===secrets.SECRET_KEYS.VERTEXAI_SERVICE_ACCOUNT){let account;try{account=JSON.parse(keyValue);}catch{throw Error('服务账号内容不是有效的 JSON，未修改原凭据。');}if(typeof account?.client_email!=='string'||typeof account?.private_key!=='string')throw Error('服务账号缺少必要字段，未修改原凭据。');}
            if(keyValue){if(!secretKey||!await secrets.writeSecret(secretKey,keyValue))throw Error('密钥尚未确认保存，请重试。');this.keyInput.value='';this.keyInput.placeholder='已配置，留空保持原样';}
            const connectionChanged=settings.chat_completion_source!==source||keyValue||fields(source).some(([key])=>key!==modelKey(source)&&settings[key]!==draft[key]);
            if(connectionChanged){cancelStatusCheck('Desktop connection changed');setOnlineStatus('no_connection');native.model_list.splice(0);this.catalog.delete(source);}
            Object.assign(settings,draft);if(this.ctx().mainApi!=='openai')changeMainAPI('openai');
            await saveSettingsConfirmed(this.ctx,[[['main_api'],'openai'],...Object.entries(draft).map(([key,value])=>[['oai_settings',key],value])]);
            const c=this.ctx();if(c.eventTypes.CHATCOMPLETION_SOURCE_CHANGED)await c.eventSource.emit(c.eventTypes.CHATCOMPLETION_SOURCE_CHANGED,source);if(c.eventTypes.CHATCOMPLETION_MODEL_CHANGED)await c.eventSource.emit(c.eventTypes.CHATCOMPLETION_MODEL_CHANGED,native.getChatCompletionModel());
            this.load(source);this.status(connectionChanged?'连接配置已确认保存，请点击“连接 / 刷新模型”。':'连接配置已确认保存。');return true;
        }finally{if(!this.disposed)this.setWorking(false);else this.working=false;}
    });}
    async connect(){
        if(!await this.save())return;this.assertIdle();this.working=true;this.render();const source=this.source,settings={...this.settings};
        try{
            cancelStatusCheck('Desktop connection check');
            if(noCatalog.has(source)){const key=secrets.resolveSecretKey();if(key&&!secrets.secret_state[key]&&!(proxySources.has(source)&&settings.reverse_proxy))throw Error('请先保存此提供商的密钥或授权信息。');setOnlineStatus('已配置（尚未验证）');resultCheckStatus();this.status('此提供商不支持模型目录验证。配置已保存，实际可用性需通过发送消息确认。');return;}
            const body={chat_completion_source:source,reverse_proxy:settings.reverse_proxy,proxy_password:settings.proxy_password};
            for(const key of ['custom_url','azure_base_url','azure_deployment_name','azure_api_version','siliconflow_endpoint','minimax_endpoint','workers_ai_account_id','pollinations_endpoint'])if(settings[key]!=null)body[key]=settings[key];
            if(source==='custom')body.custom_include_headers=substituteParams(settings.custom_include_headers||'');
            this.controller=new AbortController();const timer=setTimeout(()=>this.controller.abort(),30000);let data;
            try{const response=await fetch('/api/backends/chat-completions/status',{method:'POST',headers:this.ctx().getRequestHeaders(),body:JSON.stringify(body),signal:this.controller.signal});
                if(!response.ok)throw Error('连接验证失败（HTTP '+response.status+'），请检查地址、密钥与提供商。');
                try{data=await response.json();}catch(error){if(error.name==='AbortError')throw error;throw Error('连接结果不是有效的 JSON，请检查接口地址。');}
            }
            finally{clearTimeout(timer);}
            if(!data||typeof data!=='object'||data.error)throw Error('提供商未通过连接验证，请检查配置。');
            if(this.disposed||!sameValue(settings,this.settings)||this.ctx().mainApi!=='openai')return;
            const models=Array.isArray(data.data)?data.data.filter(model=>typeof model?.id==='string'):[];this.catalog.set(source,models);native.model_list.splice(0,native.model_list.length,...models);
            setOnlineStatus(data.bypass?'已配置（尚未验证）':'Valid');resultCheckStatus();this.status(data.bypass?'接口跳过了连接验证；请发送消息确认可用性。':'连接已验证，返回 '+models.length+' 个模型。');
        }catch(error){if(!this.disposed){setOnlineStatus('no_connection');resultCheckStatus();}if(error.name==='AbortError')throw Error('连接验证已取消或超时，请重试。');throw error;}
        finally{this.working=false;this.controller=null;this.render();}
    }
}
