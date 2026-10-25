import {existsSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {normalizeModel} from './protocol.mjs';
import {appRoot} from './paths.mjs';
export const defaults = Object.freeze({port:8765,apiKey:'mmdb',timeoutMs:180000,toolFirstByteTimeoutMs:600000,queueTimeoutMs:120000,maxRequestMs:1800000,streamKeepAliveMs:15000,maxContinuations:2,accountCooldownMs:900000,nativeContinuation:false,inputRead:false,toolPromptStyle:'legacy',models:['gemini-4-argon','gemini-3.8-flash','gemini-3.1-pro-preview','gemini-3.5-flash-lite','gemini-3.6-flash','gemini-3.1-flash-lite','gemini-3-flash-preview']});
export function readConfig(file = new URL('config.json',appRoot), env = process.env) {
  if(!existsSync(file))writeFileSync(file,JSON.stringify(defaults,null,2)+'\n');
  const config={...defaults,...JSON.parse(readFileSync(file,'utf8').replace(/^\uFEFF/,''))};
  // 1.2.x persisted this name for the user-tail contract. Keep existing installs loadable.
  if(config.toolPromptStyle==='tail-user')config.toolPromptStyle='legacy';
  if(env.MMDB_PORT)config.port=Number(env.MMDB_PORT);
  if(env.MMDB_API_KEY)config.apiKey=env.MMDB_API_KEY;
  if(!Number.isInteger(config.port)||config.port<1||config.port>65535)throw Error('port 必须为 1–65535 的整数');
  if(typeof config.apiKey!=='string'||config.apiKey.trim()!==config.apiKey||config.apiKey.length<4)throw Error('apiKey 至少 4 个字符，且不能含首尾空格');
  if(!Number.isFinite(config.timeoutMs)||config.timeoutMs<100)throw Error('timeoutMs 配置无效');
  for(const key of ['queueTimeoutMs','maxRequestMs'])if(!Number.isInteger(config[key])||config[key]<100||config[key]>7200000)throw Error(`${key} 必须为 100–7200000 毫秒`);
  if(!Number.isInteger(config.accountCooldownMs)||config.accountCooldownMs<100||config.accountCooldownMs>86400000)throw Error('accountCooldownMs 必须为 100–86400000 毫秒');
  if(typeof config.nativeContinuation!=='boolean')throw Error('nativeContinuation 必须为布尔值');
  if(typeof config.inputRead!=='boolean')throw Error('inputRead 必须为布尔值');
  if(!Number.isInteger(config.toolFirstByteTimeoutMs)||config.toolFirstByteTimeoutMs<100||config.toolFirstByteTimeoutMs>3600000)throw Error('toolFirstByteTimeoutMs 必须为 100–3600000 毫秒');
  if(!Number.isInteger(config.streamKeepAliveMs)||config.streamKeepAliveMs<1000||config.streamKeepAliveMs>60000)throw Error('streamKeepAliveMs 必须为 1000–60000 毫秒');
  if(!Number.isInteger(config.maxContinuations)||config.maxContinuations<0||config.maxContinuations>5)throw Error('maxContinuations 必须为 0–5 的整数');
  if(!['legacy','compact'].includes(config.toolPromptStyle))throw Error('toolPromptStyle 必须为 legacy 或 compact');
  if(!Array.isArray(config.models)||!config.models.length)throw Error('models 不能为空');
  config.models=[...new Set(config.models.map(normalizeModel))];
  return config;
}
export function saveExperimentalConfig(settings,file=new URL('config.json',appRoot)) {
  const path=file instanceof URL?fileURLToPath(file):file;
  // Read again on every save so unrelated user edits and credentials survive.
  const current=JSON.parse(readFileSync(path,'utf8').replace(/^\uFEFF/,''));
  for(const key of ['nativeContinuation','inputRead'])if(Object.hasOwn(settings,key))current[key]=settings[key];
  writeFileSync(path+'.tmp',JSON.stringify(current,null,2)+'\n','utf8');
  renameSync(path+'.tmp',path);
}
