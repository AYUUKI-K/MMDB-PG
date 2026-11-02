// Compatibility entry for the MMDB menu. The independent project owns supervision.
import {fileURLToPath,pathToFileURL} from 'node:url';
import * as guard from '../runtime-manager/src/supervisor.mjs';
import {dataDirectoryFor} from './manager-paths.mjs';
const defaultRoot=fileURLToPath(new URL('../',import.meta.url));
const data=root=>dataDirectoryFor(root??defaultRoot);
export const supervisionSettings=root=>guard.supervisionSettings(data(root));
export const pauseSupervision=root=>guard.pauseSupervision(data(root));
export const resumeSupervision=(root,options)=>guard.resumeSupervision(data(root),options);
export const enableSupervision=(root,options)=>guard.enableSupervision(data(root),options);
export const disableSupervision=root=>guard.disableSupervision(data(root));
export const ensureSupervisor=root=>guard.ensureSupervisor(data(root));
export const setLoginStartup=(enabled,root)=>guard.setLoginStartup(enabled,data(root));
export const loginStartupEnabled=root=>guard.loginStartupEnabled(data(root));
export {superviseStep,loginScript,startupCommand} from '../runtime-manager/src/supervisor.mjs';
export const main=(action=process.argv[2],root)=>guard.main(action,data(root));
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error(error.message);process.exitCode=1;});
