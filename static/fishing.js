// fishing.js
// Robust, deterministic, state-driven fishing system

// fishing.js
// Robust, deterministic, state-driven fishing system

export const FishingState = {
    IDLE: 'IDLE',
    CASTING: 'CASTING',
    WAITING_FOR_BITE: 'WAITING_FOR_BITE',
    HOOK_WINDOW: 'HOOK_WINDOW',
    REELING: 'REELING',
    FAIL: 'FAIL',
    SUCCESS: 'SUCCESS'
};

export function createFishingComponent() {
    return {
        state: FishingState.IDLE,
        bobber: null,
        castStartTime: 0,
        biteTime: 0,
        hookWindowEnd: 0,
        targetPosition: null,
        randomSeed: Math.random(),
    };
}

export function startCast(player, fishingComp, castDistance = 80) {
    // Calculate direction
    const dx = player.facing.x;
    const dy = player.facing.y;
    // Rod tip offset
    const rodTipX = player.x + 14 + dx * 24;
    const rodTipY = player.y + 18 + dy * 12;
    const targetX = rodTipX + dx * castDistance;
    const targetY = rodTipY + dy * castDistance;
    fishingComp.targetPosition = { x: targetX, y: targetY };
    fishingComp.castStartTime = performance.now();
    fishingComp.state = FishingState.CASTING;
    fishingComp.bobber = {
        x: rodTipX,
        y: rodTipY,
        startX: rodTipX,
        startY: rodTipY,
        targetX,
        targetY,
        travelTime: 600,
        elapsed: 0,
        landed: false,
        splashPlayed: false,
        scale: 1,
        ripple: 0,
        bite: false,
        hookAnim: 0,
    };
    // Multiplayer: send CAST event with randomSeed
}

export function updateFishing(dt, fishingComp) {
    const now = performance.now();
    if (fishingComp.state === FishingState.CASTING) {
        const bobber = fishingComp.bobber;
        bobber.elapsed += dt;
        const t = Math.min(1, bobber.elapsed / bobber.travelTime);
        // Parabolic arc
        const arcHeight = 60;
        bobber.x = lerp(bobber.startX, bobber.targetX, t);
        bobber.y = lerp(bobber.startY, bobber.targetY, t) - arcHeight * Math.sin(t * Math.PI);
        bobber.scale = 0.9 + 0.2 * (1 - t);
        if (t >= 1 && !bobber.landed) {
            bobber.x = bobber.targetX;
            bobber.y = bobber.targetY;
            bobber.landed = true;
            bobber.ripple = 1;
            fishingComp.state = FishingState.WAITING_FOR_BITE;
            // Play splash effect
            // Multiplayer: send BOBBER_LANDED event
            // Bite time: deterministic
            fishingComp.biteTime = now + seededRandom(fishingComp.randomSeed) * 3500 + 1500;
        }
    } else if (fishingComp.state === FishingState.WAITING_FOR_BITE) {
        const bobber = fishingComp.bobber;
        // Bobber floats
        bobber.y += Math.sin(now * 0.003) * 0.5;
        if (now >= fishingComp.biteTime) {
            fishingComp.state = FishingState.HOOK_WINDOW;
            fishingComp.hookWindowEnd = now + 1000;
            bobber.bite = true;
            bobber.hookAnim = 1;
            // Play bite splash, sound, shake
            // Multiplayer: send BITE_TRIGGERED event
        }
    } else if (fishingComp.state === FishingState.HOOK_WINDOW) {
        const bobber = fishingComp.bobber;
        if (bobber.hookAnim > 0) bobber.hookAnim -= dt * 0.002;
        // Wait for input
        if (now > fishingComp.hookWindowEnd) {
            fishingComp.state = FishingState.FAIL;
            // Multiplayer: send FAIL event
        }
    } else if (fishingComp.state === FishingState.SUCCESS || fishingComp.state === FishingState.FAIL) {
        // Cleanup
        fishingComp.bobber = null;
        fishingComp.state = FishingState.IDLE;
        // Multiplayer: send SUCCESS event
    }
}

export function drawFishing(ctx, fishingComp, camera) {
    const bobber = fishingComp.bobber;
    if (!bobber) return;
    // Draw ripple
    if (bobber.ripple > 0) {
        ctx.save();
        ctx.globalAlpha = 0.3 * bobber.ripple;
        ctx.beginPath();
        ctx.arc(bobber.x - camera.x + ctx.canvas.width/2, bobber.y - camera.y + ctx.canvas.height/2, 18 * bobber.ripple, 0, Math.PI*2);
        ctx.strokeStyle = '#0ff';
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.restore();
        bobber.ripple *= 0.96;
    }
    // Draw bobber
    ctx.save();
    ctx.beginPath();
    ctx.arc(bobber.x - camera.x + ctx.canvas.width/2, bobber.y - camera.y + ctx.canvas.height/2, 7 * bobber.scale, 0, Math.PI*2);
    ctx.fillStyle = bobber.bite ? '#ff0' : '#fff';
    ctx.globalAlpha = 0.92;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#222';
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.restore();
    // Hook animation
    if (bobber.hookAnim > 0) {
        ctx.save();
        ctx.translate(bobber.x - camera.x + ctx.canvas.width/2, bobber.y - camera.y + ctx.canvas.height/2);
        ctx.rotate(Math.sin(performance.now()*0.02)*0.2);
        ctx.beginPath();
        ctx.arc(0, 0, 12, 0, Math.PI*2);
        ctx.strokeStyle = '#ff0';
        ctx.lineWidth = 4 * bobber.hookAnim;
        ctx.globalAlpha = 0.5 * bobber.hookAnim;
        ctx.stroke();
        ctx.restore();
    }
}

export function handleFishingInput(key, fishingComp) {
    const now = performance.now();
    if (fishingComp.state === FishingState.HOOK_WINDOW && key === 'q') {
        fishingComp.state = FishingState.SUCCESS;
        // Multiplayer: send SUCCESS event
    }
}

function lerp(a, b, t) {
    return a + (b - a) * t;
}

function seededRandom(seed) {
    // Simple deterministic random for bite timing
    let x = Math.sin(seed * 10000) * 10000;
    return x - Math.floor(x);
}
