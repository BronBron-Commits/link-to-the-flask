export function createLoadingDiceManager(deps = {}) {
    const {
        documentObj = document,
        windowObj = window,
        getLoadingOverlayFinished = () => false,
        getLoadingDiceTray = () => null,
        loadingParticleGlyphs = [],
        getLoadingDiceRollTimer = () => null,
        setLoadingDiceRollTimer = () => {},
    } = deps;

    function buildDieSvg(dieType, value) {
        const shapes = {
            d4: { vb: '0 0 60 56', pts: '30,3 58,53 2,53', cy: '42' },
            d6: { vb: '0 0 60 60', pts: '5,5 55,5 55,55 5,55', cy: '50%' },
            d8: { vb: '0 0 60 60', pts: '30,3 57,30 30,57 3,30', cy: '50%' },
            d10: { vb: '0 0 60 66', pts: '30,3 58,26 46,63 14,63 2,26', cy: '52%' },
            d12: { vb: '0 0 64 64', pts: '32,3 62,22 50,59 14,59 2,22', cy: '50%' },
            d20: { vb: '0 0 70 62', pts: '35,3 68,58 2,58', cy: '54' },
        };
        const cfg = shapes[dieType] || shapes.d6;
        const colors = {
            d4: '#ff6b6b',
            d6: '#4ed6ff',
            d8: '#ffd700',
            d10: '#c084fc',
            d12: '#6bffb8',
            d20: '#ff9f43',
        };
        const strokeCol = colors[dieType] || '#4ed6ff';
        const ns = 'http://www.w3.org/2000/svg';
        const svg = documentObj.createElementNS(ns, 'svg');
        svg.setAttribute('viewBox', cfg.vb);
        svg.setAttribute('width', '52');
        svg.setAttribute('height', '52');
        svg.style.overflow = 'visible';
        svg.style.filter = `drop-shadow(0 0 5px ${strokeCol})`;

        const poly = documentObj.createElementNS(ns, 'polygon');
        poly.setAttribute('points', cfg.pts);
        poly.setAttribute('fill', 'rgba(6,12,30,0.95)');
        poly.setAttribute('stroke', strokeCol);
        poly.setAttribute('stroke-width', '3');
        poly.setAttribute('stroke-linejoin', 'round');
        svg.appendChild(poly);

        const label = documentObj.createElementNS(ns, 'text');
        label.setAttribute('x', '50%');
        label.setAttribute('y', cfg.cy);
        label.setAttribute('text-anchor', 'middle');
        label.setAttribute('dominant-baseline', 'middle');
        label.setAttribute('fill', strokeCol);
        label.setAttribute('font-size', value >= 10 ? '17' : '20');
        label.setAttribute('font-weight', '900');
        label.setAttribute('font-family', 'Consolas, monospace');
        label.textContent = String(value);
        svg.appendChild(label);

        return svg;
    }

    function rollAllLoadingDice() {
        const loadingDiceTray = getLoadingDiceTray();
        if (!loadingDiceTray || getLoadingOverlayFinished()) return;

        loadingDiceTray.innerHTML = '';
        const dieTypes = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20'];
        const maxRolls = { d4: 4, d6: 6, d8: 8, d10: 10, d12: 12, d20: 20 };

        dieTypes.forEach((dieType, idx) => {
            const max = maxRolls[dieType];
            const finalValue = Math.floor(Math.random() * max) + 1;

            const wrapper = documentObj.createElement('div');
            wrapper.style.display = 'flex';
            wrapper.style.flexDirection = 'column';
            wrapper.style.alignItems = 'center';
            wrapper.style.gap = '3px';
            wrapper.style.opacity = '0';
            wrapper.style.transition = `opacity 120ms ease ${idx * 60}ms`;

            const svgEl = buildDieSvg(dieType, Math.floor(Math.random() * max) + 1);
            svgEl.style.animation = 'loading-dice-spin 480ms cubic-bezier(0.22, 0.8, 0.36, 1) forwards';
            svgEl.style.animationDelay = `${idx * 55}ms`;
            wrapper.appendChild(svgEl);

            const lbl = documentObj.createElement('div');
            lbl.textContent = dieType.toUpperCase();
            lbl.style.fontSize = '10px';
            lbl.style.fontFamily = 'Consolas, monospace';
            lbl.style.color = '#7ab8dd';
            lbl.style.letterSpacing = '1px';
            wrapper.appendChild(lbl);

            loadingDiceTray.appendChild(wrapper);
            windowObj.requestAnimationFrame(() => {
                wrapper.style.opacity = '1';
            });

            let rollCount = 0;
            const rollInterval = windowObj.setInterval(() => {
                if (getLoadingOverlayFinished()) {
                    windowObj.clearInterval(rollInterval);
                    return;
                }
                rollCount += 1;
                const rollingVal = Math.floor(Math.random() * max) + 1;
                const newSvg = buildDieSvg(dieType, rollingVal);
                if (wrapper.firstChild) wrapper.replaceChild(newSvg, wrapper.firstChild);

                if (rollCount >= 6) {
                    windowObj.clearInterval(rollInterval);
                    const settledSvg = buildDieSvg(dieType, finalValue);
                    settledSvg.style.animation = 'loading-dice-settle 320ms ease-out forwards, loading-dice-glow 2.2s ease-in-out infinite';
                    settledSvg.style.animationDelay = '0ms, 100ms';
                    if (wrapper.firstChild) wrapper.replaceChild(settledSvg, wrapper.firstChild);
                }
            }, 75 + idx * 10);
        });
    }

    function startLoadingDiceRollCycle() {
        if (getLoadingDiceRollTimer()) {
            windowObj.clearInterval(getLoadingDiceRollTimer());
        }
        const nextTimer = windowObj.setInterval(() => {
            if (getLoadingOverlayFinished() || !getLoadingDiceTray()) {
                windowObj.clearInterval(nextTimer);
                setLoadingDiceRollTimer(null);
                return;
            }
            rollAllLoadingDice();
        }, 4200);
        setLoadingDiceRollTimer(nextTimer);
    }

    return {
        buildDieSvg,
        rollAllLoadingDice,
        startLoadingDiceRollCycle,
    };
}
