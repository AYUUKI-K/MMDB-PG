import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as tick} from 'node:timers/promises';
import {createBackgroundKeepAlive} from '../src/browser/keep-alive.js';

function fixture(extra={}){
  const peers=[],states=[],timers=new Map();let clock=0,next=0;
  class Peer {
    constructor(config){this.config=config;this.closed=false;this.candidates=[];peers.push(this);}
    createDataChannel(name,options){this.channel={name,options,readyState:'connecting',close(){this.readyState='closed';this.onclose?.();}};return this.channel;}
    async createOffer(){return {type:'offer',sdp:'local'};}
    async createAnswer(){return {type:'answer',sdp:'local'};}
    async setLocalDescription(value){this.localDescription=value;this.onicecandidate?.({candidate:{candidate:'local-only'}});}
    async setRemoteDescription(value){this.remoteDescription=value;}
    async addIceCandidate(value){assert.ok(this.remoteDescription);this.candidates.push(value);}
    close(){this.closed=true;this.connectionState='closed';this.onconnectionstatechange?.();}
  }
  const keep=createBackgroundKeepAlive({page:{RTCPeerConnection:Peer},changed:value=>states.push(value),now:()=>clock,schedule:fn=>{timers.set(++next,fn);return next;},cancel:id=>timers.delete(id),...extra});
  return {keep,peers,states,timers,advance:ms=>clock+=ms,open(){for(const peer of peers.slice(-2)){peer.channel.readyState='open';peer.channel.onopen?.();}}};
}

test('local-only pair becomes active only after both channels open, and repeated ensure is idempotent',async()=>{
  const f=fixture();await tick();
  for(const p of f.peers){assert.deepEqual(p.config,{iceServers:[]});assert.equal(p.candidates.length,1);}
  assert.equal(f.keep.state,'starting');f.open();assert.equal(f.keep.state,'active');assert.equal(f.timers.size,0);
  f.keep.ensure();f.keep.ensure();assert.equal(f.peers.length,2);
  f.keep.destroy();assert.ok(f.peers.every(p=>p.closed&&p.channel.readyState==='closed'));
});

test('disable and destroy during asynchronous negotiation cannot restore a stale attempt',async()=>{
  const f=fixture();f.keep.setEnabled(false);await tick();
  assert.equal(f.keep.state,'off');assert.ok(f.peers.every(p=>p.closed));assert.equal(f.timers.size,0);
  f.keep.setEnabled(true);await tick();assert.equal(f.peers.length,4);
  f.keep.destroy();f.keep.ensure();await tick();assert.equal(f.peers.length,4);assert.ok(f.peers.every(p=>p.closed));
});

test('failed or timed-out negotiation cleans up and retries with a cooldown',async()=>{
  const f=fixture();await tick();[...f.timers.values()][0]();
  assert.equal(f.keep.state,'unavailable');assert.ok(f.peers.every(p=>p.closed));
  f.keep.ensure();assert.equal(f.peers.length,2);f.advance(30000);f.keep.ensure();await tick();f.open();
  assert.equal(f.keep.state,'active');assert.equal(f.peers.length,4);
  f.peers.at(-1).connectionState='failed';f.peers.at(-1).onconnectionstatechange();
  assert.equal(f.keep.state,'unavailable');f.keep.destroy();
});

test('unsupported, disabled and rejected browser APIs do not prevent the executor from starting',()=>{
  const unsupported=fixture({page:{}});assert.equal(unsupported.keep.state,'unsupported');unsupported.keep.destroy();
  const disabled=fixture({enabled:false});assert.equal(disabled.peers.length,0);assert.equal(disabled.keep.state,'off');disabled.keep.destroy();
  const denied=fixture({page:{RTCPeerConnection:class {constructor(){throw Error('disabled');}}}});assert.equal(denied.keep.state,'unavailable');denied.keep.destroy();
});
