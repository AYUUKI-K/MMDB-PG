import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GooglePageSession} from '../src/browser/session.js';

function fixture({draft='',disabled=false,label='Run',click}={}) {
  let clicks=0,filled=0;
  const run={disabled,getAttribute:()=>null,getClientRects:()=>[{}],querySelector:()=>({textContent:label}),click(){clicks++;click?.(session,input);}};
  const input={value:draft,closest:()=>({querySelectorAll:()=>[run]})};
  const session=Object.assign(Object.create(GooglePageSession.prototype),{
    page:{location:{href:'https://aistudio.google.com/prompts/new_chat'}},hooked:true,requestCount:0,proofCount:0,service:{},proofOK:false,headers:{},
    discover(){},newConversation:async()=>{},textarea:()=>input,fill(el,value){filled++;el.value=value;}
  });
  return {session,input,run,clicks:()=>clicks,filled:()=>filled,activate:(options={})=>session.activate(new AbortController().signal,{timeoutMs:100,pollMs:1,...options})};
}
test('activation sends exactly Meow once and waits for new proof, request and native generation completion',async()=>{
  let finish;
  const f=fixture({click:(session,input)=>{assert.equal(input.value,'Meow');input.disabled=true;session.requestCount++;session.proofCount++;session.proofOK=true;session.headers={'x-goog-api-key':'public'};finish=()=>input.disabled=false;}});
  let done=false;const work=f.activate().then(()=>done=true);await new Promise(resolve=>setTimeout(resolve,5));assert.equal(done,false);finish();await work;assert.equal(f.clicks(),1);
});
test('drafts and an active native generation are never overwritten',async()=>{
  for(const settings of [{draft:'keep my draft'},{label:'Stop'}]){
    const f=fixture(settings);await assert.rejects(f.activate());assert.equal(f.filled(),0);assert.equal(f.clicks(),0);
  }
});
test('disabled send times out and removes only its own unsent Meow',async()=>{
  const f=fixture({disabled:true});await assert.rejects(f.activate({timeoutMs:5}),/超时/);assert.equal(f.input.value,'');assert.equal(f.clicks(),0);
  const other=fixture({disabled:true});const pending=other.activate();await Promise.resolve();other.input.value='a new draft';await assert.rejects(pending,/内容已变化/);assert.equal(other.input.value,'a new draft');
});
test('stale ready state cannot report activation success; timeout never resends',async()=>{
  const f=fixture();f.session.proofOK=true;f.session.service={};f.session.headers={'x-goog-api-key':'public'};
  await assert.rejects(f.activate({timeoutMs:5}),/超时/);assert.equal(f.clicks(),1);
});
test('abort before send and duplicate activations never submit another prompt',async()=>{
  const f=fixture({disabled:true}),controller=new AbortController();
  controller.abort();await assert.rejects(f.session.activate(controller.signal),{name:'AbortError'});assert.equal(f.clicks(),0);
  const pending=f.activate({timeoutMs:5});await assert.rejects(f.activate(),/正在激活/);await assert.rejects(pending,/超时/);assert.equal(f.clicks(),0);
});

function conversation(t,{draft='',label='Run',alreadyEmpty=false,transition=true}={}){
  const f=fixture({draft,label});delete f.session.newConversation;
  f.session.page.location.href=alreadyEmpty?'https://aistudio.google.com/prompts/new_chat':'https://aistudio.google.com/prompts/previous';
  let turns=alreadyEmpty?0:2,newChats=0;
  const newButton={getClientRects:()=>[{}],getAttribute:()=>null,click(){newChats++;if(transition){turns=0;f.session.page.location.href='https://aistudio.google.com/prompts/new_chat';}}};
  const previous=globalThis.document;
  globalThis.document={querySelectorAll:selector=>selector==='ms-chat-turn'?Array(turns).fill({}):[newButton]};
  t.after(()=>{globalThis.document=previous;});
  return {...f,newChats:()=>newChats,prepare:(options={})=>f.session.newConversation(new AbortController().signal,{timeoutMs:10,pollMs:1,...options})};
}

test('an existing conversation is replaced through the native new-chat action before sending Meow',async t=>{
  const f=conversation(t);f.run.click=()=>{assert.equal(f.newChats(),1);assert.equal(f.input.value,'Meow');f.session.requestCount++;f.session.proofCount++;f.session.proofOK=true;f.session.headers={'x-goog-api-key':'public'};};
  await f.activate();assert.equal(f.newChats(),1);assert.match(f.session.page.location.href,/new_chat$/);
});
test('an already blank Playground uses its empty conversation without adding another tab',async t=>{
  const f=conversation(t,{alreadyEmpty:true});await f.prepare();assert.equal(f.newChats(),0);
});
test('new-chat activation preserves drafts and never navigates during native generation',async t=>{
  const f=conversation(t,{draft:'keep this'});await assert.rejects(f.prepare(),/草稿/);assert.equal(f.newChats(),0);
  f.input.value='';f.input.disabled=true;await assert.rejects(f.prepare(),/正在生成/);assert.equal(f.newChats(),0);
});
test('an uncompleted native new-chat action cannot send Meow into the old conversation',async t=>{
  const f=conversation(t,{transition:false});await assert.rejects(f.activate({timeoutMs:5}),/未能新建/);assert.equal(f.newChats(),1);assert.equal(f.clicks(),0);assert.equal(f.input.value,'');assert.equal(f.session.activating,false);
});
