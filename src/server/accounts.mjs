import {readFileSync,writeFileSync,renameSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {normalizeAccountEmail} from '../shared/account-email.js';

export const emailAccountId=email=>'email:'+createHash('sha256').update(email).digest('hex');

// Separate from diagnostics: this private local file contains primary emails
// and model cooldowns only, never passwords, cookies or request contents.
export function accountHistory(file) {
  const states=new Map();
  if(file&&existsSync(file))try {
    const raw=readFileSync(file,'utf8');
    if(raw.length>1024*1024)throw Error('oversized account history');
    const saved=JSON.parse(raw);
    if(saved.version!==1||!Array.isArray(saved.accounts))throw Error('invalid account history');
    for(const row of saved.accounts.slice(-64)){
      const email=normalizeAccountEmail(row?.email);if(!email)continue;
      const cooldowns=new Map();
      for(const [model,until] of Object.entries(row.cooldowns??{}).slice(0,100)){
        if(/^[a-zA-Z0-9._-]{1,160}$/.test(model)&&Number.isSafeInteger(until)&&until>Date.now()&&until<=Date.now()+86400000)cooldowns.set(model,until);
      }
      states.set(emailAccountId(email),{email,cooldowns});
    }
  }catch{console.warn('MMDB: unable to load local account records.');}
  return {states,save(){
    if(!file)return;
    const accounts=[...states.values()].filter(row=>row.email).slice(-64).map(({email,cooldowns})=>({email,cooldowns:Object.fromEntries([...cooldowns].filter(([,until])=>until>Date.now()))}));
    try{writeFileSync(file+'.tmp',JSON.stringify({version:1,accounts},null,2)+'\n',{encoding:'utf8',mode:0o600});renameSync(file+'.tmp',file);}
    catch{console.warn('MMDB: unable to save local account records.');}
  }};
}
