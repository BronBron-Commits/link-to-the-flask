
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
// =========================
// CASTLE
// =========================

const castle = {
  x: 0,        // centered horizontally in world
  y: -900,     // north of center
  width: 900,
  height: 600,
  wallThickness: 40
};

// =========================
// MOAT
// =========================

const moat = {
  padding: 140,     // distance from castle walls
  width: 120        // thickness of water ring
};

let waterTime = 0;
// =========================
// COURTYARD
// =========================

const courtyard = {
  width: castle.width + 300,   // wider than castle
  height: 800,                 // deeper ceremonial space
  offsetY: castle.height/2 + 450   // well south of castle walls
};

// =========================
// PLAYER STATS
// =========================
let activeWeapon = 1; // 1 = scepter, 2 = fishing pole
let maxHealth = 100;
let health = 100;

let maxEnergy = 100;
let energy = 100;

// cooldown duration for charged E
const eCooldownMs = 800;

// cooldown trackers
let cooldowns = {
  q: 0,
  w: 0,
  e: 0,
  r: 0
};

// =========================
// ENERGY COSTS
// =========================

const energyCosts = {
  q: 15,
  w: 30,
  e: 40,
  r: 60
};

const energyRegenPerSecond = 18;

// cooldown durations
const cooldownDurations = {
  q: 800,
  w: 2000,
  e: eCooldownMs,
  r: 6000
};

// HUD press animation timers
let hudPulse = {
  q: 0,
  w: 0,
  e: 0,
  r: 0
};


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

window.addEventListener("keydown", (e) => {
  const key = e.key.toLowerCase();
if (key === "1") activeWeapon = 1;
if (key === "2") activeWeapon = 2;
  if (key === "q" && !qKeyHeld && cooldowns.q <= 0 && energy >= energyCosts.q) {
    qKeyHeld = true;
    energy -= energyCosts.q;
    fireNormal();
  }

  if (key === "w" && !wKeyHeld && cooldowns.w <= 0 && energy >= energyCosts.w) {
    wKeyHeld = true;
    energy -= energyCosts.w;
    fireShotgun();
  }

  if (key === "e" && !charging && cooldowns.e <= 0 && energy >= energyCosts.e && !eKeyHeld) {
    eKeyHeld = true;
    energy -= energyCosts.e;
    charging = true;
    chargeMs = 0;
    chargeAutoReleased = false;
    chargeSoundTimer = 0;
  }


  if (key === "r" && !ulting && cooldowns.r <= 0 && energy >= energyCosts.r) {
    energy -= energyCosts.r;

    ulting = true;
    ultTimer = 0;

    const ctxAudio = new (window.AudioContext || window.webkitAudioContext)();
    ultNoiseOsc = ctxAudio.createOscillator();
    ultNoiseGain = ctxAudio.createGain();

    ultNoiseOsc.type = "sawtooth";
    ultNoiseOsc.frequency.value = 90;
    ultNoiseGain.gain.value = 0.05;

    ultNoiseOsc.connect(ultNoiseGain);
    ultNoiseGain.connect(ctxAudio.destination);
    ultNoiseOsc.start();

    ultNoiseOsc.frequency.linearRampToValueAtTime(
      400,
      ctxAudio.currentTime + ultWindup / 1000
    );
  }
});


window.addEventListener("keyup", (e) => {
  const key = e.key.toLowerCase();

  if (key === "q") qKeyHeld = false;
  if (key === "w") wKeyHeld = false;

  if (key === "e") {
    eKeyHeld = false;

    if (charging) {
      releaseCharge();
    }
  }
});


function drawFishingPole(ctx, x, y, scale, facing) {

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);

  // Flip for left facing
  if (facing.x < 0) {
    ctx.scale(-1, 1);
  }

  // Rod shaft
  ctx.strokeStyle = "#5b3a1a";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(18, -42);
  ctx.stroke();

  // Reel
  ctx.fillStyle = "#222";
  ctx.beginPath();
  ctx.arc(4, -6, 4, 0, Math.PI * 2);
  ctx.fill();

  // Line
  ctx.strokeStyle = "rgba(230,230,230,0.7)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(18, -42);
  ctx.lineTo(18, -10);
  ctx.stroke();

  // Hook
  ctx.fillStyle = "#ccc";
  ctx.beginPath();
  ctx.arc(18, -8, 2, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}
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
  window.__musicCtx = ctx;
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
  hudPulse.q = 200;
  const sx = canvas.width/2 + 38;
  const sy = canvas.height/2 + 26;

  const {dx,dy} = aimDir();

  castAttack(sx,sy,dx,dy,{
    speed:22, life:1, rangeTiles:6, scaleBoost:1, trailCount:5
  });

  sfxShoot();
  attackAnim = 1;
