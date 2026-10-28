import {bad} from './errors.mjs';

// Function-call history conversion; the relay never executes client functions.
export const SYNTHETIC_SIGNATURE='skip_thought_signature_validator';
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const name=value=>{if(typeof value!=='string'||!/^[_a-zA-Z][_a-zA-Z0-9-]{0,63}$/.test(value))bad('工具名称格式无效');return value;};
const id=value=>{if(typeof value!=='string'||!value||value.length>256)bad('工具调用需要有效的 id');return value;};
const keys=(value,allowed)=>{if(!object(value)||Object.keys(value).some(key=>!allowed.includes(key)))bad('工具记录含不支持的字段');};


function signature(call){
  const google=call.extra_content?.google?.thought_signature,legacy=call.signature;
  if(google!==undefined&&legacy!==undefined&&google!==legacy)bad('工具调用的签名字段冲突');
  const value=google??legacy;
  if(value!==undefined&&(typeof value!=='string'||!value||value.length>1024*1024))bad('工具调用签名格式无效');
  return value??SYNTHETIC_SIGNATURE;
}

export function openAIToolMessages(messages,contentText){
  const system=[],contents=[],pending=new Map(),seen=new Set();
  for(const message of messages){
    if(!object(message))bad('messages 含无效消息');
    if(message.function_call!==undefined)bad('暂不支持旧版 function_call，请使用 tool_calls');
    if(pending.size&&message.role!=='tool')bad('工具调用之后必须先提供对应的全部工具结果');
    if(message.tool_calls!==undefined){
      if(message.role!=='assistant'||!Array.isArray(message.tool_calls)||!message.tool_calls.length)bad('tool_calls 必须位于 assistant 消息且不能为空');
      const parts=[];
      if(message.content!=null){const text=contentText(message.content);if(text)parts.push({text});}
      for(const call of message.tool_calls){
        if(!object(call)||call.type!=='function'||!object(call.function))bad('工具调用格式无效');
        const callId=id(call.id),toolName=name(call.function.name);
        if(seen.has(callId))bad('工具调用 id 重复');seen.add(callId);
        if(typeof call.function.arguments!=='string')bad('工具参数必须是 JSON 对象字符串');
        let args;try{args=JSON.parse(call.function.arguments);}catch{bad('工具参数不是合法 JSON');}
        if(!object(args))bad('工具参数必须是 JSON 对象');
        // Validate the full value tree before accepting the request.
        encodeStruct(args);
        parts.push({functionCall:{name:toolName,args,id:callId},thoughtSignature:signature(call)});
        pending.set(callId,toolName);
      }
      contents.push({role:'model',parts});
    }else if(message.role==='tool'){
      const callId=id(message.tool_call_id),toolName=pending.get(callId);
      if(!toolName)bad('工具结果找不到尚未完成的对应调用');
      if(message.name!==undefined&&message.name!==toolName)bad('工具结果名称与调用不匹配');
      const part={functionResponse:{name:toolName,id:callId,response:{result:contentText(message.content)}}};
      const previous=contents.at(-1);
      if(previous?.parts.every(p=>p.functionResponse))previous.parts.push(part);
      else contents.push({role:'user',parts:[part]});
      pending.delete(callId);
    }else{
      const text=contentText(message.content);
      if(['system','developer'].includes(message.role))system.push(text);
      else if(['user','assistant'].includes(message.role))contents.push({role:message.role==='assistant'?'model':'user',parts:[{text}]});
      else bad(`暂不支持消息角色 ${message.role}`);
    }
  }
  if(pending.size)bad('工具调用缺少结果；当前仅支持已完成的工具历史');
  return {system,contents};
}

export function encodeStruct(value,depth=0){
  if(!object(value)||depth>32)bad('工具 JSON 对象无效或嵌套超过 32 层');
  const entries=Object.entries(value).map(([key,item])=>[key,encodeValue(item,depth+1)]);
  return entries.length?[entries]:[];
}
function encodeValue(value,depth){
  if(depth>32)bad('工具 JSON 嵌套超过 32 层');
  if(value===null)return [0];
  if(typeof value==='string')return [null,null,value];
  if(typeof value==='boolean')return [null,null,null,value];
  if(typeof value==='number'&&Number.isFinite(value))return [null,value];
  if(Array.isArray(value))return [null,null,null,null,null,[value.map(item=>encodeValue(item,depth+1))]];
  if(object(value))return [null,null,null,null,encodeStruct(value,depth)];
  bad('工具 JSON 中含不支持的值');
}

export function toolPartWire(part){
  if(part.functionCall){
    keys(part,['functionCall','thoughtSignature']);keys(part.functionCall,['name','args','id']);
    const call=part.functionCall,wire=Array(15).fill(null);
    wire[10]=[name(call.name),encodeStruct(call.args),id(call.id)];
    if(part.thoughtSignature!==undefined&&(typeof part.thoughtSignature!=='string'||!part.thoughtSignature))bad('工具调用签名格式无效');
    wire[14]=part.thoughtSignature??SYNTHETIC_SIGNATURE;return wire;
  }
  keys(part,['functionResponse']);keys(part.functionResponse,['name','response','id']);
  const result=part.functionResponse,wire=Array(12).fill(null);
  wire[11]=[name(result.name),encodeStruct(result.response),id(result.id)];return wire;
}

export const hasToolHistory=body=>body.contents?.some(turn=>turn.parts?.some(part=>part.functionCall||part.functionResponse))===true;

// Also validates native Gemini-style histories and prevents partial pairs from
// reaching PG. Parallel results can arrive in any order, matched by id and name.
export function validateWireHistory(contents){
  const pending=new Map(),seen=new Set();
  for(const [parts,role] of contents){
    if(pending.size&&role!=='user')bad('工具调用之后必须先提供工具结果');
    for(const part of parts){
      if(part[10]){
        if(role!=='model')bad('functionCall 必须位于 model 消息');
        const [toolName,,callId]=part[10];
        if(seen.has(callId))bad('工具调用 id 重复');seen.add(callId);pending.set(callId,toolName);
      }else if(part[11]){
        const [toolName,,callId]=part[11];
        if(role!=='user'||pending.get(callId)!==toolName)bad('functionResponse 与工具调用不匹配');
        pending.delete(callId);
      }else if(pending.size)bad('工具结果完整返回前不能插入其他正文');
    }
  }
  if(pending.size)bad('工具调用缺少结果；当前仅支持已完成的工具历史');
}
