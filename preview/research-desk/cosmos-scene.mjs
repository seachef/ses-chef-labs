import {isVerifiedCue} from './paper-eye-cues.mjs?v=neptune-native-20261009';
import {isVerifiedSceneFill,sceneInstrument,TARGET_LIMITS} from './scene-targets.mjs?v=real-targets-20261010';
export {createPaperCueBridge} from './paper-eye-cues.mjs?v=neptune-native-20261009';
import {choreography,drawCharacter,drawEyeBeams,hash} from './character-motion.mjs?v=real-targets-20261010';
import {drawCosmicMotion} from './cosmic-motion.mjs?v=neptune-native-20261009';
import {makeCurrentPath,curvePoint,buildCurrentWaves,drawAmbientCurrents,drawCurrentPacket} from './neural-currents.mjs?v=neural-currents-20261010';
export const SCENE_LIMITS=Object.freeze({cycle:40,coinNodes:100,phoneCoinNodes:64,companions:0,maxDpr:1.25,maxPixels:1800000});
export const ASSETS=['cosmos-ocean-background.webp','neptune-run-atlas.png','neptune-braced-aim.png','cosmos-ocean-phone.webp','neptune-tucked-roll.png','neptune-transition-atlas.png'];
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function layout(width,height){const mobile=width<620,rock={x:width*.06,y:height*.60,w:width*.88,h:height*.40};return{mobile,rock,contact:{x:width*.5,y:height*.70}};}
function path(ctx,poly){ctx.beginPath();poly.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();}
export function renderScene(ctx,images,time,width,height,{reduced=false,cue=null,now=Date.now(),showCaption=true,showMarketLabels=true,marketPositions=[],markers=[],catalogue=[],masks=[],actionVariant=null,actorTime=time}={}){const [bg,,,phoneBg]=images,t=reduced?0:time,l=layout(width,height);ctx.clearRect(0,0,width,height);
 if(l.mobile&&phoneBg){
  const cover=Math.max(width/1024,height/1536),bw=1024*cover,bh=1536*cover,y=l.contact.y-1180*cover,x=(width-bw)*.5;
  ctx.drawImage(phoneBg,x,y,bw,bh);
  // Fill only the exposed water band with real still-water texture; rock pixels stay isotropic.
  const bottom=y+bh;if(bottom<height)ctx.drawImage(phoneBg,0,1428,1024,108,0,bottom,width,height-bottom);drawCosmicMotion(ctx,images,t,width,height,{reduced,mobile:true,contactY:l.contact.y});
 }else{
  const cover=Math.max(width/1672,height/941),bw=1672*cover,bh=941*cover;ctx.drawImage(bg,(width-bw)*.5,(height-bh)*.30,bw,bh);
  drawCosmicMotion(ctx,images,t,width,height,{reduced,mobile:false,contactY:l.contact.y});ctx.save();const r=l.rock;ctx.translate(r.x,r.y);ctx.scale(r.w/960,r.h/206);path(ctx,[[0,206],[39,100],[81,43],[160,16],[300,5],[550,1],[744,17],[824,38],[906,112],[960,206]]);ctx.clip();ctx.drawImage(bg,480,735,960,206,0,0,960,206);ctx.restore();
 }
 const verified=isVerifiedSceneFill(cue,now)?cue:null,celebration=cue?.kind==='profit'&&isVerifiedCue(cue,now)?cue:null;
 const recorded=markers.filter(m=>sceneInstrument(m.asset));
 const items=new Map(catalogue.map(m=>[m.id,{...m,asset:m.id,label:m.base,kind:'discovered',active:false,opacity:.72}]));
 // This is display-only replacement of the exact same venue/pair. It never
 // converts catalogue metadata into a receipt or changes its instrument identity.
 for(const m of recorded){for(const [id,n]of items)if(n.kind==='discovered'&&n.venue.toLowerCase()===m.venue.toLowerCase()&&n.pair===m.pair)items.delete(id);items.set(m.asset,m);}
 if(verified&&!items.has(verified.asset))items.set(verified.asset,{asset:verified.asset,...sceneInstrument(verified.asset),kind:verified.kind,active:true,opacity:1});
 const hint=choreography(reduced?0:actorTime,width,height,{reduced});
 const nodes=constellationLayout(width,height,[...items.values()],{masks,focus:verified?.asset,eye:hint.eyes[0]});
 const active=verified?nodes.find(n=>n.asset===verified.asset):nodes.filter(n=>n.active).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)).at(-1);
 const looking=active??nodes[Math.floor((reduced?0:actorTime)/5)%Math.max(1,nodes.length)]??{x:width*.8,y:height*.4};
 const actor=choreography(reduced?0:actorTime,width,height,{reduced,eventId:verified?.eventId??celebration?.eventId,target:looking,cue:verified??celebration,now,actionVariant});
 // A real fill may only fire at a visible marker ahead of both eye anchors.
 const target=verified?active:null;
 if(!target||masks.some(m=>target.x>=m.left&&target.x<=m.right&&target.y>=m.top&&target.y<=m.bottom))actor.fire=false;
 const feet=actor.feet,eyes=actor.eyes,p=actor;
 const neural=drawNeuralLinks(ctx,nodes,{masks,now,reduced,time:t,mobile:l.mobile});
 for(const n of nodes){const focus=n===active,emphasis=focus||n.active,radius=emphasis?(l.mobile?11:14):n.radius;ctx.save();ctx.globalAlpha=reduced?(n.active?1:.52):(n.opacity??.3);const color=focus&&verified?(verified.kind==='buy'?'#ffd177':'#ff85bd'):n.active?'#f2c36c':'#c2e7f5';ctx.strokeStyle=color;ctx.fillStyle=n.labelVisible||emphasis?'rgba(3,15,27,.92)':color;ctx.lineWidth=emphasis?1.5:n.labelVisible?.8:.5;ctx.beginPath();ctx.arc(n.x,n.y,radius,0,Math.PI*2);ctx.fill();ctx.stroke();
  if(n.labelVisible||emphasis){ctx.fillStyle=color;ctx.font=`600 ${l.mobile?8:10}px sans-serif`;ctx.textAlign='center';ctx.fillText(n.asset==='kraken:XXBTZUSD'&&n.label==='XBT'?'BTC':n.label,n.x,n.y+(radius<7?radius+9:3),l.mobile?38:48);if(emphasis){ctx.font='6px sans-serif';ctx.fillText(String(n.venue??'').toLowerCase()==='hyperliquid'?'HYP':String(n.venue??'').toLowerCase()==='kraken'?'KRA':String(n.venue??'').toLowerCase()==='binance'?'BIN':'',n.x,n.y+radius+8);}}ctx.restore();}
 drawCharacter(ctx,images,actor);
 const color=verified?.kind==='buy'?'255,191,70':'255,100,174';const beamCount=target?drawEyeBeams(ctx,actor,target,{color,strength:1}):0;
 const caption=celebration?'SIMULATED NET PROFIT · AUD '+celebration.pnl_base.toFixed(2):verified?'SIMULATED '+verified.kind.toUpperCase()+' · '+sceneInstrument(verified.asset).pair:active?'CHECK RECORDED · '+active.pair+' · '+(active.reason??active.result??'unvalidated').replaceAll('_',' '):'LOOKING · NO NEW VERIFIED FILL';
 if(showCaption){ctx.fillStyle='rgba(3,12,28,.78)';ctx.fillRect(width*.04-5,height*.06-14,l.mobile?246:295,22);ctx.fillStyle='rgba(215,232,245,.95)';ctx.font=`${l.mobile?9:11}px sans-serif`;ctx.fillText(caption,width*.04,height*.06);}
 return {nodes,neural,beamCount,beamKey:verified?.eventId??null,feet,eyes,target,pose:p,stage:l,verified:!!verified};
}

