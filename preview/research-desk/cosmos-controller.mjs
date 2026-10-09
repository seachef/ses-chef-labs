import {createActionSelector} from './character-motion.mjs?v=neptune-native-20261009';
import {ASSETS,SCENE_LIMITS,renderScene} from './cosmos-scene.mjs?v=neptune-native-20261009';
export {createPaperCueBridge} from './paper-eye-cues.mjs?v=neptune-native-20261009';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),finite=(v,d=0)=>Number.isFinite(v)?v:d;
export function makeCosmosScene({canvas,ctx,request,cancel,getDpr=()=>1,getCue=()=>null,onBeam=()=>{},showCaption=true,showMarketLabels=true,getMarketPositions=()=>[],createImage=()=>new Image()}){
 let width=0,height=0,frame=0,last=null,time=0,actorTime=0,enabled=false,visible=true,inView=true,destroyed=false,failed=!ctx;
 const selector=createActionSelector();
 const images=new Array(6),listeners=[],available=new Set();
 const ready=()=>!failed&&available.has(1)&&available.has(2)&&available.has(4)&&available.has(5)&&available.has(width<620?3:0);
 const active=()=>!destroyed&&enabled&&visible&&inView&&ready()&&width>0&&height>0;
 function reveal(show){if(canvas.style)canvas.style.opacity=show?'1':'0';}
 function paint(){if(destroyed||!visible||!inView||!ready()||!width||!height)return;try{const cue=getCue();const result=renderScene(ctx,images,time,width,height,{reduced:!enabled,cue,actorTime,actionVariant:selector.select(cue),now:Date.now(),showCaption,showMarketLabels,marketPositions:getMarketPositions()});reveal(true);onBeam(result);}catch{failed=true;reveal(false);}}
 function queue(){if(active()&&!frame)frame=request(tick);}
 function tick(now){frame=0;if(!active())return;if(Number.isFinite(now)&&(last===null||now-last>=1000/24)){const dt=last===null?0:clamp((now-last)/1000,0,.05);time=(time+dt)%86400;if(!getCue())actorTime=(actorTime+dt)%86400;last=now;paint();}queue();}
 function sync(){if(frame)cancel(frame);frame=0;last=null;if(!ready())reveal(false);paint();queue();}
 function load(index){if(images[index]||failed||destroyed)return;const im=createImage();images[index]=im;const loaded=()=>{if(im.naturalWidth>0)available.add(index);else failed=true;sync();},error=()=>{failed=true;reveal(false);sync();};listeners.push({im,loaded,error});im.addEventListener('load',loaded);im.addEventListener('error',error);im.src=new URL('./assets/'+ASSETS[index],import.meta.url).href;}
 return {
  resize(){if(destroyed)return;const b=canvas.getBoundingClientRect();width=clamp(finite(b.width),0,8192);height=clamp(finite(b.height),0,8192);const dpr=Math.min(clamp(finite(getDpr(),1),.25,SCENE_LIMITS.maxDpr),Math.sqrt(SCENE_LIMITS.maxPixels/Math.max(1,width*height)));canvas.width=Math.floor(width*dpr);canvas.height=Math.floor(height*dpr);if(ctx)ctx.setTransform(dpr,0,0,dpr,0,0);load(1);load(2);load(4);load(5);load(width<620?3:0);sync();},
  setState(state={}){if(destroyed)return;for(const key of['enabled','visible','inView'])if(key in state&&typeof state[key]!=='boolean')throw Error('Invalid motion state');if('enabled'in state)enabled=state.enabled;if('visible'in state)visible=state.visible;if('inView'in state)inView=state.inView;sync();},
  refresh(){paint();},
  destroy(){destroyed=true;if(frame)cancel(frame);frame=0;for(const {im,loaded,error}of listeners){im.removeEventListener('load',loaded);im.removeEventListener('error',error);}images.length=0;listeners.length=0;available.clear();reveal(false);},
  snapshot:()=>({width,height,frame,time,actorTime,active:active(),ready:ready(),failed,loadedImages:images.filter(Boolean).length})
 };
}
