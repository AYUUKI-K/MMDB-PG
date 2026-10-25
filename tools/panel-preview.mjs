export function panelPreview(version, panel, floating, theme) {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="require-trusted-types-for 'script'"><meta name="viewport" content="width=device-width,initial-scale=1"><title>喵喵电波 · 面板预览</title>
  <style>
    *{box-sizing:border-box}body{margin:0;background:#e9ede8;color:#29382e;font:15px/1.8 "Segoe UI","Microsoft YaHei",sans-serif}nav{padding:24px 32px;border-bottom:1px solid #d0d8cf;display:flex;gap:16px;align-items:center;flex-wrap:wrap}nav strong{margin-right:auto;font-size:14px}button{font:inherit;font-size:12px;color:#44584a;border:1px solid #c4cec3;padding:8px 16px;background:transparent;border-radius:6px;min-height:44px;cursor:pointer}button:hover{background:#dce5db}main{max-width:680px;padding:72px 32px;margin:auto}small{font-size:11px;letter-spacing:2px;color:#6d7c70}h1{font-family:Georgia,"Songti SC","SimSun",serif;font-weight:500;font-size:36px;line-height:1.5;margin:12px 0 40px}p{color:#66766a;margin:20px 0}.message{padding:24px;background:#f4f6f0;border-radius:12px}.message p{margin:12px 0 0}.composer{border:1px solid #c4cec3;border-radius:12px;color:#748076;margin-top:32px;padding:16px;font-size:13px}.caption{font-size:12px;max-width:480px} @media(max-width:600px){nav{padding:16px;gap:8px}nav strong{width:100%}main{padding:32px 24px}h1{font-size:28px}}
  </style><nav><strong>MMDB / 交互预览</strong><button id="idle">未激活</button><button id="ready">已就绪</button><button id="simulate">生成中</button><button id="failure">连接异常</button></nav><main><small>RP · READING SPACE</small><h1>连接在一旁，<br>故事在眼前。</h1><div class="message"><small>茶馆 · 演示对话</small><p>窗外的雨还没停。她将温热的茶盏推到你面前，顺手拨亮了桌边那一盏灯。</p><p>“不着急，慢慢说。”</p></div><div class="composer">写下你的下一句…</div><p class="caption">右侧面板可拖动、收起或移到独立悬浮窗。此页使用演示数据，不连接 Google，也不修改本地反代设置。</p></main>
  <script type="module">const MMDB_VERSION=${JSON.stringify(version)};${theme}\n${floating}\n${panel}
  let demoSettings={nativeContinuation:false,inputRead:false},wake=false;
  const features=()=>({settings:demoSettings,availability:{nativeContinuation:{available:true},inputRead:{available:true}},busy:false});
  const sampleTheme={version:1,scheme:'dark',values:{'--panel':'rgb(41,46,50)','--ink':'rgb(226,231,233)','--secondary':'rgb(162,175,184)','--muted':'rgb(162,175,184)','--line':'rgb(72,81,89)','--inset':'rgb(41,46,50)','--accent':'rgb(237,183,130)','--on-accent':'#202428','--panel-font':'"Segoe UI","Microsoft YaHei","PingFang SC",sans-serif','--panel-radius':'26px','--control-radius':'12px'}};
  const ui=mountBridgePanel({
    activate:()=>{ui.update({activating:true,error:''});setTimeout(()=>{ui.update({activating:false,session:true,error:''});ui.addEvent('Meow · 会话已激活');},700);},
    reconnect:()=>{ui.update({link:'connected',error:'',experiments:features()});ui.addEvent('已连接本地服务');},
    saveKey:()=>{ui.update({error:''});ui.addEvent('预览：密钥未保存');},
    saveAccountEmail:email=>ui.update({accountEmail:email,accountError:'',link:'connected',experiments:features()}),
    saveExperiments:settings=>{demoSettings={...demoSettings,...settings};ui.update({experiments:features()});},
    toggleWake:()=>ui.update({wake: wake=!wake})
  },{demo:true,themeMode:'tavern',tavernTheme:sampleTheme,accountEmail:'story@example.com',accountEmails:['story@example.com'],experiments:features(),link:'connected',session:true,completed:12,elapsed:28,model:'pg-gemini-4-argon-抗截断',apiKey:'mmdb'});
  ui.addEvent('已连接本地服务');ui.addEvent('回复已送达 · 输入 320 / 输出 860 token');
  document.getElementById('idle').onclick=()=>ui.update({busy:false,session:false,link:'disconnected',accountEmail:null,model:null,elapsed:null,experiments:null,error:''});
  document.getElementById('ready').onclick=()=>ui.update({busy:false,session:true,link:'connected',accountEmail:'story@example.com',experiments:features(),error:''});
  document.getElementById('simulate').onclick=()=>ui.update({busy:true,session:true,link:'connected',accountEmail:'story@example.com',phase:'streaming',elapsed:24,experiments:features(),error:''});
  document.getElementById('failure').onclick=()=>{ui.update({busy:false,link:'disconnected',error:'无法连接本地服务，请确认启动窗口仍在运行。'});ui.addEvent('本地连接中断');};
  </script></html>`;
}
