import {networkInterfaces} from 'node:os';
import {isIPv4} from 'node:net';
import {privateIPv4,privateCIDR} from './lan-gateway.mjs';

// Android can deny interface enumeration even when binding to a known IP works.
export function localLANInterfaces() {
  try { return networkInterfaces(); } catch { return {}; }
}

export function lanCandidates(interfaces) {
  const candidates=new Map();
  for(const [name,rows] of Object.entries(interfaces)){
    for(const row of rows??[]){
      if(row && !row.internal && row.family==='IPv4' && privateIPv4(row.address) && !candidates.has(row.address)){
        candidates.set(row.address,{name,address:row.address,cidr:row.cidr});
      }
    }
  }
  return [...candidates.values()];
}

export function chooseLAN(interfaces,selection) {
  const candidates=lanCandidates(interfaces);
  if(selection===undefined && candidates.length!==1){
    throw Object.assign(Error('如需其他设备连接，请在菜单 1 设置本设备的局域网地址。'),{code:'LAN_ADDRESS_REQUIRED'});
  }
  const [address,prefix,...extra]=String(selection??candidates[0].address).split('/');
  if(!isIPv4(address)||!privateIPv4(address))throw Error('请输入本设备的私网 IPv4，例如 192.168.1.38。');
  // Keep the existing /24 default for unattended discovery.
  const detected=selection===undefined?undefined:candidates.find(row=>row.address===address)?.cidr;
  const bits=prefix??(privateCIDR(detected)?detected.split('/')[1]:'24');
  if(extra.length||!privateCIDR(address+'/'+bits))throw Error('网络前缀无效，允许的网段必须完全属于私网。');
  const ip=address.split('.').reduce((n,part)=>n*256+Number(part),0);
  const network=ip & (0xffffffff << (32-Number(bits)));
  const subnet=[24,16,8,0].map(shift=>(network>>>shift)&255).join('.');
  return {address,port:8766,allowedCIDR:subnet+'/'+bits};
}
