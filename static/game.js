import { drawWizard } from "./character.js";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

let joy = { x: 0, y: 0 };

const tileSize = 40;
const moveDelay = 800;

let player = {
    tx: 5,
    ty: 5,
    moving: false
};

function tileToPixel(t){ return t * tileSize + tileSize/4; }

function tryMove(dx, dy){
    if(player.moving) return;

    player.tx += dx;
    player.ty += dy;

    player.tx = Math.max(0, Math.min(Math.floor(canvas.width/tileSize)-1, player.tx));
    player.ty = Math.max(0, Math.min(Math.floor(canvas.height/tileSize)-1, player.ty));

    player.moving = true;
    setTimeout(()=>player.moving=false, moveDelay);
}

function update(){
    if(Math.abs(joy.x) > 0.6) tryMove(Math.sign(joy.x),0);
    else if(Math.abs(joy.y) > 0.6) tryMove(0,Math.sign(joy.y));
}

function drawFloor(){
    for(let y=0; y<canvas.height; y+=tileSize){
        for(let x=0; x<canvas.width; x+=tileSize){
            const isWhite=((x/tileSize+y/tileSize)%2===0);
            ctx.fillStyle=isWhite?"#fff":"#000";
            ctx.fillRect(x,y,tileSize,tileSize);
        }
    }
}

function draw(){
    drawFloor();
    drawWizard(ctx, tileToPixel(player.tx), tileToPixel(player.ty), 4);
}

setInterval(()=>{
    update();
    draw();
},33);

const stick=document.getElementById("stick");
const knob=document.getElementById("knob");
let dragging=false;

stick.addEventListener("touchstart",()=>dragging=true);
window.addEventListener("touchend",()=>{
    dragging=false;
    knob.style.left="40px";
    knob.style.top="40px";
    joy.x=0;
    joy.y=0;
});
window.addEventListener("touchmove",e=>{
    if(!dragging) return;
    const rect=stick.getBoundingClientRect();
    const t=e.touches[0];

    let x=t.clientX-rect.left-70;
    let y=t.clientY-rect.top-70;

    const dist=Math.sqrt(x*x+y*y);
    const max=50;
    if(dist>max){ x=x/dist*max; y=y/dist*max; }

    knob.style.left=(40+x)+"px";
    knob.style.top=(40+y)+"px";

    joy.x=x/max;
    joy.y=y/max;
});
