// Read only capability metadata. Cookie values, tokens and source paths never
// leave this module or enter diagnostics; file timestamps are not login checks.
import {readFileSync,readdirSync,lstatSync} from 'node:fs';
import {join} from 'node:path';

export function createAuthMetadata(root){
  const base=join(root,'auth'),cache=new Map();
  const plain=(path,directory=false)=>{const stat=lstatSync(path);if(stat.isSymbolicLink()||(directory?!stat.isDirectory():!stat.isFile()))throw Error('Invalid credential path');return stat;};
  const read=path=>{if(plain(path).size>2*1024*1024)throw Error('Oversized credential file');return JSON.parse(readFileSync(path,'utf8'));};
  return ()=>{
    const result=new Map(),seen=new Set();
    try{
      plain(base,true);
      for(const entry of readdirSync(base,{withFileTypes:true})){
        if(!entry.isDirectory()||entry.isSymbolicLink())continue;
        const directory=join(base,entry.name);seen.add(directory);
        try{
          plain(directory,true);
          const configPath=join(directory,'account.json'),storagePath=join(directory,'storage-state.json');
          const a=plain(configPath),b=plain(storagePath),stamp=[a.mtimeMs,a.ctimeMs,a.size,b.mtimeMs,b.ctimeMs,b.size].join(':');
          let item=cache.get(directory);
          if(item?.stamp!==stamp){
            const config=read(configPath),state=read(storagePath),extension=state.aistudio2api;
            if(typeof config.label!=='string')continue;
            const sameAccount=typeof extension?.source?.email==='string'&&extension.source.email.toLowerCase()===config.label.toLowerCase();
            const oauth=sameAccount&&typeof extension?.oauth?.refresh_token==='string'&&!!extension.oauth.refresh_token&&typeof extension.oauth.gaia_id==='string'&&!!extension.oauth.gaia_id;
            const capability=oauth?'saved_oauth':sameAccount&&extension?.source?.browser==='chrome'?'chrome_source':'cookie_only';
            item={stamp,id:config.label.toLowerCase(),capability};cache.set(directory,item);
          }
          // Ambiguous identities cannot be advertised as capable of renewal.
          result.set(item.id,result.has(item.id)?'unknown':item.capability);
        }catch{cache.delete(directory);}
      }
    }catch{cache.clear();}
    for(const key of cache.keys())if(!seen.has(key))cache.delete(key);
    return result;
  };
}

export function authView(member,capability='unknown'){
  const value=member.auth??{};
  return {capability,automatic:capability==='saved_oauth'||capability==='chrome_source',
    lastVerifiedAt:value.lastVerifiedAt??null,lastCheckedAt:value.lastCheckedAt??null,
    verifiedBy:value.verifiedBy??null,lastFailure:value.lastFailure??null,
    failures:value.failures??0,nextCheckAt:value.nextCheckAt??null};
}
