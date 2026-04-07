const { runSimulation, replayFromLog, buildLongRunActions } = require('./simulationHarness');
const { expectDeterministicRunPair } = require('./simAssertionUtils');

describe('Simulation: Replay Determinism', () => {
  test('should produce identical state for identical action sequences', () => {
    recordVerification({
      system: 'simulation',
      guarantee: 'determinism',
      label: 'same input same output',
    });

    const actions = [
      { id: 's0', source: 'dm', type: 'network:combat-start', logicalTick: 0, timelineId: 'combat-abc' },
      { id: 'a1', source: 'p1', targetId: 'e1', type: 'action:attack', logicalTick: 1, baseDamage: 4, initiative: 15 },
      { id: 'a2', source: 'p2', targetId: 'e1', type: 'action:attack', logicalTick: 2, baseDamage: 3, initiative: 11 },
      { id: 't1', source: 'dm', type: 'turn:end', logicalTick: 3 },
    ];

    const run1 = runSimulation({ actions, seed: 42 });
    const run2 = runSimulation({ actions, seed: 42 });

    expectDeterministicRunPair(run1, run2);
  });

  test('should reproduce identical final state from replay log', () => {
    recordVerification({
      system: 'simulation',
      guarantee: 'replay',
      label: 'replay log consistency',
    });

    const actions = [
      { id: 's0', source: 'dm', type: 'network:combat-start', logicalTick: 0, timelineId: 'combat-r1' },
      { id: 'a1', source: 'p1', targetId: 'e1', type: 'action:attack', logicalTick: 1, baseDamage: 5, initiative: 14 },
      { id: 'a2', source: 'p2', targetId: 'e1', type: 'action:attack', logicalTick: 2, baseDamage: 2, initiative: 9 },
      { id: 'a3', source: 'e1', targetId: 'p1', type: 'action:attack', logicalTick: 3, baseDamage: 3, initiative: 12 },
    ];

    const baseline = runSimulation({ actions, seed: 88 });
    const replay = replayFromLog(actions, 88);

    expectDeterministicRunPair(replay, baseline);
    expect(replay.droppedDuplicates).toEqual(baseline.droppedDuplicates);
  });

  test('should resolve different client arrival order to same deterministic state', () => {
    recordVerification({
      system: 'simulation',
      guarantee: 'order-independence',
      label: 'client order independence',
    });

    const ordered = [
      { id: 's0', source: 'dm', type: 'network:combat-start', logicalTick: 0, timelineId: 'combat-order' },
      { id: 'c1-a', source: 'p1', targetId: 'e1', type: 'action:attack', logicalTick: 10, baseDamage: 3, initiative: 8 },
      { id: 'c2-a', source: 'p2', targetId: 'e1', type: 'action:attack', logicalTick: 10, baseDamage: 3, initiative: 12 },
      { id: 'c1-b', source: 'p1', targetId: 'e1', type: 'action:attack', logicalTick: 11, baseDamage: 4, initiative: 8 },
    ];

    const shuffled = [ordered[0], ordered[3], ordered[1], ordered[2]];

    const runOrdered = runSimulation({ actions: ordered, seed: 1234 });
    const runShuffled = runSimulation({ actions: shuffled, seed: 1234 });

    expectDeterministicRunPair(runShuffled, runOrdered);
  });

  test.each([1, 7, 42, 88, 1337])('should remain deterministic across seed %i for long-run combat', (seed) => {
    recordVerification({
      system: 'simulation',
      guarantee: 'determinism',
      label: `long-run seed ${seed}`,
    });

    const cfg = {
      seed,
      players: [
        { id: 'p1', hp: 28 },
        { id: 'p2', hp: 24 },
        { id: 'p3', hp: 22 },
      ],
      enemies: [
        { id: 'e1', hp: 24 },
        { id: 'e2', hp: 24 },
      ],
      turns: 40,
    };

    const run1 = runSimulation(cfg);
    const run2 = runSimulation(cfg);
    expectDeterministicRunPair(run1, run2);
  });

  test('should preserve replay correctness with mixed action types', () => {
    recordVerification({
      system: 'simulation',
      guarantee: 'replay',
      label: 'mixed action replay consistency',
    });

    const actions = [
      { id: 'mode-dm', source: 'dm', type: 'mode-change', logicalTick: 0, initiative: 50 },
      { id: 'auth-dm', source: 'dm', type: 'authority-set', logicalTick: 1, initiative: 49 },
      { id: 'start', source: 'dm', type: 'network:combat-start', logicalTick: 2, timelineId: 'mix-001', initiative: 48 },
      { id: 'p1', source: 'p1', targetId: 'e1', type: 'action:attack', logicalTick: 3, baseDamage: 5, initiative: 12 },
      { id: 'e1', source: 'e1', targetId: 'p1', type: 'action:attack', logicalTick: 4, baseDamage: 3, initiative: 11 },
      { id: 'end1', source: 'dm', type: 'turn:end', logicalTick: 5, initiative: -1 },
      { id: 'p2', source: 'p2', targetId: 'e1', type: 'action:attack', logicalTick: 6, baseDamage: 4, initiative: 13 },
    ];

    const baseline = runSimulation({
      seed: 2026,
      actions,
      players: [{ id: 'p1', hp: 20 }, { id: 'p2', hp: 20 }],
      enemies: [{ id: 'e1', hp: 25 }],
    });
    const replay = replayFromLog(actions, 2026, {
      players: [{ id: 'p1', hp: 20 }, { id: 'p2', hp: 20 }],
      enemies: [{ id: 'e1', hp: 25 }],
    });

    expectDeterministicRunPair(replay, baseline);
  });

  test('should keep deterministic results for larger entity counts', () => {
    recordVerification({
      system: 'simulation',
      guarantee: 'determinism',
      label: 'multi-entity deterministic run',
    });

    const cfg = {
      seed: 909,
      players: [
        { id: 'p1', hp: 30 },
        { id: 'p2', hp: 26 },
        { id: 'p3', hp: 22 },
        { id: 'p4', hp: 18 },
      ],
      enemies: [
        { id: 'e1', hp: 25 },
        { id: 'e2', hp: 22 },
        { id: 'e3', hp: 20 },
      ],
      turns: 30,
    };

    const runA = runSimulation(cfg);
    const runB = runSimulation(cfg);
    expectDeterministicRunPair(runA, runB);
  });

  test('should remain deterministic on edge HP and tie initiative cases', () => {
    recordVerification({
      system: 'simulation',
      guarantee: 'determinism',
      label: 'edge-case hp and initiative tie determinism',
    });

    const actions = [
      { id: 'start', source: 'dm', type: 'network:combat-start', logicalTick: 0, timelineId: 'edge-1' },
      { id: 'tie-a', source: 'p1', targetId: 'e1', type: 'action:attack', logicalTick: 1, initiative: 10, baseDamage: 1 },
      { id: 'tie-b', source: 'p2', targetId: 'e1', type: 'action:attack', logicalTick: 1, initiative: 10, baseDamage: 1 },
      { id: 'finisher', source: 'p1', targetId: 'e1', type: 'action:attack', logicalTick: 2, initiative: 10, baseDamage: 2 },
    ];

    const cfg = {
      seed: 515,
      actions,
      players: [{ id: 'p1', hp: 1 }, { id: 'p2', hp: 1 }],
      enemies: [{ id: 'e1', hp: 3 }],
    };

    const runA = runSimulation(cfg);
    const runB = runSimulation(cfg);
    expectDeterministicRunPair(runA, runB);
  });

  test.each([3, 19, 2027])('should replay long-run streams identically for seed %i', (seed) => {
    recordVerification({
      system: 'simulation',
      guarantee: 'replay',
      label: `long-run replay seed ${seed}`,
    });

    const players = [
      { id: 'p1', hp: 30 },
      { id: 'p2', hp: 26 },
      { id: 'p3', hp: 24 },
    ];
    const enemies = [
      { id: 'e1', hp: 24 },
      { id: 'e2', hp: 24 },
    ];
    const actions = buildLongRunActions(players, enemies, 60, `long-replay-${seed}`);

    const baseline = runSimulation({ seed, actions, players, enemies });
    const replay = replayFromLog(actions, seed, { players, enemies });
    expectDeterministicRunPair(replay, baseline);
  });

  test('should replay sustained 100-turn stream without drift', () => {
    recordVerification({
      system: 'simulation',
      guarantee: 'replay',
      label: '100-turn sustained replay parity',
    });

    const players = [
      { id: 'p1', hp: 34 },
      { id: 'p2', hp: 30 },
      { id: 'p3', hp: 26 },
      { id: 'p4', hp: 22 },
    ];
    const enemies = [
      { id: 'e1', hp: 30 },
      { id: 'e2', hp: 28 },
      { id: 'e3', hp: 24 },
    ];
    const actions = buildLongRunActions(players, enemies, 100, 'long-replay-100');

    const baseline = runSimulation({ seed: 404, actions, players, enemies });
    const replay = replayFromLog(actions, 404, { players, enemies });
    expectDeterministicRunPair(replay, baseline);

    expect(replay.timeline.events.length).toBeGreaterThan(700);
  });

  test('should resolve order independence with 4-client same-tick collisions', () => {
    recordVerification({
      system: 'simulation',
      guarantee: 'order-independence',
      label: '4-client same-tick collision order independence',
    });

    const ordered = [
      { id: 's0', source: 'dm', type: 'network:combat-start', logicalTick: 0, timelineId: 'collision-4' },
      { id: 'p1-a', source: 'p1', targetId: 'e1', type: 'action:attack', logicalTick: 8, initiative: 10, baseDamage: 3 },
      { id: 'p2-a', source: 'p2', targetId: 'e1', type: 'action:attack', logicalTick: 8, initiative: 10, baseDamage: 3 },
      { id: 'p3-a', source: 'p3', targetId: 'e1', type: 'action:attack', logicalTick: 8, initiative: 10, baseDamage: 3 },
      { id: 'p4-a', source: 'p4', targetId: 'e1', type: 'action:attack', logicalTick: 8, initiative: 10, baseDamage: 3 },
    ];

    const shuffled = [ordered[0], ordered[3], ordered[1], ordered[4], ordered[2]];

    const ctx = {
      players: [{ id: 'p1', hp: 20 }, { id: 'p2', hp: 20 }, { id: 'p3', hp: 20 }, { id: 'p4', hp: 20 }],
      enemies: [{ id: 'e1', hp: 35 }],
    };

    const runOrdered = runSimulation({ seed: 600, actions: ordered, ...ctx });
    const runShuffled = runSimulation({ seed: 600, actions: shuffled, ...ctx });
    expectDeterministicRunPair(runShuffled, runOrdered);
  });

  test('should resolve order independence with mixed priorities and initiative ties', () => {
    recordVerification({
      system: 'simulation',
      guarantee: 'order-independence',
      label: 'mixed priority tie order independence',
    });

    const ordered = [
      { id: 's0', source: 'dm', type: 'network:combat-start', logicalTick: 0, timelineId: 'mix-pri' },
      { id: 'mode', source: 'dm', type: 'mode-change', logicalTick: 1, initiative: 50 },
      { id: 'auth', source: 'dm', type: 'authority-set', logicalTick: 1, initiative: 49 },
      { id: 'a1', source: 'p1', targetId: 'e1', type: 'action:attack', logicalTick: 10, initiative: 9, baseDamage: 4 },
      { id: 'a2', source: 'p2', targetId: 'e1', type: 'action:attack', logicalTick: 10, initiative: 9, baseDamage: 4 },
      { id: 'end', source: 'dm', type: 'turn:end', logicalTick: 11, initiative: -99 },
    ];

    const shuffled = [ordered[0], ordered[4], ordered[2], ordered[1], ordered[3], ordered[5]];

    const ctx = {
      players: [{ id: 'p1', hp: 22 }, { id: 'p2', hp: 22 }],
      enemies: [{ id: 'e1', hp: 22 }],
    };

    const runOrdered = runSimulation({ seed: 701, actions: ordered, ...ctx });
    const runShuffled = runSimulation({ seed: 701, actions: shuffled, ...ctx });
    expectDeterministicRunPair(runShuffled, runOrdered);
  });
});
