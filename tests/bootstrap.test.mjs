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