// Bounded positions in the sky; labels never overlap controls or the rock.
const MAJORS=Object.freeze(['BTC','XBT','ETH','SOL','XRP','BNB','ADA','LINK','AVAX','DOT']);
export function constellationLayout(width,height,items,{masks=[],focus=null,eye=null}={}){
 const mobile=width<620,cols=mobile?11:16,rows=7,limit=mobile?SCENE_LIMITS.phoneCoinNodes:SCENE_LIMITS.coinNodes,slots=[];
 for(let row=0;row<rows;row++)for(let col=0;col<cols;col++){
  const x=width*(.07+.86*(col+.35*(row%2))/cols),y=height*(.175+row*.047+.009*Math.sin(col*2.4+row));
  if(x<26||x>width-26||masks.some(m=>x>=m.left-28&&x<=m.right+28&&y>=m.top-20&&y<=m.bottom+28))continue;
  slots.push({x,y,depth:row/(rows-1)});
 }
 const majorRank=n=>{const rank=MAJORS.indexOf(n.label??n.base);return rank<0?100:rank;};
 const ordered=[...items].sort((a,b)=>Number(b.asset===focus)-Number(a.asset===focus)||Number(b.kind!=='discovered')-Number(a.kind!=='discovered')||majorRank(a)-majorRank(b)||hash(a.asset)-hash(b.asset)||a.asset.localeCompare(b.asset));
 const shown=[],named=new Set();
 for(const item of ordered){if(shown.length>=limit||!slots.length)break;const major=majorRank(item),foreground=major<3,identified=item.kind!=='discovered'||item.asset===focus,labelVisible=identified||(major<8&&!named.has(item.label??item.base)),radius=identified?(mobile?11:14):foreground?(mobile?9:12):labelVisible?(mobile?4.5:6):1.7+(hash(item.asset)%16)/10;
  let index=0;
  if(item.asset===focus&&eye){const score=p=>Math.abs(p.y-eye.y)*2-Math.abs(p.x-eye.x);for(let i=1;i<slots.length;i++)if(score(slots[i])<score(slots[index]))index=i;}
  else if(labelVisible){const anchor={x:width*(foreground?(major===2?.77:.2):(.16+(shown.length%4)*.21)),y:height*(foreground?.43:.32+(shown.length%2)*.07)},score=p=>Math.hypot(p.x-anchor.x,p.y-anchor.y);for(let i=1;i<slots.length;i++)if(score(slots[i])<score(slots[index]))index=i;}
  else index=hash(item.asset)%slots.length;
  const point=slots.splice(index,1)[0];shown.push({...item,...point,radius,labelVisible,foreground});if(labelVisible)named.add(item.label??item.base);
  // Reserve only a small visual footprint. Distant identities need no badge or
  // text box, so many more real catalogue instruments fit without a label wall.
  for(let i=slots.length-1;i>=0;i--)if(Math.hypot(slots[i].x-point.x,slots[i].y-point.y)<radius+5)slots.splice(i,1);
 }
 return shown;
}

