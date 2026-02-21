/* =========================================================
   POLYPHONIC FANTASY SYNTH (stable scheduler)
   ========================================================= */

let ctx=null;
let master=null;
let started=false;

/* ---------------- INIT ---------------- */
function init(){
    if(ctx) return;
    ctx=new (window.AudioContext||window.webkitAudioContext)();

    master=ctx.createGain();
    master.gain.value=0.18;
    master.connect(ctx.destination);
}

/* ---------------- VOICE ---------------- */
function voice(freq,time,duration,type="triangle",vol=0.15,cut=1400){

    const osc=ctx.createOscillator();
    const gain=ctx.createGain();
    const filter=ctx.createBiquadFilter();

    osc.type=type;
    osc.frequency.setValueAtTime(freq,time);

    filter.type="lowpass";
    filter.frequency.value=cut;

    gain.gain.setValueAtTime(0.0001,time);
    gain.gain.exponentialRampToValueAtTime(vol,time+0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001,time+duration);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(master);

    osc.start(time);
    osc.stop(time+duration+0.05);
}

/* ---------------- SCALE ---------------- */
const scale=[261.63,293.66,329.63,392.00,440.00,523.25];

/* chord helper */
function chord(root,time){
    voice(root,time,0.9,"triangle",0.12,1200);
    voice(root*1.25,time,0.9,"triangle",0.10,1200);
    voice(root*1.5,time,0.9,"triangle",0.08,1200);
}

/* bass */
function bass(root,time){
    voice(root/2,time,0.35,"sine",0.18,600);
}

/* melody */
function melody(note,time){
    voice(note,time,0.22,"triangle",0.16,1800);
}

/* ---------------- SEQUENCER ---------------- */
let next=0;
let step=0;

function scheduler(){

    const lookAhead=0.25;

    while(next < ctx.currentTime+lookAhead){

        const root=scale[step%scale.length];

        /* harmony every beat */
        chord(root,next);

        /* bass every beat */
        bass(root,next);

        /* melody faster */
        melody(scale[(step*3+2)%scale.length],next+0.14);

        next+=0.55;
        step++;
    }

    requestAnimationFrame(scheduler);
}

/* ---------------- START ---------------- */
export function startMusic(){
    if(started) return;
    started=true;

    init();
    if(ctx.state==="suspended") ctx.resume();

    next=ctx.currentTime+0.05;
    scheduler();
}
