// Navigation only. Owner access checks and trial requests stay in the existing panel.
export function setupPaperTrialShortcut(document){
 const button=document.getElementById('openPaperTrial');
 const dialog=document.getElementById('historyDialog');
 const heading=document.getElementById('experimentHeading');
 if(!button||!dialog||!heading)return;
 button.addEventListener('click',()=>{
  if(!dialog.open)dialog.showModal();
  heading.scrollIntoView({block:'start',inline:'nearest',behavior:'auto'});
  heading.focus({preventScroll:true});
 });
}
if(typeof document!=='undefined')setupPaperTrialShortcut(document);
