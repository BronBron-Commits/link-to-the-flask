export function createUnifiedInputManager(deps = {}) {
    const {
        deadzone = 0.16,
        setMovementFlags = () => {},
        setDmFreeMovementFlags = () => {},
        setTurnFlags = () => {},
        setSprint = () => {},
        setFlightVerticalFlags = () => {},
        queueJump = () => {},
        onCommand = () => {},
    } = deps;

    const keyboardState = {
        forward: false,
        backward: false,
        left: false,
        right: false,
        turnLeft: false,
        turnRight: false,
        sprint: false,
        flyUp: false,
        flyDown: false,
    };

    const dmKeyboardState = {
        forward: false,
        backward: false,
        left: false,
        right: false,
        up: false,
        down: false,
        fast: false,
    };

    const gamepadState = {
        forward: false,
        backward: false,
        left: false,
        right: false,
        turnLeft: false,
        turnRight: false,
        sprint: false,
        flyUp: false,
        flyDown: false,
    };

    const dmGamepadState = {
        forward: false,
        backward: false,
        left: false,
        right: false,
        up: false,
        down: false,
        fast: false,
    };

    const gamepadButtons = {
        confirm: false,
        cancel: false,
        toggleMovementRadius: false,
        toggleCombat: false,
        toggleFlying: false,
    };

    function applyDeadzone(value, threshold = deadzone) {
        const numeric = Number(value) || 0;
        return Math.abs(numeric) >= threshold ? numeric : 0;
    }

    function getButtonPressed(buttons, index) {
        const button = Array.isArray(buttons) ? buttons[index] : null;
        if (!button) return false;
        if (typeof button.pressed === 'boolean') return button.pressed;
        return (Number(button.value) || 0) >= 0.5;
    }

    function getButtonValue(buttons, index) {
        const button = Array.isArray(buttons) ? buttons[index] : null;
        if (!button) return 0;
        if (typeof button.value === 'number') return button.value;
        return button.pressed ? 1 : 0;
    }

    function getPrimaryStickAxes(gamepad) {
        if (!gamepad || !Array.isArray(gamepad.axes) || gamepad.axes.length < 2) {
            return { x: 0, y: 0 };
        }
        const ax0 = Number(gamepad.axes[0]) || 0;
        const ay0 = Number(gamepad.axes[1]) || 0;
        const mag0 = Math.hypot(ax0, ay0);
        if (gamepad.axes.length >= 4) {
            const ax1 = Number(gamepad.axes[2]) || 0;
            const ay1 = Number(gamepad.axes[3]) || 0;
            const mag1 = Math.hypot(ax1, ay1);
            if (mag1 > mag0) {
                return { x: applyDeadzone(ax1), y: applyDeadzone(ay1) };
            }
        }
        return { x: applyDeadzone(ax0), y: applyDeadzone(ay0) };
    }

    function getSecondaryStickX(gamepad) {
        if (!gamepad || !Array.isArray(gamepad.axes) || gamepad.axes.length < 3) return 0;
        return applyDeadzone(Number(gamepad.axes[2]) || 0);
    }

    function getDigitalMotionFromAxes(stick, options = {}) {
        const combatMode = options.combatMode === true;
        const forward = stick.y < -deadzone;
        const backward = stick.y > deadzone;
        const leftActive = stick.x < -deadzone;
        const rightActive = stick.x > deadzone;
        return {
            forward,
            backward,
            left: combatMode ? false : leftActive,
            right: combatMode ? false : rightActive,
            turnLeft: combatMode ? leftActive : false,
            turnRight: combatMode ? rightActive : false,
        };
    }

    function emitCommand(name, payload = {}) {
        onCommand(name, payload);
    }

    function syncMovementOutputs() {
        setMovementFlags({
            forward: keyboardState.forward || gamepadState.forward,
            backward: keyboardState.backward || gamepadState.backward,
            left: keyboardState.left || gamepadState.left,
            right: keyboardState.right || gamepadState.right,
        });
        setTurnFlags({
            left: keyboardState.turnLeft || gamepadState.turnLeft,
            right: keyboardState.turnRight || gamepadState.turnRight,
        });
        setSprint(keyboardState.sprint || gamepadState.sprint);
        setFlightVerticalFlags({
            up: keyboardState.flyUp || gamepadState.flyUp,
            down: keyboardState.flyDown || gamepadState.flyDown,
        });
    }

    function syncDmMovementOutputs() {
        setDmFreeMovementFlags({
            forward: dmKeyboardState.forward || dmGamepadState.forward,
            backward: dmKeyboardState.backward || dmGamepadState.backward,
            left: dmKeyboardState.left || dmGamepadState.left,
            right: dmKeyboardState.right || dmGamepadState.right,
            up: dmKeyboardState.up || dmGamepadState.up,
            down: dmKeyboardState.down || dmGamepadState.down,
            fast: dmKeyboardState.fast || dmGamepadState.fast,
        });
    }

    function clearGamepadState() {
        gamepadState.forward = false;
        gamepadState.backward = false;
        gamepadState.left = false;
        gamepadState.right = false;
        gamepadState.turnLeft = false;
        gamepadState.turnRight = false;
        gamepadState.sprint = false;
        gamepadState.flyUp = false;
        gamepadState.flyDown = false;
        dmGamepadState.forward = false;
        dmGamepadState.backward = false;
        dmGamepadState.left = false;
        dmGamepadState.right = false;
        dmGamepadState.up = false;
        dmGamepadState.down = false;
        dmGamepadState.fast = false;
        syncMovementOutputs();
        syncDmMovementOutputs();
    }

    function handleKeyboardCommand(event, context) {
        if (event.repeat) return false;
        switch (event.code) {
            case 'Enter':
            case 'NumpadEnter':
                emitCommand('confirm');
                return true;
            case 'Escape':
                emitCommand('cancel');
                return true;
            case 'KeyM':
                emitCommand('toggle-movement-radius');
                return true;
            case 'KeyC':
                emitCommand('toggle-combat');
                return true;
            case 'Tab':
                emitCommand('toggle-flying');
                return true;
            case 'KeyF':
                if (context.isDmFreeCamera === true) {
                    emitCommand('focus-target');
                    return true;
                }
                return false;
            default:
                return false;
        }
    }

    function handleKeyboardEvent(event, phase = 'down', context = {}) {
        const keyDown = phase === 'down';
        if (!event || typeof event.code !== 'string') return false;

        if (handleKeyboardCommand(event, context)) {
            return true;
        }

        if (context.isDmFreeCamera === true) {
            switch (event.code) {
                case 'ShiftLeft':
                case 'ShiftRight':
                    dmKeyboardState.fast = keyDown;
                    syncDmMovementOutputs();
                    return true;
                case 'KeyW':
                    dmKeyboardState.forward = keyDown;
                    syncDmMovementOutputs();
                    return true;
                case 'KeyS':
                    dmKeyboardState.backward = keyDown;
                    syncDmMovementOutputs();
                    return true;
                case 'KeyA':
                    dmKeyboardState.left = keyDown;
                    syncDmMovementOutputs();
                    return true;
                case 'KeyD':
                    dmKeyboardState.right = keyDown;
                    syncDmMovementOutputs();
                    return true;
                case 'Space':
                    dmKeyboardState.up = keyDown;
                    syncDmMovementOutputs();
                    return true;
                case 'ControlLeft':
                case 'ControlRight':
                    dmKeyboardState.down = keyDown;
                    syncDmMovementOutputs();
                    return true;
                default:
                    return false;
            }
        }

        if (context.canUseStandardMovementControls !== true) {
            return false;
        }

        switch (event.code) {
            case 'ShiftLeft':
            case 'ShiftRight':
                if (keyDown && context.movementLocked === true) return false;
                keyboardState.sprint = keyDown;
                syncMovementOutputs();
                return true;
            case 'KeyW':
                if (keyDown && context.movementLocked === true) return false;
                keyboardState.forward = keyDown;
                syncMovementOutputs();
                return true;
            case 'KeyS':
                if (keyDown && context.movementLocked === true) return false;
                keyboardState.backward = keyDown;
                syncMovementOutputs();
                return true;
            case 'KeyA':
                if (keyDown && context.movementLocked === true) return false;
                keyboardState.left = keyDown && context.combatMode !== true;
                keyboardState.turnLeft = keyDown && context.combatMode === true;
                syncMovementOutputs();
                return true;
            case 'KeyD':
                if (keyDown && context.movementLocked === true) return false;
                keyboardState.right = keyDown && context.combatMode !== true;
                keyboardState.turnRight = keyDown && context.combatMode === true;
                syncMovementOutputs();
                return true;
            case 'ArrowLeft':
                if (keyDown && context.movementLocked === true) return false;
                keyboardState.turnLeft = keyDown && context.combatMode !== true;
                syncMovementOutputs();
                return true;
            case 'ArrowRight':
                if (keyDown && context.movementLocked === true) return false;
                keyboardState.turnRight = keyDown && context.combatMode !== true;
                syncMovementOutputs();
                return true;
            case 'Space':
                if (context.playerFlying === true) {
                    if (keyDown && context.movementLocked === true) return false;
                    keyboardState.flyUp = keyDown;
                    syncMovementOutputs();
                    return true;
                }
                if (keyDown && event.repeat !== true) {
                    queueJump();
                    return true;
                }
                return false;
            case 'ControlLeft':
            case 'ControlRight':
                if (context.playerFlying === true) {
                    if (keyDown && context.movementLocked === true) return false;
                    keyboardState.flyDown = keyDown;
                    syncMovementOutputs();
                    return true;
                }
                return false;
            default:
                return false;
        }
    }

    function updateButtonEdge(nextPressed, key, commandName) {
        const previous = gamepadButtons[key] === true;
        if (nextPressed && !previous) {
            emitCommand(commandName, { source: 'gamepad' });
        }
        gamepadButtons[key] = nextPressed;
    }

    function syncGamepad(gamepad, context = {}) {
        if (!gamepad) {
            clearGamepadState();
            return {
                move: { x: 0, y: 0 },
                turnX: 0,
                vertical: 0,
            };
        }

        const stick = getPrimaryStickAxes(gamepad);
        const motion = getDigitalMotionFromAxes(stick, { combatMode: context.combatMode === true });
        const buttons = Array.isArray(gamepad.buttons) ? gamepad.buttons : [];
        const rightTrigger = getButtonValue(buttons, 7);
        const leftTrigger = getButtonValue(buttons, 6);
        const vertical = applyDeadzone(rightTrigger - leftTrigger);
        const turnX = getSecondaryStickX(gamepad);
        const sprintPressed = getButtonPressed(buttons, 5);

        if (context.isDmFreeCamera === true) {
            dmGamepadState.forward = motion.forward;
            dmGamepadState.backward = motion.backward;
            dmGamepadState.left = motion.left || motion.turnLeft;
            dmGamepadState.right = motion.right || motion.turnRight;
            dmGamepadState.up = vertical > deadzone;
            dmGamepadState.down = vertical < -deadzone;
            dmGamepadState.fast = sprintPressed;
            syncDmMovementOutputs();
        } else if (context.canUseStandardMovementControls === true) {
            const movementLocked = context.movementLocked === true;
            gamepadState.forward = movementLocked ? false : motion.forward;
            gamepadState.backward = movementLocked ? false : motion.backward;
            gamepadState.left = movementLocked ? false : motion.left;
            gamepadState.right = movementLocked ? false : motion.right;
            gamepadState.turnLeft = movementLocked ? false : (motion.turnLeft || turnX < -deadzone);
            gamepadState.turnRight = movementLocked ? false : (motion.turnRight || turnX > deadzone);
            gamepadState.sprint = movementLocked ? false : sprintPressed;
            gamepadState.flyUp = context.playerFlying === true && movementLocked !== true && vertical > deadzone;
            gamepadState.flyDown = context.playerFlying === true && movementLocked !== true && vertical < -deadzone;
            syncMovementOutputs();
        }

        updateButtonEdge(getButtonPressed(buttons, 0), 'confirm', 'confirm');
        updateButtonEdge(getButtonPressed(buttons, 1), 'cancel', 'cancel');
        updateButtonEdge(getButtonPressed(buttons, 2), 'toggleMovementRadius', 'toggle-movement-radius');
        updateButtonEdge(getButtonPressed(buttons, 9), 'toggleCombat', 'toggle-combat');
        updateButtonEdge(getButtonPressed(buttons, 8), 'toggleFlying', 'toggle-flying');

        return {
            move: stick,
            turnX,
            vertical,
        };
    }

    function getXrFlightState(inputSources = []) {
        let leftX = 0;
        let leftY = 0;
        let rightX = 0;
        let leftTrigger = 0;
        let rightTrigger = 0;
        let fallbackStickCount = 0;
        let fallbackTriggerCount = 0;

        for (const source of inputSources) {
            if (!source || !source.gamepad) continue;
            const stick = getPrimaryStickAxes(source.gamepad);
            const triggerValue = getButtonValue(source.gamepad.buttons, 0);
            if (source.handedness === 'left') {
                leftX = stick.x;
                leftY = stick.y;
                leftTrigger = triggerValue;
            } else if (source.handedness === 'right') {
                rightX = stick.x;
                rightTrigger = triggerValue;
            } else {
                if (fallbackStickCount === 0) {
                    leftX = stick.x;
                    leftY = stick.y;
                } else if (fallbackStickCount === 1) {
                    rightX = stick.x;
                }
                fallbackStickCount += 1;
                if (fallbackTriggerCount === 0) {
                    leftTrigger = triggerValue;
                } else if (fallbackTriggerCount === 1) {
                    rightTrigger = triggerValue;
                }
                fallbackTriggerCount += 1;
            }
        }

        return {
            moveX: leftX,
            moveY: leftY,
            turnX: rightX,
            vertical: rightTrigger - leftTrigger,
        };
    }

    return {
        applyDeadzone,
        getPrimaryStickAxes,
        getXrFlightState,
        handleKeyboardEvent,
        syncGamepad,
        clearGamepadState,
    };
}
