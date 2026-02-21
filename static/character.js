export function drawWizard(ctx, x, y, scale=4, frame=0, idle=0, facing={x:1,y:0}){

/* =========================================================
   DIRECTION SELECTION
   ========================================================= */

let dir = "front";
if(Math.abs(facing.x) > Math.abs(facing.y)){
  dir = facing.x > 0 ? "right" : "left";
}else if(Math.abs(facing.y) > 0){
  dir = facing.y > 0 ? "front" : "back";
}

/* =========================================================
   SPRITES
   ========================================================= */

const sprites = {

front: [
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
],

back: [
"00000HHHHHH00000",
"0000HHHHHHHH0000",
"00HHHHHHHHHHHH00",
"0HHHHHHHHHHHHHH0",
"00HHHHHHHHHHHH00",
"0HHHHHHHHHHHHHH0",
"0HHHHHHHHHHHHHH0",
"00HHHHHHHHHHHH00",
"0HH3333333333HH",
"00H3333333333H0",
"0HH3333333333HH0",
"00H3333333333H0",
"003333333333330",
"033333333333333",
"033333333333333",
"003333333333330",
"0003333333333000"
],

left: [
"00000HHHHHH00000",
"0000HHHHHHHH0000",
"00HHHKKKKKKHHH00",
"0HHHKWWNNNNKHHH0",
"00HHKWKNNNNKHH00",
"0HHHKSKNNNNKHHH0",
"0HHHKHSSSSSKHHH0",
"00HHHKKHHHKKHH0",
"0HHK3333333KHH",
"00HK3333333KH0",
"0HHK3G33333KHH0",
"00K3G3333333K0",
"003333333333330",
"0KKGKKGGGGGGKK",
"033333333333333",
"0033GGGGGGGG330",
"0003333333333000"
],

right: [
"00000HHHHHH00000",
"0000HHHHHHHH0000",
"00HHHKKKKKKHHH00",
"0HHHKNNNNWWKHHH0",
"00HHKNNNNKWKHH00",
"0HHHKNNNNKSKHHH0",
"0HHHKSSSSSHKHHH0",
"00HHKKHHHKKHHH0",
"0HHK3333333KHH",
"00HK3333333KH0",
"0HHK33333G3KHH0",
"00K3333333G3K0",
"003333333333330",
"0KKGGGGGGKKGKK",
"033333333333333",
"0033GGGGGGGG330",
"0003333333333000"
]

};

const pixels = sprites[dir];

/* =========================================================
   COLORS
   ========================================================= */

const colors = {
"0": null,
"S": "#f1c27d",
"W": "#ffffff",
"K": "#000000",
"N": "#e0ac69",
"G": "#f5c542"
};

function hairColor(i,j){
  const seed = (i*928371 + j*12377) % 100;
  if(seed < 33) return "rgb(122,74,38)";
  if(seed < 66) return "rgb(105,63,32)";
  return "rgb(145,95,55)";
}

function goldColor(i,j){
  const seed = (i*19349663 ^ j*83492791) & 255;
  if(seed < 64)  return "#cfa72e";
  if(seed < 128) return "#f5c542";
  if(seed < 192) return "#ffd95e";
  return "#fff1a8";
}

const robePalette = ["#5b2fa0","#6a3dad","#7c52c7","#a884ff"];
function robeColor(i,j,time){
  const wave = Math.sin((i*0.8 + j*0.6) + time*0.004);
  return robePalette[Math.floor((wave+1)*1.5)];
}

const t = performance.now();

/* =========================================================
   DRAW
   ========================================================= */

const h = pixels.length;
const w = Math.max(...pixels.map(r => r.length));
const bob = Math.round(Math.sin(idle * 0.002) * 2);

function cell(ix, iy){
  if(iy < 0 || iy >= h) return "0";
  const row = pixels[iy];
  if(ix < 0 || ix >= row.length) return "0";
  return row[ix];
}

/* outline */
ctx.fillStyle="#000";
const dirs=[[1,0],[-1,0],[0,1],[0,-1]];
for(let j=-1;j<=h;j++){
  for(let i=-1;i<=w;i++){
    if(cell(i,j)!=="0")continue;
    let touching=false;
    for(const[dX,dY]of dirs) if(cell(i+dX,j+dY)!=="0"){touching=true;break;}
    if(touching)
      ctx.fillRect(Math.floor(x+i*scale),Math.floor(y+j*scale+bob),scale,scale);
  }
}

/* sprite */
for(let j=0;j<h;j++){
  for(let i=0;i<w;i++){
    const ch=cell(i,j);
    if(ch==="0")continue;

    if(ch==="H") ctx.fillStyle=hairColor(i,j);
    else if(ch==="3") ctx.fillStyle=robeColor(i,j,t);
    else if(ch==="G") ctx.fillStyle=goldColor(i,j);
    else ctx.fillStyle=colors[ch];

    ctx.fillRect(Math.floor(x+i*scale),Math.floor(y+j*scale+bob),scale,scale);
  }
}

}
