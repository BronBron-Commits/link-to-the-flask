import { castAttack, updateAttacks, drawAttacks } from "./attack.js?v=1";
import { drawWizard } from "./character.js?v=2";
import { drawScepter } from "./weapon.js?v=1";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

// Zoom state
let zoom = 1.0;
const maxZoom = 2.0;
function getMinZoom() {
    // Minimum zoom so the entire canvas fits within the window
    const w = canvas.width;
    const h = canvas.height;
    const winW = window.innerWidth;
    const winH = window.innerHeight;
    const scaleW = w / winW;
    const scaleH = h / winH;
    return Math.max(scaleW, scaleH, 0.1); // never allow less than 0.1
}

// Mouse wheel zoom handler
// Zooming removed: no mouse wheel zoom handler

let joy = { x: 0, y: 0 };
const tileSize = 40;

let player = { x: 0, y: 0 };
let facing={x:1,y:0};

let camera = { x:0, y:0, targetX:0, targetY:0 };
const cameraLerp = 0.12;

const moveDelay = 286;
let lastMove = 0;

/* WALK STATE */
let walking=false;
let walkFrame=0;
let walkTimer=0;

/* IDLE TIMER */
let idleTime=0;

function tryMove(){
    const now = Date.now();
    if(now-lastMove < moveDelay) return;

    let dx=0,dy=0;

    if(Math.abs(joy.x)>Math.abs(joy.y)) dx = joy.x>0?1:-1;
    else if(Math.abs(joy.y)>0) dy = joy.y>0?1:-1;
    else return;

    if(dx||dy){facing.x=dx;facing.y=dy;}
    player.x+=dx*tileSize;
    player.y+=dy*tileSize;

    walking=true;
    walkFrame^=1;
    walkTimer=250;
    idleTime=0;

    lastMove=now;
}

function update(){
    tryMove();
    idleTime += 33;
    idleTime += 33;

    camera.targetX=player.x;
    camera.targetY=player.y;

    camera.x+=(camera.targetX-camera.x)*cameraLerp;
    camera.y+=(camera.targetY-camera.y)*cameraLerp;

    if(walking){
        walkTimer-=33;
        if(walkTimer<=0) walking=false;
    }

    if(!walking) idleTime+=33;
}

// Procedural PBR wood plank pattern
let woodPatternCanvas = null;
function createWoodPattern() {
    const plankWidth = 80;
    const plankHeight = 40;
    const patternW = plankWidth * 4;
    const patternH = plankHeight * 4;
    woodPatternCanvas = document.createElement('canvas');
    woodPatternCanvas.width = patternW;
    woodPatternCanvas.height = patternH;
    const wctx = woodPatternCanvas.getContext('2d');
    for (let y = 0; y < patternH; y += plankHeight) {
        for (let x = 0; x < patternW; x += plankWidth) {
            // Deep dark brown, less gray, more warmth
            // Reddish dark brown for warmer wood
            const r = 60 + Math.floor(Math.random()*12); // more red
            const g = 28 + Math.floor(Math.random()*6);  // keep green low
            const b = 18 + Math.floor(Math.random()*4);  // keep blue low
            wctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
            wctx.fillRect(x, y, plankWidth, plankHeight);
            wctx.save();
            wctx.globalAlpha = 0.18;
            wctx.strokeStyle = `rgb(${r+10}, ${g+2}, ${b})`;
            for (let i = 0; i < 8; i++) {
                wctx.beginPath();
                const grainY = y + plankHeight/2 + Math.sin(i + x/50)*plankHeight/3;
                wctx.moveTo(x+6, grainY);
                wctx.bezierCurveTo(x+plankWidth/3, grainY+Math.random()*8, x+plankWidth*2/3, grainY-Math.random()*8, x+plankWidth-6, grainY);
                wctx.stroke();
            }
            wctx.restore();
            wctx.save();
            wctx.globalAlpha = 0.13;
            wctx.fillStyle = 'white';
            wctx.fillRect(x, y, plankWidth, plankHeight/6);
            wctx.fillStyle = 'black';
            wctx.fillRect(x, y+plankHeight*5/6, plankWidth, plankHeight/6);
            wctx.restore();
            wctx.save();
            wctx.globalAlpha = 0.25;
            wctx.strokeStyle = '#8b5a2b';
            wctx.lineWidth = 2;
            wctx.strokeRect(x, y, plankWidth, plankHeight);
            wctx.restore();
        }
    }
}

function drawWoodFloor(ctx, width, height) {
    if (!woodPatternCanvas) createWoodPattern();
    const patternW = woodPatternCanvas.width;
    const patternH = woodPatternCanvas.height;
    for (let y = 0; y < height; y += patternH) {
        for (let x = 0; x < width; x += patternW) {
            ctx.drawImage(woodPatternCanvas, x, y);
        }
    }
}

