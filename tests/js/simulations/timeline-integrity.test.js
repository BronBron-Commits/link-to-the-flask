const { runSimulation, rollbackAndReplay, replayFromLog } = require('./simulationHarness');

describe('Simulation: Timeline Integrity and Rollback', () => {
  test('timeline events are strictly ordered and non-overlapping', () => {
    const { timeline } = runSimulation({
      seed: 7,
      players: [{ id: 'p1', hp: 20 }, { id: 'p2', hp: 20 }],
      enemies: [{ id: 'e1', hp: 24 }],
      turns: 12,
    });

    expect(timeline.events.length).toBeGreaterThan(20);

    for (let i = 1; i < timeline.events.length; i += 1) {
      const prev = timeline.events[i - 1];
      const cur = timeline.events[i];
      expect(cur.tick).toBeGreaterThanOrEqual(prev.tick);
      expect(cur.startMs).toBeGreaterThanOrEqual(prev.endMs);
      expect(cur.endMs).toBeGreaterThan(cur.startMs);
    }
  });

  test('rollback produces identical state', () => {
    const sim = runSimulation({
      seed: 1337,
      players: [{ id: 'p1', hp: 24 }, { id: 'p2', hp: 22 }],
      enemies: [{ id: 'e1', hp: 25 }, { id: 'e2', hp: 18 }],
      turns: 20,
    });

    const rollback = rollbackAndReplay(sim.log, Math.floor(sim.log.length / 2), 1337, sim.context);
    const replay = replayFromLog(sim.log, 1337, sim.context);

    expect(rollback.finalReplay.state).toEqual(sim.state);
    expect(replay.state).toEqual(sim.state);
    expect(replay.timeline).toEqual(sim.timeline);
  });
});
