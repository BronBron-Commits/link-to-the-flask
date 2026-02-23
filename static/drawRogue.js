// Draws the rogue character with directional sprites and color logic
export function drawRogue(ctx, x, y, scale=4, frame=0, idle=0, facing={x:1,y:0}, sprites, robeColor="#2fa05b") {
  // Direction selection
  let dir = "front";
  let flip = false;
  if (Math.abs(facing.x) > Math.abs(facing.y)) {
    if (facing.x > 0) dir = "right";
    else { dir = "right"; flip = true; }
  } else if (Math.abs(facing.y) > 0) {
    dir = facing.y > 0 ? "front" : "back";
  }
  const pixels = sprites[dir] || sprites.front;
  const h = pixels.length;
  const w = Math.max(...pixels.map(r => r.length));
  const bob = Math.round(Math.sin(idle * 0.002) * 2);
  ctx.save();
  if (flip) {
    ctx.translate(x, 0);
    ctx.scale(-1, 1);
    x = 0;
  }
  function cell(ix, iy) {
    if (iy < 0 || iy >= h) return "0";
    const row = pixels[iy];
    if (ix < 0 || ix >= row.length) return "0";
    return row[ix];
  }
  // Outline
  ctx.fillStyle = "#000";
  const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
  for (let j = -1; j <= h; j++) {
    for (let i = -1; i <= w; i++) {
      if (cell(i, j) !== "0") continue;
      let touching = false;
      for (const [dX, dY] of dirs) if (cell(i + dX, j + dY) !== "0") { touching = true; break; }
      if (touching)
        ctx.fillRect(Math.floor(x + i * scale), Math.floor(y + j * scale + bob), scale, scale);
    }
  }
  // Sprite
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const ch = cell(i, j);
      if (ch === "0") continue;
      // Color logic for rogue
      if (ch === "G") ctx.fillStyle = "#2fa05b"; // Main robe color
      else if (ch === "E") ctx.fillStyle = "#fff"; // Eyes
      else ctx.fillStyle = "#888";
      ctx.fillRect(Math.floor(x + i * scale), Math.floor(y + j * scale + bob), scale, scale);
    }
  }
  ctx.restore();
}
