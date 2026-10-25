import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {cleanGeneration} from '../src/server/metrics.mjs';

const median=values=>{const a=values.filter(Number.isFinite).sort((x,y)=>x-y);return a.length?(a[Math.floor((a.length-1)/2)]+a[Math.floor(a.length/2)])/2:null;};
export function performanceReport(rows){
  const groups=new Map();let excluded=0;
  for(const row of Array.isArray(rows)?rows:[]){
    if(row?.status!=='finished'||row.rounds!==0||row.networkRetries!==0||!row.generation||!/^[-a-zA-Z0-9._]+(?:-抗截断)?$/.test(row.model??'')){excluded++;continue;}
    const generation=cleanGeneration(row.generation),style=row.model.endsWith('-抗截断')?(row.toolPromptStyle??'unknown'):'ordinary';
    const key=JSON.stringify([row.model,style,generation]);
    const group=groups.get(key)??{model:row.model,style,generation,rows:[]};group.rows.push(row);groups.set(key,group);
  }
  return {excluded,note:'仅汇总已知配置且无重试／续写的成功记录；不同输入仍会影响结果，不能据此推断纯生成速度。',groups:[...groups.values()].map(({rows,...group})=>({...group,samples:rows.length,medianElapsedMs:median(rows.map(row=>row.elapsedMs)),medianFirstBodyMs:median(rows.map(row=>row.firstBodyMs)),medianBodyChars:median(rows.map(row=>row.bodyChars)),reportedUsageSamples:rows.filter(row=>row.usage).length,medianPromptTokens:median(rows.map(row=>row.usage?.promptTokenCount)),medianOutputTokens:median(rows.map(row=>row.usage?.candidatesTokenCount)),medianThoughtTokens:median(rows.map(row=>row.usage?.thoughtsTokenCount))}))};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  const file=process.argv[2]??new URL('../diagnostics.log',import.meta.url);
  try{console.log(JSON.stringify(performanceReport(JSON.parse(readFileSync(file,'utf8'))),null,2));}
  catch(error){console.error(`无法读取诊断记录：${error.code??'格式无效'}`);process.exitCode=1;}
}
