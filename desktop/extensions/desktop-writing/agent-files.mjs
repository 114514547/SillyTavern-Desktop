import {WritingRequestError} from './generation.mjs';
import {AGENT_TOOL_BUDGET} from './agent-settings.mjs';

// Per-task snapshots and in-flight reads share the existing authorized bridge.
// Search and proposals are scheduled as barriers by the caller.
export function agentFiles({root,task,bridge,tools,stats,record}) {
    const files=new Map(),pending=new Map(),queries=new Map(),citations=new Map(),queue=[];
    let active=0,operations=0;
    async function limited(work){
        if(active<3)active++;else await new Promise(resolve=>queue.push(resolve));
        try{task.signal.throwIfAborted();return await work();}
        finally{if(queue.length)queue.shift()();else active--;}
    }
    async function load(path){
        if(files.has(path)){stats.cacheReuses++;return files.get(path);}
        if(pending.has(path)){stats.cacheReuses++;return pending.get(path);}
        const promise=limited(async()=>{stats.fileLoads++;return task.wait(bridge('read',{rootId:root.id,path}));});
        pending.set(path,promise);
        try{const file=await promise;files.set(path,file);files.set(file.path,file);return file;}
        finally{pending.delete(path);}
    }
    async function memo(action,args){
        const key=JSON.stringify([action,args.path||'',args.query||'']);
        if(queries.has(key)){stats.cacheReuses++;return queries.get(key);}
        const promise=action==='list'?limited(()=>task.wait(bridge(action,{rootId:root.id,...args}))):task.wait(bridge(action,{rootId:root.id,...args}),60000);
        queries.set(key,promise);
        try{return await promise;}catch(error){queries.delete(key);throw error;}
    }
    async function read(args,maxLimit=12000){
        const cached=files.has(args.path)||pending.has(args.path),file=await load(args.path);
        const requestedOffset=Math.max(0,Math.min(file.text.length,Number.isInteger(args.offset)?args.offset:0));
        const limit=Math.max(100,Math.min(maxLimit,Number.isInteger(args.limit)?args.limit:8000)),requestedEnd=Math.min(file.text.length,requestedOffset+limit);
        const citation=citations.get(file.path)||{path:file.path,revision:file.revision,ranges:[],totalCharacters:file.text.length};
        let offset=requestedOffset,end=requestedEnd;
        const duplicate=citation.ranges.some(([a,b])=>offset>=a&&end<=b);
        if(duplicate)stats.duplicateReads++;
        // Exact quotations/replacements may request the original range. Other
        // overlapping reads return the first gap, with honest source offsets.
        if(!duplicate&&!args.exact){
            for(const [a,b]of citation.ranges){if(b<=offset)continue;if(a>offset){end=Math.min(end,a);break;}offset=Math.min(end,b);}
        }
        const ranges=[...citation.ranges,[offset,end]].sort((a,b)=>a[0]-b[0]);citation.ranges=[];
        for(const range of ranges){const last=citation.ranges.at(-1);if(last&&range[0]<=last[1])last[1]=Math.max(last[1],range[1]);else citation.ranges.push([...range]);}
        citations.set(file.path,citation);
        const nextOffset=citation.ranges[0]?.[0]===0?citation.ranges[0][1]:0;
        const result={path:file.path,revision:file.revision,writable:file.writable,offset,end,nextOffset,totalCharacters:file.text.length,text:file.text.slice(offset,end),hasMore:nextOffset<file.text.length,complete:nextOffset===file.text.length,cached,duplicate,readRanges:structuredClone(citation.ranges)};
        if(offset!==requestedOffset||end!==requestedEnd)Object.assign(result,{requestedRange:[requestedOffset,requestedEnd],notice:'本次只返回请求范围中尚未覆盖的第一段；按offset/end定位，需逐字核对完整范围时使用exact=true。'});
        else if(duplicate)result.notice='此范围曾读取，本次仍返回原文以便核对或恢复压缩资料；续读请用nextOffset。';
        return result;
    }
    function reserve(name,args){
        const cost=name==='read_multiple_files'&&Array.isArray(args?.files)&&args.files.length>=1&&args.files.length<=4?args.files.length:1;
        if(operations+cost>AGENT_TOOL_BUDGET)return false;
        operations+=cost;stats.toolOperations=operations;return true;
    }
    async function execute(name,args){
        task.signal.throwIfAborted();const started=performance.now(),known=tools.some(t=>t.function.name===name),type=known?name:'unknown';stats.toolCalls++;stats.toolTypes[type]=(stats.toolTypes[type]||0)+1;
        let result,error;
        try{
            if(!root||!known)throw new WritingRequestError('当前模式不允许这个工具。');
            task.stage(name==='read_file'?'正在读取：'+String(args.path||''):name==='read_multiple_files'?'正在批量读取指定文档…':name==='search_files'?'正在搜索设定资料…':name==='list_files'?'正在查看工作区目录…':'正在生成文档修改对照…');
            if(name==='list_files')result=await memo('list',{path:args.path||''});
            else if(name==='search_files'){
                result=await memo('search',{path:args.path||'',query:args.query});
                const matches=result.results||result.matches;
                if(Array.isArray(matches)&&!matches.length)result={...result,notice:(result.limited?'本次扫描达到范围上限且未找到匹配，尚未覆盖全部目录；请缩小到子目录。':'此范围没有匹配结果；请更换关键词或根据目录定位。')+'不必重复相同搜索。'};
            }else if(name==='read_file')result=await read(args);
            else if(name==='read_multiple_files'){
                if(!Array.isArray(args.files)||!args.files.length||args.files.length>4||args.files.some(f=>!f||typeof f.path!=='string'))throw new WritingRequestError('批量读取需明确指定1～4份文件。');
                const total=Math.max(args.files.length*100,Math.min(24000,Number.isInteger(args.totalLimit)?args.totalLimit:24000)),perFile=Math.min(8000,Math.floor(total/args.files.length));
                const settled=await Promise.allSettled(args.files.map(spec=>read({...spec,limit:Math.min(perFile,Number.isInteger(spec.limit)?spec.limit:perFile)},perFile)));
                task.signal.throwIfAborted();
                const values=settled.map((item,i)=>item.status==='fulfilled'?item.value:{path:args.files[i].path,error:item.reason?.message||'读取失败'});
                result={files:values,totalCharactersReturned:values.reduce((n,f)=>n+(f.text?.length||0),0),totalLimit:total};
            }else{
                const proposal=await task.wait(bridge('propose',name==='create_file'?{rootId:root.id,path:args.path,revision:null,content:args.content}:{rootId:root.id,path:args.path,revision:args.revision,before:args.before,after:args.after}));
                result={proposalId:proposal.id,path:proposal.path,status:'pending_author_save'};
            }
            return result;
        }catch(e){error=e;throw e;}
        finally{
            const elapsedMs=Math.round(performance.now()-started);stats.toolMs+=elapsedMs;
            record({tool:name,path:args.path||'',query:args.query||'',elapsedMs,...(name==='read_file'&&result?{offset:result.offset,end:result.end,totalCharacters:result.totalCharacters,revision:result.revision,cached:result.cached,duplicate:result.duplicate}:{}),...(name==='read_multiple_files'&&result?{paths:result.files.map(f=>f.path)}:{}),...(result?.proposalId?{proposalId:result.proposalId}:{}),ok:!error,...(error?{error:String(error.message||'工具操作失败').slice(0,300)}:{})});
        }
    }
    return {citations,load,reserve,execute,get operations(){return operations;}};
}
