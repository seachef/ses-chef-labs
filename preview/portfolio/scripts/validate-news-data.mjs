#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateNewsDesk, validateEntryWatch, newsFreshness } from '../portfolio/news-data.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const usage = 'Usage: node scripts/validate-news-data.mjs [--news path] [--watch path] [--previous path] [--now UTC_ISO]';
try {
  const args = process.argv.slice(2), options = {};
  if (args.length === 1 && args[0] === '--help') { console.log(usage); }
  else {
    for (let i = 0; i < args.length; i += 2) {
      const key = args[i];
      if (!['--news', '--watch', '--previous', '--now'].includes(key) || !args[i + 1] || args[i + 1].startsWith('--') || Object.hasOwn(options, key)) throw new Error(usage);
      options[key] = args[i + 1];
    }
    const now = options['--now'] === undefined ? Date.now() : Date.parse(options['--now']);
    if (options['--now'] !== undefined && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(options['--now'])
      || !Number.isFinite(now) || new Date(now).toISOString().slice(0, 19) !== options['--now'].slice(0, 19))) throw new Error('--now must be a real UTC ISO timestamp ending in Z');
    const read = async (option, fallback) => JSON.parse(await readFile(option ? resolve(option) : resolve(root, fallback), 'utf8'));
    const [newsValue, watchValue, previous] = await Promise.all([
      read(options['--news'], 'data/news-desk.json'),
      read(options['--watch'], 'data/entry-watch.json'),
      options['--previous'] ? read(options['--previous']) : undefined,
    ]);
    const news = validateNewsDesk(newsValue, { now });
    const watch = validateEntryWatch(watchValue, { now, previous });
    const status = newsFreshness(news, now).status;
    console.log(`News desk valid: ${news.items.length} news items, ${watch.records.length} entry-watch records; news checks ${status === 'never' ? 'not yet recorded' : status}.${previous ? ' Immutable previous prefix verified.' : ''}`);
  }
} catch (error) {
  console.error(`News desk validation failed: ${error.message}`);
  process.exitCode = 1;
}
