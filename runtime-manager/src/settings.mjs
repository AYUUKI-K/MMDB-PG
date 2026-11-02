import {existsSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join,resolve} from 'node:path';
export const projectRoot=fileURLToPath(new URL('../',import.meta.url));
export function managerSettings(root=projectRoot){
  const file=join(root,'manager.config.json');
  const config=existsSync(file)?JSON.parse(readFileSync(file,'utf8').replace(/^\uFEFF/,'')):{};
  if(config.dataDirectory!==undefined&&typeof config.dataDirectory!=='string')throw Error('dataDirectory 配置无效');
  if(config.integrationModule!==undefined&&typeof config.integrationModule!=='string')throw Error('integrationModule 配置无效');
  return {dataDirectory:resolve(root,config.dataDirectory??'.runtime'),integrationModule:config.integrationModule?resolve(root,config.integrationModule):null};
}
