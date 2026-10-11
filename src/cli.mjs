import * as fs from 'node:fs';
import path from 'node:path';
import { hostname } from 'node:os';
import { fileURLToPath } from 'node:url';
import { setImmediate } from 'node:timers/promises';
import { openStore, recoverInterruptedLock } from './store.mjs';
import { fetchObservation, SUPPORTED_PRODUCTS } from './market/coinbase.mjs';
import { createServer, pauseEntries } from './server.mjs';

export async function replay({ store, input, armFixture = false, config = null, initialCash = null }) {
  if (!Array.isArray(input) || !input.length || input.length > 10000) throw new Error('Expected 1–10000 synthetic snapshots');
  for (const snapshot of input) {
    if (snapshot.provenance !== 'synthetic' || snapshot.source !== 'synthetic-fixture') throw new Error('REPLAY_BLOCKED: only explicit synthetic fixture data accepted');
    if (!Number.isSafeInteger(snapshot.observedAt)) throw new Error('REPLAY_BLOCKED: invalid fixture clock');
  }
  store.dispatch({ type: 'initialize-fixture', now: input[0].observedAt, armed: armFixture, initialCash, config,
    wallTime: Date.now(), pid: process.pid, host: hostname() });
  try {
    for (const snapshot of input) {
      store.dispatch({ type: 'snapshot', snapshot, now: snapshot.observedAt, wallTime: Date.now() });
      await setImmediate(); // Allow an independent operator process to pause between committed events.
    }
    return store.dispatch({ type: 'worker-status', status: 'completed', wallTime: Date.now() });
  } catch (error) {
    try { store.dispatch({ type: 'worker-status', status: 'failed', error: error.message, wallTime: Date.now() }); }
    catch { /* The original storage/engine failure is returned; never reset state. */ }
    throw error;
  }
}

export async function observe({ store, observer = fetchObservation }) {
  const initial = store.read();
  if (initial.engine) throw new Error('Separate data directory required for read-only observation');
  const results = [];
  const errors = [];
  // Deliberately sequential and finite: no rate-spiking retries or permanent worker.
  for (const productId of SUPPORTED_PRODUCTS) {
    try { results.push(await observer({ productId })); }
    catch (error) { errors.push(`${productId}: ${error.message}`); }
  }
  return store.dispatch({ type: 'observe', observations: results, errors, wallTime: Date.now() });
}

function argumentsFrom(argv) {
  const [command = 'help', ...args] = argv;
  const options = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--arm-fixture') { options.armFixture = true; continue; }
    if (!['--data', '--input', '--port'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Unknown or incomplete option: ${args[i]}`);
    options[args[i].slice(2)] = args[++i];
  }
  return { command, options };
}

async function main() {
  const { command, options } = argumentsFrom(process.argv.slice(2));
  if (command === 'help') {
    console.log('NEPTUNE 2 local slice\nserve [--data DIR] [--port 8787]\nreplay --input FILE --data DIR --arm-fixture (first initialization only)\nobserve --data DIR (read-only public data; never paper fills)\nstop --data DIR (persistent entry pause)\nresume-fixture --data DIR (explicit fixture-only resume)\njournal-audit --data DIR (replay and verify all committed command evidence)\nmigrate-state --data DIR (explicit version-1 preservation; historical input gap stays labelled)\nrecover-lock --data DIR (dead same-host writer only; retains lock evidence)');
    return;
  }
  if (!['serve', 'replay', 'observe', 'stop', 'resume-fixture', 'recover-lock', 'journal-audit', 'migrate-state'].includes(command)) throw new Error(`Unknown command: ${command}`);
  const directory = path.resolve(options.data ?? '.neptune-local');
  const store = openStore(directory);
  if (command === 'serve') {
    const port = Number(options.port ?? 8787);
    if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('Port must be 1–65535');
    store.read();
    const server = createServer(store);
    server.on('error', error => { console.error(error.message); process.exitCode = 1; });
    server.listen(port, '127.0.0.1', () => console.log(`Preview http://127.0.0.1:${port} · data ${directory} · no trading loop installed`));
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
    return;
  }
  if (command === 'recover-lock') { console.log(JSON.stringify(recoverInterruptedLock(directory))); return; }
  if (command === 'journal-audit') {
    const audit = store.auditJournal(); console.log(JSON.stringify(audit, null, 2));
    if (!audit.ok) process.exitCode = 1;
    return;
  }
  if (command === 'migrate-state') { const migrated = store.migrateLegacy(); console.log(JSON.stringify({ version: migrated.version, revision: migrated.revision, history: migrated.history, journal: migrated.journal }, null, 2)); return; }
  let result;
  if (command === 'replay') {
    if (!options.input) throw new Error('--input is required');
    if (fs.statSync(options.input).size > 5_000_000) throw new Error('Fixture exceeds 5 MB limit');
    const fixture = JSON.parse(fs.readFileSync(options.input, 'utf8'));
    result = await replay({ store, input: Array.isArray(fixture) ? fixture : fixture.snapshots, armFixture: !!options.armFixture });
  } else if (command === 'observe') result = await observe({ store });
  else if (command === 'stop') result = pauseEntries(store);
  else result = store.dispatch({ type: 'resume-fixture', wallTime: Date.now() });
  console.log(JSON.stringify({ mode: result.mode, revision: result.revision, worker: result.worker, stopped: result.control.stopped,
    ledgerEvents: result.engine?.totalFillCount ?? result.engine?.ledger.length ?? 0, activeLedgerEvents: result.engine?.ledger.length ?? 0, journal: result.journal, errors: result.errors }, null, 2));
  if (result.errors.length) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
