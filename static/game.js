import { castAttack, updateAttacks, drawAttacks } from "./attack.js?v=1";
import { drawWizard } from "./character.js?v=2";
import { drawScepter } from "./weapon.js?v=1";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

let joy = { x: 0, y: 0 };
const tileSize = 40;

let player = { x: 0, y: 0 };
let facing = { x: 1, y: 0 };

let camera = { x: 0, y: 0, targetX: 0, targetY: 0 };
const cameraLerp = 0.12;

const moveDelay = 286;
let lastMove = 0;

/* WALK STATE */
let walking = false;
let walkFrame = 0;
let walkTimer = 0;

/* IDLE TIMER (ms) */
let idleTime = 0;

function tryMove(){
  const now = Date.now();
  if(now - lastMove < moveDelay) return;

  let dx = 0, dy = 0;

  if(Math.abs(joy.x) > Math.abs(joy.y)) dx = joy.x > 0 ? 1 : -1;
  else if(Math.abs(joy.y) > 0) dy = joy.y > 0 ? 1 : -1;
  else return;

  if(dx || dy){ facing.x = dx; facing.y = dy; }

  player.x += dx * tileSize;
  player.y += dy * tileSize;

  walking = true;
  walkFrame ^= 1;
  walkTimer = 250;

  // reset idle when moving
  idleTime = 0;

  lastMove = now;
}

function update(dt){
  tryMove();

  camera.targetX = player.x;
  camera.targetY = player.y;

  camera.x += (camera.targetX - camera.x) * cameraLerp;
  camera.y += (camera.targetY - camera.y) * cameraLerp;

  if(walking){
    walkTimer -= dt;
    if(walkTimer <= 0) walking = false;
  }

  // accumulate idle only when not walking
  if(!walking) idleTime += dt;
}

function drawFloor(){
  const startX = Math.floor((camera.x - canvas.width/2) / tileSize) * tileSize;
  const startY = Math.floor((camera.y - canvas.height/2) / tileSize) * tileSize;

  for(let y = startY; y < camera.y + canvas.height/2 + tileSize; y += tileSize){
    for(let x = startX; x < camera.x + canvas.width/2 + tileSize; x += tileSize){
      const screenX = x - camera.x + canvas.width/2;
      const screenY = y - camera.y + canvas.height/2;

      ctx.fillStyle = ((x/tileSize + y/tileSize) % 2 === 0) ? "#fff" : "#000";
      ctx.fillRect(screenX, screenY, tileSize, tileSize);
    }
  }
}

function draw(){
  ctx.clearRect(0,0,canvas.width,canvas.height);
  drawFloor();

  // attacks behind player
  drawAttacks(ctx);

  // player centered
  drawWizard(ctx, canvas.width/2, canvas.height/2, 4, walkFrame, idleTime);

  // scepter in front of player
  const sx = canvas.width/2 + 38;
  const sy = canvas.height/2 + 26;
  drawScepter(ctx, sx, sy, 3, walkFrame, idleTime);
}

let last = performance.now();
setInterval(() => {
  const now = performance.now();
  const dt = now - last;
  last = now;

  update(dt);
  updateAttacks(dt);
  draw();
}, 33);

/* joystick */
const stick = document.getElementById("stick");
const knob = document.getElementById("knob");
let dragging = false;

stick.addEventListener("touchstart", () => dragging = true);

window.addEventListener("touchend", () => {
  dragging = false;
  knob.style.left = "40px";
  knob.style.top = "40px";
  joy.x = 0; joy.y = 0;
});

window.addEventListener("touchmove", e => {
  if(!dragging) return;

  const rect = stick.getBoundingClientRect();
  const t = e.touches[0];

  let x = t.clientX - rect.left - 70;
  let y = t.clientY - rect.top - 70;

  const dist = Math.sqrt(x*x + y*y);
  const max = 50;
  if(dist > max){ x = x/dist*max; y = y/dist*max; }

  knob.style.left = (40 + x) + "px";
  knob.style.top  = (40 + y) + "px";

  joy.x = x/max;
  joy.y = y/max;
});

/* --- ATTACK BUTTON --- */
window.action = function(btn){
  if(btn !== "A") return;

  const sx = canvas.width/2 + 38;
  const sy = canvas.height/2 + 26;

  let dx = 0, dy = 0;
  if(Math.abs(facing.x) > Math.abs(facing.y)){
    dx = facing.x > 0 ? 1 : -1;
    dy = 0;
  } else {
    dx = 0;
    dy = facing.y > 0 ? 1 : -1;
  }

  castAttack(sx, sy, dx, dy);
};
