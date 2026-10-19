'use strict';
const $=id=>document.getElementById(id);
function render(s){
  $('version').textContent=`当前 ${s.currentVersion}${s.version?' · 发布 '+s.version:''}`;
  $('source').textContent='发布源：'+s.repository;
  $('message').textContent=s.message;
  const busy=['checking','downloading','installing'].includes(s.stage);
  $('check').disabled=busy;$('download').hidden=s.stage!=='available';$('install').hidden=s.stage!=='downloaded';$('cancel').hidden=s.stage!=='downloading';
  $('progress').hidden=!['downloading','downloaded'].includes(s.stage);$('progress').value=s.percent||0;
  $('notes-panel').hidden=!s.notes;$('notes').textContent=s.notes||'';
}
async function action(fn){try{const r=await fn();if(!r.ok)$('message').textContent=r.error;else if(r.value)render(r.value);}catch{$('message').textContent='更新操作未完成，请重试。';}}
window.updates.onState(render);
$('check').onclick=()=>action(()=>window.updates.check());$('download').onclick=()=>action(()=>window.updates.download());$('cancel').onclick=()=>action(()=>window.updates.cancel());$('install').onclick=()=>action(()=>window.updates.install());
action(()=>window.updates.state());
