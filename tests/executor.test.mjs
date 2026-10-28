import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {setImmediate as tick} from 'node:timers/promises';
import {generationDiagnosticText} from '../src/browser/panel.js';
import {createBackgroundKeepAlive} from '../src/browser/keep-alive.js';
import {createSilentAudioKeepAlive} from '../src/browser/audio-keep-alive.js';

const source=readFileSync(new URL('../src/browser/executor.js',import.meta.url),'utf8').replace(/^export /gm,'');
async function setup(t,generate,{ready=true,savedKeepAlive,navigator={},timers={}}={}){
  const sockets=[],events=[],sessions=[],updates=[],removed=[],saved=[];let actions;
  class Socket {
    constructor(){this.readyState=0;this.messages=[];sockets.push(this);}
    send(raw){this.messages.push(JSON.parse(raw));}
    close(){this.readyState=3;this.onclose?.({code:1000});}
    receive(value){this.onmessage({data:JSON.stringify(value)});}
  }
  class Session {
    constructor(page,changed){this.ready=ready;this.headers={};this.changed=changed;this.contextVersion=0;sessions.push(this);queueMicrotask(()=>changed(ready));}
    async listModels(){return '[[]]';}
    destroy(){}
  }
  const page=Object.assign(new EventTarget(),{AbortController});
  const document=Object.assign(new EventTarget(),{documentElement:{dataset:{}},querySelector:()=>null,visibilityState:'visible'});
  const context=vm.createContext({document,window:page,navigator,WebSocket:Socket,GooglePageSession:Session,MMDB_VERSION:'1.3.0',performance,setTimeout:timers.setTimeout??setTimeout,clearTimeout:timers.clearTimeout??clearTimeout,setInterval,clearInterval,
    mountBridgePanel:value=>{actions=value;return {update:patch=>updates.push(patch),addEvent:event=>events.push(event),destroy(){}};},watchTavernTheme:()=>()=>{},GM_deleteValue:key=>removed.push(key),GM_getValue:(key,fallback)=>key==='mmdb.keepAlive'?(savedKeepAlive??fallback):fallback,GM_setValue:(key,value)=>saved.push([key,value]),createBackgroundKeepAlive,createSilentAudioKeepAlive,generationDiagnosticText,generateWithRecovery:generate});
  vm.runInContext(source+'\nglobalThis.bridge=startMMDB({key:"test"});',context);
  t.after(()=>context.bridge.stop());await tick();
  const socket=sockets[0];if(socket){socket.readyState=1;socket.onopen();socket.receive({type:'registered',protocolVersion:2,connectionId:'connection'});await tick();}
  const request=id=>({type:'request',requestId:id,logicalRequestId:'logical-'+id,connectionId:'connection',attemptIndex:0,model:'test',allowNetworkRetry:true,requestBody:'{"wire":[],"binding":"test"}'});
  return {socket,sockets,request,events,sessions,updates,actions,removed,saved,page,document,stop:()=>context.bridge.stop()};
}

test('background keepalive defaults on, persists an opt-out, and replies to owned page heartbeats while hidden',async t=>{
  const f=await setup(t,async()=>{});
  assert.equal(f.socket.messages[0].pageHeartbeat,1);
  assert.ok(f.updates.some(p=>p.keepAliveEnabled===true&&p.keepAliveState==='unsupported'));
  f.document.visibilityState='hidden';
  f.socket.receive({type:'page-ping',connectionId:'old',nonce:'old'});
  assert.ok(!f.socket.messages.some(m=>m.type==='page-pong'));
  f.socket.receive({type:'page-ping',connectionId:'connection',nonce:'current'});
  assert.deepEqual(f.socket.messages.at(-1),{type:'page-pong',connectionId:'connection',nonce:'current',visibility:'hidden',keepAlive:'unsupported'});
  f.actions.setKeepAlive(false);assert.deepEqual(f.saved.at(-1),['mmdb.keepAlive',false]);
  assert.ok(f.updates.some(p=>p.keepAliveState==='off'));
  const optedOut=await setup(t,async()=>{},{savedKeepAlive:false});
  assert.ok(optedOut.updates.some(p=>p.keepAliveEnabled===false&&p.keepAliveState==='off'));
});

