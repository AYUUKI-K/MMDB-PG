import {readFileSync, writeFileSync, existsSync, unlinkSync, renameSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {once} from 'node:events';
import {MMDB_VERSION} from '../shared/version.js';
import {createRelay} from './server.mjs';
import {readConfig,saveExperimentalConfig} from './config.mjs';
import {createLANGateway, privateIPv4, privateCIDR, inCIDR} from './lan-gateway.mjs';
import {ensureRuntime} from './headless-runtime.mjs';
import {chooseLAN,localLANInterfaces} from './lan-address.mjs';
import {appRoot as root} from './paths.mjs';
export {chooseLAN};

export function lanSettings(file,interfaces=localLANInterfaces){
  return {
    resolveLAN(selection){
      if(existsSync(file))return JSON.parse(readFileSync(file,'utf8').replace(/^\uFEFF/,''));
      return chooseLAN(interfaces(),selection);
    },
    saveLAN(candidate){
      if(existsSync(file))return;
      const temp=fileURLToPath(file)+'.tmp';
      writeFileSync(temp,JSON.stringify(candidate,null,2)+'\n');
      renameSync(temp,file);
    },
  };
}

export async function startServices(config,lan,{optionalLAN=false,resolveLAN=()=>lan,saveLAN=()=>{},onLANError=()=>{}}={}) {
  if(config.executionBackend==='headless'&&!config.headless)await ensureRuntime();
  let gateway,lanTask,closing=false,lanState={available:false};
  const ensureLAN=selection=>lanTask??=(async()=>{
    if(gateway?.listening)return {...lanState};
    let candidate;
    try {
      candidate=await resolveLAN(selection);
      if(closing)throw Error('后台正在停止');
      if(!candidate)return {...lanState};
      if(!privateIPv4(candidate.address)||!privateCIDR(candidate.allowedCIDR)||!inCIDR(candidate.address,candidate.allowedCIDR)||!Number.isInteger(candidate.port)||candidate.port<1||candidate.port>65535||candidate.port===relay.server.address().port)throw Error('lan-config.json 的私网地址、私有网段或端口无效。');
      const next=createLANGateway({...candidate,upstreamPort:relay.server.address().port,apiKey:config.apiKey});
      try{
        next.listen(candidate.port,candidate.address);
        await once(next,'listening');
        if(closing)throw Error('后台正在停止');
        saveLAN(candidate);
      }catch(error){next.close();throw error;}
      gateway=next;lanState={available:true,address:candidate.address,port:candidate.port};
    }catch(error){
      const waiting=error.code==='LAN_ADDRESS_REQUIRED';
      const wrongAddress=selection!==undefined&&error.code==='EADDRNOTAVAIL';
      let message=error.message;
      if(wrongAddress)message='这个地址不属于当前设备。请查看运行 MMDB 的设备在网络设置中显示的 IPv4。';
      else if(!waiting)message=`局域网入口启动失败：${error.message}`;
      lanState={available:false,needsAddress:waiting||wrongAddress,message};
      if(!waiting)onLANError(error);
      if(!optionalLAN)throw error;
    }
    return {...lanState};
  })().finally(()=>{lanTask=null;});
  const relay=createRelay({...config,ensureLAN,connectionStatus:()=>({...lanState})});
  const close=()=>{closing=true;gateway?.closeAllConnections();gateway?.close();relay.server.closeAllConnections();relay.close();};
  try {
    relay.server.listen(config.port,'127.0.0.1');await once(relay.server,'listening');
    await ensureLAN();
    return {relay,get gateway(){return gateway;},get connections(){return {...lanState};},ensureLAN,close};
  } catch(error){close();throw error;}
}
export async function main(){
  const pidFile=new URL('runtime.pid',root);
  let services;
  try {
    const config=readConfig();
    services=await startServices({...config,persistExperiments:saveExperimentalConfig,diagnosticsPath:fileURLToPath(new URL('diagnostics.log',root))},undefined,{optionalLAN:true,...lanSettings(new URL('lan-config.json',root)),onLANError:error=>console.warn(`手机入口暂不可用，本机继续运行：${error.message}`)});
    writeFileSync(pidFile,String(process.pid));
    console.log(`MEOW-FM v${MMDB_VERSION} · 喵喵电波\n${config.executionBackend==='headless'?'账号管理：主菜单 3':`安装脚本：http://127.0.0.1:${config.port}/local-pg.user.js`}\n本机酒馆：http://127.0.0.1:${config.port}/v1\n${process.argv.includes('--background')?'密钥保存在 config.json；默认 mmdb，自定义值保持不变':`密钥：${config.apiKey}`}`);
    const lan=services.connections;
    if(lan.available)console.log(`手机酒馆：http://${lan.address}:${lan.port}/v1`);
    else if(lan.needsAddress)console.log(lan.message);
    console.log(config.executionBackend==='headless'?'独立运行时模式，无需保持 AI Studio 页面；更多 → 停止后台，独立运行时与凭证保留。':process.argv.includes('--background')?'后台运行中，退出菜单不会停止；更多 → 停止后台。AI Studio 页面仍需保持打开。':'保持此窗口和 AI Studio 页面运行；Ctrl+C 停止。');
    for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>services.close());
    process.once('exit',()=>{try{if(readFileSync(pidFile,'utf8')===String(process.pid))unlinkSync(pidFile);}catch{}});
  } catch(error){services?.close();console.error(`启动失败：${error.message}`);process.exitCode=1;}
}
