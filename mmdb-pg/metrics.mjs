// Performance metadata only. Never retain request text or raw provider events.
export const phaseFields={'network-retry':'networkRetryMs',queued:'queuedMs',preparing:'prepareMs',proof:'proofMs','request-sent':'requestSentMs',headers:'responseHeadersMs',streaming:'streamingMs'};
const usageSlots={promptTokenCount:0,candidatesTokenCount:1,totalTokenCount:2,thoughtsTokenCount:9};
const count=value=>Number.isSafeInteger(value)&&value>=0;
export function cleanUsage(value) {
  const result=Object.fromEntries(Object.keys(usageSlots).filter(key=>count(value?.[key])).map(key=>[key,value[key]]));
  return Object.keys(result).length?result:undefined;
}
export function readUsage(wire) {
  return Array.isArray(wire)?cleanUsage(Object.fromEntries(Object.entries(usageSlots).map(([key,index])=>[key,wire[index]]))):undefined;
}
export function cleanGeneration(value) {
  const result={};
  for(const key of ['temperature','topP','topK','maxOutputTokens']){
    if(value?.[key]==='provider-default'||(Number.isFinite(value?.[key])&&value[key]>=0))result[key]=value[key];
  }
  if(typeof value?.thinkingConfigSent==='boolean')result.thinkingConfigSent=value.thinkingConfigSent;
  if(typeof value?.includeThoughts==='boolean')result.includeThoughts=value.includeThoughts;
  if(['low','medium','high','provider-default'].includes(value?.thinkingLevel))result.thinkingLevel=value.thinkingLevel;
  return result;
}
export function generationSummary(payload) {
  const wire=payload.wire[3];
  const thinking=wire?.[16];
  return cleanGeneration({temperature:wire?.[4]??'provider-default',topP:wire?.[5]??'provider-default',topK:wire?.[6]??'provider-default',maxOutputTokens:wire?.[3]??'provider-default',thinkingConfigSent:thinking!=null,
    ...(thinking?{includeThoughts:!!thinking[0],thinkingLevel:({1:'low',2:'medium',3:'high'})[thinking[3]]??'provider-default'}:{})});
}
const timeFields=['startedMs','endedMs','elapsedMs','queuedMs','prepareMs','proofMs','requestSentMs','responseHeadersMs','streamingMs','firstUpstreamMs','lastUpstreamMs','firstBodyMs','lastBodyMs','bodyChars'];
export function cleanAttempts(rows) {
  if(!Array.isArray(rows))return [];
  return rows.slice(0,8).map(row=>{
    const result={};
    for(const key of ['index','round',...timeFields])if(count(row?.[key]))result[key]=row[key];
    if(['initial','continuation','network-retry'].includes(row?.reason))result.reason=row.reason;
    if(['running','finished','failed','cancelled','connection-failed','continued'].includes(row?.status))result.status=row.status;
    if(Number.isInteger(row?.httpStatus)&&row.httpStatus>=100&&row.httpStatus<=599)result.httpStatus=row.httpStatus;
    if(/^[A-Z0-9_]{1,48}$/.test(row?.finishReason??''))result.finishReason=row.finishReason;
    const usage=cleanUsage(row?.usage);if(usage)result.usage=usage;
    return result;
  });
}
export class AttemptTrace {
  constructor(){this.rows=[];}
  begin(ms,round,reason){this.rows.push({index:this.rows.length+1,round,reason,startedMs:ms,status:'running',bodyChars:0});}
  get current(){return this.rows.at(-1);}
  end(status,ms){const row=this.current;if(!row||row.endedMs!==undefined)return;Object.assign(row,{status,endedMs:ms,elapsedMs:Math.max(0,ms-row.startedMs)});}
  phase(phase,ms,httpStatus){
    if(phase==='network-retry'){const round=this.current.round;this.end('connection-failed',ms);this.begin(ms,round,'network-retry');return;}
    const key=phaseFields[phase];if(key)this.current[key]??=ms;
    if(phase==='headers'&&Number.isInteger(httpStatus)&&httpStatus>=100&&httpStatus<=599)this.current.httpStatus=httpStatus;
  }
  data(ms){this.current.firstUpstreamMs??=ms;this.current.lastUpstreamMs=ms;}
  body(chars,ms){this.current.firstBodyMs??=ms;this.current.lastBodyMs=ms;this.current.bodyChars+=chars;}
  frame(usage,reason){if(usage)this.current.usage={...this.current.usage,...cleanUsage(usage)};if(reason)this.current.finishReason=reason;}
  snapshot(){
    const attempts=cleanAttempts(this.rows);
    // Totals exist only when every attempt reported that counter. Unknown is omitted.
    const usage={};
    for(const key of Object.keys(usageSlots))if(attempts.length&&attempts.every(row=>count(row.usage?.[key])))usage[key]=attempts.reduce((sum,row)=>sum+row.usage[key],0);
    return {attempts,...(Object.keys(usage).length?{usage}:{}),usageComplete:attempts.length>0&&attempts.every(row=>Object.keys(usageSlots).every(key=>count(row.usage?.[key])))};
  }
}
