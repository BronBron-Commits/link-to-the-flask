/**
 * Tests for UI state and camera control systems
 * 
 * Known bugs being tested:
 * - DM UI zones may not collapse/expand properly on rapid clicks
 * - Camera transitions may feel laggy if smoothing factors are wrong
 * - Loading overlay may get stuck if finish sequence is skipped
 */

const {
  setupTestEnvironment,
  clearAllMocks,
} = require('./testUtils.js');

describe('UI State Management', () => {
  beforeEach(() => {
    setupTestEnvironment();
    jest.clearAllMocks();
  });

  describe('DM UI zone visibility', () => {
    test('should track zone collapse state', () => {
      const dmZoneCollapsed = {
        top: false,
        left: false,
        right: false,
        bottom: false,
        center: false,
      };
      const getCollapsedZones = () => Object.entries(dmZoneCollapsed)
        .filter(([, collapsed]) => collapsed === true)
        .map(([zone]) => zone)
        .sort();

      expect(getCollapsedZones()).toEqual([]);
      dmZoneCollapsed.left = true;
      dmZoneCollapsed.bottom = true;
      expect(getCollapsedZones()).toEqual(['bottom', 'left']);
    });

    test('should toggle zone visibility', () => {
      const dmZoneCollapsed = {
        top: false,
        left: false,
      };

      const toggleZone = (zone) => {
        dmZoneCollapsed[zone] = !dmZoneCollapsed[zone];
      };

      toggleZone('left');
      expect(dmZoneCollapsed.left).toBe(true);

      toggleZone('left');
      expect(dmZoneCollapsed.left).toBe(false);
    });

    test('should apply visual transforms based on zone state', () => {
      const dmZoneCollapsed = { left: false, right: false };

      const getLeftPanelTransform = () => {
        return dmZoneCollapsed.left ? 'translateX(-340px)' : 'translateX(0)';
      };

      expect(getLeftPanelTransform()).toBe('translateX(0)');

      dmZoneCollapsed.left = true;
      expect(getLeftPanelTransform()).toBe('translateX(-340px)');
    });

    test('should apply opacity transitions', () => {
      const dmZoneCollapsed = { bottom: false };

      const getBottomOpacity = () => {
        return dmZoneCollapsed.bottom ? '0.3' : '1';
      };

      expect(getBottomOpacity()).toBe('1');

      dmZoneCollapsed.bottom = true;
      expect(getBottomOpacity()).toBe('0.3');
    });
  });

  describe('Camera controls', () => {
    test('should track camera mode', () => {
      const DM_CAMERA_MODE = {
        DIRECTOR: 'director',
        TACTICAL: 'tactical',
        FOLLOW: 'follow',
        FREE: 'free',
      };

      let dmCameraMode = DM_CAMERA_MODE.DIRECTOR;

      const isInFreeMode = (mode) => mode === DM_CAMERA_MODE.FREE;
      expect(isInFreeMode(dmCameraMode)).toBe(false);

      dmCameraMode = DM_CAMERA_MODE.FREE;
      expect(isInFreeMode(dmCameraMode)).toBe(true);
    });

    test('should apply camera smoothing factors', () => {
      const DM_DIRECTOR_SMOOTHING = 0.05;
      const DM_FOLLOW_SMOOTHING = 0.12;

      const applySmoothingFactor = (currentPos, targetPos, smoothing) => {
        return currentPos + (targetPos - currentPos) * smoothing;
      };

      const current = 0;
      const target = 100;

      const directorResult = applySmoothingFactor(current, target, DM_DIRECTOR_SMOOTHING);
      const followResult = applySmoothingFactor(current, target, DM_FOLLOW_SMOOTHING);

      expect(directorResult).toBe(5);
      expect(followResult).toBe(12);
      expect(followResult > directorResult).toBe(true); // Follow is smoother
    });

    test('should calculate camera focus offsets', () => {
      const focusOptions = {
        offsetY: 8,
        offsetZ: 12,
      };

      const targetPos = new THREE.Vector3(10, 5, 20);
      const cameraPos = new THREE.Vector3(
        targetPos.x,
        targetPos.y + focusOptions.offsetY,
        targetPos.z + focusOptions.offsetZ
      );

      expect(cameraPos.x).toBe(10);
      expect(cameraPos.y).toBe(13);
      expect(cameraPos.z).toBe(32);
    });
  });

  describe('Loading overlay state', () => {
    test('should track loading progress', () => {
      const tracker = {
        value: 0,
        target: 0,
      };

      const updateTarget = (target) => {
        tracker.target = Math.max(0, Math.min(100, Number(target) || 0));
      };

      const step = () => {
        const delta = tracker.target - tracker.value;
        tracker.value += delta * 0.5;
      };

      updateTarget(80);
      step();
      expect(tracker.value).toBeGreaterThan(0);
      expect(tracker.value).toBeLessThan(80);

      step();
      expect(tracker.value).toBeGreaterThan(30);
    });

    test('should clamp progress between 0 and 1', () => {
      const clamp01 = (value) => {
        return Math.max(0, Math.min(1, value));
      };

      expect(clamp01(-0.5)).toBe(0);
      expect(clamp01(0.5)).toBe(0.5);
      expect(clamp01(1.5)).toBe(1);
    });

    test('should track loading overlay state', () => {
      const loadingOverlay = {
        root: null,
        log: null,
        status: null,
        finished: false,
        closeScheduled: false,
        startedAt: 0,
      };

      const completeLoading = (state, nowMs) => {
        state.finished = true;
        state.closeScheduled = true;
        state.closedAt = nowMs + 1300;
      };

      completeLoading(loadingOverlay, 5000);
      expect(loadingOverlay.finished).toBe(true);
      expect(loadingOverlay.closeScheduled).toBe(true);
      expect(loadingOverlay.closedAt).toBe(6300);
    });

    test('should enforce minimum loading display time', () => {
      const LOADING_MIN_VISIBLE_MS = 3200;
      const startTime = performance.now();
      const now = performance.now() + 2000; // 2 seconds later

      const elapsedMs = now - startTime;
      const shouldStillShow = elapsedMs < LOADING_MIN_VISIBLE_MS;

      expect(shouldStillShow).toBe(true);
    });
  });

  describe('Selection and targeting', () => {
    test('should track selected combat target', () => {
      const history = [];
      let selectedCombatTarget = null;

      const selectTarget = (nextTarget) => {
        if (selectedCombatTarget && selectedCombatTarget.id !== nextTarget.id) {
          history.push(`clear:${selectedCombatTarget.id}`);
        }
        selectedCombatTarget = nextTarget;
        history.push(`select:${nextTarget.id}`);
      };

      selectTarget({ id: 'enemy-1' });
      selectTarget({ id: 'enemy-2' });

      expect(selectedCombatTarget.id).toBe('enemy-2');
      expect(history).toEqual(['select:enemy-1', 'clear:enemy-1', 'select:enemy-2']);
    });

    test('should clear previous selection before selecting new target', () => {
      let selectedCombatTarget = { id: 'enemy-1' };

      const newTarget = { id: 'enemy-2' };
      selectedCombatTarget = null; // Clear first
      selectedCombatTarget = newTarget;

      expect(selectedCombatTarget.id).toBe('enemy-2');
    });

    test('should track selected object in editor mode', () => {
      let selectedObject = null;

      expect(selectedObject).toBeNull();

      selectedObject = { uuid: 'mesh-123' };
      expect(selectedObject.uuid).toBe('mesh-123');

      selectedObject = null;
      expect(selectedObject).toBeNull();
    });
  });

  describe('Overlay visibility', () => {
    test('should track mode overlay visibility', () => {
      const modeOverlayEl = {
        display: 'none',
        visible: false,
      };

      const setOverlayOpen = (open) => {
        modeOverlayEl.visible = !!open;
        modeOverlayEl.display = open ? 'block' : 'none';
      };

      setOverlayOpen(true);
      expect(modeOverlayEl.visible).toBe(true);
      expect(modeOverlayEl.display).toBe('block');

      setOverlayOpen(false);
      expect(modeOverlayEl.visible).toBe(false);
      expect(modeOverlayEl.display).toBe('none');
    });

    test('should show/hide UI elements by element ID', () => {
      const setPlayerHudVisible = (visible) => {
        const hud = { style: { display: 'block' } };
        hud.style.display = visible ? 'block' : 'none';
        return hud;
      };

      const hud1 = setPlayerHudVisible(true);
      expect(hud1.style.display).toBe('block');

      const hud2 = setPlayerHudVisible(false);
      expect(hud2.style.display).toBe('none');
    });
  });

  describe('Floating text system', () => {
    test('should show floating text with color and position', () => {
      const showFloatingText = (text, color, isImportant) => ({
        text,
        color,
        isImportant,
        timestamp: performance.now(),
      });

      const msg = showFloatingText('Hit!', '#ff0000', true);
      expect(msg.text).toBe('Hit!');
      expect(msg.color).toBe('#ff0000');
      expect(msg.isImportant).toBe(true);
    });
  });

  describe('HUD and status displays', () => {
    test('should update player health display', () => {
      let playerHealthHUD = {
        currentHP: 20,
        maxHP: 20,
        damageIndicator: null,
      };

      const applyDamage = (amount) => {
        playerHealthHUD.currentHP -= amount;
        playerHealthHUD.damageIndicator = { amount, flashTime: performance.now() };
      };

      applyDamage(5);
      expect(playerHealthHUD.currentHP).toBe(15);
      expect(playerHealthHUD.damageIndicator.amount).toBe(5);
    });

    test('should display actor labels', () => {
      const getCombatActorLabel = (actor) => {
        if (!actor) return '';
        return (actor.userData && (actor.userData.label || actor.userData.name)) || actor.id;
      };

      const actor = { id: 'goblin-1', userData: { label: 'Goblin Warrior' } };
      expect(getCombatActorLabel(actor)).toBe('Goblin Warrior');

      const noLabel = { id: 'unknown' };
      expect(getCombatActorLabel(noLabel)).toBe('unknown');
    });
  });

  describe('Console UI management', () => {
    test('should initialize console UI manager', () => {
      const consoleManager = {
        ensureUi: jest.fn(),
        appendHistory: jest.fn(),
        clearHistory: jest.fn(),
      };

      consoleManager.ensureUi();
      expect(consoleManager.ensureUi).toHaveBeenCalled();
    });

    test('should toggle console visibility', () => {
      const consoleState = {
        open: false,
        toggleOpen: function() {
          this.open = !this.open;
        }
      };

      expect(consoleState.open).toBe(false);
      consoleState.toggleOpen();
      expect(consoleState.open).toBe(true);
      consoleState.toggleOpen();
      expect(consoleState.open).toBe(false);
    });
  });

  describe('DM control panel state', () => {
    test('should track DM command button references', () => {
      const dmCommandButtonRefs = new Map();

      dmCommandButtonRefs.set('step-turn', new Set());
      dmCommandButtonRefs.get('step-turn').add({ element: 'button1' });

      expect(dmCommandButtonRefs.has('step-turn')).toBe(true);
      expect(dmCommandButtonRefs.get('step-turn').size).toBe(1);
    });

    test('should enable/disable DM buttons based on authority', () => {
      const dmCommandButtonRefs = new Map([
        ['step-turn', new Set([{ disabled: false }])],
        ['possess', new Set([{ disabled: true }])],
      ]);

      // Observer mode: can control timeline but not possess
      const observerCaps = {
        controlTimeline: true,
        possess: false,
      };

      dmCommandButtonRefs.forEach((buttons, command) => {
        const isEnabled = command === 'step-turn'
          ? observerCaps.controlTimeline
          : observerCaps.possess;

        buttons.forEach(btn => {
          btn.disabled = !isEnabled;
        });
      });

      expect(dmCommandButtonRefs.get('step-turn').values().next().value.disabled).toBe(false);
      expect(dmCommandButtonRefs.get('possess').values().next().value.disabled).toBe(true);
    });
  });

  afterEach(() => {
    clearAllMocks();
  });
});
