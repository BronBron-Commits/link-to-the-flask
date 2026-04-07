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

  const diffs = [];
  for (let i = 1; i < snapshots.length; i += 1) {
    const prev = snapshots[i - 1];
    const next = snapshots[i];
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
    eventCount: full.timeline.events.length,
    events: full.timeline.events,
    diffs,
    initialState: snapshots.length > 0
      ? {
          tick: snapshots[0].tick,
          actors: snapshots[0].state.actors,
        }
      : null,
    stateByTick: snapshots.map((snapshot) => ({
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
