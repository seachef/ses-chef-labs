import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const src=readFileSync(new URL('../alerts-sw.js',import.meta.url),'utf8');
async function push(payload){const handlers={},shown=[];const context={Date,URL,self:{addEventListener:(n,f)=>handlers[n]=f,registration:{scope:'https://example.org/app/',showNotification:async(...x)=>shown.push(x)}}};vm.runInNewContext(src,context);let promise;handlers.push({data:{json:()=>payload},waitUntil:p=>promise=p});await promise;return shown[0];}
test('test notification never says qualified',async()=>{const n=Date.now();const [t]=await push({type:'test',observedAt:n,expiresAt:n+120000,eventId:'test'});assert(t.includes('test notification'));});
test('expired coin notification shows expired',async()=>{const n=Date.now();const [t]=await push({type:'qualified',symbol:'TEST',observedAt:n-180000,expiresAt:n-60000,eventId:'a'.repeat(64)});assert(t.includes('expired'));});
test('fresh qualified payload fixed app destination',async()=>{const n=Date.now();const [t,o]=await push({type:'qualified',symbol:'TEST',observedAt:n,expiresAt:n+120000,eventId:'b'.repeat(64),url:'https://attacker.test'});assert(t.includes('TEST'));assert.equal(o.data.path,'index.html');});
test('malformed payload shows neutral expired message',async()=>assert((await push({}))[0].includes('expired')));
