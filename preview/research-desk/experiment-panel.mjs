import {validateExperimentProjection} from './experiment-provenance.mjs?v=experiment-provenance-v3-r2';
export function readExperimentPanel(report,now=Date.now()){
 if(!report)return {available:false,text:'No experiment report received.'};
 try{validateExperimentProjection(report);}catch{return {available:false,text:'Experiment evidence failed validation.'};}
 if(report?.experiment_provenance_version!==1)return {available:false,text:'Experiment data is not available in this report.'};
 const age=now-Date.parse(report.heartbeat_at),evaluated=Date.parse(report.experiment_evaluated_at);if(!Number.isFinite(age)||age<0||age>90000||!Number.isFinite(evaluated)||evaluated<Date.parse(report.heartbeat_at)||evaluated>now||now-evaluated>90000||evaluated-Date.parse(report.heartbeat_at)>90000)return {available:false,text:'Experiment report stale. Current experiment state is unconfirmed.'};
 const x=report.market_experiment;if(!x)return {available:true,text:'No experiment has been recorded. A trial uses the existing paper account and cannot guarantee a fill.'};
 const state=x.state==='active'?'Active':x.state==='expired'?'Entry window expired':x.state==='stop_requested'?'Entry Stop requested':'Intent cap reached';
 return {available:true,id:x.id,text:`PAPER EXPERIMENT · ${x.asset} · ${x.venue}\n${state} · ${x.intents}/${x.max_intents} entry attempts\n${x.started_at} → ${x.expires_at}\nShared paper cash and exposure. Momentum qualification override; other data, cost and risk gates apply. This is not evidence of strategy edge. History below retains experiment observations and linked receipts. ${report.experiment_projection_scope?.fills_complete===false?'This status contains only a bounded recent receipt list; absent older links are unconfirmed here.':''}`};
}
export function renderExperimentPanel(document,report,now=Date.now()){const node=document.getElementById('experimentEvidence');const view=readExperimentPanel(report,now);if(node)node.textContent=view.text;const badge=document.getElementById('experimentBadge');if(badge){badge.hidden=!view.id;badge.textContent=view.id?'PAPER EXPERIMENT · '+view.id:'';}}
