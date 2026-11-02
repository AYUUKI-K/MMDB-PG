import {runtimeError} from '../../runtime-manager/src/transport.mjs';
export {runtimeError,readRuntimeSSE} from '../../runtime-manager/src/transport.mjs';
import {ApiError} from './errors.mjs';
import {decodeStruct} from './external-tools.mjs';
import {encodeStruct} from './tool-history.mjs';

const invalid=()=>new ApiError(502,'独立运行时返回了不支持或不完整的数据','headless_protocol_error');
const types=['','STRING','NUMBER','INTEGER','BOOLEAN','ARRAY','OBJECT'];
const finishes={STOP:1,MAX_TOKENS:2,SAFETY:3,RECITATION:4,OTHER:5,LANGUAGE:6,BLOCKLIST:7,PROHIBITED_CONTENT:8,SPII:9,MALFORMED_FUNCTION_CALL:10,IMAGE_SAFETY:11,UNEXPECTED_TOOL_CALL:12,TOO_MANY_TOOL_CALLS:13,IMAGE_PROHIBITED_CONTENT:14,IMAGE_OTHER:15,NO_IMAGE:16,IMAGE_RECITATION:17,MISSING_THOUGHT_SIGNATURE:18};
function slots(value,allowed){
  if(!Array.isArray(value)||value.some((item,index)=>item!=null&&!allowed.includes(index)))throw invalid();
}
function schema(value,depth=0){
  if(depth>32)throw invalid();
  slots(value,[0,1,2,3,4,5,6,7,8,9,10,11,12,13,20,21]);
  if(!types[value[0]])throw invalid();
  const result={type:types[value[0]]};
  for(const [name,index] of [['format',1],['description',2],['nullable',3],['enum',4],['required',7],['minProperties',8],['maxProperties',9],['minimum',10],['maximum',11],['minLength',12],['maxLength',13],['maxItems',20],['minItems',21]])if(value[index]!=null)result[name]=value[index];
  if(value[5]!=null)result.items=schema(value[5],depth+1);
  if(value[6]!=null)result.properties=Object.fromEntries(value[6].map(([key,child])=>[key,schema(child,depth+1)]));
  return result;
}
function part(value){
  slots(value,[1,2,10,11,12,14]);
  const result={};
  if(typeof value[1]==='string')result.text=value[1];
  if(value[2]!=null){slots(value[2],[0,1]);if(typeof value[2][0]!=='string'||typeof value[2][1]!=='string'||value[1]!=null)throw invalid();result.inlineData={mimeType:value[2][0],data:value[2][1]};}
  for(const [field,index,args] of [['functionCall',10,'args'],['functionResponse',11,'response']])if(value[index]!=null){
    slots(value[index],[0,1,2]);
    const [name,data,id]=value[index];
    result[field]={name,[args]:decodeStruct(data??[]),...(id?{id}:{})};
  }
  if(value[12]!=null)result.thought=value[12];
  if(value[14]!=null)result.thoughtSignature=value[14];
  if(!Object.keys(result).length)throw invalid();
  return result;
}
const content=value=>({role:value[1],parts:value[0].map(part)});

// Translate only the wire subset emitted by MMDB. Proofs and cookies belong to
// the separate runtime; native continuation tokens cannot cross its public API.
export function headlessRequest(payload){
  const wire=payload?.wire;
  slots(wire,[0,1,3,5,6,10,13]);
  if(typeof wire[0]!=='string'||!/^models\/[a-zA-Z0-9._-]+$/.test(wire[0]))throw invalid();
  slots(wire[3],[1,3,4,5,6,13]);
  const generationConfig={};
  for(const [name,index] of [['stopSequences',1],['maxOutputTokens',3],['temperature',4],['topP',5],['topK',6]])if(wire[3][index]!=null)generationConfig[name]=wire[3][index];
  const body={contents:wire[1].map(content),generationConfig};
  if(wire[5])body.systemInstruction=content(wire[5]);
  if(wire[6]?.length)body.tools=wire[6].map(group=>{
    slots(group,[1]);
    return {functionDeclarations:group[1].map(call=>{
      slots(call,[0,1,2]);
      return {name:call[0],...(call[1]?{description:call[1]}:{}),...(call[2]?{parameters:schema(call[2])}:{})};
    })};
  });
  return {model:wire[0].slice(7),body};
}

// Project public Gemini events into the existing checked frame decoder. This
// retains tool-envelope/input-read validation and never invents usage values.
export function headlessFrame(value){
  if(!value||typeof value!=='object'||Array.isArray(value))throw invalid();
  if(value.error){
    const statuses={RESOURCE_EXHAUSTED:429,UNAUTHENTICATED:401,PERMISSION_DENIED:403,INVALID_ARGUMENT:400,UNAVAILABLE:503,DEADLINE_EXCEEDED:504};
    throw runtimeError(Number.isInteger(value.error.code)?value.error.code:statuses[value.error.status]??502);
  }
  if(value.promptFeedback?.blockReason)throw new ApiError(400,'上游拒绝了本次输入','upstream_prompt_blocked');
  const candidates=value.candidates??[];
  if(!Array.isArray(candidates)||candidates.length>1)throw invalid();
  const candidate=candidates[0],frame=[];
  if(candidate){
    if(candidate.index!=null&&candidate.index!==0)throw invalid();
    const parts=(candidate.content?.parts??[]).map(item=>{
      if(!item||Object.keys(item).some(key=>!['text','thought','thoughtSignature','functionCall'].includes(key)))throw invalid();
      const result=Array(15).fill(null);
      if(item.text!==undefined){if(typeof item.text!=='string')throw invalid();result[1]=item.text;}
      if(item.thought!==undefined){if(typeof item.thought!=='boolean')throw invalid();result[12]=item.thought;}
      if(item.thoughtSignature!==undefined){if(typeof item.thoughtSignature!=='string')throw invalid();result[14]=item.thoughtSignature;}
      if(item.functionCall){const call=item.functionCall;if(typeof call.name!=='string'||call.id!=null&&typeof call.id!=='string')throw invalid();result[10]=[call.name,encodeStruct(call.args??{}),call.id??null];}
      return result;
    });
    const row=[[parts,'model']];
    if(candidate.finishReason){if(!Object.hasOwn(finishes,candidate.finishReason))throw invalid();row[1]=finishes[candidate.finishReason];}
    frame[0]=[row];
  }
  if(value.usageMetadata){
    const usage=[];
    for(const [name,index] of [['promptTokenCount',0],['candidatesTokenCount',1],['totalTokenCount',2],['cachedContentTokenCount',3],['toolUsePromptTokenCount',7],['thoughtsTokenCount',9]]){
      const count=value.usageMetadata[name];if(count!=null){if(!Number.isSafeInteger(count)||count<0)throw invalid();usage[index]=count;}
    }
    frame[2]=usage;
  }
  if(typeof value.responseId==='string')frame[7]=value.responseId;
  if(!frame.length)throw invalid();
  return frame;
}
