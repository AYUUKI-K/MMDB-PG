import {normalizeModel,ApiError} from './protocol.mjs';
export function modelMode(value) {
  const model=normalizeModel(value);
  if(model.endsWith('-抗截断'))return {model:model.slice(0,-4),extended:true};
  // Accept previously saved presets, but never advertise the old suffix.
  return model.endsWith('-long')?{model:model.slice(0,-5),extended:true}:{model,extended:false};
}
export function nextTurn(body,visibleText,maxOutputTokens) {
  // Carry visible text only; provider reasoning and signatures never become user input.
  const request={...body,contents:[...body.contents,{role:'model',parts:[{text:visibleText}]},{role:'user',parts:[{text:'请从刚才因输出长度上限中断的位置继续，直接接着写，不重复已有内容，不添加开场说明。'}]}]};
  if(maxOutputTokens!==undefined){
    request.generationConfig={...(body.generationConfig??body.generation_config),maxOutputTokens};
    delete request.generation_config;
  }
  return request;
}

// Only explicit client limits become logical-response budgets. Provider-default
// limits remain provider defaults; missing counters are never estimated as zero.
export function continuationBudget(limit,usage) {
  if(limit==null)return {};
  const counters=[usage?.candidatesTokenCount,usage?.thoughtsTokenCount];
  if(!counters.every(value=>Number.isSafeInteger(value)&&value>=0))return {stop:'unknown_usage'};
  const remaining=Math.max(0,limit-counters[0]-counters[1]);
  return {remaining,...(remaining===0?{stop:'output_budget'}:{})};
}

const seamWindow=8192;
const letterOrNumber=/[\p{L}\p{N}]/u;
function meaningful(text) {
  if(text.length<32)return false;
  let count=0;
  for(const char of text)if(letterOrNumber.test(char)&&++count>=16)return true;
  return false;
}
function suffixOverlap(previous,incoming) {
  const prefix=incoming.slice(0,seamWindow),tail=previous.slice(-seamWindow);
  if(!prefix.length)return 0;
  // KMP keeps a long repetitive seam linear, with bounded auxiliary memory.
  const failure=new Uint32Array(prefix.length);
  for(let i=1,j=0;i<prefix.length;i++){
    while(j&&prefix[i]!==prefix[j])j=failure[j-1];
    if(prefix[i]===prefix[j])j++;
    failure[i]=j;
  }
  let matched=0;
  for(let i=0;i<tail.length;i++){
    while(matched&&(matched===prefix.length||tail[i]!==prefix[matched]))matched=failure[matched-1];
    if(tail[i]===prefix[matched])matched++;
  }
  return matched;
}
export function joinContinuation(previous,incoming,previousRound='') {
  const trimmed=incoming.trim();
  // A complete replay is not progress, even for a short answer. Whitespace
  // is compared only for this guard, never normalized in delivered text.
  if(!trimmed||trimmed===previous.trim()||trimmed===previousRound.trim())return {text:'',overlapChars:incoming.length,hasProgress:false};
  let overlap=suffixOverlap(previous,incoming);
  // Some models restart the entire answer, exceeding the bounded seam window.
  if(previous&&incoming.startsWith(previous)&&meaningful(previous.slice(0,seamWindow)))overlap=previous.length;
  else if(previous.startsWith(incoming)&&meaningful(incoming))return {text:'',overlapChars:incoming.length,hasProgress:false};
  if(!meaningful(incoming.slice(0,overlap)))overlap=0;
  // Never cut a UTF-16 surrogate pair at an overlap boundary.
  if(overlap&&/[\uD800-\uDBFF]/.test(incoming[overlap-1])&&/[\uDC00-\uDFFF]/.test(incoming[overlap]??''))overlap=0;
  const text=incoming.slice(overlap);
  return {text,overlapChars:overlap,hasProgress:!!text.trim()};
}

export class NativeContinuation {
  constructor(payload,capability) {
    this.original=payload;
    this.total=payload.wire[3][3]??capability.outputTokenLimit;
    if(this.total>Math.max(capability.inputTokenLimit,capability.outputTokenLimit))throw new ApiError(400,'maxOutputTokens 超过当前模型目录声明的续写上限','output_limit_exceeded');
    this.usedTokens=new Set();this.round=0;this.reset();
  }
  reset(){this.latestToken=undefined;this.finishToken=undefined;}
  observe(event){
    if(event.continuationToken){
      if(event.continuationToken.length>16384)throw new ApiError(502,'上游续写凭据格式无效','invalid_continuation_token');
      this.latestToken=event.continuationToken;
    }
    if(event.finishReason)this.finishToken=event.continuationToken;
  }
  get limit(){return Math.min(this.total,(this.round+1)*32768);}
  payload(token){
    const payload=structuredClone(this.original),config=payload.wire[3];
    while(config.length<46)config.push(null);
    config[45]=1;config[3]=this.limit;payload.wire[10]=null;
    if(token){while(payload.wire.length<17)payload.wire.push(null);payload.wire[16]=token;}
    return payload;
  }
  next(reason,maxContinuations){
    const required=reason==='CONTINUATION'||(reason==='MAX_TOKENS'&&this.finishToken&&this.limit<this.total);
    if(!required)return null;
    if(!this.latestToken)throw new ApiError(502,'上游要求续写但缺少续写凭据','missing_continuation_token');
    if(this.usedTokens.has(this.latestToken))throw new ApiError(502,'上游重复返回同一续写凭据，已停止重复请求','repeated_continuation_token');
    if(this.round>=maxContinuations||this.limit>=this.total)throw new ApiError(502,'上游仍要求续写，但本次续写次数或输出预算已用完','continuation_budget_exhausted');
    const token=this.latestToken;this.usedTokens.add(token);this.round++;this.reset();
    return this.payload(token);
  }
}
