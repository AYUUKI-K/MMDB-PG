// Observe wire structure before decoding; never retain text, signatures or keys.
const efforts=['low','medium','high','xhigh','max','auto','min','minimal','none'];
const counters=['framesWithParts','rawParts','rawTextParts','rawThoughtTextParts','rawThoughtChars','signatureParts','toolParts','decodedThoughtChars','forwardedThoughtChars'];
const type=value=>Array.isArray(value)?'a':({string:'s',number:'n',boolean:'b',object:'o'})[typeof value]??'u';
const shape=part=>Array.isArray(part)?part.slice(0,32).flatMap((v,i)=>v==null?[]:[`${i}:${type(v)}`]).join(','):'non-array';
export function cleanReasoning(value){
  const result={};
  if(['missing','other',...efforts].includes(value?.requestEffort))result.requestEffort=value.requestEffort;
  for(const key of counters)if(Number.isSafeInteger(value?.[key])&&value[key]>=0)result[key]=value[key];
  if(Array.isArray(value?.partShapes))result.partShapes=value.partShapes.slice(0,8).filter(row=>
    typeof row?.slots==='string'&&/^(?:non-array|(?:(?:[0-9]|[12][0-9]|3[01]):[asnbou])(?:,(?:[0-9]|[12][0-9]|3[01]):[asnbou]){0,31}|)$/.test(row.slots)&&Number.isSafeInteger(row.count)&&row.count>=0
  ).map(({slots,count})=>({slots,count}));
  return result;
}
export class ReasoningTrace{
  constructor(effort){
    this.data={requestEffort:effort===undefined?'missing':efforts.includes(effort)?effort:'other',...Object.fromEntries(counters.map(key=>[key,0]))};
    this.shapes=new Map();
  }
  frame(frame){
    const parts=frame?.[0]?.[0]?.[0]?.[0];
    if(!Array.isArray(parts)||!parts.length)return;
    this.data.framesWithParts++;
    for(const p of parts){
      this.data.rawParts++;
      const slots=shape(p);
      if(this.shapes.has(slots)||this.shapes.size<8)this.shapes.set(slots,(this.shapes.get(slots)??0)+1);
      if(typeof p?.[1]==='string'){
        this.data.rawTextParts++;
        if(p[12]){this.data.rawThoughtTextParts++;this.data.rawThoughtChars+=p[1].length;}
      }
      if(p?.[14])this.data.signatureParts++;
      if(p?.[10])this.data.toolParts++;
    }
  }
  decoded(parts){for(const p of parts)if(p.thought&&typeof p.text==='string')this.data.decodedThoughtChars+=p.text.length;}
  forwarded(chars){this.data.forwardedThoughtChars+=chars;}
  snapshot(){return cleanReasoning({...this.data,partShapes:[...this.shapes].map(([slots,count])=>({slots,count}))});}
}
