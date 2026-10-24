// MMDB executor: bounded serial work, per-connection ownership, no offline replay.
export function startMMDB(options={}) {
  if(document.querySelector('mmdb-local-bridge'))return;
  const page=typeof unsafeWindow==='undefined'?window:unsafeWindow;
  const port=Number(options.port)||8765;
  const saved=(key,fallback)=>typeof GM_getValue==='function'?GM_getValue(`mmdb.${key}`,fallback):fallback;
  const persist=(key,value)=>{if(typeof GM_setValue==='function')GM_setValue(`mmdb.${key}`,value);};
  let key=saved('key',options.key?.startsWith('__')?'mmdb':options.key||'mmdb');
  let activeRequest;
  let socket,reconnectTimer,wakeLock,wakeWanted=false,stopped=false,chain=Promise.resolve(),completed=0;
  const jobs=new Map();
  const ui=mountBridgePanel({
    reconnect:()=>{clearTimeout(reconnectTimer);disconnect();connect();},
    saveKey:value=>{key=value;persist('key',value);disconnect();connect();ui.addEvent('连接设置已保存');ui.update({error:''});},
    saveTheme:value=>persist('theme',value),
    savePosition:value=>persist('position',value),
    toggleWake:async()=>{
      wakeWanted=!wakeWanted;
      if(!wakeWanted){await wakeLock?.release();wakeLock=null;ui.update({wake:false});return;}
      if(!navigator.wakeLock){wakeWanted=false;ui.addEvent('此浏览器不支持屏幕常亮，请在系统设置中保持页面运行');return;}
      try{wakeLock=await navigator.wakeLock.request('screen');ui.update({wake:true});wakeLock.addEventListener('release',()=>{wakeLock=null;ui.update({wake:false});});}
      catch{wakeWanted=false;ui.addEvent('屏幕常亮未获准，请保持当前标签页可见');}
    }
  },{apiKey:key,baseURL:`http://127.0.0.1:${port}/v1`,theme:saved('theme','light'),position:saved('position',null)});
  const tell=(owner,message)=>{if(owner?.readyState===1)owner.send(JSON.stringify(message));};
  const session=new GooglePageSession(page,ready=>{ui.update({session:ready});if(ready)connect();},message=>ui.addEvent(message));
  function disconnect(){if(socket){const previous=socket;socket=null;previous.close();for(const job of jobs.values())if(job.owner===previous)job.controller.abort();}ui.update({link:'disconnected'});}
  function connect(){
    if(stopped||!session?.ready||socket?.readyState===0||socket?.readyState===1)return;
    clearTimeout(reconnectTimer);ui.update({link:'connecting'});
    const owner=new WebSocket(`ws://127.0.0.1:${port}/api/build/ws`);socket=owner;
    owner.onopen=()=>tell(owner,{type:'register',executorType:'playground',apiKey:key,clientVersion:`mmdb-${MMDB_VERSION}`});
    owner.onmessage=event=>{
      let msg;try{msg=JSON.parse(event.data);}catch{return;}
      if(msg.type==='registered'){ui.update({link:'connected',error:''});ui.addEvent('已连接本地服务');return;}
      if(msg.type==='body-start'){if(msg.requestId===activeRequest){ui.update({phase:'body'});ui.addEvent('已收到正文，正在交付酒馆');}return;}
      if(msg.type==='cancel'){jobs.get(msg.requestId)?.controller.abort();return;}
      if(msg.type==='settled'){
        if(msg.requestId===activeRequest&&Number.isFinite(msg.elapsedMs))ui.update({busy:false,elapsed:msg.elapsedMs/1000});
        if(msg.status==='finished'){completed++;ui.update({completed,error:''});ui.addEvent('生成完成，已确认上游结束状态');}
        else if(msg.status==='cancelled')ui.addEvent('已停止生成');
        else{ui.update({error:msg.message||'本次生成失败'});ui.addEvent(msg.message||'生成失败');}
        return;
      }
      if(msg.type!=='request')return;
      if(jobs.size>=8){tell(owner,{type:'error',requestId:msg.requestId,status:429,error:{code:'executor_busy',message:'页面队列已满，请稍后重试'}});return;}
      const job={owner,controller:new page.AbortController(),receivedAt:performance.now(),elapsedMs:Number(msg.elapsedMs)||0};jobs.set(msg.requestId,job);
      tell(owner,{type:'progress',requestId:msg.requestId,phase:'queued'});
      chain=chain.catch(()=>{}).then(async()=>{
        if(job.controller.signal.aborted||owner!==socket||owner.readyState!==1)return;
        activeRequest=msg.requestId;const elapsed=()=>Math.max(0,job.elapsedMs+performance.now()-job.receivedAt)/1000;ui.update({busy:true,phase:'preparing',model:msg.model,rounds:msg.round??0,elapsed:elapsed(),error:''});ui.addEvent(msg.round?`继续生成，第 ${msg.round} 次续写`:'收到酒馆请求，正在准备');
        const phaseText={'network-retry':'Google 连接在收到数据前中断，重新验证后重试一次（可能额外消耗额度）','retry-skipped':'等待较久后上游连接失败，已停止自动重复提交',preparing:'正在准备请求',proof:'正在获取 Google 会话验证','request-sent':'请求已发起，等待 Google 响应',headers:'已收到 Google 响应头，等待响应数据',streaming:'已收到首个 Google 数据块'};
        const progress=(phase,details={})=>{tell(owner,{type:'progress',requestId:msg.requestId,phase,...details});ui.update({phase});if(phaseText[phase])ui.addEvent(phaseText[phase]);};
        progress('preparing');
        let lastTick=performance.now(),maxTimerGapMs=0;
        const ticker=setInterval(()=>{const now=performance.now();maxTimerGapMs=Math.max(maxTimerGapMs,Math.round(now-lastTick));lastTick=now;ui.update({elapsed:elapsed()});},1000);
        try{
          const payload=JSON.parse(msg.requestBody);
          await generateWithRecovery(session,payload,job.controller.signal,text=>tell(owner,{type:'stream-chunk',requestId:msg.requestId,chunkBody:text}),progress,{retry:msg.allowNetworkRetry===true});
          if(!job.controller.signal.aborted)tell(owner,{type:'stream-end',requestId:msg.requestId});
        }catch(error){tell(owner,{type:'error',requestId:msg.requestId,status:job.controller.signal.aborted?499:error.status||502,error:{code:job.controller.signal.aborted?'cancelled':error.code||'executor_error',message:job.controller.signal.aborted?'用户已停止生成':error.message||'浏览器执行失败',failurePhase:error.failurePhase,requestWaitMs:error.requestWaitMs,pageVisibility:document.visibilityState,browserOnline:navigator.onLine,maxTimerGapMs:Math.max(maxTimerGapMs,Math.round(performance.now()-lastTick)),authRefreshed:error.authRefreshed}});}
        finally{clearInterval(ticker);ui.update({busy:false,elapsed:elapsed()});}
      }).finally(()=>jobs.delete(msg.requestId));
    };
    owner.onclose=event=>{
      for(const job of jobs.values())if(job.owner===owner)job.controller.abort();
      if(socket!==owner)return;socket=null;ui.update({link:'disconnected'});
      if(event.code===1008||event.code===4008){ui.update({error:event.code===4008?'另一个 AI Studio 执行器已连接，请停用旧脚本或关闭重复标签页。':'连接被拒绝，请确认面板密钥与本地配置一致。'});return;}
      if(!stopped)reconnectTimer=setTimeout(connect,2000);
    };
    owner.onerror=()=>ui.update({error:'无法连接本地服务，请确认启动窗口仍在运行。'});
  }
  document.addEventListener('visibilitychange',async()=>{if(document.visibilityState==='visible'){connect();if(wakeWanted&&navigator.wakeLock&&!wakeLock)try{wakeLock=await navigator.wakeLock.request('screen');ui.update({wake:true});}catch{}}});
  page.addEventListener('pagehide',()=>{stopped=true;clearTimeout(reconnectTimer);disconnect();session.destroy();wakeLock?.release();},{once:true});
  ui.addEvent('请在本页手动发送 hi，完成 Google 会话引导');
  return {ui,session,stop:()=>{stopped=true;clearTimeout(reconnectTimer);disconnect();session.destroy();ui.destroy();}};
}
