import http from 'node:http';
import {isIP} from 'node:net';
import {timingSafeEqual} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {readFileSync, writeFileSync, unlinkSync} from 'node:fs';
import {loadConfig} from './server.mjs';

function ipv4Number(ip) { return ip.split('.').reduce((n, part) => (n * 256 + Number(part)) >>> 0, 0); }
export function inCIDR(ip, cidr) {
  ip = ip?.replace(/^::ffff:/, '');
  const [network, rawPrefix] = String(cidr).split('/');
  const prefix = Number(rawPrefix);
  if (isIP(ip ?? '') !== 4 || isIP(network) !== 4 || rawPrefix === undefined || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipv4Number(ip) & mask) === (ipv4Number(network) & mask);
}
export const privateIPv4 = ip => ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'].some(c => inCIDR(ip, c));
const equalKey = (a, b) => { if (typeof a !== 'string' || typeof b !== 'string') return false; const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
function reply(res, status, body) {
  if (res.destroyed || res.writableEnded) return;
  if (res.headersSent) { res.destroy(); return; }
  res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'});
  res.end(JSON.stringify(body));
}
export function createLANGateway(config) {
  const server = http.createServer(async (req, res) => {
    try {
      if (!inCIDR(req.socket.remoteAddress, config.allowedCIDR)) { reply(res, 403, {error: {code: 'lan_only', message: '仅允许配置的家庭局域网访问'}}); return; }
      const port = server.address().port;
      if (req.headers.host !== `${config.address}:${port}` || req.headers.origin) { reply(res, 403, {error: {code: 'origin_or_host', message: '请通过手机酒馆后端访问此 API'}}); return; }
      const url = new URL(req.url, `http://${config.address}:${port}`);
      if (req.method === 'GET' && ['/', '/health'].includes(url.pathname)) {
        let upstream;
        try {
          const health = await fetch(`http://127.0.0.1:${config.upstreamPort}/health`, {signal: AbortSignal.timeout(2500)});
          if (health.ok) upstream = await health.json();
        } catch { }
        reply(res, 200, {service: 'local-pg-lan', baseURL: `http://${config.address}:${port}/v1`, requiresApiKey: true,
          backendOnline: upstream?.service === 'local-pg', executorOnline: upstream?.executorOnline === true}); return;
      }
      const allowedGet = req.method === 'GET' && ['/v1/models', '/v1beta/models'].includes(url.pathname);
      const allowedPost = req.method === 'POST' && (url.pathname === '/v1/chat/completions' || /^\/v1beta\/models\/[^/:]+:(?:generateContent|streamGenerateContent)$/.test(url.pathname));
      if (!allowedGet && !allowedPost) { reply(res, 404, {error: {code: 'not_found', message: '此局域网入口只提供生成 API'}}); return; }
      const key = req.headers.authorization?.replace(/^Bearer\s+/i, '') ?? req.headers['x-goog-api-key'];
      if (!equalKey(key, config.apiKey)) { reply(res, 401, {error: {code: 'unauthorized', message: '请填写电脑反代生成的 API Key'}}); return; }
      const chunks = []; let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 4 * 1024 * 1024) { reply(res, 413, {error: {code: 'body_too_large', message: '请求体超过 4 MiB'}}); return; }
        chunks.push(chunk);
      }
      // The upstream destination is fixed. Only the API route, body and current key are forwarded.
      const upstream = http.request({hostname: '127.0.0.1', port: config.upstreamPort, path: url.pathname + url.search, method: req.method,
        headers: {Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json', Accept: req.headers.accept ?? 'application/json', 'Content-Length': bytes}}, up => {
        res.writeHead(up.statusCode ?? 502, {'Content-Type': up.headers['content-type'] ?? 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Accel-Buffering': 'no'});
        up.on('error', () => res.destroy());
        up.pipe(res);
      });
      // The local relay owns generation-idle detection. In non-streaming mode it may
      // receive Google chunks for minutes without writing any HTTP response bytes.
      // Bound only the local TCP connection here; a second read timer would cut off
      // a healthy non-streaming generation while it is still making progress.
      upstream.setTimeout(0);
      const connectTimer = setTimeout(() => upstream.destroy(new Error('Backend connect timeout')), config.connectTimeoutMs ?? 5000);
      upstream.once('socket', socket => {
        if (socket.connecting) socket.once('connect', () => clearTimeout(connectTimer));
        else clearTimeout(connectTimer);
      });
      upstream.on('error', error => {
        clearTimeout(connectTimer);
        reply(res, 502, {error: {code: 'backend_unavailable', message: error.message === 'Backend connect timeout' ? '连接电脑本机反代超时' : '无法连接电脑本机反代，请先启动后端'}});
      });
      upstream.on('close', () => clearTimeout(connectTimer));
      res.on('close', () => { clearTimeout(connectTimer); upstream.destroy(); });
      upstream.end(Buffer.concat(chunks));
    } catch { reply(res, 400, {error: {code: 'bad_request', message: '无法读取请求'}}); }
  });
  server.requestTimeout = 200000;
  server.headersTimeout = 15000;
  return server;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const core = loadConfig();
  const lan = JSON.parse(readFileSync(new URL('./lan-config.json', import.meta.url), 'utf8').replace(/^\uFEFF/, ''));
  if (!privateIPv4(lan.address) || !inCIDR(lan.address, lan.allowedCIDR) || !Number.isInteger(lan.port) || lan.port < 1 || lan.port > 65535 || lan.port === core.port) throw Error('lan-config.json 中的局域网地址、网段或端口无效');
  const server = createLANGateway({...lan, upstreamPort: core.port, apiKey: core.apiKey});
  const pidFile = new URL('./lan-runtime.pid', import.meta.url);
  server.on('error', error => { console.error(`局域网入口启动失败: ${error.message}`); process.exitCode = 1; });
  server.listen(lan.port, lan.address, () => {
    writeFileSync(pidFile, String(process.pid));
    console.log(`手机酒馆 Base URL: http://${lan.address}:${lan.port}/v1\n允许网段: ${lan.allowedCIDR}\n${process.argv.includes('--background') ? 'API Key 使用电脑 config.json 中的密钥' : `API Key: ${core.apiKey}`}\n电脑 AI Studio 页面也需要保持运行。`);
  });
  process.on('exit', () => { try { if (readFileSync(pidFile, 'utf8') === String(process.pid)) unlinkSync(pidFile); } catch { } });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.closeAllConnections(); server.close(); });
}
