const { runSimulation, buildLongRunActions, replayFromLog } = require('./simulationHarness');
const { expectDeterministicRunPair } = require('./simAssertionUtils');

describe('Simulation: Long-Run Stability', () => {
  test('should remain stable over 100-turn sustained event stream', () => {
    recordVerification({
      system: 'simulation',
      guarantee: 'determinism',
      label: '100-turn sustained stability',
    });

    const players = [
      { id: 'p1', hp: 36 },
      { id: 'p2', hp: 32 },
      { id: 'p3', hp: 28 },
      { id: 'p4', hp: 24 },
    ];
    const enemies = [
      { id: 'e1', hp: 32 },
      { id: 'e2', hp: 30 },
      { id: 'e3', hp: 28 },
      { id: 'e4', hp: 26 },
    ];

    const actions = buildLongRunActions(players, enemies, 100, 'sustain-100');

    const run1 = runSimulation({ seed: 989, actions, players, enemies });
    const run2 = runSimulation({ seed: 989, actions, players, enemies });

    expectDeterministicRunPair(run1, run2);
    expect(run1.timeline.events.length).toBeGreaterThan(850);
    expect(run1.state.combat.turn).toBe(101);

    const actorStates = Object.values(run1.state.actors);
    actorStates.forEach((actor) => {
      expect(Number.isFinite(actor.hp)).toBe(true);
      expect(actor.hp).toBeGreaterThanOrEqual(0);
      expect(actor.hp).toBeLessThanOrEqual(actor.maxHp);
    });

    for (let i = 1; i < run1.timeline.events.length; i += 1) {
      expect(run1.timeline.events[i].tick).toBeGreaterThanOrEqual(run1.timeline.events[i - 1].tick);
      expect(run1.timeline.events[i].startMs).toBeGreaterThanOrEqual(run1.timeline.events[i - 1].endMs);
    }
  });

  test('should keep replay parity for sustained 80-turn long-run stream', () => {
    recordVerification({
      system: 'simulation',
      guarantee: 'replay',
      label: 'long-run replay parity 80 turns',
    });

    const players = [{ id: 'p1', hp: 26 }, { id: 'p2', hp: 26 }, { id: 'p3', hp: 26 }];
    const enemies = [{ id: 'e1', hp: 24 }, { id: 'e2', hp: 24 }];
    const actions = buildLongRunActions(players, enemies, 80, 'longrun-80');

    const baseline = runSimulation({ seed: 1201, actions, players, enemies });
    const replay = replayFromLog(actions, 1201, { players, enemies });

    expectDeterministicRunPair(replay, baseline);
    expect(replay.timeline.events.length).toBeGreaterThan(450);
  });
});
