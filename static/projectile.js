export function drawProjectile(ctx, x, y, scale=10, life=1, age=0){

    const s = scale * 3;
    const alpha = Math.max(0.25, life);
    ctx.globalAlpha = alpha;

    /* purple magic glow */
    const glow = s * 4;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, glow);
    grad.addColorStop(0.0, "#ffffff");
    grad.addColorStop(0.15, "#f2d9ff");
    grad.addColorStop(0.35, "#c77dff");
    grad.addColorStop(0.6, "#9d4edd");
    grad.addColorStop(0.85, "#5a189a");
    grad.addColorStop(1.0, "rgba(0,0,0,0)");

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, glow, 0, Math.PI*2);
    ctx.fill();

    /* bright arcane core */
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(x, y, s, 0, Math.PI*2);
    ctx.fill();

    ctx.globalAlpha = 1;
}
