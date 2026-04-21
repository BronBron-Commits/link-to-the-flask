export function createDmInjectedInputHandler(options = {}) {
    const resolveCombatActorForDm = typeof options.resolveCombatActorForDm === 'function'
        ? options.resolveCombatActorForDm
        : () => null;
    const getSelectedCombatTarget = typeof options.getSelectedCombatTarget === 'function'
        ? options.getSelectedCombatTarget
        : () => null;
    const getPlayerState = typeof options.getPlayerState === 'function'
        ? options.getPlayerState
        : () => ({});
    const setSelectedCombatTarget = typeof options.setSelectedCombatTarget === 'function'
        ? options.setSelectedCombatTarget
        : () => {};
    const selectMoveAndAttackAction = typeof options.selectMoveAndAttackAction === 'function'
        ? options.selectMoveAndAttackAction
        : () => {};
    const getControlledActor = typeof options.getControlledActor === 'function'
        ? options.getControlledActor
        : () => null;
    const possessActor = typeof options.possessActor === 'function'
        ? options.possessActor
        : () => false;
    const runPossessedEnemyAttack = typeof options.runPossessedEnemyAttack === 'function'
        ? options.runPossessedEnemyAttack
        : () => false;

    function handleDmInjectedInput(payload) {
        const actorId = String(payload.actorId || '').trim();
        const action = String(payload.action || payload.input?.action || '').toLowerCase();
        const targetId = String(payload.targetId || payload.input?.target || '').trim();
        if (!actorId || !action) return false;

        const actor = resolveCombatActorForDm(actorId);
        if (!actor) return false;

        if (action === 'attack') {
            const playerState = getPlayerState();
            const target = resolveCombatActorForDm(targetId) || getSelectedCombatTarget();
            if (actor === playerState) {
                if (!target || target === playerState || !target.parent) return false;
                setSelectedCombatTarget(target);
                selectMoveAndAttackAction(target);
                return true;
            }
            if (actor !== playerState) {
                if (getControlledActor() !== actor) {
                    possessActor(actor);
                }
                return runPossessedEnemyAttack(actor);
            }
        }

        if (action === 'move') {
            const playerState = getPlayerState();
            const move = payload.move || payload.input?.move;
            if (!move || actor === playerState) return false;
            const x = Number(move.x);
            const z = Number(move.z);
            if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
            actor.position.x += x;
            actor.position.z += z;
            return true;
        }

        return false;
    }

    return {
        handleDmInjectedInput,
    };
}
