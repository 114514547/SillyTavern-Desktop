'use strict';
const assert=require('node:assert/strict'),http=require('node:http'),{once}=require('node:events');
module.exports=async function generationChecks({page,send,done}){
  let mode='normal',aborts=0;const requests=[],tokenizers=[],frontSettings=[];
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','*');
    if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
    let body='';for await(const part of req)body+=part;requests.push(JSON.parse(body));const behavior=mode;
    if(behavior==='error'){res.writeHead(429,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{message:'SYNTHETIC_PROVIDER_SECRET'}}));return;}
    res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'});res.flushHeaders();
    const chunk=(delta,finish_reason=null)=>res.write('data: '+JSON.stringify({choices:[{delta,finish_reason}]})+'\r\n\r\n');
    chunk({role:'assistant'});const timers=[];let finished=false;
    if(behavior==='hang')timers.push(setInterval(()=>res.write(': keep-alive\n\n'),50));
    else if(behavior==='partial'){timers.push(setTimeout(()=>chunk({content:'未完成的开头'}),100));timers.push(setInterval(()=>res.write(': keep-alive\n\n'),50));}
    else{
      timers.push(setTimeout(()=>chunk({reasoning_content:'SYNTHETIC_REASONING_NOT_FOR_DISPLAY'}),25));
      timers.push(setTimeout(()=>chunk({content:'你好'}),150));timers.push(setTimeout(()=>chunk({content:'，创作搭档。'}),400));
      timers.push(setTimeout(()=>{finished=true;chunk({},'stop');res.end('data: [DONE]\n\n');},1000));
    }
    res.on('close',()=>{for(const timer of timers)clearTimeout(timer);if(!finished)aborts++;});
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const count=role=>page.locator('#dw-discussion-log .mes[is_user="'+(role==='user')+'"]').count();
  const waitRequests=async n=>{const deadline=Date.now()+10000;while(requests.length<n&&Date.now()<deadline)await new Promise(r=>setTimeout(r,20));assert.ok(requests.length>=n);};
  const stop=async()=>{const start=Date.now();await page.locator('#dw-discussion-stop').click();await page.locator('#dw-discussion-retry').waitFor({timeout:2500});assert.ok(Date.now()-start<2500);assert.equal(await page.locator('#dw-discussion-send').isEnabled(),true);};
  try{
    await page.locator('#dw-viewbar [data-view="workbench"]').click();await page.locator('#dw-viewbar [data-dw-action="references"]').click();
    await page.locator('#dw-use-world').uncheck();await page.locator('#dw-use-character').uncheck();
    const previous=await page.locator('#dw-conversation').inputValue();await page.locator('#dw-new-conversation').click();await page.locator('dialog[open] .popup-input').fill('DeepSeek 连接验收');await page.locator('dialog[open] .popup-button-ok').last().click();
    await page.waitForFunction(id=>document.getElementById('dw-conversation').value!==id,previous);
    await page.evaluate(async url=>{const o=await import('/scripts/openai.js');Object.assign(o.oai_settings,{chat_completion_source:'deepseek',deepseek_model:'deepseek-flash',stream_openai:true,show_thoughts:true,openai_max_tokens:1024,reverse_proxy:url,proxy_password:'synthetic-test-key'});},'http://127.0.0.1:'+server.address().port);
    const tokenWatch=request=>{if(request.url().includes('/api/tokenizers/'))tokenizers.push(request.url());if(request.url().includes('/api/backends/chat-completions/generate')){const data=request.postDataJSON();frontSettings.push({source:data.chat_completion_source,model:data.model,stream:data.stream});}};page.on('request',tokenWatch);
    await send('你好');await page.waitForFunction(()=>!!document.querySelector('dialog[open]')||document.querySelector('.dw-discussion-pending .mes_text')?.textContent.includes('你好'),null,{timeout:10000});
    if(await page.locator('dialog[open]').count())await page.locator('dialog[open] .popup-button-ok').last().click();
    await page.waitForFunction(()=>document.querySelector('.dw-discussion-pending .mes_text')?.textContent.includes('你好'),null,{timeout:10000});await done(1);
    assert.equal(frontSettings[0].source,'deepseek');assert.equal(requests[0].model,'deepseek-flash');assert.equal(requests[0].stream,true);
    assert.ok(!tokenizers.some(url=>/model=deepseek|tokenizers\/deepseek/.test(url)));assert.ok(!(await page.locator('#dw-discussion-log').innerText()).includes('SYNTHETIC_REASONING'));
    mode='hang';const before=requests.length;await send('等待过程中测试停止');await waitRequests(before+1);await stop();assert.equal(await count('assistant'),1);
    mode='normal';await page.locator('#dw-discussion-retry').click();await done(2);assert.equal(await count('user'),2);
    mode='partial';await send('保留停止前收到的草稿');await page.waitForFunction(()=>document.querySelector('.dw-discussion-pending .mes_text')?.textContent.includes('未完成的开头'));await stop();assert.equal(await count('assistant'),3);assert.ok((await page.locator('#dw-discussion-log').innerText()).includes('未完成草稿'));
    mode='normal';await page.locator('#dw-discussion-retry').click();await done(4);assert.equal(await count('user'),3);assert.ok(!requests.at(-1).messages.some(m=>m.role==='assistant'&&m.content.includes('未完成的开头')));
    const tokenizerPattern='**/api/tokenizers/openai/count?model=gpt-4o';let release;
    const held=new Promise(r=>{release=r;});const block=async route=>{await held;await route.abort().catch(()=>{});};await page.route(tokenizerPattern,block);
    await send('整理上下文时也能立即停止');await page.waitForFunction(()=>document.querySelector('.dw-discussion-pending')?.textContent.includes('整理上下文'));await stop();release();await page.unroute(tokenizerPattern,block);
    mode='normal';await page.locator('#dw-discussion-retry').click();await done(5);assert.equal(await count('user'),4);
    mode='error';await send('测试明确的服务错误');await page.locator('#dw-discussion-retry').waitFor({timeout:10000});assert.match(await page.locator('#dw-discussion-note').innerText(),/HTTP 429/);assert.ok(!(await page.locator('#dw-discussion-note').innerText()).includes('SYNTHETIC_PROVIDER_SECRET'));
    mode='normal';await page.locator('#dw-discussion-retry').click();await done(6);assert.equal(await count('user'),5);assert.ok(aborts>=2);
    mode='partial';const originalBody=await page.locator('#dw-body').inputValue();await page.locator('[data-dw-action="continue"]').click();
    await page.waitForFunction(()=>document.getElementById('dw-generation').textContent.includes('正在接收候选稿'));
    await page.locator('[data-dw-action="stop"]').click();await page.locator('[data-dw-action="recover-candidate"]').waitFor({timeout:2500});
    assert.equal(await page.locator('#dw-body').inputValue(),originalBody);await page.locator('[data-dw-action="recover-candidate"]').click();
    assert.equal(await page.locator('dialog[open] .dw-candidate').inputValue(),'未完成的开头');await page.locator('dialog[open] .popup-button-cancel').last().click();
    await page.waitForFunction(()=>!document.querySelector('dialog[open]'));
    page.off('request',tokenWatch);await page.evaluate(()=>window.SillyTavernDesktopWriting.prepareToLeave());
    console.log('Passed: native DeepSeek parameters, incremental SSE, no DeepSeek tokenizer download, stop during preparation/network, transport abort, retained partial drafts, safe retry, HTTP errors.');
    return ['native-DeepSeek-model-and-stream-setting','incremental-SSE-with-reasoning','offline-token-budget-without-DeepSeek-download','immediate-stop-during-network-and-preparation','abort-closes-provider-connection','retain-unfinished-stream-without-prompt-contamination','retry-without-duplicate-question','redacted-specific-HTTP-error','chapter-generation-cancel-retains-candidate'];
  }finally{await page.evaluate(async()=>{const o=await import('/scripts/openai.js');o.oai_settings.reverse_proxy='';o.oai_settings.proxy_password='';}).catch(()=>{});server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
};
