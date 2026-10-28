// Local, silent Web Audio playback. Browser autoplay/OS policies still apply;
// a running AudioContext is not proof that background suspension is prevented.
export function createSilentAudioKeepAlive({page=window,enabled=false,changed=()=>{}}={}) {
  let wanted=enabled===true,disposed=false,current=null,state='off';
  const publish=value=>{state=value;changed({enabled:wanted,state});};
  const live=attempt=>!disposed&&wanted&&current===attempt;
  const release=attempt=>{
    if(!attempt)return;
    attempt.context.onstatechange=null;
    try{attempt.source?.stop();}catch{}
    try{attempt.source?.disconnect();}catch{}
    try{attempt.gain?.disconnect();}catch{}
    try{Promise.resolve(attempt.context.close()).catch(()=>{});}catch{}
  };
  const observe=attempt=>{
    if(!live(attempt))return;
    const next=attempt.context.state;
    if(next==='closed'){current=null;release(attempt);publish('unavailable');}
    else publish(next==='running'?'active':'blocked');
  };
  function ensure({gesture=false}={}){
    if(disposed||!wanted)return;
    if(!gesture){if(current)observe(current);else publish('blocked');return;}
    const Audio=page.AudioContext??page.webkitAudioContext;
    if(typeof Audio!=='function'){publish('unsupported');return;}
    let attempt=current;
    try{
      if(!attempt){
        attempt={context:new Audio()};current=attempt;
        // A short zero-filled buffer loops locally with a second zero-gain
        // guard. No media file, network, microphone, or audible tone is used.
        attempt.source=attempt.context.createBufferSource();
        attempt.source.buffer=attempt.context.createBuffer(1,attempt.context.sampleRate,attempt.context.sampleRate);
        attempt.source.loop=true;
        attempt.gain=attempt.context.createGain();attempt.gain.gain.value=0;
        attempt.source.connect(attempt.gain);attempt.gain.connect(attempt.context.destination);
        attempt.context.onstatechange=()=>observe(attempt);
        attempt.source.start();
      }
      if(attempt.resuming){observe(attempt);return;}
      attempt.resuming=true;
      const pending=attempt.context.resume();observe(attempt);
      Promise.resolve(pending).then(()=>observe(attempt),()=>{if(live(attempt))publish('blocked');}).finally(()=>{attempt.resuming=false;});
    }catch{
      if(attempt&&current===attempt){current=null;release(attempt);}
      publish('unavailable');
    }
  }
  function setEnabled(value){
    if(disposed)return;
    wanted=value===true;
    if(wanted)ensure({gesture:true});
    else{const previous=current;current=null;release(previous);publish('off');}
  }
  function destroy(){disposed=true;const previous=current;current=null;release(previous);state='off';}
  publish(wanted?'blocked':'off');
  return {ensure,setEnabled,destroy,get state(){return state;},get enabled(){return wanted;}};
}
