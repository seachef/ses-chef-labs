import test from 'node:test';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {randomBytes,createECDH} from 'node:crypto';import webpush from '../server/node_modules/web-push/src/index.js';
test('HTTP service origin/auth/subscription/delete and closed qualification endpoint',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'scl-http-')),keys=webpush.generateVAPIDKeys(),token=randomBytes(32).toString('hex');
 const child=spawn(process.execPath,[new URL('../server/server.mjs',import.meta.url).pathname],{env:{...process.env,PORT:'0',SCL_APP_ORIGIN:'https://example.org',SCL_PAIRING_TOKEN:token,SCL_VAPID_PUBLIC_KEY:keys.publicKey,SCL_VAPID_PRIVATE_KEY:keys.privateKey,SCL_VAPID_SUBJECT:'https://example.org',SCL_DATA_DIR:dir},stdio:['ignore','pipe','pipe']});
 try{const port=await new Promise((res,rej)=>{const t=setTimeout(()=>rej(Error('Startup timeout')),10000);child.stdout.on('data',d=>{const m=String(d).match(/READY_PORT=(\d+)/);if(m){clearTimeout(t);res(m[1]);}});child.once('exit',()=>{clearTimeout(t);rej(Error('Server exited'));});});
 const base='http://127.0.0.1:'+port,headers={Origin:'https://example.org',Authorization:'Bearer '+token,'Content-Type':'application/json'};
 assert.equal((await fetch(base+'/config')).status,403);
 assert.equal((await fetch(base+'/config',{headers:{Origin:'https://example.org'}})).status,401);
 assert.equal((await (await fetch(base+'/config',{headers})).json()).qualification,'NOT_CONNECTED');
 assert.equal((await fetch(base+'/qualify',{headers,method:'POST',body:'{}'})).status,404);
 const ec=createECDH('prime256v1');ec.generateKeys();const data={endpoint:'https://web.push.apple.com/synthetic-test-only',keys:{p256dh:ec.getPublicKey().toString('base64url'),auth:randomBytes(16).toString('base64url')}};
 const saved=await (await fetch(base+'/subscriptions',{headers,method:'POST',body:JSON.stringify(data)})).json();assert.match(saved.id,/^[a-f0-9]{64}$/);
 assert.equal((await (await fetch(base+'/config',{headers})).json()).devices,1);
 assert.equal((await fetch(base+'/subscriptions',{headers,method:'DELETE',body:JSON.stringify({id:saved.id})})).status,200);
 assert.equal((await (await fetch(base+'/config',{headers})).json()).devices,0);
 }finally{child.kill();await new Promise(r=>child.once('exit',r));rmSync(dir,{recursive:true});}
});
