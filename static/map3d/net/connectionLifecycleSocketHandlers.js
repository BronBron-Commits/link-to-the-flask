export function registerConnectionLifecycleSocketHandlers(config) {
    const {
        socket,
        modeManager,
        netLog,
        appendConsoleHistory,
        registerRoleWithServer,
        bootstrapPlayerCombatProfile,
        updateClientRuntimeModeFromAuthority,
        purgeLocalEchoAvatars,
        setLocalPlayerId,
        getLocalPlayerId,
        netWarn,
        incrementDisconnectCount,
    } = config || {};

    if (!socket) return;

    socket.on('connect', () => {
        // socket.id is the canonical local identity for this client connection.
        setLocalPlayerId(socket.id || getLocalPlayerId());
        netLog(`connected  sid=${socket.id}  mode=${modeManager.current}  transport=${socket.io?.engine?.transport?.name ?? '?'}`);
        appendConsoleHistory(`[NET] connected as ${modeManager.current} (${socket.id})`, 'ok');
        // CRITICAL: Always push selected role on connect/reconnect so server lobby slots stay consistent.
        registerRoleWithServer();
        // Ensure role registration happens even in tight timing scenarios
        setTimeout(() => {
            if (modeManager.current && socket) {
                registerRoleWithServer();
            }
        }, 100);
        void bootstrapPlayerCombatProfile(true);
        updateClientRuntimeModeFromAuthority();
        purgeLocalEchoAvatars();
    });

    socket.on('connect_error', (err) => {
        netWarn('connect_error', err && err.message ? err.message : err);
        appendConsoleHistory(`[NET] connection error: ${err && err.message ? err.message : String(err)}`, 'error');
        if (socket && socket.disconnected) {
            try {
                socket.connect();
            } catch (_reconnectErr) {
                // Socket.IO already handles internal backoff; this is best-effort nudging.
            }
        }
    });

    socket.on('disconnect', (reason) => {
        const total = incrementDisconnectCount();
        netWarn(`disconnected  reason=${reason}  total=${total}`);
        appendConsoleHistory(`[NET] disconnected: ${reason}`, 'error');
    });

    socket.on('reconnect_attempt', (attempt) => {
        netLog(`reconnect attempt #${attempt}`);
    });

    socket.on('player-id', (data) => {
        if (data && data.id) {
            if (socket && socket.id && socket.id !== data.id) {
                netWarn(`player-id mismatch: socket.id=${socket.id} serverId=${data.id}`);
            }
            setLocalPlayerId(data.id);
            netLog(`assigned player-id=${data.id}`);
            updateClientRuntimeModeFromAuthority();
            purgeLocalEchoAvatars();
        }
    });
}