test('resume, online and floating-panel activity recover a closed socket without replaying running work',async t=>{
  let release,calls=0;
  const f=await setup(t,async()=>{calls++;await new Promise(resolve=>release=resolve);});
  f.socket.receive(f.request('held'));await tick();
  for(const event of ['focus','online'])f.page.dispatchEvent(new Event(event));
  f.document.dispatchEvent(new Event('resume'));f.actions.resume();
  assert.equal(f.sockets.length,1);assert.equal(calls,1);
  release();await tick();f.socket.close();
  f.document.visibilityState='hidden';f.document.dispatchEvent(new Event('resume'));
  assert.equal(f.sockets.length,2);
  f.actions.resume();f.page.dispatchEvent(new Event('online'));assert.equal(f.sockets.length,2);
  f.stop();f.page.dispatchEvent(new Event('focus'));f.document.dispatchEvent(new Event('resume'));
  assert.equal(f.sockets.length,2);
});

test('screen lock acquired after stop is released and never displayed as active',async t=>{
  let grant,released=0;
  const f=await setup(t,async()=>{},{navigator:{wakeLock:{request:()=>new Promise(resolve=>grant=resolve)}}});
  const work=f.actions.toggleWake();f.stop();
  grant({release:async()=>released++});await work;
  assert.equal(released,1);assert.ok(!f.updates.some(p=>p.wake===true));
});

test('releasing a previous screen lock cannot clear a newer acquisition',async t=>{
  const locks=[];
  const f=await setup(t,async()=>{},{navigator:{wakeLock:{request:async()=>{
    const lock=new EventTarget();lock.release=()=>new Promise(resolve=>lock.finish=()=>{lock.dispatchEvent(new Event('release'));resolve();});locks.push(lock);return lock;
  }}}});
  await f.actions.toggleWake();const release=f.actions.toggleWake();await f.actions.toggleWake();
  locks[0].finish();await release;assert.equal(f.updates.filter(p=>p.wake!==undefined).at(-1).wake,true);
  const closing=f.actions.toggleWake();locks[1].finish();await closing;
});

test('ready sessions connect directly without collecting an email',async t=>{
  const {socket,actions,removed}=await setup(t,async()=>{});
  const registration=socket.messages.find(m=>m.type==='register');
  assert.equal(registration.accountEmail,undefined);assert.equal(registration.accountId,undefined);
  assert.equal(actions.saveAccountEmail,undefined);assert.deepEqual(removed,['mmdb.accountEmails']);
});

test('a page waits for session activation before connecting',async t=>{
  const {sockets,sessions,actions}=await setup(t,async()=>{},{ready:false});
  actions.reconnect();assert.equal(sockets.length,0);
  sessions[0].ready=true;sessions[0].changed(true);assert.equal(sockets.length,1);
});

test('periodic catalog refresh keeps the current revision valid while pending or failed',async t=>{
  const scheduled=new Map();let nextTimer=0;
  const timers={setTimeout(callback,ms){const id=++nextTimer;scheduled.set(id,{callback,ms});return id;},clearTimeout(id){scheduled.delete(id);}};
  const refresh=()=>{const [id,{callback}]=[...scheduled].find(([,timer])=>timer.ms===5*60*1000);scheduled.delete(id);return callback();};
  const f=await setup(t,async()=>{},{timers});
  const invalidations=socket=>socket.messages.filter(m=>m.type==='catalog-invalidated');
  assert.equal(invalidations(f.socket).length,1);
  let reject;
  f.sessions[0].listModels=()=>new Promise((_,fail)=>reject=fail);
  const pending=refresh();
  assert.equal(invalidations(f.socket).length,1,'a refresh must not invalidate the last successful catalog');
  reject(Error('temporary catalog failure'));await pending;
  assert.equal(invalidations(f.socket).length,1);
  assert.equal(f.socket.messages.filter(m=>m.type==='model-catalog').length,1);
  f.sessions[0].listModels=async()=> '[[]]';await refresh();
  assert.equal(f.socket.messages.filter(m=>m.type==='model-catalog').length,2);
  f.sessions[0].contextVersion++;f.sessions[0].changed(true);
  const next=f.sockets.at(-1);next.readyState=1;next.onopen();next.receive({type:'registered',protocolVersion:2,connectionId:'next'});await tick();
  assert.equal(invalidations(next).length,1);
  assert.equal(invalidations(next)[0].sessionRevision,1);
});

