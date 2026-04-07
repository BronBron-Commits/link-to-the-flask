const { runSimulation } = require('./simulationHarness');

describe('Simulation: Combat Full Flow', () => {
  test('should propagate combat-start from network -> state -> UI', () => {
    const actions = [
      {
        id: 'evt-start',
        source: 'dm',
        type: 'network:combat-start',
        logicalTick: 1,
        timelineId: 'combat-session-100',
      },
    ];

    const { state } = runSimulation({ actions, seed: 1 });

    expect(state.inCombat).toBe(true);
    expect(state.modeDomain).toBe('combat');
    expect(state.ui.combatVisible).toBe(true);
    expect(state.ui.timelineLabel).toBe('combat-session-100');
    expect(state.ui.cameraMode).toBe('follow');
  });

  test('should propagate mode change -> authority change -> command availability', () => {
    const actions = [
      {
        id: 'evt-mode',
        source: 'dm',
        type: 'mode-change',
        logicalTick: 1,
      },
      {
        id: 'evt-auth',
        source: 'dm',
        type: 'authority-set',
        logicalTick: 2,
      },
    ];

    const { state } = runSimulation({ actions, seed: 2 });

    expect(state.mode).toBe('dm');
    expect(state.authority).toBe('local-dm');
    expect(state.dmAuthorityLayer).toBe('simulator');
    expect(state.ui.availableCommands).toEqual(
      expect.arrayContaining(['step-turn', 'end-turn', 'set-hp', 'spawn-entity'])
    );
  });

  test('should synchronize combat start with camera and timeline under DM mode', () => {
    const actions = [
      {
        id: 'evt-mode-dm',
        source: 'dm',
        type: 'mode-change',
        logicalTick: 1,
      },
      {
        id: 'evt-combat',
        source: 'dm',
        type: 'network:combat-start',
        logicalTick: 2,
        timelineId: 'combat-dm-1',
      },
    ];

    const { state } = runSimulation({ actions, seed: 3 });

    expect(state.inCombat).toBe(true);
    expect(state.timeline.id).toBe('combat-dm-1');
    expect(state.ui.timelineLabel).toBe('combat-dm-1');
    expect(state.ui.cameraMode).toBe('tactical');
    expect(state.ui.combatVisible).toBe(true);
  });
});
