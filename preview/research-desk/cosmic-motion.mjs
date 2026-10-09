// Decorative sky only. No clocks, financial state, events or network activity.
const TAU=Math.PI*2;
export const COSMIC_LIMITS=Object.freeze({galaxies:3,stars:44,ringParticles:104,ringBands:14,textureSize:512});
let canvasFactory=null,cache=new WeakMap();
export function configureCosmicCanvas(factory){canvasFactory=factory;cache=new WeakMap();}
function canvas(w,h){if(canvasFactory)return canvasFactory(w,h);if(typeof OffscreenCanvas!=='undefined')return new OffscreenCanvas(w,h);if(typeof document!=='undefined'){const c=document.createElement('canvas');c.width=w;c.height=h;return c;}return null;}
const fract=x=>x-Math.floor(x),noise=i=>fract(Math.sin(i*127.1+311.7)*43758.5453);
export function cosmicGeometry(width,height,mobile=width<620,contactY=height*.7){
 const sw=mobile?1024:1672,sh=mobile?1536:941,cover=Math.max(width/sw,height/sh),bw=sw*cover,bh=sh*cover,x=(width-bw)*.5,y=mobile?contactY-1180*cover:(height-bh)*.30;
 return {sw,sh,cover,x,y,bw,bh,horizon:y+(mobile?995:610)*cover,mobile};
}
export function cosmicState(time=0,{reduced=false}={}){const t=reduced||!Number.isFinite(time)?0:Math.max(0,time);return {time:t,galaxyAngles:[t*.065,-t*.047,t*.083],skyX:Math.sin(t*.07)*16,skyY:Math.sin(t*.045)*5,ringAngle:t*.29,planetSpin:t*.075};}
const centers={desktop:[[1384,322,252],[354,153,146],[229,370,110]],mobile:[[809,593,223],[320,176,151],[208,550,105]]};
function textures(image,mobile){let entry=cache.get(image);if(entry?.mobile===mobile)return entry;const sprites=[];for(const [x,y,r]of centers[mobile?'mobile':'desktop']){const c=canvas(512,512);if(!c)return null;const q=c.getContext('2d');q.drawImage(image,x-r,y-r,2*r,2*r,0,0,512,512);q.globalCompositeOperation='destination-in';const g=q.createRadialGradient(256,256,140,256,256,254);g.addColorStop(0,'rgba(0,0,0,1)');g.addColorStop(.55,'rgba(0,0,0,.94)');g.addColorStop(1,'rgba(0,0,0,0)');q.fillStyle=g;q.fillRect(0,0,512,512);sprites.push(c);}entry={mobile,sprites};cache.set(image,entry);return entry;}
function rings(ctx,r,t,front){ctx.save();ctx.rotate(-.31);ctx.scale(1,.34);const start=front?0:Math.PI,end=front?Math.PI:TAU;for(let i=0;i<COSMIC_LIMITS.ringBands;i++){const rr=r*(1.45+i*.071);ctx.strokeStyle=`rgba(${i%3===0?'93,130,145':i%2?'212,180,131':'159,151,137'},${i===7?.12:.49})`;ctx.lineWidth=r*.069;ctx.beginPath();ctx.arc(0,0,rr,start,end);ctx.stroke();}
 for(let i=0;i<COSMIC_LIMITS.ringParticles;i++){const radius=r*(1.44+noise(i+20)*.97),a=(noise(i+90)*TAU+t*(.68+noise(i+300)*.4))%TAU;if((Math.sin(a)>=0)!==front)continue;const length=.015+noise(i+700)*.075;ctx.strokeStyle=`rgba(236,213,167,${.19+noise(i+230)*.49})`;ctx.lineWidth=r*(.009+noise(i)*.017);ctx.beginPath();ctx.arc(0,0,radius,a,a+length);ctx.stroke();}
 // Three distinct travelling dust plumes, readable at phone size. Clip each
 // hemisphere so a plume crossing the limb never pops between draw layers.
 ctx.save();ctx.beginPath();ctx.rect(-r*3,front?0:-r*3,r*6,r*3);ctx.clip();
 for(let i=0;i<3;i++){const radius=r*[1.58,1.94,2.29][i],a=i*2.19+t*(1.30+i*.14),length=[.78,.49,.37][i];for(let j=0;j<8;j++){ctx.strokeStyle=`rgba(${i===1?'164,211,224':'255,238,195'},${.18+j*.105})`;ctx.lineWidth=r*[.15,.13,.12][i];ctx.beginPath();ctx.arc(0,0,radius,a+j*length/8,a+(j+1)*length/8+.004);ctx.stroke();}}ctx.restore();ctx.restore();}
