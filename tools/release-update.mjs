import {existsSync,readFileSync,writeFileSync,mkdirSync,renameSync,rmSync,readdirSync,lstatSync,realpathSync} from 'node:fs';
import {join,resolve,relative,isAbsolute,dirname} from 'node:path';
import {inflateRawSync} from 'node:zlib';
import {createHash,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';

export const RELEASE_SOURCE='https://raw.githubusercontent.com/AYUUKI-K/MMDB-PG/main/downloads/mmdb-pg-latest.zip';
export const SOURCE_REPOSITORY='AYUUKI-K/MMDB-PG';
export const SOURCE_ARCHIVE_URL=`https://codeload.github.com/${SOURCE_REPOSITORY}/zip/refs/heads/main`;
export const SOURCE_RECEIPT='.source-revision.json';
const githubHeaders={'User-Agent':'MMDB-Updater','Cache-Control':'no-cache'};
const files=new Set('package.json package-lock.json README.md LICENSE .gitignore .gitattributes build.mjs launch.mjs server.mjs lan-gateway.mjs lan-config.example.json MMDB.cmd MMDB.ps1 mmdb.sh mmdb-manager.ps1 Start.cmd Start.ps1 Start-LAN.cmd Start-LAN.ps1 Stop.cmd Stop.ps1 Stop-LAN.cmd Stop-LAN.ps1 start.sh start-lan.sh'.split(' '));
const directories=new Set(['src','scripts','tools','tests','docs','licenses','dist']);
const required=['package.json','package-lock.json','build.mjs','launch.mjs','server.mjs','tools/portable-manager.mjs'];
const json=file=>JSON.parse(readFileSync(file,'utf8').replace(/^\uFEFF/,''));
export function crc32(data) {
  let value=0xffffffff;
  for(const byte of data){value^=byte;for(let bit=0;bit<8;bit++)value=(value>>>1)^((value&1)?0xedb88320:0);}
  return (value^0xffffffff)>>>0;
}
function child(base,path) {
  const offset=relative(resolve(base),resolve(path));
  if(!offset||offset==='..'||offset.startsWith('..'+(process.platform==='win32'?'\\':'/'))||isAbsolute(offset))throw Error('更新路径不在预期目录内。');
  return path;
}
function zipFooter(bytes) {
  if(bytes.length>50*1024*1024||bytes.length<22)throw Error('更新包大小无效。');
  let end=-1;
  for(let pos=bytes.length-22;pos>=Math.max(0,bytes.length-65557);pos--){
    if(bytes.readUInt32LE(pos)===0x06054b50&&pos+22+bytes.readUInt16LE(pos+20)===bytes.length){end=pos;break;}
  }
  if(end<0||bytes.readUInt16LE(end+4)||bytes.readUInt16LE(end+6)||bytes.readUInt16LE(end+8)!==bytes.readUInt16LE(end+10))throw Error('不支持的 ZIP 格式。');
  const count=bytes.readUInt16LE(end+10),size=bytes.readUInt32LE(end+12),start=bytes.readUInt32LE(end+16);
  if(!count||count>4000||start+size!==end)throw Error('ZIP 目录无效。');
  return {end,count,start,comment:bytes.subarray(end+22).toString('utf8')};
}
export function sourceRevision(bytes) {
  // GitHub uses git archive, which stores the commit ID in the ZIP comment.
  // Read it from this exact archive; never query a separate moving branch ref.
  const {comment}=zipFooter(bytes);
  if(!/^[0-9a-f]{40}$/.test(comment))throw Error('源码包缺少有效提交标识，原程序未更改。');
  return comment;
}
export function unpackRelease(bytes,destination,{revision=null,branch=false}={}) {
  if(revision!==null&&!/^[0-9a-f]{40}$/.test(revision))throw Error('源码提交标识无效。');
  if(branch&&(!revision||sourceRevision(bytes)!==revision))throw Error('源码包提交标识不一致。');
  const prefix=revision?(branch?'MMDB-PG-main/':`MMDB-PG-${revision}/`):'mmdb-pg/';
  const {end,count,start}=zipFooter(bytes);
  const names=new Set(),rows=[];let offset=start,total=0;
  for(let i=0;i<count;i++){
    if(offset+46>end||bytes.readUInt32LE(offset)!==0x02014b50)throw Error('ZIP 目录损坏。');
    const flags=bytes.readUInt16LE(offset+8),method=bytes.readUInt16LE(offset+10),crc=bytes.readUInt32LE(offset+16),compressed=bytes.readUInt32LE(offset+20),length=bytes.readUInt32LE(offset+24);
    const nameLength=bytes.readUInt16LE(offset+28),extra=bytes.readUInt16LE(offset+30),comment=bytes.readUInt16LE(offset+32),local=bytes.readUInt32LE(offset+42),mode=(bytes.readUInt32LE(offset+38)>>>16)&0xf000;
    if(offset+46+nameLength+extra+comment>end||flags&1||![0,8].includes(method)||![0,0x8000,0x4000].includes(mode))throw Error('不支持的 ZIP 条目。');
    const name=bytes.subarray(offset+46,offset+46+nameLength).toString('utf8');
    const path=name.slice(prefix.length),parts=path.replace(/\/$/,'').split('/'),top=parts[0],rootEntry=name===prefix;
    const selected=directories.has(top)||files.has(path);
    if(!name.startsWith(prefix)||(!rootEntry&&(/[\\:\x00-\x1f<>"|?*\uFFFD]/.test(path)||parts.some(part=>!part||part==='.'||part==='..'||/[ .]$/.test(part)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))))||(!revision&&!selected&&!rootEntry)||names.has(path.toLowerCase()))throw Error('安装包包含不安全、重复或非程序文件。');
    names.add(path.toLowerCase());total+=length;
    if(total>100*1024*1024||local+30>start||bytes.readUInt32LE(local)!==0x04034b50)throw Error('安装包大小或条目位置无效。');
    const localNameLength=bytes.readUInt16LE(local+26),dataStart=local+30+localNameLength+bytes.readUInt16LE(local+28);
    if(dataStart+compressed>start||bytes.readUInt16LE(local+8)!==method||bytes.subarray(local+30,local+30+localNameLength).toString('utf8')!==name)throw Error('ZIP 条目不一致。');
    if(selected&&!rootEntry)rows.push({path,method,crc,length,dataStart,compressed,directory:name.endsWith('/')});
    offset+=46+nameLength+extra+comment;
  }
  if(offset!==end||required.some(name=>!names.has(name)))throw Error('不是完整的 MMDB 更新包。');
  mkdirSync(destination,{recursive:true});
  for(const row of rows){
    const target=child(destination,join(destination,row.path));
    if(row.directory){if(row.length)throw Error('ZIP 目录内容无效。');mkdirSync(target,{recursive:true});continue;}
    const compressed=bytes.subarray(row.dataStart,row.dataStart+row.compressed);
    const data=row.method===0?compressed:inflateRawSync(compressed,{maxOutputLength:Math.max(1,row.length)});
    if(data.length!==row.length||crc32(data)!==row.crc)throw Error('更新包内容校验失败。');
    mkdirSync(dirname(target),{recursive:true});writeFileSync(target,data,{flag:'wx',mode:row.path.endsWith('.sh')?0o755:0o644});
  }
}
async function download(url,limit,fetchImpl) {
  const response=await fetchImpl(url,{headers:githubHeaders,signal:AbortSignal.timeout(120000)});
  if(!response.ok||!response.body||!response.url.startsWith('https://'))throw Error(`下载失败：HTTP ${response.status}。`);
  const chunks=[];let size=0;
  for await(const chunk of response.body){size+=chunk.length;if(size>limit)throw Error('下载文件超过大小限制。');chunks.push(chunk);}
  return Buffer.concat(chunks);
}
export async function resolveSource(fetchImpl=fetch) {
  const url=new URL(SOURCE_ARCHIVE_URL);url.searchParams.set('_mmdb',String(Date.now()));
  const bytes=await download(url.href,50*1024*1024,fetchImpl);
  return {revision:sourceRevision(bytes),bytes};
}
function readReceipt(root){
  try{return json(join(root,SOURCE_RECEIPT));}catch{return null;}
}
export async function readRelease(source,fetchImpl=fetch) {
  if(!/^https?:/i.test(source))return readFileSync(source);
  if(!source.startsWith('https://'))throw Error('更新地址必须使用 HTTPS。');
  const url=new URL(source),sumURL=new URL(source);sumURL.pathname+='.sha256';
  const stamp=String(Date.now());url.searchParams.set('_mmdb',stamp);sumURL.searchParams.set('_mmdb',stamp);
  const [bytes,sums]=await Promise.all([download(url.href,50*1024*1024,fetchImpl),download(sumURL.href,4096,fetchImpl)]);
  const expected=sums.toString('utf8').trim().match(/^([0-9a-f]{64})\s+/i)?.[1];
  if(!expected||createHash('sha256').update(bytes).digest('hex')!==expected.toLowerCase())throw Error('更新包 SHA-256 校验失败，请稍后重试；原程序未更改。');
  return bytes;
}
function prepare(folder,env) {
  const npmArgs=['ci','--omit=dev','--omit=optional','--ignore-scripts','--no-audit','--no-fund','--registry=https://registry.npmjs.org/'];
  const command=process.platform==='win32'?'powershell.exe':'npm';
  const args=process.platform==='win32'?['-NoProfile','-NonInteractive','-Command',"& npm.cmd "+npmArgs.join(' ')+"; exit $LASTEXITCODE"]:npmArgs;
  for(const [file,argv] of [[command,args],[process.execPath,[join(folder,'build.mjs')]]]){
    const result=spawnSync(file,argv,{cwd:folder,env,stdio:'inherit',windowsHide:true});
    if(result.error||result.status!==0)throw Error('新版依赖或构建失败；原程序未更改。');
  }
}
export async function updatePortable({root,env=process.env,source='source',status,stop,start,prepareScript,fetchImpl=fetch,prepareApp=prepare,move=renameSync}) {
  root=realpathSync(root);
  if(existsSync(join(root,'.git')))throw Error('当前是 Git 源码目录，不能自动覆盖工作区。请在解压后的使用目录执行“更新全部”；源码改动保留。');
  const before=await status();
  if(before.statusError)throw Error(before.statusError);
  if(before.pending>0)throw Error('当前仍有生成请求，请结束生成后再更新全部。');
  console.log('[1/3] 检查并下载新版 MMDB…');
  const snapshot=source==='source'?await resolveSource(fetchImpl):null;
  const receipt=readReceipt(root);
  if(snapshot&&receipt?.repository===SOURCE_REPOSITORY&&receipt.commit===snapshot.revision&&receipt.version===before.version){
    console.log(`已是最新源码 ${snapshot.revision.slice(0,12)}，继续准备浏览器脚本。`);return prepareScript();
  }
  if(snapshot)console.log(`源码提交：${snapshot.revision.slice(0,12)}（main）`);
  const bytes=snapshot?snapshot.bytes:await readRelease(source,fetchImpl),updates=child(root,join(root,'.updates'));
  if(existsSync(updates)&&lstatSync(updates).isSymbolicLink())throw Error('更新目录不能是链接。');
  mkdirSync(updates,{recursive:true});
  const id=randomUUID(),stage=child(updates,join(updates,'stage-'+id)),next=join(stage,'next'),backup=child(updates,join(updates,'backup-'+id));
  mkdirSync(stage);let changed=false,stopped=false,retain=false;const installed=[],saved=[];
  try{
    unpackRelease(bytes,next,{revision:snapshot?.revision??null,branch:!!snapshot});
    const manifest=json(join(next,'package.json'));
    if(manifest.name!=='mmdb-pg'||!/^\d+\.\d+\.\d+$/.test(manifest.version))throw Error('更新包标识或版本无效。');
    const target=manifest.version.split('.').map(Number),current=before.version.split('.').map(Number);
    let comparison=0;for(let i=0;i<3&&!comparison;i++)comparison=Math.sign(target[i]-current[i]);
    if(comparison<0)throw Error(`发布版本 ${manifest.version} 早于本地 ${before.version}，已拒绝降级。`);
    if(comparison===0&&!snapshot){console.log(`程序已是 ${before.version}，继续准备浏览器脚本。`);return await prepareScript();}
    console.log(`版本 ${before.version} → ${manifest.version}；正在准备依赖。`);
    prepareApp(next,env);
    const entries=readdirSync(next);
    for(const name of entries){
      if(!files.has(name)&&!directories.has(name)&&name!=='node_modules')throw Error('新版构建产生了非程序文件，未替换当前目录。');
      const old=child(root,join(root,name));
      if(existsSync(old)&&lstatSync(old).isSymbolicLink())throw Error('程序路径包含链接，未替换当前目录。');
    }
    // Receipt participates in the same backup/rollback transaction as program files.
    if(existsSync(join(root,SOURCE_RECEIPT))&&lstatSync(join(root,SOURCE_RECEIPT)).isSymbolicLink())throw Error('源码记录不能是链接。');
    writeFileSync(join(next,SOURCE_RECEIPT),JSON.stringify({repository:SOURCE_REPOSITORY,branch:'main',commit:snapshot?.revision??null,version:manifest.version})+'\n');
    entries.push(SOURCE_RECEIPT);
    console.log('[2/3] 保存旧版并重启后台（配置保持不变）…');
    await stop();stopped=true;
    mkdirSync(backup);
    // Never rename the app root: Windows menu processes may hold its cwd open.
    for(const name of entries){
      const old=child(root,join(root,name)),fresh=child(next,join(next,name)),savedPath=child(backup,join(backup,name));
      if(existsSync(old)){move(old,savedPath);saved.push(name);}
      move(fresh,old);installed.push(name);changed=true;
    }
    await start(before.mode==='lan');
    const live=await status();
    if(live.statusError||live.serviceVersion!==manifest.version)throw Error('新版后台未按预期版本就绪。');
    console.log(`MMDB ${manifest.version} 已启动；旧版保存在 ${backup}`);
  }catch(error){
    if(changed||saved.length){
      // Stop only a verified idle service before restoring files. Keep recovery
      // material if stopping or restoring fails; never overwrite a busy service.
      try{
        await stop();
        const failed=child(stage,join(stage,'failed'));mkdirSync(failed);
        for(const name of installed.reverse())move(child(root,join(root,name)),child(failed,join(failed,name)));
        for(const name of saved.reverse())move(child(backup,join(backup,name)),child(root,join(root,name)));
        if(before.running)await start(before.mode==='lan');
        console.log('更新未完成，已恢复原程序。');
      }catch(recovery){retain=true;throw Error(`${error.message} 恢复未完成：${recovery.message}；恢复文件保留在 ${stage} 和 ${backup}`);}
    }else if(stopped&&before.running){await start(before.mode==='lan');}
    throw error;
  }finally{if(!retain)rmSync(child(updates,stage),{recursive:true,force:true});}
  console.log('[3/3] 准备新版浏览器脚本安装页…');
  // A browser step failing does not roll back a successfully updated backend.
  return prepareScript();
}
