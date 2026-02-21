export function drawWizard(ctx, x, y, scale=4, frame=0, idle=0){

const pixels = [
"00000HHHHHH00000",
"0000HHHHHHHH0000",
"00HHHKKKKKKHHH00",
"0HHHKWWNNWWKHHH0",
"00HHKWKNNKWKHH00",
"0HHHKSKNNKSKHHH0",
"0HHHKHSSSSHKHHH0",
"00HHHKKHHKKHHH0",
"0HHK333KK333KHH",
"00HK33K33K33KH0",
"0HHK3G3KK3G3KHH0",
"00K3G3K33K3G3K0",
"0033G33KK33G330",
"0KKGKKKGGKKKGKK",
"033G33333333G33",
"0033GGGGGGGG33",
"0003333333333000"
];

const colors = {
"0": null,
"S": "#f1c27d",
"W": "#ffffff",
"K": "#000000",
"N": "#e0ac69",
"G": "#f5c542"
};

/* hair */
function hairColor(i,j){
  const seed = (i*928371 + j*12377) % 100;
  if(seed < 33) return "rgb(122,74,38)";
  if(seed < 66) return "rgb(105,63,32)";
  return "rgb(145,95,55)";
}

/* GOLD VARIATION (stable like hair) */
function goldColor(i,j){
  const seed = (i*19349663 ^ j*83492791) & 255;
  if(seed < 64)  return "#cfa72e";
  if(seed < 128) return "#f5c542";
  if(seed < 192) return "#ffd95e";
  return "#fff1a8";
}

/* enchanted robe shimmer */
const robePalette = [
  "#5b2fa0",
  "#6a3dad",
  "#7c52c7",
  "#a884ff"
];

function robeColor(i,j,time){
  const wave = Math.sin((i*0.8 + j*0.6) + time*0.004);
  const idx = Math.floor((wave + 1) * 1.5);
  return robePalette[idx];
}

const t = performance.now();

const h = pixels.length;
const w = Math.max(...pixels.map(r => r.length));

// idle bob (pixel units, slow)
const bob = Math.round(Math.sin(idle * 0.002) * 2);

function cell(ix, iy){
  if(iy < 0 || iy >= h) return "0";
  const row = pixels[iy];
  if(ix < 0 || ix >= row.length) return "0";
  return row[ix];
}

/* outline */
ctx.fillStyle = "#000";
const dirs = [[1,0],[-1,0],[0,1],[0,-1]];

for(let j=-1; j<=h; j++){
  for(let i=-1; i<=w; i++){
    if(cell(i,j) !== "0") continue;

    let touching = false;
    for(const [dx,dy] of dirs){
      if(cell(i+dx,j+dy) !== "0"){ touching = true; break; }
    }

    if(touching){
      ctx.fillRect(
        Math.floor(x + i*scale),
        Math.floor(y + j*scale + bob),
        scale, scale
      );
    }
  }
}

/* sprite */
for(let j=0; j<h; j++){
  for(let i=0; i<w; i++){
    const ch = cell(i,j);
    if(ch === "0") continue;

    if(ch === "H"){
      ctx.fillStyle = hairColor(i,j);
    } else if(ch === "3"){
      ctx.fillStyle = robeColor(i,j,t);
    } else if(ch === "G"){
      ctx.fillStyle = goldColor(i,j);
    } else {
      const c = colors[ch];
      if(!c) continue;
      ctx.fillStyle = c;
    }

    ctx.fillRect(
      Math.floor(x + i*scale),
      Math.floor(y + j*scale + bob),
      scale, scale
    );
  }
}

}
