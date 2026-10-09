// Decorative ocean/sky depth only. No feed, account, market or decision inputs.
export const LIMITS=Object.freeze({desktop:88,mobile:44,edges:96,dpr:1.5,pixels:4000000,fps:30,dt:.05});
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const finite=(v,fallback=0)=>Number.isFinite(v)?v:fallback;
const TAU=Math.PI*2;
export function makeNodes(count=LIMITS.desktop){
 count=clamp(Math.floor(finite(count)),0,LIMITS.desktop);
 return Array.from({length:count},(_,id)=>({id,lane:id%3,u:(id*.61803398875)%1,phase:(id*.38196601125)%1,z:.12+((id*.754877666)%1)*1.7}));
}
// Project bounded scene coordinates; positive z is farther from the viewer.
export function project(x,y,z,width,height){
 width=Math.max(0,finite(width));height=Math.max(0,finite(height));z=clamp(finite(z,1),.08,1.95);
 const scale=1.65/(1.65+z);
 return {x:(.5+(finite(x,.5)-.5)*scale)*width,y:(.48+(finite(y,.48)-.48)*scale)*height,z,scale};
}
export function imagePoint(x,y,width,height){
 // Matches the unchanged image's cover geometry, including its mobile overscan.
 const mobile=width<620,boxWidth=width*(mobile?1.5:1),scale=Math.max(boxWidth/1672,height/941);
 return {x:x*1672*scale+(boxWidth-1672*scale)*(mobile?.51:.5)-(mobile?width*.25:0),y:y*941*scale+(height-941*scale)*(mobile?.35:.44)};
}
export function protection(x,y,width,height,masks=[]){
 const face=imagePoint(.475,.19,width,height),r=Math.max(32,Math.min(width,height)*.105);
 const d=Math.hypot((x-face.x)/r,(y-face.y)/(r*1.2));
 let alpha=.15+.85*clamp((d-.55)/.8,0,1);
 // Text protection uses measured UI rectangles, not guessed viewport breakpoints.
 for(const m of masks.slice(0,16))if(x>=m.left-12&&x<=m.right+12&&y>=m.top-12&&y<=m.bottom+12)alpha=Math.min(alpha,.1);
 return alpha;
}
export function depthFrame(nodes,time,width,height,masks=[]){
 time=Math.max(0,finite(time));width=Math.max(0,finite(width));height=Math.max(0,finite(height));
 if(!width||!height)return {points:[],edges:[]};
 const points=nodes.slice(0,LIMITS.desktop).map(n=>{
  const phase=n.phase*TAU,u=(n.u+time*(n.lane===1?-.006:.008)+1e6)%1;
  // Organic horizontal ocean, high sky and diagonal trident flows; no sphere/ring.
  let x,y;
  if(n.lane===0){x=-.15+u*1.3;y=.57+.11*Math.sin(u*9+phase)+.035*Math.sin(time*.3+phase);}
  else if(n.lane===1){x=-.1+u*1.2;y=.22+.13*Math.sin(u*7+phase)+.025*Math.sin(time*.23+phase);}
  else{x=.36+u*.52+.035*Math.sin(phase+time*.21);y=.52-u*.43+.055*Math.sin(u*12+phase);}
  const z=clamp(n.z+.12*Math.sin(time*.26+phase),.08,1.95),p=project(x,y,z,width,height);
  // Fade at the current's endpoints; wrapping never produces a bright jump.
  const fade=Math.sin(u*Math.PI)**2,veil=protection(p.x,p.y,width,height,masks);
  return {...p,id:n.id,lane:n.lane,u,radius:.45+p.scale*1.15,alpha:(.1+.32*p.scale)*fade*veil,gold:n.id%5<2};
 }).sort((a,b)=>b.z-a.z||a.id-b.id);
 const edges=[],degree=new Map();
 // At most two neighbours per node, selected by actual three-dimensional distance.
 for(const a of points){
  if((degree.get(a.id)||0)>=2)continue;
  const nearest=points.filter(b=>b.id>a.id&&b.lane===a.lane&&(degree.get(b.id)||0)<2).map(b=>({b,d:Math.hypot((a.x-b.x)/width,(a.y-b.y)/height,(a.z-b.z)*.18)})).filter(e=>e.d<.18).sort((p,q)=>p.d-q.d||p.b.id-q.b.id);
  for(const {b,d} of nearest){
   if((degree.get(a.id)||0)>=2||edges.length>=LIMITS.edges)break;
   degree.set(a.id,(degree.get(a.id)||0)+1);degree.set(b.id,(degree.get(b.id)||0)+1);
   const veil=protection((a.x+b.x)/2,(a.y+b.y)/2,width,height,masks);
   edges.push({a,b,z:(a.z+b.z)/2,alpha:Math.min(a.alpha,b.alpha)*.37*(1-d/.18)*veil});
  }
 }
 edges.sort((a,b)=>b.z-a.z);return {points,edges};
}
export function paintDepth(ctx,scene){
 // Rear-to-front compositing of both strands and particles within one canvas.
 const layers=[...scene.edges.map(e=>({z:e.z,edge:e})),...scene.points.map(p=>({z:p.z,point:p}))].sort((a,b)=>b.z-a.z);
 for(const layer of layers){
  if(layer.edge){const e=layer.edge;ctx.strokeStyle=`rgba(${e.a.gold?'233,202,140':'126,219,235'},${e.alpha})`;ctx.lineWidth=.4+e.a.scale*.4;ctx.beginPath();ctx.moveTo(e.a.x,e.a.y);ctx.lineTo(e.b.x,e.b.y);ctx.stroke();}
  else{const p=layer.point;ctx.fillStyle=`rgba(${p.gold?'242,210,149':'151,234,243'},${p.alpha})`;ctx.beginPath();ctx.arc(p.x,p.y,p.radius,0,TAU);ctx.fill();}
 }
}
export function makeAtmosphere({canvas,ctx,request,cancel,getDpr=()=>1,getMasks=()=>[]}){
 let width=0,height=0,frame=0,last=null,time=0,enabled=false,visible=true,inView=true,destroyed=false,masks=[],nodes=[];
 const active=()=>!destroyed&&enabled&&visible&&inView&&!!ctx&&width>0&&height>0;
 const queue=()=>{if(active()&&!frame)frame=request(tick);};
 const clear=()=>{if(ctx)ctx.clearRect(0,0,width,height);};
 function tick(now){frame=0;if(!active())return;
  if(!Number.isFinite(now)){queue();return;}
  if(last===null||now-last>=1000/LIMITS.fps){const dt=last===null?0:clamp((now-last)/1000,0,LIMITS.dt);last=now;time=(time+dt)%86400;clear();paintDepth(ctx,depthFrame(nodes,time,width,height,masks));}
  queue();
 }
 function sync(){if(frame)cancel(frame);frame=0;last=null;clear();queue();}
 return {
  resize(){if(destroyed)return;const box=canvas.getBoundingClientRect();width=clamp(finite(box.width),0,8192);height=clamp(finite(box.height),0,8192);
   const dpr=Math.min(clamp(finite(getDpr(),1),.25,LIMITS.dpr),Math.sqrt(LIMITS.pixels/Math.max(1,width*height)));
   canvas.width=Math.floor(width*dpr);canvas.height=Math.floor(height*dpr);if(ctx)ctx.setTransform(dpr,0,0,dpr,0,0);
   nodes=makeNodes(width<620?LIMITS.mobile:LIMITS.desktop);masks=getMasks(box).slice(0,16);sync();
  },
  setState(state={}){if(destroyed)return;if(typeof state.enabled==='boolean')enabled=state.enabled;if(typeof state.visible==='boolean')visible=state.visible;if(typeof state.inView==='boolean')inView=state.inView;sync();},
  destroy(){destroyed=true;enabled=false;sync();nodes=[];masks=[];},
  snapshot:()=>({width,height,frame,time,nodeCount:nodes.length,active:active()})
 };
}
