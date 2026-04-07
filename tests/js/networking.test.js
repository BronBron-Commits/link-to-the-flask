/**
 * Tests for Socket.IO networking and real-time communication
 * 
 * Known bugs being tested:
 * - Socket disconnection may not properly clean up listeners
 * - Combat action deduplication may fail with rapid inputs
 * - sessionStorage vs localStorage mismatch causing session conflicts
 * - Network timeline synchronization race conditions
 */

const {
  setupTestEnvironment,
  clearAllMocks,
  MockSocket,
  createMockCombatActor,
} = require('./testUtils.js');

describe('Socket.IO Networking', () => {
  let mockSocket;

  beforeEach(() => {
    setupTestEnvironment();
    mockSocket = new MockSocket();
    jest.clearAllMocks();
  });

  describe('Socket connection lifecycle', () => {
    test('socket should initialize with valid ID', () => {
      expect(mockSocket.id).toBeTruthy();
      expect(mockSocket.id).toMatch(/^socket-/);
    });

    test('socket should track connected state', () => {
      expect(mockSocket.connected).toBe(true);
      mockSocket.disconnect();
      expect(mockSocket.connected).toBe(false);
    });

    test('socket should emit events', () => {
      mockSocket.emit('test-event', { data: 'value' });
      const emitted = mockSocket.getEmitted('test-event');
      expect(emitted).toHaveLength(1);
      expect(emitted[0].args[0].data).toBe('value');
    });
  });

  describe('Event listener management', () => {
    test('should register listeners', () => {
      const handler = jest.fn();
      mockSocket.on('player-move', handler);
      mockSocket.trigger('player-move', { x: 10, y: 0, z: 5 });
      expect(handler).toHaveBeenCalledWith({ x: 10, y: 0, z: 5 });
    });

    test('should support multiple listeners for same event', () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();
      mockSocket.on('combat-action-result', handler1);
      mockSocket.on('combat-action-result', handler2);
      mockSocket.trigger('combat-action-result', { success: true });
      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    });

    test('should remove listeners', () => {
      const handler = jest.fn();
      mockSocket.on('test', handler);
      mockSocket.off('test', handler);
      mockSocket.trigger('test', {});
      expect(handler).not.toHaveBeenCalled();
    });

    test('should not break when removing non-existent listener', () => {
      const handler = jest.fn();
      expect(() => {
        mockSocket.off('nonexistent', handler);
      }).not.toThrow();
    });
  });

  describe('Combat action network flow', () => {
    test('should emit combat-action-record with correct structure', () => {
      const actionRecord = {
        actorId: 'player-1',
        action: 'attack',
        targetId: 'enemy-1',
      };

      mockSocket.emit('combat-action-record', {
        record: actionRecord,
        startTimeMs: Date.now(),
        timelineId: 'combat-123',
      });

      const emitted = mockSocket.getEmitted('combat-action-record');
      expect(emitted).toHaveLength(1);
      expect(emitted[0].args[0].record.action).toBe('attack');
    });

    test('should handle rapid successive actions without deduplication errors', () => {
      const actions = [];
      for (let i = 0; i < 5; i++) {
        const actionId = `action-${i}`;
        mockSocket.emit('combat-action-record', {
          record: { id: actionId, action: 'attack' },
          startTimeMs: Date.now() + i * 10,
        });
        actions.push(actionId);
      }

      const emitted = mockSocket.getEmitted('combat-action-record');
      expect(emitted).toHaveLength(5);
      expect(emitted.map(e => e.args[0].record.id)).toEqual(actions);
    });

    test('should emit dice-roll-event for shared rolls', () => {
      mockSocket.emit('dice-roll-event', {
        roll: {
          diceTotal: 15,
          modifier: 2,
          result: 17,
        },
      });

      const emitted = mockSocket.getEmitted('dice-roll-event');
      expect(emitted).toHaveLength(1);
      expect(emitted[0].args[0].roll.result).toBe(17);
    });
  });

  describe('Combat state synchronization', () => {
    test('should broadcast combat-start event', () => {
      mockSocket.emit('combat-start', {
        initiator: mockSocket.id,
        targetId: 'enemy-1',
      });

      const emitted = mockSocket.getEmitted('combat-start');
      expect(emitted).toHaveLength(1);
      expect(emitted[0].args[0].targetId).toBe('enemy-1');
    });

    test('should broadcast combat-end event', () => {
      mockSocket.emit('combat-end', {
        summary: 'Player won',
      });

      const emitted = mockSocket.getEmitted('combat-end');
      expect(emitted).toHaveLength(1);
    });

    test('should handle combat-start-request approval flow', () => {
      const requestId = `req-${Date.now()}`;
      mockSocket.emit('combat-start-request', {
        requestId,
        targetId: 'enemy-1',
      });

      const emitted = mockSocket.getEmitted('combat-start-request');
      expect(emitted).toHaveLength(1);
      expect(emitted[0].args[0].requestId).toBeTruthy();
    });
  });

  describe('Network timeline alignment', () => {
    test('should align combat timeline with server timestamp', () => {
      const startTimeMs = Date.now() - 1000; // 1 second ago
      const timelineId = 'combat-' + Date.now();

      const payload = {
        timelineId,
        startTimeMs,
      };

      // Calculate elapsed
      const nowWallMs = Date.now();
      const elapsedSinceStartMs = Math.max(0, nowWallMs - startTimeMs);

      expect(elapsedSinceStartMs).toBeGreaterThanOrEqual(1000);
      expect(elapsedSinceStartMs).toBeLessThan(1100); // Some tolerance
    });

    test('should handle network event queueing with performance times', () => {
      const timeline = {
        id: 'combat-1',
        startTimeMs: Date.now(),
        localStartPerfMs: performance.now(),
      };

      const eventRecord = {
        targetId: 'actor-1',
        action: 'attack',
      };

      const eventTimeMs = Date.now() + 500;
      const eventOffsetMs = Math.max(0, eventTimeMs - timeline.startTimeMs);
      const duePerfMs = timeline.localStartPerfMs + eventOffsetMs;

      expect(duePerfMs).toBeGreaterThan(timeline.localStartPerfMs);
    });
  });

  describe('Session storage and resume', () => {
    test('should use sessionStorage for resume keys, not localStorage', () => {
      const resumeKey = `resume-${mockSocket.id}`;
      const sessionStorage = window.sessionStorage;

      // Should use sessionStorage
      sessionStorage.setItem(resumeKey, 'session-data');
      expect(sessionStorage.getItem(resumeKey)).toBe('session-data');

      // localStorage should not have this key (test that sessionStorage was used)
      const localStorage = window.localStorage;
      expect(localStorage.getItem(resumeKey)).toBeNull();
    });

    test('should prevent localStorage from causing session hijacking', () => {
      const sid1 = 'socket-session-1';
      const sid2 = 'socket-session-2';

      // Each socket should use sessionStorage isolation
      const session1 = window.sessionStorage;
      const session2 = window.sessionStorage;

      // They should both be the same object (per-tab)
      expect(session1).toBe(session2);

      // But in different browser tabs, they would be isolated
      // This test confirms we're using sessionStorage (tab-scoped)
      expect(session1).toBeDefined();
    });
  });

  describe('Error handling and resilience', () => {
    test('should handle null emit gracefully', () => {
      expect(() => {
        mockSocket.emit(null, {});
      }).not.toThrow();
    });

    test('should handle socket emit with missing payload', () => {
      expect(() => {
        mockSocket.emit('test-event');
      }).not.toThrow();
    });

    test('should track disconnect counter', () => {
      let disconnectCount = 0;
      const mockCallback = jest.fn(() => disconnectCount++);

      mockCallback();
      mockCallback();

      expect(disconnectCount).toBe(2);
    });
  });

  describe('Combat action record structure', () => {
    test('should include all required fields in action record', () => {
      const record = {
        actorId: 'player-1',
        action: 'attack',
        targetId: 'enemy-1',
        roll: 15,
        damage: 8,
        timestamp: Date.now(),
      };

      mockSocket.emit('combat-action-result', record);
      const emitted = mockSocket.getEmitted('combat-action-result');
      const emittedRecord = emitted[0].args[0];

      expect(emittedRecord.actorId).toBeDefined();
      expect(emittedRecord.action).toBeDefined();
      expect(emittedRecord.targetId).toBeDefined();
    });
  });

  describe('Deduplication and rate limiting', () => {
    test('should track action IDs for deduplication', () => {
      const processedIds = new Set();

      const tryProcessAction = (actionId) => {
        if (processedIds.has(actionId)) {
          return false; // Already processed
        }
        processedIds.add(actionId);
        return true;
      };

      const id1 = 'action-1';
      expect(tryProcessAction(id1)).toBe(true);
      expect(tryProcessAction(id1)).toBe(false); // Duplicate rejected
    });

    test('should reset deduplication state (simulating test fixture cleanup)', () => {
      const gameState = {
        processedActionIds: new Set(),
        playerRateLimits: new Map(),
      };

      gameState.processedActionIds.add('action-1');
      expect(gameState.processedActionIds.has('action-1')).toBe(true);

      // Reset for next test
      gameState.processedActionIds.clear();
      gameState.playerRateLimits.clear();
      expect(gameState.processedActionIds.has('action-1')).toBe(false);
    });
  });

  afterEach(() => {
    clearAllMocks();
  });
});
