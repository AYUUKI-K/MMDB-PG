// Never replay an in-flight generation. Recovery only prepares future requests.
export function createRuntimeWatchdog(recover,{schedule=setTimeout,cancel=clearTimeout,now=Date.now,intervalMs=15000}={}){
  let stopped=false,timer,flight,failures=0,state='checking',nextCheckAt=now();
  function tick(){
    if(stopped||flight)return flight;
    flight=Promise.resolve().then(recover).then(()=>{failures=0;state='watching';},()=>{failures++;state='retrying';}).finally(()=>{
      flight=null;if(stopped)return;const wait=Math.min(300000,intervalMs*2**Math.min(failures,5));nextCheckAt=now()+wait;timer=schedule(tick,wait);timer?.unref?.();
    });return flight;
  }
  timer=schedule(tick,0);timer?.unref?.();
  return {tick,status:()=>({state,failures,nextCheckAt}),close(){stopped=true;state='stopped';cancel(timer);}};
}
