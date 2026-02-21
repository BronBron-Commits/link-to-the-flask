import { castAttack, castShotgun, updateAttacks, drawAttacks } from "./attack.js?v=300";
import { drawWizard } from "./character.js?v=2";
import { drawScepter } from "./weapon.js?v=1";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

/* --- HAPTICS --- */
function rumble(ms=20){
  if(navigator.vibrate) navigator.vibrate(ms);
}

let joy = { x: 0, y: 0 };
const tileSize = 40;

let player = { x: 0, y: 0 };
let facing = { x: 1, y: 0 };

let camera = { x: 0, y: 0, targetX: 0, targetY: 0 };
const cameraLerp = 0.12;

const moveDelay = 286;
let lastMove = 0;

/* WALK STATE */
let walking=false;
let walkFrame=0;
let walkTimer=0;

/* IDLE TIMER (ms) */
let idleTime=0;

/* CHARGE STATE */
let charging=false;
let chargeMs=0;
const chargeMaxMs=900;   // full charge at 900ms
const tapThresholdMs=180;

const btnA = document.getElementById("btnA");
const btnB = document.getElementById("btnB");
const chargeFill = document.getElementById("chargeFill");

function tryMove(){
  const now = Date.now();
  if(now-lastMove < moveDelay) return;

  let dx=0,dy=0;

  if(Math.abs(joy.x)>Math.abs(joy.y)) dx = joy.x>0?1:-1;
  else if(Math.abs(joy.y)>0) dy = joy.y>0?1:-1;
  else return;

  if(dx||dy){facing.x=dx;facing.y=dy;}

  player.x += dx*tileSize;
  player.y += dy*tileSize;

  rumble(8);

  walking=true;
  walkFrame ^= 1;
  walkTimer=250;
  idleTime=0;

  lastMove=now;
}

function fireShot(power01){
  const sx = canvas.width/2 + 38;
  const sy = canvas.width/2 + 26; // keep same offset style as earlier (y based on canvas); corrected below
}

function fireNormal(){
  const sx = canvas.width/2 + 38;
  const sy = canvas.height/2 + 26;

  let dx=0,dy=0;
  if(Math.abs(facing.x)>Math.abs(facing.y)) dx=facing.x>0?1:-1;
  else dy=facing.y>0?1:-1;

  castAttack(sx,sy,dx,dy,{
    speed: 22,
    life: 1.0,
    rangeTiles: 6,
    scaleBoost: 1.0,
    trailCount: 5
  });

  rumble(30);
}

function fireCharged(power01){
  const sx = canvas.width/2 + 38;
  const sy = canvas.height/2 + 26;

  let dx=0,dy=0;
  if(Math.abs(facing.x)>Math.abs(facing.y)) dx=facing.x>0?1:-1;
  else dy=facing.y>0?1:-1;

  // ridiculous fast: scale speed and range with power
  const speed = 30 + power01*70;        // 30 -> 100
  const scaleBoost = 1.8 + power01*1.6; // 1.8 -> 5.0
  const rangeTiles = 7 + Math.round(power01*6); // 7 -> 13
  const life = 1.2 + power01*1.4;       // lasts longer

  castAttack(sx,sy,dx,dy,{
    speed,
    life,
    rangeTiles,
    scaleBoost,
    trailCount: 7
  });

  rumble(140 + Math.floor(power01*180));
}

function setChargeUI(p){
  const deg = Math.max(0, Math.min(1,p)) * 360;
  chargeFill.style.background =
    `conic-gradient(rgba(180,80,255,0.9) ${deg}deg, rgba(180,80,255,0.0) 0deg)`;
}

function beginCharge(){
  charging = true;
  chargeMs = 0;
  setChargeUI(0);
  rumble(12);
}

function endCharge(){
  const p = Math.max(0, Math.min(1, chargeMs/chargeMaxMs));
  if(chargeMs < tapThresholdMs) fireNormal();
  else fireCharged(p);

  charging = false;
  chargeMs = 0;
  setChargeUI(0);
}

