const terminalEl = document.getElementById('terminal');
const statusPill = document.getElementById('status-pill');
const suitesEl = document.getElementById('summary-suites');
const testsEl = document.getElementById('summary-tests');
const codeEl = document.getElementById('summary-code');
const commandEl = document.getElementById('summary-command');

const runAllBtn = document.getElementById('run-all');
const runWatchBtn = document.getElementById('run-watch');
const runFileBtn = document.getElementById('run-file');
const stopBtn = document.getElementById('stop');
const clearBtn = document.getElementById('clear');
const testFileInput = document.getElementById('test-file');

const timelineGenerateBtn = document.getElementById('timeline-generate');
const timelineLoadBtn = document.getElementById('timeline-load');
const timelineSlider = document.getElementById('timeline-slider');
const timelineTickEl = document.getElementById('timeline-tick');
const timelineEventEl = document.getElementById('timeline-event');
const timelineDiffEl = document.getElementById('timeline-diff');
const timelineStateEl = document.getElementById('timeline-state');
const timelineMarkersEl = document.getElementById('timeline-markers');
const timelinePhaseStripEl = document.getElementById('timeline-phase-strip');
const comparePathAEl = document.getElementById('compare-path-a');
const comparePathBEl = document.getElementById('compare-path-b');
const timelineCompareBtn = document.getElementById('timeline-compare');
const timelineDivergenceEl = document.getElementById('timeline-divergence');

const inspectorStartBtn = document.getElementById('inspector-start');
const inspectorStopBtn = document.getElementById('inspector-stop');
const inspectorSourceEl = document.getElementById('inspector-source');
const inspectorTickEl = document.getElementById('inspector-tick');
const inspectorAuthorityEl = document.getElementById('inspector-authority');
const inspectorQueueEl = document.getElementById('inspector-queue');
const inspectorPendingEl = document.getElementById('inspector-pending');
const inspectorEventsEl = document.getElementById('inspector-events');
const inspectorRawEl = document.getElementById('inspector-raw');

let busy = false;
let timelineData = null;

function append(text, isError = false) {
    const safeText = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    terminalEl.textContent += safeText;
    if (isError) {
        terminalEl.textContent += '\n';
    }
    terminalEl.scrollTop = terminalEl.scrollHeight;
}

function setStatus(state) {
    statusPill.className = `pill ${state}`;
    statusPill.textContent = state;
}

function setBusy(next) {
    busy = !!next;
    runAllBtn.disabled = busy;
    runWatchBtn.disabled = busy;
    runFileBtn.disabled = busy;
    testFileInput.disabled = busy;
    stopBtn.disabled = !busy;
}

async function run(payload) {
    if (busy) return;
    setBusy(true);
    setStatus('running');

    const result = await window.testRunnerApi.runTests(payload);
    if (!result.ok) {
        append(`\n[error] ${result.error}\n`, true);
        setStatus('failed');
        setBusy(false);
    }
}

runAllBtn.addEventListener('click', () => run({ mode: 'all' }));
runWatchBtn.addEventListener('click', () => run({ mode: 'watch' }));
runFileBtn.addEventListener('click', () => {
    const testPath = testFileInput.value.trim();
    if (!testPath) {
        append('\n[hint] Enter a test path first, e.g. tests/js/combat-system.test.js\n');
        return;
    }
    run({ mode: 'file', testPath });
});

stopBtn.addEventListener('click', async () => {
    await window.testRunnerApi.stopTests();
    setStatus('stopped');
    setBusy(false);
});

clearBtn.addEventListener('click', () => {
    terminalEl.textContent = '';
});

window.testRunnerApi.onOutput(({ stream, text }) => {
    append(text, stream === 'stderr');
});

window.testRunnerApi.onStatus((payload) => {
    if (payload.command) {
        commandEl.textContent = payload.command;
    }

    if (payload.state === 'running') {
        setStatus('running');
        return;
    }

    if (payload.state === 'passed' || payload.state === 'failed') {
        setStatus(payload.state);
        codeEl.textContent = String(payload.code);
        suitesEl.textContent = payload.summary?.testSuites || '-';
        testsEl.textContent = payload.summary?.tests || '-';
        setBusy(false);
        return;
    }

    if (payload.state === 'stopped') {
        setStatus('stopped');
        codeEl.textContent = '-';
        setBusy(false);
    }
});

