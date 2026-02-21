export function drawScepter(ctx, x, y, scale=4, frame=0, idle=0, attackAnim=0){

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
    "K": "#000000",
    "G": "#f5c542",
    "P": "#8d4bff"
  };

  /* idle bob */
  const bob = Math.round(Math.sin(idle * 0.002) * 2);

  /* attack recoil curve (fast snap forward then settle) */
  const kick = Math.sin(attackAnim * Math.PI) * 6;
  const recoilX = kick;
  const recoilY = -kick * 0.35;

  /* glow intensity */
  const glow = attackAnim;

  for(let j=0;j<pixels.length;j++){
    const row=pixels[j];
    for(let i=0;i<row.length;i++){
      const ch=row[i];
      const base=colors[ch];
      if(!base)continue;

      let color=base;

      /* animate gem brightness */
      if(ch==="P"){
        const g=Math.floor(140+115*glow);
        color=`rgb(${g-40},${g-90},255)`;
      }

      ctx.fillStyle=color;
      ctx.fillRect(
        Math.floor(x + i*scale + recoilX),
        Math.floor(y + j*scale + bob + recoilY),
        scale,scale
      );
    }
  }
}
