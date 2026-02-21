export function drawSprite(ctx, sprite, colors, wx, wy, camera, scale=4){

  const h = sprite.length;
  const w = Math.max(...sprite.map(r=>r.length));

  function cell(ix,iy){
    if(iy<0||iy>=h) return "0";
    const row=sprite[iy];
    if(ix<0||ix>=row.length) return "0";
    return row[ix];
  }

  // convert world -> screen
  function sx(ix){ return Math.floor(wx - camera.x + ctx.canvas.width/2 + ix*scale); }
  function sy(iy){ return Math.floor(wy - camera.y + ctx.canvas.height/2 + iy*scale); }

  // outline
  ctx.fillStyle="#000";
  const dirs=[[1,0],[-1,0],[0,1],[0,-1]];

  for(let j=-1;j<=h;j++){
    for(let i=-1;i<=w;i++){
      if(cell(i,j)!=="0") continue;

      let touching=false;
      for(const[dx,dy]of dirs){
        if(cell(i+dx,j+dy)!=="0"){touching=true;break;}
      }

      if(touching) ctx.fillRect(sx(i),sy(j),scale,scale);
    }
  }

  // sprite
  for(let j=0;j<h;j++){
    for(let i=0;i<w;i++){
      const ch=cell(i,j);
      if(ch==="0") continue;

      const c=colors[ch];
      if(!c) continue;

      ctx.fillStyle=c;
      ctx.fillRect(sx(i),sy(j),scale,scale);
    }
  }
}
