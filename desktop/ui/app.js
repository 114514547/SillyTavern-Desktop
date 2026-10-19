'use strict';
const $=id=>document.getElementById(id);
let selected=false;
function status(s){$('status').textContent=s;}
window.desktop.onStatus(status);
async function call(fn){try{const r=await fn();if(!r.ok){status(r.error);return null;}return r.value;}catch{status('桌面操作失败，请重试或复制诊断状态。');return null;}}
function selection(i){if(!i)return;selected=true;$('selected').textContent=i.root;$('source-info').textContent=`${i.version} · ${i.mode} | 配置：${i.configPath} | 数据：${i.dataRoot}`;$('existing').disabled=false;$('preview').disabled=false;$('migration').hidden=true;status(i.remoteWasEnabled?'原配置允许远程连接；桌面模式将仅监听本机，不修改原网络配置。':'安装识别完成。请确认原酒馆已关闭。');}
$('choose').onclick=async()=>selection(await call(()=>window.desktop.choose()));
$('inspect').onclick=async()=>selection(await call(()=>window.desktop.inspect({mode:$('mode').value,configPath:$('configPath').value,dataRoot:$('dataRoot').value})));
$('mode').onchange=()=>{$('configPath').disabled=$('mode').value==='global';$('dataRoot').disabled=$('mode').value==='global';$('existing').disabled=true;$('preview').disabled=true;status('启动方式已改变，请点击重新识别路径。');};
for(const id of ['configPath','dataRoot'])$(id).oninput=()=>{$('existing').disabled=true;$('preview').disabled=true;};
async function run(mode){for(const b of document.querySelectorAll('button'))b.disabled=true;const result=await call(()=>window.desktop.run(mode));if(result?.migration)status(`副本已创建并校验：${result.migration.count} 个文件。`);for(const b of document.querySelectorAll('button'))b.disabled=false;$('existing').disabled=!selected;$('preview').disabled=!selected;}
$('existing').onclick=()=>run('existing');$('fresh').onclick=()=>run('fresh');$('copy').onclick=()=>run('copy');
$('preview').onclick=async()=>{status('正在扫描文件与 SHA-256 校验…');const p=await call(()=>window.desktop.plan());if(p){$('migration').hidden=false;$('manifest-summary').textContent=`源数据：${p.sourceData}\n共 ${p.count} 个文件，${(p.bytes/1024/1024).toFixed(1)} MiB。复制前将再次扫描并锁定数据目录。`;$('manifest-files').textContent=p.files.slice(0,200).map(f=>`${f.relative} (${f.size} bytes)`).join('\n');status('清单已就绪，尚未复制。');}};
$('restore').onclick=()=>call(()=>window.desktop.restore());$('logs').onclick=()=>call(()=>window.desktop.copyLogs());$('open-data').onclick=()=>call(()=>window.desktop.openData());
$('retry').onclick=()=>call(()=>window.desktop.retry());
$('updates').onclick=()=>call(()=>window.desktop.openUpdates());
call(()=>window.desktop.state()).then(state=>{if(!state)return;status(state.status||'选择原有安装，或创建独立配置。');for(const i of state.candidates){const b=document.createElement('button');b.textContent=`发现 ${i.version}：${i.root}`;b.onclick=async()=>selection(await call(()=>window.desktop.inspect({root:i.root,mode:'standalone'})));$('candidates').append(b);}for(const p of state.profiles){const b=document.createElement('button');b.textContent=`继续独立配置 ${p.id.slice(0,8)} · ${p.version}`;b.onclick=()=>call(()=>window.desktop.profile(p.id));$('profiles').append(b);}});
