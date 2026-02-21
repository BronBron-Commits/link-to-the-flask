let ctx=null;
let master=null;

export function startMusic(){
  if(ctx) return;

  ctx=new (window.AudioContext||window.webkitAudioContext)();

  master=ctx.createGain();
  master.gain.value=0.18;
  master.connect(ctx.destination);

  playLoop();
}

function playVoice(freq, start, dur){
  const osc=ctx.createOscillator();
  const gain=ctx.createGain();
  const filter=ctx.createBiquadFilter();

  osc.type="triangle";

  filter.type="lowpass";
  filter.frequency.value=1200;
  filter.Q.value=0.7;

  osc.frequency.setValueAtTime(freq,start);

  gain.gain.setValueAtTime(0.0001,start);
  gain.gain.linearRampToValueAtTime(0.22,start+0.20);
  gain.gain.linearRampToValueAtTime(0.18,start+dur*0.65);
  gain.gain.linearRampToValueAtTime(0.0001,start+dur+0.7);

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(master);

  osc.start(start);
  osc.stop(start+dur+1.0);
}

function playChord(chord, time, length){
  for(const f of chord) playVoice(f,time,length);
}

function playLoop(){

  const bpm=108;   // FASTER
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

  let t=ctx.currentTime+0.2;

  function schedule(){
    for(let i=0;i<chords.length;i++){
      playChord(chords[i],t,measure*1.2);
      t+=measure;
    }
  }

  schedule();
  setInterval(schedule,measure*chords.length*1000);
}
