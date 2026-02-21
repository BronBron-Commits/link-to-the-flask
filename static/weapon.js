export function drawScepter(ctx, x, y, scale=4, frame=0, idle=0, attackAnim=0, charging=false){
  // Small pixel-art scepter. Drawn relative to x,y (top-left).

  const pixels = [
    "0000KKK0000",
    "000KGGGK000",
    "00KGPPPGK00",
    "00KGPPPGK00",
    "000KGGGK000",
    "0000KGK0000",
    "0000KGK0000",
    "0000KGK0000",
    "0000KGK0000",
    "0000KGK0000",
    "0000KGK0000",
    "0000KGK0000",
    "0000KGK0000",
    "0000KGK0000",
    "000KGGGK000",
    "000KGGGK000",
    "0000KKK0000"
  ];

  const colors = {
    "0": null,
    "K": "#000000",  // outline
    "G": "#f5c542",  // gold
    "P": "#8d4bff"   // gem
  };

  // match character idle bob (pixel units)
  const bob = Math.round(Math.sin(idle * 0.002) * 2);

  // charging shake (pixel-space jitter)
  const now = performance.now();
  let shakeX = 0;
  let shakeY = 0;

  if(charging){
    // fast little left/right wobble
    shakeX = Math.round(Math.sin(now * 0.06) * 2);
    shakeY = Math.round(Math.sin(now * 0.05) * 1);
  }

  // optional small kick when firing
  if(attackAnim > 0){
    shakeX += Math.round(Math.sin(now * 0.08) * (1 + attackAnim*2));
    shakeY += Math.round(Math.cos(now * 0.08) * (attackAnim*1));
  }

  for(let j=0; j<pixels.length; j++){
    const row = pixels[j];
    for(let i=0; i<row.length; i++){
      const ch = row[i];
      const c = colors[ch];
      if(!c) continue;

      ctx.fillStyle = c;
      ctx.fillRect(
        Math.floor(x + shakeX + i*scale),
        Math.floor(y + shakeY + j*scale + bob),
        scale, scale
      );
    }
  }
}
