import { startMusic } from "./music.js";
import { sfxShoot, sfxCharged, sfxShotgun } from "./sfx.js";
import { castAttack, castShotgun, updateAttacks, drawAttacks } from "./attack.js?v=300";
import { drawWizard } from "./character.js?v=2";
import { drawScepter } from "./weapon.js?v=2";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;

  const width = window.innerWidth;
  const height = window.innerHeight;

  canvas.width = width * dpr;
  canvas.height = height * dpr;

  canvas.style.width = width + "px";
  canvas.style.height = height + "px";

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

window.addEventListener("resize", resizeCanvas);
resizeCanvas();
/* =========================
   CORE STATE
========================= */

let player = { x: 0, y: 0 };
let facing = { x: 1, y: 0 };

let camera = { x: 0, y: 0, targetX: 0, targetY: 0 };
const cameraLerp = 0.12;

let walking = false;
let walkFrame = 0;
let walkTimer = 0;
let idleTime = 0;
let attackAnim = 0;
let ultNoiseOsc = null;
let ultNoiseGain = null;
let charging = false;
let chargeMs = 0;
const chargeMaxMs = 900;
let chargeAutoReleased = false;
let chargeSoundTimer = 0;
const eCooldownMs = 800;   // change duration here
let eCooldownTimer = 0;
let qKeyHeld = false;
let wKeyHeld = false;
let eKeyHeld = false;
let moveTarget = null;
const moveSpeed = 6;
/* =========================
   ULTIMATE STATE
========================= */

let ulting = false;
let ultTimer = 0;

const ultWindup = 1500;      // delay before lightning
const ultActive = 1500;     // ring duration
const ultTotal = ultWindup + ultActive;
let ultBurstTriggered = false;
let screenShake = 0;
/* =========================
   MUSIC START (Browser unlock)
========================= */

let musicStarted = false;

window.addEventListener("mousedown", () => {
  if (!musicStarted) {
    startMusic();
    musicStarted = true;
  }
});
/* =========================
   RIGHT CLICK MOVE
========================= */

canvas.addEventListener("contextmenu", e => e.preventDefault());

canvas.addEventListener("mousedown", (e) => {
  if (e.button !== 2) return; // right click

  const rect = canvas.getBoundingClientRect();
  const worldX = camera.x - canvas.width/2 + (e.clientX - rect.left);
  const worldY = camera.y - canvas.height/2 + (e.clientY - rect.top);

  moveTarget = { x: worldX, y: worldY };
});

/* =========================
   KEYBOARD INPUT
========================= */
window.addEventListener("keydown", (e) => {
  const key = e.key.toLowerCase();

if (key === "q" && !qKeyHeld) {
  qKeyHeld = true;
  fireNormal();
}

if (key === "w" && !wKeyHeld) {
  wKeyHeld = true;
  fireShotgun();
}

if (key === "e" && !charging && eCooldownTimer <= 0 && !eKeyHeld) {
  eKeyHeld = true;
  charging = true;
  chargeMs = 0;
  chargeAutoReleased = false;
  chargeSoundTimer = 0;
}

if (key === "r" && !ulting) {
  ulting = true;
  ultTimer = 0;

  // electrical windup noise
  const ctxAudio = new (window.AudioContext || window.webkitAudioContext)();

  ultNoiseOsc = ctxAudio.createOscillator();
  ultNoiseGain = ctxAudio.createGain();

  ultNoiseOsc.type = "sawtooth";
  ultNoiseOsc.frequency.value = 90;

  ultNoiseGain.gain.value = 0.05;

  ultNoiseOsc.connect(ultNoiseGain);
  ultNoiseGain.connect(ctxAudio.destination);

  ultNoiseOsc.start();

  // ramp pitch upward
  ultNoiseOsc.frequency.linearRampToValueAtTime(
    400,
    ctxAudio.currentTime + ultWindup / 1000
  );
}

  if (key >= "1" && key <= "9") {
    console.log("Use item slot", key);
  }
});

window.addEventListener("keyup", (e) => {
  const key = e.key.toLowerCase();

  if (key === "e") {
    eKeyHeld = false;

    if (charging) {
      releaseCharge();
    }
  }

  if (key === "q") qKeyHeld = false;
  if (key === "w") wKeyHeld = false;
});

/* =========================
   MOVEMENT
========================= */

