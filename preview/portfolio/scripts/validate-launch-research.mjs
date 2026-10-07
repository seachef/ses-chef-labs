#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateLaunchResearch, validateLaunchLedger, researchFreshness } from '../portfolio/launch-research-data.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
try {
  const args = process.argv.slice(2);
  if (args.length > 2) throw new Error('Usage: node scripts/validate-launch-research.mjs [research-file] [ledger-file]');
  const researchPath = args[0] ? resolve(args[0]) : resolve(root, 'data/launch-research.json');
  const ledgerPath = args[1] ? resolve(args[1]) : resolve(root, 'data/launch-research-ledger.json');
  const now = Date.now();
  const research = validateLaunchResearch(JSON.parse(await readFile(researchPath, 'utf8')), { now });
  const ledger = validateLaunchLedger(JSON.parse(await readFile(ledgerPath, 'utf8')), { now });
  console.log(`Launch research valid: ${research.candidates.length} candidates, ${ledger.entries.length} revisions, ${researchFreshness(research, now)}.`);
} catch (error) {
  console.error(`Launch research validation failed: ${error.message}`);
  process.exitCode = 1;
}
