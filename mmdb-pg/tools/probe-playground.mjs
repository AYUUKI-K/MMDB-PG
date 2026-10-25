// Runs a fixed synthetic probe via the user's already-connected browser bridge.
import {readFileSync,mkdirSync,appendFileSync} from 'node:fs';
import {probeNames} from '../experiment-probes.mjs';
const root=new URL('../',import.meta.url),config=JSON.parse(readFileSync(new URL('config.json',root),'utf8'));
const [experiment,model]=process.argv.slice(2);
if(!probeNames.includes(experiment)||!config.models.includes(model))throw Error('Usage: node tools/probe-playground.mjs <tool-auto|tool-any|tool-none|argument-stream|native-continuation> <configured-model>');
const response=await fetch(`http://127.0.0.1:${config.port}/v1/experiments/probe`,{method:'POST',headers:{Authorization:`Bearer ${config.apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({experiment,model}),signal:AbortSignal.timeout(190000)});
const result={testedAt:new Date().toISOString(),...await response.json()};
mkdirSync(new URL('.experiments/',root),{recursive:true});appendFileSync(new URL('.experiments/results.jsonl',root),JSON.stringify(result)+'\n');
console.log(JSON.stringify(result,null,2));
if(!response.ok||result.outcome==='failed')process.exitCode=1;
