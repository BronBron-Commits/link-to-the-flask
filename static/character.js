export function drawWizard(ctx, x, y, scale=4){

const pixels = [
"000HHHHHH000",
"00HHHHHHHH00",
"0HHHHHHHHHH0",
"0H33333333H0",
"HH3SSSSSS3HH",
"H33SSSSSS33H",
"H3SS0SS0SS3H",
"0H3SSSSSS3H0",
"0H03MMMM30H0",
"0H03BBBB30H0",
"0H33BBBB33H0",
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
"H": "#f4d03f"    // blonde hair
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
