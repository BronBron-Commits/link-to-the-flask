import { createCombatActionResultProcessor } from '/static/map3d/core/combatActionResultProcessor.js';

export function registerCombatAndSessionSocketHandlers(config) {
    const {
        socket,
        getEndTurnPending,
        setEndTurnPending,
        getEndTurnWatchdog,
        setEndTurnWatchdog,
        uxSetIntentStatus,
        showFloatingText,
        logCombatEvent,
        showCombatOutcomeOverlay,
        combatInteraction,
        setCombatUiPhase,
        combatUiPhase,
        resetCombatInteraction,
        updateActionMenu,
        uxTelemetry,
        uxRecordSample,
        playerState,
        gameMode,
        getCurrentGameMode,
        getLocalCombatActorId,
        syncPlayerRigFromState,
        combatState,
        getPlayerBaseSpeedFt,
        tryUseAction,
        tryMove,
        syncTurnExhaustionState,
        playerRig,
        cancelAction,
        updateCombatUI,
        getSocket,
        getLocalPlayerId,
        getConnectedCombatPlayerEntries,
        getCombatActorLabelById,
        applyPlayerDamage,
        findCombatActorById,
        spawnVisualDice,
        triggerEnemyFlinch,
        spawnImpactBurst,
        playCombatSfxCue,
        updatePlayerHealthHud,
        appendConsoleHistory,
        triggerSharedDiceRoll,
        netLog,
        showRuntimeModeSelectionOverlay,
        closeModeSelectionOverlay,
        getSessionGameState,
        setSessionGameState,
        getAuthoritativePlayerId,
        setAuthoritativePlayerId,
        updateClientRuntimeModeFromAuthority,
        updateLobbyOverlayFromState,
        setLobbyState,
    } = config || {};

    if (!socket) return;

    const combatActionResultProcessor = createCombatActionResultProcessor({
        combatInteraction,
        setCombatUiPhase,
        combatUiPhase,
        resetCombatInteraction,
        showFloatingText,
        updateActionMenu,
        uxTelemetry,
        uxRecordSample,
        playerState,
        getLocalCombatActorId,
        syncPlayerRigFromState,
        combatState,
        getPlayerBaseSpeedFt,
        tryUseAction,
        tryMove,
        syncTurnExhaustionState,
        playerRig,
        logCombatEvent,
        uxSetIntentStatus,
        cancelAction,
        updateCombatUI,
        getSocket,
        getLocalPlayerId,
        getConnectedCombatPlayerEntries,
        getCombatActorLabelById,
        applyPlayerDamage,
        findCombatActorById,
        spawnVisualDice,
        triggerEnemyFlinch,
        spawnImpactBurst,
        playCombatSfxCue,
        updatePlayerHealthHud,
    });

    socket.on('combat-ended', (packet) => {
        if (!packet || typeof packet !== 'object') return;
        setEndTurnPending(false);
        if (getEndTurnWatchdog()) {
            clearTimeout(getEndTurnWatchdog());
            setEndTurnWatchdog(null);
        }
        uxSetIntentStatus('attack', 'idle');
        uxSetIntentStatus('move', 'idle');
        uxSetIntentStatus('endTurn', 'idle');

        const result = String(packet.result || '').trim();
        const rounds = Math.max(1, Number(packet.rounds) || 1);
        console.info('[COMBAT] combat-ended received', { result, rounds, packet });

        if (result === 'players_defeated') {
            showFloatingText('YOU HAVE FALLEN', '#ff2d2d', true);
            logCombatEvent(`Combat lost after ${rounds} round${rounds === 1 ? '' : 's'}`, 'miss');
        } else if (result === 'players_victorious') {
            showFloatingText('ENEMIES DEFEATED', '#8dd694', true);
            logCombatEvent(`Combat won in ${rounds} round${rounds === 1 ? '' : 's'}`, 'hit');
        }

        showCombatOutcomeOverlay(packet);
    });

    socket.on('end-turn-denied', (packet) => {
        setEndTurnPending(false);
        if (getEndTurnWatchdog()) {
            clearTimeout(getEndTurnWatchdog());
            setEndTurnWatchdog(null);
        }
        const reason = String((packet && packet.reason) || 'unknown');
        console.warn('[COMBAT] end-turn denied by server:', reason);
        uxSetIntentStatus('endTurn', 'failed', 'denied');
    });

    socket.on('combat-error', (packet) => {
        setEndTurnPending(false);
        if (getEndTurnWatchdog()) {
            clearTimeout(getEndTurnWatchdog());
            setEndTurnWatchdog(null);
        }
        const reason = String((packet && packet.reason) || 'unknown');
        console.warn('[COMBAT] combat-error from server:', reason, packet);
        uxSetIntentStatus('attack', 'failed', 'error');
        uxSetIntentStatus('move', 'failed', 'error');
        uxSetIntentStatus('endTurn', 'failed', 'error');
    });

    socket.on('end-turn-accepted', (packet) => {
        const reason = String((packet && packet.reason) || 'received');
        console.log('[COMBAT] end-turn accepted by server:', reason);
        uxSetIntentStatus('endTurn', 'acked', 'accepted');
    });

    socket.on('combat-action-preview', combatActionResultProcessor.handleCombatActionPreview);

    socket.on('combat-preview-denied', combatActionResultProcessor.handleCombatPreviewDenied);

    socket.on('combat-action-preview', combatActionResultProcessor.handleCombatActionPreview);

    socket.on('combat-preview-denied', combatActionResultProcessor.handleCombatPreviewDenied);

    socket.on('combat-action-result', combatActionResultProcessor.handleCombatActionResult);

    socket.on('inventory-updated', (packet) => {
        if (!packet || typeof packet !== 'object') return;
        const packetSid = String(packet.sid || '').trim();
        const socketSid = String((getSocket() && getSocket().id) || '').trim();
        const localSid = String(getLocalPlayerId() || '').trim();
        const appliesToLocal = !!packetSid && (packetSid === socketSid || packetSid === localSid);
        if (!appliesToLocal) return;

        if (!window.loadedEngineEntity || typeof window.loadedEngineEntity !== 'object') return;
        if (packet.inventory && typeof packet.inventory === 'object') {
            window.loadedEngineEntity.inventory = structuredClone(packet.inventory);
        }
        if (packet.equippedWeapon && typeof packet.equippedWeapon === 'object') {
            window.loadedEngineEntity.combat = window.loadedEngineEntity.combat || {};
            window.loadedEngineEntity.combat.weapon = structuredClone(packet.equippedWeapon);
        }
    });

    socket.on('inventory-error', (packet) => {
        const reason = String((packet && packet.reason) || 'unknown');
        appendConsoleHistory(`[INV] inventory action denied: ${reason}`, 'error');
    });

    socket.on('combat-turn-sync-denied', () => {
        // Server is authoritative — sync attempts are silently ignored; incoming combat-turn drives state.
        console.warn('[COMBAT] combat-turn-sync rejected: server-authoritative mode active');
    });

    socket.on('dice-roll-event', (packet) => {
        const roll = packet && packet.roll ? packet.roll : null;
        if (!roll) return;
        triggerSharedDiceRoll(roll, { broadcast: false });
    });

    socket.on('role-ack', (info) => {
        if (!info || !info.role) return;
        netLog(`role-ack  id=${info.id}  role=${info.role}`);
        if (info.accepted === false) {
            const reason = String(info.reason || 'denied');
            appendConsoleHistory(`Lobby slot denied for ${String(info.requestedRole || '?')}: ${reason}`, 'error');
            showRuntimeModeSelectionOverlay();
            return;
        }
        appendConsoleHistory(`Network role: ${String(info.role)}`, 'ok');
    });

    socket.on('start-game-ack', (payload) => {
        if (!payload || typeof payload !== 'object') return;
        if (payload.ok) {
            appendConsoleHistory('Session started: roles locked', 'ok');
            if (payload.state && typeof payload.state === 'object') {
                setSessionGameState(String(payload.state.gameState || getSessionGameState() || 'in_game'));
                setAuthoritativePlayerId(String(payload.state.authoritativePlayerId || getAuthoritativePlayerId() || ''));
                updateClientRuntimeModeFromAuthority();
            }
            closeModeSelectionOverlay();
            return;
        }
        const denyReason = String(payload.reason || 'unknown');
        if (denyReason === 'already-started') {
            setSessionGameState('in_game');
            updateLobbyOverlayFromState();
        }
        appendConsoleHistory(`Start game denied: ${denyReason}`, 'error');
    });

    socket.on('session-state', (payload) => {
        if (!payload || typeof payload !== 'object') return;
        setSessionGameState(String(payload.gameState || getSessionGameState() || 'lobby'));
        setAuthoritativePlayerId(String(payload.authoritativePlayerId || getAuthoritativePlayerId() || ''));
        updateClientRuntimeModeFromAuthority();
        updateLobbyOverlayFromState();
    });

    socket.on('lobby-state', (payload) => {
        if (!payload || typeof payload !== 'object') return;
        setLobbyState(payload);
        if (typeof payload.authoritativePlayerId === 'string') {
            setAuthoritativePlayerId(payload.authoritativePlayerId);
            updateClientRuntimeModeFromAuthority();
        }
        updateLobbyOverlayFromState();
    });
}
