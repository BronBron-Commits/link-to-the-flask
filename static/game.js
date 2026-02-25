// Draw remote fishing poles and bobbers
if (window.remotePlayers) {
  for (const id in window.remotePlayers) {
    const rp = window.remotePlayers[id];
    if (!rp) continue;
    if (rp.activeWeapon === 2) {
      // Draw fishing pole
      const remoteSX = rp.x - camera.x + logicalW/2 + 38;
      const remoteSY = rp.y - camera.y + logicalH/2 + 26;
      drawFishingPole(
        ctx,
        remoteSX,
        remoteSY,
        3,
        rp.facing || { x: 1, y: 0 }
      );
      // Draw remote fishing bobber and effects
      if (rp.fishingComp) {
        drawFishing(ctx, rp.fishingComp, camera);
      }
    }
  }
}
import { NetworkClient } from "./network.js";
const networkClient = new NetworkClient();

import { createFishingComponent, startCast, updateFishing, drawFishing, handleFishingInput, FishingState } from "./fishing.js";

// Assign a unique player ID for this session (not shared across tabs)
const playerId = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
window.playerId = playerId;

import { sfxShoot, sfxCharged, sfxShotgun } from "./sfx.js";
import { castAttack, castShotgun, updateAttacks, drawAttacks } from "./attack.js?v=300";

window.castAttack = castAttack;
window.castShotgun = castShotgun;
import { drawWizard } from "./character.js?v=2";
import { characterSprites } from "./character_sprites.js";
import { drawScepter } from "./weapon.js?v=2";
import { sendAttack, sendShotgun } from "./network.js";
const remotePlayers = {};
window.remotePlayers = remotePlayers;

// =========================
// Mini Map Drawing
// =========================
/**
 * Draws a mini map in the top right corner of the screen.
 * @param {CanvasRenderingContext2D} ctx - The canvas 2D context.
 * @param {Object} player - The player object with x, y properties.
 * @param {Array} remotePlayersArr - Array of remote player objects with x, y properties.
 * @param {Object} world - The world bounds { width, height }.
 */
