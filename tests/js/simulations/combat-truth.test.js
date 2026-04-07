const { runSimulation } = require('./simulationHarness');

describe('Simulation: Full Combat Truth Tests', () => {
  test('5-round combat produces expected outcome and rich timeline', () => {
    const { state, timeline, log } = runSimulation({
      seed: 42,
      players: [
        { id: 'player-1', hp: 28 },
        { id: 'player-2', hp: 24 },
      ],
      enemies: [
        { id: 'enemy-1', hp: 20 },
        { id: 'enemy-2', hp: 20 },
      ],
      turns: 50,
    });

    expect(state.inCombat).toBe(true);
    expect(state.combat.round).toBe(6);
    expect(state.combat.turn).toBe(51);
    expect(state.combat.actionCount).toBeGreaterThan(0);

    const enemyHpTotal = ['enemy-1', 'enemy-2']
      .map((id) => state.actors[id].hp)
      .reduce((acc, hp) => acc + hp, 0);
    expect(enemyHpTotal).toBeLessThanOrEqual(10);

    expect(timeline.events.length).toBeGreaterThan(100);
    expect(log.length).toBeGreaterThan(100);
    expect(state.ui.lastCombatMessage).toContain('hit');
  });

  test('turn order, sequencing, and timing alignment remain valid', () => {
    const actions = [
      { id: 'start', source: 'dm', type: 'network:combat-start', logicalTick: 0, timelineId: 'combat-check' },
      { id: 'p1-a', source: 'p1', targetId: 'e1', type: 'action:attack', logicalTick: 1, initiative: 10, baseDamage: 4 },
      { id: 'e1-a', source: 'e1', targetId: 'p1', type: 'action:attack', logicalTick: 2, initiative: 8, baseDamage: 3 },
      { id: 'turn-end-1', source: 'dm', type: 'turn:end', logicalTick: 3, initiative: -10 },
      { id: 'p1-b', source: 'p1', targetId: 'e1', type: 'action:attack', logicalTick: 4, initiative: 10, baseDamage: 5 },
    ];

    const { state, timeline } = runSimulation({
      seed: 99,
      players: [{ id: 'p1', hp: 25 }],
      enemies: [{ id: 'e1', hp: 22 }],
      actions,
    });

    expect(state.combat.turn).toBe(2);
    expect(state.combat.round).toBe(1);

    const attackEvents = timeline.events.filter((e) => e.type === 'action:attack');
    expect(attackEvents.length).toBe(3);
    attackEvents.forEach((e) => {
      expect(e.phaseSequence).toEqual(['windup', 'impact', 'resolve']);
      expect(e.durationMs).toBeGreaterThanOrEqual(4);
    });

    for (let i = 1; i < timeline.events.length; i += 1) {
      expect(timeline.events[i].startMs).toBeGreaterThanOrEqual(timeline.events[i - 1].endMs);
    }
  });
});
