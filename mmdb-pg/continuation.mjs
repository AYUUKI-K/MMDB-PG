import {normalizeModel} from './protocol.mjs';
export function modelMode(value) {
  const model=normalizeModel(value);
  if(model.endsWith('-抗截断'))return {model:model.slice(0,-4),extended:true};
  // Accept previously saved presets, but never advertise the old suffix.
  return model.endsWith('-long')?{model:model.slice(0,-5),extended:true}:{model,extended:false};
}
export function nextTurn(body,visibleText) {
  // Carry visible text only; provider reasoning and signatures never become user input.
  return {...body,contents:[...body.contents,{role:'model',parts:[{text:visibleText}]},{role:'user',parts:[{text:'请从刚才因输出长度上限中断的位置继续，直接接着写，不重复已有内容，不添加开场说明。'}]}]};
}
export function addUsage(total,part) {
  if(!part)return total;
  if(!total)return {...part};
  const result={};
  for(const key of ['promptTokenCount','candidatesTokenCount','totalTokenCount','thoughtsTokenCount'])if(total[key]!==undefined&&part[key]!==undefined)result[key]=total[key]+part[key];
  return result;
}
