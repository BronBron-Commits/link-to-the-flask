export function createCombatRenderTransitionAdapter(deps) {
    const requiredFns = [
        'getCurrentGameMode',
        'setCurrentGameMode',
        'resolveCombatActorIdForPlayerSid',
        'setCombatPhase',
        'setCombatLock',
        'findCombatActorById',
        'ensureCombatEnvironmentPresentation',
        'syncCombatMusicToGameMode',
        'forceLeaveCombatPresentation',
        'computeCombatWorldTruth',
        'updateSceneVisibilityForCombatState',
        'syncSkyboxWithGameMode',
        'updateActionMenu',
        'updateLobbyOverlayFromState',
        'getCombatInitiatorSid',
        'setCombatInitiatorSid',
        'setCombatInitiatorActorId',
    ];
    for (const key of requiredFns) {
        if (typeof deps[key] !== 'function') {
            throw new Error(`createCombatRenderTransitionAdapter missing dependency: ${key}`);
        }
    }
    if (!deps.combatState || typeof deps.combatState !== 'object') {
        throw new Error('createCombatRenderTransitionAdapter missing dependency: combatState object');
    }
    if (!deps.combatDomainAction || typeof deps.combatDomainAction !== 'object') {
        throw new Error('createCombatRenderTransitionAdapter missing dependency: combatDomainAction');
    }
    if (!deps.gameMode || typeof deps.gameMode !== 'object') {
        throw new Error('createCombatRenderTransitionAdapter missing dependency: gameMode');
    }

    return function applyCombatDomainTransition(prevState, nextState, action) {
        const isCombatPacket = !!(action && action.type === deps.combatDomainAction.COMBAT_PACKET);
        deps.combatState.inCombat = !!nextState.inCombat;

        if (nextState.inCombat) {
            const nextInitiatorSid = nextState.initiatorSid || deps.getCombatInitiatorSid();
            deps.setCombatInitiatorSid(nextInitiatorSid);
            if (nextInitiatorSid) {
                const resolvedInitiatorActorId = deps.resolveCombatActorIdForPlayerSid(nextInitiatorSid);
                if (resolvedInitiatorActorId) {
                    deps.setCombatInitiatorActorId(resolvedInitiatorActorId);
                }
            }
            if (deps.getCurrentGameMode() !== deps.gameMode.COMBAT) {
                deps.setCurrentGameMode(deps.gameMode.COMBAT);
                deps.setCombatPhase('PLAYER');
                deps.setCombatLock(false);
            }
            const targetId = String(nextState.targetId || '').trim();
            const targetActor = targetId ? deps.findCombatActorById(targetId) : null;
            deps.ensureCombatEnvironmentPresentation({ targetActor });
            deps.syncCombatMusicToGameMode();
        } else if (prevState.inCombat || deps.getCurrentGameMode() === deps.gameMode.COMBAT) {
            const worldTruth = action && action.type === deps.combatDomainAction.WORLD_SNAPSHOT
                ? deps.computeCombatWorldTruth(action.payload || {}, prevState.inCombat)
                : null;
            const explicitWorldExit = worldTruth && worldTruth.modeFromWorld === deps.gameMode.FREE;
            const allowExit = (action && action.type === deps.combatDomainAction.COMBAT_PACKET) || explicitWorldExit;
            if (allowExit) {
                deps.forceLeaveCombatPresentation((action && action.type === deps.combatDomainAction.WORLD_SNAPSHOT) ? 'world-sync' : 'combat-state');
            }
        }

        deps.updateSceneVisibilityForCombatState(!!nextState.inCombat);
        if (isCombatPacket) {
            deps.syncSkyboxWithGameMode();
            deps.updateActionMenu();
            deps.updateLobbyOverlayFromState();
        }
    };
}
