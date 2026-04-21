# Unit Tests for map3d.js

Comprehensive unit test suite for the frontend JavaScript client of the 3D multiplayer D&D game engine.

## Test Coverage

### 1. **DM Authority & Permissions** (`dm-authority.test.js`)
Tests the role-based access control (RBAC) system:
- Mode-specific permissions (DEV, DM, PLAYER)
- DM command capability mapping
- Authority layer capabilities (Observer, Puppeteer, Simulator)
- Simulation authority state
- Command gate bypasses

**Known Bugs Targeted:**
- Permission cascading through role changes
- DM observer mode privilege escalation
- Command gates bypassed by rapid role changes

### 2. **Socket.IO Networking** (`networking.test.js`)
Tests real-time network communication:
- Socket connection lifecycle
- Event listener registration and cleanup
- Combat action network flow
- Combat state synchronization
- Network timeline alignment
- Session storage isolation (prevent hijacking)
- Action deduplication
- Rate limiting

**Known Bugs Targeted:**
- Socket disconnection cleanup failures
- Combat action deduplication race conditions
- sessionStorage vs localStorage conflicts
- Network timeline synchronization races

### 3. **Combat System Logic** (`combat-system.test.js`)
Tests turn-based combat mechanics:
- Combat timeline initialization
- Combat actor management and targeting
- Combat state tracking
- Turn and action management
- Combat message priority system
- Hit stop timing
- Turn end state machine
- Combat presentation timing

**Known Bugs Targeted:**
- Combat timeline local authority initialization
- Hit stop timing visual glitches
- Turn end state getting stuck
- Actor targeting failures with latency

### 4. **Mode Management** (`mode-management.test.js`)
Tests game mode transitions and state:
- Mode initialization and validation
- Mode transitions and listener notifications
- Fast mode switching
- Camera mode management
- Movement state tracking
- Possession and control mechanics
- DM authority layer state
- Simulation authority state

**Known Bugs Targeted:**
- Mode listeners failing on rapid toggles
- DM UI persisting after mode switch
- Camera transition jitter

### 5. **Console Commands** (`console-commands.test.js`)
Tests the developer/DM console system:
- Command registration and validation
- Command availability filtering by mode
- Command execution
- Input tokenization and parsing
- Command suggestions and autocomplete
- Command history navigation
- Mode access control

**Known Bugs Targeted:**
- Mixed-case command name registration
- Missing argument handling
- Partial input matching failures

### 6. **UI State Management** (`ui-state.test.js`)
Tests UI and visual systems:
- DM UI zone visibility and collapse
- Camera control modes and smoothing
- Loading overlay state and progress
- Selection and targeting
- Overlay visibility
- Floating text system
- HUD and status displays
- Console UI management
- DM control panel state

**Known Bugs Targeted:**
- DM UI zone collapse/expansion on rapid clicks
- Camera transition lag
- Loading overlay getting stuck

## Setup & Installation

### Prerequisites
- Node.js 16+
- npm or yarn

### Install Dependencies

```bash
cd /path/to/link-to-the-flask
npm install
```

## Running Tests

### Run all tests
```bash
npm test
```

### Run tests in watch mode (auto-rerun on file changes)
```bash
npm run test:watch
```

### Run tests with coverage report
```bash
npm run test:coverage
```

### Run specific test file
```bash
npx jest tests/js/dm-authority.test.js
```

### Run tests matching a pattern
```bash
npx jest --testNamePattern="Mode transitions"
```

### Run with verbose output
```bash
npm run test:verbose
```

## Test Structure

```
tests/
├── js/
│   ├── __mocks__/
│   │   └── three.mock.js          # THREE.js mock for testing
│   ├── setup.js                    # Global test setup
│   ├── testUtils.js                # Shared test utilities
│   ├── dm-authority.test.js        # RBAC tests
│   ├── networking.test.js          # Socket.IO tests
│   ├── combat-system.test.js       # Combat logic tests
│   ├── mode-management.test.js     # Mode state tests
│   ├── console-commands.test.js    # Console tests
│   └── ui-state.test.js            # UI state tests
```

## Test Utilities

The `testUtils.js` module provides reusable helpers:

### Mock Classes
- `MockSocket` - Simulates Socket.IO socket behavior
- `MockSceneGraph` - Simulates Three.js scene graph

### Factory Functions
- `createMockGameState()` - Creates test game state
- `createMockModeManager()` - Creates test mode manager
- `createMockPlayerState()` - Creates test player
- `createMockCombatActor(id, type)` - Creates test combat actor

