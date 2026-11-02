export * from '../runtime-manager/src/install.mjs';
import {installRuntime as install} from '../runtime-manager/src/install.mjs';
import {runtimeRoot} from '../src/server/headless-runtime.mjs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {bindManager} from './manager-paths.mjs';
export const installRuntime=(root=runtimeRoot(),options)=>{if(resolve(root)===resolve(runtimeRoot()))bindManager(fileURLToPath(new URL('../',import.meta.url)),root);return install(root,options);};
