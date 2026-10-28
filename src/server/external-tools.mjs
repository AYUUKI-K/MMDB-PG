import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {ApiError,bad} from './errors.mjs';
import {hasToolHistory} from './tool-history.mjs';

const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const toolName=value=>{if(typeof value!=='string'||!/^[_a-zA-Z][_a-zA-Z0-9-]{0,63}$/.test(value))bad('工具名称格式无效');return value;};
const keys=(value,allowed)=>{if(!object(value)||Object.keys(value).some(key=>!allowed.includes(key)))bad('工具声明或选择含不支持的字段');};
const put=(wire,index,value)=>{while(wire.length<=index)wire.push(null);wire[index]=value;};

// PG Schema field positions follow the pinned reference in THIRD_PARTY.md.
// Unsupported contracts fail before dispatch instead of silently losing rules.
export function schemaWire(schema,depth=0){
  if(!object(schema)||depth>32)bad('工具 parameters 必须为对象，嵌套不能超过 32 层');
  const allowed=['type','description','format','nullable','enum','items','properties','required','minimum','maximum','minLength','maxLength','minItems','maxItems','minProperties','maxProperties','additionalProperties','title','$schema','default'];
  if(Object.keys(schema).some(key=>!allowed.includes(key)))bad('工具 JSON Schema 含尚不支持的约束或引用');
  const type=schema.type??(schema.properties?'object':schema.items?'array':undefined);
  const types={string:1,number:2,integer:3,boolean:4,array:5,object:6};
  const code=Object.hasOwn(types,type)?types[type]:undefined;
  if(!code)bad('工具 Schema 需要明确的 string/number/integer/boolean/array/object 类型');
  const wire=[code];
  for(const [key,index] of [['format',1],['description',2]])if(schema[key]!==undefined){if(typeof schema[key]!=='string')bad(`Schema.${key} 必须为字符串`);put(wire,index,schema[key]);}
  if(schema.nullable!==undefined){if(typeof schema.nullable!=='boolean')bad('Schema.nullable 必须为布尔值');put(wire,3,schema.nullable);}
  if(schema.enum!==undefined){if(!Array.isArray(schema.enum)||!schema.enum.length||schema.enum.some(x=>typeof x!=='string')||type!=='string')bad('当前仅支持字符串 enum');put(wire,4,schema.enum);}
  if(type==='array'&&schema.items===undefined)bad('数组工具参数需要 items');
  if(schema.items!==undefined){if(type!=='array')bad('items 只能用于数组');put(wire,5,schemaWire(schema.items,depth+1));}
  if(schema.properties!==undefined){if(type!=='object'||!object(schema.properties))bad('properties 必须属于 object 参数');put(wire,6,Object.entries(schema.properties).map(([name,child])=>[name,schemaWire(child,depth+1)]));}
  if(schema.required!==undefined){if(type!=='object'||!Array.isArray(schema.required)||schema.required.some(key=>typeof key!=='string'||!Object.hasOwn(schema.properties??{},key))||new Set(schema.required).size!==schema.required.length)bad('required 必须引用已声明的属性');put(wire,7,schema.required);}
  for(const [key,index] of [['minProperties',8],['maxProperties',9],['minimum',10],['maximum',11],['minLength',12],['maxLength',13],['maxItems',20],['minItems',21]]){
    if(schema[key]===undefined)continue;
    const value=schema[key],count=!['minimum','maximum'].includes(key);
    if(typeof value!=='number'||!Number.isFinite(value)||(count&&(!Number.isSafeInteger(value)||value<0)))bad(`Schema.${key} 无效`);
    put(wire,index,value);
  }
  if(schema.additionalProperties!==undefined&&(type!=='object'||typeof schema.additionalProperties!=='boolean'))bad('additionalProperties 当前仅支持布尔值');
  return wire;
}

