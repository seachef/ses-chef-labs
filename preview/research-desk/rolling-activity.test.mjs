import test from 'node:test';
import assert from 'node:assert/strict';
import {createRollingActivity,ROLLING_ACTIVITY_LIMITS as LIMITS} from './rolling-activity.mjs';
import {setupCodingWorkers} from './team-worker-view.mjs';
const T=Date.parse('2026-10-10T09:00:00.000Z'),iso=n=>new Date(n).toISOString();
const row=(n,{at=T+n,text='Verified recorded event '+n}={})=>({key:'event:'+n,at:iso(at),text});
class Node{
 constructor(){this.value='';this.top=0;this.clientHeight=27;this.children=[];this.events={};this.attrs={};this.open=false;this.hidden=false;}
 get textContent(){return this.value;}set textContent(value){this.value=value;this.scrollTop=this.top;}
 get scrollHeight(){return Math.max(this.clientHeight,this.value.split('\n').reduce((height,line)=>height+Math.max(1,Math.ceil(line.length/70))*14,0));}
 get scrollTop(){return this.top;}set scrollTop(value){this.top=Math.max(0,Math.min(value,this.scrollHeight-this.clientHeight));}
 set innerHTML(value){throw Error('Unsafe HTML');}setAttribute(k,v){this.attrs[k]=v;}removeAttribute(k){delete this.attrs[k];}
 addEventListener(k,v){this.events[k]=v;}removeEventListener(k,v){if(this.events[k]===v)delete this.events[k];}
 replaceChildren(...c){this.children=c;}getBoundingClientRect(){return {left:0,top:0,width:100,height:42};}
}
function clock(){let now=T+10000,time=0,id=0;const frames=new Map();return {frames,now:()=>now,setNow:value=>{now=value;},request:fn=>{frames.set(++id,fn);return id;},cancel:key=>frames.delete(key),tick(ms=50){time+=ms;now+=ms;const pending=[...frames];frames.clear();for(const [,fn] of pending)fn(time);},drain(){let count=0;while(frames.size&&count++<15000)this.tick();assert.equal(frames.size,0,'bounded activity must finish');return count;}};}
function helper(options={}){const c=clock(),element=new Node();let changes=0;const app=createRollingActivity({element,now:c.now,requestAnimationFrame:c.request,cancelAnimationFrame:c.cancel,onChange:()=>changes++,...options});app.setActive(true);return {c,element,app,changes:()=>changes};}

