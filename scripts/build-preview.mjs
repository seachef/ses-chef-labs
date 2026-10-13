// Standalone visual handoff from the same production HTML/CSS, with no data or worker.
import * as fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const destination = path.resolve(process.argv[2] ?? path.join(root, '.neptune-local', 'preview.html'));
const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'operator.html'), 'utf8')
  .replace('<link rel="stylesheet" href="./style.css">', `<style>\n${css}\n</style>`)
  .replace('<script type="module" src="./loopback.mjs"></script>', '')
  .replace('<p id="mode">SIMULATED · STATE UNAVAILABLE</p>', '<p id="mode">SIMULATED · STATIC LAYOUT PREVIEW</p>')
  .replace('No worker or market connection confirmed.', 'Standalone preview. No worker, account or market connection. Open the local server for state and controls.')
  .replaceAll('type="button"', 'type="button" disabled')
  .replace('Waiting for local state.', 'STATIC PREVIEW · controls unavailable; no state connection.');
fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.writeFileSync(destination, html);
console.log(destination);
