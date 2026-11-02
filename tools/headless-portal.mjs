export {isManagerURL} from '../runtime-manager/src/portal.mjs';
import {ensureManager as open} from '../runtime-manager/src/portal.mjs';
import {runtimeRoot} from '../src/server/headless-runtime.mjs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {bindManager} from './manager-paths.mjs';
export const ensureManager=(root=runtimeRoot())=>{if(resolve(root)===resolve(runtimeRoot()))bindManager(fileURLToPath(new URL('../',import.meta.url)),root);return open(root);};