test('genuine batches reveal once with visible intermediate scroll and stop when drained',()=>{
 const b=helper(),records=Array.from({length:5},(_,i)=>row(i,{text:'Verified observation '+i+' '+'.'.repeat(150)}));
 b.app.update(records);assert.equal(b.app.snapshot().retained,1);assert.equal(b.app.snapshot().queued,4);assert.equal(b.element.scrollTop,0);
 b.c.tick();b.c.tick(100);assert.ok(b.element.scrollTop>0);assert.ok(b.element.scrollTop<b.element.scrollHeight-b.element.clientHeight);
 b.c.drain();assert.equal(b.app.snapshot().queued,0);assert.equal(b.app.snapshot().retained,5);assert.equal(b.app.snapshot().rolling,false);assert.equal(b.element.textContent,records.map(r=>r.text).join('\n'));
 const content=b.element.textContent;b.element.scrollTop=0;for(let i=0;i<50;i++)b.app.update(records);
 assert.equal(b.c.frames.size,0);assert.equal(b.element.scrollTop,0);assert.equal(b.element.textContent,content);
});
test('one-second renders and duplicate polls do not reset an in-flight animation',()=>{
 const b=helper(),records=Array.from({length:8},(_,i)=>row(i));b.app.update(records);
 for(let i=0;i<80;i++){b.c.tick(100);b.app.update(records);}
 assert.equal(b.app.snapshot().retained,8);assert.equal(b.app.snapshot().queued,0);assert.equal(b.c.frames.size,0);
});
test('pause retains genuine pending records and needs explicit resume',()=>{
 const b=helper();b.app.update([row(1),row(2)]);b.c.tick();b.c.tick();b.app.setPaused(true);
 const content=b.element.textContent,top=b.element.scrollTop;b.app.update([row(1),row(2),row(3)]);
 for(let i=0;i<20;i++)b.c.tick();assert.equal(b.element.textContent,content);assert.equal(b.element.scrollTop,top);assert.equal(b.c.frames.size,0);assert.equal(b.app.snapshot().queued,2);
 b.element.scrollTop=0;b.app.setPaused(false);b.c.drain();assert.equal(b.app.snapshot().retained,3);assert.equal(b.app.snapshot().paused,false);
});
test('hidden and source pauses preserve remaining work without mixing another view or replaying',()=>{
 const b=helper();b.app.update([row(1),row(2),row(3)]);b.c.tick();b.c.tick();b.app.setActive(false);
 b.element.textContent='Worker source only';b.app.update([row(1),row(2),row(3),row(4)]);b.c.tick(10000);
 assert.equal(b.element.textContent,'Worker source only');assert.equal(b.c.frames.size,0);
 b.app.setActive(true);b.c.drain();assert.equal(b.element.textContent,[1,2,3,4].map(n=>row(n).text).join('\n'));
 for(let i=0;i<5;i++){b.app.setActive(false);b.app.setActive(true);}
 assert.equal(b.c.frames.size,0);assert.equal(b.app.snapshot().retained,4);
});
test('reduced motion flushes immediately, keeps user pause and never creates animation frames',()=>{
 const b=helper({reducedMotion:true});b.app.update([row(1),row(2),row(3)]);assert.equal(b.app.snapshot().retained,3);assert.equal(b.c.frames.size,0);
 b.app.setPaused(true);b.app.update([row(4)]);assert.equal(b.app.snapshot().queued,1);b.app.setPaused(false);assert.equal(b.app.snapshot().retained,4);assert.equal(b.c.frames.size,0);
});
test('a live reduced-motion change ends animation and never replays it when changed back',()=>{
 const b=helper();b.app.update([row(1),row(2),row(3)]);assert.equal(b.c.frames.size,1);
 b.app.setReducedMotion(true);assert.equal(b.c.frames.size,0);assert.equal(b.app.snapshot().retained,3);b.app.setReducedMotion(false);assert.equal(b.c.frames.size,0);
});
test('missing frame support is an immediate safe display with no timeout substitute',()=>{
 const b=helper({requestAnimationFrame:undefined});b.app.update([row(1),row(2)]);assert.equal(b.app.snapshot().retained,2);assert.equal(b.c.frames.size,0);
});
test('pending and rendered history are bounded and evicted IDs cannot replay with changed timestamps',()=>{
 const b=helper();b.app.setPaused(true);for(let i=0;i<1000;i++)b.app.update([row(i)]);
 assert.equal(b.app.snapshot().queued,LIMITS.records);assert.equal(b.app.snapshot().oldestQueuedAt,row(860).at);b.app.setReducedMotion(true);b.app.setPaused(false);assert.equal(b.app.snapshot().retained,LIMITS.records);
 const before=b.element.textContent;b.app.update([row(0,{at:T+9999,text:'REPLAY'})]);assert.equal(b.element.textContent,before);assert.equal(b.app.snapshot().queued,0);
 for(let i=1000;i<1200;i++)b.app.update([row(i)]);assert.equal(b.app.snapshot().retained,LIMITS.records);
});
test('snapshot reports oldest queued and original event timestamps without relabelling reception as new work',()=>{
 const b=helper();b.app.setPaused(true);b.app.update([row(4),row(2),row(3)]);
 assert.equal(b.app.snapshot().oldestQueuedAt,row(2).at);assert.equal(b.app.snapshot().latestAt,row(4).at);
 b.c.tick(10000);b.app.update([row(4),row(2),row(3)]);assert.equal(b.app.snapshot().oldestQueuedAt,row(2).at);assert.equal(b.app.snapshot().latestAt,row(4).at);
});
test('expired pending records disappear without rolling old evidence on return',()=>{
 const b=helper();b.app.update([row(1),row(2)]);b.app.setActive(false);b.c.setNow(T+LIMITS.history_ms+3);b.app.update([row(1),row(2)]);b.app.setActive(true);
 assert.match(b.element.textContent,/Waiting for a verified market decision/);assert.equal(b.app.snapshot().queued,0);assert.equal(b.app.snapshot().retained,0);assert.equal(b.c.frames.size,0);
});
test('clock rollback never displays a future record or rejuvenates its identity',()=>{
 const b=helper();b.app.update([row(1),row(2)]);b.c.setNow(T);b.app.update([row(1),row(2)]);assert.equal(b.app.snapshot().retained,0);assert.equal(b.c.frames.size,0);
 b.c.setNow(T+5000);b.app.update([row(1),row(2)]);assert.equal(b.app.snapshot().retained,0);assert.equal(b.app.snapshot().queued,0);
});
test('disposal cancels pending work and ignores late updates or callbacks',()=>{
 const b=helper();b.app.update([row(1),row(2)]);const late=[...b.c.frames.values()][0],before=b.element.textContent;b.app.dispose();late(1000);b.app.update([row(3)]);b.app.setActive(true);b.app.setPaused(false);assert.equal(b.c.frames.size,0);assert.equal(b.element.textContent,before);
});

