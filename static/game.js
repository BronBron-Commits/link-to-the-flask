import { drawWizard } from "./character.js";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

let joy = {x:0, y:0};

async function sendMove(){
    if(joy.x===0 && joy.y===0) return;
    await fetch("/move",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({x:joy.x,y:joy.y})
    });
}
setInterval(sendMove,60);

function draw(x,y){
    ctx.clearRect(0,0,canvas.width,canvas.height);
    drawWizard(ctx, x, y, 4);
}

async function tick(){
    const r = await fetch("/state");
    const p = await r.json();
    draw(p.x,p.y);
}
setInterval(tick,33);

const stick = document.getElementById("stick");
const knob = document.getElementById("knob");
let dragging = false;

stick.addEventListener("touchstart", ()=>dragging=true);
window.addEventListener("touchend", ()=>{
    dragging=false;
    knob.style.left="40px";
    knob.style.top="40px";
    joy.x=0; joy.y=0;
});

window.addEventListener("touchmove", e=>{
    if(!dragging) return;

    const rect = stick.getBoundingClientRect();
    const t = e.touches[0];

    let x = t.clientX - rect.left - 70;
    let y = t.clientY - rect.top - 70;

    const dist = Math.sqrt(x*x + y*y);
    const max = 50;
    if(dist>max){ x = x/dist*max; y = y/dist*max; }

    knob.style.left = (40+x) + "px";
    knob.style.top  = (40+y) + "px";

    joy.x = Math.round(x/25);
    joy.y = Math.round(y/25);   // <-- flipped controls here
});
