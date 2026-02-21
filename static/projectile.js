export function drawProjectile(ctx, x, y, scale=10, life=1){

    // FORCE bigger size (3× whatever game.js sends)
    const s = scale * 3;

    const alpha = Math.max(0.25, life);
    ctx.globalAlpha = alpha;

    // large glow
    const glow = s * 4;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, glow);
    grad.addColorStop(0.0, "#ffffff");
    grad.addColorStop(0.2, "#b4ffff");
    grad.addColorStop(0.45, "#6feaff");
    grad.addColorStop(0.7, "#1fc8ff");
    grad.addColorStop(0.9, "#0a7dff");
    grad.addColorStop(1.0, "rgba(0,0,0,0)");

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, glow, 0, Math.PI*2);
    ctx.fill();

    // bright core
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(x, y, s, 0, Math.PI*2);
    ctx.fill();

    ctx.globalAlpha = 1;
}
