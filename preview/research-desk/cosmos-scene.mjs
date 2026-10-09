import {isVerifiedCue} from './paper-eye-cues.mjs?v=neptune-frame-20261009';
export {createPaperCueBridge} from './paper-eye-cues.mjs?v=neptune-frame-20261009';
import {choreography,drawCharacter,drawEyeBeams} from './character-motion.mjs?v=neptune-frame-20261009';
import {drawCosmicMotion} from './cosmic-motion.mjs?v=neptune-frame-20261009';
export const SCENE_LIMITS=Object.freeze({cycle:40,coinNodes:6,companions:0,maxDpr:1.25,maxPixels:1800000});
export const ASSETS=['cosmos-ocean-background.webp','neptune-run-atlas.png','neptune-braced-aim.png','cosmos-ocean-phone.webp','neptune-tucked-roll.png','neptune-transition-atlas.png'];
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function layout(width,height){const mobile=width<620,rock={x:width*.06,y:height*.60,w:width*.88,h:height*.40};return{mobile,rock,contact:{x:width*.5,y:height*.70}};}
function path(ctx,poly){ctx.beginPath();poly.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();}
export function renderScene(ctx,images,time,width,height,{reduced=false,cue=null,now=Date.now(),showCaption=true,showMarketLabels=true,marketPositions=[],actionVariant=null,actorTime=time}={}){const [bg,,,phoneBg]=images,t=reduced?0:time,l=layout(width,height);ctx.clearRect(0,0,width,height);
 if(l.mobile&&phoneBg){
  const cover=Math.max(width/1024,height/1536),bw=1024*cover,bh=1536*cover,y=l.contact.y-1180*cover,x=(width-bw)*.5;
  ctx.drawImage(phoneBg,x,y,bw,bh);
  // Fill only the exposed water band with real still-water texture; rock pixels stay isotropic.
  const bottom=y+bh;if(bottom<height)ctx.drawImage(phoneBg,0,1428,1024,108,0,bottom,width,height-bottom);drawCosmicMotion(ctx,images,t,width,height,{reduced,mobile:true,contactY:l.contact.y});
 }else{
  const cover=Math.max(width/1672,height/941),bw=1672*cover,bh=941*cover;ctx.drawImage(bg,(width-bw)*.5,(height-bh)*.30,bw,bh);
  drawCosmicMotion(ctx,images,t,width,height,{reduced,mobile:false,contactY:l.contact.y});ctx.save();const r=l.rock;ctx.translate(r.x,r.y);ctx.scale(r.w/960,r.h/206);path(ctx,[[0,206],[39,100],[81,43],[160,16],[300,5],[550,1],[744,17],[824,38],[906,112],[960,206]]);ctx.clip();ctx.drawImage(bg,480,735,960,206,0,0,960,206);ctx.restore();
 }
 const nodes=[{label:'ETH',x:width*(l.mobile?.07:.16),y:height*.48},{label:'SOL',x:width*.88,y:height*.41},{label:'AVAX',x:width*.63,y:height*.35},{label:'LINK',x:width*.77,y:height*.16},{label:'AAVE',x:width*.87,y:height*.30},{label:'UNI',x:width*.60,y:height*.22}].map(node=>{const shared=marketPositions.find(p=>p.label===node.label&&Number.isFinite(p.x)&&Number.isFinite(p.y));return shared?{...node,x:clamp(shared.x,0,width),y:clamp(shared.y,0,height)}:node;});
 const verified=isVerifiedCue(cue,now)?cue:null,target=verified?nodes.find(n=>n.label===verified.asset.split('/')[0]):nodes[Math.floor((reduced?0:actorTime)/5)%3];
 const actor=choreography(reduced?0:actorTime,width,height,{reduced,eventId:verified?.eventId,target,cue:verified,now,actionVariant});drawCharacter(ctx,images,actor);const feet=actor.feet,eyes=actor.eyes,p=actor;
 const shown=verified?nodes.filter((n,i)=>i<3||n===target):nodes.slice(0,3);
 for(const n of shown){const active=n===target;ctx.fillStyle=active?'rgba(137,230,245,.85)':'rgba(203,213,231,.7)';ctx.beginPath();ctx.arc(n.x,n.y,active?3.5:2.5,0,Math.PI*2);ctx.fill();if(showMarketLabels){ctx.fillStyle='rgba(3,12,28,.8)';ctx.fillRect(n.x+6,n.y-10,45,19);ctx.fillStyle=active?'#d6fbff':'#d0daec';ctx.font=`${l.mobile?10:12}px sans-serif`;ctx.fillText(n.label,n.x+10,n.y+4);}}
 const color=verified?(verified.kind==='buy'?'255,191,70':verified.kind==='sell'?'255,100,174':'186,153,255'):'80,225,255';drawEyeBeams(ctx,actor,target,{color,strength:1});
 const caption=verified?(verified.kind==='review'?'PAPER REVIEW · UNVALIDATED · ':'SIMULATED '+verified.kind.toUpperCase()+' · ')+target.label:'AMBIENT SCAN · NOT A TRADE SIGNAL';
 if(showCaption){ctx.fillStyle='rgba(3,12,28,.78)';ctx.fillRect(width*.04-5,height*.06-14,l.mobile?246:295,22);ctx.fillStyle='rgba(215,232,245,.95)';ctx.font=`${l.mobile?9:11}px sans-serif`;ctx.fillText(caption,width*.04,height*.06);}
 return {feet,eyes,target,pose:p,stage:l,verified:!!verified};
}
