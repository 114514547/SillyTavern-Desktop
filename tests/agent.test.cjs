'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const modules = Promise.all([import('../desktop/extensions/desktop-writing/agent-loop.mjs'), import('../desktop/extensions/desktop-writing/agent-transport.mjs'), import('../desktop/extensions/desktop-writing/generation.mjs')]);
test('capacity trimming drops the oldest turn while preserving a recent complete turn',async()=>{const[{fitAgentMessages}]=await modules;const messages=[{role:'system',content:'core'},{role:'user',content:'old'.repeat(500)},{role:'assistant',content:'old reply'},{role:'user',content:'recent question'},{role:'assistant',content:'recent answer'},{role:'user',content:'current'}];const result=await fitAgentMessages(messages,[],s=>s.length,230);assert.ok(result.some(m=>m.content==='recent answer'));assert.ok(!result.some(m=>m.content==='old reply'));assert.equal(result.at(-1).content,'current');});
test('long discussion keeps more than four completed pairs while budget allows',async()=>{const [{runAgent},,{WritingTask}]=await modules;const history=[];for(let i=0;i<7;i++)history.push({role:'user',text:'问题'+i},{role:'assistant',text:'回答'+i});history.push({role:'user',text:'当前问题'});const task=new WritingTask();await runAgent({history,root:null,task,count:s=>s.length/4,budget:10000,complete:async messages=>{assert.equal(messages.filter(m=>m.role==='user').length,8);return{content:'完成'};}});assert.deepEqual(task.historyInfo,{kept:7,total:7});});
test('usage after the final streamed content is retained without becoming prose',async()=>{const[,{readAgentResponse},{WritingTask}]=await modules;const text=[{choices:[{delta:{content:'正文'},finish_reason:'stop'}]},{choices:[],usage:{prompt_tokens:1000,completion_tokens:20,prompt_cache_hit_tokens:800,prompt_cache_miss_tokens:200}}].map(x=>'data: '+JSON.stringify(x)+'\n\n').join('')+'data: [DONE]\n\n';const task=new WritingTask();const result=await readAgentResponse(new Response(text,{headers:{'content-type':'text/event-stream'}}),task,()=>{},true);assert.equal(result.content,'正文');assert.equal(task.usage.hit,800);});
test('agent discovers and reads files before replying; write tools absent in discussion mode', async () => {
  const [{ runAgent }, , { WritingTask }] = await modules; const calls = [], requests = []; let turn = 0;
  const result = await runAgent({ history: [{ role: 'user', text: '根据设定分析动机' }], root: { id: 'root', name: '系列' }, task: new WritingTask(), count: text => text.length / 4, budget: 4000,
    bridge: async (name, args) => { calls.push({ name, args }); return name === 'list' ? { entries: [{ path: '角色.md', type: 'file' }] } : { path: '角色.md', text: '她保护线人', revision: 'sha', writable: true }; },
    complete: async (messages, tools) => { requests.push(messages); assert.ok(!tools.some(t => t.function.name === 'propose_edit')); turn++; return turn < 3 ? { role: 'assistant', content: '', tool_calls: [{ id: 'call-' + turn, type: 'function', function: { name: turn === 1 ? 'list_files' : 'read_file', arguments: JSON.stringify(turn === 1 ? { path: '' } : { path: '角色.md', offset: 0, limit: 100 }) } }] } : { role: 'assistant', content: '她的动机是保护线人。' }; } });
  assert.equal(result.text, '她的动机是保护线人。'); assert.deepEqual(calls.map(c => c.name), ['list', 'read']); assert.equal(result.citations[0].revision, 'sha'); assert.ok(requests[2].some(m => m.role === 'tool' && m.content.includes('保护线人')));
});
test('proposed edits only reach proposal API; no apply/delete/command tool exists', async () => {
  const [{ runAgent, agentTools }, , { WritingTask }] = await modules; const operations = []; let turn = 0;
  const result = await runAgent({ history: [{ role: 'user', text: '修改设定' }], root: { id: 'selected-root', name: '系列' }, writable: true, task: new WritingTask(), count: s => s.length / 4, budget: 4000,
    bridge: async (action, args) => { operations.push({ action, args }); return { id: 'proposal-id', path: args.path }; },
    complete: async () => ++turn === 1 ? { role: 'assistant', content: '', tool_calls: [{ id: 'p1', type: 'function', function: { name: 'propose_edit', arguments: JSON.stringify({ path: '人物.md', revision: 'sha', before: '原文', after: '建议' }) } }] } : { role: 'assistant', content: '建议已生成，等待保存。' } });
  assert.deepEqual(operations.map(o => o.action), ['propose']); assert.equal(operations[0].args.rootId, 'selected-root'); assert.equal(result.records[0].proposalId, 'proposal-id'); assert.ok(agentTools(true).every(t => !/apply|delete|exec/.test(t.function.name)));
});
test('no-folder discussion has no tools; cancellation prevents subsequent file operations', async () => {
  const [{ runAgent }, , { WritingTask }] = await modules; const task = new WritingTask(); let called = 0;
  await assert.rejects(runAgent({ history: [{ role: 'user', text: 'hello' }], root: null, task, count: s => s.length / 4, budget: 4000, bridge: async () => { called++; }, complete: async (_messages, tools) => { assert.equal(tools.length, 0); task.cancel(); return { role: 'assistant', content: 'late' }; } }), e => e.name === 'AbortError'); assert.equal(called, 0);
});
test('context trimming keeps tool pairings and current user; oversized mandatory input fails clearly', async () => {
  const [{ fitAgentMessages }] = await modules; const input = [{ role: 'system', content: 'instructions' }, { role: 'user', content: 'old'.repeat(2000) }, { role: 'assistant', content: 'old' }, { role: 'user', content: 'current' }, { role: 'assistant', tool_calls: [{ id: 'x' }] }, { role: 'tool', tool_call_id: 'x', content: 'document'.repeat(2000) }];
  const fitted = await fitAgentMessages(input, [], s => s.length, 1100); assert.equal(fitted[1].content, 'current'); assert.equal(fitted[2].tool_calls[0].id, fitted[3].tool_call_id); await assert.rejects(fitAgentMessages([{ role: 'system', content: 'system' }, { role: 'user', content: 'huge'.repeat(2000) }], [], s => s.length, 1000), /上下文/);
});
test('streamed tools reassemble arguments; reasoning retained for provider but not returned as user prose', async () => {
  const [, { readAgentResponse }, { WritingTask }] = await modules; const chunks = [': keep-alive\n\n', 'data: ' + JSON.stringify({ choices: [{ delta: { reasoning_content: 'private reasoning' } }] }) + '\n\n', 'data: ' + JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-1', function: { name: 'read_file', arguments: '{"path":' } }] } }] }) + '\n\n', 'data: ' + JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"人物.md"}' } }] }, finish_reason: 'tool_calls' }] }) + '\n\n'];
  const response = new Response(new ReadableStream({ start(controller) { const all = new TextEncoder().encode(chunks.join('')); for (let i = 0; i < all.length; i += 7) controller.enqueue(all.slice(i, i + 7)); controller.close(); } }));
  const answer = await readAgentResponse(response, new WritingTask(), () => {}, true); assert.equal(answer.tool_calls[0].function.name, 'read_file'); assert.equal(JSON.parse(answer.tool_calls[0].function.arguments).path, '人物.md'); assert.equal(answer.content, ''); assert.equal(answer.reasoning_content, 'private reasoning');
});
test('transport rejects interrupted/truncated tools and redacts upstream errors', async () => {
  const [, { readAgentResponse }, { WritingTask }] = await modules;
  await assert.rejects(readAgentResponse(new Response(JSON.stringify({ choices: [{ message: { content: '', tool_calls: [] }, finish_reason: 'length' }] }), { headers: { 'content-type': 'application/json' } }), new WritingTask()), /长度上限/);
  await assert.rejects(readAgentResponse(new Response('SECRET-UPSTREAM', { status: 429 }), new WritingTask()), e => e.message.includes('429') && !e.message.includes('SECRET'));
  await assert.rejects(readAgentResponse(new Response('data: {"choices":[{"delta":{"content":"部分"}}]}\n\n'), new WritingTask(), () => {}, true), /中途断开/);
});

