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

    socket.on('combat-action-preview', (packet) => {
        if (!packet || typeof packet !== 'object') return;
        const requestId = String(packet.requestId || '').trim();
        const expectedRequestId = String(combatInteraction.previewRequestId || '').trim();
        if (!requestId || !expectedRequestId || requestId !== expectedRequestId) return;
        if (String(combatInteraction.action || '') !== 'attack') return;

        const preview = packet.preview && typeof packet.preview === 'object' ? packet.preview : null;
        if (!preview) {
            setCombatUiPhase(combatUiPhase.IDLE);
            resetCombatInteraction();
            showFloatingText('Attack preview unavailable', '#ff8a8a', true);
            updateActionMenu();
            return;
        }

        combatInteraction.preview = {
            source: 'server',
            requestId,
            attackBonus: Number(preview.attackBonus) || 0,
            targetAC: Number(preview.targetAC) || 0,
            hitChance: Number(preview.hitChance) || 0,
            hitChancePct: Number(preview.hitChancePct) || 0,
            damageMin: Number(preview.damageMin) || 0,
            damageMax: Number(preview.damageMax) || 0,
            weapon: preview.weapon && typeof preview.weapon === 'object' ? preview.weapon : null,
            valid: true,
        };
        combatInteraction.awaitingConfirm = true;
        setCombatUiPhase(combatUiPhase.CONFIRM_READY, { action: 'attack', requestId });

        if (uxTelemetry.enabled && uxTelemetry.marks.confirmUiStartAt > 0) {
            uxRecordSample(uxTelemetry.samples.confirmUiMs, performance.now() - uxTelemetry.marks.confirmUiStartAt);
            uxTelemetry.marks.confirmUiStartAt = 0;
        }
        updateActionMenu();
    });

    socket.on('combat-preview-denied', (packet) => {
        if (!packet || typeof packet !== 'object') return;
        const requestId = String(packet.requestId || '').trim();
        const expectedRequestId = String(combatInteraction.previewRequestId || '').trim();
        if (requestId && expectedRequestId && requestId !== expectedRequestId) return;

        const reason = String(packet.reason || 'preview-denied');
        showFloatingText(`Preview denied: ${reason}`, '#ff8a8a', true);
        resetCombatInteraction();
        updateActionMenu();
    });

    socket.on('combat-action-result', (packet) => {
        if (!packet || typeof packet !== 'object') return;
        const attacker = String(packet.attacker || 'Unknown');
        const actorType = String(packet.actorType || 'unknown');
        const actionType = String(packet.type || '').trim().toLowerCase();
        const isHit = Boolean(packet.hit);
        const damage = Number(packet.damage) || 0;
        const targetId = String(packet.targetId || '');
        const targetState = String(packet.targetState || '').trim().toLowerCase();
        const targetHp = Number(packet.targetHp);
        const hasAuthoritativeTargetHp = Number.isFinite(targetHp);
        const hitRoll = Number(packet.hitRoll) || 0;
        const toHit = Number(packet.toHit) || 0;
        const targetAC = Number(packet.targetAC) || 0;
        const localActorId = String(getLocalCombatActorId() || '').trim();
        const isLocalPlayerActor = !!localActorId && String(attacker || '').trim() === localActorId;

        if (actorType === 'player' && isLocalPlayerActor && actionType && actionType !== 'attack') {
            if (uxTelemetry.enabled && uxTelemetry.marks.moveSentAt > 0) {
                uxRecordSample(uxTelemetry.samples.moveRttMs, performance.now() - uxTelemetry.marks.moveSentAt);
                uxTelemetry.marks.moveSentAt = 0;
            }
            if (actionType === 'move' || actionType === 'dash' || actionType === 'disengage') {
                const after = packet.positionAfter && typeof packet.positionAfter === 'object' ? packet.positionAfter : null;
                const movementFt = Math.max(0, Number(packet.movementFt) || 0);
                if (after) {
                    playerState.prevPosition.copy(playerState.position);
                    playerState.position.set(Number(after.x) || 0, Number(after.y) || playerState.position.y, Number(after.z) || 0);
                    syncPlayerRigFromState();
                }
                if (actionType === 'dash') {
                    combatState.player.movementRemaining = Math.max(
                        Number(combatState.player.movementRemaining) || 0,
                        Number(packet.movementBudgetFt) || getPlayerBaseSpeedFt() * 2
                    );
                    tryUseAction();
                } else if (actionType === 'disengage') {
                    tryUseAction();
                }
                if (movementFt > 0) {
                    tryMove(movementFt);
                }
                syncTurnExhaustionState();
                const verb = actionType === 'dash' ? 'Dash' : (actionType === 'disengage' ? 'Disengage' : 'Move');
                showFloatingText(`${verb} ${Math.round(movementFt)} ft`, '#8dd694', true, { anchorObject: playerRig });
                logCombatEvent(`${verb} ${Math.round(movementFt)} ft`, 'system');
                uxSetIntentStatus('move', 'resolved', actionType);
            } else if (actionType === 'dodge') {
                tryUseAction();
                showFloatingText('DODGE ACTIVE', '#8dd694', true, { anchorObject: playerRig });
                logCombatEvent('You take the Dodge action', 'system');
                uxSetIntentStatus('move', 'resolved', 'dodge');
            } else if (actionType === 'use-object') {
                tryUseAction();
                if (Number.isFinite(Number(packet.hpAfter))) {
                    playerState.hp = Number(packet.hpAfter);
                    updatePlayerHealthHud();
                }
                const healed = Math.max(0, Number(packet.healed) || 0);
                const itemLabel = String(packet.itemId || 'item').replace(/_/g, ' ');
                showFloatingText(`Use Item +${Math.round(healed)} HP`, '#8dd694', true, { anchorObject: playerRig });
                logCombatEvent(`Use Item: ${itemLabel} restores ${Math.round(healed)} HP`, 'system');
            }
            cancelAction();
            updateActionMenu();
            updateCombatUI();
            return;
        }

        if (actorType === 'enemy') {
            const atkBonus = Number(packet.attackBonus) || 0;
            const rollDetail = `(${hitRoll}+${atkBonus}=${toHit} vs AC ${targetAC})`;
            const socketSid = String((getSocket() && getSocket().id) || '').trim();
            const localSid = String(getLocalPlayerId() || '').trim();
            const normalizedTargetId = targetId.trim();
            const targetIsLocal = !!(normalizedTargetId && (
                normalizedTargetId === localActorId ||
                normalizedTargetId === socketSid ||
                normalizedTargetId === localSid
            ));
            const connectedPlayers = getConnectedCombatPlayerEntries();
            const isSoloCombat = connectedPlayers.length <= 1;
            const shouldApplyLocalDamage = isHit && damage > 0 && (targetIsLocal || (!normalizedTargetId && isSoloCombat));
            const targetLabel = targetIsLocal
                ? 'you'
                : (normalizedTargetId ? (getCombatActorLabelById(normalizedTargetId) || normalizedTargetId) : 'target');
            const logText = isHit
                ? `${attacker} hits ${targetLabel} for ${damage} dmg ${rollDetail}`
                : `${attacker} miss ${rollDetail}`;
            const floatText = isHit
                ? `${attacker} hits ${targetLabel} — ${damage} DMG`
                : `${attacker} miss`;
            logCombatEvent(logText, isHit ? 'hit' : 'miss');
            showFloatingText(floatText, isHit ? '#ff8a8a' : '#8dd694', true);
            if (packet.dodgeDisadvantage) {
                logCombatEvent(`${attacker} attacks with disadvantage`, 'system');
            }
            if (targetIsLocal && hasAuthoritativeTargetHp) {
                playerState.hp = Math.max(0, targetHp);
                updatePlayerHealthHud();
                if (targetState === 'downed' || playerState.hp <= 0) {
                    showFloatingText('YOU ARE DOWN', '#ff2d2d');
                }
            } else if (shouldApplyLocalDamage) {
                applyPlayerDamage(damage, attacker);
            }
            return;
        }

        if (actorType === 'player') {
            if (!isLocalPlayerActor) {
                return;
            }
            if (uxTelemetry.enabled && uxTelemetry.marks.attackSentAt > 0) {
                uxRecordSample(uxTelemetry.samples.attackRttMs, performance.now() - uxTelemetry.marks.attackSentAt);
                uxTelemetry.marks.attackSentAt = 0;
            }
            uxSetIntentStatus('attack', 'resolved', isHit ? 'hit' : 'miss');
            tryUseAction();
            const atkBonus = Number(packet.attackBonus) || 0;
            const rollDetail = `(${hitRoll}+${atkBonus}=${toHit} vs AC ${targetAC})`;
            const targetLabel = targetId ? (getCombatActorLabelById(targetId) || targetId) : 'target';
            const logText = isHit
                ? `${attacker} hits ${targetLabel} for ${damage} dmg ${rollDetail}`
                : `${attacker} miss ${rollDetail}`;
            logCombatEvent(logText, isHit ? 'hit' : 'miss');

            const targetActor = targetId ? findCombatActorById(targetId) : null;
            if (targetActor && targetActor.position) {
                if (targetActor.userData && hasAuthoritativeTargetHp) {
                    targetActor.userData.hp = Math.max(0, targetHp);
                    if (targetState === 'downed') {
                        targetActor.userData.state = 'downed';
                    }
                }
                const rollLabel = 'ATTACK ROLL';
                spawnVisualDice(Math.max(1, hitRoll), 20, targetActor, rollLabel);
                if (isHit) {
                    showFloatingText(`-${damage}`, '#ff6b6b', true, { anchorObject: targetActor });
                    triggerEnemyFlinch(targetActor);
                    spawnImpactBurst(targetActor.position, 0x00ff66, 20);
                    playCombatSfxCue('melee-hit');
                    if (targetState === 'downed' || (hasAuthoritativeTargetHp && targetHp <= 0)) {
                        showFloatingText(`${(targetActor.userData?.name || 'Target').toUpperCase()} DOWN`, '#ff2d2d', true, { anchorObject: targetActor });
                    }
                } else {
                    showFloatingText('MISS', '#ff8a8a', true, { anchorObject: targetActor });
                    playCombatSfxCue('miss');
                }
            }

            // Keep local turn UI in sync after server-authoritative attack results.
            cancelAction();
            syncTurnExhaustionState();
            updateActionMenu();
            updateCombatUI();
            return;
        }
    });

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
