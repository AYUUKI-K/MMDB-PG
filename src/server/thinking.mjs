import {bad} from './errors.mjs';

// Playground ListModels uses 5 for extra high, GenerateContent uses 6.
const levelsByCatalogCode = [null, 'low', 'medium', 'high', 'minimal', 'xhigh'];
const levelsByWireCode = [null, 'low', 'medium', 'high', 'minimal', null, 'xhigh'];
const standard = ['low', 'medium', 'high'];
const budgets = {none: 0, minimal: 1024, low: 1024, medium: 8192, high: 24576};
const budgetModel = model => /^gemini-2\.5-(?:pro|flash(?:-lite)?)(?:-preview[-\d]*)?$/.test(model);

export function catalogThinkingLevels(codes) {
  if (!Array.isArray(codes)) return undefined;
  return [...new Set(codes.filter(Number.isInteger).map(code => levelsByCatalogCode[code]).filter(Boolean))];
}

export function thinkingOptions(model, capability, headless) {
  let levels = capability?.thinkingLevels;
  if (!levels) {
    if (budgetModel(model)) levels = model.startsWith('gemini-2.5-pro') ? standard : ['none', ...standard];
    else if (model === 'gemini-4-hydrogen') levels = [...standard, 'xhigh'];
    else if (/^gemini-(?:4-(?:argon|carbon)|3\.[78]-flash|3\.1-pro-preview)$/.test(model)) levels = standard;
    else if (/^gemini-3(?:-flash-preview|\.1-flash-lite|\.5-flash(?:-lite)?|\.6-flash)$/.test(model)) levels = ['minimal', ...standard];
    else if (model === 'gemini-3-pro-preview') levels = ['low', 'high'];
  }
  return headless ? levels?.filter(level => level !== 'xhigh') : levels;
}

export function effortConfig(model, effort) {
  if (effort == null || effort === 'auto') return undefined;
  if (budgetModel(model) && typeof effort === 'string' && Object.hasOwn(budgets, effort)) {
    if (effort === 'none' && model.startsWith('gemini-2.5-pro')) bad('Gemini 2.5 Pro 不支持关闭思考');
    return {thinkingBudget: budgets[effort]};
  }
  return {thinkingLevel: effort};
}

export function thinkingWire(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) bad('thinkingConfig 必须为对象');
  for (const key of Object.keys(config)) {
    if (!['thinkingLevel','thinking_level','thinkingBudget','thinking_budget','includeThoughts','include_thoughts'].includes(key)) bad(`暂不支持 thinkingConfig.${key}`);
  }
  const {thinkingLevel: level = config.thinking_level, thinkingBudget: budget = config.thinking_budget, includeThoughts: include = config.include_thoughts} = config;
  if (include !== undefined && typeof include !== 'boolean') bad('includeThoughts 必须为布尔值');
  const flag = include === false ? 0 : 1;
  if (level !== undefined) {
    if (budget !== undefined) bad('thinkingLevel 和 thinkingBudget 只能指定一个');
    const code = typeof level === 'string' ? levelsByWireCode.indexOf(level.toLowerCase()) : -1;
    if (code < 1) bad('思考强度须为 minimal、low、medium、high 或 xhigh');
    return [flag, null, null, code];
  }
  if (budget !== undefined) {
    if (!Number.isSafeInteger(budget) || budget < -1 || budget > 2147483647) bad('thinkingBudget 须为 -1 或非负的 32 位整数');
    return [flag, budget];
  }
  return include === undefined ? undefined : [flag];
}

export const wireThinkingLevel = code => levelsByWireCode[code];