test('changed native request context aborts old work and connects the new session',async t=>{
  let activeSignal;
  const {socket,sockets,sessions,request}=await setup(t,async(session,payload,signal)=>{activeSignal=signal;await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));});
  socket.receive(request('held'));await tick();
  sessions[0].contextVersion++;sessions[0].changed(true);
  assert.ok(activeSignal.aborted);assert.equal(socket.readyState,3);assert.equal(sockets.length,2);
  const next=sockets.at(-1);next.readyState=1;next.onopen();
  assert.equal(next.messages.find(m=>m.type==='register').accountEmail,undefined);
});

test('an invalidated session disconnects and waits until ready again',async t=>{
  const {socket,sockets,sessions,actions}=await setup(t,async()=>{});
  sessions[0].ready=false;sessions[0].changed(false);actions.reconnect();
  assert.equal(socket.readyState,3);assert.equal(sockets.length,1);
  sessions[0].ready=true;sessions[0].changed(true);assert.equal(sockets.length,2);
});

test('browser executor echoes identities and advances attempt identity at network recovery',async t=>{
  const {socket,request}=await setup(t,async(session,payload,signal,chunk,progress)=>{progress('network-retry');progress('proof');chunk('response');});
  assert.equal(socket.messages[0].protocolVersion,2);assert.ok(socket.messages.some(m=>m.type==='model-catalog'&&m.sessionRevision===0));
  socket.receive(request('one'));await tick();
  const messages=socket.messages.filter(m=>m.requestId==='one');
  assert.equal(messages.find(m=>m.phase==='queued').attemptIndex,0);
  for(const message of messages){assert.equal(message.connectionId,'connection');assert.equal(message.logicalRequestId,'logical-one');}
  for(const message of messages.filter(m=>m.phase==='network-retry'||m.type==='stream-chunk'||m.type==='stream-end'))assert.equal(message.attemptIndex,1);
  assert.equal(messages.filter(m=>m.type==='stream-end').length,1);
});

test('cancelled queued browser work never generates, and a duplicate dispatch never overwrites a job',async t=>{
  let release;const held=new Promise(resolve=>release=resolve),seen=[];
  const {socket,request}=await setup(t,async(session,payload,signal,chunk)=>{seen.push(signal);if(seen.length===1)await held;chunk('ok');});
  socket.receive(request('first'));await tick();socket.receive(request('queued'));socket.receive(request('queued'));
  socket.receive({...request('queued'),type:'cancel'});socket.receive(request('next'));release();await tick();await tick();
  assert.equal(seen.length,2);assert.equal(socket.messages.filter(m=>m.requestId==='queued'&&m.phase==='queued').length,1);
  assert.equal(socket.messages.filter(m=>m.requestId==='queued'&&m.type==='stream-end').length,0);
  assert.equal(socket.messages.filter(m=>m.requestId==='next'&&m.type==='stream-end').length,1);
});

