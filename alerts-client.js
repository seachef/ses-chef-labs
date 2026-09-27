'use strict';
const el=id=>document.getElementById(id);let server,registration,config,token='',deviceId;
const status=text=>{el('status').textContent=text;};
async function api(path,method='GET',body){const r=await fetch(server+path,{method,cache:'no-store',credentials:'omit',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});const data=await r.json();if(!r.ok)throw Error(data.error||'Notification server unavailable');return data;}
(async()=>{try{
 const c=await fetch('alerts-config.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error();return r.json()});
 if(!c.server){status('Server not connected yet. No alerts are running.');return;}
 const u=new URL(c.server);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw Error();server=u.origin;
 if(!window.isSecureContext||!('serviceWorker'in navigator)||!('PushManager'in window))throw Error('This browser does not support notifications here.');
 if(/iPhone|iPad|iPod/.test(navigator.userAgent)&&!navigator.standalone&&!matchMedia('(display-mode: standalone)').matches)throw Error('Add Sea Chef Labs to your Home Screen, then open it there.');
 registration=await navigator.serviceWorker.register('./alerts-sw.js',{scope:'./'});await navigator.serviceWorker.ready;
 el('prepare').disabled=false;status('Enter your notification pairing code to connect.');
}catch(e){status(e.message||'Notification setup unavailable.');}})();
el('prepare').onclick=async()=>{token=el('pair').value.trim();el('pair').value='';el('prepare').disabled=true;try{config=await api('/config');if(typeof config.publicKey!=='string'||!/^[A-Za-z0-9_-]{87}$/.test(config.publicKey))throw Error('Invalid server setup');el('enable').disabled=false;el('disable').disabled=false;status('Server connected. Coin qualification is not active. Enable notifications for a delivery test.');}catch(e){token='';status(e.message);}finally{el('prepare').disabled=false;}};
function bytes(v){return Uint8Array.from(atob(v.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(v.length/4)*4,'=')),x=>x.charCodeAt(0));}
el('enable').onclick=async()=>{el('enable').disabled=true;try{
 // Subscribe is called directly during the tap, using configuration loaded beforehand.
 const subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes(config.publicKey)});
 const saved=await api('/subscriptions','POST',subscription.toJSON());deviceId=saved.id;el('test').disabled=false;el('disable').disabled=false;status('Phone registered. Tap Send me a test. Qualified-coin alerts remain off.');
}catch(e){status(e.message||'Permission was not granted.');}finally{el('enable').disabled=false;}};
el('test').onclick=async()=>{el('test').disabled=true;try{const r=await api('/test','POST',{id:deviceId});status(r.status);}catch(e){status(e.message);}finally{el('test').disabled=false;}};
el('disable').onclick=async()=>{try{const sub=await registration.pushManager.getSubscription();if(sub&&!(await sub.unsubscribe()))throw Error('Could not switch off; use iPhone notification settings.');if(deviceId)await api('/subscriptions','DELETE',{id:deviceId});deviceId=null;el('test').disabled=true;status('Phone subscription switched off.');}catch(e){status(e.message);}};
