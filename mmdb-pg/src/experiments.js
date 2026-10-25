// Support is separate from a saved preference. A successful HTTP response is
// not evidence that an undocumented PG field had any effect.
export const EXPERIMENT_DEFAULTS=Object.freeze({nativeContinuation:false,inputRead:false});
export function experimentSettings(value={}) {
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!Object.hasOwn(EXPERIMENT_DEFAULTS,key)))throw Error('实验设置格式无效');
  const result={...EXPERIMENT_DEFAULTS,...value};
  if(Object.values(result).some(value=>typeof value!=='boolean'))throw Error('实验开关必须为布尔值');
  return result;
}
export const EXPERIMENT_AVAILABILITY=Object.freeze({
  nativeContinuation:{available:true,status:'experimental',detail:'短请求已通过；完整跨轮续写仍待实测。仅支持目录声明的模型。'},
  inputRead:{available:true,status:'experimental',detail:'反代自动读取最后一条 user 文本；每次增加一次模型请求。酒馆无需工具插件。'}
});
