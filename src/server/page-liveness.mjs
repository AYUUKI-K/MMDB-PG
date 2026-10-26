import {randomUUID} from 'node:crypto';

// Transport pong is automatic in browsers. Only a JS-level reply proves that
// the executor can currently process messages. Never replay or abort work here.
export function createPageLiveness(send,{now=Date.now,intervalMs=15000,staleMs=45000,schedule=setInterval,cancel=clearInterval}={}) {
  let probe=null,lastReply=null,roundTripMs=null,visibility=null,keepAlive=null,stopped=false;
  function ping(){if(stopped||probe)return;probe={nonce:randomUUID(),at:now()};send({type:'page-ping',nonce:probe.nonce});}
  function acknowledge(message) {
    if(stopped||!probe||message.nonce!==probe.nonce)return false;
    lastReply=now();roundTripMs=Math.max(0,lastReply-probe.at);probe=null;
    visibility=['visible','hidden'].includes(message.visibility)?message.visibility:null;
    keepAlive=['active','starting','off','unsupported','unavailable'].includes(message.keepAlive)?message.keepAlive:null;
    return true;
  }
  function snapshot(){return {state:probe&&now()-probe.at>=staleMs?'unresponsive':lastReply===null?'checking':'responsive',lastResponseMs:lastReply===null?null:Math.max(0,now()-lastReply),roundTripMs,visibility,keepAlive};}
  const timer=schedule(ping,intervalMs);timer?.unref?.();ping();
  return {acknowledge,snapshot,destroy(){stopped=true;cancel(timer);probe=null;}};
}
