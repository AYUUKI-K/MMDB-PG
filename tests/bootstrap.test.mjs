import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {bootBridge} from '../src/browser/bootstrap.js';

test('page hooks start while the document is loading, before DOMContentLoaded',()=>{
  let started=0;
  bootBridge(()=>started++,{readyState:'loading',documentElement:{}},()=>assert.fail('must not defer hooks'));
  assert.equal(started,1);
});

test('document-start without a root waits only for the root and starts once',()=>{
  const documentNode={readyState:'loading',documentElement:null};let started=0;const pending=[];
  bootBridge(()=>started++,documentNode,callback=>pending.push(callback));
  assert.equal(started,0);assert.equal(pending.length,1);
  documentNode.documentElement={};pending.shift()();
  assert.equal(started,1);assert.equal(pending.length,0);
});

// Only the DOM surface used during startup; run the built browser code itself.
function browser({mobile=false}={}) {
  class Element extends EventTarget {
    constructor(tag,ownerDocument){
      super();Object.assign(this,{tag,ownerDocument,children:[],attributes:{},dataset:{},style:{setProperty(){},removeProperty(){}},classList:{toggle(){}}});
    }
    setAttribute(name,value){this.attributes[name]=value;}
    append(...nodes){this.children.push(...nodes);}
    replaceChildren(...nodes){this.children=nodes;}
    attachShadow(){return this.shadowRoot=new Element('shadow',this.ownerDocument);}
    find(match){for(const child of this.children){if(match(child))return child;const found=child.find(match);if(found)return found;}return null;}
    getElementById(id){return this.find(node=>node.attributes.id===id);}
    querySelector(selector){return this.find(node=>selector.startsWith('.')?node.attributes.class?.split(' ').includes(selector.slice(1)):selector==='button[type=submit]'?node.tag==='button'&&node.attributes.type==='submit':node.tag===selector);}
    getBoundingClientRect(){return {width:336,height:580,left:0,top:0};}
  }
  const document=Object.assign(new EventTarget(),{visibilityState:'visible'});
  document.createElement=tag=>new Element(tag,document);
  document.createElementNS=(namespaceURI,tag)=>Object.assign(document.createElement(tag),{namespaceURI});
  document.createTextNode=text=>Object.assign(document.createElement('#text'),{textContent:text});
  document.documentElement=document.createElement('html');
  document.querySelector=selector=>document.documentElement.querySelector(selector);
  const controls=new Map(['idle','ready','simulate','failure'].map(id=>[id,document.createElement('button')]));
  document.getElementById=id=>controls.get(id);
  const location={hostname:'aistudio.google.com',href:'https://aistudio.google.com/prompts/new_chat'};
  const navigator={userAgent:mobile?'Android Mobile':'Windows',maxTouchPoints:mobile?1:0};
  const window=Object.assign(new EventTarget(),{document,location,navigator,innerWidth:mobile?390:1280,innerHeight:800,matchMedia:()=>({matches:mobile}),fetch:()=>assert.fail('startup must not contact Google')});
  document.defaultView=window;
  const errors=[];
  class WebSocket { readyState=0; }
  const context=vm.createContext({document,window,location,navigator,URL,WebSocket,CSS:{supports:()=>true},console:{error:(...args)=>errors.push(args.map(String).join(' '))},setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){}});
  return {document,controls,context,errors};
}

for(const mobile of [false,true])test(`built userscript starts with default settings on ${mobile?'mobile':'desktop'}`,()=>{
  const f=browser({mobile});
  vm.runInContext(readFileSync(new URL('../dist/local-pg.user.js',import.meta.url),'utf8'),f.context);
  assert.deepEqual(f.errors,[],'bootstrap must not report a startup failure');
  const panel=f.document.querySelector('mmdb-local-bridge').shadowRoot;
  assert.equal(panel.getElementById('headline').textContent,'等待激活');
  assert.equal(panel.getElementById('inputReadScope').value,'turn');
  assert.equal(panel.getElementById('completeToolOutput').checked,true);
  assert.equal(panel.getElementById('inputRead').checked,false);
  assert.equal(panel.getElementById('outputEnvelope').value,'off');
});

test('built preview runs without source imports and renders disconnected defaults',()=>{
  const f=browser();
  const html=readFileSync(new URL('../dist/preview.html',import.meta.url),'utf8');
  const script=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
  vm.runInContext(script.replace(/^export /gm,''),f.context);
  const panel=f.document.querySelector('mmdb-local-bridge').shadowRoot;
  assert.equal(panel.getElementById('headline').textContent,'可以开始 RP');
  f.controls.get('idle').onclick();
  assert.equal(panel.getElementById('headline').textContent,'等待激活');
  assert.equal(panel.getElementById('inputReadScope').value,'turn');
  assert.equal(panel.getElementById('completeToolOutput').checked,true);
  assert.equal(panel.getElementById('completeToolOutput').disabled,true);
});
