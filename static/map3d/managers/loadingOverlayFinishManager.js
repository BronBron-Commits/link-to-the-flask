export function createLoadingOverlayFinishManager(deps = {}) {
    const {
        windowObj = window,
        performanceObj = performance,
        getLoadingOverlayRoot = () => null,
        getLoadingOverlayFinished = () => false,
        setLoadingOverlayFinished = () => {},
        getLoadingOverlayCloseScheduled = () => false,
        setLoadingOverlayCloseScheduled = () => {},
        getLoadingProgressValue = () => 0,
        setLoadingProgress = () => {},
        clamp01 = (value) => Math.max(0, Math.min(1, value)),
        getLoadingOverlayStartedAt = () => 0,
        loadingMinVisibleMs = 0,
        loadingPostCompleteHoldMs = 0,
        loadingFadeDurationMs = 0,
        setLoadingOverlayStatus = () => {},
        spawnLoadingMessageBurst = () => {},
        stopMainTheme = () => {},
        startDocksTheme = () => {},
        updateDmControlPanel = () => {},
        getLoadingLogFlushTimer = () => null,
        setLoadingLogFlushTimer = () => {},
        getLoadingQuoteTimer = () => null,
        setLoadingQuoteTimer = () => {},
        getLoadingFlavorTimer = () => null,
        setLoadingFlavorTimer = () => {},
        getLoadingDiceRollTimer = () => null,
        setLoadingDiceRollTimer = () => {},
        getLoadingStatusTimer = () => null,
        setLoadingStatusTimer = () => {},
        getLoadingProgressAnimFrame = () => null,
        setLoadingProgressAnimFrame = () => {},
        getLoadingBackdropAnimFrame = () => null,
        setLoadingBackdropAnimFrame = () => {},
        clearOverlayRefs = () => {},
        clearLoadingStatusQueue = () => {},
    } = deps;

    function finishLoadingOverlay(message = 'Ready') {
        const root = getLoadingOverlayRoot();
        if (!root || getLoadingOverlayFinished() || getLoadingOverlayCloseScheduled()) return;
        setLoadingOverlayCloseScheduled(true);

        const startProgress = getLoadingProgressValue();
        const progressStartAt = performanceObj.now();
        const progressDuration = 900;
        const animateProgress = () => {
            if (getLoadingOverlayFinished()) return;
            const elapsed = performanceObj.now() - progressStartAt;
            const t = clamp01(elapsed / progressDuration);
            const eased = 1 - Math.pow(1 - t, 3);
            setLoadingProgress(startProgress + ((1 - startProgress) * eased));
            if (t < 1) {
                windowObj.requestAnimationFrame(animateProgress);
            }
        };
        windowObj.requestAnimationFrame(animateProgress);

        const elapsedVisible = performanceObj.now() - getLoadingOverlayStartedAt();
        const remainingToMinVisible = Math.max(0, loadingMinVisibleMs - elapsedVisible);
        setLoadingOverlayStatus(`${message} - finalizing visuals...`);

        windowObj.setTimeout(() => {
            if (getLoadingOverlayFinished()) return;
            setLoadingOverlayStatus('99.2% - polishing boss-level dramatic timing...');
            spawnLoadingMessageBurst(18);
        }, Math.max(120, remainingToMinVisible * 0.2));

        windowObj.setTimeout(() => {
            if (getLoadingOverlayFinished()) return;
            setLoadingOverlayStatus('99.8% - pretending this is the final pass...');
            spawnLoadingMessageBurst(14);
        }, Math.max(260, remainingToMinVisible * 0.45));

        windowObj.setTimeout(() => {
            if (getLoadingOverlayFinished()) return;
            setLoadingOverlayStatus(`${message} - absolutely final pass for real this time.`);
            spawnLoadingMessageBurst(20);
        }, Math.max(420, remainingToMinVisible * 0.7));

        const closeDelay = remainingToMinVisible + loadingPostCompleteHoldMs;
        windowObj.setTimeout(() => {
            const liveRoot = getLoadingOverlayRoot();
            if (!liveRoot || getLoadingOverlayFinished()) return;
            setLoadingOverlayStatus(message);
            spawnLoadingMessageBurst(20);
            windowObj.setTimeout(() => {
                spawnLoadingMessageBurst(26);
            }, 220);
            liveRoot.style.opacity = '0';

            windowObj.setTimeout(() => {
                setLoadingOverlayFinished(true);

                const logFlushTimer = getLoadingLogFlushTimer();
                if (logFlushTimer) {
                    windowObj.clearInterval(logFlushTimer);
                    setLoadingLogFlushTimer(null);
                }

                const quoteTimer = getLoadingQuoteTimer();
                if (quoteTimer) {
                    windowObj.clearInterval(quoteTimer);
                    setLoadingQuoteTimer(null);
                }

                const flavorTimer = getLoadingFlavorTimer();
                if (flavorTimer) {
                    windowObj.clearInterval(flavorTimer);
                    setLoadingFlavorTimer(null);
                }

                const diceRollTimer = getLoadingDiceRollTimer();
                if (diceRollTimer) {
                    windowObj.clearInterval(diceRollTimer);
                    setLoadingDiceRollTimer(null);
                }

                const statusTimer = getLoadingStatusTimer();
                if (statusTimer) {
                    windowObj.clearTimeout(statusTimer);
                    setLoadingStatusTimer(null);
                }

                const progressAnimFrame = getLoadingProgressAnimFrame();
                if (progressAnimFrame !== null) {
                    windowObj.cancelAnimationFrame(progressAnimFrame);
                    setLoadingProgressAnimFrame(null);
                }

                const backdropAnimFrame = getLoadingBackdropAnimFrame();
                if (backdropAnimFrame !== null) {
                    windowObj.cancelAnimationFrame(backdropAnimFrame);
                    setLoadingBackdropAnimFrame(null);
                }

                const finalRoot = getLoadingOverlayRoot();
                if (finalRoot && finalRoot.parentElement) {
                    finalRoot.parentElement.removeChild(finalRoot);
                }

                stopMainTheme();
                startDocksTheme();
                clearOverlayRefs();
                clearLoadingStatusQueue();
                updateDmControlPanel();
            }, loadingFadeDurationMs);
        }, closeDelay);
    }

    return {
        finishLoadingOverlay,
    };
}
