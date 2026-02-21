import { drawProjectile } from "./projectile.js";

export const attacks = [];

/* castAttack supports options:
   { speed, life, rangeTiles, scaleBoost, trailCount, trailFade }
*/
export function castAttack(x,y,dx,dy,opts={}){
    const speed = (opts.speed ?? 22);
    const life  = (opts.life  ?? 1.0);

    attacks.push({
        x,y,
        vx:dx*speed,
        vy:dy*speed,
        life,
        startX:x,
        startY:y,
        trail:[],
        rangeTiles: (opts.rangeTiles ?? 6),
        scaleBoost: (opts.scaleBoost ?? 1),
        trailCount: (opts.trailCount ?? 5),
        trailFade:  (opts.trailFade  ?? 0.003)
    });
}

export function updateAttacks(dt){
    for(let i=attacks.length-1;i>=0;i--){
        const a=attacks[i];

        a.x += a.vx;
        a.y += a.vy;

        a.trail.push({x:a.x,y:a.y,life:1});
        if(a.trail.length > a.trailCount) a.trail.shift();

        for(const t of a.trail) t.life -= dt * a.trailFade;
        a.trail = a.trail.filter(t=>t.life>0);

        a.life -= dt * 0.00045;

        const maxDist = a.rangeTiles * 40;
        if(Math.abs(a.x-a.startX) > maxDist || Math.abs(a.y-a.startY) > maxDist) a.life = 0;

        if(a.life<=0) attacks.splice(i,1);
    }
}

export function drawAttacks(ctx){
    for(const a of attacks){
        for(const t of a.trail){
            drawProjectile(ctx,t.x,t.y,0.8,t.life);
        }
        drawProjectile(ctx,a.x,a.y,4*(a.scaleBoost||1),a.life);
    }
}
