import { drawWizard } from "./character.js";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

let joy = { x: 0, y: 0 };

// Player state with velocity
let player = {
    x: canvas.width / 2,
    y: canvas.height / 2,
    vx: 0,
    vy: 0
};

// Configurable parameters
const maxSpeed = 2.5;
const accel = 0.2;

// update loop with inertia (normal Y)
function update() {
    player.vx += (joy.x * maxSpeed - player.vx) * accel;
    player.vy += (joy.y * maxSpeed - player.vy) * accel; // normal vertical

    player.x += player.vx;
    player.y += player.vy;

    player.x = Math.max(0, Math.min(canvas.width, player.x));
    player.y = Math.max(0, Math.min(canvas.height, player.y));
}

// draw
function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawWizard(ctx, player.x, player.y, 4);
}

setInterval(() => {
    update();
    draw();
}, 33);

// joystick
const stick = document.getElementById("stick");
const knob = document.getElementById("knob");
let dragging = false;

stick.addEventListener("touchstart", () => dragging = true);
window.addEventListener("touchend", () => {
    dragging = false;
    knob.style.left = "40px";
    knob.style.top = "40px";
    joy.x = 0;
    joy.y = 0;
});
window.addEventListener("touchmove", e => {
    if (!dragging) return;
    const rect = stick.getBoundingClientRect();
    const t = e.touches[0];
    let x = t.clientX - rect.left - 70;
    let y = t.clientY - rect.top - 70;

    const dist = Math.sqrt(x*x + y*y);
    const max = 50;
    if(dist > max){ x = x/dist*max; y = y/dist*max; }

    knob.style.left = (40 + x) + "px";
    knob.style.top  = (40 + y) + "px";

    joy.x = x / max;
    joy.y = y / max; // normal Y
});
