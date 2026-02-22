let ctx = null;
let master = null;
let started = false;
let loopTimer = null;

const T = 1.12246;
const PART_LOOPS = 2;   // play each section twice

export function startMusic(){
  if(!ctx){
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.12;
    master.connect(ctx.destination);
  }

  if(ctx.state === "suspended") ctx.resume().catch(()=>{});
  if(started) return;
  started = true;

  playLoop();
}

/* ================= PAD ================= */
function playVoice(freq, start, dur){
  freq *= T;

  const osc1 = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  const gain = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  const pan = ctx.createStereoPanner();

  osc1.type = "sawtooth";
  osc2.type = "sawtooth";

  osc1.frequency.setValueAtTime(freq, start);
  osc2.frequency.setValueAtTime(freq * 1.008, start);

  filter.type = "lowpass";
  filter.frequency.setValueAtTime(600, start);
  filter.frequency.linearRampToValueAtTime(1800, start + dur * 0.6);
  filter.Q.value = 0.8;

  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.linearRampToValueAtTime(0.06, start + 0.35);
  gain.gain.linearRampToValueAtTime(0.05, start + dur * 0.7);
  gain.gain.linearRampToValueAtTime(0.0001, start + dur + 0.9);

  pan.pan.setValueAtTime((Math.random()*0.4)-0.2, start);

  osc1.connect(filter);
  osc2.connect(filter);
  filter.connect(gain);
  gain.connect(pan);
  pan.connect(master);

  osc1.start(start);
  osc2.start(start);
  osc1.stop(start + dur + 1.2);
  osc2.stop(start + dur + 1.2);
}

function playChord(chord, time, length){
  for(const f of chord) playVoice(f, time, length);
}

/* ================= LEAD ================= */
function playLead(chord, start, beat){
  const notes = [
    chord[2]*2,
    chord[3]*2,
    chord[1]*2,
    chord[2]*2
  ];

  for(let i=0;i<notes.length;i++){
    const t = start + i*(beat*0.5);
    const freq = notes[i]*T;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, t);

    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(0.06, t + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + beat*0.45);

    osc.connect(gain);
    gain.connect(master);

    osc.start(t);
    osc.stop(t + beat*0.5);
  }
}

/* ================= BASS ================= */
function playBass(root, start, beat){
  root *= T;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const filter = ctx.createBiquadFilter();

  osc.type = "sawtooth";
  filter.type = "lowpass";
  filter.frequency.value = 420;

  const fifth = root * 1.5;

  osc.frequency.setValueAtTime(root, start);
  osc.frequency.setValueAtTime(fifth, start + beat*2);

  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.linearRampToValueAtTime(0.18, start + 0.02);
  gain.gain.linearRampToValueAtTime(0.15, start + beat*3.5);
  gain.gain.linearRampToValueAtTime(0.0001, start + beat*4);

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(master);

  osc.start(start);
  osc.stop(start + beat*4 + 0.1);
}

/* ================= HIHAT ================= */
function hihat(time){
  const noise = ctx.createBufferSource();
  const buffer = ctx.createBuffer(1, ctx.sampleRate*0.02, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for(let i=0;i<data.length;i++) data[i] = Math.random()*2 - 1;
  noise.buffer = buffer;

  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 8000;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.20, time);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.02);

  noise.connect(hp);
  hp.connect(gain);
  gain.connect(master);

  noise.start(time);
  noise.stop(time + 0.03);
}

/* ================= SNARE ================= */
function snare(time){
  const noise = ctx.createBufferSource();
  const buffer = ctx.createBuffer(1, ctx.sampleRate*0.2, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for(let i=0;i<data.length;i++) data[i] = Math.random()*2 - 1;
  noise.buffer = buffer;

  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 2000;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.50, time);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.18);

  noise.connect(bp);
  bp.connect(gain);
  gain.connect(master);

  noise.start(time);
  noise.stop(time + 0.2);
}

/* ================= LOOP A ↔ B (2x each) ================= */
function playLoop(){
  const bpm = 156;
  const beat = 60 / bpm;
  const measure = beat * 4;

  const songA = [
    [261.63,329.63,392.00,523.25],
    [220.00,261.63,329.63,392.00],
    [196.00,246.94,329.63,392.00],
    [174.61,220.00,293.66,349.23],
    [196.00,261.63,329.63,392.00],
    [220.00,261.63,329.63,440.00],
    [164.81,246.94,329.63,392.00],
    [174.61,261.63,349.23,440.00]
  ];

  const songB = [
    [220.00,261.63,329.63,440.00],
    [174.61,220.00,293.66,349.23],
    [261.63,329.63,392.00,523.25],
    [196.00,246.94,329.63,392.00],
    [220.00,261.63,329.63,440.00],
    [196.00,246.94,329.63,392.00],
    [174.61,220.00,293.66,349.23],
    [164.81,207.65,246.94,329.63]
  ];

  let active = songA;
  let loopCount = 0;
  let t = ctx.currentTime + 0.12;

  function schedule(){
    for(let i=0;i<active.length;i++){
      const chord = active[i];
      const root = chord[0] / 2;

      playBass(root, t, beat);
      playChord(chord, t, measure*1.2);
      playLead(chord, t, beat);

      for(let b=0;b<4;b++){
        const bt = t + b*beat;
        hihat(bt);
        hihat(bt + beat*0.5);
        if(b===1 || b===3) snare(bt);
      }

      t += measure;
    }

    loopCount++;
    if(loopCount >= PART_LOOPS){
      active = (active === songA) ? songB : songA;
      loopCount = 0;
    }
  }

  schedule();
  if(loopTimer) clearInterval(loopTimer);
  loopTimer = setInterval(schedule, measure * songA.length * 1000);
}
