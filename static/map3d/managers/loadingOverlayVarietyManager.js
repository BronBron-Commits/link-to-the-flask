export function createLoadingOverlayVarietyManager(deps = {}) {
    const {
        windowObj = window,
        performanceObj = performance,
        getLoadingOverlayFinished = () => false,
        getLoadingOverlayRoot = () => null,
        getLoadingOverlayCard = () => null,
        getLoadingOverlayAccentBar = () => null,
        getLoadingOverlayQuote = () => null,
        getLoadingQuoteTimer = () => null,
        setLoadingQuoteTimer = () => {},
        getLoadingQuoteIndex = () => 0,
        setLoadingQuoteIndex = () => {},
        loadingNonsenseQuotes = [],
        loadingQuoteIntervalMs = 1300,
        getLoadingBackdropAnimFrame = () => null,
        setLoadingBackdropAnimFrame = () => {},
        getLoadingFlavorTimer = () => null,
        setLoadingFlavorTimer = () => {},
        loadingVarietyStatuses = [],
        loadingVarietyQuotes = [],
        getLoadingBurstCounter = () => 0,
        spawnLoadingMessageBurst = () => {},
        setLoadingOverlayStatus = () => {},
        getLoadingDiceTray = () => null,
        rollAllLoadingDice = () => {},
        getLoadingProgressTarget = () => 0,
        setLoadingProgress = () => {},
        clamp01 = (value) => Math.max(0, Math.min(1, value)),
    } = deps;

    function startLoadingQuoteCycle() {
        if (!getLoadingOverlayQuote() || getLoadingOverlayFinished()) return;
        if (getLoadingQuoteTimer()) {
            windowObj.clearInterval(getLoadingQuoteTimer());
            setLoadingQuoteTimer(null);
        }

        const pickQuote = () => {
            if (!Array.isArray(loadingNonsenseQuotes) || loadingNonsenseQuotes.length === 0) return;
            const quote = loadingNonsenseQuotes[getLoadingQuoteIndex() % loadingNonsenseQuotes.length];
            setLoadingQuoteIndex(getLoadingQuoteIndex() + 1);
            setLoadingOverlayStatus(quote);
        };

        pickQuote();
        setLoadingQuoteTimer(windowObj.setInterval(pickQuote, loadingQuoteIntervalMs));
    }

    function animateLoadingBackdropFrame() {
        setLoadingBackdropAnimFrame(null);
        if (!getLoadingOverlayRoot() || !getLoadingOverlayCard() || getLoadingOverlayFinished()) return;

        const t = performanceObj.now() * 0.00055;
        const x = 50 + (Math.sin(t * 1.4) * 18);
        const y = 24 + (Math.cos(t * 1.1) * 11);
        const hue = Math.round((Math.sin(t * 0.8) * 10) + 3);

        const overlayRoot = getLoadingOverlayRoot();
        const overlayCard = getLoadingOverlayCard();
        const accentBar = getLoadingOverlayAccentBar();
        if (!overlayRoot || !overlayCard) return;

        overlayRoot.style.background = `radial-gradient(circle at ${x.toFixed(1)}% ${y.toFixed(1)}%, rgba(255,77,109,0.24), rgba(18,21,38,0.94) 42%, rgba(5,7,18,0.99) 100%)`;
        overlayCard.style.filter = `hue-rotate(${hue}deg)`;

        if (accentBar) {
            const pulse = 0.92 + (Math.sin(t * 3.6) * 0.08);
            accentBar.style.transform = `scaleX(${pulse.toFixed(3)})`;
        }

        setLoadingBackdropAnimFrame(windowObj.requestAnimationFrame(animateLoadingBackdropFrame));
    }

    function startLoadingBackdropAnimation() {
        if (getLoadingBackdropAnimFrame() !== null) return;
        setLoadingBackdropAnimFrame(windowObj.requestAnimationFrame(animateLoadingBackdropFrame));
    }

    function startLoadingVarietyCycle() {
        if (getLoadingFlavorTimer()) {
            windowObj.clearInterval(getLoadingFlavorTimer());
            setLoadingFlavorTimer(null);
        }

        const timer = windowObj.setInterval(() => {
            if (getLoadingOverlayFinished() || !getLoadingOverlayRoot()) return;
            const roll = Math.random();

            if (roll < 0.28) {
                if (loadingVarietyStatuses.length > 0) {
                    const status = loadingVarietyStatuses[Math.floor(Math.random() * loadingVarietyStatuses.length)];
                    setLoadingOverlayStatus(status);
                }
                return;
            }

            if (roll < 0.5) {
                if (loadingVarietyQuotes.length > 0) {
                    const quote = loadingVarietyQuotes[Math.floor(Math.random() * loadingVarietyQuotes.length)];
                    setLoadingOverlayStatus(quote);
                }
                return;
            }

            if (roll < 0.7) {
                setLoadingOverlayStatus(`Showtime pulse #${(getLoadingBurstCounter() % 9) + 1}: increasing dramatic tension...`);
                spawnLoadingMessageBurst(10 + Math.floor(Math.random() * 12));
                return;
            }

            if (roll < 0.78) {
                const diceNames = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20'];
                const die = diceNames[Math.floor(Math.random() * diceNames.length)];
                const max = parseInt(die.slice(1), 10);
                const result = Math.floor(Math.random() * max) + 1;
                const flavour = result === max ? '💥 NATURAL MAX!' : result === 1 ? '💀 rolled a 1...' : `rolled ${die}: ${result}`;
                setLoadingOverlayStatus(flavour);
                if (getLoadingDiceTray()) rollAllLoadingDice();
                return;
            }

            if (roll < 0.86) {
                const progressNudge = (Math.random() * 0.03) - 0.012;
                setLoadingProgress(clamp01(getLoadingProgressTarget() + progressNudge));
                setLoadingOverlayStatus('Buffering extra swagger into the loading bar...');
                return;
            }

            spawnLoadingMessageBurst(16 + Math.floor(Math.random() * 10));
        }, 920);

        setLoadingFlavorTimer(timer);
    }

    return {
        startLoadingQuoteCycle,
        animateLoadingBackdropFrame,
        startLoadingBackdropAnimation,
        startLoadingVarietyCycle,
    };
}
