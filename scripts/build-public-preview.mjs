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
const html = fs.readFileSync(path.join(root, 'public.html'), 'utf8');
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