export function fromOpenAITools(body){
  if(body.parallel_tool_calls!==undefined&&typeof body.parallel_tool_calls!=='boolean')bad('parallel_tool_calls 必须为布尔值');
  if(body.tools!==undefined&&!Array.isArray(body.tools))bad('tools 必须为数组');
  const functions=(body.tools??[]).map(tool=>{
    keys(tool,['type','function']);if(tool.type!=='function')bad('当前仅支持 function 工具');
    keys(tool.function,['name','description','parameters','strict']);
    if(tool.function.strict!==undefined&&typeof tool.function.strict!=='boolean')bad('strict 必须为布尔值');
    if(tool.function.strict===true)bad('PG 入口尚不支持 strict:true，请使用普通函数参数 Schema');
    const {strict,...declaration}=tool.function;return declaration;
  });
  const choice=body.tool_choice??(functions.length?'auto':'none');
  let mode,allowedFunctionNames;
  if(['auto','none','required'].includes(choice))mode={auto:'AUTO',none:'NONE',required:'ANY'}[choice];
  else{keys(choice,['type','function']);keys(choice.function,['name']);if(choice.type!=='function')bad('tool_choice 必须指定 function');mode='ANY';allowedFunctionNames=[toolName(choice.function.name)];}
  if(mode==='ANY'&&!functions.length)bad('要求工具调用时必须声明 tools');
  return functions.length||body.tool_choice!==undefined?{tools:[{functionDeclarations:functions}],toolConfig:{functionCallingConfig:{mode,...(allowedFunctionNames?{allowedFunctionNames}:{})}}}:{};
}

export function externalToolPolicy(body){
  if(!object(body))bad('请求必须为 JSON 对象');
  if(body.tools!==undefined&&!Array.isArray(body.tools))bad('tools 必须为数组');
  const declarations=[];
  for(const group of body.tools??[]){keys(group,['functionDeclarations']);if(!Array.isArray(group.functionDeclarations))bad('仅支持 functionDeclarations');declarations.push(...group.functionDeclarations);}
  if(declarations.length>128)bad('最多支持 128 个函数工具');
  const names=new Set(),noArgs=new Set();
  const encoded=declarations.map(declaration=>{
    keys(declaration,['name','description','parameters']);const name=toolName(declaration.name);
    if(names.has(name))bad('工具名称重复');names.add(name);
    if(declaration.description!==undefined&&typeof declaration.description!=='string')bad('工具 description 必须为字符串');
    const parameters=declaration.parameters===undefined?{type:'object'}:declaration.parameters;
    if(!object(parameters))bad('工具 parameters 必须为 JSON 对象');
    const schema=schemaWire(Object.keys(parameters).length?parameters:{type:'object'});
    if(schema[0]!==6)bad('函数 parameters 顶层必须为 object');
    if(!Object.keys(parameters.properties??{}).length&&!parameters.required?.length)noArgs.add(name);
    // additionalProperties has no verified PG slot: retain the complete contract
    // as a model instruction, without promising strict server-side validation.
    const description=(declaration.description??'')+(JSON.stringify(parameters).includes('"additionalProperties"')?'\nArguments must follow this JSON Schema: '+JSON.stringify(parameters):'');
    return [name,description,schema];
  });
  let config={};
  if(body.toolConfig!==undefined){keys(body.toolConfig,['functionCallingConfig']);config=body.toolConfig.functionCallingConfig??{};keys(config,['mode','allowedFunctionNames']);}
  const mode=config.mode??(declarations.length?'AUTO':'NONE');
  if(!['AUTO','NONE','ANY'].includes(mode))bad('toolConfig.mode 当前支持 AUTO/NONE/ANY');
  let allowed=[...names];
  if(config.allowedFunctionNames!==undefined){
    if(mode!=='ANY'||!Array.isArray(config.allowedFunctionNames)||!config.allowedFunctionNames.length||config.allowedFunctionNames.some(name=>!names.has(name))||new Set(config.allowedFunctionNames).size!==config.allowedFunctionNames.length)bad('allowedFunctionNames 必须为 ANY 模式下已声明工具的非空子集');
    allowed=config.allowedFunctionNames;
  }
  if(mode==='ANY'&&!declarations.length)bad('ANY 模式必须声明工具');
  return {active:declarations.length>0||hasToolHistory(body),mode,noArgs,allowed:new Set(mode==='NONE'?[]:allowed),wire:mode==='NONE'?null:encoded.length?[[null,encoded.filter(row=>allowed.includes(row[0]))]]:null};
}

