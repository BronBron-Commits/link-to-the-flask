import { drawProjectile } from "./projectile.js";

export const lures = [];

export function castLure(x, y, dx, dy, opts = {}) {
    const speed = opts.speed ?? 16;
    const life = opts.life ?? 2.5;
    lures.push({
        x, y,
        vx: dx * speed,
        vy: dy * speed,
        life,
        maxLife: life,
        inWater: false
    });
}

export function updateLures(dt, waterRect) {
    for (const lure of lures) {
        if (lure.life > 0) {
            lure.x += lure.vx * dt * 0.06;
            lure.y += lure.vy * dt * 0.06;
            lure.life -= dt * 0.001;
            // Check if in water
            if (!lure.inWater && waterRect) {
                if (
                    lure.x > waterRect.x &&
                    lure.x < waterRect.x + waterRect.width &&
                    lure.y > waterRect.y &&
                    lure.y < waterRect.y + waterRect.height
                ) {
                    lure.inWater = true;
                    lure.vx = 0;
                    lure.vy = 0;
                }
            }
        }
    }
}

export function drawLures(ctx) {
    const canvas = window.canvas;
    const camera = window.camera;
    console.log('[drawLures] lures.length:', lures.length);
    for (const lure of lures) {
        if (lure.life > 0) {
            console.log('[drawLures] lure:', lure);
            // Convert world to screen coordinates
            const screenX = lure.x - camera.x + canvas.width/2;
            const screenY = lure.y - camera.y + canvas.height/2;
            // Draw fishing line from player to lure if player exists
            if (window.player && window.player.x !== undefined && window.player.y !== undefined) {
                let rodTipX = window.player.x + 14 + (window.facing?.x || 1) * 24;
                let rodTipY = window.player.y + 18 + (window.facing?.y || 0) * 12;
                const rodScreenX = rodTipX - camera.x + canvas.width/2;
                const rodScreenY = rodTipY - camera.y + canvas.height/2;
                ctx.save();
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(rodScreenX, rodScreenY);
                ctx.lineTo(screenX, screenY);
                ctx.stroke();
                ctx.restore();
            }
            // Draw bobber (no purple blast)
            ctx.save();
            ctx.beginPath();
            ctx.arc(screenX, screenY, 7, 0, Math.PI * 2);
            ctx.fillStyle = lure.inWater ? "#fff" : "#f00";
            ctx.globalAlpha = 0.92;
            ctx.fill();
            ctx.lineWidth = 2;
            ctx.strokeStyle = '#222';
            ctx.stroke();
            ctx.globalAlpha = 1;
            ctx.restore();
            // Draw a large debug marker at lure position
            ctx.save();
            ctx.beginPath();
            ctx.arc(screenX, screenY, 18, 0, Math.PI * 2);
            ctx.strokeStyle = '#0ff';
            ctx.lineWidth = 3;
            ctx.globalAlpha = 0.7;
            ctx.stroke();
            ctx.globalAlpha = 1;
            ctx.restore();
        }
    }
}
