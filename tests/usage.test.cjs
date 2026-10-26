'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const modules=Promise.all([import('../desktop/extensions/desktop-writing/generation.mjs'),import('../desktop/extensions/desktop-writing/agent-transport.mjs')]);
const event=value=>'data: '+JSON.stringify(value)+'\n\n';
const finished=text=>({choices:[{delta:{content:text},finish_reason:'stop'}]});
function stream(parts,close=true){let index=0;return new Response(new ReadableStream({pull(controller){if(index<parts.length)controller.enqueue(new TextEncoder().encode(parts[index++]));else if(close)controller.close();}}),{headers:{'content-type':'text/event-stream'}});}
test('novel drains separately delivered usage after finish_reason and stops at DONE',async()=>{
  const [{readCompletion,WritingTask}]=await modules,task=new WritingTask();
  const text=await readCompletion(stream([event(finished('正文')),event({choices:[],usage:{prompt_tokens:1000,completion_tokens:20,prompt_tokens_details:{cached_tokens:800}}}),'data: [DONE]\n\n'],false),task,{stream:true,idleMs:100});
  assert.equal(text,'正文');assert.equal(task.usage.hit,800);assert.equal(task.usage.miss,200);assert.equal(task.usage.requests,1);assert.equal(task.usage.reportedRequests,1);
});
test('finish without DONE or EOF has a bounded trailer wait and unknown usage',async()=>{
  const [{readCompletion,WritingTask}]=await modules,task=new WritingTask();
  assert.equal(await readCompletion(stream([event(finished('完成'))],false),task,{stream:true,trailerMs:15,idleMs:100}),'完成');
  assert.equal(task.usage.partial,true);assert.equal(task.usage.input,undefined);
});
test('cancelling while waiting for trailer never completes a cancelled generation',async()=>{
  const [{readCompletion,WritingTask}]=await modules,task=new WritingTask();
  const pending=readCompletion(stream([event(finished('正文'))],false),task,{stream:true,progress:()=>queueMicrotask(()=>task.cancel())});
  await assert.rejects(pending,error=>error.name==='AbortError');
});
test('Agent totals all model calls and replaces cumulative snapshots within one call',async()=>{
  const [{WritingTask},{readAgentResponse}]=await modules,task=new WritingTask();
  await readAgentResponse(stream([event({choices:[{delta:{content:'第一轮'}}],usage:{prompt_tokens:100,completion_tokens:5}}),event({choices:[],usage:{prompt_tokens:1000,completion_tokens:20,prompt_cache_hit_tokens:800,prompt_cache_miss_tokens:200}}),event({choices:[{delta:{},finish_reason:'stop'}]}),'data: [DONE]\n\n']),task,()=>{},true);
  await readAgentResponse(Response.json({choices:[{message:{content:'第二轮'},finish_reason:'stop'}],usage:{prompt_tokens:2000,completion_tokens:30,prompt_tokens_details:{cached_tokens:1600}}}),task);
  assert.equal(task.usage.input,3000);assert.equal(task.usage.output,50);assert.equal(task.usage.hit,2400);assert.equal(task.usage.miss,600);assert.equal(task.usage.requests,2);assert.equal(task.usage.reportedRequests,2);assert.equal(task.usage.partial,false);
  await readAgentResponse(Response.json({choices:[{message:{content:'无统计'},finish_reason:'stop'}]}),task);
  assert.equal(task.usage.input,3000);assert.equal(task.usage.requests,3);assert.equal(task.usage.reportedRequests,2);assert.equal(task.usage.partial,true);assert.ok(task.usage.unknownFields.includes('input'));
});
test('truncated output preserves returned usage; zero cache hits remain distinct from absent fields',async()=>{
  const [{readCompletion,WritingTask}]=await modules,task=new WritingTask();
  await assert.rejects(readCompletion(Response.json({choices:[{message:{content:'未完成'},finish_reason:'length'}],usage:{prompt_tokens:50,completion_tokens:10,prompt_tokens_details:{cached_tokens:0}}}),task),/长度上限/);
  assert.equal(task.usage.hit,0);assert.equal(task.usage.miss,50);assert.equal(task.usage.output,10);
});
