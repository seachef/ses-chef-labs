/** Foreground, cancellable historical request. No polling or persistent cache. */
import {normalizeWalletHistory} from './wallet-history.mjs';
const same=(a,b)=>JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
export function createWalletHistoryController({read,onChange=()=>{},now=Date.now}={}){
  let generation=0,abort=null,query=null,disposed=false;
  let state={status:'idle',summary:null,error:null,progress:null};
  const emit=()=>{try{onChange({...state,query});}catch{/* Cleanup cannot depend on rendering. */}};
  function stop(){generation++;abort?.abort();abort=null;}
  async function load(next=query){
    if(disposed||!next)return;
    stop();query={...next,walletIds:[...next.walletIds]};const selected=query,ticket=generation;
    abort=new AbortController();const signal=abort.signal;
    state={status:'loading',summary:null,error:null,progress:null};emit();
    let response;
    try{response=await read({...selected,signal});}catch{response={status:'unavailable'};}
    if(disposed||signal.aborted||ticket!==generation||selected!==query)return;
    abort=null;
    if(['signed-out','forbidden'].includes(response?.status)){query=null;state={status:'signed-out',summary:null,error:null,progress:null};emit();return;}
    if(response?.status!=='ready'){state={status:'unavailable',summary:null,error:response?.code||'HISTORY_UNAVAILABLE',progress:null};emit();return;}
    const data=response.data;
    try{
      if(data?.status==='building'){
        const p=data.progress,s=data.scope,q=data.query;
        if(data.schema_version!==1||s?.account_id!==selected.accountId||!Array.isArray(s.wallet_ids)||!same(s.wallet_ids,selected.walletIds)||q?.range!==selected.range||q.currency!==selected.currency||!p||!Number.isInteger(p.completed_steps)||!Number.isInteger(p.total_steps)||p.completed_steps<0||p.total_steps<1||p.completed_steps>p.total_steps||p.total_steps>100000||p.can_continue!==true)throw Error();
        state={status:'building',summary:null,error:null,progress:{completed_steps:p.completed_steps,total_steps:p.total_steps,phase:typeof p.phase==='string'?p.phase:'history'}};
      }else{
        const summary=normalizeWalletHistory(data,{...selected,now:now()});
        state={status:data.status==='unavailable'?'unavailable':'ready',summary,error:summary.errorCode,progress:null};
      }
    }catch{state={status:'unavailable',summary:null,error:'HISTORY_RESPONSE_INVALID',progress:null};}
    emit();
  }
  return {
    load,
    cancel(){stop();state={status:'cancelled',summary:null,error:null,progress:null};emit();},
    clear(){stop();query=null;state={status:'idle',summary:null,error:null,progress:null};emit();},
    destroy(){disposed=true;stop();query=null;state={status:'idle',summary:null,error:null,progress:null};emit();},
    getState:()=>({...state,query})
  };
}
