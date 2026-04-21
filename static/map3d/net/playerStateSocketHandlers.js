export function registerPlayerStateSocketHandlers(config) {
    const {
        socket,
        netLog,
        appendConsoleHistory,
        removePlayerAvatar,
        upsertPlayerAvatar,
        applyLiveCombatSyncFromPlayer,
        netStats,
        playerState,
        gameMode,
        getCurrentGameMode,
        combatState,
        applyPlayerMovementCapabilities,
        updatePlayerHealthHud,
    } = config || {};

    if (!socket) return;

    socket.on('player-character-stats-ack', (packet) => {
        if (!packet || typeof packet !== 'object') return;
        if (Number.isFinite(Number(packet.maxHp))) {
            playerState.maxHp = Number(packet.maxHp);
            const inCombatNow = getCurrentGameMode() === gameMode.COMBAT || combatState.inCombat;
            if (!inCombatNow || !Number.isFinite(Number(playerState.hp)) || Number(playerState.hp) > playerState.maxHp) {
                playerState.hp = playerState.maxHp;
            }
        }
        if (packet.movementCapabilities && typeof packet.movementCapabilities === 'object') {
            applyPlayerMovementCapabilities(packet.movementCapabilities);
        }
        if (window.loadedEngineEntity && typeof window.loadedEngineEntity === 'object' && packet.inventory && typeof packet.inventory === 'object') {
            window.loadedEngineEntity.inventory = structuredClone(packet.inventory);
        }
        updatePlayerHealthHud();
    });

    socket.on('players-state', (players) => {
        if (!players) return;
        const ids = Object.keys(players);
        netLog(`players-state  count=${ids.length}  ids=[${ids.join(', ')}]`);
        Object.values(players).forEach((player) => {
            if (player && player.role === 'player' && player.combatSync) {
                applyLiveCombatSyncFromPlayer(player.id, player.combatSync);
            }
            upsertPlayerAvatar(player);
        });
    });

    socket.on('player-joined', (player) => {
        netLog(`player-joined  id=${player && player.id}  role=${player && player.role}`);
        appendConsoleHistory(`[NET] player joined: ${player && player.id}`, 'ok');
        if (player && player.role === 'player' && player.combatSync) {
            applyLiveCombatSyncFromPlayer(player.id, player.combatSync);
        }
        upsertPlayerAvatar(player);
    });

    socket.on('player-update', (player) => {
        netStats.playerUpdatesIn += 1;
        if (netStats.playerUpdatesIn % 120 === 0) {
            // Log every 120th update (~once every 8 s at 15 Hz) to avoid console spam.
            netLog(`player-update  id=${player && player.id}  in#=${netStats.playerUpdatesIn}`);
        }
        if (player && player.role === 'player' && player.combatSync) {
            applyLiveCombatSyncFromPlayer(player.id, player.combatSync);
        }
        upsertPlayerAvatar(player);
    });

    socket.on('player-left', (data) => {
        netLog(`player-left  id=${data && data.id}`);
        if (data && data.id) {
            appendConsoleHistory(`[NET] player left: ${data.id}`, 'ok');
            removePlayerAvatar(data.id);
        }
    });
}
