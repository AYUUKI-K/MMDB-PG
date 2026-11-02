import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
export function dataDirectoryFor(root){
  const project=join(root,'runtime-manager'),file=join(project,'manager.config.json');
  if(!existsSync(file))return join(root,'.headless');
  const config=JSON.parse(readFileSync(file,'utf8').replace(/^\uFEFF/,''));
  return resolve(project,config.dataDirectory??'.runtime');
}
export function bindManager(root,dataDirectory=join(root,'.headless')){
  const file=join(root,'runtime-manager','manager.config.json');
  if(existsSync(file))return;
  try{writeFileSync(file,JSON.stringify({dataDirectory:resolve(dataDirectory),integrationModule:join(resolve(root),'tools','manager-integration.mjs')},null,2)+'\n',{flag:'wx',mode:0o600});}
  catch(error){if(error.code!=='EEXIST')throw error;}
}
