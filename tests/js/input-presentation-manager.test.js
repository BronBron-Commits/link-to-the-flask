const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadCreateInputPresentationManager() {
  const filePath = path.resolve(__dirname, '../../static/map3d/managers/inputPresentationManager.js');
  let source = fs.readFileSync(filePath, 'utf8');
  source = source.replace('export function createInputPresentationManager', 'function createInputPresentationManager');
  source += '\nmodule.exports = { createInputPresentationManager };\n';

  const context = {
    module: { exports: {} },
    exports: {},
    console,
    window: { setTimeout, clearTimeout },
    document: {},
  };

  vm.runInNewContext(source, context, { filename: filePath });
  return context.module.exports.createInputPresentationManager;
}

describe('Input Presentation Manager', () => {
  let createInputPresentationManager;
  let scheduled;
  let shown;
  let focused;
  let snaps;
  let flashes;
  let shakes;
  let phases;
  let phaseTransitions;
  let manager;

  function flushScheduled() {
    scheduled
      .slice()
      .sort((a, b) => a.delay - b.delay)
      .forEach((job) => job.fn());
  }

  beforeEach(() => {
    createInputPresentationManager = loadCreateInputPresentationManager();
    scheduled = [];
    shown = [];
    focused = [];
    snaps = 0;
    flashes = [];
    shakes = [];
    phases = [];
    phaseTransitions = [];

    manager = createInputPresentationManager({
      schedule: (fn, delay) => {
        const id = `timer-${scheduled.length + 1}`;
        scheduled.push({ id, fn, delay });
        return id;
      },
      cancelScheduled: jest.fn(),
      showFloatingText: (text, color, force, options) => shown.push({ text, color, force, options }),
      focusCameraOnAction: (target, options) => focused.push({ target, options }),
      playConfirmAttackSnap: () => { snaps += 1; },
      triggerCombatFlash: (color, alpha, durationMs) => flashes.push({ color, alpha, durationMs }),
      shakeScreen: (intensity, durationMs) => shakes.push({ intensity, durationMs }),
      setCombatUiPhase: (phase, details) => phases.push({ phase, details }),
      onPhaseTransition: (event) => phaseTransitions.push(event),
    });
  });

  test('queued attack schedules UI phase, camera focus, text, and flash', () => {
    const target = { position: { x: 1, y: 2, z: 3 } };
    manager.present(
      { kind: 'attack', outcome: 'queued', message: 'Attack queued: server' },
      { anchorObject: target, uiPhase: 'resolving', action: 'attack', color: '#ffd166' }
    );

    expect(phases).toEqual([{ phase: 'resolving', details: { action: 'attack' } }]);
    expect(scheduled).toHaveLength(2);

    flushScheduled();

    expect(snaps).toBe(1);
    expect(flashes[0]).toEqual({ color: '#ffd166', alpha: 0.08, durationMs: 180 });
    expect(focused[0].target).toBe(target);
    expect(shown[0].text).toBe('Attack queued: server');
    expect(shown[0].color).toBe('#ffd166');
  });

  test('blocked input presents immediate error feedback', () => {
    manager.present(
      { kind: 'move', outcome: 'blocked', message: 'Move blocked: movement locked' },
      { anchorObject: { position: { x: 0, y: 0, z: 0 } } }
    );

    expect(shown[0].text).toBe('Move blocked: movement locked');
    expect(shown[0].color).toBe('#ff8a8a');
    expect(flashes[0]).toEqual({ color: '#ff5a5a', alpha: 0.08, durationMs: 170 });
    expect(shakes[0]).toEqual({ intensity: 0.03, durationMs: 90 });
  });

  test('accepted attack schedules anticipation snap and follow-up focus', () => {
    const target = { position: { x: 4, y: 0, z: -2 } };
    manager.present(
      { kind: 'attack', outcome: 'accepted', message: 'Attack accepted: confirm' },
      { anchorObject: target, uiPhase: 'resolving', action: 'attack' }
    );

    expect(phases).toEqual([{ phase: 'resolving', details: { action: 'attack' } }]);
    expect(scheduled).toHaveLength(3);

    flushScheduled();

    expect(snaps).toBe(1);
    expect(flashes[0]).toEqual({ color: '#ffd166', alpha: 0.06, durationMs: 140 });
    expect(focused[0].target).toBe(target);
  });

  test('phase contract enforces minimum and hit-stop duration floor', () => {
    const contract = manager.getActionPhaseContract('attack', 'impact', {
      durationMs: 20,
      minMs: 60,
      animationMs: 50,
      hitStopMs: 120,
    });

    expect(contract.phase).toBe('impact');
    expect(contract.hitStopMs).toBe(120);
    expect(contract.durationMs).toBeGreaterThanOrEqual(136);
  });

  test('begin and end phase emit transition lifecycle events', () => {
    const contract = manager.beginActionPhase('attack', 'windup', {
      durationMs: 210,
      animationMs: 300,
      payload: { attackType: 'melee' },
    });
    manager.endActionPhase(contract, { done: true });

    expect(phases[0]).toEqual({
      phase: 'resolving',
      details: {
        action: 'attack',
        phase: 'windup',
        durationMs: 300,
      },
    });
    expect(phaseTransitions).toHaveLength(2);
    expect(phaseTransitions[0].state).toBe('start');
    expect(phaseTransitions[0].phase).toBe('windup');
    expect(phaseTransitions[1].state).toBe('end');
    expect(phaseTransitions[1].payload).toEqual({ done: true });
  });
});