function drawMiniMap(ctx, player, remotePlayersArr, world) {
  const mapWidth = 180;
  const mapHeight = 180;
  const padding = 16;
  const borderRadius = 16;
  const mapX = ctx.canvas.width / (window.devicePixelRatio || 1) - mapWidth - padding;
  const mapY = padding;

  // Draw background
  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = '#181c22';
  ctx.beginPath();
  ctx.moveTo(mapX + borderRadius, mapY);
  ctx.lineTo(mapX + mapWidth - borderRadius, mapY);
  ctx.quadraticCurveTo(mapX + mapWidth, mapY, mapX + mapWidth, mapY + borderRadius);
  ctx.lineTo(mapX + mapWidth, mapY + mapHeight - borderRadius);
  ctx.quadraticCurveTo(mapX + mapWidth, mapY + mapHeight, mapX + mapWidth - borderRadius, mapY + mapHeight);
  ctx.lineTo(mapX + borderRadius, mapY + mapHeight);
  ctx.quadraticCurveTo(mapX, mapY + mapHeight, mapX, mapY + mapHeight - borderRadius);
  ctx.lineTo(mapX, mapY + borderRadius);
  ctx.quadraticCurveTo(mapX, mapY, mapX + borderRadius, mapY);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1.0;
  ctx.strokeStyle = '#444';
  ctx.lineWidth = 2;
  ctx.stroke();
  // Draw a scaled-down reimage of the world inside the mini map
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(mapX + borderRadius, mapY);
  ctx.lineTo(mapX + mapWidth - borderRadius, mapY);
  ctx.quadraticCurveTo(mapX + mapWidth, mapY, mapX + mapWidth, mapY + borderRadius);
  ctx.lineTo(mapX + mapWidth, mapY + mapHeight - borderRadius);
  ctx.quadraticCurveTo(mapX + mapWidth, mapY + mapHeight, mapX + mapWidth - borderRadius, mapY + mapHeight);
  ctx.lineTo(mapX + borderRadius, mapY + mapHeight);
  ctx.quadraticCurveTo(mapX, mapY + mapHeight, mapX, mapY + mapHeight - borderRadius);
  ctx.lineTo(mapX, mapY + borderRadius);
  ctx.quadraticCurveTo(mapX, mapY, mapX + borderRadius, mapY);
  ctx.closePath();
  ctx.clip();
  // Calculate scale to fit the world
  const worldW = world?.width || 4000;
  const worldH = world?.height || 4000;
  const scale = Math.min((mapWidth - 32) / worldW, (mapHeight - 32) / worldH);
  ctx.translate(mapX + 16, mapY + 16);
  ctx.scale(scale, scale);
  // Draw world features (floor, castle, river, etc.)
  if (typeof drawFloor === 'function') drawFloor();
  if (typeof drawCastle === 'function') drawCastle();
  if (typeof drawRiver === 'function') drawRiver();
  if (typeof drawCourtyard === 'function') drawCourtyard();
  // Optionally draw other features
  ctx.restore();

  // Show the same area as the main screen (camera view)
  // Use camera coordinates and screen size for scaling
  const cameraW = ctx.canvas.width;
  const cameraH = ctx.canvas.height;
  const scaleX = (mapWidth - 32) / cameraW;
  const scaleY = (mapHeight - 32) / cameraH;
  const offsetX = mapX + 16;
  const offsetY = mapY + 16;

  // Draw player
  if (player && typeof camera !== 'undefined') {
    ctx.fillStyle = '#4af';
    // Calculate player's position relative to camera
    const px = offsetX + (player.x - camera.x + cameraW / 2) * scaleX;
    const py = offsetY + (player.y - camera.y + cameraH / 2) * scaleY;
    ctx.beginPath();
    ctx.arc(px, py, 7, 0, 2 * Math.PI);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // Draw remote players
  if (Array.isArray(remotePlayersArr) && typeof camera !== 'undefined') {
    ctx.fillStyle = '#fa4';
    for (const rp of remotePlayersArr) {
      const rx = offsetX + (rp.x - camera.x + cameraW / 2) * scaleX;
      const ry = offsetY + (rp.y - camera.y + cameraH / 2) * scaleY;
      ctx.beginPath();
      ctx.arc(rx, ry, 5, 0, 2 * Math.PI);
      ctx.fill();
    }
  }

  // Optionally draw castle/moat/other features here
  ctx.restore();
}

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

// Accordion play state
let accordionHeld = false;
let accordionAnim = 0; // 0 = idle, 1 = fully open
let musicNotes = [];

// Homemade synth for accordion tune
let accordionSynth = null;
let accordionSynthTimeouts = [];
// Bass line: root notes of each chord (I-vi-IV-V)
const bassNotes = [
  130.81, // C3
  110.00, // A2
  174.62, // F3
  196.00  // G3
];
const bassDur = 180; // ms, short staccato
// I-vi-IV-V (C, Am, F, G) as arpeggio
const accordionMelody = [
  {note:130.81, dur:440}, // C3
  {note:164.82, dur:440}, // E3
  {note:196.00, dur:440}, // G3
  {note:110.00, dur:440}, // A2
  {note:130.81, dur:440}, // C3
  {note:164.82, dur:440}, // E3
  {note:174.62, dur:440}, // F3
  {note:220.00, dur:440}, // A3
  {note:261.63, dur:440}, // C4
  {note:196.00, dur:440}, // G3
  {note:246.94, dur:440}, // B3
  {note:293.67, dur:640}, // D4
];

function playAccordionMelody() {
  if (accordionSynth || accordionMelodyLooping) return; // Already playing
  accordionMelodyLooping = true;
  function playLoop() {
    if (!accordionMelodyLooping) return;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    accordionSynth = ctx;
    let t = ctx.currentTime;
    const swingRatio = 0.62; // 62% for long, 38% for short
    let baseDur = 440;
    accordionMelody.forEach((n, i) => {
      // Swing: odd notes are longer, even notes are shorter
      let dur = n.dur;
      if (i < accordionMelody.length - 1) {
        if (i % 2 === 0) dur = baseDur * swingRatio;
        else dur = baseDur * (1 - swingRatio);
      }
      // Two detuned oscillators per note (triangle and sawtooth)
      [0, -8].forEach(detune => {
        ['triangle', 'sawtooth'].forEach(type => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = type;
          osc.frequency.value = n.note;
          osc.detune.value = detune;
          // Envelope: gentle attack/release
          gain.gain.setValueAtTime(0, t);
          gain.gain.linearRampToValueAtTime(0.13, t + 0.06);
          gain.gain.linearRampToValueAtTime(0.11, t + (dur/1000) - 0.08);
          gain.gain.linearRampToValueAtTime(0, t + dur/1000);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(t);
          osc.stop(t + dur/1000);
          // Clean up
          const timeout = setTimeout(()=>{
            osc.disconnect();
            gain.disconnect();
          }, (t-ctx.currentTime)*1000 + dur + 100);
          accordionSynthTimeouts.push(timeout);
        });
      });
      t += dur/1000;
    });

    // Staccato bass line: root of each chord, one per measure
    let bassT = ctx.currentTime;
    const chordLen = 3; // 3 melody notes per chord
    for (let i = 0; i < bassNotes.length; ++i) {
      const freq = bassNotes[i];
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, bassT);
      gain.gain.linearRampToValueAtTime(0.18, bassT + 0.03);
      gain.gain.linearRampToValueAtTime(0, bassT + bassDur/1000);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(bassT);
      osc.stop(bassT + bassDur/1000);
      const timeout = setTimeout(()=>{
        osc.disconnect();
        gain.disconnect();
      }, (bassT-ctx.currentTime)*1000 + bassDur + 100);
      accordionSynthTimeouts.push(timeout);
      // Advance bassT by the duration of 3 melody notes (one chord)
      let chordTotal = 0;
      for (let j = 0; j < chordLen; ++j) {
        let idx = i * chordLen + j;
        let dur = accordionMelody[idx]?.dur || baseDur;
        if (idx < accordionMelody.length - 1) {
          if (idx % 2 === 0) dur = baseDur * swingRatio;
          else dur = baseDur * (1 - swingRatio);
        }
        chordTotal += dur;
      }
      bassT += chordTotal / 1000;
    }
    // Schedule next loop
    const totalDur = t - ctx.currentTime;
    const loopTimeout = setTimeout(() => {
      try { ctx.close(); } catch(e){}
      accordionSynth = null;
      playLoop();
    }, totalDur * 1000);
    accordionSynthTimeouts.push(loopTimeout);
  }
  playLoop();
}

