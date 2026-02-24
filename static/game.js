import { NetworkClient } from "./network.js";
const networkClient = new NetworkClient();


// Assign a unique player ID for this session (not shared across tabs)
const playerId = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
window.playerId = playerId;

import { sfxShoot, sfxCharged, sfxShotgun } from "./sfx.js";
import { castAttack, castShotgun, updateAttacks, drawAttacks } from "./attack.js?v=300";
import { castLure, updateLures, drawLures } from "./lure.js";
window.castAttack = castAttack;
window.castShotgun = castShotgun;
import { drawWizard } from "./character.js?v=2";
import { characterSprites } from "./character_sprites.js";
import { drawScepter } from "./weapon.js?v=2";
import { sendAttack, sendShotgun } from "./network.js";
const remotePlayers = {};
window.remotePlayers = remotePlayers;

// Player name logic
let playerName = '';

function promptForPlayerName() {
  if (document.getElementById('nameModal')) return;
  const modal = document.createElement('div');
  modal.id = 'nameModal';
  modal.style.position = 'fixed';
  modal.style.top = '0';
  modal.style.left = '0';
  modal.style.width = '100vw';
  modal.style.height = '100vh';
  modal.style.background = 'rgba(0,0,0,0.85)';
  modal.style.display = 'flex';
  modal.style.flexDirection = 'column';
  modal.style.justifyContent = 'center';
  modal.style.alignItems = 'center';
  modal.style.zIndex = '9999';
  modal.innerHTML = `
    <div style="background:#222;padding:32px 48px;border-radius:12px;box-shadow:0 0 24px #000;text-align:center;">
      <h2 style='color:#fff;margin-bottom:16px;'>Enter Your Name</h2>
      <input id="playerNameInput" type="text" maxlength="16" style="font-size:1.2em;padding:8px 12px;border-radius:6px;border:1px solid rgb(255, 255, 255);background:#111;color:#fff;outline:none;" autofocus />
      <br><br>
      <button id="playerNameBtn" style="font-size:1.1em;padding:8px 24px;border-radius:6px;background:#fff;color:#111;border:none;cursor:pointer;">Start</button>
    </div>
  `;
  document.body.appendChild(modal);
  document.getElementById('playerNameBtn').onclick = () => {
    const val = document.getElementById('playerNameInput').value.trim();
    if (val.length > 0) {
      playerName = val;
      localStorage.setItem('playerName', playerName);
      modal.remove();
    }
  };
  document.getElementById('playerNameInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('playerNameBtn').click();
  });
}

if (!playerName) {
  promptForPlayerName();
}

// Always check for missing name on focus (e.g. after clearing storage)
window.addEventListener('focus', () => {
  if (!playerName) promptForPlayerName();
});
// Disconnect logic: notify server and remove player artifact on unload
window.addEventListener('beforeunload', () => {
  try {
    if (networkClient && typeof networkClient.send === 'function') {
      networkClient.send({ type: 'disconnect', payload: { id: window.playerId } });
    }
  } catch (e) {}
});

const canvas = document.getElementById("game");
window.canvas = canvas;
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
// Character sprite selection
const characterTypes = ["wizard", "knight", "rogue", "archer", "mage", "paladin"];
let characterTypeIndex = 0;
let characterType = characterTypes[characterTypeIndex];
let facing = { x: 1, y: 0 };

let camera = { x: 0, y: 0, targetX: 0, targetY: 0 };
const cameraLerp = 0.12;
window.camera = camera;

let walking = false;
let walkFrame = 0;
let walkTimer = 0;
let idleTime = 0;
let attackAnim = 0;
let fishingAnim = 0;
let fishingAnimType = null; // 'q', 'w', 'e', 'r'
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

// Multiplayer ultimate sync state
let remoteUlting = {};
let remoteUltTimer = {};
let remoteUltBurstTriggered = {};

/* =========================
   RIGHT CLICK MOVE
========================= */

canvas.addEventListener("contextmenu", e => e.preventDefault());


canvas.addEventListener("mousedown", (e) => {
  if (document.getElementById('nameModal')) return;
  if (e.button !== 2) return; // right click
  const rect = canvas.getBoundingClientRect();
  const worldX = camera.x - canvas.width/2 + (e.clientX - rect.left);
  const worldY = camera.y - canvas.height/2 + (e.clientY - rect.top);
  moveTarget = { x: worldX, y: worldY };
});

// Touch-to-move for mobile: tap anywhere on canvas to move there
function isMobileDevice() {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}
if (isMobileDevice()) {
  canvas.addEventListener('touchstart', function(e) {
    if (document.getElementById('nameModal')) return;
    if (e.touches.length > 0) {
      const rect = canvas.getBoundingClientRect();
      const touch = e.touches[0];
      const worldX = camera.x - canvas.width/2 + (touch.clientX - rect.left);
      const worldY = camera.y - canvas.height/2 + (touch.clientY - rect.top);
      moveTarget = { x: worldX, y: worldY };
    }
  });
}

window.addEventListener("keydown", (e) => {
  if (document.getElementById('nameModal')) return;
  const key = e.key.toLowerCase();
  // Switch character sprite with Tab (cycle)
  if (e.code === "Tab") {
    characterTypeIndex = (characterTypeIndex + 1) % characterTypes.length;
    characterType = characterTypes[characterTypeIndex];
    e.preventDefault();
    // Immediately broadcast outfit change
    outputPlayerPositionJSON();
  }
if (key === "1") activeWeapon = 1;
if (key === "2") activeWeapon = 2;
if (activeWeapon === 2) {
  // Fishing rod QWER animations
  // Helper to cast lure
  function doCastLure(power = 1) {
    // Spawn lure at the same position as regular attack (front of player)
    const sx = player.x + 38;
    const sy = player.y + 26;
    const angle = Math.atan2(facing.y, facing.x);
    // DEBUG: Log and draw marker at spawn
    console.log('[doCastLure] player.x:', player.x, 'player.y:', player.y);
    console.log('[doCastLure] lure spawn sx:', sx, 'sy:', sy, 'facing:', facing);
    if (window.ctx) {
      window.ctx.save();
      window.ctx.beginPath();
      window.ctx.arc(sx - camera.x + canvas.width/2, sy - camera.y + canvas.height/2, 7, 0, Math.PI*2);
      window.ctx.fillStyle = 'red';
      window.ctx.globalAlpha = 0.7;
      window.ctx.fill();
      window.ctx.globalAlpha = 1.0;
      window.ctx.restore();
    }
    castLure(sx, sy, Math.cos(angle), Math.sin(angle), { speed: 16 + 8 * power });
  }
  if (key === "q" && !qKeyHeld && cooldowns.q <= 0 && energy >= energyCosts.q) {
    qKeyHeld = true;
    energy -= energyCosts.q;
    fishingAnim = 1;
    fishingAnimType = 'q';
    doCastLure(1);
  }
  if (key === "w" && !wKeyHeld && cooldowns.w <= 0 && energy >= energyCosts.w) {
    wKeyHeld = true;
    energy -= energyCosts.w;
    fishingAnim = 1;
    fishingAnimType = 'w';
    doCastLure(1.2);
  }
  if (key === "e" && !eKeyHeld && cooldowns.e <= 0 && energy >= energyCosts.e) {
    eKeyHeld = true;
    energy -= energyCosts.e;
    fishingAnim = 1;
    fishingAnimType = 'e';
    doCastLure(1.5);
  }
  if (key === "r" && !ulting && cooldowns.r <= 0 && energy >= energyCosts.r) {
    energy -= energyCosts.r;
    fishingAnim = 1;
    fishingAnimType = 'r';
    doCastLure(2);
  }
  // Water rectangle for lure collision (approximate river area)
  const waterRect = { x: 0, y: 320, width: canvas.width, height: 200 };
  drawLures(ctx);
} else {
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
    // Send ultimate event to other clients
    networkClient.send({
      type: "ultimate",
      payload: {
        id: window.playerId,
        x: camera.x,
        y: camera.y
      }
    });
    const ctxAudio = new (window.AudioContext || window.webkitAudioContext)();
    ultNoiseOsc = ctxAudio.createOscillator();
    ultNoiseGain = ctxAudio.createGain();
    ultNoiseOsc.type = "sawtooth";
    ultNoiseOsc.frequency.value = 90;
    ultNoiseGain.gain.value = 0.05;
    ultNoiseOsc.connect(ultNoiseGain);
    ultNoiseGain.connect(ctxAudio.destination);
    ultNoiseOsc.start();
  }
}
});


