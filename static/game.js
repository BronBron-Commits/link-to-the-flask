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
    // Draw two bookshelves north of carpet, with fireplace between them
    const carpetW = tableRX * 4.2 * 1.5;
    const carpetH = tableRY * 3.2 * 1.5;
    const carpetX = tableCX - carpetW/2;
    const carpetY = tableCY + tableRY - carpetH/2 - 24; // push up a bit more
    // Bookshelf dimensions
    const shelfW = carpetW * 0.28;
    const shelfH = 136; // doubled height
    const shelfY = carpetY - shelfH - 24;
    // Left bookshelf
    const leftShelfX = carpetX + 16;
    // Right bookshelf
    const rightShelfX = carpetX + carpetW - shelfW - 16;
    // Fireplace dimensions and position
    const fireplaceW = carpetW * 0.22;
    const fireplaceH = 54;
    const fireplaceX = carpetX + (carpetW - fireplaceW)/2;
    const fireplaceY = shelfY + shelfH - fireplaceH;
    // Draw left bookshelf
    ctx.save();
    ctx.fillStyle = '#8b5a2b';
    ctx.fillRect(leftShelfX, shelfY, shelfW, shelfH);
    ctx.fillStyle = '#a0522d';
    for(let s=0;s<3;s++){
        ctx.fillRect(leftShelfX, shelfY + 8 + s*20, shelfW, 4);
    }
    // Draw cabinets underneath books
    const cabinetH = 32;
    ctx.fillStyle = '#6d4c2b';
    ctx.fillRect(leftShelfX, shelfY + shelfH - cabinetH, shelfW, cabinetH);
    // Cabinet doors
    ctx.fillStyle = '#a0522d';
    ctx.fillRect(leftShelfX + 6, shelfY + shelfH - cabinetH + 6, shelfW/2 - 12, cabinetH - 12);
    ctx.fillRect(leftShelfX + shelfW/2 + 6, shelfY + shelfH - cabinetH + 6, shelfW/2 - 12, cabinetH - 12);
    // Handles
    ctx.fillStyle = '#ffd700';
    ctx.beginPath();
    ctx.arc(leftShelfX + shelfW/2 - 10, shelfY + shelfH - cabinetH + cabinetH/2, 4, 0, Math.PI*2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(leftShelfX + shelfW/2 + 10, shelfY + shelfH - cabinetH + cabinetH/2, 4, 0, Math.PI*2);
    ctx.fill();
    // Draw books on left bookshelf
    const bookColors = ['#c62828', '#388e3c', '#1565c0'];
    const gold = '#ffd700';
    const booksPerLayer = Math.floor((shelfW - 16) / 12);
    if (!window.bookshelfColorOrderLeft) {
        window.bookshelfColorOrderLeft = [];
        for(let layer=0;layer<3;layer++){
            let colorOrder = [];
            for(let i=0;i<booksPerLayer;i++){
                colorOrder.push(bookColors[Math.floor(Math.random()*bookColors.length)]);
            }
            window.bookshelfColorOrderLeft.push(colorOrder);
        }
    }
    for(let layer=0;layer<3;layer++){
        let colorOrder = window.bookshelfColorOrderLeft[layer];
        for(let i=0;i<booksPerLayer;i++){
            const bookX = leftShelfX + 8 + i*12;
            const bookY = shelfY + 12 + layer*20;
            let baseColor = colorOrder[i];
            let h,s,l;
            if (!window.bookshelfHSL) window.bookshelfHSL = {};
            if (!window.bookshelfHSL[baseColor]) {
                let r = parseInt(baseColor.slice(1,3),16)/255;
                let g = parseInt(baseColor.slice(3,5),16)/255;
                let b = parseInt(baseColor.slice(5,7),16)/255;
                let max = Math.max(r,g,b), min = Math.min(r,g,b);
                l = (max+min)/2;
                if(max==min){h=s=0;}else{
                    let d = max-min;
                    s = l>0.5 ? d/(2-max-min) : d/(max+min);
                    switch(max){
                        case r: h=(g-b)/d+(g<b?6:0);break;
                        case g: h=(b-r)/d+2;break;
                        case b: h=(r-g)/d+4;break;
                    }
                    h/=6;
                }
                window.bookshelfHSL[baseColor] = {h,s,l};
            }
            let hsl = window.bookshelfHSL[baseColor];
            let offset = ((layer+1)*17 + i*31) % 100 / 500;
            let l2 = Math.min(1, Math.max(0, hsl.l + offset - 0.05));
            let s2 = Math.min(1, Math.max(0, hsl.s + offset/2 - 0.02));
            ctx.fillStyle = `hsl(${Math.round(hsl.h*360)},${Math.round(s2*100)}%,${Math.round(l2*100)}%)`;
            ctx.fillRect(bookX, bookY, 10, 16);
            ctx.fillStyle = gold;
            ctx.fillRect(bookX + 2, bookY + 2, 2, 12);
        }
    }
    ctx.restore();
    // Draw right bookshelf
    ctx.save();
    ctx.fillStyle = '#8b5a2b';
    ctx.fillRect(rightShelfX, shelfY, shelfW, shelfH);
    ctx.fillStyle = '#a0522d';
    for(let s=0;s<3;s++){
        ctx.fillRect(rightShelfX, shelfY + 8 + s*20, shelfW, 4);
    }
    // Draw cabinets underneath books
    ctx.fillStyle = '#6d4c2b';
    ctx.fillRect(rightShelfX, shelfY + shelfH - cabinetH, shelfW, cabinetH);
    // Cabinet doors
    ctx.fillStyle = '#a0522d';
    ctx.fillRect(rightShelfX + 6, shelfY + shelfH - cabinetH + 6, shelfW/2 - 12, cabinetH - 12);
    ctx.fillRect(rightShelfX + shelfW/2 + 6, shelfY + shelfH - cabinetH + 6, shelfW/2 - 12, cabinetH - 12);
    // Handles
    ctx.fillStyle = '#ffd700';
    ctx.beginPath();
    ctx.arc(rightShelfX + shelfW/2 - 10, shelfY + shelfH - cabinetH + cabinetH/2, 4, 0, Math.PI*2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(rightShelfX + shelfW/2 + 10, shelfY + shelfH - cabinetH + cabinetH/2, 4, 0, Math.PI*2);
    ctx.fill();
    // Draw books on right bookshelf
    if (!window.bookshelfColorOrderRight) {
        window.bookshelfColorOrderRight = [];
        for(let layer=0;layer<3;layer++){
            let colorOrder = [];
            for(let i=0;i<booksPerLayer;i++){
                colorOrder.push(bookColors[Math.floor(Math.random()*bookColors.length)]);
            }
            window.bookshelfColorOrderRight.push(colorOrder);
        }
    }
    for(let layer=0;layer<3;layer++){
        let colorOrder = window.bookshelfColorOrderRight[layer];
        for(let i=0;i<booksPerLayer;i++){
            const bookX = rightShelfX + 8 + i*12;
            const bookY = shelfY + 12 + layer*20;
            let baseColor = colorOrder[i];
            let h,s,l;
            if (!window.bookshelfHSL) window.bookshelfHSL = {};
            if (!window.bookshelfHSL[baseColor]) {
                let r = parseInt(baseColor.slice(1,3),16)/255;
                let g = parseInt(baseColor.slice(3,5),16)/255;
                let b = parseInt(baseColor.slice(5,7),16)/255;
                let max = Math.max(r,g,b), min = Math.min(r,g,b);
                l = (max+min)/2;
                if(max==min){h=s=0;}else{
                    let d = max-min;
                    s = l>0.5 ? d/(2-max-min) : d/(max+min);
                    switch(max){
                        case r: h=(g-b)/d+(g<b?6:0);break;
                        case g: h=(b-r)/d+2;break;
                        case b: h=(r-g)/d+4;break;
                    }
                    h/=6;
                }
                window.bookshelfHSL[baseColor] = {h,s,l};
            }
            let hsl = window.bookshelfHSL[baseColor];
            let offset = ((layer+1)*17 + i*31) % 100 / 500;
            let l2 = Math.min(1, Math.max(0, hsl.l + offset - 0.05));
            let s2 = Math.min(1, Math.max(0, hsl.s + offset/2 - 0.02));
            ctx.fillStyle = `hsl(${Math.round(hsl.h*360)},${Math.round(s2*100)}%,${Math.round(l2*100)}%)`;
            ctx.fillRect(bookX, bookY, 10, 16);
            ctx.fillStyle = gold;
            ctx.fillRect(bookX + 2, bookY + 2, 2, 12);
        }
    }
    ctx.restore();
    // Draw fireplace between bookshelves
    ctx.save();
    ctx.fillStyle = '#bdbdbd'; // stone
    ctx.fillRect(fireplaceX, fireplaceY, fireplaceW, fireplaceH);
    ctx.fillStyle = '#888'; // inner shadow
    ctx.fillRect(fireplaceX+6, fireplaceY+6, fireplaceW-12, fireplaceH-18);
    // Draw stylized magical fire in fireplace
    const fireX = fireplaceX + fireplaceW/2;
    const fireY = fireplaceY + fireplaceH - 22;
    const t = performance.now() * 0.001;
    const flicker = Math.sin(t*1.7) * 2.2 + Math.sin(t*0.7) * 1.1;
    const flameHeight = 24 + flicker;
    const flameWidth = fireplaceW * 0.18 + flicker*0.5;
    ctx.save();
    // Outer glow
    ctx.beginPath();
    ctx.moveTo(fireX, fireY + flameHeight*0.2);
    ctx.bezierCurveTo(
        fireX - flameWidth*0.7, fireY + flameHeight*0.5,
        fireX - flameWidth*0.4, fireY - flameHeight*0.2,
        fireX, fireY - flameHeight
    );
    ctx.bezierCurveTo(
        fireX + flameWidth*0.4, fireY - flameHeight*0.2,
        fireX + flameWidth*0.7, fireY + flameHeight*0.5,
        fireX, fireY + flameHeight*0.2
    );
    ctx.closePath();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#ffd700';
    ctx.shadowColor = '#ffd700';
    ctx.shadowBlur = 18;
    ctx.fill();
    ctx.shadowBlur = 0;
    // Middle flame
    ctx.beginPath();
    ctx.moveTo(fireX, fireY + flameHeight*0.1);
    ctx.bezierCurveTo(
        fireX - flameWidth*0.4, fireY + flameHeight*0.3,
        fireX - flameWidth*0.2, fireY - flameHeight*0.3,
        fireX, fireY - flameHeight*0.7
    );
    ctx.bezierCurveTo(
        fireX + flameWidth*0.2, fireY - flameHeight*0.3,
        fireX + flameWidth*0.4, fireY + flameHeight*0.3,
        fireX, fireY + flameHeight*0.1
    );
    ctx.closePath();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = '#ff9800';
    ctx.fill();
    // Inner core
    ctx.beginPath();
    ctx.moveTo(fireX, fireY);
    ctx.bezierCurveTo(
        fireX - flameWidth*0.12, fireY - flameHeight*0.1,
        fireX, fireY - flameHeight*0.25,
        fireX, fireY - flameHeight*0.45
    );
    ctx.bezierCurveTo(
        fireX, fireY - flameHeight*0.25,
        fireX + flameWidth*0.12, fireY - flameHeight*0.1,
        fireX, fireY
    );
    ctx.closePath();
    ctx.globalAlpha = 1.0;
    ctx.fillStyle = '#fffbe6';
    ctx.fill();
    // Sparkles
    for(let s=0;s<6;s++){
        ctx.save();
        ctx.globalAlpha = 0.7;
        ctx.fillStyle = '#ffd700';
        ctx.beginPath();
        ctx.arc(
            fireX + Math.sin(t*2+s)*flameWidth*0.6,
            fireY - flameHeight*0.7 + Math.cos(t*3+s)*6,
            2 + Math.sin(t*4+s)*1.2,
            0, Math.PI*2
        );
        ctx.fill();
        ctx.restore();
    }
    ctx.restore();
    // Draw larger black carpet with frills under table
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

    // Draw two couches, one on each side of the rug
    // Draw couches rotated in place, facing inward toward the table
    const couchW = carpetW * 0.38;
    const couchH = carpetH * 0.32;
    const couchY = carpetY + carpetH/2 - couchH/2;
    // Left couch (left of carpet)
    const leftCouchX = carpetX - couchW - 24;
    ctx.save();
    ctx.translate(leftCouchX + couchW/2, couchY + couchH/2);
    ctx.rotate(-Math.PI/2); // rotate 90deg counterclockwise
    ctx.fillStyle = '#3a2320';
    ctx.fillRect(-couchW/2, -couchH/2, couchW, couchH);
    ctx.fillStyle = '#5a3a2a';
    for(let i=0;i<3;i++){
        ctx.fillRect(-couchW/2 + 12 + i*(couchW/3), -couchH/2 + 8, couchW/3 - 24, couchH - 24);
    }
    ctx.fillStyle = '#181018';
    ctx.fillRect(-couchW/2 + 8, couchH/2 - 16, 12, 8);
    ctx.fillRect(couchW/2 - 20, couchH/2 - 16, 12, 8);
    ctx.fillRect(-couchW/2 + 8, -couchH/2 + 8, 12, 8);
    ctx.fillRect(couchW/2 - 20, -couchH/2 + 8, 12, 8);
    ctx.restore();
    // Right couch (right of carpet)
    const rightCouchX = carpetX + carpetW + 24;
    ctx.save();
    ctx.translate(rightCouchX + couchW/2, couchY + couchH/2);
    ctx.rotate(Math.PI/2); // rotate 90deg clockwise
    ctx.fillStyle = '#3a2320';
    ctx.fillRect(-couchW/2, -couchH/2, couchW, couchH);
    ctx.fillStyle = '#5a3a2a';
    for(let i=0;i<3;i++){
        ctx.fillRect(-couchW/2 + 12 + i*(couchW/3), -couchH/2 + 8, couchW/3 - 24, couchH - 24);
    }
    ctx.fillStyle = '#181018';
    ctx.fillRect(-couchW/2 + 8, couchH/2 - 16, 12, 8);
    ctx.fillRect(couchW/2 - 20, couchH/2 - 16, 12, 8);
    ctx.fillRect(-couchW/2 + 8, -couchH/2 + 8, 12, 8);
    ctx.fillRect(couchW/2 - 20, -couchH/2 + 8, 12, 8);
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
            // Draw larger candle farther north on top left of this dice
            ctx.save();
            const candleX = pos.x + 2;
            const candleY = pos.y - 24; // push farther north
            ctx.fillStyle = '#fffbe6'; // candle body
            ctx.fillRect(candleX, candleY, 8, 16); // double size
            // Animate more stylized magical flame
            const flameY = candleY - 8;
            const flameX = candleX + 4;
            const t = performance.now() * 0.001;
            const flicker = Math.sin(t*1.2) * 0.7 + Math.sin(t*0.5) * 0.3;
            const flameHeight = 16 + flicker*2;
            const flameWidth = 8 + flicker;
            ctx.save();
            // Outer glow
            ctx.beginPath();
            ctx.moveTo(flameX, flameY + flameHeight*0.2);
            ctx.bezierCurveTo(
                flameX - flameWidth*0.5, flameY + flameHeight*0.5,
                flameX - flameWidth*0.3, flameY - flameHeight*0.2,
                flameX, flameY - flameHeight
            );
            ctx.bezierCurveTo(
                flameX + flameWidth*0.3, flameY - flameHeight*0.2,
                flameX + flameWidth*0.5, flameY + flameHeight*0.5,
                flameX, flameY + flameHeight*0.2
            );
            ctx.closePath();
            ctx.globalAlpha = 0.45;
            ctx.fillStyle = '#ffd700';
            ctx.shadowColor = '#ffd700';
            ctx.shadowBlur = 12;
            ctx.fill();
            ctx.shadowBlur = 0;
            // Middle flame
            ctx.beginPath();
            ctx.moveTo(flameX, flameY + flameHeight*0.1);
            ctx.bezierCurveTo(
                flameX - flameWidth*0.3, flameY + flameHeight*0.3,
                flameX - flameWidth*0.15, flameY - flameHeight*0.3,
                flameX, flameY - flameHeight*0.7
            );
            ctx.bezierCurveTo(
                flameX + flameWidth*0.15, flameY - flameHeight*0.3,
                flameX + flameWidth*0.3, flameY + flameHeight*0.3,
                flameX, flameY + flameHeight*0.1
            );
            ctx.closePath();
            ctx.globalAlpha = 0.85;
            ctx.fillStyle = '#ff9800';
            ctx.fill();
            // Inner core
            ctx.beginPath();
            ctx.moveTo(flameX, flameY);
            ctx.bezierCurveTo(
                flameX - flameWidth*0.08, flameY - flameHeight*0.1,
                flameX, flameY - flameHeight*0.25,
                flameX, flameY - flameHeight*0.45
            );
            ctx.bezierCurveTo(
                flameX, flameY - flameHeight*0.25,
                flameX + flameWidth*0.08, flameY - flameHeight*0.1,
                flameX, flameY
            );
            ctx.closePath();
            ctx.globalAlpha = 1.0;
            ctx.fillStyle = '#fffbe6';
            ctx.fill();
            // Sparkles
            for(let s=0;s<3;s++){
                ctx.save();
                ctx.globalAlpha = 0.7;
                ctx.fillStyle = '#ffd700';
                ctx.beginPath();
                ctx.arc(
                    flameX + Math.sin(t*2+s)*flameWidth*0.4,
                    flameY - flameHeight*0.7 + Math.cos(t*3+s)*3,
                    1.2 + Math.sin(t*4+s)*0.7,
                    0, Math.PI*2
                );
                ctx.fill();
                ctx.restore();
            }
            ctx.restore();
            ctx.restore();
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
        // Add click handler for purple dice
        if (!window.diceClickHandlerAdded) {
            window.diceClickHandlerAdded = true;
            canvas.addEventListener('click', function(e) {
                const rect = canvas.getBoundingClientRect();
                const mouseX = (e.clientX - rect.left - canvas.width/2) / zoom + canvas.width/2;
                const mouseY = (e.clientY - rect.top - canvas.height/2) / zoom + canvas.height/2;
                for (let i = 0; i < dicePositions.length; i++) {
                    const pos = dicePositions[i];
                    if (
                        mouseX >= pos.x && mouseX <= pos.x + diceSize &&
                        mouseY >= pos.y && mouseY <= pos.y + diceSize
                    ) {
                        // Only trigger for first dice (purple dice with candle)
                        if (i === 0) {
                            // Hide canvas and load 3D scene
                            canvas.style.display = 'none';
                            // Dynamically load dice3d.js
                            // Dynamically load dice3d.js
                            const script = document.createElement('script');
                            script.type = 'module';
                            script.src = '/static/dice3d.js';
                            document.body.appendChild(script);
                        }
                        break;
                    }
                }
            });
        }

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
