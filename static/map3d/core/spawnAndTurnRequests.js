export function createSpawnAndTurnRequestService(options = {}) {
    const getMode = typeof options.getMode === 'function' ? options.getMode : () => 'player';
    const modeDm = String(options.modeDm || 'dm');
    const issueDmCommand = typeof options.issueDmCommand === 'function' ? options.issueDmCommand : () => false;
    const spawnTrainingDummy = typeof options.spawnTrainingDummy === 'function' ? options.spawnTrainingDummy : () => false;
    const consumePendingDmEncounterSetup = typeof options.consumePendingDmEncounterSetup === 'function'
        ? options.consumePendingDmEncounterSetup
        : () => {};
    const getPlayerState = typeof options.getPlayerState === 'function' ? options.getPlayerState : () => ({ position: { x: 0, y: 0, z: 0 } });
    const canIssueDmCommand = typeof options.canIssueDmCommand === 'function' ? options.canIssueDmCommand : () => false;
    const stepTurn = typeof options.stepTurn === 'function' ? options.stepTurn : () => false;
    const endTurn = typeof options.endTurn === 'function' ? options.endTurn : () => {};
    const rewindTurn = typeof options.rewindTurn === 'function' ? options.rewindTurn : () => false;
    const replayLastAction = typeof options.replayLastAction === 'function' ? options.replayLastAction : async () => false;
    const getCurrentGameMode = typeof options.getCurrentGameMode === 'function' ? options.getCurrentGameMode : () => 'free';
    const gameModeCombat = String(options.gameModeCombat || 'combat');
    const getCombatActorId = typeof options.getCombatActorId === 'function' ? options.getCombatActorId : () => null;
    const getPlayerRig = typeof options.getPlayerRig === 'function' ? options.getPlayerRig : () => null;
    const possessActor = typeof options.possessActor === 'function' ? options.possessActor : () => false;
    const releasePossession = typeof options.releasePossession === 'function' ? options.releasePossession : () => false;

    function normalizeSpawnEntityType(type) {
        const normalized = String(type || '').trim().toLowerCase();
        if (normalized === 'player-dummy' || normalized === 'player_dummy' || normalized === 'ally-dummy') {
            return 'player-dummy';
        }
        if (normalized === 'elite-dummy' || normalized === 'elite_dummy' || normalized === 'elite') {
            return 'elite-dummy';
        }
        return 'training-dummy';
    }

    function spawnEntityByType(x, y, z, type = 'training-dummy') {
        const entityType = normalizeSpawnEntityType(type);
        const definitions = {
            'training-dummy': {
                name: 'Training Dummy',
                maxHp: 50,
            },
            'player-dummy': {
                name: 'Dummy Player',
                maxHp: 42,
                faction: 'player',
            },
            'elite-dummy': {
                name: 'Elite Dummy',
                maxHp: 90,
                radius: 0.65,
            },
        };

        const config = definitions[entityType] || definitions['training-dummy'];
        console.log(`[spawnEntityByType] Type: ${entityType}, Config:`, config);
        const dummy = spawnTrainingDummy(x, y, z, config.name);
        console.log(`[spawnEntityByType] spawnTrainingDummy returned:`, dummy ? 'object' : 'null/false');
        if (!dummy || !dummy.userData) {
            console.error('[spawnEntityByType] Failed: no dummy or userData');
            return false;
        }

        dummy.userData.spawnType = entityType;
        dummy.userData.maxHp = config.maxHp;
        dummy.userData.hp = config.maxHp;
        if (Number.isFinite(config.radius)) {
            dummy.userData.radius = config.radius;
        }
        if (config.faction) {
            dummy.userData.faction = config.faction;
        }
        consumePendingDmEncounterSetup(dummy, entityType);
        console.log(`[spawnEntityByType] Successfully spawned ${entityType}:`, dummy.userData);
        return dummy;
    }

    function requestEntitySpawn(type = 'training-dummy') {
        const spawnType = normalizeSpawnEntityType(type);
        const angle = Math.random() * Math.PI * 2;
        const radius = 2.8 + (Math.random() * 1.6);
        const playerState = getPlayerState();
        const x = playerState.position.x + (Math.cos(angle) * radius);
        const y = playerState.position.y;
        const z = playerState.position.z + (Math.sin(angle) * radius);

        console.log(`[requestEntitySpawn] Type: ${type} -> ${spawnType}, Pos: (${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)})`);
        console.log(`[requestEntitySpawn] Mode: ${getMode()}, Can issue spawn: ${canIssueDmCommand('spawn-entity')}`);

        if (getMode() === modeDm) {
            console.log('[requestEntitySpawn] Using DM command path');
            const result = issueDmCommand('spawn-entity', {
                entityType: spawnType,
                position: { x, y, z },
            });
            console.log('[requestEntitySpawn] issueDmCommand returned:', result);
            return result;
        }

        console.log('[requestEntitySpawn] Using direct spawn path (not DM mode)');
        return spawnEntityByType(x, y, z, spawnType);
    }

    function requestTrainingDummySpawn(x, y, z, name = 'Training Dummy') {
        const payload = {
            position: { x, y, z },
            name,
        };

        if (getMode() === modeDm) {
            return issueDmCommand('spawn-training-dummy', payload) ? null : false;
        }

        return spawnTrainingDummy(x, y, z, name);
    }

    function requestStepTurn() {
        if (getMode() === modeDm) {
            return issueDmCommand('step-turn');
        }
        return stepTurn();
    }

    function requestEndTurn() {
        if (getCurrentGameMode() !== gameModeCombat) return false;
        if (getMode() === modeDm) {
            return issueDmCommand('end-turn');
        }
        endTurn();
        return true;
    }

    function requestRewindTurn() {
        if (getMode() === modeDm) {
            return issueDmCommand('rewind-turn');
        }
        return rewindTurn();
    }

    async function requestReplayLastAction() {
        if (getMode() === modeDm) {
            return issueDmCommand('replay-last-action');
        }
        return replayLastAction();
    }

    function requestPossessActor(actor) {
        if (!actor) return false;
        const playerState = getPlayerState();
        const playerRig = getPlayerRig();
        const resolved = actor === playerRig ? playerState : actor;
        const actorId = getCombatActorId(resolved);
        if (!actorId) return false;
        if (getMode() === modeDm) {
            return issueDmCommand('possess-actor', { actorId });
        }
        return possessActor(resolved);
    }

    function requestReleasePossession() {
        if (getMode() === modeDm) {
            return issueDmCommand('release-possession');
        }
        return releasePossession();
    }

    return {
        normalizeSpawnEntityType,
        spawnEntityByType,
        requestEntitySpawn,
        requestTrainingDummySpawn,
        requestStepTurn,
        requestEndTurn,
        requestRewindTurn,
        requestReplayLastAction,
        requestPossessActor,
        requestReleasePossession,
    };
}
