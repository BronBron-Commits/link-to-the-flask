const { runSimulation } = require('./simulationHarness');

describe('Simulation: Chaos and Network Fault Injection', () => {
  test('should resolve out-of-order combat events deterministically', () => {
    const validSequence = [
      { id: 's0', source: 'dm', type: 'network:combat-start', logicalTick: 0, timelineId: 'combat-chaos' },
      { id: 'a1', source: 'p1', targetId: 'e1', type: 'action:attack', logicalTick: 1, initiative: 10, baseDamage: 3 },
      { id: 'a2', source: 'p2', targetId: 'e1', type: 'action:attack', logicalTick: 2, initiative: 9, baseDamage: 4 },
      { id: 'a3', source: 'e1', targetId: 'p1', type: 'action:attack', logicalTick: 3, initiative: 11, baseDamage: 2 },
    ];

    const shuffled = [validSequence[0], validSequence[2], validSequence[1], validSequence[3]];

    const expected = runSimulation({ actions: validSequence, seed: 65 });
    const outOfOrder = runSimulation({ actions: shuffled, seed: 65 });

    expect(outOfOrder.state).toEqual(expected.state);
  });

  test('should remain deterministic under duplicate, delayed, dropped, and reordered packets', () => {
    const actions = [
      { id: 'start', source: 'dm', type: 'network:combat-start', logicalTick: 0, timelineId: 'combat-chaos-2' },
      { id: 'm1', source: 'p1', targetId: 'e1', type: 'action:attack', logicalTick: 1, baseDamage: 3, initiative: 7 },
      { id: 'm2', source: 'p2', targetId: 'e1', type: 'action:attack', logicalTick: 2, baseDamage: 2, initiative: 12 },
      { id: 'm3', source: 'e1', targetId: 'p2', type: 'action:attack', logicalTick: 3, baseDamage: 4, initiative: 14 },
      { id: 'm4', source: 'p1', targetId: 'e1', type: 'action:attack', logicalTick: 4, baseDamage: 5, initiative: 7 },
    ];

    const run1 = runSimulation({
      actions,
      seed: 2026,
      chaos: { delay: true, reorder: true, duplicate: true, drop: true },
    });

    const run2 = runSimulation({
      actions,
      seed: 2026,
      chaos: { delay: true, reorder: true, duplicate: true, drop: true },
    });

    expect(run1.state).toEqual(run2.state);
    expect(run1.processed).toEqual(run2.processed);
    expect(run1.droppedDuplicates).toEqual(run2.droppedDuplicates);
    expect(run1.state.timeline.id).toBeTruthy();
  });
});
