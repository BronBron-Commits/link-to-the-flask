let ctx=null;
let master=null;

export function startMusic(){
  if(ctx) return;

  ctx=new (window.AudioContext||window.webkitAudioContext)();

  master=ctx.createGain();
  master.gain.value=0.18; // global volume
  master.connect(ctx.destination);

  playLoop();
}

/* ---------- SYNTH VOICE ---------- */
function playVoice(freq, start, dur){

  const osc=ctx.createOscillator();
  const gain=ctx.createGain();
  const filter=ctx.createBiquadFilter();

  osc.type="triangle";

  filter.type="lowpass";
  filter.frequency.value=1200;
  filter.Q.value=0.7;

  osc.frequency.setValueAtTime(freq,start);

  /* legato envelope */
  gain.gain.setValueAtTime(0.0001,start);
  gain.gain.linearRampToValueAtTime(0.22,start+0.25);      // slow attack
  gain.gain.linearRampToValueAtTime(0.18,start+dur*0.7);   // sustain
  gain.gain.linearRampToValueAtTime(0.0001,start+dur+0.9); // long tail

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(master);

  osc.start(start);
  osc.stop(start+dur+1.0);
}

/* ---------- CHORD PLAYER ---------- */
function playChord(chord, time, length){
  for(const f of chord){
    playVoice(f,time,length);
  }
}

/* ---------- MUSIC LOOP ---------- */
function playLoop(){

  const bpm=78;
  const beat=60/bpm;
  const measure=beat*4;

  /* 8 chord progression (warm fantasy) */
  const chords=[
    [261.63,329.63,392.00,523.25], // C
    [220.00,261.63,329.63,392.00], // Am
    [196.00,246.94,329.63,392.00], // G
    [174.61,220.00,293.66,349.23], // F
    [196.00,261.63,329.63,392.00], // Gsus
    [220.00,261.63,329.63,440.00], // Am add9
    [164.81,246.94,329.63,392.00], // Em
    [174.61,261.63,349.23,440.00]  // Fmaj7
  ];

  let t=ctx.currentTime+0.2;

  function schedule(){
    for(let i=0;i<chords.length;i++){
      playChord(chords[i],t,measure*1.35); // overlap for legato
      t+=measure;
    }
  }

  schedule();
  setInterval(schedule,measure*chords.length*1000);
}
