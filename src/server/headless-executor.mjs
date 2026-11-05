import {validateRuntimeConnection} from '../../runtime-manager/src/connection.mjs';
export {validateRuntimeConnection} from '../../runtime-manager/src/connection.mjs';
import {randomUUID} from 'node:crypto';
import {ApiError} from './errors.mjs';
import {headlessRequest,headlessFrame,readRuntimeSSE} from './headless-protocol.mjs';
import {assertRuntimeReady} from './headless-operations.mjs';

// A local executor implementing the same ownership/cancellation contract as the
// userscript. No Google login material enters MMDB requests or diagnostics.
export function createHeadlessExecutor(options,receive,{fetchImpl=fetch,inspect,pool}={}){
  const connection=validateRuntimeConnection(options),jobs=new Map(),assignments=new Map();let chain=Promise.resolve(),closed=false;
  if(typeof inspect!=='function')throw Error('独立运行时缺少状态检查');
  const executor={readyState:1,protocolVersion:2,connectionId:randomUUID(),sessionRevision:0,mmdb:false,mmdbVersion:null,kind:'headless',catalogState:'unavailable',
    async status(){const {accountId,...status}=await inspect();return status;},
    finishLogicalRequest(id){assignments.delete(id);if(pool)void pool.finish(id).catch(()=>{});},
    send(raw){
      const message=JSON.parse(raw);
      if(message.type==='cancel'){jobs.get(message.requestId)?.abort();return;}
      if(message.type!=='request'||closed)return;
      if(jobs.has(message.requestId))return;
      const controller=new AbortController();jobs.set(message.requestId,controller);
      let attemptIndex=0;
      const log=(type,extra={})=>pool?.diagnostics?.record(type,{requestId:message.logicalRequestId??message.requestId,dispatchId:message.requestId,attempt:attemptIndex,stage:message.diagnosticStage,round:message.diagnosticRound,source:'mmdb',...extra});
      log('queued');
      const reply=data=>{if(!closed&&!controller.signal.aborted)receive({...data,requestId:message.requestId,logicalRequestId:message.logicalRequestId,connectionId:executor.connectionId,attemptIndex});};
      queueMicrotask(()=>reply({type:'progress',phase:'queued'}));
      chain=chain.catch(()=>{}).then(async()=>{
        if(closed||controller.signal.aborted){jobs.delete(message.requestId);return;}
        reply({type:'progress',phase:'preparing'});
        log('preparing');
        try{
          const logicalId=message.logicalRequestId??message.requestId;
          const {model,body}=headlessRequest(JSON.parse(message.requestBody));
          const tried=new Set();let retryReason;
          for(;;){
            controller.signal.throwIfAborted();let lease,count=0;
            try{
              if(pool){lease=await pool.lease({model,logicalId,preferredId:assignments.get(logicalId),excluded:tried,signal:controller.signal,dispatchId:message.requestId,attempt:attemptIndex,stage:message.diagnosticStage,retryReason});}
              else{const status=await inspect();assertRuntimeReady(status);if(assignments.has(logicalId)&&assignments.get(logicalId)!==status.accountId)throw new ApiError(409,'多阶段生成期间账号已改变，请用同一账号重新请求','headless_account_changed');lease={accountId:status.accountId,release(){}};}
              controller.signal.throwIfAborted();tried.add(lease.accountId);
              reply({type:'progress',phase:'request-sent'});
              log('request-sent',{model,accountId:lease.accountId});
              const response=await fetchImpl(`${connection.url}/v1beta/models/${model}:streamGenerateContent?alt=sse`,{method:'POST',redirect:'error',headers:{Authorization:`Bearer ${connection.apiKey}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal});
              reply({type:'progress',phase:'headers',httpStatus:response.status});
              log('headers',{httpStatus:response.status});
              await readRuntimeSSE(response,value=>{
                const frame=headlessFrame(value);assignments.set(logicalId,lease.accountId);
                if(!count){lease.verified?.();log('first-event',{accountId:lease.accountId});}
                reply({type:'stream-chunk',chunkBody:(count++?',':'[[')+JSON.stringify(frame)});
              });
              if(!count)throw new ApiError(502,'独立运行时未返回生成结果','headless_empty_response');
              log('attempt-finished');reply({type:'stream-chunk',chunkBody:']]'});reply({type:'stream-end'});break;
            }catch(error){
              const retryable=!controller.signal.aborted&&lease?.failure?await lease.failure(error):false;
              log('attempt-failed',{httpStatus:error.status,code:error.code,accountId:lease?.accountId});
              if(!retryable||count||assignments.has(logicalId)||tried.size>=16){log('retry-skipped',{reason:controller.signal.aborted?'cancelled':count?'partial-output':assignments.has(logicalId)?'continuation-bound':tried.size>=16?'attempt-limit':'not-safe-to-replay'});throw error;}
              retryReason=lease.failureReason;
              attemptIndex++;reply({type:'progress',phase:'account-switch'});
            }finally{lease?.release();}
          }
        }catch(error){
          reply({type:'error',status:error instanceof ApiError?error.status:502,error:{code:error instanceof ApiError?error.code:'headless_connection_failed',message:error instanceof ApiError?error.message:'独立运行时连接中断或未启动，请检查本地运行时状态',...(Number.isFinite(error.retryAt)?{retryAt:error.retryAt}:{})}});
        }finally{jobs.delete(message.requestId);}
      });
    },
    close(){closed=true;executor.readyState=3;for(const controller of jobs.values())controller.abort();jobs.clear();assignments.clear();}
  };
  return executor;
}