export const NEURAL_LIMITS=Object.freeze({nodes:SCENE_LIMITS.coinNodes,edges:160,pulseMs:900});
// Pure visual proximity graph. There is no financial, correlation or worker link.
function crossesMask(a,b,m){
 const left=m.left-5,right=m.right+5,top=m.top-5,bottom=m.bottom+5;
 let low=0,high=1;const dx=b.x-a.x,dy=b.y-a.y;
 for(const [p,q]of [[-dx,a.x-left],[dx,right-a.x],[-dy,a.y-top],[dy,bottom-a.y]]){
  if(p===0){if(q<0)return false;continue;}
  const r=q/p;if(p<0)low=Math.max(low,r);else high=Math.min(high,r);if(low>high)return false;
 }return true;
}
export function neuralLinks(nodes,{masks=[]}={}){
 const points=nodes.slice(0,NEURAL_LIMITS.nodes).filter(n=>Number.isFinite(n.x)&&Number.isFinite(n.y)),pairs=[],edges=[],used=new Set(),parent=points.map((_,i)=>i),degree=points.map(()=>0);
 const root=i=>{while(parent[i]!==i)i=parent[i];return i;};
 for(let i=0;i<points.length;i++)for(let j=i+1;j<points.length;j++){
  const a=points[i],b=points[j],distance=Math.hypot(b.x-a.x,b.y-a.y);
  if(distance<1||masks.some(m=>crossesMask(a,b,m)))continue;pairs.push({i,j,distance});
 }
 pairs.sort((a,b)=>a.distance-b.distance||a.i-b.i||a.j-b.j);
 const add=p=>{const key=p.i+':'+p.j;if(used.has(key)||edges.length>=NEURAL_LIMITS.edges)return false;used.add(key);degree[p.i]++;degree[p.j]++;edges.push({a:points[p.i],b:points[p.j]});return true;};
 // A minimum spanning forest joins all unobstructed groups, followed by a small
 // number of short extra paths to suggest branching neurons, not a dense mesh.
 for(const p of pairs){const a=root(p.i),b=root(p.j);if(a!==b){parent[a]=b;add(p);}}
 for(const p of pairs)if(degree[p.i]<3&&degree[p.j]<3)add(p);
 return edges;
}
let currentGeometry=null;
function currentGeometryFor(nodes,masks){
 const key=JSON.stringify([nodes.slice(0,NEURAL_LIMITS.nodes).map(n=>[n.asset,n.x,n.y,n.radius]),masks.map(m=>[m.left,m.right,m.top,m.bottom])]);
 if(currentGeometry?.key===key)return currentGeometry;
 const paths=neuralLinks(nodes,{masks}).map(({a,b},i)=>makeCurrentPath({...a},{...b},i));
 for(const path of paths){let last=path.a,blocked=false;for(let i=1;i<=8;i++){const point=curvePoint(path,i/8);if(masks.some(m=>crossesMask(last,point,m)))blocked=true;last=point;}if(blocked)path.c={x:(path.a.x+path.b.x)/2,y:(path.a.y+path.b.y)/2};}
 currentGeometry={key,paths,waves:buildCurrentWaves(paths)};return currentGeometry;
}
export function drawNeuralLinks(ctx,nodes,{masks=[],now=Date.now(),reduced=false,time=0,mobile=false}={}){
 const {paths,waves}=currentGeometryFor(nodes,masks);let pulses=0;ctx.save();ctx.setLineDash([]);ctx.lineCap='round';
 // Two batched under-strokes, rather than a blur/filter per connection.
 for(const [width,alpha]of [[mobile?2.5:3.5,.07],[mobile?.55:.7,.3]]){ctx.lineWidth=width;ctx.strokeStyle=`rgba(115,204,235,${alpha})`;ctx.beginPath();for(const path of paths){ctx.moveTo(path.a.x,path.a.y);ctx.quadraticCurveTo(path.c.x,path.c.y,path.b.x,path.b.y);}ctx.stroke();}
 const ambient=drawAmbientCurrents(ctx,paths,waves,time,{mobile,reduced});
 if(!reduced){for(const node of nodes.slice(0,NEURAL_LIMITS.nodes)){
  // Separate amber evidence accent. Only a short-lived validated check marker
  // reaches this path; ambient time can never create evidence or an eye beam.
  if(node.kind!=='checked'||node.active!==true||!Number.isFinite(node.until)||!Number.isFinite(now)||now>=node.until||now<Date.parse(node.at)||now-Date.parse(node.at)>TARGET_LIMITS.freshMs)continue;
  const start=node.until-(node.result==='pending'?TARGET_LIMITS.pendingMs:TARGET_LIMITS.checkMs),progress=(now-start)/NEURAL_LIMITS.pulseMs;
  if(progress<0||progress>=1)continue;
  const branches=paths.filter(p=>p.a.asset===node.asset||p.b.asset===node.asset).slice(0,3);if(!branches.length)continue;
  for(const path of branches)drawCurrentPacket(ctx,path,progress,{reverse:path.a.asset===node.asset,color:'255,198,107',alpha:Math.sin(Math.PI*progress),mobile});pulses++;
 }}ctx.restore();return {edgeCount:paths.length,pulses,...ambient,curveCount:paths.length};
}
