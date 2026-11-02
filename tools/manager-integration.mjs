// Optional integration loaded only by this installation's manager.config.json.
// The standalone project can run without this file or any MMDB dependencies.
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {createManager} from './portable-manager.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
export function createIntegration(){
  const manager=createManager({root});
  return {
    backend:()=>JSON.parse(readFileSync(join(root,'config.json'),'utf8').replace(/^\uFEFF/,'')).executionBackend,
    async status(){const value=await manager.status();return {running:value.running,pending:value.pending??0,mode:value.mode??'local',executionBackend:value.executionBackend,ready:value.executorOnline===true,unavailable:!!value.statusError};},
    start:lan=>manager.ready(lan),stop:()=>manager.stop()
  };
}
