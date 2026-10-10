// Ambient artwork only. This module has no evidence, status, trade or network API.
export const CURRENT_LIMITS=Object.freeze({phonePackets:14,desktopPackets:24,phoneGlows:8,desktopGlows:14,trailSteps:7,cohorts:2});
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),mod=(v,m)=>((v%m)+m)%m;
export function curvePoint(path,t){const u=1-t;return{x:u*u*path.a.x+2*u*t*path.c.x+t*t*path.b.x,y:u*u*path.a.y+2*u*t*path.c.y+t*t*path.b.y};}
export function makeCurrentPath(a,b,index=0){const dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy),bend=Math.min(17,length*.15)*(index%2?-1:1);return {a,b,c:{x:(a.x+b.x)/2-dy/Math.max(1,length)*bend,y:(a.y+b.y)/2+dx/Math.max(1,length)*bend},duration:clamp(length/130,.62,1.38)};}
// Travel times form a branching wave: a packet reaches a junction before its
// outgoing paths ignite. Two staggered sources keep the universe circulating.
export function buildCurrentWaves(paths){
 const nodes=[...new Map(paths.flatMap(p=>[[p.a.asset,p.a],[p.b.asset,p.b]])).values()];if(!nodes.length)return [];
 return [0,Math.floor(nodes.length*.67)].map((root,cohort)=>{
  const distances=new Map(nodes.map(n=>[n.asset,Infinity])),visited=new Set();distances.set(nodes[root].asset,0);
  for(let i=0;i<nodes.length;i++){let next=null,best=Infinity;for(const n of nodes)if(!visited.has(n.asset)&&distances.get(n.asset)<best){next=n;best=distances.get(n.asset);}if(!next)break;visited.add(next.asset);for(const p of paths){const other=p.a.asset===next.asset?p.b:p.b.asset===next.asset?p.a:null;if(other)distances.set(other.asset,Math.min(distances.get(other.asset),best+p.duration));}}
  const routes=paths.flatMap((path,index)=>{const a=distances.get(path.a.asset),b=distances.get(path.b.asset);if(!Number.isFinite(Math.min(a,b)))return [];return [{path,index,start:Math.min(a,b),reverse:b<a,cohort}];});
  const last=Math.max(0,...routes.map(r=>r.start+r.path.duration));return {routes,period:Math.max(5.2,last+1.15),offset:cohort*2.6};
 });
}
export function currentFrame(waves,time,{mobile=false,reduced=false}={}){
 if(reduced||!Number.isFinite(time))return {packets:[],glows:[]};
 const packets=[],glows=[],packetLimit=mobile?CURRENT_LIMITS.phonePackets:CURRENT_LIMITS.desktopPackets,glowLimit=mobile?CURRENT_LIMITS.phoneGlows:CURRENT_LIMITS.desktopGlows;
 for(const wave of waves){const clock=mod(Math.max(0,time)+wave.offset,wave.period);for(const route of wave.routes){const age=clock-route.start,progress=age/route.path.duration;if(progress>=0&&progress<1&&packets.length<packetLimit)packets.push({...route,progress,alpha:Math.min(1,progress*9,(1-progress)*10)});const after=age-route.path.duration;if(after>=0&&after<.72&&glows.length<glowLimit)glows.push({node:route.reverse?route.path.a:route.path.b,alpha:Math.sin(Math.PI*(1-after/.72))*.68,cohort:route.cohort});}}
 return {packets,glows};
}
function trace(ctx,path,from=0,to=1){const first=curvePoint(path,from);ctx.moveTo(first.x,first.y);for(let i=1;i<=CURRENT_LIMITS.trailSteps;i++){const p=curvePoint(path,from+(to-from)*i/CURRENT_LIMITS.trailSteps);ctx.lineTo(p.x,p.y);}}
export function drawCurrentPacket(ctx,path,progress,{reverse=false,alpha=1,color='130,232,255',mobile=false}={}){
 const head=reverse?1-progress:progress,tail=reverse?Math.min(1,head+.25):Math.max(0,head-.25);
 for(const [width,opacity]of [[mobile?5:7,.12],[mobile?2:2.5,.42],[1.15,.94]]){ctx.beginPath();trace(ctx,path,tail,head);ctx.strokeStyle=`rgba(${color},${alpha*opacity})`;ctx.lineWidth=width;ctx.stroke();}
 const p=curvePoint(path,head);ctx.beginPath();ctx.arc(p.x,p.y,mobile?1.8:2.3,0,Math.PI*2);ctx.fillStyle=`rgba(234,253,255,${alpha})`;ctx.fill();
}
export function drawAmbientCurrents(ctx,paths,waves,time,{mobile=false,reduced=false}={}){
 const frame=currentFrame(waves,time,{mobile,reduced});
 for(const glow of frame.glows){ctx.beginPath();ctx.arc(glow.node.x,glow.node.y,(glow.node.radius??(mobile?3:4))+2.5,0,Math.PI*2);ctx.lineWidth=mobile?2:2.5;ctx.strokeStyle=`rgba(${glow.cohort?'195,174,255':'116,224,250'},${glow.alpha*.5})`;ctx.stroke();}
 for(const packet of frame.packets)drawCurrentPacket(ctx,packet.path,packet.progress,{reverse:packet.reverse,alpha:packet.alpha,color:packet.cohort?'193,177,255':'116,229,255',mobile});
 return {ambientPulses:frame.packets.length,endpointGlows:frame.glows.length};
}
