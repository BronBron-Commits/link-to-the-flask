export function drawWizard(ctx, x, y, scale=4){
const pixels = [
"000PPPPPP000",
"00PPHHHHPP00",
"0PPHHHHHHPP0",
"0PH3333333HP",
"PP3SSSSSS3PP",
"P33SSSSSS33P",
"P3SSGSSGSS3P",
"0P3SSSSSS3P0",
"0P03MMMM30P0",
"0P03BBBB30P0",
"0P33BBBB33P0",
"0033BBBB3300",
"003BBBBBB300",
"03B33BB33B30",
"033333333330",
"003333333300",
"000333333000"
];

const colors = {
"0": null,
"3": "#6a3dad",   // robe
"S": "#f1c27d",   // skin
"M": "#b85c38",   // mouth
"B": "#3b2a1a",   // beard
"H": "#f4d03f",   // blonde hair
"G": "#0b7a0b",   // darker green iris
"P": "#4b0082"    // purple hood
};

for(let j=0; j<pixels.length; j++){
    for(let i=0; i<pixels[j].length; i++){
        const c = colors[pixels[j][i]];
        if(!c) continue;
        ctx.fillStyle = c;
        ctx.fillRect(
            Math.floor(x + i*scale),
            Math.floor(y + j*scale),
            scale, scale
        );
    }
}
}
