export function drawWizard(ctx, x, y, s=4){
    const p = [
        "0000222000",
        "0002444200",
        "0024444420",
        "0244444442",
        "0244DD4442",
        "0024444420",
        "0002444200",
        "0002BB2000",
        "002BBBBB20",
        "02B22BB22B",
        "0222222222"
    ];
    for(let j=0;j<p.length;j++){
        for(let i=0;i<p[j].length;i++){
            const c = p[j][i];
            if(c==="0") continue;
            if(c==="2") ctx.fillStyle="#6a00ff";
            if(c==="4") ctx.fillStyle="#b48cff";
            if(c==="D") ctx.fillStyle="#ffe0bd";
            if(c==="B") ctx.fillStyle="#3b0066";
            ctx.fillRect(x+i*s, y+j*s, s, s);
        }
    }
}
