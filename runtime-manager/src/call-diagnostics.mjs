// Metadata journal shared by the relay, account pool and supervisor. No message,
// URL, credential, stack or upstream error text is accepted by this boundary.
import {mkdirSync,readFileSync,writeFileSync,appendFileSync,renameSync,readdirSync,statSync,lstatSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID,randomBytes,createHmac} from 'node:crypto';
import {processAlive} from './headless-lock.mjs';

const DAY=86400000,MiB=1024*1024;
const FILE=/^events-\d{4}-\d{2}-\d{2}-\d+-[a-f0-9-]+\.jsonl$/;
const token=value=>typeof value==='string'&&/^[-a-zA-Z0-9_.:]{1,160}$/.test(value)?value:undefined;
const number=value=>Number.isFinite(value)&&value>=0?value:undefined;
const metrics={usage:['promptTokenCount','candidatesTokenCount','thoughtsTokenCount','totalTokenCount','cachedContentTokenCount','toolUsePromptTokenCount'],requestCounts:['total','inputRead','answer','continuation','retry','probe'],timings:['firstByteMs','firstBodyMs','firstClientTextMs','queuedMs','preparingMs','headersMs'],generation:['temperature','topP','topK','maxOutputTokens','nativeOutputBudget'],images:['count','bytes']};
const strings=['requestId','dispatchId','source','model','requestedModel','accountRef','fromAccountRef','reason','status','code','stage','backend','finishReason','inputReadMode','continuationMode'];
const numbers=['pid','sequence','attempt','round','httpStatus','elapsedMs','retryAt','firstBodyMs','firstByteMs'];
export function cleanDiagnostic(value){
  const out={v:1};
  if(!value||typeof value!=='object'||!token(value.type))return null;
  out.type=value.type;out.id=token(value.id)??randomUUID();out.at=number(value.at)??Date.now();
  for(const key of strings)if(token(value[key]))out[key]=value[key];
  for(const key of numbers)if(number(value[key])!==undefined)out[key]=value[key];
  for(const key of ['stream','usageComplete'])if(typeof value[key]==='boolean')out[key]=value[key];
  for(const [key,fields] of Object.entries(metrics))if(value[key]&&typeof value[key]==='object'){
    const clean={};for(const field of fields)if(number(value[key][field])!==undefined)clean[field]=value[key][field];
    if(Object.keys(clean).length)out[key]=clean;
  }
  return out;
}
const compare=(a,b)=>b.at-a.at||b.id.localeCompare(a.id);
export function createCallDiagnostics({root,now=Date.now,alive=processAlive,segmentBytes=MiB}={}){
  const dir=join(root,'diagnostics'),cache=new Map();let salt,writer,writerDay,writerSize=0,lastPrune=0,lastError=null,sequence=0;
  const failed=error=>{lastError={at:now(),code:['EACCES','EPERM','ENOSPC','EROFS'].includes(error?.code)?error.code:'storage_error'};};
  function init(){mkdirSync(dir,{recursive:true,mode:0o700});if(!salt){const file=join(dir,'identity');try{writeFileSync(file,randomBytes(32).toString('hex'),{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;}salt=readFileSync(file,'utf8');if(!/^[a-f0-9]{64}$/.test(salt))throw Error('identity');}}
  function account(id){try{init();return 'acct_'+createHmac('sha256',salt).update(String(id)).digest('hex').slice(0,12);}catch(e){failed(e);return undefined;}}
  function settings(){try{const s=JSON.parse(readFileSync(join(dir,'settings.json'),'utf8'));if(Number.isInteger(s.days)&&s.days>=1&&s.days<=30&&Number.isInteger(s.maxMiB)&&s.maxMiB>=10&&s.maxMiB<=500)return {days:s.days,maxMiB:s.maxMiB};}catch{}return {days:7,maxMiB:100};}
  function configure(value){if(!Number.isInteger(value.days)||value.days<1||value.days>30||!Number.isInteger(value.maxMiB)||value.maxMiB<10||value.maxMiB>500)throw Error('保留天数须为 1–30，空间上限须为 10–500 MiB');init();const target=join(dir,'settings.json'),tmp=target+'.'+randomUUID()+'.tmp';writeFileSync(tmp,JSON.stringify({days:value.days,maxMiB:value.maxMiB}),{mode:0o600});renameSync(tmp,target);prune(true);return storage();}
  function files(){init();return readdirSync(dir).filter(name=>FILE.test(name)).flatMap(name=>{try{const path=join(dir,name),s=lstatSync(path);return s.isFile()&&!s.isSymbolicLink()?[{name,path,size:s.size,mtime:s.mtimeMs}]:[];}catch{return [];}}).sort((a,b)=>a.mtime-b.mtime||a.name.localeCompare(b.name));}
  function prune(force=false){if(!force&&now()-lastPrune<60000)return;lastPrune=now();try{const config=settings(),rows=files();let size=rows.reduce((sum,f)=>sum+f.size,0);for(const f of rows){if(f.mtime>=now()-config.days*DAY&&size<=config.maxMiB*MiB)continue;try{unlinkSync(f.path);cache.delete(f.name);size-=f.size;if(f.path===writer)writer=undefined;}catch(e){failed(e);}}}catch(e){failed(e);}}
  function record(type,value={}){
    try{init();prune();const event=cleanDiagnostic({...value,type,id:randomUUID(),at:now(),pid:process.pid,sequence:sequence++});if(!event)return;
      // Raw account IDs exist only in memory and never become journal fields.
      if(value.accountId!==undefined)event.accountRef=account(value.accountId);
      if(value.fromAccountId!==undefined)event.fromAccountRef=account(value.fromAccountId);
      const line=JSON.stringify(event)+'\n',day=new Date(now()).toISOString().slice(0,10);
      const rotated=!writer||writerDay!==day||writerSize+Buffer.byteLength(line)>segmentBytes;
      if(rotated){writer=join(dir,`events-${day}-${process.pid}-${randomUUID()}.jsonl`);writerDay=day;writerSize=0;}
      appendFileSync(writer,line,{mode:0o600});writerSize+=Buffer.byteLength(line);if(rotated)prune(true);return event;
    }catch(e){failed(e);}
  }
  function read(){prune();let corrupt=0,events=[];try{const current=files(),names=new Set(current.map(f=>f.name));for(const key of cache.keys())if(!names.has(key))cache.delete(key);
    for(const f of current){let item=cache.get(f.name);if(!item||item.size!==f.size||item.mtime!==f.mtime){const text=readFileSync(f.path,'utf8'),lines=text.split('\n');lines.pop();let bad=0;const rows=[];for(const line of lines){try{const row=cleanDiagnostic(JSON.parse(line));if(row)rows.push(row);else bad++;}catch{bad++;}}item={rows,bad,size:f.size,mtime:f.mtime};cache.set(f.name,item);}events.push(...item.rows);corrupt+=item.bad;}
    const cutoff=now()-settings().days*DAY;events=events.filter(e=>e.at>=cutoff).sort(compare);
  }catch(e){failed(e);}return {events,corrupt};}
  function storage(){prune(true);let bytes=0,segments=0;try{const rows=files();bytes=rows.reduce((n,f)=>n+f.size,0);segments=rows.length;}catch(e){failed(e);}return {...settings(),bytes,segments,lastError,metadataOnly:true};}
  function requests(events){const groups=new Map();for(const event of events){if(!event.requestId)continue;let row=groups.get(event.requestId);if(!row){row={id:event.requestId,requestId:event.requestId,at:event.at,events:[]};groups.set(event.requestId,row);}row.events.push(event);row.at=Math.min(row.at,event.at);}
    for(const row of groups.values()){
      row.events.sort((a,b)=>a.at-b.at||(a.pid===b.pid?(a.sequence??0)-(b.sequence??0):a.id.localeCompare(b.id)));
      const started=row.events.find(e=>e.type==='request-start'),end=row.events.findLast(e=>e.type==='request-finish');
      for(const event of row.events)for(const key of [...strings.filter(k=>!['status','requestId','dispatchId','reason','stage','code','fromAccountRef'].includes(k)),...Object.keys(metrics),'elapsedMs','firstBodyMs','firstByteMs','stream','usageComplete'])if(event[key]!==undefined)row[key]=event[key];
      row.status=end?.status??(!started||!alive(started.pid)||now()-row.at>2*60*60*1000?'interrupted':'running');row.code=end?.code;
      row.accountRefs=[...new Set(row.events.map(e=>e.accountRef).filter(Boolean))];
      row.dispatches=row.events.filter(e=>e.type==='request-sent').length;
      row.switches=row.events.filter(e=>e.type==='account-selected'&&e.fromAccountRef&&e.fromAccountRef!==e.accountRef).length;
      row.elapsedMs=end?.elapsedMs??Math.max(0,(row.status==='running'?now():row.events.at(-1).at)-row.at);
    }return [...groups.values()].sort(compare);
  }
  function filter(rows,f={}){
    const start=Number(f.from)||now()-(Number(f.hours)>0?Math.min(720,Number(f.hours)):24)*3600000,end=Number(f.to)||Infinity,q=String(f.q??'').toLowerCase().slice(0,160);
    return rows.filter(r=>r.at>=start&&r.at<=end&&(!f.status||r.status===f.status)&&(!f.model||r.model===f.model||r.requestedModel===f.model)&&(!f.account||r.accountRef===f.account||r.accountRefs?.includes(f.account))&&(!f.source||r.source===f.source)&&(!f.type||r.type===f.type)&&(!f.code||r.code===f.code)&&(!q||[r.requestId,r.model,r.requestedModel,r.code,r.type,r.reason,...(r.accountRefs??[r.accountRef]),...(r.events??[]).flatMap(e=>[e.reason,e.code,e.type])].filter(Boolean).join(' ').toLowerCase().includes(q)));
  }
  function select(filters){const data=read(),all=requests(data.events);return {...data,all,rows:filter(filters?.view==='events'?data.events:all,filters)};}
  function query(filters={}){
    const {rows,all,events,corrupt}=select(filters),snapshot=Number(filters.snapshot)||now(),visible=rows.filter(r=>r.at<=snapshot);
    let offset=Number.isSafeInteger(filters.offset)?Math.max(0,filters.offset):0;const limit=Math.min(100,Math.max(1,Number(filters.limit)||50));
    // Snapshot + last tuple keeps pagination stable when new requests arrive.
    let page=visible;if(filters.after&&Number.isFinite(filters.after.at)&&token(filters.after.id))page=page.filter(r=>compare(r,filters.after)>0);else page=page.slice(offset);
    const slice=page.slice(0,limit),completed=visible.filter(r=>r.status==='finished'||r.status==='failed'),durations=completed.map(r=>r.elapsedMs).sort((a,b)=>a-b);
    const summary={total:visible.length,finished:visible.filter(r=>r.status==='finished').length,failed:visible.filter(r=>r.status==='failed').length,cancelled:visible.filter(r=>r.status==='cancelled').length,running:visible.filter(r=>r.status==='running').length,interrupted:visible.filter(r=>r.status==='interrupted').length,p95:durations.length?durations[Math.ceil(durations.length*.95)-1]:null,usageReported:completed.filter(r=>r.usage?.totalTokenCount!==undefined&&r.usageComplete!==false).length};
    return {rows:slice.map(({events,...r})=>r),summary,snapshot,next:page.length>limit?{at:slice.at(-1).at,id:slice.at(-1).id}:null,corrupt,storage:storage(),options:{models:[...new Set(all.map(r=>r.model).filter(Boolean))].sort(),accounts:[...new Set(events.map(e=>e.accountRef).filter(Boolean))].sort(),sources:[...new Set(events.map(e=>e.source).filter(Boolean))].sort(),types:[...new Set(events.map(e=>e.type))].sort()}};
  }
  function detail(id){return requests(read().events).find(r=>r.requestId===id)??null;}
  function exportJSONL(filters={}){
    const selected=select(filters),rows=filters.requestId?selected.all.filter(r=>r.requestId===filters.requestId):selected.rows;
    const ids=new Map(),accounts=new Map(),alias=(map,value,prefix)=>{if(!map.has(value))map.set(value,prefix+(map.size+1));return map.get(value);};
    function anonymous(row){const out={};for(const [key,value] of Object.entries(row)){if(['pid','id'].includes(key))continue;if(['requestId','dispatchId'].includes(key))out[key]=alias(ids,value,'request-');else if(['accountRef','fromAccountRef'].includes(key))out[key]=alias(accounts,value,'account-');else if(key==='accountRefs')out[key]=value.map(v=>alias(accounts,v,'account-'));else if(key==='events')out[key]=value.map(anonymous);else out[key]=value;}return out;}
    let bytes=0;const lines=[];for(const row of rows){const line=JSON.stringify(anonymous(row));if(lines.length>=5000||bytes+Buffer.byteLength(line)>20*MiB)break;lines.push(line);bytes+=Buffer.byteLength(line)+1;}
    const manifest={format:'mmdb-diagnostics-v1',exportedAt:new Date(now()).toISOString(),metadataOnly:true,accountAliases:'per-export',requestCountScope:'runtime-dispatch',matched:rows.length,exported:lines.length,truncated:lines.length<rows.length,corruptLines:selected.corrupt};
    return JSON.stringify(manifest)+'\n'+lines.join('\n')+'\n';
  }
  return {record,account,query,detail,exportJSONL,settings,configure,storage};
}
