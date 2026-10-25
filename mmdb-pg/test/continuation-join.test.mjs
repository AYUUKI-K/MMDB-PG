import {test} from 'node:test';
import assert from 'node:assert/strict';
import {joinContinuation,nextTurn,continuationBudget} from '../continuation.mjs';

test('seam checks preserve short natural repetition, whitespace, code fences and Unicode',()=>{
  for(const [before,after] of [['他说好。','好。接着走。'],['paragraph\n','\nnext'],['```js\ncode\n```','```\nnext'],['😀🐈'.repeat(20),'😀🐈'.repeat(20)+'tail'],['-'.repeat(64),'-'.repeat(64)+'\nnext']]){
    const joined=joinContinuation(before,after);assert.equal(joined.text,after);assert.equal(joined.overlapChars,0);
  }
  const seam='Alpha 中文 🐈 '.repeat(4)+'\n  ';
  assert.equal(joinContinuation('intro\n'+seam,seam+'\n  next').text,'\n  next');
});

test('full-answer replay and a previous-round replay are recognized without fuzzy editing',()=>{
  const previous='A long previous paragraph with enough meaningful characters.\n'.repeat(180);
  assert.ok(previous.length>8192);
  const joined=joinContinuation(previous,previous+'new tail');assert.equal(joined.text,'new tail');assert.equal(joined.overlapChars,previous.length);
  assert.equal(joinContinuation(previous,previous.slice(0,9000)).hasProgress,false);
  assert.equal(joinContinuation('prefix PART',' \nPART\n ','PART').hasProgress,false);
  const changed='A long previous paragraph with enough meaningful characters!\n';
  assert.equal(joinContinuation(previous,changed+'new tail').text,changed+'new tail');
});

test('long repeated seam patterns complete with bounded matching and preserve unrelated output',()=>{
  const seam='abcd'.repeat(2048),after=seam+'new content';
  assert.equal(joinContinuation('header'+seam,after).text,'new content');
  const unrelated='xyz'.repeat(100000);assert.equal(joinContinuation(seam,unrelated).text,unrelated);
});

test('next request preserves aliases, settings, and original history without mutating the caller',()=>{
  const body={contents:[{role:'user',parts:[{text:'original'}]}],generation_config:{temperature:1.2,topP:0.8,maxOutputTokens:100}};
  const original=structuredClone(body),next=nextTurn(body,'visible only',30);
  assert.deepEqual(body,original);assert.equal(next.generation_config,undefined);assert.deepEqual(next.generationConfig,{temperature:1.2,topP:0.8,maxOutputTokens:30});assert.equal(next.contents.at(-2).parts[0].text,'visible only');
  assert.deepEqual(continuationBudget(undefined,undefined),{});
  assert.deepEqual(continuationBudget(100,{candidatesTokenCount:30,thoughtsTokenCount:5}),{remaining:65});
  assert.deepEqual(continuationBudget(100,{candidatesTokenCount:100}),{stop:'unknown_usage'});
});
