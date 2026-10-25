import http from 'node:http';
import {readFileSync, writeFileSync, existsSync, unlinkSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {randomUUID, timingSafeEqual} from 'node:crypto';
import {WebSocketServer, WebSocket} from 'ws';
import {ApiError, normalizeModel, fromOpenAI, toWire, FrameParser, decodeFrame, geminiChunk, openAIUsage, finishOpenAI, assertSuccessfulFinish} from './protocol.mjs';
import {readConfig,saveExperimentalConfig} from './config.mjs';
import {modelMode, nextTurn, NativeContinuation, joinContinuation, continuationBudget} from './continuation.mjs';
import {decodeModelCatalog,modelCapability,supportsNativeContinuation,CATALOG_TTL_MS} from './capabilities.mjs';
import {RequestDeadlines} from './deadlines.mjs';
import {envelopePayload, AnswerEnvelope, ANSWER_TOOL} from './anti-truncation.mjs';
import {MMDB_VERSION} from './src/version.js';
import {diagnosticHistory} from './diagnostics.mjs';
import {AttemptTrace,generationSummary,phaseFields} from './metrics.mjs';
import {json,jsonHeartbeat} from './json-response.mjs';
import {runExperimentProbe} from './experiment-probes.mjs';
import {experimentSettings,EXPERIMENT_AVAILABILITY} from './src/experiments.js';
import {InputRead} from './input-read.mjs';

const dir = fileURLToPath(new URL('.', import.meta.url));
export function loadConfig() {
  return readConfig();
}
const same = (a, b) => { if (typeof a !== 'string') return false; const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
function fail(res, e) {
  const error = {message: e.message || '内部错误', type: 'relay_error', code: e.code ?? 'internal_error'};
  if (res.headersSent && String(res.getHeader('Content-Type')).startsWith('text/event-stream')) { if (!res.destroyed && !res.writableEnded) { res.write(`data: ${JSON.stringify({error})}\n\n`); res.end(); } }
  else json(res, e.status ?? 500, {error});
}
async function bodyJSON(req) {
  const buffers = []; let bytes = 0;
  for await (const chunk of req) { bytes += chunk.length; if (bytes > 4 * 1024 * 1024) throw new ApiError(413, '请求体超过 4 MiB'); buffers.push(chunk); }
  try { const value = JSON.parse(Buffer.concat(buffers).toString('utf8')); if (!value || Array.isArray(value) || typeof value !== 'object') throw 0; return value; }
  catch { throw new ApiError(400, '请求体必须为 JSON 对象'); }
}
export function createRelay(config) {
  const pending = new Map(), history=diagnosticHistory(config.diagnosticsPath),recent=history.recent; let executor = null;
  const executors=new Set(),accountStates=new Map();let accountTurn=0;
  const accountState=ws=>accountStates.get(ws.accountId);
  const cooling=(ws,model)=>Math.max(0,(accountState(ws)?.cooldowns.get(model)??0)-Date.now());
  const selectExecutor=(model,excluded=new Set())=>{
    const ready=[...executors].filter(ws=>ws.readyState===WebSocket.OPEN&&!ws.probeActive&&!excluded.has(ws.accountId)&&!cooling(ws,model));
    const load=ws=>[...pending.values()].filter(task=>task.owner===ws).length;
    ready.sort((a,b)=>load(a)-load(b)||a.lastUsed-b.lastUsed);
    const selected=ready[0];if(selected)selected.lastUsed=++accountTurn;return selected;
  };
  const sendPool=()=>{for(const ws of executors)send(ws,{type:'account-pool',connectionId:ws.connectionId,online:executors.size,accountLabel:ws.accountLabel});};
  const send = (ws, data) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data)); };
  const experiments=(target=executor)=>({settings:experimentSettings({nativeContinuation:config.nativeContinuation===true,inputRead:config.inputRead===true}),availability:EXPERIMENT_AVAILABILITY,
    nativeModels:config.models.filter(model=>supportsNativeContinuation(modelCapability(target,model))),busy:pending.size>0});
  const sendExperiments=()=>{for(const ws of executors)if(ws.protocolVersion===2)send(ws,{type:'experiments',connectionId:ws.connectionId,...experiments(ws)});};
  const saveExperiments=value=>{
    let settings;try{if(!value||typeof value!=='object'||Array.isArray(value))throw Error();settings=experimentSettings({...experiments().settings,...value});}catch{throw new ApiError(400,'实验设置格式无效','invalid_experiment_settings');}
    if(pending.size)throw new ApiError(409,'生成或验证进行中，请结束后再修改实验设置','experiment_busy');
    try{config.persistExperiments?.(settings);}catch{throw new ApiError(500,'无法保存实验设置，原设置保持不变','experiment_save_failed');}
    config.nativeContinuation=settings.nativeContinuation;config.inputRead=settings.inputRead;sendExperiments();return experiments();
  };
  function validHost(req) { return [`127.0.0.1:${server.address()?.port}`, `localhost:${server.address()?.port}`].includes(req.headers.host); }
  function validOrigin(req) { return !req.headers.origin || ['https://aistudio.google.com', `http://127.0.0.1:${server.address()?.port}`, `http://localhost:${server.address()?.port}`].includes(req.headers.origin); }
  const authorized = req => same(req.headers.authorization?.replace(/^Bearer\s+/i, '') ?? req.headers['x-goog-api-key'], config.apiKey);
  const server = http.createServer(async (req, res) => {
    try {
      if (!validHost(req) || !validOrigin(req)) throw new ApiError(403, '不允许的 Host 或 Origin');
      if (req.headers.origin) { res.setHeader('Access-Control-Allow-Origin', req.headers.origin); res.setHeader('Vary', 'Origin'); }
      if (req.method === 'OPTIONS') { res.writeHead(204, {'Access-Control-Allow-Headers': 'Authorization,Content-Type,x-goog-api-key', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'}); res.end(); return; }
      const url = new URL(req.url, 'http://127.0.0.1');
      if (req.method === 'GET' && url.pathname === '/health') { json(res, 200, {service: 'local-pg', version:`mmdb-${MMDB_VERSION}`, executorOnline: !!executor, pending: pending.size}); return; }
      if (req.method === 'GET' && url.pathname === '/preview') { res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}); res.end(readFileSync(`${dir}preview.html`)); return; }
      if (req.method === 'GET' && url.pathname === '/') {
        res.writeHead(200, {'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store'});
        res.end(`本机 PG 反代\n\n执行器: ${executor ? '已连接' : '未连接，请安装脚本并在 AI Studio 手动发送 hi'}\n\n安装油猴脚本: http://127.0.0.1:${server.address().port}/local-pg.user.js\nOpenAI Base URL: http://127.0.0.1:${server.address().port}/v1\n密钥保存在程序目录 config.json\n\n用法见 README.md。`); return;
      }
      if (req.method === 'GET' && ['/local-pg.user.js','/local-pg.meta.js'].includes(url.pathname)) {
        const source = readFileSync(`${dir}local-pg.user.js`, 'utf8').replaceAll('"__LOCAL_PG_KEY__"',()=>JSON.stringify(config.apiKey)).replaceAll('__LOCAL_PG_PORT__', String(server.address().port));
        res.writeHead(200, {'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'}); res.end(url.pathname.endsWith('.meta.js') ? source.slice(0,source.indexOf('// ==/UserScript==')+'// ==/UserScript=='.length)+'\n' : source); return;
      }
      if (!authorized(req)) throw new ApiError(401, '本机 API Key 不正确', 'unauthorized');
      if(url.pathname==='/v1/experiments'&&req.method==='GET'){json(res,200,experiments());return;}
      if(url.pathname==='/v1/experiments'&&req.method==='POST'){json(res,200,saveExperiments(await bodyJSON(req)));return;}
      if(req.method==='POST'&&url.pathname==='/v1/experiments/probe'){
        const result=await runExperimentProbe({body:await bodyJSON(req),owner:executor,pending,send,res,models:config.models,onChange:sendExperiments});
        json(res,200,result);return;
      }
      if (req.method === 'GET' && url.pathname === '/v1/status') {
        const catalogState=executor?.catalog?(Date.now()-executor.catalogAt<CATALOG_TTL_MS?'ready':'stale'):executor?.catalogState??'unavailable';
        json(res,200,{version:MMDB_VERSION,revision:`release-${MMDB_VERSION}`,executorOnline:!!executor,executorVersion:executor?.mmdbVersion??null,
          executorProtocol:executor?.protocolVersion??1,nativeContinuationEnabled:config.nativeContinuation===true,
          catalog:{state:catalogState,models:config.models.map(model=>({model,capability:modelCapability(executor,model)??null}))},
          accounts:[...executors].map(ws=>({id:ws.connectionId.slice(0,8),label:ws.accountLabel,pending:[...pending.values()].filter(task=>task.owner===ws).length,cooldowns:[...(accountState(ws)?.cooldowns??[])].filter(([,until])=>until>Date.now()).map(([model,until])=>({model,retryAt:new Date(until).toISOString()}))})),
          experiments:experiments(),pending:pending.size,active:[...new Set(pending.values())].map(task=>task.diagnostics()),recent});return;
      }
      if (req.method === 'GET' && ['/v1/models', '/v1beta/models'].includes(url.pathname)) {
        const models = config.models.flatMap(m => [`pg-${m}`,`pg-${m}-抗截断`]);
        json(res, 200, url.pathname.startsWith('/v1/') ? {object: 'list', data: models.map(id => ({id, object: 'model', owned_by: 'local-playground'}))} : {models: models.map(id => ({name: `models/${id}`, displayName: id, supportedGenerationMethods: ['generateContent', 'streamGenerateContent']}))}); return;
      }
      const native = /^\/v1beta\/models\/([^/:]+):(generateContent|streamGenerateContent)$/.exec(url.pathname);
      const openai = url.pathname === '/v1/chat/completions';
      if (req.method !== 'POST' || (!native && !openai)) throw new ApiError(404, '接口不存在');
      const body = await bodyJSON(req);
      if (openai && body.stream !== undefined && typeof body.stream !== 'boolean') throw new ApiError(400, 'stream 必须为布尔值');
      const requestedModel = normalizeModel(openai ? body.model : decodeURIComponent(native[1]));
      const {model,extended} = modelMode(requestedModel);
      const originalBody = openai ? fromOpenAI(body) : body;
      const encodeText = request => extended ? envelopePayload(model,request,{style:config.toolPromptStyle??'legacy'}) : toWire(model,request);
      // Validate the entire original request before replacing any input parts.
      let basePayload=encodeText(originalBody);
      const inputRead=config.inputRead===true?new InputRead(originalBody):null;
      const encodePayload=request=>inputRead?inputRead.answerPayload(request,encodeText):encodeText(request);
      if (!executor) throw new ApiError(503, '浏览器执行器未连接，请打开 AI Studio，等待脚本就绪并发送 hi', 'executor_offline');

      if (pending.size >= 8) throw new ApiError(429, '本机队列已满，请稍后再试', 'queue_full');
      let owner=selectExecutor(model);
      if(!owner)throw new ApiError([...executors].every(ws=>ws.probeActive)?409:429,'当前已连接账号都在冷却或验证中，请稍后重试','accounts_unavailable');
      const triedAccounts=new Set([owner.accountId]);
      let capability=modelCapability(owner,model);
      if(inputRead&&capability&&!capability.functionDeclarations)throw new ApiError(400,'所选模型不支持函数工具，不能读取输入','input_read_unsupported');
      let useNative=extended&&config.nativeContinuation===true&&owner.protocolVersion===2&&supportsNativeContinuation(capability);
      let nativeContinuation=!inputRead&&useNative?new NativeContinuation(basePayload,capability):null;
      let payload=inputRead?inputRead.initialPayload(model):nativeContinuation?nativeContinuation.payload():basePayload;
      // This private PG wire has no verified response-model mapping. Never
      // present the selected model, generated self-description or an unknown
      // array slot as proof of the model that actually served the request.
      const modelIdentity={requested:requestedModel,sent:payload.wire[0],reported:null,verification:'unavailable'};
      const streaming = openai ? body.stream === true : native[2] === 'streamGenerateContent';
      const id = randomUUID(), created = Math.floor(Date.now() / 1000), started = Date.now(), parts = [];
      let reason, responseId, roleSent = false, ended = false, round = 0, currentId = id, currentPartsStart = 0;
      let envelope=new AnswerEnvelope(),toolCallsObserved=false,roundHasData=false,roundHasContent=false,attemptIndex=0;
      let continuationBuffer='',previousRoundText='';
      const deadlines=new RequestDeadlines(config,{extended,queued:owner.protocolVersion===2});
      const firstByteWaitMs=extended?(config.toolFirstByteTimeoutMs??config.timeoutMs):config.timeoutMs;
      const timing={accountSwitches:0,networkRetries:0,streamRequested:streaming,clientKeepAlives:0,upstreamChunks:0,upstreamBytes:0,frames:0,bodyChunks:0,bodyChars:0,plainTextChunks:0,plainTextChars:0,thoughtChunks:0,thoughtChars:0,phase:'dispatched',phaseAtMs:0,firstByteWaitMs};
      const sinceStart=()=>Date.now()-started;
      const trace=new AttemptTrace({nativeContinuation:!!nativeContinuation});trace.begin(0,0,inputRead?'input-read':'initial');
      const generation={...generationSummary(basePayload),...(nativeContinuation?{nativeOutputBudget:nativeContinuation.total}:{})};
      const diagnostics=()=>({id:id.slice(0,8),model:requestedModel,modelIdentity,startedAt:new Date(started).toISOString(),elapsedMs:sinceStart(),rounds:round,...timing,generation,...trace.snapshot(),inputReadEnabled:!!inputRead,inputReadCompleted:inputRead?.ready===true,inputReadCalls:inputRead?.calls??0,continuationMode:nativeContinuation?'native':extended?'prompt':'none',...(extended?{transport:'tool-envelope',toolObserved:toolCallsObserved,toolGuard:'tail-user-v1',toolPromptStyle:config.toolPromptStyle??'legacy',assistantTail:originalBody.contents.at(-1)?.role==='model'}:{}),...(reason?{finishReason:reason}:{})});
      const sendTask=message=>send(owner,{...message,...(message.type==='request'?{modelIdentity}:{}),requestId:currentId,logicalRequestId:id,connectionId:owner.connectionId,attemptIndex});
      const ensureSSE = () => {
        if (res.destroyed) throw new ApiError(499, '调用方已断开', 'client_disconnected');
        if (!res.headersSent) {res.setHeader('Content-Type','text/event-stream; charset=utf-8');res.writeHead(200, {'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'});}
        if (res.writableLength > 2 * 1024 * 1024) throw new ApiError(502, '调用方读取过慢', 'slow_client');
      };
      const streamWrite = data => {
        ensureSSE();
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };
      const oaChunk = (delta, finish_reason = null, extra = {}) => ({id: `chatcmpl-${id}`, object: 'chat.completion.chunk', created, model: `pg-${requestedModel}`, choices: [{index: 0, delta, finish_reason}], ...extra});
      const forwardParts = incoming => {
        const clean=incoming.map(({text,thought,thoughtSignature})=>({...((typeof text==='string')?{text}:{}),...(thought?{thought:true}:{}),...(thoughtSignature?{thoughtSignature}:{})}));
        parts.push(...clean);
        if(timing.firstBodyMs===undefined&&owner.mmdb&&clean.some(part=>!part.thought&&part.text))sendTask({type:'body-start'});
        for(const part of clean)if(!part.thought&&part.text){trace.body(part.text.length,sinceStart());timing.bodyChunks++;timing.bodyChars+=part.text.length;timing.firstBodyMs??=sinceStart();timing.lastBodyMs=sinceStart();}
        if(!streaming||!clean.length)return;
        if(openai){
          if(!roleSent){streamWrite(oaChunk({role:'assistant'}));roleSent=true;}
          for(const part of clean)if(typeof part.text==='string'){
            if(!part.thought&&part.text)timing.firstClientTextMs??=sinceStart();
            streamWrite(oaChunk({[part.thought?'reasoning_content':'content']:part.text}));
          }
        }else{if(clean.some(part=>!part.thought&&part.text))timing.firstClientTextMs??=sinceStart();streamWrite(geminiChunk({parts:clean}));}
      };
      const makeParser = () => new FrameParser(frame => {
        timing.frames++;timing.firstFrameMs??=sinceStart();
        const reading=inputRead&&!inputRead.ready;
        const event = decodeFrame(frame,{decodeFunctionCall:reading?(call,meta)=>inputRead.decode(call,meta):extended?call=>{const part=envelope.decode(call);return part?{...part,fromTool:true}:null;}:undefined});
        if(reason&&(event.functionCallCount||event.parts.some(part=>part.text)))throw new ApiError(502,'完成状态后仍收到生成内容，未将异常响应标为成功','invalid_upstream');
        trace.frame(event.usageMetadata,event.finishReason);
        if(reading){inputRead.observe(frame,event);reason=event.finishReason??reason;roundHasContent ||= inputRead.calls>0;return;}
        nativeContinuation?.observe(event);
        roundHasContent ||= event.parts.some(part=>part.text?.trim()&&(!extended||part.fromTool));
        toolCallsObserved ||= envelope.observed;
        reason = event.finishReason ?? reason; responseId = event.responseId ?? responseId;
        for(const part of event.parts)if(part.text){
          if(part.thought){timing.thoughtChunks++;timing.thoughtChars+=part.text.length;}
          else if(!part.fromTool){timing.plainTextChunks++;timing.plainTextChars+=part.text.length;timing.firstPlainTextMs??=sinceStart();}
        }
        // A selected tool-only route must never silently become plain output.
        // Reject at the first visible ordinary body instead of discarding a
        // whole answer and reporting the mismatch minutes later at STOP.
        if(extended&&event.parts.some(part=>!part.thought&&!part.fromTool&&part.text?.trim()))throw new ApiError(502,envelope.observed?'上游混合输出工具正文和普通正文，无法保证完整交付，本次生成已停止。':'模型开始输出普通正文，未调用正文工具；本次工具模式已停止，未切换为普通输出。',envelope.observed?'mixed_tool_output':'tool_not_used');
        // Anti-truncation must not silently accept an ordinary text answer.
        const deliver=event.parts.filter(part=>!extended||part.thought||part.fromTool);
        if(extended&&!nativeContinuation&&round>0){
          // A prompt continuation can replay previous paragraphs. Commit its
          // body only after clean transport completion and exact seam checks.
          for(const part of deliver)if(part.fromTool)continuationBuffer+=part.text??'';
          forwardParts(deliver.filter(part=>!part.fromTool));
        }else forwardParts(deliver);
      });
      let parser = makeParser();
      const receive = raw => {
        trace.data(sinceStart());
        roundHasData=true;
        if(timing.phase!=='streaming'){timing.phase='streaming';timing.phaseAtMs=sinceStart();timing.streamingMs??=sinceStart();}
        timing.upstreamChunks++;timing.upstreamBytes+=Buffer.byteLength(raw);timing.firstUpstreamMs??=sinceStart();timing.lastUpstreamMs=sinceStart();
        if(parser.raw.length+raw.length>32*1024*1024)throw new ApiError(502,'上游响应超过 32 MiB','upstream_too_large');
        parser.push(raw);
        deadlines.data(sinceStart(),roundHasContent);
      };
      let timer,keepAlive;
      const cleanup = (status,message='',errorCode) => {
        ended = true; clearTimeout(timer);clearInterval(keepAlive); pending.delete(currentId);sendExperiments();
        trace.end(status,sinceStart());
        history.add({...diagnostics(),status,...(errorCode?{errorCode}:{})});
        if(owner.mmdb){const {usage,usageComplete,attempts}=trace.snapshot();sendTask({type:'settled',status,message,elapsedMs:sinceStart(),diagnostics:{id:id.slice(0,8),modelIdentity,finishReason:reason??null,rounds:round,usage,usageComplete,attempts}});}
      };
      const abort = error => { if (ended) return; sendTask({type:'cancel'}); cleanup(error.status===499?'cancelled':'failed',error.message,error.code); fail(res, error); };
      // Re-arm against absolute deadlines, never against progress or heartbeats.
      const refreshIdleTimer = () => {
        if (ended) return;
        clearTimeout(timer);
        const deadline=deadlines.next();
        timer = setTimeout(() => abort(new ApiError(504,deadline.message,deadline.code)),Math.max(0,deadline.at-sinceStart()));
      };
      refreshIdleTimer();
      keepAlive=setInterval(()=>{
        if(ended||res.writableEnded)return;
        try{if(streaming){ensureSSE();res.write(': mmdb-waiting\n\n');}else jsonHeartbeat(res);timing.clientKeepAlives++;timing.lastKeepAliveMs=sinceStart();}catch(error){abort(error);}
      },config.streamKeepAliveMs??15000);
      const finish = () => {
        parser.end();
        if(inputRead&&!inputRead.ready){
          inputRead.complete(reason);
          basePayload=encodePayload(originalBody);
          nativeContinuation=useNative?new NativeContinuation(basePayload,capability):null;
          trace.end('finished',sinceStart());trace.nativeContinuation=!!nativeContinuation;
          trace.begin(sinceStart(),0,'initial');
          const previous=pending.get(currentId);pending.delete(currentId);currentId=`${id}-answer`;
          reason=undefined;responseId=undefined;roundHasData=false;roundHasContent=false;attemptIndex=0;
          timing.phase='dispatched';timing.phaseAtMs=sinceStart();
          if(nativeContinuation)generation.nativeOutputBudget=nativeContinuation.total;
          parser=makeParser();pending.set(currentId,previous);deadlines.round(sinceStart(),owner.protocolVersion===2);refreshIdleTimer();
          sendTask({type:'request',model,round,allowNetworkRetry:false,elapsedMs:sinceStart(),stream:true,requestBody:JSON.stringify(nativeContinuation?nativeContinuation.payload():basePayload)});return;
        }
        assertSuccessfulFinish(reason,{allowContinuation:!!nativeContinuation});
        const nextNative=nativeContinuation?.next(reason,config.maxContinuations??2);
        // Intermediate native rounds can carry only a name or thought. Preserve
        // the envelope state until the provider finishes the logical response.
        if(!nextNative){
          if(extended&&!envelope.observed&&['STOP','MAX_TOKENS'].includes(reason))throw new ApiError(502,'工具抗截断未生效：模型未调用正文工具，本次未退回普通输出。','tool_not_used');
          if(extended&&envelope.observed&&!envelope.hasVisibleContent&&['STOP','MAX_TOKENS'].includes(reason))throw new ApiError(502,'上游调用了正文工具但未返回有效正文','empty_tool_envelope');
        }
        if(extended&&!nativeContinuation&&round>0){
          const joined=joinContinuation(parts.filter(p=>!p.thought).map(p=>p.text??'').join(''),continuationBuffer,previousRoundText);
          timing.continuationOverlapChars=(timing.continuationOverlapChars??0)+joined.overlapChars;
          if(!joined.hasProgress&&['STOP','MAX_TOKENS'].includes(reason))throw new ApiError(502,'续写只重复已有正文或没有新增内容，已停止继续请求','continuation_no_progress');
          if(joined.text)forwardParts([{text:joined.text}]);
          continuationBuffer='';
        }
        const visibleThisRound=parts.slice(currentPartsStart).filter(p=>!p.thought).map(p=>p.text??'').join('');
        const budget=extended&&!nativeContinuation?continuationBudget(basePayload.wire[3][3],trace.snapshot({excludeInputRead:true}).usage):{};
        if(budget.remaining!==undefined)timing.continuationRemainingTokens=budget.remaining;
        let nextPrompt=false;
        if(!nativeContinuation&&extended&&reason==='MAX_TOKENS'&&visibleThisRound){
          timing.continuationStop=budget.stop??(round>=(config.maxContinuations??2)?'max_rounds':undefined);
          nextPrompt=!timing.continuationStop;
        }
        if (nextNative || nextPrompt) {
          // Encode before transferring pending ownership, so an encoding error
          // still cancels/cleans up the actual in-flight request ID.
          const nextPayload=nextNative??encodePayload(nextTurn(originalBody,parts.filter(p=>!p.thought).map(p=>p.text??'').join(''),budget.remaining));
          const previous=pending.get(currentId); pending.delete(currentId);
          trace.end('continued',sinceStart());
          previousRoundText=visibleThisRound;
          round++;trace.begin(sinceStart(),round,'continuation'); currentId=`${id}-${round}`; currentPartsStart=parts.length;
          reason=undefined;roundHasData=false;roundHasContent=false;attemptIndex=0;timing.phase='dispatched';timing.phaseAtMs=sinceStart();if(!nativeContinuation)envelope=new AnswerEnvelope();parser=makeParser();pending.set(currentId,previous);deadlines.round(sinceStart(),owner.protocolVersion===2);refreshIdleTimer();
          sendTask({type:'request',model,round,allowNetworkRetry:extended&&!nativeContinuation&&!timing.networkRetries,elapsedMs:sinceStart(),stream:true,requestBody:JSON.stringify(nextPayload)});return;
        }
        // The public response and diagnostics share the same attempt ledger.
        // Failed or missing-usage attempts cannot disappear from aggregate costs.
        const {usage,usageComplete}=trace.snapshot();
        if(!streaming&&parts.some(part=>!part.thought&&part.text))timing.firstClientTextMs??=sinceStart();
        if (streaming) {
          if (openai) {
            streamWrite(oaChunk({}, finishOpenAI(reason)));
            if (body.stream_options?.include_usage && openAIUsage(usage)) streamWrite({...oaChunk({}), choices: [], usage: openAIUsage(usage)});
            res.write('data: [DONE]\n\n');
          } else streamWrite(geminiChunk({parts:[],finishReason:reason,usageMetadata:usage,responseId}));
          res.end();
        } else if (openai) {
          const text = parts.filter(p => !p.thought).map(p => p.text).join('');
          const thought = parts.filter(p => p.thought).map(p => p.text).join('');
          json(res, 200, {id: `chatcmpl-${id}`, object: 'chat.completion', created, model: `pg-${requestedModel}`,
            choices: [{index: 0, message: {role: 'assistant', content: text, ...(thought ? {reasoning_content: thought} : {})}, finish_reason: finishOpenAI(reason)}], ...(openAIUsage(usage) ? {usage: openAIUsage(usage)} : {}),mmdb:{continuations:round,usageComplete,inputReadCompleted:inputRead?.ready===true,continuationMode:nativeContinuation?'native':extended?'prompt':'none',...(extended?{transport:'tool-envelope',toolObserved:toolCallsObserved}:{})}});
        } else json(res, 200, geminiChunk({parts, usageMetadata: usage, finishReason: reason, responseId}));
        cleanup('finished');
      };
      res.on('close', () => { if (!ended) abort(new ApiError(499, '调用方已断开', 'client_disconnected')); });
      pending.set(currentId, {owner, abort, diagnostics, handle(msg) {
        try {
          if(ended)return;
          if(owner.protocolVersion===2){
            if(msg.connectionId!==owner.connectionId||msg.logicalRequestId!==id)return;
            const retry=msg.type==='progress'&&msg.phase==='network-retry'&&msg.attemptIndex===attemptIndex+1&&extended&&!nativeContinuation&&!timing.networkRetries&&!roundHasData;
            if(retry)attemptIndex++;
            else if(msg.attemptIndex!==attemptIndex)return;
          }
          if(msg.type==='progress'){
            if(Object.hasOwn(phaseFields,msg.phase)){
              if(msg.phase==='network-retry'){
                if(!extended||nativeContinuation||timing.networkRetries||roundHasData)return;
                timing.networkRetries++;
              }
              trace.phase(msg.phase,sinceStart(),msg.httpStatus);
              timing.phase=msg.phase;timing.phaseAtMs=sinceStart();timing[phaseFields[msg.phase]]??=sinceStart();
              if(msg.phase==='headers'&&Number.isInteger(msg.httpStatus)&&msg.httpStatus>=100&&msg.httpStatus<=599)timing.upstreamHttpStatus=msg.httpStatus;
              if(['preparing','proof','request-sent','headers','streaming'].includes(msg.phase)){deadlines.start(sinceStart());refreshIdleTimer();}
            }
            return;
          }
          if(msg.type==='error'&&msg.status===429&&msg.error?.code==='upstream_http_error'){
            const state=accountState(owner);
            state.cooldowns.set(model,Date.now()+(config.accountCooldownMs??900000));
            if(state.cooldowns.size>100)state.cooldowns.delete(state.cooldowns.keys().next().value);
            // Only restart an initial request that has never yielded upstream data.
            const next=triedAccounts.size<8&&!round&&!timing.upstreamBytes&&!parts.length&&(!inputRead||!inputRead.ready)?selectExecutor(model,triedAccounts):null;
            if(next){
              sendTask({type:'settled',status:'failed',message:'此账号返回额度限制，已转交其他本地账号。',elapsedMs:sinceStart()});
              sendTask({type:'cancel'});
              trace.end('failed',sinceStart());trace.begin(sinceStart(),0,'account-switch');
              const task=pending.get(currentId);pending.delete(currentId);
              owner=next;task.owner=owner;triedAccounts.add(owner.accountId);timing.accountSwitches++;
              currentId=`${id}-account-${timing.accountSwitches}`;pending.set(currentId,task);attemptIndex=0;
              capability=modelCapability(owner,model);
              if(inputRead&&capability&&!capability.functionDeclarations)throw new ApiError(400,'备用账号模型不支持工具读取输入','input_read_unsupported');
              useNative=extended&&config.nativeContinuation===true&&owner.protocolVersion===2&&supportsNativeContinuation(capability);
              nativeContinuation=!inputRead&&useNative?new NativeContinuation(basePayload,capability):null;trace.nativeContinuation=!!nativeContinuation;
              payload=inputRead?inputRead.initialPayload(model):nativeContinuation?nativeContinuation.payload():basePayload;
              if(nativeContinuation)generation.nativeOutputBudget=nativeContinuation.total;else delete generation.nativeOutputBudget;
              reason=undefined;responseId=undefined;roundHasData=false;roundHasContent=false;envelope=new AnswerEnvelope();parser=makeParser();
              timing.phase='dispatched';timing.phaseAtMs=sinceStart();
              deadlines.round(sinceStart(),owner.protocolVersion===2);refreshIdleTimer();sendExperiments();
              sendTask({type:'request',model,round:0,allowNetworkRetry:!inputRead&&extended&&!nativeContinuation&&!timing.networkRetries,elapsedMs:sinceStart(),stream:true,requestBody:JSON.stringify(payload)});return;
            }
          }
          if (msg.type === 'error') { abort(new ApiError(msg.status >= 400 && msg.status <= 599 ? msg.status : 502, msg.error?.message ?? '执行器失败', msg.error?.code)); return; }
          if (msg.type === 'stream-chunk') {
            if (typeof msg.chunkBody !== 'string') throw new ApiError(502, '执行器数据格式错误');
            if (msg.chunkBody.length) { receive(msg.chunkBody); refreshIdleTimer(); }
          }
          if (msg.type === 'response') { if (typeof msg.rawResponse !== 'string') throw new ApiError(502, '执行器数据格式错误'); receive(msg.rawResponse); finish(); }
          if (msg.type === 'stream-end') finish();
        } catch (e) { abort(e instanceof ApiError ? e : new ApiError(502, '无法解析上游响应，可能是 Google 协议变化', 'invalid_upstream')); }
      }});
      sendExperiments();
      sendTask({type:'request',model,experimentUsage:inputRead?'input-read':!extended?'plain':config.nativeContinuation===true?(nativeContinuation?'native':'unavailable'):'off',allowNetworkRetry:!inputRead&&extended&&!nativeContinuation&&!timing.networkRetries,elapsedMs:sinceStart(),stream:true,requestBody:JSON.stringify(payload)});
    } catch (e) { fail(res, e); }
  });
  const wss = new WebSocketServer({noServer: true, maxPayload: 2 * 1024 * 1024});
  server.on('upgrade', (req, socket, head) => {
    if (!validHost(req) || !validOrigin(req) || req.url !== '/api/build/ws') { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return; }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
  });
  wss.on('connection', ws => {
    let registered = false;
    const deadline = setTimeout(() => ws.close(1008, 'Registration timeout'), 5000);
    ws.alive = true; ws.on('pong', () => { ws.alive = true; }); ws.on('error', () => {});
    ws.on('message', data => {
      let msg; try { msg = JSON.parse(data.toString()); } catch { ws.close(1008, 'Invalid JSON'); return; }
      if (!registered) {
        if (msg?.type !== 'register' || msg.executorType !== 'playground' || !same(msg.apiKey, config.apiKey)) { ws.close(1008, 'Invalid local key'); return; }
        const accountId=typeof msg.accountId==='string'&&/^[a-zA-Z0-9:_-]{1,100}$/.test(msg.accountId)?msg.accountId:randomUUID();
        if(executors.size>=8||[...executors].some(peer=>peer.accountId===accountId)){ws.close(4008,'Account already connected or pool full');return;}
        ws.accountId=accountId;ws.accountLabel=/^账号位 \d{1,3}$/.test(msg.accountLabel??'')?msg.accountLabel:`本地页面 ${executors.size+1}`;
        if(!accountStates.has(accountId))accountStates.set(accountId,{cooldowns:new Map()});
        if(accountStates.size>64)for(const id of accountStates.keys())if(![...executors].some(peer=>peer.accountId===id)&&id!==accountId){accountStates.delete(id);break;}
        ws.lastUsed=0;executors.add(ws);
        clearTimeout(deadline); registered = true; executor ??= ws; ws.mmdb=typeof msg.clientVersion==='string'&&msg.clientVersion.startsWith('mmdb-');ws.mmdbVersion=/^mmdb-[0-9.]{1,16}$/.test(msg.clientVersion??'')?msg.clientVersion:null;
        ws.protocolVersion=msg.protocolVersion===2?2:1;ws.connectionId=randomUUID();ws.sessionRevision=-1;
        send(ws,{type:'registered',protocolVersion:ws.protocolVersion,connectionId:ws.connectionId,experiments:experiments(ws)});sendPool();return;
      }
      if(msg?.type==='experiments:set'){
        if(!executors.has(ws)||ws.protocolVersion!==2||msg.connectionId!==ws.connectionId)return;
        try{saveExperiments(msg.settings);}catch(error){send(ws,{type:'experiments',connectionId:ws.connectionId,...experiments(),error:{code:error.code,message:error.message}});}return;
      }
      if(ws.protocolVersion===2&&['model-catalog','catalog-invalidated'].includes(msg?.type)){
        if(msg.connectionId!==ws.connectionId||!Number.isSafeInteger(msg.sessionRevision)||msg.sessionRevision<0||msg.sessionRevision<ws.sessionRevision)return;
        if(ws.sessionRevision>=0&&msg.sessionRevision>ws.sessionRevision)for(const task of [...pending.values()])if(task.owner===ws)task.abort(new ApiError(409,'浏览器账号或请求上下文已变化，请重新发起生成','session_changed'));
        ws.sessionRevision=msg.sessionRevision;ws.catalog=null;ws.catalogState='unavailable';
        if(msg.type==='model-catalog')try{ws.catalog=decodeModelCatalog(msg.raw);ws.catalogAt=Date.now();ws.catalogState='ready';}catch{ws.catalogState='invalid';}
        sendExperiments();return;
      }
      const task = pending.get(msg?.requestId);
      if (task?.owner === ws) task.handle(msg);
    });
    ws.on('close', () => {
      clearTimeout(deadline);executors.delete(ws); if (executor === ws) executor = executors.values().next().value??null;sendPool();
      for (const task of [...pending.values()]) if (task.owner === ws) task.abort(new ApiError(502, '浏览器连接已断开，请重连后重试', 'executor_disconnected'));
    });
  });
  const heartbeat = setInterval(() => { for (const ws of wss.clients) { if (!ws.alive) ws.terminate(); else { ws.alive = false; ws.ping(); } } }, 25000);
  heartbeat.unref(); server.on('close', () => clearInterval(heartbeat));
  return {server, wss, close: () => { for (const ws of wss.clients) ws.terminate(); wss.close(); server.close(); }};
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const config = loadConfig(); const relay = createRelay({...config,persistExperiments:saveExperimentalConfig,diagnosticsPath:`${dir}diagnostics.log`});
  relay.server.on('error', e => { console.error(`启动失败: ${e.message}`); process.exitCode = 1; relay.close(); });
  const pidFile = new URL('./runtime.pid', import.meta.url);
  relay.server.listen(config.port, '127.0.0.1', () => {
    writeFileSync(pidFile, String(process.pid));
    console.log(`Local PG: http://127.0.0.1:${config.port}\nOpenAI Base URL: http://127.0.0.1:${config.port}/v1\n${process.argv.includes('--background') ? 'API Key 保存在 config.json' : `API Key: ${config.apiKey}`}\n请保持后端与 AI Studio 标签页运行。`);
  });
  process.on('exit', () => { try { if (readFileSync(pidFile, 'utf8') === String(process.pid)) unlinkSync(pidFile); } catch {} });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { relay.close(); });
}
