import {createInterface} from 'node:readline';
import {chooseLAN,lanCandidates,localLANInterfaces} from '../src/server/lan-address.mjs';

export async function guideLAN(enable,{input=process.stdin,print=console.log,interfaces=localLANInterfaces()}={}) {
  print('本机入口已就绪。在另一台设备上使用酒馆时，才需要设置局域网地址。');
  const candidates=lanCandidates(interfaces);
  if(candidates.length)print('请选择运行 MMDB 的这台设备正在使用的 Wi-Fi 或有线网卡，也可以直接输入它的 IPv4。');
  else print('请在运行 MMDB 的设备上打开网络设置，输入当前 Wi-Fi 或有线网络的 IPv4。');
  for(const [index,row] of candidates.entries())print(`  ${index+1}  ${row.address}（${row.name}）`);
  print('只在本机使用可直接按回车或输入 0。');
  const lines=createInterface({input,terminal:false,crlfDelay:Infinity});
  try{
    print(candidates.length?'请输入网卡编号或本设备 IPv4：':'请输入本设备 IPv4（例如 192.168.1.38）：');
    for await(const line of lines){
      const value=line.trim();
      if(!value||value==='0')break;
      const selection=/^[1-9]\d*$/.test(value)?candidates[Number(value)-1]?.address:value;
      try{
        if(!selection)throw Error('没有这个编号。');
        chooseLAN(interfaces,selection);
      }catch(error){print(error.message+' 请重新输入，或输入 0 跳过：');continue;}
      const phone=await enable(selection);
      if(phone.available){
        print(`跨设备连接已就绪。\n手机酒馆地址：http://${phone.address}:${phone.port}/v1\n请把完整地址填入另一台设备酒馆的「自定义端点（基础 URL）」，密钥与本机相同。`);
        return;
      }
      print(phone.message??'手机入口暂不可用。');
      if(!phone.needsAddress)return;
      print('请核对本设备网络设置中的 IPv4，重新输入或输入 0 跳过：');
    }
    print('已选择本机使用。以后要连接其他设备，回菜单选 1 即可。');
  }finally{lines.close();}
}
