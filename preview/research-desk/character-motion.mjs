// Bounded 2D directional sprite choreography. It never reads or writes financial state.
export const CHARACTER_LIMITS=Object.freeze({variants:4,runFrames:6,cycle:5,maxBeams:2});
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const smooth=n=>{n=clamp(n,0,1);return n*n*(3-2*n);};
export function hash(value){let h=2166136261;for(const c of String(value))h=Math.imul(h^c.charCodeAt(0),16777619);return h>>>0;}
const routes=[.34,.65,.43,.70,.30,.55,.72,.38];
const routines=[
 [{kind:'run',end:1.15,travel:1},{kind:'crouch',end:1.5},{kind:'fire',end:4.65},{kind:'turn',end:5}],
 [{kind:'roll',end:.65,travel:.55},{kind:'run',end:1.2,travel:1},{kind:'fire',end:4.6},{kind:'crouch',end:5}],
 [{kind:'run',end:.85,travel:1},{kind:'fire',end:2.3},{kind:'crouch',end:2.8},{kind:'fire',end:4.7},{kind:'turn',end:5}],
 [{kind:'crouch',end:.3},{kind:'run',end:.95,travel:.55},{kind:'roll',end:1.6,travel:1},{kind:'fire',end:4.6},{kind:'turn',end:5}]
];
export function choreography(time,width,height,{reduced=false,eventId=null,cue=null,actionVariant=null,now=Date.now(),target={x:width*.8,y:height*.3}}={}){
 const mobile=width<620,t=reduced?0:Math.max(0,Number.isFinite(time)?time:0),episode=Math.floor(t/5),q=t%5;
 // Adjacent episodes use distinct routines; a receipt changes the permutation, never event truth.
 const variant=episode%4;
 const route=i=>{const r=routes[((i%routes.length)+routes.length)%routes.length];return mobile?.5+(r-.5)*.43:r;};
 const start=route(episode),end=route(episode+1),ground=height*(mobile?.70:.7075),plan=routines[variant];
 let begin=0,progress=0,state=plan[0],previous='crouch',u=0;
 for(const step of plan){if(q<step.end){state=step;u=clamp((q-begin)/(step.end-begin),0,1);if(step.travel!==undefined)progress=progress+(step.travel-progress)*smooth(u);break;}if(step.travel!==undefined)progress=step.travel;previous=step.kind;begin=step.end;}
 const ambientKind=state.kind;let receiptProgress=1,receiptVariant=-1;
 if(cue?.kind==='profit'&&!reduced){const e=clamp((now-cue.createdAt)/Math.max(1,cue.until-cue.createdAt),0,1);receiptProgress=e;receiptVariant=hash(eventId)%4;state={kind:'victory'};u=e;}else if(cue&&!reduced){const e=clamp((now-cue.createdAt)/Math.max(1,cue.until-cue.createdAt),0,1),v=Number.isInteger(actionVariant)?actionVariant%4:hash(eventId)%4;receiptProgress=e;receiptVariant=v;state={kind:e<.20?['brace','turn','kneel','crouch'][v]:e<.35?(v===1||v===2?'recover':v===0?'brace':'crouch'):'fire'};u=clamp(e/.35,0,1);}if(reduced){state={kind:'crouch'};progress=0;}
 const x=width*(start+(end-start)*progress),travelFacing=end>=start?1:-1,aimFacing=target.x>=x?1:-1;
 let facing=state.kind==='run'||state.kind==='roll'?travelFacing:aimFacing;
 const frame=Math.floor(t*14)%6,kind=state.kind,turn=1;const samePlanted=['crouch','fire','brace'].includes(previous)&&['crouch','fire','brace'].includes(kind);const transition=!cue&&!reduced&&!samePlanted&&q-begin<.32&&previous!==kind;const blend=transition?clamp((q-begin)/.32,0,1):1;
 const aimSize=Math.min(height*(mobile?.225:.30),width*(mobile?.46:.25));
 const runSize=aimSize*1.28,rollSize=aimSize*.77;
 const baseSize=kind==='run'?runSize:kind==='roll'?rollSize:aimSize,previousSize=previous==='run'?runSize:previous==='roll'?rollSize:aimSize;const size=transition?previousSize+(baseSize-previousSize)*smooth(blend):baseSize;const transitionFrames=previous==='roll'?[0,1,3]:kind==='roll'?[3,1,0]:previous==='run'?[3,2,3]:[2,3,3];const transitionFrame=transitionFrames[Math.min(2,Math.floor(blend*3))];if(transition&&blend<1/3)facing=previous==='run'||previous==='roll'?travelFacing:aimFacing;
 const feet=kind==='run'?[{x,y:ground}]:kind==='roll'?[{x,y:ground}]:[{x:x-facing*size*.34,y:ground},{x:x+facing*size*.44,y:ground}];
 const origin={x,y:ground},eyeSource=[[995/1254,208/1254],[1033/1254,220/1254]];
 const eyes=eyeSource.map(([ex,ey])=>({x:x+facing*(ex-.5)*size*turn,y:ground+(ey-.975)*size}));
 const fire=kind==='fire'&&receiptProgress>=.35&&!transition&&!reduced&&Math.abs(target.x-x)>size*.18;
 return{kind,receiptVariant,preparation:cue?1-smooth(receiptProgress/.35):0,transition,transitionFrame,blend,previous,variant,episode,q,u,x,ground,facing,frame,size,turn,feet,eyes,origin,fire,rotation:kind==='roll'?facing*u*Math.PI*2:0,mobile};
}
function shadow(ctx,a){ctx.fillStyle='rgba(0,0,0,.42)';for(const f of a.feet){ctx.beginPath();ctx.ellipse(f.x,f.y+2,a.size*.115,a.size*.018,0,0,Math.PI*2);ctx.fill();}}
export const TRANSITION_POSES=Object.freeze([[0,0,610,606,313.5,588],[610,0,644,606,940.5,598],[0,606,627,620,313.5,1202],[627,606,627,620,940.5,1202]].map(Object.freeze));
function drawTransition(ctx,image,index,size){const [sx,sy,sw,sh,rootX,footY]=TRANSITION_POSES[index],k=size/627;ctx.drawImage(image,sx,sy,sw,sh,(sx-rootX)*k,(sy-footY)*k,sw*k,sh*k);}
export function drawCharacter(ctx,images,a){shadow(ctx,a);ctx.save();ctx.translate(a.x,a.ground);ctx.scale(a.facing*a.turn,1);
 if(a.kind==='victory'){const beat=Math.floor(a.u*12),routines=[[0,2,3,2],[1,3,2,3],[3,0,2,0],[2,3,1,3]],pose=routines[a.receiptVariant%4][beat%4];ctx.scale(1,1-.035*Math.sin(a.u*Math.PI*12)**2);ctx.scale(pose===2?a.facing:1,1);drawTransition(ctx,images[5],pose,a.size);ctx.restore();return;}
 if(a.kind==='brace')ctx.transform(1,0,.10*a.preparation,1,0,0);if(a.kind==='crouch'&&a.receiptVariant===3)ctx.scale(1,1-.13*a.preparation);
 if(a.kind==='recover'){drawTransition(ctx,images[5],3,a.size);}
 else if(a.transition){const frame=a.transitionFrame;ctx.scale(frame===2?a.facing:1,1);drawTransition(ctx,images[5],frame,a.size);}
 else if(a.kind==='kneel'){drawTransition(ctx,images[5],1,a.size);}
 else if(a.kind==='turn'){ctx.scale(a.facing,1);drawTransition(ctx,images[5],2,a.size);}
 else if(a.kind==='run'){const frame=a.frame,col=frame%3,row=Math.floor(frame/3);ctx.drawImage(images[1],col*512,row*512,512,512,-a.size*.5,-a.size*.95,a.size,a.size);}
 else if(a.kind==='roll'){ctx.translate(0,-a.size*.45);ctx.rotate(a.rotation*a.facing);ctx.drawImage(images[4],0,0,1254,1254,-a.size*.5,-a.size*.5,a.size,a.size);}
 else ctx.drawImage(images[2],0,0,1254,1254,-a.size*.5,-a.size*.975,a.size,a.size);
 ctx.restore();
}
export function drawEyeBeams(ctx,a,target,{color='112,225,255',strength=1}={}){
 if(!a.fire||!target||a.facing*(target.x-a.x)<=0)return 0;
 ctx.save();ctx.setLineDash([]);ctx.lineCap='round';
 // Coherent luminous shafts, like laser-eye imagery: broad halo, coloured body, white core.
 for(const eye of a.eyes){for(const[width,alpha,c]of[[14,.10,color],[7,.22,color],[3,.86,color],[1.2,.98,'243,253,255']]){ctx.lineWidth=width*(a.mobile?.75:1);ctx.strokeStyle=`rgba(${c},${alpha*strength})`;ctx.beginPath();ctx.moveTo(eye.x,eye.y);ctx.lineTo(target.x,target.y);ctx.stroke();}
 for(const[r,alpha]of[[5,.18],[2.5,.75]]){ctx.fillStyle=`rgba(${color},${alpha*strength})`;ctx.beginPath();ctx.arc(eye.x,eye.y,r,0,Math.PI*2);ctx.fill();}}
 ctx.fillStyle=`rgba(${color},.7)`;ctx.beginPath();ctx.arc(target.x,target.y,a.mobile?4:5,0,Math.PI*2);ctx.fill();ctx.restore();return 2;
}

export function createActionSelector(){let lastId=null,last=-1;return{select(cue){if(!cue)return null;if(cue.eventId===lastId)return last;let next=hash(cue.eventId)%4;if(next===last)next=(next+1)%4;lastId=cue.eventId;last=next;return next;},reset(){lastId=null;last=-1;}};}