test('long Chinese document is read once as a snapshot; repeated ranges are skipped and force a final answer', async () => {
  const [{ runAgent }, , { WritingTask }] = await modules; let reads = 0, turns = 0; const document = '设定内容与具体动机。'.repeat(637).slice(0,6364);
  const result = await runAgent({ history:[{role:'user',text:'了解设定'}],root:{id:'root',name:'series'},task:new WritingTask(),count:s=>s.length,budget:30000,
    bridge: async () => { reads++; return {path:'设定.md',text:document,revision:'sha',writable:true}; },
    complete: async (messages,tools) => { turns++; if (!tools.length) { assert.ok(messages.some(m=>m.role==='tool'&&JSON.parse(m.content).text===document));return {role:'assistant',content:'已读主设定；其他章节尚未读取。'}; } return {role:'assistant',content:'',tool_calls:[{id:'r'+turns,function:{name:'read_file',arguments:JSON.stringify({path:'设定.md',offset:0,limit:8000})}}]}; }
  });
  assert.equal(reads,1);assert.equal(turns,4);assert.equal(result.records[0].end,6364);assert.equal(result.records[1].duplicate,true);assert.equal(result.citations[0].ranges[0][1],6364);assert.match(result.text,/尚未读取/);
});

test('pagination gives exact continuation offset and no text is lost or read from disk twice', async () => {
 const [{runAgent}, , {WritingTask}]=await modules;let turns=0,reads=0;const chunks=[];const document='世界规则。'.repeat(2500);
 const result=await runAgent({history:[{role:'user',text:'阅读全文'}],root:{id:'r',name:'series'},task:new WritingTask(),count:s=>s.length,budget:35000,
 bridge:async()=>{reads++;return {path:'长文.md',text:document,revision:'v1'};},complete:async(messages)=>{turns++;const last=messages.filter(m=>m.role==='tool').at(-1);if(last){const r=JSON.parse(last.content);chunks.push(r.text);if(!r.hasMore)return {role:'assistant',content:'全文已读'};}return {role:'assistant',tool_calls:[{id:'c'+turns,function:{name:'read_file',arguments:JSON.stringify({path:'长文.md',offset:last?JSON.parse(last.content).nextOffset:0,limit:8000})}}]};}});
 assert.equal(chunks.join(''),document);assert.equal(reads,1);assert.deepEqual(result.citations[0].ranges,[[0,document.length]]);assert.equal(result.records[1].offset,8000);
});

