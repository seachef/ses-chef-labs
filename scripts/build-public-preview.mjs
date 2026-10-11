import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const destination = path.resolve(process.argv[2] ?? path.join(root, 'dist'));
if (destination === root || root.startsWith(destination + path.sep)) throw new Error('Build destination must not contain source');
const files = ['style.css', 'ui.mjs', 'public-preview.mjs', 'src/market/coinbase.mjs', 'src/market/public-view.mjs', 'src/market/public-session.mjs'];
// Reject an unexpected destination instead of deleting unrelated files.
if (fs.existsSync(destination) && fs.readdirSync(destination).length && !fs.existsSync(path.join(destination, 'build-manifest.json'))) throw new Error('Nonempty destination is not a prior preview build');
fs.mkdirSync(destination, { recursive: true });
const expected = ['index.html', ...files, 'build-manifest.json'];
function inspect(dir) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isSymbolicLink()) throw new Error('No symlinks in preview output');
    if (item.isDirectory()) inspect(full);
    else if (!expected.includes(path.relative(destination, full).split(path.sep).join('/'))) throw new Error(`Unexpected output file: ${item.name}`);
  }
}
inspect(destination);
for (const file of files) {
  const target = path.join(destination, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(root, file), target);
}
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
  .replace('./loopback.mjs', './public-preview.mjs')
  .replace('NEPTUNE 2.0 — simulated trading', 'NEPTUNE 2.0 — public data preview')
  .replace('SIMULATED · STATE UNAVAILABLE', 'PUBLIC DATA · READ-ONLY BROWSER PREVIEW')
  .replace('No worker or market connection confirmed.', 'Initial integration markets: BTC-USD and ETH-USD. No final coverage or picks. No execution or background service.')
  .replace('id="stop" type="button"', 'id="stop" type="button" disabled')
  .replace('>Refresh state</button>', '>Refresh public data</button><button id="cancel" type="button" disabled>Cancel data request</button>')
  .replace('Local foreground service only. Unattended operation is not deployed.', 'Browser-only public data; no autonomous worker. One snapshot on opening, then manual refresh at most once per minute.')
  .replace('>Worker</dt>', '>Observation</dt>')
  .replace('>Last cycle</dt>', '>Last attempt</dt>')
  .replace('aria-label="Local request activity"', 'aria-label="Public request activity"')
  .replace('Waiting for local state.', 'Waiting for a public-data observation.')
  .replace('SIMULATED ONLY · No wallets or exchange orders. Public data is read-only. Fixture results are not trading performance.', 'PUBLIC OBSERVATIONS ONLY · No orders, wallets, account or background service. Prices are not simulated fills.')
  .replace('JavaScript is disabled. All state is UNKNOWN; emergency stop cannot be sent from this page.', 'JavaScript is disabled. Public observations are unavailable; no engine or account is connected.');
fs.writeFileSync(path.join(destination, 'index.html'), html);
let sourceCommit = process.env.VERCEL_GIT_COMMIT_SHA ?? null, sourceDirty = null;
try {
  sourceCommit ??= execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  sourceDirty = !!execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim();
} catch { /* Exported sources do not pretend to have a verified Git revision. */ }
const manifest = { schemaVersion: 1, sourceCommit, sourceDirty, purpose: 'Connected browser-only read-only public observations; no backend or execution',
  initialIntegrationMarkets: ['BTC-USD', 'ETH-USD'], minimumManualRefreshMs: 60000, freshnessMs: 10000,
  assets: Object.fromEntries(['index.html', ...files].map(file => {
    const body = fs.readFileSync(path.join(destination, file));
    return [file, { bytes: body.length, sha256: createHash('sha256').update(body).digest('hex') }];
  })) };
fs.writeFileSync(path.join(destination, 'build-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ destination, ...manifest }, null, 2));
