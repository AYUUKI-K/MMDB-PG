export function validateRuntimeConnection(options){
  let url;try{url=new URL(options?.url);}catch{throw Error('独立运行时地址无效');}
  if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.username||url.password||url.pathname!=='/'||url.search||url.hash||!url.port)throw Error('独立运行时必须使用明确端口的 http://127.0.0.1 地址');
  if(typeof options.apiKey!=='string'||!/^[a-zA-Z0-9_-]{24,128}$/.test(options.apiKey))throw Error('独立运行时密钥无效');
  return {url:url.origin,apiKey:options.apiKey};
}