function stopAccordionMelody() {
  accordionMelodyLooping = false;
  if (accordionSynth) {
    try { accordionSynth.close(); } catch(e){}
    accordionSynth = null;
  }
  accordionSynthTimeouts.forEach(clearTimeout);
  accordionSynthTimeouts = [];
}
let fishingAnim = 0;
let fishingAnimType = null; // 'q', 'w', 'e', 'r'
let ultNoiseOsc = null;
let ultNoiseGain = null;
      let accordionMelodyLooping = false;
let charging = false;
let chargeMs = 0;
const chargeMaxMs = 900;
let chargeAutoReleased = false;
let chargeSoundTimer = 0;

let fishingComp = createFishingComponent();
let fishingCharging = false;
let fishingChargeStart = 0;

let eCooldownTimer = 0;
let qKeyHeld = false;
let wKeyHeld = false;
let eKeyHeld = false;
// Accordion state

// Helper for drawing the accordion
// Removed duplicate function declaration
function drawAccordion(ctx, x, y, scale = 1, facing = {x:1, y:0}, isReflection = false) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.rotate(Math.atan2(facing.y, facing.x) + (isReflection ? Math.PI/2 : 0));

  // Animate bellows open/close
  let bellowsOpen = accordionAnim || 0;
  let bellowsWidth = 12 + 8 * bellowsOpen;

  // Draw left side (red wood with buttons)
  ctx.fillStyle = '#b33';

  ctx.strokeStyle = '#800';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-18, -10);
  ctx.lineTo(-6, -8);
  ctx.lineTo(-6, 8);
  ctx.lineTo(-18, 10);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Buttons (white circles)
  ctx.fillStyle = '#fff';
  for (let i = -6; i <= 6; i += 6) {
    ctx.beginPath();
    ctx.arc(-14, i, 1.5, 0, 2 * Math.PI);
    ctx.fill();
    ctx.strokeStyle = '#aaa';
    ctx.stroke();
  }

  // Draw right side (black wood with keys)
  ctx.fillStyle = '#222';
  ctx.strokeStyle = '#111';
  ctx.beginPath();
  ctx.moveTo(18, -10);
  ctx.lineTo(6, -8);
  ctx.lineTo(6, 8);
  ctx.lineTo(18, 10);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Keys (white and black rectangles)
  for (let i = -6; i <= 6; i += 4) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(10, i - 1, 5, 3);
    if (i % 8 === 0) {
      ctx.fillStyle = '#000';
      ctx.fillRect(13, i - 1, 2, 3);
    }
  }

  // Draw bellows (pleated, animated width)
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(-6, -8);
  ctx.lineTo(-6 + bellowsWidth, -8);
  ctx.lineTo(-6 + bellowsWidth, 8);
  ctx.lineTo(-6, 8);
  ctx.closePath();
  ctx.clip();
  for (let i = 0; i < 8; i++) {
    ctx.strokeStyle = i % 2 === 0 ? '#eee' : '#bbb';
    ctx.beginPath();
    ctx.moveTo(-6 + i * (bellowsWidth/7), -8);
    ctx.lineTo(-6 + i * (bellowsWidth/7), 8);
    ctx.stroke();
  }
  ctx.restore();

  // Bellows outline
  ctx.strokeStyle = '#888';
  ctx.lineWidth = 1;
  ctx.strokeRect(-6, -8, bellowsWidth, 16);

  ctx.restore();
}
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
  // Accordion play (hold spacebar)
  // On mobile, only equip accordion when actually playing
  if (key === " " && (activeWeapon === 3 || (typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0)))) {
    if (!accordionHeld) {
      // On mobile, switch to accordion only while playing
      if (typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0)) {
        activeWeapon = 3;
      }
      accordionHeld = true;
      accordionAnim = 1;
      // Spawn a music note every time play starts
      musicNotes.push({
        x: player.x + 38,
        y: player.y + 10,
        vx: Math.random()*1-0.5,
        vy: -1.5-Math.random(),
        t: 0,
        color: `hsl(${Math.floor(Math.random()*360)},80%,70%)`
      });
      playAccordionMelody();
    }
  }
  // Prevent regular attacks if accordion is held
  if (activeWeapon === 3 && accordionHeld) {
    return;
  }
