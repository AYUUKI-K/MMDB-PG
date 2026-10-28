import {randomUUID} from 'node:crypto';
import {ApiError,FrameParser,toWire,normalizeModel} from './protocol.mjs';
import {envelopePayload,ANSWER_TOOL} from './anti-truncation.mjs';

export const probeNames=['tool-auto','tool-any','tool-none','argument-stream','native-continuation'];
export function probePayload(model,experiment) {
  if(!probeNames.includes(experiment))throw new ApiError(400,'未知实验类型');
  const prompt=experiment==='tool-auto'||experiment==='tool-any'?'Reply with exactly PROBE_PLAIN as plain text. Do not call a function.':experiment==='argument-stream'?'Call mmdb_emit_answer once. Set content to 100 numbered lines of a short original story about a cat exploring a garden. Each line must have at least 12 words. Return no ordinary text.':'Call mmdb_emit_answer once with content set to PROBE_TOOL. Return no ordinary text.';
  const body={contents:[{role:'user',parts:[{text:prompt}]}],generationConfig:{temperature:0,maxOutputTokens:experiment==='argument-stream'?4096:1024}};
  const payload=toWire(model,body),declaration=envelopePayload(model,body).wire[6];
  declaration[0][1][0][1]='Submit answer text when a function call is needed.';
  payload.wire[6]=declaration;
  // Hypothesis only: PG field 14/1 is retrieval config, so field 14/2 is
  // tested as function config. Never infer support from HTTP 200 alone.
  if(experiment==='tool-any')payload.wire[13][1]=[2,[ANSWER_TOOL]];
  if(experiment==='tool-none')payload.wire[13][1]=[3];
  if(experiment==='argument-stream')payload.wire[13][1]=[1,null,null,true];
  if(experiment==='native-continuation'){
    while(payload.wire[3].length<46)payload.wire[3].push(null);
    payload.wire[3][45]=1;payload.wire[10]=null;
  }
  return payload;
}

// Fixed synthetic prompts only. No raw-wire endpoint, cookies, signatures,
// tokens, user prompts or generated bodies are returned or retained here.
export function runExperimentProbe({body,owner,pending,send,res,models,timeoutMs=180000,onChange=()=>{},onRequest=()=>{}}) {
  if(!owner)throw new ApiError(503,'请先连接已就绪的 Playground 执行器','executor_offline');
  if(pending.size||owner.probeActive)throw new ApiError(409,'请等待当前请求结束后再验证实验能力','experiment_busy');
  const model=normalizeModel(body.model),experiment=body.experiment;
  if(!models.includes(model))throw new ApiError(400,'请选择已配置的模型');
  const payload=probePayload(model,experiment),id=randomUUID(),started=Date.now();
  const result={model,experiment,upstreamRequests:0,chunks:0,frames:0,toolFrames:0,argumentFrames:0,partialFrames:0,plainChars:0,argumentSizes:[],extraCallSlots:[]};
  const observeRequest=()=>{if(!result.upstreamRequests){result.upstreamRequests=1;onRequest();}};
  let ended=false,timer;
  const sendTask=message=>send(owner,{...message,requestId:id,logicalRequestId:id,connectionId:owner.connectionId,attemptIndex:0});
  return new Promise((resolve,reject)=>{
    const complete=error=>{
      if(ended)return;ended=true;clearTimeout(timer);pending.delete(id);owner.probeActive=false;onChange();
      if(error)sendTask({type:'cancel'});
      sendTask({type:'settled',status:error?'failed':'finished',experiment,elapsedMs:Date.now()-started,message:error?.message});
      if(error?.status===499){reject(error);return;}
      resolve({...result,elapsedMs:Date.now()-started,outcome:error?'failed':'completed',...(error?{errorCode:error.code??'probe_failed',message:error.message.slice(0,500)}:{})});
    };
    const parser=new FrameParser(frame=>{
      result.frames++;
      const c=frame?.[0]?.[0];if(c?.[1])result.finishCode=c[1];if(c?.[8])result.continuationTokenObserved=true;
      for(const p of c?.[0]?.[0]??[]){
        if(typeof p?.[1]==='string'&&!p[12])result.plainChars+=p[1].length;
        const call=p?.[10];if(!Array.isArray(call))continue;
        result.toolFrames++;result.firstToolMs??=Date.now()-started;
        if(call[1]!=null){result.argumentFrames++;result.firstArgumentsMs??=Date.now()-started;if(result.argumentSizes.length<32)result.argumentSizes.push(JSON.stringify(call[1]).length);}
        if(call[3]!=null){result.partialFrames++;result.firstPartialMs??=Date.now()-started;}
        for(let i=3;i<call.length;i++)if(call[i]!=null&&!result.extraCallSlots.includes(i))result.extraCallSlots.push(i);
      }
    });
    owner.probeActive=true;
    pending.set(id,{owner,abort:complete,diagnostics:()=>({experiment,model,elapsedMs:Date.now()-started}),handle(msg){
      if(ended)return;
      if(owner.protocolVersion===2&&(msg.connectionId!==owner.connectionId||msg.logicalRequestId!==id||msg.attemptIndex!==0))return;
      try{
        if(msg.type==='error')return complete(new ApiError(msg.status??502,msg.error?.message??'实验请求失败',msg.error?.code));
        if(msg.type==='progress'&&['request-sent','headers','streaming'].includes(msg.phase))observeRequest();
        if(msg.type==='progress'&&msg.phase==='headers')result.httpStatus=msg.httpStatus;
        if(msg.type==='stream-chunk'||msg.type==='response'){
          const raw=msg.chunkBody??msg.rawResponse;if(typeof raw!=='string')throw new ApiError(502,'实验响应格式无效');
          if(raw.length)observeRequest();result.chunks++;result.firstDataMs??=Date.now()-started;parser.push(raw);
        }
        if(msg.type==='stream-end'||msg.type==='response'){
          parser.end();if(!result.finishCode)throw new ApiError(502,'实验响应缺少完成状态','probe_incomplete');
          if(![1,2,22].includes(result.finishCode))throw new ApiError(502,`实验响应未正常完成（${result.finishCode}）`,'upstream_generation_failed');
          complete();
        }
      }catch(error){complete(error);}
    }});
    onChange();timer=setTimeout(()=>complete(new ApiError(504,'实验请求等待超时','probe_timeout')),timeoutMs);
    res.on('close',()=>{if(!res.writableEnded)complete(new ApiError(499,'实验验证已取消','cancelled'));});
    sendTask({type:'request',model,experiment,allowNetworkRetry:false,elapsedMs:0,stream:true,requestBody:JSON.stringify(payload)});
  });
}
