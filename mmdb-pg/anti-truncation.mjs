import {ApiError, toWire} from './protocol.mjs';

// Tool-envelope transport follows the approach described by su-kaka/gcli2api.
// This PG wire adapter and its instruction are implemented for MMDB; no Python
// module or control prompt from that project is included here.
export const ANSWER_TOOL = 'mmdb_emit_answer';
const instruction = `[客户端响应协议]\n本轮最终答复的交付方式是实际调用函数 ${ANSWER_TOOL}，而不是直接输出普通文本。请只调用一次，将用户可见的完整最终正文放在唯一字符串参数 content 内，保留所需语言、段落和格式，不包含内部思考。不要在函数外输出正文，也不要将函数调用写成文本、JSON 示例或代码块。该函数仅提交答复，不执行任何外部操作。`;
const deliveryReminder = `[客户端交付提醒]\n请回应以上用户任务，并通过实际的 ${ANSWER_TOOL} 函数调用提交最终答复，唯一参数 content 为完整正文。此处只规定交付方式，正文继续遵循原任务的语言和格式。不要以普通文本模拟工具调用。`;

const compactInstruction=`请实际调用 ${ANSWER_TOOL} 一次提交最终答复，content 为完整正文，保留原语言和格式，不含内部思考；函数外不输出正文。该函数仅提交文本。`;
const compactReminder=`请调用 ${ANSWER_TOOL} 提交本轮答复。`;
export function envelopePayload(model, body, {style='legacy'}={}) {
  if(!['legacy','compact'].includes(style))throw new ApiError(400,'工具交付策略无效','invalid_tool_style');
  const compact=style==='compact';
  const contract=compact?compactInstruction:instruction;
  const reminder=compact?compactReminder:deliveryReminder;
  const system=body.systemInstruction ?? body.system_instruction;
  // SillyTavern can end a prompt with an assistant prefill. In AUTO mode this
  // encourages continuation of that text instead of a fresh function call.
  // Keep the prefill/history intact, then end the request on a user transport
  // reminder. Build WAA's binding from this exact, augmented conversation.
  const contents=body.contents?.map(turn=>({...turn,parts:turn.parts?.map(part=>({...part}))}));
  const last=contents?.at(-1);
  if(last?.role==='model')contents.push({role:'user',parts:[{text:`${reminder}\n${compact?'上一条 assistant 预填仅作上下文参考。':'上一条 assistant 预填仅作为上下文参考；本轮请另行提交函数调用，不继续生成预填的普通文本。'}`}]});
  else if(last)last.parts=[...(last.parts??[]),{text:reminder}];
  const request={...body,contents,systemInstruction:{parts:[...(system?.parts ?? []),{text:contract}]}};
  delete request.system_instruction;
  const payload=toWire(model,request);
  // Schema: OBJECT with one required STRING property. Tool is root field 7.
  const schema=[6,null,null,null,null,null,[['content',[1,null,compact?'完整最终正文，保留语言和格式。':'用户可见的完整最终答复；保留原语言和格式，不包含内部思考。']]],['content']];
  payload.wire[6]=[[null,[[ANSWER_TOOL,compact?'提交最终正文。':'本轮最终答复的唯一提交入口：实际调用一次，以 content 字符串交付全部正文。不要在工具外输出正文。',schema]]]];
  return payload;
}

function malformed(message) { throw new ApiError(502,message,'invalid_tool_envelope'); }
function contentFromStruct(value) {
  if(!Array.isArray(value)||!Array.isArray(value[0])||value.some((entry,index)=>index>0&&entry!=null))malformed('工具答复参数格式无效');
  let content;
  for(const entry of value[0]){
    if(!Array.isArray(entry)||typeof entry[0]!=='string'||!Array.isArray(entry[1])||entry.some((value,index)=>index>1&&value!=null))malformed('工具答复参数格式无效');
    if(entry[0]!=='content')malformed('工具答复包含未声明的参数');
    if(content!==undefined||typeof entry[1][2]!=='string'||entry[1].some((value,index)=>index!==2&&value!=null))malformed('工具答复正文不是唯一的字符串');
    content=entry[1][2];
  }
  return content;
}

export class AnswerEnvelope {
  constructor(){this.observed=false;this.fragments=0;this.hasVisibleContent=false;this.currentName=null;this.callId=null;}
  decode(call) {
    if(!Array.isArray(call))malformed('工具调用格式无效');
    if(call[0]!=null&&typeof call[0]!=='string')malformed('工具名称格式无效');
    if(call[2]!=null&&typeof call[2]!=='string')malformed('工具调用标识格式无效');
    // The verified PG layout is [name, Struct, callId?]. Do not silently drop
    // future argument-fragment fields or guess public API -> PG wire positions.
    if(call.some((value,index)=>index>2&&value!=null))throw new ApiError(502,'上游返回了尚未验证的工具参数扩展，未将不完整参数作为正文交付','unsupported_tool_arguments');
    const name=call[0]||this.currentName;
    if(name!==ANSWER_TOOL)throw new ApiError(502,'上游调用了未声明的工具，未将其作为正文返回','unexpected_tool_call');
    if(call[2]){
      if(this.callId&&this.callId!==call[2])throw new ApiError(502,'同一答复出现多个工具调用标识，未将不同调用拼接为正文','multiple_tool_calls');
      this.callId=call[2];
    }
    this.currentName=name;this.observed=true;
    // A name-only streaming frame can precede the argument frame.
    if(call[1]==null)return null;
    const content=contentFromStruct(call[1]);
    if(content===undefined)return null;
    this.fragments++;
    this.hasVisibleContent ||= !!content.trim();
    return {text:content};
  }
}
