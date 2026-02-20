export function drawWizard(ctx, x, y, scale=4){

const pixels = [
"0000HHHHHHHH0000",
"000HHHHHHHHHHH00",
"00HHHHHHHHHHHHH0",
"0HHHHHHHHHHHHHH0",
"0HHHH333333HHHH0",
"HHH33SSSSSS33HHH",
"HH33SWWNNWWS33HH",
"HH3SSWKNNKWSS3HH",
"HH3SSWKNNKWSS3HH",
"HH3SSSSSSSSSS33HH",
"0HH333SSSS333HH0",
"HHH333333333HHH",
"0HH333333333HH0",
"0HH333333333HH0",
"003333333333330",
"003333333333330",
"033333333333330",
"033333333333330",
"003333333333300",
"000333333333000"
];

const colors = {
"0": null,
"3": "#6a3dad",
"S": "#f1c27d",
"W": "#ffffff",
"K": "#000000",
"N": "#e0ac69"
};

/* deterministic pseudo-random brown per pixel */
function hairColor(i,j){
    const seed = (i*928371 + j*12377) % 100;
    const base = [122,74,38];

    if(seed < 33) return "rgb(122,74,38)";     // mid brown
    if(seed < 66) return "rgb(105,63,32)";     // darker
    return "rgb(145,95,55)";                   // lighter
}

const h = pixels.length;
const w = Math.max(...pixels.map(r => r.length));

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
    let touching=false;
    for(const [dx,dy] of dirs){
      if(cell(i+dx,j+dy)!=="0"){touching=true;break;}
    }
    if(touching){
      ctx.fillRect(
        Math.floor(x+i*scale),
        Math.floor(y+j*scale),
        scale,scale
      );
    }
  }
}

/* sprite */
for(let j=0;j<h;j++){
  for(let i=0;i<w;i++){
    const ch = cell(i,j);
    if(ch==="0") continue;

    if(ch==="H"){
        ctx.fillStyle = hairColor(i,j); // stable variation
    } else {
        const c = colors[ch];
        if(!c) continue;
        ctx.fillStyle = c;
    }

    ctx.fillRect(
      Math.floor(x+i*scale),
      Math.floor(y+j*scale),
      scale,scale
    );
  }
}

}
