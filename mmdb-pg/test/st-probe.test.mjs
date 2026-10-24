import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {inspectPhone} from '../tools/check-st-reasoning.mjs';

async function fixture(t,patched=true,denied=false,startDelayMs=0){
  let calls=0,readinessCalls=0;
  const server=http.createServer(async(req,res)=>{
    if(req.url==='/csrf-token'){
      readinessCalls++;
      if(denied){res.writeHead(401);res.end();return;}
      res.writeHead(200,{'Content-Type':'application/json','Set-Cookie':'probe=session; Path=/; HttpOnly'});res.end('{"token":"local-token"}');return;
    }
    assert.equal(req.url,'/api/backends/chat-completions/generate');assert.equal(req.headers.cookie,'probe=session');assert.equal(req.headers['x-csrf-token'],'local-token');
    let raw='';for await(const part of req)raw+=part;const input=JSON.parse(raw);calls++;
    assert.equal(input.reasoning_effort,'high');assert.equal(new URL(input.custom_url).hostname,'127.0.0.1');
    const upstream=await fetch(input.custom_url+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer NEVER_PRINT_THIS'},body:JSON.stringify({model:input.model,messages:input.messages,...(patched?{reasoning_effort:input.reasoning_effort}:{})})});
    res.writeHead(upstream.status,{'Content-Type':'application/json'});res.end(await upstream.text());
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const port=server.address().port;
  let startup;
  if(startDelayMs){
    await new Promise(resolve=>server.close(resolve));
    startup=setTimeout(()=>server.listen(port,'127.0.0.1'),startDelayMs);
  }
  t.after(()=>{clearTimeout(startup);server.closeAllConnections();server.close();});
  return {url:`http://127.0.0.1:${port}`,calls:()=>calls,readinessCalls:()=>readinessCalls};
}
test('phone probe distinguishes a loaded patch from a dropping backend with no live provider',async t=>{
  for(const patched of [false,true]){
    const app=await fixture(t,patched);const result=await inspectPhone(app.url);
    assert.equal(result.status,200);assert.equal(result.observed.effort,patched?'high':'missing');assert.equal(app.calls(),1);
    assert.ok(!JSON.stringify(result).includes('NEVER_PRINT_THIS'));assert.ok(!JSON.stringify(result).includes('messages'));
  }
});
test('phone probe reports access failures without bypassing authentication',async t=>{
  const app=await fixture(t,false,true);assert.deepEqual(await inspectPhone(app.url),{stage:'csrf',status:401,observed:null});assert.equal(app.calls(),0);assert.equal(app.readinessCalls(),1);
});
test('phone probe refuses external target addresses before opening a listener',async()=>{
  await assert.rejects(inspectPhone('https://example.com'));await assert.rejects(inspectPhone('http://192.168.3.59:8766'));
});

test('phone probe waits for a restarting backend and sends the mock POST once',async t=>{
  const app=await fixture(t,true,false,150);
  const result=await inspectPhone(app.url,{readyTimeoutMs:2000,pollMs:25});
  assert.equal(result.observed.effort,'high');assert.equal(app.calls(),1);
});

test('phone probe bounds startup waiting and reports that forwarding is untested',async t=>{
  const app=await fixture(t,true,false,5000);
  const result=await inspectPhone(app.url,{readyTimeoutMs:100,pollMs:10});
  assert.deepEqual(result,{stage:'startup',status:null,observed:null});assert.equal(app.calls(),0);
});
