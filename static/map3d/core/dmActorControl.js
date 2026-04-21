export function createDmActorControlService(options = {}) {
    const getLocalCombatActorId = typeof options.getLocalCombatActorId === 'function'
        ? options.getLocalCombatActorId
        : () => '';
    const getPlayerState = typeof options.getPlayerState === 'function'
        ? options.getPlayerState
        : () => ({ hp: 0, maxHp: 0 });
    const findCombatActorById = typeof options.findCombatActorById === 'function'
        ? options.findCombatActorById
        : () => null;
    const updatePlayerHealthHud = typeof options.updatePlayerHealthHud === 'function'
        ? options.updatePlayerHealthHud
        : () => {};
    const removeTrainingDummy = typeof options.removeTrainingDummy === 'function'
        ? options.removeTrainingDummy
        : () => {};
    const getSelectedCombatTarget = typeof options.getSelectedCombatTarget === 'function'
        ? options.getSelectedCombatTarget
        : () => null;
    const setSelectedCombatTarget = typeof options.setSelectedCombatTarget === 'function'
        ? options.setSelectedCombatTarget
        : () => {};
    const exitCombatIfNoTargets = typeof options.exitCombatIfNoTargets === 'function'
        ? options.exitCombatIfNoTargets
        : () => {};
    const applyPlayerDamage = typeof options.applyPlayerDamage === 'function'
        ? options.applyPlayerDamage
        : () => {};

    function resolveCombatActorForDm(actorId) {
        const id = String(actorId || '').trim();
        if (!id) return null;
        if (id === 'player' || id === getLocalCombatActorId()) return getPlayerState();
        return findCombatActorById(id);
    }

    function setActorHpById(actorId, value) {
        const actor = resolveCombatActorForDm(actorId);
        const hpValue = Math.max(0, Number(value) || 0);
        if (!actor) return false;

        const playerState = getPlayerState();
        if (actor === playerState) {
            playerState.hp = Math.min(Number(playerState.maxHp) || hpValue, hpValue);
            updatePlayerHealthHud();
            return true;
        }

        actor.userData.hp = Math.min(Number(actor.userData?.maxHp) || hpValue, hpValue);
        if (actor.userData.hp <= 0) {
            removeTrainingDummy(actor);
            if (getSelectedCombatTarget() === actor) setSelectedCombatTarget(null);
            exitCombatIfNoTargets();
        }
        return true;
    }

    function applyDamageToActorById(actorId, amount) {
        const actor = resolveCombatActorForDm(actorId);
        const damage = Math.max(0, Math.round(Number(amount) || 0));
        if (!actor || damage <= 0) return false;

        const playerState = getPlayerState();
        if (actor === playerState) {
            applyPlayerDamage(damage, 'DM override');
            return true;
        }

        return setActorHpById(actorId, Math.max(0, Number(actor.userData?.hp) - damage));
    }

    return {
        resolveCombatActorForDm,
        setActorHpById,
        applyDamageToActorById,
    };
}
