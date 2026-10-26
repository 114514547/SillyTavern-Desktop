'use strict';
// Offline acceptance: real file I/O and Agent loop, deterministic model stub. No API/network.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {LocalWorkspace}=require('../desktop/services/local-workspace.cjs');
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
(async()=>{
 if(!process.argv[2])throw new Error('Pass the explicitly authorized document folder.');
 const folder=path.resolve(process.argv[2]),output=path.resolve(__dirname,'../test-results'),home=path.join(output,'readonly-folder-check-'+Date.now());
 const before=new Map();for(const e of await fs.readdir(folder,{withFileTypes:true}))if(e.isFile()&&/\.(md|txt)$/i.test(e.name))before.set(e.name,digest(await fs.readFile(path.join(folder,e.name))));
 const service=new LocalWorkspace({home});const root=await service.connect(folder);
 const {runAgent}=await import('../desktop/extensions/desktop-writing/agent-loop.mjs');const {WritingTask}=await import('../desktop/extensions/desktop-writing/generation.mjs');const {agentLimits}=await import('../desktop/extensions/desktop-writing/agent-settings.mjs');
 let turns=0,diskReads=0;const received=new Set(),collected=new Map();
 const answer=await runAgent({history:[{role:'user',text:'读取目录中的文档，核对阅读范围。'}],root,task:new WritingTask(),budget:agentLimits().input,count:s=>s.length,
 bridge:async(action,args)=>{assert.ok(['list','read'].includes(action));if(action==='read')diskReads++;return service[action](args);},
 complete:async(messages,tools)=>{
  turns++;for(const m of messages.filter(m=>m.role==='tool')){const r=JSON.parse(m.content);if(r.text&&!r.contextTruncated){const ranges=collected.get(r.path)||new Map();ranges.set(r.offset,r.text);collected.set(r.path,ranges);if(r.end===r.totalCharacters&&r.offset===0)received.add(r.path);}}
  const missing=[...before.keys()].find(name=>!received.has(name));if(!missing||!tools.length)return {role:'assistant',content:'本地读取范围核对完成；这是离线测试，不是模型理解质量评估。'};
  return {role:'assistant',content:'继续核对下一份资料。',tool_calls:[{id:'offline-'+turns,function:{name:'read_file',arguments:JSON.stringify({path:missing,offset:0,limit:12000})}}]};
 }});
 assert.equal(received.size,before.size);assert.equal(diskReads,before.size);
 let characters=0;for(const [name,hash]of before){const bytes=await fs.readFile(path.join(folder,name));assert.equal(digest(bytes),hash);const read=[...collected.get(name).values()][0];assert.equal(read,bytes.toString('utf8').replace(/\r\n/g,'\n'));characters+=read.length;}
 const result={date:new Date().toISOString(),scope:'authorized-folder-readonly-offline-loop-not-live-model',files:before.size,characters,diskReads,modelStubRounds:turns,records:answer.records.length,originalHashesUnchanged:true,networkRequests:0,passed:true};await fs.writeFile(path.join(output,'agent-folder-check.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