function draw() {
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.save();
    // Center and scale canvas for zoom
    ctx.translate(canvas.width/2, canvas.height/2);
    ctx.scale(zoom, zoom);
    ctx.translate(-canvas.width/2, -canvas.height/2);
    drawWoodFloor(ctx, canvas.width, canvas.height);
    // Draw improved circular 3D table to the left of character
    const charX = canvas.width/2;
    const charY = canvas.height/2;
    const tableCX = charX - 100;
    const tableCY = charY + 32;
    const tableRX = 44; // horizontal radius
    const tableRY = 28; // vertical radius
    // Draw larger black carpet with frills under table
    const carpetW = tableRX * 4.2;
    const carpetH = tableRY * 3.2;
    const carpetX = tableCX - carpetW/2;
    const carpetY = tableCY + tableRY - carpetH/2;
    ctx.save();
    ctx.fillStyle = '#181018'; // black base
    ctx.fillRect(carpetX, carpetY, carpetW, carpetH);
    // Draw frills on left and right ends
    const frillCount = 18;
    const frillLen = 16;
    const frillSpacing = carpetH / (frillCount+1);
    ctx.strokeStyle = '#bdbdbd';
    ctx.lineWidth = 2;
    for(let i=1;i<=frillCount;i++){
        // Left frills
        ctx.beginPath();
        ctx.moveTo(carpetX, carpetY + i*frillSpacing);
        ctx.lineTo(carpetX - frillLen, carpetY + i*frillSpacing + Math.sin(i)*4);
        ctx.stroke();
        // Right frills
        ctx.beginPath();
        ctx.moveTo(carpetX + carpetW, carpetY + i*frillSpacing);
        ctx.lineTo(carpetX + carpetW + frillLen, carpetY + i*frillSpacing + Math.sin(i)*4);
        ctx.stroke();
    }
    ctx.restore();
    // Table top (ellipse for perspective)
    ctx.beginPath();
    ctx.ellipse(tableCX, tableCY, tableRX, tableRY, 0, 0, Math.PI*2);
    ctx.closePath();
    ctx.fillStyle = '#a0522d';
    ctx.fill();
    // Table rim (darker ellipse)
    ctx.beginPath();
    ctx.ellipse(tableCX, tableCY, tableRX, tableRY, 0, 0, Math.PI*2);
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#8b5a2b';
    ctx.stroke();
    // Table top highlight
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.beginPath();
    ctx.ellipse(tableCX, tableCY-tableRY/2, tableRX-10, tableRY/2.2, 0, 0, Math.PI);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.restore();
    // Table legs (placed for perspective)
    ctx.fillStyle = '#8b5a2b';
    ctx.fillRect(tableCX-tableRX+10, tableCY+tableRY-6, 8, 32);
    ctx.fillRect(tableCX+tableRX-18, tableCY+tableRY-6, 8, 32);
    ctx.fillRect(tableCX-4, tableCY+tableRY, 8, 32);
    // Table shadow
    ctx.save();
    ctx.globalAlpha = 0.15;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(tableCX, tableCY+tableRY+32, tableRX, 14, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();

    // Draw 3 purple dice on the table
    const diceSize = 14;
    const diceY = tableCY - tableRY/2 + 12;
    const dicePositions = [
        {x: tableCX - 10, y: diceY},
        {x: tableCX + 4, y: diceY + 6},
        {x: tableCX + 16, y: diceY - 4}
    ];
    for (let i = 0; i < 3; i++) {
        const pos = dicePositions[i];
        ctx.save();
        // Dice body
        ctx.fillStyle = '#7a3cff';
        ctx.strokeStyle = '#4b1a7a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.rect(pos.x, pos.y, diceSize, diceSize);
        ctx.fill();
        ctx.stroke();
        // Dice highlight
        ctx.globalAlpha = 0.18;
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(pos.x + diceSize*0.7, pos.y + diceSize*0.3, diceSize*0.18, 0, Math.PI*2);
        ctx.fill();
        ctx.globalAlpha = 1.0;
        // Dice pips
        ctx.fillStyle = '#fff';
        if (i === 0) {
            // 1 pip
            ctx.beginPath();
            ctx.arc(pos.x + diceSize/2, pos.y + diceSize/2, 3.5, 0, Math.PI*2);
            ctx.fill();
        } else if (i === 1) {
            // 2 pips
            ctx.beginPath();
            ctx.arc(pos.x + diceSize*0.3, pos.y + diceSize*0.3, 3, 0, Math.PI*2);
            ctx.fill();
            ctx.beginPath();
            ctx.arc(pos.x + diceSize*0.7, pos.y + diceSize*0.7, 3, 0, Math.PI*2);
            ctx.fill();
        } else {
            // 3 pips
            ctx.beginPath();
            ctx.arc(pos.x + diceSize*0.3, pos.y + diceSize*0.3, 3, 0, Math.PI*2);
            ctx.fill();
            ctx.beginPath();
            ctx.arc(pos.x + diceSize*0.7, pos.y + diceSize*0.7, 3, 0, Math.PI*2);
            ctx.fill();
            ctx.beginPath();
            ctx.arc(pos.x + diceSize/2, pos.y + diceSize/2, 3, 0, Math.PI*2);
            ctx.fill();
        }
        ctx.restore();
    }
    ctx.restore();

    // Draw chair to the left of circular table
    const tableR = tableRX; // define tableR for compatibility
    const chairX = tableCX - tableR - 32;
    const chairY = tableCY + tableR - 10;
    ctx.save();
    ctx.fillStyle = '#deb887'; // chair seat
    ctx.fillRect(chairX, chairY, 32, 12);
    ctx.fillStyle = '#8b5a2b'; // chair legs
    ctx.fillRect(chairX+2, chairY+12, 6, 18);
    ctx.fillRect(chairX+24, chairY+12, 6, 18);
    ctx.fillStyle = '#a0522d'; // chair back
    ctx.fillRect(chairX, chairY-16, 32, 14);
    ctx.restore();

    drawWizard(
        ctx,
        charX,
        charY,
        4,
        walkFrame,
        idleTime
    );

    // scepter: position relative to centered player
    // tweak these offsets to move it into the hand
    const sx = charX + 38;
    const sy = charY + 26;
    drawScepter(ctx, sx, sy, 3, walkFrame);
}

let last=performance.now();
setInterval(()=>{
const now=performance.now();
const dt=now-last; last=now;
idleTime+=dt;
update();
    updateAttacks(dt);
draw();
},33);

// Joystick and button code fully removed

/* --- ATTACK BUTTON --- */
// Attack button code fully removed