function saturn(ctx,x,y,r,state){ctx.save();ctx.translate(x,y);rings(ctx,r,state.ringAngle,false);const g=ctx.createRadialGradient(-r*.45,-r*.5,r*.04,0,0,r*1.15);g.addColorStop(0,'#dbccb0');g.addColorStop(.36,'#a99c86');g.addColorStop(.74,'#4d5d66');g.addColorStop(1,'#071323');ctx.fillStyle=g;ctx.beginPath();ctx.arc(0,0,r,0,TAU);ctx.fill();ctx.save();ctx.beginPath();ctx.arc(0,0,r,0,TAU);ctx.clip();ctx.rotate(-.31);for(let i=0;i<12;i++){const yy=(-.94+i*.16)*r;ctx.strokeStyle=`rgba(${i%2?'232,206,155':'14,30,45'},.16)`;ctx.lineWidth=r*.07;ctx.beginPath();ctx.ellipse(Math.sin(state.planetSpin+i)*r*.22,yy,r*1.22,r*.11,0,0,TAU);ctx.stroke();}const shade=ctx.createLinearGradient(-r,0,r,0);shade.addColorStop(0,'rgba(2,10,23,0)');shade.addColorStop(.57,'rgba(2,10,23,.07)');shade.addColorStop(1,'rgba(2,10,23,.83)');ctx.fillStyle=shade;ctx.fillRect(-r,-r,r*2,r*2);
 // Ring shadow and a narrow lit limb place the sphere inside its tilted disk.
 ctx.strokeStyle='rgba(0,8,18,.43)';ctx.lineWidth=r*.13;ctx.beginPath();ctx.ellipse(0,r*.02,r*1.68,r*.34,0,0,Math.PI);ctx.stroke();ctx.restore();
 const rim=ctx.createLinearGradient(-r,-r,r,r);rim.addColorStop(0,'rgba(241,222,177,.8)');rim.addColorStop(.48,'rgba(145,193,206,.17)');rim.addColorStop(1,'rgba(0,0,0,0)');ctx.strokeStyle=rim;ctx.lineWidth=Math.max(.55,r*.021);ctx.beginPath();ctx.arc(0,0,r,0,TAU);ctx.stroke();rings(ctx,r,state.ringAngle,true);ctx.restore();}
export function drawCosmicMotion(ctx,images,time,width,height,{reduced=false,mobile=width<620,contactY=height*.7}={}){
 const image=mobile?images[3]:images[0];if(!image||width<=0||height<=0)return null;const g=cosmicGeometry(width,height,mobile,contactY),s=cosmicState(time,{reduced}),skyHeight=Math.max(0,Math.min(height,g.horizon));if(!skyHeight)return {geometry:g,state:s};
 ctx.save();ctx.beginPath();ctx.rect(0,0,width,skyHeight-1);ctx.clip();
 // The entire deep sky drifts; the horizon, sea and rock are never transformed.
 ctx.drawImage(image,0,0,g.sw,mobile?994:609,g.x+s.skyX*g.cover,g.y+s.skyY*g.cover,g.bw,(mobile?994:609)*g.cover);
 const tex=textures(image,mobile);if(tex){centers[mobile?'mobile':'desktop'].forEach(([x,y,r],i)=>{ctx.save();ctx.translate(g.x+x*g.cover+s.skyX*g.cover,g.y+y*g.cover+s.skyY*g.cover);ctx.rotate(s.galaxyAngles[i]);ctx.globalAlpha=.96;ctx.drawImage(tex.sprites[i],-r*g.cover,-r*g.cover,2*r*g.cover,2*r*g.cover);ctx.restore();});}
 // Sparse nearer stars travel across the farther photographic sky without flashes.
 for(let i=0;i<COSMIC_LIMITS.stars;i++){const depth=.35+noise(i+600)*.65,x=fract(noise(i)+s.time*.0008*depth)*width,y=noise(i+55)*skyHeight*.92,r=.45+depth*.8;ctx.globalAlpha=.23+depth*.32;ctx.fillStyle=i%4===0?'#e3d4b4':'#c9e8f5';ctx.beginPath();ctx.arc(x,y,r,0,TAU);ctx.fill();}ctx.globalAlpha=1;
 const r=Math.min(width*(mobile?.055:.039),height*.058);saturn(ctx,width*(mobile?.77:.73),skyHeight*.20,r,s);
 // A stationary haze band makes the moving sky meet the calm water seamlessly.
 const horizon=ctx.createLinearGradient(0,skyHeight-30*g.cover,0,skyHeight);horizon.addColorStop(0,'rgba(12,47,81,0)');horizon.addColorStop(.88,'rgba(28,87,130,.4)');horizon.addColorStop(1,'rgba(107,181,218,.65)');ctx.fillStyle=horizon;ctx.fillRect(0,skyHeight-30*g.cover,width,30*g.cover);ctx.restore();return {geometry:g,state:s};
}
