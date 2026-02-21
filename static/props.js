export function drawThrone(ctx, x, y, scale=4){

const pixels = [
"000000KKKKKK000000",
"0000KKGGGGGGKK0000",
"000KGRRRRRRRRGK000",
"00KGRRRRRRRRRRGK00",
"0KGRRRRRRRRRRRRGK0",
"KGRRRRRRRRRRRRRRGK",
"KGRRRRRRRRRRRRRRGK",
"KGGGGGGGGGGGGGGGGK",
"KBBBBBBBBBBBBBBBBK",
"KBBBBBBBBBBBBBBBBK",
"KBBBBBBBBBBBBBBBBK",
"KBBBBBBBBBBBBBBBBK",
"KBBBBBBBBBBBBBBBBK",
"KBBBBBBBBBBBBBBBBK",
"KBBBBBBBBBBBBBBBBK",
"KBBBBBBBBBBBBBBBBK",
"KBBBBBBBBBBBBBBBBK",
"KBBBBBBBBBBBBBBBBK",
"KBBBBBBBBBBBBBBBBK",
"KBBBBBBBBBBBBBBBBK"
];

const colors = {
"0": null,
"K": "#2b1a0f",      // dark outline wood
"B": "#5a3b22",      // wood body
"G": "#d4af37",      // gold trim
"R": "#8b0000"       // velvet cushion
};

for(let j=0;j<pixels.length;j++){
  const row=pixels[j];
  for(let i=0;i<row.length;i++){
    const c=colors[row[i]];
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