test('context packing preserves valid JSON, revision and ranges while explicitly marking omitted text', async()=>{
 const [{fitAgentMessages}]=await modules;const fitted=await fitAgentMessages([{role:'system',content:'s'},{role:'user',content:'u'},{role:'assistant',tool_calls:[{id:'c'}]},{role:'tool',tool_call_id:'c',content:JSON.stringify({path:'设定.md',revision:'sha',offset:0,end:6364,totalCharacters:6364,hasMore:false,text:'中'.repeat(6364)})}],[],s=>s.length,1800);
 const result=JSON.parse(fitted.at(-1).content);assert.equal(result.revision,'sha');assert.equal(result.contextTruncated,true);assert.deepEqual(result.retainedRanges,[[0,256],[6108,6364]]);assert.equal(fitted.at(-2).tool_calls[0].id,fitted.at(-1).tool_call_id);
});

test('Agent reserves room for output independently of the roleplay limit and clamps unsafe values', async()=>{
 const {agentLimits}=await import('../desktop/extensions/desktop-writing/agent-settings.mjs');assert.deepEqual(agentLimits(),{context:32768,output:4096,input:25344});assert.equal(agentLimits({context:8192,output:16384}).output,4096);assert.equal(agentLimits({context:0,output:NaN}).output,4096);assert.ok(agentLimits().input+agentLimits().output<agentLimits().context);
});

test('malformed tool arguments consume the bounded budget and still leave room for a final reply',async()=>{
 const [{runAgent}, ,{WritingTask}]=await modules;let turns=0,operations=0;
 const result=await runAgent({history:[{role:'user',text:'核对设定'}],root:{id:'r',name:'series'},task:new WritingTask(),count:s=>s.length/4,budget:16000,bridge:async()=>{operations++;},complete:async(_messages,tools)=>{turns++;return tools.length?{role:'assistant',tool_calls:Array.from({length:8},(_,n)=>({id:turns+'-'+n,function:{name:'read_file',arguments:'incomplete JSON'}}))}:{role:'assistant',content:'工具参数错误，无法核对资料。'};}});
 assert.equal(operations,0);assert.equal(turns,5);assert.equal(result.records.length,32);assert.match(result.text,/无法核对/);
});

test('failed or cancelled old requests do not become pending instructions in the next turn',async()=>{
 const [{runAgent}, ,{WritingTask}]=await modules;const history=[{role:'user',text:'已完成的问题'},{role:'assistant',text:'已确认的结论'},{role:'user',text:'旧任务：读完整个文件夹'},{role:'assistant',text:'失败的中间话',incomplete:true},{role:'user',text:'另一个被停止的任务'},{role:'user',text:'你好，介绍你自己'}];
 await runAgent({history,root:null,task:new WritingTask(),count:s=>s.length,budget:4000,complete:async(messages)=>{assert.deepEqual(messages.slice(1).map(m=>m.content),['已完成的问题','已确认的结论','你好，介绍你自己']);return {role:'assistant',content:'我是设定助手。'};}});assert.equal(history.length,6,'visible history is preserved');
});
