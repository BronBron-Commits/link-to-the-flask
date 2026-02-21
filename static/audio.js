let ctx=null;
let osc=null;
let gain=null;
let master=null;

export function audioInit(){
    if(ctx) return;

    ctx = new (window.AudioContext||window.webkitAudioContext)();

    master = ctx.createGain();
    master.gain.value = 0.18;
    master.connect(ctx.destination);

    osc = ctx.createOscillator();
    gain = ctx.createGain();

    osc.type="sine";

    osc.connect(gain);
    gain.connect(master);

    gain.gain.value = 0;

    osc.start();
}

/* HARD RETRIGGER — prevents stacking */
export function playTone(freq){
    if(!ctx) audioInit();

    const now = ctx.currentTime;

    /* kill any previous envelope instantly */
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(0.0, now);

    /* set frequency */
    osc.frequency.cancelScheduledValues(now);
    osc.frequency.setValueAtTime(freq, now);

    /* attack */
    gain.gain.linearRampToValueAtTime(0.35, now + 0.01);
}

/* release */
export function stopTone(){
    if(!ctx) return;
    const now = ctx.currentTime;

    gain.gain.cancelScheduledValues(now);
    gain.gain.linearRampToValueAtTime(0.0, now + 0.06);
}

export function musicNote(freq,duration=0.25){
    playTone(freq);
    setTimeout(stopTone,duration*1000);
}
