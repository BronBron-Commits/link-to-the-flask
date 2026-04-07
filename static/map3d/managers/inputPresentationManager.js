export function createInputPresentationManager(deps = {}) {
    const {
        now = () => (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now()),
        schedule = (fn, delay) => window.setTimeout(fn, delay),
        cancelScheduled = (id) => window.clearTimeout(id),
        showFloatingText = () => {},
        focusCameraOnAction = () => {},
        playConfirmAttackSnap = () => {},
        triggerCombatFlash = () => {},
        shakeScreen = () => {},
        setCombatUiPhase = () => {},
        onPhaseTransition = () => {},
    } = deps;

    const PHASE_ORDER = ['anticipation', 'windup', 'impact', 'recovery', 'settle'];
    const PHASE_MIN_MS = {
        anticipation: 70,
        windup: 120,
        impact: 80,
        recovery: 110,
        settle: 90,
    };

    const activeTimers = new Set();

    function queue(delayMs, fn) {
        const timerId = schedule(() => {
            activeTimers.delete(timerId);
            fn();
        }, Math.max(0, Number(delayMs) || 0));
        activeTimers.add(timerId);
        return timerId;
    }

    function clear() {
        activeTimers.forEach((timerId) => {
            cancelScheduled(timerId);
        });
        activeTimers.clear();
    }

    function defaultAnchor(presentation) {
        return presentation && presentation.anchorObject ? presentation.anchorObject : null;
    }

    function normalizeDuration(ms) {
        const value = Number(ms);
        return Number.isFinite(value) ? Math.max(0, value) : 0;
    }

    function normalizeKind(kind) {
        return String(kind || 'action').trim().toLowerCase() || 'action';
    }

    function normalizePhase(phase) {
        const normalized = String(phase || '').trim().toLowerCase();
        return PHASE_ORDER.includes(normalized) ? normalized : 'windup';
    }

    function getActionPhaseContract(kind, phase, options = {}) {
        const normalizedKind = normalizeKind(kind);
        const normalizedPhase = normalizePhase(phase);
        const minMs = normalizeDuration(options.minMs) || PHASE_MIN_MS[normalizedPhase] || 80;
        const requestedMs = normalizeDuration(options.durationMs);
        const animationMs = normalizeDuration(options.animationMs);
        const requestedHitStopMs = normalizeDuration(options.hitStopMs);
        const impactHitStopMs = normalizedPhase === 'impact' ? requestedHitStopMs : 0;
        const durationMs = Math.max(minMs, requestedMs, animationMs, impactHitStopMs > 0 ? impactHitStopMs + 16 : 0);
        return {
            kind: normalizedKind,
            phase: normalizedPhase,
            minMs,
            animationMs,
            hitStopMs: impactHitStopMs,
            durationMs,
        };
    }

    function markPhaseTransition(contract, state, payload = null) {
        const details = {
            kind: contract.kind,
            phase: contract.phase,
            state: String(state || 'start'),
            durationMs: contract.durationMs,
            minMs: contract.minMs,
            animationMs: contract.animationMs,
            hitStopMs: contract.hitStopMs,
            timestampMs: now(),
            payload: payload && typeof payload === 'object' ? { ...payload } : null,
        };
        onPhaseTransition(details);
        return details;
    }

    function beginActionPhase(kind, phase, options = {}) {
        const contract = getActionPhaseContract(kind, phase, options);
        setCombatUiPhase('resolving', {
            action: contract.kind,
            phase: contract.phase,
            durationMs: contract.durationMs,
        });
        markPhaseTransition(contract, 'start', options.payload || null);
        return contract;
    }

    function endActionPhase(contract, payload = null) {
        if (!contract || typeof contract !== 'object') return;
        markPhaseTransition(contract, 'end', payload);
    }

    function presentBlocked(entry, presentation = {}) {
        const anchorObject = defaultAnchor(presentation);
        showFloatingText(entry.message, '#ff8a8a', true, anchorObject ? { anchorObject } : null);
        triggerCombatFlash('#ff5a5a', 0.08, 170);
        shakeScreen(0.03, 90);
    }

    function presentQueued(entry, presentation = {}) {
        const anchorObject = defaultAnchor(presentation);
        const uiPhase = presentation.uiPhase || null;
        if (uiPhase) {
            setCombatUiPhase(uiPhase, { action: presentation.action || entry.kind });
        }

        queue(30, () => {
            if (entry.kind === 'attack') {
                playConfirmAttackSnap();
                triggerCombatFlash('#ffd166', 0.08, 180);
            } else if (entry.kind === 'move') {
                triggerCombatFlash('#66b3ff', 0.08, 180);
            } else if (entry.kind === 'end-turn') {
                triggerCombatFlash('#8dd694', 0.06, 160);
            }
        });

        queue(45, () => {
            if (anchorObject) {
                focusCameraOnAction(anchorObject, {
                    durationMs: Number(presentation.focusDurationMs) || 520,
                    strength: Number(presentation.focusStrength) || 1.1,
                });
            }
            showFloatingText(entry.message, presentation.color || '#ffd166', false, anchorObject ? { anchorObject } : null);
        });
    }

    function presentAccepted(entry, presentation = {}) {
        const anchorObject = defaultAnchor(presentation);
        const uiPhase = presentation.uiPhase || null;
        if (uiPhase) {
            setCombatUiPhase(uiPhase, { action: presentation.action || entry.kind });
        }

        if (entry.kind === 'attack') {
            queue(0, () => playConfirmAttackSnap());
            queue(50, () => triggerCombatFlash('#ffd166', 0.06, 140));
            queue(70, () => {
                if (anchorObject) {
                    focusCameraOnAction(anchorObject, {
                        durationMs: Number(presentation.focusDurationMs) || 460,
                        strength: Number(presentation.focusStrength) || 1.15,
                    });
                }
            });
        } else if (entry.kind === 'move') {
            queue(40, () => triggerCombatFlash('#66b3ff', 0.05, 120));
        } else if (entry.kind === 'end-turn') {
            queue(20, () => triggerCombatFlash('#8dd694', 0.05, 120));
        }
    }

    function present(entry, presentation = null) {
        if (!entry || typeof entry !== 'object') return;
        const outcome = String(entry.outcome || '').toLowerCase();
        const normalizedPresentation = presentation && typeof presentation === 'object' ? presentation : {};

        if (outcome === 'blocked' || outcome === 'rejected') {
            presentBlocked(entry, normalizedPresentation);
            return;
        }
        if (outcome === 'queued' || outcome === 'pending') {
            presentQueued(entry, normalizedPresentation);
            return;
        }
        if (outcome === 'accepted' || outcome === 'resolved') {
            presentAccepted(entry, normalizedPresentation);
        }
    }

    return {
        present,
        clear,
        getActionPhaseContract,
        beginActionPhase,
        endActionPhase,
    };
}
