import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {textModels,decodeModelCatalog,CATALOG_TTL_MS} from '../src/server/capabilities.mjs';
import {relayFixture,catalogRow} from './helpers.mjs';

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
