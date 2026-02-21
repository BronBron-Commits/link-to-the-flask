let ctx = null;
let master = null;
let started = false;
let loopTimer = null;

/* whole-step transpose */
const T = 1.12246;

/* start from user input */
export function startMusic(){
  if(!ctx){
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.18;
    master.connect(ctx.destination);
  }

  if(ctx.state === "suspended") ctx.resume().catch(()=>{});
  if(started) return;
  started = true;

  playLoop();
}

/* ================= PAD VOICE ================= */
function playVoice(freq, start, dur){
  freq*=T;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const filter = ctx.createBiquadFilter();

  osc.type = "triangle";
  filter.type="lowpass";
  filter.frequency.value=1200;

  osc.frequency.setValueAtTime(freq,start);

  gain.gain.setValueAtTime(0.0001,start);
  gain.gain.linearRampToValueAtTime(0.22,start+0.18);
  gain.gain.linearRampToValueAtTime(0.18,start+dur*0.7);
  gain.gain.linearRampToValueAtTime(0.0001,start+dur+0.7);

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(master);

  osc.start(start);
  osc.stop(start+dur+1.0);
}

function playChord(chord,time,len){
  for(const f of chord) playVoice(f,time,len);
}

/* ================= BASS ROOT-5TH ================= */
function playBass(root,start,beat){
  root*=T;

  const osc=ctx.createOscillator();
  const gain=ctx.createGain();
  const filter=ctx.createBiquadFilter();

  osc.type="sawtooth";
  filter.type="lowpass";
  filter.frequency.value=420;

  const fifth=root*1.5;

  osc.frequency.setValueAtTime(root,start);
  osc.frequency.setValueAtTime(fifth,start+beat*2);

  gain.gain.setValueAtTime(0.0001,start);
  gain.gain.linearRampToValueAtTime(0.32,start+0.02);
  gain.gain.linearRampToValueAtTime(0.25,start+beat*3.5);
  gain.gain.linearRampToValueAtTime(0.0001,start+beat*4);

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(master);

  osc.start(start);
  osc.stop(start+beat*4+0.1);
}

/* ================= HIHAT ================= */
function hihat(time){
  const noise=ctx.createBufferSource();
  const buffer=ctx.createBuffer(1,ctx.sampleRate*0.02,ctx.sampleRate);
  const data=buffer.getChannelData(0);
  for(let i=0;i<data.length;i++) data[i]=Math.random()*2-1;
  noise.buffer=buffer;

  const hp=ctx.createBiquadFilter();
  hp.type="highpass";
  hp.frequency.value=7000;

  const gain=ctx.createGain();
  gain.gain.setValueAtTime(0.12,time);
  gain.gain.exponentialRampToValueAtTime(0.0001,time+0.02);

  noise.connect(hp);
  hp.connect(gain);
  gain.connect(master);

  noise.start(time);
  noise.stop(time+0.03);
}

/* ================= SNARE ================= */
function snare(time){
  const noise=ctx.createBufferSource();
  const buffer=ctx.createBuffer(1,ctx.sampleRate*0.2,ctx.sampleRate);
  const data=buffer.getChannelData(0);
  for(let i=0;i<data.length;i++) data[i]=Math.random()*2-1;
  noise.buffer=buffer;

  const bp=ctx.createBiquadFilter();
  bp.type="bandpass";
  bp.frequency.value=1800;

  const gain=ctx.createGain();
  gain.gain.setValueAtTime(0.35,time);
  gain.gain.exponentialRampToValueAtTime(0.0001,time+0.18);

  noise.connect(bp);
  bp.connect(gain);
  gain.connect(master);

  noise.start(time);
  noise.stop(time+0.2);
}

/* ================= LOOP ================= */
function playLoop(){

  const bpm=156; // 20% faster than previous 130
  const beat=60/bpm;
  const measure=beat*4;

  const chords=[
    [261.63,329.63,392.00,523.25],
    [220.00,261.63,329.63,392.00],
    [196.00,246.94,329.63,392.00],
    [174.61,220.00,293.66,349.23],
    [196.00,261.63,329.63,392.00],
    [220.00,261.63,329.63,440.00],
    [164.81,246.94,329.63,392.00],
    [174.61,261.63,349.23,440.00]
  ];

  let t=ctx.currentTime+0.12;

  function schedule(){
    if(ctx.state==="suspended") ctx.resume().catch(()=>{});

    for(let i=0;i<chords.length;i++){

      const root=chords[i][0]/2;
      playBass(root,t,beat);
      playChord(chords[i],t,measure*1.2);

      for(let b=0;b<4;b++){
        const bt=t+b*beat;

        hihat(bt);
        hihat(bt+beat*0.5);

        if(b===1||b===3) snare(bt);
      }

      t+=measure;
    }
  }

  schedule();
  if(loopTimer) clearInterval(loopTimer);
  loopTimer=setInterval(schedule,measure*chords.length*1000);
}
