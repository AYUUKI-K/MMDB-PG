import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPanelWindow} from '../src/browser/panel-window.js';

function setup({pip=true,blocked=false,activity=()=>{}}={}) {
  const screen=new EventTarget(),child=new EventTarget(),changes=[];
  let created=0;
  const home={append:node=>node.location='home'};
  const host={ownerDocument:{documentElement:home},dataset:{},location:'home'};
  Object.assign(child,{closed:false,document:{documentElement:{style:{}},body:{style:{},append:node=>node.location='child'}},focus(){this.focused=true;},close(){this.closed=true;this.dispatchEvent(new Event('pagehide'));}});
  screen.open=()=>{created++;return blocked?null:child;};
  if(pip)screen.documentPictureInPicture={requestWindow:async()=>{created++;return child;}};
  const controller=createPanelWindow(host,{screen,changed:(...args)=>changes.push(args),activity});
  return {screen,child,host,changes,controller,created:()=>created};
}
test('PiP adopts the live panel once, focuses on repeated open and restores on close',async()=>{
  const f=setup();await f.controller.open();await f.controller.open();
  assert.equal(f.created(),1);assert.equal(f.host.location,'child');assert.equal(f.host.dataset.detached,'true');assert.ok(f.child.focused);
  assert.deepEqual(f.changes,[[true,'pip']]);f.child.close();
  assert.equal(f.host.location,'home');assert.equal(f.host.dataset.detached,'false');assert.deepEqual(f.changes.at(-1),[false]);f.controller.destroy();
});
test('popup fallback is explicit and blocked windows leave the panel usable',async()=>{
  const f=setup({pip:false});await f.controller.open();assert.deepEqual(f.changes,[[true,'popup']]);f.controller.restore();assert.equal(f.host.location,'home');f.controller.destroy();
  const blocked=setup({pip:false,blocked:true});await assert.rejects(blocked.controller.open(),/拦截/);assert.equal(blocked.host.location,'home');blocked.controller.destroy();
});
test('a rejected PiP can be retried as popup and closing the source closes its child',async()=>{
  const f=setup();f.screen.documentPictureInPicture.requestWindow=async()=>{throw Error('not allowed');};
  await assert.rejects(f.controller.open(),/not allowed/);await f.controller.open({popup:true});assert.equal(f.host.location,'child');
  f.screen.dispatchEvent(new Event('pagehide'));assert.ok(f.child.closed);assert.equal(f.changes.length,1);
});
test('late PiP completion after source destruction cannot strand a live panel',async()=>{
  const f=setup();let resolve;
  f.screen.documentPictureInPicture.requestWindow=()=>new Promise(done=>resolve=done);
  const open=f.controller.open();f.controller.destroy();resolve(f.child);await open;
  assert.ok(f.child.closed);assert.equal(f.host.location,'home');assert.equal(f.changes.length,0);
});

test('floating-window focus wakes the executor only while the window is attached',async()=>{
  let wakes=0;const f=setup({activity:()=>wakes++});await f.controller.open();
  f.child.dispatchEvent(new Event('focus'));assert.equal(wakes,1);
  f.controller.restore();f.child.dispatchEvent(new Event('focus'));assert.equal(wakes,1);f.controller.destroy();
});
