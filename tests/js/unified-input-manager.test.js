const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadCreateUnifiedInputManager() {
  const filePath = path.resolve(__dirname, '../../static/map3d/managers/unifiedInputManager.js');
  let source = fs.readFileSync(filePath, 'utf8');
  source = source.replace('export function createUnifiedInputManager', 'function createUnifiedInputManager');
  source += '\nmodule.exports = { createUnifiedInputManager };\n';

  const context = {
    module: { exports: {} },
    exports: {},
    console,
    window: {},
    document: {},
    setTimeout,
    clearTimeout,
  };

  vm.runInNewContext(source, context, { filename: filePath });
  return context.module.exports.createUnifiedInputManager;
}

describe('Unified Input Manager', () => {
  let createUnifiedInputManager;
  let movementState;
  let dmMovementState;
  let turnState;
  let sprintState;
  let flightVerticalState;
  let jumpCount;
  let commands;
  let manager;

  beforeEach(() => {
    createUnifiedInputManager = loadCreateUnifiedInputManager();
    movementState = { forward: false, backward: false, left: false, right: false };
    dmMovementState = { forward: false, backward: false, left: false, right: false, up: false, down: false, fast: false };
    turnState = { left: false, right: false };
    sprintState = false;
    flightVerticalState = { up: false, down: false };
    jumpCount = 0;
    commands = [];

    manager = createUnifiedInputManager({
      setMovementFlags: (next) => { movementState = { ...movementState, ...next }; },
      setDmFreeMovementFlags: (next) => { dmMovementState = { ...dmMovementState, ...next }; },
      setTurnFlags: (next) => { turnState = { ...turnState, ...next }; },
      setSprint: (next) => { sprintState = !!next; },
      setFlightVerticalFlags: (next) => { flightVerticalState = { ...flightVerticalState, ...next }; },
      queueJump: () => { jumpCount += 1; },
      onCommand: (name, payload) => { commands.push({ name, payload }); },
    });
  });

  test('keyboard movement updates shared movement flags and resets on keyup', () => {
    const context = {
      canUseStandardMovementControls: true,
      combatMode: false,
      playerFlying: false,
      movementLocked: false,
    };

    expect(manager.handleKeyboardEvent({ code: 'KeyW', repeat: false }, 'down', context)).toBe(true);
    expect(movementState.forward).toBe(true);
    expect(movementState.backward).toBe(false);

    expect(manager.handleKeyboardEvent({ code: 'ShiftLeft', repeat: false }, 'down', context)).toBe(true);
    expect(sprintState).toBe(true);

    expect(manager.handleKeyboardEvent({ code: 'KeyW', repeat: false }, 'up', context)).toBe(true);
    expect(movementState.forward).toBe(false);

    expect(manager.handleKeyboardEvent({ code: 'ShiftLeft', repeat: false }, 'up', context)).toBe(true);
    expect(sprintState).toBe(false);
  });

  test('keyboard combat strafes become turn input instead of lateral move', () => {
    const context = {
      canUseStandardMovementControls: true,
      combatMode: true,
      playerFlying: false,
      movementLocked: false,
    };

    manager.handleKeyboardEvent({ code: 'KeyA', repeat: false }, 'down', context);
    expect(movementState.left).toBe(false);
    expect(turnState.left).toBe(true);

    manager.handleKeyboardEvent({ code: 'KeyD', repeat: false }, 'down', context);
    expect(movementState.right).toBe(false);
    expect(turnState.right).toBe(true);
  });

  test('keyboard action commands and jump route through behavior callbacks', () => {
    const context = {
      canUseStandardMovementControls: true,
      combatMode: false,
      playerFlying: false,
      movementLocked: false,
    };

    manager.handleKeyboardEvent({ code: 'Enter', repeat: false }, 'down', context);
    manager.handleKeyboardEvent({ code: 'Escape', repeat: false }, 'down', context);
    manager.handleKeyboardEvent({ code: 'KeyM', repeat: false }, 'down', context);
    manager.handleKeyboardEvent({ code: 'Space', repeat: false }, 'down', context);

    expect(commands.map((entry) => entry.name)).toEqual(['confirm', 'cancel', 'toggle-movement-radius']);
    expect(jumpCount).toBe(1);
  });

  test('gamepad maps left stick to move, right stick to turn, and emits confirm only on rising edge', () => {
    const gamepad = {
      connected: true,
      axes: [0.72, -0.91, 0.66, 0.02],
      buttons: [
        { pressed: true, value: 1 },
        { pressed: false, value: 0 },
        { pressed: false, value: 0 },
        { pressed: false, value: 0 },
        { pressed: false, value: 0 },
        { pressed: true, value: 1 },
        { pressed: false, value: 0 },
        { pressed: false, value: 0 },
        { pressed: false, value: 0 },
        { pressed: false, value: 0 },
      ],
    };

    manager.syncGamepad(gamepad, {
      canUseStandardMovementControls: true,
      combatMode: false,
      playerFlying: false,
      movementLocked: false,
    });

    expect(movementState.forward).toBe(true);
    expect(movementState.right).toBe(true);
    expect(turnState.right).toBe(true);
    expect(sprintState).toBe(true);
    expect(commands.filter((entry) => entry.name === 'confirm')).toHaveLength(1);

    manager.syncGamepad(gamepad, {
      canUseStandardMovementControls: true,
      combatMode: false,
      playerFlying: false,
      movementLocked: false,
    });

    expect(commands.filter((entry) => entry.name === 'confirm')).toHaveLength(1);
  });

  test('gamepad respects movement lock and does not leave stale move state active', () => {
    const gamepad = {
      connected: true,
      axes: [-0.8, -0.9, 0, 0],
      buttons: [],
    };

    manager.syncGamepad(gamepad, {
      canUseStandardMovementControls: true,
      combatMode: false,
      playerFlying: false,
      movementLocked: true,
    });

    expect(movementState.forward).toBe(false);
    expect(movementState.left).toBe(false);
    expect(turnState.left).toBe(false);
    expect(turnState.right).toBe(false);
  });

  test('xr input sources normalize handed movement, turn, and vertical triggers', () => {
    const xrState = manager.getXrFlightState([
      {
        handedness: 'left',
        gamepad: {
          axes: [0.35, -0.8, 0, 0],
          buttons: [{ value: 0.15 }],
        },
      },
      {
        handedness: 'right',
        gamepad: {
          axes: [0.55, 0.1, 0, 0],
          buttons: [{ value: 0.9 }],
        },
      },
    ]);

    expect(xrState.moveX).toBeCloseTo(0.35);
    expect(xrState.moveY).toBeCloseTo(-0.8);
    expect(xrState.turnX).toBeCloseTo(0.55);
    expect(xrState.vertical).toBeCloseTo(0.75);
  });

  test('dm free camera keyboard input maps to DM movement state', () => {
    manager.handleKeyboardEvent({ code: 'KeyW', repeat: false }, 'down', {
      isDmFreeCamera: true,
    });
    manager.handleKeyboardEvent({ code: 'Space', repeat: false }, 'down', {
      isDmFreeCamera: true,
    });
    manager.handleKeyboardEvent({ code: 'ShiftLeft', repeat: false }, 'down', {
      isDmFreeCamera: true,
    });

    expect(dmMovementState.forward).toBe(true);
    expect(dmMovementState.up).toBe(true);
    expect(dmMovementState.fast).toBe(true);
  });
});
