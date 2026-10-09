// No AudioContext creation here: the existing trusted gesture handler owns unlock.
export const LASER_LIMITS=Object.freeze({gapMs:700,duration:.16,volume:.055});
export function createLaserAudio({getContext,canPlay,clock=()=>performance.now()}){
 let previous=null,last=-Infinity;const playing=new Set();
 function stop(){for(const node of playing){try{node.stop();}catch{}try{node.disconnect();}catch{}}playing.clear();previous=null;}
 return {stop,observe(frame){
  if(!canPlay()){stop();return false;}
  const key=frame?.beamCount>0&&typeof frame.beamKey==='string'?frame.beamKey:null,rising=key!==null&&key!==previous;previous=key;
  const ctx=getContext(),now=clock();if(!rising||!ctx||ctx.state!=='running'||now-last<LASER_LIMITS.gapMs)return false;
  try{const oscillator=ctx.createOscillator(),gain=ctx.createGain(),t=ctx.currentTime;oscillator.type='sawtooth';oscillator.frequency.setValueAtTime(760,t);oscillator.frequency.exponentialRampToValueAtTime(180,t+LASER_LIMITS.duration);gain.gain.setValueAtTime(0,t);gain.gain.linearRampToValueAtTime(LASER_LIMITS.volume,t+.012);gain.gain.exponentialRampToValueAtTime(.0001,t+LASER_LIMITS.duration);oscillator.connect(gain).connect(ctx.destination);playing.add(oscillator);oscillator.onended=()=>{playing.delete(oscillator);oscillator.disconnect();gain.disconnect();};oscillator.start(t);oscillator.stop(t+LASER_LIMITS.duration);last=now;return true;}catch{return false;}
 },snapshot:()=>({playing:playing.size,last})};
}
