// Whitespace keeps a pending JSON response active without inventing a token.
export const JSON_KEEPALIVE = 'json-whitespace-v1';
export function beginJSON(res, status = 200, keepAlive = false) {
  if (!res.headersSent) res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, no-transform',
    'X-Content-Type-Options': 'nosniff',
    'X-Accel-Buffering': 'no',
    ...(keepAlive ? {'X-MMDB-Response': JSON_KEEPALIVE} : {}),
  });
}
export function json(res, status, body) {
  if (res.destroyed || res.writableEnded) return;
  beginJSON(res, status);
  res.end(JSON.stringify(body));
}
export function jsonHeartbeat(res) {
  if (res.destroyed || res.writableEnded) return;
  if (res.writableLength > 2 * 1024 * 1024) throw Object.assign(new Error('调用方读取过慢'), {status:502,code:'slow_client'});
  beginJSON(res, 200, true);
  res.write(' \n');
}
