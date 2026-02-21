import { drawProjectile } from "./projectile.js";

export const attacks = [];

/* normal shot */
export function castAttack(x,y,dx,dy){
    const speed = 22;
    attacks.push({x,y,vx:dx*speed,vy:dy*speed,life:1,startX:x,startY:y,trail:[],small:false});
}

/* shotgun blast */
export function castShotgun(x,y,dx,dy){

    const pellets = 6;        // reduced count
    const spread = 0.65;      // slightly tighter cone
    const speed = 18;

    const base = Math.atan2(dy,dx);

    for(let i=0;i<pellets;i++){
        const t=(i/(pellets-1))-0.5;
        const a=base+t*spread;

        attacks.push({
            x,y,
            vx:Math.cos(a)*speed,
            vy:Math.sin(a)*speed,
            life:1,
            startX:x,startY:y,
            trail:[],
            small:true
        });
    }
}

export function updateAttacks(dt){
    for(let i=attacks.length-1;i>=0;i--){
        const a=attacks[i];

        a.x+=a.vx;
        a.y+=a.vy;

        a.trail.push({x:a.x,y:a.y,life:1});
        if(a.trail.length>5)a.trail.shift();

        for(const t of a.trail)t.life-=dt*0.003;
        a.trail=a.trail.filter(t=>t.life>0);

        a.life-=dt*0.00045;
        if(Math.abs(a.x-a.startX)>6*40||Math.abs(a.y-a.startY)>6*40)a.life=0;

        if(a.life<=0)attacks.splice(i,1);
    }
}

export function drawAttacks(ctx){
    for(const a of attacks){

        const trailSize = a.small ? 0.25 : 1;
        const mainSize  = a.small ? 1.2  : 4;

        for(const t of a.trail)
            drawProjectile(ctx,t.x,t.y,trailSize,t.life);

        drawProjectile(ctx,a.x,a.y,mainSize,a.life);
    }
}
