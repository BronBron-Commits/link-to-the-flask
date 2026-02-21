export function drawScepter(ctx, x, y, scale=4, frame=0, idle=0){

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
    "G": "#f5c542"
  };

  /* animated purple gem palette */
  const gemPalette = [
    "#5a189a",  // dark
    "#7b2cbf",  // base
    "#9d4edd",  // bright
    "#c77dff",  // glow
    "#e0aaff"   // highlight
  ];

  function gemColor(i,j,time){
    // moving wave across gem
    const wave = Math.sin(time*0.006 + i*0.9 + j*0.7);
    const idx = Math.floor((wave+1)*2); // 0-4
    return gemPalette[idx];
  }

  const t = performance.now();

  // idle bob matches character
  const bob = Math.round(Math.sin(idle * 0.002) * 2);

  for(let j=0;j<pixels.length;j++){
    const row=pixels[j];
    for(let i=0;i<row.length;i++){
      const ch=row[i];
      if(ch==="0") continue;

      if(ch==="P"){
        ctx.fillStyle = gemColor(i,j,t);
      }else{
        const c=colors[ch];
        if(!c) continue;
        ctx.fillStyle=c;
      }

      ctx.fillRect(
        Math.floor(x+i*scale),
        Math.floor(y+j*scale+bob),
        scale,scale
      );
    }
  }
}
