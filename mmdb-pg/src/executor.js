// MMDB executor: bounded serial work, per-connection ownership, no offline replay.
export function startMMDB(options={}) {
  if(document.querySelector('mmdb-local-bridge'))return;
  const page=typeof unsafeWindow==='undefined'?window:unsafeWindow;
  const port=Number(options.port)||8765;
  const saved=(key,fallback)=>typeof GM_getValue==='function'?GM_getValue(`mmdb.${key}`,fallback):fallback;
  const persist=(key,value)=>{if(typeof GM_setValue==='function')GM_setValue(`mmdb.${key}`,value);};
  let key=saved('key',options.key?.startsWith('__')?'mmdb':options.key||'mmdb');
  let activeRequest,experimentTimer;
  const profileId=saved('profileId','')||('profile-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2));persist('profileId',profileId);
  const accountInfo=()=>{const index=String(session.headers?.['x-goog-authuser']??(page.location?.pathname?.match(/\/u\/(\d+)\//)?.[1]??'0'));return {accountId:profileId+':'+index,accountLabel:'账号位 '+index};};
  let socket,reconnectTimer,catalogTimer,catalogController,wakeLock,wakeWanted=false,stopped=false,chain=Promise.resolve(),completed=0;
  const jobs=new Map();
  const ui=mountBridgePanel({
    reconnect:()=>{clearTimeout(reconnectTimer);disconnect();connect();},
    saveKey:value=>{key=value;persist('key',value);disconnect();connect();ui.addEvent('连接设置已保存');ui.update({error:''});},
    saveTheme:value=>persist('theme',value),
    savePosition:value=>persist('position',value),
    saveExperiments:settings=>{
      if(socket?.readyState!==1||socket.protocolVersion!==2){ui.update({experimentError:'请先连接新版后台。'});return;}
      clearTimeout(experimentTimer);ui.update({experimentSaving:true,experimentError:''});
      tell(socket,{type:'experiments:set',connectionId:socket.connectionId,settings});
      experimentTimer=setTimeout(()=>ui.update({experimentSaving:false,experimentError:'未收到保存确认，请重连检查当前设置。'}),8000);
    },
    toggleWake:async()=>{
      wakeWanted=!wakeWanted;
      if(!wakeWanted){await wakeLock?.release();wakeLock=null;ui.update({wake:false});return;}
      if(!navigator.wakeLock){wakeWanted=false;ui.addEvent('此浏览器不支持屏幕常亮，请在系统设置中保持页面运行');return;}
      try{wakeLock=await navigator.wakeLock.request('screen');ui.update({wake:true});wakeLock.addEventListener('release',()=>{wakeLock=null;ui.update({wake:false});});}
      catch{wakeWanted=false;ui.addEvent('屏幕常亮未获准，请保持当前标签页可见');}
    }
  },{apiKey:key,baseURL:`http://127.0.0.1:${port}/v1`,theme:saved('theme','light'),position:saved('position',null)});
  const tell=(owner,message)=>{if(owner?.readyState===1)owner.send(JSON.stringify(message));};
  const session=new GooglePageSession(page,ready=>{ui.update({session:ready});if(ready){if(socket&&socket.accountId!==accountInfo().accountId)disconnect();connect();if(socket?.catalogRevision!==session.contextVersion)refreshCatalog(socket);}},message=>ui.addEvent(message));
  async function refreshCatalog(owner){
    if(!owner||owner!==socket||owner.readyState!==1||owner.protocolVersion!==2)return;
    clearTimeout(catalogTimer);catalogController?.abort();
    const controller=new page.AbortController();catalogController=controller;
    const revision=session.contextVersion;owner.catalogRevision=revision;
    tell(owner,{type:'catalog-invalidated',connectionId:owner.connectionId,sessionRevision:revision});
    const timeout=setTimeout(()=>controller.abort(),10000);
    try {
      const raw=await session.listModels(controller.signal);
      if(!controller.signal.aborted&&owner===socket&&revision===session.contextVersion)tell(owner,{type:'model-catalog',connectionId:owner.connectionId,sessionRevision:revision,raw});
    }catch{if(!controller.signal.aborted&&owner===socket)ui.addEvent('模型能力目录暂不可用，保留普通交付与提示词续写');}
    finally{
      clearTimeout(timeout);
      if(catalogController===controller){catalogController=null;if(owner===socket&&!stopped)catalogTimer=setTimeout(()=>refreshCatalog(owner),5*60*1000);}
    }
  }
  function disconnect(){clearTimeout(catalogTimer);clearTimeout(experimentTimer);catalogController?.abort();if(socket){const previous=socket;socket=null;previous.close();for(const job of jobs.values())if(job.owner===previous)job.controller.abort();}ui.update({link:'disconnected',experiments:null,experimentSaving:false});}
  function connect(){
    if(stopped||!session?.ready||socket?.readyState===0||socket?.readyState===1)return;
    clearTimeout(reconnectTimer);ui.update({link:'connecting'});
    const owner=new WebSocket(`ws://127.0.0.1:${port}/api/build/ws`);socket=owner;owner.accountId=accountInfo().accountId;
    owner.onopen=()=>tell(owner,{type:'register',executorType:'playground',apiKey:key,clientVersion:`mmdb-${MMDB_VERSION}`,protocolVersion:2,...accountInfo()});
    owner.onmessage=event=>{
      if(owner!==socket)return;
      let msg;try{msg=JSON.parse(event.data);}catch{return;}
      if(!msg||typeof msg!=='object'||Array.isArray(msg))return;
      if(msg.type==='registered'){owner.connectionId=msg.connectionId;owner.protocolVersion=msg.protocolVersion;ui.update({link:'connected',error:'',experiments:msg.experiments??null,experimentError:''});ui.addEvent('已连接本地服务');refreshCatalog(owner);return;}
      if(owner.protocolVersion===2&&msg.connectionId!==owner.connectionId)return;
      if(msg.type==='account-pool'){ui.addEvent(`${msg.accountLabel} · 本地账号池 ${msg.online} 个页面在线`);return;}
      if(msg.type==='experiments'){clearTimeout(experimentTimer);ui.update({experiments:msg,experimentSaving:false,experimentError:msg.error?.message??''});return;}
      if(msg.type==='body-start'){if(msg.requestId===activeRequest){ui.update({phase:'body'});ui.addEvent('已收到正文，正在交付酒馆');}return;}
      if(msg.type==='cancel'){const job=jobs.get(msg.requestId);if(job?.owner===owner){job.controller.abort();if(!job.running)jobs.delete(msg.requestId);}return;}
      if(msg.type==='settled'){
        if(msg.requestId===activeRequest&&Number.isFinite(msg.elapsedMs))ui.update({busy:false,elapsed:msg.elapsedMs/1000});
        if(msg.experiment){ui.addEvent(msg.status==='finished'?'能力验证结束，结果见本地探测记录':msg.message||'能力验证未完成');return;}
        if(msg.diagnostics)ui.addEvent(`[${String(msg.requestId).slice(0,8)}] ${generationDiagnosticText(msg.diagnostics)}`);
        if(msg.status==='finished'){completed++;ui.update({completed,error:''});ui.addEvent('生成完成，已确认上游结束状态');}
        else if(msg.status==='cancelled')ui.addEvent('已停止生成');
        else{ui.update({error:msg.message||'本次生成失败'});ui.addEvent(msg.message||'生成失败');}
        return;
      }
      if(msg.type!=='request')return;
      if(jobs.has(msg.requestId))return;
      let attemptIndex=0;
      const reply=message=>tell(owner,{...message,requestId:msg.requestId,logicalRequestId:msg.logicalRequestId,connectionId:owner.connectionId,attemptIndex});
      if(jobs.size>=8){reply({type:'error',status:429,error:{code:'executor_busy',message:'页面队列已满，请稍后重试'}});return;}
      const job={owner,controller:new page.AbortController(),receivedAt:performance.now(),elapsedMs:Number(msg.elapsedMs)||0,running:false};jobs.set(msg.requestId,job);
      reply({type:'progress',phase:'queued'});
      chain=chain.catch(()=>{}).then(async()=>{
        if(job.controller.signal.aborted||owner!==socket||owner.readyState!==1)return;
        job.running=true;
        activeRequest=msg.requestId;const elapsed=()=>Math.max(0,job.elapsedMs+performance.now()-job.receivedAt)/1000;ui.update({busy:true,phase:'preparing',model:msg.model,rounds:msg.round??0,elapsed:elapsed(),error:'',...(msg.experiment?{experimentUsage:'probe'}:msg.experimentUsage?{experimentUsage:msg.experimentUsage}:{})});ui.addEvent(msg.experiment?'正在验证 Playground 能力':msg.round?`继续生成，第 ${msg.round} 次续写`:'收到酒馆请求，正在准备');
        const phaseText={'network-retry':'Google 连接在收到数据前中断，正在重新验证并重试一次',preparing:'正在准备请求',proof:'正在获取 Google 会话验证','request-sent':'请求已发起，等待 Google 响应',headers:'已收到 Google 响应头，等待响应数据',streaming:'已收到首个 Google 数据块'};
        const progress=(phase,details={})=>{if(phase==='network-retry')attemptIndex++;reply({type:'progress',phase,...details});ui.update({phase});if(phaseText[phase])ui.addEvent(phaseText[phase]);};
        progress('preparing');
        const ticker=setInterval(()=>ui.update({elapsed:elapsed()}),1000);
        try{
          const payload=JSON.parse(msg.requestBody);
          await generateWithRecovery(session,payload,job.controller.signal,text=>reply({type:'stream-chunk',chunkBody:text}),progress,{retry:msg.allowNetworkRetry===true});
          if(!job.controller.signal.aborted)reply({type:'stream-end'});
        }catch(error){reply({type:'error',status:job.controller.signal.aborted?499:error.status||502,error:{code:job.controller.signal.aborted?'cancelled':error.code||'executor_error',message:job.controller.signal.aborted?'用户已停止生成':error.message||'浏览器执行失败'}});}
        finally{clearInterval(ticker);ui.update({busy:false,elapsed:elapsed()});}
      }).finally(()=>{if(jobs.get(msg.requestId)===job)jobs.delete(msg.requestId);});
    };
    owner.onclose=event=>{
      for(const job of jobs.values())if(job.owner===owner)job.controller.abort();
      if(socket!==owner)return;socket=null;clearTimeout(catalogTimer);clearTimeout(experimentTimer);catalogController?.abort();ui.update({link:'disconnected',experiments:null,experimentSaving:false});
      if(event.code===1008||event.code===4008){ui.update({error:event.code===4008?'同一账号已有页面连接，或本地账号池已满（最多 8 个）。':'连接被拒绝，请确认面板密钥与本地配置一致。'});return;}
      if(!stopped)reconnectTimer=setTimeout(connect,2000);
    };
    owner.onerror=()=>ui.update({error:'无法连接本地服务，请确认启动窗口仍在运行。'});
  }
  document.addEventListener('visibilitychange',async()=>{if(document.visibilityState==='visible'){connect();if(wakeWanted&&navigator.wakeLock&&!wakeLock)try{wakeLock=await navigator.wakeLock.request('screen');ui.update({wake:true});}catch{}}});
  page.addEventListener('pagehide',()=>{stopped=true;clearTimeout(reconnectTimer);disconnect();session.destroy();wakeLock?.release();},{once:true});
  ui.addEvent('请在本页手动发送 hi，完成 Google 会话引导');
  return {ui,session,stop:()=>{stopped=true;clearTimeout(reconnectTimer);disconnect();session.destroy();ui.destroy();}};
}
