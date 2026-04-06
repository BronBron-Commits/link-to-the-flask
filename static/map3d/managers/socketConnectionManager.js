export function createSocketConnectionManager(deps) {
    const {
        windowObj,
        modeManager,
        getSocket,
        setSocket,
        getSocketModeUnsubscribe,
        setSocketModeUnsubscribe,
        netLog,
        netWarn,
        appendConsoleHistory,
        registerSocketHandlers,
        bootstrapPlayerCombatProfile,
        updateClientRuntimeModeFromAuthority,
    } = deps || {};

    const CLIENT_RESUME_STORAGE_KEY = 'map3d_resume_key_v1';

    function getNetworkRoleFromMode(mode) {
        const normalized = String(mode || '').toLowerCase();
        if (normalized === 'dm') return 'dm';
        if (normalized === 'dev') return 'dev';
        return 'player';
    }

    function registerRoleWithServer() {
        const socket = getSocket();
        if (!socket) return;
        socket.emit('register-role', {
            role: getNetworkRoleFromMode(modeManager.current),
        });
    }

    function getResumeKeyStorage() {
        try {
            if (typeof windowObj !== 'undefined' && windowObj.sessionStorage) {
                return windowObj.sessionStorage;
            }
        } catch (_err) {
            return null;
        }
        return null;
    }

    function getOrCreateClientResumeKey() {
        const fallback = `anon-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
        const storage = getResumeKeyStorage();
        try {
            const existing = String(storage?.getItem(CLIENT_RESUME_STORAGE_KEY) || '').trim();
            if (existing) return existing;
            const generated = (windowObj.crypto && typeof windowObj.crypto.randomUUID === 'function')
                ? windowObj.crypto.randomUUID()
                : fallback;
            storage?.setItem(CLIENT_RESUME_STORAGE_KEY, generated);
            try {
                // Old builds used localStorage, which is shared across tabs and caused
                // new tabs to impersonate an existing client session.
                windowObj.localStorage?.removeItem(CLIENT_RESUME_STORAGE_KEY);
            } catch (_storageCleanupErr) {
                // Best-effort cleanup only.
            }
            return generated;
        } catch (_err) {
            return fallback;
        }
    }

    async function initializeSocketConnection() {
        if (!windowObj.io || windowObj.__DISABLE_MAP3D_SOCKET__) {
            netLog('socket init skipped: window.io missing or __DISABLE_MAP3D_SOCKET__ set');
            return;
        }

        if (!modeManager.current) {
            netWarn('initializeSocketConnection called but modeManager.current is not set — this should not happen');
            return;
        }

        try {
            const buildProbe = await fetch('/server-build', {
                method: 'GET',
                headers: { Accept: 'application/json' },
            });
            if (buildProbe.ok) {
                const buildInfo = await buildProbe.json();
                console.log('[NET] server-build probe', buildInfo);
                appendConsoleHistory(`[NET] server-build ${String(buildInfo && buildInfo.build ? buildInfo.build : 'unknown')}`, 'ok');
            } else {
                console.warn('[NET] server-build probe failed:', buildProbe.status);
            }
        } catch (_buildErr) {
            console.warn('[NET] server-build probe failed: network error');
        }

        try {
            // Probe once to avoid repeated 404 reconnect spam when Socket.IO backend is unavailable.
            const probe = await fetch('/socket.io/?EIO=4&transport=polling', {
                method: 'GET',
                headers: { Accept: '*/*' },
            });
            if (!probe.ok) {
                console.info('[NET] Socket.IO endpoint unavailable; multiplayer sync disabled for this session.');
                return;
            }
            netLog(`probe OK  status=${probe.status}`);
        } catch (_err) {
            console.info('[NET] Socket.IO probe failed; multiplayer sync disabled for this session.');
            return;
        }

        // Persist/refresh resume identity for this tab (reserved for reconnect flows).
        getOrCreateClientResumeKey();

        const socket = windowObj.io(windowObj.location.origin, {
            transports: ['websocket'],
            upgrade: false,
        });
        setSocket(socket);
        windowObj.socket = socket;
        netLog('socket created, registering handlers…');
        appendConsoleHistory('[NET] transport mode: websocket-only', 'ok');
        registerSocketHandlers();

        if (getSocketModeUnsubscribe()) {
            getSocketModeUnsubscribe()();
        }
        if (typeof modeManager !== 'undefined' && modeManager && typeof modeManager.onChange === 'function') {
            setSocketModeUnsubscribe(modeManager.onChange(() => {
                registerRoleWithServer();
            }));
        }

        registerRoleWithServer();

        // Safety: Ensure role is registered even if timing is tight.
        setTimeout(() => {
            if (modeManager.current && getSocket()) {
                const currentRole = getNetworkRoleFromMode(modeManager.current);
                netLog(`Fallback role check: ${currentRole}`);
                registerRoleWithServer();
            }
        }, 250);
    }

    function requestStartGame() {
        const socket = getSocket();
        if (!socket) {
            appendConsoleHistory('Cannot start game: no server connection', 'error');
            return;
        }
        socket.emit('start-game');
    }

    return {
        getNetworkRoleFromMode,
        registerRoleWithServer,
        initializeSocketConnection,
        requestStartGame,
    };
}
