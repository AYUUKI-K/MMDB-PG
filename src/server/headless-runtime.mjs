// Compatibility export: implementation belongs to the independent manager project.
export * from '../../runtime-manager/src/headless-runtime.mjs';
import {readFileSync,writeFileSync,renameSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {appRoot} from './paths.mjs';
import * as runtime from '../../runtime-manager/src/headless-runtime.mjs';
export const runtimeRoot=()=>existsSync(new URL('../../runtime-manager/manager.config.json',import.meta.url))?runtime.runtimeRoot():fileURLToPath(new URL('.headless/',appRoot));
export const readRuntimeSettings=(root=runtimeRoot())=>runtime.readRuntimeSettings(root);
export const ensureRuntime=(root=runtimeRoot())=>runtime.ensureRuntime(root);
export const initializeRuntime=(root=runtimeRoot(),options)=>runtime.initializeRuntime(root,options);
export function setExecutionBackend(backend,file=new URL('config.json',appRoot)){
  if(!['browser','headless'].includes(backend))throw Error('执行后端无效');
  const path=file instanceof URL?fileURLToPath(file):file;
  const value=JSON.parse(readFileSync(path,'utf8').replace(/^\uFEFF/,''));
  value.executionBackend=backend;
  writeFileSync(path+'.tmp',JSON.stringify(value,null,2)+'\n',{mode:0o600});renameSync(path+'.tmp',path);
}
