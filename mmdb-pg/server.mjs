import http from 'node:http';
import {readFileSync, writeFileSync, existsSync, unlinkSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {randomUUID, timingSafeEqual} from 'node:crypto';
import {WebSocketServer, WebSocket} from 'ws';
import {ApiError, normalizeModel, fromOpenAI, toWire, FrameParser, decodeFrame, geminiChunk, openAIUsage, finishOpenAI} from './protocol.mjs';
import {readConfig} from './config.mjs';
import {modelMode, nextTurn, addUsage} from './continuation.mjs';
import {envelopePayload, AnswerEnvelope, ANSWER_TOOL} from './anti-truncation.mjs';
import {MMDB_VERSION} from './src/version.js';
import {diagnosticHistory} from './diagnostics.mjs';
import {AttemptTrace,generationSummary,phaseFields} from './metrics.mjs';
import {json,jsonHeartbeat} from './json-response.mjs';
import {ReasoningTrace} from './reasoning-diagnostics.mjs';

const dir = fileURLToPath(new URL('.', import.meta.url));
const phaseLabels={'network-retry':'连接失败后的唯一一次重试',dispatched:'等待浏览器执行器',queued:'执行器队列',preparing:'准备请求',proof:'会话验证','request-sent':'等待 Google 响应',headers:'等待 Google 响应数据',streaming:'接收 Google 数据'};
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
  const send = (ws, data) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data)); };
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
        const source = readFileSync(`${dir}local-pg.user.js`, 'utf8').replaceAll('__LOCAL_PG_KEY__', config.apiKey).replaceAll('__LOCAL_PG_PORT__', String(server.address().port));
        res.writeHead(200, {'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'}); res.end(url.pathname.endsWith('.meta.js') ? source.slice(0,source.indexOf('// ==/UserScript==')+'// ==/UserScript=='.length)+'\n' : source); return;
      }
      if (!authorized(req)) throw new ApiError(401, '本机 API Key 不正确', 'unauthorized');
      if (req.method === 'GET' && url.pathname === '/v1/status') { json(res,200,{version:MMDB_VERSION,revision:`release-${MMDB_VERSION}`,executorOnline:!!executor,executorVersion:executor?.mmdbVersion??null,pending:pending.size,active:[...new Set(pending.values())].map(task=>task.diagnostics()),recent}); return; }
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
      const encodePayload = request => extended ? envelopePayload(model,request) : toWire(model,request);
      const payload = encodePayload(originalBody);
      if (!executor) throw new ApiError(503, '浏览器执行器未连接，请打开 AI Studio，等待脚本就绪并发送 hi', 'executor_offline');
      if (pending.size >= 8) throw new ApiError(429, '本机队列已满，请稍后再试', 'queue_full');
      const streaming = openai ? body.stream === true : native[2] === 'streamGenerateContent';
      const id = randomUUID(), created = Math.floor(Date.now() / 1000), started = Date.now(), parts = [];
      let usage, totalUsage, reason, responseId, roleSent = false, ended = false, round = 0, currentId = id, currentPartsStart = 0;
      let envelope=new AnswerEnvelope(),toolCallsObserved=false,roundHasData=false,roundHasBody=false,roundStarted=started;
      const firstByteWaitMs=extended?(config.toolFirstByteTimeoutMs??config.timeoutMs):config.timeoutMs;
      const timing={networkRetries:0,streamRequested:streaming,clientKeepAlives:0,upstreamChunks:0,upstreamBytes:0,frames:0,bodyChunks:0,bodyChars:0,plainTextChunks:0,plainTextChars:0,thoughtChunks:0,thoughtChars:0,phase:'dispatched',phaseAtMs:0,firstByteWaitMs};
      const sinceStart=()=>Date.now()-started;
      const trace=new AttemptTrace();trace.begin(0,0,'initial');
      const generation=generationSummary(payload);
      const reasoning=new ReasoningTrace(openai?body.reasoning_effort:undefined);
      const diagnostics=()=>({id:id.slice(0,8),model:requestedModel,startedAt:new Date(started).toISOString(),elapsedMs:sinceStart(),rounds:round,...timing,generation,reasoning:reasoning.snapshot(),...trace.snapshot(),...(extended?{transport:'tool-envelope',toolObserved:toolCallsObserved,toolGuard:'tail-user-v1',toolPromptStyle:'tail-user',assistantTail:originalBody.contents.at(-1)?.role==='model'}:{}),...(reason?{finishReason:reason}:{})});
      const ensureSSE = () => {
        if (res.destroyed) throw new ApiError(499, '调用方已断开', 'client_disconnected');
        if (!res.headersSent) {res.setHeader('Content-Type','text/event-stream; charset=utf-8');res.writeHead(200, {'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'});}
        if (res.writableLength > 2 * 1024 * 1024) throw new ApiError(502, '调用方读取过慢', 'slow_client');
      };
      const streamWrite = data => {
        ensureSSE();
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };
      const oaChunk = (delta, finish_reason = null, extra = {}) => ({id: `chatcmpl-${id}`, object: 'chat.completion.chunk', created, model: `pg-${requestedModel}`, choices: [{index: 0, delta, finish_reason, ...(finish_reason && reason?.startsWith('PROVIDER_') ? {provider_finish_reason:reason.toLowerCase()} : {})}], ...extra});
      const forwardParts = incoming => {
        const clean=incoming.map(({text,thought,thoughtSignature})=>({...((typeof text==='string')?{text}:{}),...(thought?{thought:true}:{}),...(thoughtSignature?{thoughtSignature}:{})}));
        parts.push(...clean);
        if(timing.firstBodyMs===undefined&&owner.mmdb&&clean.some(part=>!part.thought&&part.text))send(owner,{type:'body-start',requestId:currentId});
        for(const part of clean)if(!part.thought&&part.text){roundHasBody=true;trace.body(part.text.length,sinceStart());timing.bodyChunks++;timing.bodyChars+=part.text.length;timing.firstBodyMs??=sinceStart();timing.lastBodyMs=sinceStart();}
        if(!streaming||!clean.length)return;
        if(openai){
          if(!roleSent){streamWrite(oaChunk({role:'assistant'}));roleSent=true;}
          for(const part of clean)if(typeof part.text==='string'){
            if(!part.thought&&part.text)timing.firstClientTextMs??=sinceStart();
            streamWrite(oaChunk({[part.thought?'reasoning_content':'content']:part.text}));
            if(part.thought)reasoning.forwarded(part.text.length);
          }
        }else{if(clean.some(part=>!part.thought&&part.text))timing.firstClientTextMs??=sinceStart();streamWrite(geminiChunk({parts:clean}));for(const part of clean)if(part.thought&&typeof part.text==='string')reasoning.forwarded(part.text.length);}
      };
      const makeParser = () => new FrameParser(frame => {
        timing.frames++;timing.firstFrameMs??=sinceStart();
        reasoning.frame(frame);
        const event = decodeFrame(frame,{decodeFunctionCall:extended?call=>{const part=envelope.decode(call);return part?{...part,fromTool:true}:null;}:undefined});
        reasoning.decoded(event.parts);
        trace.frame(event.usageMetadata,event.finishReason);
        toolCallsObserved ||= envelope.observed;
        if(event.usageMetadata)usage={...usage,...event.usageMetadata}; reason = event.finishReason ?? reason; responseId = event.responseId ?? responseId;
        for(const part of event.parts)if(part.text){
          if(part.thought){timing.thoughtChunks++;timing.thoughtChars+=part.text.length;}
          else if(!part.fromTool){timing.plainTextChunks++;timing.plainTextChars+=part.text.length;timing.firstPlainTextMs??=sinceStart();}
        }
        // A selected tool-only route must never silently become plain output.
        // Reject at the first visible ordinary body instead of discarding a
        // whole answer and reporting the mismatch minutes later at STOP.
        if(extended&&!envelope.observed&&event.parts.some(part=>!part.thought&&!part.fromTool&&part.text?.trim()))throw new ApiError(502,'模型开始输出普通正文，未调用正文工具；本次工具模式已停止，未切换为普通输出。','tool_not_used');
        // Anti-truncation must not silently accept an ordinary text answer.
        forwardParts(event.parts.filter(part=>!extended||part.thought||part.fromTool));
      });
      let parser = makeParser();
      const receive = raw => {
        trace.data(sinceStart());
        roundHasData=true;
        if(timing.phase!=='streaming'){timing.phase='streaming';timing.phaseAtMs=sinceStart();timing.streamingMs??=sinceStart();}
        timing.upstreamChunks++;timing.upstreamBytes+=Buffer.byteLength(raw);timing.firstUpstreamMs??=sinceStart();timing.lastUpstreamMs=sinceStart();
        if(parser.raw.length+raw.length>32*1024*1024)throw new ApiError(502,'上游响应超过 32 MiB','upstream_too_large');
        parser.push(raw);
      };
      const owner = executor;
      let timer,keepAlive;
      const cleanup = (status,message='',errorCode) => {
        ended = true; clearTimeout(timer);clearInterval(keepAlive); pending.delete(currentId);
        trace.end(status,sinceStart());
        history.add({...diagnostics(),status,...(errorCode?{errorCode}:{})});
        if(owner.mmdb)send(owner,{type:'settled',requestId:currentId,status,message,elapsedMs:sinceStart()});
      };
      const abort = error => { if (ended) return; send(owner, {type: 'cancel', requestId: currentId}); cleanup(error.status===499?'cancelled':'failed',error.message,error.code); fail(res, error); };
      // Until tool body text arrives, use a fixed deadline for this round.
      // Thoughts, signatures and partial frames must neither shorten nor renew it.
      // Once body text arrives, keep the usual idle-data timeout.
      const refreshIdleTimer = () => {
        if (ended) return;
        clearTimeout(timer);
        if(extended&&!roundHasBody){
          const remaining=firstByteWaitMs-(Date.now()-roundStarted);
          timer=setTimeout(()=>abort(new ApiError(504,`等待工具正文超时：本轮 ${firstByteWaitMs / 1000} 秒内未收到正文（${phaseLabels[timing.phase]??'等待执行器'}）。`,roundHasData?'tool_body_timeout':'upstream_first_byte_timeout')),Math.max(0,remaining));
          return;
        }
        const budget=roundHasData?config.timeoutMs:firstByteWaitMs;
        timer = setTimeout(() => abort(new ApiError(504,roundHasData?`等待生成数据超时：连续 ${budget / 1000} 秒未收到后续上游数据。`:`等待首个上游数据超时：${budget / 1000} 秒内未收到数据（${phaseLabels[timing.phase]??'等待执行器'}）。`,!roundHasData&&extended?'upstream_first_byte_timeout':'timeout')), budget);
      };
      refreshIdleTimer();
      keepAlive=setInterval(()=>{
        if(ended||res.writableEnded)return;
        try{if(streaming){ensureSSE();res.write(': mmdb-waiting\n\n');}else jsonHeartbeat(res);timing.clientKeepAlives++;timing.lastKeepAliveMs=sinceStart();}catch(error){abort(error);}
      },config.streamKeepAliveMs??15000);
      const finish = () => {
        parser.end();
        if (!reason) throw new ApiError(502, '上游响应缺少完成状态，未将部分内容标为成功', 'incomplete_upstream');
        if(extended&&!envelope.observed&&['STOP','MAX_TOKENS'].includes(reason))throw new ApiError(502,'工具抗截断未生效：模型未调用正文工具，本次未退回普通输出。','tool_not_used');
        if(extended&&envelope.observed&&!envelope.fragments&&reason==='STOP')throw new ApiError(502,'上游调用了正文工具但未返回正文参数','empty_tool_envelope');
        totalUsage=addUsage(totalUsage,usage);
        const visibleThisRound=parts.slice(currentPartsStart).filter(p=>!p.thought).map(p=>p.text??'').join('');
        if (extended && reason==='MAX_TOKENS' && visibleThisRound && round < (config.maxContinuations ?? 2)) {
          const previous=pending.get(currentId); pending.delete(currentId);
          trace.end('continued',sinceStart());
          round++;trace.begin(sinceStart(),round,'continuation'); currentId=`${id}-${round}`; currentPartsStart=parts.length;
          const nextPayload=encodePayload(nextTurn(originalBody,parts.filter(p=>!p.thought).map(p=>p.text??'').join('')));
          reason=undefined;usage=undefined;roundHasData=false;roundHasBody=false;roundStarted=Date.now();timing.phase='dispatched';timing.phaseAtMs=sinceStart();envelope=new AnswerEnvelope();parser=makeParser();pending.set(currentId,previous);refreshIdleTimer();
          send(owner,{type:'request',requestId:currentId,model,round,allowNetworkRetry:extended&&!timing.networkRetries,elapsedMs:sinceStart(),stream:true,requestBody:JSON.stringify(nextPayload)});return;
        }
        usage=totalUsage;
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
            choices: [{index: 0, message: {role: 'assistant', content: text, ...(thought ? {reasoning_content: thought} : {})}, finish_reason: finishOpenAI(reason),...(reason?.startsWith('PROVIDER_')?{provider_finish_reason:reason.toLowerCase()}:{})}], ...(usage ? {usage: openAIUsage(usage)} : {}),mmdb:{continuations:round,...(extended?{transport:'tool-envelope',toolObserved:toolCallsObserved}:{})}});
        } else json(res, 200, geminiChunk({parts, usageMetadata: usage, finishReason: reason, responseId}));
        if(!streaming)for(const part of parts)if(part.thought&&typeof part.text==='string')reasoning.forwarded(part.text.length);
        cleanup('finished');
      };
      res.on('close', () => { if (!ended) abort(new ApiError(499, '调用方已断开', 'client_disconnected')); });
      pending.set(currentId, {owner, abort, diagnostics, disconnect(code){timing.executorCloseCode=code;abort(new ApiError(502, `AI Studio 浏览器与本地反代的连接已断开（${code}），请重连后重试`, 'executor_disconnected'));}, handle(msg) {
        try {
          if(msg.type==='progress'){
            if(msg.phase==='retry-skipped'){timing.retrySkipped=true;return;}
            if(Object.hasOwn(phaseFields,msg.phase)){
              if(msg.phase==='network-retry'){
                if(timing.networkRetries||roundHasData)return;
                // Enforce the policy here too, including older executors.
                if(sinceStart()-(timing.prepareMs??0)>=30000){
                  timing.retrySkipped=true;
                  abort(new ApiError(502,'浏览器到 Google 的连接在长时间等待后失败；已停止自动重复提交，请检查网络或代理后重试。','upstream_connection_failed'));return;
                }
                timing.networkRetries++;
              }
              trace.phase(msg.phase,sinceStart(),msg.httpStatus);
              timing.phase=msg.phase;timing.phaseAtMs=sinceStart();timing[phaseFields[msg.phase]]??=sinceStart();
              if(msg.phase==='headers'&&Number.isInteger(msg.httpStatus)&&msg.httpStatus>=100&&msg.httpStatus<=599)timing.upstreamHttpStatus=msg.httpStatus;
            }
            return;
          }
          if (msg.type === 'error') {
            if(['before-headers','before-data','during-data'].includes(msg.error?.failurePhase))timing.upstreamFailurePhase=msg.error.failurePhase;
            if(Number.isSafeInteger(msg.error?.requestWaitMs)&&msg.error.requestWaitMs>=0)timing.upstreamFailureWaitMs=msg.error.requestWaitMs;
            abort(new ApiError(msg.status >= 400 && msg.status <= 599 ? msg.status : 502, msg.error?.message ?? '执行器失败', msg.error?.code)); return;
          }
          if (msg.type === 'stream-chunk') {
            if (typeof msg.chunkBody !== 'string') throw new ApiError(502, '执行器数据格式错误');
            if (msg.chunkBody.length) { receive(msg.chunkBody); refreshIdleTimer(); }
          }
          if (msg.type === 'response') { if (typeof msg.rawResponse !== 'string') throw new ApiError(502, '执行器数据格式错误'); receive(msg.rawResponse); finish(); }
          if (msg.type === 'stream-end') finish();
        } catch (e) { abort(e instanceof ApiError ? e : new ApiError(502, '无法解析上游响应，可能是 Google 协议变化', 'invalid_upstream')); }
      }});
      send(owner, {type: 'request', requestId: id, model, allowNetworkRetry:extended&&!timing.networkRetries, elapsedMs:sinceStart(), stream: true, requestBody: JSON.stringify(payload)});
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
        if (executor) { ws.close(4008, 'Another executor is online'); return; }
        clearTimeout(deadline); registered = true; executor = ws; ws.mmdb=typeof msg.clientVersion==='string'&&msg.clientVersion.startsWith('mmdb-');ws.mmdbVersion=/^mmdb-[0-9.]{1,16}$/.test(msg.clientVersion??'')?msg.clientVersion:null; send(ws, {type: 'registered'}); return;
      }
      const task = pending.get(msg?.requestId);
      if (task?.owner === ws) task.handle(msg);
    });
    ws.on('close', code => {
      clearTimeout(deadline); if (executor === ws) executor = null;
      for (const task of [...pending.values()]) if (task.owner === ws)task.disconnect(code);
    });
  });
  const heartbeat = setInterval(() => { for (const ws of wss.clients) { if (!ws.alive) ws.terminate(); else { ws.alive = false; ws.ping(); } } }, 25000);
  heartbeat.unref(); server.on('close', () => clearInterval(heartbeat));
  return {server, wss, close: () => { for (const ws of wss.clients) ws.terminate(); wss.close(); server.close(); }};
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const config = loadConfig(); const relay = createRelay({...config,diagnosticsPath:`${dir}diagnostics.log`});
  relay.server.on('error', e => { console.error(`启动失败: ${e.message}`); process.exitCode = 1; relay.close(); });
  const pidFile = new URL('./runtime.pid', import.meta.url);
  relay.server.listen(config.port, '127.0.0.1', () => {
    writeFileSync(pidFile, String(process.pid));
    console.log(`Local PG: http://127.0.0.1:${config.port}\nOpenAI Base URL: http://127.0.0.1:${config.port}/v1\n${process.argv.includes('--background') ? 'API Key 保存在 config.json' : `API Key: ${config.apiKey}`}\n请保持后端与 AI Studio 标签页运行。`);
  });
  process.on('exit', () => { try { if (readFileSync(pidFile, 'utf8') === String(process.pid)) unlinkSync(pidFile); } catch {} });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { relay.close(); });
}