cooldowns.q = cooldownDurations.q;
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
  hudPulse.w = 200;
  const sx = canvas.width/2 + 38;
  const sy = canvas.height/2 + 26;

  const {dx,dy} = aimDir();

  castShotgun(sx,sy,dx,dy);
  sfxShotgun();
  attackAnim = 1;
cooldowns.w = cooldownDurations.w;
}

function releaseCharge(){
  hudPulse.e = 200;
  const p = Math.min(1, chargeMs / chargeMaxMs);

  fireCharged(p);

  charging = false;
  chargeMs = 0;
  chargeSoundTimer = 0;

  eCooldownTimer = eCooldownMs;
  cooldowns.e = cooldownDurations.e;
}

function update(dt){

waterTime += dt * 0.002;

  // =========================
  // ULTIMATE
  // =========================

  if (ulting) {

    ultTimer += dt;

    if (!ultBurstTriggered && ultTimer >= ultWindup) {
      ultBurstTriggered = true;
      triggerUltimateBurst();
      cooldowns.r = cooldownDurations.r;

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

// =========================
// COOLDOWN DECAY
// =========================

for (let key in cooldowns) {
  if (cooldowns[key] > 0) {
    cooldowns[key] -= dt;
    if (cooldowns[key] < 0) cooldowns[key] = 0;
  }
}


for (let key in hudPulse) {
  if (hudPulse[key] > 0) {
    hudPulse[key] -= dt;
    if (hudPulse[key] < 0) hudPulse[key] = 0;
  }
}


// =========================
// ENERGY REGEN
// =========================

energy += energyRegenPerSecond * (dt / 1000);
if (energy > maxEnergy) energy = maxEnergy;


}






/* =========================
   DRAW
========================= */


function drawCourtyard() {

  const centerX = castle.x;
  const centerY = castle.y + courtyard.offsetY + 20;

  const screenX = centerX - camera.x + canvas.width/2;
  const screenY = centerY - camera.y + canvas.height/2;

  const w = courtyard.width;
  const h = courtyard.height;

  ctx.save();

  // =========================
  // PBR GRASS
  // =========================

  const tileSize = 32;

  const lightDir = { x: -0.4, y: -0.9 };
  const len = Math.hypot(lightDir.x, lightDir.y);
  lightDir.x /= len;
  lightDir.y /= len;

  for (let y = -h/2; y < h/2; y += tileSize) {
    for (let x = -w/2; x < w/2; x += tileSize) {

      const worldX = castle.x + x;
      const worldY = castle.y + courtyard.offsetY + y;

      const sx = screenX + x;
      const sy = screenY + y;

      const n1 = Math.sin(worldX * 0.03) * 0.5;
      const n2 = Math.cos(worldY * 0.04) * 0.5;
      const noise = (n1 + n2);

      const baseGreen = 90 + noise * 25;

      const nx = Math.sin(worldX * 0.05) * 0.6;
      const ny = Math.cos(worldY * 0.05) * 0.6;

      const dot = Math.max(0, nx * lightDir.x + ny * lightDir.y);
      const rough = 0.5 + Math.sin((worldX + worldY) * 0.02) * 0.2;

      const brightness = baseGreen * (0.6 + dot * 0.6) * (1 - rough * 0.25);

      const r = brightness * 0.4;
      const g = brightness;
      const b = brightness * 0.35;

      ctx.fillStyle = `rgb(${r|0},${g|0},${b|0})`;
      ctx.fillRect(sx, sy, tileSize, tileSize);
    }
  }

  // =========================
  // BRICK PATH
  // =========================

  const pathWidth = 260;
  const brickW = 46;
  const brickH = 22;
  const mortar = 4;

  const brickLight = { x: -0.5, y: -0.8 };
  const brickLen = Math.hypot(brickLight.x, brickLight.y);
  brickLight.x /= brickLen;
  brickLight.y /= brickLen;

  function drawBrickField(startX, startY, width, height) {
    for (let y = 0; y < height; y += brickH + mortar) {

      const row = Math.floor(y / (brickH + mortar));
      const stagger = row % 2 === 0 ? 0 : brickW/2;

      for (let x = 0; x < width; x += brickW) {

        const bx = startX + x + stagger;
        const by = startY + y;

        const wx = bx + camera.x - canvas.width/2;
        const wy = by + camera.y - canvas.height/2;

        const noise =
          Math.sin(wx * 0.05) * 0.5 +
          Math.cos(wy * 0.05) * 0.5;

        const baseRed = 150 + noise * 30;
        const baseGreen = 35 + noise * 8;
        const baseBlue = 30 + noise * 6;

        const nx = Math.sin(wx * 0.1) * 0.4;
        const ny = Math.cos(wy * 0.1) * 0.4;

        const dot = Math.max(0, nx*brickLight.x + ny*brickLight.y);
        const rough = 0.6 + Math.sin((wx+wy)*0.03)*0.2;
        const brightness = (0.65 + dot*0.6) * (1 - rough*0.2);

        const r = (baseRed * brightness) | 0;
        const g = (baseGreen * brightness) | 0;
        const b = (baseBlue * brightness) | 0;

        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(bx, by, brickW - mortar, brickH);

        ctx.fillStyle = "rgba(0,0,0,0.15)";
        ctx.fillRect(bx, by + brickH - 3, brickW - mortar, 3);

        ctx.fillStyle = "rgba(255,200,180,0.12)";
        ctx.fillRect(bx, by, brickW - mortar, 2);
      }
    }
  }

  const verticalPathX = screenX - pathWidth/2;
  const verticalPathY = screenY - h/2;

  drawBrickField(verticalPathX, verticalPathY, pathWidth, h);

  drawBrickField(
    screenX - pathWidth/2,
    screenY + h/2,
    pathWidth,
    400
  );

  // =========================
  // HOUSE (computed AFTER pathWidth exists)
  // =========================

  const hedgeEndY = screenY + (h/2 - 30);
  const houseY = hedgeEndY + 120;
  const houseX = screenX - pathWidth/2 - 260;

  const houseW = 180;
  const houseH = 140;

  ctx.fillStyle = "#8b5a2b";
  ctx.fillRect(
    houseX - houseW/2,
    houseY - houseH,
    houseW,
    houseH
  );

  ctx.fillStyle = "#5a2b1a";
  ctx.beginPath();
  ctx.moveTo(houseX - houseW/2 - 20, houseY - houseH);
  ctx.lineTo(houseX + houseW/2 + 20, houseY - houseH);
  ctx.lineTo(houseX, houseY - houseH - 80);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#3a1d0f";
  ctx.fillRect(
    houseX - 20,
    houseY - 60,
    40,
    60
  );

  ctx.fillStyle = "#aee2ff";
  ctx.fillRect(houseX - 50, houseY - 100, 30, 30);
  ctx.fillRect(houseX + 20, houseY - 100, 30, 30);

  // =========================
  // HEDGES
  // =========================

  const bushRadius = 22;
  const hedgeOffset = pathWidth/2 + 80;

  ctx.fillStyle = "#1f4f1f";

  for (let y = -h/2 + 30; y <= h/2 - 30; y += 55) {

    ctx.beginPath();
    ctx.arc(screenX - hedgeOffset, screenY + y, bushRadius, 0, Math.PI*2);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(screenX + hedgeOffset, screenY + y, bushRadius, 0, Math.PI*2);
    ctx.fill();
  }

  ctx.restore();
}

function drawRiver() {

  const centerX = castle.x;
  const centerY = castle.y + courtyard.offsetY + 20;

  const screenX = centerX - camera.x + canvas.width/2;
  const screenY = centerY - camera.y + canvas.height/2;

  const h = courtyard.height;

  const riverTop = screenY + h/2 + 400;
  const riverHeight = 200;

  ctx.save();

  // Clip river region
  ctx.beginPath();
  ctx.rect(0, riverTop, canvas.width, riverHeight);
  ctx.clip();

  const tileSize = 20;

  // WATER
  for (let y = 0; y < riverHeight; y += tileSize) {
    for (let x = 0; x < canvas.width; x += tileSize) {

      const wave = Math.sin((x * 0.02) + waterTime * 3) * 8;

      const brightness =
        80 +
        Math.sin((x + waterTime * 300) * 0.01) * 15 +
        Math.cos((y - waterTime * 250) * 0.01) * 10;

      ctx.fillStyle = `rgb(${brightness*0.35}, ${brightness*0.6}, ${brightness})`;

      ctx.fillRect(x, riverTop + y + wave, tileSize, tileSize);
    }
  }

  // REFLECTION
  ctx.save();
  ctx.translate(0, riverTop * 2);
  ctx.scale(1, -1);
  ctx.globalAlpha = 0.25;

  drawCastle();

  const dpr = window.devicePixelRatio || 1;
  const logicalW = canvas.width / dpr;
  const logicalH = canvas.height / dpr;

  drawWizard(
    ctx,
    logicalW/2,
    logicalH/2,
    4,
    walkFrame,
    idleTime,
    facing
  );

  if (activeWeapon === 1) {

    drawScepter(
      ctx,
      logicalW/2 + 38,
      logicalH/2 + 26,
      3,
      walkFrame,
      idleTime,
      attackAnim,
      charging
    );

  } else if (activeWeapon === 2) {

    drawFishingPole(
      ctx,
      logicalW/2 + 38,
      logicalH/2 + 26,
      3,
      facing
    );

  }

  ctx.restore(); // reflection
  ctx.restore(); // clip
}

function drawMoat() {

  const screenX = castle.x - camera.x + canvas.width/2;
  const screenY = castle.y - camera.y + canvas.height/2;

  const outerW = castle.width + moat.padding * 2;
  const outerH = castle.height + moat.padding * 2;

  const innerW = outerW - moat.width * 2;
  const innerH = outerH - moat.width * 2;

  ctx.save();

  // Create clipping region for water ring
  ctx.beginPath();
  ctx.rect(screenX - outerW/2, screenY - outerH/2, outerW, outerH);
  ctx.rect(screenX - innerW/2, screenY - innerH/2, innerW, innerH);
  ctx.clip("evenodd");

  const tileSize = 40;

  for (let y = -outerH/2; y < outerH/2; y += tileSize) {
    for (let x = -outerW/2; x < outerW/2; x += tileSize) {

      const wx = x + screenX;
      const wy = y + screenY;

      // shimmer waves
      const wave =
        Math.sin((wx + waterTime * 300) * 0.01) +
        Math.cos((wy - waterTime * 250) * 0.01);

      const brightness = 80 + wave * 20;

      ctx.fillStyle = `rgb(${brightness*0.4}, ${brightness*0.6}, ${brightness})`;
      ctx.fillRect(wx, wy, tileSize, tileSize);
    }
  }

  ctx.restore();
}


function drawCastle() {

  const screenX = castle.x - camera.x + canvas.width/2;
  const screenY = castle.y - camera.y + canvas.height/2;

  const w = castle.width;
  const h = castle.height;
  const t = castle.wallThickness;

  ctx.save();

  // Base stone color
  ctx.fillStyle = "#5a5a63";
  ctx.fillRect(screenX - w/2, screenY - h/2, w, h);

  // Inner courtyard
  ctx.fillStyle = "#2e2e33";
  ctx.fillRect(
    screenX - w/2 + t,
    screenY - h/2 + t,
    w - t*2,
    h - t*2
  );

  // Towers (4 corners)
  const towerRadius = 90;

  ctx.fillStyle = "#6a6a75";

  const corners = [
    [-w/2, -h/2],
    [ w/2, -h/2],
    [-w/2,  h/2],
    [ w/2,  h/2]
  ];

  corners.forEach(([ox, oy]) => {
    ctx.beginPath();
    ctx.arc(screenX + ox, screenY + oy, towerRadius, 0, Math.PI*2);
    ctx.fill();
  });

  // Gate (south side)
  ctx.fillStyle = "#2a1f15";
  ctx.fillRect(
    screenX - 80,
    screenY + h/2 - 20,
    160,
    120
  );

  ctx.restore();
}




function drawHUD(logicalW, logicalH) {

  const hudHeight = 120;
  const barWidth = 300;
  const barHeight = 18;
  const centerX = logicalW / 2;
  const bottomY = logicalH - 30;

  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillRect(0, logicalH - hudHeight, logicalW, hudHeight);

  // HEALTH
  const healthPercent = health / maxHealth;
  ctx.fillStyle = "#400";
  ctx.fillRect(centerX - barWidth/2, bottomY - 50, barWidth, barHeight);
  ctx.fillStyle = "#e22";
  ctx.fillRect(centerX - barWidth/2, bottomY - 50, barWidth * healthPercent, barHeight);

  // ENERGY
  const energyPercent = energy / maxEnergy;
  ctx.fillStyle = "#002";
  ctx.fillRect(centerX - barWidth/2, bottomY - 25, barWidth, barHeight);
  ctx.fillStyle = "#2af";
  ctx.fillRect(centerX - barWidth/2, bottomY - 25, barWidth * energyPercent, barHeight);

  // ABILITIES
  const abilities = ["q","w","e","r"];
  const baseSize = 50;
  const spacing = 70;
  const startX = centerX - (spacing * 1.5);

  ctx.font = "20px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  abilities.forEach((key, i) => {

    const pulse = hudPulse[key] / 200;
    const scale = 1 + pulse * 0.15;
    const size = baseSize * scale;

    const x = startX + i * spacing;
    const y = logicalH - 80;

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);

let canAfford = energy >= energyCosts[key];
ctx.fillStyle = canAfford ? "#222" : "#111";
    ctx.fillRect(-baseSize/2, -baseSize/2, baseSize, baseSize);

    if (cooldowns[key] > 0) {

      const percent = cooldowns[key] / cooldownDurations[key];

      ctx.fillStyle = "rgba(0,0,0,0.7)";
      ctx.fillRect(
        -baseSize/2,
        -baseSize/2,
        baseSize,
        baseSize * percent
      );

      ctx.fillStyle = "#fff";
      ctx.fillText((cooldowns[key] / 1000).toFixed(1), 0, 0);

    } else {

      ctx.fillStyle = canAfford ? "#fff" : "#555";
      ctx.fillText(key.toUpperCase(), 0, 0);
    }

    ctx.restore();
  });
}

