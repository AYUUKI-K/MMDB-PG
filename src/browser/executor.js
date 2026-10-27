// MMDB executor: bounded serial work, per-connection ownership, no offline replay.
export function startMMDB(options={}) {
  if(document.querySelector('mmdb-local-bridge')||document.documentElement.dataset.mmdbBridgeMounted==='true')return;
  document.documentElement.dataset.mmdbBridgeMounted='true';
  const page=typeof unsafeWindow==='undefined'?window:unsafeWindow;
  const port=Number(options.port)||8765;
  const saved=(key,fallback)=>typeof GM_getValue==='function'?GM_getValue(`mmdb.${key}`,fallback):fallback;
  const persist=(key,value)=>{if(typeof GM_setValue==='function')GM_setValue(`mmdb.${key}`,value);};
  let key=saved('key',options.key?.startsWith('__')?'mmdb':options.key||'mmdb');
  let activeRequest,experimentTimer,activationController,activating=false;
  // Remove the retired email suggestions without reading or sending them.
  if(typeof GM_deleteValue==='function')GM_deleteValue('mmdb.accountEmails');
  let sessionRevision=-1;
  let socket,reconnectTimer,catalogTimer,catalogController,wakeLock,wakePending=false,wakeWanted=false,stopped=false,chain=Promise.resolve(),completed=0;
  let keepAliveEnabled=saved('keepAlive',true)!==false;
  const jobs=new Map();
  const ui=mountBridgePanel({
    activate:async()=>{
      if(activating||stopped)return;
      if(jobs.size){ui.update({error:'请先结束酒馆生成，再激活会话。'});return;}
      activating=true;activationController=new page.AbortController();
      clearTimeout(reconnectTimer);disconnect();ui.update({activating:true,error:''});
      try{await session.activate(activationController.signal);if(!stopped){ui.update({session:session.ready});ui.addEvent('Meow · 会话已激活');}}
      catch(error){if(!stopped)ui.update({error:error.message||'激活未完成，请检查 AI Studio 页面。'});}
      finally{activating=false;activationController=null;if(!stopped){ui.update({activating:false});connect();}}
    },
    reconnect:()=>{if(jobs.size||activating)return;clearTimeout(reconnectTimer);disconnect();connect();},
    saveKey:value=>{if(jobs.size||activating)return;key=value;persist('key',value);disconnect();connect();ui.addEvent('连接设置已保存');ui.update({error:''});},
    saveTheme:value=>persist('theme',value),
    saveThemeMode:value=>persist('themeMode',value),
    savePosition:value=>persist('position',value),
    setKeepAlive:value=>{keepAliveEnabled=value===true;persist('keepAlive',keepAliveEnabled);background.setEnabled(keepAliveEnabled);},
    resume:()=>resume(),
    saveExperiments:settings=>{
      if(socket?.readyState!==1||socket.protocolVersion!==2){ui.update({experimentError:'请先连接新版后台。'});return;}
      clearTimeout(experimentTimer);ui.update({experimentSaving:true,experimentError:''});
      tell(socket,{type:'experiments:set',connectionId:socket.connectionId,settings});
      experimentTimer=setTimeout(()=>ui.update({experimentSaving:false,experimentError:'未收到保存确认，请重连检查当前设置。'}),8000);
    },
    toggleWake:async()=>{
      wakeWanted=!wakeWanted;
      if(!wakeWanted){const previous=wakeLock;wakeLock=null;ui.update({wake:false});await previous?.release();return;}
      if(!navigator.wakeLock){wakeWanted=false;ui.addEvent('此浏览器不支持屏幕常亮，请在系统设置中保持页面运行');return;}
      await syncWake();
    }
  },{apiKey:key,baseURL:`http://127.0.0.1:${port}/v1`,theme:saved('theme','dark'),themeMode:saved('themeMode','tavern'),tavernTheme:saved('tavernTheme',null),position:saved('position',null),pageWindow:page,keepAliveEnabled});
  const background=createBackgroundKeepAlive({page,enabled:keepAliveEnabled,changed:({enabled,state})=>ui.update({keepAliveEnabled:enabled,keepAliveState:state})});
  const keepAliveTimer=setInterval(()=>background.ensure(),15000);
  const stopTheme=watchTavernTheme(theme=>ui.update({tavernTheme:theme}));
  const tell=(owner,message)=>{if(owner?.readyState===1)owner.send(JSON.stringify(message));};
  const session=new GooglePageSession(page,ready=>{
    if(sessionRevision!==session.contextVersion){
      sessionRevision=session.contextVersion;clearTimeout(reconnectTimer);disconnect();
    }
    ui.update({session:ready});
    if(!ready){clearTimeout(reconnectTimer);disconnect();return;}
    connect();if(socket?.catalogRevision!==session.contextVersion)refreshCatalog(socket);
  },message=>ui.addEvent(message));
  async function refreshCatalog(owner){
    if(!owner||owner!==socket||owner.readyState!==1||owner.protocolVersion!==2)return;
    clearTimeout(catalogTimer);catalogController?.abort();
    const controller=new page.AbortController();catalogController=controller;
    const revision=session.contextVersion;
    // Periodic refreshes keep the last successful catalog within its original TTL.
    // A new connection or page context must still invalidate previous evidence.
    if(owner.catalogRevision!==revision)tell(owner,{type:'catalog-invalidated',connectionId:owner.connectionId,sessionRevision:revision});
    owner.catalogRevision=revision;
    const timeout=setTimeout(()=>controller.abort(),10000);
    try {
      const raw=await session.listModels(controller.signal);
      if(!controller.signal.aborted&&owner===socket&&revision===session.contextVersion)tell(owner,{type:'model-catalog',connectionId:owner.connectionId,sessionRevision:revision,raw});
    }catch{if(!controller.signal.aborted&&owner===socket)ui.addEvent('模型目录暂未更新，稍后自动重试');}
    finally{
      clearTimeout(timeout);
      if(catalogController===controller){catalogController=null;if(owner===socket&&!stopped)catalogTimer=setTimeout(()=>refreshCatalog(owner),5*60*1000);}
    }
  }
  function disconnect(){clearTimeout(catalogTimer);clearTimeout(experimentTimer);catalogController?.abort();if(socket){const previous=socket;socket=null;previous.close();for(const job of jobs.values())if(job.owner===previous)job.controller.abort();}ui.update({link:'disconnected',experiments:null,experimentSaving:false});}
  function connect(){
    if(stopped||activating||!session?.ready||socket?.readyState===0||socket?.readyState===1)return;
    clearTimeout(reconnectTimer);ui.update({link:'connecting'});
    const owner=new WebSocket(`ws://127.0.0.1:${port}/api/build/ws`);socket=owner;
    owner.onopen=()=>{if(owner===socket)tell(owner,{type:'register',executorType:'playground',apiKey:key,clientVersion:`mmdb-${MMDB_VERSION}`,protocolVersion:2,pageHeartbeat:1});};
    owner.onmessage=event=>{
      if(owner!==socket)return;
      let msg;try{msg=JSON.parse(event.data);}catch{return;}
      if(!msg||typeof msg!=='object'||Array.isArray(msg))return;
      if(msg.type==='registered'){owner.connectionId=msg.connectionId;owner.protocolVersion=msg.protocolVersion;ui.update({link:'connected',error:'',experiments:msg.experiments??null,experimentError:''});ui.addEvent('已连接本地服务');refreshCatalog(owner);return;}
      if(owner.protocolVersion===2&&msg.connectionId!==owner.connectionId)return;
      if(msg.type==='page-ping'){
        if(typeof msg.nonce!=='string'||msg.nonce.length>64)return;
        background.ensure();tell(owner,{type:'page-pong',connectionId:owner.connectionId,nonce:msg.nonce,visibility:document.visibilityState,keepAlive:background.state});return;
      }
      if(msg.type==='experiments'){clearTimeout(experimentTimer);ui.update({experiments:msg,experimentSaving:false,experimentError:msg.error?.message??''});return;}
      if(msg.type==='body-start'){if(msg.requestId===activeRequest)ui.update({phase:'body'});return;}
      if(msg.type==='cancel'){const job=jobs.get(msg.requestId);if(job?.owner===owner){job.controller.abort();if(!job.running)jobs.delete(msg.requestId);}return;}
      if(msg.type==='settled'){
        if(msg.requestId===activeRequest&&Number.isFinite(msg.elapsedMs))ui.update({busy:false,elapsed:msg.elapsedMs/1000});
        if(msg.experiment){ui.addEvent(msg.status==='finished'?'能力验证结束，结果见本地探测记录':msg.message||'能力验证未完成');return;}
        if(msg.status==='finished'){completed++;ui.update({completed,error:''});const detail=generationDiagnosticText(msg.diagnostics);ui.addEvent(`回复已送达${detail?' · '+detail:''}`);}
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
        const phaseText={'network-retry':'连接中断，正在重试一次'};
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
      if([1008,4008].includes(event.code)){ui.update({error:event.code===4008?'已有 AI Studio 页面连接，请先关闭原页面，再点击重连。':'连接被拒绝，请确认面板密钥与本地配置一致。'});return;}
      if(!stopped)reconnectTimer=setTimeout(connect,2000);
    };
    owner.onerror=()=>ui.update({error:'无法连接本地服务，请确认启动窗口仍在运行。'});
  }
  async function syncWake(){
    if(stopped||!wakeWanted||wakeLock||wakePending||!navigator.wakeLock||document.visibilityState!=='visible')return;
    wakePending=true;
    try{
      const lock=await navigator.wakeLock.request('screen');
      if(stopped||!wakeWanted||document.visibilityState!=='visible'){await lock.release();return;}
      wakeLock=lock;ui.update({wake:true});
      lock.addEventListener('release',()=>{if(wakeLock===lock){wakeLock=null;if(!stopped)ui.update({wake:false});}},{once:true});
    }catch{if(!stopped)ui.addEvent('屏幕常亮未获准，后台保活仍按当前设置运行');}
    finally{wakePending=false;}
  }
  function resume(){if(stopped)return;background.ensure();connect();void syncWake();}
  const visible=()=>{if(document.visibilityState==='visible')resume();};
  document.addEventListener('visibilitychange',visible);
  document.addEventListener('resume',resume);page.addEventListener('online',resume);page.addEventListener('focus',resume);
  const stop=()=>{if(stopped)return;stopped=true;activationController?.abort();clearTimeout(reconnectTimer);clearInterval(keepAliveTimer);background.destroy();disconnect();session.destroy();wakeLock?.release();stopTheme();ui.destroy();document.removeEventListener('visibilitychange',visible);document.removeEventListener('resume',resume);page.removeEventListener('online',resume);page.removeEventListener('focus',resume);page.removeEventListener('pagehide',stop);delete document.documentElement.dataset.mmdbBridgeMounted;};
  page.addEventListener('pagehide',stop,{once:true});
  return {ui,session,stop};
}
