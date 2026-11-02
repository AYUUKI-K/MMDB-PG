import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {EventEmitter,once} from 'node:events';
import http from 'node:http';
import {inlineImage,prepareImages,downloadImage,imageDestination,publicImageAddress,IMAGE_LIMITS,wireBinding} from '../src/server/images.mjs';
import {toWire,fromOpenAI} from '../src/server/protocol.mjs';
import {headlessRequest} from '../src/server/headless-protocol.mjs';
import {InputRead} from '../src/server/input-read.mjs';
import {nextTurn} from '../src/server/continuation.mjs';
import {createRelay} from '../src/server/server.mjs';
import {relayFixture,frame,finish} from './helpers.mjs';

const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',image={mimeType:'image/png',data:png};
const message=()=>({role:'user',content:[{type:'text',text:'before'},{type:'image_url',image_url:{url:'data:image/png;base64,'+png}},{type:'text',text:'after'}]});
test('OpenAI image ordering and binding survive browser wire, headless conversion and continuation',async()=>{
  const body={messages:[message()]};assert.deepEqual(await prepareImages(body,{openai:true}),{count:1,bytes:Buffer.from(png,'base64').length});
  const converted=fromOpenAI(body),wire=toWire('test',converted);assert.deepEqual(wire.wire[1][0][0],[[null,'before'],[null,null,['image/png',png]],[null,'after']]);assert.equal(wire.binding,'before '+png+' after');
  assert.deepEqual(headlessRequest(wire).body.contents,converted.contents);assert.deepEqual(nextTurn(converted,'answer').contents[0],converted.contents[0]);
  for(const body of [converted,{contents:[{role:'user',parts:[{inlineData:image}]}]}]){const reader=new InputRead(body,{synthetic:true}),payload=reader.answerPayload(body,b=>toWire('test',b));assert.equal(payload.wire[1].flatMap(t=>t[0]).filter(p=>p[2]).length,1);assert(payload.binding.includes(png));assert.equal(payload.binding,wireBinding(payload.wire[1]));}
});
test('rejects invalid data, mismatched MIME, oversized and too many images',async()=>{
  assert.throws(()=>inlineImage({mimeType:'image/jpeg',data:png}),/MIME/);assert.throws(()=>inlineImage({mimeType:'image/png',data:'x!'}),/Base64/);assert.throws(()=>inlineImage({mimeType:'image/svg+xml',data:'abcd'}),/仅支持/);
  assert.throws(()=>inlineImage({mimeType:'image/png',data:'a'.repeat(Math.ceil(IMAGE_LIMITS.perImage/3)*4+4097)}),/8 MiB/);
  await assert.rejects(prepareImages({messages:Array.from({length:9},message)},{openai:true}),/8 张/);
  assert.throws(()=>toWire('test',{contents:[{parts:[{text:'x',inlineData:image}]}]}),/混合/);
  const native={contents:[{parts:[{inline_data:{mime_type:'image/png',data:png}}]}]};await prepareImages(native);assert.deepEqual(native.contents[0].parts[0],{inlineData:image});
});
test('URL fetch refuses local, private, mapped and rebinding addresses',async()=>{
  for(const address of ['127.0.0.1','10.2.3.4','169.254.169.254','100.64.0.1','192.168.1.1','::1','::ffff:127.0.0.1','::ffff:7f00:1','fc00::1','fe80::1','2002:7f00:1::','2001:db8::1'])assert.equal(publicImageAddress(address),false,address);
  assert.equal(publicImageAddress('8.8.8.8'),true);assert.equal(publicImageAddress('2606:4700:4700::1111'),true);
  for(const url of ['file:///C:/x.png','http://2130706433/x','https://user:pass@example.com/x','http://example.com:8765/x'])await assert.rejects(imageDestination(url));
  await assert.rejects(imageDestination('https://example.com/img',{resolve:async()=>[{address:'8.8.8.8',family:4},{address:'127.0.0.1',family:4}]}),/不能指向/);
});
test('downloads pin DNS, strip credentials, check redirect destinations and hide URLs on error',async()=>{
  let seen,looked;const response=(status,headers,bytes=Buffer.from(png,'base64'))=>Object.assign(Readable.from([bytes]),{statusCode:status,headers});
  const request=(_url,options,callback)=>{seen=options;options.lookup('example.com',{all:true},(_error,rows)=>looked=rows);const req=new EventEmitter();req.setTimeout=()=>{};req.end=()=>queueMicrotask(()=>callback(response(200,{})));return req;};
  assert.deepEqual(await downloadImage('https://example.com/img?secret=signed',{resolve:async()=>[{address:'8.8.8.8',family:4}],request}),image);assert.deepEqual(looked,[{address:'8.8.8.8',family:4}]);assert(!seen.headers.Authorization&&!seen.headers.Cookie);
  const redirect=(_url,_options,callback)=>{const req=new EventEmitter();req.setTimeout=()=>{};req.end=()=>queueMicrotask(()=>callback(response(302,{location:'http://127.0.0.1/private'})));return req;};
  await assert.rejects(downloadImage('https://example.com/a',{resolve:async()=>[{address:'8.8.8.8',family:4}],request:redirect}),e=>e.code==='image_url_forbidden'&&!e.message.includes('/private'));
  await assert.rejects(downloadImage('https://example.com/SECRET',{resolve:async()=>{throw Error('SECRET');}}),e=>!e.message.includes('SECRET'));
});
test('browser relay sends an image through the WS executor in JSON and SSE modes',async t=>{
  const f=await relayFixture(t,{inputRead:true,inputReadSynthetic:true});let sent=0;f.ws.on('message',raw=>{const m=JSON.parse(raw);if(m.type!=='request')return;sent++;const payload=JSON.parse(m.requestBody);assert(payload.binding.includes(png));assert(payload.wire[1].some(t=>t[0].some(p=>p[2]?.[1]===png)));f.deliver(m,[frame([[null,'image accepted']]),finish()]);});
  for(const stream of [false,true]){const response=await f.call({model:'pg-test',stream,messages:[message()]});assert.equal(response.status,200);assert((await response.text()).includes('image accepted'));}assert.equal(sent,2);
});
test('headless relay sends the same image bytes and synthetic history to the runtime',async t=>{
  let calls=0;const runtime=http.createServer(async(req,res)=>{const chunks=[];for await(const c of req)chunks.push(c);const body=JSON.parse(Buffer.concat(chunks));assert.deepEqual(body.contents.flatMap(t=>t.parts).find(p=>p.inlineData).inlineData,image);calls++;res.writeHead(200,{'Content-Type':'text/event-stream'});res.end('data: '+JSON.stringify({candidates:[{content:{parts:[{text:'image headless'}]},finishReason:'STOP'}]})+'\n\n');});runtime.listen(0,'127.0.0.1');await once(runtime,'listening');
  // Explicit test connection uses the existing inspector contract.
  const original=runtime.listeners('request')[0];runtime.removeAllListeners('request');runtime.on('request',(req,res)=>{if(req.url==='/api/auth/login'){res.setHeader('Set-Cookie','aistudio_admin=test; HttpOnly');res.end('{}');}else if(req.url==='/api/status')res.end(JSON.stringify({state:'RUNNING',ready:true,active_requests:0}));else if(req.url==='/api/accounts')res.end(JSON.stringify({accounts:[{id:'a',enabled:true,state:'ready'}]}));else original(req,res);});
  const app=createRelay({apiKey:'test',models:['test'],timeoutMs:3000,inputRead:true,inputReadSynthetic:true,executionBackend:'headless',headless:{url:'http://127.0.0.1:'+runtime.address().port,apiKey:'a'.repeat(32),adminPassword:'b'.repeat(64)}});app.server.listen(0,'127.0.0.1');await once(app.server,'listening');t.after(()=>{app.close();app.server.closeAllConnections();runtime.closeAllConnections();runtime.close();});
  const response=await fetch('http://127.0.0.1:'+app.server.address().port+'/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer test','Content-Type':'application/json'},body:JSON.stringify({model:'pg-test',messages:[message()]})});assert.equal(response.status,200);assert.equal((await response.json()).choices[0].message.content,'image headless');assert.equal(calls,1);
});
