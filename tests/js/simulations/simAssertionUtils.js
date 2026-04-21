function firstDifferentActor(runA, runB) {
  const actorsA = runA && runA.state && runA.state.actors ? runA.state.actors : {};
  const actorsB = runB && runB.state && runB.state.actors ? runB.state.actors : {};
  const ids = Array.from(new Set([...Object.keys(actorsA), ...Object.keys(actorsB)])).sort();

  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i];
    const a = actorsA[id];
    const b = actorsB[id];
    if (!a || !b) {
      return { id, field: 'missing', expected: a || null, actual: b || null };
    }
    if (a.hp !== b.hp) {
      return { id, field: 'hp', expected: a.hp, actual: b.hp };
    }
    if (a.alive !== b.alive) {
      return { id, field: 'alive', expected: a.alive, actual: b.alive };
    }
  }

  return null;
}

function firstTimelineDiff(runA, runB) {
  const eventsA = runA && runA.timeline && Array.isArray(runA.timeline.events) ? runA.timeline.events : [];
  const eventsB = runB && runB.timeline && Array.isArray(runB.timeline.events) ? runB.timeline.events : [];
  const len = Math.max(eventsA.length, eventsB.length);

  for (let i = 0; i < len; i += 1) {
    const a = eventsA[i];
    const b = eventsB[i];
    if (!a || !b) {
      return {
        index: i,
        tick: a ? a.tick : b ? b.tick : null,
        reason: 'event-count-mismatch',
      };
    }

    if (a.tick !== b.tick || a.type !== b.type || a.source !== b.source || a.targetId !== b.targetId) {
      return {
        index: i,
        tick: a.tick,
        reason: 'event-sequence-mismatch',
        expected: { tick: a.tick, type: a.type, source: a.source, targetId: a.targetId },
        actual: { tick: b.tick, type: b.type, source: b.source, targetId: b.targetId },
      };
    }
  }

  return null;
}

function buildDivergenceMessage(runA, runB) {
  const eventDiff = firstTimelineDiff(runA, runB);
  const actorDiff = firstDifferentActor(runA, runB);

  const parts = ['Simulation divergence detected.'];

  if (eventDiff) {
    parts.push(`Divergence at tick ${eventDiff.tick ?? 'unknown'} (event index ${eventDiff.index}).`);
    parts.push(`Reason: ${eventDiff.reason}.`);
    if (eventDiff.expected && eventDiff.actual) {
      parts.push(`Expected event: ${JSON.stringify(eventDiff.expected)}.`);
      parts.push(`Actual event: ${JSON.stringify(eventDiff.actual)}.`);
    }
  }

  if (actorDiff) {
    parts.push(`Actor ${actorDiff.id} differs on ${actorDiff.field}.`);
    parts.push(`Expected: ${JSON.stringify(actorDiff.expected)}.`);
    parts.push(`Actual: ${JSON.stringify(actorDiff.actual)}.`);
  }

  if (!eventDiff && !actorDiff) {
    parts.push('State mismatch found but no focused divergence extracted.');
  }

  return parts.join(' ');
}

function expectDeterministicRunPair(runA, runB) {
  if (runA.state && runB.state && JSON.stringify(runA.state) === JSON.stringify(runB.state)
    && JSON.stringify(runA.timeline) === JSON.stringify(runB.timeline)
    && JSON.stringify(runA.processed) === JSON.stringify(runB.processed)) {
    return;
  }

  throw new Error(buildDivergenceMessage(runA, runB));
}

module.exports = {
  expectDeterministicRunPair,
};
