'use strict';
const $=id=>document.getElementById(id);
let selected=false,preferredProfile=null;
for(const b of document.querySelectorAll('button'))b.disabled=true;
let loading=false,loadingTimer=null,latestStatus='';
function diagnostics(show){$('startup-actions').hidden=!show;$('startup-status').classList.toggle('needs-attention',show);if(show)for(const id of ['retry','logs','open-data'])$(id).disabled=false;}
function beginLoading(){if(loading)return;loading=true;diagnostics(false);$('startup-status').setAttribute('aria-busy','true');loadingTimer=setTimeout(()=>diagnostics(true),8000);}
function endLoading(){loading=false;clearTimeout(loadingTimer);$('startup-status').setAttribute('aria-busy','false');}
let discovered=false;
$('advanced-options').addEventListener('toggle',async()=>{if(!$('advanced-options').open||discovered)return;const list=await call(()=>window.desktop.discover());if(!list)return;discovered=true;for(const i of list){const b=document.createElement('button');b.textContent=`发现 ${i.version}：${i.root}`;b.onclick=async()=>selection(await call(()=>window.desktop.inspect({root:i.root,mode:'standalone'})));$('candidates').append(b);}});
function status(s,error=false){$('status').textContent=s;const failed=error||/失败|错误|超时|无法|意外退出|拒绝|权限不足|占用|检测到已有|无效|损坏/.test(s);if(failed){endLoading();diagnostics(true);}else if(s.startsWith('正在'))beginLoading();else{endLoading();diagnostics(false);}}
window.desktop.onStatus(s=>{latestStatus=s;status(s);});
status('正在读取工作区…');
async function call(fn){try{const r=await fn();if(!r.ok){status(r.error,true);return null;}return r.value;}catch{status('桌面操作失败，请重试或复制诊断状态。',true);return null;}}
function selection(i){if(!i)return;selected=true;$('selected').textContent=i.root;$('source-info').textContent=`${i.version} · ${i.mode} | 配置：${i.configPath} | 数据：${i.dataRoot}`;$('existing').disabled=false;$('preview').disabled=false;$('migration').hidden=true;status(i.remoteWasEnabled?'原配置允许远程连接；桌面模式将仅监听本机，不修改原网络配置。':'安装识别完成。请确认原酒馆已关闭。');}
$('choose').onclick=async()=>selection(await call(()=>window.desktop.choose()));
$('inspect').onclick=async()=>selection(await call(()=>window.desktop.inspect({mode:$('mode').value,configPath:$('configPath').value,dataRoot:$('dataRoot').value})));
$('mode').onchange=()=>{$('configPath').disabled=$('mode').value==='global';$('dataRoot').disabled=$('mode').value==='global';$('existing').disabled=true;$('preview').disabled=true;status('启动方式已改变，请点击重新识别路径。');};
for(const id of ['configPath','dataRoot'])$(id).oninput=()=>{$('existing').disabled=true;$('preview').disabled=true;};
async function launch(action){for(const b of document.querySelectorAll('button'))b.disabled=true;status('正在加载酒馆核心组件…');const result=await call(action);if(result?.migration)status(`副本已创建并校验：${result.migration.count} 个文件。`);for(const b of document.querySelectorAll('button'))b.disabled=false;$('existing').disabled=!selected;$('preview').disabled=!selected;return result;}
const run=mode=>launch(()=>window.desktop.run(mode));
$('existing').onclick=()=>run('existing');$('fresh').onclick=()=>preferredProfile?launch(()=>window.desktop.profile(preferredProfile)):run('fresh');$('new-fresh').onclick=()=>run('fresh');$('copy').onclick=()=>run('copy');
$('preview').onclick=async()=>{status('正在扫描文件与 SHA-256 校验…');const p=await call(()=>window.desktop.plan());if(p){$('migration').hidden=false;$('manifest-summary').textContent=`源数据：${p.sourceData}\n共 ${p.count} 个文件，${(p.bytes/1024/1024).toFixed(1)} MiB。复制前将再次扫描并锁定数据目录。`;$('manifest-files').textContent=p.files.slice(0,200).map(f=>`${f.relative} (${f.size} bytes)`).join('\n');status('清单已就绪，尚未复制。');}};
$('restore').onclick=()=>call(()=>window.desktop.restore());$('logs').onclick=()=>call(()=>window.desktop.copyLogs());$('open-data').onclick=()=>call(()=>window.desktop.openData());
$('retry').onclick=()=>{endLoading();return launch(()=>window.desktop.retry());};
$('updates').onclick=()=>call(()=>window.desktop.openUpdates());
call(()=>window.desktop.state()).then(state=>{if(!state)return;for(const b of document.querySelectorAll('button'))b.disabled=false;$('existing').disabled=true;$('preview').disabled=true;status(latestStatus||state.status||'点击开始使用，即可创建自己的独立工作区。');preferredProfile=state.profiles.find(p=>p.id===state.currentProfileId)?.id||(state.profiles.length===1?state.profiles[0].id:null);$('fresh').textContent=state.profiles.length===1?'继续创作（工作区 1）':preferredProfile?'继续使用':state.profiles.length?'新建独立工作区':'开始使用';$('profiles').hidden=state.profiles.length<2;if(state.profiles.length>=2)state.profiles.forEach((p,index)=>{const b=document.createElement('button');b.textContent=`继续工作区 ${index+1}${p.id===preferredProfile?'（上次使用）':''}`;b.onclick=()=>launch(()=>window.desktop.profile(p.id));$('profiles').append(b);});});