setBusy(false);
setStatus('idle');
append('Electron test runner ready. Click "Run All Tests" to begin.\n');

function renderTimelineAt(index) {
    if (!timelineData || !Array.isArray(timelineData.events) || timelineData.events.length === 0) {
        timelineTickEl.textContent = 'tick -';
        timelineEventEl.textContent = 'No timeline loaded.';
        timelineDiffEl.textContent = 'State diff unavailable.';
        timelineStateEl.textContent = 'State snapshot unavailable.';
        return;
    }

    const safeIdx = Math.max(0, Math.min(index, timelineData.events.length - 1));
    const evt = timelineData.events[safeIdx];
    const tick = Number.isFinite(evt.tick) ? evt.tick : safeIdx;
    timelineTickEl.textContent = `tick ${tick} (event ${safeIdx + 1}/${timelineData.events.length})`;
    timelineEventEl.textContent = JSON.stringify(evt, null, 2);
    renderTimelineMarkers(safeIdx);
    renderTimelinePhases(evt);

    const diff = Array.isArray(timelineData.diffs)
        ? timelineData.diffs.find((d) => d.tick === tick)
        : null;
    timelineDiffEl.textContent = diff
        ? JSON.stringify(diff, null, 2)
        : 'No state diff at this tick.';

    const snapshot = Array.isArray(timelineData.stateByTick)
        ? timelineData.stateByTick.find((s) => s.tick === tick)
        : null;
    timelineStateEl.textContent = snapshot
        ? JSON.stringify(snapshot, null, 2)
        : 'No state snapshot at this tick.';
}

function getTimelineMarkerClass(evt) {
    const type = String(evt?.type || '').toLowerCase();
    if (type.startsWith('input:ack') || evt?.inputAck || evt?.ack) return 'ack';
    if (type.startsWith('presentation:phase')) return 'presentation';
    if (type.startsWith('action:')) return 'attack';
    if (type.startsWith('turn:')) return 'turn';
    if (type.startsWith('network:')) return 'network';
    return 'generic';
}

function getTimelineMarkerLabel(evt, index) {
    const tick = Number.isFinite(evt?.tick) ? evt.tick : index;
    const type = String(evt?.type || 'event');
    if (type.startsWith('input:ack')) {
        const outcome = String(evt?.outcome || evt?.ack?.outcome || evt?.inputAck?.outcome || 'ack').toUpperCase();
        return `${tick}: ${outcome}`;
    }
    if (type.startsWith('presentation:phase')) {
        const phase = String(evt?.phase || evt?.payload?.phase || 'phase').toUpperCase();
        const state = String(evt?.state || 'start').toUpperCase();
        return `${tick}: ${phase} ${state}`;
    }
    if (type.startsWith('action:attack')) return `${tick}: ATTACK`;
    if (type.startsWith('turn:end')) return `${tick}: TURN END`;
    if (type.startsWith('network:combat-start')) return `${tick}: START`;
    return `${tick}: ${type.replace(/^.*?:/, '').toUpperCase()}`;
}

function renderTimelineMarkers(activeIndex) {
    if (!timelineMarkersEl) return;
    const events = Array.isArray(timelineData?.events) ? timelineData.events : [];
    timelineMarkersEl.innerHTML = '';
    if (events.length === 0) {
        timelineMarkersEl.textContent = 'No timeline markers.';
        return;
    }

    const maxMarkers = Math.min(events.length, 200);
    for (let i = 0; i < maxMarkers; i += 1) {
        const evt = events[i];
        const marker = document.createElement('button');
        marker.type = 'button';
        marker.className = `timeline-marker ${getTimelineMarkerClass(evt)}${i === activeIndex ? ' active' : ''}`;
        marker.textContent = getTimelineMarkerLabel(evt, i);
        marker.title = `${String(evt?.type || 'event')} (${Number.isFinite(evt?.startMs) ? `${evt.startMs}ms` : 'n/a'} to ${Number.isFinite(evt?.endMs) ? `${evt.endMs}ms` : 'n/a'})`;
        marker.addEventListener('click', () => {
            timelineSlider.value = String(i);
            renderTimelineAt(i);
        });
        timelineMarkersEl.appendChild(marker);
    }
}

