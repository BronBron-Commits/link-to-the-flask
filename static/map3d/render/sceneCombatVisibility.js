export function createSceneCombatVisibilityUpdater(deps) {
    const {
        isSceneReadyForWorldState,
        getScene,
        netLog,
    } = deps || {};

    if (typeof isSceneReadyForWorldState !== 'function') {
        throw new Error('createSceneCombatVisibilityUpdater requires isSceneReadyForWorldState');
    }
    if (typeof getScene !== 'function') {
        throw new Error('createSceneCombatVisibilityUpdater requires getScene');
    }

    const log = typeof netLog === 'function' ? netLog : () => {};
    const cache = {
        list: [],
        cachedAt: 0,
    };

    return function updateSceneVisibilityForCombatState(inCombat) {
        // Cache combat-hide candidates to avoid traversing the full scene every update.
        if (!isSceneReadyForWorldState()) return;

        const COMBAT_HIDE_LIST_REFRESH_MS = 5000;
        const nowMs = performance.now();
        const cacheExpired = (nowMs - cache.cachedAt) > COMBAT_HIDE_LIST_REFRESH_MS;

        if (cacheExpired || cache.list.length === 0) {
            const scene = getScene();
            const next = [];
            scene.traverse((obj) => {
                if (!obj || !obj.userData) return;

                const objectType = String(obj.userData.type || '').toLowerCase();
                const isFurniture = objectType === 'furniture' || objectType === 'prop' || objectType === 'decoration' || objectType === 'decor';

                const meshName = String(obj.name || '').toLowerCase();
                const hasMatchingName = meshName.includes('furniture') || meshName.includes('prop') || meshName.includes('decor') || meshName.includes('glb');

                const shouldHideInCombat = isFurniture || (hasMatchingName && !meshName.includes('player') && !meshName.includes('enemy'));
                if (shouldHideInCombat) {
                    next.push(obj);
                }
            });
            cache.list = next;
            cache.cachedAt = nowMs;
        }

        cache.list.forEach((obj) => {
            if (!obj || !obj.userData || !obj.parent) return;

            if (inCombat && obj.visible) {
                obj.userData.wasVisibleBeforeCombat = true;
                obj.visible = false;
                log(`[COMBAT] Hiding furniture: ${obj.name || obj.userData.id || obj.type}`);
            } else if (!inCombat && !obj.visible && (obj.userData.wasVisibleBeforeCombat !== false)) {
                obj.visible = true;
                delete obj.userData.wasVisibleBeforeCombat;
                log(`[COMBAT] Showing furniture: ${obj.name || obj.userData.id || obj.type}`);
            }
        });
    };
}
