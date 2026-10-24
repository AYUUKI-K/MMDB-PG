import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {createLANGateway, inCIDR} from '../lan-gateway.mjs';

const key = 'pg-lan-test-only-not-a-real-secret';
async function setup(t, handler) {
  const upstream = http.createServer(handler);
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  const gateway = createLANGateway({address:'127.0.0.1', allowedCIDR:'127.0.0.0/8', upstreamPort:upstream.address().port, apiKey:key, timeoutMs:3000});
  gateway.listen(0,'127.0.0.1'); await once(gateway,'listening');
  t.after(() => { gateway.closeAllConnections(); gateway.close(); upstream.closeAllConnections(); upstream.close(); });
  const base = `http://127.0.0.1:${gateway.address().port}`;
  return {base, gateway, upstream, headers:{Authorization:`Bearer ${key}`}};
}
test('LAN CIDR matching rejects out-of-subnet clients', () => {
  assert.equal(inCIDR('192.168.3.23','192.168.3.0/24'),true);
  assert.equal(inCIDR('192.168.4.23','192.168.3.0/24'),false);
  assert.equal(inCIDR('::ffff:192.168.3.23','192.168.3.0/24'),true);
  assert.equal(inCIDR('127.0.0.1','192.168.3.0/24'),false);
  assert.equal(inCIDR('invalid','192.168.3.0/24'),false);
});
test('LAN entry authenticates APIs and never serves script or configuration', async t => {
  const {base,headers} = await setup(t,(req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(req.url === '/health' ? {service:'local-pg',executorOnline:true} : {object:'list',data:[]}));});
  const health = await (await fetch(base+'/health')).json();
  assert.equal(health.backendOnline,true); assert.equal(health.executorOnline,true); assert.ok(!JSON.stringify(health).includes(key));
  assert.equal((await fetch(base+'/v1/models')).status,401);
  assert.equal((await fetch(base+'/v1/models',{headers:{Authorization:'Bearer wrong'}})).status,401);
  assert.equal((await fetch(base+'/v1/models',{headers})).status,200);
  for (const path of ['/local-pg.user.js','/config.json','/api/build/ws','/lan-config.json']) assert.equal((await fetch(base+path,{headers})).status,404);
  assert.equal((await fetch(base+'/v1/models',{headers:{...headers,Origin:'https://untrusted.example'}})).status,403);
});
test('generation forwards the JSON payload and key only to the fixed local upstream', async t => {
  const {base,headers} = await setup(t,async(req,res)=>{
    assert.equal(req.headers.authorization,`Bearer ${key}`); assert.equal(req.headers.origin,undefined);
    assert.equal(req.url,'/v1/chat/completions');
    let text='';for await(const chunk of req)text+=chunk;
    const body=JSON.parse(text);assert.equal(body.messages[0].role,'user');
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{role:'assistant',content:'LAN_OK'}}]}));
  });
  const response=await fetch(base+'/v1/chat/completions',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({model:'pg-test',messages:[{role:'user',content:'hi'}]})});
  assert.equal(response.status,200);assert.equal((await response.json()).choices[0].message.content,'LAN_OK');
});
test('SSE is forwarded before upstream completion', async t => {
  let endStream;
  const {base,headers} = await setup(t,(req,res)=>{
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    res.write('data: {"choices":[{"delta":{"content":"first"}}]}\n\n');
    endStream=()=>res.end('data: [DONE]\n\n');
  });
  const response=await fetch(base+'/v1/chat/completions',{method:'POST',headers,body:'{}'});
  const reader=response.body.getReader();
  const first=new TextDecoder().decode((await reader.read()).value);
  assert.ok(first.includes('first'));assert.ok(!first.includes('[DONE]'));
  endStream();let tail='';for(;;){const chunk=await reader.read();if(chunk.done)break;tail+=new TextDecoder().decode(chunk.value);}
  assert.ok(tail.includes('[DONE]'));
});

test('non-streaming generation is not subject to a gateway read timeout', async t => {
  const upstream=http.createServer(async(req,res)=>{
    for await(const chunk of req) { }
    await delay(240);
    res.setHeader('Content-Type','application/json');res.end('{"result":"complete"}');
  });
  upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
  const gateway=createLANGateway({address:'127.0.0.1',allowedCIDR:'127.0.0.0/8',apiKey:key,upstreamPort:upstream.address().port,timeoutMs:80});
  gateway.listen(0,'127.0.0.1');await once(gateway,'listening');
  t.after(()=>{gateway.closeAllConnections();gateway.close();upstream.closeAllConnections();upstream.close();});
  const response=await fetch(`http://127.0.0.1:${gateway.address().port}/v1/chat/completions`,{method:'POST',headers:{Authorization:`Bearer ${key}`},body:'{}'});
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{result:'complete'});
});
