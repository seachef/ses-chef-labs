import { createHash } from 'node:crypto';
import { evaluate } from './qualification.mjs';
export async function deliverQualified({report,episodeId,collectorConnected=false,store,send,now=Date.now()}) {
  // No public endpoint exposes this. No connected collector exists in this release.
  if(!collectorConnected)return {state:'BLOCKED',reason:'QUALIFIER_NOT_CONNECTED'};
  const q=evaluate(report,now);if(q.state!=='PASS')return q;
  if(typeof episodeId!=='string'||!/^sha256:[a-f0-9]{64}$/.test(episodeId))return {state:'BLOCKED',reason:'Stable qualification episode required'};
  const devices=store.devices();if(!devices.length)return {state:'WAIT',reason:'NO_DEVICE'};
  const event=createHash('sha256').update(q.assetId+':'+episodeId).digest('hex');
  let sent=0,unknown=0;
  for(const d of devices){const id=event+':'+d.id;if(!store.claim(id,now))continue;
    const message={type:'qualified',symbol:q.symbol,observedAt:now,expiresAt:now+120000,eventId:event};
    try{await send(d.subscription,message);store.finish(id,'ACCEPTED_BY_PUSH_SERVICE');sent++;}
    catch(e){if([404,410].includes(e.statusCode)){store.remove(d.id);store.finish(id,'SUBSCRIPTION_EXPIRED');}else{store.finish(id,'DELIVERY_UNKNOWN');unknown++;}}
  }
  // Unknown delivery is never retried automatically; an accepted push is not proof it was read.
  return {state:'PROCESSED',sent,unknown};
}