window.addEventListener("keyup", (e) => {
  if (document.getElementById('nameModal')) return;
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

  // FLOAT / BOB OFFSET
  let floatOffset = 0;
  if (walking) {
    floatOffset = Math.sin(performance.now() * 0.015) * 2;
  } else {
    floatOffset = Math.sin(idleTime * 0.004) * 1.5;
  }

  // Animation for QWER
  let animOffsetX = 0, animOffsetY = 0, animAngle = 0;
  if (typeof fishingAnim !== 'undefined' && fishingAnim > 0) {
    if (fishingAnimType === 'q') {
      animAngle = -Math.PI/6 * fishingAnim; // quick flick
      animOffsetY = -10 * fishingAnim;
    } else if (fishingAnimType === 'w') {
      animAngle = Math.PI/8 * fishingAnim;
      animOffsetX = 8 * fishingAnim;
    } else if (fishingAnimType === 'e') {
      animAngle = Math.PI/2 * fishingAnim;
      animOffsetY = -18 * fishingAnim;
    } else if (fishingAnimType === 'r') {
      animAngle = Math.PI * fishingAnim;
      animOffsetX = 16 * fishingAnim;
      animOffsetY = -16 * fishingAnim;
    }
  }

  // POSITION OFFSET
  const offsetX = 14 + animOffsetX;
  const offsetY = 18 + floatOffset + animOffsetY;

  ctx.translate(x + offsetX, y + offsetY);
  ctx.rotate(animAngle);

  const weaponScale = scale * 0.6;
  ctx.scale(weaponScale, weaponScale);

  // Flip if facing left
  if (facing.x < 0) {
    ctx.scale(-1, 1);
  }

  // Rod shaft
  ctx.strokeStyle = "#5b3a1a";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(12, -28);
  ctx.stroke();

  // Reel
  ctx.fillStyle = "#222";
  ctx.beginPath();
  ctx.arc(3, -4, 3, 0, Math.PI * 2);
  ctx.fill();

  // Line
  ctx.strokeStyle = "rgba(230,230,230,0.7)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(12, -28);
  ctx.lineTo(12, -6);
  ctx.stroke();

  // Hook
  ctx.fillStyle = "#ccc";
  ctx.beginPath();
  ctx.arc(12, -5, 1.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}




/* =========================
   MOVEMENT
========================= */

function tryMove(dt){
  if (isMobileDevice()) {
    mobileTryMove(dt);
    return;
  }
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
  // Use player world position with offset for attack origin
  const sx = player.x + 38;
  const sy = player.y + 26;

  const {dx,dy} = aimDir();

  castAttack(sx,sy,dx,dy,{
    speed:22, life:1, rangeTiles:6, scaleBoost:1, trailCount:5
  });
  networkClient.sendAttack({
    attackType: "normal",
    dx,
    dy
  });

  sfxShoot();
  attackAnim = 1;
  cooldowns.q = cooldownDurations.q;
}

function fireCharged(power01){

  // Use player world position with offset for attack origin
  const sx = player.x + 38;
  const sy = player.y + 26;

  const {dx,dy} = aimDir();

  const speed = 30 + power01*70;
  const scaleBoost = 1.8 + power01*1.6;
  const rangeTiles = 7 + Math.round(power01*6);
  const life = 1.2 + power01*1.4;

  castAttack(sx,sy,dx,dy,{
    speed, life, rangeTiles, scaleBoost, trailCount:7
  });
  networkClient.sendAttack({
    attackType: "charged",
    dx,
    dy,
    power: power01
  });

  sfxCharged(power01);
  attackAnim = 1;
}

function fireShotgun(){
  hudPulse.w = 200;

  // Use player world position with offset for attack origin
  const sx = player.x + 38;
  const sy = player.y + 26;

  const {dx,dy} = aimDir();

  castShotgun(sx,sy,dx,dy);
  networkClient.sendAttack({
    attackType: "shotgun",
    dx,
    dy
  });
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
  // Water rectangle for lure collision (approximate river area)
  const waterRect = { x: 0, y: 320, width: canvas.width, height: 200 };
  updateLures(dt, waterRect);

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
  // Remote ultimates
  for (const id in remoteUlting) {
    if (remoteUlting[id]) {
      remoteUltTimer[id] += dt;
      if (!remoteUltBurstTriggered[id] && remoteUltTimer[id] >= ultWindup) {
        remoteUltBurstTriggered[id] = true;
        triggerUltimateBurst(remoteUlting[id].x, remoteUlting[id].y);
      }
      if (remoteUltTimer[id] >= ultTotal) {
        remoteUlting[id] = null;
        remoteUltTimer[id] = 0;
        remoteUltBurstTriggered[id] = false;
      }
    }
  }

  // =========================
  // MOVEMENT (disabled during ult)
  // =========================

    if (!ulting) {
      tryMove(dt);
      outputPlayerPositionJSON(); // Output position after movement
    }

// =========================
// OUTPUT PLAYER POSITION AS JSON
// =========================
function outputPlayerPositionJSON() {
  window.outputPlayerPositionJSON = outputPlayerPositionJSON;
  const playerData = {
    id: window.playerId,
    x: player.x,
    y: player.y,
    facing: { ...facing },
    health,
    energy,
    activeWeapon,
    characterType,
    name: playerName
  };
  // Send position to server for multiplayer sync
  networkClient.sendPlayerUpdate(playerData);
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
  fishingAnim = Math.max(0, fishingAnim - dt*0.008);
  if (fishingAnim === 0) fishingAnimType = null;

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

  const grassExtraX = 1600;
  for (let y = -h/2; y < h/2; y += tileSize) {
    for (let x = -w/2 - grassExtraX; x < w/2 + grassExtraX; x += tileSize) {

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

  // =========================
  // HOUSE (computed AFTER pathWidth exists)
  // =========================


  // HOUSE (computed AFTER pathWidth exists)
  const hedgeEndY = screenY + (h/2 - 30);
  const houseY = hedgeEndY + 120;
  const houseW = 200;
  const houseH = 150;
  const roofH = 60;
  const doorW = 36;
  const doorH = 62;
  const windowW = 32;
  const windowH = 32;
  const chimneyW = 18;
  const chimneyH = 38;
  // Draw multiple houses
  const housePositions = [
    screenX - pathWidth/2 - 260,
    screenX - pathWidth/2 - 500,
    screenX - pathWidth/2 - 740
  ];
  housePositions.forEach((houseX) => {
    ctx.fillStyle = "#e6cfa3";
    ctx.fillRect(houseX - houseW/2, houseY - houseH, houseW, houseH);
    ctx.save();
    ctx.shadowColor = "#a87c4a";
    ctx.shadowBlur = 16;
    ctx.fillStyle = "#a87c4a";
    ctx.beginPath();
    ctx.moveTo(houseX - houseW/2 - 16, houseY - houseH);
    ctx.lineTo(houseX + houseW/2 + 16, houseY - houseH);
    ctx.lineTo(houseX, houseY - houseH - roofH);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();
    ctx.fillStyle = "#7a5c3a";
    ctx.fillRect(houseX + houseW/2 - 30, houseY - houseH - chimneyH, chimneyW, chimneyH);
    ctx.fillStyle = "#6b3a1a";
    ctx.fillRect(houseX - doorW/2, houseY - doorH, doorW, doorH);
    ctx.fillStyle = "#d9b15b";
    ctx.beginPath();
    ctx.arc(houseX + doorW/2 - 8, houseY - doorH + doorH/2, 4, 0, Math.PI*2);
    ctx.fill();
    ctx.fillStyle = "#aee2ff";
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.fillRect(houseX - houseW/2 + 18, houseY - houseH + 24, windowW, windowH);
    ctx.strokeRect(houseX - houseW/2 + 18, houseY - houseH + 24, windowW, windowH);
    ctx.fillRect(houseX + houseW/2 - windowW - 18, houseY - houseH + 24, windowW, windowH);
    ctx.strokeRect(houseX + houseW/2 - windowW - 18, houseY - houseH + 24, windowW, windowH);
    ctx.beginPath();
    ctx.moveTo(houseX - houseW/2 + 18 + windowW/2, houseY - houseH + 24);
    ctx.lineTo(houseX - houseW/2 + 18 + windowW/2, houseY - houseH + 24 + windowH);
    ctx.moveTo(houseX - houseW/2 + 18, houseY - houseH + 24 + windowH/2);
    ctx.lineTo(houseX - houseW/2 + 18 + windowW, houseY - houseH + 24 + windowH/2);
    ctx.moveTo(houseX + houseW/2 - windowW - 18 + windowW/2, houseY - houseH + 24);
    ctx.lineTo(houseX + houseW/2 - windowW - 18 + windowW/2, houseY - houseH + 24 + windowH);
    ctx.moveTo(houseX + houseW/2 - windowW - 18, houseY - houseH + 24 + windowH/2);
    ctx.lineTo(houseX + houseW/2 - windowW - 18 + windowW, houseY - houseH + 24 + windowH/2);
    ctx.stroke();
    ctx.fillStyle = "#b5651d";
    ctx.fillRect(houseX - houseW/2 + 18, houseY - houseH + 24 + windowH + 6, windowW, 8);
    ctx.fillStyle = "#ff6f61";
    ctx.beginPath();
    ctx.arc(houseX - houseW/2 + 28, houseY - houseH + 24 + windowH + 10, 4, 0, Math.PI*2);
    ctx.arc(houseX - houseW/2 + 38, houseY - houseH + 24 + windowH + 10, 4, 0, Math.PI*2);
    ctx.arc(houseX - houseW/2 + 48, houseY - houseH + 24 + windowH + 10, 4, 0, Math.PI*2);
    ctx.fill();
    ctx.fillStyle = "#b5651d";
    ctx.fillRect(houseX + houseW/2 - windowW - 18, houseY - houseH + 24 + windowH + 6, windowW, 8);
    ctx.fillStyle = "#ff6f61";
    ctx.beginPath();
    ctx.arc(houseX + houseW/2 - windowW - 8, houseY - houseH + 24 + windowH + 10, 4, 0, Math.PI*2);
    ctx.arc(houseX + houseW/2 - windowW + 2, houseY - houseH + 24 + windowH + 10, 4, 0, Math.PI*2);
    ctx.arc(houseX + houseW/2 - windowW + 12, houseY - houseH + 24 + windowH + 10, 4, 0, Math.PI*2);
    ctx.fill();
  });

  // GATE (centered on path)
  const gateBaseY = screenY + (h / 2 - 10); // slightly below hedges
  const gateCenterX = screenX;
  const gateWidth = 180;
  const gateHeight = 120;
  const postWidth = 22;
  const postHeight = 140;
  ctx.save();
  // Draw left post
  ctx.fillStyle = '#bfa77a';
  ctx.fillRect(gateCenterX - gateWidth / 2 - postWidth, gateBaseY - postHeight, postWidth, postHeight);
  // Draw right post
  ctx.fillRect(gateCenterX + gateWidth / 2, gateBaseY - postHeight, postWidth, postHeight);
  // Draw gate body (vertical bars)
  ctx.fillStyle = '#7a5c3a';
  for (let i = 0; i <= 6; i++) {
    const x = gateCenterX - gateWidth / 2 + i * (gateWidth / 6);
    ctx.fillRect(x - 4, gateBaseY - gateHeight, 8, gateHeight);
  }
  // Draw gate top (arched)
  ctx.beginPath();
  ctx.moveTo(gateCenterX - gateWidth / 2, gateBaseY - gateHeight);
  ctx.quadraticCurveTo(gateCenterX, gateBaseY - gateHeight - 40, gateCenterX + gateWidth / 2, gateBaseY - gateHeight);
  ctx.lineWidth = 8;
  ctx.strokeStyle = '#7a5c3a';
  ctx.stroke();
  // Draw horizontal bars
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(gateCenterX - gateWidth / 2, gateBaseY - gateHeight + 32);
  ctx.lineTo(gateCenterX + gateWidth / 2, gateBaseY - gateHeight + 32);
  ctx.moveTo(gateCenterX - gateWidth / 2, gateBaseY - gateHeight + 64);
  ctx.lineTo(gateCenterX + gateWidth / 2, gateBaseY - gateHeight + 64);
  ctx.stroke();
  ctx.restore();

  // GUARD TOWER (opposite side of path)
  const towerX = screenX + pathWidth/2 + 260;
  const towerY = houseY;
  const towerW = 70;
  const towerH = 180;
  const roofH_tower = 48;
  // Stone base
  ctx.save();
  ctx.fillStyle = "#bfc6d1";
  ctx.fillRect(towerX - towerW/2, towerY - towerH, towerW, towerH);
  // Brick lines
  ctx.strokeStyle = "#7a7d8c";
  ctx.lineWidth = 2;
  for (let y = towerY - towerH + 12; y < towerY; y += 16) {
    ctx.beginPath();
    ctx.moveTo(towerX - towerW/2, y);
    ctx.lineTo(towerX + towerW/2, y);
    ctx.stroke();
  }
  // Roof
  ctx.fillStyle = "#a87c4a";
  ctx.beginPath();
  ctx.moveTo(towerX - towerW/2 - 10, towerY - towerH);
  ctx.lineTo(towerX + towerW/2 + 10, towerY - towerH);
  ctx.lineTo(towerX, towerY - towerH - roofH_tower);
  ctx.closePath();
  ctx.fill();
  // Windows
  ctx.fillStyle = "#aee2ff";
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2;
  for (let i = -1; i <= 1; i++) {
    ctx.fillRect(towerX + i*22 - 12, towerY - towerH + 36, 24, 24);
    ctx.strokeRect(towerX + i*22 - 12, towerY - towerH + 36, 24, 24);
    ctx.beginPath();
    ctx.moveTo(towerX + i*22, towerY - towerH + 36);
    ctx.lineTo(towerX + i*22, towerY - towerH + 60);
    ctx.moveTo(towerX + i*22 - 12, towerY - towerH + 48);
    ctx.lineTo(towerX + i*22 + 12, towerY - towerH + 48);
    ctx.stroke();
  }
  // Flag
  ctx.beginPath();
  ctx.moveTo(towerX, towerY - towerH - roofH_tower);
  ctx.lineTo(towerX, towerY - towerH - roofH_tower - 36);
  ctx.strokeStyle = "#222";
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = "#2af";
  ctx.beginPath();
  ctx.moveTo(towerX, towerY - towerH - roofH_tower - 36);
  ctx.lineTo(towerX + 22, towerY - towerH - roofH_tower - 24);
  ctx.lineTo(towerX, towerY - towerH - roofH_tower - 12);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Overhauled hedges: layered bushes, color variation, flowers
  const bushRadius = 24;
  const hedgeOffset = pathWidth/2 + 80;
  const bushColors = ["#2e7d32", "#388e3c", "#43a047", "#66bb6a"];
  const flowerColors = ["#ff6f61", "#ffd700", "#aee2ff", "#e22", "#fff"];
  for (let y = -h/2 + 30; y <= h/2 - 30; y += 55) {
    // Layered bushes (3 per hedge row)
    for (let i = -1; i <= 1; i++) {
      const offset = i * (bushRadius + 8);
      ctx.save();
      ctx.globalAlpha = 0.85 - Math.abs(i)*0.15;
      ctx.fillStyle = bushColors[(y+i)%bushColors.length];
      ctx.beginPath();
      ctx.arc(screenX - hedgeOffset + offset, screenY + y, bushRadius, 0, Math.PI*2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(screenX + hedgeOffset + offset, screenY + y, bushRadius, 0, Math.PI*2);
      ctx.fill();
      ctx.globalAlpha = 1.0;
      ctx.restore();
      // Flowers (randomly placed)
      if (i === 0 && y % 110 === 0) {
        for (let f = 0; f < 3; f++) {
          ctx.fillStyle = flowerColors[(y+f)%flowerColors.length];
          ctx.beginPath();
          ctx.arc(screenX - hedgeOffset + offset + Math.random()*12 - 6, screenY + y + Math.random()*12 - 6, 4, 0, Math.PI*2);
          ctx.fill();
          ctx.beginPath();
          ctx.arc(screenX + hedgeOffset + offset + Math.random()*12 - 6, screenY + y + Math.random()*12 - 6, 4, 0, Math.PI*2);
          ctx.fill();
        }
      }
    }
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
  const riverHeight = 1050; // Tripled height for a much taller river

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

  // PIER (anchored, wide, long, styled like the gate)
  (function drawPier() {
    // Anchor pier in world space, centered horizontally, just below the coastline
    const gateWidth = 180;
    const pierWidth = gateWidth * 4; // 4x wider than the gate
    const pierLength = riverHeight; // cross the full river
    // Use the same world-space X as the gate
    const pierWorldX = castle.x;
    const pierWorldY = castle.y + courtyard.offsetY + 20 + courtyard.height / 2 + 400; // riverTop
    // Convert to screen space
    const pierScreenX = pierWorldX - camera.x + canvas.width / 2 - pierWidth / 2;
    const pierScreenY = pierWorldY - camera.y + canvas.height / 2;

    // Stylized pier body (vertical planks with wood grain, bolts, and color variation)
    ctx.save();
    const plankCount = 32;
    for (let i = 0; i <= plankCount; i++) {
      const x = pierScreenX + i * (pierWidth / plankCount);
      // Subtle color variation for planks
      ctx.fillStyle = i % 2 === 0 ? '#bfa77a' : '#c8b07a';
      ctx.strokeStyle = '#7a5c3a';
      ctx.lineWidth = 4;
      ctx.fillRect(x - 8, pierScreenY, 16, pierLength);
      ctx.strokeRect(x - 8, pierScreenY, 16, pierLength);
      // Wood grain lines
      ctx.save();
      ctx.strokeStyle = 'rgba(120,90,40,0.25)';
      ctx.lineWidth = 1.2;
      for (let g = 0; g < 4; g++) {
        ctx.beginPath();
        ctx.moveTo(x - 6, pierScreenY + 30 + g * 60 + Math.random()*10);
        ctx.bezierCurveTo(x, pierScreenY + 50 + g * 60 + Math.random()*10, x + 2, pierScreenY + 70 + g * 60 + Math.random()*10, x + 6, pierScreenY + 90 + g * 60 + Math.random()*10);
        ctx.stroke();
      }
      ctx.restore();
      // Bolts
      ctx.save();
      ctx.fillStyle = '#888';
      for (let b = 0; b < 6; b++) {
        ctx.beginPath();
        ctx.arc(x, pierScreenY + 30 + b * (pierLength / 6), 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    // Deck (top plank with shadow and highlight)
    ctx.save();
    // Shadow under deck
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = '#000';
    ctx.fillRect(pierScreenX, pierScreenY - 10, pierWidth, 18);
    ctx.globalAlpha = 1.0;
    // Deck plank
    ctx.fillStyle = '#b08d57';
    ctx.strokeStyle = '#7a5c3a';
    ctx.lineWidth = 4;
    ctx.fillRect(pierScreenX, pierScreenY - 18, pierWidth, 18);
    ctx.strokeRect(pierScreenX, pierScreenY - 18, pierWidth, 18);
    // Deck highlight
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = '#fff';
    ctx.fillRect(pierScreenX, pierScreenY - 18, pierWidth, 4);
    ctx.globalAlpha = 1.0;

    // --- Crates on the pier ---
    // Draw 3 crates at different spots on the pier deck
    function drawCrate(x, y, size = 38) {
      ctx.save();
      ctx.fillStyle = '#b08d57';
      ctx.strokeStyle = '#7a5c3a';
      ctx.lineWidth = 3;
      ctx.fillRect(x, y, size, size);
      ctx.strokeRect(x, y, size, size);
      // Wood slats
      ctx.strokeStyle = '#a88c5a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + 6, y + 8);
      ctx.lineTo(x + size - 6, y + size - 8);
      ctx.moveTo(x + size - 6, y + 8);
      ctx.lineTo(x + 6, y + size - 8);
      ctx.moveTo(x + size/2, y + 4);
      ctx.lineTo(x + size/2, y + size - 4);
      ctx.moveTo(x + 4, y + size/2);
      ctx.lineTo(x + size - 4, y + size/2);
      ctx.stroke();
      ctx.restore();
    }
    // Place crates spaced along the pier
    drawCrate(pierScreenX + pierWidth * 0.18, pierScreenY - 18 - 38, 38);
    drawCrate(pierScreenX + pierWidth * 0.52, pierScreenY - 18 - 38, 44);
    drawCrate(pierScreenX + pierWidth * 0.75, pierScreenY - 18 - 28, 32);

    ctx.restore();
    // Roof and walls for the pier (covered dock)
    (function drawPierRoofAndWalls() {
      // Roof parameters
      const roofHeight = 90;
      const roofOverhang = 32;
      const roofY = pierScreenY - 18 - roofHeight;
      // Solid, semi-transparent roof (no gable or shingle lines)
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(pierScreenX - roofOverhang, roofY + roofHeight); // left bottom
      ctx.lineTo(pierScreenX + pierWidth / 2, roofY); // top
      ctx.lineTo(pierScreenX + pierWidth + roofOverhang, roofY + roofHeight); // right bottom
      ctx.closePath();
      ctx.fillStyle = '#a97c50';
      ctx.globalAlpha = 0.65;
      ctx.fill();
      ctx.globalAlpha = 1.0;
      ctx.restore();

      // Side walls (railings)
      ctx.save();
      ctx.strokeStyle = '#a97c50';
      ctx.lineWidth = 7;
      ctx.globalAlpha = 0.85;
      // Left railing
      ctx.beginPath();
      ctx.moveTo(pierScreenX + 12, pierScreenY - 8);
      ctx.lineTo(pierScreenX + 12, pierScreenY + pierLength - 40);
      ctx.stroke();
      // Right railing
      ctx.beginPath();
      ctx.moveTo(pierScreenX + pierWidth - 12, pierScreenY - 8);
      ctx.lineTo(pierScreenX + pierWidth - 12, pierScreenY + pierLength - 40);
      ctx.stroke();
      // Top rails
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(pierScreenX + 12, pierScreenY - 8);
      ctx.lineTo(pierScreenX + pierWidth - 12, pierScreenY - 8);
      ctx.stroke();
      // Bottom rails (partial, not at water)
      ctx.beginPath();
      ctx.moveTo(pierScreenX + 12, pierScreenY + pierLength / 2);
      ctx.lineTo(pierScreenX + pierWidth - 12, pierScreenY + pierLength / 2);
      ctx.stroke();
      ctx.restore();
    })();
    // Posts (with wood rings and shadow)
    function drawPost(px, py) {
      ctx.save();
      // Post shadow
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.ellipse(px + 16, py + 48, 16, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1.0;
      // Post body
      ctx.fillStyle = '#7a5c3a';
      ctx.fillRect(px, py, 32, 48);
      ctx.strokeStyle = '#5a3c1a';
      ctx.lineWidth = 3;
      ctx.strokeRect(px, py, 32, 48);
      // Wood rings
      ctx.strokeStyle = '#a88c5a';
      ctx.lineWidth = 2;
      for (let r = 1; r <= 2; r++) {
        ctx.beginPath();
        ctx.moveTo(px + 4, py + r * 12);
        ctx.lineTo(px + 28, py + r * 12);
        ctx.stroke();
      }
      ctx.restore();
    }
    drawPost(pierScreenX - 16, pierScreenY - 24);
    drawPost(pierScreenX + pierWidth - 16, pierScreenY - 24);
    drawPost(pierScreenX - 16, pierScreenY + pierLength - 24);
    drawPost(pierScreenX + pierWidth - 16, pierScreenY + pierLength - 24);
    ctx.restore();
  })();

  // REFLECTION
  ctx.save();
  ctx.translate(0, riverTop * 2);
  ctx.scale(1, -1);
  ctx.globalAlpha = 0.25;

  drawCastle();

  const dpr = window.devicePixelRatio || 1;
  const logicalW = canvas.width / dpr;
  const logicalH = canvas.height / dpr;

  // Draw local player reflection
  if (characterSprites[characterType] && characterType !== "wizard") {
    // Custom sprite reflection
    const sprite = characterSprites[characterType].sprites.front;
    const scale = 4;
    const x = logicalW/2;
    const y = logicalH/2;
    for (let j = 0; j < sprite.length; j++) {
      const row = sprite[j];
      for (let i = 0; i < row.length; i++) {
        const ch = row[i];
        if (ch === "0") continue;
        if (characterType === "knight" && ch === "A") {
          const palette = characterSprites[characterType].robeColor;
          const t = performance.now();
          const idx = Math.floor(((Math.sin(i*0.8 + j*0.6 + t*0.004)+1)*1.5)) % palette.length;
          ctx.fillStyle = palette[idx];
        } else if (characterType === "knight" && ch === "E") {
          const palette = characterSprites[characterType].eyeColor;
          const t = performance.now();
          const idx = Math.floor(((Math.sin(i*1.5 + j*2.2 + t*0.01)+1)*1.5)) % palette.length;
          ctx.fillStyle = palette[idx];
        } else {
          ctx.fillStyle = ch === "K" ? "#000" : ch === "W" ? "#fff" : ch === "N" ? "#e0ac69" : ch === "S" ? "#f1c27d" : ch === "G" ? "#f5c542" : ch === "3" ? characterSprites[characterType].robeColor : "#888";
        }
        ctx.fillRect(Math.floor(x + i*scale), Math.floor(y + j*scale), scale, scale);
      }
    }
  } else {
    drawWizard(
      ctx,
      logicalW/2,
      logicalH/2,
      4,
      walkFrame,
      idleTime,
      facing
    );
  }
  // Weapon reflection
  const weaponX = logicalW/2 + 38;
  const weaponY = logicalH/2 + 26;
  if (activeWeapon === 1) {
    drawScepter(
      ctx,
      weaponX,
      weaponY,
      3,
      walkFrame,
      idleTime,
      attackAnim,
      charging
    );
  } else if (activeWeapon === 2) {
    drawFishingPole(
      ctx,
      weaponX,
      weaponY,
      3,
      facing
    );
  }

  // Draw remote player reflections
  if (window.remotePlayers) {
    for (const id in window.remotePlayers) {
      const rp = window.remotePlayers[id];
      if (!rp) continue;
      const screenX = rp.x - camera.x + logicalW/2;
      const screenY = rp.y - camera.y + logicalH/2;
      let remoteType = rp.characterType || "wizard";
      if (characterSprites[remoteType] && remoteType !== "wizard") {
        const sprite = characterSprites[remoteType].sprites.front;
        const scale = 4;
        for (let j = 0; j < sprite.length; j++) {
          const row = sprite[j];
          for (let i = 0; i < row.length; i++) {
            const ch = row[i];
            if (ch === "0") continue;
            if (remoteType === "knight" && ch === "A") {
              const palette = characterSprites[remoteType].robeColor;
              const t = performance.now();
              const idx = Math.floor(((Math.sin(i*0.8 + j*0.6 + t*0.004)+1)*1.5)) % palette.length;
              ctx.fillStyle = palette[idx];
            } else if (remoteType === "knight" && ch === "E") {
              const palette = characterSprites[remoteType].eyeColor;
              const t = performance.now();
              const idx = Math.floor(((Math.sin(i*1.5 + j*2.2 + t*0.01)+1)*1.5)) % palette.length;
              ctx.fillStyle = palette[idx];
            } else {
              ctx.fillStyle = ch === "K" ? "#000" : ch === "W" ? "#fff" : ch === "N" ? "#e0ac69" : ch === "S" ? "#f1c27d" : ch === "G" ? "#f5c542" : ch === "3" ? characterSprites[remoteType].robeColor : "#888";
            }
            ctx.fillRect(Math.floor(screenX + i*scale), Math.floor(screenY + j*scale), scale, scale);
          }
        }
      } else {
        drawWizard(
          ctx,
          screenX,
          screenY,
          4,
          0,
          0,
          rp.facing || { x: 1, y: 0 },
          rp.robeColor || '#5b2fa0'
        );
      }
      // Draw weapon for remote player
      const weaponX = screenX + 38;
      const weaponY = screenY + 26;
      if (rp.activeWeapon === 1) {
        drawScepter(
          ctx,
          weaponX,
          weaponY,
          3,
          0,
          0,
          0,
          false
        );
      } else if (rp.activeWeapon === 2) {
        if (typeof drawFishingPole === 'function') {
          drawFishingPole(
            ctx,
            weaponX,
            weaponY,
            3,
            rp.facing || { x: 1, y: 0 }
          );
        }
      }
    }
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

  // Facelift: Castle base with gradient stone
  const grad = ctx.createLinearGradient(screenX, screenY - h/2, screenX, screenY + h/2);
  grad.addColorStop(0, "#bfc6d1");
  grad.addColorStop(1, "#7a7d8c");
  ctx.fillStyle = grad;
  ctx.fillRect(screenX - w/2, screenY - h/2, w, h);

  // Inner courtyard with lighter stone
  ctx.fillStyle = "#e3e6ed";
  ctx.fillRect(
    screenX - w/2 + t,
    screenY - h/2 + t,
    w - t*2,
    h - t*2
  );

  // Towers (4 corners) with brick pattern and highlights
  const towerRadius = 90;
  const towerColors = ["#d1bfa3", "#bfa98c", "#a38c7a"];
  const corners = [
    [-w/2, -h/2],
    [ w/2, -h/2],
    [-w/2,  h/2],
    [ w/2,  h/2]
  ];
  corners.forEach(([ox, oy], idx) => {
    ctx.save();
    ctx.beginPath();
    ctx.arc(screenX + ox, screenY + oy, towerRadius, 0, Math.PI*2);
    ctx.clip();
    // Brick pattern
    for (let y = -towerRadius; y < towerRadius; y += 16) {
      for (let x = -towerRadius; x < towerRadius; x += 32) {
        ctx.fillStyle = towerColors[(x+y+idx*2)%towerColors.length];
        ctx.fillRect(screenX + ox + x, screenY + oy + y, 28, 12);
      }
    }
    // Highlight
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(screenX + ox, screenY + oy - 30, towerRadius * 0.7, 0, Math.PI*2);
    ctx.fill();
    ctx.globalAlpha = 1.0;
    ctx.restore();
    // Tower top
    ctx.save();
    ctx.beginPath();
    ctx.arc(screenX + ox, screenY + oy, towerRadius, 0, Math.PI*2);
    ctx.lineWidth = 6;
    ctx.strokeStyle = "#6a6a75";
    ctx.stroke();
    ctx.restore();
    // Flag
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(screenX + ox, screenY + oy - towerRadius);
    ctx.lineTo(screenX + ox, screenY + oy - towerRadius - 36);
    ctx.strokeStyle = "#222";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = idx % 2 === 0 ? "#e22" : "#2af";
    ctx.beginPath();
    ctx.moveTo(screenX + ox, screenY + oy - towerRadius - 36);
    ctx.lineTo(screenX + ox + 22, screenY + oy - towerRadius - 24);
    ctx.lineTo(screenX + ox, screenY + oy - towerRadius - 12);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  });

  // Gate (south side) with arch and details
  ctx.save();
  ctx.fillStyle = "#7a5c3a";
  ctx.fillRect(
    screenX - 80,
    screenY + h/2 - 20,
    160,
    120
  );
  // Arch
  ctx.beginPath();
  ctx.arc(screenX, screenY + h/2 + 40, 80, Math.PI, 0);
  ctx.fillStyle = "#e3e6ed";
  ctx.globalAlpha = 0.7;
  ctx.fill();
  ctx.globalAlpha = 1.0;
  // Door
  ctx.fillStyle = "#4a2b1a";
  ctx.fillRect(screenX - 36, screenY + h/2 + 40, 72, 60);
  // Door knob
  ctx.fillStyle = "#d9b15b";
  ctx.beginPath();
  ctx.arc(screenX + 24, screenY + h/2 + 70, 6, 0, Math.PI*2);
  ctx.fill();
  ctx.restore();

  // Windows on castle front
  ctx.save();
  ctx.fillStyle = "#aee2ff";
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2;
  for (let i = -1; i <= 1; i++) {
    ctx.fillRect(screenX + i*120 - 18, screenY - h/2 + 36, 36, 36);
    ctx.strokeRect(screenX + i*120 - 18, screenY - h/2 + 36, 36, 36);
    // Crossbars
    ctx.beginPath();
    ctx.moveTo(screenX + i*120, screenY - h/2 + 36);
    ctx.lineTo(screenX + i*120, screenY - h/2 + 72);
    ctx.moveTo(screenX + i*120 - 18, screenY - h/2 + 54);
    ctx.lineTo(screenX + i*120 + 18, screenY - h/2 + 54);
    ctx.stroke();
  }
  ctx.restore();

  ctx.restore();
}




function drawHUD(logicalW, logicalH) {
  // Overlay HTML buttons for QWER on mobile/touch devices
  if (typeof window !== 'undefined' && window.isMobileHUDOverlay !== true && ('ontouchstart' in window || navigator.maxTouchPoints > 0)) {
    window.isMobileHUDOverlay = true;
    // Remove any existing overlay
    const old = document.getElementById('hud-touch-overlay');
    if (old) old.remove();
    const overlay = document.createElement('div');
    overlay.id = 'hud-touch-overlay';
    overlay.style.position = 'fixed';
    overlay.style.left = '0';
    overlay.style.top = '0';
    overlay.style.width = '100vw';
    overlay.style.height = '100vh';
    overlay.style.pointerEvents = 'none';
    overlay.style.zIndex = '10000';
    document.body.appendChild(overlay);
    const abilities = ['q','w','e','r'];
    const baseSize = 50;
    const spacing = 70;
    const logicalW = window.innerWidth;
    const logicalH = window.innerHeight;
    const centerX = logicalW / 2;
    const startX = centerX - (spacing * 1.5);
    abilities.forEach((key, i) => {
      const x = startX + i * spacing;
      const y = logicalH - 80;
      const btn = document.createElement('button');
      btn.innerText = key.toUpperCase();
      btn.style.position = 'absolute';
      btn.style.left = (x - baseSize/2) + 'px';
      btn.style.top = (y - baseSize/2) + 'px';
      btn.style.width = baseSize + 'px';
      btn.style.height = baseSize + 'px';
      btn.style.opacity = '0';
      btn.style.pointerEvents = 'auto';
      btn.style.border = 'none';
      btn.style.background = 'transparent';
      btn.style.zIndex = '10001';
      btn.addEventListener('touchstart', function(e) {
        e.preventDefault();
        const down = new KeyboardEvent('keydown', { key });
        window.dispatchEvent(down);
      });
      btn.addEventListener('touchend', function(e) {
        e.preventDefault();
        const up = new KeyboardEvent('keyup', { key });
        window.dispatchEvent(up);
      });
      btn.addEventListener('mousedown', function(e) {
        e.preventDefault();
        const down = new KeyboardEvent('keydown', { key });
        window.dispatchEvent(down);
      });
      btn.addEventListener('mouseup', function(e) {
        e.preventDefault();
        const up = new KeyboardEvent('keyup', { key });
        window.dispatchEvent(up);
      });
      overlay.appendChild(btn);
    });
  }

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

function triggerUltimateBurst(centerX = camera.x, centerY = camera.y) {
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
window.triggerUltimateBurst = triggerUltimateBurst;

function drawUltimateHalo(centerX = null, centerY = null, timer = null) {
  const dpr = window.devicePixelRatio || 1;
  const logicalW = canvas.width / dpr;
  const logicalH = canvas.height / dpr;

  // Use provided position or default to local
  if (!centerX) centerX = logicalW / 2;
  if (!centerY) centerY = logicalH / 2;

  const radius = 140;

  // only draw ring after windup delay
  let useTimer = timer !== null ? timer : ultTimer;
  if (useTimer < ultWindup) return;

  const activeTime = useTimer - ultWindup;
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
  drawSouthForest();
  // Draw a forest south of the bridge (below the river)
  function drawSouthForest() {
    // Use world coordinates for correct placement
    // Anchor forest in world space so it doesn't move with the player
    const worldCenterX = castle.x;
    const worldCenterY = castle.y + courtyard.offsetY + 20;
    const h = courtyard.height;
    const riverTopWorld = worldCenterY + h/2 + 400;
    const riverHeight = 1050;
    const forestYWorld = riverTopWorld + riverHeight + 40;
    const forestHeight = 420 * 9;
    const forestLeftWorld = worldCenterX - 1600;
    const forestRightWorld = worldCenterX + 1600;
    const treeCount = 48;
    // Cherry blossom petal particles blowing in the wind
    const petalCount = 60;
    const windSpeed = 0.18;
    const t = performance.now() * 0.00025;
    for (let p = 0; p < petalCount; p++) {
      // Use seededRand for deterministic spread
      const pxBase = forestLeftWorld + (forestRightWorld - forestLeftWorld) * seededRand(1000 + p);
      const pyBase = forestYWorld + forestHeight * seededRand(2000 + p);
      // Animate petals drifting right and slightly up/down
      const px = pxBase + (t * 320 + 120 * seededRand(3000 + p)) % (forestRightWorld - forestLeftWorld);
      const py = pyBase + Math.sin(t * 2 + p) * 32 + Math.cos(t + p) * 12;
      // Only draw petals within the visible screen
      const sx = px - camera.x + canvas.width / 2;
      const sy = py - camera.y + canvas.height / 2;
      if (sx < -40 || sx > canvas.width + 40 || sy < -40 || sy > canvas.height + 40) continue;
      ctx.save();
      ctx.globalAlpha = 0.7 + 0.2 * seededRand(4000 + p);
      ctx.fillStyle = seededRand(5000 + p) > 0.5 ? '#ffd6f6' : '#ffb7e5';
      ctx.beginPath();
      ctx.ellipse(sx, sy, 8 + 4 * seededRand(6000 + p), 4 + 2 * seededRand(7000 + p), Math.PI * 2 * seededRand(8000 + p), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    // Path parameters
    const pathWidth = 120 * 3;
    const pathLeft = worldCenterX - pathWidth / 2;
    const pathRight = worldCenterX + pathWidth / 2;
    // Draw grass under the forest area
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = '#4fa84f';
    ctx.fillRect(forestLeftWorld - camera.x + canvas.width / 2, forestYWorld - camera.y + canvas.height / 2, forestRightWorld - forestLeftWorld, forestHeight);
    ctx.globalAlpha = 1.0;
    ctx.restore();
    // Deterministic pseudo-random for consistent tree placement
    function seededRand(seed) {
      let x = Math.sin(seed) * 10000;
      return x - Math.floor(x);
    }
    for (let i = 0; i < treeCount * 9; i++) {
      // Distribute trees in clusters with some deterministic randomness
      const cluster = Math.floor(i / 16);
      const rx = seededRand(i + 1) * 0.7;
      const ry = seededRand(i + 100) * 0.7;
      const cx = seededRand(i + 200) * 18 - seededRand(i + 300) * 32;
      const cy = seededRand(i + 400) * 12;
      const xWorld = forestLeftWorld + (forestRightWorld - forestLeftWorld) * (i + rx) / (treeCount * 9) + cluster * 18 + cx;
      const yWorld = forestYWorld + (ry * forestHeight) + cy;
      // Skip trees that would overlap the path
      if (xWorld > pathLeft - 18 && xWorld < pathRight + 18) continue;
      // Convert world to screen coordinates
      const x = xWorld - camera.x + canvas.width / 2;
      const y = yWorld - camera.y + canvas.height / 2;
      // Randomly select some trees to be cherry blossoms with birch trunks
      const cherryChance = 0.18;
      const isCherry = seededRand(i + 500) < cherryChance;
      ctx.save();
      if (isCherry) {
        // White birch trunk
        ctx.fillStyle = '#f7f7f2';
        ctx.fillRect(x - 6, y + 36, 12, 44);
        // Birch trunk stripes
        ctx.strokeStyle = '#bdbdbd';
        ctx.lineWidth = 2;
        for (let s = 0; s < 4; s++) {
          ctx.beginPath();
          ctx.moveTo(x - 4, y + 44 + s * 10);
          ctx.lineTo(x + 4, y + 44 + s * 10);
          ctx.stroke();
        }
        // Cherry blossom foliage
        ctx.beginPath();
        ctx.arc(x, y + 24, 36, 0, Math.PI * 2);
        ctx.arc(x - 20, y + 36, 26, 0, Math.PI * 2);
        ctx.arc(x + 20, y + 36, 26, 0, Math.PI * 2);
        ctx.fillStyle = seededRand(i + 800) > 0.5 ? '#ffd6f6' : '#ffb7e5';
        ctx.globalAlpha = 0.93;
        ctx.fill();
        ctx.globalAlpha = 1.0;
      } else {
        // Regular tree
        ctx.fillStyle = '#7a5c3a';
        ctx.fillRect(x - 6, y + 36, 12, 44); // trunk bigger
        // Draw larger foliage (layered circles)
        ctx.beginPath();
        ctx.arc(x, y + 24, 36, 0, Math.PI * 2);
        ctx.arc(x - 20, y + 36, 26, 0, Math.PI * 2);
        ctx.arc(x + 20, y + 36, 26, 0, Math.PI * 2);
        ctx.fillStyle = i % 3 === 0 ? '#3e7d3a' : (i % 3 === 1 ? '#4fa84f' : '#2e5d2a');
        ctx.globalAlpha = 0.93;
        ctx.fill();
        ctx.globalAlpha = 1.0;
      }
      ctx.restore();
    }
    // Draw the path itself (dirt path)
    ctx.save();
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = '#bfa77a';
    ctx.beginPath();
    ctx.moveTo(pathLeft - camera.x + canvas.width / 2, forestYWorld - camera.y + canvas.height / 2);
    ctx.lineTo(pathRight - camera.x + canvas.width / 2, forestYWorld - camera.y + canvas.height / 2);
    ctx.lineTo(pathRight - camera.x + canvas.width / 2, forestYWorld + forestHeight + 80 * 9 - camera.y + canvas.height / 2);
    ctx.lineTo(pathLeft - camera.x + canvas.width / 2, forestYWorld + forestHeight + 80 * 9 - camera.y + canvas.height / 2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // === Lava Fountain with Black Stone Pavers (slightly smaller, more effects) ===
    // Position: end of the path
    const scale = 3.2;
    const fountainCenterX = worldCenterX;
    const fountainCenterY = forestYWorld + forestHeight + 80 * 9 + 60 * scale;
    const screenFountainX = fountainCenterX - camera.x + canvas.width / 2;
    const screenFountainY = fountainCenterY - camera.y + canvas.height / 2;

    // Draw black stone pavers (circle around fountain)
    const paverCount = 24;
    const paverRadius = 64 * scale;
    for (let i = 0; i < paverCount; i++) {
      const angle = (Math.PI * 2 / paverCount) * i;
      const px = screenFountainX + Math.cos(angle) * paverRadius;
      const py = screenFountainY + Math.sin(angle) * paverRadius;
      ctx.save();
      ctx.globalAlpha = 0.82;
      ctx.fillStyle = '#222';
      ctx.beginPath();
      ctx.ellipse(px, py, 22 * scale, 16 * scale, angle, 0, Math.PI * 2);
      ctx.shadowColor = '#000';
      ctx.shadowBlur = 8 * scale;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.restore();
    }

    // Draw lava fountain base
    ctx.save();
    ctx.globalAlpha = 0.93;
    ctx.fillStyle = '#3a2a1a';
    ctx.beginPath();
    ctx.arc(screenFountainX, screenFountainY, 38 * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Draw animated lava (center)
    const lavaT = performance.now() * 0.002;
    ctx.save();
    ctx.globalAlpha = 0.92;
    for (let r = 0; r < 3; r++) {
      ctx.beginPath();
      const radius = (22 - r * 5 + Math.sin(lavaT + r) * 2) * scale;
      ctx.arc(screenFountainX, screenFountainY, radius, 0, Math.PI * 2);
      ctx.fillStyle = r === 0 ? '#ff6a00' : (r === 1 ? '#ffb300' : '#fff2a8');
      ctx.shadowColor = r === 0 ? '#ff6a00' : '#ffb300';
      ctx.shadowBlur = (18 - r * 6) * scale;
      ctx.fill();
    }
    ctx.shadowBlur = 0;
    ctx.restore();

    // Draw smoke particles (smaller)
    const smokeCount = 22;
    for (let i = 0; i < smokeCount; i++) {
      const t2 = lavaT + i * 0.18;
      const angle = Math.PI * 2 * (i / smokeCount) + Math.sin(lavaT + i) * 0.2;
      const dist = 18 * scale + Math.sin(lavaT * 0.7 + i) * 8 * scale;
      const sx = screenFountainX + Math.cos(angle) * dist + Math.sin(lavaT + i) * 6;
      const sy = screenFountainY - 30 * scale - Math.abs(Math.sin(lavaT + i) * 12 * scale) - i * 2.5;
      ctx.save();
      ctx.globalAlpha = 0.18 + 0.13 * Math.sin(lavaT * 1.2 + i);
      ctx.fillStyle = '#444';
      ctx.beginPath();
      ctx.ellipse(sx, sy, 6 * scale * (0.7 + 0.3 * Math.sin(t2)), 3.5 * scale * (0.7 + 0.3 * Math.cos(t2)), angle, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Draw flying lava spurts/particles (smaller)
    const spurtCount = 18;
    for (let i = 0; i < spurtCount; i++) {
      const t3 = lavaT + i * 0.7;
      const spurtAngle = Math.PI * 2 * (i / spurtCount) + Math.sin(lavaT * 0.7 + i) * 0.2;
      const baseRadius = 18 * scale;
      const spurtLen = 90 * scale + Math.sin(lavaT * 2.1 + i) * 18 * scale;
      const px = screenFountainX + Math.cos(spurtAngle) * baseRadius;
      const py = screenFountainY - Math.abs(Math.sin(lavaT + i) * 12 * scale);
      const vx = Math.cos(spurtAngle) * spurtLen * Math.abs(Math.sin(t3));
      const vy = -spurtLen * Math.abs(Math.cos(t3));
      // Animate flying particle
      const fx = px + vx * Math.abs(Math.sin(lavaT * 0.7 + i * 0.3));
      const fy = py + vy * Math.abs(Math.sin(lavaT * 0.7 + i * 0.3));
      ctx.save();
      ctx.globalAlpha = 0.7 + 0.3 * Math.abs(Math.sin(lavaT + i));
      ctx.fillStyle = i % 2 === 0 ? '#ffb300' : '#ff6a00';
      ctx.beginPath();
      ctx.ellipse(fx, fy, 2.8 * scale, 1.5 * scale, spurtAngle, 0, Math.PI * 2);
      ctx.shadowColor = '#ff6a00';
      ctx.shadowBlur = 3 * scale;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.restore();
    }

    // Draw lava spout (fountain jet)
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    const spoutHeight = (54 + Math.sin(lavaT * 2) * 8) * scale;
    ctx.moveTo(screenFountainX, screenFountainY);
    ctx.bezierCurveTo(
      screenFountainX - 10 * scale, screenFountainY - spoutHeight * 0.4,
      screenFountainX + 10 * scale, screenFountainY - spoutHeight * 0.7,
      screenFountainX, screenFountainY - spoutHeight
    );
    ctx.lineWidth = 18 * scale;
    ctx.strokeStyle = '#ff6a00';
    ctx.shadowColor = '#ff6a00';
    ctx.shadowBlur = 16 * scale;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 7 * scale;
    ctx.strokeStyle = '#fff2a8';
    ctx.stroke();
    ctx.restore();
  }
  drawAttacks(ctx, camera, logicalW, logicalH);
// =========================
// DRAW REMOTE PLAYERS
// =========================
if (window.remotePlayers) {
  for (const id in window.remotePlayers) {
    const rp = window.remotePlayers[id];
    const screenX = rp.x - camera.x + logicalW/2;
    const screenY = rp.y - camera.y + logicalH/2;
    // Use correct characterType for remote player
    let remoteType = rp.characterType || "wizard";
    if (characterSprites[remoteType] && remoteType !== "wizard") {
      const sprite = characterSprites[remoteType].sprites.front;
      const scale = 4;
      for (let j = 0; j < sprite.length; j++) {
        const row = sprite[j];
        for (let i = 0; i < row.length; i++) {
          const ch = row[i];
          if (ch === "0") continue;
          if (remoteType === "knight" && ch === "A") {
            const palette = characterSprites[remoteType].robeColor;
            const t = performance.now();
            const idx = Math.floor(((Math.sin(i*0.8 + j*0.6 + t*0.004)+1)*1.5)) % palette.length;
            ctx.fillStyle = palette[idx];
          } else if (remoteType === "knight" && ch === "E") {
            const palette = characterSprites[remoteType].eyeColor;
            const t = performance.now();
            const idx = Math.floor(((Math.sin(i*1.5 + j*2.2 + t*0.01)+1)*1.5)) % palette.length;
            ctx.fillStyle = palette[idx];
          } else {
            ctx.fillStyle = ch === "K" ? "#000" : ch === "W" ? "#fff" : ch === "N" ? "#e0ac69" : ch === "S" ? "#f1c27d" : ch === "G" ? "#f5c542" : ch === "3" ? characterSprites[remoteType].robeColor : "#888";
          }
          ctx.fillRect(Math.floor(screenX + i*scale), Math.floor(screenY + j*scale), scale, scale);
        }
      }
    } else {
      drawWizard(
        ctx,
        screenX,
        screenY,
        4,
        0,
        0,
        rp.facing || { x: 1, y: 0 },
        rp.robeColor || '#5b2fa0'
      );
    }
    // Draw weapon for remote player
    const weaponX = screenX + 38;
    const weaponY = screenY + 26;
    if (rp.activeWeapon === 1) {
      drawScepter(
        ctx,
        weaponX,
        weaponY,
        3,
        0,
        0,
        0,
        false
      );
    } else if (rp.activeWeapon === 2) {
      if (typeof drawFishingPole === 'function') {
        drawFishingPole(
          ctx,
          weaponX,
          weaponY,
          3,
          rp.facing || { x: 1, y: 0 }
        );
      }
    }
  }
}
  // =========================
  // Darken screen during ult
  // =========================
  if (ulting) {
    const fadeIn = Math.min(1, ultTimer / ultWindup);
    ctx.fillStyle = `rgba(0,0,0,${0.7 * fadeIn})`;
    ctx.fillRect(0,0,logicalW,logicalH);
  }
  // Draw remote ult effects
  for (const id in remoteUlting) {
    if (remoteUlting[id]) {
      const fadeIn = Math.min(1, remoteUltTimer[id] / ultWindup);
      ctx.fillStyle = `rgba(0,0,0,${0.7 * fadeIn})`;
      ctx.fillRect(0,0,logicalW,logicalH);
      // Draw halo at remote player's screen position
      const rp = window.remotePlayers[id];
      if (rp) {
        const screenX = rp.x - camera.x + logicalW/2;
        const screenY = rp.y - camera.y + logicalH/2;
        drawUltimateHalo(screenX, screenY, remoteUltTimer[id]);
      }
    }
  }
  // Draw remote ultimate burst projectiles
  for (const id in remoteUlting) {
    if (remoteUlting[id] && remoteUltBurstTriggered[id]) {
      // Only trigger burst if not already triggered this frame
      if (!remoteUlting[id].burstDrawn) {
        triggerUltimateBurst(remoteUlting[id].x, remoteUlting[id].y);
        remoteUlting[id].burstDrawn = true;
      }
    } else if (remoteUlting[id]) {
      remoteUlting[id].burstDrawn = false;
    }
  }
  // =========================
  // Wizard
  // =========================
  let raiseOffset = 0;
  if (ulting) {
    const progress = Math.min(1, ultTimer / 400);
    raiseOffset = -20 * progress;
  }


  // Use alternate sprite system if selected
  if (characterSprites[characterType] && characterType !== "wizard") {
    // Custom sprite drawing (front only for demo)
    const sprite = characterSprites[characterType].sprites.front;
    const scale = 4;
    const x = logicalW/2;
    const y = logicalH/2 + raiseOffset;
    for (let j = 0; j < sprite.length; j++) {
      const row = sprite[j];
      for (let i = 0; i < row.length; i++) {
        const ch = row[i];
        if (ch === "0") continue;
        // Animate knight robe color
        if (characterType === "knight" && ch === "A") {
          const palette = characterSprites[characterType].robeColor;
          const t = performance.now();
          const idx = Math.floor(((Math.sin(i*0.8 + j*0.6 + t*0.004)+1)*1.5)) % palette.length;
          ctx.fillStyle = palette[idx];
        } else if (characterType === "knight" && ch === "E") {
          const palette = characterSprites[characterType].eyeColor;
          const t = performance.now();
          const idx = Math.floor(((Math.sin(i*1.5 + j*2.2 + t*0.01)+1)*1.5)) % palette.length;
          ctx.fillStyle = palette[idx];
        } else {
          ctx.fillStyle = ch === "K" ? "#000" : ch === "W" ? "#fff" : ch === "N" ? "#e0ac69" : ch === "S" ? "#f1c27d" : ch === "G" ? "#f5c542" : ch === "3" ? characterSprites[characterType].robeColor : "#888";
        }
        ctx.fillRect(Math.floor(x + i*scale), Math.floor(y + j*scale), scale, scale);
      }
    }
  } else {
    drawWizard(
      ctx,
      logicalW/2,
      logicalH/2 + raiseOffset,
      4,
      walkFrame,
      idleTime,
      facing,
      '#5b2fa0'
    );
  }

  // Draw player name tag (smaller, centered, white)
  if (playerName) {
    ctx.save();
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    // Shadow for readability
    ctx.shadowColor = 'black';
    ctx.shadowBlur = 4;
    ctx.fillStyle = '#fff';
    const nameOffsetX = 40; // move right by 40px
    ctx.fillText(playerName, logicalW/2 + nameOffsetX, logicalH/2 + raiseOffset - 18);
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  // Draw remote player name tags
  if (window.remotePlayers) {
    for (const id in window.remotePlayers) {
      const rp = window.remotePlayers[id];
      if (!rp) continue;
      // Only show name if valid string (not fallback to id or hashes)
      const name = (typeof rp.name === 'string' && rp.name.trim().length > 0) ? rp.name : '';
      if (name) {
        const screenX = rp.x - camera.x + logicalW/2;
        const screenY = rp.y - camera.y + logicalH/2;
        ctx.save();
        ctx.font = 'bold 14px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.shadowColor = 'black';
        ctx.shadowBlur = 4;
        ctx.fillStyle = '#fff';
          const nameOffsetX = 40; // match local player orientation
          ctx.fillText(name, screenX + nameOffsetX, screenY - 18);
        ctx.shadowBlur = 0;
        ctx.restore();
      }
    }
  }

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
