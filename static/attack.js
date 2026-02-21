import { drawProjectile } from "./projectile.js";

export const attacks = [];

export function castAttack(x,y,dirX,dirY){
    const speed = 6;

    attacks.push({
        x:x,
        y:y,
        vx:dirX*speed,
        vy:dirY*speed,
        life:1,startX:x,startY:y
    });
}

export function updateAttacks(dt){
    for(let i=attacks.length-1;i>=0;i--){
        const a = attacks[i];

        a.x += a.vx;
        a.y += a.vy;

        a.life -= dt*0.0003;
        if(Math.abs(a.x-a.startX) > 9*40 || Math.abs(a.y-a.startY) > 9*40) a.life=0;

        if(a.life<=0) attacks.splice(i,1);
    }
}

export function drawAttacks(ctx){
    for(const a of attacks){
        drawProjectile(ctx,a.x,a.y,3,a.life);
    }
}
