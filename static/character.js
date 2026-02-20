export function drawWizard(ctx, x, y, scale=4){

const pixels = [
"0000HHHHHHHH0000",
"000HHHHHHHHHHH00",
"00HHHHHHHHHHHHH0",
"0HHHHHHHHHHHHHH0",
"0HHHH333333HHHH0",
"HHH33SSSSSS33HHH",
"HH3SSWWNNWWSS3HH",
"HH3SSWKNNKWSS3HH",
"HH3SSWKNNKWSS3HH",
"HH3SSSSSSSSSS3HH",
"0HHSSSSSSSSSSHH0",
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
"3": "#6a3dad",   // robe
"S": "#f1c27d",   // skin
"H": "#6b3f1d",   // hair (brown)
"W": "#ffffff",   // eye white
"K": "#000000",   // pupil
"N": "#e0ac69"    // nose bridge
};

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
    const c=colors[cell(i,j)];
    if(!c) continue;
    ctx.fillStyle=c;
    ctx.fillRect(
      Math.floor(x+i*scale),
      Math.floor(y+j*scale),
      scale,scale
    );
  }
}

}
