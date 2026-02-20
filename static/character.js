export function drawWizard(ctx, x, y, scale=4){

const pixels = [
"0000HHHHHHHH0000",
"000HHHHHHHHHHH00",
"00HHHHHHHHHHHHH0",
"0HHHHHHHHHHHHHH0",
"0H333333333333H0",
"HH33SSSSSSSS33HH",
"H333SSWWSSWW333H",
"H33SSSWKSSKWSS3H",
"H33SSSSKSSKSS33H",
"0H33MMMMMMMM33H0",
"0H333333333333H0",
"0H333333333333H0",
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
"M": "#b85c38",
"H": "#f4d03f",
"W": "#ffffff",
"K": "#000000"
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
