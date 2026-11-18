import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {existsSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chooseLAN,lanCandidates,localLANInterfaces} from '../src/server/lan-address.mjs';
import {lanSettings,startServices} from '../src/server/launch.mjs';
import {guideLAN} from '../tools/lan-menu.mjs';
import {createManager} from '../tools/portable-manager.mjs';
import {MMDB_VERSION} from '../src/shared/version.js';

const wifi={family:'IPv4',address:'192.168.3.38',cidr:'192.168.3.38/23',internal:false};
const interfaces={vpn:[{...wifi,address:'10.0.0.2',cidr:'10.0.0.2/28'}],wifi:[wifi,wifi]};
test('menu lists distinct private interfaces and accepts a number after invalid input',async()=>{
  const output=[],submitted=[];
  await guideLAN(async address=>{
    submitted.push(address);
    return {available:true,address,port:8766};
  },{interfaces,print:line=>output.push(line),input:Readable.from(['9\n127.0.0.1\n8.8.8.8\n2\n'])});
  assert.deepEqual(submitted,[wifi.address]);
  assert.equal(output.filter(line=>line.includes('（wifi）')).length,1);
  assert.match(output.at(-1),/192\.168\.3\.38:8766\/v1/);
  assert.equal(chooseLAN(interfaces,wifi.address).allowedCIDR,'192.168.2.0/23');
  assert.equal(chooseLAN({},wifi.address).allowedCIDR,'192.168.3.0/24');
  assert.equal(chooseLAN({},wifi.cidr).allowedCIDR,'192.168.2.0/23');
  for(const selection of ['192.168.3.38/0','192.168.3.38/','192.168.3.38/24/1','::ffff:192.168.3.38'])
    assert.throws(()=>chooseLAN({},selection));
});

test('menu retries an unassigned address and supports skip or EOF without enabling LAN',async()=>{
  const attempted=[];
  await guideLAN(async address=>{
    attempted.push(address);
    return {available:false,needsAddress:true,message:'地址未绑定'};
  },{interfaces:{},print:()=>{},input:Readable.from(['192.168.1.99\n192.168.2.38/23\n0\n'])});
  assert.deepEqual(attempted,['192.168.1.99','192.168.2.38/23']);
  for(const lines of [[],['\n'],['0\n']]){
    await guideLAN(()=>assert.fail('skip contacted backend'),{interfaces,print:()=>{},input:Readable.from(lines)});
  }
});

test('manual address starts the gateway on the live core and saves only after binding',async t=>{
  const device=lanCandidates(localLANInterfaces())[0];
  if(!device)return t.skip('No private LAN interface on this host');
  const dir=mkdtempSync(join(tmpdir(),'mmdb-lan-menu-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const file=pathToFileURL(join(dir,'lan-config.json'));
  const settings=lanSettings(file,()=>({}));
  const warnings=[];
  const occupied=createServer();
  occupied.listen(0,device.address);await once(occupied,'listening');
  t.after(()=>{if(occupied.listening)occupied.close();});
  const port=occupied.address().port;
  const service=await startServices({port:0,apiKey:'test-key',models:['test']},null,{
    optionalLAN:true,...settings,onLANError:error=>warnings.push(error),resolveLAN:selection=>({...settings.resolveLAN(selection),port}),
  });
  t.after(()=>service.close());
  const corePort=service.relay.server.address().port;
  const base='http://127.0.0.1:'+corePort;
  const headers={Authorization:'Bearer test-key'};
  const enable=address=>fetch(base+'/v1/lan/enable?'+new URLSearchParams({address}),{method:'POST',headers}).then(response=>response.json());
  assert.equal(service.connections.needsAddress,true);
  assert.doesNotMatch(service.connections.message,/失败|错误|未启动/);
  assert.equal(warnings.length,0);
  assert.equal((await enable('0.0.0.0')).available,false);
  assert.equal((await enable(device.address)).available,false);
  assert.equal(warnings.at(-1)?.code,'EADDRINUSE');
  assert.equal(existsSync(file),false);
  assert.equal((await fetch(base+'/v1/models',{headers})).status,200);
  await new Promise(resolve=>occupied.close(resolve));
  writeFileSync(join(dir,'package.json'),JSON.stringify({name:'mmdb-pg',version:MMDB_VERSION}));
  writeFileSync(join(dir,'runtime.pid'),String(process.pid));
  const manager=createManager({root:dir,env:{MMDB_PORT:String(corePort),MMDB_API_KEY:'test-key'},
    inspect:()=>({executable:process.execPath,args:[process.execPath,join(dir,'launch.mjs')]})});
  const output=[];
  await manager.menuReady(false,{interfaces:{},print:line=>output.push(line),input:Readable.from([device.address+'\n'])});
  assert(output.at(-1).includes(`http://${device.address}:${port}/v1`));
  const saved=JSON.parse(readFileSync(file,'utf8'));
  assert.deepEqual(saved,{...chooseLAN({},device.address),port});
  assert.deepEqual(settings.resolveLAN('192.168.99.99'),saved);
  assert.equal((await fetch(`http://${device.address}:${port}/v1/models`,{headers})).status,200);
  await manager.menuReady(false,{print:()=>assert.fail('configured gateway prompted again')});
});
