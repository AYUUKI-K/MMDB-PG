import {readFileSync,writeFileSync,renameSync} from 'node:fs';
import {cleanUsage,cleanGeneration,cleanAttempts,cleanRequestCounts} from './metrics.mjs';

// An explicit allowlist keeps prompt text, tool arguments and credentials out.
const fields=['clientKeepAlives','lastKeepAliveMs','usageComplete','networkRetries','networkRetryMs','id','model','status','startedAt','elapsedMs','rounds','transport','toolObserved','toolGuard','assistantTail','finishReason','errorCode','streamRequested','upstreamChunks','upstreamBytes','frames','bodyChunks','bodyChars','partialToolChunks','plainTextChunks','plainTextChars','thoughtChunks','thoughtChars','firstPlainTextMs','firstUpstreamMs','lastUpstreamMs','firstFrameMs','firstBodyMs','lastBodyMs','firstClientTextMs','phase','phaseAtMs','firstByteWaitMs','queuedMs','prepareMs','proofMs','requestSentMs','responseHeadersMs','streamingMs','upstreamHttpStatus'];
const clean=row=>{
  const result=Object.fromEntries(fields.filter(key=>['string','number','boolean'].includes(typeof row?.[key])).map(key=>[key,row[key]]));
  if(row?.generation)result.generation=cleanGeneration(row.generation);
  if(row?.attempts)result.attempts=cleanAttempts(row.attempts);
  const requests=cleanRequestCounts(row?.requestCounts);if(requests)result.requestCounts=requests;
  if(['off','real','synthetic','external'].includes(row?.inputReadMode))result.inputReadMode=row.inputReadMode;
  const identity=row?.modelIdentity;
  const modelName=value=>typeof value==='string'&&value.length<=160&&/^(?:models\/)?(?:pg-)?[a-zA-Z0-9._-]+(?:-抗截断)?$/.test(value);
  if(identity?.verification==='unavailable'&&modelName(identity.requested)&&modelName(identity.sent))result.modelIdentity={requested:identity.requested,sent:identity.sent,reported:null,verification:'unavailable'};
  const usage=cleanUsage(row?.usage);if(usage)result.usage=usage;
  if(['legacy','compact'].includes(row?.toolPromptStyle))result.toolPromptStyle=row.toolPromptStyle;
  if(['none','prompt','native'].includes(row?.continuationMode))result.continuationMode=row.continuationMode;
  for(const key of ['inputReadEnabled','inputReadCompleted'])if(typeof row?.[key]==='boolean')result[key]=row[key];
  if(Number.isSafeInteger(row?.inputReadCalls)&&row.inputReadCalls>=0&&row.inputReadCalls<=1)result.inputReadCalls=row.inputReadCalls;
  for(const key of ['continuationOverlapChars','continuationRemainingTokens'])if(Number.isSafeInteger(row?.[key])&&row[key]>=0)result[key]=row[key];
  if(['output_budget','unknown_usage','max_rounds'].includes(row?.continuationStop))result.continuationStop=row.continuationStop;
  return result;
};
export function diagnosticHistory(file) {
  let recent=[];
  if(file)try { const raw=readFileSync(file,'utf8');if(raw.length<512*1024){const data=JSON.parse(raw);if(Array.isArray(data))recent=data.slice(0,50).map(clean);} } catch {}
  return {recent,add(row){
    recent.unshift(clean(row));recent.length=Math.min(recent.length,50);
    if(file)try{writeFileSync(file+'.tmp',JSON.stringify(recent),'utf8');renameSync(file+'.tmp',file);}catch{console.warn('MMDB: unable to save diagnostic metadata.');}
  }};
}