function view(){
 const c=clock(),nodes=new Map(),events={},windowEvents={},motion={matches:false,addEventListener(k,fn){this.change=fn;},removeEventListener(){delete this.change;}};
 const document={hidden:false,getElementById(id){if(!nodes.has(id))nodes.set(id,new Node());return nodes.get(id);},createElement:()=>new Node(),addEventListener:(k,fn)=>events[k]=fn,removeEventListener:k=>delete events[k],defaultView:{requestAnimationFrame:c.request,cancelAnimationFrame:c.cancel,matchMedia:()=>motion,addEventListener:(k,fn)=>windowEvents[k]=fn,removeEventListener:k=>delete windowEvents[k]}};
 const app=setupCodingWorkers({document,now:c.now}),activity=nodes.get('teamActivityPreview');
 const market=n=>({key:'kraken:number:'+n,at:iso(T+n),asset:'ETH/USD',action:'hold',result:'no_trade',reason:'no_qualified_momentum',source:'Kraken paper decision'});
 const send=(ids,changes={})=>{const records=ids.map(market);events['neptune:market-activity']({detail:{records,connected:true,nativeStatus:'ready',latestAt:records.at(-1)?.at??null,...changes}});};
 return {c,nodes,events,windowEvents,motion,document,app,activity,send};
}
test('view animation survives repeated browser renders; status names true queue time and later stops',()=>{
 const b=view();b.send([1,2,3,4]);assert.equal(b.activity.textContent.split('\n').length,1);assert.match(b.nodes.get('teamCodeNote').textContent,/3 queued · oldest/);assert.match(b.nodes.get('teamCodeNote').textContent,/oldest 09:00:00 UTC/);assert.match(b.nodes.get('teamCodeNote').attrs.title,/Oldest queued event: 2026-10-10 09:00:00\.002 UTC/);
 for(let i=0;i<100;i++){b.c.tick(100);b.app.render();}
 assert.equal(b.activity.textContent.split('\n').length,4);assert.equal(b.c.frames.size,0);assert.match(b.nodes.get('teamCodeNote').textContent,/Waiting for new activity/);
 b.c.setNow(T+95000);b.app.render();assert.match(b.nodes.get('teamCodeNote').textContent,/Awaiting a new decision/);assert.match(b.nodes.get('teamCodeNote').textContent,/1m 34s ago/);b.app.dispose();
});
test('wheel, touch, mouse selection and reader keys pause until explicit Resume; other keys do not pause',()=>{
 for(const event of [{type:'wheel'},{type:'touchstart'},{type:'pointerdown'},{type:'keydown',key:'ArrowUp'},{type:'keydown',key:'PageDown'},{type:'keydown',key:'Home'},{type:'keydown',key:'End'},{type:'keydown',key:' '}]){
  const b=view();b.send([1,2,3]);b.activity.events[event.type](event);assert.equal(b.c.frames.size,0);assert.equal(b.nodes.get('pauseTeamActivity').textContent,'Resume');assert.equal(b.nodes.get('pauseTeamActivity').attrs['aria-pressed'],'true');
  const before=b.activity.textContent;b.send([1,2,3,4]);b.app.render();assert.equal(b.activity.textContent,before);b.nodes.get('pauseTeamActivity').events.click();b.c.drain();assert.equal(b.activity.textContent.split('\n').length,4);assert.equal(b.nodes.get('pauseTeamActivity').textContent,'Pause');b.app.dispose();
 }
 const b=view();b.send([1,2]);b.activity.events.keydown({type:'keydown',key:'Tab'});assert.equal(b.c.frames.size,1);b.app.dispose();
});
test('source, workers, hidden page and pagehide suspend the stream and return without duplicate records',()=>{
 const b=view();b.send([1,2,3]);b.nodes.get('toggleTeamPane').events.click();assert.equal(b.c.frames.size,0);assert.equal(b.nodes.get('pauseTeamActivity').hidden,true);assert.equal(b.nodes.get('teamCodeNote').attrs['aria-label'],undefined);assert.equal(b.nodes.get('teamCodeNote').attrs.title,undefined);const old=b.activity.textContent;b.send([1,2,3,4]);assert.equal(b.activity.textContent,old);
 b.nodes.get('toggleTeamPane').events.click();b.nodes.get('showCodingTeam').events.click();assert.match(b.activity.textContent,/Waiting for real coding-worker events/);assert.equal(b.nodes.get('teamCodeNote').attrs['aria-label'],undefined);assert.equal(b.c.frames.size,0);
 b.nodes.get('showMarketStreams').events.click();assert.doesNotMatch(b.activity.textContent,/coding-worker/);b.document.hidden=true;b.events.visibilitychange({type:'visibilitychange'});assert.equal(b.c.frames.size,0);
 b.document.hidden=false;b.events.visibilitychange({type:'visibilitychange'});b.windowEvents.pagehide({type:'pagehide'});assert.equal(b.c.frames.size,0);b.app.render();assert.equal(b.c.frames.size,0);
 b.windowEvents.pageshow({type:'pageshow'});b.c.drain();assert.equal(b.activity.textContent.split('\n').length,4);b.nodes.get('showCodingTeam').events.click();b.nodes.get('showMarketStreams').events.click();assert.equal(b.c.frames.size,0);b.app.dispose();
});
test('live reduced-motion media preference flushes real records; disposal removes new listeners',()=>{
 const b=view();b.send([1,2,3]);b.motion.change({matches:true});assert.equal(b.c.frames.size,0);assert.equal(b.activity.textContent.split('\n').length,3);b.app.dispose();assert.equal(b.activity.events.wheel,undefined);assert.equal(b.activity.events.touchstart,undefined);assert.equal(b.activity.events.pointerdown,undefined);assert.equal(b.activity.events.keydown,undefined);assert.equal(b.nodes.get('pauseTeamActivity').events.click,undefined);assert.equal(b.motion.change,undefined);
});
test('offline and invalid snapshots never manufacture activity or worker activation',()=>{
 const b=view();b.send([1,2],{connected:false});assert.match(b.nodes.get('teamCodeNote').textContent,/Feed unavailable/);const before=b.activity.textContent;
 b.events['neptune:market-activity']({detail:{records:[{key:'private',at:iso(T),text:'Injected'}],connected:true,nativeStatus:'ready',latestAt:iso(T)}});assert.equal(b.activity.textContent,before);b.c.drain();assert.doesNotMatch(b.activity.textContent,/Injected/);assert.equal(b.app.store.snapshot().report,null);assert.equal(b.c.frames.size,0);b.app.dispose();
});

test('app-wide Pause motion immediately stops rolling and respects explicit reader pause',async()=>{
 const b=view();let still=false;b.document.body={classList:{contains:()=>still}};b.send([1,2,3]);assert.equal(b.c.frames.size,1);
 still=true;b.nodes.get('accessMotion').events.click();await Promise.resolve();assert.equal(b.c.frames.size,0);assert.equal(b.activity.textContent.split('\n').length,3);
 b.activity.events.wheel({type:'wheel'});b.send([1,2,3,4]);assert.equal(b.activity.textContent.split('\n').length,3);
 still=false;b.nodes.get('accessMotion').events.click();await Promise.resolve();assert.equal(b.c.frames.size,0);assert.equal(b.nodes.get('pauseTeamActivity').textContent,'Resume');
 b.nodes.get('pauseTeamActivity').events.click();b.c.drain();assert.equal(b.activity.textContent.split('\n').length,4);b.app.dispose();assert.equal(b.nodes.get('accessMotion').events.click,undefined);
});
