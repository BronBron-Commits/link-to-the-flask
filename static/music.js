let ctx = null;
let master = null;
let started = false;
let loopTimer = null;

/* -3 semitones */
const T = 0.8409;

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

/* ================= REGGAE PAD ================= */
function playPadChord(chord, start, beat){
  for(const note of chord){
    const freq = note * T;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(freq, start);

    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(0.12, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + beat*0.3);

    osc.connect(gain);
    gain.connect(master);

    osc.start(start);
    osc.stop(start + beat*0.35);
  }
}

/* ================= EIGHTH NOTE BASS ================= */
function play808Groove(chord, start, beat){
  const root  = chord[0] * T / 2;
  const third = chord[1] * T / 2;
  const fifth = chord[2] * T / 2;

  const sixteenth = beat / 4;
  const sustain = beat / 2;   // eighth note length

  const pattern = [
    {freq: root,  time: start},
    {freq: third, time: start + beat + sixteenth},
    {freq: fifth, time: start + beat + sixteenth*2},
    {freq: third, time: start + beat + sixteenth*3},
    {freq: root,  time: start + beat*2},
    {freq: third, time: start + beat*3 + sixteenth},
    {freq: fifth, time: start + beat*3 + sixteenth*2},
    {freq: third, time: start + beat*3 + sixteenth*3}
  ];

  for(const n of pattern){
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(n.freq, n.time);

    gain.gain.setValueAtTime(0.0001, n.time);
    gain.gain.linearRampToValueAtTime(0.7, n.time + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, n.time + sustain);

    osc.connect(gain);
    gain.connect(master);

    osc.start(n.time);
    osc.stop(n.time + sustain);
  }
}

/* ================= HIHAT ================= */
function hat(time){
  const noise = ctx.createBufferSource();
  const buffer = ctx.createBuffer(1, ctx.sampleRate*0.015, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for(let i=0;i<data.length;i++) data[i] = Math.random()*2 - 1;
  noise.buffer = buffer;

  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 9000;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.15, time);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.04);

  noise.connect(hp);
  hp.connect(gain);
  gain.connect(master);

  noise.start(time);
  noise.stop(time + 0.05);
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
  bp.frequency.value = 2500;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.9, time);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.18);

  noise.connect(bp);
  bp.connect(gain);
  gain.connect(master);

  noise.start(time);
  noise.stop(time + 0.25);
}

/* ================= LOOP ================= */
function playLoop(){
  const bpm = 224 * 0.75;
  const beat = 60 / bpm;
  const measure = beat * 4;

  const Bb = [233.08, 293.66, 349.23];
  const Ab = [207.65, 261.63, 311.13];

  let t = ctx.currentTime + 0.1;

  function schedule(){
    for(let bar=0; bar<4; bar++){
      const chord = (bar % 2 === 0) ? Bb : Ab;

      play808Groove(chord, t, beat);

      for(let b=0; b<4; b++){
        hat(t + b*beat);
        playPadChord(chord, t + b*beat + beat*0.5, beat);
      }

      snare(t + beat*2);

      t += measure;
    }
  }

  schedule();
  if(loopTimer) clearInterval(loopTimer);
  loopTimer = setInterval(schedule, measure * 4 * 1000);
}
