import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as tick} from 'node:timers/promises';
import {createSilentAudioKeepAlive} from '../src/browser/audio-keep-alive.js';

function fixture({enabled=false,resume}={}){
  const contexts=[],states=[];
  class Audio {
    constructor(){this.state='suspended';this.sampleRate=8000;this.destination={};contexts.push(this);}
    createBuffer(channels,size,rate){return {channels,rate,data:new Float32Array(size)};}
    createBufferSource(){return this.source={connect(){},start(){this.started=true;},stop(){this.stopped=true;},disconnect(){this.disconnected=true;}};}
    createGain(){return this.gain={gain:{value:1},connect(){},disconnect(){this.disconnected=true;}};}
    async resume(){if(resume)return resume(this);this.state='running';this.onstatechange?.();}
    async close(){this.state='closed';this.closed=true;}
  }
  const audio=createSilentAudioKeepAlive({page:{AudioContext:Audio},enabled,changed:state=>states.push(state)});
  return {audio,contexts,states};
}
test('silent audio defaults off, starts from a gesture and releases all resources on disable',async()=>{
  const f=fixture();assert.equal(f.audio.state,'off');assert.equal(f.contexts.length,0);
  f.audio.setEnabled(true);await tick();const context=f.contexts[0];
  assert.equal(f.audio.state,'active');assert.equal(context.source.loop,true);assert.equal(context.gain.gain.value,0);assert.ok(context.source.buffer.data.every(value=>value===0));
  f.audio.ensure({gesture:true});await tick();assert.equal(f.contexts.length,1);
  f.audio.setEnabled(false);assert.equal(f.audio.state,'off');assert.ok(context.closed&&context.source.stopped&&context.gain.disconnected);f.audio.destroy();
});
test('saved opt-in waits for interaction; blocked playback is reported and can recover',async()=>{
  let blocked=true;const f=fixture({enabled:true,resume:async context=>{if(blocked)throw Error('NotAllowedError');context.state='running';context.onstatechange?.();}});
  f.audio.ensure();assert.equal(f.audio.state,'blocked');assert.equal(f.contexts.length,0);
  f.audio.ensure({gesture:true});await tick();assert.equal(f.audio.state,'blocked');
  blocked=false;f.audio.ensure({gesture:true});await tick();assert.equal(f.audio.state,'active');
  f.contexts[0].state='suspended';f.contexts[0].onstatechange();assert.equal(f.audio.state,'blocked');f.audio.destroy();
});
test('late resume after disable or destroy cannot restart playback',async()=>{
  let finish;const f=fixture({resume:()=>new Promise(resolve=>{finish=resolve;})});f.audio.setEnabled(true);f.audio.setEnabled(false);finish();await tick();assert.equal(f.audio.state,'off');
  f.audio.setEnabled(true);f.audio.destroy();finish();await tick();f.audio.setEnabled(true);assert.equal(f.contexts.length,2);assert.ok(f.contexts.every(c=>c.closed));
});
test('unsupported or failed audio API does not break the page',()=>{
  const absent=createSilentAudioKeepAlive({page:{}});absent.setEnabled(true);assert.equal(absent.state,'unsupported');absent.destroy();
  const denied=createSilentAudioKeepAlive({page:{AudioContext:class{constructor(){throw Error('denied');}}}});denied.setEnabled(true);assert.equal(denied.state,'unavailable');denied.destroy();
});
