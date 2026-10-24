import {ApiError, toWire} from './protocol.mjs';

// Tool-envelope transport follows the approach described by su-kaka/gcli2api.
// This PG wire adapter and its instruction are implemented for MMDB; no Python
// module or control prompt from that project is included here.
export const ANSWER_TOOL = 'mmdb_emit_answer';
export const DELIVERY_USER = 'Submit your complete answer through mmdb_emit_answer. For a long answer, call it multiple times in order, with about 1000 characters per call. Continue until the answer is complete; do not repeat earlier sections or output answer text outside the tool.';
export const LEGACY_DELIVERY_USER = 'Call mmdb_emit_answer once to submit the final answer.';
export function envelopePayload(model, body) {
  const legacy4A = model === 'gemini-4-argon';
  // Preserve the original system and history. Always append one user turn.
  const contents=body.contents?.map(turn=>({...turn,parts:turn.parts?.map(part=>({...part}))}));
  if(contents?.length)contents.push({role:'user',parts:[{text:legacy4A ? LEGACY_DELIVERY_USER : DELIVERY_USER}]});
  const payload=toWire(model,{...body,contents});
  const schema=[6,null,null,null,null,null,[['content',[1,null,'The final answer.']]],['content']];
  payload.wire[6]=[[null,[[ANSWER_TOOL,legacy4A ? 'Submit the final answer.' : 'Submit the next section of the final answer. Call again for remaining sections, in order.',schema]]]];
  return payload;
}

function malformed(message) { throw new ApiError(502,message,'invalid_tool_envelope'); }
function contentFromStruct(value) {
  if(!Array.isArray(value)||!Array.isArray(value[0]))malformed('工具答复参数格式无效');
  let content;
  for(const entry of value[0]){
    if(!Array.isArray(entry)||typeof entry[0]!=='string'||!Array.isArray(entry[1]))malformed('工具答复参数格式无效');
    if(entry[0]!=='content')malformed('工具答复包含未声明的参数');
    if(content!==undefined||typeof entry[1][2]!=='string')malformed('工具答复正文不是唯一的字符串');
    content=entry[1][2];
  }
  return content;
}

export class AnswerEnvelope {
  constructor(){this.observed=false;this.fragments=0;this.currentName=null;}
  decode(call) {
    if(!Array.isArray(call))malformed('工具调用格式无效');
    const name=call[0]||this.currentName;
    if(name!==ANSWER_TOOL)throw new ApiError(502,'上游调用了未声明的工具，未将其作为正文返回','unexpected_tool_call');
    this.currentName=name;this.observed=true;
    // A name-only streaming frame can precede the argument frame.
    if(call[1]==null)return null;
    const content=contentFromStruct(call[1]);
    if(content===undefined)return null;
    this.fragments++;
    return {text:content};
  }
}
