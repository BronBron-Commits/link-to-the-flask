export function createLoadingOverlayBuilderManager(deps = {}) {
    const {
        documentObj = document,
        performanceObj = performance,
        ensureLoadingOverlayFxStyles = () => {},
        startMainTheme = () => {},
        renderLoadingProgress = () => {},
        setLoadingProgress = () => {},
        startLoadingVarietyCycle = () => {},
        startLoadingBackdropAnimation = () => {},
        spawnLoadingMessageBurst = () => {},
        rollAllLoadingDice = () => {},
        startLoadingDiceRollCycle = () => {},
        setLoadingOverlayStartedAt = () => {},
        setLoadingOverlayRoot = () => {},
        setLoadingOverlayCard = () => {},
        setLoadingOverlayFxLayer = () => {},
        setLoadingOverlayAccentBar = () => {},
        setLoadingOverlayProgressText = () => {},
        setLoadingOverlayProgressFill = () => {},
        setLoadingOverlayStatusEl = () => {},
        setLoadingOverlayQuoteEl = () => {},
        setLoadingOverlayLog = () => {},
        setLoadingDiceTray = () => {},
        setLoadingProgressValue = () => {},
        setLoadingProgressTarget = () => {},
        setLoadingQuoteIndex = () => {},
        getLoadingOverlayQuote = () => null,
    } = deps;

    function createLoadingOverlay() {
        ensureLoadingOverlayFxStyles();
        setLoadingOverlayStartedAt(performanceObj.now());
        startMainTheme();

        const loadingOverlayRoot = documentObj.createElement('div');
        loadingOverlayRoot.style.position = 'fixed';
        loadingOverlayRoot.style.inset = '0';
        loadingOverlayRoot.style.zIndex = '99999';
        loadingOverlayRoot.style.display = 'flex';
        loadingOverlayRoot.style.flexDirection = 'column';
        loadingOverlayRoot.style.justifyContent = 'center';
        loadingOverlayRoot.style.alignItems = 'center';
        loadingOverlayRoot.style.padding = 'clamp(10px, 2vw, 24px)';
        loadingOverlayRoot.style.background = 'radial-gradient(circle at 15% 12%, rgba(255,77,109,0.24), rgba(18,21,38,0.94) 42%, rgba(5,7,18,0.99) 100%)';
        loadingOverlayRoot.style.color = '#e8f2ff';
        loadingOverlayRoot.style.fontFamily = '"Noto Sans JP", "Hiragino Kaku Gothic ProN", "Yu Gothic", "Meiryo", sans-serif';
        loadingOverlayRoot.style.fontSize = 'clamp(16px, 1.3vw, 24px)';
        loadingOverlayRoot.style.transition = 'opacity 0.45s ease';

        const card = documentObj.createElement('div');
        card.style.width = '100%';
        card.style.height = '100%';
        card.style.maxWidth = 'none';
        card.style.maxHeight = 'none';
        card.style.display = 'flex';
        card.style.flexDirection = 'column';
        card.style.gap = 'clamp(10px, 1.6vh, 18px)';
        card.style.padding = 'clamp(16px, 2.4vw, 34px)';
        card.style.borderRadius = 'clamp(14px, 1.3vw, 24px)';
        card.style.border = '2px solid rgba(115, 206, 255, 0.6)';
        card.style.background = 'linear-gradient(180deg, rgba(10,14,29,0.9), rgba(7,9,20,0.94))';
        card.style.boxShadow = '0 24px 80px rgba(0,0,0,0.62), inset 0 0 0 2px rgba(255,255,255,0.05), inset 0 14px 24px rgba(255,77,109,0.08), 0 0 36px rgba(83,184,255,0.22)';
        card.style.animation = 'none';
        card.style.position = 'relative';
        loadingOverlayRoot.appendChild(card);

        const fxLayer = documentObj.createElement('div');
        fxLayer.style.position = 'absolute';
        fxLayer.style.inset = '0';
        fxLayer.style.pointerEvents = 'none';
        fxLayer.style.overflow = 'hidden';
        fxLayer.style.zIndex = '3';
        card.appendChild(fxLayer);

        const accentBar = documentObj.createElement('div');
        accentBar.style.height = 'clamp(6px, 0.8vh, 10px)';
        accentBar.style.borderRadius = '999px';
        accentBar.style.background = 'linear-gradient(90deg, rgba(255,77,109,0.95), rgba(255,188,66,0.9), rgba(78,214,255,0.95))';
        accentBar.style.boxShadow = '0 0 20px rgba(255,77,109,0.45), 0 0 18px rgba(78,214,255,0.35)';
        card.appendChild(accentBar);

        const scanlineOverlay = documentObj.createElement('div');
        scanlineOverlay.style.position = 'absolute';
        scanlineOverlay.style.inset = '0';
        scanlineOverlay.style.zIndex = '5';
        scanlineOverlay.style.pointerEvents = 'none';
        scanlineOverlay.style.borderRadius = 'inherit';
        scanlineOverlay.style.background = 'repeating-linear-gradient(to bottom, transparent 0px, transparent 3px, rgba(0,0,0,0.14) 3px, rgba(0,0,0,0.14) 4px)';
        scanlineOverlay.style.animation = 'loading-scanline 1.8s linear infinite, loading-flicker 5.2s step-start infinite';
        card.appendChild(scanlineOverlay);

        const scanlineSweep = documentObj.createElement('div');
        scanlineSweep.style.position = 'absolute';
        scanlineSweep.style.left = '0';
        scanlineSweep.style.right = '0';
        scanlineSweep.style.height = '4px';
        scanlineSweep.style.background = 'linear-gradient(to right, transparent, rgba(78,214,255,0.6), transparent)';
        scanlineSweep.style.pointerEvents = 'none';
        scanlineSweep.style.zIndex = '6';
        scanlineSweep.style.animation = 'loading-scanline-sweep 3.1s linear infinite';
        card.appendChild(scanlineSweep);

        const titleWrap = documentObj.createElement('div');
        titleWrap.style.position = 'relative';
        titleWrap.style.lineHeight = '1.08';
        card.appendChild(titleWrap);

        ['#ff005580', '#00ffff55'].forEach((col, i) => {
            const ghost = documentObj.createElement('div');
            ghost.textContent = 'PARAVAL ENGINE';
            ghost.style.position = 'absolute';
            ghost.style.inset = '0';
            ghost.style.fontSize = 'clamp(36px, 6.2vw, 82px)';
            ghost.style.fontWeight = '900';
            ghost.style.letterSpacing = '1.8px';
            ghost.style.color = col;
            ghost.style.pointerEvents = 'none';
            ghost.style.userSelect = 'none';
            ghost.style.animation = `loading-rgb-split ${1.4 + i * 0.7}s ease-in-out infinite`;
            ghost.style.animationDelay = `${i * 0.3}s`;
            titleWrap.appendChild(ghost);
        });

        const title = documentObj.createElement('div');
        title.textContent = 'PARAVAL ENGINE';
        title.style.fontSize = 'clamp(36px, 6.2vw, 82px)';
        title.style.fontWeight = '900';
        title.style.letterSpacing = '1.8px';
        title.style.lineHeight = '1.08';
        title.style.color = '#ffffff';
        title.style.position = 'relative';
        title.style.zIndex = '1';
        title.style.textShadow = '0 0 2px rgba(255,255,255,0.9), 0 0 22px rgba(83,184,255,0.45), 0 0 30px rgba(255,88,122,0.25), 0 6px 16px rgba(0,0,0,0.85)';
        title.style.animation = 'loading-title-glitch 7.3s steps(1) infinite';
        titleWrap.appendChild(title);

        const progressHeader = documentObj.createElement('div');
        progressHeader.style.display = 'flex';
        progressHeader.style.justifyContent = 'space-between';
        progressHeader.style.alignItems = 'center';
        progressHeader.style.color = '#cae6ff';
        progressHeader.style.fontSize = 'clamp(17px, 2.1vw, 32px)';

        const progressLabel = documentObj.createElement('span');
        progressLabel.textContent = '加载进度  //  Progress';
        progressHeader.appendChild(progressLabel);

        const progressText = documentObj.createElement('span');
        progressText.textContent = '0%';
        progressHeader.appendChild(progressText);
        card.appendChild(progressHeader);

        const progressTrack = documentObj.createElement('div');
        progressTrack.style.height = 'clamp(14px, 2.3vh, 28px)';
        progressTrack.style.borderRadius = '999px';
        progressTrack.style.overflow = 'hidden';
        progressTrack.style.background = 'rgba(70, 103, 156, 0.25)';
        progressTrack.style.border = '2px solid rgba(128, 196, 255, 0.55)';

        const progressFill = documentObj.createElement('div');
        progressFill.style.height = '100%';
        progressFill.style.width = '0%';
        progressFill.style.background = 'linear-gradient(90deg, #ff4d6d, #ffbc42 46%, #4ed6ff)';
        progressFill.style.boxShadow = '0 0 18px rgba(255,77,109,0.42), 0 0 18px rgba(78,214,255,0.4), inset 0 0 10px rgba(255,255,255,0.2)';
        progressFill.style.transition = 'none';
        progressFill.style.transformOrigin = 'left center';
        progressTrack.appendChild(progressFill);
        card.appendChild(progressTrack);

        const statusEl = documentObj.createElement('div');
        statusEl.textContent = '正在初始化渲染器和资源...';
        statusEl.style.color = '#bfe3ff';
        statusEl.style.fontSize = 'clamp(20px, 2.4vw, 36px)';
        statusEl.style.minHeight = 'clamp(24px, 3vh, 40px)';
        statusEl.style.fontWeight = '800';
        statusEl.style.letterSpacing = '0.8px';
        card.appendChild(statusEl);

        const quoteEl = documentObj.createElement('div');
        quoteEl.textContent = '系统正在校准... // preparing scene vectors...';
        quoteEl.style.color = '#e7f1ff';
        quoteEl.style.fontSize = 'clamp(17px, 1.95vw, 32px)';
        quoteEl.style.minHeight = 'clamp(22px, 3vh, 36px)';
        quoteEl.style.fontStyle = 'normal';
        quoteEl.style.opacity = '0.95';
        quoteEl.style.letterSpacing = '0.5px';
        card.appendChild(quoteEl);

        const diceTray = documentObj.createElement('div');
        diceTray.style.display = 'flex';
        diceTray.style.gap = 'clamp(8px, 1.2vw, 18px)';
        diceTray.style.alignItems = 'center';
        diceTray.style.justifyContent = 'center';
        diceTray.style.padding = '6px 0 2px';
        diceTray.style.minHeight = 'clamp(60px, 8vh, 90px)';
        diceTray.style.flexShrink = '0';
        card.appendChild(diceTray);

        documentObj.body.appendChild(loadingOverlayRoot);

        setLoadingOverlayRoot(loadingOverlayRoot);
        setLoadingOverlayCard(card);
        setLoadingOverlayFxLayer(fxLayer);
        setLoadingOverlayAccentBar(accentBar);
        setLoadingOverlayProgressText(progressText);
        setLoadingOverlayProgressFill(progressFill);
        setLoadingOverlayStatusEl(statusEl);
        setLoadingOverlayQuoteEl(quoteEl);
        setLoadingOverlayLog(null);
        setLoadingDiceTray(diceTray);
        setLoadingProgressValue(0);
        setLoadingProgressTarget(0);
        setLoadingQuoteIndex(0);

        renderLoadingProgress(0);
        setLoadingProgress(0.02);

        const activeQuoteEl = getLoadingOverlayQuote();
        if (activeQuoteEl) {
            activeQuoteEl.textContent = '';
            activeQuoteEl.style.minHeight = '0';
            activeQuoteEl.style.opacity = '0';
        }

        startLoadingVarietyCycle();
        startLoadingBackdropAnimation();
        spawnLoadingMessageBurst(14);
        rollAllLoadingDice();
        startLoadingDiceRollCycle();
    }

    return {
        createLoadingOverlay,
    };
}