function drawFloor(){

  const tileSize = 40;
  const startX = Math.floor((camera.x-canvas.width/2)/tileSize)*tileSize;
  const startY = Math.floor((camera.y-canvas.height/2)/tileSize)*tileSize;

  // Fake directional light (top-left)
  const lightDir = { x: -0.6, y: -0.8 };
  const lightLen = Math.hypot(lightDir.x, lightDir.y);
  lightDir.x /= lightLen;
  lightDir.y /= lightLen;

  for(let y=startY; y<camera.y+canvas.height/2+tileSize; y+=tileSize){
    for(let x=startX; x<camera.x+canvas.width/2+tileSize; x+=tileSize){

      const screenX = x-camera.x+canvas.width/2;
      const screenY = y-camera.y+canvas.height/2;

      // Base Albedo variation
      const noise = (Math.sin(x*0.05) + Math.cos(y*0.05)) * 0.5;
      const base = 120 + noise * 30;

      // Fake normal from tile slope pattern
      const nx = Math.sin(x*0.02) * 0.5;
      const ny = Math.cos(y*0.02) * 0.5;

      const dot = Math.max(0, nx*lightDir.x + ny*lightDir.y);

      // Roughness variation
      const rough = 0.4 + (Math.sin((x+y)*0.03) * 0.2);

      const brightness = base * (0.6 + dot*0.6) * (1 - rough*0.3);

      ctx.fillStyle = `rgb(${brightness},${brightness},${brightness})`;
      ctx.fillRect(screenX, screenY, tileSize, tileSize);
    }
  }
}

