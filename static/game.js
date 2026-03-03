import { castAttack, updateAttacks, drawAttacks } from "./attack.js?v=1";
import { drawWizard } from "./character.js?v=2";
import { drawScepter } from "./weapon.js?v=1";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

// Zoom state
let zoom = 2.0; // doubled zoom
const maxZoom = 4.0; // allow higher zoom
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
const tileSize = 80; // doubled tile size

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
    const plankWidth = 160; // doubled
    const plankHeight = 80; // doubled
    const patternW = plankWidth * 4;
    const patternH = plankHeight * 4;
    woodPatternCanvas = document.createElement('canvas');
    woodPatternCanvas.width = patternW;
    woodPatternCanvas.height = patternH;
    const wctx = woodPatternCanvas.getContext('2d');
    for (let y = 0; y < patternH; y += plankHeight) {
        for (let x = 0; x < patternW; x += plankWidth) {
            // Even darker wood for dim lighting
            const r = 28 + Math.floor(Math.random()*6);
            const g = 14 + Math.floor(Math.random()*4);
            const b = 8 + Math.floor(Math.random()*2);
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
        // ...existing code...
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.save();
    ctx.scale(0.5, 0.5); // 0.5x (zoomed out to 50%)
    // Center camera on player/world
    ctx.translate(-camera.x + canvas.width/2, -camera.y + canvas.height/2);
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
    const tableRX = 88; // horizontal radius doubled
    const tableRY = 56; // vertical radius doubled
    // Draw two bookshelves north of carpet, with fireplace between them
    const carpetW = tableRX * 4.2 * 1.5;
    const carpetH = tableRY * 3.2 * 1.5;
        // Spotlight effect over furniture area (after carpetW/H are defined)
        ctx.save();
        const spotlightCX = canvas.width/2 - 100; // table center x
        const spotlightCY = canvas.height/2 + 32; // table center y
            let spotlightRadius = Math.max(carpetW, carpetH) * 0.92;
        const spotlightGradient = ctx.createRadialGradient(
            spotlightCX, spotlightCY, spotlightRadius * 0.32,
            spotlightCX, spotlightCY, spotlightRadius
        );
        spotlightGradient.addColorStop(0, 'rgba(255,255,220,0.28)');
        spotlightGradient.addColorStop(0.7, 'rgba(255,255,220,0.09)');
        spotlightGradient.addColorStop(1, 'rgba(255,255,220,0)');
        ctx.globalAlpha = 0.65;
        ctx.fillStyle = spotlightGradient;
        ctx.fillRect(spotlightCX - spotlightRadius, spotlightCY - spotlightRadius, spotlightRadius*2, spotlightRadius*2);
        ctx.restore();
    const carpetX = tableCX - carpetW/2;
    const carpetY = tableCY + tableRY - carpetH/2 - 24; // push up a bit more
    // Bookshelf dimensions
    const shelfW = carpetW * 0.28;
    const shelfH = 272; // doubled height
    const shelfY = carpetY - shelfH - 24;
    // Left bookshelf
    const leftShelfX = carpetX + 16;
    // Right bookshelf
    const rightShelfX = carpetX + carpetW - shelfW - 16;
    // Fireplace dimensions and position
    const fireplaceW = carpetW * 0.22;
    const fireplaceH = 108; // doubled height
    const fireplaceX = carpetX + (carpetW - fireplaceW)/2;
    const fireplaceY = shelfY + shelfH - fireplaceH;
    // Draw left bookshelf
    ctx.save();
    ctx.fillStyle = '#2a1a0e';
    ctx.fillRect(leftShelfX, shelfY, shelfW, shelfH);
    ctx.fillStyle = '#3a2320';
    for(let s=0;s<3;s++){
        ctx.fillRect(leftShelfX, shelfY + 8 + s*20, shelfW, 4);
    }
    // Draw cabinets underneath books
    const cabinetH = 64; // doubled height
    ctx.fillStyle = '#1a0e07';
    ctx.fillRect(leftShelfX, shelfY + shelfH - cabinetH, shelfW, cabinetH);
    // Cabinet doors
    ctx.fillStyle = '#a0522d';
    ctx.fillRect(leftShelfX + 6, shelfY + shelfH - cabinetH + 6, shelfW/2 - 12, cabinetH - 12);
    ctx.fillRect(leftShelfX + shelfW/2 + 6, shelfY + shelfH - cabinetH + 6, shelfW/2 - 12, cabinetH - 12);
    // Handles
    ctx.fillStyle = '#3a2320';
    ctx.beginPath();
    ctx.arc(leftShelfX + shelfW/2 - 10, shelfY + shelfH - cabinetH + cabinetH/2, 4, 0, Math.PI*2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(leftShelfX + shelfW/2 + 10, shelfY + shelfH - cabinetH + cabinetH/2, 4, 0, Math.PI*2);
    ctx.fill();
    // Draw books on left bookshelf
    const bookColors = ['#c62828', '#388e3c', '#1565c0'];
    const gold = '#ffd700';
    const booksPerLayer = Math.floor((shelfW - 32) / 24); // doubled spacing
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
            const bookX = leftShelfX + 16 + i*24;
            const bookY = shelfY + 24 + layer*40;
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
            ctx.fillRect(bookX, bookY, 20, 32);
            ctx.fillStyle = gold;
            ctx.fillRect(bookX + 4, bookY + 4, 4, 24);
        }
    }
    ctx.restore();

    // Animated fog overlay effect
    ctx.save();
    // Animate fog center with time for drifting effect
    const fogTime = performance.now() * 0.00018;
    const fogDriftX = Math.sin(fogTime) * canvas.width * 0.13;
    const fogDriftY = Math.cos(fogTime * 0.7) * canvas.height * 0.09;
    const fogCenterX = canvas.width/2 + fogDriftX;
    const fogCenterY = canvas.height/2 + fogDriftY;
    const fogGradient = ctx.createRadialGradient(
        fogCenterX, fogCenterY, Math.min(canvas.width, canvas.height)*0.18,
        fogCenterX, fogCenterY, Math.max(canvas.width, canvas.height)*0.85
    );
    fogGradient.addColorStop(0, 'rgba(255,255,255,0.28)');
    fogGradient.addColorStop(0.5, 'rgba(255,255,255,0.18)');
    fogGradient.addColorStop(1, 'rgba(255,255,255,0.52)');
    ctx.globalAlpha = 0.75;
    ctx.fillStyle = fogGradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();

    // Stronger vignette effect overlay (with more blur and opacity)
    ctx.save();
    ctx.globalAlpha = 0.92;
    // Draw blurred vignette using an offscreen canvas
    const vignetteCanvas = document.createElement('canvas');
    vignetteCanvas.width = canvas.width;
    vignetteCanvas.height = canvas.height;
    const vctx = vignetteCanvas.getContext('2d');
    // Draw radial gradient to offscreen
    const vignetteGradient = vctx.createRadialGradient(
        canvas.width/2, canvas.height/2, Math.min(canvas.width, canvas.height)*0.18,
        canvas.width/2, canvas.height/2, Math.max(canvas.width, canvas.height)*0.68
    );
    vignetteGradient.addColorStop(0, 'rgba(0,0,0,0)');
    vignetteGradient.addColorStop(0.55, 'rgba(0,0,0,0.45)');
    vignetteGradient.addColorStop(0.85, 'rgba(0,0,0,0.85)');
    vignetteGradient.addColorStop(1, 'rgba(0,0,0,1)');
    vctx.fillStyle = vignetteGradient;
    vctx.fillRect(0, 0, canvas.width, canvas.height);
    // Apply stronger blur filter
    vctx.globalAlpha = 1.0;
    vctx.filter = 'blur(38px)';
    vctx.drawImage(vignetteCanvas, 0, 0);
    vctx.filter = 'none';
    // Draw blurred vignette to main canvas
    ctx.drawImage(vignetteCanvas, 0, 0);
    ctx.restore();
    // Draw right bookshelf
    ctx.save();
    ctx.fillStyle = '#8b5a2b';
    ctx.fillRect(rightShelfX, shelfY, shelfW, shelfH);
    ctx.fillStyle = '#2a1a0e';
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
            const bookX = rightShelfX + 16 + i*24;
            const bookY = shelfY + 24 + layer*40;
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
            ctx.fillRect(bookX, bookY, 20, 32);
            ctx.fillStyle = gold;
            ctx.fillRect(bookX + 4, bookY + 4, 4, 24);
        }
    }
    ctx.restore();
    // Draw fireplace between bookshelves
    ctx.save();
    ctx.fillStyle = '#2a2320'; // dim stone
    ctx.fillRect(fireplaceX, fireplaceY, fireplaceW, fireplaceH);
    ctx.fillStyle = '#181018'; // dim inner shadow
    ctx.fillRect(fireplaceX+6, fireplaceY+6, fireplaceW-12, fireplaceH-18);
    // Draw stylized magical fire in fireplace
    const fireX = fireplaceX + fireplaceW/2;
    const fireY = fireplaceY + fireplaceH - 22;
    const t = performance.now() * 0.001;
    const flicker = Math.sin(t*1.7) * 2.2 + Math.sin(t*0.7) * 1.1;
    const flameHeight = 48 + flicker*2; // doubled
    const flameWidth = fireplaceW * 0.36 + flicker; // doubled
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
    ctx.fillStyle = '#2a1a0e';
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
    ctx.fillStyle = '#3a2320';
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
    ctx.fillStyle = '#181018';
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
    ctx.fillStyle = '#0a0608'; // even darker base
    ctx.fillRect(carpetX, carpetY, carpetW, carpetH);
    // Gold symmetrical design
    ctx.save();
    ctx.strokeStyle = '#ffd700';
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.85;
    // Centered pattern: mirrored arcs and lines
    const centerX = carpetX + carpetW/2;
    const centerY = carpetY + carpetH/2;
    const designW = carpetW * 0.41;
    const designH = carpetH * 0.41;
    // Four mirrored arcs
    for(let i=0;i<4;i++){
        ctx.save();
        ctx.translate(centerX, centerY);
        ctx.rotate(i * Math.PI/2);
        ctx.beginPath();
        ctx.arc(0, -designH/2 + 24, designW/3, Math.PI*0.85, Math.PI*2.15);
        ctx.stroke();
        ctx.restore();
    }
    // Four mirrored lines
    for(let i=0;i<4;i++){
        ctx.save();
        ctx.translate(centerX, centerY);
        ctx.rotate(i * Math.PI/2);
        ctx.beginPath();
        ctx.moveTo(0, -designH/2 + 24);
        ctx.lineTo(0, -designH/2 + 24 + designH*0.22);
        ctx.stroke();
        ctx.restore();
    }
    // Center medallion
    ctx.beginPath();
    ctx.arc(centerX, centerY, designW*0.13, 0, Math.PI*2);
    ctx.stroke();
    ctx.restore();
    // Draw frills on left and right ends
    const frillCount = 18;
    const frillLen = 32; // doubled
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
    // Left couch (left of carpet) - enhanced look
    const leftCouchX = carpetX - couchW - 24;
    ctx.save();
    ctx.translate(leftCouchX + couchW/2, couchY + couchH/2);
    ctx.rotate(-Math.PI/2); // rotate 90deg counterclockwise
    // Couch base with rounded corners
    ctx.fillStyle = '#4b2e1a';
    ctx.strokeStyle = '#2a1a0e';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-couchW/2 + 12, -couchH/2);
    ctx.lineTo(couchW/2 - 12, -couchH/2);
    ctx.quadraticCurveTo(couchW/2, -couchH/2, couchW/2, -couchH/2 + 12);
    ctx.lineTo(couchW/2, couchH/2 - 12);
    ctx.quadraticCurveTo(couchW/2, couchH/2, couchW/2 - 12, couchH/2);
    ctx.lineTo(-couchW/2 + 12, couchH/2);
    ctx.quadraticCurveTo(-couchW/2, couchH/2, -couchW/2, couchH/2 - 12);
    ctx.lineTo(-couchW/2, -couchH/2 + 12);
    ctx.quadraticCurveTo(-couchW/2, -couchH/2, -couchW/2 + 12, -couchH/2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Couch seat cushions
    ctx.fillStyle = '#6d4c2b';
    for(let i=0;i<3;i++){
        ctx.beginPath();
        ctx.moveTo(-couchW/2 + 16 + i*(couchW/3), -couchH/2 + 10);
        ctx.lineTo(-couchW/2 + 16 + (i+1)*(couchW/3) - 20, -couchH/2 + 10);
        ctx.quadraticCurveTo(-couchW/2 + 16 + (i+1)*(couchW/3) - 10, -couchH/2 + 18, -couchW/2 + 16 + (i+1)*(couchW/3) - 20, couchH/2 - 18);
        ctx.lineTo(-couchW/2 + 16 + i*(couchW/3), couchH/2 - 18);
        ctx.quadraticCurveTo(-couchW/2 + 16 + i*(couchW/3) + 10, -couchH/2 + 18, -couchW/2 + 16 + i*(couchW/3), -couchH/2 + 10);
        ctx.closePath();
        ctx.fill();
    }
    // Armrests
    ctx.fillStyle = '#3a2320';
    ctx.beginPath();
    ctx.ellipse(-couchW/2 + 18, 0, 14, couchH/2 - 8, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(couchW/2 - 18, 0, 14, couchH/2 - 8, 0, 0, Math.PI*2);
    ctx.fill();
    // Backrest with subtle highlight
    ctx.save();
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = '#5a3a2a';
    ctx.beginPath();
    ctx.moveTo(-couchW/2 + 12, -couchH/2 + 2);
    ctx.lineTo(couchW/2 - 12, -couchH/2 + 2);
    ctx.quadraticCurveTo(couchW/2, -couchH/2 + 2, couchW/2, -couchH/2 + 18);
    ctx.lineTo(-couchW/2, -couchH/2 + 18);
    ctx.quadraticCurveTo(-couchW/2, -couchH/2 + 2, -couchW/2 + 12, -couchH/2 + 2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // Subtle shadow under couch
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(0, couchH/2 - 6, couchW/2.2, 10, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();
    ctx.restore();
    // Right couch (right of carpet) - enhanced look
    const rightCouchX = carpetX + carpetW + 24;
    ctx.save();
    ctx.translate(rightCouchX + couchW/2, couchY + couchH/2);
    ctx.rotate(Math.PI/2); // rotate 90deg clockwise
    // Couch base with rounded corners
    ctx.fillStyle = '#4b2e1a';
    ctx.strokeStyle = '#2a1a0e';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-couchW/2 + 12, -couchH/2);
    ctx.lineTo(couchW/2 - 12, -couchH/2);
    ctx.quadraticCurveTo(couchW/2, -couchH/2, couchW/2, -couchH/2 + 12);
    ctx.lineTo(couchW/2, couchH/2 - 12);
    ctx.quadraticCurveTo(couchW/2, couchH/2, couchW/2 - 12, couchH/2);
    ctx.lineTo(-couchW/2 + 12, couchH/2);
    ctx.quadraticCurveTo(-couchW/2, couchH/2, -couchW/2, couchH/2 - 12);
    ctx.lineTo(-couchW/2, -couchH/2 + 12);
    ctx.quadraticCurveTo(-couchW/2, -couchH/2, -couchW/2 + 12, -couchH/2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Couch seat cushions
    ctx.fillStyle = '#6d4c2b';
    for(let i=0;i<3;i++){
        ctx.beginPath();
        ctx.moveTo(-couchW/2 + 16 + i*(couchW/3), -couchH/2 + 10);
        ctx.lineTo(-couchW/2 + 16 + (i+1)*(couchW/3) - 20, -couchH/2 + 10);
        ctx.quadraticCurveTo(-couchW/2 + 16 + (i+1)*(couchW/3) - 10, -couchH/2 + 18, -couchW/2 + 16 + (i+1)*(couchW/3) - 20, couchH/2 - 18);
        ctx.lineTo(-couchW/2 + 16 + i*(couchW/3), couchH/2 - 18);
        ctx.quadraticCurveTo(-couchW/2 + 16 + i*(couchW/3) + 10, -couchH/2 + 18, -couchW/2 + 16 + i*(couchW/3), -couchH/2 + 10);
        ctx.closePath();
        ctx.fill();
    }
    // Armrests
    ctx.fillStyle = '#3a2320';
    ctx.beginPath();
    ctx.ellipse(-couchW/2 + 18, 0, 14, couchH/2 - 8, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(couchW/2 - 18, 0, 14, couchH/2 - 8, 0, 0, Math.PI*2);
    ctx.fill();
    // Backrest with subtle highlight
    ctx.save();
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = '#5a3a2a';
    ctx.beginPath();
    ctx.moveTo(-couchW/2 + 12, -couchH/2 + 2);
    ctx.lineTo(couchW/2 - 12, -couchH/2 + 2);
    ctx.quadraticCurveTo(couchW/2, -couchH/2 + 2, couchW/2, -couchH/2 + 18);
    ctx.lineTo(-couchW/2, -couchH/2 + 18);
    ctx.quadraticCurveTo(-couchW/2, -couchH/2 + 2, -couchW/2 + 12, -couchH/2 + 2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // Subtle shadow under couch
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(0, couchH/2 - 6, couchW/2.2, 10, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();
    ctx.restore();
    // Table top (ellipse for perspective)
    ctx.beginPath();
    ctx.ellipse(tableCX, tableCY, tableRX, tableRY, 0, 0, Math.PI*2);
    ctx.closePath();
    ctx.fillStyle = '#2a1a0e';
    ctx.fill();
    // Table rim (darker ellipse)
    ctx.beginPath();
    ctx.ellipse(tableCX, tableCY, tableRX, tableRY, 0, 0, Math.PI*2);
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#181018';
    ctx.stroke();
    // Table top highlight
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.beginPath();
    ctx.ellipse(tableCX, tableCY-tableRY/2, tableRX-10, tableRY/2.2, 0, 0, Math.PI);
    ctx.fillStyle = '#181018';
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
    const diceSize = 28; // doubled
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
                // Check if mouse is inside table ellipse
                const dx = mouseX - tableCX;
                const dy = mouseY - tableCY;
                // Ellipse equation: (dx/tableRX)^2 + (dy/tableRY)^2 <= 1
                if ((dx*dx)/(tableRX*tableRX) + (dy*dy)/(tableRY*tableRY) <= 1) {
                    // Only trigger for first dice (purple dice with candle)
                    // Dynamically load map3d.js as a module
                    canvas.style.display = 'none';
                    const script = document.createElement('script');
                    script.type = 'module';
                    script.src = '/static/map3d.js';
                    document.body.appendChild(script);
                }
            });
        }

    // Draw chair to the left of circular table
    const tableR = tableRX; // define tableR for compatibility
    const chairX = tableCX - tableR - 64; // doubled offset
    const chairY = tableCY + tableR - 20; // doubled offset
    ctx.save();
    ctx.fillStyle = '#deb887'; // chair seat
    ctx.fillRect(chairX, chairY, 64, 24);
    ctx.fillStyle = '#181018'; // chair legs
    ctx.fillRect(chairX+4, chairY+24, 12, 36);
    ctx.fillRect(chairX+48, chairY+24, 12, 36);
    ctx.fillStyle = '#2a1a0e'; // chair back
    ctx.fillRect(chairX, chairY-32, 64, 28);
    ctx.restore();

    drawWizard(
        ctx,
        charX,
        charY,
        8, // double the scale for player
        walkFrame,
        idleTime
    );

    // scepter: position relative to centered player
    // tweak these offsets to move it into the hand
    const sx = charX + 80; // moved a little more to the right
    const sy = charY + 36; // moved a little further down
    drawScepter(ctx, sx, sy, 6, walkFrame); // double the scale for scepter
    ctx.restore(); // Restore after scaling
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
