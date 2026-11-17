// Support is separate from a saved preference. A successful HTTP response is
// not evidence that an undocumented PG field had any effect.
export const EXPERIMENT_DEFAULTS=Object.freeze({nativeContinuation:false,inputRead:false,inputReadSynthetic:false,inputReadScope:'turn',outputEnvelope:'off',completeToolOutput:true});
export function experimentSettings(value={}) {
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!Object.hasOwn(EXPERIMENT_DEFAULTS,key)))throw Error('生成设置格式无效');
  const result={...EXPERIMENT_DEFAULTS,...value};
  for(const key of ['nativeContinuation','inputRead','inputReadSynthetic','completeToolOutput'])if(typeof result[key]!=='boolean')throw Error('功能开关必须为布尔值');
  if(!['last','turn'].includes(result.inputReadScope))throw Error('输入读取范围必须为 last 或 turn');
  if(!['off','auto','required'].includes(result.outputEnvelope))throw Error('结果封装必须为 off、auto 或 required');
  return result;
}
export const EXPERIMENT_AVAILABILITY=Object.freeze({
  nativeContinuation:{available:true,status:'available',detail:'支持的抗截断模型自动接续长回复。'},
  inputRead:{available:true,status:'available',detail:'通过工具结果提供本轮用户输入，默认读取最后一组连续用户消息。'},
  inputReadSynthetic:{available:true,status:'available',detail:'本地构造读取记录，省去一次输入读取请求。'},
  inputReadScope:{available:true,status:'available',detail:'可读取最后一条或最后一组连续用户消息，系统指令保持原用途。'},
  outputEnvelope:{available:true,status:'available',detail:'普通模型可用工具提交任务结果；必须工具采用提示要求和返回校验。'},
  completeToolOutput:{available:true,status:'available',detail:'抗截断回复在全部续写正常完成后交付；未完成则报错。'}
});
