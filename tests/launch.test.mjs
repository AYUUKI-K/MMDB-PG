import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startServices,chooseLAN} from '../launch.mjs';
import {networkInterfaces} from 'node:os';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {privateIPv4} from '../src/server/lan-gateway.mjs';

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

test('optional LAN selection failure keeps the loopback API alive and is visible in authenticated status',async()=>{
  const errors=[];
  const service=await startServices(config,undefined,{optionalLAN:true,resolveLAN:()=>{throw Error('synthetic network ambiguity');},onLANError:error=>errors.push(error)});
  try{
    const base=`http://127.0.0.1:${service.relay.server.address().port}`;
    assert.equal((await fetch(base+'/health')).status,200);
    const state=await(await fetch(base+'/v1/status',{headers:{Authorization:'Bearer mmdb'}})).json();
    assert.equal(state.connections.available,false);assert.match(state.connections.message,/ambiguity/);assert.equal(errors.length,1);
    assert.equal((await fetch(base+'/v1/lan/enable',{method:'POST'})).status,401);
    assert.equal((await fetch(base+'/v1/lan/enable',{method:'POST',headers:{Authorization:'Bearer mmdb',Origin:'https://aistudio.google.com'}})).status,403);
  }finally{service.close();}
});

test('unsafe LAN subnets fail closed without taking down the loopback relay',async()=>{
  for(const allowedCIDR of ['192.168.3.0/','0.0.0.0/0','192.168.0.0/15']){
    const service=await startServices(config,{address:'192.168.3.23',port:18766,allowedCIDR},{optionalLAN:true});
    try{
      assert.equal(service.connections.available,false);assert.equal(service.gateway,undefined);
      assert.equal((await fetch(`http://127.0.0.1:${service.relay.server.address().port}/health`)).status,200);
    }finally{service.close();}
  }
});

test('a failed phone listener can be retried without restarting the core; concurrent starts share one gateway',async t=>{
  const address=Object.values(networkInterfaces()).flat().find(row=>row&&!row.internal&&row.family==='IPv4'&&privateIPv4(row.address))?.address;
  if(!address){t.skip('No private LAN interface on this test host');return;}
  const occupied=createServer();occupied.listen(0,address);await once(occupied,'listening');
  const port=occupied.address().port,lan={address,port,allowedCIDR:address+'/32'};
  const service=await startServices(config,lan,{optionalLAN:true});
  t.after(()=>{occupied.close();service.close();});
  const core=service.relay.server.address().port,base=`http://127.0.0.1:${core}`,headers={Authorization:'Bearer mmdb'};
  assert.equal(service.gateway,undefined);
  assert.equal((await fetch(base+'/v1/models',{headers})).status,200);
  await new Promise(resolve=>occupied.close(resolve));
  const results=await Promise.all([service.ensureLAN(),service.ensureLAN()]);
  assert(results.every(result=>result.available));assert.equal(service.relay.server.address().port,core);
  const phone=`http://${address}:${port}`;
  assert.equal((await fetch(phone+'/v1/models')).status,401);
  assert.equal((await fetch(phone+'/v1/models',{headers})).status,200);
  assert.equal((await fetch(phone+'/local-pg.user.js',{headers})).status,404);
  assert.equal((await fetch(phone+'/v1/status',{headers})).status,404);
  assert.equal((await fetch(phone+'/v1/lan/enable',{method:'POST',headers})).status,404);
  assert.equal((await fetch(phone+'/v1/models',{headers:{...headers,Origin:'http://untrusted.invalid'}})).status,403);
  const previous=service.gateway;
  assert.equal((await(await fetch(base+'/v1/lan/enable',{method:'POST',headers})).json()).available,true);
  assert.equal(service.gateway,previous);
});
