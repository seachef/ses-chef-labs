// Push only: no fetch handler and no stale-price/page cache.
self.addEventListener('push',event=>{
 let p;try{p=event.data.json();}catch{p={};}
 const now=Date.now();
 const valid=p&&['test','qualified'].includes(p.type)&&Number.isSafeInteger(p.observedAt)&&Number.isSafeInteger(p.expiresAt)&&p.observedAt<=now+5000&&p.expiresAt>now&&p.expiresAt-p.observedAt<=120000&&/^[a-f0-9]{64}$|^test$/.test(p.eventId||'');
 const qualified=valid&&p.type==='qualified'&&/^[A-Z0-9][A-Z0-9._-]{0,19}$/.test(p.symbol||'');
 // Always show a visible notification for received push; delayed evidence must not look ready.
 const title=qualified?`${p.symbol} — setup checks passed`:valid&&p.type==='test'?'Sea Chef Labs — test notification':'Sea Chef Labs — update expired';
 const body=qualified?'Tap to refresh and review. Conditions can change.':valid&&p.type==='test'?'Phone delivery test only. No coin qualified.':'Open the app for current information.';
 event.waitUntil(self.registration.showNotification(title,{body,tag:valid?p.eventId:'scl-expired',data:{path:'index.html'},renotify:false}));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 const url=new URL('index.html',self.registration.scope).href;
 event.waitUntil((async()=>{const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});for(const w of windows){if(w.url.startsWith(self.registration.scope)){await w.navigate(url);return w.focus();}}return self.clients.openWindow(url);})());
});
