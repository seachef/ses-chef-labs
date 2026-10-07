#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateEntrySetups, evaluateEntrySetup } from '../portfolio/entry-setups.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
try {
  const args = process.argv.slice(2);
  if (args.length > 1) throw new Error('Usage: node scripts/validate-entry-setups.mjs [setups-file]');
  const path = args[0] ? resolve(args[0]) : resolve(root, 'data/entry-setups.json');
  const now = Date.now();
  const data = validateEntrySetups(JSON.parse(await readFile(path, 'utf8')), { now });
  const reviewCount = data.setups.filter(setup => evaluateEntrySetup(setup, now).status === 'review').length;
  console.log(`Entry setups valid: ${data.setups.length} setups, ${reviewCount} available for review. No order execution.`);
} catch (error) {
  console.error(`Entry setups validation failed: ${error.message}`);
  process.exitCode = 1;
}
