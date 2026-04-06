const LOADING_OVERLAY_FX_CSS = `
@keyframes loading-status-pop {
    0% { transform: translateY(8px) scale(0.94) rotate(-0.6deg); opacity: 0.45; }
    44% { transform: translateY(0px) scale(1.03) rotate(0.45deg); opacity: 1; }
    100% { transform: translateY(0px) scale(1) rotate(0deg); opacity: 1; }
}
@keyframes loading-quote-bounce {
    0% { transform: translateX(-8px); opacity: 0.55; }
    45% { transform: translateX(4px); opacity: 1; }
    100% { transform: translateX(0px); opacity: 0.95; }
}
@keyframes loading-glyph-burst {
    0% { transform: translate(0px, 0px) scale(0.8) rotate(0deg); opacity: 0; }
    20% { opacity: 1; }
    100% { transform: translate(var(--tx), var(--ty)) scale(var(--s)) rotate(var(--r)); opacity: 0; }
}
@keyframes loading-card-jitter {
    0%, 100% { transform: translateY(0px) rotate(0deg); }
    14% { transform: translateY(-1.5px) rotate(0.22deg) skewX(0.3deg); }
    28% { transform: translateY(1.5px) rotate(-0.18deg); }
    42% { transform: translateY(-0.5px) rotate(0.08deg) skewX(-0.2deg); }
    57% { transform: translateY(1px) rotate(0.14deg); }
    71% { transform: translateY(-1.2px) rotate(-0.1deg) skewX(0.15deg); }
    85% { transform: translateY(0.6px) rotate(0.05deg); }
}
@keyframes loading-title-glitch {
    0%, 88%, 100% { text-shadow: 0 0 2px rgba(255,255,255,0.9), 0 0 22px rgba(83,184,255,0.45), 0 0 30px rgba(255,88,122,0.25), 0 6px 16px rgba(0,0,0,0.85); clip-path: none; transform: translateX(0); }
    89% { clip-path: inset(12% 0 80% 0); transform: translateX(-6px); text-shadow: 3px 0 #ff0066, -3px 0 #00ffff; color: #ff99bb; }
    90% { clip-path: none; transform: translateX(3px); }
    91% { clip-path: inset(72% 0 10% 0); transform: translateX(5px); text-shadow: -4px 0 #00ffff, 4px 0 #ff0066; color: #99eeff; }
    92% { clip-path: none; transform: translateX(0); text-shadow: 0 0 2px rgba(255,255,255,0.9), 0 0 22px rgba(83,184,255,0.45); }
    94% { clip-path: inset(35% 0 55% 0); transform: translateX(-3px) scaleX(1.02); color: #ffffff; }
    95% { clip-path: none; transform: translateX(0); }
}
@keyframes loading-scanline {
    0% { background-position: 0 0; }
    100% { background-position: 0 200px; }
}
@keyframes loading-scanline-sweep {
    0% { top: -4px; opacity: 0.14; }
    80% { opacity: 0.22; }
    100% { top: 100%; opacity: 0; }
}
@keyframes loading-flicker {
    0%, 19%, 21%, 23%, 62%, 64%, 100% { opacity: 1; }
    20% { opacity: 0.55; }
    22% { opacity: 0.88; }
    63% { opacity: 0.6; }
}
@keyframes loading-card-hard-glitch {
    0%, 100% { clip-path: none; transform: translateX(0); filter: none; }
    5% { clip-path: inset(6% 0 88% 0); transform: translateX(-8px); filter: hue-rotate(120deg) brightness(1.6); }
    6% { clip-path: none; transform: translateX(4px); filter: none; }
    7% { clip-path: inset(78% 0 6% 0); transform: translateX(-4px); filter: hue-rotate(240deg); }
    8% { clip-path: none; transform: translateX(0); }
    50% { clip-path: none; filter: none; }
    51% { clip-path: inset(45% 0 45% 0); transform: translateX(6px); filter: saturate(3) hue-rotate(60deg); }
    52% { clip-path: none; transform: translateX(0); filter: none; }
}
@keyframes loading-rgb-split {
    0%, 100% { transform: translate(0, 0); opacity: 0.18; }
    25% { transform: translate(-3px, 0); opacity: 0.28; }
    50% { transform: translate(3px, 1px); opacity: 0.22; }
    75% { transform: translate(-1px, -1px); opacity: 0.15; }
}
@keyframes loading-dice-spin {
    0% { transform: rotateY(0deg) scale(0.4) translateY(-6px); opacity: 0; }
    25% { opacity: 1; }
    75% { transform: rotateY(540deg) scale(1.15) translateY(-2px); }
    100% { transform: rotateY(720deg) scale(1) translateY(0px); opacity: 1; }
}
@keyframes loading-dice-settle {
    0% { transform: scale(1.18) rotate(-6deg); }
    35% { transform: scale(0.88) rotate(4deg); }
    65% { transform: scale(1.06) rotate(-2deg); }
    100% { transform: scale(1) rotate(0deg); }
}
@keyframes loading-dice-glow {
    0%, 100% { filter: drop-shadow(0 0 4px #ffd700) drop-shadow(0 0 10px #ff8800); }
    50% { filter: drop-shadow(0 0 8px #ffffff) drop-shadow(0 0 18px #ffd700); }
}
`;

export function createLoadingOverlayStyleManager(deps = {}) {
    const {
        documentObj = document,
        getLoadingOverlayFxStylesInjected = () => false,
        setLoadingOverlayFxStylesInjected = () => {},
    } = deps;

    function ensureLoadingOverlayFxStyles() {
        if (getLoadingOverlayFxStylesInjected()) return;
        if (!documentObj.head) return;
        const style = documentObj.createElement('style');
        style.id = 'loading-overlay-fx-style';
        style.textContent = LOADING_OVERLAY_FX_CSS;
        documentObj.head.appendChild(style);
        setLoadingOverlayFxStylesInjected(true);
    }

    return {
        ensureLoadingOverlayFxStyles,
    };
}
