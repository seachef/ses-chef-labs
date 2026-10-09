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

test('all generated scene assets retain complete reviewed PNG bytes and inflate correctly',async()=>{
 const {inflateSync}=await import('node:zlib');
 const assets={'neptune-run-atlas.png':'d31603023937fbb3b3bf0f2860bb19b90f16cfd6a290754ef8d87c8eb31ea9e5','neptune-braced-aim.png':'fe8227db951a9fc70881851afe9c49db588a40374726b99cf885bc2ccc5e40b2','neptune-tucked-roll.png':'942384e70fff33e8c2ab20a04d17693689cfc9f739e614e6a7c48e8b76a13c13','neptune-transition-atlas.png':'569930f17db4ed9af461f34c288019fea523230aed436c0e25903aca3b99aee7','cosmos-ocean-background.png':'501be0eb268efd9924d8ac13f57ccb8480b92605933ba69bc62ae047eb183cae','cosmos-ocean-phone.png':'5b37db5e7524c77f0363178db3b4f34cc28517919a3accbdd9a13d62640db01a','neptune-body-clean.png':'9aae33e7a960f272c4769d2466d4c6fc95e7a22d35796f8cf859296a88fa1691','neptune-head-clean.png':'84166f43f42410676f26d4e65c0a36ffd6629de65243327fc923635763d8e554'};
 for(const [name,hash]of Object.entries(assets)){
  const bytes=fs.readFileSync(new URL('./assets/'+name,import.meta.url));assert.equal(createHash('sha256').update(bytes).digest('hex'),hash);assert.deepEqual([...bytes.subarray(0,8)],[137,80,78,71,13,10,26,10]);
  let offset=8,width,height,channels,ended=false;const compressed=[];
  while(offset<bytes.length){const length=bytes.readUInt32BE(offset),kind=bytes.toString('ascii',offset+4,offset+8),data=bytes.subarray(offset+8,offset+8+length);assert.ok(offset+length+12<=bytes.length);if(kind==='IHDR'){width=data.readUInt32BE(0);height=data.readUInt32BE(4);assert.equal(data[8],8);channels=data[9]===2?3:data[9]===6?4:0;assert.ok(channels);assert.equal(data[12],0);}if(kind==='IDAT')compressed.push(data);offset+=length+12;if(kind==='IEND'){ended=true;break;}}
  assert.ok(ended);assert.equal(offset,bytes.length);assert.equal(inflateSync(Buffer.concat(compressed),{maxOutputLength:10000000}).length,(width*channels+1)*height);
 }
});
test('pixel-equivalent opaque WebP backgrounds retain exact reviewed lossless binaries',()=>{for(const[name,hash,w,h]of[['cosmos-ocean-background.webp','6cbfc1991b88f2bb6678c5ecbc81276a082c145f48f2120a2b32682c9b4caaf9',1672,941],['cosmos-ocean-phone.webp','eff69b35d50aa7cb2415b01d9dbe1b80c136005d2683e1cf80ebf19052748bb2',1024,1536]]){const b=fs.readFileSync(new URL('./assets/'+name,import.meta.url));assert.equal(createHash('sha256').update(b).digest('hex'),hash);assert.equal(b.toString('ascii',0,4),'RIFF');assert.equal(b.readUInt32LE(4)+8,b.length);assert.equal(b.toString('ascii',8,16),'WEBPVP8L');assert.equal(b[20],47);const bits=b.readUInt32LE(21);assert.equal(1+(bits&16383),w);assert.equal(1+((bits>>>14)&16383),h);}});
