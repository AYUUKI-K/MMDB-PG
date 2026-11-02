export const EXTENSION_ID='pgppfacklbmaojbefbgllmjabijlkabc';
export const EXTENSION_ORIGIN=`chrome-extension://${EXTENSION_ID}`;
export const COOKIE_URL='https://aistudio.google.com/';
export const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export function localOrigin(value){
  try{const u=new URL(value);return u.protocol==='http:'&&u.hostname==='127.0.0.1'&&Number(u.port)>0&&!u.username&&!u.password&&u.origin===value;}catch{return false;}
}
export function validTicket(value,origin,now=Date.now()){
  return value?.version===1&&hex(value.installationId)&&hex(value.token)&&hex(value.proof)&&localOrigin(value.origin)&&value.origin===origin&&Number.isSafeInteger(value.authUser)&&value.authUser>=0&&value.authUser<=99&&Number.isSafeInteger(value.expiresAt)&&value.expiresAt>now&&value.expiresAt<=now+90000;
}
export const ticketText=value=>JSON.stringify([value.version,value.installationId,value.origin,value.token,value.authUser,value.expiresAt]);
