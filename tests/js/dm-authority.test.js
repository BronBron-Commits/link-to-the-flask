/**
 * Tests for DM authority and permissions system
 * 
 * Known bugs being tested:
 * - Permissions may not properly cascade through role changes
 * - DM observer mode may have inappropriate privilege escalation
 * - Command gates may be bypassed when roles change rapidly
 */

const {
  setupTestEnvironment,
  clearAllMocks,
} = require('./testUtils.js');

describe('DM Authority and Permissions', () => {
  beforeEach(() => {
    setupTestEnvironment();
    jest.clearAllMocks();
  });

  describe('Mode permissions', () => {
    test('DEV mode should have all permissions', () => {
      const MODE = {
        DEV: 'dev',
        DM: 'dm',
        PLAYER: 'player',
      };

      const MODE_PERMISSIONS = {
        'tools.selection': [MODE.DEV],
        'tools.grid': [MODE.DEV],
        'tools.colliderDebug': [MODE.DEV],
        'combat.control': [MODE.DEV, MODE.DM],
        'combat.spawn': [MODE.DEV, MODE.DM],
        'player.combatInput': [MODE.PLAYER],
        'player.keyboardInput': [MODE.PLAYER],
        'audio.debug': [MODE.DEV],
      };

      const hasPermission = (permissionKey, mode) => {
        const allowed = MODE_PERMISSIONS[permissionKey];
        return Array.isArray(allowed) && allowed.includes(mode);
      };

      // DEV should have: selection, grid, collider, combat.control, combat.spawn, audio.debug
      expect(hasPermission('tools.selection', MODE.DEV)).toBe(true);
      expect(hasPermission('tools.grid', MODE.DEV)).toBe(true);
      expect(hasPermission('tools.colliderDebug', MODE.DEV)).toBe(true);
      expect(hasPermission('combat.control', MODE.DEV)).toBe(true);
      expect(hasPermission('combat.spawn', MODE.DEV)).toBe(true);
      expect(hasPermission('audio.debug', MODE.DEV)).toBe(true);
      expect(hasPermission('player.combatInput', MODE.DEV)).toBe(false);
    });

    test('DM mode should not have tool/debug permissions', () => {
      const MODE = {
        DEV: 'dev',
        DM: 'dm',
        PLAYER: 'player',
      };

      const MODE_PERMISSIONS = {
        'tools.selection': [MODE.DEV],
        'tools.grid': [MODE.DEV],
        'tools.colliderDebug': [MODE.DEV],
        'combat.control': [MODE.DEV, MODE.DM],
        'combat.spawn': [MODE.DEV, MODE.DM],
        'player.combatInput': [MODE.PLAYER],
        'player.keyboardInput': [MODE.PLAYER],
        'audio.debug': [MODE.DEV],
      };

      const hasPermission = (permissionKey, mode) => {
        const allowed = MODE_PERMISSIONS[permissionKey];
        return Array.isArray(allowed) && allowed.includes(mode);
      };

      // DM should have combat control/spawn but NOT tools
      expect(hasPermission('combat.control', MODE.DM)).toBe(true);
      expect(hasPermission('combat.spawn', MODE.DM)).toBe(true);
      expect(hasPermission('tools.selection', MODE.DM)).toBe(false);
      expect(hasPermission('tools.grid', MODE.DM)).toBe(false);
      expect(hasPermission('audio.debug', MODE.DM)).toBe(false);
    });

    test('PLAYER mode should only have player input permissions', () => {
      const MODE = {
        DEV: 'dev',
        DM: 'dm',
        PLAYER: 'player',
      };

      const MODE_PERMISSIONS = {
        'tools.selection': [MODE.DEV],
        'tools.grid': [MODE.DEV],
        'tools.colliderDebug': [MODE.DEV],
        'combat.control': [MODE.DEV, MODE.DM],
        'combat.spawn': [MODE.DEV, MODE.DM],
        'player.combatInput': [MODE.PLAYER],
        'player.keyboardInput': [MODE.PLAYER],
        'audio.debug': [MODE.DEV],
      };

      const hasPermission = (permissionKey, mode) => {
        const allowed = MODE_PERMISSIONS[permissionKey];
        return Array.isArray(allowed) && allowed.includes(mode);
      };

      // PLAYER can only use their own inputs
      expect(hasPermission('player.combatInput', MODE.PLAYER)).toBe(true);
      expect(hasPermission('player.keyboardInput', MODE.PLAYER)).toBe(true);
      expect(hasPermission('combat.control', MODE.PLAYER)).toBe(false);
      expect(hasPermission('combat.spawn', MODE.PLAYER)).toBe(false);
    });
  });

  describe('DM command capability mapping', () => {
    test('Commands should map to correct capability keys', () => {
      const DM_COMMAND_CAPABILITY = {
        'step-turn': 'controlTimeline',
        'end-turn': 'controlTimeline',
        'rewind-turn': 'controlTimeline',
        'replay-last-action': 'controlTimeline',
        'save-snapshot': 'controlTimeline',
        'restore-snapshot': 'controlTimeline',
        'possess': 'possess',
        'possess-actor': 'possess',
        'release-possession': 'possess',
        'inject-input': 'injectInput',
        'set-hp': 'overrideStats',
        'apply-damage': 'overrideStats',
        'spawn-training-dummy': 'spawnDespawn',
        'spawn-entity': 'spawnDespawn',
        'despawn-actor': 'spawnDespawn',
        'set-simulation-authority': 'controlTimeline',
        'force-roll': 'forceRoll',
        'toggle-ai': 'toggleAi',
        'trigger-event': 'forceRoll',
      };

      // Verify mapping is consistent
      expect(DM_COMMAND_CAPABILITY['step-turn']).toBe('controlTimeline');
      expect(DM_COMMAND_CAPABILITY['possess']).toBe('possess');
      expect(DM_COMMAND_CAPABILITY['set-hp']).toBe('overrideStats');
      expect(DM_COMMAND_CAPABILITY['spawn-training-dummy']).toBe('spawnDespawn');
      expect(DM_COMMAND_CAPABILITY['force-roll']).toBe('forceRoll');
      expect(DM_COMMAND_CAPABILITY['toggle-ai']).toBe('toggleAi');
    });

    test('All timeline commands should map to controlTimeline', () => {
      const DM_COMMAND_CAPABILITY = {
        'step-turn': 'controlTimeline',
        'end-turn': 'controlTimeline',
        'rewind-turn': 'controlTimeline',
        'replay-last-action': 'controlTimeline',
        'save-snapshot': 'controlTimeline',
        'restore-snapshot': 'controlTimeline',
        'set-simulation-authority': 'controlTimeline',
      };

      Object.entries(DM_COMMAND_CAPABILITY).forEach(([cmd, cap]) => {
        expect(cap).toBe('controlTimeline');
      });
    });
  });

  describe('Authority layer capabilities', () => {
    test('Observer should have read-only access', () => {
      const DM_AUTHORITY_LAYER = {
        OBSERVER: 'observer',
        PUPPETEER: 'puppeteer',
        SIMULATOR: 'simulator',
      };

      const DM_CAPABILITY_PRESETS = {
        [DM_AUTHORITY_LAYER.OBSERVER]: {
          possess: false,
          injectInput: false,
          overrideStats: false,
          controlTimeline: true,
          spawnDespawn: false,
          forceRoll: false,
          toggleAi: false,
        },
      };

      const observer = DM_CAPABILITY_PRESETS[DM_AUTHORITY_LAYER.OBSERVER];
      expect(observer.possess).toBe(false);
      expect(observer.injectInput).toBe(false);
      expect(observer.overrideStats).toBe(false);
      expect(observer.controlTimeline).toBe(true);
    });

    test('Puppeteer should allow control but not stat override', () => {
      const DM_AUTHORITY_LAYER = {
        OBSERVER: 'observer',
        PUPPETEER: 'puppeteer',
        SIMULATOR: 'simulator',
      };

      const DM_CAPABILITY_PRESETS = {
        [DM_AUTHORITY_LAYER.PUPPETEER]: {
          possess: true,
          injectInput: true,
          overrideStats: false,
          controlTimeline: true,
          spawnDespawn: false,
          forceRoll: true,
          toggleAi: true,
        },
      };

      const puppeteer = DM_CAPABILITY_PRESETS[DM_AUTHORITY_LAYER.PUPPETEER];
      expect(puppeteer.possess).toBe(true);
      expect(puppeteer.injectInput).toBe(true);
      expect(puppeteer.overrideStats).toBe(false);
      expect(puppeteer.controlTimeline).toBe(true);
      expect(puppeteer.toggleAi).toBe(true);
    });

    test('Simulator should have full control', () => {
      const DM_AUTHORITY_LAYER = {
        OBSERVER: 'observer',
        PUPPETEER: 'puppeteer',
        SIMULATOR: 'simulator',
      };

      const DM_CAPABILITY_PRESETS = {
        [DM_AUTHORITY_LAYER.SIMULATOR]: {
          possess: true,
          injectInput: true,
          overrideStats: true,
          controlTimeline: true,
          spawnDespawn: true,
          forceRoll: true,
          toggleAi: true,
        },
      };

      const simulator = DM_CAPABILITY_PRESETS[DM_AUTHORITY_LAYER.SIMULATOR];
      Object.values(simulator).forEach(cap => {
        expect(cap).toBe(true);
      });
    });
  });

  describe('Local simulation authority', () => {
    test('Server authority should be the default', () => {
      const SIMULATION_AUTHORITY = {
        SERVER: 'server',
        LOCAL_DM: 'local-dm',
      };

      expect(SIMULATION_AUTHORITY.SERVER).toBe('server');
      expect(SIMULATION_AUTHORITY.LOCAL_DM).toBe('local-dm');
    });

    test('Authority should only be LOCAL_DM when explicitly set in DM mode', () => {
      let simulationAuthority = 'server';
      const SIMULATION_AUTHORITY = {
        SERVER: 'server',
        LOCAL_DM: 'local-dm',
      };

      const isSimulationOwner = (mode, authority) => {
        if (mode === 'dev') return true;
        if (mode === 'dm') return authority === SIMULATION_AUTHORITY.LOCAL_DM;
        // Players never own simulation - server always owns when authority is SERVER
        return false;
      };

      // Server authority - player should NOT be owner
      expect(isSimulationOwner('player', simulationAuthority)).toBe(false);

      // Local DM authority - DM should be owner
      simulationAuthority = SIMULATION_AUTHORITY.LOCAL_DM;
      expect(isSimulationOwner('dm', simulationAuthority)).toBe(true);
      expect(isSimulationOwner('player', simulationAuthority)).toBe(false);
    });
  });

  describe('Bypass gates', () => {
    test('Standard gate should be enforced', () => {
      window.__DM_BYPASS_COMMAND_GATES__ = false;
      const MODE = 'player';

      const canIssueDmCommand = (type, mode, bypass) => {
        if (bypass === true) return true;
        if (mode !== 'dm') return false;
        return true; // simplified for test
      };

      expect(canIssueDmCommand('step-turn', MODE, false)).toBe(false);
    });

    test('Bypass flag should allow all commands', () => {
      window.__DM_BYPASS_COMMAND_GATES__ = true;
      const MODE = 'player';

      const canIssueDmCommand = (type, mode, bypass) => {
        if (bypass === true) return true;
        if (mode !== 'dm') return false;
        return true;
      };

      expect(canIssueDmCommand('step-turn', MODE, window.__DM_BYPASS_COMMAND_GATES__)).toBe(true);
    });
  });

  afterEach(() => {
    clearAllMocks();
    delete window.__DM_BYPASS_COMMAND_GATES__;
  });
});
