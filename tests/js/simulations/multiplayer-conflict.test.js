const { runSimulation, runBurst } = require('./simulationHarness');
const { expectDeterministicRunPair } = require('./simAssertionUtils');

describe('Simulation: Multiplayer Conflict and Performance Invariants', () => {
  test('should resolve simultaneous multi-client actions with stable outcome', () => {
    recordVerification({
      system: 'simulation',
      guarantee: 'multiplayer-conflict',
      label: 'simultaneous multi-client stable outcome',
    });

    const actions = [
      { id: 'start', source: 'dm', type: 'network:combat-start', logicalTick: 0, timelineId: 'combat-multi' },
      { id: 'p1-a1', source: 'p1', targetId: 'e1', type: 'action:attack', logicalTick: 5, initiative: 10, baseDamage: 2 },
      { id: 'p2-a1', source: 'p2', targetId: 'e1', type: 'action:attack', logicalTick: 5, initiative: 12, baseDamage: 2 },
      { id: 'p3-a1', source: 'p3', targetId: 'e1', type: 'action:attack', logicalTick: 5, initiative: 8, baseDamage: 3 },
      { id: 'p4-a1', source: 'p4', targetId: 'e1', type: 'action:attack', logicalTick: 5, initiative: 9, baseDamage: 3 },
    ];

    const run = runSimulation({
      players: [
        { id: 'p1', hp: 20 },
        { id: 'p2', hp: 20 },
        { id: 'p3', hp: 20 },
        { id: 'p4', hp: 20 },
      ],
      enemies: [{ id: 'e1', hp: 40 }],
      actions,
      seed: 444,
    });

    expect(run.state.inCombat).toBe(true);
    expect(run.state.actors.e1.hp).toBeLessThan(40);
    expect(run.processed.length).toBe(5);
  });

  test.each([111, 444, 2029])('should resolve multi-turn conflicts deterministically across seed %i', (seed) => {
    recordVerification({
      system: 'simulation',
      guarantee: 'multiplayer-conflict',
      label: `multi-turn conflict seed ${seed}`,
    });

    const runA = runSimulation({
      players: [
        { id: 'p1', hp: 24 },
        { id: 'p2', hp: 24 },
        { id: 'p3', hp: 22 },
        { id: 'p4', hp: 22 },
      ],
      enemies: [{ id: 'e1', hp: 40 }, { id: 'e2', hp: 36 }],
      turns: 20,
      seed,
    });

    const runB = runSimulation({
      players: [
        { id: 'p1', hp: 24 },
        { id: 'p2', hp: 24 },
        { id: 'p3', hp: 22 },
        { id: 'p4', hp: 22 },
      ],
      enemies: [{ id: 'e1', hp: 40 }, { id: 'e2', hp: 36 }],
      turns: 20,
      seed,
    });

    expectDeterministicRunPair(runA, runB);
    expect(runA.state.inCombat).toBe(true);
    expect(runA.state.combat.turn).toBe(21);
  });

  test('should keep mixed authority transitions stable during multiplayer conflict', () => {
    recordVerification({
      system: 'simulation',
      guarantee: 'multiplayer-conflict',
      label: 'mixed authority multiplayer stability',
    });

    const actions = [
      { id: 'mode-dm', source: 'dm', type: 'mode-change', logicalTick: 0, initiative: 80 },
      { id: 'auth-dm', source: 'dm', type: 'authority-set', logicalTick: 1, initiative: 79 },
      { id: 'start', source: 'dm', type: 'network:combat-start', logicalTick: 2, timelineId: 'mix-authority-1', initiative: 78 },
      { id: 'p1', source: 'p1', targetId: 'e1', type: 'action:attack', logicalTick: 3, initiative: 10, baseDamage: 4 },
      { id: 'mode-player', source: 'player', type: 'mode-change', logicalTick: 4, initiative: 77 },
      { id: 'bad-auth', source: 'p2', type: 'authority-set', logicalTick: 5, initiative: 76 },
      { id: 'p2', source: 'p2', targetId: 'e1', type: 'action:attack', logicalTick: 6, initiative: 9, baseDamage: 3 },
    ];

    const run = runSimulation({
      players: [{ id: 'p1', hp: 22 }, { id: 'p2', hp: 22 }],
      enemies: [{ id: 'e1', hp: 20 }],
      actions,
      seed: 919,
    });

    expect(run.state.authority).toBe('server');
    expect(run.state.dmAuthorityLayer).toBe('observer');
    expect(run.state.actors.e1.hp).toBeLessThan(20);
  });

  test('should reject non-DM authority escalation attempt', () => {
    recordVerification({
      system: 'simulation',
      guarantee: 'multiplayer-conflict',
      label: 'authority escalation blocked',
    });

    const actions = [
      { id: 'mode-player', source: 'player', type: 'mode-change', logicalTick: 1 },
      { id: 'bad-auth', source: 'p1', type: 'authority-set', logicalTick: 2 },
    ];

    const run = runSimulation({ actions, seed: 11 });

    expect(run.state.mode).toBe('player');
    expect(run.state.authority).toBe('server');
    expect(run.state.dmAuthorityLayer).toBe('observer');
    expect(run.state.ui.availableCommands).not.toEqual(
      expect.arrayContaining(['set-hp', 'spawn-entity'])
    );
  });

  test('should handle 100 rapid actions under frame budget invariant', () => {
    recordVerification({
      system: 'simulation',
      guarantee: 'performance',
      label: 'burst 100 under frame budget',
    });

    const burst = runBurst(100, 1701);

    expect(burst.queueSize).toBe(101);
    expect(burst.processed).toBeGreaterThan(50);
    expect(burst.elapsedMs).toBeLessThan(16);
  });

  test('should cap event queue growth for large bursts', () => {
    recordVerification({
      system: 'simulation',
      guarantee: 'performance',
      label: 'queue growth capped under burst',
    });

    const burst = runBurst(200, 88);

    expect(burst.queueSize).toBeLessThanOrEqual(220);
    expect(burst.result.state.timeline.id).toBe('combat-burst');
  });

  test('should sustain mixed combat/network workload under bounded average cost', () => {
    recordVerification({
      system: 'simulation',
      guarantee: 'performance',
      label: 'sustained mixed workload bounded average cost',
    });

    const rounds = 20;
    const samples = [];

    for (let i = 0; i < rounds; i += 1) {
      const start = performance.now();
      const burst = runBurst(60, 500 + i);
      const sim = runSimulation({
        seed: 900 + i,
        players: [{ id: 'p1', hp: 20 }, { id: 'p2', hp: 20 }, { id: 'p3', hp: 20 }],
        enemies: [{ id: 'e1', hp: 30 }, { id: 'e2', hp: 30 }],
        turns: 12,
        chaos: {
          delay: true,
          reorder: true,
          duplicate: true,
          drop: false,
        },
      });
      const elapsed = performance.now() - start;
      samples.push(elapsed);

      expect(burst.processed).toBeGreaterThan(30);
      expect(sim.timeline.events.length).toBeGreaterThan(30);
    }

    const avg = samples.reduce((acc, v) => acc + v, 0) / samples.length;
    const max = Math.max(...samples);

    expect(avg).toBeLessThan(14);
    expect(max).toBeLessThan(25);
  });

  test('should avoid degradation drift across sustained windows', () => {
    recordVerification({
      system: 'simulation',
      guarantee: 'performance',
      label: 'sustained window degradation check',
    });

    const windowSamples = [];

    for (let window = 0; window < 3; window += 1) {
      const t0 = performance.now();
      for (let i = 0; i < 10; i += 1) {
        runSimulation({
          seed: 1200 + (window * 10) + i,
          players: [{ id: 'p1', hp: 24 }, { id: 'p2', hp: 24 }],
          enemies: [{ id: 'e1', hp: 24 }, { id: 'e2', hp: 24 }],
          turns: 20,
          chaos: {
            delay: true,
            reorder: true,
            duplicate: true,
            drop: true,
          },
        });
      }
      windowSamples.push(performance.now() - t0);
    }

    const first = windowSamples[0];
    const last = windowSamples[windowSamples.length - 1];

    // Guard against obvious sustained-time degradation.
    expect(last).toBeLessThan(first * 1.8);
  });
});
