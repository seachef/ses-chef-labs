import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import {createHash} from 'node:crypto';
const sha=v=>createHash('sha256').update(v).digest('hex');
const read=p=>fs.readFile(new URL('../'+p,import.meta.url));
test('release source, native model and atomic migration hashes match the final shipped bytes',async()=>{
 const m=JSON.parse(await read('MANIFEST.json'));
 for(const [p,h] of Object.entries(m.files))assert.equal(sha(await read(p)),h,p);
 const sorted=Object.fromEntries(Object.entries(m.files).sort(([a],[b])=>a.localeCompare(b)));
 assert.equal(sha(JSON.stringify(sorted)),m.source_hash);
 assert.equal(sha(await read('ATOMIC-NATIVE-UPGRADE.sql')),m.upgrade_sha256);
 assert.equal(sha(await read('native-config.json')),m.native_model_hash);
 const economics=(await read('native-economics.sql')).toString(),config=JSON.parse(await read('native-config.json'));
 assert(economics.includes(m.native_model_hash));assert(economics.includes(config.version));
 assert.deepEqual(config.activation.native_entry_venues,['hyperliquid']);assert.deepEqual(config.activation.native_collection_venues,['hyperliquid','USDC']);
 const upgrade=(await read('ATOMIC-NATIVE-UPGRADE.sql')).toString();assert(upgrade.includes(`values(6,'${m.source_hash}'`));
 for(const p of ['native-economics.sql','native-ledger.sql','native-order-rules.sql','native-scanner-helpers.sql','native-public-projection.sql','native-collector.sql','transport-observation.sql','collector-integration.sql','native-audit.sql'])assert(upgrade.includes((await read(p)).toString()),p);
});
test('publication manifest covers and hashes every shipped backend source, fixture and test',async()=>{
 const root=new URL('../',import.meta.url),manifest=JSON.parse(await read('PUBLICATION-MANIFEST.json'));
 async function walk(url,prefix=''){const result=[];for(const entry of await fs.readdir(url,{withFileTypes:true})){if(entry.name==='node_modules'||entry.name==='PUBLICATION-MANIFEST.json')continue;const p=prefix+entry.name;if(entry.isDirectory())result.push(...await walk(new URL(entry.name+'/',url),p+'/'));else if(entry.isFile())result.push(p);}return result;}
 assert.deepEqual(Object.keys(manifest.files).sort(),(await walk(root)).sort());
 for(const [p,h] of Object.entries(manifest.files))assert.equal(sha(await read(p)),h,p);
});
