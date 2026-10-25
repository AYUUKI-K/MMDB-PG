import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {setImmediate as tick} from 'node:timers/promises';
import {generationDiagnosticText} from '../src/panel.js';

const source=readFileSync(new URL('../src/executor.js',import.meta.url),'utf8').replace(/^export /gm,'');
async function setup(t,generate){
  const sockets=[],events=[],sessions=[],updates=[];let actions;
  class Socket {
    constructor(){this.readyState=0;this.messages=[];sockets.push(this);}
    send(raw){this.messages.push(JSON.parse(raw));}
    close(){this.readyState=3;this.onclose?.({code:1000});}
    receive(value){this.onmessage({data:JSON.stringify(value)});}
  }
  class Session {
    constructor(page,changed){this.ready=true;this.contextVersion=0;sessions.push(this);queueMicrotask(()=>changed(true));}
    async listModels(){return '[[]]';}
    destroy(){}
  }
  const page={AbortController,addEventListener(){}};
  const context=vm.createContext({document:{querySelector:()=>null,addEventListener(){}},window:page,navigator:{},WebSocket:Socket,GooglePageSession:Session,MMDB_VERSION:'1.3.0',performance,setTimeout,clearTimeout,setInterval,clearInterval,
    mountBridgePanel:value=>{actions=value;return {update:patch=>updates.push(patch),addEvent:event=>events.push(event),destroy(){}};},generationDiagnosticText,generateWithRecovery:generate});
  vm.runInContext(source+'\nglobalThis.bridge=startMMDB({key:"test"});',context);
  t.after(()=>context.bridge.stop());await tick();const socket=sockets[0];socket.readyState=1;socket.onopen();
  socket.receive({type:'registered',protocolVersion:2,connectionId:'connection'});await tick();
  const request=id=>({type:'request',requestId:id,logicalRequestId:'logical-'+id,connectionId:'connection',attemptIndex:0,model:'test',allowNetworkRetry:true,requestBody:'{"wire":[],"binding":"test"}'});
  return {socket,request,events,sessions,updates,actions};
}

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

test('completion logs report sent model and unknown identity without treating missing thinking as zero',async t=>{
  const {socket,request,events}=await setup(t,async()=>{});
  socket.receive(request('model-check'));await tick();
  socket.receive({...request('model-check'),type:'settled',status:'finished',elapsedMs:12,diagnostics:{modelIdentity:{sent:'models/test'},usage:{promptTokenCount:8,candidatesTokenCount:2},usageComplete:false,finishReason:'STOP'}});
  assert.ok(events.some(text=>text.includes('发送模型：models/test')&&text.includes('实际模型：无法核验')&&text.includes('思考 未知')&&text.includes('用量不完整')));
});
