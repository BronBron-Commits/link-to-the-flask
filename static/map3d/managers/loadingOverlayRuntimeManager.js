export function createLoadingOverlayRuntimeManager(deps = {}) {
    const {
        performanceObj = performance,
        windowObj = window,
        getLoadingOverlayFinished = () => false,
        getLoadingOverlayCloseScheduled = () => false,
        getProgressFill = () => null,
        getProgressText = () => null,
        getStatusEl = () => null,
        getLoadingProgressValue = () => 0,
        setLoadingProgressValue = () => {},
        getLoadingProgressTarget = () => 0,
        setLoadingProgressTarget = () => {},
        getLoadingProgressAnimFrame = () => null,
        setLoadingProgressAnimFrame = () => {},
        getLoadingStatusQueue = () => [],
        getLoadingStatusTimer = () => null,
        setLoadingStatusTimer = () => {},
        getLoadingStatusLastShownAt = () => 0,
        setLoadingStatusLastShownAt = () => {},
        loadingStatusMinIntervalMs = 180,
        spawnLoadingMessageBurst = () => {},
    } = deps;

    function clamp01(value) {
        return Math.max(0, Math.min(1, value));
    }

    function renderLoadingProgress(value) {
        const progressFill = getProgressFill();
        const progressText = getProgressText();
        if (!progressFill || !progressText) return;
        const percent = value * 100;
        progressFill.style.width = `${percent.toFixed(2)}%`;
        const pulse = 1 + (Math.sin((performanceObj.now() * 0.013) + (percent * 0.05)) * 0.04);
        progressFill.style.transform = `scaleY(${pulse.toFixed(3)})`;
        progressText.textContent = `${percent.toFixed(1)}%`;
    }

    function animateLoadingProgressFrame() {
        setLoadingProgressAnimFrame(null);
        if (!getProgressFill() || !getProgressText() || getLoadingOverlayFinished()) return;

        const delta = getLoadingProgressTarget() - getLoadingProgressValue();
        if (Math.abs(delta) < 0.0005) {
            setLoadingProgressValue(getLoadingProgressTarget());
            renderLoadingProgress(getLoadingProgressValue());
            return;
        }

        setLoadingProgressValue(clamp01(getLoadingProgressValue() + (delta * 0.12)));
        renderLoadingProgress(getLoadingProgressValue());
        setLoadingProgressAnimFrame(windowObj.requestAnimationFrame(animateLoadingProgressFrame));
    }

    function ensureLoadingProgressAnimation() {
        if (getLoadingProgressAnimFrame() !== null) return;
        setLoadingProgressAnimFrame(windowObj.requestAnimationFrame(animateLoadingProgressFrame));
    }

    function setLoadingProgress(value) {
        setLoadingProgressTarget(clamp01(value));
        if (!getProgressFill() || !getProgressText() || getLoadingOverlayFinished()) return;
        ensureLoadingProgressAnimation();
    }

    function setLoadingOverlayStatus(text) {
        const statusEl = getStatusEl();
        if (!statusEl || getLoadingOverlayFinished()) return;
        const next = String(text || '').trim();
        if (!next) return;

        const statusQueue = getLoadingStatusQueue();
        statusQueue.length = 0;
        statusQueue.push(next);

        const pump = () => {
            const liveStatusEl = getStatusEl();
            if (getLoadingOverlayFinished() || !liveStatusEl) {
                setLoadingStatusTimer(null);
                return;
            }
            const queue = getLoadingStatusQueue();
            if (queue.length === 0) {
                setLoadingStatusTimer(null);
                return;
            }

            const now = performanceObj.now();
            const sinceLast = now - getLoadingStatusLastShownAt();
            if (sinceLast < loadingStatusMinIntervalMs) {
                setLoadingStatusTimer(windowObj.setTimeout(pump, loadingStatusMinIntervalMs - sinceLast));
                return;
            }

            const message = queue.shift();
            liveStatusEl.textContent = message;
            setLoadingStatusLastShownAt(performanceObj.now());

            liveStatusEl.style.animation = 'none';
            void liveStatusEl.offsetWidth;
            liveStatusEl.style.animation = 'loading-status-pop 520ms cubic-bezier(0.18, 0.88, 0.23, 1)';
            spawnLoadingMessageBurst(10);

            const jitterDelay = 40 + Math.round(Math.random() * 90);
            setLoadingStatusTimer(windowObj.setTimeout(pump, jitterDelay));
        };

        if (!getLoadingStatusTimer()) {
            const randomDelay = 70 + Math.round(Math.random() * 150);
            setLoadingStatusTimer(windowObj.setTimeout(pump, randomDelay));
        }
    }

    function updateLoadingState(statusText, progressValue) {
        if (getLoadingOverlayCloseScheduled() || getLoadingOverlayFinished()) return;
        if (typeof progressValue === 'number') {
            setLoadingProgress(progressValue);
        }
        setLoadingOverlayStatus(statusText);
    }

    function formatLoadingLogArgs(args) {
        return args.map((arg) => {
            if (typeof arg === 'string') return arg;
            if (arg instanceof Error) return arg.stack || arg.message;
            try {
                return JSON.stringify(arg);
            } catch (_err) {
                return String(arg);
            }
        }).join(' ');
    }

    function appendLoadingLog(level, args) {
        void level;
        void args;
    }

    function setLoadingOverlayQuote(text) {
        if (getLoadingOverlayFinished()) return;
        const next = String(text || '').trim();
        if (!next) return;
        setLoadingOverlayStatus(next);
    }

    return {
        clamp01,
        renderLoadingProgress,
        animateLoadingProgressFrame,
        ensureLoadingProgressAnimation,
        setLoadingProgress,
        updateLoadingState,
        formatLoadingLogArgs,
        appendLoadingLog,
        setLoadingOverlayStatus,
        setLoadingOverlayQuote,
    };
}