const invalid=message=>{throw new ApiError(502,message,'invalid_external_tool_call');};
function decodeValue(wire,depth){
  if(!Array.isArray(wire)||depth>32)invalid('工具参数编码无效或嵌套过深');
  const fields=wire.map((value,index)=>value!=null?index:-1).filter(index=>index>=0);
  if(fields.length!==1||fields[0]>5)invalid('工具参数 Value 字段无效');
  const index=fields[0],value=wire[index];
  if(index===0){if(value!==0)invalid('工具 null 参数无效');return null;}
  if(index===1){if(typeof value!=='number'||!Number.isFinite(value))invalid('工具数字参数无效');return value;}
  if(index===2||index===3){if(typeof value!==(index===2?'string':'boolean'))invalid('工具参数类型无效');return value;}
  if(index===4)return decodeStruct(value,depth+1);
  if(!Array.isArray(value)||value.some((x,i)=>i>0&&x!=null)||(value[0]!=null&&!Array.isArray(value[0])))invalid('工具数组参数无效');
  return (value[0]??[]).map(item=>decodeValue(item,depth+1));
}
export function decodeStruct(wire,depth=0){
  if(!Array.isArray(wire)||depth>32||wire.some((value,index)=>index>0&&value!=null)||(wire[0]!=null&&!Array.isArray(wire[0])))invalid('工具对象参数无效');
  const result={},seen=new Set();
  for(const entry of wire[0]??[]){
    if(!Array.isArray(entry)||entry.length!==2||typeof entry[0]!=='string'||seen.has(entry[0]))invalid('工具对象参数字段无效');
    seen.add(entry[0]);Object.defineProperty(result,entry[0],{value:decodeValue(entry[1],depth+1),enumerable:true});
  }
  return result;
}

// Hold tool calls until clean upstream completion. No partial arguments are
// exposed as executable calls; text SSE can still flow while the model thinks.
export class ExternalToolCalls {
  constructor(policy,{parallel=true}={}){this.policy=policy;this.parallel=parallel;this.calls=[];this.byId=new Map();this.pending=new Map();}
  decode(call,{partIndex,thoughtSignature}={}){
    if(!Array.isArray(call)||call.some((value,index)=>index>2&&value!=null))invalid('尚不支持此工具参数分片格式');
    const [name,args,id]=call;
    if(name!=null&&(typeof name!=='string'||!this.policy.allowed.has(name)))invalid('上游调用了未声明或被禁用的工具');
    if(id!=null&&(typeof id!=='string'||!id||id.length>256))invalid('工具调用 ID 无效');
    let current=id?this.byId.get(id):undefined;
    current??=this.pending.get(partIndex);
    if(!current){
      if(!name)invalid('工具调用缺少名称');
      current={id:id??`call_${randomUUID().replaceAll('-','')}`,providerId:id??null,name,args:undefined,signature:undefined};
      this.calls.push(current);this.byId.set(current.id,current);
      if(this.calls.length>128)invalid('上游工具调用数量过多');
    }
    if((name&&name!==current.name)||(id&&current.providerId&&id!==current.providerId))invalid('工具调用身份发生变化');
    if(id&&!current.providerId){this.byId.delete(current.id);current.id=id;current.providerId=id;this.byId.set(id,current);}
    if(thoughtSignature!=null){
      if(typeof thoughtSignature!=='string'||!thoughtSignature||(current.signature&&current.signature!==thoughtSignature))invalid('工具调用签名无效或冲突');
      current.signature=thoughtSignature;
    }
    if(args!=null){const decoded=decodeStruct(args);if(current.args!==undefined&&!isDeepStrictEqual(current.args,decoded))invalid('重复调用 ID 的参数发生变化，未拼接未经验证的参数分片');current.args=decoded;this.pending.delete(partIndex);}
    else if(current.args===undefined)this.pending.set(partIndex,current);
    return null;
  }
  finish(reason){
    if(this.calls.length&&reason!=='STOP')throw new ApiError(502,'工具调用未正常完成，未向客户端交付可执行调用','incomplete_external_tool_call');
    if(reason==='STOP'&&this.policy.mode==='ANY'&&!this.calls.length)throw new ApiError(502,'模型未按要求调用工具','tool_choice_not_honored');
    if(!this.parallel&&this.calls.length>1)throw new ApiError(502,'模型返回了多个工具调用，未满足 parallel_tool_calls:false','parallel_tools_not_honored');
    for(const call of this.calls)if(call.args===undefined&&this.policy.noArgs?.has(call.name))call.args={};
    if(this.calls.some(call=>call.args===undefined))invalid('工具调用缺少完整参数');
    return this.calls.map(call=>({functionCall:{id:call.id,name:call.name,args:call.args},...(call.signature?{thoughtSignature:call.signature}:{})}));
  }
}
export const openAIToolCall=part=>({id:part.functionCall.id,type:'function',function:{name:part.functionCall.name,arguments:JSON.stringify(part.functionCall.args)},...(part.thoughtSignature?{extra_content:{google:{thought_signature:part.thoughtSignature}}}:{})});
