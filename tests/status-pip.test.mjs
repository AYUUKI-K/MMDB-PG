import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createStatusPip,statusPipSupport} from '../src/browser/status-pip.js';
import {getPanelWindowMode} from '../src/browser/panel-window.js';

function fixture({ready=1,play=()=>Promise.resolve(),request,status=()=>({})}={}){
  const screen=new EventTarget(),video=new EventTarget(),changes=[],drawn=[],calls=[],timers=new Map();
  let sequence=0,stopped=0,removed=0,exits=0;
  const stream={getTracks:()=>[{stop:()=>stopped++}]};
  const canvas={getContext:()=>({fillRect(){},fillText:line=>{drawn.push(line);calls.push('draw');}}),captureStream:fps=>{assert.equal(fps,1);calls.push('capture');return stream;}};
  Object.assign(video,{readyState:ready,style:{},setAttribute(){},pause(){},remove(){removed++;},play(){calls.push('play');return play();},requestPictureInPicture:request??(async()=>{calls.push('pip');doc.pictureInPictureElement=video;})});
  const doc={pictureInPictureEnabled:true,documentElement:{append(){}},createElement:tag=>tag==='canvas'?canvas:video,async exitPictureInPicture(){exits++;doc.pictureInPictureElement=null;video.dispatchEvent(new Event('leavepictureinpicture'));}};
  Object.assign(screen,{document:doc,navigator:{userAgent:'Android'},HTMLCanvasElement:{prototype:{captureStream(){}}},HTMLVideoElement:{prototype:{requestPictureInPicture(){}}},setTimeout:fn=>{timers.set(++sequence,fn);return sequence;},clearTimeout:id=>timers.delete(id),setInterval:fn=>{timers.set(++sequence,fn);return sequence;},clearInterval:id=>timers.delete(id)});
  const controller=createStatusPip({screen,status,changed:(...args)=>changes.push(args)});
  return {screen,doc,video,controller,changes,drawn,calls,timers,get stopped(){return stopped;},get removed(){return removed;},get exits(){return exits;}};
}
const tick=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};

test('an absent capability flag does not reject a browser that exposes native PiP',async()=>{
  const f=fixture();f.doc.pictureInPictureEnabled=undefined;
  assert.equal(statusPipSupport(f.screen).supported,true);assert.equal(getPanelWindowMode(f.screen),'video-pip');
  await f.controller.open();assert.equal(f.controller.active,true);f.controller.destroy();
});
test('explicit false and missing methods report actual capability failures',async()=>{
  const f=fixture();f.doc.pictureInPictureEnabled=false;assert.equal(statusPipSupport(f.screen).supported,false);await assert.rejects(f.controller.open(),/不可用|策略/);
  f.doc.pictureInPictureEnabled=undefined;delete f.screen.HTMLVideoElement.prototype.requestPictureInPicture;delete f.video.requestPictureInPicture;
  assert.equal(statusPipSupport(f.screen).api,false);await assert.rejects(f.controller.open(),/接口/);assert.equal(f.stopped,0);f.controller.destroy();
});
test('first frame precedes capture, then metadata and playback precede native PiP',async()=>{
  let finishPlay;const f=fixture({ready:0,play:()=>new Promise(resolve=>{finishPlay=resolve;})});const pending=f.controller.open();
  assert(f.calls.indexOf('draw')<f.calls.indexOf('capture'));assert(!f.calls.includes('play'));
  f.video.readyState=1;f.video.dispatchEvent(new Event('loadedmetadata'));await tick();assert(f.calls.includes('play'));assert(!f.calls.includes('pip'));
  finishPlay();await pending;assert(f.calls.indexOf('play')<f.calls.indexOf('pip'));assert.equal(f.controller.active,true);assert.deepEqual(f.changes,[[true,'video-pip']]);
  await f.controller.close();assert.equal(f.stopped,1);assert.equal(f.removed,1);assert.equal(f.exits,1);assert.equal(f.timers.size,0);assert.equal(f.changes.length,2);f.controller.destroy();
});
test('status animation includes only our own allowlisted fields, never prompt/response/credentials',async()=>{
  let status={session:true,link:'connected',elapsed:1,completed:2,apiKey:'private-key',prompt:'private-body',response:'private-response'};
  const f=fixture({status:()=>status});await f.controller.open();assert(f.drawn.includes('电波已就绪'));assert(!f.drawn.join().includes('private-'));
  status={...status,busy:true,elapsed:9};f.controller.refresh();assert(f.drawn.includes('正在生成'));assert(f.drawn.some(line=>line.includes('9 秒')));f.controller.destroy();
});
test('denied PiP and play failures clean all resources and leave a fresh retry usable',async()=>{
  const f=fixture({request:async()=>{throw Object.assign(Error('denied'),{name:'NotAllowedError'});}});
  await assert.rejects(f.controller.open(),/权限/);assert.equal(f.controller.active,false);assert.equal(f.stopped,1);assert.equal(f.timers.size,0);
  f.video.requestPictureInPicture=async()=>{f.doc.pictureInPictureElement=f.video;};await f.controller.open();assert.equal(f.controller.active,true);f.controller.destroy();
  const failed=fixture({play:async()=>{throw Error('cannot play');}});await assert.rejects(failed.controller.open(),/cannot play/);assert.equal(failed.stopped,1);assert.equal(failed.timers.size,0);failed.controller.destroy();
});
test('native close and source unload reset the switch and release tracks exactly once',async()=>{
  const f=fixture();await f.controller.open();f.doc.pictureInPictureElement=null;f.video.dispatchEvent(new Event('leavepictureinpicture'));assert.equal(f.controller.active,false);assert.equal(f.stopped,1);assert.equal(f.timers.size,0);
  await f.controller.open();f.screen.dispatchEvent(new Event('pagehide'));assert.equal(f.controller.active,false);assert.equal(f.stopped,2);assert.equal(f.timers.size,0);
});
test('metadata and playback wait can be cancelled without keeping a dangling opening promise',async()=>{
  for(const options of [{ready:0},{play:()=>new Promise(()=>{})}]){
    const f=fixture(options),pending=f.controller.open();await tick();f.controller.destroy();await pending;assert.equal(f.stopped,1);assert.equal(f.timers.size,0);assert.deepEqual(f.changes,[]);
  }
});
test('late native completion after close cannot strand PiP or close another player',async()=>{
  let finish;const f=fixture({request:()=>new Promise(resolve=>{finish=()=>{f.doc.pictureInPictureElement=f.video;resolve();};})});
  const pending=f.controller.open();await tick();f.controller.destroy();finish();await pending;await tick();assert.equal(f.exits,1);assert.equal(f.stopped,1);assert.deepEqual(f.changes,[]);
  const other=fixture();await other.controller.open();other.doc.pictureInPictureElement={};await other.controller.close();assert.equal(other.exits,0);other.controller.destroy();
});
test('bounded readiness timeout releases resources instead of leaving a permanent starting state',async()=>{
  const f=fixture({ready:0}),pending=f.controller.open();const check=assert.rejects(pending,/尚未就绪/);[...f.timers.values()][0]();await check;assert.equal(f.stopped,1);assert.equal(f.timers.size,0);f.controller.destroy();
});
