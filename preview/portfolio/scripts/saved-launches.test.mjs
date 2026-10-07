import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {savedLaunchMarkup} from '../portfolio/saved-launches.mjs';
import {validateLaunchResearch,validateLaunchLedger} from '../portfolio/launch-research-data.mjs';

// Synthetic, fixed-time renderer evidence. Daily public data is validated separately.
const now=Date.parse('2026-10-07T13:00:00Z');
const source='https://example.com/synthetic-launch';
const current={schema_version:1,checked_at:'2026-10-07T12:00:00Z',candidates:[{
 id:'synthetic-launch',name:'Synthetic project',symbol:'SYN',status:'watch',
 summary:'Synthetic research fixture. No public sale is confirmed.',
 risks:['Synthetic uncertainty for a renderer test.'],official_url:source,
 launch:{date:null,time_utc:null,source_url:source},venues:[],
 sources:[{label:'Synthetic primary source',url:source,checked_at:'2026-10-07T12:00:00Z'}],
 australia_eligibility:'unverified'
}]};
const ledger={schema_version:1,entries:[{candidate_id:'synthetic-launch',checked_at:'2026-10-07T12:00:00Z',event:'added',fingerprint:'a'.repeat(64),note:'Original saved research note.'}]};

test('saved launch history survives the large panel removal with truthful dates',()=>{
 const html=savedLaunchMarkup(current,ledger,now);
 assert.match(html,/Launch date unconfirmed/);assert.match(html,/Original saved research note/);
 assert.doesNotMatch(html,/<article|Buy now/);
 const page=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.doesNotMatch(page,/id="launches"|src="portfolio\/launch-research.mjs/);assert.match(page,/Saved launch leads/);
});
test('saved revisions cannot introduce markup or private fields',()=>{
 const bad=structuredClone(ledger);bad.entries[0].note='<img onerror=alert(1)>';
 assert.throws(()=>savedLaunchMarkup(current,bad,now),/plain text/);
 bad.entries[0].note='Plain note';bad.entries[0].wallet='private';
 assert.throws(()=>savedLaunchMarkup(current,bad,now),/unknown property/);
});
test('fixed-time tests retain future-date rejection instead of weakening validation',()=>{
 const future=structuredClone(current);future.checked_at='2026-10-07T21:25:00Z';
 assert.throws(()=>savedLaunchMarkup(future,ledger,now),/future/);
 assert.doesNotThrow(()=>savedLaunchMarkup(future,ledger,Date.parse('2026-10-07T21:30:00Z')));
});
test('mutable published launch data validates against the current clock without fixed candidate assumptions',()=>{
 const live=JSON.parse(fs.readFileSync(new URL('../data/launch-research.json',import.meta.url)));
 const history=JSON.parse(fs.readFileSync(new URL('../data/launch-research-ledger.json',import.meta.url)));
 validateLaunchResearch(live);validateLaunchLedger(history);
});
