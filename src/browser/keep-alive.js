// A local WebRTC data-channel pair keeps background work eligible to run in
// Chromium. No media, STUN/TURN service, or Google request is involved.
// This is best effort: OS suspension and browser-forced freezes still win.
export function createBackgroundKeepAlive({page=window,enabled=true,changed=()=>{},now=Date.now,schedule=setTimeout,cancel=clearTimeout}={}) {
  let wanted=enabled,disposed=false,current=null,retryAt=0,state='off';
  const publish=value=>{if(state!==value){state=value;changed({enabled:wanted,state});}};
  const release=attempt=>{
    if(!attempt)return;
    cancel(attempt.timer);
    for(const channel of attempt.channels){channel.onopen=channel.onclose=channel.onerror=null;try{channel.close();}catch{}}
    for(const peer of attempt.peers){peer.onicecandidate=peer.onconnectionstatechange=null;try{peer.close();}catch{}}
  };
  function fail(attempt) {
    if(current!==attempt)return;
    current=null;release(attempt);retryAt=now()+30000;publish('unavailable');
  }
  function ensure() {
    if(disposed||!wanted||current||now()<retryAt)return;
    if(typeof page.RTCPeerConnection!=='function'){publish('unsupported');return;}
    const attempt={peers:[],channels:[],timer:null};current=attempt;publish('starting');
    const live=()=>current===attempt&&!disposed&&wanted;
    try {
      const left=new page.RTCPeerConnection({iceServers:[]});attempt.peers.push(left);
      const right=new page.RTCPeerConnection({iceServers:[]});attempt.peers.push(right);
      const pending=new Map([[left,[]],[right,[]]]);
      const candidate=async(peer,value)=>{
        if(!live())return;
        if(!peer.remoteDescription){pending.get(peer).push(value);return;}
        try{await peer.addIceCandidate(value);}catch{if(live())fail(attempt);}
      };
      left.onicecandidate=event=>{if(event.candidate)void candidate(right,event.candidate);};
      right.onicecandidate=event=>{if(event.candidate)void candidate(left,event.candidate);};
      const remote=async(peer,description)=>{
        await peer.setRemoteDescription(description);
        if(!live())return;
        for(const value of pending.get(peer).splice(0)){if(!live())return;await peer.addIceCandidate(value);}
      };
      for(const peer of attempt.peers){
        peer.onconnectionstatechange=()=>{if(['failed','disconnected','closed'].includes(peer.connectionState)&&live())fail(attempt);};
        const channel=peer.createDataChannel('mmdb-background',{negotiated:true,id:0});attempt.channels.push(channel);
        channel.onopen=()=>{if(live()&&attempt.channels.every(item=>item.readyState==='open')){cancel(attempt.timer);publish('active');}};
        channel.onclose=channel.onerror=()=>{if(live())fail(attempt);};
      }
      attempt.timer=schedule(()=>fail(attempt),15000);
      void (async()=>{
        const offer=await left.createOffer();if(!live())return;
        await left.setLocalDescription(offer);if(!live())return;
        await remote(right,left.localDescription);if(!live())return;
        const answer=await right.createAnswer();if(!live())return;
        await right.setLocalDescription(answer);if(!live())return;
        await remote(left,right.localDescription);
      })().catch(()=>{if(live())fail(attempt);});
    } catch {fail(attempt);}
  }
  function setEnabled(value) {
    wanted=value===true;retryAt=0;
    if(!wanted){const previous=current;current=null;release(previous);publish('off');}
    else ensure();
  }
  function destroy(){disposed=true;const previous=current;current=null;release(previous);}
  // Publish the initial preference even when the API is absent.
  changed({enabled:wanted,state:wanted?'starting':'off'});ensure();
  return {ensure,setEnabled,destroy,get state(){return state;},get enabled(){return wanted;}};
}
