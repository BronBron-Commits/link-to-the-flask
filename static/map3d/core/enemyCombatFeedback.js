export function createEnemyCombatFeedbackService(options = {}) {
    const THREERef = options.THREE;
    const getPlayerState = typeof options.getPlayerState === 'function'
        ? options.getPlayerState
        : () => ({ position: { x: 0, z: 0 } });
    const getTrainingDummies = typeof options.getTrainingDummies === 'function'
        ? options.getTrainingDummies
        : () => [];
    const focusOutcomeText = typeof options.focusOutcomeText === 'function' ? options.focusOutcomeText : () => {};
    const showFloatingText = typeof options.showFloatingText === 'function' ? options.showFloatingText : () => {};
    const spawnImpactBurst = typeof options.spawnImpactBurst === 'function' ? options.spawnImpactBurst : () => {};
    const triggerCombatFlash = typeof options.triggerCombatFlash === 'function' ? options.triggerCombatFlash : () => {};
    const shakeScreen = typeof options.shakeScreen === 'function' ? options.shakeScreen : () => {};
    const playCombatSfxCue = typeof options.playCombatSfxCue === 'function' ? options.playCombatSfxCue : () => {};
    const removeEnemyHealthBar = typeof options.removeEnemyHealthBar === 'function' ? options.removeEnemyHealthBar : () => {};
    const logCombatEvent = typeof options.logCombatEvent === 'function' ? options.logCombatEvent : () => {};
    const requestAnimationFrameFn = typeof options.requestAnimationFrameFn === 'function'
        ? options.requestAnimationFrameFn
        : requestAnimationFrame;
    const cancelAnimationFrameFn = typeof options.cancelAnimationFrameFn === 'function'
        ? options.cancelAnimationFrameFn
        : cancelAnimationFrame;
    const performanceObj = options.performanceObj || performance;

    function triggerEnemySwingAnim(enemy) {
        if (!enemy || !enemy.userData) return;
        const modelRoot = enemy.children.find((c) => c.name === 'training_dummy_visual');
        if (!modelRoot) return;

        let leftUpperArm = null;
        let rightUpperArm = null;
        modelRoot.traverse((child) => {
            if (!child.isBone) return;
            const n = child.name || '';
            if (!leftUpperArm && /(left.*upperarm|upperarm.*left|leftarm|arm_l|l_upperarm|larm)/i.test(n)) leftUpperArm = child;
            if (!rightUpperArm && /(right.*upperarm|upperarm.*right|rightarm|arm_r|r_upperarm|rarm)/i.test(n)) rightUpperArm = child;
        });
        if (!leftUpperArm && !rightUpperArm) return;

        const leftRest = leftUpperArm ? leftUpperArm.rotation.clone() : null;
        const rightRest = rightUpperArm ? rightUpperArm.rotation.clone() : null;

        const SWING_DURATION_MS = 480;
        const startTime = performanceObj.now();

        const swingRig = enemy.userData.swingAnimRig || null;
        if (swingRig) cancelAnimationFrameFn(swingRig.raf);

        const state = { raf: null };
        enemy.userData.swingAnimRig = state;

        const tick = () => {
            const elapsed = performanceObj.now() - startTime;
            const t = Math.min(1, elapsed / SWING_DURATION_MS);
            const arc = t < 0.45 ? (t / 0.45) : (1 - ((t - 0.45) / 0.55));
            const swing = arc * 1.9;

            if (leftUpperArm && leftRest) {
                leftUpperArm.rotation.x = leftRest.x - swing;
                leftUpperArm.rotation.z = leftRest.z + (swing * 0.28);
            }
            if (rightUpperArm && rightRest) {
                rightUpperArm.rotation.x = rightRest.x - swing;
                rightUpperArm.rotation.z = rightRest.z - (swing * 0.28);
            }

            if (t < 1) {
                state.raf = requestAnimationFrameFn(tick);
            } else {
                if (leftUpperArm && leftRest) leftUpperArm.rotation.copy(leftRest);
                if (rightUpperArm && rightRest) rightUpperArm.rotation.copy(rightRest);
                enemy.userData.swingAnimRig = null;
            }
        };

        state.raf = requestAnimationFrameFn(tick);
    }

    function triggerEnemyFlinch(target) {
        if (!target || !target.userData) return;
        const playerState = getPlayerState();
        const dir = new THREERef.Vector3(
            target.position.x - playerState.position.x,
            0,
            target.position.z - playerState.position.z
        );
        if (dir.lengthSq() < 0.001) dir.set(1, 0, 0);
        dir.normalize();
        target.userData.flinchState = {
            originX: target.position.x,
            originZ: target.position.z,
            offsetX: dir.x * 0.38,
            offsetZ: dir.z * 0.38,
            elapsed: 0,
            duration: 260,
        };
    }

    function updateEnemyFlinches(deltaMs) {
        for (const dummy of getTrainingDummies()) {
            if (!dummy || !dummy.userData.flinchState) continue;
            const f = dummy.userData.flinchState;
            f.elapsed += deltaMs;
            const t = Math.min(1, f.elapsed / f.duration);
            const knock = t < 0.35 ? (t / 0.35) : (1 - ((t - 0.35) / 0.65));
            dummy.position.x = f.originX + (f.offsetX * knock);
            dummy.position.z = f.originZ + (f.offsetZ * knock);
            if (f.elapsed >= f.duration) {
                dummy.position.x = f.originX;
                dummy.position.z = f.originZ;
                dummy.userData.flinchState = null;
            }
        }
    }

    async function playKillSequence(target) {
        if (!target || !target.parent) return;
        focusOutcomeText('DEFEATED', '#ff4444', 2200);
        showFloatingText('DEFEATED', '#ff4444', true, { anchorObject: target });
        spawnImpactBurst(target.position, 0xff4444, 55);
        spawnImpactBurst(target.position, 0xffcc00, 30);
        triggerCombatFlash('#ff2200', 0.38, 500);
        shakeScreen(0.55, 600);
        playCombatSfxCue('melee-hit');

        const startScaleY = target.scale.y;
        const startPosY = target.position.y;
        const startTime = performanceObj.now();
        const duration = 560;

        await new Promise((resolve) => {
            const collapse = () => {
                if (!target.parent) {
                    resolve();
                    return;
                }
                const t = Math.min(1, (performanceObj.now() - startTime) / duration);
                const eased = t * t;
                target.scale.y = Math.max(0.001, startScaleY * (1 - eased));
                target.position.y = startPosY - (eased * 1.8);
                if (t < 1) {
                    requestAnimationFrameFn(collapse);
                } else {
                    resolve();
                }
            };
            requestAnimationFrameFn(collapse);
        });

        removeEnemyHealthBar(target);
        logCombatEvent(`${target.userData.name || 'Target'} defeated`, 'hit');
    }

    return {
        triggerEnemySwingAnim,
        triggerEnemyFlinch,
        updateEnemyFlinches,
        playKillSequence,
    };
}
