export function createDmCommandApplier(deps = {}) {
    const {
        traceDmPipeline,
        getMode,
        getSimulationAuthority,
        getDmAuthorityLayer,
        isLocalCombatAuthority,
        spawnTrainingDummy,
        spawnEntityByType,
        stepTurn,
        endTurn,
        rewindTurn,
        replayLastAction,
        resolveCombatActorForDm,
        possessActor,
        releasePossession,
        setActorHpById,
        applyDamageToActorById,
        getPlayerState,
        removeTrainingDummy,
        handleDmInjectedInput,
        saveSnapshot,
        getCombatTimeline,
        restoreCombatSnapshot,
        THREE,
        MODE,
        setSimulationAuthority,
        syncDmAuthorityLayerFromState,
        emitDiceRollEvent,
        addDmEvent,
    } = deps;

    function applyDmCommandFromServer(packet) {
        const command = packet && (packet.command || packet);
        if (!command || !command.type) return;

        traceDmPipeline('APPLY DM COMMAND', {
            type: String(command.type || '').toLowerCase(),
            from: packet && packet.from ? packet.from : 'unknown',
            mode: getMode(),
            authority: getSimulationAuthority(),
            layer: getDmAuthorityLayer(),
        });

        const payload = command.payload || {};
        const commandType = String(command.type).toLowerCase();

        switch (commandType) {
        case 'spawn-training-dummy': {
            if (!isLocalCombatAuthority()) return;
            const pos = payload.position || {};
            const x = Number(pos.x);
            const y = Number(pos.y);
            const z = Number(pos.z);
            const name = String(payload.name || 'Training Dummy');
            if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
            const dummy = spawnTrainingDummy(x, y, z, name);
            const actorId = String(payload.actorId || '').trim();
            if (dummy && dummy.userData && actorId) {
                dummy.userData.actorId = actorId;
                dummy.userData.networkId = actorId;
            }
            break;
        }
        case 'spawn-entity': {
            if (!isLocalCombatAuthority()) {
                console.warn('[SPAWN] spawn-entity blocked: not local combat authority');
                return;
            }
            const pos = payload.position || {};
            const x = Number(pos.x);
            const y = Number(pos.y);
            const z = Number(pos.z);
            const type = String(payload.entityType || payload.type || 'training-dummy');
            if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
                console.warn('[SPAWN] spawn-entity invalid position:', x, y, z);
                return;
            }
            console.log(`[SPAWN] Spawning ${type} at (${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)})`);
            const result = spawnEntityByType(x, y, z, type);
            const actorId = String(payload.actorId || '').trim();
            if (result && result.userData && actorId) {
                result.userData.actorId = actorId;
                result.userData.networkId = actorId;
            }
            console.log('[SPAWN] Spawn result:', result ? 'success' : 'failed');
            break;
        }
        case 'step-turn':
            if (!isLocalCombatAuthority()) return;
            stepTurn();
            break;
        case 'end-turn':
            if (!isLocalCombatAuthority()) return;
            endTurn();
            break;
        case 'rewind-turn':
            if (!isLocalCombatAuthority()) return;
            rewindTurn();
            break;
        case 'replay-last-action':
            if (!isLocalCombatAuthority()) return;
            void replayLastAction();
            break;
        case 'possess':
        case 'possess-actor': {
            if (!isLocalCombatAuthority()) return;
            const actorId = String(payload.actorId || '').trim();
            if (!actorId) return;
            const actor = resolveCombatActorForDm(actorId);
            if (!actor) return;
            possessActor(actor);
            break;
        }
        case 'release-possession':
            if (!isLocalCombatAuthority()) return;
            releasePossession();
            break;
        case 'set-hp':
            if (!isLocalCombatAuthority()) return;
            setActorHpById(payload.actorId, payload.value);
            break;
        case 'apply-damage':
            if (!isLocalCombatAuthority()) return;
            applyDamageToActorById(payload.actorId, payload.amount);
            break;
        case 'toggle-ai': {
            if (!isLocalCombatAuthority()) return;
            const actor = resolveCombatActorForDm(payload.actorId);
            const playerState = getPlayerState();
            if (!actor || actor === playerState) return;
            actor.userData.aiEnabled = payload.enabled !== false;
            break;
        }
        case 'despawn-actor': {
            if (!isLocalCombatAuthority()) return;
            const actor = resolveCombatActorForDm(payload.actorId);
            const playerState = getPlayerState();
            if (!actor || actor === playerState) return;
            removeTrainingDummy(actor);
            break;
        }
        case 'inject-input':
            if (!isLocalCombatAuthority()) return;
            handleDmInjectedInput(payload);
            break;
        case 'save-snapshot':
            if (!isLocalCombatAuthority()) return;
            saveSnapshot(String(payload.reason || 'dm-manual-snapshot'));
            break;
        case 'restore-snapshot': {
            if (!isLocalCombatAuthority()) return;
            const combatTimeline = getCombatTimeline();
            const index = Number(payload.index);
            const targetIndex = Number.isFinite(index)
                ? THREE.MathUtils.clamp(index, 0, Math.max(0, combatTimeline.length - 1))
                : Math.max(0, combatTimeline.length - 1);
            const snapshot = combatTimeline[targetIndex] || null;
            if (snapshot) restoreCombatSnapshot(snapshot, { restoreTimelineState: true, setCursor: false });
            break;
        }
        case 'set-simulation-authority': {
            if (getMode() !== MODE.DM) return;
            const authority = String(payload.authority || '').toLowerCase();
            setSimulationAuthority(authority);
            syncDmAuthorityLayerFromState();
            break;
        }
        case 'force-roll': {
            if (!isLocalCombatAuthority()) return;
            const sides = Math.max(2, Math.floor(Number(payload.sides) || 20));
            const raw = 1 + Math.floor(Math.random() * sides);
            const mod = Number(payload.mod) || 0;
            emitDiceRollEvent({
                sides,
                label: String(payload.label || 'DM FORCE ROLL'),
                raw,
                total: raw + mod,
                mod,
            });
            break;
        }
        case 'trigger-event':
            addDmEvent(String(payload.message || 'DM event triggered'), 'system');
            break;
        default:
            break;
        }
    }

    return {
        applyDmCommandFromServer,
    };
}
