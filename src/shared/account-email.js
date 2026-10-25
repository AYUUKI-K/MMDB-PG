// A local account label, not proof of Google authentication. Use the primary
// sign-in email; do not merge dots/aliases for Workspace or custom domains.
export function normalizeAccountEmail(value) {
  if(typeof value!=='string')return null;
  const email=value.trim().toLowerCase();
  if(email.length>254||!email.length||/[^\x21-\x7e]/.test(email))return null;
  const parts=email.split('@');
  if(parts.length!==2)return null;
  const [local,domain]=parts;
  if(!local||local.length>64||!/[a-z0-9]/.test(local)||!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)||local.startsWith('.')||local.endsWith('.')||local.includes('..'))return null;
  if(!domain.includes('.')||domain.length>253||domain.split('.').some(part=>!part||part.length>63||!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(part)))return null;
  return email;
}

export function maskAccountEmail(email) {
  const [local,domain]=email.split('@');
  return `${local[0]}***@${domain}`;
}
