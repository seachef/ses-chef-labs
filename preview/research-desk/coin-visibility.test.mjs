import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createCanvas,loadImage} from './canvas-test-support.mjs';
import {configureCosmicCanvas} from './cosmic-motion.mjs?v=neptune-native-20261009';
import {ASSETS,renderScene,constellationLayout,SCENE_LIMITS,NEURAL_LIMITS} from './cosmos-scene.mjs?v=neural-currents-20261010';
configureCosmicCanvas(createCanvas);
const images=await Promise.all(ASSETS.map(a=>loadImage(new URL('./assets/'+a,import.meta.url).pathname)));
const catalogue=JSON.parse(fs.readFileSync(new URL('./discovery-catalogue.json',import.meta.url))).instruments;
function render(options={}){
 const canvas=createCanvas(390,430),ctx=canvas.getContext('2d'),labels=[],fillText=ctx.fillText.bind(ctx);
 ctx.fillText=(...args)=>{labels.push({text:args[0],color:ctx.fillStyle,alpha:ctx.globalAlpha,font:ctx.font});fillText(...args);};
 return {result:renderScene(ctx,images,2,390,430,{showCaption:false,...options}),labels};
}
test('history badges are lighter while fresh checks retain their distinct amber colour',()=>{
 const historical={asset:'ETH/USD',pair:'ETH/USD',venue:'Kraken',label:'ETH',kind:'recorded',active:false,opacity:.4};
 const old=render({markers:[historical]}),fresh=render({markers:[{...historical,kind:'checked',active:true,opacity:1}]}),discovery=render({catalogue:[catalogue.find(x=>x.base==='ETH')]});
 const oldLabel=old.labels.find(x=>x.text==='ETH'),freshLabel=fresh.labels.find(x=>x.text==='ETH'),catalogueLabel=discovery.labels.find(x=>x.text==='ETH');
 assert.equal(oldLabel.color,'#c2e7f5');assert.ok(Math.abs(oldLabel.alpha-.4)<=1/255);assert.match(oldLabel.font,/600/);
 assert.equal(freshLabel.color,'#f2c36c');assert.equal(freshLabel.alpha,1);assert.ok(oldLabel.alpha<catalogueLabel.alpha&&catalogueLabel.alpha<freshLabel.alpha);
 assert.ok(Math.abs(catalogueLabel.alpha-.72)<=1/255);assert.equal(discovery.result.nodes[0].active,false);
 for(const {result} of [old,fresh,discovery]){assert.equal(result.beamCount,0);assert.equal(result.verified,false);}
});
test('reduced motion keeps lighter history static and cannot imply live activity',()=>{
 const a=render({catalogue,reduced:true}),b=render({catalogue,reduced:true});
 assert.deepEqual(a.labels,b.labels);assert.ok(a.labels.every(x=>Math.abs(x.alpha-.52)<=1/255));
 assert.equal(a.result.beamCount,0);assert.equal(a.result.neural.pulses,0);assert.ok(a.result.nodes.every(x=>!x.active));
});
test('smaller distant identities fill the sky while major foreground anchors remain legible',()=>{
 const items=catalogue.map(x=>({...x,asset:x.id,label:x.base,kind:'discovered',active:false}));
 for(const [w,h,min,max]of [[320,400,64,64],[390,430,64,64],[768,600,100,100],[1180,500,100,100]]){
  const nodes=constellationLayout(w,h,items);
  assert.ok(nodes.length>=min&&nodes.length<=max,`${w}: ${nodes.length}`);assert.equal(new Set(nodes.map(x=>x.asset)).size,nodes.length);assert.ok(nodes.filter(x=>x.labelVisible).length<=8);assert.ok(nodes.filter(x=>!x.labelVisible).every(x=>x.radius<=3.2));for(const ticker of ['XBT','ETH'])assert.ok(nodes.find(x=>x.label===ticker)?.foreground);
  for(const n of nodes){assert.ok(n.x>=26&&n.x<=w-26);assert.ok(n.y>=h*.16&&n.y<=h*.47);assert.equal(n.active,false);}
  for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++)assert.ok(Math.hypot(nodes[i].x-nodes[j].x,nodes[i].y-nodes[j].y)>=7);
 }
 assert.equal(SCENE_LIMITS.coinNodes,100);assert.equal(SCENE_LIMITS.phoneCoinNodes,64);assert.equal(NEURAL_LIMITS.nodes,100);assert.equal(NEURAL_LIMITS.edges,160);
});
test('added density continues to yield to controls rather than crowding masked areas',()=>{
 const items=catalogue.map(x=>({...x,asset:x.id,label:x.base,kind:'discovered',active:false}));
 for(const [w,h]of [[320,400],[390,430],[768,600],[1180,500]]){
  const masks=[{left:0,right:w*.7,top:0,bottom:h*.25}];
  for(const n of constellationLayout(w,h,items,{masks}))for(const m of masks)assert.ok(!(n.x>=m.left-28&&n.x<=m.right+28&&n.y>=m.top-20&&n.y<=m.bottom+28));
  assert.deepEqual(constellationLayout(w,h,items,{masks:[{left:0,right:w,top:0,bottom:h}]}),[]);
 }
});