function triggerUltimateBurst() {
  hudPulse.r = 300;
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

  const dpr = window.devicePixelRatio || 1;
  const logicalW = canvas.width / dpr;
  const logicalH = canvas.height / dpr;

  // =========================
  // SCREEN SHAKE
  // =========================
  if (screenShake > 0) {
    const shakeX = (Math.random() - 0.5) * screenShake;
    const shakeY = (Math.random() - 0.5) * screenShake;
    ctx.save();
    ctx.translate(shakeX, shakeY);
  }

  // ===== WORLD DRAW ORDER (FIXED) =====
  drawFloor();
  drawMoat();
  drawCastle();        // castle BEFORE courtyard
  drawCourtyard();     // courtyard (house + hedges)
  drawRiver();         // river LAST (because it clips)

  drawAttacks(ctx);

  // =========================
  // Darken screen during ult
  // =========================
  if (ulting) {
    const fadeIn = Math.min(1, ultTimer / ultWindup);
    ctx.fillStyle = `rgba(0,0,0,${0.7 * fadeIn})`;
    ctx.fillRect(0,0,logicalW,logicalH);
  }

  // =========================
  // Wizard
  // =========================
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

if (activeWeapon === 1) {

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

} else if (activeWeapon === 2) {

  drawFishingPole(
    ctx,
    sx,
    sy,
    3,
    facing
  );

}

  if (ulting) {
    drawUltimateHalo();
  }

  if (screenShake > 0) {
    ctx.restore();
  }

  drawHUD(logicalW, logicalH);
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