import {parseSparseJSON,ApiError} from './protocol.mjs';

export const CATALOG_TTL_MS=10*60*1000;
const modelID=value=>typeof value==='string'&&/^(?:models\/)?[a-zA-Z0-9._-]{1,160}$/.test(value)?value.replace(/^models\//,''):null;
const limit=value=>Number.isSafeInteger(value)&&value>0&&value<=10000000?value:undefined;
// Wire slots are pinned to AIStudio2API's ListModels adapter; see THIRD_PARTY.md.
// Store only public capabilities. Never store the original RPC body or headers.
export function decodeModelCatalog(raw) {
  if(typeof raw!=='string'||Buffer.byteLength(raw)>1024*1024)throw new ApiError(502,'模型能力目录过大或格式无效','invalid_model_catalog');
  let root;try{root=parseSparseJSON(raw);}catch{throw new ApiError(502,'模型能力目录无法解析','invalid_model_catalog');}
  if(!Array.isArray(root?.[0])||root[0].length>2000||root?.[1]?.[0])throw new ApiError(502,'模型能力目录不可用','invalid_model_catalog');
  const models=new Map(),aliases=new Map();
  for(const row of root[0]) {
    const id=modelID(row?.[0]);if(!id||!Array.isArray(row))continue;
    const methods=Array.isArray(row[7])?row[7].filter(value=>typeof value==='string'&&value.length<80):[];
    const capabilities=Array.isArray(row[64])?row[64].filter(Number.isSafeInteger):undefined;
    const entry={id,inputTokenLimit:limit(row[5]),outputTokenLimit:limit(row[6]),methods,
      functionDeclarations:capabilities?.includes(10)??false,outputContinuation:capabilities?.includes(91)??false,
      textGeneration:methods.includes('generateContent')&&capabilities?.includes(1)===true&&!capabilities.some(code=>[20,21,26,37,46,53].includes(code))&&!/image|imagen|veo|lyria|tts/i.test(id)};
    // Ambiguous duplicate IDs/aliases cannot enable protocol features.
    models.set(id,models.has(id)?null:entry);
    const rows=Array.isArray(row[56])?row[56]:[];
    const names=typeof rows[0]==='string'?[rows[0]]:rows.map(value=>value?.[0]);
    for(const name of names){const alias=modelID(name);if(alias&&alias!==id)aliases.set(alias,aliases.has(alias)?null:entry);}
  }
  // An alias must not restore capabilities rejected for its duplicate canonical ID.
  for(const [id,entry] of aliases)if(!models.has(id))models.set(id,entry&&models.get(entry.id)===entry?entry:null);
  return models;
}
export function modelCapability(owner,model,now=Date.now()) {
  if(!owner?.catalog||now-owner.catalogAt>=CATALOG_TTL_MS)return undefined;
  return owner.catalog.get(model)??undefined;
}
export function supportsNativeContinuation(capability) {
  return !!(capability?.functionDeclarations&&capability.outputContinuation&&capability.inputTokenLimit&&capability.outputTokenLimit&&capability.methods.includes('generateContent'));
}

// Add canonical text models from fresh page evidence; keep configured aliases and order.
export function textModels(owner,configured,now=Date.now()) {
  const result=new Set(configured);
  if(owner?.catalog&&now-owner.catalogAt<CATALOG_TTL_MS)for(const [id,entry] of owner.catalog){
    if(entry?.id===id&&entry.textGeneration)result.add(id);
  }
  return [...result];
}
