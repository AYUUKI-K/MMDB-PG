// 1.18.x updaters only copy their original top-level directory allowlist.
// Carry new public components under tools/, then restore them after replacement.
// Never copy credentials, fetch extra code, or expand new directories during an
// old updater's staging build (that updater would reject those directories).
import {existsSync,readFileSync,writeFileSync,mkdirSync,renameSync,lstatSync} from 'node:fs';
import {resolve,join,dirname,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
export const COMPONENT_BUNDLE='tools/legacy-components.json';
export const componentFiles=new Set(['package.json','README.md','LICENSE','cli.mjs','Manager.cmd','start.sh','manager.config.example.json']);
const extensionFiles=new Set(['README.md','capture.mjs','connect.css','connect.html','connect.mjs','manifest.json','protocol.mjs','worker.mjs']);
export function publicComponent(path){
  const parts=path.split('/');
  if(parts.some(p=>!p||p==='.'||p==='..'||/[\\:\x00-\x1f<>"|?*]/.test(p)||/[ .]$/.test(p)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)))return false;
  if(parts[0]==='browser-extension')return parts.length===2&&extensionFiles.has(parts[1]);
  if(parts[0]!=='runtime-manager')return false;
  if(parts.length===2)return componentFiles.has(parts[1]);
  if(parts[1]==='browser-extension')return parts.length===3&&extensionFiles.has(parts[2]);
  if(parts[1]==='licenses')return parts.length===3&&parts[2]==='AIStudio2API-LICENSE';
  return ['src','tests'].includes(parts[1])&&!parts.slice(2).some(p=>p.startsWith('.'))&&/\.(mjs|js)$/.test(parts.at(-1));
}
export function readComponentBundle(root){
  const raw=readFileSync(join(root,COMPONENT_BUNDLE));if(raw.length>10*1024*1024)throw Error('兼容组件包过大');
  const data=JSON.parse(raw),version=JSON.parse(readFileSync(join(root,'package.json'),'utf8')).version;
  if(data.format!==1||data.version!==version||!Array.isArray(data.files)||!data.files.length||data.files.length>1000)throw Error('兼容组件包版本或格式无效');
  const seen=new Set();let size=0;
  const files=data.files.map(row=>{
    if(typeof row.path!=='string'||!publicComponent(row.path)||seen.has(row.path.toLowerCase())||typeof row.text!=='string')throw Error('兼容组件包包含非公开或重复文件');
    seen.add(row.path.toLowerCase());size+=Buffer.byteLength(row.text);
    if(size>8*1024*1024||createHash('sha256').update(row.text).digest('hex')!==row.sha256)throw Error('兼容组件包校验失败');
    return row;
  });
  if(!seen.has('runtime-manager/package.json')||!seen.has('runtime-manager/src/portal.mjs')||!seen.has('browser-extension/manifest.json'))throw Error('兼容组件包不完整');
  return files;
}
export function restoreLegacyComponents(root=fileURLToPath(new URL('../',import.meta.url))){
  root=resolve(root);
  const anchors={'runtime-manager':'package.json','browser-extension':'manifest.json'};
  const missing=Object.keys(anchors).filter(name=>!existsSync(join(root,name,anchors[name])));
  if(!missing.length)return false;
  if(!existsSync(join(root,COMPONENT_BUNDLE)))throw Error('缺少独立管理组件，请使用完整 MMDB 更新包');
  const files=readComponentBundle(root).filter(f=>missing.includes(f.path.split('/')[0]));
  // Anchors are written last; an interrupted expansion can safely be retried.
  files.sort((a,b)=>Number(a.path===a.path.split('/')[0]+'/'+anchors[a.path.split('/')[0]])-Number(b.path===b.path.split('/')[0]+'/'+anchors[b.path.split('/')[0]]));
  for(const file of files){
    const target=resolve(root,file.path),offset=relative(root,target);
    if(offset.startsWith('..'+sep)||offset==='..')throw Error('兼容组件路径越界');
    for(let path=target;path!==root;path=dirname(path))if(existsSync(path)&&lstatSync(path).isSymbolicLink())throw Error('兼容组件路径不能是链接');
    mkdirSync(dirname(target),{recursive:true});const temporary=target+'.'+randomUUID()+'.tmp';
    writeFileSync(temporary,file.text,{flag:'wx',mode:target.endsWith('.sh')?0o755:0o644});renameSync(temporary,target);
  }
  return true;
}
