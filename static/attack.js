import { drawProjectile } from "./projectile.js";

export const attacks = [];

export function castAttack(x,y,dirX,dirY){
    const speed = 22;

    attacks.push({
        x:x,
        y:y,
        vx:dirX*speed,
        vy:dirY*speed,
        life:1,
        startX:x,
        startY:y,
        trail:[]
    });
}

export function updateAttacks(dt){
    for(let i=attacks.length-1;i>=0;i--){
        const a = attacks[i];

        /* movement */
        a.x += a.vx;
        a.y += a.vy;

        /* add trail point */
        a.trail.push({x:a.x,y:a.y,life:1});
        if(a.trail.length>12) a.trail.shift();

        /* fade trail */
        for(const t of a.trail){
            t.life -= dt*0.002;
        }
        a.trail = a.trail.filter(t=>t.life>0);

        /* projectile life */
        a.life -= dt*0.00025;
        if(Math.abs(a.x-a.startX)>9*40 || Math.abs(a.y-a.startY)>9*40)
            a.life=0;

        if(a.life<=0) attacks.splice(i,1);
    }
}

export function drawAttacks(ctx){
    for(const a of attacks){

        /* draw trail first */
        for(const t of a.trail){
            drawProjectile(ctx,t.x,t.y,1,t.life);
        }

        /* draw main projectile */
        drawProjectile(ctx,a.x,a.y,4,a.life);
    }
}
