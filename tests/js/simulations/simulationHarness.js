function mulberry32(seed) {
  let t = seed >>> 0;
  return function next() {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function pickFirstAliveActor(actorIds, actors) {
  for (let i = 0; i < actorIds.length; i += 1) {
    const id = actorIds[i];
    if (actors[id] && actors[id].alive) return id;
  }
  return null;
}

function defaultActor(id, team, hp) {
  return {
    id,
    team,
    hp,
    maxHp: hp,
    alive: true,
    actedOnTurn: 0,
    position: { x: 0, y: 0, z: 0 },
  };
}

function distance2d(a, b) {
  const dx = Number(a && a.x) - Number(b && b.x);
  const dz = Number(a && a.z) - Number(b && b.z);
  return Math.hypot(dx || 0, dz || 0);
}

function assignDefaultPositions(players, enemies, actors) {
  const laneCount = Math.max(1, Math.min(players.length || 1, enemies.length || 1));
  const xForLane = (lane) => ((lane - ((laneCount - 1) / 2)) * 4);

  players.forEach((p, idx) => {
    if (!actors[p.id]) return;
    if (p && p.position) {
      actors[p.id].position = {
        x: Number.isFinite(p.position.x) ? p.position.x : 0,
        y: Number.isFinite(p.position.y) ? p.position.y : 0,
        z: Number.isFinite(p.position.z) ? p.position.z : 0,
      };
      return;
    }
    const lane = idx % laneCount;
    actors[p.id].position = { x: xForLane(lane), y: 0, z: -2 };
  });

  enemies.forEach((e, idx) => {
    if (!actors[e.id]) return;
    if (e && e.position) {
      actors[e.id].position = {
        x: Number.isFinite(e.position.x) ? e.position.x : 0,
        y: Number.isFinite(e.position.y) ? e.position.y : 0,
        z: Number.isFinite(e.position.z) ? e.position.z : 0,
      };
      return;
    }
    const lane = idx % laneCount;
    actors[e.id].position = { x: xForLane(lane), y: 0, z: 2 };
  });
}

function defaultTimeline() {
  return {
    id: null,
    startedAtTick: null,
    lastEndMs: 0,
    events: [],
  };
}

function pushTimelineEvent(state, action, durationMs, phaseSequence) {
  const safeDuration = Math.max(1, Number.isFinite(durationMs) ? durationMs : 1);
  const startMs = state.timeline.lastEndMs;
  const endMs = startMs + safeDuration;

  state.timeline.events.push({
    index: state.timeline.events.length,
    id: action.id,
    tick: action.logicalTick,
    type: action.type,
    source: action.source,
    targetId: action.targetId || null,
    startMs,
    endMs,
    durationMs: safeDuration,
    phaseSequence: Array.isArray(phaseSequence) ? phaseSequence.slice() : [],
  });

  state.timeline.lastEndMs = endMs;
}

function normalizeAction(action, index) {
  const safe = action || {};
  return {
    id: String(safe.id || `evt-${index}`),
    source: String(safe.source || 'system'),
    type: String(safe.type || 'noop'),
    logicalTick: Number.isFinite(safe.logicalTick) ? safe.logicalTick : index,
    initiative: Number.isFinite(safe.initiative) ? safe.initiative : 0,
    targetId: safe.targetId || null,
    baseDamage: Number.isFinite(safe.baseDamage) ? safe.baseDamage : 3,
    timelineId: safe.timelineId || null,
    eventTimeMs: Number.isFinite(safe.eventTimeMs) ? safe.eventTimeMs : null,
  };
}

function resolveAuthority(mode, explicitAuthority) {
  if (explicitAuthority) return explicitAuthority;
  return mode === 'dm' ? 'local-dm' : 'server';
}

function updateCommandProjection(state) {
  const isDm = state.mode === 'dm';
  const isSim = state.authority === 'local-dm';
  const commands = [];

  if (isDm) {
    commands.push('step-turn', 'end-turn', 'replay-last-action');
  }
  if (isDm && isSim) {
    commands.push('set-hp', 'spawn-entity', 'despawn-actor');
  }

  state.ui.availableCommands = commands.sort();
}

function processStartCombat(state, action) {
  state.inCombat = true;
  state.modeDomain = 'combat';
  state.timeline.id = action.timelineId || `combat-${action.logicalTick}`;
  state.timeline.startedAtTick = action.logicalTick;
  state.ui.combatVisible = true;
  state.ui.cameraMode = state.mode === 'dm' ? 'tactical' : 'follow';
  state.ui.timelineLabel = state.timeline.id;
  state.combat.round = Math.max(1, state.combat.round);
  state.combat.turn = 1;
  pushTimelineEvent(state, action, 1, ['network', 'state-apply', 'ui-project']);
}

function processModeChange(state, action) {
  state.mode = action.source;
  state.authority = resolveAuthority(state.mode, null);
  state.dmAuthorityLayer = state.mode === 'dm' ? 'simulator' : 'observer';
  updateCommandProjection(state);
  pushTimelineEvent(state, action, 1, ['mode-update', 'authority-sync', 'command-projection']);
}

function processAuthoritySet(state, action) {
  state.authority = action.source === 'dm' ? 'local-dm' : 'server';
  state.dmAuthorityLayer = state.authority === 'local-dm' ? 'simulator' : 'observer';
  updateCommandProjection(state);
  pushTimelineEvent(state, action, 1, ['authority-update', 'command-projection']);
}

function processAttack(state, action, rng) {
  const source = state.actors[action.source];
  const target = state.actors[action.targetId];
  if (!source || !target || !source.alive || !target.alive) {
    pushTimelineEvent(state, action, 1, ['skip']);
    return;
  }

  if (distance2d(source.position, target.position) > 5) {
    state.ui.lastCombatMessage = `${source.id} could not reach ${target.id}`;
    pushTimelineEvent(state, action, 1, ['out-of-range']);
    return;
  }

  const spread = 1 + Math.floor(rng() * 3);
  const dmg = Math.max(1, action.baseDamage + spread);
  target.hp = Math.max(0, target.hp - dmg);
  target.alive = target.hp > 0;
  source.actedOnTurn = state.turn;
  state.combat.actionCount += 1;

  state.ui.lastCombatMessage = `${source.id} hit ${target.id} for ${dmg}`;
  pushTimelineEvent(state, action, 3 + spread, ['windup', 'impact', 'resolve']);
}

function applyAction(state, action, rng) {
  switch (action.type) {
    case 'network:combat-start':
      processStartCombat(state, action);
      break;
    case 'mode-change':
      processModeChange(state, action);
      break;
    case 'authority-set':
      processAuthoritySet(state, action);
      break;
    case 'action:attack':
      processAttack(state, action, rng);
      break;
    case 'turn:end':
      state.turn += 1;
      state.combat.turn += 1;
      if (state.combat.turn % 10 === 1) {
        state.combat.round += 1;
      }
      pushTimelineEvent(state, action, 1, ['turn-close', 'turn-open']);
      break;
    default:
      pushTimelineEvent(state, action, 1, ['noop']);
      break;
  }
}

function buildLongRunActions(players, enemies, turns, timelineId = 'combat-sim-longrun') {
  const safeTurns = Math.max(0, Number.isFinite(turns) ? Math.floor(turns) : 0);
  if (safeTurns === 0) return [];

  const actions = [
    {
      id: 'auto-start',
      source: 'dm',
      type: 'network:combat-start',
      logicalTick: 0,
      timelineId,
      initiative: 100,
    },
  ];

  let tick = 1;
  const playerIds = players.map((p) => p.id);
  const enemyIds = enemies.map((e) => e.id);

  for (let t = 0; t < safeTurns; t += 1) {
    for (let p = 0; p < playerIds.length; p += 1) {
      actions.push({
        id: `auto-p-${t}-${p}`,
        source: playerIds[p],
        targetId: enemyIds[p % Math.max(1, enemyIds.length)] || null,
        type: 'action:attack',
        logicalTick: tick,
        baseDamage: 3 + ((t + p) % 2),
        initiative: 10 + (p % 5),
      });
      tick += 1;
    }

    for (let e = 0; e < enemyIds.length; e += 1) {
      actions.push({
        id: `auto-e-${t}-${e}`,
        source: enemyIds[e],
        targetId: playerIds[e % Math.max(1, playerIds.length)] || null,
        type: 'action:attack',
        logicalTick: tick,
        baseDamage: 2 + ((t + e) % 2),
        initiative: 8 + (e % 4),
      });
      tick += 1;
    }

    actions.push({
      id: `auto-turn-end-${t}`,
      source: 'dm',
      type: 'turn:end',
      logicalTick: tick,
      initiative: -100,
    });
    tick += 1;
  }

  return actions;
}

function stabilizeEventOrder(actions) {
  return actions
    .map(normalizeAction)
    .sort((a, b) => {
      if (a.logicalTick !== b.logicalTick) return a.logicalTick - b.logicalTick;
      if (a.initiative !== b.initiative) return b.initiative - a.initiative;
      return a.id.localeCompare(b.id);
    });
}

function applyChaos(actions, chaos, rng) {
  if (!chaos) return actions.slice();
  let out = actions.slice();

  if (chaos.duplicate === true) {
    const duped = [];
    out.forEach((evt) => {
      duped.push(evt);
      if (rng() < 0.2) {
        duped.push({ ...evt, id: `${evt.id}-dup` });
      }
    });
    out = duped;
  }

  if (chaos.drop === true) {
    out = out.filter((evt) => rng() > 0.1 || evt.type === 'network:combat-start');
  }

  if (chaos.reorder === true) {
    out = out
      .map((evt) => ({ evt, key: rng() }))
      .sort((a, b) => a.key - b.key)
      .map((entry) => entry.evt);
  }

  if (chaos.delay === true) {
    out = out.map((evt) => ({
      ...evt,
      logicalTick: evt.logicalTick + Math.floor(rng() * 4),
    }));
  }

  return out;
}

function runSimulation(config = {}) {
  const {
    players = [{ id: 'p1', hp: 20 }, { id: 'p2', hp: 20 }],
    enemies = [{ id: 'e1', hp: 18 }],
    actions = [],
    turns = 0,
    seed = 123,
    chaos = null,
  } = config;

  const rng = mulberry32(seed);
  const actors = {};
  players.forEach((p) => {
    actors[p.id] = defaultActor(p.id, 'player', Number.isFinite(p.hp) ? p.hp : 20);
  });
  enemies.forEach((e) => {
    actors[e.id] = defaultActor(e.id, 'enemy', Number.isFinite(e.hp) ? e.hp : 18);
  });
  assignDefaultPositions(players, enemies, actors);

  const state = {
    inCombat: false,
    modeDomain: 'free',
    mode: 'player',
    authority: 'server',
    dmAuthorityLayer: 'observer',
    turn: 1,
    timeline: defaultTimeline(),
    combat: {
      round: 0,
      turn: 0,
      actionCount: 0,
    },
    ui: {
      combatVisible: false,
      cameraMode: 'exploration',
      timelineLabel: null,
      lastCombatMessage: '',
      availableCommands: [],
    },
    actors,
  };

  updateCommandProjection(state);

  const seenIds = new Set();
  const longRunActions = (!Array.isArray(actions) || actions.length === 0)
    ? buildLongRunActions(players, enemies, turns)
    : actions;
  const rawActions = longRunActions.map((a, idx) => normalizeAction(a, idx));
  const noisyActions = applyChaos(rawActions, chaos, rng);
  const ordered = stabilizeEventOrder(noisyActions);

  const processed = [];
  const droppedDuplicates = [];
  const processedActions = [];

  ordered.forEach((action) => {
    const dedupeKey = `${action.type}:${action.source}:${action.targetId || ''}:${action.logicalTick}`;
    if (seenIds.has(dedupeKey)) {
      droppedDuplicates.push(action.id);
      return;
    }
    seenIds.add(dedupeKey);
    applyAction(state, action, rng);
    processed.push(action.id);
    processedActions.push(clone(action));
  });

  const playerIds = players.map((p) => p.id);
  const enemyIds = enemies.map((e) => e.id);
  const livingPlayers = playerIds.filter((id) => state.actors[id] && state.actors[id].alive);
  const livingEnemies = enemyIds.filter((id) => state.actors[id] && state.actors[id].alive);

  state.combat.livingPlayerId = pickFirstAliveActor(playerIds, state.actors);
  state.combat.livingEnemyId = pickFirstAliveActor(enemyIds, state.actors);
  state.combat.winner = livingPlayers.length === 0
    ? 'enemy'
    : livingEnemies.length === 0
      ? 'player'
      : 'none';

  return {
    state,
    timeline: clone(state.timeline),
    log: processedActions,
    context: {
      players: clone(players),
      enemies: clone(enemies),
    },
    processed,
    droppedDuplicates,
  };
}

function replayFromLog(logActions, seed = 123, context = {}) {
  return runSimulation({
    actions: clone(logActions),
    seed,
    players: Array.isArray(context.players) ? clone(context.players) : undefined,
    enemies: Array.isArray(context.enemies) ? clone(context.enemies) : undefined,
  });
}

function rollbackAndReplay(logActions, rollbackIndex, seed = 123, context = {}) {
  const safeIndex = Math.max(0, Math.min(logActions.length, Number.isFinite(rollbackIndex) ? rollbackIndex : 0));
  const initialSegment = clone(logActions.slice(0, safeIndex));
  const replaySegment = clone(logActions.slice(safeIndex));

  const runConfig = {
    seed,
    players: Array.isArray(context.players) ? clone(context.players) : undefined,
    enemies: Array.isArray(context.enemies) ? clone(context.enemies) : undefined,
  };

  const preRollback = runSimulation({ ...runConfig, actions: initialSegment });
  const finalReplay = runSimulation({ ...runConfig, actions: initialSegment.concat(replaySegment) });

  return {
    preRollback,
    finalReplay,
  };
}

function runBurst(size, seed = 77) {
  const actions = [{
    id: 'start',
    source: 'dm',
    type: 'network:combat-start',
    logicalTick: 0,
    timelineId: 'combat-burst',
  }];

  for (let i = 0; i < size; i += 1) {
    actions.push({
      id: `atk-${i}`,
      source: i % 2 === 0 ? 'p1' : 'p2',
      targetId: 'e1',
      type: 'action:attack',
      logicalTick: 1 + i,
      baseDamage: 2 + (i % 3),
      initiative: (i % 10),
    });
  }

  const started = performance.now();
  const result = runSimulation({ actions, seed });
  const elapsedMs = performance.now() - started;

  return {
    elapsedMs,
    queueSize: actions.length,
    processed: result.processed.length,
    dropped: result.droppedDuplicates.length,
    result,
  };
}

module.exports = {
  runSimulation,
  replayFromLog,
  rollbackAndReplay,
  runBurst,
  stabilizeEventOrder,
  buildLongRunActions,
};
