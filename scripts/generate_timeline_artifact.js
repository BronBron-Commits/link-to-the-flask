/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

const { runSimulation, buildLongRunActions } = require('../tests/js/simulations/simulationHarness');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function diffActorState(prevState, nextState) {
  const prevActors = prevState && prevState.actors ? prevState.actors : {};
  const nextActors = nextState && nextState.actors ? nextState.actors : {};
  const ids = Array.from(new Set([...Object.keys(prevActors), ...Object.keys(nextActors)])).sort();

  const changed = [];
  ids.forEach((id) => {
    const prev = prevActors[id] || null;
    const next = nextActors[id] || null;
    if (!prev || !next) {
      changed.push({ id, prev, next });
      return;
    }
    if (prev.hp !== next.hp || prev.alive !== next.alive) {
      changed.push({
        id,
        prev: { hp: prev.hp, alive: prev.alive },
        next: { hp: next.hp, alive: next.alive },
      });
    }
  });
  return changed;
}

function summarizeAliveActors(state) {
  const actors = state && state.actors ? state.actors : {};
  let playersAlive = 0;
  let enemiesAlive = 0;

  Object.values(actors).forEach((actor) => {
    if (!actor || actor.alive === false || Number(actor.hp || 0) <= 0) return;
    const team = String(actor.team || '').toLowerCase();
    if (team === 'player') playersAlive += 1;
    if (team === 'enemy') enemiesAlive += 1;
  });

  return { playersAlive, enemiesAlive };
}

function generateArtifact() {
  const workspaceRoot = path.resolve(__dirname, '..');
  const outDir = path.join(workspaceRoot, 'artifacts');
  fs.mkdirSync(outDir, { recursive: true });

  const players = [
    { id: 'p1', hp: 28 },
    { id: 'p2', hp: 24 },
    { id: 'p3', hp: 22 },
  ];
  const enemies = [
    { id: 'e1', hp: 26 },
    { id: 'e2', hp: 22 },
  ];

  const actions = buildLongRunActions(players, enemies, 30, 'timeline-debug-seed');
  const full = runSimulation({ seed: 4242, actions, players, enemies });

  const uniqueTicks = Array.from(new Set(full.log.map((evt) => evt.logicalTick))).sort((a, b) => a - b);
  const snapshots = [];

  uniqueTicks.forEach((tick) => {
    const prefix = full.log.filter((evt) => evt.logicalTick <= tick);
    const run = runSimulation({ seed: 4242, actions: prefix, players, enemies });
    snapshots.push({
      tick,
      state: clone(run.state),
    });
  });

  const terminalIndex = snapshots.findIndex((snapshot) => {
    const counts = summarizeAliveActors(snapshot.state);
    return counts.playersAlive <= 0 || counts.enemiesAlive <= 0;
  });

  const trimmedSnapshots = terminalIndex >= 0
    ? snapshots.slice(0, terminalIndex + 1)
    : snapshots;
  const maxTick = trimmedSnapshots.length > 0
    ? trimmedSnapshots[trimmedSnapshots.length - 1].tick
    : null;
  const trimmedEvents = Number.isFinite(maxTick)
    ? full.timeline.events.filter((evt) => Number(evt.tick) <= Number(maxTick))
    : full.timeline.events.slice();

  const diffs = [];
  for (let i = 1; i < trimmedSnapshots.length; i += 1) {
    const prev = trimmedSnapshots[i - 1];
    const next = trimmedSnapshots[i];
    const changedActors = diffActorState(prev.state, next.state);
    if (changedActors.length > 0) {
      diffs.push({
        tick: next.tick,
        changedActors,
      });
    }
  }

  const artifact = {
    generatedAt: new Date().toISOString(),
    seed: 4242,
    players,
    enemies,
    eventCount: trimmedEvents.length,
    events: trimmedEvents,
    diffs,
    initialState: trimmedSnapshots.length > 0
      ? {
          tick: trimmedSnapshots[0].tick,
          actors: trimmedSnapshots[0].state.actors,
        }
      : null,
    stateByTick: trimmedSnapshots.map((snapshot) => ({
      tick: snapshot.tick,
      actors: snapshot.state.actors,
      combat: snapshot.state.combat,
      authority: snapshot.state.authority,
      mode: snapshot.state.mode,
    })),
  };

  const outPath = path.join(outDir, 'timeline-debug.json');
  fs.writeFileSync(outPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  return outPath;
}

const outPath = generateArtifact();
console.log(`Timeline artifact written: ${outPath}`);