### Utilities
- `setupTestEnvironment()` - Initializes test globals
- `clearAllMocks()` - Resets all mocks between tests

## Example Usage

```javascript
const { setupTestEnvironment, createMockCombatActor } = require('../testUtils.js');

describe('My Tests', () => {
  beforeEach(() => {
    setupTestEnvironment();
  });

  test('should test combat actor', () => {
    const actor = createMockCombatActor('enemy-1', 'goblin');
    expect(actor.type).toBe('goblin');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });
});
```

## Known Issues & Fixes

### 1. Session Storage Isolation Bug
**Location:** `networking.test.js`
**Issue:** Using localStorage instead of sessionStorage for resume keys causes session hijacking across browser tabs.
**Status:** ✅ Tested

### 2. DM Observer Mode Escalation
**Location:** `dm-authority.test.js`
**Issue:** Observer authority layer may inadvertently grant higher privileges than intended.
**Status:** ✅ Tested

### 3. Combat Timeline Race Condition
**Location:** `combat-system.test.js`
**Issue:** Local timeline initialization may conflict with network synchronization.
**Status:** ✅ Tested

### 4. Turn End Watchdog Hang
**Location:** `combat-system.test.js`
**Issue:** If endTurnWatchdog timer isn't cleared, turn state can get stuck.
**Status:** ✅ Tested

### 5. Mode Transition Listener Failure
**Location:** `mode-management.test.js`
**Issue:** Rapid mode changes may not properly notify all listeners.
**Status:** ✅ Tested

## Jest Configuration

The `jest.config.js` file is configured with:
- **testEnvironment**: jsdom (for DOM APIs)
- **testTimeout**: 10 seconds
- **Coverage Collection**: Excludes three.js and loader files
- **Module Mocking**: Auto-mocks THREE.js

## CI/CD Integration

To integrate with GitHub Actions or other CI:

```yaml
- name: Run JavaScript Tests
  run: |
    npm install
    npm test -- --coverage
    
- name: Upload Coverage
  uses: codecov/codecov-action@v3
  with:
    flags: javascript
    files: ./coverage/lcov.info
```

## Contributing Tests

When adding new tests:

1. **Place tests in appropriate file** based on feature area
2. **Use descriptive test names** - they serve as documentation
3. **Mock external dependencies** - use `MockSocket`, `MockSceneGraph`, etc.
4. **Test both happy path and error cases**
5. **Clean up after each test** - call `clearAllMocks()` in `afterEach`
6. **Document known bugs** - comment why specific assertions are present

Example:
```javascript
describe('New Feature', () => {
  beforeEach(() => {
    setupTestEnvironment();
  });

  test('should do something specific', () => {
    // Arrange
    const actor = createMockCombatActor('test-1');
    
    // Act
    const result = doSomething(actor);
    
    // Assert
    expect(result).toBe(expectedValue);
  });
});
```

## Coverage Goals

Current coverage targets:
- **Statements**: 70%+
- **Branches**: 65%+
- **Functions**: 70%+
- **Lines**: 70%+

View coverage report:
```bash
npm run test:coverage
# Then open coverage/lcov-report/index.html in your browser
```

## Troubleshooting

### Tests timeout
Increase timeout in specific tests:
```javascript
test('long operation', () => {
  // test code
}, 15000); // 15 second timeout
```

### Mock not working
Ensure mocks are imported before code under test:
```javascript
// ❌ Wrong
const myCode = require('../map3d.js');
const { MockSocket } = require('./testUtils.js');

// ✅ Correct
const { MockSocket } = require('./testUtils.js');
const myCode = require('../map3d.js');
```

### Session/Local storage issues
Clear storage in `beforeEach`:
```javascript
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  setupTestEnvironment();
});
```

## Resources

- [Jest Documentation](https://jestjs.io/)
- [Three.js Testing Guide](https://threejs.org/docs/#manual/en/introduction/Testing)
- [Socket.IO Testing](https://socket.io/docs/v4/testing/)
- [D&D 5e Combat Rules](https://www.dndbeyond.com/)

## Support

For issues with tests, please:
1. Check the existing test files for similar patterns
2. Review the `testUtils.js` for available mocks
3. Run with `--verbose` flag for detailed output
4. Check Jest documentation for configuration options

---

**Last Updated:** 2026-04-06
**Test Files:** 6
**Total Tests:** 100+
**Coverage Areas:** Authority, Networking, Combat, UI State, Modes, Commands
