export function createCombatTargetingService(options = {}) {
    const getAllPlayerAvatars = typeof options.getAllPlayerAvatars === 'function'
        ? options.getAllPlayerAvatars
        : () => ({});
    const canTarget = typeof options.canTarget === 'function'
        ? options.canTarget
        : () => false;
    const isMeshSelectable = typeof options.isMeshSelectable === 'function'
        ? options.isMeshSelectable
        : () => false;
    const resolveSelectableTarget = typeof options.resolveSelectableTarget === 'function'
        ? options.resolveSelectableTarget
        : (value) => value;

    function getValidTargets(attacker, rangeFeet, includeAllies = false) {
        const validTargets = [];
        const avatars = Object.values(getAllPlayerAvatars() || {});

        for (const avatar of avatars) {
            if (avatar === attacker) continue;
            if (!includeAllies && avatar.isAlly === attacker.isAlly) continue;
            if (canTarget(attacker, avatar, rangeFeet, true)) {
                validTargets.push(avatar);
            }
        }

        return validTargets;
    }

    function highlightTargets(attacker, rangeFeet, includeAllies = false) {
        const validTargets = getValidTargets(attacker, rangeFeet, includeAllies);
        const avatars = Object.values(getAllPlayerAvatars() || {});

        for (const avatar of avatars) {
            if (avatar === attacker) continue;
            const isValid = validTargets.includes(avatar);
            if (avatar.userData.highlightMesh) {
                avatar.userData.highlightMesh.visible = isValid;
                avatar.userData.highlightMesh.material.color.setHex(isValid ? 0x00ff00 : 0x888888);
            }
        }

        return validTargets;
    }

    function clearTargetHighlights() {
        const avatars = Object.values(getAllPlayerAvatars() || {});
        for (const avatar of avatars) {
            if (avatar.userData.highlightMesh) {
                avatar.userData.highlightMesh.visible = false;
            }
        }
    }

    function getFirstSelectableHit(intersects) {
        for (const hit of intersects) {
            if (!hit || !hit.object || !hit.object.isMesh) continue;
            if (!isMeshSelectable(hit.object)) continue;
            return resolveSelectableTarget(hit.object);
        }
        return null;
    }

    return {
        getValidTargets,
        highlightTargets,
        clearTargetHighlights,
        getFirstSelectableHit,
    };
}
