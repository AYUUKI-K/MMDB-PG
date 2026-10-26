import {networkInterfaces} from 'node:os';
import {readFileSync, writeFileSync, existsSync, unlinkSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {once} from 'node:events';
import {MMDB_VERSION} from '../shared/version.js';
import {createRelay} from './server.mjs';
import {readConfig,saveExperimentalConfig} from './config.mjs';
import {createLANGateway, privateIPv4, inCIDR} from './lan-gateway.mjs';

import {appRoot as root} from './paths.mjs';
export function chooseLAN(interfaces) {
  const addresses=[...new Set(Object.values(interfaces).flat().filter(row=>row&&!row.internal&&row.family==='IPv4'&&privateIPv4(row.address)).map(row=>row.address))];
  if(addresses.length!==1)throw Error('无法唯一确定局域网地址，请按 lan-config.example.json 创建 lan-config.json。');
  const address=addresses[0];
  return {address,port:8766,allowedCIDR:address.split('.').slice(0,3).join('.')+'.0/24'};
}
export async function startServices(config,lan) {
  const relay=createRelay(config);
  let gateway;
  const close=()=>{gateway?.closeAllConnections();gateway?.close();relay.server.closeAllConnections();relay.close();};
  try {
    relay.server.listen(config.port,'127.0.0.1');await once(relay.server,'listening');
    if(lan){
      if(!privateIPv4(lan.address)||!inCIDR(lan.address,lan.allowedCIDR)||!Number.isInteger(lan.port)||lan.port<1||lan.port>65535||lan.port===config.port)throw Error('lan-config.json 的私网地址、网段或端口无效。');
      gateway=createLANGateway({...lan,upstreamPort:relay.server.address().port,apiKey:config.apiKey});
      gateway.listen(lan.port,lan.address);await once(gateway,'listening');
    }
    return {relay,gateway,close};
  } catch(error){close();throw error;}
}
export async function main(){
  const pidFile=new URL('runtime.pid',root);
  let services;
  try {
    const config=readConfig();
    let lan;
    if(process.argv.includes('--lan')){
      const file=new URL('lan-config.json',root);
      if(!existsSync(file))writeFileSync(file,JSON.stringify(chooseLAN(networkInterfaces()),null,2)+'\n');
      lan=JSON.parse(readFileSync(file,'utf8').replace(/^\uFEFF/,''));
    }
    services=await startServices({...config,persistExperiments:saveExperimentalConfig,diagnosticsPath:fileURLToPath(new URL('diagnostics.log',root))},lan);
    writeFileSync(pidFile,String(process.pid));
    console.log(`MMDB v${MMDB_VERSION} 本地反代\n安装脚本：http://127.0.0.1:${config.port}/local-pg.user.js\n本机酒馆：http://127.0.0.1:${config.port}/v1\n${process.argv.includes('--background')?'密钥保存在 config.json':`密钥：${config.apiKey}`}`);
    if(lan)console.log(`手机酒馆：http://${lan.address}:${lan.port}/v1`);
    console.log(process.argv.includes('--background')?'后台运行中，退出菜单不会停止；请用菜单 6 停止。AI Studio 页面仍需保持打开。':'保持此窗口和 AI Studio 页面运行；Ctrl+C 停止。');
    for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>services.close());
    process.once('exit',()=>{try{if(readFileSync(pidFile,'utf8')===String(process.pid))unlinkSync(pidFile);}catch{}});
  } catch(error){services?.close();console.error(`启动失败：${error.message}`);process.exitCode=1;}
}