function tryMove(dt){
  if(!moveTarget) return;

  const dx = moveTarget.x - player.x;
  const dy = moveTarget.y - player.y;
  const dist = Math.hypot(dx, dy);

  if(dist < 4){
    moveTarget = null;
    walking = false;
    return;
  }

  const nx = dx / dist;
  const ny = dy / dist;

  player.x += nx * moveSpeed;
  player.y += ny * moveSpeed;

  // SNAP FACING TO CARDINAL ONLY
  if (Math.abs(nx) > Math.abs(ny)) {
    facing.x = nx > 0 ? 1 : -1;
    facing.y = 0;
  } else {
    facing.y = ny > 0 ? 1 : -1;
    facing.x = 0;
  }

  walking = true;
  idleTime = 0;
}

/* =========================
   SHOOTING
========================= */

function aimDir(){
  let dx = 0, dy = 0;

  if (Math.abs(facing.x) > Math.abs(facing.y)) {
    dx = facing.x > 0 ? 1 : -1;
  } else {
    dy = facing.y > 0 ? 1 : -1;
  }

  return { dx, dy };
}

function sfxUltimateBoom() {
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  osc.type = "triangle";
  osc.frequency.setValueAtTime(120, audioCtx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(40, audioCtx.currentTime + 0.4);

  gain.gain.setValueAtTime(0.4, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5);

  osc.connect(gain);
  gain.connect(audioCtx.destination);

  osc.start();
  osc.stop(audioCtx.currentTime + 0.5);
}
function fireNormal(){
  const sx = canvas.width/2 + 38;
  const sy = canvas.height/2 + 26;

  const {dx,dy} = aimDir();

  castAttack(sx,sy,dx,dy,{
    speed:22, life:1, rangeTiles:6, scaleBoost:1, trailCount:5
  });

  sfxShoot();
  attackAnim = 1;
}

function fireCharged(power01){
  const sx = canvas.width/2 + 38;
  const sy = canvas.height/2 + 26;

  const {dx,dy} = aimDir();

  const speed = 30 + power01*70;
  const scaleBoost = 1.8 + power01*1.6;
  const rangeTiles = 7 + Math.round(power01*6);
  const life = 1.2 + power01*1.4;

  castAttack(sx,sy,dx,dy,{
    speed, life, rangeTiles, scaleBoost, trailCount:7
  });

  sfxCharged(power01);
  attackAnim = 1;
}

function fireShotgun(){
  const sx = canvas.width/2 + 38;
  const sy = canvas.height/2 + 26;

  const {dx,dy} = aimDir();

  castShotgun(sx,sy,dx,dy);
  sfxShotgun();
  attackAnim = 1;
}

function releaseCharge(){
  const p = Math.min(1, chargeMs / chargeMaxMs);

  fireCharged(p);

  charging = false;
  chargeMs = 0;
  chargeSoundTimer = 0;

  eCooldownTimer = eCooldownMs;
}

function update(dt){

  // =========================
  // ULTIMATE
  // =========================

  if (ulting) {

    ultTimer += dt;

    if (!ultBurstTriggered && ultTimer >= ultWindup) {
      ultBurstTriggered = true;
      triggerUltimateBurst();

      if (ultNoiseOsc) {
        ultNoiseOsc.stop();
        ultNoiseOsc = null;
      }
    }

    if (ultTimer >= ultTotal) {
      ulting = false;
      ultTimer = 0;
      ultBurstTriggered = false;
    }
  }

  // =========================
  // MOVEMENT (disabled during ult)
  // =========================

  if (!ulting) {
    tryMove(dt);
  }

  // =========================
  // COOLDOWNS
  // =========================

  if (eCooldownTimer > 0) {
    eCooldownTimer -= dt;
  }

  // =========================
  // CAMERA
  // =========================

  camera.targetX = player.x;
  camera.targetY = player.y;

  camera.x += (camera.targetX - camera.x) * cameraLerp;
  camera.y += (camera.targetY - camera.y) * cameraLerp;

  // =========================
  // WALK ANIMATION
  // =========================

  if(walking){
    walkTimer -= dt;
    if(walkTimer <= 0){
      walkFrame ^= 1;
      walkTimer = 200;
    }
  } else {
    idleTime += dt;
  }

  attackAnim = Math.max(0, attackAnim - dt*0.006);

  // =========================
  // CHARGING
  // =========================

  if (charging) {
    chargeMs += dt;

    const power = chargeMs / chargeMaxMs;

    chargeSoundTimer -= dt;
    if (chargeSoundTimer <= 0) {
      sfxCharged(power * 0.35);
      chargeSoundTimer = 90 - power * 60;
    }

    if (chargeMs >= chargeMaxMs && !chargeAutoReleased) {
      chargeAutoReleased = true;
      releaseCharge();
    }
  }

  // =========================
  // SCREEN SHAKE DECAY (FIXED)
  // =========================

  if (screenShake > 0) {
    screenShake -= dt * 0.06;
    if (screenShake < 0) screenShake = 0;
  }
}
/* =========================
   DRAW
========================= */

function drawFloor(){
  const tileSize = 40;
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

function triggerUltimateBurst() {

  const dpr = window.devicePixelRatio || 1;
  const logicalW = canvas.width / dpr;
  const logicalH = canvas.height / dpr;

  const centerX = logicalW / 2;
  const centerY = logicalH / 2;

  const radius = 140;
  const shots = 48; // huge burst

  for (let i = 0; i < shots; i++) {

    const angle = (Math.PI * 2 / shots) * i;

    const dx = Math.cos(angle);
    const dy = Math.sin(angle);

    const spawnX = centerX + dx * radius;
    const spawnY = centerY + dy * radius;

    castAttack(spawnX, spawnY, dx, dy, {
      speed: 28,
      life: 1.4,
      rangeTiles: 8,
      scaleBoost: 1.6,
      trailCount: 6
    });
  }

  sfxUltimateBoom();
  screenShake = 25;   // strength of shake
}
function drawUltimateHalo() {
  const dpr = window.devicePixelRatio || 1;
  const logicalW = canvas.width / dpr;
  const logicalH = canvas.height / dpr;

  // EXACT same position wizard is drawn at
  const centerX = logicalW / 2;
  const centerY = logicalH / 2;

  const radius = 140;

  // only draw ring after windup delay
  if (ultTimer < ultWindup) return;

  const activeTime = ultTimer - ultWindup;
  const rotation = activeTime * 0.004;

  ctx.save();
  ctx.translate(centerX, centerY);
  ctx.rotate(rotation);

  // main glowing perimeter
  ctx.lineWidth = 6;
  ctx.strokeStyle = "rgba(100,180,255,0.85)";
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.stroke();

  // crackling lightning segments
  const segments = 24;

  for (let i = 0; i < segments; i++) {
    const angle = (Math.PI * 2 / segments) * i;

    const jitter = (Math.random() - 0.5) * 10;

    const x1 = Math.cos(angle) * radius;
    const y1 = Math.sin(angle) * radius;

    const x2 = Math.cos(angle + 0.12) * (radius + jitter);
    const y2 = Math.sin(angle + 0.12) * (radius + jitter);

    ctx.strokeStyle = `hsl(${200 + Math.sin(activeTime*0.02)*40},100%,65%)`;
    ctx.lineWidth = 3;

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  ctx.restore();
}


function draw(){

  ctx.clearRect(0,0,canvas.width,canvas.height);

  const logicalW = canvas.width / (window.devicePixelRatio || 1);
  const logicalH = canvas.height / (window.devicePixelRatio || 1);

  // =========================
  // SCREEN SHAKE (FIXED)
  // =========================

  if (screenShake > 0) {
    const shakeX = (Math.random() - 0.5) * screenShake;
    const shakeY = (Math.random() - 0.5) * screenShake;
    ctx.save();
    ctx.translate(shakeX, shakeY);
  }

  drawFloor();
  drawAttacks(ctx);

  // Darken screen
  if (ulting) {
    const fadeIn = Math.min(1, ultTimer / ultWindup);
    ctx.fillStyle = `rgba(0,0,0,${0.7 * fadeIn})`;
    ctx.fillRect(0,0,logicalW,logicalH);
  }

  // Raise wizard slightly
  let raiseOffset = 0;
  if (ulting) {
    const progress = Math.min(1, ultTimer / 400);
    raiseOffset = -20 * progress;
  }

  drawWizard(
    ctx,
    logicalW/2,
    logicalH/2 + raiseOffset,
    4,
    walkFrame,
    idleTime,
    facing
  );

  const sx = logicalW/2 + 38;
  const sy = logicalH/2 + 26;

  drawScepter(
    ctx,
    sx,
    sy,
    3,
    walkFrame,
    idleTime,
    attackAnim,
    charging
  );

  if (ulting) {
    drawUltimateHalo();
  }

  // =========================
  // RESTORE SHAKE
  // =========================

  if (screenShake > 0) {
    ctx.restore();
  }
}
/* =========================
   MAIN LOOP
========================= */

let last = performance.now();
setInterval(()=>{
  const now = performance.now();
  const dt = now - last; 
  last = now;

  update(dt);
  updateAttacks(dt);
  draw();
}, 16);