test('browser waits for authoritative experiment acknowledgement and clears state on disconnect',async t=>{
  const {socket,actions,updates}=await setup(t,async()=>{});
  actions.saveExperiments({nativeContinuation:true});
  assert.equal(socket.messages.at(-1).type,'experiments:set');assert.equal(socket.messages.at(-1).connectionId,'connection');
  assert.equal(updates.at(-1).experimentSaving,true);
  socket.receive({type:'experiments',connectionId:'obsolete',settings:{nativeContinuation:true}});
  assert.equal(updates.at(-1).experimentSaving,true);
  socket.receive({type:'experiments',connectionId:'connection',settings:{nativeContinuation:false},error:{message:'busy'}});
  assert.equal(updates.at(-1).experimentSaving,false);assert.equal(updates.at(-1).experimentError,'busy');
  socket.close();assert.equal(updates.at(-1).experiments,null);
});

test('synthetic capability probes do not increment delivered chat count',async t=>{
  const {socket,request,updates,events}=await setup(t,async()=>{});
  socket.receive({...request('probe'),experiment:'tool-auto'});await tick();
  socket.receive({...request('probe'),type:'settled',experiment:'tool-auto',status:'finished',elapsedMs:12});
  assert.ok(events.includes('能力验证结束，结果见本地探测记录'));assert.ok(!updates.some(value=>value.completed));
});

test('completion logs show reported counts once and omit model identity guesses and missing counts',async t=>{
  const {socket,request,events}=await setup(t,async()=>{});
  socket.receive(request('model-check'));await tick();
  socket.receive({...request('model-check'),type:'settled',status:'finished',elapsedMs:12,diagnostics:{modelIdentity:{sent:'models/test'},usage:{promptTokenCount:8,candidatesTokenCount:2},usageComplete:false,finishReason:'STOP'}});
  assert.ok(events.some(text=>text==='回复已送达 · 输入 8 / 输出 2 token'));
  assert.ok(!events.some(text=>/实际模型|发送模型|未知|无法核验/.test(text)));
});

test('owned server counters update the panel and failed activity retains per-request counts',async t=>{
  const {socket,request,events,updates}=await setup(t,async()=>{});
  socket.receive(request('counted'));await tick();
  const counts={total:1,inputRead:0,answer:1,continuation:0,retry:0};
  const msg={type:'request-counts',connectionId:'connection',logicalRequestId:'logical-counted',requestCounts:counts,requestTotals:{total:9}};
  socket.receive({...msg,connectionId:'old'});assert.ok(!updates.some(p=>p.requestTotals?.total===9));
  socket.receive(msg);assert.equal(updates.at(-1).requestCounts.total,1);assert.equal(updates.at(-1).requestTotals.total,9);
  socket.receive({...msg,logicalRequestId:'another-request',requestCounts:{...counts,total:2},requestTotals:{total:10}});
  assert.equal(updates.at(-1).requestCounts,undefined);assert.equal(updates.at(-1).requestTotals.total,10);
  socket.receive({...request('counted'),type:'settled',status:'failed',message:'signature rejected',elapsedMs:12,diagnostics:{requestCounts:counts,inputReadMode:'synthetic'}});
  assert.ok(events.some(text=>text.includes('signature rejected · 上游 1 次')&&text.includes('合成读取')));
  socket.close();assert.equal(updates.at(-1).requestTotals,null);
});

test('Meow activation is single-flight, disconnects during the page request, and reconnects on completion',async t=>{
  const {actions,sessions,socket,sockets,updates}=await setup(t,async()=>{});
  let release,calls=0;
  sessions[0].activate=async()=>{calls++;sessions[0].changed(true);await new Promise(resolve=>release=resolve);};
  const work=actions.activate();await tick();
  assert.equal(socket.readyState,3);assert.equal(sockets.length,1);
  await actions.activate();actions.reconnect();
  assert.equal(calls,1);assert.equal(sockets.length,1);
  release();await work;
  assert.equal(sockets.length,2);assert.ok(updates.some(value=>value.activating===false));
});

test('activation never interrupts a live chat generation',async t=>{
  let release,calls=0;
  const {actions,sessions,socket,request}=await setup(t,()=>new Promise(resolve=>release=resolve));
  sessions[0].activate=async()=>calls++;
  socket.receive(request('active'));await tick();await actions.activate();
  assert.equal(calls,0);assert.equal(socket.readyState,1);release();await tick();
});
