'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const modulePromise=import('../desktop/extensions/desktop-writing/generation.mjs');
const sse=text=>new Response(text,{headers:{'Content-Type':'text/event-stream'}});
test('cancel interrupts preparation and late resolution cannot complete the cancelled operation',async()=>{
  const {WritingTask}=await modulePromise;const task=new WritingTask();let resolve;
  const pending=task.wait(new Promise(r=>{resolve=r;}));task.cancel();
  await assert.rejects(pending,e=>e.name==='AbortError');resolve('late result');assert.equal(task.signal.aborted,true);
});
test('offline token budgeting is bounded and falls back conservatively without a model download',async()=>{
  const {WritingTask,createTokenCounter}=await modulePromise;let calls=0,aborted=false;
  const count=createTokenCounter({getRequestHeaders:()=>({})},new WritingTask(),{timeout:10,request:async(url,options)=>{
    assert.equal(url,'/api/tokenizers/openai/count?model=gpt-4o');calls++;options.signal.addEventListener('abort',()=>{aborted=true;});return new Promise(()=>{});
  }});
  assert.equal(await count('你好'),6);assert.equal(await count('abc'),3);assert.equal(calls,1);assert.equal(aborted,true);
});
test('SSE handles comments, split UTF-8, reasoning before content, and DONE without waiting for EOF',async()=>{
  const {WritingTask,readCompletion}=await modulePromise;const task=new WritingTask();const progress=[];let cancelled=false;
  const text=': keep-alive\r\n\r\ndata: '+JSON.stringify({choices:[{delta:{reasoning_content:'private reasoning'}}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{content:'你好，创作搭档。'}}]})+'\n\ndata: [DONE]\n\n';
  const bytes=new TextEncoder().encode(text);const body=new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=2)c.enqueue(bytes.slice(i,i+2));},cancel(){cancelled=true;}});
  const result=await readCompletion(new Response(body,{headers:{'Content-Type':'text/event-stream'}}),task,{idleMs:100,progress:(text,thinking)=>progress.push({text,thinking})});
  assert.equal(result,'你好，创作搭档。');assert.ok(progress.some(x=>x.thinking));assert.ok(!result.includes('private reasoning'));assert.equal(cancelled,true);
});
test('SSE keep-alive comments do not turn an idle request into an infinite wait',async()=>{
  const {WritingTask,readCompletion}=await modulePromise;let timer;
  const stream=new ReadableStream({start(c){timer=setInterval(()=>c.enqueue(new TextEncoder().encode(': keep-alive\n\n')),5);},cancel(){clearInterval(timer);}});
  try{await assert.rejects(readCompletion(new Response(stream,{headers:{'Content-Type':'text/event-stream'}}),new WritingTask(),{idleMs:30}),/超时|有效内容/);}finally{clearInterval(timer);}
});
test('native backend SSE without forwarded content type follows the requested stream mode',async()=>{
  const {WritingTask,readCompletion}=await modulePromise;
  const body='data: '+JSON.stringify({choices:[{delta:{content:'原生后端回复'}}]})+'\n\ndata: [DONE]\n\n';
  assert.equal(await readCompletion(new Response(body),new WritingTask(),{stream:true}),'原生后端回复');
  const json=new Response(JSON.stringify({choices:[{message:{content:'兼容 JSON 回退'}}]}),{headers:{'Content-Type':'application/json'}});
  assert.equal(await readCompletion(json,new WritingTask(),{stream:true}),'兼容 JSON 回退');
});
test('stream interruption keeps received text and never treats it as a finished response',async()=>{
  const {WritingTask,readCompletion}=await modulePromise;const task=new WritingTask();
  await assert.rejects(readCompletion(sse('data: '+JSON.stringify({choices:[{delta:{content:'未完成的开头'}}]})+'\n\n'),task),/中途断开/);
  assert.equal(task.text,'未完成的开头');
});
test('HTTP errors are specific without reflecting provider response bodies or credentials',async()=>{
  const {WritingTask,readCompletion,publicError}=await modulePromise;
  await assert.rejects(readCompletion(new Response('sk-SYNTHETIC_SECRET',{status:401}),new WritingTask()),e=>e.message.includes('401')&&!e.message.includes('SYNTHETIC_SECRET'));
  await assert.rejects(readCompletion(new Response('',{status:400,statusText:'Unauthorized'}),new WritingTask()),/401/);
  assert.ok(!publicError(new Error('sk-SYNTHETIC_SECRET')).includes('SYNTHETIC_SECRET'));
});
test('non-chat providers retain native generation but can be cancelled independently',async()=>{
  const {WritingTask,generateWriting}=await modulePromise;const task=new WritingTask();let stops=0;
  const api={mainApi:'other',generateRaw:()=>new Promise(()=>{}),stopGeneration:()=>{stops++;}};
  const waiting=generateWriting(api,{prompt:'hello'},task);task.cancel();await assert.rejects(waiting,e=>e.name==='AbortError');assert.equal(stops,1);
  let calls=0;await assert.rejects(generateWriting({...api,generateRaw:()=>{calls++;}}, {}, task),e=>e.name==='AbortError');assert.equal(calls,0);
});
