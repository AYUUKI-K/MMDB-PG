// MMDB-specific SillyTavern compatibility helper. No prompts or credentials.
import {pipeline} from 'node:stream/promises';

export function isMMDBJSONResponse(upstream, body) {
  return upstream.ok && body.stream !== true && typeof body.model === 'string'
    && body.model.startsWith('pg-')
    && upstream.headers.get('x-mmdb-response') === 'json-whitespace-v1'
    && /^application\/json(?:;|$)/i.test(upstream.headers.get('content-type') ?? '');
}

export async function forwardMMDBJSON(upstream, response, signal) {
  response.statusCode = upstream.status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store, no-transform');
  response.setHeader('X-Accel-Buffering', 'no');
  // Forward the whitespace as it arrives, then the single final JSON object.
  // pipeline handles backpressure and destroys both sides on a broken stream.
  // It never marks a truncated JSON object as a completed generation.
  await pipeline(upstream.body, response, {signal});
}
