import { drawProjectile } from "./projectile.js";

export const attacks = [];

/* ---------------- SINGLE SHOT ---------------- */
export function castAttack(x,y,dx,dy){
    const speed = 22;

    attacks.push({
        x,y,
        vx:dx*speed,
        vy:dy*speed,
        life:1,
        startX:x,
        startY:y,
        trail:[]
    });
}

/* ---------------- SHOTGUN BLAST ---------------- */
export function castShotgun(x,y,dx,dy){

    const pellets = 13;          // number of particles
    const spread  = 0.9;         // arc width
    const speed   = 20;

    const baseAngle = Math.atan2(dy,dx);

    for(let i=0;i<pellets;i++){
        const t = (i/(pellets-1))-0.5;
        const ang = baseAngle + t*spread;

        attacks.push({
            x,y,
            vx:Math.cos(ang)*speed,
            vy:Math.sin(ang)*speed,
            life:1,
            startX:x,
            startY:y,
            trail:[]
        });
    }
}

/* ---------------- UPDATE ---------------- */
export function updateAttacks(dt){
    for(let i=attacks.length-1;i>=0;i--){
        const a = attacks[i];

        a.x += a.vx;
        a.y += a.vy;

        /* trail */
        a.trail.push({x:a.x,y:a.y,life:1});
        if(a.trail.length>7) a.trail.shift();

        for(const t of a.trail)
            t.life -= dt*0.003;

        a.trail = a.trail.filter(t=>t.life>0);

        /* lifetime */
        a.life -= dt*0.00045;

        if(Math.abs(a.x-a.startX)>6*40 || Math.abs(a.y-a.startY)>6*40)
            a.life=0;

        if(a.life<=0)
            attacks.splice(i,1);
    }
}

/* ---------------- DRAW ---------------- */
export function drawAttacks(ctx){
    for(const a of attacks){
        for(const t of a.trail)
            drawProjectile(ctx,t.x,t.y,1,t.life);

        drawProjectile(ctx,a.x,a.y,4,a.life);
    }
}
