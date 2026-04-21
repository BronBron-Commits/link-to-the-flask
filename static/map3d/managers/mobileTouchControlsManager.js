export function createMobileTouchControlsManager(deps = {}) {
    const {
        THREE,
        windowObj = window,
        documentObj = document,
        mobileTouchMaxWidth = 900,
        mobileTouchPadSize = 180,
        mobileTouchStickSize = 88,
        mobileTouchPadOffsetX = 20,
        mobileTouchPadOffsetBottom = 20,
        touchMoveDeadzone = 0.22,
        touchLookDeadzone = 0.08,
        touchLookSpeed = 2.45,
        isDmFreeCamera = () => false,
        canUseStandardMovementControls = () => true,
        isTextInputTarget = () => false,
        isCombatReviewUiOpen = () => false,
        getConsoleOpen = () => false,
        getDmCamera = () => null,
        getCamera = () => null,
        getPlayerRig = () => null,
        getCombatCameraActive = () => false,
        getYaw = () => 0,
        setYaw = () => {},
        getPitch = () => 0,
        setPitch = () => {},
        setMovementFlags = () => {},
        setDmFreeMovementFlags = () => {},
    } = deps;

    const mobileTouchEnabled = ('ontouchstart' in windowObj)
        || ((windowObj.navigator && windowObj.navigator.maxTouchPoints) ? windowObj.navigator.maxTouchPoints > 0 : false);

    let touchControlsRootEl = null;
    let touchMovePadEl = null;
    let touchMoveStickEl = null;
    let touchLookPadEl = null;
    let touchLookStickEl = null;
    let touchMovePointerId = null;
    let touchLookPointerId = null;
    const touchMoveAxis = new THREE.Vector2(0, 0);
    const touchLookAxis = new THREE.Vector2(0, 0);

    function applyPlayerMoveFlags(forward, backward, left, right) {
        setMovementFlags({ forward, backward, left, right });
    }

    function applyDmFreeMoveFlags(forward, backward, left, right) {
        setDmFreeMovementFlags({ forward, backward, left, right });
    }

    function isMobileTouchScreenLayout() {
        if (!mobileTouchEnabled) return false;
        if (windowObj.matchMedia && windowObj.matchMedia(`(max-width: ${mobileTouchMaxWidth}px)`).matches) {
            return true;
        }
        const width = Number(windowObj.innerWidth) || 0;
        const height = Number(windowObj.innerHeight) || 0;
        return Math.min(width, height) > 0 && Math.min(width, height) <= mobileTouchMaxWidth;
    }

    function resetTouchMoveState() {
        touchMoveAxis.set(0, 0);
        applyPlayerMoveFlags(false, false, false, false);
        applyDmFreeMoveFlags(false, false, false, false);
    }

    function resetTouchLookState() {
        touchLookAxis.set(0, 0);
    }

    function updateTouchMoveFlags() {
        if (Math.abs(touchMoveAxis.x) < touchMoveDeadzone && Math.abs(touchMoveAxis.y) < touchMoveDeadzone) {
            applyPlayerMoveFlags(false, false, false, false);
            applyDmFreeMoveFlags(false, false, false, false);
            return;
        }

        const forward = touchMoveAxis.y < -touchMoveDeadzone;
        const backward = touchMoveAxis.y > touchMoveDeadzone;
        const left = touchMoveAxis.x < -touchMoveDeadzone;
        const right = touchMoveAxis.x > touchMoveDeadzone;

        if (isDmFreeCamera()) {
            applyDmFreeMoveFlags(forward, backward, left, right);
            applyPlayerMoveFlags(false, false, false, false);
            return;
        }

        if (canUseStandardMovementControls()) {
            applyPlayerMoveFlags(forward, backward, left, right);
        }
    }

    function resetTouchJoystickState() {
        touchMovePointerId = null;
        touchLookPointerId = null;
        if (touchMoveStickEl) touchMoveStickEl.style.transform = 'translate(-50%, -50%)';
        if (touchLookStickEl) touchLookStickEl.style.transform = 'translate(-50%, -50%)';
        resetTouchMoveState();
        resetTouchLookState();
        updateTouchMoveFlags();
    }

    function refreshMobileTouchControlsVisibility() {
        if (!touchControlsRootEl) return;
        const shouldShow = isMobileTouchScreenLayout();
        touchControlsRootEl.style.display = shouldShow ? 'block' : 'none';
        if (!shouldShow) {
            resetTouchJoystickState();
        }
    }

    function applyTouchLookInput(delta) {
        if (!mobileTouchEnabled || !isMobileTouchScreenLayout()) return;
        if (Math.abs(touchLookAxis.x) < touchLookDeadzone && Math.abs(touchLookAxis.y) < touchLookDeadzone) return;
        if (getConsoleOpen() || isCombatReviewUiOpen()) return;

        const lookYaw = touchLookAxis.x * touchLookSpeed * Math.max(0, delta);
        const lookPitch = touchLookAxis.y * touchLookSpeed * Math.max(0, delta);

        const dmCamera = getDmCamera();
        if (isDmFreeCamera() && dmCamera) {
            dmCamera.rotation.order = 'YXZ';
            dmCamera.rotation.y -= lookYaw;
            dmCamera.rotation.x = Math.max(-1.45, Math.min(1.45, dmCamera.rotation.x - lookPitch));
            return;
        }

        if (!canUseStandardMovementControls()) return;
        const nextYaw = getYaw() - lookYaw;
        setYaw(nextYaw);

        const combatCameraActive = !!getCombatCameraActive();
        if (!combatCameraActive) {
            const nextPitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, getPitch() - lookPitch));
            setPitch(nextPitch);
        }

        const playerRig = getPlayerRig();
        if (playerRig) {
            playerRig.rotation.y = nextYaw;
        }

        if (!combatCameraActive) {
            const camera = getCamera();
            if (camera) {
                camera.rotation.x = getPitch();
            }
        }
    }

    function setTouchPadAxisFromEvent(padEl, stickEl, touch, axisVec) {
        if (!padEl || !stickEl || !touch) return;
        const rect = padEl.getBoundingClientRect();
        const cx = rect.left + (rect.width * 0.5);
        const cy = rect.top + (rect.height * 0.5);
        const maxRadius = rect.width * 0.35;
        let dx = touch.clientX - cx;
        let dy = touch.clientY - cy;
        const len = Math.hypot(dx, dy);
        if (len > maxRadius && len > 0.0001) {
            const s = maxRadius / len;
            dx *= s;
            dy *= s;
        }
        axisVec.set(dx / Math.max(1, maxRadius), dy / Math.max(1, maxRadius));
        stickEl.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    }

    function createMobileTouchControls() {
        if (!mobileTouchEnabled || touchControlsRootEl) return;

        const root = documentObj.createElement('div');
        root.id = 'mobile-touch-controls';
        root.style.position = 'fixed';
        root.style.inset = '0';
        root.style.pointerEvents = 'none';
        root.style.zIndex = '2600';

        const createPad = (left, right) => {
            const pad = documentObj.createElement('div');
            pad.style.position = 'absolute';
            if (left !== null) pad.style.left = left;
            if (right !== null) pad.style.right = right;
            pad.style.bottom = `${mobileTouchPadOffsetBottom}px`;
            pad.style.width = `${mobileTouchPadSize}px`;
            pad.style.height = `${mobileTouchPadSize}px`;
            pad.style.borderRadius = '999px';
            pad.style.background = 'rgba(18, 26, 42, 0.45)';
            pad.style.border = '1px solid rgba(160, 200, 255, 0.55)';
            pad.style.backdropFilter = 'blur(3px)';
            pad.style.touchAction = 'none';
            pad.style.pointerEvents = 'auto';

            const stick = documentObj.createElement('div');
            stick.style.position = 'absolute';
            stick.style.left = '50%';
            stick.style.top = '50%';
            stick.style.width = `${mobileTouchStickSize}px`;
            stick.style.height = `${mobileTouchStickSize}px`;
            stick.style.borderRadius = '999px';
            stick.style.transform = 'translate(-50%, -50%)';
            stick.style.background = 'rgba(160, 205, 255, 0.24)';
            stick.style.border = '1px solid rgba(190, 225, 255, 0.75)';
            stick.style.boxShadow = '0 0 16px rgba(110, 170, 255, 0.4)';
            pad.appendChild(stick);

            root.appendChild(pad);
            return { pad, stick };
        };

        const leftPad = createPad(`${mobileTouchPadOffsetX}px`, null);
        const rightPad = createPad(null, `${mobileTouchPadOffsetX}px`);

        touchMovePadEl = leftPad.pad;
        touchMoveStickEl = leftPad.stick;
        touchLookPadEl = rightPad.pad;
        touchLookStickEl = rightPad.stick;

        touchMovePadEl.addEventListener('touchstart', (event) => {
            if (isTextInputTarget(event.target) || getConsoleOpen()) return;
            if (touchMovePointerId !== null) return;
            const touch = event.changedTouches && event.changedTouches[0];
            if (!touch) return;
            touchMovePointerId = touch.identifier;
            setTouchPadAxisFromEvent(touchMovePadEl, touchMoveStickEl, touch, touchMoveAxis);
            updateTouchMoveFlags();
            event.preventDefault();
        }, { passive: false });

        touchMovePadEl.addEventListener('touchmove', (event) => {
            if (touchMovePointerId === null) return;
            for (const t of event.changedTouches) {
                if (t.identifier !== touchMovePointerId) continue;
                setTouchPadAxisFromEvent(touchMovePadEl, touchMoveStickEl, t, touchMoveAxis);
                updateTouchMoveFlags();
                event.preventDefault();
                break;
            }
        }, { passive: false });

        const endMove = (event) => {
            if (touchMovePointerId === null) return;
            for (const t of event.changedTouches) {
                if (t.identifier !== touchMovePointerId) continue;
                touchMovePointerId = null;
                touchMoveStickEl.style.transform = 'translate(-50%, -50%)';
                resetTouchMoveState();
                updateTouchMoveFlags();
                event.preventDefault();
                break;
            }
        };
        touchMovePadEl.addEventListener('touchend', endMove, { passive: false });
        touchMovePadEl.addEventListener('touchcancel', endMove, { passive: false });

        touchLookPadEl.addEventListener('touchstart', (event) => {
            if (isTextInputTarget(event.target) || getConsoleOpen()) return;
            if (touchLookPointerId !== null) return;
            const touch = event.changedTouches && event.changedTouches[0];
            if (!touch) return;
            touchLookPointerId = touch.identifier;
            setTouchPadAxisFromEvent(touchLookPadEl, touchLookStickEl, touch, touchLookAxis);
            event.preventDefault();
        }, { passive: false });

        touchLookPadEl.addEventListener('touchmove', (event) => {
            if (touchLookPointerId === null) return;
            for (const t of event.changedTouches) {
                if (t.identifier !== touchLookPointerId) continue;
                setTouchPadAxisFromEvent(touchLookPadEl, touchLookStickEl, t, touchLookAxis);
                event.preventDefault();
                break;
            }
        }, { passive: false });

        const endLook = (event) => {
            if (touchLookPointerId === null) return;
            for (const t of event.changedTouches) {
                if (t.identifier !== touchLookPointerId) continue;
                touchLookPointerId = null;
                touchLookStickEl.style.transform = 'translate(-50%, -50%)';
                resetTouchLookState();
                event.preventDefault();
                break;
            }
        };
        touchLookPadEl.addEventListener('touchend', endLook, { passive: false });
        touchLookPadEl.addEventListener('touchcancel', endLook, { passive: false });

        documentObj.body.appendChild(root);
        touchControlsRootEl = root;
        refreshMobileTouchControlsVisibility();
    }

    return {
        isMobileTouchScreenLayout,
        resetTouchJoystickState,
        refreshMobileTouchControlsVisibility,
        resetTouchMoveState,
        resetTouchLookState,
        updateTouchMoveFlags,
        applyTouchLookInput,
        setTouchPadAxisFromEvent,
        createMobileTouchControls,
    };
}
