import {readUsage} from './metrics.mjs';
import {ApiError,bad} from './errors.mjs';
import {openAIToolMessages,toolPartWire,validateWireHistory} from './tool-history.mjs';
import {fromOpenAITools,externalToolPolicy} from './external-tools.mjs';
export {ApiError} from './errors.mjs';
// Wire field positions checked against AIStudio2API/docs/protocol.md (see THIRD_PARTY.md).
export function normalizeModel(model) {
  if (typeof model !== 'string' || !/^(?:models\/)?(?:pg-)?[a-zA-Z0-9._-]+(?:-抗截断)?$/.test(model)) bad('需要有效的 model 名称');
  return model.replace(/^models\//, '').replace(/^pg-/, '');
}
function contentText(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.every(p => p?.type === 'text' && typeof p.text === 'string')) return value.map(p => p.text).join('\n');
  bad('仅支持文本消息内容；图片和附件尚未实现');
}
export function fromOpenAI(body) {
  if (!Array.isArray(body.messages) || !body.messages.length) bad('messages 不能为空');
  for (const key of ['functions', 'function_call', 'response_format', 'logprobs', 'audio', 'modalities']) {
    if (body[key] !== undefined) bad(`暂不支持参数 ${key}`);
  }
  if (body.n !== undefined && body.n !== 1) bad('仅支持 n=1');
  const tools=fromOpenAITools(body);
  const {system,contents}=openAIToolMessages(body.messages,contentText);
  return {...tools,contents, systemInstruction: system.length ? {parts: [{text: system.join('\n\n')}]} : undefined,
    generationConfig: {temperature: body.temperature, topP: body.top_p, maxOutputTokens: body.max_completion_tokens ?? body.max_tokens,
      stopSequences: typeof body.stop === 'string' ? [body.stop] : body.stop}};
}
function partsWire(parts,allowTools=false) {
  if (!Array.isArray(parts) || !parts.length) bad('parts 不能为空');
  return parts.map(p => {
    if(!p||typeof p!=='object')bad('Part 格式无效');
    if(allowTools&&(p.functionCall||p.functionResponse))return toolPartWire(p);
    if(allowTools&&typeof p.text==='string'&&Object.keys(p).every(key=>['text','thought','thoughtSignature'].includes(key))){
      if(p.thought!==undefined&&typeof p.thought!=='boolean')bad('thought 必须为布尔值');
      if(p.thoughtSignature!==undefined&&(typeof p.thoughtSignature!=='string'||!p.thoughtSignature))bad('thoughtSignature 格式无效');
      const wire=[null,p.text];
      if(p.thought!==undefined||p.thoughtSignature!==undefined){while(wire.length<15)wire.push(null);wire[12]=p.thought??null;wire[14]=p.thoughtSignature??null;}
      return wire;
    }
    if (typeof p.text !== 'string' || Object.keys(p).some(k => k !== 'text')) bad('首版仅支持纯文本 Part');
    return [null, p.text];
  });
}
export function toWire(model, body) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.contents) || !body.contents.length) bad('contents 不能为空');
  for (const k of Object.keys(body)) if (!['contents', 'systemInstruction', 'system_instruction', 'generationConfig', 'generation_config','tools','toolConfig'].includes(k)) bad(`暂不支持 Gemini 字段 ${k}`);
  const tools=externalToolPolicy(body);
  const contents = body.contents.map(c => {
    const role = c.role ?? 'user';
    if (!['user', 'model'].includes(role)) bad('contents.role 必须为 user 或 model');
    return [partsWire(c.parts,true), role];
  });
  validateWireHistory(contents);
  const g = body.generationConfig ?? body.generation_config ?? {};
  for (const k of Object.keys(g)) if (!['temperature', 'topP', 'topK', 'maxOutputTokens', 'stopSequences'].includes(k)) bad(`暂不支持 generationConfig.${k}`);
  for (const [k, min, max, integer] of [['temperature', 0, 2, false], ['topP', 0, 1, false], ['topK', 0, 1000000, true], ['maxOutputTokens', 1, 1000000, true]]) {
    if (g[k] !== undefined && (typeof g[k] !== 'number' || !Number.isFinite(g[k]) || g[k] < min || g[k] > max || (integer && !Number.isInteger(g[k])))) bad(`generationConfig.${k} 超出范围`);
  }
  if (g.stopSequences !== undefined && (!Array.isArray(g.stopSequences) || g.stopSequences.some(s => typeof s !== 'string'))) bad('stopSequences 必须为字符串数组');
  const config = Array(14).fill(null);
  config[1] = g.stopSequences ?? null; config[3] = g.maxOutputTokens ?? null;
  config[4] = g.temperature ?? null; config[5] = g.topP ?? null; config[6] = g.topK ?? null; config[13] = 1;
  const sys = body.systemInstruction ?? body.system_instruction;
  const wire = [ `models/${normalizeModel(model)}`, contents, null, config, null, sys ? [partsWire(sys.parts), 'user'] : null, null, null, null, null, 1, null, null, [[null, null, 'Asia/Shanghai']] ];
  wire[6]=tools.wire;
  if(tools.mode==='ANY'){
    const instruction=`This request requires a function call. Call one of the declared functions (${[...tools.allowed].join(', ')}); do not substitute a plain text answer.`;
    wire[5]??=[[],'user'];wire[5][0].push([null,instruction]);
  }
  // WAA binds contents in order, including historical turns; system is excluded.
  const binding = body.contents.flatMap(c => c.parts.map(p => p.text??'')).join(' ');
  return {wire, binding};
}

