import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import { createServer } from '../src/server.mjs';
import { openStore } from '../src/store.mjs';

const root = new URL('../', import.meta.url);
const read = file => fs.readFileSync(new URL(file, root), 'utf8');
const canonical = 'https://ses-chef-labs-git-neptune-2-clean-start-seachef.vercel.app/';

test('Pages repository root redirects without scripts or origin-root API requests', () => {
  const html = read('index.html');
  assert.ok(html.includes(`http-equiv="refresh" content="0; url=${canonical}"`));
  assert.ok(html.includes(`rel="canonical" href="${canonical}"`));
  assert.ok(html.includes(`<a href="${canonical}">`));
  assert.doesNotMatch(html, /<script|\/api\/|loopback|public-preview|research-setups/i);
  assert.equal(new URL(canonical, 'https://seachef.github.io/ses-chef-labs/').href, canonical);
});

test('local root retains CSP-compatible operator assets, state and durable stop', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neptune-hosting-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = openStore(dir), server = createServer(store);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const route of ['/', '/index.html']) {
    const res = await fetch(base + route);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
    const html = await res.text();
    assert.equal(html, read('operator.html'));
    assert.doesNotMatch(html, /http-equiv="refresh"|<script(?![^>]*\bsrc=)/);
    for (const [, asset] of html.matchAll(/(?:src|href)="(\.\/[^\"]+)"/g)) {
      assert.equal((await fetch(new URL(asset, base))).status, 200);
    }
  }
  assert.equal((await fetch(base + '/api/state')).status, 200);
  const stopped = await fetch(base + '/api/stop', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: '{}' });
  assert.equal(stopped.status, 200);
  assert.equal((await stopped.json()).stopPersisted, true);
  assert.equal(openStore(dir).read().control.stopped, true);
  assert.equal((await fetch(base + '/api/stop', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://example.com' }, body: '{}' })).status, 403);
});

test('static local layout builder still renders the operator document', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neptune-layout-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'preview.html');
  execFileSync(process.execPath, ['scripts/build-preview.mjs', file], { cwd: root });
  const html = fs.readFileSync(file, 'utf8');
  assert.equal((html.match(/<section\b/g) ?? []).length, 5);
  assert.match(html, /STATIC LAYOUT PREVIEW/);
  assert.doesNotMatch(html, /http-equiv="refresh"|<script/);
});

test('Vercel public build keeps inherited security headers', () => {
  const config = JSON.parse(read('vercel.json'));
  assert.equal(config.buildCommand, 'node scripts/build-public-preview.mjs');
  assert.equal(config.outputDirectory, 'dist');
  const headers = Object.fromEntries(config.headers.find(x => x.source === '/(.*)').headers.map(h => [h.key, h.value]));
  assert.deepEqual(headers, {
    'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload'
  });
});
