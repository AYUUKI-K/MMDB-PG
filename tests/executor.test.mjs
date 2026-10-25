import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {setImmediate as tick} from 'node:timers/promises';
import {generationDiagnosticText} from '../src/browser/panel.js';
import {normalizeAccountEmail} from '../src/shared/account-email.js';

const source=readFileSync(new URL('../src/browser/executor.js',import.meta.url),'utf8').replace(/^export /gm,'');
async function setup(t,generate,{confirm=true,detectedEmail=null}={}){
  const sockets=[],events=[],sessions=[],updates=[];let actions,accountChanged;
  class Socket {
    constructor(){this.readyState=0;this.messages=[];sockets.push(this);}
    send(raw){this.messages.push(JSON.parse(raw));}
    close(){this.readyState=3;this.onclose?.({code:1000});}
    receive(value){this.onmessage({data:JSON.stringify(value)});}
  }
  class Session {
    constructor(page,changed){this.ready=true;this.headers={};this.changed=changed;this.contextVersion=0;this.accountEmail=detectedEmail;sessions.push(this);queueMicrotask(()=>changed(true));}
    async listModels(){return '[[]]';}
    destroy(){}
  }
  const page={AbortController,addEventListener(){},removeEventListener(){}};
  const context=vm.createContext({document:{documentElement:{dataset:{}},querySelector:()=>null,addEventListener(){},removeEventListener(){}},window:page,navigator:{},WebSocket:Socket,GooglePageSession:Session,MMDB_VERSION:'1.3.0',performance,setTimeout,clearTimeout,setInterval,clearInterval,
    mountBridgePanel:value=>{actions=value;return {update:patch=>updates.push(patch),addEvent:event=>events.push(event),destroy(){}};},watchTavernTheme:()=>()=>{},readGoogleAccountEmail:()=>detectedEmail,watchGoogleAccountEmail:changed=>{accountChanged=changed;changed(detectedEmail);return ()=>{};},normalizeAccountEmail,generationDiagnosticText,generateWithRecovery:generate});
  vm.runInContext(source+'\nglobalThis.bridge=startMMDB({key:"test"});',context);
  t.after(()=>context.bridge.stop());await tick();
  if(confirm)actions.saveAccountEmail('first@example.com');
  const socket=sockets[0];if(socket){socket.readyState=1;socket.onopen();socket.receive({type:'registered',protocolVersion:2,connectionId:'connection'});await tick();}
  const request=id=>({type:'request',requestId:id,logicalRequestId:'logical-'+id,connectionId:'connection',attemptIndex:0,model:'test',allowNetworkRetry:true,requestBody:'{"wire":[],"binding":"test"}'});
  return {socket,sockets,request,events,sessions,updates,actions,setDetectedEmail(email){detectedEmail=email;accountChanged(email);}};
}

test('the visible account paired with a native session connects without manual confirmation',async t=>{
  const {socket,updates}=await setup(t,async()=>{},{confirm:false,detectedEmail:'current@example.com'});
  assert.equal(socket.messages.find(m=>m.type==='register').accountEmail,'current@example.com');
  assert.ok(updates.some(patch=>patch.detectedAccountEmail==='current@example.com'));
});

test('changing the visible account disconnects old work and waits for a matching native capture',async t=>{
  let activeSignal;
  const {socket,sockets,request,sessions,setDetectedEmail}=await setup(t,async(session,payload,signal)=>{activeSignal=signal;await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));},{confirm:false,detectedEmail:'first@example.com'});
  socket.receive(request('held'));await tick();setDetectedEmail('second@example.com');
  assert.ok(activeSignal.aborted);assert.equal(socket.readyState,3);assert.equal(sockets.length,1);
  sessions[0].changed(true);assert.equal(sockets.length,1);
  sessions[0].accountEmail='second@example.com';sessions[0].contextVersion++;sessions[0].changed(true);
  assert.equal(sockets.length,2);const next=sockets.at(-1);next.readyState=1;next.onopen();
  assert.equal(next.messages.find(m=>m.type==='register').accountEmail,'second@example.com');
});

test('manual input cannot override the visible login with a different email',async t=>{
  const {socket,sockets,actions,updates}=await setup(t,async()=>{},{confirm:false,detectedEmail:'current@example.com'});
  actions.saveAccountEmail('other@example.com');assert.equal(socket.readyState,1);assert.equal(sockets.length,1);
  assert.match(updates.at(-1).accountError,/不同/);
});

test('browser registers the confirmed email and requires confirmation after account changes',async t=>{
  const {socket,sockets,sessions,actions}=await setup(t,async()=>{});
  const initial=socket.messages.find(m=>m.type==='register');
  assert.equal(initial.accountEmail,'first@example.com');assert.equal(initial.accountId,undefined);
  sessions[0].headers={'x-goog-authuser':'1'};sessions[0].changed(true);
  assert.equal(socket.readyState,3);assert.equal(sockets.length,1);
  actions.reconnect();assert.equal(sockets.length,1);
  actions.saveAccountEmail(' SECOND@Example.com ');const next=sockets.at(-1);assert.notEqual(next,socket);
  next.readyState=1;next.onopen();const registered=next.messages.find(m=>m.type==='register');
  assert.equal(registered.accountEmail,'second@example.com');
});

test('a new page waits for email confirmation and invalid input cannot connect',async t=>{
  const {sockets,actions}=await setup(t,async()=>{},{confirm:false});
  assert.equal(sockets.length,0);actions.reconnect();assert.equal(sockets.length,0);
  actions.saveAccountEmail('not-an-email');assert.equal(sockets.length,0);
  actions.saveAccountEmail('first@example.com');assert.equal(sockets.length,1);
});

test('changed context at the same Google slot clears email and stops pending generation',async t=>{
  let activeSignal;
  const {socket,sockets,sessions,request,updates}=await setup(t,async(session,payload,signal)=>{activeSignal=signal;await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));});
  socket.receive(request('held'));await tick();
  sessions[0].contextVersion++;sessions[0].changed(true);
  assert.ok(activeSignal.aborted);assert.equal(socket.readyState,3);assert.equal(sockets.length,1);
  assert.ok(updates.some(patch=>patch.accountEmail===null&&patch.accountError));
});

test('email cannot change while a generation is running',async t=>{
  let release;const held=new Promise(resolve=>release=resolve);
  const {socket,sockets,actions,request,updates}=await setup(t,()=>held);
  socket.receive(request('held'));await tick();actions.saveAccountEmail('second@example.com');
  assert.equal(sockets.length,1);assert.equal(socket.readyState,1);
  assert.match(updates.at(-1).accountError,/结束当前生成/);release();await tick();
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

test('Meow activation is single-flight, disconnects during the page request, and reconnects on completion',async t=>{
  const {actions,sessions,socket,sockets,updates}=await setup(t,async()=>{});
  let release,calls=0;
  sessions[0].activate=async()=>{calls++;sessions[0].changed(true);await new Promise(resolve=>release=resolve);};
  const work=actions.activate();await tick();
  assert.equal(socket.readyState,3);assert.equal(sockets.length,1);
  await actions.activate();actions.reconnect();actions.saveAccountEmail('other@example.com');
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
