let ctx=null;
let master=null;

function init(){
  if(ctx) return;
  ctx=new (window.AudioContext||window.webkitAudioContext)();
  master=ctx.createGain();
  master.gain.value=0.35;
  master.connect(ctx.destination);
}

function tone(freq, time, dur, type="triangle", vol=0.25){
  const osc=ctx.createOscillator();
  const gain=ctx.createGain();

  osc.type=type;
  osc.frequency.setValueAtTime(freq,time);
  osc.frequency.exponentialRampToValueAtTime(freq*0.4,time+dur);

  gain.gain.setValueAtTime(0.0001,time);
  gain.gain.linearRampToValueAtTime(vol,time+0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001,time+dur);

  osc.connect(gain);
  gain.connect(master);

  osc.start(time);
  osc.stop(time+dur+0.05);
}

/* noise burst for explosions */
function noise(time,dur,vol=0.6){
  const buffer=ctx.createBuffer(1,ctx.sampleRate*dur,ctx.sampleRate);
  const data=buffer.getChannelData(0);
  for(let i=0;i<data.length;i++){
    data[i]=(Math.random()*2-1)*(1-i/data.length);
  }

  const src=ctx.createBufferSource();
  const gain=ctx.createGain();
  const filter=ctx.createBiquadFilter();

  filter.type="lowpass";
  filter.frequency.value=900;

  src.buffer=buffer;
  gain.gain.setValueAtTime(vol,time);
  gain.gain.exponentialRampToValueAtTime(0.0001,time+dur);

  src.connect(filter);
  filter.connect(gain);
  gain.connect(master);

  src.start(time);
}

/* -------- BASIC SHOT -------- */
export function sfxShoot(){
  init();
  const t=ctx.currentTime;
  tone(880,t,0.08,"triangle",0.20);
  tone(1320,t+0.02,0.06,"sine",0.12);
}

/* -------- CHARGED SHOT -------- */
export function sfxCharged(power=1){
  init();
  const t=ctx.currentTime;
  const base=220+power*220;

  /* normal charged */
  tone(base,t,0.25,"sawtooth",0.35);
  tone(base*1.5,t+0.05,0.30,"triangle",0.28);
  tone(base*2.2,t+0.08,0.35,"sine",0.18);

  /* FULL CHARGE EXPLOSION */
  if(power>0.92){
    tone(90,t,0.6,"sawtooth",0.9);      // sub boom
    tone(45,t,0.8,"sine",1.0);          // deep bass
    noise(t,0.7,0.8);                   // impact blast
    tone(4000,t+0.02,0.4,"square",0.2); // crack
  }
}

/* -------- SHOTGUN -------- */
export function sfxShotgun(){
  init();
  const t=ctx.currentTime;

  for(let i=0;i<6;i++){
    tone(600+Math.random()*600,t+i*0.01,0.12,"square",0.18);
  }

  tone(140,t,0.22,"sawtooth",0.35);
}
