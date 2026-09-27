import { timingSafeEqual, ECDH } from 'node:crypto';
export function authorized(header, token) {
  if(typeof token!=='string'||token.length<32||typeof header!=='string') return false;
  const a=Buffer.from(header),b=Buffer.from('Bearer '+token);
  return a.length===b.length&&timingSafeEqual(a,b);
}
export function subscription(value) {
  if(!value||typeof value.endpoint!=='string'||value.endpoint.length>2048) throw Error('Invalid subscription');
  const u=new URL(value.endpoint);
  const known=u.hostname==='web.push.apple.com'||u.hostname==='fcm.googleapis.com'||u.hostname==='updates.push.services.mozilla.com';
  if(u.protocol!=='https:'||!known||u.port||u.username||u.password||u.hash||u.pathname==='/') throw Error('Unsupported push endpoint');
  const decode=(v,n)=>{if(typeof v!=='string'||!/^[A-Za-z0-9_-]+$/.test(v))throw Error('Invalid key');const b=Buffer.from(v,'base64url');if(b.length!==n||b.toString('base64url')!==v)throw Error('Invalid key');return b;};
  const key=decode(value.keys?.p256dh,65);decode(value.keys?.auth,16);
  ECDH.convertKey(key,'prime256v1',undefined,undefined,'uncompressed');
  return {endpoint:u.href,keys:{p256dh:value.keys.p256dh,auth:value.keys.auth}};
}
