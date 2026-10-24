// Offline parameter probe. Sends only synthetic text to a loopback mock, never Google.
import http from 'node:http';
import {once} from 'node:events';
import {existsSync,readFileSync,realpathSync} from 'node:fs';
import {homedir} from 'node:os';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';

async function waitForStartup(target,readyTimeoutMs,pollMs){
  const deadline=Date.now()+readyTimeoutMs;
  while(true){
    try{
      return await fetch(new URL('/csrf-token',target),{signal:AbortSignal.timeout(Math.max(1,Math.min(2000,deadline-Date.now()))),redirect:'error'});
    }catch(error){
      const transient=error.name==='TimeoutError'||['ECONNREFUSED','ECONNRESET','EPIPE','UND_ERR_SOCKET'].includes(error.cause?.code);
      if(!transient)throw error;
      if(Date.now()>=deadline)return null;
      await delay(Math.min(pollMs,deadline-Date.now()));
    }
  }
}

export async function inspectPhone(base='http://127.0.0.1:8000',{readyTimeoutMs=30000,pollMs=500}={}){
  const target=new URL(base);
  if(target.protocol!=='http:'||!['localhost','127.0.0.1','[::1]'].includes(target.hostname)||target.username||target.password)throw Error('只允许检查手机本机 HTTP 酒馆。');
  if(!Number.isInteger(readyTimeoutMs)||readyTimeoutMs<1||readyTimeoutMs>30000||!Number.isInteger(pollMs)||pollMs<1||pollMs>1000)throw Error('启动等待参数无效。');
  let observed;
  const mock=http.createServer(async(req,res)=>{
    if(req.method!=='POST'||req.url!=='/v1/chat/completions'){res.writeHead(404);res.end();return;}
    try{
      let raw='',length=0;
      for await(const part of req){length+=part.length;if(length>65536)throw Error('probe too large');raw+=part.toString();}
      const value=JSON.parse(raw);
      // Retain only allowlisted parameter metadata; no headers, tokens or messages.
      observed={model:value.model==='pg-gemini-4-argon'?'pg-gemini-4-argon':'other',effort:['low','medium','high','xhigh','max','auto'].includes(value.reasoning_effort)?value.reasoning_effort:(value.reasoning_effort===undefined?'missing':'other')};
      res.writeHead(200,{'Content-Type':'application/json'});
      res.end(JSON.stringify({id:'mmdb-offline-probe',object:'chat.completion',model:'pg-gemini-4-argon',choices:[{index:0,message:{role:'assistant',content:'MMDB_OFFLINE_CHECK'},finish_reason:'stop'}]}));
    }catch{res.writeHead(400);res.end('{}');}
  });
  mock.listen(0,'127.0.0.1');await once(mock,'listening');
  try{
    // Only retry the readiness GET. Never retry the generation POST.
    const tokenResponse=await waitForStartup(target,readyTimeoutMs,pollMs);
    if(!tokenResponse)return {stage:'startup',status:null,observed:null};
    if(!tokenResponse.ok)return {stage:'csrf',status:tokenResponse.status,observed:null};
    const token=await tokenResponse.json();
    if(typeof token.token!=='string')return {stage:'csrf-format',status:tokenResponse.status,observed:null};
    const cookies=tokenResponse.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
    const response=await fetch(new URL('/api/backends/chat-completions/generate',target),{
      method:'POST',signal:AbortSignal.timeout(10000),redirect:'error',headers:{'Content-Type':'application/json','X-CSRF-Token':token.token,...(cookies?{Cookie:cookies}:{})},
      body:JSON.stringify({chat_completion_source:'custom',custom_url:`http://127.0.0.1:${mock.address().port}/v1`,model:'pg-gemini-4-argon',messages:[{role:'user',content:'MMDB offline parameter check. No real generation.'}],reasoning_effort:'high',include_reasoning:true,temperature:0,max_tokens:1,stream:false,custom_include_body:'',custom_exclude_body:'',custom_include_headers:''}),
    });
    // Discard the mock reply, do not persist or show the provider response body.
    await response.arrayBuffer();
    return {stage:'roundtrip',status:response.status,observed:observed??null};
  }finally{mock.closeAllConnections();await new Promise(resolve=>mock.close(resolve));}
}

if(process.argv[1]&&existsSync(process.argv[1])&&import.meta.url===pathToFileURL(realpathSync(process.argv[1])).href){
  try{
    const root=resolve(process.argv[2]||resolve(homedir(),'SillyTavern'));
    const file=resolve(root,'src/endpoints/backends/chat-completions.js');
    console.log('检查目录：',root);
    console.log('磁盘补丁标记：',existsSync(file)?readFileSync(file,'utf8').includes('MMDB PG reasoning:'):'未找到此目录');
    const result=await inspectPhone();
    console.log('本机模拟结果：',JSON.stringify(result));
    if(result.observed?.effort==='high')console.log('正在运行的酒馆后端已能转发 high，需继续查页面实际发出的参数。');
    else if(result.observed?.effort==='missing')console.log('正在运行的酒馆后端仍丢弃强度参数；磁盘标记不代表运行进程已加载补丁。');
    else if(result.stage==='startup')console.log('等待 30 秒后，手机本机 8000 端口仍未就绪；尚未检查参数转发。');
    else console.log('未完成本机模拟检查；请保留上面的状态码。无需发起 Google 生成。');
  }catch(error){console.error('检查未完成：',error.message);process.exitCode=1;}
}
