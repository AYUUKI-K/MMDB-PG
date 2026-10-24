import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {normalizeModel} from './protocol.mjs';
export const defaults = Object.freeze({port:8765,apiKey:'mmdb',timeoutMs:180000,toolFirstByteTimeoutMs:600000,streamKeepAliveMs:15000,maxContinuations:2,toolPromptStyle:'tail-user',models:['gemini-4-argon','gemini-3.8-flash','gemini-3.1-pro-preview','gemini-3.5-flash-lite','gemini-3.6-flash','gemini-3.1-flash-lite','gemini-3-flash-preview']});
export function readConfig(file = new URL('./config.json',import.meta.url), env = process.env) {
  if(!existsSync(file))writeFileSync(file,JSON.stringify(defaults,null,2)+'\n');
  const config={...defaults,...JSON.parse(readFileSync(file,'utf8').replace(/^\uFEFF/,''))};
  if(env.MMDB_PORT)config.port=Number(env.MMDB_PORT);
  if(env.MMDB_API_KEY)config.apiKey=env.MMDB_API_KEY;
  if(!Number.isInteger(config.port)||config.port<1||config.port>65535)throw Error('port 必须为 1–65535 的整数');
  if(typeof config.apiKey!=='string'||config.apiKey.trim()!==config.apiKey||config.apiKey.length<4)throw Error('apiKey 至少 4 个字符，且不能含首尾空格');
  if(!Number.isFinite(config.timeoutMs)||config.timeoutMs<100)throw Error('timeoutMs 配置无效');
  if(!Number.isInteger(config.toolFirstByteTimeoutMs)||config.toolFirstByteTimeoutMs<100||config.toolFirstByteTimeoutMs>3600000)throw Error('toolFirstByteTimeoutMs 必须为 100–3600000 毫秒');
  if(!Number.isInteger(config.streamKeepAliveMs)||config.streamKeepAliveMs<1000||config.streamKeepAliveMs>60000)throw Error('streamKeepAliveMs 必须为 1000–60000 毫秒');
  if(!Number.isInteger(config.maxContinuations)||config.maxContinuations<0||config.maxContinuations>5)throw Error('maxContinuations 必须为 0–5 的整数');
  if(!['legacy','compact','tail-user'].includes(config.toolPromptStyle))throw Error('toolPromptStyle 无效');
  // Retain old configuration values as aliases for the single current contract.
  config.toolPromptStyle='tail-user';
  if(!Array.isArray(config.models)||!config.models.length)throw Error('models 不能为空');
  config.models=[...new Set(config.models.map(normalizeModel))];
  return config;
}
