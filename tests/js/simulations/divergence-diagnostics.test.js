const { runSimulation } = require('./simulationHarness');
const { expectDeterministicRunPair } = require('./simAssertionUtils');

describe('Simulation: Divergence Diagnostics', () => {
  test('should report divergence tick and event mismatch context', () => {
    const actions = [
      { id: 'start', source: 'dm', type: 'network:combat-start', logicalTick: 0, timelineId: 'diag-1' },
      { id: 'a1', source: 'p1', targetId: 'e1', type: 'action:attack', logicalTick: 1, initiative: 10, baseDamage: 4 },
      { id: 'a2', source: 'e1', targetId: 'p1', type: 'action:attack', logicalTick: 2, initiative: 9, baseDamage: 3 },
    ];

    const runA = runSimulation({ seed: 42, actions });
    const runB = runSimulation({ seed: 42, actions });
    runB.timeline.events[1].tick += 4;

    expect(() => expectDeterministicRunPair(runA, runB)).toThrow(/Divergence at tick|event index|Expected event|Actual event/);
  });

  test('should report actor-level state mismatch context', () => {
    const actions = [
      { id: 'start', source: 'dm', type: 'network:combat-start', logicalTick: 0, timelineId: 'diag-2' },
      { id: 'a1', source: 'p1', targetId: 'e1', type: 'action:attack', logicalTick: 1, initiative: 10, baseDamage: 4 },
    ];

    const runA = runSimulation({ seed: 51, actions });
    const runB = runSimulation({ seed: 51, actions });
    runB.state.actors.e1.hp += 2;

    expect(() => expectDeterministicRunPair(runA, runB)).toThrow(/Actor e1 differs on hp|Expected|Actual/);
  });
});
