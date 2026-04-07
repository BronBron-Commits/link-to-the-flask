const { runSimulation } = require('./simulationHarness');
const { expectDeterministicRunPair } = require('./simAssertionUtils');

describe('Simulation: Fuzz and Adversarial Packets', () => {
  test('should handle randomized invalid payload injection without crashes', () => {
    const iterations = 60;

    for (let i = 0; i < iterations; i += 1) {
      const actions = [
        { id: `start-${i}`, source: 'dm', type: 'network:combat-start', logicalTick: 0, timelineId: `fz-${i}` },
        { id: `bad-${i}`, source: null, type: i % 2 === 0 ? 'action:attack' : null, logicalTick: i + 1, targetId: undefined, baseDamage: Number.NaN },
        { id: `weird-${i}`, source: 'p1', type: 'action:attack', logicalTick: i + 2, targetId: i % 3 === 0 ? 'missing' : 'e1', baseDamage: i % 5 === 0 ? -99 : 3 },
      ];

      expect(() => runSimulation({
        seed: 9000 + i,
        players: [{ id: 'p1', hp: 20 }],
        enemies: [{ id: 'e1', hp: 20 }],
        actions,
        chaos: { delay: true, reorder: true, duplicate: true, drop: true },
      })).not.toThrow();
    }
  });

  test('should remain deterministic under adversarial packet storms with same seed', () => {
    const actions = [];
    actions.push({ id: 'start', source: 'dm', type: 'network:combat-start', logicalTick: 0, timelineId: 'storm' });

    for (let i = 0; i < 180; i += 1) {
      actions.push({
        id: `pkt-${i}`,
        source: i % 4 === 0 ? 'p1' : i % 4 === 1 ? 'p2' : i % 4 === 2 ? 'e1' : 'e2',
        targetId: i % 2 === 0 ? 'e1' : 'p1',
        type: 'action:attack',
        logicalTick: 1 + Math.floor(i / 2),
        initiative: i % 13,
        baseDamage: 1 + (i % 5),
      });
    }

    const cfg = {
      seed: 121212,
      players: [{ id: 'p1', hp: 28 }, { id: 'p2', hp: 24 }],
      enemies: [{ id: 'e1', hp: 30 }, { id: 'e2', hp: 30 }],
      actions,
      chaos: { delay: true, reorder: true, duplicate: true, drop: true },
    };

    const runA = runSimulation(cfg);
    const runB = runSimulation(cfg);

    expectDeterministicRunPair(runA, runB);
    expect(runA.timeline.events.length).toBeGreaterThan(30);
  });

  test('should keep timeline monotonically ordered after packet reordering fuzz', () => {
    const actions = [
      { id: 'start', source: 'dm', type: 'network:combat-start', logicalTick: 0, timelineId: 'order-fuzz' },
    ];

    for (let i = 0; i < 120; i += 1) {
      actions.push({
        id: `o-${i}`,
        source: i % 2 === 0 ? 'p1' : 'e1',
        targetId: i % 2 === 0 ? 'e1' : 'p1',
        type: 'action:attack',
        logicalTick: 1 + (i % 30),
        initiative: i % 7,
        baseDamage: 2,
      });
    }

    const run = runSimulation({
      seed: 31337,
      players: [{ id: 'p1', hp: 30 }],
      enemies: [{ id: 'e1', hp: 30 }],
      actions,
      chaos: { delay: true, reorder: true, duplicate: true, drop: false },
    });

    for (let i = 1; i < run.timeline.events.length; i += 1) {
      expect(run.timeline.events[i].tick).toBeGreaterThanOrEqual(run.timeline.events[i - 1].tick);
      expect(run.timeline.events[i].startMs).toBeGreaterThanOrEqual(run.timeline.events[i - 1].endMs);
    }
  });
});
