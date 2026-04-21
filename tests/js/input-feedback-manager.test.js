const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadCreateInputFeedbackManager() {
  const filePath = path.resolve(__dirname, '../../static/map3d/managers/inputFeedbackManager.js');
  let source = fs.readFileSync(filePath, 'utf8');
  source = source.replace('export function createInputFeedbackManager', 'function createInputFeedbackManager');
  source += '\nmodule.exports = { createInputFeedbackManager };\n';

  const context = {
    module: { exports: {} },
    exports: {},
    console,
    window: {},
    document: {},
  };

  vm.runInNewContext(source, context, { filename: filePath });
  return context.module.exports.createInputFeedbackManager;
}

describe('Input Feedback Manager', () => {
  let createInputFeedbackManager;
  let intentUpdates;
  let floatingMessages;
  let consoleMessages;
  let timelineEvents;
  let store;
  let manager;

  beforeEach(() => {
    createInputFeedbackManager = loadCreateInputFeedbackManager();
    intentUpdates = [];
    floatingMessages = [];
    consoleMessages = [];
    timelineEvents = [];
    store = { history: [], lastByKind: {} };

    manager = createInputFeedbackManager({
      now: () => 123456,
      setIntentStatus: (kind, state, note) => intentUpdates.push({ kind, state, note }),
      showFloatingText: (text, color, force, options) => floatingMessages.push({ text, color, force, options }),
      appendConsoleHistory: (text, tone) => consoleMessages.push({ text, tone }),
      pushTimeline: (entry) => timelineEvents.push(entry),
      getHistoryStore: () => store,
    });
  });

  test('records accepted attack feedback into history, intent state, console, and timeline', () => {
    const entry = manager.record('attack', 'accepted', 'confirm');

    expect(entry.kind).toBe('attack');
    expect(entry.outcome).toBe('accepted');
    expect(store.history).toHaveLength(1);
    expect(store.lastByKind.attack).toEqual(entry);
    expect(intentUpdates).toEqual([{ kind: 'attack', state: 'accepted', note: 'confirm' }]);
    expect(consoleMessages[0]).toEqual({ text: '[INPUT] Attack accepted: confirm', tone: 'ok' });
    expect(timelineEvents[0]).toMatchObject({ type: 'input:ack', kind: 'attack', outcome: 'accepted', reason: 'confirm' });
  });

  test('queued move feedback uses warning styling and can suppress floating text', () => {
    manager.record('move', 'queued', 'server', { showFloating: false });

    expect(floatingMessages).toHaveLength(0);
    expect(intentUpdates).toEqual([{ kind: 'move', state: 'queued', note: 'server' }]);
    expect(consoleMessages[0]).toEqual({ text: '[INPUT] Move queued: server', tone: 'system' });
  });

  test('blocked end-turn feedback maps to endTurn intent key', () => {
    manager.record('end-turn', 'blocked', 'no-server-connection');

    expect(intentUpdates).toEqual([{ kind: 'endTurn', state: 'blocked', note: 'no-server-connection' }]);
    expect(floatingMessages[0].text).toBe('End turn blocked: no server connection');
    expect(floatingMessages[0].color).toBe('#ff8a8a');
  });

  test('clear removes recorded history and lastByKind entries', () => {
    manager.record('attack', 'accepted', 'confirm');
    manager.record('move', 'queued', 'server');

    manager.clear();

    expect(store.history).toHaveLength(0);
    expect(store.lastByKind.attack).toBeUndefined();
    expect(store.lastByKind.move).toBeUndefined();
  });
});
