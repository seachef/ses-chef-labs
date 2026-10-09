import {paperView,validateReports} from './status.mjs';
const $=id=>document.getElementById(id);
const endpoint='https://jhsrbmvmjtihlxnbrvbx.supabase.co/rest/v1/paper_public_status?select=id,payload&order=id.asc';
// Existing public, read-only status feed. This is a publishable key, not an owner credential.
const publicKey='sb_publishable_spuSGf1hTwSfAxZoC6FGzQ_umB2RB07';
let selected='BTC/USD',reports=new Map(),connected=false,busy=false,polls=0;
const lastEvents=new Map();
const money=v=>typeof v==='number'&&Number.isFinite(v)?new Intl.NumberFormat('en-AU',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(v):'—';
const safe=v=>typeof v==='string'?v.slice(0,350):'';
const stamp=v=>Number.isFinite(Date.parse(v))?new Date(v).toLocaleTimeString('en-AU',{timeZone:'Australia/Perth',hour12:false}):'—';
async function readReports(){
 const controller=new AbortController();
 const timeout=setTimeout(()=>controller.abort(),8000);
 try{const response=await fetch(endpoint,{headers:{apikey:publicKey},credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',signal:controller.signal});
 if(!response.ok)throw Error('Status service unavailable');
 return validateReports(await response.json());}finally{clearTimeout(timeout);}
}
async function refreshFeed(){
 if(busy)return;
 busy=true; $('refresh').disabled=true;
 try {
  const next=await readReports();
  reports=new Map(next.map(r=>[r.symbol,r]));
  connected=true;
  next.forEach(igniteNewEvent);
 } catch { connected=false; }
 finally {
  polls++; busy=false;
  $('refresh').disabled=false;
  render();
 }
}
function igniteNewEvent(report){
 const event=report.events?.[0],id=event?.id,previous=lastEvents.get(report.symbol);
 if(!Number.isSafeInteger(id))return;
 lastEvents.set(report.symbol,id);
 const age=Date.now()-Date.parse(event.at);
 if(previous===undefined||id<=previous||age<0||age>90000||paperView(report,true).status!=='running')return;
 const node=document.querySelector(`[data-market="${report.symbol}"]`);
 node.classList.remove('ignite');void node.offsetWidth;node.classList.add('ignite');
}
function render(){
 const report=reports.get(selected),view=paperView(report,connected);
 $('connection').textContent=view.label+' · '+selected.split('/')[0];
 $('feedSummary').textContent=connected?(reports.size?'Verified paper reports · 10s refresh':'Connected · awaiting paper reports'):'Feed offline · no current valuation';
 $('feedState').textContent=view.label.toUpperCase();
 $('selectedCoin').textContent=selected.split('/')[0]+' · PAPER';
 $('equity').textContent=money(report?.equity);
 $('pnl').textContent=money(Number.isFinite(report?.equity)&&Number.isFinite(report?.initial_cash)?report.equity-report.initial_cash:undefined);
 $('fills').textContent=Number.isSafeInteger(report?.fills)&&report.fills>=0?report.fills:'—';
 const quantity=report?.position_qty;
 $('position').textContent=Number.isFinite(quantity)?quantity===0?'Position · flat':`Position · ${quantity.toPrecision(5)} ${selected.split('/')[0]} virtual`:'No verified position available.';
 $('lastFill').textContent=report?.last_fill_at?`${safe(report.last_fill_side)||'Paper fill'} · ${stamp(report.last_fill_at)} Perth`:'No verified buy or sell received.';
 $('valuation').textContent=!report?'No real orders. No wallet access.':['stale','offline','ended','paused'].includes(view.status)?'LAST REPORT · NOT A CURRENT VALUATION':'Virtual USD · modeled costs included';
 $('heartbeat').textContent='Server heartbeat '+stamp(report?.heartbeat_at)+' Perth';
 $('execution').textContent=`refreshFeed() · ${polls} checks · ${connected?(reports.size?'report verified':'awaiting reports'):'feed unavailable'}`;
 const events=Array.isArray(report?.events)?report.events.slice(0,8):[];
 $('events').replaceChildren(...events.map(e=>{const li=document.createElement('li'),time=document.createElement('time');time.textContent=stamp(e.at);li.append(time,document.createTextNode(safe(e.message)||safe(e.kind)||'Server event'));return li;}));
 if(!events.length){const li=document.createElement('li');li.textContent=view.reason;$('events').append(li);}
 document.querySelectorAll('[data-market]').forEach(node=>{const r=reports.get(node.dataset.market),v=paperView(r,connected);node.setAttribute('aria-pressed',String(node.dataset.market===selected));node.querySelector('span').textContent=v.status==='running'?'PAPER · '+(safe(r.status)||'monitoring').toUpperCase():v.label.toUpperCase();});
}
$('codeSource').textContent=refreshFeed.toString();
$('refresh').addEventListener('click',refreshFeed);
document.querySelectorAll('[data-market]').forEach(node=>node.addEventListener('click',()=>{selected=node.dataset.market;render();}));
document.querySelectorAll('.mobile-tabs button').forEach(button=>button.addEventListener('click',()=>{document.querySelectorAll('.mobile-tabs button').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));document.querySelectorAll('.instrument').forEach(p=>p.classList.toggle('active',p.dataset.pane===button.dataset.pane));}));
$('about').addEventListener('click',()=>$('aboutDialog').showModal());
$('closeAbout').addEventListener('click',()=>$('aboutDialog').close());
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
let motion=!reduced.matches,frame=0,lastFrame=0;
const canvas=$('atmosphere'),ctx=canvas.getContext('2d');
let width=1,height=1;
function resize(){const box=canvas.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,1.5);width=box.width;height=box.height;canvas.width=width*dpr;canvas.height=height*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);}
// Atmospheric particles only. None represent orders or market measurements.
function drawAtmosphere(t){
 frame=0;if(!motion||document.hidden)return;
 if(t-lastFrame>33){lastFrame=t;ctx.clearRect(0,0,width,height);const seconds=t/1000;
 const count=width<620?44:105;
 for(let i=0;i<count;i++){const x=((i*127.31-seconds*(25+i%9*3))%width+width)%width,y=(i*73.17+seconds*(150+i%7*16))%height;ctx.strokeStyle=`rgba(176,214,233,${.035+(i%4)*.016})`;ctx.lineWidth=.55;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x-5,y+16);ctx.stroke();}
 for(let i=0;i<24;i++){const x=(i*193.7+Math.sin(seconds*.2+i)*22)%width,y=height*(.33+(i%11)*.037)+Math.sin(seconds*.5+i)*7;ctx.fillStyle=`rgba(236,212,157,${.13+.17*Math.sin(seconds+i)**2})`;ctx.beginPath();ctx.arc(x,y,i%3===0?1.3:.65,0,Math.PI*2);ctx.fill();}
 // Slow illumination rather than strobing lightning; < one event per 18 seconds.
 const cycle=seconds%18;if(cycle<1.5){ctx.fillStyle=`rgba(137,182,223,${.035*Math.sin(cycle/1.5*Math.PI)})`;ctx.fillRect(0,0,width,height);}
 }frame=requestAnimationFrame(drawAtmosphere);
}
function syncMotion(){cancelAnimationFrame(frame);document.body.classList.toggle('still',!motion);$('motion').textContent=motion?'Motion on':'Motion off';$('motion').setAttribute('aria-pressed',String(motion));ctx.clearRect(0,0,width,height);if(motion&&!document.hidden)frame=requestAnimationFrame(drawAtmosphere);}
$('motion').addEventListener('click',()=>{motion=!motion;syncMotion();});
reduced.addEventListener('change',e=>{motion=!e.matches;syncMotion();});
window.addEventListener('resize',resize);resize();syncMotion();
let audioContext,soundOn=false;
$('sound').addEventListener('click',async()=>{try{
 if(!audioContext){const Audio=window.AudioContext||window.webkitAudioContext;audioContext=new Audio();const buffer=audioContext.createBuffer(1,audioContext.sampleRate*4,audioContext.sampleRate),data=buffer.getChannelData(0);let v=0;for(let i=0;i<data.length;i++){v=(v+(Math.random()*2-1)*.035)/1.025;data[i]=v;}const source=audioContext.createBufferSource();source.buffer=buffer;source.loop=true;const filter=audioContext.createBiquadFilter();filter.type='lowpass';filter.frequency.value=500;const gain=audioContext.createGain();gain.gain.value=.23;source.connect(filter).connect(gain).connect(audioContext.destination);source.start();}
 soundOn=!soundOn;await audioContext[soundOn?'resume':'suspend']();$('sound').textContent=soundOn?'Sound on':'Sound off';$('sound').setAttribute('aria-pressed',String(soundOn));
 }catch{$('sound').textContent='Sound unavailable';}});
function clock(){$('clock').textContent='PERTH '+new Date().toLocaleTimeString('en-AU',{timeZone:'Australia/Perth',hour12:false});}
clock();setInterval(clock,1000);render();void refreshFeed();
setInterval(()=>{render();if(!document.hidden)void refreshFeed();},10000);
document.addEventListener('visibilitychange',()=>{syncMotion();if(document.hidden){if(audioContext)void audioContext.suspend();}else{if(soundOn&&audioContext)void audioContext.resume();void refreshFeed();}});