function renderTimelinePhases(evt) {
    if (!timelinePhaseStripEl) return;
    const phases = Array.isArray(evt?.phaseSequence) ? evt.phaseSequence : [];
    timelinePhaseStripEl.innerHTML = '';
    if (phases.length === 0) {
        timelinePhaseStripEl.textContent = 'No phase sequence.';
        return;
    }
    for (const phase of phases) {
        const chip = document.createElement('span');
        chip.className = 'timeline-phase-chip';
        chip.textContent = String(phase);
        timelinePhaseStripEl.appendChild(chip);
    }
}

timelineSlider.addEventListener('input', () => {
    const idx = Number.parseInt(timelineSlider.value, 10) || 0;
    renderTimelineAt(idx);
});

timelineGenerateBtn.addEventListener('click', async () => {
    const result = await window.testRunnerApi.generateTimeline();
    if (!result.ok) {
        append(`\n[timeline:error] ${result.error}\n`, true);
        return;
    }
    append(`\n[timeline] Generated at ${result.artifactPath}\n`);
});

timelineLoadBtn.addEventListener('click', async () => {
    const result = await window.testRunnerApi.loadTimeline();
    if (!result.ok) {
        append(`\n[timeline:error] ${result.error}\n`, true);
        return;
    }

    timelineData = result.data;
    const count = Array.isArray(timelineData.events) ? timelineData.events.length : 0;
    timelineSlider.max = String(Math.max(0, count - 1));
    timelineSlider.value = '0';
    renderTimelineMarkers(0);
    renderTimelineAt(0);
    append(`\n[timeline] Loaded ${count} events from ${result.artifactPath}\n`);
});

timelineCompareBtn.addEventListener('click', async () => {
    const result = await window.testRunnerApi.compareTimeline({
        pathA: comparePathAEl.value.trim(),
        pathB: comparePathBEl.value.trim(),
    });

    if (!result.ok) {
        timelineDivergenceEl.textContent = `[compare:error] ${result.error}`;
        append(`\n[compare:error] ${result.error}\n`, true);
        return;
    }

    if (result.equal) {
        timelineDivergenceEl.textContent = `No divergence. Artifacts are equivalent.\nA: ${result.pathA}\nB: ${result.pathB}`;
        append(`\n[compare] No divergence between artifacts.\n`);
        return;
    }

    timelineDivergenceEl.textContent = JSON.stringify(result.divergence, null, 2);
    append(`\n[compare] Divergence found at tick ${result.divergence?.tick ?? 'unknown'} (${result.divergence?.type || 'unknown'}).\n`, true);
});

inspectorStartBtn.addEventListener('click', async () => {
    const result = await window.testRunnerApi.startInspector({ intervalMs: 750 });
    if (!result.ok) {
        append(`\n[inspector:error] ${result.error || 'Failed to start inspector'}\n`, true);
        return;
    }
    append(`\n[inspector] attached (${result.stateFilePath})\n`);
});

inspectorStopBtn.addEventListener('click', async () => {
    await window.testRunnerApi.stopInspector();
    append('\n[inspector] detached\n');
});

window.testRunnerApi.onInspectorUpdate((snapshot) => {
    inspectorSourceEl.textContent = String(snapshot.source || '-');
    inspectorTickEl.textContent = String(snapshot.tick ?? '-');
    inspectorAuthorityEl.textContent = String(snapshot.authority || '-');
    inspectorQueueEl.textContent = String(snapshot.queueDepth ?? '-');
    inspectorPendingEl.textContent = String(snapshot.pendingNetworkEvents ?? '-');
    inspectorEventsEl.textContent = String(snapshot.timelineEvents ?? '-');
    inspectorRawEl.textContent = JSON.stringify(snapshot, null, 2);
});

window.testRunnerApi.onInspectorStatus((payload) => {
    if (payload.state === 'running') {
        inspectorRawEl.textContent = `Inspector running. Polling every ${payload.intervalMs} ms.`;
    }
    if (payload.state === 'stopped') {
        inspectorRawEl.textContent = 'Inspector detached.';
    }
});
