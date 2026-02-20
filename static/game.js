import { drawWizard } from "./character.js";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

let joy = { x: 0, y: 0 };
const tileSize = 40;

let player = { x: 0, y: 0 };

let camera = { x:0, y:0, targetX:0, targetY:0 };
const cameraLerp = 0.1656;

const moveDelay = 800;
let lastMove = 0;

/* --- WALK ANIMATION STATE (TIME BASED) --- */
let walkFrame = 0;
let animTimer = 0;
const animSpeed = 120; // ms per frame

function tryMove(){
    const now = Date.now();
    if(now - lastMove < moveDelay) return;

    let dx = 0, dy = 0;

    if(Math.abs(joy.x) > Math.abs(joy.y)){
        dx = joy.x > 0 ? 1 : -1;
    } else if(Math.abs(joy.y) > 0){
        dy = joy.y > 0 ? 1 : -1;
    } else return;

    player.x += dx * tileSize;
    player.y += dy * tileSize;

    lastMove = now;
}

function update(dt){
    tryMove();

    camera.targetX = player.x;
    camera.targetY = player.y;

    camera.x += (camera.targetX - camera.x) * cameraLerp;
    camera.y += (camera.targetY - camera.y) * cameraLerp;

    /* animate ONLY while moving */
    const moving =
        Math.abs(camera.x - camera.targetX) > 0.5 ||
        Math.abs(camera.y - camera.targetY) > 0.5;

    if(moving){
        animTimer += dt;
        if(animTimer > animSpeed){
            walkFrame ^= 1;
            animTimer = 0;
        }
    }else{
        walkFrame = 0;
        animTimer = 0;
    }
}

function drawFloor(){
    const startX = Math.floor((camera.x - canvas.width/2) / tileSize) * tileSize;
    const startY = Math.floor((camera.y - canvas.height/2) / tileSize) * tileSize;

    for(let y=startY; y<camera.y+canvas.height/2+tileSize; y+=tileSize){
        for(let x=startX; x<camera.x+canvas.width/2+tileSize; x+=tileSize){
            const screenX = x - camera.x + canvas.width/2;
            const screenY = y - camera.y + canvas.height/2;
            ctx.fillStyle = ((x/tileSize + y/tileSize)%2===0) ? "#fff" : "#000";
            ctx.fillRect(screenX,screenY,tileSize,tileSize);
        }
    }
}

function draw(){
    ctx.clearRect(0,0,canvas.width,canvas.height);
    drawFloor();

    drawWizard(
        ctx,
        canvas.width/2,
        canvas.height/2,
        4,
        walkFrame
    );
}

/* REAL FRAME LOOP */
let last = performance.now();
function loop(now){
    const dt = now - last;
    last = now;

    update(dt);
    draw();

    requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

/* joystick */
const stick = document.getElementById("stick");
const knob = document.getElementById("knob");
let dragging=false;

stick.addEventListener("touchstart",()=>dragging=true);

window.addEventListener("touchend",()=>{
    dragging=false;
    knob.style.left="40px";
    knob.style.top="40px";
    joy.x=0; joy.y=0;
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
