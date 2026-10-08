// Only the existing authenticated Supabase client may change the server PAPER runner.
// Authorization is enforced by paper_control owner RLS, never by a public user ID.
export function createPaperControl({getClient,onChange=()=>{},now=()=>Date.now(),timeoutMs=12000}={}){
  let busy=false,epoch=0,state={access:'checking',control:null,payload:null,busy:false,message:'Checking server paper runner…'};
  const emit=patch=>{state={...state,...patch};onChange({...state});};
  const timed=async promise=>{let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('timeout')),timeoutMs);})]);}finally{clearTimeout(timer);}};
  const denied=error=>['401','403','42501','PGRST301','PGRST302'].includes(String(error?.status||error?.code));
  async function authority(){
    const client=await getClient();if(!client)return {access:'signed-out',control:null,payload:null};
    const auth=await timed(client.auth.getUser());
    if(auth.error||!auth.data?.user){if(auth.error&&!denied(auth.error)&&auth.error.name!=='AuthSessionMissingError')throw Error('auth');return {access:'signed-out',control:null,payload:null};}
    const result=await timed(client.from('paper_control').select('id,enabled,capacity_paused,capacity_reason').eq('id',1));
    if(result.error){if(denied(result.error))return {access:'denied',control:null,payload:null};throw Error('control');}
    const control=result.data?.length===1&&result.data[0].id===1&&typeof result.data[0].enabled==='boolean'?result.data[0]:null;
    if(!control)return {access:'denied',control:null,payload:null};
    return {access:'owner',control,payload:null,client};
  }
  async function publicStatus(client){
    try{const result=await timed(client.from('paper_public_status').select('id,payload').order('id',{ascending:true}));const rows=result.data;if(!result.error&&Array.isArray(rows)&&rows.length===4&&rows.every((r,i)=>r.id===i+1&&r.payload?.mode==='PAPER'&&typeof r.payload.enabled==='boolean'&&typeof r.payload.risk_paused==='boolean'))return rows.map(r=>r.payload);}catch{}
    return null;
  }
  function invalidate(){++epoch;busy=false;emit({access:'signed-out',control:null,payload:null,busy:false,message:'Sign in with your existing GitHub owner account to control the server paper runner.'});}
  async function refresh(){
    if(busy)return;busy=true;const id=++epoch;emit({busy:true});
    try{const {client,...result}=await authority();if(id!==epoch)return;emit({...result,message:result.access==='owner'?'':result.access==='signed-out'?'Sign in with your existing GitHub owner account to control the server paper runner.':'This account does not have owner access to the paper runner.'});
      // Public feed availability must never block an authenticated Stop.
      busy=false;emit({busy:false});if(client&&result.access==='owner'){const payload=await publicStatus(client);if(id===epoch)emit({payload});}}
    catch{if(id===epoch)emit({access:'unavailable',control:null,payload:null,message:'Could not verify owner access or server state. Check connection and try again.'});}
    finally{if(id===epoch){busy=false;emit({busy:false});}}
  }
  async function setEnabled(enabled){
    if(busy||state.access!=='owner'||typeof enabled!=='boolean'||enabled&&!canResumePaper(state,now()))return;
    busy=true;const id=++epoch;emit({busy:true,message:enabled?'Saving Resume on the server…':'Saving Stop on the server…'});
    try{
      // Revalidate authentication and ownership immediately before every write.
      const {client,...current}=await authority();if(id!==epoch)return;
      if(current.access!=='owner'){emit({...current,message:'Owner access could not be verified. No change was sent.'});return;}
      if(enabled&&current.control.capacity_paused===true){emit({...current,message:'This campaign is permanently ended. Resume was not sent.'});return;}
      const result=await timed(client.from('paper_control').update({enabled}).eq('id',1).select('id,enabled'));
      if(id!==epoch)return;
      if(result.error||result.data?.length!==1||result.data[0].id!==1||result.data[0].enabled!==enabled){
        emit({access:denied(result.error)||!result.error?'denied':'unavailable',control:null,payload:null,message:'The server did not confirm this change. Check connection before trying again.'});return;
      }
      emit({control:{...current.control,...result.data[0]},payload:null,message:enabled?'Resume saved on the server. Waiting for a fresh server heartbeat; any risk lock stays active.':'Stop saved on the server. Waiting for the server status to confirm it has stopped.'});
      busy=false;emit({busy:false});const payload=await publicStatus(client);if(id===epoch)emit({payload});
    }catch{if(id===epoch)emit({access:'unavailable',control:null,payload:null,message:'The result is unknown. The request may have reached the server. Check connection before trying again.'});}
    finally{if(id===epoch){busy=false;emit({busy:false});}}
  }
  return {refresh,setEnabled,invalidate,getState:()=>({...state}),now};
}
export function paperControlCopy(state,now=Date.now()){
  if(state.access!=='owner')return state.message;
  const {control:c,payload:p}=state;if(!c)return 'Server control state unavailable.';
  const terminal=c.capacity_paused===true?[c]:(p?.filter(row=>row.capacity_paused===true||row.status==='capacity_paused')||[]);
  if(terminal.length){
    const reasons=[...new Set(terminal.map(row=>typeof row.capacity_reason==='string'&&row.capacity_reason.trim()?row.capacity_reason.trim():'Campaign time or storage limit reached'))].join('; ');
    return 'Paper campaign ended permanently: '+reasons+'. Resume is unavailable. Ledgers and open virtual positions are preserved. The scheduler is intentionally stopped; no new heartbeat is expected.';
  }
  if(p?.some(row=>row.campaign_expires_at!=null&&(!Number.isFinite(Date.parse(row.campaign_expires_at))||Date.parse(row.campaign_expires_at)<=now)))return 'Resume is unavailable: the campaign end time has passed or could not be verified. Waiting for the server to confirm its final status.';
  const fresh=Array.isArray(p)&&p.every(row=>{const age=now-Date.parse(row.heartbeat_at);return Number.isFinite(age)&&age>=-5000&&age<=90000;});
  const locked=p?.filter(row=>row.risk_paused).map(row=>row.symbol||'Market')||[];
  const risk=locked.length?' Risk lock active for '+locked.join(', ')+': new entries remain blocked.':'';
  if(!c.enabled)return fresh&&p.every(row=>row.enabled===false&&row.status==='stopped')?'All four server paper runners stopped. Ledgers and open virtual positions are preserved.'+risk:'Stop All is saved. Waiting for all four server runners to confirm they have stopped.';
  if(!fresh||!p.every(row=>row.enabled===true))return 'Resume All is saved. Fresh heartbeats from all four server runners are not confirmed yet.'+risk;
  return (locked.length?'Server checks enabled; risk-locked markets can only make protective exits.':p.some(row=>row.status==='feed_error')?'Server checks enabled, but at least one market feed needs attention.':'Server checks enabled for BTC, ETH, SOL and PEPE. Fresh heartbeats confirmed.')+risk;
}

export function canResumePaper(state,now=Date.now()){
  return state.access==='owner'&&state.control?.enabled===false&&state.control?.capacity_paused!==true&&Array.isArray(state.payload)&&state.payload.length===4&&state.payload.every(row=>{
    const age=now-Date.parse(row.heartbeat_at);
    const expires=row.campaign_expires_at==null?null:Date.parse(row.campaign_expires_at);
    return row.capacity_paused!==true&&row.status!=='capacity_paused'&&(expires===null||Number.isFinite(expires)&&expires>now)&&row.enabled===false&&row.status==='stopped'&&Number.isFinite(age)&&age>=-5000&&age<=90000;
  });
}
