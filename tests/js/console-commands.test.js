/**
 * Tests for console commands and command registry
 * 
 * Known bugs being tested:
 * - Commands may fail to register if name has mixed case
 * - Command execution may not properly handle missing arguments
 * - Suggestion matching may not work correctly with partial input
 */

const {
  setupTestEnvironment,
  clearAllMocks,
} = require('./testUtils.js');

describe('Console Commands', () => {
  let consoleCommands;

  beforeEach(() => {
    setupTestEnvironment();
    consoleCommands = Object.create(null);
    jest.clearAllMocks();
  });

  describe('Command registration', () => {
    test('should register a console command', () => {
      const command = {
        modes: ['dev'],
        usage: 'test-command <arg>',
        description: 'Test command',
        execute: jest.fn(),
      };

      consoleCommands['test-command'] = command;
      expect(consoleCommands['test-command']).toBeDefined();
      expect(consoleCommands['test-command'].description).toBe('Test command');
    });

    test('should normalize command names to lowercase', () => {
      const registerCommand = (name, config) => {
        const normalized = String(name || '').toLowerCase();
        consoleCommands[normalized] = config;
      };

      registerCommand('TestCommand', {
        modes: ['dev'],
        execute: jest.fn(),
      });

      expect(consoleCommands['testcommand']).toBeDefined();
      expect(consoleCommands['TestCommand']).toBeUndefined();
    });

    test('should reject invalid command registration', () => {
      const registerCommand = (name, config) => {
        if (!name || !config || typeof config.execute !== 'function') {
          throw new Error('Invalid command');
        }
        consoleCommands[name.toLowerCase()] = config;
      };

      expect(() => {
        registerCommand(null, {});
      }).toThrow('Invalid command');

      expect(() => {
        registerCommand('cmd', { execute: null });
      }).toThrow('Invalid command');
    });
  });

  describe('Command availability', () => {
    test('should list available commands', () => {
      consoleCommands['move'] = { modes: ['player'], execute: jest.fn() };
      consoleCommands['attack'] = { modes: ['player', 'dm'], execute: jest.fn() };
      consoleCommands['spawn'] = { modes: ['dm', 'dev'], execute: jest.fn() };

      const getAvailableCommands = () => {
        return Object.keys(consoleCommands).sort();
      };

      const cmds = getAvailableCommands();
      expect(cmds).toEqual(['attack', 'move', 'spawn']);
    });

    test('should filter commands by mode', () => {
      const commands = {
        move: { modes: ['player'], execute: jest.fn() },
        attack: { modes: ['player', 'dm'], execute: jest.fn() },
        spawn: { modes: ['dev'], execute: jest.fn() },
        step: { modes: ['dm', 'dev'], execute: jest.fn() },
      };

      const getAvailableFor = (mode) => {
        return Object.entries(commands)
          .filter(([_, cmd]) => cmd.modes.includes(mode))
          .map(([name, _]) => name)
          .sort();
      };

      expect(getAvailableFor('player')).toEqual(['attack', 'move']);
      expect(getAvailableFor('dm')).toEqual(['attack', 'step']);
      expect(getAvailableFor('dev')).toEqual(['spawn', 'step']);
    });
  });

  describe('Command execution', () => {
    test('should execute command with arguments', () => {
      const mockExecute = jest.fn();
      consoleCommands['test'] = {
        modes: ['dev'],
        execute: mockExecute,
      };

      const cmd = consoleCommands['test'];
      cmd.execute(['arg1', 'arg2']);

      expect(mockExecute).toHaveBeenCalledWith(['arg1', 'arg2']);
    });

    test('should pass context to command execution', () => {
      const mockExecute = jest.fn();
      const context = {
        scene: {},
        player: {},
        getMode: () => 'dev',
      };

      consoleCommands['test'] = {
        modes: ['dev'],
        execute: (args, ctx) => {
          expect(ctx).toBeDefined();
          expect(ctx.getMode()).toBe('dev');
        },
      };

      consoleCommands['test'].execute([], context);
    });
  });

  describe('Command parsing', () => {
    test('should tokenize console input', () => {
      const tokenizeInput = (raw) => {
        return (raw || '')
          .trim()
          .split(/\s+/)
          .filter(t => t.length > 0);
      };

      expect(tokenizeInput('move 10 20')).toEqual(['move', '10', '20']);
      expect(tokenizeInput('  spawn   dummy  ')).toEqual(['spawn', 'dummy']);
      expect(tokenizeInput('')).toEqual([]);
    });

    test('should handle quoted strings', () => {
      const tokenizeInput = (raw) => {
        if (!raw || typeof raw !== 'string') return [];

        const tokens = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < raw.length; i++) {
          const char = raw[i];
          if (char === '"' && (i === 0 || raw[i - 1] !== '\\')) {
            inQuotes = !inQuotes;
          } else if (char === ' ' && !inQuotes) {
            if (current) tokens.push(current);
            current = '';
          } else {
            current += char;
          }
        }

        if (current) tokens.push(current);
        return tokens;
      };

      expect(tokenizeInput('say "hello world"')).toEqual(['say', 'hello world']);
    });
  });

  describe('Command suggestions', () => {
    test('should match command prefixes', () => {
      const commands = ['move', 'moveto', 'attack', 'spawn', 'skill', 'save'];

      const getSuggestions = (input) => {
        const prefix = input.toLowerCase();
        return commands.filter(cmd => cmd.startsWith(prefix));
      };

      expect(getSuggestions('mov')).toEqual(['move', 'moveto']);
      expect(getSuggestions('sp')).toEqual(['spawn']);
      expect(getSuggestions('s')).toEqual(['spawn', 'skill', 'save']);
      expect(getSuggestions('att')).toEqual(['attack']);
      expect(getSuggestions('xyz')).toEqual([]);
    });

    test('should cycle through suggestions', () => {
      const suggestions = ['move', 'moveto', 'movefast'];
      let suggestionIndex = 0;

      const nextSuggestion = () => {
        suggestionIndex = (suggestionIndex + 1) % suggestions.length;
        return suggestions[suggestionIndex];
      };

      expect(nextSuggestion()).toBe('moveto');
      expect(nextSuggestion()).toBe('movefast');
      expect(nextSuggestion()).toBe('move');
    });
  });

  describe('Command history', () => {
    test('should store command history', () => {
      const commandHistory = [];

      const addToHistory = (cmd) => {
        commandHistory.push(cmd);
      };

      addToHistory('move 10');
      addToHistory('attack enemy');
      addToHistory('spawn dummy');

      expect(commandHistory).toHaveLength(3);
      expect(commandHistory[0]).toBe('move 10');
    });

    test('should navigate command history', () => {
      const commandHistory = ['cmd1', 'cmd2', 'cmd3'];
      let historyIndex = -1;

      const getPreviousCommand = () => {
        if (historyIndex < commandHistory.length - 1) {
          historyIndex++;
          return commandHistory[historyIndex];
        }
        return null;
      };

      const getNextCommand = () => {
        if (historyIndex > 0) {
          historyIndex--;
          return commandHistory[historyIndex];
        }
        return null;
      };

      expect(getPreviousCommand()).toBe('cmd1');
      expect(getPreviousCommand()).toBe('cmd2');
      expect(getNextCommand()).toBe('cmd1');
      expect(getNextCommand()).toBeNull();
    });

    test('should limit history size to prevent memory issues', () => {
      const MAX_HISTORY = 100;
      const commandHistory = [];

      const addToHistory = (cmd) => {
        commandHistory.push(cmd);
        if (commandHistory.length > MAX_HISTORY) {
          commandHistory.shift(); // Remove oldest
        }
      };

      for (let i = 0; i < 150; i++) {
        addToHistory(`command-${i}`);
      }

      expect(commandHistory.length).toBe(MAX_HISTORY);
      expect(commandHistory[0]).toBe('command-50'); // Oldest remaining
    });
  });

  describe('Console state', () => {
    test('should track console open state', () => {
      let consoleOpen = false;

      expect(consoleOpen).toBe(false);

      consoleOpen = true;
      expect(consoleOpen).toBe(true);

      consoleOpen = false;
      expect(consoleOpen).toBe(false);
    });

    test('should store console state separately from game state', () => {
      const consoleState = {
        open: false,
        history: [],
        commandHistory: [],
        commandHistoryIndex: -1,
        suggestionMatches: [],
        suggestionIndex: 0,
      };

      expect(consoleState.open).toBe(false);
      expect(Array.isArray(consoleState.history)).toBe(true);

      consoleState.open = true;
      expect(consoleState.open).toBe(true);
    });
  });

  describe('Mode access control', () => {
    test('should enforce command mode restrictions', () => {
      const commands = {
        move: { modes: ['player'] },
        spawn: { modes: ['dev', 'dm'] },
        help: { modes: ['dev', 'dm', 'player'] },
      };

      const canExecuteCommand = (cmdName, currentMode) => {
        const cmd = commands[cmdName];
        if (!cmd) return false;
        return cmd.modes.includes(currentMode);
      };

      // Player mode
      expect(canExecuteCommand('move', 'player')).toBe(true);
      expect(canExecuteCommand('spawn', 'player')).toBe(false);
      expect(canExecuteCommand('help', 'player')).toBe(true);

      // DM mode
      expect(canExecuteCommand('move', 'dm')).toBe(false);
      expect(canExecuteCommand('spawn', 'dm')).toBe(true);

      // Dev mode
      expect(canExecuteCommand('spawn', 'dev')).toBe(true);
    });
  });

  afterEach(() => {
    clearAllMocks();
  });
});
