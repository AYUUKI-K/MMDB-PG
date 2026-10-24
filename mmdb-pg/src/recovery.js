// Retry only a connection failure before response data, once, with a new proof.
// A request may already have reached Google; this can consume another generation.
export async function generateWithRecovery(session,payload,signal,chunk,progress,{retry=false,delayMs=1500,retryWindowMs=Infinity,now=()=>performance.now()}={}) {
  let received=false;
  const started=now();
  const check=()=>{if(signal.aborted)throw new DOMException('用户已停止生成','AbortError');};
  for(let attempt=0;attempt<2;attempt++){
    check();
    try {
      return await session.generate(payload,signal,text=>{if(text)received=true;chunk(text);},progress);
    } catch(error){
      check();
      if(!retry||attempt||received||error.code!=='upstream_connection_failed')throw error;
      // The relay owns the overall deadline; retry never resets that budget.
      // An explicitly supplied retry window can still opt out of late replay.
      if(now()-started>=retryWindowMs){
        progress('retry-skipped');
        error.message+=' 本次已长时间等待，未自动重复提交；请检查网络或代理后重试。';
        throw error;
      }
      progress('network-retry');
      await new Promise((resolve,reject)=>{
        const abort=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);reject(new DOMException('用户已停止生成','AbortError'));};
        const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},delayMs);
        signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
      });
    }
  }
}
