import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {RequestDeadlines} from '../src/server/deadlines.mjs';
import {relayFixture,frame,toolPart,finish} from './helpers.mjs';

test('queue, first-content, idle and total deadlines have independent clocks',()=>{
  const d=new RequestDeadlines({timeoutMs:100,toolFirstByteTimeoutMs:500,queueTimeoutMs:300,maxRequestMs:1000},{extended:true,queued:true});
  assert.equal(d.next().at,300);assert.equal(d.next().code,'queue_timeout');
  d.start(250);d.start(290);assert.equal(d.next().at,750);
  d.data(450,false);d.data(600,false);assert.equal(d.next().at,750);
  d.data(700,true);assert.equal(d.next().at,800);d.data(780);assert.equal(d.next().at,880);
  d.round(900,true);assert.equal(d.next().at,1000);assert.equal(d.next().code,'request_deadline');
});

test('a new executor can wait in queue longer than generation idle budget',async t=>{
  const f=await relayFixture(t,{timeoutMs:100,toolFirstByteTimeoutMs:300,queueTimeoutMs:800,streamKeepAliveMs:25});
  const dispatched=f.nextRequest(),work=f.call();const msg=await dispatched;
  f.send(msg,{type:'progress',phase:'queued'});await delay(220);
  f.send(msg,{type:'progress',phase:'preparing'});await delay(150);
  f.deliver(msg,[frame([toolPart('after queue')]),finish()]);
  assert.equal((await(await work).json()).choices[0].message.content,'after queue');
});

test('a raw JSON prefix does not shorten the buffered tool wait',async t=>{
  const f=await relayFixture(t,{timeoutMs:90,toolFirstByteTimeoutMs:500,streamKeepAliveMs:25});
  const dispatched=f.nextRequest(),work=f.call();const msg=await dispatched;
  f.send(msg,{type:'progress',phase:'preparing'});
  f.send(msg,{type:'stream-chunk',chunkBody:'[['});await delay(240);
  f.send(msg,{type:'stream-chunk',chunkBody:JSON.stringify(frame([toolPart('buffered answer')]))+','+JSON.stringify(finish())+']]'});
  f.send(msg,{type:'stream-end'});
  assert.equal((await(await work).json()).choices[0].message.content,'buffered answer');
});

test('queue timeout cancels a queued job even if queued events keep arriving',async t=>{
  const f=await relayFixture(t,{queueTimeoutMs:180,streamKeepAliveMs:25});
  const dispatched=f.nextRequest(),work=f.call();const msg=await dispatched;
  const timer=setInterval(()=>f.send(msg,{type:'progress',phase:'queued'}),30);t.after(()=>clearInterval(timer));
  const result=await(await work).json();clearInterval(timer);assert.equal(result.error.code,'queue_timeout');assert.equal((await f.status()).pending,0);
});

test('a request total deadline survives live data, progress and keepalives',async t=>{
  const f=await relayFixture(t,{timeoutMs:140,maxRequestMs:240,streamKeepAliveMs:25});
  const dispatched=f.nextRequest(),work=f.call({model:'pg-test',stream:true});const msg=await dispatched;
  f.send(msg,{type:'progress',phase:'preparing'});f.send(msg,{type:'stream-chunk',chunkBody:'[['+JSON.stringify(frame([[null,'start']]))});
  const timer=setInterval(()=>f.send(msg,{type:'stream-chunk',chunkBody:','+JSON.stringify(frame([[null,'.']]))}),40);t.after(()=>clearInterval(timer));
  const raw=await(await work).text();clearInterval(timer);assert.match(raw,/request_deadline/);assert.doesNotMatch(raw,/\[DONE\]/);
});

test('connection, logical request and attempt identities reject stale output after retry',async t=>{
  const f=await relayFixture(t);let current;
  f.ws.on('message',raw=>{const msg=JSON.parse(raw);if(msg.type!=='request')return;current=msg;
    f.send(msg,{type:'progress',phase:'preparing'});
    f.send(msg,{type:'progress',phase:'network-retry',attemptIndex:1});
    f.send(msg,{type:'response',rawResponse:JSON.stringify([[frame([toolPart('STALE')]),finish()]])});
    for(const identity of [{connectionId:'old-connection'},{logicalRequestId:'other-request'}])f.send(msg,{type:'error',attemptIndex:1,...identity,status:502,error:{code:'stale'}});
    f.deliver({...msg,attemptIndex:1},[frame([toolPart('current')]),finish()]);
  });
  const result=await(await f.call()).json(),row=(await f.status()).recent[0];
  assert.ok(current.connectionId);assert.equal(result.choices[0].message.content,'current');assert.equal(row.attempts.length,2);assert.equal(result.usage,undefined);
});
