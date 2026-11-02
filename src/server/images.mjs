import http from 'node:http';
import https from 'node:https';
import {lookup} from 'node:dns/promises';
import {isIP,BlockList} from 'node:net';
import {ApiError} from './errors.mjs';

export const MAX_BODY_BYTES=20*1024*1024;
export const IMAGE_LIMITS={count:8,perImage:8*1024*1024,total:12*1024*1024};
const error=(message,code='invalid_image',status=400)=>new ApiError(status,message,code);
const TYPES=new Set(['image/png','image/jpeg','image/webp']);
function detect(bytes){if(bytes.length>=8&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';if(bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';if(bytes.length>=12&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP')return 'image/webp';}
export function inlineImage(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['mimeType','mime_type','data'].includes(k)))throw error('inlineData 必须包含 mimeType 和 Base64 data');
  const mimeType=value.mimeType??value.mime_type;
  if(!TYPES.has(mimeType))throw error('图片仅支持 PNG、JPEG、WebP','unsupported_image_type');
  if(value.mimeType&&value.mime_type&&value.mimeType!==value.mime_type)throw error('图片 MIME 字段冲突');
  if(typeof value.data!=='string'||value.data.length>Math.ceil(IMAGE_LIMITS.perImage/3)*4+4096)throw error('单张图片超过 8 MiB','image_too_large',413);
  const data=value.data.replace(/[\r\n]/g,'');if(!/^[A-Za-z0-9+/]+={0,2}$/.test(data)||data.length%4===1)throw error('图片 Base64 格式无效');
  const bytes=Buffer.from(data,'base64');if(!bytes.length||bytes.toString('base64').replace(/=+$/,'')!==data.replace(/=+$/,''))throw error('图片 Base64 格式无效');
  if(bytes.length>IMAGE_LIMITS.perImage)throw error('单张图片超过 8 MiB','image_too_large',413);
  if(detect(bytes)!==mimeType)throw error('图片内容与声明的 MIME 不匹配');
  return {mimeType,data:bytes.toString('base64')};
}
export function imageURLPart(part){
  if(!part||Object.keys(part).some(k=>!['type','image_url'].includes(k)))throw error('image_url 内容块格式无效');
  const image=typeof part.image_url==='string'?{url:part.image_url}:part.image_url;
  if(!image||Object.keys(image).some(k=>!['url','detail'].includes(k))||typeof image.url!=='string')throw error('image_url.url 必须为图片地址或 data URL');
  if(image.detail!==undefined&&!['auto','low','high'].includes(image.detail))throw error('image_url.detail 格式无效');
  const match=/^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/.exec(image.url);
  if(!match)throw error('图片链接尚未解析为内联图片','image_not_resolved');
  // PG has no verified OpenAI detail mapping. Image bytes are never rescaled.
  return {inlineData:inlineImage({mimeType:match[1],data:match[2]})};
}
export function openAIContentParts(value){
  if(typeof value==='string')return [{text:value}];
  if(!Array.isArray(value)||!value.length)throw error('消息内容必须为文本或非空的内容块数组','invalid_content');
  // Preserve the legacy newline semantics for text-only arrays.
  if(value.every(p=>p?.type==='text'&&typeof p.text==='string'))return [{text:value.map(p=>p.text).join('\n')}];
  return value.map(p=>{if(p?.type==='text'&&typeof p.text==='string'&&Object.keys(p).every(k=>['type','text'].includes(k)))return {text:p.text};if(p?.type==='image_url')return imageURLPart(p);throw error('仅支持 text 和 image_url 内容块','unsupported_content');});
}

// No private-network fetches, DNS rebinding, proxy credentials, cookies, referer
// or forwarded API keys. Every redirect is independently resolved and pinned.
const blocked=new BlockList(),blocked6=new BlockList();
for(const cidr of ['0.0.0.0/8','10.0.0.0/8','100.64.0.0/10','127.0.0.0/8','169.254.0.0/16','172.16.0.0/12','192.0.0.0/24','192.0.2.0/24','192.168.0.0/16','198.18.0.0/15','198.51.100.0/24','203.0.113.0/24','224.0.0.0/4','240.0.0.0/4']){const [a,n]=cidr.split('/');blocked.addSubnet(a,Number(n),'ipv4');}
for(const cidr of ['::/96','::ffff:0:0/96','64:ff9b::/96','64:ff9b:1::/48','100::/64','2001::/23','2001:db8::/32','2002::/16','fc00::/7','fe80::/10','fec0::/10','ff00::/8']){const [a,n]=cidr.split('/');blocked6.addSubnet(a,Number(n),'ipv6');}
export function publicImageAddress(address){const family=isIP(address);return family===4?!blocked.check(address,'ipv4'):family===6&&/^[23]/i.test(address)&&!blocked6.check(address,'ipv6');}
export async function imageDestination(value,{resolve=lookup}={}){
  let url;try{url=new URL(value);}catch{throw error('图片 URL 格式无效');}
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.hash||url.port&&!['80','443'].includes(url.port))throw error('图片链接仅允许无认证的公网 HTTP(S) 标准端口','image_url_forbidden');
  const hostname=url.hostname.replace(/^\[|\]$/g,''),addresses=isIP(hostname)?[{address:hostname,family:isIP(hostname)}]:await resolve(hostname,{all:true,verbatim:true});
  if(!addresses.length||addresses.some(a=>!publicImageAddress(a.address)))throw error('图片链接不能指向本机、内网或保留地址；请改传 Base64','image_url_forbidden');
  return {url,address:addresses[0]};
}
export async function downloadImage(value,{signal,resolve=lookup,request}={}){
  try{for(let redirect=0;redirect<=3;redirect++){
    signal?.throwIfAborted();let onAbort;
    const aborted=new Promise((_,reject)=>{if(signal){onAbort=()=>reject(signal.reason);signal.addEventListener('abort',onAbort,{once:true});}});
    const {url,address}=await Promise.race([imageDestination(value,{resolve}),aborted]).finally(()=>{if(onAbort)signal.removeEventListener('abort',onAbort);});signal?.throwIfAborted();
    const response=await new Promise((accept,reject)=>{
      const req=(request??(url.protocol==='https:'?https.request:http.request))(url,{method:'GET',agent:false,signal,headers:{Accept:'image/png,image/jpeg,image/webp','User-Agent':'MMDB-Image/1','Accept-Encoding':'identity'},lookup:(_host,options,callback)=>callback(null,options.all?[address]:address.address,address.family)},accept);req.on('error',reject);req.setTimeout(15000,()=>req.destroy(error('下载图片超时','image_download_timeout',504)));req.end();
    });
    if([301,302,303,307,308].includes(response.statusCode)){const location=response.headers.location;response.destroy();if(!location||redirect===3)throw error('图片重定向过多或缺少目标','image_download_failed',400);value=new URL(location,url).href;continue;}
    if(response.statusCode!==200){response.destroy();throw error('图片地址未返回可用图片','image_download_failed',400);}
    if(response.headers['content-encoding']&&response.headers['content-encoding']!=='identity'){response.destroy();throw error('图片响应压缩编码不受支持');}
    if(Number(response.headers['content-length'])>IMAGE_LIMITS.perImage){response.destroy();throw error('单张图片超过 8 MiB','image_too_large',413);}
    const chunks=[];let size=0;for await(const chunk of response){size+=chunk.length;if(size>IMAGE_LIMITS.perImage){response.destroy();throw error('单张图片超过 8 MiB','image_too_large',413);}chunks.push(chunk);}
    const bytes=Buffer.concat(chunks),mimeType=detect(bytes);return inlineImage({mimeType,data:bytes.toString('base64')});
  }}catch(e){if(e instanceof ApiError)throw e;if(signal?.aborted)throw error('图片准备超时或请求已取消','image_prepare_cancelled',408);throw error('无法下载图片，请检查公网链接或改用 Base64','image_download_failed',400);}
}
export async function prepareImages(body,{openai=false,signal,download=downloadImage}={}){
  const bounded=signal?AbortSignal.any([signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000),memo=new Map();let count=0,bytes=0;
  function charge(image){count++;bytes+=Buffer.from(image.data,'base64').length;if(count>IMAGE_LIMITS.count||bytes>IMAGE_LIMITS.total)throw error('每次最多 8 张图片，合计不超过 12 MiB','images_too_large',413);return image;}
  if(openai){for(const turn of Array.isArray(body.messages)?body.messages:[]){if(!Array.isArray(turn?.content))continue;for(const part of turn.content){if(part?.type!=='image_url')continue;if(!['user','assistant'].includes(turn.role))throw error('图片应放在 user 或 assistant 消息中');const source=typeof part.image_url==='string'?part.image_url:part.image_url?.url;if(typeof source!=='string')throw error('image_url.url 无效');let image;
      if(source.startsWith('data:'))image=imageURLPart(part).inlineData;else{if(source.length>8192)throw error('图片链接过长');if(!memo.has(source))memo.set(source,await download(source,{signal:bounded}));image=memo.get(source);}
      charge(image);const detail=typeof part.image_url==='object'?part.image_url.detail:undefined;part.image_url={url:'data:'+image.mimeType+';base64,'+image.data,...(detail?{detail}:{})};
    }}
  }else{for(const turn of Array.isArray(body.contents)?body.contents:[]){for(const part of Array.isArray(turn?.parts)?turn.parts:[]){if(part?.inlineData!==undefined||part?.inline_data!==undefined){if(part.inlineData&&part.inline_data)throw error('inlineData 字段重复');const image=charge(inlineImage(part.inlineData??part.inline_data));delete part.inline_data;part.inlineData=image;}}}}
  return {count,bytes};
}
export const wireBinding=contents=>contents.flatMap(turn=>turn[0].map(part=>part[1]??part[2]?.[1]??'')).join(' ');
