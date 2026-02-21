import { startMusic } from "./music.js";
import { sfxShoot, sfxCharged, sfxShotgun } from "./sfx.js";
import { castAttack, castShotgun, updateAttacks, drawAttacks } from "./attack.js?v=300";
import { drawWizard } from "./character.js?v=2";
import { drawScepter } from "./weapon.js?v=1";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

function rumble(ms=20){ navigator.vibrate?.(ms); }

let chargeHapticTimer=0;
function chargeHaptics(dt,p){
  chargeHapticTimer-=dt;
  if(chargeHapticTimer>0) return;
  navigator.vibrate?.(6+Math.floor(p*40));
  chargeHapticTimer=Math.max(12,70-Math.floor(p*50));
}

let chargeSoundTimer=0;

let joy={x:0,y:0};
const tileSize=40;
let player={x:0,y:0};
let facing={x:1,y:0};
let camera={x:0,y:0,targetX:0,targetY:0};
const cameraLerp=0.12;
const moveDelay=286;
let lastMove=0;

let walking=false,walkFrame=0,walkTimer=0;
let idleTime=0,attackAnim=0;
let charging=false,chargeMs=0;
const chargeMaxMs=900,tapThresholdMs=180;

const btnA=document.getElementById("btnA");
const btnB=document.getElementById("btnB");
const chargeFill=document.getElementById("chargeFill");

/* MOVEMENT */
function tryMove(){
  const now=Date.now();
  if(now-lastMove<moveDelay) return;

  let dx=0,dy=0;
  if(Math.abs(joy.x)>Math.abs(joy.y)) dx=joy.x>0?1:-1;
  else if(Math.abs(joy.y)>0) dy=joy.y>0?1:-1;
  else return;

  facing.x=dx; facing.y=dy;
  player.x+=dx*tileSize; player.y+=dy*tileSize;

  rumble(8);
  walking=true; walkFrame^=1; walkTimer=250; idleTime=0;
  lastMove=now;
}

/* SHOOT */
function fireNormal(){
  const sx=canvas.width/2+38, sy=canvas.height/2+26;
  let dx=Math.abs(facing.x)>Math.abs(facing.y)?(facing.x>0?1:-1):0;
  let dy=dx?0:(facing.y>0?1:-1);
  castAttack(sx,sy,dx,dy,{speed:22,life:1,rangeTiles:6,scaleBoost:1,trailCount:5});
  sfxShoot(); rumble(30); attackAnim=1;
}

function fireCharged(p){
  const sx=canvas.width/2+38, sy=canvas.height/2+26;
  let dx=Math.abs(facing.x)>Math.abs(facing.y)?(facing.x>0?1:-1):0;
  let dy=dx?0:(facing.y>0?1:-1);

  castAttack(sx,sy,dx,dy,{
    speed:30+p*70,
    life:1.2+p*1.4,
    rangeTiles:7+Math.round(p*6),
    scaleBoost:1.8+p*1.6,
    trailCount:7
  });

  sfxCharged(p); rumble(140+Math.floor(p*180)); attackAnim=1;
}

/* CHARGE */
function setChargeUI(p){
  chargeFill.style.background=`conic-gradient(rgba(180,80,255,0.9) ${Math.min(1,p)*360}deg, transparent 0deg)`;
}

function beginCharge(){ startMusic(); charging=true; chargeMs=0; chargeHapticTimer=0; chargeSoundTimer=0; setChargeUI(0); rumble(12); }
function endCharge(){ const p=chargeMs/chargeMaxMs; (chargeMs<tapThresholdMs?fireNormal:fireCharged)(p); charging=false; chargeMs=0; setChargeUI(0); }

/* UPDATE */
function update(dt){
  tryMove();
  camera.targetX=player.x; camera.targetY=player.y;
  camera.x+=(camera.targetX-camera.x)*cameraLerp;
  camera.y+=(camera.targetY-camera.y)*cameraLerp;

  if(walking){walkTimer-=dt;if(walkTimer<=0)walking=false;}
  else idleTime+=dt;
  attackAnim=Math.max(0,attackAnim-dt*0.006);

  if(charging){
    chargeMs=Math.min(chargeMs+dt,chargeMaxMs);
    const p=chargeMs/chargeMaxMs;
    setChargeUI(p); chargeHaptics(dt,p);
    chargeSoundTimer-=dt;
    if(chargeSoundTimer<=0){sfxCharged(p*0.35);chargeSoundTimer=85;}
  }
}

/* DRAW */
function drawFloor(){
  const sx=Math.floor((camera.x-canvas.width/2)/tileSize)*tileSize;
  const sy=Math.floor((camera.y-canvas.height/2)/tileSize)*tileSize;
  for(let y=sy;y<camera.y+canvas.height/2+tileSize;y+=tileSize)
    for(let x=sx;x<camera.x+canvas.width/2+tileSize;x+=tileSize){
      ctx.fillStyle=((x/tileSize+y/tileSize)%2===0)?"#fff":"#000";
      ctx.fillRect(x-camera.x+canvas.width/2,y-camera.y+canvas.height/2,tileSize,tileSize);
    }
}

function draw(){
  ctx.clearRect(0,0,canvas.width,canvas.height);
  drawFloor();
  drawAttacks(ctx);
  drawWizard(ctx,canvas.width/2,canvas.height/2,4,walkFrame,idleTime,facing);
  drawScepter(ctx,canvas.width/2+38,canvas.height/2+26,3,walkFrame,idleTime,attackAnim);
}

let last=performance.now();
setInterval(()=>{const now=performance.now(),dt=now-last;last=now;update(dt);updateAttacks(dt);draw();},33);

/* MULTI-TOUCH JOYSTICK */
const stick=document.getElementById("stick");
const knob=document.getElementById("knob");
let stickTouchId=null;

stick.addEventListener("touchstart",e=>{stickTouchId=e.changedTouches[0].identifier;},{passive:true});

window.addEventListener("touchend",e=>{
  for(const t of e.changedTouches) if(t.identifier===stickTouchId){
    stickTouchId=null; knob.style.left="40px"; knob.style.top="40px"; joy={x:0,y:0};
  }
});

window.addEventListener("touchmove",e=>{
  if(stickTouchId===null) return;
  let t=[...e.touches].find(t=>t.identifier===stickTouchId); if(!t) return;
  const r=stick.getBoundingClientRect();
  let x=t.clientX-r.left-70,y=t.clientY-r.top-70;
  const d=Math.hypot(x,y),m=50;if(d>m){x=x/d*m;y=y/d*m;}
  knob.style.left=(40+x)+"px";knob.style.top=(40+y)+"px";joy={x:x/m,y:y/m};
});

/* BUTTONS */
function bindPressHold(el,d,u){
  el.addEventListener("touchstart",e=>{e.preventDefault();d();},{passive:false});
  el.addEventListener("touchend",e=>{e.preventDefault();u();},{passive:false});
  el.addEventListener("mousedown",e=>{e.preventDefault();d();});
  window.addEventListener("mouseup",e=>{if(charging){e.preventDefault();u();}});
}
bindPressHold(btnA,beginCharge,endCharge);

btnB.addEventListener("click",()=>{
  const sx=canvas.width/2+38,sy=canvas.height/2+26;
  let dx=Math.abs(facing.x)>Math.abs(facing.y)?(facing.x>0?1:-1):0;
  let dy=dx?0:(facing.y>0?1:-1);
  castShotgun(sx,sy,dx,dy); sfxShotgun(); attackAnim=1; rumble(90);
});
