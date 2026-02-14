const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

// Logical resolution (retro internal resolution)
const GAME_WIDTH = 360;
const GAME_HEIGHT = 640;

// Match device pixel ratio
const DPR = window.devicePixelRatio || 1;

canvas.width = GAME_WIDTH * DPR;
canvas.height = GAME_HEIGHT * DPR;
canvas.style.width = GAME_WIDTH + "px";
canvas.style.height = GAME_HEIGHT + "px";

ctx.scale(DPR, DPR);

// Disable smoothing
ctx.imageSmoothingEnabled = false;

// ===== Floating animation =====
let floatOffset = 0;
let floatDir = 1;

// ===== Draw Character =====
function drawCharacter(cx, cy) {
    const p = 6; // pixel unit

    ctx.fillStyle = "#4B0082";
    ctx.fillRect(cx - 5*p, cy - 3*p, 10*p, 10*p);

    ctx.fillStyle = "#f1c27d";
    ctx.fillRect(cx - 2*p, cy - 6*p, 4*p, 4*p);

    ctx.fillStyle = "#000000";
    ctx.fillRect(cx - 3*p, cy - 1*p, 6*p, 5*p);

    ctx.fillStyle = "#a020f0";
    ctx.fillRect(cx - p, cy + p, 2*p, p);
    ctx.fillRect(cx - 2*p, cy + 2*p, 4*p, p);
    ctx.fillRect(cx - p, cy + 3*p, 2*p, p);

    ctx.fillStyle = "#f1c27d";
    ctx.fillRect(cx - 5*p, cy - 1*p, 2*p, 5*p);
    ctx.fillRect(cx + 3*p, cy - 1*p, 2*p, 5*p);

    ctx.fillStyle = "#333333";
    ctx.fillRect(cx - 3*p, cy + 4*p, 2*p, 4*p);
    ctx.fillRect(cx + p, cy + 4*p, 2*p, 4*p);

    ctx.fillStyle = "#800080";
    ctx.fillRect(cx - 3*p, cy - 9*p, 6*p, 3*p);

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(cx - 4*p, cy - 6*p, 8*p, p);
    ctx.fillRect(cx + 2*p, cy - 10*p, p, p);
}

// ===== Render Loop =====
function render() {
    ctx.clearRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    const grad = ctx.createLinearGradient(0, 0, 0, GAME_HEIGHT);
    grad.addColorStop(0, "#12002b");
    grad.addColorStop(1, "#300060");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    floatOffset += 0.6 * floatDir;
    if (floatOffset > 20 || floatOffset < -20) {
        floatDir *= -1;
    }

    drawCharacter(GAME_WIDTH / 2, GAME_HEIGHT / 2 + floatOffset);

    requestAnimationFrame(render);
}

render();
