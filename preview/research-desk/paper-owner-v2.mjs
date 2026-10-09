const ACCOUNT='neptune-paper-v2',TABLE='neptune_paper_v2_control',FIELDS='id,enabled,epoch,changed_at';
const integer=v=>Number.isSafeInteger(v)&&v>=0;
const time=v=>typeof v==='string'&&Number.isFinite(Date.parse(v));
const denied=e=>['401','403','42501','PGRST301','PGRST302'].includes(String(e?.status||e?.code));
export function validateControl(row){if(!row||row.id!==ACCOUNT||typeof row.enabled!=='boolean'||!integer(row.epoch)||!time(row.changed_at))throw Error('Invalid owner control');return {id:ACCOUNT,enabled:row.enabled,epoch:row.epoch,changed_at:row.changed_at};}
export function controlAcknowledgement(control,report,now=Date.now()){
 if(!control)return {applied:false,message:'Owner control state unavailable.'};
 const c=report?.control,at=c?.ack_at;
 if(!c||typeof c.requested_enabled!=='boolean'||!integer(c.requested_epoch)||!integer(c.ack_epoch)||typeof c.enabled!=='boolean'||!['applied','rejected_capacity'].includes(c.ack_status)||!time(at))return {applied:false,message:'Request saved; waiting for the server acknowledgement.'};
 if(c.requested_epoch!==control.epoch||c.ack_epoch!==control.epoch||c.requested_enabled!==control.enabled||Date.parse(at)<Date.parse(control.changed_at)||now-Date.parse(at)<0||!time(report?.heartbeat_at)||now-Date.parse(report.heartbeat_at)<0||now-Date.parse(report.heartbeat_at)>90000)return {applied:false,message:'Request saved; current matching server acknowledgement is not confirmed.'};
 if(c.ack_status==='rejected_capacity')return {applied:false,rejected:true,message:'Resume rejected: this paper campaign has reached capacity. No account reset occurred.'};
 if(c.enabled!==control.enabled)return {applied:false,message:'Request saved; actual engine state has not matched it yet.'};
 return {applied:true,message:c.enabled?'Resume acknowledged. Risk gates still apply; this does not confirm a trade.':'Stop acknowledged. Open positions are frozen; history and risk counters are preserved.'};
}
export function createOwnerControl({getClient,onChange=()=>{},now=()=>Date.now(),timeoutMs=12000}){
 let state={access:'unchecked',control:null,busy:false,message:'Owner controls have not been checked.',report:null},epoch=0;
 const emit=patch=>{state={...state,...patch};onChange({...state});};
 async function timed(promise){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('timeout')),timeoutMs);})]);}finally{clearTimeout(timer);}}
 async function authority(){
  const client=await timed(Promise.resolve().then(getClient));if(!client)return {access:'signed-out'};
  const auth=await timed(client.auth.getUser());if(auth.error||!auth.data?.user){if(auth.error&&!denied(auth.error)&&auth.error.name!=='AuthSessionMissingError')throw Error('unavailable');return {access:'signed-out'};}
  const result=await timed(client.from(TABLE).select(FIELDS).eq('id',ACCOUNT));
  if(result.error){if(denied(result.error))return {access:'denied'};throw Error('unavailable');}
  if(!Array.isArray(result.data)||result.data.length!==1)return {access:'denied'};
  return {access:'owner',control:validateControl(result.data[0]),client};
 }
 function invalidate(){epoch++;emit({access:'signed-out',control:null,busy:false,report:null,message:'Owner session ended. No controls are enabled.'});}
 function observe(report){state.report=report;if(state.access==='owner'&&state.control&&!state.busy)emit({message:controlAcknowledgement(state.control,report,now()).message});}
 async function refresh(){if(state.busy)return;const request=++epoch;emit({busy:true,message:'Checking owner access…'});try{const {client,...verified}=await authority();if(request!==epoch)return;emit({...verified,control:verified.control||null,message:verified.access==='owner'?controlAcknowledgement(verified.control,state.report,now()).message:verified.access==='signed-out'?'Sign in through the existing Portfolio page, then return to check owner access.':'This session does not have owner control access.'});}catch{if(request===epoch)emit({access:'unavailable',control:null,message:'Owner access is unavailable. No change was sent.'});}finally{if(request===epoch)emit({busy:false});}}
 async function requestEnabled(enabled){
  if(state.busy||state.access!=='owner'||typeof enabled!=='boolean')return;
  const request=++epoch;emit({busy:true,message:enabled?'Requesting Resume…':'Requesting Stop…'});
  try{
   const {client,...verified}=await authority();if(request!==epoch)return;
   if(verified.access!=='owner'){emit({...verified,control:null,message:'Owner access could not be verified. No change was sent.'});return;}
   // Recheck ownership and use an epoch lease. A stale tab cannot overwrite a newer request.
   const response=await timed(client.from(TABLE).update({enabled}).eq('id',ACCOUNT).eq('epoch',verified.control.epoch).select(FIELDS));
   if(request!==epoch)return;
   if(response.error||!Array.isArray(response.data)||response.data.length!==1){emit({access:denied(response.error)?'denied':'unavailable',control:null,message:'Change was not confirmed. A newer request or connection failure may exist; check owner state before retrying.'});return;}
   const control=validateControl(response.data[0]);if(control.enabled!==enabled||control.epoch!==verified.control.epoch+1)throw Error('Unconfirmed revision');
   emit({control,report:null,message:enabled?'Resume request saved. Waiting for a matching server acknowledgement.':'Stop request saved. Waiting for a matching server acknowledgement; exposure is not yet confirmed frozen.'});
  }catch{if(request===epoch)emit({access:'unavailable',control:null,message:'Request outcome is unknown. It may have reached the server; check owner state before retrying.'});}
  finally{if(request===epoch)emit({busy:false});}
 }
 return {refresh,requestEnabled,observe,invalidate,getState:()=>({...state})};
}
