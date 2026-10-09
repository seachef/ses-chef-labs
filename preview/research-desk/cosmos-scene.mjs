import {isVerifiedCue} from './paper-eye-cues.mjs?v=neptune-v2-20261009-r8';
export {createPaperCueBridge} from './paper-eye-cues.mjs?v=neptune-v2-20261009-r8';
// Standalone visual prototype. Every cue in this module is explicitly decorative.
export const SCENE_LIMITS=Object.freeze({cycle:7.5,stars:24,coinNodes:6,companions:3,maxDpr:1.25,maxPixels:1800000});
export const ASSETS=['cosmos-ocean-background.png','neptune-body-clean.png','neptune-head-clean.png','cosmos-ocean-phone.png'];
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),ease=(a,b,t)=>{const u=clamp((t-a)/(b-a),0,1);return u*u*(3-2*u);};
const I=[1,0,0,1,0,0];
export const mul=(a,b)=>[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
const move=(x,y)=>[1,0,0,1,x,y],rotate=r=>[Math.cos(r),Math.sin(r),-Math.sin(r),Math.cos(r),0,0],scale=(x,y=x)=>[x,0,0,y,0,0];
export const point=(m,x,y)=>({x:m[0]*x+m[2]*y+m[4],y:m[1]*x+m[3]*y+m[5]});
const around=(x,y,m)=>mul(move(x,y),mul(m,move(-x,-y)));
export function pose(time){const t=Number.isFinite(time)?(((time*2.4)%18)+18)%18:0,section=Math.floor(t/6),q=t%6,attend=ease(.7,2.2,q)*(1-ease(4.6,5.8,q)),beam=ease(2.4,2.9,q)*(1-ease(3.9,4.5,q));return {t,section,attend,beam,torso:-.075*attend+.014*Math.sin(t*.8),head:-.20*attend+.055*Math.sin(t*.67),yaw:1-.12*attend,upperArm:-.58*attend,forearm:-.63*attend};}
export function layout(width,height){const mobile=width<620,s=Math.min(height*(mobile?.32:.43)/1460,width*.53/820),rock={x:width*.06,y:height*.60,w:width*.88,h:height*.40};const contact=mobile?{x:width*.5,y:height*.70}:{x:rock.x+420/960*rock.w,y:rock.y+55/206*rock.h};return {mobile,rock,contact,s,root:mul(move(contact.x,contact.y),mul(scale(s),move(-585,-1460)))};}

function solveArm(shoulder,wrist,l1,l2){const dx=wrist.x-shoulder.x,dy=wrist.y-shoulder.y,d=clamp(Math.hypot(dx,dy),Math.abs(l1-l2)+.001,l1+l2-.001),a=Math.atan2(dy,dx)-Math.acos(clamp((l1*l1+d*d-l2*l2)/(2*l1*d),-1,1));return {x:shoulder.x+Math.cos(a)*l1,y:shoulder.y+Math.sin(a)*l1};}
function bone(sx,sy,ex,ey,start,end){return mul(move(start.x,start.y),mul(rotate(Math.atan2(end.y-start.y,end.x-start.x)-Math.atan2(ey-sy,ex-sx)),move(-sx,-sy)));}
export function skeleton(time,width,height){const p=pose(time),l=layout(width,height),torso=around(560,640,rotate(p.torso));const head=mul(torso,around(565,300,mul(rotate(p.head),scale(p.yaw,1))));const upper=mul(torso,around(705,365,rotate(p.upperArm))),fore=mul(upper,around(790,555,rotate(p.forearm)));const shoulder=point(torso,430,365),wrist={x:220,y:600},elbow=solveArm(shoulder,wrist,Math.hypot(70,155),Math.hypot(140,80));return {p,l,torso,head,upper,fore,leftUpper:bone(430,365,360,520,shoulder,elbow),leftFore:bone(360,520,220,600,elbow,wrist),eyes:[[580,206],[619,211]].map(([x,y])=>point(mul(l.root,head),x,y)),feet:[[320,1460],[850,1460]].map(([x,y])=>point(l.root,x,y))};}
const POLY={
 lower:[[424,590],[641,580],[719,696],[775,855],[884,1082],[936,1255],[999,1375],[951,1467],[828,1480],[770,1410],[673,1160],[635,1010],[573,1270],[492,1398],[435,1445],[390,1466],[216,1458],[234,1415],[316,1360],[337,1180],[389,961],[307,1064],[130,1225],[44,1240],[66,1175],[225,1012],[302,852],[364,733]],
 torso:[[463,252],[584,236],[659,239],[754,291],[794,347],[739,426],[700,482],[671,550],[659,655],[439,660],[423,548],[435,445],[345,415],[369,335]],
 upper:[[679,324],[744,344],[797,429],[828,546],[815,591],[763,600],[727,517],[697,452]],
 fore:[[765,532],[823,518],[867,573],[891,673],[882,768],[861,814],[840,825],[824,807],[805,825],[786,799],[797,758],[817,699],[772,621]],
 leftUpper:[[400,367],[459,390],[430,484],[386,555],[340,552],[322,516],[353,434]],
 leftFore:[[341,508],[389,548],[392,588],[329,622],[275,637],[253,665],[188,667],[168,637],[162,607],[186,571],[229,557],[262,569],[320,531]],
 staff:[[164,0],[185,67],[207,154],[256,191],[271,273],[304,346],[270,395],[243,439],[225,480],[238,577],[253,806],[256,1084],[279,1282],[264,1340],[245,1399],[211,1346],[190,1308],[207,1225],[211,1030],[206,792],[204,610],[200,483],[153,447],[139,409],[116,363],[74,303],[98,271],[101,191],[146,112]],
 head:[[499,20],[555,98],[584,196],[678,257],[779,230],[811,77],[857,102],[892,266],[929,375],[897,436],[872,589],[940,708],[994,841],[1009,979],[936,1119],[816,1116],[779,1274],[694,1233],[618,1179],[557,1073],[495,1162],[395,1184],[283,1326],[181,1347],[106,1261],[25,1364],[4,1221],[39,1070],[10,943],[84,781],[213,686],[369,590],[403,474],[339,438],[345,356],[403,407],[402,332],[448,375],[423,291],[472,352],[478,211],[491,273],[497,150]]
};
function path(ctx,poly){ctx.beginPath();poly.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();}
function piece(ctx,image,poly,m=I){ctx.save();ctx.transform(...m);path(ctx,poly);ctx.clip();ctx.drawImage(image,0,0);ctx.restore();}
function shadow(ctx,p,s){ctx.save();ctx.translate(p.x,p.y+1);for(let i=6;i>=1;i--){ctx.fillStyle=`rgba(0,0,0,${.045+(7-i)*.01})`;ctx.beginPath();ctx.ellipse(0,0,s*(55+i*5),s*(6+i*2),0,0,Math.PI*2);ctx.fill();}ctx.restore();}
export function renderScene(ctx,images,time,width,height,{reduced=false,cue=null,now=Date.now(),showCaption=true,showMarketLabels=true,marketPositions=[]}={}){const [bg,body,headImage,phoneBg]=images,t=reduced?0:time,{p,l,torso,head,upper,fore,leftUpper,leftFore,eyes,feet}=skeleton(t,width,height);ctx.clearRect(0,0,width,height);
 if(l.mobile&&phoneBg){
  const cover=Math.max(width/1024,height/1536),bw=1024*cover,bh=1536*cover,y=l.contact.y-1180*cover,x=(width-bw)*.5;
  ctx.drawImage(phoneBg,x,y,bw,bh);
  // Fill only the exposed water band with real still-water texture; rock pixels stay isotropic.
  const bottom=y+bh;if(bottom<height)ctx.drawImage(phoneBg,0,1428,1024,108,0,bottom,width,height-bottom);
 }else{
  const cover=Math.max(width/1672,height/941),bw=1672*cover,bh=941*cover;ctx.drawImage(bg,(width-bw)*.5,(height-bh)*.30,bw,bh);
  ctx.save();const r=l.rock;ctx.translate(r.x,r.y);ctx.scale(r.w/960,r.h/206);path(ctx,[[0,206],[39,100],[81,43],[160,16],[300,5],[550,1],[744,17],[824,38],[906,112],[960,206]]);ctx.clip();ctx.drawImage(bg,480,735,960,206,0,0,960,206);ctx.restore();
 }
 for(const f of feet)shadow(ctx,f,l.s);
 ctx.save();ctx.transform(...l.root);piece(ctx,body,POLY.lower);piece(ctx,body,POLY.staff);piece(ctx,body,POLY.leftUpper,leftUpper);piece(ctx,body,POLY.leftFore,leftFore);piece(ctx,body,POLY.torso,torso);piece(ctx,body,POLY.upper,upper);piece(ctx,body,POLY.fore,fore);
 ctx.save();ctx.transform(...head);ctx.translate(329,22);ctx.scale(.36,.36);piece(ctx,headImage,POLY.head);ctx.restore();ctx.restore();
 const nodes=[{label:'ETH',x:width*.73,y:height*.24},{label:'SOL',x:width*.88,y:height*.41},{label:'AVAX',x:width*.63,y:height*.35},{label:'LINK',x:width*.77,y:height*.16},{label:'AAVE',x:width*.87,y:height*.30},{label:'UNI',x:width*.60,y:height*.22}].map(node=>{const shared=marketPositions.find(p=>p.label===node.label&&Number.isFinite(p.x)&&Number.isFinite(p.y));return shared?{...node,x:clamp(shared.x,0,width),y:clamp(shared.y,0,height)}:node;});
 const verified=isVerifiedCue(cue,now)?cue:null,target=verified?nodes.find(n=>n.label===verified.asset.split('/')[0]):nodes[p.section];
 const shown=verified?nodes.filter((n,i)=>i<3||n===target):nodes.slice(0,3);
 for(const n of shown){const active=n===target;ctx.fillStyle=active?'rgba(137,230,245,.85)':'rgba(203,213,231,.7)';ctx.beginPath();ctx.arc(n.x,n.y,active?3.5:2.5,0,Math.PI*2);ctx.fill();if(showMarketLabels){ctx.fillStyle='rgba(3,12,28,.8)';ctx.fillRect(n.x+6,n.y-10,45,19);ctx.fillStyle=active?'#d6fbff':'#d0daec';ctx.font=`${l.mobile?10:12}px sans-serif`;ctx.fillText(n.label,n.x+10,n.y+4);}}
 const strength=verified?.85:p.beam,color=verified?(verified.kind==='buy'?'248,211,126':verified.kind==='sell'?'234,166,231':'199,193,245'):'129,231,255';
 if(!reduced&&strength>0&&target){ctx.save();ctx.setLineDash(verified?[]:[4,5]);ctx.strokeStyle=`rgba(${color},${strength*.8})`;ctx.lineWidth=verified?2:(l.mobile?1:1.25);for(const eye of eyes){ctx.beginPath();ctx.moveTo(eye.x,eye.y);ctx.lineTo(target.x,target.y);ctx.stroke();ctx.fillStyle=`rgba(${color},${strength})`;ctx.beginPath();ctx.arc(eye.x,eye.y,l.mobile?1.3:2,0,Math.PI*2);ctx.fill();}ctx.restore();}
 // Three quiet system-role companions. Their orbit is decorative; pulse needs a trusted cue.
 const companionCenter=point(l.root,585,565),roles=['Scout','Risk','Trades'];
 for(let i=0;i<3;i++){const role=roles[i],angle=t*.26+i*Math.PI*2/3,x=companionCenter.x+Math.cos(angle)*(l.mobile?70:86),y=companionCenter.y+Math.sin(angle)*(l.mobile?31:42),pulse=verified?.role===role?Math.sin(clamp((now-verified.createdAt)/2600,0,1)*Math.PI)**2:0;
  for(let j=2;j>=0;j--){ctx.fillStyle=`rgba(${i===0?'128,213,247':i===1?'196,177,238':'234,208,144'},${(.10+.09*(2-j)+pulse*.13)})`;ctx.beginPath();ctx.arc(x,y,3.5+j*2+pulse*2,0,Math.PI*2);ctx.fill();}
  const labelX=companionCenter.x+(x>=companionCenter.x?(l.mobile?80:100):-(l.mobile?115:135));ctx.fillStyle='rgba(3,12,28,.72)';ctx.fillRect(labelX-3,y-9,role==='Trades'?41:35,17);ctx.fillStyle='rgba(206,224,236,.88)';ctx.font=`${l.mobile?9:10}px sans-serif`;ctx.fillText(role,labelX,y+3);
 }
 const caption=verified?(verified.kind==='review'?'PAPER REVIEW · UNVALIDATED · ':'SIMULATED '+verified.kind.toUpperCase()+' · ')+target.label:'AMBIENT SCAN · NOT A TRADE SIGNAL';
 if(showCaption){ctx.fillStyle='rgba(3,12,28,.78)';ctx.fillRect(width*.04-5,height*.06-14,l.mobile?246:295,22);ctx.fillStyle='rgba(215,232,245,.95)';ctx.font=`${l.mobile?9:11}px sans-serif`;ctx.fillText(caption,width*.04,height*.06);}
 return {feet,eyes,target,pose:p,stage:l,verified:!!verified};
}
