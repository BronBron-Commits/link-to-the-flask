export function createLoadingMusicManager(deps = {}) {
    const {
        audioCtor = Audio,
        getMainThemeAudio = () => null,
        setMainThemeAudio = () => {},
        getDocksMusicAudio = () => null,
        setDocksMusicAudio = () => {},
    } = deps;

    function startMainTheme() {
        try {
            if (!getMainThemeAudio()) {
                const audio = new audioCtor('/static/maintheme.wav');
                audio.loop = false;
                audio.volume = 0;
                audio.preload = 'auto';
                audio.addEventListener('ended', () => {
                    startDocksTheme();
                }, { once: true });
                setMainThemeAudio(audio);
            }
            const mainThemeAudio = getMainThemeAudio();
            const playPromise = mainThemeAudio.play();
            if (playPromise && typeof playPromise.then === 'function') {
                playPromise.then(() => {
                    const targetVol = 0.45;
                    const steps = 30;
                    const stepMs = 60;
                    let step = 0;
                    const fadeIn = setInterval(() => {
                        step += 1;
                        mainThemeAudio.volume = Math.min(targetVol, (step / steps) * targetVol);
                        if (step >= steps) clearInterval(fadeIn);
                    }, stepMs);
                }).catch(() => {
                    // Autoplay blocked — will play on next user gesture.
                });
            }
        } catch (_err) {
            // Ignore audio errors.
        }
    }

    function startDocksTheme() {
        try {
            if (!getDocksMusicAudio()) {
                const audio = new audioCtor('/static/docks.wav');
                audio.loop = true;
                audio.volume = 0;
                audio.preload = 'auto';
                setDocksMusicAudio(audio);
            }
            const docksMusicAudio = getDocksMusicAudio();
            const playPromise = docksMusicAudio.play();
            if (playPromise && typeof playPromise.then === 'function') {
                playPromise.then(() => {
                    const targetVol = 0.45;
                    const steps = 30;
                    const stepMs = 60;
                    let step = 0;
                    const fadeIn = setInterval(() => {
                        step += 1;
                        docksMusicAudio.volume = Math.min(targetVol, (step / steps) * targetVol);
                        if (step >= steps) clearInterval(fadeIn);
                    }, stepMs);
                }).catch(() => {
                    // Autoplay blocked.
                });
            }
        } catch (_err) {
            // Ignore audio errors.
        }
    }

    function stopDocksTheme() {
        const docksMusicAudio = getDocksMusicAudio();
        if (!docksMusicAudio) return;
        try {
            const steps = 30;
            const stepMs = 50;
            const startVol = docksMusicAudio.volume;
            let step = 0;
            const fadeOut = setInterval(() => {
                step += 1;
                docksMusicAudio.volume = Math.max(0, startVol * (1 - step / steps));
                if (step >= steps) {
                    clearInterval(fadeOut);
                    docksMusicAudio.pause();
                    docksMusicAudio.currentTime = 0;
                    docksMusicAudio.volume = 0;
                }
            }, stepMs);
        } catch (_err) {
            // Ignore audio errors.
        }
    }

    function stopMainTheme() {
        const mainThemeAudio = getMainThemeAudio();
        if (!mainThemeAudio) return;
        try {
            const steps = 30;
            const stepMs = 50;
            const startVol = mainThemeAudio.volume;
            let step = 0;
            const fadeOut = setInterval(() => {
                step += 1;
                mainThemeAudio.volume = Math.max(0, startVol * (1 - step / steps));
                if (step >= steps) {
                    clearInterval(fadeOut);
                    mainThemeAudio.pause();
                    mainThemeAudio.currentTime = 0;
                    mainThemeAudio.volume = 0;
                }
            }, stepMs);
        } catch (_err) {
            // Ignore audio errors.
        }
    }

    return {
        startMainTheme,
        startDocksTheme,
        stopDocksTheme,
        stopMainTheme,
    };
}
