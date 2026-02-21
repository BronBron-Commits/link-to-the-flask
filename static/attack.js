import { drawProjectile } from "./projectile.js";

export const attacks = [];

export function castAttack(x,y,dirX,dirY){

    const speed = 900; // pixels per second (VERY fast)

    attacks.push({
        x:x,
        y:y,
        vx:dirX*speed,
        vy:dirY*speed,
        life:1,
        startX:x,
        startY:y,
        age:0
    });
}

export function updateAttacks(dt){
    const sec = dt/1000;

    for(let i=attacks.length-1;i>=0;i--){
        const a = attacks[i];

        a.age += dt;

        // actual movement uses time
        a.x += a.vx * sec;
        a.y += a.vy * sec;

        // lifetime fade
        a.life -= dt*0.0006;

        // range limit
        if(Math.hypot(a.x-a.startX,a.y-a.startY) > 9*40)
            a.life=0;

        if(a.life<=0) attacks.splice(i,1);
    }
}

export function drawAttacks(ctx){
    for(const a of attacks){
        drawProjectile(ctx,a.x,a.y,3,a.life,a.age);
    }
}
