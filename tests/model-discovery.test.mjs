import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {textModels,decodeModelCatalog,modelCapability,supportsNativeContinuation,CATALOG_TTL_MS} from '../src/server/capabilities.mjs';
import {relayFixture,catalogRow,frame,toolPart,finish} from './helpers.mjs';

test('fresh canonical chat models are appended without aliases, duplicate IDs or media models',()=>{
  const rows=[catalogRow({id:'new-chat',flags:[1,10],aliases:[['models/new-alias']]}),catalogRow({id:'duplicate',flags:[1]}),catalogRow({id:'duplicate',flags:[1]}),catalogRow({id:'unknown',flags:[]}),catalogRow({id:'image-generator',flags:[1,21]}),catalogRow({id:'audio-generator',flags:[1,53]})];
  rows.push(catalogRow({id:'live-session',flags:[1,26]}),catalogRow({id:'speech-translation',flags:[1,46]}));
  const noFlags=catalogRow({id:'missing-flags'});noFlags[64]=null;rows.push(noFlags);
  const wrongMethod=catalogRow({id:'other-method',flags:[1]});wrongMethod[7]=['embedContent'];rows.push(wrongMethod);
  const owner={catalog:decodeModelCatalog(JSON.stringify([rows])),catalogAt:10};
  assert.deepEqual(textModels(owner,['manual','new-chat'],10),['manual','new-chat']);
  assert.deepEqual(textModels(owner,['manual'],10),['manual','new-chat']);
  assert.deepEqual(textModels(owner,['manual'],10+CATALOG_TTL_MS),['manual']);
  assert.deepEqual(textModels(null,['manual']),['manual']);
});

test('both model list APIs synchronize ordinary models and retain the exact configured anti-truncation entries',async t=>{
  const f=await relayFixture(t);
  const list=async()=>await(await fetch(f.base+'/v1/models',{headers:f.headers})).json();
  assert.deepEqual((await list()).data.map(m=>m.id),['pg-test','pg-test-抗截断']);
  await f.catalog([catalogRow({id:'new-chat',flags:[1,10]}),catalogRow({id:'test',flags:[1,10]})]);
  assert.deepEqual((await list()).data.map(m=>m.id),['pg-test','pg-test-抗截断','pg-new-chat']);
  const native=await(await fetch(f.base+'/v1beta/models',{headers:f.headers})).json();
  assert.deepEqual(native.models.map(m=>m.name),['models/pg-test','models/pg-test-抗截断','models/pg-new-chat']);
  f.ws.send(JSON.stringify({type:'catalog-invalidated',connectionId:f.connectionId,sessionRevision:1}));
  for(let i=0;(await f.status()).catalog.state==='ready'&&i<50;i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal((await f.status()).catalog.state,'unavailable');
  assert.deepEqual((await list()).data.map(m=>m.id),['pg-test','pg-test-抗截断']);
  await f.catalog([catalogRow({id:'new-chat',flags:[1,10]})],1);
  const closed=once(f.ws,'close');f.ws.close();await closed;
  // Client close and the server's close callback run on separate sockets.
  for(let i=0;(await f.status()).executorOnline&&i<50;i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal((await f.status()).executorOnline,false);
  assert.deepEqual((await list()).data.map(m=>m.id),['pg-test','pg-test-抗截断']);
});

test('aliases cannot restore capabilities from a duplicate canonical model, in either row order',()=>{
  const conflicting=[catalogRow({id:'duplicate',flags:[1,10,91],aliases:[['models/first-alias']]}),catalogRow({id:'duplicate',flags:[1,10,91],aliases:[['models/second-alias']]})];
  for(const rows of [conflicting,[...conflicting].reverse()]){
    const owner={catalog:decodeModelCatalog(JSON.stringify([[...rows,catalogRow({id:'valid',flags:[1,10,91],aliases:[['models/valid-alias']]})]])),catalogAt:10};
    for(const id of ['duplicate','first-alias','second-alias']){
      assert.equal(modelCapability(owner,id,10),undefined,id);
      assert.equal(supportsNativeContinuation(modelCapability(owner,id,10)),false,id);
    }
    assert.equal(supportsNativeContinuation(modelCapability(owner,'valid-alias',10)),true);
    assert.deepEqual(textModels(owner,[],10),['valid']);
  }
});

test('failed same-session catalogs retain models and native capability only until the original expiry',async t=>{
  const f=await relayFixture(t,{nativeContinuation:true});
  const update=async(raw,sessionRevision=0)=>{
    f.ws.send(JSON.stringify({type:'model-catalog',connectionId:f.connectionId,sessionRevision,raw}));
    const pong=once(f.ws,'pong');f.ws.ping();await pong;
  };
  const list=async()=> (await (await fetch(f.base+'/v1/models',{headers:f.headers})).json()).data.map(row=>row.id);
  await f.catalog([catalogRow({flags:[1,10,91]}),catalogRow({id:'discovered',flags:[1,10]})]);
  const owner=[...f.app.wss.clients][0],acceptedAt=owner.catalogAt;
  await update('malformed');
  assert.equal(owner.catalogAt,acceptedAt,'a failed refresh must not extend the TTL');
  assert.equal((await f.status()).catalog.state,'ready');
  assert.ok((await list()).includes('pg-discovered'));
  const dispatched=f.nextRequest(),work=f.call();const msg=await dispatched;
  assert.equal(JSON.parse(msg.requestBody).wire[3][45],1);
  f.deliver(msg,[frame([toolPart('native reply')]),finish()]);
  assert.equal((await(await work).json()).mmdb.continuationMode,'native');

  owner.catalogAt=Date.now()-CATALOG_TTL_MS;
  await update('malformed');
  assert.equal((await f.status()).catalog.state,'stale');
  assert.deepEqual((await f.status()).experiments.nativeModels,[]);
  assert.ok(!(await list()).includes('pg-discovered'));

  await update(JSON.stringify([[catalogRow({flags:[1,10,91]}),catalogRow({id:'replacement',flags:[1]})]]));
  assert.equal((await f.status()).catalog.state,'ready');
  assert.ok((await list()).includes('pg-replacement'));
  assert.ok(!(await list()).includes('pg-discovered'));
  await update('malformed',1);
  assert.equal((await f.status()).catalog.state,'invalid');
  assert.ok(!(await list()).includes('pg-replacement'),'a changed session must discard old capabilities even when its catalog fails');
});