function update(dt){
  tryMove();

  camera.targetX=player.x;
  camera.targetY=player.y;

  camera.x+=(camera.targetX-camera.x)*cameraLerp;
  camera.y+=(camera.targetY-camera.y)*cameraLerp;

  if(walking){
    walkTimer-=dt;
    if(walkTimer<=0) walking=false;
  }

  if(!walking) idleTime+=dt;

  if(charging){
    chargeMs = Math.min(chargeMs + dt, chargeMaxMs);
    setChargeUI(chargeMs/chargeMaxMs);
  }
}

function drawFloor(){
  const startX=Math.floor((camera.x-canvas.width/2)/tileSize)*tileSize;
  const startY=Math.floor((camera.y-canvas.height/2)/tileSize)*tileSize;

  for(let y=startY;y<camera.y+canvas.height/2+tileSize;y+=tileSize){
    for(let x=startX;x<camera.x+canvas.width/2+tileSize;x+=tileSize){
      const screenX=x-camera.x+canvas.width/2;
      const screenY=y-camera.y+canvas.height/2;

      ctx.fillStyle=((x/tileSize+y/tileSize)%2===0)?"#fff":"#000";
      ctx.fillRect(screenX,screenY,tileSize,tileSize);
    }
  }
}

function draw(){
  ctx.clearRect(0,0,canvas.width,canvas.height);
  drawFloor();

  drawAttacks(ctx);

  drawWizard(ctx,canvas.width/2,canvas.height/2,4,walkFrame,idleTime);

  const sx = canvas.width/2 + 38;
  const sy = canvas.height/2 + 26;
  drawScepter(ctx,sx,sy,3,walkFrame,idleTime);
}

let last=performance.now();
setInterval(()=>{
  const now=performance.now();
  const dt=now-last; last=now;

  update(dt);
  updateAttacks(dt);
  draw();
},33);

/* joystick (left) */
const stick=document.getElementById("stick");
const knob=document.getElementById("knob");
let dragging=false;

stick.addEventListener("touchstart",()=>dragging=true);

window.addEventListener("touchend",()=>{
  dragging=false;
  knob.style.left="40px";
  knob.style.top="40px";
  joy.x=0;joy.y=0;
});

window.addEventListener("touchmove",e=>{
  if(!dragging)return;
  const rect=stick.getBoundingClientRect();
  const t=e.touches[0];

  let x=t.clientX-rect.left-70;
  let y=t.clientY-rect.top-70;

  const dist=Math.sqrt(x*x+y*y);
  const max=50;
  if(dist>max){x=x/dist*max;y=y/dist*max;}

  knob.style.left=(40+x)+"px";
  knob.style.top=(40+y)+"px";

  joy.x=x/max;
  joy.y=y/max;
});

/* A button: press/hold/release */
function bindPressHold(el, onDown, onUp){
  el.addEventListener("touchstart", (e)=>{ e.preventDefault(); onDown(); }, {passive:false});
  el.addEventListener("touchend",   (e)=>{ e.preventDefault(); onUp(); }, {passive:false});

  el.addEventListener("mousedown",  (e)=>{ e.preventDefault(); onDown(); });
  window.addEventListener("mouseup",(e)=>{ if(charging){ e.preventDefault(); onUp(); }});
}

bindPressHold(btnA, beginCharge, endCharge);

/* B button: simple shotgun later; for now just rumble so it isn't dead */
btnB.addEventListener("click", ()=>{
  const sx = canvas.width/2 + 38;
  const sy = canvas.height/2 + 26;

  let dx=0,dy=0;
  if(Math.abs(facing.x)>Math.abs(facing.y)) dx=facing.x>0?1:-1;
  else dy=facing.y>0?1:-1;

  castShotgun(sx,sy,dx,dy);
  rumble(90);
});
