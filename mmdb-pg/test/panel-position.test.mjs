import {test} from 'node:test';
import assert from 'node:assert/strict';
import {attachPanelPosition} from '../src/panel.js';

class Surface {
  constructor(){this.listeners=new Map();}
  addEventListener(type,handler){const set=this.listeners.get(type)??new Set();set.add(handler);this.listeners.set(type,set);}
  removeEventListener(type,handler){this.listeners.get(type)?.delete(handler);}
  emit(type,values={}){const event={button:0,isPrimary:true,pointerId:1,clientX:0,clientY:0,target:this,preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;},...values};for(const handler of this.listeners.get(type)??[])handler(event);if(this.parent&&!event.stopped){const bubbled=this.parent.emit(type,event);event.prevented||=bubbled.prevented;event.stopped||=bubbled.stopped;}return event;}
  closest(){return this;}
  setPointerCapture(){}
  releasePointerCapture(){}
}
function setup(options={}){
  const screen=new Surface();screen.innerWidth=390;screen.innerHeight=800;screen.matchMedia=()=>({matches:true});screen.visualViewport=Object.assign(new Surface(),{width:390,height:800,offsetLeft:0,offsetTop:0});
  const header=new Surface(),pill=new Surface(),article={style:{}};
  header.parent=screen;pill.parent=screen;
  const host={style:{},dataset:{},shadowRoot:{querySelector:()=>article},width:140,height:48,getBoundingClientRect(){return {left:Number.parseFloat(this.style.left)||0,top:Number.parseFloat(this.style.top)||0,width:this.width,height:this.height};}};
  const saved=[];const controller=attachPanelPosition(host,[header,pill],{screen,save:position=>saved.push(position),...options});
  return {host,header,pill,screen,article,saved,controller};
}

test('mobile pill starts away from the bottom-right send button and real taps still expand',()=>{
  const {host,pill,controller}=setup();assert.equal(host.getBoundingClientRect().left,12);assert.ok(host.getBoundingClientRect().top<400);
  pill.emit('pointerdown',{clientX:20,clientY:270});pill.emit('pointerup',{clientX:20,clientY:270});assert.equal(pill.emit('click').prevented,undefined);controller.destroy();
});

test('stationary touch activates once without relying on a browser compatibility click',()=>{
  let taps=0;const {pill,header,screen,controller}=setup({tap:()=>{taps++;return true;}});
  pill.emit('pointerdown',{pointerType:'touch'});pill.emit('pointerup',{pointerType:'touch'});assert.equal(taps,1);
  assert.ok(pill.emit('click').prevented);assert.equal(header.emit('click').prevented,undefined);controller.destroy();
});

test('opening on touch-up cannot click a newly exposed control underneath',()=>{
  const {pill,screen,controller}=setup({tap:()=>true});pill.emit('pointerdown',{pointerType:'touch'});pill.emit('pointerup',{pointerType:'touch'});
  assert.ok(screen.emit('click',{pointerType:'touch',pointerId:1}).prevented);
  screen.emit('pointerdown',{pointerType:'touch',pointerId:2});assert.equal(screen.emit('click',{pointerType:'touch',pointerId:2}).prevented,undefined);controller.destroy();
});

test('dragging the text inside the pill moves it, stores position, and suppresses the release click',()=>{
  const {host,pill,saved,controller}=setup();const child={closest:()=>pill},before=host.getBoundingClientRect();
  pill.emit('pointerdown',{target:child,clientX:20,clientY:280});pill.emit('pointermove',{clientX:130,clientY:360});pill.emit('pointerup',{clientX:130,clientY:360});
  assert.equal(host.getBoundingClientRect().left,before.left+110);assert.equal(host.getBoundingClientRect().top,before.top+80);assert.equal(saved.length,1);assert.ok(pill.emit('click').prevented);controller.destroy();
});

test('dragging cannot move the widget off-screen and nested header buttons do not drag',()=>{
  const {host,header,saved,controller}=setup();const button=new Surface();const before=host.getBoundingClientRect();
  header.emit('pointerdown',{target:button});header.emit('pointermove',{clientX:100,clientY:100});header.emit('pointerup');assert.deepEqual(host.getBoundingClientRect(),before);assert.equal(saved.length,0);
  header.emit('pointerdown');header.emit('pointermove',{clientX:2000,clientY:-2000});header.emit('pointerup');assert.equal(host.getBoundingClientRect().left,238);assert.equal(host.getBoundingClientRect().top,12);controller.destroy();
});

test('a saved position survives remount, viewport rotation, expansion, and the soft keyboard',()=>{
  const first=setup();first.pill.emit('pointerdown');first.pill.emit('pointermove',{clientX:100,clientY:100});first.pill.emit('pointerup');const position=first.saved[0];first.controller.destroy();
  const {host,screen,article,controller}=setup({position});assert.ok(Math.abs(host.getBoundingClientRect().left-(12+226*position.x))<.01);
  host.width=292;host.height=650;screen.visualViewport.height=320;screen.visualViewport.offsetTop=60;screen.visualViewport.emit('resize');const rect=host.getBoundingClientRect();
  assert.ok(rect.left>=12&&rect.left+rect.width<=378);assert.equal(rect.top,72);assert.equal(article.style.maxHeight,'296px');
  screen.visualViewport.width=800;screen.visualViewport.height=390;screen.visualViewport.emit('resize');assert.ok(host.getBoundingClientRect().left+host.width<=788);controller.destroy();
});

test('cancelled drags restore position, keyboard and cycle provide alternatives, cleanup removes listeners',()=>{
  const {host,pill,screen,saved,controller}=setup();const original=host.getBoundingClientRect();
  pill.emit('pointerdown');pill.emit('pointermove',{clientX:50,clientY:50});pill.emit('pointercancel');assert.deepEqual(host.getBoundingClientRect(),original);assert.equal(saved.length,0);
  pill.emit('keydown',{key:'ArrowRight'});assert.equal(host.getBoundingClientRect().left,28);assert.equal(saved.length,1);
  controller.cycle();assert.equal(host.getBoundingClientRect().left,12);assert.equal(saved.length,2);
  controller.destroy();const before=host.getBoundingClientRect();pill.emit('keydown',{key:'ArrowRight'});screen.visualViewport.width=100;screen.visualViewport.emit('resize');assert.deepEqual(host.getBoundingClientRect(),before);
});