// Google JSON+protobuf can omit array entries: [,value,,] -> [null,value,null,null].
// Scan strings rather than use a regex that could corrupt generated text.
export function parseSparseJSON(raw) {
  let result = '', string = false, escaped = false, previous = '';
  for (const ch of raw) {
    if (string) { result += ch; if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === '"') string = false; continue; }
    if (ch === '"') { string = true; result += ch; previous = 'v'; continue; }
    if ((ch === ',' && (previous === '[' || previous === ',')) || (ch === ']' && previous === ',')) result += 'null';
    result += ch;
    if (!/\s/.test(ch)) previous = ch;
  }
  return JSON.parse(result);
}

// Incrementally extract complete frames inside root[0], across arbitrary WS chunks.
export class FrameParser {
  constructor(onFrame) { this.onFrame = onFrame; this.raw = ''; this.pos = 0; this.depth = 0; this.string = false; this.escape = false; this.start = -1; this.count = 0; }
  push(chunk) {
    this.raw += chunk;
    if (this.raw.length > 32 * 1024 * 1024) throw new ApiError(502, '上游响应超过 32 MiB', 'upstream_too_large');
    for (; this.pos < this.raw.length; this.pos++) {
      const ch = this.raw[this.pos];
      if (this.string) { if (this.escape) this.escape = false; else if (ch === '\\') this.escape = true; else if (ch === '"') this.string = false; continue; }
      if (ch === '"') { this.string = true; continue; }
      if (ch === '[') { this.depth++; if (this.depth === 3) this.start = this.pos; }
      else if (ch === ']') {
        if (this.depth === 3 && this.start >= 0) { this.onFrame(parseSparseJSON(this.raw.slice(this.start, this.pos + 1)),{offset:this.start,index:this.count}); this.start = -1; this.count++; }
        this.depth--;
      }
    }
  }
  end() {
    let root;
    try { root = parseSparseJSON(this.raw); } catch { throw new ApiError(502, 'Google 响应不是完整的 JSON+protobuf 数据', 'invalid_upstream'); }
    if (root?.[1]?.[0]) {
      const rpc=root[1][0],status=({3:400,7:403,8:429,16:401,4:504,14:503})[rpc]??502;
      const message=`Google RPC ${rpc}: ${root[1][1] ?? '未知错误'}`;
      throw new ApiError(status,message,rpc===8?'upstream_quota_exhausted':'upstream_rpc_error');
    }
    if (!this.count) throw new ApiError(502, '没有识别到生成结果，可能是 Google 协议已变化', 'invalid_upstream');
  }
}
const reasons = {1: 'STOP', 2: 'MAX_TOKENS', 3: 'SAFETY', 4: 'RECITATION', 5: 'OTHER', 6: 'LANGUAGE', 7: 'BLOCKLIST', 8: 'PROHIBITED_CONTENT', 9: 'SPII', 10: 'MALFORMED_FUNCTION_CALL', 11: 'IMAGE_SAFETY', 12: 'UNEXPECTED_TOOL_CALL', 13: 'TOO_MANY_TOOL_CALLS', 14: 'IMAGE_PROHIBITED_CONTENT', 15: 'IMAGE_OTHER', 16: 'NO_IMAGE', 17: 'IMAGE_RECITATION', 18: 'MISSING_THOUGHT_SIGNATURE', 22: 'CONTINUATION'};
const filteredReasons = new Set(['SAFETY','RECITATION','BLOCKLIST','PROHIBITED_CONTENT','SPII','IMAGE_SAFETY','IMAGE_PROHIBITED_CONTENT','IMAGE_RECITATION']);
export function assertSuccessfulFinish(reason,{allowContinuation=false}={}) {
  if(!reason)throw new ApiError(502,'上游响应缺少完成状态，未将部分内容标为成功','incomplete_upstream');
  if(reason==='STOP'||reason==='MAX_TOKENS'||filteredReasons.has(reason)||(allowContinuation&&reason==='CONTINUATION'))return;
  if(reason==='CONTINUATION')throw new ApiError(502,'上游要求原生续写，但本次请求未启用已确认能力的原生续写','native_continuation_unavailable');
  throw new ApiError(502,`上游生成未正常完成（${reason}），未将部分内容标为成功`,'upstream_generation_failed');
}
const promptBlockReasons = {1: 'SAFETY', 2: 'OTHER', 3: 'BLOCKLIST', 4: 'PROHIBITED_CONTENT', 5: 'IMAGE_SAFETY'};
export function decodeFrame(frame, {decodeFunctionCall,allowMultipleFunctionCalls=false} = {}) {
  // Prompt rejection is a valid frame with no candidates, not a missing finish frame.
  // Keep the error free of prompt text and browser credentials.
  const feedback = frame?.[1];
  if (Number.isInteger(feedback?.[0]) && feedback[0] > 0) {
    const blockReason = promptBlockReasons[feedback[0]] ?? `PROVIDER_${feedback[0]}`;
    throw new ApiError(400, `Google 拒绝处理本次输入（${blockReason}），未开始生成。请检查本次发送的聊天历史、角色卡和预设。`, 'upstream_prompt_blocked');
  }
  const candidate = frame?.[0]?.[0];
  const parts = candidate?.[0]?.[0] ?? [];
  const functionCallCount=parts.filter(p=>p?.[10]!=null).length;
  if(decodeFunctionCall&&!allowMultipleFunctionCalls&&functionCallCount>1)throw new ApiError(502,'同一响应帧包含多个正文工具调用，未将不同调用拼接为正文','multiple_tool_calls');
  const decoded = parts.map((p,partIndex) => {
    if(p?.[10]!=null && decodeFunctionCall){
      if(p?.[2]||p?.[11]||p?.[12]||typeof p?.[1]==='string')throw new ApiError(502,'工具调用与其他 Part 内容冲突','invalid_tool_envelope');
      return decodeFunctionCall(p[10],{partIndex,thoughtSignature:p[14]});
    }
    if ((typeof p?.[1] !== 'string' && !p?.[14]) || p?.[2] || p?.[10] || p?.[11]) throw new ApiError(502, '返回了首版尚不支持的非文本内容', 'unsupported_upstream_part');
    return {...(typeof p[1] === 'string' ? {text: p[1]} : {}), ...(p[12] ? {thought: true} : {}), ...(p[14] ? {thoughtSignature: p[14]} : {})};
  }).filter(Boolean);
  const u = frame?.[2];
  const finishCode = candidate?.[1];
  const finishReason = Number.isInteger(finishCode) && finishCode > 0 ? reasons[finishCode] ?? `PROVIDER_${finishCode}` : undefined;
  return {parts: decoded, finishReason, responseId: frame?.[7],...(functionCallCount?{functionCallCount}:{}),
    ...(typeof candidate?.[8]==='string'&&candidate[8]?{continuationToken:candidate[8]}:{}),
    usageMetadata: readUsage(u)};
}
export function geminiChunk(event) {
  return {candidates: [{content: {role: 'model', parts: event.parts}, ...(event.finishReason ? {finishReason: event.finishReason.startsWith('PROVIDER_')?'OTHER':event.finishReason,...(event.finishReason.startsWith('PROVIDER_')?{finishMessage:event.finishReason}:{})} : {}), index: 0}],
    ...(event.usageMetadata ? {usageMetadata: event.usageMetadata} : {}), ...(event.responseId ? {responseId: event.responseId} : {})};
}
export function openAIUsage(u) {
  if (!u || ![u.promptTokenCount,u.candidatesTokenCount,u.thoughtsTokenCount,u.totalTokenCount].every(Number.isSafeInteger)) return undefined;
  return {...(u.promptTokenCount!==undefined?{prompt_tokens:u.promptTokenCount}:{}),
    ...(u.candidatesTokenCount!==undefined&&u.thoughtsTokenCount!==undefined?{completion_tokens:u.candidatesTokenCount+u.thoughtsTokenCount}:{}),
    ...(u.totalTokenCount!==undefined?{total_tokens:u.totalTokenCount}:{}),
    ...(u.thoughtsTokenCount!==undefined?{completion_tokens_details:{reasoning_tokens:u.thoughtsTokenCount}}:{})};
}
export function finishOpenAI(reason) {
  assertSuccessfulFinish(reason);
  return reason==='MAX_TOKENS'?'length':filteredReasons.has(reason)?'content_filter':'stop';
}
