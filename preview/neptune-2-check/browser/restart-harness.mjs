// FUTURE PERMITTED BROWSER ONLY. NO NETWORK. No claim this has run.
import {IndexedDBPaperStore,ACCOUNT_MODES} from '../indexeddb-store.mjs';
import {PublicPaperController} from '../controller.mjs';
import {T,evidence,candidate} from '../test/fixtures.mjs';
const output=document.getElementById('result'),create=document.getElementById('create'),exit=document.getElementById('exit');
const check=(ok,why)=>{if(!ok)throw Error(why)};
const query=new URLSearchParams(location.search),accountId=query.get('account'),stage=query.get('stage');
let verified=null;
create.addEventListener('click',async()=>{create.disabled=true;try{
 const id=`mock_native_${crypto.randomUUID()}`,s=await IndexedDBPaperStore.create({accountId:id,accountMode:ACCOUNT_MODES.paper,acknowledgement:'CREATE_ISOLATED_PUBLIC_PAPER_ACCOUNT'});
 await s.execute(1,'start',[{id:'mock_native_start',acknowledgement:'START_ONE_FINITE_PUBLIC_PRICE_PAPER_PRACTICE',now:T}]);await s.execute(2,'observePublicResponse',[evidence(1),T+110]);await s.execute(3,'proposeBuy',[candidate(s.snapshot().state.lastBook),T+111]);await s.execute(4,'observePublicResponse',[evidence(2),T+210]);s.close();
 location.replace(`./restart-harness.html?account=${encodeURIComponent(id)}&stage=holding`);
}catch(error){output.textContent=`FAILED: ${error.message}`;}});
exit.addEventListener('click',async()=>{exit.disabled=true;try{
 check(verified?.state.position,'No verified open mocked position');const s=await IndexedDBPaperStore.recover({accountId}),v=s.snapshot().version;
 await s.execute(v+1,'resumeProtective',[{acknowledgement:'RESUME_FRESH_PROTECTIVE_EXIT_ONLY',now:T+10001}]);await s.execute(v+2,'observePublicResponse',[evidence(3,T+10010),T+10020]);s.close();
 location.replace(`./restart-harness.html?account=${encodeURIComponent(accountId)}&stage=settled`);
}catch(error){output.textContent=`FAILED: ${error.message}`;}});
if(/^mock_native_[A-Za-z0-9_-]{8,60}$/.test(accountId??'')&&['holding','settled'].includes(stage)){
 create.disabled=true;
 try{const c=await PublicPaperController.recover({accountId,now:()=>stage==='holding'?T+10000:T+20000});verified=c.view();
 check(verified.state.entriesEnabled===false,'Recovery did not halt entries');check(verified.state.dataInterrupted,'Recovery did not record interruption');
 check(verified.state.ledger.length===(stage==='holding'?1:3),'Unexpected duplicate/missing ledger rows');
 check(Boolean(verified.state.position)===(stage==='holding'),'Unexpected position');
 check(verified.state.cashMicros===100000000+verified.state.realizedNetMicros-(verified.state.position?.entryCostMicros??0),'Cash conservation failed');
 output.textContent=JSON.stringify({result:stage==='settled'?'PASS_MOCKED_NATIVE_RELOAD_FLOW':'MOCKED_ENTRY_RECOVERED_ENTRIES_HALTED',accountId,revision:verified.version,ledgerRows:verified.state.ledger.length,source:'FABRICATED_FIXTURES_NO_PUBLIC_REQUESTS',nativeBrowserRestart:'NOT_TESTED',physicalCrashDurability:'NOT_TESTED',crossTab:'NOT_TESTED',appUi:'NOT_TESTED',userAgent:navigator.userAgent},null,2);exit.disabled=stage!=='holding';c.close();
 }catch(error){output.textContent=`FAILED: ${error.message}`;}
}
