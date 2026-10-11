import http from 'node:http';
import * as fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toView } from './view.mjs';

const publicRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assets = new Map([['/', ['index.html', 'text/html']], ['/index.html', ['index.html', 'text/html']],
  ['/ui.mjs', ['ui.mjs', 'text/javascript']], ['/style.css', ['style.css', 'text/css']]]);

export function pauseEntries(store, reason = 'Operator emergency entry pause') {
  return store.dispatch({ type: 'stop', reason, wallTime: Date.now() });
}

export function createServer(store) {
  return http.createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'");
    const reply = (status, value) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(value)); };
    try {
      const host = request.headers.host;
      if (!/^127\.0\.0\.1:\d+$/.test(host ?? '') && !/^localhost:\d+$/.test(host ?? '')) return reply(403, { error: 'Loopback host required' });
      const url = new URL(request.url, `http://${host}`);
      if (request.method === 'GET' && url.pathname === '/api/state') return reply(200, toView(store.read()));
      if (request.method === 'POST' && url.pathname === '/api/stop') {
        if (request.headers.origin && request.headers.origin !== `http://${host}`) return reply(403, { error: 'Same origin required' });
        if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] ?? '')) return reply(415, { error: 'JSON required' });
        let body = '';
        for await (const chunk of request) { body += chunk; if (body.length > 1024) return reply(413, { error: 'Body too large' }); }
        if (body && JSON.stringify(JSON.parse(body)) !== '{}') return reply(400, { error: 'No trade or configuration input accepted' });
        const document = pauseEntries(store);
        return reply(200, { ...toView(document), stopPersisted: true });
      }
      if (request.method === 'GET' && assets.has(url.pathname)) {
        const [filename, contentType] = assets.get(url.pathname);
        response.writeHead(200, { 'Content-Type': `${contentType}; charset=utf-8` });
        return response.end(fs.readFileSync(path.join(publicRoot, filename)));
      }
      reply(404, { error: 'Not found' });
    } catch (error) {
      reply(503, { error: `Unavailable; no successful stop acknowledgement: ${error.message}` });
    }
  });
}
