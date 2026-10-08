import {getAuthClient} from './auth-client.mjs?v=20261001.data2';
import {createPaperControl,paperControlCopy,canResumePaper} from './paper-control.mjs?v=20261008.terminal1';
const root=document.getElementById('serverPaperControls');
if(root){
  const status=root.querySelector('[data-paper-status]'),message=root.querySelector('[data-paper-message]'),stop=root.querySelector('[data-paper-stop]'),resume=root.querySelector('[data-paper-resume]'),check=root.querySelector('[data-paper-check]'),signIn=root.querySelector('[data-paper-signin]');
  let client,subscription,timer;
  const controller=createPaperControl({getClient:async()=>client||=await getAuthClient(),onChange:state=>{
    root.setAttribute('aria-busy',String(state.busy));status.textContent=paperControlCopy(state);message.textContent=state.access==='owner'?state.message:'';
    stop.disabled=state.busy||state.access!=='owner';resume.disabled=state.busy||!canResumePaper(state);
    check.disabled=state.busy;signIn.hidden=state.access==='owner';
    stop.textContent=state.busy?'Please wait…':'Stop all server paper runners';
  }});
  stop.addEventListener('click',()=>void controller.setEnabled(false));resume.addEventListener('click',()=>void controller.setEnabled(true));check.addEventListener('click',()=>void controller.refresh());
  // Reuse the existing sign-in dialog and OAuth callback flow without duplicating it.
  signIn.addEventListener('click',()=>document.getElementById('accountButton')?.click());
  function pause(){clearInterval(timer);timer=null;}
  function watch(){pause();if(!document.hidden)timer=setInterval(()=>void controller.refresh(),15000);}
  async function start(){try{client=await getAuthClient();subscription?.unsubscribe();subscription=client?.auth.onAuthStateChange((event)=>{
    if(['SIGNED_OUT','USER_DELETED'].includes(event))controller.invalidate();
    else if(['SIGNED_IN','TOKEN_REFRESHED'].includes(event))setTimeout(()=>void controller.refresh(),0);
  })?.data?.subscription;await controller.refresh();watch();}catch{controller.invalidate();status.textContent='Sign-in could not be loaded. Open your existing account connection and try again.';}}
  document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();else{void controller.refresh();watch();}});
  window.addEventListener('pagehide',()=>{pause();subscription?.unsubscribe();controller.invalidate();});
  window.addEventListener('pageshow',event=>{if(event.persisted)void start();});
  void start();
}
