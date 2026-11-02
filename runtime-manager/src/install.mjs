import {createHash,randomUUID} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,renameSync,existsSync,lstatSync,chmodSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join,basename} from 'node:path';
import {initializeRuntime,runtimeRoot,runtimeExecutable} from './headless-runtime.mjs';

export const RUNTIME_VERSION='v0.2.18';
// Official release asset digests checked on 2026-11-01. No mutable latest URLs.
const releases={
  'win32-x64':['windows-amd64.zip','c5d015b0779b612ed071743b117484897863408bfd79ac3e3e8b0b9bae088eb2'],
  'linux-x64':['linux-amd64.tar.gz','93eef846c82571abffa7ab4b6d23b074b47e7749bb008481600d6c9f65b5d2a4'],
  'linux-arm64':['linux-arm64.tar.gz','95e29de7682548aa13183ab55174a43dd019fba7ac9244a8dd1ad80ffafa5090'],
  'darwin-x64':['darwin-amd64.tar.gz','d2c244cfc914cfd42cb82b7e6a007553247fd5e252e581ba9b24723d23629f4a'],
  'darwin-arm64':['darwin-arm64.tar.gz','69b6971f98d14a966900f3166af4fbdae8abfb18a9a2116073c8a7346f8a62f5']
};
export function runtimeRelease(platform=process.platform,arch=process.arch){
  const asset=releases[`${platform}-${arch}`];if(!asset)throw Error('当前平台没有已核对的独立运行时发行包；Android/Termux 暂不支持此模式');
  const [suffix,sha256]=asset,name=`aistudio2api-${RUNTIME_VERSION}-${suffix}`;
  return {name,sha256,url:`https://github.com/Mag1cFall/AIStudio2API/releases/download/${RUNTIME_VERSION}/${name}`};
}
export function verifyRuntimeArchive(bytes,sha256){if(createHash('sha256').update(bytes).digest('hex')!==sha256)throw Error('独立运行时下载校验失败，未安装');}
export async function installRuntime(root=runtimeRoot(),{fetchImpl=fetch}={}){
  const release=runtimeRelease();initializeRuntime(root);
  if(existsSync(runtimeExecutable(root)))return {installed:false,version:RUNTIME_VERSION};
  const response=await fetchImpl(release.url,{signal:AbortSignal.timeout(180000)});
  if(!response.ok)throw Error(`独立运行时下载失败（HTTP ${response.status}）`);
  const chunks=[];let size=0;
  for await(const chunk of response.body){size+=chunk.length;if(size>128*1024*1024)throw Error('独立运行时下载超过大小限制');chunks.push(chunk);}
  const bytes=Buffer.concat(chunks);verifyRuntimeArchive(bytes,release.sha256);
  const staging=join(root,'install-'+randomUUID());mkdirSync(staging,{mode:0o700});
  const archive=join(staging,release.name);writeFileSync(archive,bytes,{mode:0o600});
  const names=execFileSync('tar',['-tf',archive],{encoding:'utf8',windowsHide:true}).trim().split(/\r?\n/);
  if(names.some(name=>name.startsWith('/')||name.includes('\\')||name.includes(':')||name.split('/').includes('..')))throw Error('运行时压缩包路径无效');
  const binary=basename(runtimeExecutable(root)),candidates=names.filter(name=>basename(name)===binary);
  if(candidates.length!==1)throw Error('运行时压缩包中没有唯一执行文件');
  execFileSync('tar',['-xf',archive,'-C',staging,candidates[0]],{windowsHide:true});
  const source=join(staging,candidates[0]);if(!lstatSync(source).isFile()||lstatSync(source).isSymbolicLink())throw Error('运行时执行文件无效');
  renameSync(source,runtimeExecutable(root));
  if(process.platform!=='win32')chmodSync(runtimeExecutable(root),0o700);
  writeFileSync(join(root,'installation.json'),JSON.stringify({version:RUNTIME_VERSION,archiveSHA256:release.sha256,executableSHA256:createHash('sha256').update(readFileSync(runtimeExecutable(root))).digest('hex')},null,2)+'\n',{mode:0o600});
  return {installed:true,version:RUNTIME_VERSION};
}
