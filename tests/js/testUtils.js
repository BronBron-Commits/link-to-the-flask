/**
 * Test utilities and helper functions for map3d.js tests
 */

class MockSocket {
  constructor() {
    this.emitted = [];
    this.listeners = {};
    this.connected = true;
    this.id = 'socket-' + Math.random().toString(36).substr(2, 9);
  }

  emit(eventName, ...args) {
    this.emitted.push({ event: eventName, args });
  }

  on(eventName, handler) {
    if (!this.listeners[eventName]) {
      this.listeners[eventName] = [];
    }
    this.listeners[eventName].push(handler);
  }

  off(eventName, handler) {
    if (this.listeners[eventName]) {
      this.listeners[eventName] = this.listeners[eventName].filter(h => h !== handler);
    }
  }

  trigger(eventName, ...args) {
    if (this.listeners[eventName]) {
      this.listeners[eventName].forEach(handler => handler(...args));
    }
  }

  disconnect() {
    this.connected = false;
  }

  getEmitted(eventName) {
    return this.emitted.filter(e => e.event === eventName);
  }

  clearEmitted() {
    this.emitted = [];
  }
}

class MockSceneGraph {
  constructor() {
    this.children = [];
    this.add = jest.fn((obj) => this.children.push(obj));
    this.remove = jest.fn((obj) => {
      const idx = this.children.indexOf(obj);
      if (idx > -1) this.children.splice(idx, 1);
    });
  }
}

// Mock game state
function createMockGameState() {
  return {
    inCombat: false,
    players: {},
    actors: [],
    currentTurn: 0,
  };
}

// Mock mode manager
function createMockModeManager() {
  return {
    current: 'player',
    listeners: [],
    setMode(nextMode) {
      this.current = nextMode;
      this.listeners.forEach(listener => listener(nextMode));
    },
    onChange(listener) {
      this.listeners.push(listener);
      return () => {
        this.listeners = this.listeners.filter(l => l !== listener);
      };
    }
  };
}

// Mock player state
function createMockPlayerState() {
  return {
    id: 'player-1',
    position: new THREE.Vector3(0, 0, 0),
    rotation: new THREE.Quaternion(),
    hp: 20,
    maxHp: 20,
    movementSpeed: 30,
    actionsUsed: 0,
    movementUsed: 0,
    bonusActionUsed: false,
  };
}

// Mock combat actor
function createMockCombatActor(id = 'actor-1', actorType = 'enemy') {
  return {
    id,
    type: actorType,
    hp: 15,
    maxHp: 15,
    position: new THREE.Vector3(10, 0, 0),
    initiative: 12,
    defeated: false,
    userData: {
      label: `Test ${actorType}`,
      persistentId: id,
    }
  };
}

// Initialize test environment with defaults
function setupTestEnvironment() {
  global.socket = new MockSocket();
  global.modeManager = createMockModeManager();
  global.playerState = createMockPlayerState();
  global.combatState = { inCombat: false };
  global.currentGameMode = 'free';
  return {
    socket: global.socket,
    modeManager: global.modeManager,
    playerState: global.playerState,
  };
}

// Clear all mocks
function clearAllMocks() {
  jest.clearAllMocks();
  if (global.socket) global.socket.clearEmitted();
}

module.exports = {
  MockSocket,
  MockSceneGraph,
  createMockGameState,
  createMockModeManager,
  createMockPlayerState,
  createMockCombatActor,
  setupTestEnvironment,
  clearAllMocks,
};
