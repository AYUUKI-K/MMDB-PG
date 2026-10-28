import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createStatusPip,supportsStatusPip} from '../src/browser/status-pip.js';
import {getPanelWindowMode} from '../src/browser/panel-window.js';

function fixture({ready=1,request,play=()=>Promise.resolve(),status=()=>({})}={}){
  const screen=new EventTarget(),video=new EventTarget(),changes=[],text=[],timers=new Map();
  let stopped=0,removed=0,exits=0,id=0;
  const stream={getTracks:()=>[{stop:()=>stopped++}]};
  const canvas={getContext:()=>({fillRect(){},fillText:line=>text.push(line)}),captureStream:()=>stream};
  Object.assign(video,{readyState:ready,style:{},setAttribute(){},play,pause(){},remove(){removed++;},requestPictureInPicture:request??(async()=>{doc.pictureInPictureElement=video;})});
  const doc={pictureInPictureEnabled:true,documentElement:{append(){}},createElement:tag=>tag==='canvas'?canvas:video,async exitPictureInPicture(){exits++;doc.pictureInPictureElement=null;video.dispatchEvent(new Event('leavepictureinpicture'));}};
  Object.assign(screen,{document:doc,navigator:{userAgent:'Android'},HTMLVideoElement:{prototype:{requestPictureInPicture(){}}},HTMLCanvasElement:{prototype:{captureStream(){}}},setTimeout:fn=>{timers.set(++id,fn);return id;},setInterval:fn=>{timers.set(++id,fn);return id;},clearTimeout:n=>timers.delete(n),clearInterval:n=>timers.delete(n)});
  const controller=createStatusPip({screen,status,changed:(...args)=>changes.push(args)});
  return {screen,video,doc,controller,changes,timers,text,get stopped(){return stopped;},get removed(){return removed;},get exits(){return exits;}};
}

test('Android selects real video PiP only when all required capabilities are exposed',()=>{
  const f=fixture();assert.equal(getPanelWindowMode(f.screen),'video-pip');
  assert.equal(getPanelWindowMode(f.screen,{popup:true}),'inline');
  f.doc.pictureInPictureEnabled=false;assert.equal(supportsStatusPip(f.screen),false);assert.equal(getPanelWindowMode(f.screen),'inline');f.controller.destroy();
});
test('PiP requests do not wait on playback and release tracks/timers on close',async()=>{
  const f=fixture({play:()=>new Promise(()=>{})});await f.controller.open();assert.equal(f.controller.active,true);assert.deepEqual(f.changes,[[true,'video-pip']]);
  await f.controller.close();assert.equal(f.controller.active,false);assert.equal(f.exits,1);assert.equal(f.stopped,1);assert.equal(f.removed,1);assert.equal(f.timers.size,0);f.controller.destroy();
});
test('only allowlisted connection/metrics are drawn, including updates',async()=>{
  let state={session:true,link:'connected',apiKey:'secret',prompt:'private',model:'private model',elapsed:2,completed:3};
  const f=fixture({status:()=>state});await f.controller.open();assert(f.text.includes('已就绪'));assert(!f.text.join().includes('secret'));assert(!f.text.join().includes('private'));
  state={...state,busy:true,elapsed:5};f.controller.refresh();assert(f.text.includes('正在生成'));assert(f.text.some(line=>line.includes('5 秒')));f.controller.destroy();
});
test('PiP rejection preserves inactive state and cleans resources; a later click can retry',async()=>{
  const f=fixture({request:async()=>{throw Object.assign(Error('denied'),{name:'NotAllowedError'});}});
  await assert.rejects(f.controller.open(),/权限/);assert.equal(f.controller.active,false);assert.equal(f.stopped,1);assert.equal(f.timers.size,0);
  f.video.requestPictureInPicture=async()=>{f.doc.pictureInPictureElement=f.video;};await f.controller.open();assert.equal(f.controller.active,true);f.controller.destroy();
});
test('native close and page unload release the status video',async()=>{
  const f=fixture();await f.controller.open();f.doc.pictureInPictureElement=null;f.video.dispatchEvent(new Event('leavepictureinpicture'));assert.equal(f.stopped,1);assert.equal(f.timers.size,0);
  await f.controller.open();f.screen.dispatchEvent(new Event('pagehide'));assert.equal(f.stopped,2);assert.equal(f.controller.active,false);
});
test('disposing while native PiP is opening closes a late window and never reports active',async()=>{
  let resolve;const f=fixture({request:()=>new Promise(done=>{resolve=()=>{f.doc.pictureInPictureElement=f.video;done();};})});
  const pending=f.controller.open();f.controller.destroy();resolve();await pending;assert.equal(f.stopped,1);assert.equal(f.exits,1);assert.equal(f.controller.active,false);assert.deepEqual(f.changes,[]);
});
test('metadata waiting is canceled on disposal instead of leaving an opening promise',async()=>{
  const f=fixture({ready:0});const pending=f.controller.open();f.controller.destroy();await pending;assert.equal(f.stopped,1);assert.equal(f.timers.size,0);assert.deepEqual(f.changes,[]);
});
test('preparation without opening expires and does not close another player',async()=>{
  const f=fixture();f.controller.prepare();for(const callback of [...f.timers.values()])callback();assert.equal(f.stopped,1);assert.equal(f.timers.size,0);
  f.doc.pictureInPictureElement={};await f.controller.close();assert.equal(f.exits,0);f.controller.destroy();
});
