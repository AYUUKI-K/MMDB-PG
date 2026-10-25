import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startServices,chooseLAN} from '../launch.mjs';

const config={port:0,apiKey:'mmdb',models:['test'],timeoutMs:2000};
test('portable launcher serves core and closes without a browser or Google',async()=>{
  const service=await startServices(config);
  const url=`http://127.0.0.1:${service.relay.server.address().port}/health`;
  try {assert.equal((await(await fetch(url)).json()).executorOnline,false);}finally{service.close();}
});
test('port collision does not stop the already running relay',async()=>{
  const service=await startServices(config),port=service.relay.server.address().port;
  try {
    await assert.rejects(startServices({...config,port}),{code:'EADDRINUSE'});
    assert.equal((await(await fetch(`http://127.0.0.1:${port}/health`)).json()).service,'local-pg');
  }finally{service.close();}
});
test('ambiguous LAN selection fails rather than exposing an arbitrary interface',()=>{
  const row=address=>({address,internal:false,family:'IPv4'});
  assert.equal(chooseLAN({wifi:[row('192.168.1.2')]}).allowedCIDR,'192.168.1.0/24');
  assert.throws(()=>chooseLAN({wifi:[row('192.168.1.2')],vpn:[row('10.1.1.2')]}));
});