if (key === "1") activeWeapon = 1;
if (key === "2") activeWeapon = 2;
if (key === "3") activeWeapon = 3;
if (activeWeapon === 2) {
  // Q: Hold to charge, release to cast farther
  if (key === "q" && !qKeyHeld && cooldowns.q <= 0 && energy >= energyCosts.q && !fishingCharging) {
    qKeyHeld = true;
    fishingCharging = true;
    fishingChargeStart = performance.now();
    // Don't startCast or animate yet; wait for keyup
  }
  if (key === "w" && !wKeyHeld && cooldowns.w <= 0 && energy >= energyCosts.w) {
    wKeyHeld = true;
    energy -= energyCosts.w;
    fishingAnim = 1;
    fishingAnimType = 'w';
    startCast({ ...player, facing }, fishingComp, 100);
  }
  if (key === "e" && !eKeyHeld && cooldowns.e <= 0 && energy >= energyCosts.e) {
    eKeyHeld = true;
    energy -= energyCosts.e;
    fishingAnim = 1;
    fishingAnimType = 'e';
    startCast({ ...player, facing }, fishingComp, 120);
  }
  if (key === "r" && !ulting && cooldowns.r <= 0 && energy >= energyCosts.r) {
    energy -= energyCosts.r;
    fishingAnim = 1;
    fishingAnimType = 'r';
    startCast({ ...player, facing }, fishingComp, 140);
  }
 
  // Handle fishing input (e.g. hook with Q)
  handleFishingInput(key, fishingComp);
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

  if (key === "q") {
    qKeyHeld = false;
    if (activeWeapon === 2 && fishingCharging && cooldowns.q <= 0 && energy >= energyCosts.q) {
      fishingCharging = false;
      const chargeDuration = Math.min(performance.now() - fishingChargeStart, 1200); // ms
      // Map chargeDuration (min 80, max 220)
      const minDist = 80, maxDist = 220;
      const dist = minDist + ((maxDist - minDist) * (chargeDuration / 1200));
      energy -= energyCosts.q;
      fishingAnim = 1;
      fishingAnimType = 'q';
      startCast({ ...player, facing }, fishingComp, dist);
    }
  }
  if (key === "w") wKeyHeld = false;

  if (key === "e") {
    eKeyHeld = false;

    if (charging) {
      releaseCharge();
    }
  }
  // Release accordion
  if (key === " ") {
    accordionHeld = false;
    accordionAnim = 0;
    stopAccordionMelody();
    // On mobile, unequip accordion when not playing
    if (typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0)) {
      if (activeWeapon === 3) activeWeapon = 1;
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
  // Draw rod string for this player only
  if (typeof window !== 'undefined' && window._bobberScreenPos && window._bobberScreenPos[playerId]) {
    ctx.save();
    ctx.strokeStyle = "rgba(230,230,230,0.85)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(12, -28); // rod tip
    // Transform rod tip to screen coordinates
    const m = ctx.getTransform();
    // End point is in screen coordinates
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.moveTo(m.e + 12 * m.a - 28 * m.b, m.f + 12 * m.c - 28 * m.d); // rod tip in screen
    ctx.lineTo(window._bobberScreenPos[playerId].x, window._bobberScreenPos[playerId].y);
    ctx.stroke();
    ctx.restore();
  } else {
    ctx.strokeStyle = "rgba(230,230,230,0.7)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(12, -28);
    ctx.lineTo(12, -6);
    ctx.stroke();
  }

  // (Removed static bobber/hook here; now only the dynamic bobber is drawn in drawFishing)

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
  // Desktop movement logic (restore)
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

// Mobile movement logic using virtual joystick
let joystick = {
  active: false,
  startX: 0,
  startY: 0,
  currentX: 0,
  currentY: 0,
  dx: 0,
  dy: 0
};

function createJoystick() {
  if (document.getElementById('joystick-container')) return;
  const container = document.createElement('div');
  container.id = 'joystick-container';
  container.style.position = 'fixed';
  container.style.left = '24px';
  container.style.bottom = '110px'; // Slightly above HUD
  container.style.width = '120px';
  container.style.height = '120px';
  container.style.zIndex = '10001';
  container.style.touchAction = 'none';
  document.body.appendChild(container);

  const base = document.createElement('div');
  base.style.position = 'absolute';
  base.style.left = '0';
  base.style.top = '0';
  base.style.width = '120px';
  base.style.height = '120px';
  base.style.background = 'rgba(80,80,80,0.18)';
  base.style.borderRadius = '60px';
  container.appendChild(base);

  const stick = document.createElement('div');
  stick.id = 'joystick-stick';
  stick.style.position = 'absolute';
  stick.style.left = '40px';
  stick.style.top = '40px';
  stick.style.width = '40px';
  stick.style.height = '40px';
  stick.style.background = 'rgba(180,180,180,0.7)';
  stick.style.borderRadius = '20px';
  stick.style.boxShadow = '0 2px 8px #0002';
  container.appendChild(stick);

  // Touch events
  container.addEventListener('touchstart', function(e) {
    const touch = e.touches[0];
    joystick.active = true;
    const rect = container.getBoundingClientRect();
    joystick.startX = touch.clientX - rect.left;
    joystick.startY = touch.clientY - rect.top;
    joystick.currentX = joystick.startX;
    joystick.currentY = joystick.startY;
    joystick.dx = 0;
    joystick.dy = 0;
    stick.style.left = (joystick.startX - 20) + 'px';
    stick.style.top = (joystick.startY - 20) + 'px';
  });
  container.addEventListener('touchmove', function(e) {
    if (!joystick.active) return;
    const touch = e.touches[0];
    const rect = container.getBoundingClientRect();
    let x = touch.clientX - rect.left;
    let y = touch.clientY - rect.top;
    // Clamp to circle radius 48px
    const dx = x - joystick.startX;
    const dy = y - joystick.startY;
    const dist = Math.hypot(dx, dy);
    const maxDist = 48;
    let clampedDx = dx, clampedDy = dy;
    if (dist > maxDist) {
      clampedDx = dx * maxDist / dist;
      clampedDy = dy * maxDist / dist;
      x = joystick.startX + clampedDx;
      y = joystick.startY + clampedDy;
    }
    stick.style.left = (x - 20) + 'px';
    stick.style.top = (y - 20) + 'px';
    joystick.currentX = x;
    joystick.currentY = y;
    joystick.dx = clampedDx / maxDist;
    joystick.dy = clampedDy / maxDist;
  });
  container.addEventListener('touchend', function(e) {
    joystick.active = false;
    joystick.dx = 0;
    joystick.dy = 0;
    stick.style.left = '40px';
    stick.style.top = '40px';
  });
}

if (isMobileDevice()) {
  window.addEventListener('DOMContentLoaded', createJoystick);
}

function mobileTryMove(dt) {
  // Use joystick input for movement
  if (!joystick.active || (Math.abs(joystick.dx) < 0.1 && Math.abs(joystick.dy) < 0.1)) {
    walking = false;
    return;
  }
  const speed = moveSpeed;
  player.x += joystick.dx * speed;
  player.y += joystick.dy * speed;
  // Snap facing
  if (Math.abs(joystick.dx) > Math.abs(joystick.dy)) {
    facing.x = joystick.dx > 0 ? 1 : -1;
    facing.y = 0;
  } else {
    facing.y = joystick.dy > 0 ? 1 : -1;
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

  // Update fishing logic if fishing pole is active
  if (activeWeapon === 2) {
    updateFishing(dt, fishingComp);
  }

  // Accordion animation
  if (activeWeapon === 3) {
    if (accordionHeld) {
      accordionAnim = Math.min(1, accordionAnim + dt*0.004);
      // Occasionally spawn music notes while held
      if (Math.random() < dt*0.0015) {
        musicNotes.push({
          x: player.x + 38,
          y: player.y + 10,
          vx: Math.random()*1-0.5,
          vy: -1.5-Math.random(),
          t: 0,
          color: `hsl(${Math.floor(Math.random()*360)},80%,70%)`
        });
      }
    } else {
      accordionAnim = Math.max(0, accordionAnim - dt*0.004);
    }
  }

  // Update music notes
  for (let note of musicNotes) {
    note.x += note.vx;
    note.y += note.vy;
    note.t += dt;
  }
  // Remove old notes
  musicNotes = musicNotes.filter(n => n.t < 2000);

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
    name: playerName,
    accordionHeld
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
  } else if (activeWeapon === 3) {
    // Draw accordion reflection with extra 90 degree rotation
    drawAccordion(
      ctx,
      weaponX,
      weaponY,
      1.5, // match main draw size
      facing,
      true // isReflection
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
  // On mobile/touch, only show the overlay HUD and skip drawing the canvas HUD
  if (typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0)) {
    // Always remove any existing overlay before creating a new one
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
    const abilities = ['q','w','e','r','accordion'];
    const baseSize = 50;
    const spacing = 70;
    const logicalW = window.innerWidth;
    const logicalH = window.innerHeight;
    const centerX = logicalW / 2;
    const startX = centerX - (spacing * 2);
    abilities.forEach((key, i) => {
      const x = startX + i * spacing;
      const y = logicalH - 80;
      const btn = document.createElement('button');
      btn.innerText = key === 'accordion' ? 'ACD' : key.toUpperCase();
      btn.style.position = 'absolute';
      btn.style.left = (x - baseSize/2) + 'px';
      btn.style.top = (y - baseSize/2) + 'px';
      btn.style.width = baseSize + 'px';
      btn.style.height = baseSize + 'px';
      btn.style.opacity = '1';
      btn.style.pointerEvents = 'auto';
      btn.style.border = '2px solid #2af';
      btn.style.background = 'rgba(34,42,68,0.92)';
      btn.style.borderRadius = '14px';
      btn.style.color = '#fff';
      btn.style.fontWeight = 'bold';
      btn.style.fontSize = '1.2em';
      btn.style.boxShadow = '0 2px 10px #0008';
      btn.style.zIndex = '10001';
      btn.style.transition = 'background 0.2s, border 0.2s';
      btn.onpointerdown = () => btn.style.background = '#2af8';
      btn.onpointerup = () => btn.style.background = 'rgba(34,42,68,0.92)';
      btn.onpointerleave = () => btn.style.background = 'rgba(34,42,68,0.92)';
      if (key === 'accordion') {
        btn.addEventListener('touchstart', function(e) {
          e.preventDefault();
          // Switch to accordion and hold space
          const one = new KeyboardEvent('keydown', { key: '3' });
          window.dispatchEvent(one);
          const down = new KeyboardEvent('keydown', { key: ' ' });
          window.dispatchEvent(down);
        });
        btn.addEventListener('touchend', function(e) {
          e.preventDefault();
          // Release space
          const up = new KeyboardEvent('keyup', { key: ' ' });
          window.dispatchEvent(up);
        });
        btn.addEventListener('mousedown', function(e) {
          e.preventDefault();
          const one = new KeyboardEvent('keydown', { key: '3' });
          window.dispatchEvent(one);
          const down = new KeyboardEvent('keydown', { key: ' ' });
          window.dispatchEvent(down);
        });
        btn.addEventListener('mouseup', function(e) {
          e.preventDefault();
          const up = new KeyboardEvent('keyup', { key: ' ' });
          window.dispatchEvent(up);
        });
      } else {
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
      }
      overlay.appendChild(btn);
    });
    return; // Do not draw the canvas HUD on mobile
  }

  const hudHeight = 120;
  const barWidth = 300;
  const barHeight = 18;
  const centerX = logicalW / 2;
  const bottomY = logicalH - 30;

  // Modern HUD background: blurred, rounded, gradient
    // Draw fish icon and Q charge bar if holding fishing rod
    if (typeof activeWeapon !== 'undefined' && activeWeapon === 2) {
      // Position: left of HUD
      const iconX = 70;
      const iconY = logicalH - hudHeight / 2 - 10;
      const iconSize = 44;
      // Draw fish icon (simple stylized fish)
      ctx.save();
      ctx.translate(iconX, iconY);
      ctx.scale(iconSize / 48, iconSize / 48);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#2af';
      ctx.fillStyle = '#bff';
      ctx.beginPath();
      ctx.ellipse(0, 0, 18, 10, 0, 0, Math.PI * 2);
      ctx.moveTo(-18, 0);
      ctx.lineTo(-28, -10);
      ctx.lineTo(-28, 10);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // Eye
      ctx.beginPath();
      ctx.arc(10, -3, 2, 0, Math.PI * 2);
      ctx.fillStyle = '#222';
      ctx.fill();
      ctx.restore();
      // Draw charge bar (always visible, longer)
      const barW = 110;
      const barH = 12;
      const barX = iconX - barW / 2 + 10;
      const barY = iconY + iconSize / 2 + 10;
      let qCharge = 0;
      if (fishingCharging && typeof fishingChargeStart !== 'undefined') {
        qCharge = Math.min(1, (performance.now() - fishingChargeStart) / chargeMaxMs);
      }
      ctx.save();
      ctx.strokeStyle = '#2af';
      ctx.lineWidth = 2.5;
      ctx.fillStyle = '#bff';
      ctx.beginPath();
      ctx.roundRect(barX, barY, barW, barH, 5);
      ctx.stroke();
      if (qCharge > 0) {
        ctx.fillStyle = '#2af';
        ctx.beginPath();
        ctx.roundRect(barX, barY, barW * qCharge, barH, 5);
        ctx.fill();
      }
      ctx.restore();
    }
  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = ctx.createLinearGradient(0, logicalH - hudHeight, 0, logicalH);
  ctx.fillStyle.addColorStop(0, '#222a');
  ctx.fillStyle.addColorStop(1, '#444a');
  ctx.beginPath();
  ctx.moveTo(20, logicalH - hudHeight + 20);
  ctx.lineTo(logicalW - 20, logicalH - hudHeight + 20);
  ctx.quadraticCurveTo(logicalW, logicalH - hudHeight + 40, logicalW, logicalH - 20);
  ctx.lineTo(logicalW, logicalH - 20);
  ctx.quadraticCurveTo(logicalW - 20, logicalH, 20, logicalH);
  ctx.lineTo(20, logicalH);
  ctx.quadraticCurveTo(0, logicalH - 20, 0, logicalH - hudHeight + 40);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // HEALTH
  const healthPercent = health / maxHealth;
  // Rounded health bar with gradient
  ctx.save();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#a33';
  ctx.fillStyle = ctx.createLinearGradient(centerX - barWidth/2, 0, centerX + barWidth/2, 0);
  ctx.fillStyle.addColorStop(0, '#e22');
  ctx.fillStyle.addColorStop(1, '#f66');
  ctx.beginPath();
  ctx.roundRect(centerX - barWidth/2, bottomY - 50, barWidth, barHeight, 9);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = ctx.createLinearGradient(centerX - barWidth/2, 0, centerX - barWidth/2 + barWidth * healthPercent, 0);
  ctx.fillStyle.addColorStop(0, '#e22');
  ctx.fillStyle.addColorStop(1, '#fff');
  ctx.beginPath();
  ctx.roundRect(centerX - barWidth/2, bottomY - 50, barWidth * healthPercent, barHeight, 9);
  ctx.fill();
  ctx.restore();

  // ENERGY
  const energyPercent = energy / maxEnergy;
  ctx.save();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#2af';
  ctx.fillStyle = ctx.createLinearGradient(centerX - barWidth/2, 0, centerX + barWidth/2, 0);
  ctx.fillStyle.addColorStop(0, '#2af');
  ctx.fillStyle.addColorStop(1, '#6ff');
  ctx.beginPath();
  ctx.roundRect(centerX - barWidth/2, bottomY - 25, barWidth, barHeight, 9);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = ctx.createLinearGradient(centerX - barWidth/2, 0, centerX - barWidth/2 + barWidth * energyPercent, 0);
  ctx.fillStyle.addColorStop(0, '#2af');
  ctx.fillStyle.addColorStop(1, '#fff');
  ctx.beginPath();
  ctx.roundRect(centerX - barWidth/2, bottomY - 25, barWidth * energyPercent, barHeight, 9);
  ctx.fill();
  ctx.restore();

  // ABILITIES
  const abilities = ["q","w","e","r"];
  const baseSize = 50;
  const spacing = 70;
  const startX = centerX - (spacing * 1.5);

  ctx.font = "bold 22px sans-serif";
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
    // Ability button: rounded, shadow, icon
    ctx.shadowColor = canAfford ? '#2af' : '#a33';
    ctx.shadowBlur = canAfford ? 12 : 6;
    ctx.fillStyle = canAfford ? '#222' : '#111';
    ctx.strokeStyle = canAfford ? '#2af' : '#a33';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(-baseSize/2, -baseSize/2, baseSize, baseSize, 12);
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;

    if (cooldowns[key] > 0) {
      const percent = cooldowns[key] / cooldownDurations[key];
      ctx.fillStyle = "rgba(0,0,0,0.7)";
      ctx.beginPath();
      ctx.roundRect(-baseSize/2, -baseSize/2, baseSize, baseSize * percent, 12);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = "bold 18px sans-serif";
      ctx.fillText((cooldowns[key] / 1000).toFixed(1), 0, 0);
    } else {
      ctx.fillStyle = canAfford ? "#fff" : "#555";
      ctx.font = "bold 22px sans-serif";
      ctx.fillText(key.toUpperCase(), 0, 0);
    }

    ctx.restore();
  });
  // Add icons or text for health/energy
  ctx.save();
  ctx.font = "bold 18px sans-serif";
  ctx.fillStyle = "#fff";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("❤", centerX - barWidth/2 - 30, bottomY - 41);
  ctx.fillText("⚡", centerX - barWidth/2 - 30, bottomY - 16);
  ctx.restore();
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
    if (rp.accordionHeld) {
      // Draw accordion for remote player regardless of activeWeapon
      ctx.save();
      if (rp.facing && rp.facing.y > 0) {
        ctx.translate(weaponX, weaponY + 18); // Pull down
        ctx.rotate(Math.PI / 2); // 90 degrees
      } else if (rp.facing && rp.facing.x > 0) {
        ctx.translate(weaponX + 32, weaponY); // More extreme push right
        ctx.rotate(Math.PI / 2); // 90 degrees
      } else if (rp.facing && rp.facing.x < 0) {
        ctx.translate(weaponX - 32, weaponY); // More extreme push left
        ctx.rotate(-Math.PI / 2); // -90 degrees
      } else if (rp.facing && rp.facing.y < 0) {
        ctx.translate(weaponX, weaponY - 18);
        ctx.rotate(-Math.PI / 2); // -90 degrees
      } else {
        ctx.translate(weaponX, weaponY);
      }
      drawAccordion(ctx, 0, 0, 1.5, rp.facing || {x:1,y:0});
      ctx.restore();
      // Optionally: draw floating notes for remote players here if you sync them
    } else if (rp.activeWeapon === 1) {
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

  // Draw fishing bobber and effects
  drawFishing(ctx, fishingComp, camera);

} else if (activeWeapon === 3) {

  // Draw accordion at 50% size, orientation and offset depend on facing
  ctx.save();
  if (facing.y > 0) { // Facing down/front
    ctx.translate(sx, sy + 18); // Pull down
    ctx.rotate(Math.PI / 2); // 90 degrees
  } else if (facing.x > 0) { // Facing right
    ctx.translate(sx + 32, sy); // More extreme push right
    ctx.rotate(Math.PI / 2); // 90 degrees
  } else if (facing.x < 0) { // Facing left
    ctx.translate(sx - 32, sy); // More extreme push left
    ctx.rotate(-Math.PI / 2); // -90 degrees
  } else if (facing.y < 0) { // Facing up
    ctx.translate(sx, sy - 18);
    ctx.rotate(-Math.PI / 2); // -90 degrees
  } else {
    ctx.translate(sx, sy);
  }
  drawAccordion(
    ctx,
    0,
    0,
    1.5, // 50% of previous size (was 3)
    facing
  );
  ctx.restore();

}

  if (ulting) {
    drawUltimateHalo();
  }

  if (screenShake > 0) {
    ctx.restore();
  }

  drawMiniMap(ctx, logicalW, logicalH);
  // Draw floating music notes (above player)
  function drawMusicNotes(ctx, camera) {
    for (let note of musicNotes) {
      ctx.save();
      ctx.globalAlpha = 1 - note.t/2000;
      ctx.fillStyle = note.color;
      ctx.font = 'bold 22px Arial';
      ctx.translate(note.x - camera.x + ctx.canvas.width/2, note.y - camera.y + ctx.canvas.height/2);
      ctx.rotate(Math.sin(note.t*0.005 + note.x)*0.3);
      ctx.fillText('♪', 0, 0);
      ctx.restore();
    }
  }
  drawMusicNotes(ctx, camera);
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
