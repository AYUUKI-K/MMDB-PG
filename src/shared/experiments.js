// Support is separate from a saved preference. A successful HTTP response is
// not evidence that an undocumented PG field had any effect.
export const EXPERIMENT_DEFAULTS=Object.freeze({nativeContinuation:false,inputRead:false});
export function experimentSettings(value={}) {
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!Object.hasOwn(EXPERIMENT_DEFAULTS,key)))throw Error('生成设置格式无效');
  const result={...EXPERIMENT_DEFAULTS,...value};
  if(Object.values(result).some(value=>typeof value!=='boolean'))throw Error('功能开关必须为布尔值');
  return result;
}
export const EXPERIMENT_AVAILABILITY=Object.freeze({
  nativeContinuation:{available:true,status:'available',detail:'支持的抗截断模型自动接续长回复。'},
  inputRead:{available:true,status:'available',detail:'读取最后一条用户消息，每轮增加一次模型请求。'}
});
