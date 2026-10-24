import {readFileSync,writeFileSync,renameSync} from 'node:fs';
import {cleanUsage,cleanGeneration,cleanAttempts} from './metrics.mjs';
import {cleanReasoning} from './reasoning-diagnostics.mjs';

// An explicit allowlist keeps prompt text, tool arguments and credentials out.
const fields=['clientKeepAlives','lastKeepAliveMs','usageComplete','networkRetries','networkRetryMs','id','model','status','startedAt','elapsedMs','rounds','transport','toolObserved','toolGuard','assistantTail','finishReason','errorCode','streamRequested','upstreamChunks','upstreamBytes','frames','bodyChunks','bodyChars','partialToolChunks','plainTextChunks','plainTextChars','thoughtChunks','thoughtChars','firstPlainTextMs','firstUpstreamMs','lastUpstreamMs','firstFrameMs','firstBodyMs','lastBodyMs','firstClientTextMs','phase','phaseAtMs','firstByteWaitMs','queuedMs','prepareMs','proofMs','requestSentMs','responseHeadersMs','streamingMs','upstreamHttpStatus'];
const clean=row=>{
  const result=Object.fromEntries(fields.filter(key=>['string','number','boolean'].includes(typeof row?.[key])).map(key=>[key,row[key]]));
  if(row?.generation)result.generation=cleanGeneration(row.generation);
  if(row?.reasoning)result.reasoning=cleanReasoning(row.reasoning);
  if(row?.attempts)result.attempts=cleanAttempts(row.attempts);
  const usage=cleanUsage(row?.usage);if(usage)result.usage=usage;
  if(['legacy','compact','tail-user'].includes(row?.toolPromptStyle))result.toolPromptStyle=row.toolPromptStyle;
  if(['before-headers','before-data','during-data'].includes(row?.upstreamFailurePhase))result.upstreamFailurePhase=row.upstreamFailurePhase;
  for(const key of ['upstreamFailureWaitMs','executorCloseCode'])if(Number.isSafeInteger(row?.[key])&&row[key]>=0)result[key]=row[key];
  if(typeof row?.retrySkipped==='boolean')result.retrySkipped=row.retrySkipped;
  if(['visible','hidden','prerender'].includes(row?.pageVisibility))result.pageVisibility=row.pageVisibility;
  for(const key of ['browserOnline','authRefreshed'])if(typeof row?.[key]==='boolean')result[key]=row[key];
  if(Number.isSafeInteger(row?.maxTimerGapMs)&&row.maxTimerGapMs>=0)result.maxTimerGapMs=row.maxTimerGapMs;
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
