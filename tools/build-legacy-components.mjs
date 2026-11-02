import {existsSync,readdirSync,readFileSync,writeFileSync,lstatSync} from 'node:fs';
import {join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {COMPONENT_BUNDLE,publicComponent,readComponentBundle} from './legacy-components.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
if(existsSync(join(root,'runtime-manager/package.json'))&&existsSync(join(root,'browser-extension/manifest.json'))){
  const files=[];
  function visit(dir){for(const entry of readdirSync(dir,{withFileTypes:true})){
    const path=join(dir,entry.name),name=relative(root,path).replaceAll('\\','/');
    // Only descend into public trees. In particular, never read .runtime or a
    // manager.config.json even when building from a running local installation.
    if(entry.isDirectory()){if(name==='runtime-manager'||/^runtime-manager\/(src|browser-extension|licenses|tests)(\/|$)/.test(name)||name==='browser-extension')visit(path);}
    else if(publicComponent(name)){
      if(!lstatSync(path).isFile()||entry.isSymbolicLink())throw Error('公开组件不能是链接');
      const text=readFileSync(path,'utf8').replaceAll('\r\n','\n');files.push({path:name,text,sha256:createHash('sha256').update(text).digest('hex')});
    }
  }}
  visit(join(root,'runtime-manager'));visit(join(root,'browser-extension'));files.sort((a,b)=>a.path.localeCompare(b.path,'en'));
  writeFileSync(join(root,COMPONENT_BUNDLE),JSON.stringify({format:1,version:JSON.parse(readFileSync(join(root,'package.json'),'utf8')).version,files})+'\n');
}else readComponentBundle(root); // Validate, but leave an old updater's staging tree intact.
