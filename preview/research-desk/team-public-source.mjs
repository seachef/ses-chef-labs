// Approved public source references from immutable commit 0ed31. Never an execution trace.
export const PUBLIC_WORK_SOURCES=Object.freeze([
  {
    "id": "refresh-feed",
    "commit": "0ed31a9437767169664edd0a8f1555d2e38d4351",
    "path": "preview/research-desk/neptune.mjs",
    "function_name": "refreshFeed",
    "file_sha256": "adeadcb4fc4fbd5b46f2e8e7e8ffd1c45ca1bdf515c9bc53ca599831485abb53",
    "snippet_sha256": "3446135be91c08f38efe4a70a90ef67db01a3b82a20fc0392164fea383ba7b5b",
    "code": "async function refreshFeed(){\n if(busy)return;\n busy=true;$('refresh').disabled=true;recordRuntime('GET paper status \u00b7 request started');\n const workStartedAt=new Date().toISOString(),workRunId='interface:'+workStartedAt+':'+polls;emitInterfaceWork('started',workRunId,workStartedAt,'Read-only status request started');\n try{report=await readReports();cueBridge.observe(report);connected=true;igniteDecisions();recordRuntime(report?'Report validated \u00b7 '+paperViewV2(report,true).label:'Empty response \u00b7 account not created');emitInterfaceWork('completed',workRunId,workStartedAt,report?'Status response received and validated':'Empty status response received');}catch{connected=false;cueBridge.disconnect();recordRuntime('Feed check failed \u00b7 data unavailable');emitInterfaceWork('failed',workRunId,workStartedAt,'Status request failed; data unavailable');}\n finally{polls++;busy=false;$('refresh').disabled=false;render();}\n}"
  },
  {
    "id": "validate-browser-event",
    "commit": "0ed31a9437767169664edd0a8f1555d2e38d4351",
    "path": "preview/research-desk/team-work.mjs",
    "function_name": "validateWorkEvent",
    "file_sha256": "3523113f616f29a53691e733b047169b9b6e130bdba670da25d4d8eb66374127",
    "snippet_sha256": "4598e103c1ca9524297724632c9239c23e96c1b2a13f9aa596d7c109012fbc8d",
    "code": "export function validateWorkEvent(raw,{now=Date.now()}={}){\n if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;\n // No coding_agent or reviewer can become live through this local browser channel.\n if(raw.version!==1||raw.actor_kind!=='browser_check'||raw.actor_id!=='browser-interface')return null;\n if(!['started','completed','failed'].includes(raw.kind)||!iso(raw.occurred_at))return null;\n const at=Date.parse(raw.occurred_at);if(at>now||now-at>60000)return null;\n if(typeof raw.run_id!=='string'||!/^interface:\\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\d\\.\\d{3}Z:\\d{1,12}$/.test(raw.run_id))return null;\n if(raw.id!==raw.run_id+':'+raw.kind||raw.seq!==(raw.kind==='started'?0:1))return null;\n if(raw.task!=='Refresh public paper status'||raw.source?.path!==PATH||raw.source?.function_name!=='refreshFeed')return null;\n if(raw.source.commit!==null||raw.source.file_sha256!==null)return null;\n if(raw.evidence?.kind!=='local_invocation'||raw.evidence.id!==raw.run_id||!iso(raw.evidence.at))return null;\n if(Date.parse(raw.evidence.at)>at||raw.run_id.split('interface:')[1].slice(0,24)!==raw.evidence.at)return null;\n if(raw.kind==='started'&&raw.evidence.at!==raw.occurred_at)return null;\n if(raw.output?.exit_code!==null||raw.review!==null)return null;\n const expected=raw.kind==='started'?['Read-only status request started']:raw.kind==='failed'?['Status request failed; data unavailable']:['Status response received and validated','Empty status response received'];\n if(!expected.includes(raw.output?.summary))return null;\n return Object.freeze({version:1,id:raw.id,run_id:raw.run_id,seq:raw.seq,actor_id:raw.actor_id,actor_kind:raw.actor_kind,kind:raw.kind,occurred_at:raw.occurred_at,received_at:new Date(now).toISOString(),task:raw.task,source:Object.freeze({path:PATH,function_name:'refreshFeed',commit:null,file_sha256:null}),evidence:Object.freeze({kind:'local_invocation',id:raw.run_id,at:raw.evidence.at}),output:Object.freeze({summary:raw.output.summary,exit_code:null}),review:null});\n}"
  },
  {
    "id": "browser-work-state",
    "commit": "0ed31a9437767169664edd0a8f1555d2e38d4351",
    "path": "preview/research-desk/team-work.mjs",
    "function_name": "workState",
    "file_sha256": "3523113f616f29a53691e733b047169b9b6e130bdba670da25d4d8eb66374127",
    "snippet_sha256": "29560a03aa52fc0595ca4b51a4d3cf9139e5e6dc3133491f121ca4b8915a077b",
    "code": "export function workState(snapshot,now=Date.now()){\n const newestRun=snapshot.events.reduce((latest,event)=>Math.max(latest,Number(event.run_id.split(':').at(-1))),-1);\n const event=snapshot.events.find(event=>Number(event.run_id.split(':').at(-1))===newestRun);\n if(!event)return {coding:'NOT CONNECTED',local:'Waiting for an observed check',event:null};\n const age=now-Date.parse(event.occurred_at);\n if(!Number.isFinite(age)||age<0)return {coding:'NOT CONNECTED',local:'Timestamp unavailable',event};\n if(event.kind==='started')return {coding:'NOT CONNECTED',local:age<=ACTIVE_MS?'CHECKING \u00b7 local invocation':'WAITING \u00b7 check has no recent completion',event};\n return {coding:'NOT CONNECTED',local:(event.kind==='failed'?'FAILED':'COMPLETED')+(age>ACTIVE_MS?' \u00b7 previous local check':' \u00b7 local check'),event};\n}"
  }
].map(source=>Object.freeze(source)));
