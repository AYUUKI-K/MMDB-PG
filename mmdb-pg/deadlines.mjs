// One logical request has an absolute lifetime. Each dispatch has a separate
// queue wait and generation wait; transport prefixes are not generated content.
export class RequestDeadlines {
  constructor(config,{extended=false,queued=false}={}) {
    this.idleMs=config.timeoutMs;
    this.firstMs=extended?(config.toolFirstByteTimeoutMs??config.timeoutMs):config.timeoutMs;
    this.queueMs=config.queueTimeoutMs??120000;
    this.totalMs=config.maxRequestMs??1800000;
    this.extended=extended;
    this.round(0,queued);
  }
  round(ms,queued) {this.queuedAt=ms;this.startedAt=queued?undefined:ms;this.firstContentAt=undefined;this.lastDataAt=undefined;}
  start(ms) {this.startedAt??=ms;}
  data(ms,hasContent=false) {this.start(ms);this.lastDataAt=ms;if(hasContent)this.firstContentAt??=ms;}
  next() {
    const total={at:this.totalMs,code:'request_deadline',message:'本次请求已达到总耗时上限，已停止所有后续生成。'};
    let phase;
    if(this.startedAt===undefined)phase={at:this.queuedAt+this.queueMs,code:'queue_timeout',message:'等待浏览器执行队列超时，请减少同时发起的请求。'};
    else if(this.firstContentAt===undefined)phase={at:this.startedAt+this.firstMs,code:this.extended?'upstream_first_byte_timeout':'timeout',message:'等待首个有效生成内容超时，已停止本次请求。'};
    else phase={at:this.lastDataAt+this.idleMs,code:'timeout',message:'等待后续上游数据超时，未把部分响应标为成功。'};
    return phase.at<total.at?phase:total;
  }
}
