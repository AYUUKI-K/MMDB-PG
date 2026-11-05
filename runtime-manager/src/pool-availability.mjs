import {ApiError} from './errors.mjs';

export const normalizeModel=model=>String(model??'').replace(/^models\//,'');
export const cooldownUntil=(member,model)=>Math.max(member.cooldowns?.['*']?.until??0,member.cooldowns?.[normalizeModel(model)]?.until??0);
export const needsLogin=(row,member)=>member?.authRequired||row.state==='auth_required';
export const supportsModel=(row,model)=>!model||!row.models?.length||row.models.map(normalizeModel).includes(normalizeModel(model));

export function unavailableError(accounts,members,model,now){
  const enabled=accounts.filter(row=>members[row.id]?.enabled);
  if(!enabled.length)return new ApiError(503,'账号池没有启用账号，请在账号管理中启用','headless_no_enabled_accounts');
  const supported=enabled.filter(row=>supportsModel(row,model));
  if(!supported.length)return new ApiError(400,'已启用账号的模型目录不支持此模型，请选择可用模型','headless_model_unsupported');
  const authenticated=supported.filter(row=>!needsLogin(row,members[row.id]));
  if(!authenticated.length)return new ApiError(401,'支持此模型的账号均需要重新登录，请验证登录或重新导入凭证','headless_auth_required');
  const cooling=authenticated.filter(row=>cooldownUntil(members[row.id],model)>now);
  if(cooling.length===authenticated.length){
    const retryAt=Math.min(...cooling.map(row=>cooldownUntil(members[row.id],model)));
    const quota=cooling.every(row=>['*',normalizeModel(model)].some(key=>{const entry=members[row.id].cooldowns?.[key];return entry?.until>now&&entry.reason==='quota';}));
    return Object.assign(new ApiError(quota?429:403,quota?'可用账号处于额度冷却，请在冷却结束后重试':'可用账号暂被上游拒绝访问，请在管理页检查',quota?'upstream_quota_exhausted':'headless_access_denied'),{retryAt});
  }
  return new ApiError(503,'账号池暂不可用，请在管理页检查运行时状态','headless_pool_unavailable');
}
