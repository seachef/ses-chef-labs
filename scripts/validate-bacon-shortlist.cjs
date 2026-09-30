const fs=require('node:fs'),assert=require('node:assert/strict');
const {validDocument}=require('../bacon-shortlist.js');
const shortlist=JSON.parse(fs.readFileSync('data/bacon-shortlist.json','utf8'));
const ledger=JSON.parse(fs.readFileSync('data/bacon-research-log.json','utf8'));
assert.ok(validDocument(shortlist),'Invalid paper shortlist schema/levels');
assert.equal(ledger.schema,1);assert.ok(Array.isArray(ledger.records));assert.ok(Array.isArray(ledger.runs));
assert.equal(new Set(ledger.records.map(r=>r.id)).size,ledger.records.length,'Duplicate ledger IDs');
for(const r of ledger.records){assert.ok(r.id&&r.canonicalUrl?.startsWith('https://')&&r.contentHash&&r.revision>=1&&Array.isArray(r.revisions));}
console.log('Paper shortlist and dated record valid');
