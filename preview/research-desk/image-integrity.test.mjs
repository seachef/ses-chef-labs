import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';

// This is a pinned, independently decoded JPEG, not a generic image decoder.
// A textual/base64 warning, truncation, or unreviewed replacement must fail CI.
const approved={name:'neptune-scene.jpg',bytes:818168,sha256:'526f7117ac8926d0643f4aeb01a9da324ee18a6c71fbef88ae4762e7706cd713'};
const html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8');
function verifyApprovedImage(bytes){
 assert.equal(bytes.length,approved.bytes);
 assert.deepEqual([...bytes.subarray(0,2)],[0xff,0xd8]);
 assert.deepEqual([...bytes.subarray(-2)],[0xff,0xd9]);
 assert.equal(createHash('sha256').update(bytes).digest('hex'),approved.sha256);
}
test('active scene points to the exact decoded approved binary image',()=>{
 const src=html.match(/<img\b[^>]*\bid="art"[^>]*\bsrc="([^"]+)"/)?.[1];
 assert.equal(src,'./'+approved.name);
 verifyApprovedImage(fs.readFileSync(new URL(src,import.meta.url)));
});
test('image integrity rejects truncation, encoded text and byte corruption',()=>{
 const bytes=fs.readFileSync(new URL('./'+approved.name,import.meta.url));
 const corrupted=Buffer.from(bytes);corrupted[100]^=1;
 for(const bad of [bytes.subarray(0,-1),Buffer.from('Warning: truncated output '+bytes.toString('base64')),corrupted])assert.throws(()=>verifyApprovedImage(bad));
});
test('About has an accessible name and event scrolling is keyboard reachable',()=>{
 assert.match(html,/<dialog id="aboutDialog" aria-labelledby="aboutTitle">/);
 assert.match(html,/<h2 id="aboutTitle">NEPTUNE<\/h2>/);
 assert.match(html,/<div class="pane-scroll" tabindex="0" role="region" aria-label="Paper event stream"><p id="scanState">/);
});
