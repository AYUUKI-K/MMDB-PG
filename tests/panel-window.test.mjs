import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPanelWindow} from '../src/browser/panel-window.js';

function setup({pip=true,blocked=false,activity=()=>{},navigator={},coarse=false,noHover=false}={}) {
  const screen=new EventTarget(),child=new EventTarget(),changes=[];
  let created=0;
  const home={append:node=>node.location='home'};
  const host={ownerDocument:{documentElement:home},dataset:{},location:'home'};
  const metadata=[];
  const doc={documentElement:{style:{}},body:{style:{},append:node=>node.location='child'},head:{append:node=>metadata.push(node)},createElement:()=>({}),querySelector:()=>metadata.find(node=>node.name==='viewport')};
  Object.assign(child,{closed:false,document:doc,focus(){this.focused=true;},close(){this.closed=true;this.dispatchEvent(new Event('pagehide'));}});
  screen.navigator=navigator;
  screen.matchMedia=query=>({matches:query==='(pointer: coarse)'?coarse:query==='(hover: none)'?noHover:false});
  screen.open=()=>{created++;return blocked?null:child;};
  if(pip)screen.documentPictureInPicture={requestWindow:async()=>{created++;return child;}};
  const controller=createPanelWindow(host,{screen,changed:(...args)=>changes.push(args),activity});
  return {screen,child,host,changes,controller,created:()=>created};
}
test('PiP adopts the live panel once, focuses on repeated open and restores on close',async()=>{
  const f=setup();await f.controller.open();await f.controller.open();
  assert.equal(f.created(),1);assert.equal(f.host.location,'child');assert.equal(f.host.dataset.detached,'true');assert.ok(f.child.focused);
  assert.equal(f.child.document.querySelector('meta[name="viewport"]').content,'width=device-width,initial-scale=1');
  assert.deepEqual(f.changes,[[true,'pip']]);f.child.close();
  assert.equal(f.host.location,'home');assert.equal(f.host.dataset.detached,'false');assert.deepEqual(f.changes.at(-1),[false]);f.controller.destroy();
});
test('desktop popup fallback and blocked windows leave the panel usable',async()=>{
  const f=setup({pip:false});await f.controller.open();assert.deepEqual(f.changes,[[true,'popup']]);f.controller.restore();assert.equal(f.host.location,'home');f.controller.destroy();
  const blocked=setup({pip:false,blocked:true});await assert.rejects(blocked.controller.open(),/拦截/);assert.equal(blocked.host.location,'home');blocked.controller.destroy();
});
for(const [name,device] of [
  ['Android',{navigator:{userAgent:'Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile Safari/537.36'}}],
  ['Android tablet',{navigator:{userAgent:'Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Safari/537.36'}}],
  ['mobile client hint',{navigator:{userAgentData:{mobile:true}}}],
  ['desktop-site touch browser',{navigator:{userAgent:'Mozilla/5.0 (X11; Linux x86_64)',userAgentData:{mobile:false},maxTouchPoints:5},coarse:true,noHover:true}],
  ['iPhone',{navigator:{userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'}}],
])test(`${name} keeps the panel in its page without opening a full-size tab`,async()=>{
  const f=setup({pip:false,...device});
  await f.controller.open();await f.controller.open({popup:true});
  assert.equal(f.created(),0);assert.equal(f.host.location,'home');assert.notEqual(f.host.dataset.detached,'true');
  assert.deepEqual(f.changes,[[false,'inline'],[false,'inline']]);
  f.controller.restore();f.controller.destroy();await f.controller.open();
  assert.equal(f.changes.length,2);assert.equal(f.created(),0);
});

test('mobile browsers can still use real PiP when the capability is available',async()=>{
  const f=setup({navigator:{userAgent:'Android',maxTouchPoints:5},coarse:true,noHover:true});
  await f.controller.open();assert.equal(f.created(),1);assert.deepEqual(f.changes,[[true,'pip']]);
  f.child.close();assert.equal(f.host.location,'home');f.controller.destroy();
});

test('mobile PiP rejection falls back inline even when a popup is explicitly requested',async()=>{
  const f=setup({navigator:{userAgent:'Android'}});
  f.screen.documentPictureInPicture.requestWindow=async()=>{throw Error('not allowed');};
  await assert.rejects(f.controller.open(),/not allowed/);await f.controller.open({popup:true});
  assert.equal(f.created(),0);assert.equal(f.host.location,'home');assert.deepEqual(f.changes,[[false,'inline']]);f.controller.destroy();
});

test('touch-capable desktops with a mouse retain the ordinary popup fallback',async()=>{
  const f=setup({pip:false,navigator:{userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',maxTouchPoints:10}});
  await f.controller.open();assert.equal(f.created(),1);assert.deepEqual(f.changes,[[true,'popup']]);f.controller.destroy();
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
