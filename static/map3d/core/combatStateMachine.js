export const COMBAT_UI_PHASE = {
    IDLE: 'idle',
    TARGETING: 'targeting',
    PREVIEW_PENDING: 'preview-pending',
    CONFIRM_READY: 'confirm-ready',
    RESOLVING: 'resolving',
};

export function createCombatUiLifecycle() {
    return {
        phase: COMBAT_UI_PHASE.IDLE,
        requestId: null,
        action: null,
    };
}

export function createCombatInteractionState() {
    return {
        action: null,
        target: null,
        preview: null,
        autoApproachPreview: null,
        awaitingConfirm: false,
        previewRequestId: null,
    };
}

export function applyCombatUiPhase(combatUiLifecycle, combatInteraction, phase, details = {}) {
    combatUiLifecycle.phase = String(phase || COMBAT_UI_PHASE.IDLE);
    combatUiLifecycle.action = details.action || combatInteraction.action || null;
    combatUiLifecycle.requestId = details.requestId || null;
}

export function turnPhaseToCombatPhase(phase, turnPhase) {
    if (phase === turnPhase.ENEMY) return 'ENEMY';
    if (phase === turnPhase.TRANSITION) return 'TRANSITION';
    return 'PLAYER';
}

export function isPlayerInputTurn(args) {
    const {
        currentGameMode,
        combatMode,
        combatPhase,
        currentTurnPhase,
        turnPhase,
    } = args || {};
    if (currentGameMode !== combatMode) return false;
    return combatPhase === 'PLAYER' || currentTurnPhase === turnPhase.PLAYER;
}
