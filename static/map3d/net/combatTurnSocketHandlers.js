export function registerCombatTurnSocketHandlers(config) {
    const {
        socket,
        combatState,
        getCurrentGameMode,
        gameMode,
        dispatchCombatTurnActor,
        uxTelemetry,
        uxRecordSample,
        uxSetIntentStatus,
        updateCombatUI,
        updateDmControlPanel,
        isLocalPlayerTurnEntry,
        playerState,
        findCombatActorById,
        getEndTurnPending,
        setEndTurnPending,
        getEndTurnWatchdog,
        setEndTurnWatchdog,
        forceLeaveCombatPresentation,
    } = config || {};

    if (!socket) return;

    socket.on('combat-turn', (packet) => {
        console.log('[COMBAT-TURN] received', {
            turnIndex: packet && packet.turnIndex,
            actor: packet && packet.currentActor && packet.currentActor.id,
            type: packet && packet.currentActor && packet.currentActor.type,
            round: packet && packet.roundNumber,
        });
        if (!packet || typeof packet !== 'object') return;
        const wasEndTurnPending = getEndTurnPending();
        setEndTurnPending(false);
        if (getEndTurnWatchdog()) {
            clearTimeout(getEndTurnWatchdog());
            setEndTurnWatchdog(null);
        }
        const order = Array.isArray(packet.order) ? packet.order : [];
        const turnIndex = Math.max(0, Math.min(Number(packet.turnIndex) || 0, order.length > 0 ? order.length - 1 : 0));
        const roundNumber = Math.max(1, Number(packet.roundNumber) || 1);
        const currentActor = packet.currentActor || (order[turnIndex] ?? null);

        // Hard-overwrite local turn state with server authority — no merging.
        combatState.turnQueue = order;
        combatState.currentTurnIndex = turnIndex;
        combatState.turnIndex = turnIndex;
        combatState.roundNumber = roundNumber;
        combatState.turnOrder = order.map((entry) => {
            if (!entry) return null;
            if (entry.type === 'player') {
                return isLocalPlayerTurnEntry(entry) ? playerState : findCombatActorById(entry.id);
            }
            return findCombatActorById(entry.id)?.userData;
        }).filter(Boolean);

        if (getCurrentGameMode() === gameMode.COMBAT && currentActor) {
            dispatchCombatTurnActor(currentActor);
        }
        if (uxTelemetry.enabled && uxTelemetry.marks.endTurnSentAt > 0) {
            uxRecordSample(uxTelemetry.samples.endTurnRttMs, performance.now() - uxTelemetry.marks.endTurnSentAt);
            uxTelemetry.marks.endTurnSentAt = 0;
        }
        if (wasEndTurnPending) {
            uxSetIntentStatus('endTurn', 'resolved', 'turn-advanced');
        }
        updateCombatUI();
        updateDmControlPanel();
    });

    socket.on('combat-full-state', (packet) => {
        if (!packet || typeof packet !== 'object') return;
        const order = Array.isArray(packet.order) ? packet.order : [];
        const turn = Number(packet.turn) || 0;
        const turnIndex = order.length > 0 ? Math.max(0, Math.min(turn, order.length - 1)) : 0;
        const roundNumber = Math.max(1, Number((packet.state || {}).roundNumber) || 1);

        combatState.turnQueue = order;
        combatState.currentTurnIndex = turnIndex;
        combatState.turnIndex = turnIndex;
        combatState.roundNumber = roundNumber;
        combatState.turnOrder = order.map((entry) => {
            if (!entry) return null;
            if (entry.type === 'player') {
                return isLocalPlayerTurnEntry(entry) ? playerState : findCombatActorById(entry.id);
            }
            return findCombatActorById(entry.id)?.userData;
        }).filter(Boolean);

        updateCombatUI();
        updateDmControlPanel();
    });

    socket.on('combat-reset', () => {
        setEndTurnPending(false);
        if (getEndTurnWatchdog()) {
            clearTimeout(getEndTurnWatchdog());
            setEndTurnWatchdog(null);
        }
        uxSetIntentStatus('attack', 'idle');
        uxSetIntentStatus('move', 'idle');
        uxSetIntentStatus('endTurn', 'idle');
        forceLeaveCombatPresentation('combat-reset');
    });
}
