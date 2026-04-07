// --- Socket.IO real-time multiplayer ---
// Assumes <script src="https://cdn.socket.io/4.7.5/socket.io.min.js"></script> is loaded in the HTML
let socket = null;
let socketModeUnsubscribe = null;
const SUPPRESSED_CONSOLE_WARNING_SNIPPETS = [
    'THREE.ImageUtils.getDataURL: Image converted to jpg for performance reasons',
];

function installConsoleSpamFilter() {
    if (console.__map3dSpamFilterInstalled) return;
    console.__map3dSpamFilterInstalled = true;

    const baseWarn = console.warn.bind(console);
    console.warn = (...args) => {
        const first = typeof args[0] === 'string' ? args[0] : '';
        const shouldSuppress = SUPPRESSED_CONSOLE_WARNING_SNIPPETS.some((snippet) => first.includes(snippet));
        if (shouldSuppress) return;
        baseWarn(...args);
    };
}

installConsoleSpamFilter();

const __urlSearch = new URLSearchParams(window.location.search || '');
const __dmPipelineDebugDefault = __urlSearch.get('dmdebug') === '1';
const __dmForceGodDefault = __urlSearch.get('godlocal') === '1';
const __dmForceLocalCommandsDefault = __dmForceGodDefault || __urlSearch.get('dmlocal') === '1';
const __dmBypassGatesDefault = __dmForceGodDefault || __urlSearch.get('dmbypass') === '1';

window.__DM_PIPELINE_DEBUG__ = __dmPipelineDebugDefault;
window.__DM_FORCE_GOD_MODE__ = __dmForceGodDefault;
window.__DM_FORCE_LOCAL_DM_COMMANDS__ = __dmForceLocalCommandsDefault;
window.__DM_SKIP_SOCKET_DM_COMMANDS__ = __dmForceLocalCommandsDefault;
window.__DM_BYPASS_COMMAND_GATES__ = __dmBypassGatesDefault;

function isDmPipelineDebugEnabled() {
    return window.__DM_PIPELINE_DEBUG__ === true;
}

function traceDmPipeline(stage, details) {
    if (!isDmPipelineDebugEnabled()) return;
    console.log(`[DM PIPELINE] ${stage}`, details || {});
}

let pendingRuntimeMode = null;
let pendingSceneState = null;
let pendingWorldHydrationPayload = null;
let _worldHydrator = null;
let socketConnectionManager = null;
const serverEntityNetworkIds = new Set();

function isCameraReadyForRuntimeMode() {
    try {
        return !!camera;
    } catch (_err) {
        return false;
    }
}

function isSceneReadyForWorldState() {
    try {
        return !!scene && typeof scene.traverse === 'function';
    } catch (_err) {
        return false;
    }
}

function flushPendingWorldState() {
    if (!isSceneReadyForWorldState()) return;

    if (pendingSceneState && pendingSceneState.objects) {
        const queuedState = pendingSceneState;
        pendingSceneState = null;
        applySceneState(queuedState);
    }

    if (pendingWorldHydrationPayload) {
        const queuedPayload = pendingWorldHydrationPayload;
        pendingWorldHydrationPayload = null;
        hydrateWorld(queuedPayload);
    }
}

function flushPendingRuntimeMode() {
    if (!isCameraReadyForRuntimeMode()) return;
    if (!pendingRuntimeMode) return;
    const queuedMode = pendingRuntimeMode;
    pendingRuntimeMode = null;
    applyRuntimeMode(queuedMode);
}

function getNetworkRoleFromMode(mode) {
    if (!socketConnectionManager) {
        const normalized = String(mode || '').toLowerCase();
        if (normalized === 'dm') return 'dm';
        if (normalized === 'dev') return 'dev';
        return 'player';
    }
    return socketConnectionManager.getNetworkRoleFromMode(mode);
}

function registerRoleWithServer() {
    if (!socketConnectionManager) return;
    socketConnectionManager.registerRoleWithServer();
}

let lobbyState = null;
let sessionGameState = 'lobby';
let authoritativePlayerId = null;
const DM_UI_V2 = true;
const SIMULATION_AUTHORITY = Object.freeze({
    SERVER: 'server',
    LOCAL_DM: 'local-dm',
});
const DM_AUTHORITY_LAYER = Object.freeze({
    OBSERVER: 'observer',
    PUPPETEER: 'puppeteer',
    SIMULATOR: 'simulator',
});
const DM_CAPABILITY_PRESETS = Object.freeze({
    [DM_AUTHORITY_LAYER.OBSERVER]: Object.freeze({
        possess: false,
        injectInput: false,
        overrideStats: false,
        controlTimeline: true,
        spawnDespawn: false,
        forceRoll: false,
        toggleAi: false,
    }),
    [DM_AUTHORITY_LAYER.PUPPETEER]: Object.freeze({
        possess: true,
        injectInput: true,
        overrideStats: false,
        controlTimeline: true,
        spawnDespawn: false,
        forceRoll: true,
        toggleAi: true,
    }),
    [DM_AUTHORITY_LAYER.SIMULATOR]: Object.freeze({
        possess: true,
        injectInput: true,
        overrideStats: true,
        controlTimeline: true,
        spawnDespawn: true,
        forceRoll: true,
        toggleAi: true,
    }),
});
const DM_COMMAND_CAPABILITY = Object.freeze({
    'step-turn': 'controlTimeline',
    'end-turn': 'controlTimeline',
    'rewind-turn': 'controlTimeline',
    'replay-last-action': 'controlTimeline',
    'save-snapshot': 'controlTimeline',
    'restore-snapshot': 'controlTimeline',
    'possess': 'possess',
    'possess-actor': 'possess',
    'release-possession': 'possess',
    'inject-input': 'injectInput',
    'set-hp': 'overrideStats',
    'apply-damage': 'overrideStats',
    'spawn-training-dummy': 'spawnDespawn',
    'spawn-entity': 'spawnDespawn',
    'despawn-actor': 'spawnDespawn',
    'set-simulation-authority': 'controlTimeline',
    'force-roll': 'forceRoll',
    'toggle-ai': 'toggleAi',
    'trigger-event': 'forceRoll',
});
let simulationAuthority = SIMULATION_AUTHORITY.SERVER;
let dmAuthorityLayer = DM_AUTHORITY_LAYER.OBSERVER;

const SETTINGS = {
    quality: 'high',
    shadows: true,
    particles: true,
    postProcessing: true,
    maxFPS: 60,
    renderScale: 1.0,
};
let frameIntervalMs = 1000 / 60;
let lastFrameTimeMs = 0;
let focusedMaxFPS = SETTINGS.maxFPS;
let focusedParticlesEnabled = SETTINGS.particles;
let focusedRenderScale = SETTINGS.renderScale;

function isPrimaryClient() {
    return true;
}

function applySettings() {
    const configuredMaxFPS = Number(SETTINGS.maxFPS) || 60;
    const baseMaxFPS = Math.max(10, configuredMaxFPS);
    frameIntervalMs = 1000 / baseMaxFPS;
    combatParticlesEnabled = !!SETTINGS.particles;
    updateCombatParticleBudget();

    if (!rendererReady) return;

    const dpr = window.devicePixelRatio || 1;
    const configuredScale = Math.max(0.35, Math.min(1.0, Number(SETTINGS.renderScale) || 1));
    const primaryScale = configuredScale;
    renderer.setPixelRatio(dpr * primaryScale);
    renderer.shadowMap.enabled = !!SETTINGS.shadows;
}

function setQuality(level) {
    const normalized = String(level || '').toLowerCase();
    if (normalized === 'low') {
        SETTINGS.quality = 'low';
        SETTINGS.renderScale = 0.5;
        SETTINGS.shadows = false;
        SETTINGS.particles = false;
        SETTINGS.maxFPS = 30;
    } else if (normalized === 'medium') {
        SETTINGS.quality = 'medium';
        SETTINGS.renderScale = 0.75;
        SETTINGS.shadows = false;
        SETTINGS.particles = true;
        SETTINGS.maxFPS = 45;
    } else if (normalized === 'high') {
        SETTINGS.quality = 'high';
        SETTINGS.renderScale = 1.0;
        SETTINGS.shadows = true;
        SETTINGS.particles = true;
        SETTINGS.maxFPS = 60;
    } else {
        return false;
    }

    focusedMaxFPS = SETTINGS.maxFPS;
    focusedParticlesEnabled = SETTINGS.particles;
    focusedRenderScale = SETTINGS.renderScale;
    applySettings();
    return true;
}

document.addEventListener('visibilitychange', () => {
    focusedMaxFPS = Number(SETTINGS.maxFPS) || focusedMaxFPS;
    focusedParticlesEnabled = !!SETTINGS.particles;
    focusedRenderScale = Math.max(0.35, Math.min(1.0, Number(SETTINGS.renderScale) || focusedRenderScale));
    applySettings();
});

function requestStartGame() {
    if (!socketConnectionManager) return;
    socketConnectionManager.requestStartGame();
}

function updateLobbyOverlayFromState() {
    if (!modeOverlayEl || !modeOverlayEl.__lobbyWidgets) return;
    const widgets = modeOverlayEl.__lobbyWidgets;
    const slots = lobbyState && lobbyState.slots ? lobbyState.slots : {};
    const playerSlots = Array.isArray(lobbyState && lobbyState.playerSlots) ? lobbyState.playerSlots : [];
    const rolesLocked = !!(lobbyState && lobbyState.rolesLocked);
    sessionGameState = String((lobbyState && lobbyState.gameState) || sessionGameState || 'lobby');
    authoritativePlayerId = (lobbyState && typeof lobbyState.authoritativePlayerId === 'string')
        ? lobbyState.authoritativePlayerId
        : authoritativePlayerId;

    const roleToMode = {
        player: 'player',
        dm: 'dm',
        dev: 'dev',
    };

    Object.entries(roleToMode).forEach(([role, mode]) => {
        const btn = widgets.buttonsByMode.get(mode);
        if (!btn) return;
        const line2 = btn.__detailLine;
        const slot = slots[role] || null;
        const occupied = Number(slot && slot.occupied) || 0;
        const capacity = Math.max(1, Number(slot && slot.capacity) || (role === 'player' ? 4 : 1));
        const isFull = !!(slot && slot.isFull);
        if (line2) {
            const base = String(line2.__baseDetail || line2.textContent || '');
            line2.textContent = `${base} Slot ${occupied}/${capacity}${isFull ? ' (full)' : ''}`;
        }
        const isCurrentRole = getNetworkRoleFromMode(modeManager.current) === role;
        btn.disabled = (isFull && !isCurrentRole) || (rolesLocked && !isCurrentRole);
        btn.style.opacity = btn.disabled ? '0.52' : '1';
        btn.style.cursor = btn.disabled ? 'not-allowed' : 'pointer';
    });

    if (widgets.statusEl) {
        const total = Number(lobbyState && lobbyState.totalConnected) || 0;
        const authTag = authoritativePlayerId ? ` | authority ${authoritativePlayerId.slice(0, 6)}` : '';
        widgets.statusEl.textContent = `Lobby ${sessionGameState.toUpperCase()}: ${total} connected${authTag}`;
    }

    if (widgets.playerSlotsEl) {
        const lines = playerSlots.length > 0
            ? playerSlots.map((slot) => {
                const sid = slot && slot.sid ? String(slot.sid) : null;
                return `P${Number(slot && slot.slot) || '?'}: ${sid ? sid.slice(0, 6) : 'open'}`;
            })
            : ['P1: open', 'P2: open', 'P3: open', 'P4: open'];
        widgets.playerSlotsEl.textContent = lines.join(' | ');
    }

    if (widgets.startBtn) {
        widgets.startBtn.disabled = true;
        widgets.startBtn.style.display = 'none';
    }
}

async function refreshLobbyStateSnapshot() {
    try {
        const response = await fetch('/lobby_state', {
            method: 'GET',
            headers: { Accept: 'application/json' },
        });
        if (!response.ok) return;
        const payload = await response.json();
        if (!payload || payload.ok !== true || !payload.lobby) return;
        lobbyState = payload.lobby;
        updateLobbyOverlayFromState();
    } catch (_err) {
        // Snapshot polling is best-effort only.
    }
}

let activeNetworkCombatTimeline = null;
let localCombatTimelineId = null;
const pendingNetworkCombatEvents = [];
const NETWORK_TIMELINE_MAX_EVENTS_PER_FRAME = 2;
const NETWORK_TIMELINE_FRAME_BUDGET_MS = 4;

function alignNetworkCombatTimeline(payload, options = {}) {
    if (!payload || typeof payload !== 'object') return false;
    const timelineId = String(payload.timelineId || '').trim();
    const startTimeMs = Number(payload.startTimeMs);
    if (!timelineId || !Number.isFinite(startTimeMs)) return false;

    const nowWallMs = Date.now();
    const elapsedSinceStartMs = Math.max(0, nowWallMs - startTimeMs);
    activeNetworkCombatTimeline = {
        id: timelineId,
        startTimeMs,
        localStartPerfMs: performance.now() - elapsedSinceStartMs,
    };

    if (options.adoptAsLocalAuthority) {
        localCombatTimelineId = timelineId;
    }

    return true;
}

function beginLocalCombatTimeline() {
    if (!isSimulationOwner()) return false;
    if (currentGameMode !== GAME_MODE.COMBAT) return false;
    if (activeNetworkCombatTimeline && localCombatTimelineId && activeNetworkCombatTimeline.id === localCombatTimelineId) {
        return true;
    }

    const timelineId = `combat-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const startTimeMs = Date.now();

    alignNetworkCombatTimeline({ timelineId, startTimeMs }, { adoptAsLocalAuthority: true });
    if (socket) {
        socket.emit('timeline-start', { timelineId, startTimeMs });
    }
    return true;
}

const dmAuthorityManager = createDmAuthorityManager({
    SIMULATION_AUTHORITY,
    DM_AUTHORITY_LAYER,
    modeDm: 'dm',
    getSimulationAuthority: () => simulationAuthority,
    setSimulationAuthorityState: (value) => { simulationAuthority = value; },
    getDmAuthorityLayer: () => dmAuthorityLayer,
    setDmAuthorityLayerState: (value) => { dmAuthorityLayer = value; },
    getCurrentGameMode: () => currentGameMode,
    gameModeCombat: 'combat',
    beginLocalCombatTimeline,
    getControlledActor,
    releasePossession,
    getModeManager: () => modeManager,
    traceDmPipeline,
    appendConsoleHistory,
});

function startLocalSimulation() {
    return dmAuthorityManager.startLocalSimulation();
}

function setSimulationAuthority(authority) {
    return dmAuthorityManager.setSimulationAuthority(authority);
}

function getDmCapabilities() {
    const layer = Object.values(DM_AUTHORITY_LAYER).includes(dmAuthorityLayer)
        ? dmAuthorityLayer
        : DM_AUTHORITY_LAYER.OBSERVER;
    return DM_CAPABILITY_PRESETS[layer] || DM_CAPABILITY_PRESETS[DM_AUTHORITY_LAYER.OBSERVER];
}

function syncDmAuthorityLayerFromState() {
    return dmAuthorityManager.syncDmAuthorityLayerFromState();
}

function setDmAuthorityLayer(nextLayer) {
    return dmAuthorityManager.setDmAuthorityLayer(nextLayer);
}

function canIssueDmCommand(type) {
    if (window.__DM_BYPASS_COMMAND_GATES__ === true) {
        return true;
    }
    if (modeManager.current !== MODE.DM) return false;
    const capabilityKey = DM_COMMAND_CAPABILITY[String(type || '').toLowerCase()];
    if (!capabilityKey) return true;
    const caps = getDmCapabilities();
    return caps[capabilityKey] === true;
}

function registerDmCommandButton(button, commandType) {
    if (!button || !commandType) return;
    const key = String(commandType || '').toLowerCase();
    if (!dmCommandButtonRefs.has(key)) {
        dmCommandButtonRefs.set(key, new Set());
    }
    dmCommandButtonRefs.get(key).add(button);
}

function updateDmCommandButtonStates() {
    dmCommandButtonRefs.forEach((buttons, commandType) => {
        const allowed = canIssueDmCommand(commandType);
        buttons.forEach((button) => {
            if (!button) return;
            button.disabled = !allowed;
            button.style.opacity = allowed ? '1' : '0.45';
            button.style.cursor = allowed ? 'pointer' : 'not-allowed';
        });
    });
}

window.__SIM_DEBUG_ENABLED__ = window.__SIM_DEBUG_ENABLED__ === true;
window.__SIM_DEBUG__ = window.__SIM_DEBUG__ || {
    timeline: [],
    currentTick: 0,
    listeners: new Set(),
};

const SIM_DEBUG_MAX_TICKS = 2000;
let simDebugOverlayEl = null;

function isSimDebugEnabled() {
    return window.__SIM_DEBUG_ENABLED__ === true;
}

function getActorsFromCombatState(state) {
    if (!state || typeof state !== 'object') return {};
    if (state.actors && typeof state.actors === 'object') return state.actors;
    if (state.combat && typeof state.combat.actors === 'object') return state.combat.actors;
    if (state.world && typeof state.world.actors === 'object') return state.world.actors;
    return {};
}

function normalizeActorState(actorState) {
    if (!actorState || typeof actorState !== 'object') {
        return {
            hp: null,
            maxHp: null,
            alive: null,
        };
    }
    const hpRaw = Number(actorState.hp);
    const maxHpRaw = Number(actorState.maxHp ?? actorState.max_hp);
    return {
        hp: Number.isFinite(hpRaw) ? hpRaw : null,
        maxHp: Number.isFinite(maxHpRaw) ? maxHpRaw : null,
        alive: typeof actorState.alive === 'boolean' ? actorState.alive : null,
    };
}

function computeActorDiff(prevState, nextState) {
    const prevActors = getActorsFromCombatState(prevState);
    const nextActors = getActorsFromCombatState(nextState);
    const actorIds = Array.from(new Set([...Object.keys(prevActors), ...Object.keys(nextActors)])).sort();
    const changedActors = [];

    actorIds.forEach((id) => {
        const prev = normalizeActorState(prevActors[id]);
        const next = normalizeActorState(nextActors[id]);
        if (prev.hp !== next.hp || prev.maxHp !== next.maxHp || prev.alive !== next.alive) {
            changedActors.push({ id, prev, next });
        }
    });

    return changedActors;
}

function getSimDebugOverlayEl() {
    if (simDebugOverlayEl && simDebugOverlayEl.isConnected) return simDebugOverlayEl;
    if (!dmRightPanelEl) return null;

    simDebugOverlayEl = document.createElement('div');
    simDebugOverlayEl.id = 'sim-debug-overlay';
    simDebugOverlayEl.style.pointerEvents = 'none';
    simDebugOverlayEl.style.border = '1px solid rgba(138, 182, 255, 0.36)';
    simDebugOverlayEl.style.background = 'rgba(7, 14, 29, 0.85)';
    simDebugOverlayEl.style.borderRadius = '10px';
    simDebugOverlayEl.style.padding = '10px';
    simDebugOverlayEl.style.color = '#d9e9ff';
    simDebugOverlayEl.style.fontFamily = 'Consolas, "Segoe UI", monospace';
    simDebugOverlayEl.style.fontSize = '12px';
    simDebugOverlayEl.style.lineHeight = '1.35';
    simDebugOverlayEl.style.display = 'none';
    dmRightPanelEl.appendChild(simDebugOverlayEl);
    return simDebugOverlayEl;
}

function formatActorDiffLine(change) {
    const id = String(change && change.id ? change.id : '?');
    const prevHp = Number.isFinite(change?.prev?.hp) ? change.prev.hp : null;
    const nextHp = Number.isFinite(change?.next?.hp) ? change.next.hp : null;
    const prevAlive = change?.prev?.alive;
    const nextAlive = change?.next?.alive;
    let statusTag = '';
    if (prevAlive === true && nextAlive === false) {
        statusTag = ' DEAD';
    } else if (prevAlive === false && nextAlive === true) {
        statusTag = ' REVIVED';
    }

    if (Number.isFinite(prevHp) && Number.isFinite(nextHp)) {
        const delta = nextHp - prevHp;
        const deltaText = delta === 0 ? '0' : (delta > 0 ? `+${delta}` : `${delta}`);
        const color = delta < 0 ? '#ff9e9e' : (delta > 0 ? '#9ff2b4' : '#c8d9ef');
        return `<div><span style="color:#9fb6d8">${id}</span>: ${prevHp} -> ${nextHp} <span style="color:${color}">(${deltaText})</span>${statusTag}</div>`;
    }

    return `<div><span style="color:#9fb6d8">${id}</span>: state changed${statusTag}</div>`;
}

function renderDebugOverlay(tickData) {
    const overlayEl = getSimDebugOverlayEl();
    if (!overlayEl) return;

    if (!isSimDebugEnabled() || modeManager.current !== MODE.DM) {
        overlayEl.style.display = 'none';
        return;
    }

    const changedActors = Array.isArray(tickData?.changedActors) ? tickData.changedActors : [];
    const actorRows = changedActors.length > 0
        ? changedActors.slice(0, 8).map(formatActorDiffLine).join('')
        : '<div style="color:#7f96b8">No actor diffs on this tick.</div>';

    const eventType = String(tickData?.event?.type || tickData?.action?.type || '-');
    const source = String(tickData?.source || tickData?.event?.source || '-');
    const authority = String(simulationAuthority || '-').toUpperCase();
    const mode = String(modeManager.current || '-').toUpperCase();
    const divergence = tickData?.divergence;
    const divergenceHtml = divergence
        ? `<div style="margin-top:8px;color:#ffb4b4">DIVERGENCE: ${String(divergence)}</div>`
        : '';

    overlayEl.style.display = 'block';
    overlayEl.innerHTML = `
        <div style="font-weight:700;color:#f4fbff;letter-spacing:0.03em">SIM DEBUG</div>
        <div style="margin-top:4px;color:#9ec1eb">Tick ${Number.isFinite(tickData?.tick) ? tickData.tick : '-'}</div>
        <div style="margin-top:4px;color:#9ec1eb">Event ${eventType}</div>
        <div style="color:#9ec1eb">Source ${source}</div>
        <div style="color:#9ec1eb">Authority ${authority} | Mode ${mode}</div>
        <div style="margin-top:8px;border-top:1px solid rgba(138,182,255,0.25);padding-top:7px">${actorRows}</div>
        ${divergenceHtml}
    `;
}

function pushDebugTick(tickData) {
    if (!isSimDebugEnabled()) return;

    const bus = window.__SIM_DEBUG__;
    if (!bus || !Array.isArray(bus.timeline) || !(bus.listeners instanceof Set)) return;

    const normalized = {
        tick: Number.isFinite(tickData?.tick) ? tickData.tick : bus.currentTick,
        timestamp: Number.isFinite(tickData?.timestamp) ? tickData.timestamp : performance.now(),
        ...tickData,
    };
    bus.timeline.push(normalized);
    if (bus.timeline.length > SIM_DEBUG_MAX_TICKS) {
        bus.timeline.splice(0, bus.timeline.length - SIM_DEBUG_MAX_TICKS);
    }

    bus.listeners.forEach((listener) => {
        try {
            listener(normalized);
        } catch (_err) {
            // Keep debug listeners isolated from runtime logic.
        }
    });
}

if (!(window.__SIM_DEBUG__.listeners instanceof Set)) {
    window.__SIM_DEBUG__.listeners = new Set();
}
if (window.__SIM_DEBUG__.listeners instanceof Set && !window.__SIM_DEBUG__.__overlayListenerInstalled) {
    window.__SIM_DEBUG__.listeners.add(renderDebugOverlay);
    window.__SIM_DEBUG__.__overlayListenerInstalled = true;
}

window.exportDebugTimeline = () => {
    const bus = window.__SIM_DEBUG__;
    const payload = Array.isArray(bus && bus.timeline) ? bus.timeline : [];
    return JSON.stringify(payload, null, 2);
};

function queueNetworkCombatAction(record, eventTimeMsRaw) {
    if (!record) return;
    const eventTimeMs = Number(eventTimeMsRaw);

    if (!activeNetworkCombatTimeline) {
        const fallbackStart = Number.isFinite(eventTimeMs) ? eventTimeMs : Date.now();
        alignNetworkCombatTimeline({
            timelineId: `implicit-${Math.floor(fallbackStart)}`,
            startTimeMs: fallbackStart,
        });
    }

    const timeline = activeNetworkCombatTimeline;
    if (!timeline) return;

    const resolvedEventTimeMs = Number.isFinite(eventTimeMs)
        ? eventTimeMs
        : Date.now();
    const eventOffsetMs = Math.max(0, resolvedEventTimeMs - timeline.startTimeMs);
    const duePerfMs = timeline.localStartPerfMs + eventOffsetMs;

    pendingNetworkCombatEvents.push({
        record,
        duePerfMs,
    });
}

function processNetworkCombatTimeline(nowPerfMs) {
    if (!pendingNetworkCombatEvents.length) return;

    const isOwner = isSimulationOwner();
    if (!isOwner) {
        processNetworkCombatTimeline.__observerTick = (processNetworkCombatTimeline.__observerTick || 0) + 1;
        if ((processNetworkCombatTimeline.__observerTick % OBSERVER_FRAME_STRIDE) !== 0) {
            return;
        }
    }
    const maxEventsPerFrame = NETWORK_TIMELINE_MAX_EVENTS_PER_FRAME;
    const frameBudgetMs = isOwner ? NETWORK_TIMELINE_FRAME_BUDGET_MS : Math.max(1, NETWORK_TIMELINE_FRAME_BUDGET_MS - 2);
    const frameStartMs = performance.now();
    let processed = 0;

    while (processed < maxEventsPerFrame && pendingNetworkCombatEvents.length > 0) {
        if ((performance.now() - frameStartMs) >= frameBudgetMs) break;

        let nextIdx = -1;
        let nextDuePerfMs = Number.POSITIVE_INFINITY;

        for (let i = 0; i < pendingNetworkCombatEvents.length; i++) {
            const queued = pendingNetworkCombatEvents[i];
            if (!queued) continue;
            if (nowPerfMs + 0.5 < queued.duePerfMs) continue;
            if (queued.duePerfMs < nextDuePerfMs) {
                nextDuePerfMs = queued.duePerfMs;
                nextIdx = i;
            }
        }

        if (nextIdx < 0) break;

        const queued = pendingNetworkCombatEvents[nextIdx];
        pendingNetworkCombatEvents.splice(nextIdx, 1);
        const lateMs = Math.max(0, Math.round(nowPerfMs - queued.duePerfMs));
        const debugTick = window.__SIM_DEBUG__.currentTick;
        void replayRemoteCombatActionRecord(queued.record, {
            offsetMs: lateMs,
            instant: !isOwner,
            allowAsyncPresentation: false,
        });
        pushDebugTick({
            tick: debugTick,
            source: 'network',
            event: cloneJsonSafe(queued.record),
            timing: {
                duePerfMs: queued.duePerfMs,
                nowPerfMs,
                lateMs,
            },
        });
        window.__SIM_DEBUG__.currentTick = debugTick + 1;
        processed += 1;
    }
}

function emitCombatActionRecord(actionRecord) {
    if (!socket || !actionRecord) return;
    beginLocalCombatTimeline();
    const debugTick = window.__SIM_DEBUG__.currentTick;
    socket.emit('combat-action-record', {
        record: cloneJsonSafe(actionRecord),
        startTimeMs: Date.now(),
        timelineId: localCombatTimelineId || activeNetworkCombatTimeline?.id || null,
    });
    pushDebugTick({
        tick: debugTick,
        source: 'local',
        event: cloneJsonSafe(actionRecord),
        timelineId: localCombatTimelineId || activeNetworkCombatTimeline?.id || null,
    });
    window.__SIM_DEBUG__.currentTick = debugTick + 1;
}

function emitDiceRollEvent(rollPayload) {
    if (!socket || !rollPayload) return;
    socket.emit('dice-roll-event', {
        roll: cloneJsonSafe(rollPayload),
    });
}

function emitCombatStateEvent(active, payload = {}) {
    if (!socket) return;
    if (modeManager.current !== MODE.DM && active && isDmConnectedForCombatApproval()) {
        netWarn(`[COMBAT] blocked ${active ? 'combat-start' : 'combat-end'} emit from non-DM client`);
        return;
    }
    const eventName = active ? 'combat-start' : 'combat-end';
    socket.emit(eventName, cloneJsonSafe(payload));
}

function isDmConnectedForCombatApproval() {
    if (modeManager.current === MODE.DM) return false;
    const occupied = Number(lobbyState && lobbyState.slots && lobbyState.slots.dm && lobbyState.slots.dm.occupied) || 0;
    return occupied > 0;
}

function notifyPendingDmApproval(kind = 'combat', targetLabel = '') {
    const scope = String(kind || 'combat').trim().toLowerCase() || 'combat';
    const suffix = targetLabel ? ` (${targetLabel})` : '';
    appendConsoleHistory(`Waiting for DM approval for ${scope}${suffix}...`, 'ok');
}

function requestCombatStartApproval(targetActor) {
    if (!socket || !targetActor) return false;
    const targetId = getCombatActorId(targetActor);
    if (!targetId) return false;
    const isPlayerActor = targetActor === playerState || targetActor === playerRig || !!targetActor.userData?.playerId;
    if (!isPlayerActor && !serverEntityNetworkIds.has(String(targetId))) {
        showFloatingText('Select a server-spawned target first', '#ff8a8a', true);
        appendConsoleHistory(`[COMBAT] blocked start request for local-only target: ${targetId}`, 'error');
        return false;
    }
    const requestId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    pendingCombatStartRequest = {
        requestId,
        targetId,
        requestedAt: performance.now(),
    };
    socket.emit('combat-start-request', {
        requestId,
        targetId,
    });
    const targetLabel = getCombatActorLabel(targetActor);
    appendConsoleHistory(`Combat request sent to DM for approval (${targetLabel})`, 'ok');
    notifyPendingDmApproval('combat', targetLabel);
    showFloatingText('Combat request sent to DM', '#9ec9ff', true);
    return true;
}

function requestDmStartCombat(targetActor = null) {
    if (modeManager.current !== MODE.DM) return false;
    if (!socket) return false;
    if (currentGameMode === GAME_MODE.COMBAT || combatState.inCombat) return false;

    const targetId = targetActor ? getCombatActorId(targetActor) : null;
    if (targetActor && targetId) {
        const isPlayerActor = targetActor === playerState || targetActor === playerRig || !!targetActor.userData?.playerId;
        if (!isPlayerActor && !serverEntityNetworkIds.has(String(targetId))) {
            showFloatingText('Target is local-only. Spawn/select a network dummy.', '#ff8a8a', true);
            appendConsoleHistory(`[COMBAT] blocked start for non-network target: ${targetId}`, 'error');
            return false;
        }
    }
    emitCombatStateEvent(true, {
        initiator: localPlayerId || (socket ? socket.id : null),
        targetId,
    });
    return true;
}

function triggerSharedDiceRoll(rollPayload, options = {}) {
    if (!rollPayload) return;
    const dmUiDiceDisabled = modeManager.current === MODE.DM;
    if (!dmUiDiceDisabled && window.diceRoll) {
        window.diceRoll(rollPayload);
    }
    if (options.broadcast !== false) {
        emitDiceRollEvent(rollPayload);
    }
}

const _updateSceneVisibilityForCombatState = createSceneCombatVisibilityUpdater({
    isSceneReadyForWorldState,
    getScene: () => scene,
    netLog,
});

function updateSceneVisibilityForCombatState(inCombat) {
    _updateSceneVisibilityForCombatState(inCombat);
}

function computeCombatWorldTruth(payload, fallbackInCombat) {
    return computeCombatTruthFromWorldPayload(payload, fallbackInCombat, {
        combatModeValue: GAME_MODE.COMBAT,
        explorationModeValue: GAME_MODE.FREE,
    });
}

let _combatRenderTransitionAdapter = null;

function applyCombatDomainTransition(prevState, nextState, action) {
    if (!_combatRenderTransitionAdapter) {
        _combatRenderTransitionAdapter = createCombatRenderTransitionAdapter({
            combatDomainAction: COMBAT_DOMAIN_ACTION,
            gameMode: GAME_MODE,
            combatState,
            getCurrentGameMode: () => currentGameMode,
            setCurrentGameMode: (mode) => { currentGameMode = mode; },
            getCombatInitiatorSid: () => combatInitiatorSid,
            setCombatInitiatorSid: (sid) => { combatInitiatorSid = sid; },
            setCombatInitiatorActorId: (actorId) => { combatInitiatorActorId = actorId; },
            resolveCombatActorIdForPlayerSid,
            setCombatPhase,
            setCombatLock,
            findCombatActorById,
            ensureCombatEnvironmentPresentation,
            syncCombatMusicToGameMode,
            forceLeaveCombatPresentation,
            computeCombatWorldTruth,
            updateSceneVisibilityForCombatState,
            syncSkyboxWithGameMode,
            updateActionMenu,
            updateLobbyOverlayFromState,
        });
    }
    const debugTick = window.__SIM_DEBUG__.currentTick;
    const changedActors = computeActorDiff(prevState, nextState);
    const combatActionType = String(action && (action.type || action.kind) ? (action.type || action.kind) : '').toLowerCase();
    const divergence = (action && action.divergence) || (combatActionType.includes('divergence') ? 'combat-state-mismatch' : null);
    pushDebugTick({
        tick: debugTick,
        source: 'state-transition',
        action: cloneJsonSafe(action),
        changedActors,
        snapshot: cloneJsonSafe(nextState),
        divergence,
    });
    window.__SIM_DEBUG__.currentTick = debugTick + 1;
    _combatRenderTransitionAdapter(prevState, nextState, action);
}

const combatDomainStore = createCombatDomainStore({
    initialState: {
        inCombat: false,
    },
    computeWorldTruth: computeCombatWorldTruth,
    parseCombatPacket(packet) {
        const packetMode = String((packet && packet.mode) || '').toLowerCase();
        const inCombat = packetMode ? packetMode === 'combat' : !!(packet && packet.active);
        return {
            inCombat,
            initiatorSid: String((packet && packet.initiator) || '').trim() || null,
            targetId: String((packet && packet.targetId) || '').trim() || null,
        };
    },
    onTransition: applyCombatDomainTransition,
});

function hydrateWorld(payload) {
    if (!_worldHydrator) {
        _worldHydrator = createWorldHydrator({
            getServerEntityNetworkIds: () => serverEntityNetworkIds,
            setSessionGameState: (value) => { sessionGameState = value; },
            getSessionGameState: () => sessionGameState,
            setAuthoritativePlayerId: (value) => { authoritativePlayerId = value; },
            updateClientRuntimeModeFromAuthority,
            extractSceneStateFromWorldPayload,
            isSceneReadyForWorldState,
            setPendingWorldHydrationPayload: (value) => { pendingWorldHydrationPayload = value; },
            setPendingSceneState: (value) => { pendingSceneState = value; },
            traceDmPipeline,
            applySceneState: (...args) => applySceneState(...args),
            combatDomainStore,
            combatDomainAction: COMBAT_DOMAIN_ACTION,
            getScene: () => scene,
            getSocket: () => socket,
            getLocalPlayerId: () => localPlayerId,
            upsertPlayerAvatar,
            purgeLocalEchoAvatars,
            removePlayerAvatar,
            getTrainingDummies: () => trainingDummies,
            removeTrainingDummy,
            spawnTrainingDummy,
            trainingDummyYOffset: TRAINING_DUMMY_Y_OFFSET,
            trainingDummyDamage: TRAINING_DUMMY_DAMAGE,
        });
    }
    _worldHydrator(payload);
}

// ── Network debug helpers (disabled) ─────────────────────────────────────
window.__NET_DEBUG__ = false;
function netLog(..._args) {}

function netWarn(..._args) {}

// Running tally for the current session.
const _netStats = {
    playerUpdatesIn: 0,
    playerUpdatesOut: 0,
    dmCommandsOut: 0,
    dmCommandsIn: 0,
    sceneUpdatesIn: 0,
    disconnects: 0,
    avatarPoseUpdatesApplied: 0,
};

// Expose stats so `window.__netStats` is readable from the browser console.
window.__netStats = _netStats;

function registerSocketHandlers() {
    registerMap3dSocketHandlers({
        socket,
        modeManager,
        netLog,
        appendConsoleHistory,
        registerRoleWithServer,
        bootstrapPlayerCombatProfile,
        updateClientRuntimeModeFromAuthority,
        purgeLocalEchoAvatars,
        setLocalPlayerId: (value) => { localPlayerId = value; },
        getLocalPlayerId: () => localPlayerId,
        netWarn,
        incrementDisconnectCount: () => {
            _netStats.disconnects += 1;
            return _netStats.disconnects;
        },
        removePlayerAvatar,
        upsertPlayerAvatar,
        applyLiveCombatSyncFromPlayer,
        netStats: _netStats,
        playerState,
        gameMode: GAME_MODE,
        getCurrentGameMode: () => currentGameMode,
        combatState,
        applyPlayerMovementCapabilities,
        updatePlayerHealthHud,
        hydrateWorld,
        combatDomainStore,
        combatDomainAction: COMBAT_DOMAIN_ACTION,
        mode: MODE,
        findCombatActorById,
        getCombatActorLabel,
        addDmEvent,
        notifyPendingDmApproval,
        getPendingCombatStartRequest: () => pendingCombatStartRequest,
        setPendingCombatStartRequest: (value) => { pendingCombatStartRequest = value; },
        showFloatingText,
        findMeshByPersistentId: (...args) => findMeshByPersistentId(...args),
        findMeshByName: (...args) => findMeshByName(...args),
        applyMaterialState: (...args) => applyMaterialState(...args),
        applySceneState: (...args) => applySceneState(...args),
        traceDmPipeline,
        applyDmCommandFromServer,
        alignNetworkCombatTimeline,
        recordCombatAction,
        isDmObserverMode,
        getCombatActorLabelById,
        queueNetworkCombatAction,
        dispatchCombatTurnActor,
        uxTelemetry,
        uxRecordSample,
        uxSetIntentStatus,
        updateCombatUI,
        updateDmControlPanel,
        isLocalPlayerTurnEntry,
        getEndTurnPending: () => endTurnPending,
        setEndTurnPending: (value) => { endTurnPending = value; },
        getEndTurnWatchdog: () => endTurnWatchdog,
        setEndTurnWatchdog: (value) => { endTurnWatchdog = value; },
        forceLeaveCombatPresentation,
        logCombatEvent,
        showCombatOutcomeOverlay,
        combatInteraction,
        setCombatUiPhase,
        combatUiPhase: COMBAT_UI_PHASE,
        resetCombatInteraction,
        updateActionMenu,
        getLocalCombatActorId,
        syncPlayerRigFromState,
        getPlayerBaseSpeedFt,
        tryUseAction,
        tryMove,
        syncTurnExhaustionState,
        playerRig,
        cancelAction,
        getSocket: () => socket,
        getConnectedCombatPlayerEntries,
        applyPlayerDamage,
        spawnVisualDice,
        triggerEnemyFlinch,
        spawnImpactBurst,
        playCombatSfxCue,
        triggerSharedDiceRoll,
        showRuntimeModeSelectionOverlay,
        closeModeSelectionOverlay,
        getSessionGameState: () => sessionGameState,
        setSessionGameState: (value) => { sessionGameState = value; },
        getAuthoritativePlayerId: () => authoritativePlayerId,
        setAuthoritativePlayerId: (value) => { authoritativePlayerId = value; },
        updateLobbyOverlayFromState,
        setLobbyState: (value) => { lobbyState = value; },
    });
}

async function initializeSocketConnection() {
    if (!socketConnectionManager) return;
    await socketConnectionManager.initializeSocketConnection();
}

// NOTE: do NOT call initializeSocketConnection() here anymore.
// Socket connection is deferred until AFTER role is chosen (see above).
import * as THREE from '/static/three.module.js';
if (window.THREE && window.THREE !== THREE) {
    console.warn('[THREE] Multiple THREE instances detected (window.THREE !== module THREE). This can break loader/render compatibility.');
}
window.THREE = THREE;
import '/static/player_ui.js';
import '/static/hud.js';
import '/static/dice.js';
import '/static/inventory.js';

import { GLTFLoader } from '/static/GLTFLoader.js';
import { COMBAT_DOMAIN_ACTION, computeCombatTruthFromWorldPayload, createCombatDomainStore } from '/static/map3d/domain/combatDomainStore.js';
import { COMBAT_UI_PHASE, createCombatInteractionState, createCombatUiLifecycle, applyCombatUiPhase, turnPhaseToCombatPhase as mapTurnPhaseToCombatPhase, isPlayerInputTurn as mapIsPlayerInputTurn } from '/static/map3d/core/combatStateMachine.js';
import { FEET_PER_UNIT, FEET_PER_SQUARE, COMBAT_TILE_FEET, MOVE_ZONE_COLOR, MOVE_DEST_COLOR, DND_RANGES, COMBAT_DISTANCE_SCALE, OPPORTUNITY_ATTACK_TRIGGER_CHANCE, RETREAT_TRIP_TRIGGER_CHANCE, RETREAT_TRIP_MOVE_PENALTY_FEET, TRAINING_DUMMY_Y_OFFSET, unitsToFeet, feetToUnits, getDistance, getDistanceFeet, getFlatDistanceFeet, getEdgeDistanceFeet, getEffectiveCombatDistanceFeet, getDistanceInSquares, gridDistanceFromWorld, canReachInFeet, canReachInSquares } from '/static/map3d/core/combatDistance.js';
import { createAttackResolutionService } from '/static/map3d/core/attackResolution.js';
import { createCombatTargetingService } from '/static/map3d/core/combatTargeting.js';
import { createEnemyCombatFeedbackService } from '/static/map3d/core/enemyCombatFeedback.js';
import { createSpawnAndTurnRequestService } from '/static/map3d/core/spawnAndTurnRequests.js';
import { createDmActorControlService } from '/static/map3d/core/dmActorControl.js';
import { createDmInjectedInputHandler } from '/static/map3d/core/dmInjectedInput.js';
import { createScenePersistenceManager } from '/static/map3d/managers/scenePersistenceManager.js';
import { createDmCommandBus } from '/static/map3d/managers/dmCommandBus.js';
import { createDmCommandApplier } from '/static/map3d/managers/dmCommandApplier.js';
import { createDmAuthorityManager } from '/static/map3d/managers/dmAuthorityManager.js';
import { createInputFeedbackManager } from '/static/map3d/managers/inputFeedbackManager.js';
import { createInputPresentationManager } from '/static/map3d/managers/inputPresentationManager.js';
import { createMobileTouchControlsManager } from '/static/map3d/managers/mobileTouchControlsManager.js';
import { createUnifiedInputManager } from '/static/map3d/managers/unifiedInputManager.js';
import { createCommandConsoleUiManager } from '/static/map3d/managers/commandConsoleUiManager.js';
import { createLoadingOverlayRuntimeManager } from '/static/map3d/managers/loadingOverlayRuntimeManager.js';
import { createLoadingMusicManager } from '/static/map3d/managers/loadingMusicManager.js';
import { createLoadingOverlayVarietyManager } from '/static/map3d/managers/loadingOverlayVarietyManager.js';
import { createLoadingOverlayStyleManager } from '/static/map3d/managers/loadingOverlayStyleManager.js';
import { createLoadingOverlayBuilderManager } from '/static/map3d/managers/loadingOverlayBuilderManager.js';
import { createLoadingDiceManager } from '/static/map3d/managers/loadingDiceManager.js';
import { createLoadingOverlayFinishManager } from '/static/map3d/managers/loadingOverlayFinishManager.js';
import { registerDefaultConsoleCommandsFromManager } from '/static/map3d/managers/consoleCommandRegistryManager.js';
import { createConsoleCommandRuntimeManager } from '/static/map3d/managers/consoleCommandRuntimeManager.js';
import { createCombatRenderTransitionAdapter } from '/static/map3d/adapters/combatRenderAdapter.js';
import { createSceneCombatVisibilityUpdater } from '/static/map3d/render/sceneCombatVisibility.js';
import { createEnemyHealthBarPrimitive, removeEnemyHealthBarPrimitive, createPlayerHeadHealthBarPrimitive, removePlayerHeadHealthBarPrimitive, updateSingleHeadHealthBarPrimitive, attachTargetSelectionRingPrimitive, removeTargetSelectionRingPrimitive } from '/static/map3d/render/combatOverlayPrimitives.js';
import { createWorldHydrator } from '/static/map3d/net/worldHydrator.js';
import { extractSceneStateFromWorldPayload } from '/static/map3d/net/worldPayloadUtils.js';
import { registerMap3dSocketHandlers } from '/static/map3d/net/socketOrchestrator.js';
import { createSocketConnectionManager } from '/static/map3d/managers/socketConnectionManager.js';
import { applyStoredAvatarRig, sanitizeStoredRigSettings, findRigHandBone } from '/static/avatar_rig_runtime.js';
import { spawnEntityFromContracts } from '/static/utils/renderBindingAdapter.js';
import { initializeBVH, buildMergedColliderMesh, resolveCollisionsWithBVH, queryGroundHeightBVH, disposeBVHCollider, applyAcceleratedRaycast } from '/static/bvh_collision.js';

let ITEM_DB = {};
let equipItem = () => false;
let useItem = () => false;
let loadEngineEntityFromUrls = null;
let engineEntityContractModuleReady = false;

async function ensureEngineEntityContractModule() {
    if (engineEntityContractModuleReady) return;
    // Avoid network 404 noise by defaulting to JSON contract fallback.
    ITEM_DB = {};
    equipItem = () => false;
    useItem = () => false;
    loadEngineEntityFromUrls = null;
    engineEntityContractModuleReady = true;
}
// Selection logic: only selected object gets a green BoxHelper
let selectedObject = null;
let selectionBoxHelper = null;
let isGrabbing = false;
let grabAxis = null; // null = free, 'x', 'y', 'z' = axis lock
let activeRangeCircle = null;
let activeMovementCircle = null;
let selectedCombatTarget = null;
let pendingDmEncounterSetup = null;
let dmQuickMenuArmedByLeftClick = false;
let pendingCombatStartRequest = null;
let dmLmbDragHoldTimer = null;
let dmLmbDragCandidate = null;
let dmLmbDown = false;
let grabStartPosition = null;
let dmPlacementCameraActive = false;
const dmPlacementPrevCameraPos = new THREE.Vector3();
const dmPlacementPrevCameraQuat = new THREE.Quaternion();
const dmPlacementTargetPos = new THREE.Vector3();

function setSelectedCombatTarget(newTarget) {
    if (selectedCombatTarget && selectedCombatTarget !== newTarget) {
        removeTargetSelectionRing(selectedCombatTarget);
    }
    selectedCombatTarget = newTarget;
    if (newTarget) {
        attachTargetSelectionRing(newTarget);
    }
    updateActionMenu();
    updateDmControlPanel();
}
let controlledActor = null;
let controlledActorId = null;
let possessionStatusEl = null;
let dmRootUI = null;
let dmTopBarEl = null;
let dmLeftPanelEl = null;
let dmRightPanelEl = null;
let dmBottomBarEl = null;
let dmCenterOverlayEl = null;
let dmZoneToggleLeftEl = null;
let dmZoneToggleRightEl = null;
let dmZoneToggleTopEl = null;
let dmZoneToggleBottomEl = null;
let dmZoneToggleCenterEl = null;
const DM_SHOW_TIMELINE = false;
const dmZoneCollapsed = {
    top: false,
    left: false,
    right: false,
    bottom: false,
    center: false,
};
let dmPanelEl = null;
let dmPanelInfoEl = null;
let dmPanelQueueEl = null;
let dmPanelControlsEl = null;
let dmEventLogEl = null;
let dmStartCombatBtnEl = null;
let dmQuickEncounterBtnEl = null;
let dmSpawnTypeSelectEl = null;
let dmWhoSummaryEl = null;
let dmWhoListEl = null;
let dmUiV2Nuked = false;
let dmTimelineTitleEl = null;
let dmAutoStepTimer = null;
let dmAutoStepEnabled = false;
// BG3-style movement zone
let moveZoneDisc = null;       // filled disc — click surface
let moveZoneRing = null;       // outer border ring
let moveZoneTargetX = null;    // smooth lerp target for movement circle
let moveZoneTargetZ = null;    // smooth lerp target for movement circle
let moveDestMarker = null;     // destination ring shown on hover
let movePathLine = null;       // line from player → hovered dest
let hoveredMoveWorldPos = null; // last valid hovered position (snapped)
let enemyHoverCursor = null;   // single hover cursor around hovered enemy
// Set to true only AFTER renderer is constructed. Guards event listeners that
// fire during the roleChosenPromise await against accessing renderer TDZ.
let rendererReady = false;
const trainingDummies = [];
let combatUiEl = null;
let combatLogEl = null;
let combatFlashEl = null;
let dmTimelineEl = null;
let dmTimelineRangeEl = null;
let dmTimelineLabelEl = null;
let dmTimelineBranchEl = null;
let dmTimelinePendingIndex = null;
let dmTimelineScrubBusy = false;
let dmEntitySummaryEl = null;
let dmDmModeSelectEl = null;
let dmAuthorityBadgeEl = null;
let dmControlledBadgeEl = null;
let dmSessionStatusEl = null;
let dmSelectedNameValueEl = null;
let dmSelectedTypeValueEl = null;
let dmSelectedHpValueEl = null;
let dmSelectedActorIdValueEl = null;
let dmEncounterSummaryEl = null;
let dmEncounterHintEl = null;
let godContextMenuEl = null;
let godContextMenuTitleEl = null;
let godContextMenuMetaEl = null;
let godContextMenuActionsEl = null;
let godWorldMenuEl = null;
let godWorldMenuActionsEl = null;
let godWorldMenuTitleEl = null;
const dmCommandButtonRefs = new Map();
const godUiState = {
    lastContextSignature: '',
    lastWorldMenuSignature: '',
    worldMenuOpen: false,
};
const godUiAnchorPos = new THREE.Vector3();
let savedDiceRollFn = null;
const dmDetachedLegacyUi = [];
const MESSAGE_PRIORITY = {
    LOW: 10,
    MEDIUM: 35,
    HIGH: 65,
    CRITICAL: 100,
};
const MESSAGE_PRIMARY_MIN_PRIORITY = MESSAGE_PRIORITY.HIGH;
const combatMessageState = {
    active: null,
    fadeTimerId: null,
    removeTimerId: null,
    recentByKey: new Map(),
    locked: false,
};
let deliberateMoveState = null;
let pendingPostMoveAttack = null;
let combatPresentationBusy = false;
let combatUiSuppressed = false;
let combatHitStopUntil = 0;
let combatLastHitStopAt = 0;
let turnEndRequired = false;
let pendingTurnEndRequired = false;
let turnEndOverlay = null;
let turnEndOverlayCard = null;
let turnEndFlashInterval = null;
let softActionPromptShown = false; // Stage 1: gentle prompt when action used but movement remains
let hoveredTargetPreview = null; // {target, element} for hover tooltip
let targetPreviewElement = null; // DOM element for target hover info
const COMBAT_PRESENTATION_MIN_MS = 900;
const FAST_COMBAT = true;
const MELEE_TIMELINE_MS = FAST_COMBAT ? {
    windup: 80,
    rollHold: 80,
    impactHold: 40,
    postImpactPause: 40,
    resultHold: 80,
    damageHold: 60,
} : {
    windup: 240,
    rollHold: 260,
    impactHold: 120,
    postImpactPause: 120,
    resultHold: 320,
    damageHold: 180,
};
const RANGED_TIMELINE_MS = FAST_COMBAT ? {
    windup: 80,
    launchHold: 80,
    impactHold: 40,
    postImpactPause: 40,
    resultHold: 80,
    damageHold: 60,
} : {
    windup: 240,
    launchHold: 280,
    impactHold: 120,
    postImpactPause: 120,
    resultHold: 360,
    damageHold: 180,
};
const ENEMY_TIMELINE_MS = FAST_COMBAT ? {
    readyHold: 120,
    moveDuration: 220,
    moveSettle: 80,
    windup: 80,
    rollHold: 80,
    impactHold: 40,
    resultHold: 80,
    damageHold: 60,
} : {
    readyHold: 260,
    moveDuration: 360,
    moveSettle: 140,
    windup: 240,
    rollHold: 280,
    impactHold: 120,
    resultHold: 320,
    damageHold: 180,
};
let combatAudioCtx = null;
let combatAudioUnlocked = false;
let confirmAttackSnapAudio = null;
let battleMusicAudio = null;
let mainThemeAudio = null;
let docksMusicAudio = null;
let legacyLoopMusicMode = 'unknown';
const COMBAT_SFX_ENABLED = true;
const COMBAT_MUSIC_ENABLED = false;
let combatMusicTheme = 'none';
let combatMusicStep = 0;
let combatMusicNextTime = 0;
let combatMusicSchedulerId = null;
let combatMusicSamplesPromise = null;
let toneStartRequested = false;
const combatMusicSampleBuffers = {
    kick: null,
    hat: null,
    snare: null,
    stab: null,
};
// Combat transition state
const combatParticles = [];
const combatParticlePool = [];
const COMBAT_PARTICLE_POOL_DEFAULT_MAX = 100;
const COMBAT_PARTICLE_POOL_LOW_MAX = 50;
const COMBAT_PARTICLE_POOL_HIDDEN_MAX = 24;
const COMBAT_PARTICLE_SPAWN_PER_FRAME_DEFAULT = 2;
const COMBAT_PARTICLE_SPAWN_PER_FRAME_LOW = 3;
const MAX_PARTICLE_BURST = 6;
let combatParticlePoolMax = COMBAT_PARTICLE_POOL_DEFAULT_MAX;
const pendingCombatParticleBursts = [];
const combatParticleGeometry = new THREE.SphereGeometry(0.12, 5, 5);
let combatCenter = new THREE.Vector3();
let combatRadius = 10;
let combatArenaWarnLastShown = 0; // throttle "Cannot leave combat" message
const enemyHealthBars = new Map(); // dummy -> { container, hpFill, lagFill, lagValue }
const playerHeadHealthBars = new Map(); // actorKey -> { container, hpFill, lagFill, nameEl, lagValue }
let combatRing = null;
let combatGrid = null;
const COMBAT_FLOOR_Y_OFFSET = -1.5;
const COMBAT_FLOOR_VISUAL_RADIUS = 2400;
const combatMoveTiles = [];
let combatMoveTileBuildToken = 0;
const COMBAT_TILE_BUILD_CHUNK = 180;
const combatTileArenaProbe = new THREE.Vector3();
let inspectorOpen = false;
let inspectorMenu = null;
let inspectorTab = null;
let actionMenuEl = null;
let ffxMenuState = { openSub: null };
let dmWorldSetpiece = null;
let diceCinematicOverlay = null;
let diceCinematicTimer = null;
let diceCinematicActive = false;
const diceCinematicUiState = new Map();
let diceCinematicResultCard = null;
let diceCinematicResultValueEl = null;
let diceCinematicResultLabelEl = null;
let diceCinematicTitleEl = null;
let diceCinematicPrevCanvasFilter = '';
let diceCinematicPrevExposure = null;
const DICE_CINEMATIC_MAX_MS = 650;
const DICE_CINEMATIC_MIN_MS = 180;
const VISUAL_DICE_DURATION_MS = 620;
let outcomeFocusEl = null;
let outcomeFocusTimer = null;
const ENABLE_OUTCOME_FOCUS_OVERLAY = false;
const ENABLE_DICE_RESULT_NUMBER_OVERLAY = false;
// Removed stray comma
// Raycaster and mouse for picking
const raycaster = new THREE.Raycaster();
raycaster.firstHitOnly = true;
const mouse = new THREE.Vector2();
const selectableMeshes = [];
let selectableMeshCacheNextRefreshAt = 0;
const xrRaycaster = new THREE.Raycaster();
const xrRayOrigin = new THREE.Vector3();
const xrRayDirection = new THREE.Vector3();
const xrRayRotation = new THREE.Matrix4();
const floorProbeRaycaster = new THREE.Raycaster();
const floorProbeOrigin = new THREE.Vector3();
const floorProbeDirection = new THREE.Vector3(0, -1, 0);
let localPlayerId = null;
let localPlayerCombatActorId = null;
let combatInitiatorSid = null;
let combatInitiatorActorId = null;
let lastAppliedCombatSyncTimestamp = 0;
let lastPlayerSyncAt = 0;
const PLAYER_UPDATE_MIN_INTERVAL_MS = 66; // ~15 updates/sec max
const PLAYER_HEAVY_SYNC_INTERVAL_MS = 250;
const PLAYER_COMBAT_SYNC_INTERVAL_MS = 100;
let lastHeavyPlayerSyncAt = 0;
let lastCombatSyncAt = 0;
const localPlayerWorldPos = new THREE.Vector3();
const localPlayerWorldQuat = new THREE.Quaternion();
const thirdPersonLookTarget = new THREE.Vector3();
let localPlayerAvatarRoot = null;
let localPlayerAvatarRigState = null;
let localPlayerHammerProp = null; // hammer.glb parented to hand bone
let localPlayerHammerHandBone = null;
let localPlayerHammerBackBone = null;
let localPlayerHammerBackAnchor = null;
let localPlayerAvatarMoveSpeed = 0;
let localPlayerJumpVisualBlend = 0;
const localAvatarLoader = new GLTFLoader();
const remoteAvatarLoader = new GLTFLoader();
const trainingDummyVisualLoader = new GLTFLoader();
const lightSpawnPos = new THREE.Vector3();
const lightSpawnDir = new THREE.Vector3();
let userLightIdCounter = 1;
const xrHandRays = [];
const XR_RAY_MAX_DISTANCE = 80;
const ENABLE_DATA_DRIVEN_ENTITY_SPAWN = false;

let loadingOverlayRoot = null;
let loadingOverlayLog = null;
let loadingOverlayStatus = null;
let loadingOverlayProgressFill = null;
let loadingOverlayProgressText = null;
let loadingOverlayQuote = null;
let loadingOverlayFinished = false;
let loadingOverlayCloseScheduled = false;
let loadingOverlayStartedAt = 0;
let loadingLogFlushTimer = null;
let loadingProgressAnimFrame = null;
let loadingQuoteTimer = null;
let loadingStatusTimer = null;
let loadingStatusLastShownAt = 0;
let loadingOverlayFxLayer = null;
let loadingOverlayFxStylesInjected = false;
let loadingFlavorTimer = null;
let loadingBackdropAnimFrame = null;
let loadingOverlayCard = null;
let loadingOverlayAccentBar = null;
let loadingDiceTray = null;
let loadingDiceRollTimer = null;
let dmCamera = null;
let dmRightDragActive = false;
let dmRightDragLastX = 0;
let dmRightDragLastY = 0;
let activeCamera = null;
const DM_CAMERA_MODE = Object.freeze({
    DIRECTOR: 'director',
    TACTICAL: 'tactical',
    FOLLOW: 'follow',
    FREE: 'free',
});
let dmCameraMode = DM_CAMERA_MODE.DIRECTOR;
let dmFollowEntity = null;
let dmFreeMoveForward = false;
let dmFreeMoveBackward = false;
let dmFreeMoveLeft = false;
let dmFreeMoveRight = false;
let dmFreeMoveUp = false;
let dmFreeMoveDown = false;
let dmFreeMoveFast = false;
const dmFreeForward = new THREE.Vector3();
const dmFreeUp = new THREE.Vector3(0, 1, 0);
const dmFreeRight = new THREE.Vector3();
const dmFreeMove = new THREE.Vector3();
const DM_FREE_SWIM_SPEED = 14;
const DM_FREE_SWIM_FAST_MULTIPLIER = 2.2;
const DM_FOLLOW_OFFSET = new THREE.Vector3(0, 10, 14);
const DM_FOLLOW_SMOOTHING = 0.12;
const DM_DIRECTOR_RADIUS = 18;
const DM_DIRECTOR_HEIGHT = 7;
const DM_DIRECTOR_ORBIT_SPEED = 0.00012;
const DM_DIRECTOR_SMOOTHING = 0.05;
const DM_DIRECTOR_FOV = 70;
const DM_TACTICAL_HEIGHT = 35;
const DM_INSET_DEFAULT_WIDTH = 400;
const DM_INSET_DEFAULT_HEIGHT = 300;
const DM_INSET_MARGIN = 16;
let dmInsetEnabled = false;
const LOADING_LOG_MAX_LINES = 220;
const LOADING_LOG_FLUSH_INTERVAL_MS = 46;
const LOADING_MIN_VISIBLE_MS = 3200;
const LOADING_POST_COMPLETE_HOLD_MS = 1300;
const LOADING_FADE_DURATION_MS = 550;
const LOADING_QUOTE_INTERVAL_MS = 1750;
const LOADING_STATUS_MIN_INTERVAL_MS = 340;
const loadingLogLines = [];
const loadingLogQueue = [];
const loadingStatusQueue = [];
let loadingProgressValue = 0;
let loadingProgressTarget = 0;
let loadingQuoteIndex = 0;
let loadingBurstCounter = 0;
const LOADING_NONSENSE_QUOTES = [
    'Calibrating moonbeams into spreadsheet format...',
    'Polishing invisible bananas for premium stability...',
    'Reticulating waffles at maximum seriousness...',
    'Negotiating peace between polygons and soup...',
    'Convincing electrons to walk in a straight circle...',
    'Teaching the loading bar to yodel quietly...',
    'Compressing thunder into travel-size packets...',
    'Aligning cosmic socks by flavor profile...',
    'Inflating tiny dragons for quality assurance...',
    'Converting awkward silence into GPU acceleration...',
    'Untangling spaghetti code from literal spaghetti...',
    'Asking the map politely to map itself...',
];
const LOADING_PARTICLE_GLYPHS = ['*', '+', 'o', '#', '~', '!', '?', '@'];
const LOADING_VARIETY_STATUSES = [
    'Rehearsing dramatic entrance music...',
    'Consulting dice for load-order wisdom...',
    'Installing temporary confidence in shaders...',
    'Bribing frame-time goblins with snacks...',
    'Polishing combat poses for maximum drama...',
    'Untangling cinematic camera cables...',
    'Adding unnecessary but excellent sparkles...',
    'Buffering suspense... please gasp politely...',
    'Handshaking with very serious particles...',
    'Routing extra hype into presentation layer...',
];
const LOADING_VARIETY_QUOTES = [
    'Warning: this loading screen may become sentient.',
    'The progress bar is currently doing a side quest.',
    'Trust the process. The process is mostly vibes.',
    'Our QA wizard says this is absolutely intentional.',
    'Please remain calm while we over-engineer drama.',
    'Now featuring 38% more theatrical nonsense.',
    'If this takes longer, blame the sparkle budget.',
];

const CONSOLE_MODE = Object.freeze({
    DEV: 'dev',
    DM: 'dm',
    PLAYER: 'player',
});

const MODE = CONSOLE_MODE;

const MODE_PERMISSIONS = Object.freeze({
    'tools.selection': [MODE.DEV],
    'tools.grid': [MODE.DEV],
    'tools.colliderDebug': [MODE.DEV],
    'combat.control': [MODE.DEV, MODE.DM],
    'combat.spawn': [MODE.DEV, MODE.DM],
    'player.combatInput': [MODE.PLAYER],
    'player.keyboardInput': [MODE.PLAYER],
    'audio.debug': [MODE.DEV],
});

const modeManager = {
    current: null,  // ← NO DEFAULT: null until user chooses via overlay
    listeners: [],
    setMode(nextMode) {
        const normalized = String(nextMode || '').toLowerCase();
        if (!Object.values(MODE).includes(normalized)) {
            return false;
        }
        if (this.current === normalized) {
            return true;
        }
        this.current = normalized;
        traceDmPipeline('MODE_SET', { mode: normalized });
        this.listeners.slice().forEach((listener) => {
            try {
                listener(normalized);
            } catch (err) {
                console.error('mode change listener failed', err);
            }
        });
        return true;
    },
    onChange(listener) {
        if (typeof listener !== 'function') return () => {};
        this.listeners.push(listener);
        return () => {
            const idx = this.listeners.indexOf(listener);
            if (idx >= 0) this.listeners.splice(idx, 1);
        };
    },
};

socketConnectionManager = createSocketConnectionManager({
    windowObj: window,
    modeManager,
    getSocket: () => socket,
    setSocket: (value) => { socket = value; },
    getSocketModeUnsubscribe: () => socketModeUnsubscribe,
    setSocketModeUnsubscribe: (value) => { socketModeUnsubscribe = value; },
    netLog,
    netWarn,
    appendConsoleHistory,
    registerSocketHandlers,
    bootstrapPlayerCombatProfile,
    updateClientRuntimeModeFromAuthority,
});

// Resolves once the user picks a role from the startup overlay.
// Nothing that depends on the chosen role should run before this settles.
let _resolveRoleChosen;
const roleChosenPromise = new Promise((resolve) => { _resolveRoleChosen = resolve; });

// Debug: log when promise resolves
roleChosenPromise.then(() => {
    netLog('✅ ROLE PROMISE RESOLVED — app resuming initialization');
    traceDmPipeline('ROLE PROMISE RESOLVED', { mode: modeManager.current });
    if (window.__DM_FORCE_GOD_MODE__ === true) {
        forceGodModeForDiagnostics();
    }
});

// Socket connection defers until role is chosen.
roleChosenPromise.then(() => {
    initializeSocketConnection();
});


function hasModePermission(permissionKey, mode = modeManager.current) {
    const allowed = MODE_PERMISSIONS[permissionKey];
    if (!Array.isArray(allowed)) return false;
    return allowed.includes(mode);
}

function isDmLikeMode(mode = modeManager.current) {
    return mode === MODE.DM || mode === MODE.DEV;
}

function isDmObserverMode() {
    return modeManager.current === MODE.DM && dmAuthorityLayer === DM_AUTHORITY_LAYER.OBSERVER;
}

// True whenever the DM camera is under free-fly control (not possessing an actor).
function isDmFreeCamera() {
    return isDmLikeMode() && !getControlledActor();
}

function hasDmPossessionControl() {
    return isDmLikeMode() && !!getControlledActor();
}

function canUseStandardMovementControls() {
    return hasModePermission('player.keyboardInput') || hasDmPossessionControl();
}

function isLocalCombatAuthority() {
    if (modeManager.current === MODE.DM) return true;
    if (modeManager.current !== MODE.PLAYER) return false;
    if (!socket) return true;
    if (!localPlayerId) return false;
    // Server decides authority; default to local-only in single-player fallback.
    if (!authoritativePlayerId) return true;
    return localPlayerId === authoritativePlayerId;
}

function isSimulationOwner() {
    if (modeManager.current === MODE.DM) return true;
    if (simulationAuthority === SIMULATION_AUTHORITY.LOCAL_DM) {
        return modeManager.current === MODE.DM;
    }
    if (!socket) return true;
    return isLocalCombatAuthority();
}

const CLIENT_MODE_FULL = 'full';
const CLIENT_MODE_OBSERVER = 'observer';
let CLIENT_MODE = CLIENT_MODE_FULL;

function isObserverClient() {
    return CLIENT_MODE === CLIENT_MODE_OBSERVER;
}

function updateClientRuntimeModeFromAuthority() {
    // Online multiplayer should not auto-degrade non-authoritative clients.
    // Keep observer mode as an explicit dev/testing override only.
    const nextMode = CLIENT_MODE_FULL;
    if (CLIENT_MODE === nextMode) return false;
    CLIENT_MODE = nextMode;
    applySettings();
    return true;
}

function setPlayerHudVisible(visible) {
    const hud = document.getElementById('hud');
    if (!hud) return;
    hud.style.display = visible ? 'block' : 'none';
    if (!visible) {
        hud.classList.remove('visible');
    }
}

function createDmRootUI() {
    if (dmRootUI) return dmRootUI;
    const root = document.createElement('div');
    root.id = 'dm-root-ui';
    root.style.position = 'fixed';
    root.style.inset = '0';
    root.style.pointerEvents = 'none';
    // Keep DM panel behind loading overlay until loading is fully complete.
    root.style.zIndex = '98000';
    root.style.display = 'none';

    const topBar = document.createElement('div');
    topBar.id = 'dm-topbar';
    topBar.style.position = 'absolute';
    topBar.style.left = '20px';
    topBar.style.right = '20px';
    topBar.style.top = '12px';
    topBar.style.display = 'none';
    topBar.style.alignItems = 'stretch';
    topBar.style.justifyContent = 'space-between';
    topBar.style.gap = '10px';
    topBar.style.pointerEvents = 'none';
    topBar.style.transition = 'transform 170ms ease, opacity 170ms ease';

    const leftPanel = document.createElement('div');
    leftPanel.id = 'dm-left';
    leftPanel.style.position = 'absolute';
    leftPanel.style.left = '20px';
    leftPanel.style.top = '24px';
    leftPanel.style.bottom = '120px';
    leftPanel.style.width = '320px';
    leftPanel.style.display = 'none';
    leftPanel.style.flexDirection = 'column';
    leftPanel.style.gap = '8px';
    leftPanel.style.pointerEvents = 'none';
    leftPanel.style.transition = 'transform 170ms ease, opacity 170ms ease';

    const rightPanel = document.createElement('div');
    rightPanel.id = 'dm-right';
    rightPanel.style.position = 'absolute';
    rightPanel.style.right = '20px';
    rightPanel.style.top = '24px';
    rightPanel.style.bottom = '120px';
    rightPanel.style.width = '320px';
    rightPanel.style.display = 'none';
    rightPanel.style.flexDirection = 'column';
    rightPanel.style.gap = '8px';
    rightPanel.style.pointerEvents = 'none';
    rightPanel.style.transition = 'transform 170ms ease, opacity 170ms ease';

    const bottomBar = document.createElement('div');
    bottomBar.id = 'dm-bottom';
    bottomBar.style.position = 'absolute';
    bottomBar.style.left = '20px';
    bottomBar.style.right = '20px';
    bottomBar.style.bottom = '14px';
    bottomBar.style.height = '60px';
    bottomBar.style.display = 'flex';
    bottomBar.style.alignItems = 'center';
    bottomBar.style.gap = '10px';
    bottomBar.style.pointerEvents = 'auto';
    bottomBar.style.transition = 'transform 170ms ease, opacity 170ms ease';

    const centerOverlay = document.createElement('div');
    centerOverlay.id = 'dm-center';
    centerOverlay.style.position = 'absolute';
    centerOverlay.style.left = '50%';
    centerOverlay.style.bottom = '140px';
    centerOverlay.style.transform = 'translateX(-50%)';
    centerOverlay.style.display = 'none';
    centerOverlay.style.flexDirection = 'column';
    centerOverlay.style.alignItems = 'center';
    centerOverlay.style.gap = '8px';
    centerOverlay.style.pointerEvents = 'none';
    centerOverlay.style.transition = 'transform 170ms ease, opacity 170ms ease';

    root.appendChild(topBar);
    root.appendChild(leftPanel);
    root.appendChild(rightPanel);
    root.appendChild(bottomBar);
    root.appendChild(centerOverlay);

    dmTopBarEl = topBar;
    dmLeftPanelEl = leftPanel;
    dmRightPanelEl = rightPanel;
    dmBottomBarEl = bottomBar;
    dmCenterOverlayEl = centerOverlay;

    const makeZoneToggle = (label) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = label;
        btn.style.position = 'absolute';
        btn.style.width = '20px';
        btn.style.height = '40px';
        btn.style.border = '1px solid rgba(125, 170, 230, 0.8)';
        btn.style.background = 'rgba(7, 15, 30, 0.85)';
        btn.style.color = '#dbe9ff';
        btn.style.borderRadius = '8px';
        btn.style.cursor = 'pointer';
        btn.style.fontFamily = 'Consolas, "Segoe UI", monospace';
        btn.style.fontSize = '12px';
        btn.style.lineHeight = '1';
        btn.style.padding = '0';
        btn.style.zIndex = '2';
        btn.style.pointerEvents = 'auto';
        btn.style.backdropFilter = 'blur(6px)';
        return btn;
    };

    dmZoneToggleLeftEl = makeZoneToggle('▶');
    dmZoneToggleLeftEl.style.left = '0';
    dmZoneToggleLeftEl.style.top = '50%';
    dmZoneToggleLeftEl.style.transform = 'translateY(-50%)';
    dmZoneToggleLeftEl.style.borderTopLeftRadius = '0';
    dmZoneToggleLeftEl.style.borderBottomLeftRadius = '0';
    dmZoneToggleLeftEl.style.display = 'none';
    dmZoneToggleLeftEl.title = 'Toggle entity panel';
    dmZoneToggleLeftEl.addEventListener('click', () => {
        dmZoneCollapsed.left = !dmZoneCollapsed.left;
        applyDmZoneVisibility();
    });

    dmZoneToggleRightEl = makeZoneToggle('◀');
    dmZoneToggleRightEl.style.right = '0';
    dmZoneToggleRightEl.style.top = '50%';
    dmZoneToggleRightEl.style.transform = 'translateY(-50%)';
    dmZoneToggleRightEl.style.borderTopRightRadius = '0';
    dmZoneToggleRightEl.style.borderBottomRightRadius = '0';
    dmZoneToggleRightEl.style.display = 'none';
    dmZoneToggleRightEl.title = 'Toggle events panel';
    dmZoneToggleRightEl.addEventListener('click', () => {
        dmZoneCollapsed.right = !dmZoneCollapsed.right;
        applyDmZoneVisibility();
    });

    dmZoneToggleTopEl = makeZoneToggle('▲');
    dmZoneToggleTopEl.style.left = '50%';
    dmZoneToggleTopEl.style.top = '0';
    dmZoneToggleTopEl.style.transform = 'translateX(-50%)';
    dmZoneToggleTopEl.style.width = '44px';
    dmZoneToggleTopEl.style.height = '18px';
    dmZoneToggleTopEl.style.borderTopLeftRadius = '0';
    dmZoneToggleTopEl.style.borderTopRightRadius = '0';
    dmZoneToggleTopEl.title = 'Toggle top bar';
    dmZoneToggleTopEl.addEventListener('click', () => {
        dmZoneCollapsed.top = !dmZoneCollapsed.top;
        applyDmZoneVisibility();
    });

    dmZoneToggleBottomEl = makeZoneToggle('▼');
    dmZoneToggleBottomEl.style.left = '50%';
    dmZoneToggleBottomEl.style.bottom = '0';
    dmZoneToggleBottomEl.style.transform = 'translateX(-50%)';
    dmZoneToggleBottomEl.style.width = '44px';
    dmZoneToggleBottomEl.style.height = '18px';
    dmZoneToggleBottomEl.style.borderBottomLeftRadius = '0';
    dmZoneToggleBottomEl.style.borderBottomRightRadius = '0';
    dmZoneToggleBottomEl.title = 'Toggle timeline';
    dmZoneToggleBottomEl.addEventListener('click', () => {
        dmZoneCollapsed.bottom = !dmZoneCollapsed.bottom;
        applyDmZoneVisibility();
    });

    dmZoneToggleCenterEl = makeZoneToggle('●');
    dmZoneToggleCenterEl.style.left = '50%';
    dmZoneToggleCenterEl.style.bottom = '106px';
    dmZoneToggleCenterEl.style.transform = 'translateX(-50%)';
    dmZoneToggleCenterEl.style.width = '20px';
    dmZoneToggleCenterEl.style.height = '20px';
    dmZoneToggleCenterEl.style.display = 'none';
    dmZoneToggleCenterEl.title = 'Toggle controls';
    dmZoneToggleCenterEl.addEventListener('click', () => {
        dmZoneCollapsed.center = !dmZoneCollapsed.center;
        applyDmZoneVisibility();
    });

    root.appendChild(dmZoneToggleLeftEl);
    root.appendChild(dmZoneToggleRightEl);
    root.appendChild(dmZoneToggleTopEl);
    root.appendChild(dmZoneToggleBottomEl);
    root.appendChild(dmZoneToggleCenterEl);

    document.body.appendChild(root);
    dmRootUI = root;
    applyDmZoneVisibility();
    return dmRootUI;
}

function applyDmZoneVisibility() {
    if (!dmTopBarEl || !dmLeftPanelEl || !dmRightPanelEl || !dmBottomBarEl || !dmCenterOverlayEl) return;

    dmTopBarEl.style.transform = dmZoneCollapsed.top ? 'translateY(-130%)' : 'translateY(0)';
    dmTopBarEl.style.opacity = dmZoneCollapsed.top ? '0.35' : '1';

    dmLeftPanelEl.style.transform = dmZoneCollapsed.left ? 'translateX(-340px)' : 'translateX(0)';
    dmLeftPanelEl.style.opacity = dmZoneCollapsed.left ? '0.3' : '1';

    dmRightPanelEl.style.transform = dmZoneCollapsed.right ? 'translateX(340px)' : 'translateX(0)';
    dmRightPanelEl.style.opacity = dmZoneCollapsed.right ? '0.3' : '1';

    dmBottomBarEl.style.transform = dmZoneCollapsed.bottom ? 'translateY(96px)' : 'translateY(0)';
    dmBottomBarEl.style.opacity = dmZoneCollapsed.bottom ? '0.3' : '1';

    dmCenterOverlayEl.style.transform = dmZoneCollapsed.center
        ? 'translate(-50%, 120px)'
        : 'translate(-50%, 0)';
    dmCenterOverlayEl.style.opacity = dmZoneCollapsed.center ? '0.35' : '1';

    if (dmZoneToggleRightEl) dmZoneToggleRightEl.textContent = dmZoneCollapsed.right ? '▶' : '◀';
    if (dmZoneToggleTopEl) dmZoneToggleTopEl.textContent = dmZoneCollapsed.top ? '▼' : '▲';
    if (dmZoneToggleBottomEl) dmZoneToggleBottomEl.textContent = dmZoneCollapsed.bottom ? '▲' : '▼';
    if (dmZoneToggleCenterEl) dmZoneToggleCenterEl.textContent = dmZoneCollapsed.center ? '◌' : '●';
}

function detachLegacyUiNode(node) {
    if (!node || !node.parentNode || node.__dmDetachedLegacy === true) return;
    dmDetachedLegacyUi.push({
        node,
        parent: node.parentNode,
        nextSibling: node.nextSibling || null,
    });
    node.__dmDetachedLegacy = true;
    node.parentNode.removeChild(node);
}

function restoreDetachedLegacyUiNodes() {
    while (dmDetachedLegacyUi.length > 0) {
        const record = dmDetachedLegacyUi.pop();
        if (!record || !record.node || !record.parent) continue;
        const { node, parent, nextSibling } = record;
        try {
            if (nextSibling && nextSibling.parentNode === parent) {
                parent.insertBefore(node, nextSibling);
            } else {
                parent.appendChild(node);
            }
        } catch (_err) {
            if (document.body && node.parentNode !== document.body) {
                document.body.appendChild(node);
            }
        }
        node.__dmDetachedLegacy = false;
    }
}

function nukeUiForDm() {
    if (!DM_UI_V2 || !document.body) return;
    const nodes = Array.from(document.body.children || []);
    nodes.forEach((el) => {
        if (!el) return;
        const isDmRoot = dmRootUI && el === dmRootUI;
        const isCanvas = el.tagName === 'CANVAS' || el.id === 'canvas';
        const isConsoleRoot = el.id === 'console-root' || (consoleRootEl && el === consoleRootEl);
        if (isDmRoot || isCanvas || isConsoleRoot) return;
        detachLegacyUiNode(el);
    });
}

function isLoadingOverlayBlockingDmUi() {
    return !!(loadingOverlayRoot && !loadingOverlayFinished);
}

function suppressDiceUiForDm(suppress) {
    if (suppress) {
        if (!savedDiceRollFn && typeof window.diceRoll === 'function') {
            savedDiceRollFn = window.diceRoll;
        }
        window.diceRoll = () => {};
        return;
    }
    if (savedDiceRollFn) {
        window.diceRoll = savedDiceRollFn;
        savedDiceRollFn = null;
    }
}

function hardSuppressPlayerFacingUiForDm() {
    // DM command center is the only active UI authority in DM mode.
    const detachIds = [
        'combat-log',
        'combat-ui',
        'action-menu',
        'coords-hud',
        'fps-hud',
        'turn-end-overlay',
        'end-turn-prompt',
    ];
    detachIds.forEach((id) => {
        const el = document.getElementById(id);
        if (el) detachLegacyUiNode(el);
    });

    // Keep root-only DM UI while removing legacy visual noise.
    if (combatLogEl) detachLegacyUiNode(combatLogEl);
    if (actionMenuEl) detachLegacyUiNode(actionMenuEl);
    if (combatUiEl) detachLegacyUiNode(combatUiEl);
}

function addDmEvent(text, tone = 'info') {
    if (modeManager.current !== MODE.DM) return;
    if (!dmEventLogEl) return;
    const msgText = String(text || '').trim();
    if (!msgText) return;

    const line = document.createElement('div');
    line.textContent = msgText;
    line.style.fontFamily = 'Consolas, "Segoe UI", monospace';
    line.style.fontSize = '12px';
    line.style.lineHeight = '1.35';
    line.style.padding = '5px 8px';
    line.style.borderRadius = '6px';
    line.style.whiteSpace = 'nowrap';
    line.style.overflow = 'hidden';
    line.style.textOverflow = 'ellipsis';
    if (tone === 'hit') {
        line.style.color = '#89d38a';
        line.style.background = 'rgba(35, 92, 49, 0.28)';
    } else if (tone === 'miss') {
        line.style.color = '#ffb0b0';
        line.style.background = 'rgba(110, 34, 34, 0.3)';
    } else if (tone === 'system') {
        line.style.color = '#ffe39e';
        line.style.background = 'rgba(92, 74, 31, 0.3)';
    } else {
        line.style.color = '#9ec9ff';
        line.style.background = 'rgba(38, 56, 90, 0.3)';
    }

    dmEventLogEl.appendChild(line);
    while (dmEventLogEl.children.length > 6) {
        dmEventLogEl.removeChild(dmEventLogEl.firstChild);
    }
    dmEventLogEl.scrollTop = dmEventLogEl.scrollHeight;
}

function getCombatActorLabelById(actorId) {
    if (!actorId) return 'Unknown';
    if (actorId === 'player' || actorId === getLocalCombatActorId()) return 'Player';
    const actor = findCombatActorById(actorId);
    if (actor) return getCombatActorLabel(actor);
    return String(actorId);
}

function setDmCameraMode(nextMode, options = {}) {
    if (!Object.values(DM_CAMERA_MODE).includes(nextMode)) return false;
    dmCameraMode = nextMode;

    if (nextMode !== DM_CAMERA_MODE.FREE) {
        dmFreeMoveForward = false;
        dmFreeMoveBackward = false;
        dmFreeMoveLeft = false;
        dmFreeMoveRight = false;
        dmFreeMoveUp = false;
        dmFreeMoveDown = false;
        dmFreeMoveFast = false;
    }

    if (!options.silent) {
        const label = nextMode === DM_CAMERA_MODE.DIRECTOR
            ? 'DM camera: director (1)'
            : nextMode === DM_CAMERA_MODE.TACTICAL
                ? 'DM camera: tactical top-down (2)'
                : nextMode === DM_CAMERA_MODE.FOLLOW
                    ? 'DM camera: follow lock (3)'
                    : 'DM camera: free fly (ESC + WASD)';
        showFloatingText(label, '#9ec9ff', true);
        appendConsoleHistory(label, 'ok');
    }

    return true;
}

function updateDmFreeSwimCamera(delta) {
    if (!dmCamera) return false;

    const speed = DM_FREE_SWIM_SPEED * (dmFreeMoveFast ? DM_FREE_SWIM_FAST_MULTIPLIER : 1);
    dmCamera.getWorldDirection(dmFreeForward);
    if (dmFreeForward.lengthSq() < 0.0001) {
        dmFreeForward.set(0, 0, -1);
    } else {
        dmFreeForward.normalize();
    }

    dmFreeRight.crossVectors(dmFreeForward, dmFreeUp).normalize();

    dmFreeMove.set(0, 0, 0);
    if (dmFreeMoveForward) dmFreeMove.add(dmFreeForward);
    if (dmFreeMoveBackward) dmFreeMove.sub(dmFreeForward);
    if (dmFreeMoveLeft) dmFreeMove.sub(dmFreeRight);
    if (dmFreeMoveRight) dmFreeMove.add(dmFreeRight);
    if (dmFreeMoveUp) dmFreeMove.add(dmFreeUp);
    if (dmFreeMoveDown) dmFreeMove.sub(dmFreeUp);

    if (dmFreeMove.lengthSq() > 0.0001) {
        dmFreeMove.normalize();
        dmCamera.position.addScaledVector(dmFreeMove, speed * Math.max(0, delta));
    }

    return true;
}

function focusDmCameraOnTarget(target, options = {}) {
    if (!dmCamera || !target) return false;
    const pos = (target && target.position instanceof THREE.Vector3) ? target.position : null;
    if (!pos) return false;
    const offsetY = Number.isFinite(options.offsetY) ? options.offsetY : 8;
    const offsetZ = Number.isFinite(options.offsetZ) ? options.offsetZ : 12;
    const endPos = new THREE.Vector3(pos.x, pos.y + offsetY, pos.z + offsetZ);
    const startPos = dmCamera.position.clone();
    const lookTarget = new THREE.Vector3(pos.x, pos.y + 1.2, pos.z);
    const duration = 480;
    const startTime = performance.now();
    function tick(now) {
        const t = Math.min(1, (now - startTime) / duration);
        const eased = 1 - Math.pow(1 - t, 3);
        dmCamera.position.lerpVectors(startPos, endPos, eased);
        dmCamera.lookAt(lookTarget);
        dmCamera.rotation.order = 'YXZ';
        if (t < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
    const label = (target.userData && (target.userData.label || target.userData.name)) || 'entity';
    addDmEvent(`Camera → ${label}`, 'system');
    return true;
}
window.focusDmCameraOnTarget = focusDmCameraOnTarget;

const consoleState = {
    open: false,
    history: [],
    commandHistory: [],
    commandHistoryIndex: -1,
    suggestionMatches: [],
    suggestionIndex: 0,
};

const uxTelemetry = {
    enabled: false,
    sessionStartedAt: 0,
    samples: {
        confirmUiMs: [],
        attackRttMs: [],
        moveRttMs: [],
        endTurnRttMs: [],
    },
    counters: {
        confirms: 0,
        cancels: 0,
        timeouts: 0,
        macroRuns: 0,
    },
    marks: {
        confirmUiStartAt: 0,
        attackSentAt: 0,
        moveSentAt: 0,
        endTurnSentAt: 0,
    },
    macroRunning: false,
};

const uxIntentState = {
    attack: { state: 'idle', since: 0, note: '' },
    move: { state: 'idle', since: 0, note: '' },
    endTurn: { state: 'idle', since: 0, note: '' },
};

const consoleCommands = Object.create(null);
let consoleRootEl = null;
let commandConsoleUiManager = null;
let consoleCommandRuntimeManager = null;
let consoleEventBus = null;
let combatParticlesEnabled = true;
let consoleAudioMuted = false;
let modeOverlayEl = null;

function getAvailableConsoleCommandNames() {
    return Object.keys(consoleCommands)
        .filter((name) => {
            const cmd = consoleCommands[name];
            return !!(cmd && Array.isArray(cmd.modes) && cmd.modes.includes(modeManager.current));
        })
        .sort();
}

function ensureCommandConsoleUiManager() {
    if (commandConsoleUiManager) return commandConsoleUiManager;
    commandConsoleUiManager = createCommandConsoleUiManager({
        consoleState,
        getCurrentMode: () => modeManager.current,
        getAvailableCommandNames: getAvailableConsoleCommandNames,
        runConsoleCommand,
        isTextInputTarget,
        onRootElChanged: (rootEl) => {
            consoleRootEl = rootEl || null;
        },
    });
    consoleEventBus = commandConsoleUiManager.getEventBus();
    return commandConsoleUiManager;
}

ensureCommandConsoleUiManager();

function appendConsoleHistory(text, tone = 'info') {
    ensureCommandConsoleUiManager().appendConsoleHistory(text, tone);
}

function renderConsoleHistory() {
    ensureCommandConsoleUiManager().renderConsoleHistory();
}

function updateConsoleModeBadge() {
    ensureCommandConsoleUiManager().updateConsoleModeBadge();
}

function renderConsoleSuggestions() {
    ensureCommandConsoleUiManager().renderConsoleSuggestions();
}

function ensureConsoleUi() {
    ensureCommandConsoleUiManager().ensureConsoleUi();
}

function setConsoleOpen(open) {
    ensureCommandConsoleUiManager().setConsoleOpen(open);
}

function toggleConsoleOpen() {
    ensureCommandConsoleUiManager().toggleConsoleOpen();
}

function isTextInputTarget(target) {
    const tagName = target && target.tagName ? target.tagName : '';
    return tagName === 'INPUT' || tagName === 'TEXTAREA' || target?.isContentEditable === true;
}

function isConsoleToggleKey(event) {
    if (event.repeat) return false;
    // Reliable fallback shortcuts across keyboard layouts.
    if (event.code === 'F2') return true;
    if (event.code === 'KeyK' && event.ctrlKey && event.shiftKey) return true;
    if (isGodModeActive() && event.code === 'Tab') return true;
    if (event.code === 'Backquote' || event.code === 'Slash' || event.code === 'NumpadDivide') return true;
    return event.key === '`' || event.key === '/';
}

function tokenizeConsoleInput(raw) {
    return ensureConsoleCommandRuntimeManager().tokenizeConsoleInput(raw);
}

function registerConsoleCommand(name, config) {
    if (!name || !config || typeof config.execute !== 'function') return;
    consoleCommands[name.toLowerCase()] = {
        modes: Array.isArray(config.modes) ? config.modes.slice() : [CONSOLE_MODE.DEV],
        usage: config.usage || name,
        description: config.description || '',
        execute: config.execute,
    };
}

function ensureConsoleCommandRuntimeManager() {
    if (consoleCommandRuntimeManager) return consoleCommandRuntimeManager;
    consoleCommandRuntimeManager = createConsoleCommandRuntimeManager({
        getScene: () => scene,
        getRenderer: () => renderer,
        getPlayerState: () => playerState,
        requestTrainingDummySpawn,
        saveSnapshot,
        requestRewindTurn,
        requestReplayLastAction,
        getDmOverride: () => dmOverride,
        setDmOverride: (value) => { dmOverride = value; },
        requestEndTurn,
        requestStepTurn,
        requestPossessActor,
        requestReleasePossession,
        getControlledActor,
        getMode: () => modeManager.current,
        modeDm: MODE.DM,
        appendConsoleHistory,
        runPossessedEnemyAttack,
        getSelectedCombatTarget: () => selectedCombatTarget,
        getTrainingDummies: () => trainingDummies,
        getEdgeDistanceFeet,
        setSelectedCombatTarget,
        selectMoveAndAttackAction,
        getConsoleAudioMuted: () => consoleAudioMuted,
        setConsoleAudioMuted: (value) => { consoleAudioMuted = !!value; },
        getCombatMixerMasterGain: () => combatMixerMasterGain,
        getCombatAudioMasterGain: () => combatAudioMasterGain,
        getCombatMusicMasterGain: () => combatMusicMasterGain,
        getCombatMusicTargetGain,
        playCombatSfxCue,
        getEventBus: () => consoleEventBus,
        getConsoleCommands: () => consoleCommands,
    });
    return consoleCommandRuntimeManager;
}

function buildConsoleContext() {
    return ensureConsoleCommandRuntimeManager().buildConsoleContext();
}

function runConsoleCommand(input) {
    ensureConsoleCommandRuntimeManager().runConsoleCommand(input);
}

function parseConsoleScalar(raw) {
    return ensureConsoleCommandRuntimeManager().parseConsoleScalar(raw);
}

function uxResetTelemetry() {
    uxTelemetry.samples.confirmUiMs.length = 0;
    uxTelemetry.samples.attackRttMs.length = 0;
    uxTelemetry.samples.moveRttMs.length = 0;
    uxTelemetry.samples.endTurnRttMs.length = 0;
    uxTelemetry.counters.confirms = 0;
    uxTelemetry.counters.cancels = 0;
    uxTelemetry.counters.timeouts = 0;
    uxTelemetry.marks.confirmUiStartAt = 0;
    uxTelemetry.marks.attackSentAt = 0;
    uxTelemetry.marks.moveSentAt = 0;
    uxTelemetry.marks.endTurnSentAt = 0;
}

function uxStartTelemetry() {
    uxResetTelemetry();
    uxTelemetry.enabled = true;
    uxTelemetry.sessionStartedAt = Date.now();
}

function uxStopTelemetry() {
    uxTelemetry.enabled = false;
}

function uxRecordSample(bucket, value) {
    if (!uxTelemetry.enabled) return;
    if (!bucket || !Array.isArray(bucket)) return;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return;
    bucket.push(n);
}

function uxPercentile(values, p) {
    if (!Array.isArray(values) || values.length === 0) return null;
    const sorted = values.slice().sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * (sorted.length - 1))));
    return sorted[idx];
}

function uxStats(values) {
    if (!Array.isArray(values) || values.length === 0) {
        return { n: 0, avg: null, p50: null, p95: null };
    }
    const sum = values.reduce((acc, v) => acc + v, 0);
    return {
        n: values.length,
        avg: sum / values.length,
        p50: uxPercentile(values, 50),
        p95: uxPercentile(values, 95),
    };
}

function uxFormatStats(label, values) {
    const s = uxStats(values);
    if (s.n <= 0) return `${label}: n=0`;
    return `${label}: n=${s.n} avg=${s.avg.toFixed(1)}ms p50=${s.p50.toFixed(1)}ms p95=${s.p95.toFixed(1)}ms`;
}

function uxSetIntentStatus(kind, state, note = '') {
    if (!uxIntentState[kind]) return;
    uxIntentState[kind].state = String(state || 'idle');
    uxIntentState[kind].since = performance.now();
    uxIntentState[kind].note = String(note || '');
    updateActionMenu();
}

function uxIntentBadgeHtml(kind) {
    const status = uxIntentState[kind];
    if (!status || status.state === 'idle') return '';
    const ageMs = Math.max(0, performance.now() - (Number(status.since) || 0));
    if ((status.state === 'resolved' || status.state === 'failed' || status.state === 'canceled') && ageMs > 2600) {
        uxIntentState[kind].state = 'idle';
        return '';
    }
    const stateClass = `ffx-intent-${status.state}`;
    const text = status.note ? `${status.state}:${status.note}` : status.state;
    return `<span class="ffx-intent-badge ${stateClass}">${text}</span>`;
}

function uxComputeFeelScore() {
    const attack = uxStats(uxTelemetry.samples.attackRttMs);
    const move = uxStats(uxTelemetry.samples.moveRttMs);
    const endTurn = uxStats(uxTelemetry.samples.endTurnRttMs);
    const confirmUi = uxStats(uxTelemetry.samples.confirmUiMs);
    const p95 = (s) => (s && Number.isFinite(s.p95) ? s.p95 : null);
    let score = 100;

    const penalties = [
        { value: p95(confirmUi), target: 90, scale: 0.08 },
        { value: p95(attack), target: 450, scale: 0.03 },
        { value: p95(move), target: 500, scale: 0.03 },
        { value: p95(endTurn), target: 700, scale: 0.03 },
    ];
    penalties.forEach((entry) => {
        if (!Number.isFinite(entry.value)) return;
        const overflow = Math.max(0, entry.value - entry.target);
        score -= overflow * entry.scale;
    });

    score -= (uxTelemetry.counters.timeouts || 0) * 6;
    const cancelRate = (uxTelemetry.counters.confirms + uxTelemetry.counters.cancels) > 0
        ? (uxTelemetry.counters.cancels / (uxTelemetry.counters.confirms + uxTelemetry.counters.cancels))
        : 0;
    if (cancelRate > 0.35) {
        score -= (cancelRate - 0.35) * 40;
    }
    return Math.max(0, Math.min(100, score));
}

async function uxWaitFor(predicate, timeoutMs = 3000, pollMs = 40) {
    const started = performance.now();
    while ((performance.now() - started) < timeoutMs) {
        if (predicate()) return true;
        await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
    return false;
}

async function runUxMacro(cycles = 3) {
    if (uxTelemetry.macroRunning) {
        appendConsoleHistory('UX macro already running', 'error');
        return;
    }
    uxTelemetry.macroRunning = true;
    uxTelemetry.counters.macroRuns += 1;
    appendConsoleHistory(`UX macro start: ${cycles} cycle(s)`, 'ok');

    try {
        for (let i = 0; i < cycles; i++) {
            if (currentGameMode !== GAME_MODE.COMBAT || combatState.phase !== 'PLAYER') {
                appendConsoleHistory(`UX macro halted at cycle ${i + 1}: not in player combat turn`, 'error');
                break;
            }

            const targets = trainingDummies.filter((dummy) => (
                dummy && dummy.parent && (dummy.userData?.hp || 0) > 0
            ));
            if (targets.length <= 0) {
                appendConsoleHistory(`UX macro halted at cycle ${i + 1}: no live targets`, 'error');
                break;
            }

            const target = targets.sort((a, b) => getEdgeDistanceFeet(playerState, a) - getEdgeDistanceFeet(playerState, b))[0];
            setSelectedCombatTarget(target);
            selectMoveAndAttackAction(target);

            const gotConfirm = await uxWaitFor(() => !!combatInteraction.awaitingConfirm, 1200, 30);
            if (!gotConfirm) {
                uxTelemetry.counters.timeouts += 1;
                appendConsoleHistory(`UX macro cycle ${i + 1}: confirm did not appear`, 'error');
                break;
            }

            confirmAction();
            await new Promise((resolve) => setTimeout(resolve, 260));
            endTurn();

            const backToPlayer = await uxWaitFor(() => (currentGameMode === GAME_MODE.COMBAT && combatState.phase === 'PLAYER'), 10000, 60);
            if (!backToPlayer) {
                uxTelemetry.counters.timeouts += 1;
                appendConsoleHistory(`UX macro cycle ${i + 1}: timed out waiting for next player turn`, 'error');
                break;
            }

            appendConsoleHistory(`UX macro cycle ${i + 1}/${cycles} complete`, 'ok');
            await new Promise((resolve) => setTimeout(resolve, 120));
        }
    } finally {
        uxTelemetry.macroRunning = false;
        appendConsoleHistory('UX macro done', 'ok');
    }
}

function registerDefaultConsoleCommands() {
    registerDefaultConsoleCommandsFromManager({
        registerConsoleCommand,
        CONSOLE_MODE,
        MODE,
        GAME_MODE,
        SETTINGS,
        SIMULATION_AUTHORITY,
        DM_AUTHORITY_LAYER,
        THREE,
        getCamera: () => camera,
        combatState,
        playerState,
        combatTimeline,
        combatActionHistory,
        getCombatActionHistoryCursor: () => combatActionHistoryCursor,
        getCombatActionAtCursor,
        modeManager,
        consoleCommands,
        consoleState,
        appendConsoleHistory,
        renderConsoleHistory,
        setQuality,
        isObserverClient,

        updateClientRuntimeModeFromAuthority,
        getClientModeFull: () => CLIENT_MODE_FULL,
        setClientMode: (value) => { CLIENT_MODE = value; },
        applySettings,
        getCurrentGameMode: () => currentGameMode,
        setCurrentGameMode: (value) => { currentGameMode = value; },
        requestTrainingDummySpawn,
        getSpectatorCombat: () => spectatorCombat,
        setSpectatorCombat: (value) => { spectatorCombat = !!value; },
        requestDmStartCombat,
        emitCombatStateEvent,
        getLocalPlayerId: () => localPlayerId,
        getSocket: () => socket,
        findCombatActorById,
        getSelectedCombatTarget: () => selectedCombatTarget,
        getCombatParticlesEnabled: () => combatParticlesEnabled,
        setCombatParticlesEnabled: (value) => { combatParticlesEnabled = !!value; },
        setGridVisibility,
        toggleGrid,
        getGridVisible: () => gridVisible,
        getYaw: () => yaw,
        setYaw: (value) => { yaw = value; },
        getPitch: () => pitch,
        setPitch: (value) => { pitch = value; },
        getLookSpeed: () => lookSpeed,
        setLookSpeed: (value) => { lookSpeed = value; },
        updatePlayerHealthHud,
        setCombatPhase,
        setCombatLock,
        deactivateCombatCamera,
        updateCombatUI,
        updateActionMenu,
        getDmAutoStepEnabled: () => dmAutoStepEnabled,
        setDmAutoStepEnabled,
        getSimulationAuthority: () => simulationAuthority,
        setSimulationAuthority,
        syncDmAuthorityLayerFromState,
        getDmAuthorityLayer: () => dmAuthorityLayer,
        setDmAuthorityLayer,
        parseConsoleScalar,
        syncPlayerRigFromState,
        uxStartTelemetry,
        uxStopTelemetry,
        uxResetTelemetry,
        runUxMacro,
        uxTelemetry,
        uxFormatStats,
        uxComputeFeelScore,
    });
}

function handleConsoleGlobalKeydown(event) {
    if (isConsoleToggleKey(event) && !isTextInputTarget(event.target)) {
        toggleConsoleOpen();
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
    }

    if (!consoleState.open) return;

    // Allow typing/navigation inside text inputs while console is open.
    // Without this, the global capture handler blocks all keystrokes.
    if (isTextInputTarget(event.target)) {
        if (event.key === 'Escape') {
            setConsoleOpen(false);
            event.preventDefault();
            event.stopImmediatePropagation();
        }
        return;
    }

    // Keep gameplay handlers isolated while the command console is active.
    if (event.key === 'Escape') {
        setConsoleOpen(false);
    }
    event.preventDefault();
    event.stopImmediatePropagation();
}

function resetTransientInputState() {
    moveForward = false;
    moveBackward = false;
    moveLeft = false;
    moveRight = false;
    turnLeft = false;
    turnRight = false;
    playerFlyUp = false;
    playerFlyDown = false;
    playerSprinting = false;
    pendingAction = null;
}

function applyRuntimeMode(mode) {
    if (!isCameraReadyForRuntimeMode()) {
        pendingRuntimeMode = mode;
        traceDmPipeline('RUNTIME MODE QUEUED', { mode });
        return;
    }

    const allowPlayerControl = mode === MODE.PLAYER || isDmLikeMode(mode);
    const inPlayerMode = mode === MODE.PLAYER;
    const inDmMode = mode === MODE.DM;
    const inDmLikeMode = isDmLikeMode(mode);

    if (!allowPlayerControl || inDmMode) {
        resetTransientInputState();
        showActionUI(false);
        hideCombatConfirmUI();
        hideEndTurnPrompt();
        hideTargetPreview();
        clearTurnEndState();
        if (combatInteraction.awaitingConfirm) {
            resetCombatInteraction();
        }
    } else if (currentGameMode === GAME_MODE.COMBAT && currentTurnPhase === TURN_PHASE.PLAYER) {
        showActionUI(true);
    }

    if (mode === MODE.DEV) {
        if (currentGameMode === GAME_MODE.COMBAT) {
            clearTurnEndState();
            currentGameMode = GAME_MODE.FREE;
            currentTurnPhase = TURN_PHASE.IDLE;
            combatState.inCombat = false;
            combatState.phase = 'TRANSITION';
            setCombatLock(false);
            setCombatTimelineBusy(false);
            clearCombatMoveTiles();
            deactivateCombatCamera();
            logCombatEvent('Combat paused by DEV mode', 'system');
        }
    }

    if (mode !== MODE.DEV && colliderDebugVisible) {
        setColliderDebugVisible(false);
    }

    if (mode !== MODE.DM) {
        dmUiV2Nuked = false;
        dmZoneCollapsed.top = false;
        dmZoneCollapsed.right = false;
        dmZoneCollapsed.bottom = false;
        dmZoneCollapsed.center = false;
        applyDmZoneVisibility();
        simulationAuthority = SIMULATION_AUTHORITY.SERVER;
        dmAuthorityLayer = DM_AUTHORITY_LAYER.OBSERVER;
        dmFollowEntity = null;
        setDmCameraMode(DM_CAMERA_MODE.FREE, { silent: true });
        releasePossession();
        setDmAutoStepEnabled(false);
    }

    if (inDmLikeMode && !getControlledActor()) {
        releasePointerLockIfActive();
        startLocalSimulation();
        dmAuthorityLayer = DM_AUTHORITY_LAYER.SIMULATOR;
        activeCamera = dmCamera || camera;
        setDmCameraMode(DM_CAMERA_MODE.FREE, { silent: true });
        if (dmCamera) {
            dmCamera.position.set(
                playerState.position.x,
                playerState.position.y + 20,
                playerState.position.z + 20,
            );
            dmCamera.lookAt(playerState.position);
        }
    } else {
        activeCamera = camera;
    }

    setPlayerHudVisible(mode !== MODE.DM);

    if (inDmMode) {
        dmUiV2Nuked = false;
        createDmRootUI();
        hardSuppressPlayerFacingUiForDm();
        suppressDiceUiForDm(true);
        setCombatUiSuppressed(true);
        if (consoleRootEl) {
            consoleRootEl.style.left = '14px';
            consoleRootEl.style.bottom = '14px';
        }
        setConsoleOpen(true);
    } else {
        suppressDiceUiForDm(false);
        restoreDetachedLegacyUiNodes();
    }

    if (inPlayerMode && inspectorOpen) {
        setInspectorOpen(false);
    }
    if (inspectorMenu) {
        inspectorMenu.style.display = inPlayerMode ? 'none' : 'block';
        inspectorMenu.style.pointerEvents = inPlayerMode ? 'none' : 'auto';
        inspectorMenu.style.visibility = inPlayerMode ? 'hidden' : 'visible';
    }
    if (inspectorTab) {
        inspectorTab.style.display = inPlayerMode ? 'none' : 'flex';
        inspectorTab.style.pointerEvents = inPlayerMode ? 'none' : 'auto';
        inspectorTab.style.visibility = inPlayerMode ? 'hidden' : 'visible';
    }

    updateCombatUI();
    updateActionMenu();
    updateDmControlPanel();
}

function closeModeSelectionOverlay() {
    if (!modeOverlayEl) return;
    
    // Show loading overlay again now that role is chosen
    if (loadingOverlayRoot) {
        loadingOverlayRoot.style.display = 'flex';
    }
    
    // Unblock anything awaiting role selection before tearing down the overlay.
    if (_resolveRoleChosen) {
        _resolveRoleChosen();
        _resolveRoleChosen = null;
    }
    if (modeOverlayEl.parentElement) {
        modeOverlayEl.parentElement.removeChild(modeOverlayEl);
    }
    modeOverlayEl = null;
}

function showRuntimeModeSelectionOverlay() {
    if (modeOverlayEl || !document.body) return;
    
    // Hide loading overlay while user selects role (will be re-shown after)
    if (loadingOverlayRoot) {
        loadingOverlayRoot.style.display = 'none';
    }

    modeOverlayEl = document.createElement('div');
    modeOverlayEl.style.position = 'fixed';
    modeOverlayEl.style.inset = '0';
    modeOverlayEl.style.zIndex = '100000';  // MUST be above loading overlay (99999)
    modeOverlayEl.style.display = 'flex';
    modeOverlayEl.style.alignItems = 'center';
    modeOverlayEl.style.justifyContent = 'center';
    modeOverlayEl.style.background = 'radial-gradient(circle at 50% 35%, rgba(19, 31, 58, 0.86), rgba(5, 8, 16, 0.95))';
    // Ensure clicks on overlay background also close/resolve (user can always click the panel instead)
    modeOverlayEl.style.pointerEvents = 'auto';

    const panel = document.createElement('div');
    panel.style.width = 'min(520px, calc(100vw - 28px))';
    panel.style.padding = '20px';
    panel.style.borderRadius = '12px';
    panel.style.border = '1px solid rgba(134, 177, 255, 0.5)';
    panel.style.background = 'linear-gradient(170deg, rgba(16, 24, 43, 0.94), rgba(7, 10, 18, 0.98))';
    panel.style.boxShadow = '0 16px 45px rgba(0, 0, 0, 0.55)';
    panel.style.fontFamily = 'Consolas, "Segoe UI", monospace';

    const title = document.createElement('div');
    title.textContent = 'Select Runtime Mode';
    title.style.color = '#f2f6ff';
    title.style.fontSize = '22px';
    title.style.fontWeight = '700';
    title.style.letterSpacing = '0.4px';
    title.style.marginBottom = '8px';

    const subtitle = document.createElement('div');
    subtitle.textContent = 'Party Lobby: claim a slot as Player, DM, or Dev. You can switch later via console.';
    subtitle.style.color = '#a9c5ff';
    subtitle.style.fontSize = '13px';
    subtitle.style.marginBottom = '14px';

    const status = document.createElement('div');
    status.textContent = 'Lobby online: loading slots...';
    status.style.color = '#9bc0ff';
    status.style.fontSize = '12px';
    status.style.marginBottom = '10px';

    const playerSlotsLine = document.createElement('div');
    playerSlotsLine.textContent = 'P1: open | P2: open | P3: open | P4: open';
    playerSlotsLine.style.color = '#d7e7ff';
    playerSlotsLine.style.fontSize = '12px';
    playerSlotsLine.style.marginBottom = '12px';

    const startRow = document.createElement('div');
    startRow.style.display = 'none';
    startRow.style.justifyContent = 'flex-end';
    startRow.style.marginBottom = '10px';

    const startBtn = document.createElement('button');
    startBtn.type = 'button';
    startBtn.textContent = 'Start Game (DM)';
    startBtn.style.padding = '8px 12px';
    startBtn.style.borderRadius = '8px';
    startBtn.style.border = '1px solid rgba(130, 212, 154, 0.95)';
    startBtn.style.background = 'rgba(24, 63, 40, 0.92)';
    startBtn.style.color = '#d9ffe8';
    startBtn.style.fontFamily = 'Consolas, "Segoe UI", monospace';
    startBtn.style.fontSize = '12px';
    startBtn.style.cursor = 'pointer';
    startBtn.addEventListener('click', () => {
        if (startBtn.disabled) return;
        requestStartGame();
    });
    startRow.appendChild(startBtn);

    const actions = document.createElement('div');
    actions.style.display = 'grid';
    actions.style.gridTemplateColumns = '1fr';
    actions.style.gap = '10px';

    const buttonsByMode = new Map();

    function makeModeButton(mode, label, detail, accent) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.style.textAlign = 'left';
        btn.style.padding = '12px 14px';
        btn.style.borderRadius = '9px';
        btn.style.border = `1px solid ${accent}`;
        btn.style.background = 'rgba(8, 12, 22, 0.9)';
        btn.style.color = '#edf3ff';
        btn.style.cursor = 'pointer';
        btn.style.fontFamily = 'Consolas, "Segoe UI", monospace';
        btn.style.transition = 'transform 120ms ease, box-shadow 120ms ease';

        const line1 = document.createElement('div');
        line1.textContent = label;
        line1.style.fontWeight = '700';
        line1.style.marginBottom = '3px';

        const line2 = document.createElement('div');
        line2.textContent = detail;
        line2.style.fontSize = '13px';
        line2.style.color = '#a8c2ff';
        line2.__baseDetail = detail;

        btn.addEventListener('mouseenter', () => {
            btn.style.transform = 'translateY(-1px)';
            btn.style.boxShadow = `0 8px 20px ${accent.replace('1)', '0.25)')}`;
        });
        btn.addEventListener('mouseleave', () => {
            btn.style.transform = 'translateY(0px)';
            btn.style.boxShadow = 'none';
        });
        btn.addEventListener('click', () => {
            if (btn.disabled) return;
            modeManager.setMode(mode);
            // NOW register with server using the chosen role (not default)
            if (socket) {
                registerRoleWithServer();
            }
            closeModeSelectionOverlay();
            appendConsoleHistory(`Mode selected: ${mode}`, 'ok');
        });

        btn.appendChild(line1);
        btn.appendChild(line2);
        btn.__detailLine = line2;
        buttonsByMode.set(mode, btn);
        return btn;
    }

    actions.appendChild(makeModeButton(MODE.PLAYER, 'Play Character', 'Movement, combat, and player interactions only.', 'rgba(88, 220, 145, 1)'));
    actions.appendChild(makeModeButton(MODE.DM, 'Dungeon Master', 'Play normally plus spawn enemies and control encounter flow.', 'rgba(255, 187, 82, 1)'));
    actions.appendChild(makeModeButton(MODE.DEV, 'Developer Tools', 'Selection, debug overlays, and engine diagnostics.', 'rgba(116, 173, 255, 1)'));

    panel.appendChild(title);
    panel.appendChild(subtitle);
    panel.appendChild(status);
    panel.appendChild(playerSlotsLine);
    panel.appendChild(startRow);
    panel.appendChild(actions);
    modeOverlayEl.appendChild(panel);
    modeOverlayEl.__lobbyWidgets = {
        statusEl: status,
        playerSlotsEl: playerSlotsLine,
        startBtn,
        buttonsByMode,
    };
    document.body.appendChild(modeOverlayEl);

    updateLobbyOverlayFromState();
    void refreshLobbyStateSnapshot();
}

function initializeCommandConsole() {
    let commandsRegistered = false;
    const ensureConsoleCommandsRegistered = () => {
        if (commandsRegistered) return;
        commandsRegistered = true;
        registerDefaultConsoleCommands();
    };

    // Defer registration one tick so late-declared constants (e.g. GAME_MODE)
    // are initialized before command registry captures them.
    window.setTimeout(ensureConsoleCommandsRegistered, 0);
    // Debug escape hatch for cases where browser/input layers swallow hotkeys.
    window.__openCommandConsole = () => setConsoleOpen(true);
    window.__closeCommandConsole = () => setConsoleOpen(false);
    window.__toggleCommandConsole = () => toggleConsoleOpen();
    window.addEventListener('keydown', handleConsoleGlobalKeydown, true);
    modeManager.onChange((nextMode) => {
        updateConsoleModeBadge();
        applyRuntimeMode(nextMode);
    });
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            ensureConsoleUi();
            showRuntimeModeSelectionOverlay();
            window.setTimeout(() => applyRuntimeMode(modeManager.current), 0);
            appendConsoleHistory('Console ready. Type "help" for command list.');
        }, { once: true });
    } else {
        ensureConsoleUi();
        showRuntimeModeSelectionOverlay();
        window.setTimeout(() => applyRuntimeMode(modeManager.current), 0);
        appendConsoleHistory('Console ready. Type "help" for command list.');
    }
}

initializeCommandConsole();

let loadingOverlayRuntimeManager = null;
let loadingOverlayStyleManager = null;
let loadingOverlayBuilderManager = null;
let loadingDiceManager = null;
let loadingOverlayFinishManager = null;

function ensureLoadingOverlayRuntimeManager() {
    if (loadingOverlayRuntimeManager) return loadingOverlayRuntimeManager;
    loadingOverlayRuntimeManager = createLoadingOverlayRuntimeManager({
        performanceObj: performance,
        windowObj: window,
        getLoadingOverlayFinished: () => loadingOverlayFinished,
        getLoadingOverlayCloseScheduled: () => loadingOverlayCloseScheduled,
        getProgressFill: () => loadingOverlayProgressFill,
        getProgressText: () => loadingOverlayProgressText,
        getStatusEl: () => loadingOverlayStatus,
        getLoadingProgressValue: () => loadingProgressValue,
        setLoadingProgressValue: (value) => { loadingProgressValue = value; },
        getLoadingProgressTarget: () => loadingProgressTarget,
        setLoadingProgressTarget: (value) => { loadingProgressTarget = value; },
        getLoadingProgressAnimFrame: () => loadingProgressAnimFrame,
        setLoadingProgressAnimFrame: (value) => { loadingProgressAnimFrame = value; },
        getLoadingStatusQueue: () => loadingStatusQueue,
        getLoadingStatusTimer: () => loadingStatusTimer,
        setLoadingStatusTimer: (value) => { loadingStatusTimer = value; },
        getLoadingStatusLastShownAt: () => loadingStatusLastShownAt,
        setLoadingStatusLastShownAt: (value) => { loadingStatusLastShownAt = value; },
        loadingStatusMinIntervalMs: LOADING_STATUS_MIN_INTERVAL_MS,
        spawnLoadingMessageBurst,
    });
    return loadingOverlayRuntimeManager;
}

function clamp01(value) {
    return ensureLoadingOverlayRuntimeManager().clamp01(value);
}

function renderLoadingProgress(value) {
    ensureLoadingOverlayRuntimeManager().renderLoadingProgress(value);
}

function animateLoadingProgressFrame() {
    ensureLoadingOverlayRuntimeManager().animateLoadingProgressFrame();
}

function ensureLoadingProgressAnimation() {
    ensureLoadingOverlayRuntimeManager().ensureLoadingProgressAnimation();
}

function setLoadingProgress(value) {
    ensureLoadingOverlayRuntimeManager().setLoadingProgress(value);
}

function updateLoadingState(statusText, progressValue) {
    ensureLoadingOverlayRuntimeManager().updateLoadingState(statusText, progressValue);
}

function formatLoadingLogArgs(args) {
    return ensureLoadingOverlayRuntimeManager().formatLoadingLogArgs(args);
}

function appendLoadingLog(level, args) {
    ensureLoadingOverlayRuntimeManager().appendLoadingLog(level, args);
}

function setLoadingOverlayStatus(text) {
    ensureLoadingOverlayRuntimeManager().setLoadingOverlayStatus(text);
}

function setLoadingOverlayQuote(text) {
    ensureLoadingOverlayRuntimeManager().setLoadingOverlayQuote(text);
}

function ensureLoadingOverlayFxStyles() {
    if (!loadingOverlayStyleManager) {
        loadingOverlayStyleManager = createLoadingOverlayStyleManager({
            documentObj: document,
            getLoadingOverlayFxStylesInjected: () => loadingOverlayFxStylesInjected,
            setLoadingOverlayFxStylesInjected: (value) => { loadingOverlayFxStylesInjected = !!value; },
        });
    }
    loadingOverlayStyleManager.ensureLoadingOverlayFxStyles();
}

function spawnLoadingMessageBurst(count = 8) {
    if (!loadingOverlayFxLayer || !loadingOverlayStatus || loadingOverlayFinished) return;
    const statusRect = loadingOverlayStatus.getBoundingClientRect();
    const layerRect = loadingOverlayFxLayer.getBoundingClientRect();
    const originX = statusRect.left - layerRect.left + (statusRect.width * (0.2 + Math.random() * 0.6));
    const originY = statusRect.top - layerRect.top + (statusRect.height * (0.2 + Math.random() * 0.6));

    const burstSize = Math.max(4, Math.min(18, count));
    for (let i = 0; i < burstSize; i++) {
        const glyph = document.createElement('span');
        glyph.textContent = LOADING_PARTICLE_GLYPHS[Math.floor(Math.random() * LOADING_PARTICLE_GLYPHS.length)];
        glyph.style.position = 'absolute';
        glyph.style.left = `${originX}px`;
        glyph.style.top = `${originY}px`;
        glyph.style.color = i % 2 === 0 ? '#ffd166' : '#8fd3ff';
        glyph.style.fontSize = `${11 + Math.round(Math.random() * 13)}px`;
        glyph.style.fontWeight = '900';
        glyph.style.pointerEvents = 'none';
        glyph.style.zIndex = '4';
        const dx = (Math.random() - 0.5) * 180;
        const dy = -20 - (Math.random() * 120);
        glyph.style.setProperty('--tx', `${dx.toFixed(1)}px`);
        glyph.style.setProperty('--ty', `${dy.toFixed(1)}px`);
        glyph.style.setProperty('--s', `${(0.75 + Math.random() * 1.2).toFixed(2)}`);
        glyph.style.setProperty('--r', `${Math.round((Math.random() - 0.5) * 520)}deg`);
        glyph.style.animation = `loading-glyph-burst ${420 + Math.round(Math.random() * 520)}ms cubic-bezier(0.2, 0.82, 0.2, 1) forwards`;
        loadingOverlayFxLayer.appendChild(glyph);
        window.setTimeout(() => {
            if (glyph.parentElement) glyph.parentElement.removeChild(glyph);
        }, 1100);
    }
    loadingBurstCounter += 1;
}

function startLoadingQuoteCycle() {
    ensureLoadingOverlayVarietyManager().startLoadingQuoteCycle();
}

function animateLoadingBackdropFrame() {
    ensureLoadingOverlayVarietyManager().animateLoadingBackdropFrame();
}

function startLoadingBackdropAnimation() {
    ensureLoadingOverlayVarietyManager().startLoadingBackdropAnimation();
}

function startLoadingVarietyCycle() {
    ensureLoadingOverlayVarietyManager().startLoadingVarietyCycle();
}

let loadingOverlayVarietyManager = null;

function ensureLoadingOverlayVarietyManager() {
    if (loadingOverlayVarietyManager) return loadingOverlayVarietyManager;
    loadingOverlayVarietyManager = createLoadingOverlayVarietyManager({
        windowObj: window,
        performanceObj: performance,
        getLoadingOverlayFinished: () => loadingOverlayFinished,
        getLoadingOverlayRoot: () => loadingOverlayRoot,
        getLoadingOverlayCard: () => loadingOverlayCard,
        getLoadingOverlayAccentBar: () => loadingOverlayAccentBar,
        getLoadingOverlayQuote: () => loadingOverlayQuote,
        getLoadingQuoteTimer: () => loadingQuoteTimer,
        setLoadingQuoteTimer: (value) => { loadingQuoteTimer = value; },
        getLoadingQuoteIndex: () => loadingQuoteIndex,
        setLoadingQuoteIndex: (value) => { loadingQuoteIndex = value; },
        loadingNonsenseQuotes: LOADING_NONSENSE_QUOTES,
        loadingQuoteIntervalMs: LOADING_QUOTE_INTERVAL_MS,
        getLoadingBackdropAnimFrame: () => loadingBackdropAnimFrame,
        setLoadingBackdropAnimFrame: (value) => { loadingBackdropAnimFrame = value; },
        getLoadingFlavorTimer: () => loadingFlavorTimer,
        setLoadingFlavorTimer: (value) => { loadingFlavorTimer = value; },
        loadingVarietyStatuses: LOADING_VARIETY_STATUSES,
        loadingVarietyQuotes: LOADING_VARIETY_QUOTES,
        getLoadingBurstCounter: () => loadingBurstCounter,
        spawnLoadingMessageBurst,
        setLoadingOverlayStatus,
        getLoadingDiceTray: () => loadingDiceTray,
        rollAllLoadingDice,
        getLoadingProgressTarget: () => loadingProgressTarget,
        setLoadingProgress,
        clamp01,
    });
    return loadingOverlayVarietyManager;
}

function ensureLoadingOverlayFinishManager() {
    if (loadingOverlayFinishManager) return loadingOverlayFinishManager;
    loadingOverlayFinishManager = createLoadingOverlayFinishManager({
        windowObj: window,
        performanceObj: performance,
        getLoadingOverlayRoot: () => loadingOverlayRoot,
        getLoadingOverlayFinished: () => loadingOverlayFinished,
        setLoadingOverlayFinished: (value) => { loadingOverlayFinished = !!value; },
        getLoadingOverlayCloseScheduled: () => loadingOverlayCloseScheduled,
        setLoadingOverlayCloseScheduled: (value) => { loadingOverlayCloseScheduled = !!value; },
        getLoadingProgressValue: () => loadingProgressValue,
        setLoadingProgress,
        clamp01,
        getLoadingOverlayStartedAt: () => loadingOverlayStartedAt,
        loadingMinVisibleMs: LOADING_MIN_VISIBLE_MS,
        loadingPostCompleteHoldMs: LOADING_POST_COMPLETE_HOLD_MS,
        loadingFadeDurationMs: LOADING_FADE_DURATION_MS,
        setLoadingOverlayStatus,
        spawnLoadingMessageBurst,
        stopMainTheme,
        startDocksTheme,
        updateDmControlPanel,
        getLoadingLogFlushTimer: () => loadingLogFlushTimer,
        setLoadingLogFlushTimer: (value) => { loadingLogFlushTimer = value; },
        getLoadingQuoteTimer: () => loadingQuoteTimer,
        setLoadingQuoteTimer: (value) => { loadingQuoteTimer = value; },
        getLoadingFlavorTimer: () => loadingFlavorTimer,
        setLoadingFlavorTimer: (value) => { loadingFlavorTimer = value; },
        getLoadingDiceRollTimer: () => loadingDiceRollTimer,
        setLoadingDiceRollTimer: (value) => { loadingDiceRollTimer = value; },
        getLoadingStatusTimer: () => loadingStatusTimer,
        setLoadingStatusTimer: (value) => { loadingStatusTimer = value; },
        getLoadingProgressAnimFrame: () => loadingProgressAnimFrame,
        setLoadingProgressAnimFrame: (value) => { loadingProgressAnimFrame = value; },
        getLoadingBackdropAnimFrame: () => loadingBackdropAnimFrame,
        setLoadingBackdropAnimFrame: (value) => { loadingBackdropAnimFrame = value; },
        clearOverlayRefs: () => {
            loadingOverlayRoot = null;
            loadingOverlayLog = null;
            loadingOverlayStatus = null;
            loadingOverlayProgressFill = null;
            loadingOverlayProgressText = null;
            loadingOverlayQuote = null;
            loadingOverlayFxLayer = null;
            loadingOverlayCard = null;
            loadingOverlayAccentBar = null;
            loadingDiceTray = null;
        },
        clearLoadingStatusQueue: () => {
            loadingStatusQueue.length = 0;
        },
    });
    return loadingOverlayFinishManager;
}

function finishLoadingOverlay(message = 'Ready') {
    ensureLoadingOverlayFinishManager().finishLoadingOverlay(message);
}

let loadingMusicManager = null;

function ensureLoadingMusicManager() {
    if (loadingMusicManager) return loadingMusicManager;
    loadingMusicManager = createLoadingMusicManager({
        audioCtor: Audio,
        getMainThemeAudio: () => mainThemeAudio,
        setMainThemeAudio: (value) => { mainThemeAudio = value; },
        getDocksMusicAudio: () => docksMusicAudio,
        setDocksMusicAudio: (value) => { docksMusicAudio = value; },
    });
    return loadingMusicManager;
}

function startMainTheme() {
    ensureLoadingMusicManager().startMainTheme();
}

function startDocksTheme() {
    ensureLoadingMusicManager().startDocksTheme();
}

function stopDocksTheme() {
    ensureLoadingMusicManager().stopDocksTheme();
}

function stopMainTheme() {
    ensureLoadingMusicManager().stopMainTheme();
}

function ensureLoadingOverlayBuilderManager() {
    if (loadingOverlayBuilderManager) return loadingOverlayBuilderManager;
    loadingOverlayBuilderManager = createLoadingOverlayBuilderManager({
        documentObj: document,
        performanceObj: performance,
        ensureLoadingOverlayFxStyles,
        startMainTheme,
        renderLoadingProgress,
        setLoadingProgress,
        startLoadingVarietyCycle,
        startLoadingBackdropAnimation,
        spawnLoadingMessageBurst,
        rollAllLoadingDice,
        startLoadingDiceRollCycle,
        setLoadingOverlayStartedAt: (value) => { loadingOverlayStartedAt = value; },
        setLoadingOverlayRoot: (value) => { loadingOverlayRoot = value; },
        setLoadingOverlayCard: (value) => { loadingOverlayCard = value; },
        setLoadingOverlayFxLayer: (value) => { loadingOverlayFxLayer = value; },
        setLoadingOverlayAccentBar: (value) => { loadingOverlayAccentBar = value; },
        setLoadingOverlayProgressText: (value) => { loadingOverlayProgressText = value; },
        setLoadingOverlayProgressFill: (value) => { loadingOverlayProgressFill = value; },
        setLoadingOverlayStatusEl: (value) => { loadingOverlayStatus = value; },
        setLoadingOverlayQuoteEl: (value) => { loadingOverlayQuote = value; },
        setLoadingOverlayLog: (value) => { loadingOverlayLog = value; },
        setLoadingDiceTray: (value) => { loadingDiceTray = value; },
        setLoadingProgressValue: (value) => { loadingProgressValue = value; },
        setLoadingProgressTarget: (value) => { loadingProgressTarget = value; },
        setLoadingQuoteIndex: (value) => { loadingQuoteIndex = value; },
        getLoadingOverlayQuote: () => loadingOverlayQuote,
    });
    return loadingOverlayBuilderManager;
}

function createLoadingOverlay() {
    ensureLoadingOverlayBuilderManager().createLoadingOverlay();
}

function ensureLoadingDiceManager() {
    if (loadingDiceManager) return loadingDiceManager;
    loadingDiceManager = createLoadingDiceManager({
        documentObj: document,
        windowObj: window,
        getLoadingOverlayFinished: () => loadingOverlayFinished,
        getLoadingDiceTray: () => loadingDiceTray,
        getLoadingDiceRollTimer: () => loadingDiceRollTimer,
        setLoadingDiceRollTimer: (value) => { loadingDiceRollTimer = value; },
    });
    return loadingDiceManager;
}

// Build an inline SVG die face
function buildDieSvg(dieType, value) {
    return ensureLoadingDiceManager().buildDieSvg(dieType, value);
}

function rollAllLoadingDice() {
    ensureLoadingDiceManager().rollAllLoadingDice();
}

function startLoadingDiceRollCycle() {
    ensureLoadingDiceManager().startLoadingDiceRollCycle();
}

function mirrorConsoleToLoadingOverlay() {
    // Loading overlay intentionally does not mirror console logs.
}

createLoadingOverlay();

const visualAssetCatalog = {
    // Fill this with real character/item GLBs as your asset pipeline matures.
    // Example: 'character.elf.warlock': '/static/models/characters/elf_warlock.glb'
    'character.elf.warlock': {
        path: '/static/playerentity.gltf',
        scale: 0.5,
    },
};

function resolveAssetPathByKey(assetKey) {
    return visualAssetCatalog[assetKey] || null;
}

function getLocalSidIdentitySet() {
    const ids = new Set();
    const socketSid = String((socket && socket.id) || '').trim();
    const cachedSid = String(localPlayerId || '').trim();
    if (socketSid) ids.add(socketSid);
    if (cachedSid) ids.add(cachedSid);
    return ids;
}

function getLocalActorIdentitySet() {
    const ids = new Set();
    const localActor = String(localPlayerCombatActorId || '').trim();
    if (localActor && localActor !== 'player') {
        ids.add(localActor);
    }
    return ids;
}

function isLocalPlayerPayload(player) {
    if (!player || typeof player !== 'object') return false;

    const sidCandidates = getLocalSidIdentitySet();
    const sid = String(player.id || '').trim();
    if (sid && sidCandidates.has(sid)) return true;

    const actorCandidates = getLocalActorIdentitySet();
    if (!actorCandidates.size) return false;

    const actorId = String(player.networkId || player.actorId || '').trim();
    return !!(actorId && actorCandidates.has(actorId));
}

function purgeLocalEchoAvatars() {
    if (!scene || !scene.userData || !scene.userData.playerAvatars) return;

    const avatarEntries = Object.entries(scene.userData.playerAvatars);
    for (const [playerId, avatarRoot] of avatarEntries) {
        const candidate = {
            id: playerId,
            networkId: avatarRoot && avatarRoot.userData ? avatarRoot.userData.networkId : null,
            actorId: avatarRoot && avatarRoot.userData ? avatarRoot.userData.actorId : null,
        };
        if (isLocalPlayerPayload(candidate)) {
            removePlayerAvatar(playerId);
        }
    }

    if (!scene.userData.playerAvatarStates) return;
    Object.keys(scene.userData.playerAvatarStates).forEach((playerId) => {
        const state = scene.userData.playerAvatarStates[playerId];
        const candidate = {
            id: playerId,
            networkId: state && typeof state === 'object' ? state.networkId : null,
            actorId: state && typeof state === 'object' ? state.actorId : null,
        };
        if (isLocalPlayerPayload(candidate)) {
            delete scene.userData.playerAvatarStates[playerId];
        }
    });
}

async function loadFirstJson(urls) {
    for (const url of urls) {
        try {
            const res = await fetch(url);
            if (!res.ok) continue;
            return await res.json();
        } catch (_err) {
            // Try next path.
        }
    }
    return null;
}

async function initDataDrivenLayer(staticWorldRoot) {
    if (!ENABLE_DATA_DRIVEN_ENTITY_SPAWN) {
        return;
    }

    await ensureEngineEntityContractModule();

    const fallbackLoadEngineEntityFromUrls = async (urls) => {
        const entity = await loadFirstJson(urls);
        if (!entity || typeof entity !== 'object') {
            throw new Error('Engine entity contract not found in fallback loader');
        }
        return {
            entity,
            sourceUrl: 'fallback-json',
        };
    };

    const loadContract = loadEngineEntityFromUrls || fallbackLoadEngineEntityFromUrls;

    const engineContract = await loadContract([
        '/data/character_tidy/engine_entity.json',
        '/engine_entity.json',
        '/static/engine_entity.json',
    ]);
    window.loadedEngineEntity = engineContract.entity;
    window.inventorySystem = {
        itemDb: ITEM_DB,
        equipItem: (instanceId) => {
            if (socket) {
                socket.emit('equip-item', { instanceId });
                return true;
            }
            return equipItem(window.loadedEngineEntity, instanceId);
        },
        unequipItem: (instanceId) => {
            if (socket) {
                socket.emit('unequip-item', { instanceId });
                return true;
            }
            if (!window.loadedEngineEntity || !window.loadedEngineEntity.inventory) return false;
            const items = Array.isArray(window.loadedEngineEntity.inventory.items) ? window.loadedEngineEntity.inventory.items : [];
            const item = items.find((row) => row && row.instanceId === instanceId);
            if (!item) return false;
            item.equipped = false;
            return true;
        },
        useItem: (instanceId) => {
            if (socket) {
                socket.emit('use-item', { instanceId });
                return true;
            }
            return useItem(window.loadedEngineEntity, instanceId);
        },
        lootItem: (targetSid, itemId, qty = 1) => {
            if (!socket) return false;
            socket.emit('loot-item', { targetSid, itemId, qty });
            return true;
        },
    };
    void bootstrapPlayerCombatProfile(true);
    console.log(`Engine entity contract loaded + validated (${engineContract.sourceUrl})`);

    const templateRecord = await loadFirstJson([
        '/data/character_tidy/character_template.json',
        '/character_template.json',
        '/static/character_template.json',
    ]);
    const runtimeRecord = await loadFirstJson([
        '/data/character_tidy/combat_instance.json',
        '/combat_instance.json',
        '/static/combat_instance.json',
    ]);

    if (!templateRecord || !runtimeRecord) {
        console.warn('Data-driven layer skipped: character template/runtime contracts not found.');
        return;
    }

    try {
        const result = await spawnEntityFromContracts({
            templateRecord,
            runtimeRecord,
            staticRoot: staticWorldRoot,
            scene,
            resolveAssetPath: resolveAssetPathByKey,
        });
        console.log('Data-driven entity shell spawned. Source:', result.spawnSource);
        window.runtimeRenderBinding = result.runtimeRecord.render_registry_binding;
    } catch (err) {
        console.warn('Failed to initialize data-driven render layer:', err);
    }
}

function upsertPlayerAvatar(player) {
    if (!player || !player.id) return;
    if (!isSceneReadyForWorldState()) return;

    if (!scene.userData.playerAvatarStates) scene.userData.playerAvatarStates = {};
    scene.userData.playerAvatarStates[player.id] = player;

    if (window.__NET_DEBUG__) {
        console.log('[AVATAR DEBUG]', {
            id: player.id,
            hasExisting: !!scene.userData?.playerAvatars?.[player.id],
        });
    }

    const mode = modeManager.current;
    const effectiveLocalId = (socket && socket.id) ? socket.id : localPlayerId;
    const isLocalPlayer = isLocalPlayerPayload(player);

    if (isLocalPlayer) {
        localPlayerCombatActorId = String(player.networkId || player.actorId || player.id || localPlayerCombatActorId || '').trim() || localPlayerCombatActorId;
    }

    if (mode === MODE.DM && window.__NET_DEBUG__) {
        console.log('[DEBUG]', {
            id: player.id,
            localPlayerId,
            socketId: socket && socket.id ? socket.id : null,
            effectiveLocalId,
            isLocal: isLocalPlayer,
            mode,
        });
    }

    // Never apply network avatar updates to this client's own player.
    // Local avatar is driven by local rig state; network echoes should be ignored.
    if (isLocalPlayer) {
        if (scene.userData && scene.userData.playerAvatars && scene.userData.playerAvatars[player.id]) {
            removePlayerAvatar(player.id);
        }
        if (window.__NET_DEBUG__) console.log('[NET] Skipping local player avatar network upsert');
        return;
    }
    
    let avatarRoot = scene.userData.playerAvatars?.[player.id];

    if (player.avatar && player.avatar.modelUrl && player.avatar.modelUrl !== 'fallback' && avatarRoot) {
        ensureRemoteAvatarModelLoaded(avatarRoot, player.avatar.modelUrl, player.avatar.scale);
    }
    
    // If player sent avatar pose data, apply it (overrides simple cube)
    if (player.avatar && player.avatar.bonePoses && avatarRoot) {
        _netStats.avatarPoseUpdatesApplied += 1;
        
        // Traverse existing avatar and apply bone poses
        avatarRoot.traverse((bone) => {
            if (bone.isBone || (bone.userData && bone.userData.boneType)) {
                const boneName = bone.name || `bone_${Object.keys(player.avatar.bonePoses).length}`;
                const poseData = player.avatar.bonePoses[boneName];
                
                if (poseData && poseData.q) {
                    // Apply quaternion rotation
                    bone.quaternion.set(poseData.q[0], poseData.q[1], poseData.q[2], poseData.q[3]);
                }
                
                if (poseData && poseData.p) {
                    // Apply position (for skeleton meshes)
                    bone.position.set(poseData.p[0], poseData.p[1], poseData.p[2]);
                }
            }
        });
    }
    
    // Create avatar if it doesn't exist (fallback cube)
    if (!avatarRoot) {
        if (window.__NET_DEBUG__) {
            console.log(`[AVATAR] Creating new avatar for ${player.id}:`, { role: player.role, pos: player.position });
        }
        avatarRoot = new THREE.Group();
        avatarRoot.userData.playerId = player.id;
        avatarRoot.userData.playerRole = player.role;
        avatarRoot.userData.networkId = String(player.networkId || player.actorId || player.id || '').trim() || player.id;
        avatarRoot.userData.actorId = String(player.actorId || player.networkId || player.id || '').trim() || player.id;
        avatarRoot.userData.playerLabel = String(player.actorId || player.id || 'Player');
        
        // Simple cube visual for remote player (fallback if no mesh data)
        const geometry = new THREE.BoxGeometry(0.6, 1.8, 0.6);
        const material = new THREE.MeshStandardMaterial({
            color: player.role === 'dm' ? 0xffb352 : 0x58dc91,  // DM orange, Player green
            roughness: 0.6,
            metalness: 0.2,
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.position.y = 0.9;  // Offset so bottom is on ground
        mesh.userData.isFallbackCube = true;
        avatarRoot.add(mesh);
        
        // Label above head
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = player.role === 'dm' ? '#ffb352' : '#58dc91';
        ctx.font = 'bold 48px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(player.role === 'dm' ? 'DM' : 'Player', 128, 64);
        
        const texture = new THREE.CanvasTexture(canvas);
        const labelGeometry = new THREE.PlaneGeometry(0.8, 0.4);
        const labelMaterial = new THREE.MeshBasicMaterial({ map: texture, transparent: true });
        const label = new THREE.Mesh(labelGeometry, labelMaterial);
        label.position.y = 2.2;
        label.lookAt(0, 0, 0);  // Face player initially
        avatarRoot.add(label);
        label.userData.label = true;
        
        scene.add(avatarRoot);
        if (window.__NET_DEBUG__) {
            console.log('[AVATAR CREATED]', avatarRoot);
        }
        if (window.__NET_DEBUG__) {
            const debugMesh = new THREE.Mesh(
                new THREE.BoxGeometry(1, 2, 1),
                new THREE.MeshBasicMaterial({ color: 0xff0000, wireframe: true })
            );
            debugMesh.position.y = 1.0;
            debugMesh.userData.isAvatarDebugProbe = true;
            avatarRoot.add(debugMesh);
        }
        
        // Store in scene userData
        if (!scene.userData.playerAvatars) scene.userData.playerAvatars = {};
        scene.userData.playerAvatars[player.id] = avatarRoot;
        if (window.__NET_DEBUG__) {
            console.log(`[AVATAR] Created fallback cube for ${player.id}`, { avatarCount: Object.keys(scene.userData.playerAvatars).length });
        }

        if (player.avatar && player.avatar.modelUrl && player.avatar.modelUrl !== 'fallback') {
            ensureRemoteAvatarModelLoaded(avatarRoot, player.avatar.modelUrl, player.avatar.scale);
        }
    }

    avatarRoot.userData.playerId = player.id;
    avatarRoot.userData.playerRole = player.role;
    avatarRoot.userData.networkId = String(player.networkId || player.actorId || player.id || avatarRoot.userData.networkId || '').trim() || player.id;
    avatarRoot.userData.actorId = String(player.actorId || player.networkId || player.id || avatarRoot.userData.actorId || '').trim() || player.id;
    avatarRoot.userData.playerLabel = String(player.actorId || player.id || avatarRoot.userData.playerLabel || 'Player');
    const combatSyncPlayer = player.combatSync && typeof player.combatSync.player === 'object'
        ? player.combatSync.player
        : null;
    const combatSyncHp = Number(combatSyncPlayer?.hp ?? combatSyncPlayer?.currentHp ?? combatSyncPlayer?.current_hp);
    if (Number.isFinite(combatSyncHp)) {
        avatarRoot.userData.hp = Math.max(0, combatSyncHp);
    }
    const combatSyncMaxHp = Number(combatSyncPlayer?.maxHp ?? combatSyncPlayer?.max_hp);
    if (Number.isFinite(combatSyncMaxHp)) {
        avatarRoot.userData.maxHp = Math.max(1, combatSyncMaxHp);
    }
    
    // Update position if available
    if (player.position) {
        avatarRoot.position.set(
            Number(player.position.x) || 0,
            Number(player.position.y) || 0,
            Number(player.position.z) || 0
        );
    }

    if (!avatarRoot.userData) avatarRoot.userData = {};
    const playerMaxHp = Number(player.maxHp ?? player.max_hp);
    if (Number.isFinite(playerMaxHp)) {
        avatarRoot.userData.maxHp = Math.max(1, playerMaxHp);
    } else if (!Number.isFinite(Number(avatarRoot.userData.maxHp))) {
        const fallbackHpForMax = Number(player.hp ?? player.currentHp ?? player.current_hp);
        avatarRoot.userData.maxHp = Number.isFinite(fallbackHpForMax) && fallbackHpForMax > 0
            ? Math.max(1, fallbackHpForMax)
            : 100;
    }
    const playerHp = Number(player.hp ?? player.currentHp ?? player.current_hp);
    if (Number.isFinite(playerHp)) {
        avatarRoot.userData.hp = Math.max(0, Math.min(avatarRoot.userData.maxHp, playerHp));
    } else if (!Number.isFinite(Number(avatarRoot.userData.hp))) {
        avatarRoot.userData.hp = avatarRoot.userData.maxHp;
    }
    
    // Update rotation if available
    if (player.rotation) {
        avatarRoot.rotation.set(0, (Number(player.rotation.y) || 0) + NETWORK_AVATAR_YAW_OFFSET, 0);
    }

    avatarRoot.visible = true;
    avatarRoot.traverse((child) => {
        if (child && typeof child.visible === 'boolean') child.visible = true;
    });
    if (!avatarRoot.parent) {
        scene.add(avatarRoot);
        if (window.__NET_DEBUG__) {
            console.warn(`[AVATAR] Re-attached detached avatar root for ${player.id}`);
        }
    }

    updateRemoteMovementVisual(player.id, avatarRoot, player.movementPreview || null);
}

function ensureRemoteAvatarModelLoaded(avatarRoot, modelUrl, scale = 1) {
    if (!avatarRoot || !modelUrl || modelUrl === 'fallback') return;
    if (!avatarRoot.userData) avatarRoot.userData = {};
    if (avatarRoot.userData.remoteModelUrl === modelUrl && avatarRoot.userData.remoteAvatarModel) {
        const nextScale = Number(scale);
        if (Number.isFinite(nextScale) && nextScale > 0) {
            avatarRoot.userData.remoteAvatarModel.scale.setScalar(nextScale);
        }
        return;
    }
    if (avatarRoot.userData.remoteModelLoadingUrl === modelUrl) return;

    avatarRoot.userData.remoteModelLoadingUrl = modelUrl;
    if (window.__NET_DEBUG__) {
        console.log(`[AVATAR] Loading remote GLTF for ${avatarRoot.userData && avatarRoot.userData.playerId ? avatarRoot.userData.playerId : 'unknown'}: ${modelUrl}`);
    }
    remoteAvatarLoader.load(
        modelUrl,
        (gltf) => {
            if (avatarRoot.userData.remoteModelLoadingUrl !== modelUrl) return;

            const modelRoot = gltf.scene || (gltf.scenes && gltf.scenes[0]);
            if (!modelRoot) {
                avatarRoot.userData.remoteModelLoadingUrl = null;
                return;
            }

            normalizeAvatarModel(modelRoot);
            markAvatarUnselectable(modelRoot);

            avatarRoot.children
                .filter((child) => child && child.userData && (child.userData.isFallbackCube || child.userData.label || child.userData.isRemoteAvatarModel))
                .forEach((child) => {
                    avatarRoot.remove(child);
                });

            modelRoot.userData.isRemoteAvatarModel = true;
            const nextScale = Number(scale);
            if (Number.isFinite(nextScale) && nextScale > 0) {
                modelRoot.scale.multiplyScalar(nextScale);
            }
            avatarRoot.add(modelRoot);
            avatarRoot.userData.remoteAvatarModel = modelRoot;
            avatarRoot.userData.remoteModelUrl = modelUrl;
            avatarRoot.userData.remoteModelLoadingUrl = null;
            if (window.__NET_DEBUG__) {
                console.log(`[AVATAR] GLTF attached for ${avatarRoot.userData && avatarRoot.userData.playerId ? avatarRoot.userData.playerId : 'unknown'}`, {
                    modelUrl,
                    scale: Number.isFinite(nextScale) && nextScale > 0 ? nextScale : 1,
                    parentInScene: !!avatarRoot.parent,
                });
            }
        },
        undefined,
        (error) => {
            if (avatarRoot.userData) avatarRoot.userData.remoteModelLoadingUrl = null;
            console.warn(`[AVATAR] Failed remote GLTF load for ${avatarRoot.userData && avatarRoot.userData.playerId ? avatarRoot.userData.playerId : 'unknown'}: ${modelUrl}`, error);
        }
    );
}

function isDescendantOf(node, ancestor) {
    let cursor = node;
    while (cursor) {
        if (cursor === ancestor) return true;
        cursor = cursor.parent;
    }
    return false;
}

function markAvatarUnselectable(root) {
    if (!root) return;
    if (!root.userData) root.userData = {};
    root.userData.unselectable = true;
}

function ensureRemoteMovementVisual(playerId) {
    if (!playerId) return null;
    if (!scene.userData.remoteMovementVisuals) {
        scene.userData.remoteMovementVisuals = {};
    }

    let entry = scene.userData.remoteMovementVisuals[playerId];
    if (entry) return entry;

    const zoneGroup = new THREE.Group();
    zoneGroup.name = `remote_move_zone_${playerId}`;
    markAvatarUnselectable(zoneGroup);

    const zoneDisc = new THREE.Mesh(
        new THREE.CircleGeometry(1, 72),
        new THREE.MeshBasicMaterial({
            color: 0x00e8ff,
            transparent: true,
            opacity: 0.13,
            side: THREE.DoubleSide,
            depthWrite: false,
        })
    );
    zoneDisc.rotation.x = -Math.PI / 2;
    zoneDisc.renderOrder = 20;
    zoneDisc.userData.unselectable = true;
    zoneGroup.add(zoneDisc);

    const zoneRing = new THREE.Mesh(
        new THREE.RingGeometry(0.97, 1.0, 72),
        new THREE.MeshBasicMaterial({
            color: 0x00e8ff,
            transparent: true,
            opacity: 0.55,
            side: THREE.DoubleSide,
            depthWrite: false,
        })
    );
    zoneRing.rotation.x = -Math.PI / 2;
    zoneRing.position.y = 0.005;
    zoneRing.renderOrder = 21;
    zoneRing.userData.unselectable = true;
    zoneGroup.add(zoneRing);

    const cursor = new THREE.Mesh(
        new THREE.RingGeometry(0.18, 0.42, 32),
        new THREE.MeshBasicMaterial({
            color: 0x00ffcc,
            transparent: true,
            opacity: 0.88,
            side: THREE.DoubleSide,
            depthWrite: false,
        })
    );
    cursor.rotation.x = -Math.PI / 2;
    cursor.renderOrder = 25;
    cursor.visible = false;
    cursor.userData.unselectable = true;
    scene.add(cursor);

    const lineGeom = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0, 0),
    ]);
    const pathLine = new THREE.Line(
        lineGeom,
        new THREE.LineBasicMaterial({
            color: 0x00ffcc,
            transparent: true,
            opacity: 0.6,
            depthWrite: false,
        })
    );
    pathLine.renderOrder = 24;
    pathLine.visible = false;
    pathLine.userData.unselectable = true;
    scene.add(pathLine);

    zoneGroup.visible = false;
    scene.add(zoneGroup);

    entry = { zoneGroup, zoneDisc, zoneRing, cursor, pathLine };
    scene.userData.remoteMovementVisuals[playerId] = entry;
    return entry;
}

function removeRemoteMovementVisual(playerId) {
    if (!playerId || !scene.userData.remoteMovementVisuals) return;
    const entry = scene.userData.remoteMovementVisuals[playerId];
    if (!entry) return;

    if (entry.zoneGroup && entry.zoneGroup.parent) entry.zoneGroup.parent.remove(entry.zoneGroup);
    if (entry.cursor && entry.cursor.parent) entry.cursor.parent.remove(entry.cursor);
    if (entry.pathLine && entry.pathLine.parent) entry.pathLine.parent.remove(entry.pathLine);

    if (entry.zoneDisc?.geometry) entry.zoneDisc.geometry.dispose();
    if (entry.zoneDisc?.material) entry.zoneDisc.material.dispose();
    if (entry.zoneRing?.geometry) entry.zoneRing.geometry.dispose();
    if (entry.zoneRing?.material) entry.zoneRing.material.dispose();
    if (entry.cursor?.geometry) entry.cursor.geometry.dispose();
    if (entry.cursor?.material) entry.cursor.material.dispose();
    if (entry.pathLine?.geometry) entry.pathLine.geometry.dispose();
    if (entry.pathLine?.material) entry.pathLine.material.dispose();

    delete scene.userData.remoteMovementVisuals[playerId];
}

function updateRemoteMovementVisual(playerId, avatarRoot, movementPreview) {
    if (!playerId || !avatarRoot) return;
    const entry = ensureRemoteMovementVisual(playerId);
    if (!entry) return;

    const hasPreview = movementPreview && typeof movementPreview === 'object' && movementPreview.showZone === true;
    if (!hasPreview) {
        entry.zoneGroup.visible = false;
        entry.cursor.visible = false;
        entry.pathLine.visible = false;
        return;
    }

    const moveFeet = Math.max(0, Number(movementPreview.movementRemaining) || 0);
    const radiusUnits = Math.max(0.01, feetToUnits(moveFeet));

    entry.zoneGroup.visible = true;
    entry.zoneGroup.position.set(avatarRoot.position.x, avatarRoot.position.y + 0.025, avatarRoot.position.z);
    entry.zoneDisc.scale.set(radiusUnits, radiusUnits, 1);
    entry.zoneRing.scale.set(radiusUnits, radiusUnits, 1);

    const cursor = movementPreview.cursor;
    const hasCursor = cursor && Number.isFinite(cursor.x) && Number.isFinite(cursor.y) && Number.isFinite(cursor.z);
    if (!hasCursor) {
        entry.cursor.visible = false;
        entry.pathLine.visible = false;
        return;
    }

    entry.cursor.visible = true;
    entry.cursor.position.set(Number(cursor.x), Number(cursor.y) + 0.03, Number(cursor.z));

    entry.pathLine.visible = true;
    entry.pathLine.geometry.setFromPoints([
        new THREE.Vector3(avatarRoot.position.x, avatarRoot.position.y + 0.04, avatarRoot.position.z),
        new THREE.Vector3(Number(cursor.x), Number(cursor.y) + 0.04, Number(cursor.z)),
    ]);
}

function removeLocalPlayerAvatar() {
    if (localPlayerAvatarRigState && typeof localPlayerAvatarRigState.dispose === 'function') {
        localPlayerAvatarRigState.dispose();
    }
    localPlayerAvatarRigState = null;
    if (localPlayerHammerProp) {
        if (localPlayerHammerProp.parent) localPlayerHammerProp.parent.remove(localPlayerHammerProp);
        localPlayerHammerProp = null;
    }
    localPlayerHammerHandBone = null;
    localPlayerHammerBackBone = null;
    localPlayerHammerBackAnchor = null;
    if (!localPlayerAvatarRoot) return;
    if (selectedObject && isDescendantOf(selectedObject, localPlayerAvatarRoot)) {
        selectObject(null);
    }
    if (localPlayerAvatarRoot.parent) {
        localPlayerAvatarRoot.parent.remove(localPlayerAvatarRoot);
    }
    localPlayerAvatarRoot = null;
}

function buildFallbackLocalAvatar(auraHex = '#7f6bff') {
    const root = new THREE.Group();
    root.name = 'local_player_avatar';

    const auraColor = new THREE.Color(auraHex);
    const bodyMat = new THREE.MeshStandardMaterial({
        color: auraColor.clone().offsetHSL(0, -0.08, -0.05),
        roughness: 0.62,
        metalness: 0.08,
        emissive: auraColor.clone().multiplyScalar(0.09),
    });
    const headMat = new THREE.MeshStandardMaterial({
        color: 0xe7ccb2,
        roughness: 0.7,
        metalness: 0.02,
    });

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.6, 6, 12), bodyMat);
    torso.position.y = 1.0;
    root.add(torso);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 20, 18), headMat);
    head.position.y = 1.55;
    root.add(head);

    const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.55, 0.02, 10, 42),
        new THREE.MeshBasicMaterial({ color: auraColor, transparent: true, opacity: 0.65 })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.08;
    root.add(ring);

    return root;
}

function normalizeAvatarModel(modelRoot) {
    modelRoot.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(modelRoot);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const targetHeight = 1.85;
    const safeHeight = Math.max(size.y, 0.001);
    const scale = targetHeight / safeHeight;
    modelRoot.scale.setScalar(scale);
    modelRoot.updateMatrixWorld(true);

    const scaledBox = new THREE.Box3().setFromObject(modelRoot);
    const scaledCenter = scaledBox.getCenter(new THREE.Vector3());
    const minY = scaledBox.min.y;

    modelRoot.position.x += -scaledCenter.x;
    modelRoot.position.y += -minY + 0.02;
    modelRoot.position.z += -scaledCenter.z;
}

function attachAvatarToPlayerRig(avatarRoot) {
    if (!playerRig) return;
    removeLocalPlayerAvatar();
    localPlayerAvatarRoot = avatarRoot;
    markAvatarUnselectable(localPlayerAvatarRoot);
    // Keep avatar as a visible in-world representation of the player near the rig origin.
    // Rotate avatar model by 180 degrees relative to rig heading.
    localPlayerAvatarRoot.position.set(0, LOCAL_AVATAR_BASE_Y, 0);
    localPlayerAvatarRoot.rotation.y = Math.PI;
    localPlayerAvatarRoot.rotation.x = 0;
    localPlayerHammerBackAnchor = new THREE.Group();
    localPlayerHammerBackAnchor.name = 'local_player_hammer_back_anchor';
    // Fallback holster anchor when no usable spine/chest bone exists.
    localPlayerHammerBackAnchor.position.set(0.18, 2.02, -0.12);
    localPlayerHammerBackAnchor.rotation.set(0.08, Math.PI * 0.22, -Math.PI * 0.18);
    localPlayerAvatarRoot.add(localPlayerHammerBackAnchor);
    playerRig.add(localPlayerAvatarRoot);
    if (selectedObject && isDescendantOf(selectedObject, localPlayerAvatarRoot)) {
        selectObject(null);
    }
}

function setLocalHammerHolstered(holstered) {
    if (!localPlayerHammerProp) return;

    if (holstered) {
        const holsterParent = localPlayerHammerBackBone || localPlayerHammerBackAnchor;
        if (!holsterParent) return;
        if (localPlayerHammerProp.parent !== holsterParent) {
            if (localPlayerHammerProp.parent) {
                localPlayerHammerProp.parent.remove(localPlayerHammerProp);
            }
            holsterParent.add(localPlayerHammerProp);
        }
        if (localPlayerHammerBackBone) {
            // Bone-space placement for rigged avatars.
            localPlayerHammerProp.position.set(0, 0, 0);
            localPlayerHammerProp.rotation.set(0, 0, 0);
            localPlayerHammerProp.position.set(-2.5, -4.5, -2);
            localPlayerHammerProp.rotation.set(0, Math.PI, Math.PI / 4);
        } else {
            // Fallback anchor placement for procedural/simple avatars.
            localPlayerHammerProp.position.set(0.30, -1.45, -0.38);
            localPlayerHammerProp.rotation.set(0.18, Math.PI * 0.88, -Math.PI * 0.56);
        }
        localPlayerHammerProp.visible = true;
        return;
    }

    if (!localPlayerHammerHandBone) return;
    if (localPlayerHammerProp.parent !== localPlayerHammerHandBone) {
        if (localPlayerHammerProp.parent) {
            localPlayerHammerProp.parent.remove(localPlayerHammerProp);
        }
        localPlayerHammerHandBone.add(localPlayerHammerProp);
    }
    localPlayerHammerProp.position.set(0, 0.12, 0);
    localPlayerHammerProp.rotation.set(0, 0, 0);
    localPlayerHammerProp.visible = true;
}

function findRigBackBone(modelRoot) {
    if (!modelRoot) return null;
    let best = null;
    let bestScore = -Infinity;
    const boneNamePattern = /(upperchest|chest|spine[0-9_]*|torso|ribcage)/i;

    modelRoot.traverse((obj) => {
        if (!obj || !obj.isBone) return;
        const name = String(obj.name || '');
        if (!boneNamePattern.test(name)) return;

        let score = 0;
        if (/upperchest/i.test(name)) score += 8;
        if (/chest/i.test(name)) score += 6;
        if (/spine2|spine_2|spine03|spine3/i.test(name)) score += 4;
        if (/spine/i.test(name)) score += 2;
        score += obj.children ? Math.min(obj.children.length, 6) * 0.4 : 0;

        if (score > bestScore) {
            bestScore = score;
            best = obj;
        }
    });

    return best;
}

async function initLocalAvatarFromProfile() {
    // DM is a pure observer — no local avatar in the world.
    if (modeManager.current === MODE.DM) return;
    if (!playerRig) return;

    let profile = null;
    try {
        profile = JSON.parse(localStorage.getItem('character_profile_v1') || 'null');
    } catch (_err) {
        profile = null;
    }

    const aura = profile && typeof profile.aura === 'string' ? profile.aura : '#7f6bff';
    const modelUrl = profile && typeof profile.modelUrl === 'string' ? profile.modelUrl : null;
    const rigSettings = sanitizeStoredRigSettings(profile && profile.rigSettings ? profile.rigSettings : null);

    if (!modelUrl) {
        const fallbackRoot = buildFallbackLocalAvatar(aura);
        fallbackRoot.userData.modelUrl = 'fallback';
        attachAvatarToPlayerRig(fallbackRoot);
        return;
    }

    await new Promise((resolve) => {
        localAvatarLoader.load(
            modelUrl,
            (gltf) => {
                const modelRoot = gltf.scene || (gltf.scenes && gltf.scenes[0]);
                if (!modelRoot) {
                    attachAvatarToPlayerRig(buildFallbackLocalAvatar(aura));
                    resolve();
                    return;
                }
                normalizeAvatarModel(modelRoot);
                modelRoot.userData.modelUrl = modelUrl;
                attachAvatarToPlayerRig(modelRoot);
                localPlayerAvatarRigState = applyStoredAvatarRig(modelRoot, rigSettings);
                // Attach hammer.glb to right hand bone if present
                const hammerLoader = new GLTFLoader();
                const handBone = findRigHandBone(modelRoot, rigSettings);
                const backBone = findRigBackBone(modelRoot);
                localPlayerHammerHandBone = handBone || null;
                localPlayerHammerBackBone = backBone || null;
                hammerLoader.load('/static/hammer.glb', (gltf) => {
                    const hammerRoot = gltf.scene || (gltf.scenes && gltf.scenes[0]);
                    if (!hammerRoot) return;
                    hammerRoot.scale.setScalar(2.2);
                    localPlayerHammerProp = hammerRoot;
                    setLocalHammerHolstered(true);
                });
                resolve();
            },
            undefined,
            (_error) => {
                const fallbackRoot = buildFallbackLocalAvatar(aura);
                fallbackRoot.userData.modelUrl = 'fallback';
                attachAvatarToPlayerRig(fallbackRoot);
                resolve();
            }
        );
    });
}

function removePlayerAvatar(playerId) {
    if (!playerId || !scene.userData.playerAvatars) return;
    
    const avatarRoot = scene.userData.playerAvatars[playerId];
    if (avatarRoot && avatarRoot.parent) {
        // Dispose geometries and materials
        avatarRoot.traverse((child) => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                if (Array.isArray(child.material)) {
                    child.material.forEach(m => {
                        if (m.map) m.map.dispose();
                        m.dispose();
                    });
                } else {
                    if (child.material.map) child.material.map.dispose();
                    child.material.dispose();
                }
            }
        });
        
        scene.remove(avatarRoot);
    }
    
    delete scene.userData.playerAvatars[playerId];
    if (scene.userData.playerAvatarStates) {
        delete scene.userData.playerAvatarStates[playerId];
    }
    removeRemoteMovementVisual(playerId);
    removePlayerHeadHealthBar(`remote-${playerId}`);
}

function isMeshSelectable(obj) {
    let node = obj;
    while (node) {
        if (node.userData && node.userData.unselectable) return false;
        node = node.parent;
    }
    return true;
}

function resolveSelectableTarget(obj) {
    let node = obj;
    while (node) {
        if (node.userData && node.userData.selectTarget) {
            return node.userData.selectTarget;
        }
        node = node.parent;
    }
    return obj;
}

function createPointLightFromCamera() {
    const viewCam = getActiveViewCamera();
    viewCam.getWorldPosition(lightSpawnPos);
    viewCam.getWorldDirection(lightSpawnDir);
    lightSpawnPos.addScaledVector(lightSpawnDir, 2.0);

    const light = createUserPointLight({
        name: `user_light_${userLightIdCounter++}`,
        color: 0xfff2c8,
        intensity: 1.5,
        distance: 35,
        decay: 2.0,
        position: { x: lightSpawnPos.x, y: lightSpawnPos.y, z: lightSpawnPos.z }
    });
    scene.add(light);
    selectObject(light);
}

function attachPointLightHandle(light) {
    const oldHandle = light.getObjectByName('point_light_handle');
    if (oldHandle) light.remove(oldHandle);

    // Selectable mesh handle for picking and visual feedback.
    const handleMat = new THREE.MeshStandardMaterial({
        color: 0xffd26a,
        emissive: 0xff9f1a,
        emissiveIntensity: 0.8,
        roughness: 0.35,
        metalness: 0.15
    });
    const handle = new THREE.Mesh(new THREE.SphereGeometry(0.06, 14, 14), handleMat);
    handle.name = 'point_light_handle';
    handle.userData.selectTarget = light;
    handle.castShadow = false;
    handle.receiveShadow = false;
    handle.visible = light.userData.showHandle !== false;
    light.add(handle);
}

function setPointLightHandleVisible(light, visible) {
    if (!light || !light.isPointLight) return;
    light.userData.showHandle = !!visible;
    const handle = light.getObjectByName('point_light_handle');
    if (handle) handle.visible = !!visible;
}

function getMaterialTextureAnim(mat) {
    const anim = mat && mat.userData && mat.userData.textureAnim ? mat.userData.textureAnim : {};
    return {
        x: typeof anim.x === 'number' ? anim.x : 0,
        y: typeof anim.y === 'number' ? anim.y : 0,
        z: typeof anim.z === 'number' ? anim.z : 0,
    };
}

function setMaterialTextureAnimAxis(mat, axis, value) {
    if (!mat) return;
    if (!mat.userData) mat.userData = {};
    const prev = getMaterialTextureAnim(mat);
    prev[axis] = Number(value) || 0;
    mat.userData.textureAnim = prev;
}

// Cache for animatable materials to avoid scene traversal every frame
let animatableMaterialsCache = [];
let animatableMaterialsCacheTime = 0;
const ANIMATABLE_CACHE_REBUILD_MS = 5000; // Rebuild cache every 5 seconds

function rebuildAnimatableMaterialsCache() {
    animatableMaterialsCache = [];
    scene.traverse((obj) => {
        if (!obj.isMesh || !obj.material) return;
        if (Array.isArray(obj.material)) {
            obj.material.forEach((m) => {
                const anim = getMaterialTextureAnim(m);
                if (anim.x || anim.y || anim.z) {
                    animatableMaterialsCache.push({ material: m, anim });
                }
            });
        } else {
            const anim = getMaterialTextureAnim(obj.material);
            if (anim.x || anim.y || anim.z) {
                animatableMaterialsCache.push({ material: obj.material, anim });
            }
        }
    });
    animatableMaterialsCacheTime = performance.now();
}

function animateMaterialTexture(matEntry, delta) {
    if (!matEntry || !matEntry.material || !matEntry.material.map) return;
    const mat = matEntry.material;
    const anim = matEntry.anim;
    if (!anim.x && !anim.y && !anim.z) return;

    mat.map.wrapS = THREE.RepeatWrapping;
    mat.map.wrapT = THREE.RepeatWrapping;
    mat.map.offset.x += anim.x * delta;
    mat.map.offset.y += anim.y * delta;
    mat.map.rotation += anim.z * delta;
    mat.map.needsUpdate = true;
}

function animateSceneTextures(delta) {
    const now = performance.now();
    if (now - animatableMaterialsCacheTime > ANIMATABLE_CACHE_REBUILD_MS) {
        rebuildAnimatableMaterialsCache();
    }
    // Only iterate over cached animatable materials instead of entire scene
    for (let i = 0; i < animatableMaterialsCache.length; i++) {
        animateMaterialTexture(animatableMaterialsCache[i], delta);
    }
}

// ========== D&D Range Visualization Helpers ==========

// Create a range circle at a given position
function createRangeCircle(centerPos, radiusInFeet, color = 0xff0000, opacity = 0.3) {
    const radiusInUnits = feetToUnits(radiusInFeet);
    const geometry = new THREE.RingGeometry(radiusInUnits * 0.95, radiusInUnits * 1.05, 64);
    const material = new THREE.MeshBasicMaterial({ 
        color: color, 
        transparent: true,
        opacity: opacity,
        side: THREE.DoubleSide
    });
    const ring = new THREE.Mesh(geometry, material);
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(centerPos);
    ring.position.y += 0.05; // Slightly above ground to avoid z-fighting
    return ring;
}

// Create a filled circle for movement radius
function createMovementRadius(centerPos, radiusInFeet, color = 0x0000ff, opacity = 0.15) {
    const radiusInUnits = feetToUnits(radiusInFeet);
    const geometry = new THREE.CircleGeometry(radiusInUnits, 64);
    const material = new THREE.MeshBasicMaterial({ 
        color: color, 
        transparent: true,
        opacity: opacity,
        side: THREE.DoubleSide
    });
    const circle = new THREE.Mesh(geometry, material);
    circle.rotation.x = -Math.PI / 2;
    circle.position.copy(centerPos);
    circle.position.y += 0.02;
    return circle;
}

// Create a line from entity to target (aim/targeting line)
function createTargetingLine(fromPos, toPos, color = 0x00ff00, lineWidth = 2, options = {}) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(
        new Float32Array([
            fromPos.x, fromPos.y, fromPos.z,
            toPos.x, toPos.y, toPos.z
        ]), 3
    ));
    const material = new THREE.LineBasicMaterial({ 
        color: color,
        linewidth: lineWidth,
        transparent: true,
        opacity: 0.7
    });
    if (options && options.alwaysOnTop) {
        material.depthTest = false;
        material.depthWrite = false;
        material.toneMapped = false;
        material.opacity = typeof options.opacity === 'number' ? options.opacity : 0.96;
    }
    const line = new THREE.Line(geometry, material);
    if (options && options.alwaysOnTop) {
        line.renderOrder = 10000;
    }
    return line;
}

// Create a grid plane visualization (optional overlay)
function createGridPlane(width = 100, height = 100, gridSize = 5, color = 0x888888, opacity = 0.1) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    
    ctx.fillStyle = `rgba(255, 255, 255, 1)`;
    ctx.fillRect(0, 0, width, height);
    
    ctx.strokeStyle = `rgba(136, 136, 136, 0.3)`;
    ctx.lineWidth = 1;
    
    for (let i = 0; i <= width; i += gridSize) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, height);
        ctx.stroke();
    }
    for (let j = 0; j <= height; j += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, j);
        ctx.lineTo(width, j);
        ctx.stroke();
    }
    
    const texture = new THREE.CanvasTexture(canvas);
    const geometry = new THREE.PlaneGeometry(width / gridSize, height / gridSize);
    const material = new THREE.MeshBasicMaterial({ 
        map: texture,
        transparent: true,
        opacity: opacity,
        side: THREE.DoubleSide
    });
    const plane = new THREE.Mesh(geometry, material);
    plane.rotation.x = -Math.PI / 2;
    return plane;
}

// ============================================

function createUserPointLight(state) {
    const light = new THREE.PointLight(
        state.color ?? 0xfff2c8,
        typeof state.intensity === 'number' ? state.intensity : 1.5,
        typeof state.distance === 'number' ? state.distance : 35,
        typeof state.decay === 'number' ? state.decay : 2.0
    );
    light.name = state.name || `user_light_${userLightIdCounter++}`;
    light.userData.isUserLight = true;
    light.userData.showHandle = state.showHandle !== false;
    light.castShadow = true;
    light.shadow.mapSize.width = 1024;
    light.shadow.mapSize.height = 1024;
    if (state.position) {
        light.position.set(
            Number(state.position.x) || 0,
            Number(state.position.y) || 0,
            Number(state.position.z) || 0
        );
    }
    attachPointLightHandle(light);
    return light;
}

function serializeLight(light) {
    if (!light || !light.isPointLight || !light.userData.isUserLight) return null;
    return {
        name: light.name,
        color: light.color ? light.color.getHex() : 0xfff2c8,
        intensity: light.intensity,
        distance: light.distance,
        decay: light.decay,
        position: { x: light.position.x, y: light.position.y, z: light.position.z },
        showHandle: light.userData.showHandle !== false
    };
}

function applyStateToLight(light, state) {
    if (!light || !state) return;
    if (typeof state.color === 'number') light.color.setHex(state.color);
    if (typeof state.intensity === 'number') light.intensity = state.intensity;
    if (typeof state.distance === 'number') light.distance = state.distance;
    if (typeof state.decay === 'number') light.decay = state.decay;
    if (state.position) {
        light.position.set(
            Number(state.position.x) || 0,
            Number(state.position.y) || 0,
            Number(state.position.z) || 0
        );
    }
    setPointLightHandleVisible(light, state.showHandle !== false);
    attachPointLightHandle(light);
}

function refreshSelectableMeshCache(force = false) {
    const now = performance.now();
    if (!force && now < selectableMeshCacheNextRefreshAt) {
        return;
    }
    selectableMeshes.length = 0;
    scene.traverse((obj) => {
        if (obj.isMesh && isMeshSelectable(obj)) {
            selectableMeshes.push(obj);
        }
    });
    // Refresh every ~350ms to reduce click-path work while still tracking scene changes.
    selectableMeshCacheNextRefreshAt = now + 350;
}

const GOD_ACTIONS = Object.freeze({
    LOOK: 'look',
    SELECT: 'select',
    CONTEXT: 'context',
    MOVE: 'move',
    CANCEL: 'cancel',
});

function getActiveTargetablesForInteraction() {
    return trainingDummies.filter((dummy) => (
        dummy &&
        dummy.parent &&
        dummy.userData &&
        dummy.userData.isTargetable &&
        (dummy.userData.hp || 0) > 0
    ));
}

function projectWorldPointToScreen(worldPoint) {
    if (!renderer || !renderer.domElement || !worldPoint) return null;
    const projected = worldPoint.clone().project(getActiveViewCamera());
    return {
        x: (projected.x * 0.5 + 0.5) * renderer.domElement.clientWidth,
        y: (-projected.y * 0.5 + 0.5) * renderer.domElement.clientHeight,
    };
}

function getInteractionHit(input = {}) {
    const source = input.source || 'mouse';
    let tool = raycaster;

    if (source === 'xr') {
        const controller = input.controller || null;
        if (!controller) return null;
        controller.updateMatrixWorld(true);
        xrRayOrigin.setFromMatrixPosition(controller.matrixWorld);
        xrRayRotation.identity().extractRotation(controller.matrixWorld);
        xrRayDirection.set(0, 0, -1).applyMatrix4(xrRayRotation).normalize();
        xrRaycaster.set(xrRayOrigin, xrRayDirection);
        tool = xrRaycaster;
    } else {
        if (!rendererReady || !input.mouseEvent) return null;
        if (combatCameraActive || isDmFreeCamera() || isDmObserverMode()) {
            const rect = renderer.domElement.getBoundingClientRect();
            mouse.x = ((input.mouseEvent.clientX - rect.left) / rect.width) * 2 - 1;
            mouse.y = -((input.mouseEvent.clientY - rect.top) / rect.height) * 2 + 1;
        } else {
            mouse.x = 0;
            mouse.y = 0;
        }
        tool.setFromCamera(mouse, getActiveViewCamera());
    }

    const targetables = getActiveTargetablesForInteraction();
    const targetHit = targetables.length > 0 ? tool.intersectObjects(targetables, false)[0] : null;
    const moveHit = moveZoneDisc && combatCameraActive ? tool.intersectObject(moveZoneDisc, false)[0] : null;

    let selectableHit = null;
    if (source !== 'xr' && hasModePermission('tools.selection')) {
        refreshSelectableMeshCache();
        const intersects = tool.intersectObjects(selectableMeshes, false);
        selectableHit = intersects.length > 0 ? getFirstSelectableHit(intersects) : null;
    }

    let screenX = null;
    let screenY = null;
    if (source === 'mouse' && input.mouseEvent) {
        screenX = input.mouseEvent.clientX;
        screenY = input.mouseEvent.clientY;
    } else if (targetHit && targetHit.point) {
        const projected = projectWorldPointToScreen(targetHit.point);
        if (projected) {
            screenX = projected.x;
            screenY = projected.y;
        }
    }

    return {
        source,
        targetHit,
        moveHit,
        selectableHit,
        screenX,
        screenY,
    };
}

function handleGodLook(payload = {}) {
    const source = payload.source || 'mouse';
    if (source === 'mouse') {
        if (!isDmFreeCamera()) return;
        const phase = payload.phase || 'move';
        if (phase === 'start') {
            const event = payload.mouseEvent;
            if (!event) return;
            dmRightDragActive = true;
            dmRightDragLastX = event.clientX;
            dmRightDragLastY = event.clientY;
            return;
        }
        if (phase === 'end') {
            dmRightDragActive = false;
            return;
        }
        if (phase === 'move' && dmCamera && dmRightDragActive) {
            const event = payload.mouseEvent;
            if (!event) return;
            const dx = event.clientX - dmRightDragLastX;
            const dy = event.clientY - dmRightDragLastY;
            dmRightDragLastX = event.clientX;
            dmRightDragLastY = event.clientY;
            dmCamera.rotation.order = 'YXZ';
            dmCamera.rotation.y -= dx * lookSpeed;
            dmCamera.rotation.x = Math.max(-1.45, Math.min(1.45, dmCamera.rotation.x - (dy * lookSpeed)));
        }
        return;
    }

    if (source === 'xr' && isDmFreeCamera() && dmCamera) {
        const deltaYaw = Number(payload.deltaYaw) || 0;
        const deltaPitch = Number(payload.deltaPitch) || 0;
        dmCamera.rotation.order = 'YXZ';
        dmCamera.rotation.y -= deltaYaw;
        dmCamera.rotation.x = Math.max(-1.45, Math.min(1.45, dmCamera.rotation.x - deltaPitch));
    }
}

function handleGodSelect(payload = {}) {
    if (!rendererReady) return;
    if (consoleState.open) return;
    if (isInputLockedForCombat('ACTION')) return;

    const source = payload.source || 'mouse';
    const event = payload.mouseEvent || null;
    if (source === 'mouse') {
        const inWorldMenu = event && event.target && typeof event.target.closest === 'function'
            ? !!event.target.closest('#god-world-menu')
            : false;
        if (!inWorldMenu) hideGodWorldMenu();

        const uiMenus = [inspectorMenu];
        let el = event ? event.target : null;
        while (el) {
            if (uiMenus.includes(el) || el.tagName === 'INPUT' || el.tagName === 'BUTTON') return;
            el = el.parentElement;
        }

        if (combatInteraction.awaitingConfirm) return;
        if (isGrabbing && selectedObject) {
            finishGrabPlacement(true);
            return;
        }
    }

    const hit = getInteractionHit(payload);
    if (!hit) return;

    if (isDmFreeCamera()) {
        if (hit.targetHit && hit.targetHit.object) {
            const actor = hit.targetHit.object;
            if (actor === playerState || actor === playerRig) {
                setSelectedCombatTarget(playerState);
                dmQuickMenuArmedByLeftClick = true;
                const label = getCombatActorLabel(playerState);
                addDmEvent(`Selected ${label}`, 'system');
                showFloatingText('Player selected: quick actions ready', '#9ec9ff', true, { anchorObject: playerRig || playerState });
            } else {
                setSelectedCombatTarget(actor);
                dmQuickMenuArmedByLeftClick = false;
                hideGodContextMenu();
                const label = actor.userData?.name || actor.userData?.actorId || 'Actor';
                addDmEvent(`Selected ${label}`, 'system');
            }
        } else {
            dmQuickMenuArmedByLeftClick = false;
            hideGodContextMenu();
            hideGodWorldMenu();
        }
        return;
    }

    if (isDmObserverMode()) {
        if (hit.targetHit && hit.targetHit.object) {
            setSelectedCombatTarget(hit.targetHit.object);
            setDmFollowEntity(hit.targetHit.object);
            const label = hit.targetHit.object.userData?.name || hit.targetHit.object.userData?.actorId || 'Actor';
            showFloatingText(`Selected: ${label}`, '#ffcf85', true, { anchorObject: hit.targetHit.object });
            appendConsoleHistory(`[COMBAT] Selected ${label} for encounter setup`, 'ok');
        }
        return;
    }

    if (hasModePermission('player.combatInput')) {
        const clickedTarget = hit.targetHit ? hit.targetHit.object : null;
        const clickedOnMovezone = hit.moveHit ? hit.moveHit.point : null;

        if (clickedTarget) {
            const enteredCombatThisClick = tryEnterCombat(clickedTarget);
            setSelectedCombatTarget(clickedTarget);
            const distanceFeet = getEdgeDistanceFeet(playerState, clickedTarget);
            const inRange = canTarget(playerState, clickedTarget, DND_RANGES.melee, true);
            console.info(`Clicked: ${clickedTarget.userData.name || 'Target'}`);
            console.info(`Distance (edge): ${distanceFeet.toFixed(2)} ft`);
            console.info(`In melee range: ${inRange}`);
            showFloatingText(`${clickedTarget.userData.name || 'Target'} — ${Math.round(distanceFeet)} ft`, '#a8d8ff');

            if (clickedTarget.material && clickedTarget.material.color) {
                clickedTarget.material.color.set(inRange ? 0x00ff00 : 0xff0000);
            }

            if (!activeRangeCircle) {
                activeRangeCircle = createRangeCircle(playerState.position, DND_RANGES.melee, 0xff4444, 0.35);
                scene.add(activeRangeCircle);
            } else {
                activeRangeCircle.position.copy(playerState.position);
                activeRangeCircle.position.y += 0.05;
            }

            if (!enteredCombatThisClick) {
                if (currentAction === 'attack') {
                    selectMoveAndAttackAction(clickedTarget);
                } else if (pendingAction === 'melee') {
                    selectMoveAndAttackAction(clickedTarget);
                    pendingAction = null;
                } else if (pendingAction === 'ranged') {
                    rangedAttack(clickedTarget);
                    pendingAction = null;
                } else if (!currentAction) {
                    selectMoveAndAttackAction(clickedTarget);
                }
            }
            return;
        }

        if (!clickedTarget && clickedOnMovezone && currentGameMode === GAME_MODE.COMBAT) {
            const isPlayerInputTurn = (combatState.phase === 'PLAYER' || currentTurnPhase === TURN_PHASE.PLAYER);
            if (isMovementSelectionAction(currentAction) || (!currentAction && isPlayerInputTurn)) {
                selectMoveDestination(clickedOnMovezone);
            }
            return;
        }
    }

    if (hit.selectableHit) {
        selectObject(hit.selectableHit);
    }
}

function handleGodContext(payload = {}) {
    void payload;
}

function handleGodMove(payload = {}) {
    void payload;
}

function handleGodAction(action, payload = {}) {
    switch (action) {
        case GOD_ACTIONS.LOOK:
            handleGodLook(payload);
            break;
        case GOD_ACTIONS.SELECT:
            handleGodSelect(payload);
            break;
        case GOD_ACTIONS.MOVE:
            handleGodMove(payload);
            break;
        case GOD_ACTIONS.CONTEXT:
            handleGodContext(payload);
            break;
        case GOD_ACTIONS.CANCEL:
            closeAllDmUI();
            break;
    }
}

window.handleGodAction = handleGodAction;

// Mouse adapter: LMB selects/interacts, RMB controls camera look only.
window.addEventListener('mousedown', (event) => {
    if (event.button === 2) {
        handleGodAction(GOD_ACTIONS.LOOK, { source: 'mouse', phase: 'start', mouseEvent: event });
        return;
    }
    if (event.button !== 0) return;
    dmLmbDown = true;
    if (isDmFreeCamera() && isGodModeActive() && rendererReady && event.target === renderer.domElement) {
        const hit = getInteractionHit({ source: 'mouse', mouseEvent: event });
        const actor = hit && hit.targetHit ? hit.targetHit.object : null;
        if (actor && actor !== playerState && actor !== playerRig) {
            dmLmbDragCandidate = actor;
            if (dmLmbDragHoldTimer) {
                clearTimeout(dmLmbDragHoldTimer);
                dmLmbDragHoldTimer = null;
            }
            dmLmbDragHoldTimer = window.setTimeout(() => {
                dmLmbDragHoldTimer = null;
                if (!dmLmbDown || !dmLmbDragCandidate || isGrabbing) return;
                beginGodEntityMove(dmLmbDragCandidate);
            }, 150);
        }
    }
    handleGodAction(GOD_ACTIONS.SELECT, { source: 'mouse', mouseEvent: event });
});

window.addEventListener('mouseup', (event) => {
    if (event.button !== 0) return;
    dmLmbDown = false;
    dmLmbDragCandidate = null;
    if (dmLmbDragHoldTimer) {
        clearTimeout(dmLmbDragHoldTimer);
        dmLmbDragHoldTimer = null;
    }
});

window.addEventListener('contextmenu', (event) => {
    if (!rendererReady) return;
    if (!isGodModeActive()) return;
    event.preventDefault();
    event.stopPropagation();
});

// Double-click on a valid move-zone point: pick + confirm movement in one gesture.
window.addEventListener('dblclick', (event) => {
    if (!rendererReady) return;
    if (consoleState.open) return;
    if (event.button !== 0) return;
    if (currentGameMode !== GAME_MODE.COMBAT) return;
    if (!combatCameraActive) return;

    // Ignore UI-originated double-clicks.
    let el = event.target;
    while (el) {
        if (el === inspectorMenu || el === actionMenuEl || el === confirmUI || el.tagName === 'INPUT' || el.tagName === 'BUTTON') {
            return;
        }
        el = el.parentElement;
    }

    const rect = renderer.domElement.getBoundingClientRect();
    const mx = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const my = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera({ x: mx, y: my }, getActiveViewCamera());

    // DM Priority: double-click to possess any actor (player or training dummy).
    if (isGodModeActive()) {
        const allActors = [
            playerState,
            ...trainingDummies.filter((d) => d && d.parent && (d.userData?.hp || 0) > 0)
        ];
        const actorHit = allActors.length > 0 ? raycaster.intersectObjects(allActors, false)[0] : null;
        if (actorHit && actorHit.object) {
            if (requestPossessActor(actorHit.object)) {
                event.preventDefault();
                return;
            }
        }
    }

    // Priority 1: double-click enemy => immediately auto move+attack (no extra prompt).
    if (hasModePermission('player.combatInput')) {
        const activeTargetables = trainingDummies.filter((dummy) => (
            dummy &&
            dummy.parent &&
            dummy.userData &&
            dummy.userData.isTargetable &&
            (dummy.userData.hp || 0) > 0
        ));
        const targetHit = activeTargetables.length > 0
            ? raycaster.intersectObjects(activeTargetables, false)[0]
            : null;
        const clickedTarget = targetHit ? targetHit.object : null;

        if (clickedTarget && canAttack() && !combatInteraction.awaitingConfirm) {
            setSelectedCombatTarget(clickedTarget);
            const inMeleeRange = canTarget(playerState, clickedTarget, DND_RANGES.melee, true);
            if (inMeleeRange) {
                playConfirmAttackSnap();
                executeAttack(clickedTarget);
                event.preventDefault();
                return;
            }

            const preview = buildAutoApproachPreview(clickedTarget);
            if (preview && preview.valid) {
                const moveStarted = executeMoveTo(preview.destPos, preview.costFeet);
                if (moveStarted) {
                    queuePostMoveAttack(clickedTarget, 'melee');
                }
                resetCombatInteraction();
                updateActionMenu();
                event.preventDefault();
                return;
            }
        }
    }

    // Priority 2: movement reticle double-click => pick + confirm move.
    if (!moveZoneDisc) return;
    const isPlayerInputTurn = (combatState.phase === 'PLAYER' || currentTurnPhase === TURN_PHASE.PLAYER);
    if (!(isMovementSelectionAction(currentAction) || (!currentAction && isPlayerInputTurn))) return;

    const hit = raycaster.intersectObject(moveZoneDisc, false)[0];
    if (!hit || !hit.point) return;

    const snapped = snapToMoveGrid(hit.point.x, hit.point.z);

    // If a move choice is already open for this snapped tile, confirm it directly.
    if (
        combatInteraction.awaitingConfirm &&
        (isMovementSelectionAction(combatInteraction.action) || combatInteraction.action === 'move-to-approach' || combatInteraction.action === 'move-and-attack') &&
        combatInteraction.preview &&
        combatInteraction.preview.valid &&
        Math.abs((combatInteraction.preview.destX || 0) - snapped.x) < 0.01 &&
        Math.abs((combatInteraction.preview.destZ || 0) - snapped.z) < 0.01
    ) {
        confirmAction();
        event.preventDefault();
        return;
    }

    // Otherwise pick this destination and immediately confirm if valid.
    selectMoveDestination(hit.point);
    if (combatInteraction.awaitingConfirm && combatInteraction.preview && combatInteraction.preview.valid) {
        confirmAction();
    }
    event.preventDefault();
});
// --- Grab (move) selected object with 'g' ---
window.addEventListener('keydown', (event) => {
    if (!canManipulateSceneSelection()) return;
    if (event.key === 'g' && selectedObject && !isGrabbing) {
        beginGrabPlacement(selectedObject);
    }
    // Axis lock
    if (isGrabbing && ['x','y','z'].includes(event.key.toLowerCase())) {
        grabAxis = event.key.toLowerCase();
        event.preventDefault(); // Prevent browser navigation
    }
    // Confirm placement with Enter or Escape
    if (isGrabbing && event.key === 'Enter') {
        finishGrabPlacement(true);
        event.preventDefault();
        event.stopImmediatePropagation();
    }
    if (isGrabbing && event.key === 'Escape') {
        finishGrabPlacement(false);
        event.preventDefault();
        event.stopImmediatePropagation();
    }
});

// Move selected object with mouse while grabbing
window.addEventListener('mousemove', (event) => {
    if (!canManipulateSceneSelection()) return;
    if (!isGrabbing || !selectedObject) return;
    const rect = renderer.domElement.getBoundingClientRect();
    const ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera({ x: ndcX, y: ndcY }, getActiveViewCamera());
    let intersection = null;
    if (grabAxis === 'x') {
        // Plane parallel to YZ, passing through object
        const plane = new THREE.Plane(new THREE.Vector3(1,0,0), -selectedObject.position.x);
        intersection = new THREE.Vector3();
        raycaster.ray.intersectPlane(plane, intersection);
        if (intersection) {
            selectedObject.position.x = intersection.x;
            if (socket) socket.emit('scene-update', serializeScene());
        }
    } else if (grabAxis === 'y') {
        // Plane parallel to XZ, passing through object
        const plane = new THREE.Plane(new THREE.Vector3(0,1,0), -selectedObject.position.y);
        intersection = new THREE.Vector3();
        raycaster.ray.intersectPlane(plane, intersection);
        if (intersection) {
            selectedObject.position.y = intersection.y;
            if (socket) socket.emit('scene-update', serializeScene());
        }
    } else if (grabAxis === 'z') {
        // Plane parallel to XY, passing through object
        const plane = new THREE.Plane(new THREE.Vector3(0,0,1), -selectedObject.position.z);
        intersection = new THREE.Vector3();
        raycaster.ray.intersectPlane(plane, intersection);
        if (intersection) {
            selectedObject.position.z = intersection.z;
            if (socket) socket.emit('scene-update', serializeScene());
        }
    } else {
        // Free move on ground plane (y=0)
        const planeY = 0;
        const planeNormal = new THREE.Vector3(0, 1, 0);
        const plane = new THREE.Plane(planeNormal, -planeY);
        intersection = new THREE.Vector3();
        raycaster.ray.intersectPlane(plane, intersection);
        if (intersection) {
            selectedObject.position.x = intersection.x;
            selectedObject.position.z = intersection.z;
            if (socket) socket.emit('scene-update', serializeScene());
        }
    }
    if (intersection) {
        if (selectionBoxHelper) selectionBoxHelper.update();
        updateInspectorMenu();
    }
});

function selectObject(obj) {
    // Remove highlight from previous selection
    if (selectedObject && selectedObject.material && selectedObject.material.emissive) {
        selectedObject.material.emissive.set(0x000000);
    }
    // Remove previous BoxHelper
    if (selectionBoxHelper) {
        scene.remove(selectionBoxHelper);
        selectionBoxHelper = null;
    }
    selectedObject = obj;
    if (selectedObject) {
        // Highlight material
        if (selectedObject.material && selectedObject.material.emissive) {
            selectedObject.material.emissive.set(0x333333);
        }
        // Add BoxHelper
        selectionBoxHelper = new THREE.BoxHelper(selectedObject, 0x00ff00);
        scene.add(selectionBoxHelper);
    }
    updateInspectorMenu();
}

let firstMeshSelected = false;
// --- Utility: Generate box UVs for all meshes ---
function assignBoxUVs(mesh) {
    mesh.geometry.computeBoundingBox();
    const bbox = mesh.geometry.boundingBox;
    const positions = mesh.geometry.attributes.position;
    const uvs = [];
    for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i);
        const y = positions.getY(i);
        const z = positions.getZ(i);
        // Box projection: choose the major axis for each vertex
        const dx = bbox.max.x - bbox.min.x;
        const dy = bbox.max.y - bbox.min.y;
        const dz = bbox.max.z - bbox.min.z;
        let u = 0, v = 0;
        if (dx >= dy && dx >= dz) {
            // X is major axis: project onto YZ
            u = (y - bbox.min.y) / dy;
            v = (z - bbox.min.z) / dz;
        } else if (dy >= dx && dy >= dz) {
            // Y is major axis: project onto XZ
            u = (x - bbox.min.x) / dx;
            v = (z - bbox.min.z) / dz;
        } else {
            // Z is major axis: project onto XY
            u = (x - bbox.min.x) / dx;
            v = (y - bbox.min.y) / dy;
        }
        uvs.push(u, v);
    }
    mesh.geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    mesh.geometry.attributes.uv.needsUpdate = true;
}
// --- PBR Texture Loader Example ---





// --- Character Controls ---
let moveForward = false, moveBackward = false, moveLeft = false, moveRight = false;
let turnLeft = false, turnRight = false;
let velocity = new THREE.Vector3();
let direction = new THREE.Vector3();
let canMove = false;
let playerRig = null;
const xrMove = new THREE.Vector3();
const xrForward = new THREE.Vector3();
const xrRight = new THREE.Vector3();
const activeViewWorldPos = new THREE.Vector3();
const activeViewWorldQuat = new THREE.Quaternion();

const speed = 4.1; // units per second
const lookSpeed = 0.002;
const turnSpeed = 1.8;
const xrMoveSpeed = 6.6;
const xrVerticalSpeed = 4.2;
const xrTurnSpeed = 1.8;
const xrDeadzone = 0.16;
const WORLD_SCALE = 8.0;
const PLAYER_SPAWN = new THREE.Vector3(17, 12.64, 14.17);
const PLAYER_GRAVITY = 28;
const PLAYER_JUMP_SPEED = 9.5;
const PLAYER_DOUBLE_JUMP_SPEED = 9.0;
const PLAYER_TRIPLE_JUMP_SPEED = 8.8;
const PLAYER_MAX_JUMPS = 3;
const PLAYER_TERMINAL_VELOCITY = 36;
const PLAYER_COLLISION_EPSILON = 0.001;
const PLAYER_GROUND_SNAP = 0.12;
const PLAYER_GROUND_OFFSET = 2.4; // Height of player feet above geometric surface
const PLAYER_MAX_SAFE_DISTANCE = 10000;
const MAX_PHYSICS_DELTA = 1 / 60;
const MIN_COLLIDER_DIAGONAL = 0.5;
const MAX_COLLIDER_DIAGONAL = 50;
const FLOOR_MAX_THICKNESS = 0.2;
const FLOOR_MAX_HEIGHT_VARIATION = 4;
const FLOOR_MIN_SPAN = 1;
const PRIMARY_FLOOR_COLLIDER_NAME = 'Plane001';
const FLOOR_DEBUG_TARGET_NAME = PRIMARY_FLOOR_COLLIDER_NAME;
const FLOOR_MESH_RAYCAST_PADDING = 2;
const COLLIDER_MERGE_DISTANCE = 2;
const PLANE_DEBUG_THICKNESS = 0.05;
const STACKED_OVERLAP_THRESHOLD = 0.1;
let pitch = 0, yaw = 0;
let orbitPreviewActive = false;
let orbitPreviewYaw = 0;
let orbitPreviewPitch = 0;
let orbitPreviewLastX = 0;
let orbitPreviewLastY = 0;
const orbitPreviewSensitivity = 0.006;
const orbitPreviewMaxYaw = Math.PI * 0.7;
const orbitPreviewMaxPitch = 1.2;
let mobileTouchControlsManager = null;
let unifiedInputManager = null;
let inputFeedbackManager = null;
let inputPresentationManager = null;

function ensureMobileTouchControlsManager() {
    if (mobileTouchControlsManager) return mobileTouchControlsManager;
    mobileTouchControlsManager = createMobileTouchControlsManager({
        THREE,
        windowObj: window,
        documentObj: document,
        isDmFreeCamera,
        canUseStandardMovementControls,
        isTextInputTarget,
        isCombatReviewUiOpen,
        getConsoleOpen: () => !!(consoleState && consoleState.open),
        getDmCamera: () => dmCamera,
        getCamera: () => camera,
        getPlayerRig: () => playerRig,
        getCombatCameraActive: () => combatCameraActive,
        getYaw: () => yaw,
        setYaw: (value) => { yaw = value; },
        getPitch: () => pitch,
        setPitch: (value) => { pitch = value; },
        setMovementFlags: ({ forward, backward, left, right }) => {
            moveForward = !!forward;
            moveBackward = !!backward;
            moveLeft = !!left;
            moveRight = !!right;
        },
        setDmFreeMovementFlags: ({ forward, backward, left, right }) => {
            dmFreeMoveForward = !!forward;
            dmFreeMoveBackward = !!backward;
            dmFreeMoveLeft = !!left;
            dmFreeMoveRight = !!right;
        },
    });
    return mobileTouchControlsManager;
}

function isMobileTouchScreenLayout() {
    return ensureMobileTouchControlsManager().isMobileTouchScreenLayout();
}

function resetTouchJoystickState() {
    ensureMobileTouchControlsManager().resetTouchJoystickState();
}

function refreshMobileTouchControlsVisibility() {
    ensureMobileTouchControlsManager().refreshMobileTouchControlsVisibility();
}

function resetTouchMoveState() {
    ensureMobileTouchControlsManager().resetTouchMoveState();
}

function resetTouchLookState() {
    ensureMobileTouchControlsManager().resetTouchLookState();
}

function updateTouchMoveFlags() {
    ensureMobileTouchControlsManager().updateTouchMoveFlags();
}

function applyTouchLookInput(delta) {
    ensureMobileTouchControlsManager().applyTouchLookInput(delta);
}

function setTouchPadAxisFromEvent(padEl, stickEl, touch, axisVec) {
    ensureMobileTouchControlsManager().setTouchPadAxisFromEvent(padEl, stickEl, touch, axisVec);
}

function createMobileTouchControls() {
    ensureMobileTouchControlsManager().createMobileTouchControls();
}

function ensureUnifiedInputManager() {
    if (unifiedInputManager) return unifiedInputManager;
    unifiedInputManager = createUnifiedInputManager({
        setMovementFlags: ({ forward, backward, left, right }) => {
            moveForward = !!forward;
            moveBackward = !!backward;
            moveLeft = !!left;
            moveRight = !!right;
        },
        setDmFreeMovementFlags: ({ forward, backward, left, right, up, down, fast }) => {
            dmFreeMoveForward = !!forward;
            dmFreeMoveBackward = !!backward;
            dmFreeMoveLeft = !!left;
            dmFreeMoveRight = !!right;
            dmFreeMoveUp = !!up;
            dmFreeMoveDown = !!down;
            dmFreeMoveFast = !!fast;
        },
        setTurnFlags: ({ left, right }) => {
            turnLeft = !!left;
            turnRight = !!right;
        },
        setSprint: (value) => {
            playerSprinting = !!value;
        },
        setFlightVerticalFlags: ({ up, down }) => {
            playerFlyUp = !!up;
            playerFlyDown = !!down;
        },
        queueJump: () => {
            playerState.jumpQueued = true;
        },
        onCommand: (command) => {
            handleUnifiedGameplayCommand(command);
        },
    });
    return unifiedInputManager;
}

function ensureInputFeedbackManager() {
    if (inputFeedbackManager) return inputFeedbackManager;
    window.__INPUT_ACK__ = window.__INPUT_ACK__ || {
        history: [],
        lastByKind: {},
    };
    inputFeedbackManager = createInputFeedbackManager({
        setIntentStatus: uxSetIntentStatus,
        showFloatingText,
        appendConsoleHistory,
        pushTimeline: (entry) => {
            pushDebugTick({
                tick: window.__SIM_DEBUG__.currentTick,
                source: 'input-feedback',
                event: entry,
            });
        },
        presentFeedback: (entry, presentation) => {
            ensureInputPresentationManager().present(entry, presentation);
        },
        getHistoryStore: () => window.__INPUT_ACK__,
    });
    return inputFeedbackManager;
}

function ensureInputPresentationManager() {
    if (inputPresentationManager) return inputPresentationManager;
    inputPresentationManager = createInputPresentationManager({
        showFloatingText,
        focusCameraOnAction,
        playConfirmAttackSnap,
        triggerCombatFlash,
        shakeScreen,
        setCombatUiPhase,
        onPhaseTransition: (phaseEvent) => {
            pushDebugTick({
                tick: window.__SIM_DEBUG__.currentTick,
                source: 'presentation-phase',
                event: {
                    type: 'presentation:phase',
                    ...phaseEvent,
                },
            });
        },
    });
    return inputPresentationManager;
}

function recordInputFeedback(kind, outcome, reason = '', options = {}) {
    return ensureInputFeedbackManager().record(kind, outcome, reason, options);
}

// Auto-orbit during animations (dance, flip)
let autoOrbitYaw = 0;
const autoOrbitSpeed = 0.15; // radians per second
let combatCameraActive = false;
let preCombatCameraFov = 75;
const combatCameraDesiredPos = new THREE.Vector3();
const combatCameraLookAtPos = new THREE.Vector3();
const combatCameraFocusBlendPos = new THREE.Vector3();
let combatCameraFocusBlendReady = false;
const combatCameraActionFocusPos = new THREE.Vector3();
let combatCameraActionFocusUntil = 0;
let combatCameraActionFocusStrength = 1;
const LOCK_COMBAT_CAMERA_TO_PLAYER = true;
const COMBAT_CAMERA_STEADY_OFFSET = new THREE.Vector3(0, 2.6, -4.8);
const COMBAT_CAMERA_LOOK_Y_OFFSET = 1.0;
const FREE_CAMERA_HEIGHT = 1.25;
const dmCameraDesiredPos = new THREE.Vector3();
const dmDirectorCenter = new THREE.Vector3();
let headspinYaw = 0; // separate fast-spin yaw applied to model root during headspin
const AVATAR_SCALE_STEP = 0.08;
const AVATAR_SCALE_MIN = 0.02;
const AVATAR_SCALE_MAX = 3.0;
const LOCAL_AVATAR_BASE_Y = -2;
const NETWORK_AVATAR_YAW_OFFSET = Math.PI;
const worldColliders = [];
let worldPhysicsReady = false;
let colliderDebugVisible = false;
let colliderDebugGroup = null;
let worldEverythingRoot = null;

// === BVH Collision System ===
let bvhColliderMesh = null;
let useBVHCollisions = true; // Set to false to fall back to Box3-based collisions
const upAxis = new THREE.Vector3(0, 1, 0);
const moveVectorWorld = new THREE.Vector3();
let playerFlying = false;
let playerFlyUp = false;
let playerFlyDown = false;
let playerSprinting = false;
const PLAYER_FLY_SPEED = 6.5;
const PLAYER_SPRINT_MULTIPLIER = 1.65; // Sprint is ~65% faster
const TRAINING_DUMMY_DAMAGE = 1; // heavily nerfed dummy damage
const TRAINING_DUMMY_MODEL_URL = '/static/Untitled.glb';
const TRAINING_DUMMY_MODEL_URL_FALLBACK = '/static/untitled.glb';
const TRAINING_DUMMY_POSE_PRESETS = new Set(['idle', 'guard', 'taunt', 'slump']);
const DEFAULT_TRAINING_DUMMY_RIG_SETTINGS = {
    useFallbackRig: true,
    boneRotationOverrides: {
        // Relax T-pose arms downward so idle dummies don't hold arms up.
        leftUpperArm: { x: 0, y: 0, z: -1.15 },
        rightUpperArm: { x: 0, y: 0, z: 1.15 },
    },
};
let trainingDummyProfileModelUrl = null;
let trainingDummyProfilePose = 'idle';
let trainingDummyProfileRigSettings = null;

try {
    const savedProfile = JSON.parse(localStorage.getItem('character_profile_v1') || 'null');
    const savedDummy = savedProfile && typeof savedProfile.trainingDummy === 'object'
        ? savedProfile.trainingDummy
        : null;
    const savedDummyRigSettings = savedDummy && typeof savedDummy.rigSettings === 'object'
        ? savedDummy.rigSettings
        : null;
    // Default to canonical fallback rebone so dummy rigs auto-work without manual tuning.
    trainingDummyProfileRigSettings = sanitizeStoredRigSettings(savedDummyRigSettings || DEFAULT_TRAINING_DUMMY_RIG_SETTINGS);
    if (savedDummy && typeof savedDummy.modelUrl === 'string' && savedDummy.modelUrl.trim().length > 0) {
        trainingDummyProfileModelUrl = savedDummy.modelUrl.trim();
    }
    const savedPose = savedDummy && typeof savedDummy.pose === 'string'
        ? savedDummy.pose.toLowerCase().trim()
        : '';
    if (TRAINING_DUMMY_POSE_PRESETS.has(savedPose)) {
        trainingDummyProfilePose = savedPose;
    }
} catch (_err) {
    trainingDummyProfileModelUrl = null;
    trainingDummyProfilePose = 'idle';
    trainingDummyProfileRigSettings = sanitizeStoredRigSettings(DEFAULT_TRAINING_DUMMY_RIG_SETTINGS);
}

const playerState = {
    position: PLAYER_SPAWN.clone(),
    velocity: new THREE.Vector3(),
    onGround: false,
    jumpCount: 0,
    jumpQueued: false,
    capsule: {
        radius: 0.4,
        height: 1.8,
    },
    // D&D Combat System
    prevPosition: PLAYER_SPAWN.clone(),
    movementRemaining: 30,    // feet per turn
    actionAvailable: true,
    bonusActionAvailable: true,
    reactionAvailable: true,
    radius: 0.4,              // collider radius in Three.js units (matches capsule.radius)
    hp: 100,
    maxHp: 100,
    speedFt: 30,
};

const playerCombatCapabilities = {
    can_dash: true,
    can_disengage: true,
    can_dodge: true,
    has_opportunity_attack: true,
};

let playerProfileBootstrapPromise = null;

function applyPlayerMovementCapabilities(rawCapabilities) {
    const raw = rawCapabilities && typeof rawCapabilities === 'object' ? rawCapabilities : {};
    playerCombatCapabilities.can_dash = !!(raw.can_dash ?? raw.canDash ?? playerCombatCapabilities.can_dash);
    playerCombatCapabilities.can_disengage = !!(raw.can_disengage ?? raw.canDisengage ?? playerCombatCapabilities.can_disengage);
    playerCombatCapabilities.can_dodge = !!(raw.can_dodge ?? raw.canDodge ?? playerCombatCapabilities.can_dodge);
    playerCombatCapabilities.has_opportunity_attack = !!(raw.has_opportunity_attack ?? raw.hasOpportunityAttack ?? playerCombatCapabilities.has_opportunity_attack);
    updateActionMenu();
}

function deriveMovementCapabilitiesFromMaster(master) {
    return master && master.actions && master.actions.movement && typeof master.actions.movement === 'object'
        ? master.actions.movement
        : null;
}

function syncLoadedInventoryFromMaster(master) {
    if (!master || typeof master !== 'object') return;
    if (!window.loadedEngineEntity || typeof window.loadedEngineEntity !== 'object') return;
    if (master.inventory && typeof master.inventory === 'object') {
        window.loadedEngineEntity.inventory = structuredClone(master.inventory);
    }
}

function getPlayerBaseSpeedFt() {
    const speed = Number(playerState.speedFt) || Number(window.loadedEngineEntity?.combat?.speed) || 30;
    return Math.max(5, speed);
}

function isMovementSelectionAction(action) {
    return action === 'move' || action === 'dash' || action === 'disengage';
}

function getMovementBudgetForAction(action) {
    if (action === 'dash') {
        return Math.max(Number(combatState.player.movementRemaining) || 0, getPlayerBaseSpeedFt() * 2);
    }
    return Math.max(0, Number(combatState.player.movementRemaining) || 0);
}

function getCombatConsumableItems() {
    const items = Array.isArray(window.loadedEngineEntity?.inventory?.items)
        ? window.loadedEngineEntity.inventory.items
        : [];
    return items.filter((row) => {
        if (!row || Number(row.qty) <= 0) return false;
        const itemId = String(row.itemId || '').trim().toLowerCase();
        const definition = window.inventorySystem?.itemDb?.[itemId];
        return definition && definition.type === 'consumable';
    });
}

function getPrimaryCombatConsumable() {
    const consumables = getCombatConsumableItems();
    return consumables.find((row) => String(row.itemId || '').trim().toLowerCase() === 'health_potion') || consumables[0] || null;
}

function syncLocalPlayerProfile(profile) {
    if (!profile || typeof profile !== 'object') return;
    const summary = profile.summary && typeof profile.summary === 'object' ? profile.summary : {};
    const master = profile.master && typeof profile.master === 'object' ? profile.master : null;
    const inCombatNow = currentGameMode === GAME_MODE.COMBAT || combatState.inCombat;
    const summaryMaxHpRaw = summary.max_hp ?? summary.maxHp ?? summary.hit_points;
    const summaryCurrentHpRaw = summary.current_hp ?? summary.currentHp ?? summary.hit_points;
    const nextMaxHp = Number.isFinite(Number(summaryMaxHpRaw)) ? Number(summaryMaxHpRaw) : null;
    const nextCurrentHp = Number.isFinite(Number(summaryCurrentHpRaw)) ? Number(summaryCurrentHpRaw) : null;

    if (nextMaxHp !== null) {
        playerState.maxHp = nextMaxHp;
    }
    if (nextMaxHp !== null && !inCombatNow) {
        playerState.hp = nextMaxHp;
    } else if (nextCurrentHp !== null) {
        playerState.hp = nextCurrentHp;
    } else if (nextMaxHp !== null && !Number.isFinite(Number(playerState.hp))) {
        playerState.hp = nextMaxHp;
    }
    if (Number.isFinite(Number(summary.speed_ft))) {
        playerState.speedFt = Math.max(5, Number(summary.speed_ft));
    }
    updatePlayerHealthHud();

    if (master) {
        const movementCaps = deriveMovementCapabilitiesFromMaster(master);
        if (movementCaps) {
            applyPlayerMovementCapabilities(movementCaps);
        }
        syncLoadedInventoryFromMaster(master);
    }
}

async function bootstrapPlayerCombatProfile(force = false) {
    if (!force && playerProfileBootstrapPromise) {
        return playerProfileBootstrapPromise;
    }
    playerProfileBootstrapPromise = (async () => {
        try {
            const response = await fetch('/api/player-info');
            const payload = await response.json();
            if (!response.ok || !payload || !payload.ok) return null;

            syncLocalPlayerProfile(payload);

            if (socket && socket.connected) {
                const summary = payload.summary && typeof payload.summary === 'object' ? payload.summary : {};
                const master = payload.master && typeof payload.master === 'object' ? payload.master : {};
                const summaryMaxHp = summary.max_hp ?? summary.maxHp ?? summary.hit_points ?? null;
                socket.emit('player-character-stats', {
                    ac: summary.armor_class ?? null,
                    maxHp: summaryMaxHp,
                    initiativeBonus: summary.initiative_bonus ?? null,
                    speedFt: summary.speed_ft ?? null,
                    movementCapabilities: deriveMovementCapabilitiesFromMaster(master),
                    inventory: master.inventory ?? null,
                });
            }
            return payload;
        } catch (_err) {
            return null;
        }
    })();
    return playerProfileBootstrapPromise;
}

function parseHudHpText() {
    const hpTextEl = document.getElementById('hud-hp-text');
    if (!hpTextEl) return null;
    const raw = (hpTextEl.textContent || '').trim();
    const match = raw.match(/(\d+)\s*\/\s*(\d+)/);
    if (!match) return null;
    const current = Number(match[1]);
    const max = Number(match[2]);
    if (!Number.isFinite(current) || !Number.isFinite(max) || max <= 0) return null;
    return { current, max };
}

function syncPlayerHealthFromHudIfAvailable() {
    const parsed = parseHudHpText();
    if (!parsed) return false;
    playerState.hp = parsed.current;
    playerState.maxHp = parsed.max;
    return true;
}

function updatePlayerHealthHud() {
    const fillEl = document.getElementById('hud-hp-fill');
    const textEl = document.getElementById('hud-hp-text');
    if (!fillEl || !textEl) return;

    const max = Math.max(1, Number(playerState.maxHp) || 1);
    const current = Math.max(0, Math.min(max, Number(playerState.hp) || 0));
    const pct = Math.max(0, Math.min(1, current / max));

    fillEl.style.width = `${(pct * 100).toFixed(1)}%`;
    fillEl.style.background = pct > 0.5 ? '#4caf7d' : (pct > 0.25 ? '#f0b429' : '#e05c5c');
    fillEl.style.boxShadow = `0 0 14px ${pct > 0.5 ? '#4caf7d' : (pct > 0.25 ? '#f0b429' : '#e05c5c')}`;
    textEl.textContent = `${current} / ${max}`;
}

function applyPlayerDamage(amount, sourceName = 'Enemy') {
    syncPlayerHealthFromHudIfAvailable();
    const dmg = Math.max(0, Math.round(Number(amount) || 0));
    if (dmg <= 0) return 0;

    playerState.hp = Math.max(0, (Number(playerState.hp) || 0) - dmg);
    updatePlayerHealthHud();

    if (playerState.hp <= 0) {
        showFloatingText('YOU ARE DOWN', '#ff2d2d');
        logCombatEvent(`${sourceName} drops you to 0 HP`, 'miss');
    }

    return dmg;
}

function applyDummyDamage(dummy, amount) {
    const dmg = Math.max(0, Math.round(Number(amount) || 0));
    if (dmg <= 0 || !dummy || !dummy.userData) return 0;

    dummy.userData.hp = Math.max(0, (Number(dummy.userData.hp) || 0) - dmg);
    
    if (dummy.userData.hp <= 0) {
        showFloatingText(`${(dummy.userData?.name || 'Dummy').toUpperCase()} DOWN`, '#ff2d2d', true, { anchorObject: dummy });
    }
    
    return dmg;
}

// ========== D&D Combat System ==========

const GAME_MODE = {
    FREE: 'free',
    COMBAT: 'combat',
};

const TURN_PHASE = {
    IDLE: 'idle',
    PLAYER: 'player',
    ENEMY: 'enemy',
    TRANSITION: 'transition',
};

let currentGameMode = GAME_MODE.FREE;
let currentTurnPhase = TURN_PHASE.IDLE;
let pendingAction = null; // 'melee' | 'ranged' | null

// ── Combat Interaction State ──
let currentAction = null;       // 'move' | 'attack' | 'ability' | null
const combatUiLifecycle = createCombatUiLifecycle();
const combatInteraction = createCombatInteractionState();
let confirmUI = null;

function setCombatUiPhase(phase, details = {}) {
    applyCombatUiPhase(combatUiLifecycle, combatInteraction, phase, details);
}

const combatState = {
    // Authoritative turn state.
    phase: 'PLAYER', // PLAYER | ENEMY | TRANSITION
    turnIndex: 0,
    turnQueue: [],
    player: {
        actionUsed: false,
        bonusUsed: false,
        movementRemaining: 30,
        hasActed: false,
    },
    lock: false,
    timelineBusy: false,

    // Legacy fields retained for compatibility with existing systems.
    turnOrder: [],              // Array of combatants in turn order
    currentTurnIndex: 0,        // Index of current actor
    inCombat: false,            // Whether combat is active
    roundNumber: 0,             // Current round
};
let spectatorCombat = false; // when true, player turns are auto-skipped (dummy-vs-dummy brawls)
let endTurnPending = false;
let endTurnWatchdog = null;

const combatTimeline = [];
const COMBAT_TIMELINE_MAX = 64;
const combatActionHistory = [];
const COMBAT_ACTION_HISTORY_MAX = 24;
let combatActionHistoryCursor = -1;
let lastCombatAction = null;
let combatReplayActive = false;
let dmOverride = null;
let combatActorIdCounter = 1;

// Track recently-damaged dummies to prevent world-sync from overwriting local HP updates
const recentlyDamagedDummies = new Map(); // actorId -> timestamp (ms)

function turnPhaseToCombatPhase(phase) {
    return mapTurnPhaseToCombatPhase(phase, TURN_PHASE);
}

function isPlayerInputTurn() {
    return mapIsPlayerInputTurn({
        currentGameMode,
        combatMode: GAME_MODE.COMBAT,
        combatPhase: combatState.phase,
        currentTurnPhase,
        turnPhase: TURN_PHASE,
    });
}

function cloneJsonSafe(value) {
    return JSON.parse(JSON.stringify(value));
}

function getLocalCombatActorId() {
    const effectiveLocalId = String(((socket && socket.id) ? socket.id : localPlayerId) || '').trim();
    if (!localPlayerCombatActorId && effectiveLocalId) {
        const playerStateMap = (scene && scene.userData && scene.userData.playerAvatarStates)
            ? scene.userData.playerAvatarStates
            : null;
        const localState = playerStateMap ? playerStateMap[effectiveLocalId] : null;
        const actorId = String(localState?.networkId || localState?.actorId || '').trim();
        if (actorId) {
            localPlayerCombatActorId = actorId;
        }
    }
    return String(localPlayerCombatActorId || effectiveLocalId || 'player').trim() || 'player';
}

function isLocalPlayerTurnEntry(entry) {
    if (!entry || entry.type !== 'player') return false;
    const entryId = String(entry.id || '').trim();
    let localActorId = String(localPlayerCombatActorId || '').trim();
    if (!localActorId) {
        localActorId = String(getLocalCombatActorId() || '').trim();
    }
    if (entryId && localActorId && entryId === localActorId) return true;

    const socketSid = String((socket && socket.id) || '').trim();
    const cachedSid = String(localPlayerId || '').trim();
    const ownerSid = String(entry.ownerSid || entry.playerId || entry.sid || '').trim();
    const ownerMatchesLocal = !!(
        ownerSid && (
            (socketSid && ownerSid === socketSid) ||
            (cachedSid && ownerSid === cachedSid)
        )
    );
    if (ownerMatchesLocal) {
        if (!localActorId && entryId) {
            localPlayerCombatActorId = entryId;
        }
        return true;
    }

    // Fallback: derive local actor id from known player avatar state by either SID.
    const playerStateMap = (scene && scene.userData && scene.userData.playerAvatarStates)
        ? scene.userData.playerAvatarStates
        : null;
    const localState = playerStateMap
        ? (playerStateMap[socketSid] || playerStateMap[cachedSid] || null)
        : null;
    const derivedActorId = String(localState && (localState.networkId || localState.actorId) ? (localState.networkId || localState.actorId) : '').trim();
    if (entryId && derivedActorId && entryId === derivedActorId) {
        localPlayerCombatActorId = derivedActorId;
        return true;
    }

    return false;
}

function resolveCombatActorIdForPlayerSid(sid) {
    const normalizedSid = String(sid || '').trim();
    if (!normalizedSid) return null;

    const effectiveLocalId = (socket && socket.id) ? socket.id : localPlayerId;
    if (effectiveLocalId && normalizedSid === effectiveLocalId) {
        return getLocalCombatActorId();
    }

    const playerStateMap = (scene && scene.userData && scene.userData.playerAvatarStates)
        ? scene.userData.playerAvatarStates
        : null;
    const playerState = playerStateMap ? playerStateMap[normalizedSid] : null;
    if (!playerState) return null;
    const actorId = String(playerState.networkId || playerState.actorId || playerState.id || '').trim();
    return actorId || null;
}

function getCombatOpeningActorId() {
    if (!combatState.inCombat) return null;
    if (Math.max(1, Number(combatState.roundNumber) || 1) > 1) return null;

    if (combatInitiatorActorId) return combatInitiatorActorId;
    if (combatInitiatorSid) {
        const resolved = resolveCombatActorIdForPlayerSid(combatInitiatorSid);
        if (resolved) {
            combatInitiatorActorId = resolved;
            return resolved;
        }
    }
    return null;
}

function getConnectedCombatPlayerEntries() {
    const playerStateMap = (scene && scene.userData && scene.userData.playerAvatarStates)
        ? scene.userData.playerAvatarStates
        : {};
    const effectiveLocalId = (socket && socket.id) ? socket.id : localPlayerId;
    const localActorId = getLocalCombatActorId();
    const entries = [];

    Object.values(playerStateMap).forEach((player) => {
        if (!player || String(player.role || '').toLowerCase() !== 'player') return;
        const playerId = String(player.id || '').trim();
        const actorId = String(player.actorId || playerId || '').trim();
        if (!playerId || !actorId) return;
        entries.push({
            id: actorId,
            playerId,
            name: actorId,
            isLocal: !!(effectiveLocalId && playerId === effectiveLocalId),
        });
    });

    if (!entries.some((entry) => entry.id === localActorId)) {
        entries.push({
            id: localActorId,
            playerId: String(effectiveLocalId || localActorId),
            name: String(localPlayerCombatActorId || 'Player'),
            isLocal: true,
        });
    }

    entries.sort((left, right) => left.id.localeCompare(right.id));
    return entries;
}

function isLocalCombatQueueEntry(entry) {
    return isLocalPlayerTurnEntry(entry);
}

function buildResolutionFromActionRecord(actionRecord) {
    if (!actionRecord || typeof actionRecord !== 'object') return null;
    if (actionRecord.resolution && typeof actionRecord.resolution === 'object') {
        return actionRecord.resolution;
    }

    const attackRoll = Number(actionRecord.attackRoll);
    const attackTotal = Number(actionRecord.attackTotal);
    const damageRoll = Number(actionRecord.damageRoll);
    const damageTotal = Number(actionRecord.damageTotal);

    if (!Number.isFinite(attackRoll) || !Number.isFinite(attackTotal)) return null;

    const attackBonus = Number.isFinite(Number(actionRecord.attackBonus))
        ? Number(actionRecord.attackBonus)
        : (attackTotal - attackRoll);
    const damageBonus = Number.isFinite(Number(actionRecord.damageBonus))
        ? Number(actionRecord.damageBonus)
        : (Number.isFinite(damageRoll) && Number.isFinite(damageTotal) ? (damageTotal - damageRoll) : 0);
    const hit = typeof actionRecord.hit === 'boolean'
        ? actionRecord.hit
        : String(actionRecord.result || '').toLowerCase() !== 'miss';
    const resultType = actionRecord.resultType || (hit ? 'normal' : 'normal');

    return {
        roll: attackRoll,
        attackBonus,
        total: attackTotal,
        targetAC: Number.isFinite(Number(actionRecord.targetAC)) ? Number(actionRecord.targetAC) : 0,
        hit,
        damageRoll: Number.isFinite(damageRoll) ? damageRoll : 0,
        damageBonus,
        totalDamage: Number.isFinite(damageTotal) ? damageTotal : 0,
        resultType,
        attackType: actionRecord.attackType || 'melee',
    };
}

function createCombatSnapshot(reason = 'snapshot') {
    if (currentGameMode !== GAME_MODE.COMBAT) return null;
    return {
        reason,
        savedAt: Date.now(),
        gameMode: currentGameMode,
        turnPhase: currentTurnPhase,
        combatState: cloneJsonSafe(combatState),
        playerState: {
            hp: Number(playerState.hp) || 0,
            maxHp: Number(playerState.maxHp) || 0,
            actionAvailable: !!playerState.actionAvailable,
            reactionAvailable: !!playerState.reactionAvailable,
            position: {
                x: Number(playerState.position.x) || 0,
                y: Number(playerState.position.y) || 0,
                z: Number(playerState.position.z) || 0,
            },
            prevPosition: {
                x: Number(playerState.prevPosition.x) || 0,
                y: Number(playerState.prevPosition.y) || 0,
                z: Number(playerState.prevPosition.z) || 0,
            },
        },
        enemies: trainingDummies
            .filter((dummy) => dummy && dummy.parent && dummy.userData?.faction !== 'player')
            .map(serializeTrainingDummy)
            .filter(Boolean),
        ui: {
            selectedTargetName: selectedCombatTarget?.userData?.name || null,
            pendingAction: pendingAction || null,
            currentAction: currentAction || null,
            hoveredMoveWorldPos: hoveredMoveWorldPos
                ? {
                    x: Number(hoveredMoveWorldPos.x) || 0,
                    y: Number(hoveredMoveWorldPos.y) || 0,
                    z: Number(hoveredMoveWorldPos.z) || 0,
                }
                : null,
        },
    };
}

function serializeTrainingDummy(dummy) {
    if (!dummy) return null;
    return {
        networkId: dummy.userData?.networkId || dummy.userData?.actorId || null,
        actorId: dummy.userData?.actorId || null,
        name: dummy.userData?.name || 'Training Dummy',
        position: {
            x: Number(dummy.position.x) || 0,
            y: Number(dummy.position.y) || 0,
            z: Number(dummy.position.z) || 0,
        },
        rotationY: Number(dummy.rotation.y) || 0,
        hp: Number(dummy.userData?.hp) || 0,
        maxHp: Number(dummy.userData?.maxHp) || 50,
        radius: Number(dummy.userData?.radius) || 0.5,
        movementRemaining: Number(dummy.userData?.movementRemaining) || 30,
        actionAvailable: dummy.userData?.actionAvailable !== false,
        playerSpotted: !!dummy.userData?.playerSpotted,
        ac: Number(dummy.userData?.ac) || 12,
        attackBonus: Number(dummy.userData?.attackBonus) || 4,
        damageRoll: Number(dummy.userData?.damageRoll) || TRAINING_DUMMY_DAMAGE,
        damageBonus: Number(dummy.userData?.damageBonus) || 0,
    };
}

function buildLiveCombatSyncPayload() {
    const inCombat = currentGameMode === GAME_MODE.COMBAT;
    const queue = Array.isArray(combatState.turnQueue) ? combatState.turnQueue : [];
    return {
        inCombat,
        phase: combatState.phase || 'PLAYER',
        currentTurnIndex: Math.max(0, Number(combatState.currentTurnIndex) || 0),
        roundNumber: Math.max(0, Number(combatState.roundNumber) || 0),
        turnQueue: queue.map((entry) => ({
            id: String(entry?.id || ''),
            type: entry?.type === 'player' ? 'player' : 'enemy',
            name: String(entry?.name || (entry?.type === 'player' ? 'Player' : 'Enemy')),
        })).filter((entry) => !!entry.id),
        player: {
            actorId: getLocalCombatActorId(),
            hp: Math.max(0, Number(playerState.hp) || 0),
            maxHp: Math.max(1, Number(playerState.maxHp) || 1),
            movementRemaining: Math.max(0, Number(combatState.player?.movementRemaining) || 0),
            actionUsed: !!combatState.player?.actionUsed,
            bonusUsed: !!combatState.player?.bonusUsed,
            hasActed: !!combatState.player?.hasActed,
            position: {
                x: Number(playerState.position?.x) || 0,
                y: Number(playerState.position?.y) || 0,
                z: Number(playerState.position?.z) || 0,
            },
        },
        enemies: trainingDummies
            .filter((dummy) => dummy && dummy.parent && dummy.userData?.faction !== 'player')
            .map(serializeTrainingDummy)
            .filter(Boolean),
        timestamp: Date.now(),
    };
}

function applyLiveCombatSyncFromPlayer(playerId, combatSync) {
    if (!combatSync || typeof combatSync !== 'object') return;

    const sourceId = String(playerId || '').trim();
    if (!sourceId) return;
    const payloadTimestamp = Math.max(0, Number(combatSync.timestamp) || 0);
    if (payloadTimestamp > 0 && payloadTimestamp < lastAppliedCombatSyncTimestamp) {
        return;
    }
    if (payloadTimestamp > 0) {
        lastAppliedCombatSyncTimestamp = payloadTimestamp;
    }

    const inCombat = !!combatSync.inCombat;

    if (inCombat && !combatInitiatorActorId && Number(combatSync.roundNumber) <= 1) {
        const queueFromSync = Array.isArray(combatSync.turnQueue) ? combatSync.turnQueue : [];
        const firstPlayerEntry = queueFromSync.find((entry) => String(entry?.type || '').toLowerCase() === 'player');
        const firstPlayerId = String(firstPlayerEntry?.id || '').trim();
        if (firstPlayerId) {
            combatInitiatorActorId = firstPlayerId;
        }
    }

    currentGameMode = inCombat ? GAME_MODE.COMBAT : GAME_MODE.FREE;
    combatState.inCombat = inCombat;

    combatState.roundNumber = Math.max(0, Number(combatSync.roundNumber) || 0);

    const effectiveLocalId = (socket && socket.id) ? socket.id : localPlayerId;
    if (effectiveLocalId && sourceId === effectiveLocalId) {
        combatState.player.actionUsed = !!combatSync.player?.actionUsed;
        combatState.player.bonusUsed = !!combatSync.player?.bonusUsed;
        combatState.player.hasActed = !!combatSync.player?.hasActed;
        combatState.player.movementRemaining = Math.max(0, Number(combatSync.player?.movementRemaining) || 0);
        syncCombatPlayerToLegacyState();

        if (Number.isFinite(Number(combatSync.player?.hp))) {
            playerState.hp = Math.max(0, Number(combatSync.player.hp));
        }
        if (Number.isFinite(Number(combatSync.player?.maxHp))) {
            playerState.maxHp = Math.max(1, Number(combatSync.player.maxHp));
        }
    }

    const enemyStates = Array.isArray(combatSync.enemies) ? combatSync.enemies : [];
    const existingById = new Map(trainingDummies
        .filter((dummy) => dummy && dummy.userData)
        .map((dummy) => [String(dummy.userData.networkId || dummy.userData.actorId || ''), dummy]));
    const syncedIds = new Set();

    for (const enemyState of enemyStates) {
        if (!enemyState || typeof enemyState !== 'object') continue;
        const actorId = String(enemyState.actorId || '').trim();
        const networkId = String(enemyState.networkId || enemyState.actorId || '').trim();
        if (!networkId) continue;
        const effectiveActorId = String(actorId || networkId).trim();
        syncedIds.add(networkId);

        let dummy = existingById.get(networkId) || existingById.get(effectiveActorId);
        if (!dummy || !dummy.parent) {
            dummy = spawnTrainingDummy(
                Number(enemyState.position?.x) || 0,
                Number(enemyState.position?.y) || 0,
                Number(enemyState.position?.z) || 0,
                String(enemyState.name || 'Training Dummy')
            );
            dummy.userData.networkId = networkId;
            dummy.userData.actorId = effectiveActorId;
            existingById.set(networkId, dummy);
        }

        dummy.userData.networkId = networkId;
        dummy.userData.actorId = effectiveActorId;
        dummy.userData.name = String(enemyState.name || dummy.userData.name || 'Training Dummy');
        dummy.position.set(
            Number(enemyState.position?.x) || 0,
            (Number(enemyState.position?.y) || 0) + TRAINING_DUMMY_Y_OFFSET,
            Number(enemyState.position?.z) || 0,
        );
        dummy.rotation.y = Number(enemyState.rotationY) || 0;
        dummy.userData.hp = Math.max(0, Number(enemyState.hp) || 0);
        dummy.userData.maxHp = Math.max(1, Number(enemyState.maxHp) || 50);
        dummy.userData.radius = Math.max(0.1, Number(enemyState.radius) || 0.5);
        dummy.userData.movementRemaining = Math.max(0, Number(enemyState.movementRemaining) || 30);
        dummy.userData.actionAvailable = enemyState.actionAvailable !== false;
        dummy.userData.playerSpotted = !!enemyState.playerSpotted;
        dummy.userData.ac = Math.max(1, Number(enemyState.ac) || 12);
        dummy.userData.attackBonus = Number(enemyState.attackBonus) || 4;
        dummy.userData.damageRoll = Math.max(1, Number(enemyState.damageRoll) || TRAINING_DUMMY_DAMAGE);
        dummy.userData.damageBonus = Number(enemyState.damageBonus) || 0;
    }

    for (const dummy of [...trainingDummies]) {
        const actorId = String(dummy?.userData?.networkId || dummy?.userData?.actorId || '').trim();
        if (actorId && !syncedIds.has(actorId)) {
            removeTrainingDummy(dummy);
        }
    }

    const queue = Array.isArray(combatSync.turnQueue)
        ? combatSync.turnQueue.map((entry) => ({
            id: String(entry?.id || ''),
            type: entry?.type === 'player' ? 'player' : 'enemy',
            name: String(entry?.name || (entry?.type === 'player' ? 'Player' : 'Enemy')),
        })).filter((entry) => !!entry.id)
        : [];
    combatState.turnQueue = queue;
    combatState.turnOrder = queue.map((entry) => {
        if (entry.type === 'player') {
            return isLocalPlayerTurnEntry(entry) ? playerState : findCombatActorById(entry.id);
        }
        return findCombatActorById(entry.id)?.userData;
    }).filter(Boolean);
    if (queue.length > 0) {
        combatState.currentTurnIndex = THREE.MathUtils.clamp(Number(combatSync.currentTurnIndex) || 0, 0, queue.length - 1);
    } else {
        combatState.currentTurnIndex = 0;
    }

    const openingActorId = getCombatOpeningActorId();
    if (openingActorId && queue.length > 0) {
        const openerIndex = queue.findIndex((entry) => entry && entry.id === openingActorId);
        if (openerIndex >= 0) {
            combatState.currentTurnIndex = openerIndex;
        }
    }
    combatState.turnIndex = combatState.currentTurnIndex;

    if (inCombat) {
        const currentEntry = getCurrentCombatQueueEntry();
        if (currentEntry?.type === 'enemy') {
            setCombatPhase('ENEMY');
        } else if (isLocalCombatQueueEntry(currentEntry)) {
            setCombatPhase('PLAYER');
        } else {
            setCombatPhase('TRANSITION');
            setCombatLock(true);
            setCombatTimelineBusy(false);
            clearCombatMoveTiles();
            showActionUI(false);
        }
    } else {
        currentTurnPhase = TURN_PHASE.IDLE;
        combatState.phase = 'TRANSITION';
        combatInitiatorSid = null;
        combatInitiatorActorId = null;
    }

    if (inCombat) {
        rebuildCombatArenaFromCurrentState();
    }

    updateCombatUI();
    updateDmControlPanel();
}

function getCombatActorId(actor) {
    if (!actor) return null;
    if (actor === playerState || actor === playerRig) return getLocalCombatActorId();
    if (actor.userData?.networkId) return actor.userData.networkId;
    if (actor.userData?.actorId) return actor.userData.actorId;
    if (actor.userData?.playerId) return actor.userData.playerId;
    // Do not fall back to display names; combat ids must be stable/network-safe.
    return null;
}

function getCombatActorLabel(actor) {
    if (!actor) return 'Unknown';
    if (actor === playerState || actor === playerRig) return 'Player';
    return actor.userData?.name || actor.userData?.networkId || actor.userData?.actorId || 'Enemy';
}

function isGodModeActive() {
    return modeManager.current === MODE.DM;
}

function canManipulateSceneSelection() {
    return hasModePermission('tools.selection') || isGodModeActive();
}

function clampGodMenuPosition(x, y, menuEl) {
    const menuWidth = menuEl ? Math.max(220, menuEl.offsetWidth || 0) : 220;
    const menuHeight = menuEl ? Math.max(60, menuEl.offsetHeight || 0) : 60;
    return {
        x: THREE.MathUtils.clamp(Number(x) || 0, 12, Math.max(12, window.innerWidth - menuWidth - 12)),
        y: THREE.MathUtils.clamp(Number(y) || 0, 12, Math.max(12, window.innerHeight - menuHeight - 12)),
    };
}

function createGodButton(label, onClick, options = {}) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.style.padding = options.compact ? '7px 9px' : '8px 10px';
    btn.style.borderRadius = '10px';
    btn.style.border = `1px solid ${options.border || 'rgba(118, 178, 255, 0.5)'}`;
    btn.style.background = options.background || 'rgba(10, 19, 36, 0.94)';
    btn.style.color = options.color || '#edf4ff';
    btn.style.fontFamily = 'Consolas, "Segoe UI", monospace';
    btn.style.fontSize = options.compact ? '11px' : '12px';
    btn.style.cursor = 'pointer';
    btn.style.pointerEvents = 'auto';
    if (!btn.style.transition) {
        btn.style.transition = 'transform 90ms ease, filter 90ms ease';
    }
    btn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        buttonFeedback(btn);
        traceDmPipeline('UI COMMAND FIRED', {
            source: options.source || 'god-ui',
            commandType: options.commandType || null,
            label,
        });
        onClick();
    });
    return btn;
}

function ensureGodContextMenu() {
    if (godContextMenuEl) return godContextMenuEl;
    const root = createDmRootUI();
    const menu = document.createElement('div');
    menu.id = 'god-context-menu';
    menu.style.position = 'fixed';
    menu.style.left = '0';
    menu.style.top = '0';
    menu.style.display = 'none';
    menu.style.minWidth = '220px';
    menu.style.maxWidth = '280px';
    menu.style.padding = '10px';
    menu.style.borderRadius = '14px';
    menu.style.border = '1px solid rgba(118, 178, 255, 0.36)';
    menu.style.background = 'rgba(4, 9, 18, 0.9)';
    menu.style.boxShadow = '0 16px 42px rgba(0, 0, 0, 0.5)';
    menu.style.backdropFilter = 'blur(10px)';
    menu.style.pointerEvents = 'auto';
    menu.style.zIndex = '98020';

    const title = document.createElement('div');
    title.style.fontFamily = 'Consolas, "Segoe UI", monospace';
    title.style.fontSize = '12px';
    title.style.letterSpacing = '0.08em';
    title.style.textTransform = 'uppercase';
    title.style.color = '#fff4cb';
    title.style.marginBottom = '4px';
    menu.appendChild(title);

    const meta = document.createElement('div');
    meta.style.fontFamily = 'Consolas, "Segoe UI", monospace';
    meta.style.fontSize = '11px';
    meta.style.color = '#9ebce8';
    meta.style.marginBottom = '8px';
    menu.appendChild(meta);

    const actions = document.createElement('div');
    actions.style.display = 'grid';
    actions.style.gridTemplateColumns = '1fr 1fr';
    actions.style.gap = '6px';
    menu.appendChild(actions);

    root.appendChild(menu);
    godContextMenuEl = menu;
    godContextMenuTitleEl = title;
    godContextMenuMetaEl = meta;
    godContextMenuActionsEl = actions;
    return godContextMenuEl;
}

function ensureGodWorldMenu() {
    if (godWorldMenuEl) return godWorldMenuEl;
    const root = createDmRootUI();
    const menu = document.createElement('div');
    menu.id = 'god-world-menu';
    menu.style.position = 'fixed';
    menu.style.left = '0';
    menu.style.top = '0';
    menu.style.display = 'none';
    menu.style.minWidth = '240px';
    menu.style.padding = '10px';
    menu.style.borderRadius = '14px';
    menu.style.border = '1px solid rgba(255, 196, 112, 0.42)';
    menu.style.background = 'rgba(8, 12, 20, 0.94)';
    menu.style.boxShadow = '0 18px 44px rgba(0, 0, 0, 0.56)';
    menu.style.backdropFilter = 'blur(10px)';
    menu.style.pointerEvents = 'auto';
    menu.style.zIndex = '98021';

    const title = document.createElement('div');
    title.style.fontFamily = 'Consolas, "Segoe UI", monospace';
    title.style.fontSize = '12px';
    title.style.letterSpacing = '0.08em';
    title.style.textTransform = 'uppercase';
    title.style.color = '#ffe9b8';
    title.style.marginBottom = '8px';
    menu.appendChild(title);

    const actions = document.createElement('div');
    actions.style.display = 'grid';
    actions.style.gridTemplateColumns = '1fr';
    actions.style.gap = '6px';
    menu.appendChild(actions);

    root.appendChild(menu);
    godWorldMenuEl = menu;
    godWorldMenuTitleEl = title;
    godWorldMenuActionsEl = actions;
    return godWorldMenuEl;
}

function hideGodWorldMenu() {
    if (!godWorldMenuEl) return;
    godUiState.worldMenuOpen = false;
    godUiState.lastWorldMenuSignature = '';
    godWorldMenuEl.style.display = 'none';
}

function hideGodContextMenu() {
    if (!godContextMenuEl) return;
    godUiState.lastContextSignature = '';
    godContextMenuEl.style.display = 'none';
}

function closeAllDmUI() {
    if (modeManager.current !== MODE.DM) return false;

    let closedAny = false;
    if (godContextMenuEl && godContextMenuEl.style.display !== 'none') {
        hideGodContextMenu();
        closedAny = true;
    }
    if (godWorldMenuEl && godWorldMenuEl.style.display !== 'none') {
        hideGodWorldMenu();
        closedAny = true;
    }
    if (dmPanelEl && dmPanelEl.style.display !== 'none') {
        dmPanelEl.style.display = 'none';
        closedAny = true;
    }
    if (closedAny) {
        setSelectedCombatTarget(null);
        appendConsoleHistory('[UI] ESC -> closed DM UI', 'ok');
    }
    return closedAny;
}

window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || event.repeat) return;
    if (isTextInputTarget(event.target)) return;
    if (closeAllDmUI()) {
        event.preventDefault();
        event.stopPropagation();
    }
});

function buttonFeedback(btn) {
    if (!btn) return;
    if (btn.__feedbackTimer) {
        clearTimeout(btn.__feedbackTimer);
        btn.__feedbackTimer = null;
    }
    const prevTransform = btn.style.transform;
    const prevFilter = btn.style.filter;
    btn.style.transform = 'scale(0.95)';
    btn.style.filter = 'brightness(1.4)';
    btn.__feedbackTimer = window.setTimeout(() => {
        btn.style.transform = prevTransform;
        btn.style.filter = prevFilter;
        btn.__feedbackTimer = null;
    }, 100);
}

function activateDmPlacementCamera(targetObject) {
    if (!isGodModeActive() || !dmCamera || !targetObject || !targetObject.position) return false;
    if (!dmPlacementCameraActive) {
        dmPlacementPrevCameraPos.copy(dmCamera.position);
        dmPlacementPrevCameraQuat.copy(dmCamera.quaternion);
        dmPlacementCameraActive = true;
    }
    dmCamera.rotation.order = 'YXZ';
    dmCamera.position.set(
        targetObject.position.x,
        targetObject.position.y + 28,
        targetObject.position.z + 0.01,
    );
    dmCamera.lookAt(targetObject.position.x, targetObject.position.y, targetObject.position.z);
    return true;
}

function updateDmPlacementCamera() {
    if (!dmPlacementCameraActive || !isGrabbing || !selectedObject || !selectedObject.position || !dmCamera) return;
    dmPlacementTargetPos.set(
        selectedObject.position.x,
        selectedObject.position.y + 28,
        selectedObject.position.z + 0.01,
    );
    dmCamera.position.lerp(dmPlacementTargetPos, 0.22);
    dmCamera.lookAt(selectedObject.position.x, selectedObject.position.y, selectedObject.position.z);
}

function stopDmPlacementCamera() {
    if (!dmPlacementCameraActive || !dmCamera) return;
    dmCamera.position.copy(dmPlacementPrevCameraPos);
    dmCamera.quaternion.copy(dmPlacementPrevCameraQuat);
    dmPlacementCameraActive = false;
}

function beginGrabPlacement(targetObject) {
    if (!targetObject || !targetObject.position) return false;
    isGrabbing = true;
    grabAxis = null;
    grabStartPosition = targetObject.position.clone();
    document.body.style.cursor = 'move';
    activateDmPlacementCamera(targetObject);
    return true;
}

function finishGrabPlacement(commit = true) {
    if (!isGrabbing) return false;
    if (!commit && selectedObject && selectedObject.position && grabStartPosition) {
        selectedObject.position.copy(grabStartPosition);
        if (selectionBoxHelper) selectionBoxHelper.update();
        updateInspectorMenu();
        if (socket) socket.emit('scene-update', serializeScene());
    }
    isGrabbing = false;
    grabAxis = null;
    grabStartPosition = null;
    document.body.style.cursor = '';
    stopDmPlacementCamera();
    return true;
}

function beginGodEntityMove(actor) {
    if (!actor || actor === playerState) return false;
    selectObject(actor);
    const started = beginGrabPlacement(actor);
    if (!started) return false;
    showFloatingText('Overhead placement: drag to reposition, Enter/Click to place, ESC to cancel.', '#9ec9ff', true, { anchorObject: actor });
    return true;
}

function applyGodDamage(actor, amount) {
    const actorId = getCombatActorId(actor);
    if (!actorId) return false;
    if (modeManager.current === MODE.DM) {
        return issueDmCommand('apply-damage', { actorId, amount });
    }
    return applyDamageToActorById(actorId, amount);
}

function setGodActorHp(actor, value) {
    const actorId = getCombatActorId(actor);
    if (!actorId) return false;
    if (modeManager.current === MODE.DM) {
        return issueDmCommand('set-hp', { actorId, value });
    }
    return setActorHpById(actorId, value);
}

function despawnGodActor(actor) {
    const actorId = getCombatActorId(actor);
    if (!actorId || actor === playerState) return false;
    if (modeManager.current === MODE.DM) {
        return issueDmCommand('despawn-actor', { actorId });
    }
    removeTrainingDummy(actor);
    return true;
}

function rebuildGodContextMenu(actor) {
    ensureGodContextMenu();
    if (!godContextMenuActionsEl || !godContextMenuTitleEl || !godContextMenuMetaEl) return;

    const actorId = getCombatActorId(actor);
    const actorLabel = getCombatActorLabel(actor);
    const hp = actor === playerState
        ? Math.max(0, Number(playerState.hp) || 0)
        : Math.max(0, Number(actor?.userData?.hp) || 0);
    const maxHp = actor === playerState
        ? Math.max(1, Number(playerState.maxHp) || 1)
        : Math.max(1, Number(actor?.userData?.maxHp) || 1);
    const signature = [
        actorId,
        currentGameMode,
        combatState.inCombat ? 'combat' : 'free',
        hp,
        maxHp,
        canIssueDmCommand('spawn-entity') ? 'spawn' : 'no-spawn',
    ].join('|');

    if (godUiState.lastContextSignature === signature) return;
    godUiState.lastContextSignature = signature;

    godContextMenuTitleEl.textContent = actorLabel;
    godContextMenuMetaEl.textContent = `${actorId || '-'} · HP ${hp}/${maxHp}`;
    godContextMenuActionsEl.innerHTML = '';

    const append = (button) => {
        godContextMenuActionsEl.appendChild(button);
    };

    if (actor !== playerState && currentGameMode !== GAME_MODE.COMBAT && !combatState.inCombat) {
        append(createGodButton('Start Combat', () => {
            requestDmStartCombat(actor);
            hideGodWorldMenu();
        }, {
            background: 'rgba(29, 82, 43, 0.95)',
            border: 'rgba(113, 214, 131, 0.75)',
        }));
    }

    append(createGodButton('Possess', () => {
        requestPossessActor(actor);
    }));

    append(createGodButton('Damage 10', () => {
        applyGodDamage(actor, 10);
    }, {
        background: 'rgba(78, 26, 26, 0.94)',
        border: 'rgba(255, 128, 128, 0.55)',
    }));

    append(createGodButton('Move', () => {
        beginGodEntityMove(actor);
    }));

    append(createGodButton('Kill', () => {
        setGodActorHp(actor, 0);
    }, {
        background: 'rgba(78, 24, 24, 0.94)',
        border: 'rgba(255, 91, 91, 0.75)',
    }));

    append(createGodButton('Focus', () => {
        setDmFollowEntity(actor, { autoSwitch: true });
    }));

    if (actor !== playerState) {
        append(createGodButton('Despawn', () => {
            despawnGodActor(actor);
        }, {
            background: 'rgba(58, 17, 17, 0.96)',
            border: 'rgba(255, 120, 120, 0.55)',
        }));
    }
}

function updateGodContextMenu() {
    if (!isGodModeActive() || isLoadingOverlayBlockingDmUi()) {
        hideGodContextMenu();
        hideGodWorldMenu();
        return;
    }

    const actor = getSelectedDmActor();
    if (!actor || !renderer || !getActiveViewCamera()) {
        hideGodContextMenu();
        return;
    }

    // Quick action popup is intentionally player-only.
    if (actor !== playerState || !dmQuickMenuArmedByLeftClick) {
        hideGodContextMenu();
        return;
    }

    ensureGodContextMenu();
    rebuildGodContextMenu(actor);

    const activeView = getActiveViewCamera();
    const heightOffset = actor === playerState ? 2.3 : 3.0;
    if (actor === playerState && playerRig && playerRig.parent) {
        playerRig.getWorldPosition(godUiAnchorPos);
    } else if (typeof actor.getWorldPosition === 'function') {
        actor.getWorldPosition(godUiAnchorPos);
    } else if (actor.position) {
        godUiAnchorPos.copy(actor.position);
    } else {
        hideGodContextMenu();
        return;
    }

    godUiAnchorPos.y += heightOffset;
    godUiAnchorPos.project(activeView);
    if (godUiAnchorPos.z > 1.1) {
        hideGodContextMenu();
        return;
    }

    const screenX = (godUiAnchorPos.x * 0.5 + 0.5) * renderer.domElement.clientWidth;
    const screenY = (-godUiAnchorPos.y * 0.5 + 0.5) * renderer.domElement.clientHeight;
    const pos = clampGodMenuPosition(screenX + 22, screenY - 12, godContextMenuEl);
    godContextMenuEl.style.left = `${pos.x}px`;
    godContextMenuEl.style.top = `${pos.y}px`;
    godContextMenuEl.style.display = 'block';
}

function rebuildGodWorldMenu() {
    ensureGodWorldMenu();
    if (!godWorldMenuActionsEl || !godWorldMenuTitleEl) return;

    const selectedActor = getSelectedDmActor();
    const signature = [
        selectedActor ? getCombatActorId(selectedActor) : 'world',
        currentGameMode,
        combatState.inCombat ? 'combat' : 'free',
        canIssueDmCommand('spawn-entity') ? 'spawn' : 'no-spawn',
        dmAutoStepEnabled ? 'play' : 'pause',
    ].join('|');
    if (godUiState.lastWorldMenuSignature === signature) return;
    godUiState.lastWorldMenuSignature = signature;

    godWorldMenuTitleEl.textContent = 'God Commands';
    godWorldMenuActionsEl.innerHTML = '';

    const append = (button) => {
        godWorldMenuActionsEl.appendChild(button);
    };

    append(createGodButton('Quick Encounter', () => {
        armPendingDmEncounterSetup({ spawnType: 'training-dummy', autoStart: true });
        requestEntitySpawn('training-dummy');
        hideGodWorldMenu();
    }));

    append(createGodButton('Spawn Enemy', () => {
        armPendingDmEncounterSetup({ spawnType: 'training-dummy', autoStart: false });
        requestEntitySpawn('training-dummy');
        hideGodWorldMenu();
    }));

    append(createGodButton('Spawn Ally Dummy', () => {
        armPendingDmEncounterSetup({ spawnType: 'player-dummy', autoStart: false });
        requestEntitySpawn('player-dummy');
        hideGodWorldMenu();
    }));

    append(createGodButton(currentGameMode === GAME_MODE.COMBAT || combatState.inCombat ? 'Combat Running' : 'Start Combat', () => {
        requestDmStartCombat(getEncounterStartTarget());
        hideGodWorldMenu();
    }, {
        background: 'rgba(29, 82, 43, 0.95)',
        border: 'rgba(113, 214, 131, 0.75)',
    }));

    append(createGodButton(dmAutoStepEnabled ? 'Pause Timeline' : 'Play Timeline', () => {
        setDmAutoStepEnabled(!dmAutoStepEnabled);
        godUiState.lastWorldMenuSignature = '';
        rebuildGodWorldMenu();
    }));

    append(createGodButton('Force Roll d20', () => {
        issueDmCommand('force-roll', { sides: 20, mod: 0, label: 'GOD FORCE ROLL' });
        hideGodWorldMenu();
    }));

    append(createGodButton('Trigger Event', () => {
        issueDmCommand('trigger-event', { message: 'GOD triggered event' });
        hideGodWorldMenu();
    }));

    append(createGodButton('Command Palette (Tab)', () => {
        setConsoleOpen(true);
        hideGodWorldMenu();
    }, {
        compact: true,
        background: 'rgba(20, 25, 38, 0.96)',
    }));
}

function showGodWorldMenu(x, y) {
    if (!isGodModeActive()) return;
    ensureGodWorldMenu();
    godUiState.worldMenuOpen = true;
    rebuildGodWorldMenu();
    const pos = clampGodMenuPosition(x, y, godWorldMenuEl);
    godWorldMenuEl.style.left = `${pos.x}px`;
    godWorldMenuEl.style.top = `${pos.y}px`;
    godWorldMenuEl.style.display = 'block';
}

function getSelectedDmActor() {
    const selected = selectedCombatTarget || (selectedObject && selectedObject.userData?.selectTarget ? selectedObject.userData.selectTarget : selectedObject);
    const selectedActor = selected && (selected === playerRig || selected === playerState || selected.userData?.isTargetable)
        ? (selected === playerRig ? playerState : selected)
        : null;
    return selectedActor;
}

function getEncounterStartTarget() {
    const actor = getSelectedDmActor();
    if (!actor || actor === playerState) return null;
    return actor;
}

function armPendingDmEncounterSetup(options = {}) {
    pendingDmEncounterSetup = {
        spawnType: normalizeSpawnEntityType(options.spawnType || 'training-dummy'),
        autoStart: !!options.autoStart,
        requestedAt: performance.now(),
    };
}

function consumePendingDmEncounterSetup(actor, entityType) {
    if (!pendingDmEncounterSetup || !actor) return false;
    if ((performance.now() - Number(pendingDmEncounterSetup.requestedAt || 0)) > 5000) {
        pendingDmEncounterSetup = null;
        return false;
    }

    const normalizedType = normalizeSpawnEntityType(entityType);
    if (pendingDmEncounterSetup.spawnType !== normalizedType) return false;

    const shouldAutoStart = pendingDmEncounterSetup.autoStart;
    pendingDmEncounterSetup = null;
    setSelectedCombatTarget(actor);
    if (modeManager.current === MODE.DM) {
        setDmFollowEntity(actor);
    }

    const actorLabel = getCombatActorLabel(actor);
    if (shouldAutoStart && modeManager.current === MODE.DM && currentGameMode !== GAME_MODE.COMBAT && !combatState.inCombat) {
        const startedCombat = requestDmStartCombat(actor);
        if (startedCombat) {
            appendConsoleHistory(`[COMBAT] Quick encounter started with ${actorLabel}`, 'ok');
            showFloatingText(`Encounter started: ${actorLabel}`, '#9ff0b2', true, { anchorObject: actor });
            return true;
        }
    }

    showFloatingText(`Selected: ${actorLabel}`, '#ffcf85', true, { anchorObject: actor });
    return true;
}

function ensurePossessionStatusUI() {
    if (possessionStatusEl) return possessionStatusEl;
    createDmRootUI();
    const el = document.createElement('div');
    el.style.position = 'relative';
    el.style.padding = '8px 12px';
    el.style.borderRadius = '8px';
    el.style.border = '1px solid rgba(255, 170, 40, 0.8)';
    el.style.background = 'rgba(20, 12, 8, 0.88)';
    el.style.color = '#ffd28c';
    el.style.fontFamily = 'Consolas, "Segoe UI", monospace';
    el.style.fontSize = '13px';
    el.style.letterSpacing = '0.4px';
    el.style.zIndex = '1';
    el.style.pointerEvents = 'none';
    el.style.display = 'none';
    if (dmCenterOverlayEl) {
        dmCenterOverlayEl.appendChild(el);
    } else {
        document.body.appendChild(el);
    }
    possessionStatusEl = el;
    return possessionStatusEl;
}

function ensureDmControlPanel() {
    if (DM_UI_V2) {
        const root = createDmRootUI();
        if (dmPanelEl && dmPanelEl.__dmV2Panel) return dmPanelEl;
        dmCommandButtonRefs.clear();
        dmStartCombatBtnEl = null;
        dmQuickEncounterBtnEl = null;
        dmSpawnTypeSelectEl = null;
        dmWhoSummaryEl = null;
        dmWhoListEl = null;
        dmEncounterSummaryEl = null;
        dmEncounterHintEl = null;

        if (dmTopBarEl) dmTopBarEl.innerHTML = '';
        if (dmLeftPanelEl) dmLeftPanelEl.innerHTML = '';
        if (dmRightPanelEl) dmRightPanelEl.innerHTML = '';
        if (dmBottomBarEl) dmBottomBarEl.innerHTML = '';
        if (dmCenterOverlayEl) dmCenterOverlayEl.innerHTML = '';

        const cardBaseStyle = (el) => {
            el.style.border = '1px solid rgba(120, 170, 255, 0.35)';
            el.style.borderRadius = '8px';
            el.style.background = 'rgba(0,0,0,0.38)';
            el.style.backdropFilter = 'blur(6px)';
            el.style.color = '#d7e6ff';
        };

        const sectionTitle = (text) => {
            const title = document.createElement('div');
            title.textContent = text;
            title.style.fontSize = '11px';
            title.style.letterSpacing = '0.08em';
            title.style.textTransform = 'uppercase';
            title.style.color = '#9fc2ff';
            return title;
        };

        const mkBtn = (label, onClick, commandType = null) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = label;
            btn.style.padding = '6px 9px';
            btn.style.borderRadius = '6px';
            btn.style.border = '1px solid rgba(132, 170, 226, 0.8)';
            btn.style.background = 'rgba(23, 34, 54, 0.92)';
            btn.style.color = '#f3f8ff';
            btn.style.fontFamily = 'Consolas, "Segoe UI", monospace';
            btn.style.fontSize = '12px';
            btn.style.cursor = 'pointer';
            btn.style.transition = 'transform 90ms ease, filter 90ms ease';
            btn.addEventListener('click', (event) => {
                buttonFeedback(btn);
                traceDmPipeline('UI COMMAND FIRED', {
                    source: 'dm-panel',
                    commandType,
                    label,
                });
                onClick(event);
            });
            if (commandType) registerDmCommandButton(btn, commandType);
            return btn;
        };

        dmAuthorityBadgeEl = null;
        dmSessionStatusEl = null;
        dmPanelInfoEl = null;

        const rightShell = document.createElement('div');
        rightShell.style.flex = '1 1 auto';
        rightShell.style.display = 'flex';
        rightShell.style.flexDirection = 'column';
        rightShell.style.gap = '8px';
        rightShell.style.padding = '8px';
        cardBaseStyle(rightShell);

        const selectedCard = document.createElement('div');
        selectedCard.style.display = 'grid';
        selectedCard.style.gridTemplateColumns = 'auto 1fr';
        selectedCard.style.gap = '4px 8px';
        selectedCard.appendChild(sectionTitle('Selected Entity'));
        const spacer = document.createElement('div');
        selectedCard.appendChild(spacer);

        const nameLabel = document.createElement('div');
        nameLabel.textContent = 'Name';
        nameLabel.style.color = '#8fb2ec';
        const nameValue = document.createElement('div');
        selectedCard.appendChild(nameLabel);
        selectedCard.appendChild(nameValue);

        const typeLabel = document.createElement('div');
        typeLabel.textContent = 'Type';
        typeLabel.style.color = '#8fb2ec';
        const typeValue = document.createElement('div');
        selectedCard.appendChild(typeLabel);
        selectedCard.appendChild(typeValue);

        const hpLabel = document.createElement('div');
        hpLabel.textContent = 'HP';
        hpLabel.style.color = '#8fb2ec';
        const hpValue = document.createElement('div');
        selectedCard.appendChild(hpLabel);
        selectedCard.appendChild(hpValue);

        const idLabel = document.createElement('div');
        idLabel.textContent = 'Actor ID';
        idLabel.style.color = '#8fb2ec';
        const idValue = document.createElement('div');
        selectedCard.appendChild(idLabel);
        selectedCard.appendChild(idValue);

        dmSelectedNameValueEl = nameValue;
        dmSelectedTypeValueEl = typeValue;
        dmSelectedHpValueEl = hpValue;
        dmSelectedActorIdValueEl = idValue;
        rightShell.appendChild(selectedCard);

        const modeCard = document.createElement('div');
        modeCard.style.display = 'flex';
        modeCard.style.alignItems = 'center';
        modeCard.style.justifyContent = 'space-between';
        modeCard.style.gap = '6px';
        modeCard.appendChild(sectionTitle('Mode'));
        const modeSelect = document.createElement('select');
        modeSelect.style.background = 'rgba(18, 26, 42, 0.95)';
        modeSelect.style.color = '#e8f0ff';
        modeSelect.style.border = '1px solid rgba(120, 170, 255, 0.65)';
        modeSelect.style.borderRadius = '6px';
        modeSelect.style.padding = '4px 7px';
        [
            { value: DM_AUTHORITY_LAYER.OBSERVER, label: 'Observer' },
            { value: DM_AUTHORITY_LAYER.PUPPETEER, label: 'Puppeteer' },
            { value: DM_AUTHORITY_LAYER.SIMULATOR, label: 'Simulator' },
        ].forEach((entry) => {
            const option = document.createElement('option');
            option.value = entry.value;
            option.textContent = entry.label;
            modeSelect.appendChild(option);
        });
        modeSelect.value = dmAuthorityLayer;
        modeSelect.addEventListener('change', () => {
            setDmAuthorityLayer(String(modeSelect.value || DM_AUTHORITY_LAYER.OBSERVER));
            updateDmControlPanel();
        });
        modeCard.appendChild(modeSelect);
        dmDmModeSelectEl = modeSelect;
        rightShell.appendChild(modeCard);

        const actionGrid = document.createElement('div');
        actionGrid.style.display = 'grid';
        actionGrid.style.gridTemplateColumns = '1fr 1fr';
        actionGrid.style.gap = '6px';
        actionGrid.appendChild(sectionTitle('Actions'));
        actionGrid.appendChild(document.createElement('div'));

        const encounterSummary = document.createElement('div');
        encounterSummary.style.gridColumn = '1 / span 2';
        encounterSummary.style.padding = '8px 10px';
        encounterSummary.style.borderRadius = '6px';
        encounterSummary.style.border = '1px solid rgba(112, 170, 255, 0.28)';
        encounterSummary.style.background = 'rgba(9, 16, 29, 0.72)';
        encounterSummary.style.color = '#e9f1ff';
        encounterSummary.style.fontSize = '12px';
        encounterSummary.style.lineHeight = '1.45';
        dmEncounterSummaryEl = encounterSummary;
        actionGrid.appendChild(encounterSummary);

        const encounterHint = document.createElement('div');
        encounterHint.style.gridColumn = '1 / span 2';
        encounterHint.style.fontSize = '11px';
        encounterHint.style.color = '#9db8e6';
        encounterHint.style.minHeight = '16px';
        dmEncounterHintEl = encounterHint;
        actionGrid.appendChild(encounterHint);

        const startCombatBtn = mkBtn('Start Combat', () => {
            const target = getEncounterStartTarget();
            const startedCombat = requestDmStartCombat(target);
            if (!startedCombat) {
                appendConsoleHistory('[COMBAT] Start request ignored (already active or unavailable)', 'error');
                return;
            }
            const label = target ? getCombatActorLabel(target) : 'no target';
            appendConsoleHistory(`[COMBAT] DM started combat (${label})`, 'ok');
        });
        startCombatBtn.style.gridColumn = '1 / span 2';
        startCombatBtn.style.background = 'rgba(35, 86, 44, 0.95)';
        startCombatBtn.style.borderColor = 'rgba(113, 214, 131, 0.9)';
        dmStartCombatBtnEl = startCombatBtn;
        actionGrid.appendChild(startCombatBtn);

        const quickEncounterBtn = mkBtn('Quick Encounter', () => {
            const type = String(spawnTypeSelect.value || 'training-dummy');
            armPendingDmEncounterSetup({ spawnType: type, autoStart: true });
            const requested = requestEntitySpawn(type);
            if (requested === false) {
                pendingDmEncounterSetup = null;
                appendConsoleHistory(`[COMBAT] Quick encounter failed to spawn ${type}`, 'error');
                return;
            }
            appendConsoleHistory(`[COMBAT] Quick encounter queued for ${type}`, 'ok');
        }, 'spawn-entity');
        quickEncounterBtn.style.background = 'rgba(82, 46, 22, 0.95)';
        quickEncounterBtn.style.borderColor = 'rgba(255, 184, 96, 0.9)';
        dmQuickEncounterBtnEl = quickEncounterBtn;
        actionGrid.appendChild(quickEncounterBtn);

        const spawnMenuTitle = document.createElement('div');
        spawnMenuTitle.textContent = 'Spawn Menu';
        spawnMenuTitle.style.gridColumn = '1 / span 2';
        spawnMenuTitle.style.fontSize = '11px';
        spawnMenuTitle.style.letterSpacing = '0.08em';
        spawnMenuTitle.style.textTransform = 'uppercase';
        spawnMenuTitle.style.color = '#9fc2ff';
        spawnMenuTitle.style.marginTop = '2px';
        actionGrid.appendChild(spawnMenuTitle);

        const spawnTypeSelect = document.createElement('select');
        spawnTypeSelect.style.background = 'rgba(18, 26, 42, 0.95)';
        spawnTypeSelect.style.color = '#e8f0ff';
        spawnTypeSelect.style.border = '1px solid rgba(120, 170, 255, 0.65)';
        spawnTypeSelect.style.borderRadius = '6px';
        spawnTypeSelect.style.padding = '4px 7px';
        [
            { value: 'training-dummy', label: 'Training Dummy' },
            { value: 'player-dummy', label: 'Player Dummy' },
            { value: 'elite-dummy', label: 'Elite Dummy' },
        ].forEach((entry) => {
            const option = document.createElement('option');
            option.value = entry.value;
            option.textContent = entry.label;
            spawnTypeSelect.appendChild(option);
        });
        actionGrid.appendChild(spawnTypeSelect);
        dmSpawnTypeSelectEl = spawnTypeSelect;

        const spawnEntityBtn = mkBtn('Spawn Selected', () => {
            const type = String(spawnTypeSelect.value || 'training-dummy');
            armPendingDmEncounterSetup({ spawnType: type, autoStart: false });
            const requested = requestEntitySpawn(type);
            if (requested === false) {
                pendingDmEncounterSetup = null;
                appendConsoleHistory(`[SPAWN] Failed to request ${type}`, 'error');
                return;
            }
            appendConsoleHistory(`[SPAWN] Requested ${type}`, 'ok');
        }, 'spawn-entity');
        spawnEntityBtn.style.background = 'rgba(58, 66, 24, 0.95)';
        spawnEntityBtn.style.borderColor = 'rgba(199, 220, 104, 0.9)';
        actionGrid.appendChild(spawnEntityBtn);

        actionGrid.appendChild(mkBtn('Possess', () => {
            const target = selectedCombatTarget;
            if (!target) return;
            issueDmCommand('possess-actor', { actorId: getCombatActorId(target) });
        }, 'possess'));
        actionGrid.appendChild(mkBtn('Release', () => {
            issueDmCommand('release-possession');
        }, 'release-possession'));
        actionGrid.appendChild(mkBtn('Focus Camera', () => {
            const target = selectedCombatTarget;
            if (!target) return;
            setDmFollowEntity(target, { autoSwitch: true });
        }));
        rightShell.appendChild(actionGrid);

        const events = document.createElement('div');
        events.id = 'dm-events';
        events.style.display = 'flex';
        events.style.flexDirection = 'column';
        events.style.gap = '4px';
        events.style.overflowY = 'auto';
        events.style.flex = '1 1 auto';
        rightShell.appendChild(events);

        if (dmLeftPanelEl) dmLeftPanelEl.appendChild(rightShell);
        dmEventLogEl = events;
        dmPanelQueueEl = null;
        dmEntitySummaryEl = selectedCard;

        const whoShell = document.createElement('div');
        whoShell.style.flex = '1 1 auto';
        whoShell.style.display = 'flex';
        whoShell.style.flexDirection = 'column';
        whoShell.style.gap = '8px';
        whoShell.style.padding = '8px';
        whoShell.style.minHeight = '0';
        cardBaseStyle(whoShell);

        const whoHeader = document.createElement('div');
        whoHeader.style.display = 'flex';
        whoHeader.style.alignItems = 'center';
        whoHeader.style.justifyContent = 'space-between';
        whoHeader.style.gap = '8px';
        whoHeader.appendChild(sectionTitle("Who's Who"));

        const whoSummary = document.createElement('div');
        whoSummary.style.fontSize = '11px';
        whoSummary.style.color = '#a8c8ff';
        whoHeader.appendChild(whoSummary);
        dmWhoSummaryEl = whoSummary;

        const whoList = document.createElement('div');
        whoList.style.display = 'flex';
        whoList.style.flexDirection = 'column';
        whoList.style.gap = '4px';
        whoList.style.overflowY = 'auto';
        whoList.style.flex = '1 1 auto';
        whoList.style.minHeight = '0';
        dmWhoListEl = whoList;

        whoShell.appendChild(whoHeader);
        whoShell.appendChild(whoList);
        if (dmRightPanelEl) dmRightPanelEl.appendChild(whoShell);

        const timelineWrap = document.createElement('div');
        timelineWrap.id = 'dm-timeline-panel';
        timelineWrap.style.width = '100%';
        timelineWrap.style.height = '100%';
        timelineWrap.style.display = DM_SHOW_TIMELINE ? 'flex' : 'none';
        timelineWrap.style.alignItems = 'center';
        timelineWrap.style.gap = '10px';
        timelineWrap.style.padding = '8px 12px';
        cardBaseStyle(timelineWrap);

        const timelineRange = document.createElement('input');
        timelineRange.type = 'range';
        timelineRange.min = '0';
        timelineRange.max = '0';
        timelineRange.value = '0';
        timelineRange.disabled = true;
        timelineRange.style.width = '100%';

        const timelineLabel = document.createElement('div');
        timelineLabel.textContent = 'Timeline';
        timelineLabel.style.color = '#d7e8ff';
        timelineLabel.style.fontFamily = 'Consolas, "Segoe UI", monospace';
        timelineLabel.style.fontSize = '12px';
        timelineLabel.style.minWidth = '120px';

        timelineRange.addEventListener('input', () => {
            if (!combatActionHistory.length) return;
            const idx = THREE.MathUtils.clamp(Number(timelineRange.value) || 0, 0, combatActionHistory.length - 1);
            const action = combatActionHistory[idx] || null;
            timelineLabel.textContent = summarizeCombatActionForTimeline(action, idx, combatActionHistory.length);
        });
        timelineRange.addEventListener('change', () => {
            if (!combatActionHistory.length) return;
            const idx = THREE.MathUtils.clamp(Number(timelineRange.value) || 0, 0, combatActionHistory.length - 1);
            void scrubDmTimelineToIndex(idx);
        });

        const playbackBar = document.createElement('div');
        playbackBar.style.display = 'flex';
        playbackBar.style.gap = '6px';
        playbackBar.appendChild(mkBtn('Play', () => setDmAutoStepEnabled(true), 'step-turn'));
        playbackBar.appendChild(mkBtn('Pause', () => setDmAutoStepEnabled(false), 'step-turn'));
        playbackBar.appendChild(mkBtn('Step', () => requestStepTurn(), 'step-turn'));
        playbackBar.appendChild(mkBtn('Rewind', () => requestRewindTurn(), 'rewind-turn'));
        playbackBar.appendChild(mkBtn('Save', () => issueDmCommand('save-snapshot', { reason: 'dm-manual' }), 'save-snapshot'));
        playbackBar.appendChild(mkBtn('Restore', () => issueDmCommand('restore-snapshot', { index: combatTimeline.length - 1 }), 'restore-snapshot'));

        const branchState = document.createElement('div');
        branchState.style.fontSize = '11px';
        branchState.style.color = '#9ec7ff';
        branchState.style.minWidth = '180px';
        dmTimelineBranchEl = branchState;

        const authoritySelect = document.createElement('select');
        authoritySelect.style.background = 'rgba(18, 26, 42, 0.95)';
        authoritySelect.style.color = '#e8f0ff';
        authoritySelect.style.border = '1px solid rgba(120, 170, 255, 0.65)';
        authoritySelect.style.borderRadius = '6px';
        authoritySelect.style.padding = '4px 7px';
        [
            { value: SIMULATION_AUTHORITY.SERVER, label: 'Server' },
            { value: SIMULATION_AUTHORITY.LOCAL_DM, label: 'Local DM' },
        ].forEach((entry) => {
            const option = document.createElement('option');
            option.value = entry.value;
            option.textContent = entry.label;
            authoritySelect.appendChild(option);
        });
        authoritySelect.value = simulationAuthority;
        authoritySelect.addEventListener('change', () => {
            issueDmCommand('set-simulation-authority', {
                authority: String(authoritySelect.value || SIMULATION_AUTHORITY.SERVER),
            });
            updateDmControlPanel();
        });

        timelineWrap.appendChild(timelineRange);
        timelineWrap.appendChild(timelineLabel);
        timelineWrap.appendChild(playbackBar);
        timelineWrap.appendChild(branchState);
        timelineWrap.appendChild(authoritySelect);
        if (dmBottomBarEl && DM_SHOW_TIMELINE) dmBottomBarEl.appendChild(timelineWrap);
        dmTimelineEl = timelineWrap;
        dmTimelineRangeEl = timelineRange;
        dmTimelineLabelEl = timelineLabel;

        const controls = document.createElement('div');
        controls.style.display = 'flex';
        controls.style.gap = '8px';
        controls.style.pointerEvents = 'auto';
        controls.appendChild(mkBtn('Spawn', () => {
            const a = Math.random() * Math.PI * 2;
            const r = 2.8 + (Math.random() * 1.6);
            const x = playerState.position.x + (Math.cos(a) * r);
            const z = playerState.position.z + (Math.sin(a) * r);
            requestTrainingDummySpawn(x, playerState.position.y, z, 'Training Dummy');
        }, 'spawn-training-dummy'));
        controls.appendChild(mkBtn('Possess', () => {
            const target = selectedCombatTarget;
            if (!target) return;
            issueDmCommand('possess-actor', { actorId: getCombatActorId(target) });
        }, 'possess'));
        controls.appendChild(mkBtn('Force Roll', () => {
            issueDmCommand('force-roll', { sides: 20, mod: 0, label: 'DM FORCE ROLL' });
        }, 'force-roll'));
        controls.appendChild(mkBtn('Trigger Event', () => {
            issueDmCommand('trigger-event', { message: 'DM triggered scripted event' });
        }, 'trigger-event'));
        if (dmCenterOverlayEl) dmCenterOverlayEl.appendChild(controls);
        dmPanelControlsEl = controls;

        dmPanelEl = root;
        dmPanelEl.__dmV2Panel = true;
        return dmPanelEl;
    }

    if (dmPanelEl) return dmPanelEl;

    const root = createDmRootUI();

    const panel = document.createElement('div');
    panel.id = 'dm-panel';
    panel.style.position = 'absolute';
    panel.style.inset = '0';
    panel.style.border = 'none';
    panel.style.background = 'transparent';
    panel.style.color = '#eaf2ff';
    panel.style.fontFamily = 'Consolas, "Segoe UI", monospace';
    panel.style.fontSize = '13px';
    panel.style.lineHeight = '1.45';
    panel.style.zIndex = '131410';
    panel.style.display = 'none';
    panel.style.pointerEvents = 'none';

    const cardBaseStyle = (el) => {
        el.style.border = '1px solid rgba(120, 170, 255, 0.35)';
        el.style.borderRadius = '8px';
        el.style.background = 'rgba(0,0,0,0.35)';
        el.style.backdropFilter = 'blur(6px)';
        el.style.color = '#d7e6ff';
    };

    const title = document.createElement('div');
    title.textContent = 'DM DIRECTOR PANEL';
    title.style.padding = '6px 10px';
    title.style.borderRadius = '8px';
    title.style.fontSize = '12px';
    title.style.fontWeight = '700';
    title.style.letterSpacing = '0.14em';
    title.style.textTransform = 'uppercase';
    title.style.color = '#a8ccff';
    title.style.pointerEvents = 'none';
    cardBaseStyle(title);
    title.style.flex = '0 0 auto';
    if (dmTopBarEl) dmTopBarEl.appendChild(title);

    const info = document.createElement('div');
    info.style.width = 'min(430px, 48vw)';
    info.style.padding = '8px 10px';
    info.style.pointerEvents = 'auto';
    cardBaseStyle(info);
    if (dmTopBarEl) dmTopBarEl.appendChild(info);
    dmPanelInfoEl = info;

    const queue = document.createElement('div');
    queue.style.width = '100%';
    queue.style.padding = '8px 10px';
    queue.style.color = '#c9dfff';
    queue.style.wordWrap = 'break-word';
    queue.style.pointerEvents = 'auto';
    cardBaseStyle(queue);
    if (dmRightPanelEl) dmRightPanelEl.appendChild(queue);
    dmPanelQueueEl = queue;

    dmTimelineEl = document.createElement('div');
    dmTimelineEl.id = 'dm-timeline-panel';
    dmTimelineEl.style.position = 'relative';
    dmTimelineEl.style.width = '100%';
    dmTimelineEl.style.height = '100%';
    dmTimelineEl.style.maxHeight = '82px';
    dmTimelineEl.style.display = DM_SHOW_TIMELINE ? 'flex' : 'none';
    dmTimelineEl.style.flexDirection = 'row';
    dmTimelineEl.style.alignItems = 'center';
    dmTimelineEl.style.gap = '8px';
    dmTimelineEl.style.padding = '8px 12px';
    dmTimelineEl.style.overflowX = 'auto';
    dmTimelineEl.style.overflowY = 'hidden';
    dmTimelineEl.style.pointerEvents = 'auto';
    cardBaseStyle(dmTimelineEl);

    dmTimelineTitleEl = document.createElement('div');
    dmTimelineTitleEl.textContent = 'Timeline';
    dmTimelineTitleEl.style.fontSize = '12px';
    dmTimelineTitleEl.style.letterSpacing = '0.08em';
    dmTimelineTitleEl.style.textTransform = 'uppercase';
    dmTimelineTitleEl.style.color = '#b9d7ff';
    dmTimelineTitleEl.style.flex = '0 0 auto';

    dmTimelineRangeEl = document.createElement('input');
    dmTimelineRangeEl.type = 'range';
    dmTimelineRangeEl.min = '0';
    dmTimelineRangeEl.max = '0';
    dmTimelineRangeEl.value = '0';
    dmTimelineRangeEl.disabled = true;
    dmTimelineRangeEl.style.width = '340px';
    dmTimelineRangeEl.style.maxWidth = '52vw';
    dmTimelineRangeEl.style.flex = '0 0 auto';
    dmTimelineRangeEl.style.cursor = 'pointer';

    dmTimelineLabelEl = document.createElement('div');
    dmTimelineLabelEl.textContent = 'DM Scrubber - waiting for combat outcomes';
    dmTimelineLabelEl.style.fontSize = '12px';
    dmTimelineLabelEl.style.color = '#e7f0ff';
    dmTimelineLabelEl.style.lineHeight = '1.35';
    dmTimelineLabelEl.style.flex = '0 0 auto';
    dmTimelineLabelEl.style.maxWidth = '420px';
    dmTimelineLabelEl.style.whiteSpace = 'nowrap';
    dmTimelineLabelEl.style.overflow = 'hidden';
    dmTimelineLabelEl.style.textOverflow = 'ellipsis';

    dmTimelineRangeEl.addEventListener('input', () => {
        if (!combatActionHistory.length) return;
        const idx = THREE.MathUtils.clamp(Number(dmTimelineRangeEl.value) || 0, 0, combatActionHistory.length - 1);
        const action = combatActionHistory[idx] || null;
        dmTimelineLabelEl.textContent = summarizeCombatActionForTimeline(action, idx, combatActionHistory.length);
    });

    dmTimelineRangeEl.addEventListener('change', () => {
        if (!combatActionHistory.length) return;
        const idx = THREE.MathUtils.clamp(Number(dmTimelineRangeEl.value) || 0, 0, combatActionHistory.length - 1);
        void scrubDmTimelineToIndex(idx);
    });

    dmTimelineEl.appendChild(dmTimelineTitleEl);
    dmTimelineEl.appendChild(dmTimelineRangeEl);
    dmTimelineEl.appendChild(dmTimelineLabelEl);
    if (dmBottomBarEl && DM_SHOW_TIMELINE) dmBottomBarEl.appendChild(dmTimelineEl);

    const controls = document.createElement('div');
    controls.style.position = 'relative';
    controls.style.display = 'flex';
    controls.style.flexWrap = 'wrap';
    controls.style.justifyContent = 'center';
    controls.style.gap = '6px';
    controls.style.padding = '10px 12px';
    controls.style.pointerEvents = 'auto';
    controls.style.maxWidth = '68vw';
    cardBaseStyle(controls);
    dmPanelControlsEl = controls;

    function makeButton(label, onClick) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = label;
        btn.style.padding = '7px 9px';
        btn.style.borderRadius = '6px';
        btn.style.border = '1px solid rgba(132, 170, 226, 0.8)';
        btn.style.background = 'rgba(23, 34, 54, 0.92)';
        btn.style.color = '#f3f8ff';
        btn.style.cursor = 'pointer';
        btn.style.fontFamily = 'inherit';
        btn.style.fontSize = '12px';
        btn.addEventListener('click', onClick);
        return btn;
    }

    controls.appendChild(makeButton('⏮ REWIND', () => {
        if (!requestRewindTurn()) {
            showFloatingText('No snapshot to rewind', '#ff8a8a', true);
        }
    }));

    controls.appendChild(makeButton('⏯ REPLAY', () => {
        void requestReplayLastAction().then((ok) => {
            if (!ok) showFloatingText('No action to replay', '#ff8a8a', true);
        }).catch(() => {
            showFloatingText('Replay failed', '#ff8a8a', true);
        });
    }));

    controls.appendChild(makeButton('▶ STEP', () => {
        if (!requestStepTurn()) {
            showFloatingText('Step unavailable', '#ff8a8a', true);
        }
    }));

    controls.appendChild(makeButton('🎭 POSSESS', () => {
        const target = selectedCombatTarget || findCombatActorById(getCurrentCombatQueueEntry()?.id || '');
        if (!target) {
            showFloatingText('Select an enemy to possess', '#ff8a8a', true);
            return;
        }
        if (!requestPossessActor(target)) {
            showFloatingText('Possession failed', '#ff8a8a', true);
        }
    }));

    controls.appendChild(makeButton('✖ RELEASE', () => {
        if (!requestReleasePossession()) {
            showFloatingText('No possession to release', '#ff8a8a', true);
        }
    }));

    controls.appendChild(makeButton('+ SPAWN', () => {
        const baseAngle = Math.random() * Math.PI * 2;
        const spawnRadius = 2.8 + (Math.random() * 1.6);
        const x = playerState.position.x + (Math.cos(baseAngle) * spawnRadius);
        const z = playerState.position.z + (Math.sin(baseAngle) * spawnRadius);
        const y = playerState.position.y;
        requestTrainingDummySpawn(x, y, z, 'Training Dummy');
    }));

    if (dmCenterOverlayEl) dmCenterOverlayEl.appendChild(controls);

    dmEventLogEl = document.createElement('div');
    dmEventLogEl.id = 'dm-event-log';
    dmEventLogEl.style.position = 'relative';
    dmEventLogEl.style.width = '100%';
    dmEventLogEl.style.flex = '1 1 auto';
    dmEventLogEl.style.minHeight = '220px';
    dmEventLogEl.style.overflowY = 'auto';
    dmEventLogEl.style.display = 'flex';
    dmEventLogEl.style.flexDirection = 'column';
    dmEventLogEl.style.gap = '4px';
    dmEventLogEl.style.padding = '8px';
    dmEventLogEl.style.pointerEvents = 'auto';
    cardBaseStyle(dmEventLogEl);
    if (dmRightPanelEl) dmRightPanelEl.appendChild(dmEventLogEl);

    root.appendChild(panel);
    dmPanelEl = panel;
    return dmPanelEl;
}

function setDmAutoStepEnabled(enabled) {
    dmAutoStepEnabled = !!enabled;
    if (dmAutoStepTimer) {
        window.clearInterval(dmAutoStepTimer);
        dmAutoStepTimer = null;
    }
    if (dmAutoStepEnabled) {
        dmAutoStepTimer = window.setInterval(() => {
            if (modeManager.current !== MODE.DM) return;
            if (currentGameMode !== GAME_MODE.COMBAT) return;
            if (combatState.timelineBusy || combatReplayActive) return;
            if (getControlledActor()) return;
            requestStepTurn();
        }, 1200);
    }
}

// DM Control Panel state cache for avoiding DOM thrashing
const dmPanelState = {
    lastActorName: '',
    lastActorType: '',
    lastControlledText: '',
    lastCameraMode: '',
    lastQueueText: '',
};

function refreshDmWhoListPanel() {
    if (!dmWhoListEl) return;

    const shortId = (id) => {
        const raw = String(id || '').trim();
        return raw ? raw.slice(0, 6) : '------';
    };
    const isPlayerDummy = (dummy) => /^dummy\s+player\b/i.test(String(dummy?.userData?.name || '').trim());

    const avatarMap = (scene && scene.userData && scene.userData.playerAvatars)
        ? scene.userData.playerAvatars
        : {};
    const playerRows = Object.values(avatarMap)
        .filter((avatar) => avatar && avatar.userData)
        .map((avatar) => ({
            id: String(avatar.userData.playerId || ''),
            actorId: String(avatar.userData.actorId || avatar.userData.playerId || ''),
            role: String(avatar.userData.playerRole || 'player').toLowerCase(),
            hp: Number.isFinite(Number(avatar.userData.hp)) ? Math.max(0, Number(avatar.userData.hp)) : null,
            maxHp: Number.isFinite(Number(avatar.userData.maxHp)) ? Math.max(1, Number(avatar.userData.maxHp)) : null,
        }))
        .filter((row) => row.role === 'player');

    const liveDummies = trainingDummies.filter((dummy) => dummy && dummy.parent);
    const enemyDummies = liveDummies.filter((dummy) => !isPlayerDummy(dummy));
    const playerDummies = liveDummies.filter((dummy) => isPlayerDummy(dummy));

    const dmId = (socket && socket.id) ? socket.id : localPlayerId;
    if (dmWhoSummaryEl) {
        dmWhoSummaryEl.textContent = `P ${playerRows.length} | D ${enemyDummies.length} | DP ${playerDummies.length}`;
    }

    dmWhoListEl.innerHTML = '';
    const addSection = (title, rows, entityRefs) => {
        const heading = document.createElement('div');
        heading.textContent = title;
        heading.style.marginTop = '4px';
        heading.style.fontSize = '11px';
        heading.style.letterSpacing = '0.06em';
        heading.style.textTransform = 'uppercase';
        heading.style.color = '#7ea6e2';
        dmWhoListEl.appendChild(heading);

        if (!rows.length) {
            const empty = document.createElement('div');
            empty.textContent = '  - none';
            empty.style.color = '#7f90ad';
            empty.style.fontSize = '12px';
            dmWhoListEl.appendChild(empty);
            return;
        }

        rows.forEach((rowText, idx) => {
            const row = document.createElement('div');
            row.textContent = rowText;
            row.style.fontSize = '12px';
            row.style.color = '#d7e6ff';
            row.style.padding = '4px 6px';
            row.style.borderRadius = '4px';
            row.style.cursor = 'pointer';
            row.style.userSelect = 'none';
            row.style.transition = 'all 0.2s';
            row.style.backgroundColor = 'transparent';

            const entity = entityRefs && entityRefs[idx];
            const isSelected = entity === selectedCombatTarget;
            if (isSelected) {
                row.style.backgroundColor = 'rgba(100, 180, 255, 0.3)';
                row.style.borderLeft = '3px solid rgba(100, 180, 255, 0.8)';
                row.style.paddingLeft = '3px';
            }

            row.addEventListener('mouseenter', () => {
                if (!isSelected) {
                    row.style.backgroundColor = 'rgba(100, 180, 255, 0.15)';
                }
            });

            row.addEventListener('mouseleave', () => {
                if (!isSelected) {
                    row.style.backgroundColor = 'transparent';
                }
            });

            row.addEventListener('click', () => {
                if (entity) {
                    setSelectedCombatTarget(entity);
                    updateDmControlPanel();
                }
            });

            dmWhoListEl.appendChild(row);
        });
    };

    const playerLines = playerRows.map((row) => {
        const hpText = Number.isFinite(row.hp) && Number.isFinite(row.maxHp) ? ` HP ${row.hp}/${row.maxHp}` : '';
        return `  - Player ${shortId(row.actorId || row.id)}${hpText}`;
    });
    const playerEntities = playerRows.map((row) => findCombatActorById(row.actorId || row.id));

    const dummyLines = enemyDummies.map((dummy) => {
        const name = String(dummy.userData?.name || 'Training Dummy');
        const hp = Math.max(0, Number(dummy.userData?.hp) || 0);
        const maxHp = Math.max(1, Number(dummy.userData?.maxHp) || 1);
        return `  - ${name} (${shortId(getCombatActorId(dummy))}) HP ${hp}/${maxHp}`;
    });
    const dummyEntities = enemyDummies;

    const playerDummyLines = playerDummies.map((dummy) => {
        const name = String(dummy.userData?.name || 'Dummy Player');
        const hp = Math.max(0, Number(dummy.userData?.hp) || 0);
        const maxHp = Math.max(1, Number(dummy.userData?.maxHp) || 1);
        return `  - ${name} (${shortId(getCombatActorId(dummy))}) HP ${hp}/${maxHp}`;
    });
    const playerDummyEntities = playerDummies;

    const dmLines = [`  - DM (you) ${shortId(dmId)}`];

    addSection('Players', playerLines, playerEntities);
    addSection('Dummies', dummyLines, dummyEntities);
    addSection('Player Dummies', playerDummyLines, playerDummyEntities);
    addSection('DM', dmLines);
}

function updateDmControlPanel() {
    const panel = ensureDmControlPanel();
    if (!panel) return;

    if (modeManager.current !== MODE.DM || isLoadingOverlayBlockingDmUi()) {
        panel.style.display = 'none';
        if (dmRootUI) dmRootUI.style.display = 'none';
        return;
    }

    if (dmRootUI) dmRootUI.style.display = 'block';
    panel.style.display = 'block';

    if (DM_UI_V2) {
        if (!dmUiV2Nuked && !isLoadingOverlayBlockingDmUi()) {
            nukeUiForDm();
            dmUiV2Nuked = true;
        }
        syncDmAuthorityLayerFromState();
        const currentEntry = getCurrentCombatQueueEntry();
        const actorName = currentEntry ? (currentEntry.name || currentEntry.id || 'Unknown') : 'None';
        const controlled = getControlledActor();
        const controlledText = controlled ? getCombatActorLabel(controlled) : 'None';
        if (dmPanelInfoEl) dmPanelInfoEl.textContent = `Turn ${actorName} | Camera ${dmCameraMode}`;
        if (dmControlledBadgeEl) dmControlledBadgeEl.textContent = `Controlled: ${controlledText}`;
        if (dmAuthorityBadgeEl) {
            const authorityText = simulationAuthority === SIMULATION_AUTHORITY.LOCAL_DM ? 'LOCAL DM' : 'SERVER';
            const controlState = simulationAuthority === SIMULATION_AUTHORITY.LOCAL_DM
                ? 'SIMULATION CONTROL ACTIVE'
                : 'SIMULATION ON SERVER';
            dmAuthorityBadgeEl.textContent = `GOD | ${dmAuthorityLayer.toUpperCase()} | ${authorityText}`;
        }
        if (dmDmModeSelectEl && dmDmModeSelectEl.value !== dmAuthorityLayer) {
            dmDmModeSelectEl.value = dmAuthorityLayer;
        }
        if (dmSessionStatusEl) {
            const stateText = String(sessionGameState || 'lobby').toUpperCase();
            const slots = Array.isArray(lobbyState?.playerSlots) ? lobbyState.playerSlots : [];
            const occupied = slots.filter((slot) => !!(slot && slot.sid)).length;
            dmSessionStatusEl.textContent = `Session ${stateText} | Players ${occupied}/4 | LMB select/drag | Tab palette`;
        }

        const selectedActor = getSelectedDmActor();
        const encounterTarget = getEncounterStartTarget();
        const canStartCombat = modeManager.current === MODE.DM
            && currentGameMode !== GAME_MODE.COMBAT
            && !combatState.inCombat;
        const canSpawn = canIssueDmCommand('spawn-entity');
        const liveEncounterCount = trainingDummies.filter((dummy) => (
            dummy &&
            dummy.parent &&
            dummy.userData &&
            dummy.userData.isTargetable &&
            (dummy.userData.hp || 0) > 0
        )).length;

        if (dmStartCombatBtnEl) {
            dmStartCombatBtnEl.disabled = !canStartCombat;
            dmStartCombatBtnEl.style.opacity = canStartCombat ? '1' : '0.45';
            dmStartCombatBtnEl.style.cursor = canStartCombat ? 'pointer' : 'not-allowed';
            dmStartCombatBtnEl.textContent = encounterTarget
                ? `Start Combat: ${getCombatActorLabel(encounterTarget)}`
                : 'Start Combat (No Target)';
        }

        if (dmSpawnTypeSelectEl) {
            dmSpawnTypeSelectEl.disabled = !canSpawn;
            dmSpawnTypeSelectEl.style.opacity = canSpawn ? '1' : '0.5';
            dmSpawnTypeSelectEl.style.cursor = canSpawn ? 'pointer' : 'not-allowed';
        }

        if (dmQuickEncounterBtnEl) {
            dmQuickEncounterBtnEl.disabled = !canSpawn || !canStartCombat;
            dmQuickEncounterBtnEl.style.opacity = (!canSpawn || !canStartCombat) ? '0.45' : '1';
            dmQuickEncounterBtnEl.style.cursor = (!canSpawn || !canStartCombat) ? 'not-allowed' : 'pointer';
        }

        if (dmEncounterSummaryEl) {
            if (!canStartCombat) {
                dmEncounterSummaryEl.textContent = 'Combat is already active. Use the timeline and turn controls to manage the encounter.';
            } else if (encounterTarget) {
                dmEncounterSummaryEl.textContent = `Ready to start. ${getCombatActorLabel(encounterTarget)} is selected as the opening encounter target.`;
            } else if (selectedActor === playerState) {
                dmEncounterSummaryEl.textContent = 'Player selected. Start combat without a target, or pick an enemy to anchor the opening turn.';
            } else if (liveEncounterCount > 0) {
                dmEncounterSummaryEl.textContent = `${liveEncounterCount} encounter target${liveEncounterCount === 1 ? '' : 's'} live in the scene. Select one from the world or the Who\'s Who list, or start combat without a target.`;
            } else {
                dmEncounterSummaryEl.textContent = 'No encounter targets are live yet. Spawn one, then start combat from this panel.';
            }
        }

        if (dmEncounterHintEl) {
            if (!canStartCombat) {
                dmEncounterHintEl.textContent = 'Encounter setup is locked while combat is active.';
            } else if (!canSpawn) {
                dmEncounterHintEl.textContent = `Current DM layer ${dmAuthorityLayer.toUpperCase()} cannot spawn. Switch to SIMULATOR for quick encounter setup.`;
            } else if (encounterTarget) {
                dmEncounterHintEl.textContent = 'Fast path: click Start Combat to use the current target, or Quick Encounter to spawn and start immediately.';
            } else {
                dmEncounterHintEl.textContent = 'Suggested flow: 1) spawn or click an enemy, 2) confirm it is selected here, 3) start combat.';
            }
        }

        if (dmSelectedNameValueEl) dmSelectedNameValueEl.textContent = selectedActor ? getCombatActorLabel(selectedActor) : 'None';
        if (dmSelectedTypeValueEl) {
            dmSelectedTypeValueEl.textContent = selectedActor === playerState
                ? 'Player'
                : selectedActor
                    ? 'Enemy'
                    : '-';
        }
        if (dmSelectedActorIdValueEl) dmSelectedActorIdValueEl.textContent = selectedActor ? String(getCombatActorId(selectedActor) || '-') : '-';
        if (dmSelectedHpValueEl) {
            if (!selectedActor) {
                dmSelectedHpValueEl.textContent = '-';
            } else if (selectedActor === playerState) {
                dmSelectedHpValueEl.textContent = `${Math.max(0, Number(playerState.hp) || 0)} / ${Math.max(1, Number(playerState.maxHp) || 1)}`;
            } else {
                dmSelectedHpValueEl.textContent = `${Math.max(0, Number(selectedActor.userData?.hp) || 0)} / ${Math.max(1, Number(selectedActor.userData?.maxHp) || 1)}`;
            }
        }

        refreshDmWhoListPanel();

        updateDmCommandButtonStates();

        updateDmTimelineUI();
        return;
    }

    const currentEntry = getCurrentCombatQueueEntry();
    const actorType = currentEntry ? (currentEntry.type === 'player' ? 'Player' : 'Enemy') : 'None';
    const actorName = currentEntry ? (currentEntry.name || currentEntry.id || 'Unknown') : 'None';
    const controlled = getControlledActor();
    const controlledText = controlled ? getCombatActorLabel(controlled) : 'None';
    
    // Only update if values changed
    if (dmPanelInfoEl && (
        dmPanelState.lastActorName !== actorName ||
        dmPanelState.lastActorType !== actorType ||
        dmPanelState.lastControlledText !== controlledText ||
        dmPanelState.lastCameraMode !== dmCameraMode
    )) {
        dmPanelInfoEl.innerHTML =
            `Current Turn: <strong>${actorName}</strong> (${actorType})<br>` +
            `Controlled: <strong>${controlledText}</strong><br>` +
            `Camera: <strong>${dmCameraMode}</strong> (1=Director 2=Tactical 3=Follow 4=Inset ESC=Free)`;
        
        dmPanelState.lastActorName = actorName;
        dmPanelState.lastActorType = actorType;
        dmPanelState.lastControlledText = controlledText;
        dmPanelState.lastCameraMode = dmCameraMode;
    }

    if (dmPanelQueueEl) {
        const queue = Array.isArray(combatState.turnQueue) ? combatState.turnQueue : [];
        let queueText = '';
        
        if (queue.length <= 0) {
            queueText = 'Queue: [empty]';
        } else {
            const currentIdx = THREE.MathUtils.clamp(combatState.currentTurnIndex || 0, 0, queue.length - 1);
            queueText = `Queue: ${queue.map((entry, index) => {
                const label = entry.name || entry.id || 'Actor';
                const wrapped = `[${label}]`;
                return index === currentIdx ? `*${wrapped}*` : wrapped;
            }).join(' -> ')}`;
        }
        
        if (dmPanelState.lastQueueText !== queueText) {
            dmPanelQueueEl.textContent = queueText;
            dmPanelState.lastQueueText = queueText;
        }
    }

    updateDmTimelineUI();
}

function updatePossessionStatusUI() {
    const ui = ensurePossessionStatusUI();
    const actor = getControlledActor();
    if (!actor || modeManager.current !== MODE.DM) {
        ui.style.display = 'none';
        updateDmControlPanel();
        return;
    }
    ui.textContent = `[ POSSESSING: ${getCombatActorLabel(actor).toUpperCase()} ]  ESC TO RELEASE`;
    ui.style.display = 'block';
    updateDmControlPanel();
}

function getControlledActor() {
    if (!controlledActor && controlledActorId) {
        controlledActor = controlledActorId === 'player'
            ? playerState
            : findCombatActorById(controlledActorId);
    }
    if (!controlledActor) return null;
    if (controlledActor === playerState || controlledActor === playerRig) return playerState;
    if (!controlledActor.parent || (controlledActor.userData?.hp || 0) <= 0) {
        controlledActor = null;
        controlledActorId = null;
        return null;
    }
    return controlledActor;
}

function getActiveInputActor() {
    if (!isDmLikeMode()) return playerState;
    return getControlledActor() || playerState;
}

function attachCameraToPlayerRigView() {
    if (!camera || !playerRig) return;
    if (camera.parent !== playerRig) {
        playerRig.add(camera);
    }
    camera.position.set(0, FREE_CAMERA_HEIGHT, 4.8);
    camera.rotation.set(pitch, 0, 0);
}

function attachCameraToPossessedActorView(actor) {
    if (!camera || !actor || actor === playerState || actor === playerRig) {
        attachCameraToPlayerRigView();
        return;
    }
    if (camera.parent !== actor) {
        actor.add(camera);
    }
    camera.position.set(0, FREE_CAMERA_HEIGHT, 4.8);
    camera.rotation.set(pitch, 0, 0);
}

function focusCameraOnPossessedActor(actor) {
    if (!actor) return;
    const focusTarget = actor === playerState ? playerRig : actor;
    focusCameraOnAction(focusTarget, { strength: 1.55, durationMs: 1200 });
}

function possessActor(actor) {
    if (!actor) return false;
    const resolved = actor === playerRig ? playerState : actor;
    if (resolved !== playerState) {
        if (!resolved.parent || (resolved.userData?.hp || 0) <= 0) return false;
    }
    controlledActor = resolved;
    controlledActorId = getCombatActorId(resolved);
    attachCameraToPossessedActorView(resolved);
    activeCamera = camera;
    focusCameraOnPossessedActor(resolved);
    showFloatingText(`POSSESSING ${getCombatActorLabel(resolved).toUpperCase()}`, '#ffcf85', true, {
        anchorObject: resolved === playerState ? playerRig : resolved,
    });
    updatePossessionStatusUI();
    return true;
}

function releasePossession() {
    const hadControl = !!getControlledActor();
    controlledActor = null;
    controlledActorId = null;
    if (isDmLikeMode()) {
        attachCameraToPlayerRigView();
        activeCamera = dmCamera || camera;
    }
    updatePossessionStatusUI();
    updateDmControlPanel();
    return hadControl;
}

function getCombatQueueEntryById(actorId) {
    if (!actorId || !Array.isArray(combatState.turnQueue)) return null;
    return combatState.turnQueue.find((entry) => entry && entry.id === actorId) || null;
}

function getCurrentCombatQueueEntry() {
    if (!Array.isArray(combatState.turnQueue) || combatState.turnQueue.length <= 0) return null;
    const index = THREE.MathUtils.clamp(combatState.currentTurnIndex || 0, 0, combatState.turnQueue.length - 1);
    return combatState.turnQueue[index] || null;
}

function syncCombatTurnQueue(preferredActorId = null) {
    const currentEntry = getCurrentCombatQueueEntry();
    const openingActorId = getCombatOpeningActorId();
    const shouldUseOpeningPriority = !preferredActorId && !currentEntry?.id;
    const preferredId = preferredActorId || currentEntry?.id || (shouldUseOpeningPriority ? openingActorId : null) || getLocalCombatActorId();
    const queue = [
        ...getConnectedCombatPlayerEntries().map((entry) => ({
            id: entry.id,
            type: 'player',
            name: entry.isLocal ? 'Player' : entry.name,
        })),
        ...trainingDummies
            .filter((dummy) => dummy && dummy.parent && (dummy.userData?.hp || 0) > 0)
            .map((dummy) => ({
                id: getCombatActorId(dummy),
                type: dummy.userData?.faction === 'player' ? 'player' : 'enemy',
                name: dummy.userData?.name || 'Enemy',
            })),
    ];
    combatState.turnQueue = queue;
    combatState.turnOrder = queue.map((entry) => {
        if (entry.type === 'player') {
            return isLocalPlayerTurnEntry(entry) ? playerState : findCombatActorById(entry.id);
        }
        return findCombatActorById(entry.id)?.userData;
    }).filter(Boolean);

    const preferredIndex = queue.findIndex((entry) => entry.id === preferredId);
    if (preferredIndex >= 0) {
        combatState.currentTurnIndex = preferredIndex;
    } else if (queue.length > 0) {
        combatState.currentTurnIndex = 0;
    } else {
        combatState.currentTurnIndex = 0;
    }

    combatState.turnIndex = combatState.currentTurnIndex;
    return queue;
}

function advanceCombatTurnQueue() {
    const previousEntry = getCurrentCombatQueueEntry();
    const previousActorId = previousEntry?.id || null;
    const previousIndex = Math.max(0, Number(combatState.currentTurnIndex) || 0);
    const queue = syncCombatTurnQueue(previousActorId);
    if (queue.length <= 0) return null;

    let anchorIndex = -1;
    if (previousActorId) {
        anchorIndex = queue.findIndex((entry) => entry && entry.id === previousActorId);
    }
    if (anchorIndex < 0) {
        // If the previous actor is gone (e.g., defeated/disconnected), keep index continuity.
        anchorIndex = THREE.MathUtils.clamp(previousIndex, 0, queue.length - 1);
    }

    combatState.currentTurnIndex = (anchorIndex + 1) % queue.length;
    combatState.turnIndex = combatState.currentTurnIndex;
    if (combatState.currentTurnIndex === 0) {
        combatState.roundNumber = Math.max(1, Number(combatState.roundNumber) || 1) + 1;
    }
    return getCurrentCombatQueueEntry();
}

function saveSnapshot(reason = 'turn-start') {
    const snapshot = createCombatSnapshot(reason);
    if (!snapshot) return null;
    combatTimeline.push(snapshot);
    if (combatTimeline.length > COMBAT_TIMELINE_MAX) {
        combatTimeline.shift();
    }
    return snapshot;
}

function recordCombatAction(actionRecord, options = {}) {
    if (!actionRecord) return null;
    const shouldBroadcast = options.broadcast !== false && isLocalCombatAuthority();
    if (combatActionHistoryCursor >= 0 && combatActionHistoryCursor < combatActionHistory.length - 1) {
        combatActionHistory.splice(combatActionHistoryCursor + 1);
    }
    const stored = cloneJsonSafe(actionRecord);
    const resolved = buildResolutionFromActionRecord(stored);
    if (resolved) {
        stored.resolution = {
            ...(stored.resolution && typeof stored.resolution === 'object' ? stored.resolution : {}),
            ...resolved,
        };
        stored.attackRoll = Number.isFinite(Number(stored.attackRoll)) ? Number(stored.attackRoll) : resolved.roll;
        stored.attackBonus = Number.isFinite(Number(stored.attackBonus)) ? Number(stored.attackBonus) : resolved.attackBonus;
        stored.attackTotal = Number.isFinite(Number(stored.attackTotal)) ? Number(stored.attackTotal) : resolved.total;
        stored.targetAC = Number.isFinite(Number(stored.targetAC)) ? Number(stored.targetAC) : resolved.targetAC;
        stored.damageRoll = Number.isFinite(Number(stored.damageRoll)) ? Number(stored.damageRoll) : resolved.damageRoll;
        stored.damageBonus = Number.isFinite(Number(stored.damageBonus)) ? Number(stored.damageBonus) : resolved.damageBonus;
        stored.damageTotal = Number.isFinite(Number(stored.damageTotal)) ? Number(stored.damageTotal) : resolved.totalDamage;
        stored.hit = typeof stored.hit === 'boolean' ? stored.hit : !!resolved.hit;
        stored.resultType = stored.resultType || resolved.resultType || 'normal';
    }
    combatActionHistory.push(stored);
    if (combatActionHistory.length > COMBAT_ACTION_HISTORY_MAX) {
        combatActionHistory.shift();
    }
    combatActionHistoryCursor = combatActionHistory.length - 1;
    lastCombatAction = stored;

    if (shouldBroadcast) {
        emitCombatActionRecord(stored);
    }

    return stored;
}

async function replayRemoteCombatActionRecord(actionRecord, options = {}) {
    if (!actionRecord || combatReplayActive) return false;

    const applied = applyRecordedCombatActionInstant(actionRecord);
    if (!applied) return false;

    if (options.instant === true) {
        return true;
    }

    if (options.allowAsyncPresentation) {
        void playRecordedCombatAction(actionRecord, {
            ...options,
            nonBlockingPresentation: true,
        });
        return true;
    }

    await playRecordedCombatAction(actionRecord, options);
    return true;
}

function applyRecordedCombatActionInstant(actionRecord) {
    if (!actionRecord || actionRecord.type !== 'attack') return false;

    const resolution = buildResolutionFromActionRecord(actionRecord);
    if (!resolution) return false;

    const actor = findCombatActorById(actionRecord.actorId);
    const target = findCombatActorById(actionRecord.targetId);
    const attackType = String(actionRecord.attackType || '').toLowerCase();
    const actorLabel = String(actionRecord.actorId || 'ENEMY').toUpperCase();

    if (attackType === 'enemy-melee') {
        triggerSharedDiceRoll({ sides: 20, label: `${actorLabel} ATTACK`, mod: resolution.attackBonus, raw: resolution.roll, total: resolution.total });
        displayAttackResult(resolution, playerRig, true);
        if (resolution.hit) {
            triggerSharedDiceRoll({ sides: 8, label: `${actorLabel} DAMAGE`, mod: resolution.damageBonus, raw: resolution.damageRoll, total: resolution.totalDamage });
        }
    } else {
        triggerSharedDiceRoll({ sides: 20, label: 'ATTACK', mod: resolution.attackBonus, raw: resolution.roll, total: resolution.total });
        if (target) {
            displayAttackResult(resolution, target, true);
        }
        if (resolution.hit) {
            const damageSides = attackType === 'ranged' ? 6 : 8;
            triggerSharedDiceRoll({ sides: damageSides, label: 'DAMAGE', mod: resolution.damageBonus, raw: resolution.damageRoll, total: resolution.totalDamage });
        }
    }

    if (actionRecord.targetDefeated && target) {
        void playKillSequence(target);
    }

    if (modeManager.current === MODE.DM || isDmObserverMode()) {
        const resultText = resolution.hit ? 'HIT' : 'MISS';
        const damageText = resolution.hit ? ` DMG ${resolution.totalDamage}` : '';
        addDmEvent(`ROLL ${resultText} (${resolution.total} vs ${resolution.targetAC})${damageText}`, resolution.hit ? 'hit' : 'miss');
    }

    updateCombatUI();
    updateDmControlPanel();
    return true;
}

function resetCombatActionHistory() {
    combatActionHistory.length = 0;
    combatActionHistoryCursor = -1;
    lastCombatAction = null;
    combatReplayActive = false;
}

function getCombatActionAtCursor(offset = 0) {
    if (combatActionHistory.length <= 0) return null;
    const baseCursor = combatActionHistoryCursor >= 0 ? combatActionHistoryCursor : (combatActionHistory.length - 1);
    const nextCursor = THREE.MathUtils.clamp(baseCursor + offset, 0, combatActionHistory.length - 1);
    combatActionHistoryCursor = nextCursor;
    const action = combatActionHistory[nextCursor] || null;
    lastCombatAction = action;
    return action;
}

function findCombatActorById(actorId) {
    if (!actorId) return null;
    if (actorId === 'player' || actorId === getLocalCombatActorId()) return playerRig;
    const avatars = scene && scene.userData && scene.userData.playerAvatars ? scene.userData.playerAvatars : null;
    if (avatars) {
        const avatar = Object.values(avatars).find((candidate) => {
            if (!candidate || !candidate.userData) return false;
            return candidate.userData.networkId === actorId
                || candidate.userData.actorId === actorId
                || candidate.userData.playerId === actorId;
        });
        if (avatar) return avatar;
    }
    return trainingDummies.find((dummy) => {
        if (!dummy || !dummy.parent) return false;
        const id = getCombatActorId(dummy);
        return id === actorId || dummy.userData?.name === actorId;
    }) || null;
}

function rebuildCombatArenaFromCurrentState() {
    if (currentGameMode !== GAME_MODE.COMBAT) return;
    const points = [playerState.position.clone()];
    for (const dummy of trainingDummies) {
        if (dummy && dummy.parent && (dummy.userData?.hp || 0) > 0) {
            points.push(dummy.position.clone());
        }
    }
    if (points.length === 0) return;
    combatCenter.set(0, 0, 0);
    for (const point of points) {
        combatCenter.add(point);
    }
    combatCenter.multiplyScalar(1 / points.length);

    let farthest = 0;
    for (const point of points) {
        farthest = Math.max(farthest, combatCenter.distanceTo(point));
    }
    combatRadius = Math.max(10, farthest + 5);

    if (combatRing && combatRing.parent) scene.remove(combatRing);
    if (combatGrid && combatGrid.parent) scene.remove(combatGrid);
    combatRing = createCombatArena(combatCenter, combatRadius);
    combatGrid = createCombatGrid(combatCenter, combatRadius);
}

function removeTrainingDummy(dummy) {
    if (!dummy) return;
    if (getControlledActor() === dummy) {
        releasePossession();
    }
    if (dummy.userData?.rigState && typeof dummy.userData.rigState.dispose === 'function') {
        dummy.userData.rigState.dispose();
    }
    if (dummy.userData) {
        dummy.userData.rigState = null;
    }
    removeEnemyHealthBar(dummy);
    if (dummy.parent) dummy.parent.remove(dummy);
    const index = trainingDummies.indexOf(dummy);
    if (index !== -1) trainingDummies.splice(index, 1);
    if (currentGameMode === GAME_MODE.COMBAT) {
        syncCombatTurnQueue();
    }
}

function updateTrainingDummyIdleAnimations(delta) {
    if (!Number.isFinite(delta) || delta <= 0) return;
    for (const dummy of trainingDummies) {
        if (!dummy || !dummy.parent) continue;
        const rigState = dummy.userData?.rigState;
        if (!rigState || !rigState.active || typeof rigState.update !== 'function') continue;
        rigState.update(delta, 0, {
            isAirborne: false,
            verticalVelocity: 0,
            isFlying: false,
        });
    }
}

function resetCombatPresentationState() {
    if (diceCinematicTimer) {
        window.clearTimeout(diceCinematicTimer);
        diceCinematicTimer = null;
    }
    if (outcomeFocusTimer) {
        window.clearTimeout(outcomeFocusTimer);
        outcomeFocusTimer = null;
    }
    if (outcomeFocusEl) {
        outcomeFocusEl.style.display = 'none';
        outcomeFocusEl.style.opacity = '0';
        outcomeFocusEl.style.animation = 'none';
    }
    combatPresentationBusy = false;
    combatHitStopUntil = 0;
    turnEndRequired = false;
    pendingTurnEndRequired = false;
    softActionPromptShown = false;
    hoveredMoveWorldPos = null;
    hoveredTargetPreview = null;
    pendingPostMoveAttack = null;
    setCombatUiSuppressed(false);
    setCombatMessageLock(false);
    clearActiveCombatMessage(true);
    combatMessageState.recentByKey.clear();
    endDiceCinematic();
    hideEndTurnPrompt();
    hideCombatConfirmUI();
    hideTargetPreview();
    clearCombatMoveTiles();
}

function applyCombatState(snapshot) {
    if (!snapshot) return false;

    clearTurnEndState();
    resetCombatPresentationState();
    pendingAction = null;
    dmOverride = null;
    resetCombatInteraction();
    currentGameMode = snapshot.gameMode === GAME_MODE.COMBAT ? GAME_MODE.COMBAT : GAME_MODE.FREE;

    playerState.position.set(
        snapshot.playerState?.position?.x || 0,
        snapshot.playerState?.position?.y || 0,
        snapshot.playerState?.position?.z || 0,
    );
    playerState.prevPosition.set(
        snapshot.playerState?.prevPosition?.x || playerState.position.x,
        snapshot.playerState?.prevPosition?.y || playerState.position.y,
        snapshot.playerState?.prevPosition?.z || playerState.position.z,
    );
    playerState.velocity.set(0, 0, 0);
    playerState.hp = Number(snapshot.playerState?.hp) || playerState.hp;
    playerState.maxHp = Number(snapshot.playerState?.maxHp) || playerState.maxHp;
    playerState.reactionAvailable = snapshot.playerState?.reactionAvailable !== false;
    syncPlayerRigFromState();
    updatePlayerHealthHud();

    const enemySnapshots = Array.isArray(snapshot.enemies) ? snapshot.enemies : [];
    // Use backend's authoritative actor IDs as key (no fallback to counter)
    const existingById = new Map(trainingDummies
        .filter((d) => d && d.userData?.actorId)
        .map((dummy) => [String(dummy.userData.actorId), dummy]));
    const snapshotIds = new Set(enemySnapshots
        .filter((e) => e && e.actorId)
        .map((enemy) => String(enemy.actorId)));
    // Remove dummies not in snapshot
    for (const dummy of [...trainingDummies]) {
        const dummyActorId = dummy.userData?.actorId;
        if (!dummyActorId || !snapshotIds.has(String(dummyActorId))) {
            removeTrainingDummy(dummy);
        }
    }
    // Sync/create dummies from authoritative snapshot
    for (const enemyState of enemySnapshots) {
        const actorId = String(enemyState.actorId || '').trim();
        if (!actorId) {
            console.warn('[COMBAT] Skipping enemy snapshot without actorId:', enemyState);
            continue;
        }
        let dummy = existingById.get(actorId);
        if (!dummy || !dummy.parent) {
            dummy = spawnTrainingDummy(
                enemyState.position?.x || 0,
                enemyState.position?.y || 0,
                enemyState.position?.z || 0,
                enemyState.name || 'Training Dummy'
            );
        }
        // Authoritative actor ID from backend
        dummy.userData.actorId = actorId;
        dummy.userData.networkId = enemyState.networkId || actorId;
        dummy.position.set(
            enemyState.position?.x || 0,
            (enemyState.position?.y || 0) + TRAINING_DUMMY_Y_OFFSET,
            enemyState.position?.z || 0,
        );
        dummy.rotation.y = Number(enemyState.rotationY) || 0;
        dummy.userData.hp = Number(enemyState.hp) || 0;
        dummy.userData.maxHp = Number(enemyState.maxHp) || 50;
        dummy.userData.radius = Number(enemyState.radius) || 0.5;
        dummy.userData.movementRemaining = Number(enemyState.movementRemaining) || 30;
        dummy.userData.actionAvailable = enemyState.actionAvailable !== false;
        dummy.userData.playerSpotted = !!enemyState.playerSpotted;
        dummy.userData.ac = Number(enemyState.ac) || 12;
        dummy.userData.attackBonus = Number(enemyState.attackBonus) || 4;
        dummy.userData.damageRoll = Number(enemyState.damageRoll) || TRAINING_DUMMY_DAMAGE;
        dummy.userData.damageBonus = Number(enemyState.damageBonus) || 0;
    }

    combatState.phase = snapshot.combatState?.phase || 'PLAYER';
    combatState.turnIndex = Number(snapshot.combatState?.turnIndex) || 0;
    combatState.player.actionUsed = !!snapshot.combatState?.player?.actionUsed;
    combatState.player.bonusUsed = !!snapshot.combatState?.player?.bonusUsed;
    combatState.player.movementRemaining = Number(snapshot.combatState?.player?.movementRemaining);
    if (!Number.isFinite(combatState.player.movementRemaining)) {
        combatState.player.movementRemaining = 30;
    }
    combatState.player.hasActed = !!snapshot.combatState?.player?.hasActed;
    combatState.lock = false;
    combatState.timelineBusy = false;
    const restoredQueue = Array.isArray(snapshot.combatState?.turnQueue) ? snapshot.combatState.turnQueue : [];
    const restoredCurrentActorId = restoredQueue.length > 0
        ? restoredQueue[Math.min(Number(snapshot.combatState?.currentTurnIndex) || 0, restoredQueue.length - 1)]?.id
        : 'player';
    combatState.currentTurnIndex = Number(snapshot.combatState?.currentTurnIndex) || 0;
    combatState.inCombat = currentGameMode === GAME_MODE.COMBAT;
    combatState.roundNumber = Number(snapshot.combatState?.roundNumber) || 0;

    if (currentGameMode === GAME_MODE.COMBAT) {
        setCombatPhase(snapshot.turnPhase ? turnPhaseToCombatPhase(snapshot.turnPhase) : combatState.phase);
    } else {
        currentTurnPhase = TURN_PHASE.IDLE;
        combatState.phase = 'TRANSITION';
    }
    setCombatTimelineBusy(false);
    setCombatLock(false);
    syncCombatPlayerToLegacyState();

    if (currentGameMode === GAME_MODE.COMBAT) {
        activateCombatCamera();
        rebuildCombatArenaFromCurrentState();
        syncCombatTurnQueue(restoredCurrentActorId || getLocalCombatActorId());
        showActionUI(combatState.phase === 'PLAYER');
    } else {
        deactivateCombatCamera();
        if (combatRing && combatRing.parent) { scene.remove(combatRing); combatRing = null; }
        if (combatGrid && combatGrid.parent) { scene.remove(combatGrid); combatGrid = null; }
        combatState.turnQueue = [];
        combatState.turnOrder = [];
        showActionUI(false);
    }

    const restoredUi = snapshot.ui || null;
    pendingAction = restoredUi?.pendingAction || null;
    currentAction = restoredUi?.currentAction || null;
    combatInteraction.action = currentAction;
    setSelectedCombatTarget(restoredUi?.selectedTargetName
        ? trainingDummies.find((dummy) => dummy?.userData?.name === restoredUi.selectedTargetName) || null
        : null);
    if (restoredUi?.hoveredMoveWorldPos && currentGameMode === GAME_MODE.COMBAT && combatState.phase === 'PLAYER') {
        hoveredMoveWorldPos = new THREE.Vector3(
            Number(restoredUi.hoveredMoveWorldPos.x) || 0,
            Number(restoredUi.hoveredMoveWorldPos.y) || 0,
            Number(restoredUi.hoveredMoveWorldPos.z) || 0,
        );
    }
    if (isPlayerInputTurn()) {
        rebuildCombatMoveTiles();
        syncTurnExhaustionState();
    }
    updateCombatUI();
    updateActionMenu();
    return true;
}

function loadSnapshot(index) {
    if (!Number.isInteger(index) || index < 0 || index >= combatTimeline.length) return false;
    return applyCombatState(cloneJsonSafe(combatTimeline[index]));
}

function restoreCombatSnapshot(snapshot, options = {}) {
    if (!snapshot) return false;
    const restored = applyCombatState(cloneJsonSafe(snapshot));
    if (!restored) return false;

    if (options.restoreTimelineState === true) {
        const idx = combatTimeline.findIndex((entry) => entry === snapshot);
        if (idx >= 0) {
            combatActionHistoryCursor = options.setCursor === false ? combatActionHistoryCursor : idx;
        }
    }
    return true;
}

function rewindTurn() {
    if (combatReplayActive || combatState.timelineBusy) return false;
    if (combatTimeline.length < 2) return false;
    combatTimeline.pop();
    return loadSnapshot(combatTimeline.length - 1);
}

async function runActionPresentationPhase(kind, phase, replayTiming, options = {}) {
    const manager = ensureInputPresentationManager();
    const contract = manager.beginActionPhase(kind, phase, options);
    const hitStopWaitMs = contract.hitStopMs > 0
        ? Math.max(20, Math.min(70, Number(contract.hitStopMs) || 0))
        : 0;

    try {
        if (typeof options.onEnter === 'function') {
            await options.onEnter(contract);
        }

        if (contract.hitStopMs > 0) {
            await hitStop(contract.hitStopMs);
        }

        const delayMs = Math.max(0, contract.durationMs - hitStopWaitMs);
        if (delayMs > 0) {
            await timelineDelay(delayMs, replayTiming);
        }

        if (typeof options.onExit === 'function') {
            await options.onExit(contract);
        }
    } finally {
        manager.endActionPhase(contract, options.payload || null);
    }
}

async function playRecordedCombatAction(actionRecord, options = {}) {
    if (!actionRecord || actionRecord.type !== 'attack') return false;

    const replayOffsetMs = Math.max(0, Number(options.offsetMs) || 0);
    const replayTiming = { remainingOffsetMs: replayOffsetMs };

    const resolution = buildResolutionFromActionRecord(actionRecord);
    if (!resolution) return false;

    const actor = findCombatActorById(actionRecord.actorId);
    const target = findCombatActorById(actionRecord.targetId);
    const startFov = camera ? camera.fov : 58;

    const nonBlockingPresentation = options.nonBlockingPresentation === true;

    if (!nonBlockingPresentation) {
        setCombatTimelineBusy(true);
        setCombatLock(true);
        setCombatMessageLock(true);
    }

    try {
        if (actionRecord.attackType === 'melee') {
            await runActionPresentationPhase('attack', 'anticipation', replayTiming, {
                durationMs: 120,
                animationMs: 220,
                payload: { attackType: 'melee' },
                onEnter: async () => {
                    beginDiceCinematic(8200);
                    focusCameraOnAction(playerState, { strength: 1.45, durationMs: 1300 });
                    await tweenCameraFov(43, 220);
                    showFloatingText('CHARGE UP', '#ffd166', true, { anchorObject: playerRig });
                },
            });

            await runActionPresentationPhase('attack', 'windup', replayTiming, {
                durationMs: MELEE_TIMELINE_MS.windup + MELEE_TIMELINE_MS.rollHold,
                animationMs: 260,
                payload: { attackType: 'melee' },
                onEnter: () => {
                    triggerSharedDiceRoll({ sides: 20, label: 'ATTACK', mod: resolution.attackBonus, raw: resolution.roll, total: resolution.total });
                    if (target) spawnVisualDice(resolution.roll, 20, target, 'ATTACK ROLL');
                    showFloatingText(`Roll: ${resolution.total}`, '#ffe08a', true, { anchorObject: target || playerRig });
                },
            });

            await runActionPresentationPhase('attack', 'impact', replayTiming, {
                durationMs: MELEE_TIMELINE_MS.impactHold,
                animationMs: 220,
                hitStopMs: 120,
                payload: { attackType: 'melee', hit: !!resolution.hit },
                onEnter: () => {
                    if (target) {
                        focusCameraOnAction(target, { strength: 1.85, durationMs: 1350 });
                        triggerLocalHammerAttackSwing();
                    }
                },
            });

            await runActionPresentationPhase('attack', 'recovery', replayTiming, {
                durationMs: MELEE_TIMELINE_MS.resultHold,
                animationMs: 240,
                payload: { attackType: 'melee', resultType: resolution.resultType || 'normal' },
                onEnter: async () => {
                    if (target) displayAttackResult(resolution, target, true);
                    if (resolution.hit && target) {
                        triggerSharedDiceRoll({ sides: 8, label: 'DAMAGE', mod: resolution.damageBonus, raw: resolution.damageRoll, total: resolution.totalDamage });
                        spawnVisualDice(resolution.damageRoll, 8, target, 'DAMAGE');
                        showFloatingText(`-${resolution.totalDamage}`, '#ff6b6b', true, { anchorObject: target });
                        triggerEnemyFlinch(target);
                        spawnImpactBurst(target.position, 0x00ff00, 24);
                        triggerCombatFlash('#00ff00', 0.12, 300);
                        shakeScreen(0.22, 420);
                        playCombatSfxCue('melee-hit');
                        if (actionRecord.targetDefeated) {
                            await playKillSequence(target);
                        }
                    } else if (target) {
                        spawnImpactBurst(target.position, 0xff7878, 12);
                        triggerCombatFlash('#ff3333', 0.08, 240);
                        shakeScreen(0.06, 150);
                        playCombatSfxCue('miss');
                    }
                },
            });

            await runActionPresentationPhase('attack', 'settle', replayTiming, {
                durationMs: MELEE_TIMELINE_MS.damageHold,
                animationMs: 160,
                payload: { attackType: 'melee' },
            });
        } else if (actionRecord.attackType === 'ranged') {
            let shot = null;
            await runActionPresentationPhase('attack', 'anticipation', replayTiming, {
                durationMs: 120,
                animationMs: 220,
                payload: { attackType: 'ranged' },
                onEnter: async () => {
                    beginDiceCinematic(8000);
                    focusCameraOnAction(playerState, { strength: 1.35, durationMs: 1250 });
                    await tweenCameraFov(44, 220);
                    showFloatingText('CHANNELING', '#66ccff', true, { anchorObject: playerRig });
                },
            });

            await runActionPresentationPhase('attack', 'windup', replayTiming, {
                durationMs: RANGED_TIMELINE_MS.windup + RANGED_TIMELINE_MS.launchHold,
                animationMs: 260,
                payload: { attackType: 'ranged' },
                onEnter: () => {
                    if (target) {
                        focusOutcomeText('ARCANE SHOT', '#66ccff', 1400);
                        showFloatingText('ARCANE SHOT', '#66ccff', true, { anchorObject: target });
                    }
                    shot = target
                        ? createTargetingLine(playerState.position.clone(), target.position.clone(), 0x66ccff, 1, { alwaysOnTop: true, opacity: 0.98 })
                        : null;
                    if (shot) scene.add(shot);
                },
                onExit: () => {
                    if (shot && shot.parent) shot.parent.remove(shot);
                },
            });

            await runActionPresentationPhase('attack', 'impact', replayTiming, {
                durationMs: RANGED_TIMELINE_MS.impactHold,
                animationMs: 220,
                hitStopMs: 120,
                payload: { attackType: 'ranged', hit: !!resolution.hit },
                onEnter: () => {
                    if (target) {
                        focusCameraOnAction(target, { strength: 1.75, durationMs: 1300 });
                        triggerEnemyFlinch(target);
                        spawnImpactBurst(target.position, 0x66ccff, 26);
                    }
                    triggerCombatFlash('#66ccff', 0.12, 320);
                    shakeScreen(0.18, 360);
                    playCombatSfxCue('ranged-hit');
                },
            });

            await runActionPresentationPhase('attack', 'recovery', replayTiming, {
                durationMs: RANGED_TIMELINE_MS.resultHold,
                animationMs: 220,
                payload: { attackType: 'ranged', resultType: resolution.resultType || 'normal' },
                onEnter: async () => {
                    focusOutcomeText(resolution.hit ? 'HIT' : 'MISS', resolution.hit ? '#00ff00' : '#ff4444', 1500);
                    showFloatingText(resolution.hit ? 'HIT' : 'MISS', resolution.hit ? '#00ff00' : '#ff4444', true, { anchorObject: target || playerRig });

                    if (resolution.hit && target) {
                        showFloatingText(`-${resolution.totalDamage}`, '#ff6b6b', true, { anchorObject: target });
                        logCombatEvent(`Replay: ranged hit ${target.userData.name || 'target'} for ${resolution.totalDamage}`, 'hit');
                        if (actionRecord.targetDefeated) {
                            await playKillSequence(target);
                        }
                    } else {
                        playCombatSfxCue('miss');
                    }
                },
            });

            await runActionPresentationPhase('attack', 'settle', replayTiming, {
                durationMs: RANGED_TIMELINE_MS.damageHold,
                animationMs: 160,
                payload: { attackType: 'ranged' },
            });
        } else if (actionRecord.attackType === 'enemy-melee') {
            await runActionPresentationPhase('enemy-attack', 'anticipation', replayTiming, {
                durationMs: 130,
                animationMs: 240,
                payload: { attackType: 'enemy-melee' },
                onEnter: async () => {
                    beginDiceCinematic(7600);
                    if (actor) focusCameraOnAction(actor, { strength: 1.45, durationMs: 1300 });
                    await tweenCameraFov(44, 240);
                    showFloatingText(`${String(actionRecord.actorId || 'ENEMY').toUpperCase()} PREPARES`, '#ffb3a7', true, { anchorObject: actor || playerRig });
                    playConfirmAttackSnap();
                },
            });

            await runActionPresentationPhase('enemy-attack', 'windup', replayTiming, {
                durationMs: ENEMY_TIMELINE_MS.windup + ENEMY_TIMELINE_MS.rollHold,
                animationMs: 240,
                payload: { attackType: 'enemy-melee' },
                onEnter: () => {
                    triggerSharedDiceRoll({ sides: 20, label: `${String(actionRecord.actorId || 'ENEMY').toUpperCase()} ATTACK`, mod: resolution.attackBonus, raw: resolution.roll, total: resolution.total });
                    spawnVisualDice(resolution.roll, 20, playerRig, `${String(actionRecord.actorId || 'ENEMY').toUpperCase()} ATTACK`);
                    showFloatingText(`Roll: ${resolution.total}`, '#ffe08a', true, { anchorObject: playerRig });
                },
            });

            await runActionPresentationPhase('enemy-attack', 'impact', replayTiming, {
                durationMs: ENEMY_TIMELINE_MS.impactHold,
                animationMs: 220,
                hitStopMs: 130,
                payload: { attackType: 'enemy-melee', hit: !!resolution.hit },
                onEnter: () => {
                    focusCameraOnAction(playerState, { strength: 1.8, durationMs: 1350 });
                    displayAttackResult(resolution, playerRig, true);
                },
            });

            await runActionPresentationPhase('enemy-attack', 'recovery', replayTiming, {
                durationMs: ENEMY_TIMELINE_MS.resultHold,
                animationMs: 200,
                payload: { attackType: 'enemy-melee', resultType: resolution.resultType || 'normal' },
                onEnter: () => {
                    if (resolution.hit) {
                        showFloatingText(`-${resolution.totalDamage}`, '#ff6b6b', true, { anchorObject: playerRig });
                        spawnImpactBurst(playerState.position, 0xff4444, 28);
                        shakeScreen(0.2, 320);
                        triggerCombatFlash('#ff2d2d', 0.22, 380);
                        playCombatSfxCue('enemy-hit-player');
                        playConfirmAttackSnap();
                    } else {
                        playCombatSfxCue('miss');
                    }
                },
            });

            await runActionPresentationPhase('enemy-attack', 'settle', replayTiming, {
                durationMs: ENEMY_TIMELINE_MS.damageHold,
                animationMs: 160,
                payload: { attackType: 'enemy-melee' },
            });
        }
    } finally {
        await tweenCameraFov(startFov, 320);
        if (!nonBlockingPresentation) {
            setCombatMessageLock(false);
            setCombatTimelineBusy(false);
            setCombatLock(false);
        }
        endDiceCinematic();
    }

    return true;
}

async function replayLastAction() {
    if (combatReplayActive || combatState.timelineBusy) return false;
    const actionRecord = getCombatActionAtCursor(0);
    if (!actionRecord) return false;
    const before = cloneJsonSafe(actionRecord.snapshotBefore);
    const after = cloneJsonSafe(actionRecord.snapshotAfter);
    if (!before || !after) return false;

    combatReplayActive = true;
    try {
        applyCombatState(before);
        showFloatingText('REPLAY', '#9ad1ff', true, { priority: MESSAGE_PRIORITY.CRITICAL });
        triggerCombatFlash('#9ad1ff', 0.12, 280);
        await delay(260);
        await playRecordedCombatAction(actionRecord);
        applyCombatState(after);
        return true;
    } finally {
        combatReplayActive = false;
    }
}

function consumeDmOverride(baseResolution) {
    if (!dmOverride) return baseResolution;
    const override = dmOverride;
    dmOverride = null;
    const next = {
        ...baseResolution,
        ...override,
    };
    if (Number.isFinite(override.roll)) next.roll = override.roll;
    if (Number.isFinite(override.attackBonus)) next.attackBonus = override.attackBonus;
    if (Number.isFinite(override.targetAC)) next.targetAC = override.targetAC;
    if (Number.isFinite(override.total)) {
        next.total = override.total;
    } else {
        next.total = (Number(next.roll) || 0) + (Number(next.attackBonus) || 0);
    }
    if (typeof override.hit === 'boolean') next.hit = override.hit;
    if (!next.hit) {
        next.damageRoll = 0;
        next.damageBonus = 0;
        next.totalDamage = 0;
    } else if (Number.isFinite(override.damage)) {
        next.damageRoll = override.damage;
        next.damageBonus = 0;
        next.totalDamage = override.damage;
    } else {
        next.totalDamage = (Number(next.damageRoll) || 0) + (Number(next.damageBonus) || 0);
    }
    if (!override.resultType) {
        if (next.roll === 20) next.resultType = 'crit';
        else if (next.roll === 1) next.resultType = 'fumble';
        else next.resultType = next.hit ? 'normal' : 'normal';
    }
    return next;
}

function combatPhaseToTurnPhase(phase) {
    if (phase === 'ENEMY') return TURN_PHASE.ENEMY;
    if (phase === 'TRANSITION') return TURN_PHASE.TRANSITION;
    return TURN_PHASE.PLAYER;
}

function syncCombatPlayerToLegacyState() {
    playerState.movementRemaining = Math.max(0, combatState.player.movementRemaining);
    playerState.actionAvailable = !combatState.player.actionUsed;
    playerState.bonusActionAvailable = !combatState.player.bonusUsed;
    if (Number.isFinite(playerState.actionsRemaining)) {
        playerState.actionsRemaining = playerState.actionAvailable ? 1 : 0;
    }
}

function setCombatPhase(phase) {
    combatState.phase = phase;
    currentTurnPhase = combatPhaseToTurnPhase(phase);
}

function setCombatLock(locked) {
    combatState.lock = !!locked;
    if (combatState.lock) {
        lockPlayerInput(true);
    }
}

function setCombatTimelineBusy(busy) {
    combatState.timelineBusy = !!busy;
    combatPresentationBusy = combatState.timelineBusy;
}

function isInputLockedForCombat(inputType = 'GENERAL') {
    if (currentGameMode !== GAME_MODE.COMBAT) return false;
    if (turnEndRequired && inputType !== 'END_TURN') return true;
    if (inputType === 'END_TURN') return false;
    return combatState.lock;
}

function tryUseAction() {
    if (combatState.player.actionUsed) return false;
    combatState.player.actionUsed = true;
    combatState.player.hasActed = true;
    syncCombatPlayerToLegacyState();
    return true;
}

function tryMove(costFeet) {
    const normalizedCost = Math.max(0, Math.round(Number(costFeet) || 0));
    if (normalizedCost <= 0) return false;
    if (combatState.player.movementRemaining < normalizedCost) return false;
    combatState.player.movementRemaining -= normalizedCost;
    syncCombatPlayerToLegacyState();
    return true;
}

function getMoveCostFeet(fromPos, toPos) {
    if (!fromPos || !toPos) return COMBAT_TILE_FEET;
    const distFeet = unitsToFeet(getDistance(fromPos, toPos));
    return Math.max(COMBAT_TILE_FEET, Math.ceil(distFeet / COMBAT_TILE_FEET) * COMBAT_TILE_FEET);
}

function isTurnEndPresentationBlocked() {
    return combatState.timelineBusy || combatMessageState.locked || !!combatMessageState.active;
}

function checkTurnEndRequired() {
    if (modeManager.current === MODE.DM) {
        clearTurnEndState();
        return;
    }
    if (currentGameMode !== GAME_MODE.COMBAT) return;
    if (combatState.phase !== 'PLAYER') return;
    if (!isTurnExhausted()) {
        pendingTurnEndRequired = false;
        return;
    }
    if (turnEndRequired) return;
    if (isTurnEndPresentationBlocked()) {
        pendingTurnEndRequired = true;
        setCombatLock(true);
        hideEndTurnPrompt();
        return;
    }
    pendingTurnEndRequired = false;
    setCombatLock(true);
    showEndTurnOverlay();
}

function showEndTurnOverlay() {
    enterTurnEndState();
}

function canPlayerMove() {
    if (!hasModePermission('player.combatInput')) {
        if (!(modeManager.current === MODE.DM && getControlledActor() === playerState)) {
            return false;
        }
    }
    if (currentGameMode === GAME_MODE.FREE) return true;
    return isPlayerInputTurn() && !isInputLockedForCombat('MOVE') && combatState.player.movementRemaining > 0;
}

function canAttack() {
    if (!hasModePermission('player.combatInput')) {
        if (!(modeManager.current === MODE.DM && getControlledActor() === playerState)) {
            return false;
        }
    }
    return currentGameMode === GAME_MODE.COMBAT &&
        combatState.phase === 'PLAYER' &&
        !isInputLockedForCombat('ACTION') &&
        !combatState.player.actionUsed;
}

function isActionUsedButCanMove() {
    // Stage 1: Action exhausted but movement remains
    return currentGameMode === GAME_MODE.COMBAT &&
        combatState.phase === 'PLAYER' &&
        combatState.player.actionUsed &&
        combatState.player.movementRemaining > 0;
}

function isTurnExhausted() {
    // Stage 2: Both action AND movement exhausted.
    return currentGameMode === GAME_MODE.COMBAT &&
        combatState.phase === 'PLAYER' &&
        combatState.player.actionUsed &&
        combatState.player.movementRemaining <= 0;
}

function stopTurnEndFlash() {
    if (turnEndFlashInterval) {
        window.clearInterval(turnEndFlashInterval);
        turnEndFlashInterval = null;
    }
}

function lockPlayerInput(locked) {
    if (!locked) return;
    resetTransientInputState();
    releasePointerLockIfActive();
    if (playerState && playerState.velocity) {
        playerState.velocity.x = 0;
        playerState.velocity.z = 0;
    }
}

function ensureTurnEndOverlay() {
    if (turnEndOverlay) return turnEndOverlay;

    turnEndOverlay = document.createElement('div');
    turnEndOverlay.id = 'turn-end-overlay';
    turnEndOverlay.style.position = 'fixed';
    turnEndOverlay.style.inset = '0';
    turnEndOverlay.style.display = 'none';
    turnEndOverlay.style.alignItems = 'center';
    turnEndOverlay.style.justifyContent = 'center';
    turnEndOverlay.style.padding = '24px';
    turnEndOverlay.style.background = 'rgba(18, 0, 0, 0.4)';
    turnEndOverlay.style.backdropFilter = 'blur(3px) brightness(0.65)';
    turnEndOverlay.style.zIndex = '130500';
    turnEndOverlay.style.pointerEvents = 'auto';

    turnEndOverlayCard = document.createElement('div');
    turnEndOverlayCard.style.minWidth = 'min(460px, calc(100vw - 40px))';
    turnEndOverlayCard.style.maxWidth = 'min(560px, calc(100vw - 40px))';
    turnEndOverlayCard.style.padding = '26px 30px';
    turnEndOverlayCard.style.border = '2px solid rgba(255, 68, 68, 0.95)';
    turnEndOverlayCard.style.borderRadius = '16px';
    turnEndOverlayCard.style.background = 'rgba(100, 0, 0, 0.88)';
    turnEndOverlayCard.style.boxShadow = '0 24px 72px rgba(0,0,0,0.72), 0 0 36px rgba(255,40,40,0.32)';
    turnEndOverlayCard.style.color = '#fff5f5';
    turnEndOverlayCard.style.fontFamily = 'Consolas, "Segoe UI", monospace';
    turnEndOverlayCard.style.textAlign = 'center';
    turnEndOverlayCard.style.cursor = 'pointer';
    turnEndOverlayCard.style.userSelect = 'none';
    turnEndOverlayCard.style.transition = 'transform 140ms ease, box-shadow 140ms ease, background 180ms ease';
    turnEndOverlayCard.innerHTML = `
        <div style="font-size:30px;font-weight:900;letter-spacing:0.12em;text-transform:uppercase;line-height:1.05;">TURN COMPLETE</div>
        <div style="margin-top:12px;font-size:16px;line-height:1.55;color:#ffd6d6;">You are out of actions and movement.</div>
        <div style="margin-top:6px;font-size:16px;line-height:1.55;color:#ffd6d6;">Press <span style="color:#fff;font-weight:800;">ENTER</span> to end turn.</div>
    `;
    turnEndOverlayCard.addEventListener('mouseenter', () => {
        if (!turnEndRequired) return;
        turnEndOverlayCard.style.transform = 'scale(1.015)';
    });
    turnEndOverlayCard.addEventListener('mouseleave', () => {
        turnEndOverlayCard.style.transform = 'scale(1)';
    });
    turnEndOverlayCard.addEventListener('mousedown', (event) => {
        event.preventDefault();
        event.stopPropagation();
    });
    turnEndOverlayCard.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        confirmEndTurn();
    });

    turnEndOverlay.addEventListener('mousedown', (event) => {
        event.preventDefault();
        event.stopPropagation();
    });
    turnEndOverlay.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        confirmEndTurn();
    });

    turnEndOverlay.appendChild(turnEndOverlayCard);
    document.body.appendChild(turnEndOverlay);
    return turnEndOverlay;
}

function startTurnFlash() {
    const overlay = ensureTurnEndOverlay();
    if (!overlay || !turnEndOverlayCard) return;
    stopTurnEndFlash();
    let bright = false;
    turnEndFlashInterval = window.setInterval(() => {
        if (!turnEndRequired || !turnEndOverlayCard) return;
        bright = !bright;
        turnEndOverlayCard.style.background = bright
            ? 'rgba(168, 0, 0, 0.96)'
            : 'rgba(92, 0, 0, 0.88)';
        turnEndOverlayCard.style.boxShadow = bright
            ? '0 24px 72px rgba(0,0,0,0.74), 0 0 42px rgba(255,60,60,0.48)'
            : '0 24px 72px rgba(0,0,0,0.72), 0 0 30px rgba(255,40,40,0.24)';
    }, 380);
}

function clearTurnEndState() {
    turnEndRequired = false;
    pendingTurnEndRequired = false;
    softActionPromptShown = false;
    stopTurnEndFlash();
    if (combatState.phase === 'PLAYER' && !combatState.timelineBusy) {
        setCombatLock(false);
    }
    if (turnEndOverlay) {
        turnEndOverlay.style.display = 'none';
    }
    if (turnEndOverlayCard) {
        turnEndOverlayCard.style.transform = 'scale(1)';
        turnEndOverlayCard.style.background = 'rgba(100, 0, 0, 0.88)';
        turnEndOverlayCard.style.boxShadow = '0 24px 72px rgba(0,0,0,0.72), 0 0 36px rgba(255,40,40,0.32)';
    }
}

function enterTurnEndState() {
    if (turnEndRequired || !isTurnExhausted()) return;
    turnEndRequired = true;
    resetCombatInteraction();
    pendingAction = null;
    currentAction = null;
    hideEndTurnPrompt();
    clearCombatMoveTiles();
    showActionUI(false);
    setCombatLock(true);
    ensureTurnEndOverlay().style.display = 'flex';
    startTurnFlash();
    focusOutcomeText('TURN COMPLETE', '#ff8a8a', 1500);
    showFloatingText('TURN COMPLETE', '#ff8a8a', true, { priority: MESSAGE_PRIORITY.CRITICAL });
    playCombatSfxCue('turn-alert');
    updateCombatUI();
    updateActionMenu();
}

function confirmEndTurn() {
    if (!turnEndRequired) return;
    clearTurnEndState();
    endTurn();
}

function syncTurnExhaustionState() {
    // Stage 2: Hard prompt — both resources exhausted.
    if (isTurnExhausted()) {
        checkTurnEndRequired();
    }
    // Stage 1: Soft prompt — action used but movement available
    else if (isActionUsedButCanMove()) {
        if (!softActionPromptShown) {
            softActionPromptShown = true;
            updateActionMenu(); // refresh UI to show soft prompt styling
        }
    }
    // Cleanup: restore normal state if resources became available
    else if (turnEndRequired || softActionPromptShown) {
        clearTurnEndState();
    }
}

function acquireCombatParticle(colorHex = 0xff4444) {
    let p = combatParticlePool.pop();
    if (!p) {
        p = new THREE.Mesh(combatParticleGeometry, new THREE.MeshBasicMaterial({
            color: colorHex,
            transparent: true,
            opacity: 0.95,
        }));
        p.userData = {
            velocity: new THREE.Vector3(),
            life: 1,
        };
    }
    if (p.material && p.material.color) {
        p.material.color.setHex(colorHex);
        p.material.opacity = 0.95;
    }
    p.visible = true;
    p.scale.setScalar(1);
    return p;
}

function updateCombatParticleBudget() {
    const quality = String(SETTINGS.quality || 'high').toLowerCase();
    const qualityCap = quality === 'low' ? COMBAT_PARTICLE_POOL_LOW_MAX : COMBAT_PARTICLE_POOL_DEFAULT_MAX;
    combatParticlePoolMax = qualityCap;

    while (combatParticlePool.length > combatParticlePoolMax) {
        const extra = combatParticlePool.pop();
        if (extra && extra.material) {
            extra.material.dispose();
        }
    }
}

function getCombatParticleSpawnBudgetPerFrame() {
    const quality = String(SETTINGS.quality || 'high').toLowerCase();
    if (quality === 'low') return COMBAT_PARTICLE_SPAWN_PER_FRAME_LOW;
    return COMBAT_PARTICLE_SPAWN_PER_FRAME_DEFAULT;
}

function enqueueCombatParticleBurst(position, config = {}) {
    if (!combatParticlesEnabled || !isSimulationOwner()) return;
    if (!position) return;

    const count = Math.max(1, Math.min(MAX_PARTICLE_BURST, Number(config.count) || 1));
    pendingCombatParticleBursts.push({
        position: position.clone(),
        color: Number.isFinite(Number(config.color)) ? Number(config.color) : 0xff4444,
        remaining: count,
        yOffset: Number.isFinite(Number(config.yOffset)) ? Number(config.yOffset) : 1.05,
        speedMin: Number.isFinite(Number(config.speedMin)) ? Number(config.speedMin) : 0.08,
        speedMax: Number.isFinite(Number(config.speedMax)) ? Number(config.speedMax) : 0.16,
        upwardMin: Number.isFinite(Number(config.upwardMin)) ? Number(config.upwardMin) : 0.1,
        upwardMax: Number.isFinite(Number(config.upwardMax)) ? Number(config.upwardMax) : 0.95,
        lifeMin: Number.isFinite(Number(config.lifeMin)) ? Number(config.lifeMin) : 1.55,
        lifeMax: Number.isFinite(Number(config.lifeMax)) ? Number(config.lifeMax) : 1.55,
        useHue: !!config.useHue,
    });
}

function processQueuedCombatParticleBursts() {
    if (!pendingCombatParticleBursts.length) return;
    if (!combatParticlesEnabled || !isSimulationOwner()) {
        pendingCombatParticleBursts.length = 0;
        return;
    }

    let spawned = 0;
    const maxPerFrame = getCombatParticleSpawnBudgetPerFrame();
    while (spawned < maxPerFrame && pendingCombatParticleBursts.length > 0) {
        const burst = pendingCombatParticleBursts[0];
        if (!burst || burst.remaining <= 0) {
            pendingCombatParticleBursts.shift();
            continue;
        }

        const colorHex = burst.useHue
            ? new THREE.Color().setHSL(0, 1, 0.5 + Math.random() * 0.3).getHex()
            : burst.color;
        const p = acquireCombatParticle(colorHex);
        p.position.copy(burst.position);
        p.position.y += burst.yOffset;

        const dir = new THREE.Vector3(
            Math.random() - 0.5,
            THREE.MathUtils.lerp(burst.upwardMin, burst.upwardMax, Math.random()),
            Math.random() - 0.5,
        ).normalize();
        const speed = THREE.MathUtils.lerp(burst.speedMin, burst.speedMax, Math.random());
        p.userData.velocity.copy(dir).multiplyScalar(speed);
        p.userData.life = THREE.MathUtils.lerp(burst.lifeMin, burst.lifeMax, Math.random());
        scene.add(p);
        combatParticles.push(p);

        burst.remaining -= 1;
        if (burst.remaining <= 0) {
            pendingCombatParticleBursts.shift();
        }
        spawned += 1;
    }
}

function ensureCombatAudioContext() {
    if (combatAudioCtx) return combatAudioCtx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    combatAudioCtx = new Ctx();
    return combatAudioCtx;
}

let combatAudioInputGain = null;
let combatAudioHighpass = null;
let combatAudioLowpass = null;
let combatAudioDistortion = null;
let combatAudioCompressor = null;
let combatAudioMasterGain = null;
let combatMixerMasterGain = null;
let combatMixerCompressor = null;
let combatMusicMasterGain = null;
const MUSIC_BPM = 90;
const MUSIC_STEPS_PER_BEAT = 4;
const MUSIC_STEPS_PER_BAR = 16;
const MUSIC_STEP_SEC = (60 / MUSIC_BPM) / MUSIC_STEPS_PER_BEAT;
const MUSIC_LOOKAHEAD_SEC = 0.28;
const MUSIC_SCHEDULER_MS = 80;
const BOOM_BAP_SAMPLE_URLS = {
    kick: '/static/bassdrum.wav',
    hat: '/static/closedhihat.wav',
    snare: '/static/snare.wav',
    stab: '/static/stab.wav',
};
const COMBAT_SFX_COOLDOWN_MS = {
    'melee-hit': 70,
    'ranged-hit': 70,
    'enemy-hit-player': 90,
    miss: 130,
    'enemy-move': 180,
    'turn-player': 260,
    'turn-enemy': 260,
};
const combatSfxLastPlayedAt = Object.create(null);
const combatSfxQueue = [];
const COMBAT_SFX_MAX_QUEUE = 24;
const COMBAT_SFX_MAX_PER_FRAME = 3;

function getCombatMusicTargetGain(theme = null) {
    if (!COMBAT_MUSIC_ENABLED) return 0.0001;
    const resolvedTheme = theme || combatMusicTheme || (currentGameMode === GAME_MODE.COMBAT ? 'combat' : 'ambient');
    return resolvedTheme === 'combat' ? 0.46 : 0.38;
}

function ensureCombatMixerBus(ctx) {
    if (!ctx || combatMixerMasterGain) return;

    combatMixerMasterGain = ctx.createGain();
    combatMixerMasterGain.gain.value = 0.6;

    combatMixerCompressor = ctx.createDynamicsCompressor();
    combatMixerCompressor.threshold.value = -24;
    combatMixerCompressor.knee.value = 30;
    combatMixerCompressor.ratio.value = 12;
    combatMixerCompressor.attack.value = 0.003;
    combatMixerCompressor.release.value = 0.25;

    combatMixerMasterGain.connect(combatMixerCompressor);
    combatMixerCompressor.connect(ctx.destination);
}

function ensureCombatMusicBus(ctx) {
    if (!ctx || combatMusicMasterGain) return;
    ensureCombatMixerBus(ctx);

    combatMusicMasterGain = ctx.createGain();
    combatMusicMasterGain.gain.value = 0.0001;
    combatMusicMasterGain.connect(combatMixerMasterGain || ctx.destination);
}

function loadCombatMusicSamples(ctx) {
    if (!ctx) return Promise.resolve();
    if (combatMusicSamplesPromise) return combatMusicSamplesPromise;

    const entries = Object.entries(BOOM_BAP_SAMPLE_URLS);
    combatMusicSamplesPromise = Promise.all(entries.map(async ([key, url]) => {
        try {
            const response = await fetch(url, { cache: 'force-cache' });
            if (!response.ok) throw new Error(`Failed to load ${url}`);
            const data = await response.arrayBuffer();
            const buffer = await ctx.decodeAudioData(data.slice(0));
            combatMusicSampleBuffers[key] = buffer;
        } catch (error) {
            console.warn('[Audio] Could not load music sample:', url, error);
            combatMusicSampleBuffers[key] = null;
        }
    })).then(() => undefined);

    return combatMusicSamplesPromise;
}

function hasCombatMusicSamplesReady() {
    return !!(combatMusicSampleBuffers.kick && combatMusicSampleBuffers.hat && combatMusicSampleBuffers.snare);
}

function scheduleSamplePlayback(ctx, sampleKey, startAt, options = null) {
    if (!ctx || !combatMusicMasterGain) return;
    const buffer = combatMusicSampleBuffers[sampleKey];
    if (!buffer) return;

    const opts = options || {};
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.setValueAtTime(Math.max(0.25, Number.isFinite(opts.rate) ? opts.rate : 1), startAt);

    const gain = ctx.createGain();
    const amp = Math.max(0.0001, Number.isFinite(opts.amp) ? opts.amp : 1);
    gain.gain.setValueAtTime(amp, startAt);

    source.connect(gain);
    gain.connect(combatMusicMasterGain);
    source.start(startAt);
}

function scheduleBoomBapStep(ctx, stepInBar, startAt, theme) {
    const isCombat = theme === 'combat';

    // Classic boom-bap skeleton.
    if (stepInBar === 0 || stepInBar === 8) {
        scheduleSamplePlayback(ctx, 'kick', startAt, {
            amp: isCombat ? 1.02 : 0.94,
            rate: isCombat ? 1.0 : 0.97,
        });
    }

    if (stepInBar === 4 || stepInBar === 12) {
        scheduleSamplePlayback(ctx, 'snare', startAt, {
            amp: isCombat ? 1.0 : 0.92,
            rate: isCombat ? 1.0 : 0.98,
        });
    }

    if (stepInBar % 2 === 0) {
        const hatSwing = stepInBar % 4 === 2 ? 0.01 : 0;
        scheduleSamplePlayback(ctx, 'hat', startAt + hatSwing, {
            amp: isCombat ? 0.56 : 0.48,
            rate: isCombat ? 1.06 : 1.03,
        });
    }

    if (stepInBar === 7 || stepInBar === 15) {
        scheduleSamplePlayback(ctx, 'hat', startAt, {
            amp: isCombat ? 0.44 : 0.38,
            rate: 1.14,
        });
    }

    if (stepInBar === 0 || (isCombat && (stepInBar === 6 || stepInBar === 14)) || (!isCombat && stepInBar === 8)) {
        scheduleSamplePlayback(ctx, 'stab', startAt, {
            amp: isCombat ? 0.34 : 0.22,
            rate: isCombat ? 1.0 : 0.94,
        });
    }
}

function runCombatMusicScheduler() {
    if (!COMBAT_MUSIC_ENABLED) return;
    if (!combatAudioUnlocked) return;
    const ctx = combatAudioCtx;
    if (!ctx) return;
    ensureCombatMusicBus(ctx);
    if (!hasCombatMusicSamplesReady()) return;

    // If scheduling falls behind (sample load stall/tab hitch), skip backlog.
    if (!Number.isFinite(combatMusicNextTime) || combatMusicNextTime < (ctx.currentTime - (MUSIC_STEP_SEC * 2))) {
        combatMusicNextTime = ctx.currentTime + 0.02;
    }

    while (combatMusicNextTime < ctx.currentTime + MUSIC_LOOKAHEAD_SEC) {
        const resolvedTheme = combatMusicTheme === 'none'
            ? (currentGameMode === GAME_MODE.COMBAT ? 'combat' : 'ambient')
            : combatMusicTheme;
        const stepInBar = combatMusicStep % MUSIC_STEPS_PER_BAR;
        scheduleBoomBapStep(ctx, stepInBar, combatMusicNextTime, resolvedTheme);

        combatMusicStep += 1;
        combatMusicNextTime += MUSIC_STEP_SEC;
    }
}

function startCombatMusicTheme(theme) {
    if (!COMBAT_MUSIC_ENABLED) {
        combatMusicTheme = 'none';
        if (combatMusicSchedulerId) {
            window.clearInterval(combatMusicSchedulerId);
            combatMusicSchedulerId = null;
        }
        if (combatMusicMasterGain?.gain) {
            combatMusicMasterGain.gain.value = 0.0001;
        }
        return;
    }

    if (!combatAudioUnlocked) return;
    const ctx = combatAudioCtx || ensureCombatAudioContext();
    if (!ctx) return;
    ensureCombatMusicBus(ctx);

    const now = ctx.currentTime;
    combatMusicTheme = theme;
    combatMusicStep = 0;
    combatMusicNextTime = now + 0.05;

    loadCombatMusicSamples(ctx)
        .then(() => {
            runCombatMusicScheduler();
        })
        .catch(() => {
            // Loading errors are handled per-sample in loadCombatMusicSamples.
        });

    if (combatMusicMasterGain) {
        combatMusicMasterGain.gain.cancelScheduledValues(now);
        combatMusicMasterGain.gain.setTargetAtTime(getCombatMusicTargetGain(theme), now, 0.12);
    }

    if (!combatMusicSchedulerId) {
        combatMusicSchedulerId = window.setInterval(runCombatMusicScheduler, MUSIC_SCHEDULER_MS);
    }

    runCombatMusicScheduler();
}

function updateCombatMusicTheme(force = false) {
    if (!COMBAT_MUSIC_ENABLED) return;
    if (!combatAudioUnlocked) return;
    if (!combatAudioCtx) return;
    const desiredTheme = currentGameMode === GAME_MODE.COMBAT ? 'combat' : 'ambient';
    if (!force && combatMusicTheme === desiredTheme) return;
    startCombatMusicTheme(desiredTheme);
}

// Compatibility shim used by combat enter/exit flow.
function syncCombatMusicToGameMode() {
    const desiredLegacyMode = currentGameMode === GAME_MODE.COMBAT ? 'combat' : 'free';
    if (legacyLoopMusicMode !== desiredLegacyMode) {
        legacyLoopMusicMode = desiredLegacyMode;
        if (desiredLegacyMode === 'combat') {
            stopDocksTheme();
            stopMainTheme();
            startBattleMusic();
        } else {
            stopBattleMusic();
            startDocksTheme();
        }
    }
    updateCombatMusicTheme(true);
}

function ensureMusicRunning() {
    if (!COMBAT_MUSIC_ENABLED) return;
    if (!combatAudioUnlocked) return;
    if (combatMusicSchedulerId && combatMusicTheme !== 'none') return;
    startCombatMusicTheme(currentGameMode === GAME_MODE.COMBAT ? 'combat' : 'ambient');
}

function shouldPlayCombatSfxCue(cue) {
    const now = performance.now();
    const cooldownMs = COMBAT_SFX_COOLDOWN_MS[cue] || 80;
    const prev = combatSfxLastPlayedAt[cue] || 0;
    if ((now - prev) < cooldownMs) return false;
    combatSfxLastPlayedAt[cue] = now;
    return true;
}

function createDistortionCurve(amount = 120) {
    const n = 2048;
    const curve = new Float32Array(n);
    const k = Math.max(1, amount);
    const deg = Math.PI / 180;
    for (let i = 0; i < n; i++) {
        const x = (i * 2) / n - 1;
        curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + (k * Math.abs(x)));
    }
    return curve;
}

function createBitCrusherNode(ctx, bits = 5, normFreq = 0.14) {
    const node = ctx.createScriptProcessor(256, 2, 2);
    let phase = 0;
    let lastL = 0;
    let lastR = 0;
    const step = Math.pow(0.5, Math.max(2, Math.min(8, bits)));
    const hold = Math.max(0.02, Math.min(0.5, normFreq));

    node.onaudioprocess = (event) => {
        const inL = event.inputBuffer.getChannelData(0);
        const inR = event.inputBuffer.numberOfChannels > 1
            ? event.inputBuffer.getChannelData(1)
            : inL;
        const outL = event.outputBuffer.getChannelData(0);
        const outR = event.outputBuffer.numberOfChannels > 1
            ? event.outputBuffer.getChannelData(1)
            : outL;

        for (let i = 0; i < inL.length; i++) {
            phase += hold;
            if (phase >= 1) {
                phase -= 1;
                lastL = step * Math.floor((inL[i] / step) + 0.5);
                lastR = step * Math.floor((inR[i] / step) + 0.5);
            }
            outL[i] = lastL;
            outR[i] = lastR;
        }
    };

    return node;
}

function ensureCombatAudioBus(ctx) {
    if (!ctx || combatAudioInputGain) return;
    ensureCombatMixerBus(ctx);

    combatAudioInputGain = ctx.createGain();
    combatAudioInputGain.gain.value = 0.82;

    combatAudioHighpass = ctx.createBiquadFilter();
    combatAudioHighpass.type = 'highpass';
    combatAudioHighpass.frequency.value = 70;
    combatAudioHighpass.Q.value = 0.75;

    combatAudioLowpass = ctx.createBiquadFilter();
    combatAudioLowpass.type = 'lowpass';
    combatAudioLowpass.frequency.value = 5200;
    combatAudioLowpass.Q.value = 0.72;

    combatAudioDistortion = ctx.createWaveShaper();
    combatAudioDistortion.curve = createDistortionCurve(22);
    combatAudioDistortion.oversample = '4x';

    combatAudioCompressor = ctx.createDynamicsCompressor();
    combatAudioCompressor.threshold.value = -16;
    combatAudioCompressor.knee.value = 24;
    combatAudioCompressor.ratio.value = 3;
    combatAudioCompressor.attack.value = 0.006;
    combatAudioCompressor.release.value = 0.12;

    combatAudioMasterGain = ctx.createGain();
    combatAudioMasterGain.gain.value = 0.72;

    combatAudioInputGain.connect(combatAudioHighpass);
    combatAudioHighpass.connect(combatAudioLowpass);
    combatAudioLowpass.connect(combatAudioDistortion);
    combatAudioDistortion.connect(combatAudioCompressor);
    combatAudioCompressor.connect(combatAudioMasterGain);
    combatAudioMasterGain.connect(combatMixerMasterGain || ctx.destination);
}

function duckCombatMusic() {
    if (!COMBAT_MUSIC_ENABLED) return;
    if (!combatAudioUnlocked) return;
    const ctx = combatAudioCtx;
    if (!ctx || !combatMusicMasterGain) return;

    const now = ctx.currentTime;
    const baseGain = getCombatMusicTargetGain();
    const duckedGain = Math.max(0.15, baseGain * 0.42);
    const currentGain = Math.max(0.0001, combatMusicMasterGain.gain.value);

    combatMusicMasterGain.gain.cancelScheduledValues(now);
    combatMusicMasterGain.gain.setValueAtTime(currentGain, now);
    combatMusicMasterGain.gain.linearRampToValueAtTime(duckedGain, now + 0.05);
    combatMusicMasterGain.gain.linearRampToValueAtTime(baseGain, now + 0.4);
}

function unlockCombatAudio() {
    const ctx = ensureCombatAudioContext();
    if (!ctx) return;

    // If Tone.js is present, resume it from the same trusted user gesture.
    if (!toneStartRequested && window.Tone && typeof window.Tone.start === 'function') {
        toneStartRequested = true;
        window.Tone.start().catch(() => {
            // Ignore; this can fail when Tone is not fully initialized yet.
            toneStartRequested = false;
        });
    }

    if (COMBAT_SFX_ENABLED) ensureCombatAudioBus(ctx);
    if (COMBAT_MUSIC_ENABLED) {
        ensureCombatMusicBus(ctx);
    }
    const wasUnlocked = combatAudioUnlocked;

    if (ctx.state === 'suspended') {
        ctx.resume().then(() => {
            combatAudioUnlocked = true;
            legacyLoopMusicMode = 'unknown';
            syncCombatMusicToGameMode();
            if (!wasUnlocked) {
                startCombatMusicTheme(currentGameMode === GAME_MODE.COMBAT ? 'combat' : 'ambient');
            } else {
                ensureMusicRunning();
            }
            updateCombatMusicTheme(!wasUnlocked);
        }).catch(() => {
            // Ignore unlock failures until next user gesture.
        });
        return;
    }

    if (combatAudioUnlocked) {
        ensureMusicRunning();
        return;
    }

    combatAudioUnlocked = true;
    legacyLoopMusicMode = 'unknown';
    syncCombatMusicToGameMode();
    startCombatMusicTheme(currentGameMode === GAME_MODE.COMBAT ? 'combat' : 'ambient');
    updateCombatMusicTheme(true);
}

document.addEventListener('click', () => {
    unlockCombatAudio();
}, { once: true, passive: true });

function startBattleMusic() {
    try {
        if (!battleMusicAudio) {
            battleMusicAudio = new Audio('/static/battlemusic.wav');
            battleMusicAudio.loop = true;
            battleMusicAudio.volume = 0;
            battleMusicAudio.preload = 'auto';
        }
        const playPromise = battleMusicAudio.play();
        if (playPromise && typeof playPromise.then === 'function') {
            playPromise.then(() => {
                // Fade in from 0 to target volume
                const targetVol = 0.35;
                const steps = 20;
                const stepMs = 50;
                let step = 0;
                const fadeIn = setInterval(() => {
                    step += 1;
                    battleMusicAudio.volume = Math.min(targetVol, (step / steps) * targetVol);
                    if (step >= steps) clearInterval(fadeIn);
                }, stepMs);
            }).catch(() => {
                // Autoplay blocked — will play on next user gesture
            });
        }
    } catch (_err) {
        // Ignore audio errors
    }
}

function stopBattleMusic() {
    if (!battleMusicAudio) return;
    try {
        const audio = battleMusicAudio;
        const steps = 20;
        const stepMs = 50;
        const startVol = audio.volume;
        let step = 0;
        const fadeOut = setInterval(() => {
            step += 1;
            audio.volume = Math.max(0, startVol * (1 - step / steps));
            if (step >= steps) {
                clearInterval(fadeOut);
                audio.pause();
                audio.currentTime = 0;
                audio.volume = 0;
            }
        }, stepMs);
    } catch (_err) {
        // Ignore audio errors
    }
}

function playConfirmAttackSnap() {
    try {
        if (!confirmAttackSnapAudio) {
            confirmAttackSnapAudio = new Audio('/static/snapsreverb.wav');
            confirmAttackSnapAudio.preload = 'auto';
            confirmAttackSnapAudio.volume = 0.7;
        }
        const oneShot = confirmAttackSnapAudio.cloneNode(true);
        oneShot.volume = confirmAttackSnapAudio.volume;
        const playPromise = oneShot.play();
        if (playPromise && typeof playPromise.catch === 'function') {
            playPromise.catch(() => {
                // Ignore autoplay/gesture errors; this is a cosmetic cue.
            });
        }
    } catch (_err) {
        // Ignore audio errors so combat flow is never blocked.
    }
}

function playCombatSfx(events = []) {
    if (!COMBAT_SFX_ENABLED) return;
    if (!combatAudioUnlocked) return;
    const ctx = combatAudioCtx || ensureCombatAudioContext();
    if (!ctx) return;
    ensureCombatAudioBus(ctx);
    if (!combatAudioUnlocked && ctx.state === 'suspended') return;

    // Hard cap voices per cue to avoid bursty allocation spikes.
    const clampedEvents = events.slice(0, 2);

    const now = ctx.currentTime;
    for (const event of clampedEvents) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const type = event.type || 'triangle';
        const attack = Number.isFinite(event.attack) ? event.attack : 0.002;
        const decay = Number.isFinite(event.decay) ? event.decay : 0.12;
        const startAt = now + (Number.isFinite(event.at) ? event.at : 0);
        const f0 = Number.isFinite(event.freq) ? event.freq : 320;
        const f1 = Number.isFinite(event.freqTo) ? event.freqTo : f0;
        const amp = Number.isFinite(event.amp) ? event.amp : 0.06;
        const detuneBase = Number.isFinite(event.detune) ? event.detune : 0;
        const detuneJitter = Number.isFinite(event.detuneJitter) ? event.detuneJitter : 8;
        const useSub = !!event.sub;
        const subGainScale = Number.isFinite(event.subAmpScale) ? event.subAmpScale : 0.52;

        osc.type = type;
        osc.frequency.setValueAtTime(f0, startAt);
        osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), startAt + Math.max(0.02, decay));
        osc.detune.setValueAtTime(detuneBase + ((Math.random() - 0.5) * detuneJitter), startAt);

        gain.gain.setValueAtTime(0.0001, startAt);
        gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, amp), startAt + attack);
        gain.gain.exponentialRampToValueAtTime(0.0001, startAt + attack + decay);

        osc.connect(gain);
        gain.connect(combatAudioInputGain || ctx.destination);
        osc.start(startAt);
        osc.stop(startAt + attack + decay + 0.03);

        if (useSub) {
            const subOsc = ctx.createOscillator();
            const subGain = ctx.createGain();
            subOsc.type = 'sine';
            subOsc.frequency.setValueAtTime(Math.max(20, f0 * 0.5), startAt);
            subOsc.frequency.exponentialRampToValueAtTime(Math.max(20, f1 * 0.5), startAt + Math.max(0.02, decay));
            subOsc.detune.setValueAtTime(detuneBase - 4 + ((Math.random() - 0.5) * detuneJitter), startAt);

            subGain.gain.setValueAtTime(0.0001, startAt);
            subGain.gain.exponentialRampToValueAtTime(Math.max(0.0002, amp * subGainScale), startAt + attack);
            subGain.gain.exponentialRampToValueAtTime(0.0001, startAt + attack + decay);

            subOsc.connect(subGain);
            subGain.connect(combatAudioInputGain || ctx.destination);
            subOsc.start(startAt);
            subOsc.stop(startAt + attack + decay + 0.03);
        }
    }
}

function playCombatSfxCue(cue) {
    if (!COMBAT_SFX_ENABLED) return;
    if (!shouldPlayCombatSfxCue(cue)) return;

    if (combatSfxQueue.length >= COMBAT_SFX_MAX_QUEUE) {
        combatSfxQueue.shift();
    }
    combatSfxQueue.push(cue);
}

function processCombatSfxQueue() {
    if (!COMBAT_SFX_ENABLED || combatSfxQueue.length === 0) return;

    let processed = 0;
    while (processed < COMBAT_SFX_MAX_PER_FRAME && combatSfxQueue.length > 0) {
        const cue = combatSfxQueue.shift();
        if (!cue) break;

        if (cue === 'melee-hit' || cue === 'ranged-hit' || cue === 'miss' || cue === 'enemy-hit-player') {
            duckCombatMusic();
        }

        if (cue === 'melee-hit') {
            playCombatSfx([
                { type: 'triangle', freq: 210, freqTo: 120, amp: 0.12, decay: 0.11, at: 0, detuneJitter: 3, sub: true, subAmpScale: 0.48 },
                { type: 'square', freq: 620, freqTo: 280, amp: 0.038, decay: 0.09, at: 0.012, detuneJitter: 2 },
            ]);
        } else if (cue === 'ranged-hit') {
            playCombatSfx([
                { type: 'triangle', freq: 520, freqTo: 260, amp: 0.075, decay: 0.12, at: 0, detuneJitter: 2 },
                { type: 'sine', freq: 760, freqTo: 420, amp: 0.024, decay: 0.08, at: 0.008, detuneJitter: 2 },
            ]);
        } else if (cue === 'miss') {
            playCombatSfx([
                { type: 'sine', freq: 420, freqTo: 320, amp: 0.026, decay: 0.07, at: 0, detuneJitter: 1 },
                { type: 'sine', freq: 300, freqTo: 210, amp: 0.02, decay: 0.07, at: 0.045, detuneJitter: 1 },
            ]);
        } else if (cue === 'enemy-hit-player') {
            playCombatSfx([
                { type: 'triangle', freq: 185, freqTo: 98, amp: 0.11, decay: 0.13, at: 0, detuneJitter: 3, sub: true, subAmpScale: 0.55 },
                { type: 'square', freq: 520, freqTo: 240, amp: 0.03, decay: 0.09, at: 0.015, detuneJitter: 2 },
            ]);
        } else if (cue === 'turn-alert') {
            playCombatSfx([
                { type: 'square', freq: 180, freqTo: 150, amp: 0.06, decay: 0.08, at: 0, detuneJitter: 1 },
                { type: 'square', freq: 180, freqTo: 145, amp: 0.055, decay: 0.08, at: 0.14, detuneJitter: 1 },
                { type: 'triangle', freq: 360, freqTo: 300, amp: 0.03, decay: 0.09, at: 0.02, detuneJitter: 1 },
            ]);
        }
        processed += 1;
    }
}

// Audio must be resumed from a user gesture in modern browsers.
window.addEventListener('pointerdown', unlockCombatAudio, { passive: true, once: true });
window.addEventListener('keydown', unlockCombatAudio, { passive: true, once: true });

function normalizeCombatMessageKey(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .replace(/\d+/g, '#')
        .trim();
}

function getCombatMessagePriority(text, force = false) {
    const msg = String(text || '').toLowerCase();
    if (!msg) return force ? MESSAGE_PRIORITY.MEDIUM : MESSAGE_PRIORITY.LOW;
    let priority = MESSAGE_PRIORITY.LOW;
    if (/you are down|critical strike|combat start|combat ended|defeated/.test(msg)) {
        priority = MESSAGE_PRIORITY.CRITICAL;
    } else if (/your turn|enemy turn|miss|no action|cannot|invalid|hits you|failed|arcane shot|hit!/.test(msg)) {
        priority = MESSAGE_PRIORITY.HIGH;
    } else if (/attack queued|move ready|move to tile|roll|moved|target|click a target/.test(msg)) {
        priority = MESSAGE_PRIORITY.MEDIUM;
    }
    if (force) {
        priority = Math.min(MESSAGE_PRIORITY.CRITICAL, priority + 20);
    }
    return priority;
}

function getCombatMessageTier(text, priority) {
    const msg = String(text || '').toLowerCase();
    if (/attack queued|move ready|move to tile|click a target|roll:/.test(msg)) return 'secondary';
    if (priority >= MESSAGE_PRIMARY_MIN_PRIORITY) return 'primary';
    return 'secondary';
}

function projectMessageAnchorToViewport(anchorObject, tier) {
    if (!anchorObject || !camera || typeof anchorObject.getWorldPosition !== 'function') {
        return null;
    }

    const worldPos = anchorObject.getWorldPosition(new THREE.Vector3());
    worldPos.y += 2.5;
    const projected = worldPos.project(camera);

    if (!Number.isFinite(projected.x) || !Number.isFinite(projected.y) || projected.z > 1.2) {
        return null;
    }

    let x = (projected.x * 0.5 + 0.5) * 100;
    let y = ((-projected.y * 0.5) + 0.5) * 100;
    y -= tier === 'primary' ? 8 : 4;

    x = THREE.MathUtils.clamp(x, 12, 88);
    y = THREE.MathUtils.clamp(y, 10, 90);
    if (y > 30 && y < 70) {
        y = tier === 'primary' ? 14 : 84;
    }

    return { x, y };
}

function clearActiveCombatMessage(immediate = false) {
    const active = combatMessageState.active;
    if (!active || !active.el) return;

    window.clearTimeout(combatMessageState.fadeTimerId);
    window.clearTimeout(combatMessageState.removeTimerId);
    combatMessageState.fadeTimerId = null;
    combatMessageState.removeTimerId = null;

    if (immediate) {
        if (active.el.parentElement) active.el.parentElement.removeChild(active.el);
        combatMessageState.active = null;
        return;
    }

    active.el.style.opacity = '0';
    active.el.style.transform = 'translate(-50%, -62%) scale(1.04)';
    combatMessageState.removeTimerId = window.setTimeout(() => {
        if (active.el.parentElement) active.el.parentElement.removeChild(active.el);
        if (combatMessageState.active && combatMessageState.active.id === active.id) {
            combatMessageState.active = null;
        }
    }, 220);
}

function setCombatMessageLock(locked) {
    combatMessageState.locked = !!locked;
    if (combatMessageState.locked) {
        clearActiveCombatMessage(true);
    }
}

function delay(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, Math.max(0, ms)));
}

async function timelineDelay(ms, timingState = null) {
    const requestedMs = Math.max(0, Number(ms) || 0);
    if (requestedMs <= 0) return;
    if (!timingState || !Number.isFinite(Number(timingState.remainingOffsetMs))) {
        await delay(requestedMs);
        return;
    }
    const remainingOffset = Math.max(0, Number(timingState.remainingOffsetMs) || 0);
    const skipped = Math.min(requestedMs, remainingOffset);
    timingState.remainingOffsetMs = Math.max(0, remainingOffset - skipped);
    const waitMs = requestedMs - skipped;
    if (waitMs > 0) {
        await delay(waitMs);
    }
}

function triggerCombatHitStop(durationMs = 140) {
    const now = performance.now();
    // Throttle repeated hit-stop bursts when multiple contacts happen in quick succession.
    if (now - combatLastHitStopAt < 90) return;
    combatLastHitStopAt = now;
    combatHitStopUntil = Math.max(combatHitStopUntil, now + Math.max(28, Math.min(72, durationMs)));
}

// Async wrapper: applies a short soft hit-stop window without hard-freezing the whole frame.
async function hitStop(ms) {
    triggerCombatHitStop(ms);
    await delay(Math.max(20, Math.min(70, Number(ms) || 0)));
}

function tweenCameraFov(toFov, durationMs = 260) {
    if (!camera || !Number.isFinite(toFov)) return Promise.resolve();
    const startFov = camera.fov;
    const targetFov = THREE.MathUtils.clamp(toFov, 28, 95);
    const start = performance.now();
    const duration = Math.max(1, durationMs);

    return new Promise((resolve) => {
        function tick(now) {
            const t = THREE.MathUtils.clamp((now - start) / duration, 0, 1);
            const eased = 1 - Math.pow(1 - t, 3);
            camera.fov = startFov + ((targetFov - startFov) * eased);
            camera.updateProjectionMatrix();
            if (t >= 1) {
                resolve();
                return;
            }
            window.requestAnimationFrame(tick);
        }
        window.requestAnimationFrame(tick);
    });
}

function showFloatingText(text, color = '#ff6b6b', force = false, options = null) {
    if (combatMessageState.locked && !force) return;

    const now = performance.now();
    const msgText = String(text || '').trim();
    if (!msgText) return;

    const priority = getCombatMessagePriority(msgText, force);
    const tier = getCombatMessageTier(msgText, priority);
    const msgKey = normalizeCombatMessageKey(msgText);
    const recentAt = combatMessageState.recentByKey.get(msgKey) || 0;
    if ((now - recentAt) < 420 && !force) return;

    const active = combatMessageState.active;
    if (active) {
        if (active.key === msgKey && !force) return;
        if (priority < active.priority && (now - active.startedAt) < 340) return;
        clearActiveCombatMessage(true);
    }

    const inCombat = currentGameMode === GAME_MODE.COMBAT;
    let xPercent = 50;
    let yPercent = tier === 'primary' ? 14 : 84;
    const anchorObject = options && options.anchorObject ? options.anchorObject : null;
    const projected = projectMessageAnchorToViewport(anchorObject, tier);
    if (projected) {
        xPercent = projected.x;
        yPercent = projected.y;
    }

    const el = document.createElement('div');
    el.className = `combat-managed-message ${tier}`;
    el.textContent = msgText;
    el.style.position = 'fixed';
    el.style.left = `${xPercent}%`;
    el.style.top = `${yPercent}%`;
    el.style.transform = 'translate(-50%, -50%) scale(0.94)';
    el.style.color = color;
    el.style.fontFamily = 'Consolas, "Segoe UI", monospace';
    el.style.fontSize = tier === 'primary'
        ? (inCombat ? '56px' : '32px')
        : (inCombat ? '20px' : '17px');
    el.style.fontWeight = tier === 'primary' ? '900' : '700';
    el.style.letterSpacing = tier === 'primary' ? (inCombat ? '1px' : '0.4px') : '0.2px';
    el.style.textTransform = inCombat ? 'uppercase' : 'none';
    el.style.webkitTextStroke = tier === 'primary'
        ? (inCombat ? '2px #000000' : '1.5px #000000')
        : '0.8px #000000';
    el.style.paintOrder = 'stroke fill';
    el.style.textShadow = tier === 'primary'
        ? `0 0 10px ${color}, 0 0 22px ${color}, 0 8px 20px rgba(0,0,0,0.92)`
        : '0 2px 8px rgba(0,0,0,0.8)';
    el.style.zIndex = '2600';
    el.style.pointerEvents = 'none';
    el.style.opacity = '0';
    if (tier === 'secondary') {
        el.style.background = 'rgba(8,10,18,0.68)';
        el.style.border = '1px solid rgba(160, 190, 255, 0.4)';
        el.style.borderRadius = '8px';
        el.style.padding = '4px 10px';
        el.style.opacity = '0';
    }
    el.style.transition = 'opacity 160ms ease, transform 220ms ease';
    document.body.appendChild(el);

    const messageId = `msg-${Math.floor(now)}-${Math.floor(Math.random() * 1e5)}`;
    combatMessageState.active = {
        id: messageId,
        el,
        key: msgKey,
        priority,
        startedAt: now,
    };
    combatMessageState.recentByKey.set(msgKey, now);

    requestAnimationFrame(() => {
        el.style.opacity = tier === 'secondary' ? '0.78' : '1';
        el.style.transform = 'translate(-50%, -50%) scale(1)';
    });

    const holdMs = priority >= MESSAGE_PRIORITY.CRITICAL ? 1050 : 780;
    const fadeMs = 220;
    combatMessageState.fadeTimerId = window.setTimeout(() => {
        if (!combatMessageState.active || combatMessageState.active.id !== messageId) return;
        clearActiveCombatMessage(false);
    }, holdMs);

    combatMessageState.removeTimerId = window.setTimeout(() => {
        if (!combatMessageState.active || combatMessageState.active.id !== messageId) return;
        clearActiveCombatMessage(true);
    }, holdMs + fadeMs + 20);
}

function triggerCombatFlash(color = '#ffffff', alpha = 0.18, durationMs = 260) {
    if (!combatFlashEl) return;
    combatFlashEl.style.background = color;
    combatFlashEl.style.transition = `opacity ${Math.max(90, Math.round(durationMs * 0.33))}ms ease`;
    combatFlashEl.style.opacity = String(alpha);
    setTimeout(() => {
        combatFlashEl.style.transition = `opacity ${Math.max(140, durationMs)}ms ease`;
        combatFlashEl.style.opacity = '0';
    }, 30);
}

// Screen shake functions
let screenShakeIntensity = 0;
let screenShakeStartTime = 0;
let screenShakeDuration = 0;

function shakeScreen(intensity, durationMs) {
    screenShakeIntensity = Math.max(0.02, intensity);
    screenShakeDuration = durationMs || 300;
    screenShakeStartTime = performance.now();
}

function updateScreenShake(delta) {
    if (screenShakeIntensity <= 0 || !camera) return;
    const elapsed = performance.now() - screenShakeStartTime;
    const progress = Math.min(1, elapsed / screenShakeDuration);
    if (progress >= 1) {
        screenShakeIntensity = 0;
        return;
    }
    const easeProgress = 1 - progress;
    const currentIntensity = screenShakeIntensity * easeProgress;
    camera.position.x += (Math.random() - 0.5) * currentIntensity * 2;
    camera.position.y += (Math.random() - 0.5) * currentIntensity * 2;
}

function spawnImpactBurst(position, color = 0xff4444, count = 24) {
    enqueueCombatParticleBurst(position, {
        color,
        count,
        yOffset: 1.05,
        speedMin: 0.08,
        speedMax: 0.24,
        upwardMin: 0.1,
        upwardMax: 0.95,
        lifeMin: 1.45,
        lifeMax: 1.65,
    });
}

function queuePostMoveAttack(target, attackType = 'melee') {
    if (!target || !target.userData || !target.userData.isTargetable) return false;
    pendingPostMoveAttack = {
        target,
        attackType,
    };
    return true;
}

function resolvePendingPostMoveAttack() {
    if (!pendingPostMoveAttack) return;

    const pending = pendingPostMoveAttack;
    pendingPostMoveAttack = null;

    if (currentGameMode !== GAME_MODE.COMBAT || combatState.phase !== 'PLAYER') return;
    const target = pending.target;
    if (!target || !target.parent || !target.userData || !target.userData.isTargetable) {
        showFloatingText('Target lost', '#ff8a8a', true);
        return;
    }

    if (pending.attackType === 'melee' && canTarget(playerState, target, DND_RANGES.melee, true)) {
        playConfirmAttackSnap();
        executeAttack(target);
    } else {
        showFloatingText('Moved, but still out of attack range', '#ff8a8a', true);
    }
}

function updateDeliberatePlayerMove(nowMs) {
    if (!deliberateMoveState) return;

    const elapsed = Math.max(0, nowMs - deliberateMoveState.startTimeMs);
    const duration = Math.max(1, deliberateMoveState.durationMs);
    const t = THREE.MathUtils.clamp(elapsed / duration, 0, 1);
    const eased = 1 - Math.pow(1 - t, 3);

    playerState.position.lerpVectors(deliberateMoveState.startPos, deliberateMoveState.endPos, eased);
    playerState.velocity.x = 0;
    playerState.velocity.z = 0;
    syncPlayerRigFromState();

    if (t >= 1) {
        const retreatStartPos = deliberateMoveState.startPos.clone();
        const retreatEndPos = deliberateMoveState.endPos.clone();
        playerState.position.copy(deliberateMoveState.endPos);
        syncPlayerRigFromState();
        deliberateMoveState = null;
        maybeResolveRetreatReaction(retreatStartPos, retreatEndPos);
        rebuildCombatMoveTiles();
        resolvePendingPostMoveAttack();
    }
}

function logCombatEvent(text, tone = 'info') {
    addDmEvent(text, tone);
    if (!combatLogEl) return;
    // Keep log focused: low-value chatter is suppressed.
    if (tone === 'info') return;

    const msgText = String(text || '').trim();
    if (!msgText) return;
    const msgKey = normalizeCombatMessageKey(msgText);
    for (const child of Array.from(combatLogEl.children)) {
        if (child.dataset && child.dataset.msgKey === msgKey && child.parentElement) {
            child.parentElement.removeChild(child);
            break;
        }
    }

    const line = document.createElement('div');
    const color = tone === 'hit'
        ? '#8dd694'
        : tone === 'miss'
            ? '#ff9f9f'
            : tone === 'system'
                ? '#ffd166'
                : '#d9e2ff';
    line.dataset.msgKey = msgKey;
    line.textContent = msgText;
    line.style.color = color;
    line.style.marginBottom = '4px';
    line.style.padding = '2px 6px';
    line.style.borderRadius = '4px';
    line.style.fontWeight = '700';
    line.style.textShadow = `0 0 10px ${color}`;
    line.style.background = tone === 'hit'
        ? 'rgba(44, 150, 78, 0.18)'
        : tone === 'miss'
            ? 'rgba(170, 48, 48, 0.18)'
            : tone === 'system'
                ? 'rgba(190, 140, 20, 0.16)'
                : 'rgba(90, 110, 170, 0.14)';
    line.style.whiteSpace = 'nowrap';
    line.style.textOverflow = 'ellipsis';
    line.style.overflow = 'hidden';
    line.style.opacity = '0';
    line.style.transform = 'translateY(6px) scale(0.98)';
    line.style.transition = 'opacity 220ms ease, transform 260ms ease';
    combatLogEl.appendChild(line);
    requestAnimationFrame(() => {
        line.style.opacity = '1';
        line.style.transform = 'translateY(0px) scale(1)';
    });
    while (combatLogEl.children.length > 3) {
        combatLogEl.removeChild(combatLogEl.firstChild);
    }
    window.setTimeout(() => {
        if (!line.parentElement) return;
        line.style.opacity = '0';
        line.style.transform = 'translateY(-5px) scale(0.98)';
        window.setTimeout(() => {
            if (line.parentElement) line.parentElement.removeChild(line);
        }, 220);
    }, 2300);
    combatLogEl.scrollTop = combatLogEl.scrollHeight;
}

function clearCombatMoveTiles() {
    // Invalidate any in-flight async tile build.
    combatMoveTileBuildToken += 1;
    while (combatMoveTiles.length > 0) {
        const tile = combatMoveTiles.pop();
        if (tile.parent) tile.parent.remove(tile);
    }
    // BG3 zone objects
    if (moveZoneDisc   && moveZoneDisc.parent)   { moveZoneDisc.parent.remove(moveZoneDisc);     moveZoneDisc = null;   }
    if (moveZoneRing   && moveZoneRing.parent)   { moveZoneRing.parent.remove(moveZoneRing);     moveZoneRing = null;   }
    if (moveDestMarker && moveDestMarker.parent) { moveDestMarker.parent.remove(moveDestMarker); moveDestMarker = null; }
    if (movePathLine   && movePathLine.parent)   { movePathLine.parent.remove(movePathLine);     movePathLine = null;   }
    hoveredMoveWorldPos = null;
}

function rebuildCombatMoveTiles() {
    const canUseCombatMoveInput = hasModePermission('player.combatInput')
        || (modeManager.current === MODE.DM && getControlledActor() === playerState);
    if (!canUseCombatMoveInput) {
        clearCombatMoveTiles();
        return;
    }

    if (!isPlayerInputTurn()) {
        clearCombatMoveTiles();
        return;
    }

    const moveFeet = combatState.player.movementRemaining;
    if (moveFeet <= 0) {
        clearCombatMoveTiles();
        return;
    }

    const radiusUnits = feetToUnits(moveFeet);
    const groundY = (bvhColliderMesh && bvhColliderMesh.geometry && bvhColliderMesh.geometry.boundsTree)
        ? queryGroundHeightBVH(bvhColliderMesh, playerState.position, 60)
        : null;
    const discY = Number.isFinite(groundY) ? groundY + 0.025 : playerState.position.y + 0.025;

    // Create circles only if they don't exist
    if (!moveZoneDisc) {
        const discGeo  = new THREE.CircleGeometry(radiusUnits, 72);
        const discMat  = new THREE.MeshBasicMaterial({
            color: MOVE_ZONE_COLOR,
            transparent: true,
            opacity: 0.13,
            side: THREE.DoubleSide,
            depthWrite: false,
        });
        moveZoneDisc = new THREE.Mesh(discGeo, discMat);
        moveZoneDisc.rotation.x = -Math.PI / 2;
        moveZoneDisc.renderOrder = 20;
        moveZoneDisc.userData.isMoveZoneDisc = true;
        scene.add(moveZoneDisc);
    }

    if (!moveZoneRing) {
        const ringGeo  = new THREE.RingGeometry(radiusUnits * 0.97, radiusUnits, 72);
        const ringMat  = new THREE.MeshBasicMaterial({
            color: MOVE_ZONE_COLOR,
            transparent: true,
            opacity: 0.55,
            side: THREE.DoubleSide,
            depthWrite: false,
        });
        moveZoneRing = new THREE.Mesh(ringGeo, ringMat);
        moveZoneRing.rotation.x = -Math.PI / 2;
        moveZoneRing.renderOrder = 21;
        scene.add(moveZoneRing);
    }

    // Store target position for smooth lerp in animate loop
    moveZoneTargetX = playerState.position.x;
    moveZoneTargetZ = playerState.position.z;
    moveZoneDisc.userData.targetY = discY;
}

// Snap a world position to the nearest 5-ft grid point.
function snapToMoveGrid(worldX, worldZ) {
    const step = feetToUnits(COMBAT_TILE_FEET); // 1 unit per 5 ft
    return {
        x: Math.round(worldX / step) * step,
        z: Math.round(worldZ / step) * step,
    };
}

// Show/update the destination marker + path line (called on hover).
function updateMoveDestPreview(snappedX, snappedZ, discY) {
    const y = discY + 0.015;

    // Marker ring
    if (!moveDestMarker) {
        const geo = new THREE.RingGeometry(0.18, 0.42, 32);
        const mat = new THREE.MeshBasicMaterial({
            color: MOVE_DEST_COLOR,
            transparent: true,
            opacity: 0.9,
            side: THREE.DoubleSide,
            depthWrite: false,
        });
        moveDestMarker = new THREE.Mesh(geo, mat);
        moveDestMarker.rotation.x = -Math.PI / 2;
        moveDestMarker.renderOrder = 25;
        scene.add(moveDestMarker);
    }
    moveDestMarker.position.set(snappedX, y, snappedZ);
    moveDestMarker.visible = true;

    // Path line (dashed look via LineSegments with gaps)
    if (movePathLine && movePathLine.parent) scene.remove(movePathLine);
    movePathLine = null;

    const px = playerState.position.x;
    const pz = playerState.position.z;
    const dx = snappedX - px;
    const dz = snappedZ - pz;
    const segCount = 12;
    const verts = [];
    for (let i = 0; i < segCount; i++) {
        // Each dash: two vertices at t and t+gap
        const t0 = i / segCount;
        const t1 = (i + 0.55) / segCount;
        verts.push(px + dx * t0, y + 0.01, pz + dz * t0);
        verts.push(px + dx * t1, y + 0.01, pz + dz * t1);
    }
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
    const lineMat = new THREE.LineBasicMaterial({
        color: MOVE_DEST_COLOR,
        transparent: true,
        opacity: 0.65,
    });
    movePathLine = new THREE.LineSegments(lineGeo, lineMat);
    movePathLine.renderOrder = 24;
    scene.add(movePathLine);
}

function hideMoveDestPreview() {
    if (moveDestMarker) moveDestMarker.visible = false;
    if (movePathLine && movePathLine.parent) { scene.remove(movePathLine); movePathLine = null; }
    hoveredMoveWorldPos = null;
}

function ensureEnemyHoverCursor() {
    if (enemyHoverCursor) return enemyHoverCursor;
    const geo = new THREE.RingGeometry(0.62, 0.78, 48);
    const mat = new THREE.MeshBasicMaterial({
        color: 0x00ffff,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        depthWrite: false,
    });
    enemyHoverCursor = new THREE.Mesh(geo, mat);
    enemyHoverCursor.rotation.x = -Math.PI / 2;
    enemyHoverCursor.renderOrder = 30;
    enemyHoverCursor.visible = false;
    enemyHoverCursor.userData.unselectable = true;
    scene.add(enemyHoverCursor);
    return enemyHoverCursor;
}

function updateEnemyHoverCursor(target) {
    if (!target || !target.position) {
        hideTargetPreview();
        return;
    }
    const cursor = ensureEnemyHoverCursor();
    const radius = Math.max(0.55, Number(target.userData?.radius) || 0.5);
    const scale = radius / 0.5;
    cursor.scale.set(scale, scale, 1);
    cursor.position.set(target.position.x, target.position.y + 0.04, target.position.z);
    cursor.visible = true;
    hoveredTargetPreview = target;
}

// Create or update the target hover preview tooltip
function createTargetPreviewElement() {
    const element = document.createElement('div');
    element.style.position = 'fixed';
    element.style.bottom = 'auto';
    element.style.left = '0';
    element.style.right = 'auto';
    element.style.top = '0';
    element.style.pointerEvents = 'none';
    element.style.zIndex = '10000';
    element.style.fontFamily = 'Consolas, monospace';
    element.style.fontSize = '13px';
    element.style.lineHeight = '1.4';
    element.style.padding = '8px';
    element.style.backgroundColor = '#1a1a1a';
    element.style.border = '2px solid #00ffff';
    element.style.borderRadius = '4px';
    element.style.whiteSpace = 'nowrap';
    element.style.boxShadow = '0 0 16px rgba(0, 255, 255, 0.5)';
    document.body.appendChild(element);
    return element;
}

// Update or show the target preview with hit/miss and damage info
function updateTargetPreview(target, screenX, screenY) {
    void screenX;
    void screenY;
    updateEnemyHoverCursor(target);
}

// Hide the target preview tooltip
function hideTargetPreview() {
    if (targetPreviewElement && targetPreviewElement.parentNode) {
        targetPreviewElement.parentNode.removeChild(targetPreviewElement);
        targetPreviewElement = null;
    }
    if (enemyHoverCursor) {
        enemyHoverCursor.visible = false;
    }
    hoveredTargetPreview = null;
}

// Legacy tile-object path (kept for any external callers).
function moveToCombatTile(tile) {
    if (!tile || !tile.userData || !tile.userData.combatMoveTile) return false;
    return executeMoveTo(
        new THREE.Vector3(tile.userData.tileX, playerState.position.y, tile.userData.tileZ),
        tile.userData.costFeet
    );
}

// Core movement executor — accepts a world-space destination and the pre-computed cost.
function executeMoveTo(targetPos, costFeet) {
    if (deliberateMoveState) return false;
    if (isInputLockedForCombat('MOVE')) return false;
    if (!canPlayerMove()) {
        showFloatingText('You cannot move right now', '#ff8a8a');
        return false;
    }
    if (costFeet <= 0 || costFeet > combatState.player.movementRemaining) {
        showFloatingText('Not enough movement', '#ff8a8a');
        logCombatEvent(`Move failed (${Math.round(combatState.player.movementRemaining)} ft left)`, 'miss');
        return false;
    }
    // ENFORCEMENT GATE: Prevent illegal moves at execution time
    if (!canMoveTo(targetPos)) {
        showFloatingText('Cannot leave combat!', '#ff8a8a', true);
        logCombatEvent('Move blocked: outside combat arena', 'miss');
        return false;
    }

    playerState.prevPosition.copy(playerState.position);
    const startPos = playerState.position.clone();
    const durationMs = THREE.MathUtils.clamp(220 + (costFeet * 24), 240, 980);

    playerState.velocity.x = 0;
    playerState.velocity.z = 0;
    if (!tryMove(costFeet)) {
        showFloatingText('Not enough movement', '#ff8a8a');
        return false;
    }
    deliberateMoveState = {
        startPos,
        endPos: targetPos.clone(),
        startTimeMs: performance.now(),
        durationMs,
    };
    focusCameraOnAction(playerState);

    showFloatingText(`Advance ${costFeet} ft`, '#8dd694', true, { anchorObject: playerRig });
    logCombatEvent(`You move ${costFeet} ft (${Math.round(combatState.player.movementRemaining)} ft left)`, 'system');
    syncTurnExhaustionState();
    return true;
}

function announceCombatStart() {
    showFloatingText('COMBAT START', '#ffd166');
    logCombatEvent('Combat engaged', 'system');
}

// === Combat UI Optimization: Dirty flag system ===
const combatUiState = {
    lastPhaseText: '',
    lastHpText: '',
    lastMovementText: '',
    lastActionText: '',
    lastEndTurnLabel: '',
    lastEndTurnBg: '',
    lastEndTurnBorder: '',
    lastEndTurnColor: '',
    lastEndTurnBoxShadow: '',
    lastCanEndTurnNow: null,
    lastBorderColor: '',
};

function updateCombatUI() {
    if (!combatUiEl) return;
    if (modeManager.current === MODE.DM) {
        combatUiEl.style.display = 'none';
        return;
    }
    combatUiEl.style.display = 'block';
    const phaseText = currentGameMode === GAME_MODE.COMBAT
        ? (combatState.phase === 'PLAYER' ? '⚔ YOUR TURN' : '👹 ENEMY TURN')
        : '—';
    const hpNow = Math.max(0, Math.round(Number(playerState.hp) || 0));
    const hpMax = Math.max(1, Math.round(Number(playerState.maxHp) || 1));
    const hpText = `${hpNow} / ${hpMax}`;
    const movementText = `${Math.max(0, Math.round(combatState.player.movementRemaining))} ft`;
    
    // Stage 1: show "USED" + soft prompt
    const actionText = turnEndRequired 
        ? 'TURN COMPLETE' 
        : (combatState.player.actionUsed ? 'USED' : 'READY');
    
    const showEndTurnButton = false;
    const canEndTurnNow = currentGameMode === GAME_MODE.COMBAT && currentTurnPhase === TURN_PHASE.PLAYER;
    
    // Determine button state
    let endTurnLabel = 'End Turn (Enter)';
    let endTurnBg = 'rgba(20,20,30,0.9)';
    let endTurnBorder = '1px solid rgba(180,180,255,0.45)';
    let endTurnColor = '#e6f0ff';
    let endTurnBoxShadow = '0 0 0 transparent';
    
    // Hard prompt: both resources exhausted
    if (turnEndRequired) {
        endTurnLabel = 'End Turn Required (Enter)';
        endTurnBg = 'rgba(120, 0, 0, 0.94)';
        endTurnBorder = '1px solid rgba(255, 90, 90, 0.95)';
        endTurnColor = '#fff2f2';
        endTurnBoxShadow = '0 0 12px rgba(255, 80, 80, 0.8)';
    }
    // Soft prompt: action used but movement remains
    else if (softActionPromptShown) {
        endTurnLabel = 'Action Used — End Turn When Ready (Enter)';
        endTurnBg = 'rgba(20, 40, 70, 0.92)';
        endTurnBorder = '1px solid rgba(100, 180, 255, 0.7)';
        endTurnColor = '#b8d8ff';
        endTurnBoxShadow = '0 0 8px rgba(100, 160, 255, 0.55), inset 0 0 12px rgba(100, 180, 255, 0.2)';
    }

    // Check if anything changed (dirty flag optimization)
    const isDirty = combatUiState.lastPhaseText !== phaseText ||
                    combatUiState.lastHpText !== hpText ||
                    combatUiState.lastMovementText !== movementText ||
                    combatUiState.lastActionText !== actionText ||
                    combatUiState.lastEndTurnLabel !== endTurnLabel ||
                    combatUiState.lastEndTurnBg !== endTurnBg ||
                    combatUiState.lastEndTurnBorder !== endTurnBorder ||
                    combatUiState.lastEndTurnColor !== endTurnColor ||
                    combatUiState.lastEndTurnBoxShadow !== endTurnBoxShadow ||
                    combatUiState.lastCanEndTurnNow !== canEndTurnNow;

    // Only update DOM if state changed
    if (isDirty) {
        combatUiEl.innerHTML = `
            <div>Turn: ${phaseText}</div>
            <div>HP: ${hpText}</div>
            <div>Movement: ${movementText}</div>
            <div>Action: ${actionText}</div>
            ${showEndTurnButton ? `
                <button id="combat-end-turn-btn" style="
                    margin-top: 8px;
                    width: 100%;
                    padding: 6px 10px;
                    background: ${endTurnBg};
                    color: ${endTurnColor};
                    border: ${endTurnBorder};
                    border-radius: 6px;
                    font-family: monospace;
                    font-size: 11px;
                    cursor: ${canEndTurnNow ? 'pointer' : 'not-allowed'};
                    opacity: ${canEndTurnNow ? '1' : '0.6'};
                    box-shadow: ${endTurnBoxShadow};
                    transition: box-shadow 0.3s;
                " ${canEndTurnNow ? '' : 'disabled'}>${endTurnLabel}</button>
            ` : ''}
        `;

        // Cache current state
        combatUiState.lastPhaseText = phaseText;
        combatUiState.lastHpText = hpText;
        combatUiState.lastMovementText = movementText;
        combatUiState.lastActionText = actionText;
        combatUiState.lastEndTurnLabel = endTurnLabel;
        combatUiState.lastEndTurnBg = endTurnBg;
        combatUiState.lastEndTurnBorder = endTurnBorder;
        combatUiState.lastEndTurnColor = endTurnColor;
        combatUiState.lastEndTurnBoxShadow = endTurnBoxShadow;
        combatUiState.lastCanEndTurnNow = canEndTurnNow;
    }

    const endTurnBtn = document.getElementById('combat-end-turn-btn');
    if (endTurnBtn && canEndTurnNow) {
        endTurnBtn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (turnEndRequired) {
                confirmEndTurn();
            } else {
                endTurn();
            }
        });
    }

    const borderColor = currentGameMode === GAME_MODE.COMBAT
        ? (currentTurnPhase === TURN_PHASE.PLAYER ? 'rgba(255,200,60,0.8)' : 'rgba(255, 110, 110, 0.7)')
        : 'rgba(130, 150, 180, 0.55)';
    
    if (combatUiState.lastBorderColor !== borderColor) {
        combatUiEl.style.borderColor = borderColor;
        combatUiState.lastBorderColor = borderColor;
    }
}

function spawnCombatBurst(position) {
    enqueueCombatParticleBurst(position, {
        count: 20,
        yOffset: 1.0,
        speedMin: 0.08,
        speedMax: 0.22,
        upwardMin: 0.2,
        upwardMax: 0.8,
        lifeMin: 0.95,
        lifeMax: 1.15,
        useHue: true,
    });
}

let combatCheckerTexture = null;

function getCombatCheckerTexture() {
    if (combatCheckerTexture) return combatCheckerTexture;

    const size = 512;
    const cells = 16;
    const cell = size / cells;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    for (let y = 0; y < cells; y++) {
        for (let x = 0; x < cells; x++) {
            const dark = ((x + y) % 2) === 0;
            ctx.fillStyle = dark ? '#101010' : '#2f2f2f';
            ctx.fillRect(x * cell, y * cell, cell, cell);
        }
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.LinearMipMapLinearFilter;
    tex.needsUpdate = true;

    combatCheckerTexture = tex;
    return combatCheckerTexture;
}

function createCombatArena(center, radius) {
    const arenaGroup = new THREE.Group();

    const floorVisualRadius = Math.max(radius - 0.14, COMBAT_FLOOR_VISUAL_RADIUS);
    const floorGeo = new THREE.CircleGeometry(floorVisualRadius, 120);
    const checkerTex = getCombatCheckerTexture();
    const tilesAcrossDiameter = Math.max(64, Math.round((floorVisualRadius * 2) / 1.1));
    checkerTex.repeat.set(tilesAcrossDiameter, tilesAcrossDiameter);
    const floorMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        map: checkerTex,
        transparent: true,
        opacity: 0.96,
        side: THREE.DoubleSide,
        depthWrite: false,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0.045, 0);
    arenaGroup.add(floor);

    const ringGeo = new THREE.RingGeometry(radius - 0.12, radius, 80);
    const ringMat = new THREE.MeshBasicMaterial({
        color: 0x3f3f3f,
        transparent: true,
        opacity: 0.88,
        side: THREE.DoubleSide,
        depthWrite: false,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(0, 0.06, 0);
    arenaGroup.add(ring);

    arenaGroup.position.set(center.x, center.y + COMBAT_FLOOR_Y_OFFSET, center.z);
    scene.add(arenaGroup);
    return arenaGroup;
}

function createCombatGrid(center, size) {
    const grid = new THREE.GridHelper(size * 2, size * 2, 0x4a4a4a, 0x2b2b2b);
    grid.position.set(center.x, center.y + COMBAT_FLOOR_Y_OFFSET + 0.03, center.z);
    scene.add(grid);
    return grid;
}

function ensureCombatEnvironmentPresentation(options = {}) {
    const targetActor = options.targetActor && options.targetActor.position
        ? options.targetActor
        : (trainingDummies.find((dummy) => dummy && dummy.parent && dummy.position) || null);

    const playerPos = playerState && playerState.position ? playerState.position : null;
    if (playerPos && targetActor && targetActor.position) {
        combatCenter.copy(playerPos).lerp(targetActor.position, 0.5);
        combatRadius = Math.max(10, playerPos.distanceTo(targetActor.position) + 5);
    } else if (playerPos) {
        combatCenter.copy(playerPos);
        combatRadius = Math.max(10, combatRadius || 12);
    }

    if (combatRing && combatRing.parent) scene.remove(combatRing);
    if (combatGrid && combatGrid.parent) scene.remove(combatGrid);
    combatRing = createCombatArena(combatCenter, combatRadius);
    combatGrid = createCombatGrid(combatCenter, combatRadius);
}

function isInsideCombatArena(pos) {
    return pos.distanceTo(combatCenter) <= combatRadius;
}

// Pre-execution gate: validate movement BEFORE physics applies it
function canMoveTo(targetPos) {
    return true; // Arena boundary not enforced — player moves freely within movement zone
}

function activateCombatCamera() {
    // DM free-fly camera should remain in control even during combat.
    if (isDmFreeCamera()) {
        return;
    }
    if (!camera || !playerRig) return;
    if (combatCameraActive) return;

    if (document.pointerLockElement) {
        document.exitPointerLock();
    }

    preCombatCameraFov = camera.fov;
    scene.attach(camera);
    camera.fov = 58;
    camera.updateProjectionMatrix();
    combatCameraActive = true;
    combatCameraFocusBlendReady = false;
    // Disable any active arrow-turn input while combat is active.
    turnLeft = false;
    turnRight = false;
    setCrosshairVisible(false);
}

function deactivateCombatCamera() {
    // DM free-fly mode does not use player combat camera state.
    if (isDmFreeCamera()) {
        combatCameraActive = false;
        return;
    }
    if (!camera || !playerRig) return;
    if (!combatCameraActive) return;

    playerRig.attach(camera);
    camera.fov = preCombatCameraFov || 75;
    camera.updateProjectionMatrix();
    camera.position.set(0, FREE_CAMERA_HEIGHT, 4.8);
    camera.rotation.set(pitch, 0, 0);
    combatCameraActive = false;
    combatCameraFocusBlendReady = false;
    setCrosshairVisible(true);
}

function focusCameraOnAction(target, options = {}) {
    if (!combatCameraActive || !target || !target.position) return;
    if (LOCK_COMBAT_CAMERA_TO_PLAYER && currentGameMode === GAME_MODE.COMBAT) return;
    const durationMs = Number.isFinite(options.durationMs) ? options.durationMs : 1250;
    const strength = Number.isFinite(options.strength) ? options.strength : 1;
    combatCameraActionFocusPos.copy(target.position);
    combatCameraActionFocusUntil = performance.now() + Math.max(400, durationMs);
    combatCameraActionFocusStrength = THREE.MathUtils.clamp(strength, 0.6, 2.2);
}

function updateCombatCamera(delta) {
    if (isDmFreeCamera()) return false;
    if (!combatCameraActive || currentGameMode !== GAME_MODE.COMBAT) return false;

    // Freeze camera motion while action review/confirm UI is open.
    if (isCombatReviewUiOpen()) {
        return true;
    }

    // Performance mode: keep framing anchored to the player during combat.
    const focusPos = playerState.position;
    combatCameraFocusBlendPos.copy(focusPos);

    combatCameraDesiredPos.set(
        combatCameraFocusBlendPos.x + COMBAT_CAMERA_STEADY_OFFSET.x,
        combatCameraFocusBlendPos.y + COMBAT_CAMERA_STEADY_OFFSET.y,
        combatCameraFocusBlendPos.z + COMBAT_CAMERA_STEADY_OFFSET.z
    );

    combatCameraLookAtPos.set(
        combatCameraFocusBlendPos.x,
        combatCameraFocusBlendPos.y + COMBAT_CAMERA_LOOK_Y_OFFSET,
        combatCameraFocusBlendPos.z
    );

    const lerpT = THREE.MathUtils.clamp(delta * 2.4, 0, 1);
    camera.position.lerp(combatCameraDesiredPos, lerpT);
    camera.lookAt(combatCameraLookAtPos);
    return true;
}

function setDmFollowEntity(entity, options = {}) {
    if (!entity || !entity.position) {
        dmFollowEntity = null;
        return false;
    }
    dmFollowEntity = entity;
    if (options.autoSwitch && dmCameraMode !== DM_CAMERA_MODE.FREE) {
        setDmCameraMode(DM_CAMERA_MODE.FOLLOW, { silent: options.silent === true });
    }
    return true;
}

function getMostRelevantActor() {
    const possessed = getControlledActor();
    if (possessed && possessed.position) return possessed;
    if (dmFollowEntity && dmFollowEntity.position) {
        if (dmFollowEntity === playerState || dmFollowEntity.parent) {
            return dmFollowEntity;
        }
    }
    const queueEntry = getCurrentCombatQueueEntry();
    if (queueEntry && queueEntry.id) {
        if (isLocalPlayerTurnEntry(queueEntry)) return playerState;
        const queueActor = findCombatActorById(queueEntry.id);
        if (queueActor && queueActor.position) return queueActor;
    }
    if (selectedCombatTarget && selectedCombatTarget.position && selectedCombatTarget.parent) {
        return selectedCombatTarget;
    }
    return playerState;
}

function getCombatFocusPoint() {
    const focus = dmDirectorCenter;
    focus.set(0, 0, 0);

    const liveActors = trainingDummies.filter((dummy) => (
        dummy &&
        dummy.parent &&
        (dummy.userData?.hp || 0) > 0 &&
        dummy.position
    ));
    const playerPos = playerState && playerState.position ? playerState.position : null;

    if (liveActors.length <= 0 || !playerPos) {
        const fallback = getMostRelevantActor();
        if (fallback && fallback.position) {
            focus.copy(fallback.position);
            return focus;
        }
        return focus.set(0, 1.5, 0);
    }

    focus.copy(playerPos);
    liveActors.forEach((actor) => focus.add(actor.position));
    focus.multiplyScalar(1 / (liveActors.length + 1));
    focus.y += 1.5;
    return focus;
}

function updateDmObserverCamera(delta) {
    if (!isDmFreeCamera()) return false;
    return updateDmFreeSwimCamera(delta);
}

function forceLeaveCombatPresentation(reason = 'sync') {
    combatTimeline.length = 0;
    resetCombatActionHistory();
    clearTurnEndState();
    resetCombatPresentationState();

    currentGameMode = GAME_MODE.FREE;
    currentTurnPhase = TURN_PHASE.IDLE;
    combatState.inCombat = false;
    combatState.phase = 'TRANSITION';
    combatState.turnQueue = [];
    combatState.turnOrder = [];
    combatState.currentTurnIndex = 0;
    combatState.turnIndex = 0;
    combatState.roundNumber = 0;

    setCombatLock(false);
    setCombatTimelineBusy(false);
    pendingAction = null;
    resetCombatInteraction();
    clearCombatMoveTiles();
    deactivateCombatCamera();

    if (combatRing && combatRing.parent) {
        scene.remove(combatRing);
    }
    combatRing = null;
    if (combatGrid && combatGrid.parent) {
        scene.remove(combatGrid);
    }
    combatGrid = null;

    combatInitiatorSid = null;
    combatInitiatorActorId = null;
    spectatorCombat = false;

    syncSkyboxWithGameMode();
    syncCombatMusicToGameMode();
    showActionUI(false);
    updateActionMenu();
    updateCombatUI();
    updateDmControlPanel();

    // Slide DM setpiece + hands back up and restore original world transform.
    if (dmWorldSetpiece && !dmWorldSetpiece.userData._slideExitPending) {
        dmWorldSetpiece.userData._slideExitPending = true;
        const restPos = dmWorldSetpiece.userData._restPos;
        const restRotY = dmWorldSetpiece.userData._restRot && dmWorldSetpiece.userData._restRot.y;
        const startY = dmWorldSetpiece.position.y;
        const exitY = startY + 35;
        const duration = 700;
        const start = performance.now();
        const slide = () => {
            const t = Math.min(1, (performance.now() - start) / duration);
            const eased = t * t;
            dmWorldSetpiece.position.y = startY + (exitY - startY) * eased;
            if (t < 1) {
                requestAnimationFrame(slide);
            } else {
                dmWorldSetpiece.userData._slideExitPending = false;
                if (restPos) {
                    dmWorldSetpiece.position.copy(restPos);
                    if (restRotY !== undefined) dmWorldSetpiece.rotation.y = restRotY;
                }
            }
        };
        requestAnimationFrame(slide);
    }

    console.info(`[COMBAT] forced exit presentation (${reason})`);
}

let combatOutcomeOverlay = null;
let combatOutcomeHideTimer = null;

function ensureCombatOutcomeOverlay() {
    if (combatOutcomeOverlay) return combatOutcomeOverlay;

    const overlay = document.createElement('div');
    overlay.id = 'combat-outcome-overlay';
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.zIndex = '12000';
    overlay.style.display = 'none';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.background = 'radial-gradient(circle at center, rgba(18,24,28,0.62) 0%, rgba(3,4,6,0.88) 100%)';
    overlay.style.backdropFilter = 'blur(7px)';

    const panel = document.createElement('div');
    panel.style.minWidth = 'min(520px, 88vw)';
    panel.style.maxWidth = '88vw';
    panel.style.padding = '28px 26px';
    panel.style.border = '1px solid rgba(255,255,255,0.18)';
    panel.style.background = 'linear-gradient(180deg, rgba(19,22,28,0.96) 0%, rgba(8,10,14,0.98) 100%)';
    panel.style.boxShadow = '0 30px 100px rgba(0,0,0,0.55)';
    panel.style.borderRadius = '18px';
    panel.style.display = 'flex';
    panel.style.flexDirection = 'column';
    panel.style.alignItems = 'center';
    panel.style.gap = '12px';
    panel.style.textAlign = 'center';

    const eyebrow = document.createElement('div');
    eyebrow.dataset.role = 'eyebrow';
    eyebrow.style.fontFamily = 'Georgia, Times New Roman, serif';
    eyebrow.style.letterSpacing = '0.28em';
    eyebrow.style.fontSize = '12px';
    eyebrow.style.textTransform = 'uppercase';
    eyebrow.style.color = '#9fb2c8';

    const title = document.createElement('div');
    title.dataset.role = 'title';
    title.style.fontFamily = 'Georgia, Times New Roman, serif';
    title.style.fontSize = '42px';
    title.style.lineHeight = '1.05';
    title.style.fontWeight = '700';
    title.style.color = '#f6f1df';
    title.style.textShadow = '0 6px 24px rgba(0,0,0,0.45)';

    const body = document.createElement('div');
    body.dataset.role = 'body';
    body.style.maxWidth = '42ch';
    body.style.fontFamily = 'Segoe UI, sans-serif';
    body.style.fontSize = '15px';
    body.style.lineHeight = '1.55';
    body.style.color = '#d0d6e1';

    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.flexWrap = 'wrap';
    actions.style.justifyContent = 'center';
    actions.style.gap = '10px';
    actions.style.marginTop = '8px';

    const retryBtn = document.createElement('button');
    retryBtn.type = 'button';
    retryBtn.dataset.action = 'retry';
    retryBtn.textContent = 'Retry';
    retryBtn.style.padding = '10px 18px';
    retryBtn.style.borderRadius = '999px';
    retryBtn.style.border = '1px solid rgba(255,255,255,0.16)';
    retryBtn.style.background = '#f1e2b0';
    retryBtn.style.color = '#16181c';
    retryBtn.style.fontWeight = '700';
    retryBtn.style.cursor = 'pointer';

    const continueBtn = document.createElement('button');
    continueBtn.type = 'button';
    continueBtn.dataset.action = 'continue';
    continueBtn.style.padding = '10px 18px';
    continueBtn.style.borderRadius = '999px';
    continueBtn.style.border = '1px solid rgba(255,255,255,0.14)';
    continueBtn.style.background = 'rgba(255,255,255,0.06)';
    continueBtn.style.color = '#eef3ff';
    continueBtn.style.fontWeight = '600';
    continueBtn.style.cursor = 'pointer';

    actions.appendChild(retryBtn);
    actions.appendChild(continueBtn);
    panel.appendChild(eyebrow);
    panel.appendChild(title);
    panel.appendChild(body);
    panel.appendChild(actions);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    combatOutcomeOverlay = overlay;
    return overlay;
}

function hideCombatOutcomeOverlay() {
    if (combatOutcomeHideTimer) {
        clearTimeout(combatOutcomeHideTimer);
        combatOutcomeHideTimer = null;
    }
    if (combatOutcomeOverlay) {
        combatOutcomeOverlay.style.display = 'none';
    }
}

function showCombatOutcomeOverlay(packet = {}) {
    const overlay = ensureCombatOutcomeOverlay();
    if (!overlay) return;

    const result = String(packet.result || '').trim().toLowerCase();
    const rounds = Math.max(1, Number(packet.rounds) || 1);
    const eyebrow = overlay.querySelector('[data-role="eyebrow"]');
    const title = overlay.querySelector('[data-role="title"]');
    const body = overlay.querySelector('[data-role="body"]');
    const retryBtn = overlay.querySelector('[data-action="retry"]');
    const continueBtn = overlay.querySelector('[data-action="continue"]');
    if (!eyebrow || !title || !body || !retryBtn || !continueBtn) return;

    const isDefeat = result === 'players_defeated';
    eyebrow.textContent = isDefeat ? 'Game Over' : 'Victory';
    title.textContent = isDefeat ? 'You Have Fallen' : 'Enemies Defeated';
    title.style.color = isDefeat ? '#ffd0d0' : '#e7f6c7';
    body.textContent = isDefeat
        ? `Your party can no longer fight. The battle ended after ${rounds} round${rounds === 1 ? '' : 's'}.`
        : `The battlefield is yours. Combat ended in ${rounds} round${rounds === 1 ? '' : 's'}.`;

    retryBtn.style.display = isDefeat ? 'inline-flex' : 'none';
    continueBtn.textContent = isDefeat ? 'Return to World' : 'Continue';
    retryBtn.onclick = () => {
        hideCombatOutcomeOverlay();
        window.location.reload();
    };
    continueBtn.onclick = () => {
        hideCombatOutcomeOverlay();
    };

    overlay.style.display = 'flex';

    if (!isDefeat) {
        combatOutcomeHideTimer = setTimeout(() => {
            hideCombatOutcomeOverlay();
        }, 2200);
    }
}

function tryEnterCombat(target, options = {}) {
    const bypassDmApproval = options && options.bypassDmApproval === true;
    const skipNetworkEmit = options && options.skipNetworkEmit === true;
    if (!hasModePermission('player.combatInput')) return false;
    if (!target || !target.userData || !target.userData.isTargetable) return false;
    if (currentGameMode === GAME_MODE.COMBAT) return false;
    if (!bypassDmApproval && modeManager.current !== MODE.DM && isDmConnectedForCombatApproval()) {
        requestCombatStartApproval(target);
        return false;
    }

    const serverAuthoritative = !!(socket && socket.connected);
    if (serverAuthoritative && modeManager.current !== MODE.DM) {
        // Delegate to the server — it will broadcast combat-state to all clients
        // which drives the local presentation in lockstep.
        if (socket) {
            socket.emit('combat-start', { targetId: getCombatActorId(target) });
        }
        appendConsoleHistory('Combat start requested. Waiting for server sync...', 'ok');
        return false;
    }

    console.info('Entering combat...');
    hideCombatOutcomeOverlay();
    combatTimeline.length = 0;
    resetCombatActionHistory();
    currentGameMode = GAME_MODE.COMBAT;
    combatState.inCombat = true;
    const effectiveLocalId = (socket && socket.id) ? socket.id : localPlayerId;
    combatInitiatorSid = String(effectiveLocalId || '').trim() || combatInitiatorSid;
    combatInitiatorActorId = getLocalCombatActorId();
    syncSkyboxWithGameMode();
    syncCombatMusicToGameMode();
    setCombatPhase('PLAYER');
    setCombatLock(false);
    combatState.turnQueue = [];
    combatState.turnOrder = [playerState, target.userData];
    combatState.currentTurnIndex = 0;
    combatState.turnIndex = 0;
    combatState.roundNumber = 1;
    resetLocalTurnResources();

    if (!skipNetworkEmit) {
        emitCombatStateEvent(true, {
            initiator: localPlayerId || (socket ? socket.id : null),
            targetId: getCombatActorId(target),
        });
    }

    // Dramatic effects
    spawnCombatBurst(playerState.position);
    ensureCombatEnvironmentPresentation({ targetActor: target });

    activateCombatCamera();
    syncCombatTurnQueue(getLocalCombatActorId());

    // Snap camera directly behind the player based on their current facing direction.
    {
        const yaw = playerRig ? playerRig.rotation.y : 0;
        const behind = new THREE.Vector3(
            Math.sin(yaw) * COMBAT_CAMERA_STEADY_OFFSET.z,
            COMBAT_CAMERA_STEADY_OFFSET.y,
            Math.cos(yaw) * COMBAT_CAMERA_STEADY_OFFSET.z
        );
        camera.position.set(
            playerState.position.x + behind.x,
            playerState.position.y + behind.y,
            playerState.position.z + behind.z
        );
        camera.lookAt(
            playerState.position.x,
            playerState.position.y + COMBAT_CAMERA_LOOK_Y_OFFSET,
            playerState.position.z
        );
    }

    // Reposition DM setpiece to the far side of the battlefield, facing the player,
    // then drop it in from above.
    if (dmWorldSetpiece) {
        // Save original world transform so we can restore it after combat.
        dmWorldSetpiece.userData._slideExitPending = false;
        dmWorldSetpiece.userData._restPos = dmWorldSetpiece.position.clone();
        dmWorldSetpiece.userData._restRot = { y: dmWorldSetpiece.rotation.y };

        // Direction from player toward enemy gives us the "far side".
        const fwd = new THREE.Vector3()
            .subVectors(target.position, playerState.position)
            .setY(0);
        if (fwd.lengthSq() < 0.001) fwd.set(0, 0, -1);
        fwd.normalize();

        const dist = combatRadius + 12;
        const landX = combatCenter.x + fwd.x * dist;
        const landZ = combatCenter.z + fwd.z * dist;
        const landY = playerState.position.y + 5;   // center of screen ~5 above the floor

        // Rotate to face back toward the player / camera.
        const faceYaw = Math.atan2(
            playerState.position.x - landX,
            playerState.position.z - landZ
        );
        dmWorldSetpiece.rotation.set(0, faceYaw, 0);

        // Start high above, animate down.
        const dropFrom = landY + 35;
        dmWorldSetpiece.position.set(landX, dropFrom, landZ);
        const duration = 800;
        const start = performance.now();
        const slide = () => {
            const t = Math.min(1, (performance.now() - start) / duration);
            const eased = 1 - Math.pow(1 - t, 3);
            dmWorldSetpiece.position.y = dropFrom + (landY - dropFrom) * eased;
            if (t < 1) requestAnimationFrame(slide);
        };
        requestAnimationFrame(slide);
    }

    announceCombatStart();

    // Push the authoritative turn order (players + enemies) to the server now that the
    // local queue has been built. The server cannot see training dummies, so the client
    // must supply the order once at combat start. Subsequent advancement is server-driven.
    if (socket && socket.connected) {
        const queueForServer = syncCombatTurnQueue(getLocalCombatActorId());
        socket.emit('combat-turn-sync', {
            order: queueForServer,
            turnIndex: 0,
            roundNumber: 1,
        });
    }

    startPlayerTurn();
    return true;
}

function exitCombatIfNoTargets() {
    if (socket && socket.connected && modeManager.current !== MODE.DM) {
        // Remote player clients should not end combat locally; wait for server
        // world/combat state updates to drive presentation transitions.
        return;
    }
    if (trainingDummies.length > 0) return;
    combatTimeline.length = 0;
    resetCombatActionHistory();
    clearTurnEndState();
    currentGameMode = GAME_MODE.FREE;
    currentTurnPhase = TURN_PHASE.IDLE;
    syncSkyboxWithGameMode();
    syncCombatMusicToGameMode();
    combatState.phase = 'TRANSITION';
    setCombatLock(false);
    setCombatTimelineBusy(false);
    pendingAction = null;
    resetCombatInteraction();
    
    combatState.inCombat = false;
    combatInitiatorSid = null;
    combatInitiatorActorId = null;
    spectatorCombat = false;

    emitCombatStateEvent(false, {
        initiator: localPlayerId || (socket ? socket.id : null),
    });
    
    combatState.turnOrder = [];
    combatState.currentTurnIndex = 0;
    if (combatRing && combatRing.parent) { scene.remove(combatRing); combatRing = null; }
    if (combatGrid && combatGrid.parent) { scene.remove(combatGrid); combatGrid = null; }
    deactivateCombatCamera();

    // Slide DM setpiece back up out of view, then restore its original world transform.
    if (dmWorldSetpiece) {
        const restPos = dmWorldSetpiece.userData._restPos;
        const restRotY = dmWorldSetpiece.userData._restRot && dmWorldSetpiece.userData._restRot.y;
        const startY = dmWorldSetpiece.position.y;
        const exitY = startY + 35;
        const duration = 700;
        const start = performance.now();
        const slide = () => {
            const t = Math.min(1, (performance.now() - start) / duration);
            const eased = t * t;
            dmWorldSetpiece.position.y = startY + (exitY - startY) * eased;
            if (t < 1) {
                requestAnimationFrame(slide);
            } else if (restPos) {
                dmWorldSetpiece.position.copy(restPos);
                if (restRotY !== undefined) dmWorldSetpiece.rotation.y = restRotY;
            }
        };
        requestAnimationFrame(slide);
    }

    activeNetworkCombatTimeline = null;
    localCombatTimelineId = null;
    pendingNetworkCombatEvents.length = 0;
    clearCombatMoveTiles();
    showActionUI(false);
    updateActionMenu();
    console.info('Combat resolved. Returning to free roam.');
    showFloatingText('Combat Ended', '#8dd694');
    logCombatEvent('Combat ended', 'system');
}

// Check if attacker can target defender
function canTarget(attacker, target, rangeFeet, checkLOS = true) {
    if (!attacker || !target) return false;
    if (attacker === target) return false;  // Can't target self

    const dist = getEffectiveCombatDistanceFeet(attacker, target);

    // Small epsilon avoids boundary flicker from floating point precision (e.g. displayed 5.00 ft).
    if (dist > rangeFeet + 0.05) return false;

    if (checkLOS && !hasLineOfSight(attacker.position, target.position)) return false;

    return true;
}

// Attempt to move to a target position (uses grid distance for movement cost)
function tryMoveTo(targetPos) {
    if (combatState.player.movementRemaining <= 0) return false;
    
    const cost = getDistanceInSquares(playerState.position, targetPos) * FEET_PER_SQUARE;
    
    if (cost > combatState.player.movementRemaining) return false;
    
    if (!tryMove(cost)) return false;
    playerState.position.copy(targetPos);
    
    return true;
}

// Advance to next turn
function nextTurn() {
    return advanceCombatTurnQueue();
}

function dispatchCombatTurnActor(entry) {
    if (!entry || currentGameMode !== GAME_MODE.COMBAT) return false;

    pendingAction = null;
    resetCombatInteraction();
    updateActionMenu();

    if (entry.type === 'player') {
        const isLocal = isLocalCombatQueueEntry(entry);
        console.log('[DISPATCH]', {
            entryId: entry.id,
            entryOwnerSid: entry.ownerSid,
            localActorId: getLocalCombatActorId(),
            socketId: socket && socket.id,
            isLocal,
        });
        if (!isLocal) {
            clearTurnEndState();
            setCombatPhase('TRANSITION');
            setCombatLock(true);
            setCombatTimelineBusy(false);
            clearCombatMoveTiles();
            showActionUI(false);
            const actorLabel = entry.name || getCombatActorLabelById(entry.id) || 'Player';
            addDmEvent(`TURN START: ${actorLabel}`, 'system');
            showFloatingText(`${actorLabel} Turn`, '#8ab4ff');
            logCombatEvent(`${actorLabel} turn`, 'system');
            updateCombatUI();
            updateDmControlPanel();
            return true;
        }
        if (spectatorCombat) {
            // Auto-skip player turn in spectator (brawl) mode
            showFloatingText('SPECTATING', '#b9c0cf');
            setTimeout(() => { stepTurn(); }, 600);
            return true;
        }
        addDmEvent('TURN START: Player', 'system');
        startPlayerTurn();
        return true;
    }

    const enemy = findCombatActorById(entry.id);
    if (!enemy || !enemy.parent || (enemy.userData?.hp || 0) <= 0) {
        // Server is authoritative for turn advancement; do not emit local step-turn
        // when an enemy actor is missing client-side.
        // Still show turn feedback so the player knows the enemy is acting.
        const enemyLabel = entry.name || entry.id || 'Enemy';
        addDmEvent(`TURN START: ${enemyLabel}`, 'system');
        showFloatingText(`Enemy Turn — ${enemyLabel}`, '#ff8a8a');
        logCombatEvent(`${enemyLabel} turn`, 'system');
        setCombatPhase('TRANSITION');
        setCombatLock(true);
        setCombatTimelineBusy(false);
        clearCombatMoveTiles();
        showActionUI(false);
        updateCombatUI();
        updateDmControlPanel();
        return true;
    }

    clearTurnEndState();
    setCombatPhase('ENEMY');
    setCombatLock(true);
    clearCombatMoveTiles();
    showActionUI(false);
    addDmEvent(`TURN START: ${entry.name || 'Enemy'}`, 'system');
    showFloatingText(`Enemy Turn — ${entry.name || 'Enemy'}`, '#ff8a8a');
    playCombatSfxCue('turn-enemy');
    logCombatEvent(`${entry.name || 'Enemy'} turn`, 'system');
    // Server resolves enemy actions and will broadcast combat-action-result/combat-turn.
    return true;
}

function stepTurn() {
    if (currentGameMode !== GAME_MODE.COMBAT) {
        console.log('[END-TURN] stepTurn: not in combat mode');
        return false;
    }
    if (combatReplayActive) {
        console.log('[END-TURN] stepTurn: replay active, skipping');
        return false;
    }
    console.log('[END-TURN] stepTurn: emitting end-turn to server');
    // Delegate turn advancement to the server. The server validates ownership and
    // broadcasts 'combat-turn' to all clients, which drives dispatchCombatTurnActor.
    socket.emit('end-turn', {});
    return true;
}

// Check line of sight from position A to B (uses raycasting)
function hasLineOfSight(posA, posB, blockingFilter = null) {
    if (!posA || !posB) return false;
    
    const direction = new THREE.Vector3().subVectors(posB, posA).normalize();
    const distance = posA.distanceTo(posB);
    
    const raycaster = new THREE.Raycaster(posA, direction, 0, distance * 1.1);
    const hits = raycaster.intersectObjects(scene.children, true);
    
    if (hits.length === 0) return true;  // Nothing blocking
    
    // Treat only explicit LOS blockers as blocking so decoration doesn't invalidate targeting.
    for (let hit of hits) {
        if (hit.distance >= distance * 0.95) {
            return true;  // Target is at/beyond this hit
        }
        if (blockingFilter && !blockingFilter(hit.object)) {
            continue;  // Skip non-blocking objects
        }
        if (hit.object.userData && hit.object.userData.blockLOS === true) {
            return false;  // Something is blocking
        }
    }
    
    return true;
}

function checkOpportunityAttack(startPos, endPos, enemy) {
    if (!startPos || !endPos || !enemy || !enemy.position) return false;
    if (!enemy.parent || !enemy.userData || !enemy.userData.isTargetable) return false;
    if ((enemy.userData.hp || 0) <= 0) return false;

    const enemyRadiusUnits = Number(enemy.userData?.radius) || 0;
    const actorRadiusUnits = Number(playerState?.radius) || 0;
    const combinedFeet = unitsToFeet(enemyRadiusUnits + actorRadiusUnits);
    const wasInMelee = Math.max(0, getFlatDistanceFeet(startPos, enemy.position) - combinedFeet) * COMBAT_DISTANCE_SCALE <= DND_RANGES.melee;
    const nowOutOfMelee = Math.max(0, getFlatDistanceFeet(endPos, enemy.position) - combinedFeet) * COMBAT_DISTANCE_SCALE > DND_RANGES.melee;
    return wasInMelee && nowOutOfMelee;
}

function maybeResolveRetreatReaction(startPos, endPos) {
    if (currentGameMode !== GAME_MODE.COMBAT || combatState.phase !== 'PLAYER') return;
    if (!isLocalCombatAuthority()) return;
    if (!startPos || !endPos) return;

    const threateningEnemies = trainingDummies.filter((enemy) => checkOpportunityAttack(startPos, endPos, enemy));
    if (threateningEnemies.length === 0) return;

    // Only one reaction roll per retreat movement to avoid burst spikes.
    const enemy = threateningEnemies[0];
    const enemyName = enemy.userData?.name || 'Enemy';
    const roll = Math.random();

    if (roll < OPPORTUNITY_ATTACK_TRIGGER_CHANCE) {
        const reaction = resolveEnemyAttack(enemy, playerState);
        showFloatingText(`${enemyName.toUpperCase()} OPPORTUNITY!`, '#ffb3a7', true, { anchorObject: enemy });
        if (reaction.hit) {
            const dealt = applyPlayerDamage(reaction.totalDamage, `${enemyName} (opportunity)`);
            showFloatingText(`-${dealt}`, '#ff6b6b', true, { anchorObject: playerRig });
            spawnImpactBurst(playerState.position, 0xff4444, 18);
            triggerCombatFlash('#ff2d2d', 0.18, 260);
            shakeScreen(0.12, 210);
            playCombatSfxCue('enemy-hit-player');
            logCombatEvent(`${enemyName} lands an opportunity attack for ${dealt}`, 'miss');
        } else {
            playCombatSfxCue('miss');
            logCombatEvent(`${enemyName} swings as you retreat and misses`, 'info');
        }
        return;
    }

    if (roll < OPPORTUNITY_ATTACK_TRIGGER_CHANCE + RETREAT_TRIP_TRIGGER_CHANCE) {
        const penalty = Math.min(
            RETREAT_TRIP_MOVE_PENALTY_FEET,
            Math.max(0, Number(combatState.player?.movementRemaining) || 0)
        );
        if (penalty > 0) {
            combatState.player.movementRemaining = Math.max(0, combatState.player.movementRemaining - penalty);
            syncCombatPlayerToLegacyState();
            syncTurnExhaustionState();
            updateCombatUI();
            updateActionMenu();
        }
        showFloatingText('You stumble while retreating', '#ffd166', true);
        playCombatSfxCue('miss');
        logCombatEvent(`${enemyName} pressures your retreat — you lose ${penalty} ft`, 'system');
        return;
    }

    showFloatingText('Clean disengage', '#8dd694', true);
}

const {
    getValidTargets,
    highlightTargets,
    clearTargetHighlights,
    getFirstSelectableHit,
} = createCombatTargetingService({
    getAllPlayerAvatars: () => allPlayerAvatars,
    canTarget,
    isMeshSelectable,
    resolveSelectableTarget,
});

function triggerLocalHammerAttackSwing() {
    if (!localPlayerAvatarRigState || !localPlayerAvatarRigState.active) return;
    if (typeof localPlayerAvatarRigState.triggerHammerFlourish !== 'function') return;
    localPlayerAvatarRigState.triggerHammerFlourish();
}

// ── Attack Resolution with Dice ──
const {
    getAttackConfig,
    getAttackPreview,
    resolveAttack,
    resolveEnemyAttack,
} = createAttackResolutionService({
    consumeDmOverride,
    trainingDummyDamage: TRAINING_DUMMY_DAMAGE,
    getFallbackTargetAc: () => (Number.isFinite(playerState?.ac) ? playerState.ac : 12),
});

// ── 3D Dice Visualization ──
function createD20Geometry() {
    // d20 (icosahedron with 20 faces)
    return new THREE.IcosahedronGeometry(2.304, 0);
}

function createD8Geometry() {
    // d8 (octahedron with 8 faces)
    return new THREE.OctahedronGeometry(2.016, 0);
}

function createD6Geometry() {
    // d6 (cube with 6 faces)
    return new THREE.BoxGeometry(1.728, 1.728, 1.728);
}

function spawnVisualDice(rollValue, diceType, targetMesh, label) {
    if (!scene) return;
    
    let geometry, material;
    const DICE_SCALE = 0.75;
    const color = diceType === 20 ? 0xff6b9d : diceType === 8 ? 0x00d9ff : 0xffb84d; // pink d20, cyan d8, orange d6
    
    if (diceType === 20) {
        geometry = createD20Geometry();
    } else if (diceType === 8) {
        geometry = createD8Geometry();
    } else {
        geometry = createD6Geometry();
    }
    
    material = new THREE.MeshPhysicalMaterial({
        color: color,
        metalness: 0.6,
        roughness: 0.2,
        emissive: color,
        emissiveIntensity: 0.5,
        transparent: true,
        depthWrite: false,
        depthTest: false,
    });

    showDiceCinematicResult(rollValue, diceType, label, color);
    
    const dice = new THREE.Mesh(geometry, material);
    dice.scale.setScalar(DICE_SCALE);
    
    // Spawn in the center lane during cinematic rolls.
    const activeCam = (typeof getActiveViewCamera === 'function') ? getActiveViewCamera() : camera;
    const camPos = new THREE.Vector3();
    activeCam.getWorldPosition(camPos);

    const ndcX = (Math.random() - 0.5) * 0.05;
    const ndcY = 0.03 + ((Math.random() - 0.5) * 0.05);
    const projected = new THREE.Vector3(ndcX, ndcY, 0.2).unproject(activeCam);
    const dir = projected.sub(camPos).normalize();
    const depth = 5.8 + (Math.random() * 0.8);
    const spawnPos = camPos.clone().addScaledVector(dir, depth);
    const startY = spawnPos.y + 0.28;

    dice.position.copy(spawnPos);
    dice.renderOrder = 130200;
    
    // Random rotation
    dice.rotation.set(
        Math.random() * Math.PI,
        Math.random() * Math.PI,
        Math.random() * Math.PI
    );
    
    diceScene.add(dice);
    
    // Add label text above dice
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#' + color.toString(16).padStart(6, '0');
    ctx.font = 'bold 62px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(rollValue.toString(), 32, 32);
    
    const texture = new THREE.CanvasTexture(canvas);
    const labelMaterial = new THREE.MeshBasicMaterial({ map: texture, transparent: true });
    labelMaterial.depthTest = false;
    labelMaterial.depthWrite = false;
    const labelGeometry = new THREE.PlaneGeometry(1.728, 1.728);
    const labelMesh = new THREE.Mesh(labelGeometry, labelMaterial);
    labelMesh.position.copy(dice.position);
    labelMesh.position.y += 1.49;
    labelMesh.renderOrder = 130220;
    diceScene.add(labelMesh);
    
    // Animate and remove
    const startTime = performance.now();
    const duration = VISUAL_DICE_DURATION_MS; // ms
    
    function animateDice() {
        const elapsed = performance.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        
        // Fall and rotate with a slower hang at the top of the roll.
        const fallProgress = Math.pow(progress, 1.45);
        dice.position.y = startY - (fallProgress * fallProgress * 2.18);
        dice.rotation.x += 0.04;
        dice.rotation.y += 0.065;
        dice.rotation.z += 0.022;
        
        // Fade and scale
        const fadeOut = progress < 0.72 ? 1 : Math.max(0, 1 - ((progress - 0.72) / 0.28));
        dice.material.opacity = fadeOut;
        dice.material.transparent = true;
        
        labelMesh.material.opacity = fadeOut;
        labelMesh.position.copy(dice.position);
        labelMesh.position.y += 1.49;
        const liveCam = (typeof getActiveViewCamera === 'function') ? getActiveViewCamera() : camera;
        const liveCamPos = new THREE.Vector3();
        liveCam.getWorldPosition(liveCamPos);
        labelMesh.lookAt(liveCamPos);
        
        if (progress < 1) {
            requestAnimationFrame(animateDice);
        } else {
            diceScene.remove(dice);
            diceScene.remove(labelMesh);
        }
    }
    
    animateDice();
}

function showDiceCinematicResult(rollValue, diceType, label, colorHex) {
    if (!ENABLE_DICE_RESULT_NUMBER_OVERLAY) return;
    const overlay = ensureDiceCinematicOverlay();
    if (!overlay || !diceCinematicResultCard || !diceCinematicResultValueEl || !diceCinematicResultLabelEl) return;

    const accent = `#${(colorHex || 0xffffff).toString(16).padStart(6, '0')}`;
    const dieLabel = diceType ? `D${diceType}` : 'DIE';
    diceCinematicResultLabelEl.textContent = [label, dieLabel].filter(Boolean).join(' • ');
    diceCinematicResultLabelEl.style.color = accent;
    diceCinematicResultValueEl.textContent = String(rollValue);
    diceCinematicResultValueEl.style.color = '#ffffff';
    diceCinematicResultValueEl.style.textShadow = `0 0 18px ${accent}, 0 0 42px ${accent}, 0 8px 28px rgba(0,0,0,0.92)`;
    diceCinematicResultCard.style.borderColor = `${accent}cc`;
    diceCinematicResultCard.style.boxShadow = `0 24px 72px rgba(0,0,0,0.7), 0 0 32px ${accent}66, inset 0 0 0 1px rgba(255,255,255,0.08)`;
    diceCinematicResultCard.style.opacity = '1';
    diceCinematicResultCard.style.transform = 'translate(-50%, -50%) scale(1.08)';

    window.setTimeout(() => {
        if (diceCinematicResultCard) {
            diceCinematicResultCard.style.transform = 'translate(-50%, -50%) scale(1)';
        }
    }, 180);
}

function clearDiceCinematicResult() {
    if (!ENABLE_DICE_RESULT_NUMBER_OVERLAY) return;
    if (!diceCinematicResultCard || !diceCinematicResultValueEl || !diceCinematicResultLabelEl) return;
    diceCinematicResultLabelEl.textContent = '';
    diceCinematicResultValueEl.textContent = '';
    diceCinematicResultCard.style.opacity = '0';
    diceCinematicResultCard.style.transform = 'translate(-50%, -42%) scale(0.84)';
}

function ensureOutcomeFocusEl() {
    if (outcomeFocusEl) return outcomeFocusEl;

    const styleTag = document.createElement('style');
    styleTag.textContent = `
        @keyframes outcome-focus-pop {
            0% { transform: translate(-50%, -52%) scale(0.9); opacity: 0; }
            16% { transform: translate(-50%, -50%) scale(1.05); opacity: 1; }
            70% { transform: translate(-50%, -50%) scale(1.0); opacity: 1; }
            100% { transform: translate(-50%, -48%) scale(0.98); opacity: 0; }
        }
        @keyframes outcome-focus-glow {
            0%, 100% { filter: drop-shadow(0 0 10px rgba(255,255,255,0.35)); }
            50% { filter: drop-shadow(0 0 28px rgba(255,255,255,0.65)); }
        }
    `;
    document.head.appendChild(styleTag);

    outcomeFocusEl = document.createElement('div');
    outcomeFocusEl.style.position = 'fixed';
    outcomeFocusEl.style.left = '50%';
    outcomeFocusEl.style.top = '38%';
    outcomeFocusEl.style.transform = 'translate(-50%, -50%)';
    outcomeFocusEl.style.zIndex = '130000';
    outcomeFocusEl.style.pointerEvents = 'none';
    outcomeFocusEl.style.fontFamily = 'Consolas, "Segoe UI", monospace';
    outcomeFocusEl.style.fontWeight = '800';
    outcomeFocusEl.style.fontSize = 'clamp(36px, 5.7vw, 82px)';
    outcomeFocusEl.style.letterSpacing = '0.06em';
    outcomeFocusEl.style.textTransform = 'uppercase';
    outcomeFocusEl.style.whiteSpace = 'nowrap';
    outcomeFocusEl.style.opacity = '0';
    outcomeFocusEl.style.display = 'none';
    outcomeFocusEl.style.textShadow = '0 0 18px rgba(0,0,0,0.75), 0 0 28px rgba(255,255,255,0.2)';
    document.body.appendChild(outcomeFocusEl);
    return outcomeFocusEl;
}

function focusOutcomeText(text, color = '#ffffff', durationMs = 1600) {
    if (!ENABLE_OUTCOME_FOCUS_OVERLAY) {
        if (outcomeFocusTimer) {
            window.clearTimeout(outcomeFocusTimer);
            outcomeFocusTimer = null;
        }
        if (outcomeFocusEl) {
            outcomeFocusEl.style.display = 'none';
            outcomeFocusEl.style.opacity = '0';
            outcomeFocusEl.style.animation = 'none';
        }
        return;
    }

    const el = ensureOutcomeFocusEl();
    el.textContent = text;
    el.style.color = color;
    el.style.display = 'block';
    el.style.opacity = '1';

    // Restart animations every time we show a new outcome.
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = 'outcome-focus-pop 1.05s ease forwards, outcome-focus-glow 0.72s ease-in-out 2';

    if (outcomeFocusTimer) {
        window.clearTimeout(outcomeFocusTimer);
    }
    outcomeFocusTimer = window.setTimeout(() => {
        outcomeFocusTimer = null;
        if (outcomeFocusEl) {
            outcomeFocusEl.style.display = 'none';
            outcomeFocusEl.style.opacity = '0';
        }
    }, Math.max(900, durationMs));
}

function setCombatUiSuppressed(suppressed) {
    combatUiSuppressed = !!suppressed;
    if (combatUiEl) {
        combatUiEl.style.opacity = combatUiSuppressed ? '0.22' : '1';
    }
    if (combatLogEl) {
        combatLogEl.style.opacity = combatUiSuppressed ? '0.2' : '1';
    }
    if (actionMenuEl) {
        actionMenuEl.style.opacity = combatUiSuppressed ? '0.24' : '1';
    }
    if (endTurnPromptUI) {
        endTurnPromptUI.style.opacity = combatUiSuppressed ? '0.2' : (endTurnPromptUI.style.display === 'none' ? '0' : '1');
    }
    if (confirmUI) {
        if (combatUiSuppressed) {
            confirmUI.dataset.preSuppressDisplay = confirmUI.style.display || 'none';
            confirmUI.style.display = 'none';
            confirmUI.style.visibility = 'hidden';
        } else if (confirmUI.dataset.preSuppressDisplay && confirmUI.dataset.preSuppressDisplay !== 'none') {
            confirmUI.style.display = confirmUI.dataset.preSuppressDisplay;
            confirmUI.style.visibility = 'visible';
        }
    }
}

function ensureDiceCinematicOverlay() {
    if (diceCinematicOverlay) return diceCinematicOverlay;

    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.pointerEvents = 'none';
    overlay.style.zIndex = '129950';
    overlay.style.opacity = '0';
    overlay.style.display = 'none';
    overlay.style.transition = 'opacity 420ms ease';
    overlay.style.willChange = 'opacity';
    overlay.style.backdropFilter = 'none';
    // Keep cinematic text/cards but remove full-screen dim/blackout wash.
    overlay.style.background = 'transparent';

    const title = document.createElement('div');
    title.textContent = 'DICE ROLL';
    title.style.position = 'absolute';
    title.style.left = '50%';
    title.style.top = '14%';
    title.style.transform = 'translate(-50%, 24px) scale(0.92)';
    title.style.fontFamily = 'Consolas, "Segoe UI", monospace';
    title.style.fontSize = 'clamp(16px, 2.2vw, 26px)';
    title.style.fontWeight = '700';
    title.style.letterSpacing = '0.24em';
    title.style.color = 'rgba(232, 244, 255, 0.9)';
    title.style.textShadow = '0 0 16px rgba(0,0,0,0.75)';
    title.style.opacity = '0';
    title.style.transition = 'opacity 300ms ease, transform 420ms cubic-bezier(0.2, 0.9, 0.24, 1)';
    overlay.appendChild(title);
    diceCinematicTitleEl = title;

    const resultCard = document.createElement('div');
    resultCard.style.position = 'absolute';
    resultCard.style.left = '50%';
    resultCard.style.top = '52%';
    resultCard.style.transform = 'translate(-50%, -40%) scale(0.82)';
    resultCard.style.minWidth = 'min(44vw, 420px)';
    resultCard.style.padding = '18px 28px 20px';
    resultCard.style.borderRadius = '24px';
    resultCard.style.border = '2px solid rgba(255,255,255,0.58)';
    resultCard.style.background = 'linear-gradient(180deg, rgba(6,10,22,0.42), rgba(8,12,24,0.18))';
    resultCard.style.backdropFilter = 'none';
    resultCard.style.boxShadow = '0 24px 72px rgba(0,0,0,0.7), 0 0 24px rgba(255,255,255,0.18)';
    resultCard.style.textAlign = 'center';
    resultCard.style.opacity = '0';
    resultCard.style.transition = 'opacity 260ms ease, transform 520ms cubic-bezier(0.16, 0.92, 0.2, 1), box-shadow 220ms ease, border-color 220ms ease';

    const resultLabel = document.createElement('div');
    resultLabel.style.fontFamily = 'Consolas, "Segoe UI", monospace';
    resultLabel.style.fontSize = 'clamp(14px, 1.4vw, 18px)';
    resultLabel.style.fontWeight = '700';
    resultLabel.style.letterSpacing = '0.2em';
    resultLabel.style.textTransform = 'uppercase';
    resultLabel.style.marginBottom = '8px';
    resultLabel.style.opacity = '0.96';
    resultCard.appendChild(resultLabel);

    const resultValue = document.createElement('div');
    resultValue.style.fontFamily = 'Consolas, "Segoe UI", monospace';
    resultValue.style.fontSize = 'clamp(86px, 14vw, 172px)';
    resultValue.style.lineHeight = '0.9';
    resultValue.style.fontWeight = '900';
    resultValue.style.letterSpacing = '-0.04em';
    resultValue.style.webkitTextStroke = '2px rgba(255,255,255,0.2)';
    resultValue.style.paintOrder = 'stroke fill';
    resultCard.appendChild(resultValue);

    overlay.appendChild(resultCard);
    diceCinematicResultCard = resultCard;
    diceCinematicResultLabelEl = resultLabel;
    diceCinematicResultValueEl = resultValue;

    diceCinematicOverlay = overlay;
    document.body.appendChild(overlay);
    return overlay;
}

function setDiceCinematicOverlayVisible(visible) {
    const overlay = ensureDiceCinematicOverlay();
    if (!overlay) return;

    if (visible) {
        overlay.style.display = 'block';
        requestAnimationFrame(() => {
            if (!overlay) return;
            overlay.style.opacity = '1';
            overlay.style.backdropFilter = 'none';
            if (diceCinematicTitleEl) {
                diceCinematicTitleEl.style.opacity = '1';
                diceCinematicTitleEl.style.transform = 'translate(-50%, 0) scale(1)';
            }
        });
        return;
    }

    clearDiceCinematicResult();
    if (diceCinematicTitleEl) {
        diceCinematicTitleEl.style.opacity = '0';
        diceCinematicTitleEl.style.transform = 'translate(-50%, 20px) scale(0.94)';
    }
    overlay.style.backdropFilter = 'none';
    overlay.style.opacity = '0';
    window.setTimeout(() => {
        if (overlay && !diceCinematicActive) {
            overlay.style.display = 'none';
        }
    }, 420);
}

function endDiceCinematic() {
    if (!diceCinematicActive) return;
    diceCinematicActive = false;
    setCombatUiSuppressed(false);
    setDiceCinematicOverlayVisible(false);
}

function beginDiceCinematic(durationMs = 1900) {
    // During brief attack emphasis, reduce competing UI noise.
    diceCinematicActive = true;
    setCombatUiSuppressed(true);
    setDiceCinematicOverlayVisible(true);
    if (diceCinematicTimer) {
        window.clearTimeout(diceCinematicTimer);
    }
    const requestedDurationMs = Number(durationMs);
    const safeDurationMs = Number.isFinite(requestedDurationMs) ? requestedDurationMs : 0;
    diceCinematicTimer = window.setTimeout(() => {
        diceCinematicTimer = null;
        endDiceCinematic();
    }, THREE.MathUtils.clamp(safeDurationMs, DICE_CINEMATIC_MIN_MS, DICE_CINEMATIC_MAX_MS));
}

function restoreCombatInteractionTargetVisual() {
    const target = combatInteraction.target;
    if (!target || !target.material) return;
    // Restore original material if we created an emissive one
    if (target.userData.previewOriginalMaterial) {
        target.material = target.userData.previewOriginalMaterial;
        delete target.userData.previewOriginalMaterial;
        delete target.userData.pulsingTile;
    } else {
        // Fallback: restore color properties
        if (target.material.emissive && target.userData && target.userData.previewOriginalEmissive !== undefined) {
            target.material.emissive.setHex(target.userData.previewOriginalEmissive);
            delete target.userData.previewOriginalEmissive;
        }
        if (target.material.color && target.userData && target.userData.previewOriginalColor !== undefined) {
            target.material.color.setHex(target.userData.previewOriginalColor);
            delete target.userData.previewOriginalColor;
        }
    }
    removeTargetSelectionRing(target);
}

function hideCombatConfirmUI() {
    if (!confirmUI) return;
    if (confirmUI.parentElement) confirmUI.parentElement.removeChild(confirmUI);
    confirmUI = null;
}

function isCombatReviewUiOpen() {
    if (currentGameMode !== GAME_MODE.COMBAT) return false;
    if (combatInteraction.awaitingConfirm) return true;
    return false;
}

function resetCombatInteraction(options = {}) {
    const preserveAction = !!options.preserveAction;
    const keepPhase = !!options.keepPhase;
    restoreCombatInteractionTargetVisual();
    combatInteraction.target = null;
    combatInteraction.preview = null;
    combatInteraction.autoApproachPreview = null;
    combatInteraction.awaitingConfirm = false;
    combatInteraction.previewRequestId = null;
    combatInteraction.moveAndAttackTarget = null;
    if (!preserveAction) {
        combatInteraction.action = null;
        currentAction = null;
        ffxMenuState.openSub = null;
    }
    if (!keepPhase) {
        setCombatUiPhase(COMBAT_UI_PHASE.IDLE);
    }
    hideCombatConfirmUI();
}

function ensureCombatConfirmUI() {
    // Legacy confirm panel is retired. The FFX action-menu renders inline confirm controls.
    if (confirmUI && confirmUI.parentElement) confirmUI.parentElement.removeChild(confirmUI);
    confirmUI = null;
    return null;
}

function positionCombatConfirmUI() {
    // No-op: legacy confirm panel removed.
}

let endTurnPromptUI = null;

function ensureEndTurnPromptUI() {
    if (endTurnPromptUI) return endTurnPromptUI;

    endTurnPromptUI = document.createElement('div');
    endTurnPromptUI.id = 'end-turn-prompt';
    endTurnPromptUI.style.position = 'fixed';
    endTurnPromptUI.style.top = 'auto';
    endTurnPromptUI.style.left = '24px';
    endTurnPromptUI.style.bottom = '24px';
    endTurnPromptUI.style.transform = 'none';
    endTurnPromptUI.style.minWidth = '220px';
    endTurnPromptUI.style.width = 'min(26vw, 320px)';
    endTurnPromptUI.style.maxWidth = 'min(26vw, 320px)';
    endTurnPromptUI.style.padding = '14px 16px';
    endTurnPromptUI.style.background = 'linear-gradient(180deg, rgba(15, 23, 42, 0.96), rgba(20, 30, 50, 0.98))';
    endTurnPromptUI.style.border = '2px solid rgba(220, 38, 38, 0.6)';
    endTurnPromptUI.style.borderRadius = '12px';
    endTurnPromptUI.style.boxShadow = '0 16px 48px rgba(0,0,0,0.62), 0 0 24px rgba(220,38,38,0.16), inset 0 0 0 1px rgba(255,255,255,0.04)';
    endTurnPromptUI.style.backdropFilter = 'blur(10px)';
    endTurnPromptUI.style.color = '#f1f5f9';
    endTurnPromptUI.style.fontFamily = 'Consolas, "Segoe UI", monospace';
    endTurnPromptUI.style.fontSize = '15px';
    endTurnPromptUI.style.lineHeight = '1.7';
    endTurnPromptUI.style.textAlign = 'center';
    endTurnPromptUI.style.zIndex = '119999';
    endTurnPromptUI.style.display = 'none';
    endTurnPromptUI.style.visibility = 'hidden';
    endTurnPromptUI.style.opacity = '0';
    endTurnPromptUI.style.pointerEvents = 'auto';
    endTurnPromptUI.style.cursor = 'default';
    endTurnPromptUI.style.transition = 'opacity 0.2s ease, visibility 0.2s ease';
    document.body.appendChild(endTurnPromptUI);
    
    window.addEventListener('resize', () => {
        if (endTurnPromptUI && endTurnPromptUI.style.display !== 'none') {
            positionEndTurnPromptUI();
        }
    });
    
    return endTurnPromptUI;
}

function positionEndTurnPromptUI() {
    if (!endTurnPromptUI) return;

    const hud = document.getElementById('hud');
    if (!hud || !hud.classList.contains('visible')) {
        endTurnPromptUI.style.left = '24px';
        endTurnPromptUI.style.bottom = '24px';
        endTurnPromptUI.style.right = 'auto';
        endTurnPromptUI.style.top = 'auto';
        endTurnPromptUI.style.transform = 'none';
        return;
    }

    const hudRect = hud.getBoundingClientRect();
    const spacing = 18;
    const viewportPadding = 16;
    const promptRect = endTurnPromptUI.getBoundingClientRect();
    const promptWidth = promptRect.width || 360;
    const promptHeight = promptRect.height || 90;

    let left = hudRect.left - promptWidth - spacing;
    let top = hudRect.bottom - promptHeight;

    if (left < viewportPadding) {
        left = viewportPadding;
    }
    if (left + promptWidth > window.innerWidth - viewportPadding) {
        left = Math.max(viewportPadding, window.innerWidth - promptWidth - viewportPadding);
    }
    if (top < viewportPadding) {
        top = Math.max(viewportPadding, hudRect.top - promptHeight - spacing);
    }

    endTurnPromptUI.style.left = `${Math.round(left)}px`;
    endTurnPromptUI.style.top = `${Math.round(top)}px`;
    endTurnPromptUI.style.right = 'auto';
    endTurnPromptUI.style.bottom = 'auto';
    endTurnPromptUI.style.transform = 'none';
}

function shouldShowEndTurnPrompt() {
    if (modeManager.current === MODE.DM) {
        return false;
    }
    if (currentGameMode !== GAME_MODE.COMBAT || combatState.phase !== 'PLAYER') {
        return false;
    }
    if (turnEndRequired || pendingTurnEndRequired || isTurnEndPresentationBlocked()) {
        return false;
    }
    return combatState.player.actionUsed && combatState.player.movementRemaining <= 0;
}

function showEndTurnPrompt() {
    if (turnEndRequired) return;
    const ui = ensureEndTurnPromptUI();
    console.log('Showing end-turn prompt, UI element:', ui);
    ui.innerHTML = `
        <div style="font-size:14px;color:#fca5a5;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:8px;font-weight:600;">Out of Actions</div>
        <div style="font-size:15px;color:#e2e8f0;margin-bottom:12px;">Movement and actions exhausted</div>
        <div style="font-size:14px;color:#94a3b8;margin-bottom:10px;">Press <span style="color:#fbbf24;font-weight:700;">ENTER</span> to end your turn</div>
    `;
    ui.style.display = 'block';
    ui.style.visibility = 'visible';
    ui.style.opacity = '1';
    positionEndTurnPromptUI();
    console.log('End-turn prompt positioned:', ui.style.left, ui.style.top);
}

function hideEndTurnPrompt() {
    if (!endTurnPromptUI) return;
    endTurnPromptUI.style.opacity = '0';
    endTurnPromptUI.style.visibility = 'hidden';
    setTimeout(() => {
        if (endTurnPromptUI) {
            endTurnPromptUI.style.display = 'none';
        }
    }, 200);
}

function showAttackPreviewUI() {
    hideCombatConfirmUI();
    updateActionMenu();
}

function showMoveConfirmUI() {
    hideCombatConfirmUI();
    updateActionMenu();
}

function selectMoveAndAttackAction(target) {
    if (modeManager.current === MODE.DM && getControlledActor() !== playerState) return false;
    if (!target || !target.userData || !target.userData.isTargetable) return false;
    if (combatInteraction.awaitingConfirm) return false;
    if (isInputLockedForCombat('ACTION')) return false;
    if (!canAttack()) {
        showFloatingText('Attack unavailable', '#ff8a8a', true);
        return false;
    }

    // Check if enemy is in melee range
    const inMeleeRange = canTarget(playerState, target, DND_RANGES.melee, false);
    const approachPreview = buildAutoApproachPreview(target);
    
    // Store target for later attack
    resetCombatInteraction({ preserveAction: true });
    combatInteraction.target = target;
    
    if (inMeleeRange) {
        // Unified flow: enemy click + attack mode goes straight to inline FFX confirm.
        selectAttackTarget(target);
    } else if (approachPreview && approachPreview.valid) {
        // Unified flow: create move+attack preview and confirm through the FFX menu only.
        initiateAutoApproachToTarget(target, approachPreview);
    } else {
        // Too far to auto-combo this turn, fall back to manual move guidance.
        showFloatingText('Too far this turn - move closer first', '#66b3ff', true);
        showMovementTilesForApproach(target);
    }
    return true;
}

function buildAutoApproachPreview(target) {
    if (!target || !target.position) return null;
    const targetPos = target.position.clone();
    const playerPos = playerState.position.clone();
    const direction = new THREE.Vector3(targetPos.x - playerPos.x, 0, targetPos.z - playerPos.z);
    const planarLen = direction.length();
    if (planarLen < 0.0001) return null;
    direction.multiplyScalar(1 / planarLen);

    const meleeRangeUnits = feetToUnits(DND_RANGES.melee);
    const desired = targetPos.clone().addScaledVector(direction, -meleeRangeUnits);
    const snapped = snapToMoveGrid(desired.x, desired.z);
    const destPos = new THREE.Vector3(snapped.x, playerState.position.y, snapped.z);
    const costFeet = getMoveCostFeet(playerState.position, destPos);
    const valid = costFeet > 0 &&
        costFeet <= combatState.player.movementRemaining &&
        canMoveTo(destPos);

    return {
        destPos,
        costFeet,
        valid,
        remainingFeet: Math.max(0, Math.round(combatState.player.movementRemaining - costFeet)),
    };
}

function showAutoMoveAttackPrompt(target, preview) {
    // Legacy chooser UI removed. Route through unified FFX menu flow.
    initiateAutoApproachToTarget(target, preview);
}

function showMoveOrAttackPrompt(target) {
    // Legacy chooser UI removed. Route through unified FFX menu flow.
    selectAttackTarget(target);
}

function initiateAutoApproachToTarget(target, preparedPreview = null) {
    const previewData = preparedPreview || buildAutoApproachPreview(target);
    if (!previewData || !previewData.valid) {
        showFloatingText('Cannot auto-move into attack range', '#ff8a8a', true);
        showMovementTilesForApproach(target);
        return;
    }

    resetCombatInteraction({ preserveAction: true });
    combatInteraction.action = 'move-and-attack';
    combatInteraction.moveAndAttackTarget = target;
    combatInteraction.target = previewData.destPos;
    combatInteraction.preview = {
        destX: previewData.destPos.x,
        destZ: previewData.destPos.z,
        costFeet: previewData.costFeet,
        valid: previewData.valid,
        remainingFeet: previewData.remainingFeet,
    };
    combatInteraction.awaitingConfirm = true;
    setCombatUiPhase(COMBAT_UI_PHASE.CONFIRM_READY, { action: 'move-and-attack' });

    updateActionMenu();
    showMoveConfirmUI();
}

function showMovementTilesForApproach(target) {
    // Enable movement mode to let player pick an approach position
    combatInteraction.action = 'move-to-approach';
    combatInteraction.moveAndAttackTarget = target;
    setCombatUiPhase(COMBAT_UI_PHASE.TARGETING, { action: 'move-to-approach' });
    
    // Show movement range UI
    rebuildCombatMoveTiles();
    showFloatingText('Click to move closer, then you can attack', '#66b3ff', true);
}

function selectAttackTarget(target) {
    if (modeManager.current === MODE.DM && getControlledActor() !== playerState) return false;
    if (!target || !target.userData || !target.userData.isTargetable) return false;
    if (combatInteraction.awaitingConfirm) return false;
    if (isInputLockedForCombat('ACTION')) return false;
    if (!canAttack()) {
        showFloatingText('Attack unavailable', '#ff8a8a', true);
        return false;
    }
    if (!socket || !socket.connected) {
        showFloatingText('No server connection', '#ff8a8a', true);
        return false;
    }

    const targetId = String(getCombatActorId(target) || '').trim();
    if (!targetId) {
        showFloatingText('Invalid target', '#ff8a8a', true);
        return false;
    }

    resetCombatInteraction({ preserveAction: true });
    combatInteraction.action = 'attack';
    currentAction = 'attack';
    combatInteraction.target = target;
    const previewRequestId = `preview_attack_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    combatInteraction.previewRequestId = previewRequestId;
    setCombatUiPhase(COMBAT_UI_PHASE.PREVIEW_PENDING, { action: 'attack', requestId: previewRequestId });

    uxTelemetry.marks.confirmUiStartAt = performance.now();

    if (target.material && target.material.emissive) {
        target.userData.previewOriginalEmissive = target.material.emissive.getHex();
        target.material.emissive.setHex(0xffff00);
    } else if (target.material && target.material.color) {
        target.userData.previewOriginalColor = target.material.color.getHex();
        target.material.color.setHex(0xffff00);
    }
    attachTargetSelectionRing(target);

    socket.emit('combat-action-preview', {
        requestId: previewRequestId,
        type: 'attack',
        attackType: 'melee',
        targetId,
    });

    setSelectedCombatTarget(target);
    updateActionMenu();
    showAttackPreviewUI();
    return true;
}

function selectMoveDestination(worldPos) {
    if (modeManager.current === MODE.DM && getControlledActor() !== playerState) return false;
    // Accept either a world-space Vector3/object or a legacy tile mesh.
    let destX, destZ;
    if (worldPos && worldPos.userData && worldPos.userData.combatMoveTile) {
        // Legacy tile path
        const step = feetToUnits(COMBAT_TILE_FEET);
        destX = worldPos.userData.tileX * step;
        destZ = worldPos.userData.tileZ * step;
    } else if (worldPos && Number.isFinite(worldPos.x)) {
        const snapped = snapToMoveGrid(worldPos.x, worldPos.z);
        destX = snapped.x;
        destZ = snapped.z;
    } else {
        return false;
    }

    if (combatInteraction.awaitingConfirm) return false;
    if (isInputLockedForCombat('MOVE')) return false;
    if (!canPlayerMove()) {
        const reason = combatState.phase !== 'PLAYER'
            ? 'Wait for your turn'
            : 'No movement left';
        showFloatingText(reason, '#ff8a8a', true);
        return false;
    }

    const movementAction = isMovementSelectionAction(currentAction) ? currentAction : 'move';
    const movementBudgetFt = getMovementBudgetForAction(movementAction);

    // Clamp destination inside movement radius
    const radiusUnits = feetToUnits(movementBudgetFt);
    const dx = destX - playerState.position.x;
    const dz = destZ - playerState.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist > radiusUnits + 0.01) {
        showFloatingText('Out of range', '#ff8a8a', true);
        return false;
    }

    const destPos = new THREE.Vector3(destX, playerState.position.y, destZ);
    const costFeet = getMoveCostFeet(playerState.position, destPos);
    const valid = costFeet > 0 && costFeet <= movementBudgetFt && canMoveTo(destPos);
    
    // Fail fast if destination leaves combat arena
    if (currentGameMode === GAME_MODE.COMBAT && !canMoveTo(destPos)) {
        // Silently reject — move disc is already clamped to arena, so this is a rare edge case
        return false;
    }

    resetCombatInteraction({ preserveAction: true });
    combatInteraction.action = movementAction;
    currentAction = movementAction;
    uxSetIntentStatus('move', 'armed', movementAction);
    combatInteraction.target = destPos;      // store world pos directly
    combatInteraction.preview = {
        destX,
        destZ,
        costFeet,
        valid,
        remainingFeet: Math.max(0, Math.round(movementBudgetFt - costFeet)),
        movementBudgetFt,
    };
    combatInteraction.awaitingConfirm = true;
    uxTelemetry.marks.confirmUiStartAt = performance.now();
    setCombatUiPhase(COMBAT_UI_PHASE.CONFIRM_READY, { action: movementAction });

    updateActionMenu();
    showMoveConfirmUI();
    if (uxTelemetry.enabled && uxTelemetry.marks.confirmUiStartAt > 0) {
        uxRecordSample(uxTelemetry.samples.confirmUiMs, performance.now() - uxTelemetry.marks.confirmUiStartAt);
        uxTelemetry.marks.confirmUiStartAt = 0;
    }
    return true;
}

// ── Preview and Execution Functions ──
function showAttackPreview(target) {
    void target;
    showFloatingText('Attack ready', '#ffeb3b');
    
    // Highlight target in yellow
    if (target.material && target.material.color) {
        target.userData.originalColor = target.material.color.getHex();
        target.material.color.set(0xffeb3b);
    }
}

function showMovementPreview(tile) {
    // Highlight tile in blue
    if (tile.material && tile.material.color) {
        tile.userData.originalColor = tile.material.color.getHex();
        tile.material.color.set(0x4488ff);
    }
    
    showFloatingText(`Move to tile (Click to confirm)`, '#4488ff');
}

function executeAttack(target) {
    if (!target || !target.userData || !target.userData.isTargetable) {
        recordInputFeedback('attack', 'blocked', 'invalid-target', { showFloating: false });
        cancelAction();
        return;
    }
    if (isInputLockedForCombat('ACTION')) {
        recordInputFeedback('attack', 'blocked', 'combat-locked', { showFloating: false });
        return;
    }
    if (combatState.timelineBusy) {
        recordInputFeedback('attack', 'queued', 'timeline-busy', { showFloating: false });
        return;
    }
    if (!isLocalCombatAuthority()) {
        recordInputFeedback('attack', 'blocked', 'authority-remote', { showFloating: false });
        showFloatingText('Combat authority is on player client', '#ff8a8a', true);
        return;
    }
    
    if (!canAttack()) {
        recordInputFeedback('attack', 'blocked', 'action-already-used', { showFloating: false });
        console.info('No action available. End turn to refresh action.');
        showFloatingText('Action already used', '#ff8a8a');
        logCombatEvent('Melee failed: no action left', 'miss');
        cancelAction();
        return;
    }

    if (!canTarget(playerState, target, DND_RANGES.melee, true)) {
        recordInputFeedback('attack', 'blocked', 'out-of-range', { showFloating: false });
        console.info('Out of range or no line of sight');
        showFloatingText('Out of range', '#ff8a8a', true);
        cancelAction();
        return;
    }

    if (!socket || !socket.connected) {
        recordInputFeedback('attack', 'blocked', 'no-server-connection', { showFloating: false });
        showFloatingText('No server connection', '#ff8a8a', true);
        cancelAction();
        return;
    }

    const targetId = String(getCombatActorId(target) || '').trim();
    if (!targetId) {
        recordInputFeedback('attack', 'blocked', 'invalid-target-id', { showFloating: false });
        showFloatingText('Invalid target', '#ff8a8a', true);
        cancelAction();
        return;
    }

    const actionId = `client_attack_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    uxSetIntentStatus('attack', 'sent', 'attack');
    socket.emit('combat-action', {
        id: actionId,
        type: 'attack',
        targetId,
        attackType: 'melee',
    });

    recordInputFeedback('attack', 'queued', 'server', {
        showFloating: false,
        presentation: {
            anchorObject: target,
            uiPhase: COMBAT_UI_PHASE.RESOLVING,
            action: 'attack',
            color: '#ffd166',
        },
    });
    showFloatingText('Attack sent to server', '#8dd694', true, { anchorObject: target });
    logCombatEvent(`Attack intent sent (${target.userData.name || targetId})`, 'system');
    setCombatUiPhase(COMBAT_UI_PHASE.RESOLVING, { action: 'attack' });
    resetCombatInteraction({ keepPhase: true });
    updateActionMenu();
}

function displayAttackResult(resolution, target, forceMessage = false) {
    // Priority 2: Outcome-first display. Large outcome word first, math details secondary.
    let resultColor = '#ffffff';
    let outcomeText = '';
    let focusDuration = 1500;
    const anchorTarget = target || playerRig;

    if (resolution.resultType === 'crit') {
        resultColor = '#ffd700';
        outcomeText = 'CRITICAL HIT';
        focusDuration = 1800;
    } else if (resolution.resultType === 'fumble') {
        resultColor = '#e05c5c';
        outcomeText = 'FUMBLE';
        focusDuration = 1700;
    } else if (resolution.hit) {
        resultColor = '#00ff00';
        outcomeText = 'HIT';
        focusDuration = 1500;
    } else {
        resultColor = '#ff0000';
        outcomeText = 'MISS';
        focusDuration = 1500;
    }

    // PRIMARY: show outcome only (large, bold)
    showFloatingText(outcomeText, resultColor, forceMessage, { anchorObject: anchorTarget });
    focusOutcomeText(outcomeText, resultColor, focusDuration);

    // SECONDARY: show math details in smaller text (delayed slightly for visual hierarchy)
    setTimeout(() => {
        let mathDetail = `${resolution.roll} + ${resolution.attackBonus} = ${resolution.total} vs AC ${resolution.targetAC}`;
        if (resolution.hit) {
            mathDetail += ` | Dmg: ${resolution.damageRoll} + ${resolution.damageBonus} = ${resolution.totalDamage}`;
        }
        showFloatingText(mathDetail, '#999999', forceMessage, { anchorObject: anchorTarget });
    }, 340);

    // Full breakdown in console (unchanged)
    console.info(`Attack Roll: ${resolution.roll} +${resolution.attackBonus} = ${resolution.total} vs AC ${resolution.targetAC}`);
    if (resolution.hit) {
        console.info(`Damage: ${resolution.damageRoll} + ${resolution.damageBonus} = ${resolution.totalDamage}`);
    }
}

function attackTarget(target) {
    executeAttack(target);
}

function rangedAttack(target) {
    if (!target || !target.userData || !target.userData.isTargetable) {
        recordInputFeedback('attack', 'blocked', 'invalid-target', { showFloating: false });
        return;
    }
    if (isInputLockedForCombat('ACTION')) {
        recordInputFeedback('attack', 'blocked', 'combat-locked', { showFloating: false });
        return;
    }
    if (combatState.timelineBusy) {
        recordInputFeedback('attack', 'queued', 'timeline-busy', { showFloating: false });
        return;
    }
    if (!isLocalCombatAuthority()) {
        recordInputFeedback('attack', 'blocked', 'authority-remote', { showFloating: false });
        showFloatingText('Combat authority is on player client', '#ff8a8a', true);
        return;
    }
    if (!canAttack()) {
        recordInputFeedback('attack', 'blocked', 'action-already-used', { showFloating: false });
        console.info('No action available. Press Enter to end turn and refresh.');
        showFloatingText('Action already used', '#ff8a8a');
        logCombatEvent('Ranged failed: no action left', 'miss');
        return;
    }

    if (!canTarget(playerState, target, DND_RANGES.spellRange30, true)) {
        recordInputFeedback('attack', 'blocked', 'out-of-range', { showFloating: false });
        console.info('Out of ranged attack distance or no line of sight.');
        showFloatingText('MISS', '#ff8a8a');
        spawnImpactBurst(target.position, 0xff7878, 10);
        triggerCombatFlash('#ff3333', 0.07, 170);
        shakeScreen(0.06, 100);  // Tiny shake on ranged miss
        playCombatSfxCue('miss');
        logCombatEvent(`Ranged miss on ${target.userData.name || 'target'}`, 'miss');
        return;
    }

    if (!socket || !socket.connected) {
        recordInputFeedback('attack', 'blocked', 'no-server-connection', { showFloating: false });
        showFloatingText('No server connection', '#ff8a8a', true);
        return;
    }

    const targetId = String(getCombatActorId(target) || '').trim();
    if (!targetId) {
        recordInputFeedback('attack', 'blocked', 'invalid-target-id', { showFloating: false });
        showFloatingText('Invalid target', '#ff8a8a', true);
        return;
    }

    const actionId = `client_attack_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    socket.emit('combat-action', {
        id: actionId,
        type: 'attack',
        targetId,
        attackType: 'ranged',
    });

    recordInputFeedback('attack', 'queued', 'server', {
        showFloating: false,
        presentation: {
            anchorObject: target,
            uiPhase: COMBAT_UI_PHASE.RESOLVING,
            action: 'ranged',
            color: '#66ccff',
        },
    });
    showFloatingText('Ranged attack sent to server', '#8dd694', true, { anchorObject: target });
    logCombatEvent(`Ranged intent sent (${target.userData.name || targetId})`, 'system');
}

function resetLocalTurnResources() {
    pendingTurnEndRequired = false;
    combatState.player.actionUsed = false;
    combatState.player.bonusUsed = false;
    combatState.player.movementRemaining = getPlayerBaseSpeedFt();
    combatState.player.hasActed = false;
    playerState.reactionAvailable = true;
    syncCombatPlayerToLegacyState();
}

function startPlayerTurn() {
    beginLocalCombatTimeline();
    addDmEvent('PLAYER TURN: Action + movement refreshed', 'system');
    clearTurnEndState();
    syncPlayerHealthFromHudIfAvailable();
    updatePlayerHealthHud();
    syncCombatTurnQueue(getLocalCombatActorId());
    setCombatPhase('PLAYER');
    setCombatTimelineBusy(false);
    setCombatLock(false);
    resetLocalTurnResources();
    pendingAction = null;
    resetCombatInteraction();
    saveSnapshot('player-turn-start');
    updateActionMenu();
    
    // Dramatic turn announcement
    showFloatingText('═══ YOUR TURN ═══', '#8dd694');
    playCombatSfxCue('turn-player');
    logCombatEvent('🎯 Your turn started - plan your attack!', 'system');
    // Defer tile generation one frame to avoid click-to-combat hitch.
    window.requestAnimationFrame(() => {
        if (isPlayerInputTurn()) {
            rebuildCombatMoveTiles();
        }
    });
    showActionUI(true);
}

function endTurn() {
    if (!socket || !socket.connected) {
        recordInputFeedback('end-turn', 'blocked', 'no-server-connection', { showFloating: false });
        console.warn('[END-TURN] blocked: no connection');
        return;
    }
    if (endTurnPending) {
        recordInputFeedback('end-turn', 'queued', 'already-pending', { showFloating: false, pushTimeline: false });
        console.log('[END-TURN] blocked: already pending');
        return;
    }
    if (currentGameMode !== GAME_MODE.COMBAT) {
        recordInputFeedback('end-turn', 'blocked', 'not-in-combat', { showFloating: false, pushTimeline: false });
        console.log('[END-TURN] endTurn: not in combat mode');
        return;
    }

    endTurnPending = true;
    if (endTurnWatchdog) {
        clearTimeout(endTurnWatchdog);
        endTurnWatchdog = null;
    }
    endTurnWatchdog = setTimeout(() => {
        if (!endTurnPending) return;
        endTurnPending = false;
        uxSetIntentStatus('endTurn', 'failed', 'timeout');
        recordInputFeedback('end-turn', 'rejected', 'timeout', { showFloating: false });
        console.warn('[END-TURN] watchdog timeout: no server response; pending cleared');
        showFloatingText('Turn sync timeout, retrying allowed', '#ffd166', true);
    }, 3500);

    addDmEvent('PLAYER TURN: Ended', 'system');
    clearTurnEndState();
    pendingAction = null;
    resetCombatInteraction();
    updateActionMenu();
    clearCombatMoveTiles();
    showActionUI(false);

    console.log('[END-TURN] emitting once');
    if (uxTelemetry.enabled) uxTelemetry.marks.endTurnSentAt = performance.now();
    uxSetIntentStatus('endTurn', 'sent', 'end-turn');
    recordInputFeedback('end-turn', 'queued', 'server', {
        showFloating: false,
        presentation: {
            anchorObject: playerRig || playerState,
            color: '#8dd694',
        },
    });
    socket.emit('end-turn', { clientTs: Date.now() }, (ack) => {
        console.log('[END-TURN] server ack:', ack);
        if (!ack || ack.ok === true) {
            recordInputFeedback('end-turn', 'accepted', 'server-ack', { showFloating: false, pushTimeline: false });
            return;
        }
        endTurnPending = false;
        if (endTurnWatchdog) {
            clearTimeout(endTurnWatchdog);
            endTurnWatchdog = null;
        }
        const reason = String(ack.reason || 'unknown');
        console.warn('[END-TURN] ack reported failure:', reason);
        recordInputFeedback('end-turn', 'rejected', reason, { showFloating: false });
        uxSetIntentStatus('endTurn', 'failed', reason);
    });
}

function canEnemySeePlayer(enemy, player) {
    if (!enemy || !player) return false;

    const ENEMY_VISION_RANGE_FEET = 14;
    const ENEMY_VISION_CONE_DEGREES = 24;
    
    // Distance check: intentionally tiny perception radius.
    const dist = getEdgeDistanceFeet(player, enemy);
    if (dist > ENEMY_VISION_RANGE_FEET) return false;
    
    // Line of sight check via raycasting
    const direction = new THREE.Vector3().subVectors(player.position, enemy.position).normalize();
    const rayOrigin = enemy.position.clone();
    rayOrigin.y += 1;  // Eye level
    
    const raycaster = new THREE.Raycaster(rayOrigin, direction, 0, dist);
    const intersects = raycaster.intersectObjects(scene.children, true);
    
    // Check if any solid object blocks the view
    for (const hit of intersects) {
        if (hit.object === player || (player.children && player.children.includes(hit.object))) continue;

        // Ignore enemy's own mesh hierarchy and helper visuals.
        let node = hit.object;
        let belongsToEnemy = false;
        while (node) {
            if (node === enemy) {
                belongsToEnemy = true;
                break;
            }
            node = node.parent;
        }
        if (belongsToEnemy) continue;
        if (hit.object.userData && (hit.object.userData.isTargetable || hit.object.userData.isFOVMesh || hit.object.userData.isCombatMoveTile)) continue;

        // Hit a solid obstacle
        return false;
    }
    
    // Angular cone check: intentionally tiny vision cone.
    const enemyForward = new THREE.Vector3(0, 0, -1);
    if (enemy.parent) {
        enemyForward.applyQuaternion(enemy.getWorldQuaternion(new THREE.Quaternion()));
    } else {
        enemyForward.applyQuaternion(enemy.quaternion);
    }
    
    const angleCos = direction.dot(enemyForward);
    const fovRadians = (ENEMY_VISION_CONE_DEGREES * Math.PI) / 180;
    const fovCos = Math.cos(fovRadians / 2);
    
    return angleCos >= fovCos;  // Within FOV cone
}

function moveEnemyTowardPlayer(enemy, player, moveDistFeet = 10) {
    if (!enemy || !player) return 0;

    const feetToMove = Math.max(0, Math.min(moveDistFeet, enemy.userData.movementRemaining || 0));
    if (feetToMove <= 0) return 0;

    // Keep enemy navigation on ground plane (XZ only) to avoid vertical drift/disappearing.
    const direction = new THREE.Vector3(
        player.position.x - enemy.position.x,
        0,
        player.position.z - enemy.position.z
    );
    const planarLen = direction.length();
    if (planarLen < 0.0001) return 0;
    direction.multiplyScalar(1 / planarLen);

    const moveDistance = feetToUnits(feetToMove);

    const prevY = enemy.position.y;

    // Move enemy toward player
    enemy.position.x += direction.x * moveDistance;
    enemy.position.z += direction.z * moveDistance;

    // Snap back to ground if BVH ground query is available.
    if (bvhColliderMesh && bvhColliderMesh.geometry && bvhColliderMesh.geometry.boundsTree) {
        const groundY = queryGroundHeightBVH(bvhColliderMesh, enemy.position, 80);
        if (Number.isFinite(groundY)) {
            enemy.position.y = groundY;
        } else {
            enemy.position.y = prevY;
        }
    } else {
        enemy.position.y = prevY;
    }

    enemy.lookAt(player.position.x, enemy.position.y, player.position.z);
    
    // Clamp to combat arena bounds if applicable
    if (combatCenter && combatRadius) {
        const dx = enemy.position.x - combatCenter.x;
        const dz = enemy.position.z - combatCenter.z;
        const dist = Math.sqrt((dx * dx) + (dz * dz));
        if (dist > combatRadius) {
            const clampScale = (combatRadius - 0.5) / Math.max(dist, 0.0001);
            enemy.position.x = combatCenter.x + (dx * clampScale);
            enemy.position.z = combatCenter.z + (dz * clampScale);
        }
    }

    // Safety clamp for bad values that can make meshes disappear from view.
    if (!Number.isFinite(enemy.position.x) || !Number.isFinite(enemy.position.y) || !Number.isFinite(enemy.position.z)) {
        enemy.position.copy(combatCenter);
        enemy.position.y = Number.isFinite(prevY) ? prevY : 0;
    }

    enemy.userData.movementRemaining = Math.max(0, (enemy.userData.movementRemaining || 0) - feetToMove);
    return feetToMove;
}

async function animateEnemyAdvance(enemy, destination, durationMs = ENEMY_TIMELINE_MS.moveDuration) {
    if (!enemy || !destination) return;

    const startPos = enemy.position.clone();
    const endPos = destination.clone();
    const duration = Math.max(220, durationMs || 0);
    const start = performance.now();

    await new Promise((resolve) => {
        function tick(now) {
            const t = Math.min(1, (now - start) / duration);
            const eased = 1 - Math.pow(1 - t, 3);
            enemy.position.lerpVectors(startPos, endPos, eased);
            enemy.lookAt(playerState.position.x, enemy.position.y, playerState.position.z);
            if (t >= 1) {
                resolve();
                return;
            }
            window.requestAnimationFrame(tick);
        }
        window.requestAnimationFrame(tick);
    });
}

function resetEnemyTurnResources(enemy) {
    if (!enemy || !enemy.userData) return;
    enemy.userData.movementRemaining = 30;
    enemy.userData.actionAvailable = true;
}

function tryUseEnemyAction(enemy) {
    if (!enemy || !enemy.userData || !enemy.userData.actionAvailable) return false;
    enemy.userData.actionAvailable = false;
    return true;
}

// Find another dummy that this dummy can target (for dummy-vs-dummy combat)
function findDummyTargetForDummy(actorDummy) {
    if (!actorDummy || !actorDummy.userData) return null;
    
    const validTargets = trainingDummies.filter((dummy) => {
        if (!dummy || !dummy.parent || dummy === actorDummy) return false;
        if ((dummy.userData?.hp || 0) <= 0) return false;
        // Dummies should attack other non-player faction dummies (training/elite dummies)
        // Player faction dummies should be avoided
        if (dummy.userData?.faction === 'player') return false;
        return true;
    });
    
    if (validTargets.length === 0) return null;
    
    // Pick a random dummy from valid targets
    return validTargets[Math.floor(Math.random() * validTargets.length)];
}

async function playEnemyMeleeActionSequence({
    enemy,
    enemyName,
    combatTarget,
    targetRig,
    resolution,
    replayTiming = null,
    prepText = null,
    sourceLabel = null,
}) {
    if (!enemy || !targetRig || !resolution) return;
    const timing = replayTiming || { remainingOffsetMs: 0 };
    const startFov = camera ? camera.fov : 58;
    const isPlayerTarget = combatTarget === playerState;
    const resolvedEnemyName = String(enemyName || enemy.userData?.name || 'Enemy');
    const attackLabel = String(sourceLabel || resolvedEnemyName).toUpperCase();

    const sequenceStart = performance.now();
    try {
        setCombatMessageLock(true);
        await runActionPresentationPhase('enemy-attack', 'anticipation', timing, {
            durationMs: 130,
            animationMs: 240,
            payload: { attackType: 'enemy-melee', actorId: getCombatActorId(enemy) },
            onEnter: async () => {
                beginDiceCinematic(7600);
                focusCameraOnAction(enemy, { strength: 1.45, durationMs: 1300 });
                await tweenCameraFov(44, 240);
                showFloatingText(prepText || `${attackLabel} PREPARES`, '#ffb3a7', true, { anchorObject: enemy });
                playConfirmAttackSnap();
                triggerEnemySwingAnim(enemy);
            },
        });

        await runActionPresentationPhase('enemy-attack', 'windup', timing, {
            durationMs: ENEMY_TIMELINE_MS.windup + ENEMY_TIMELINE_MS.rollHold,
            animationMs: 240,
            payload: { attackType: 'enemy-melee', actorId: getCombatActorId(enemy) },
            onEnter: () => {
                triggerSharedDiceRoll({
                    sides: 20,
                    label: `${attackLabel} ATTACK`,
                    mod: resolution.attackBonus,
                    raw: resolution.roll,
                    total: resolution.total,
                });
                spawnVisualDice(resolution.roll, 20, targetRig, `${attackLabel} ATTACK`);
                showFloatingText(`Roll: ${resolution.total}`, '#ffe08a', true, { anchorObject: targetRig });
            },
        });

        await runActionPresentationPhase('enemy-attack', 'impact', timing, {
            durationMs: ENEMY_TIMELINE_MS.impactHold,
            animationMs: 220,
            hitStopMs: 130,
            payload: { attackType: 'enemy-melee', actorId: getCombatActorId(enemy), hit: !!resolution.hit },
            onEnter: () => {
                focusCameraOnAction(targetRig, { strength: 1.8, durationMs: 1350 });
                displayAttackResult(resolution, targetRig, isPlayerTarget);
            },
        });

        await runActionPresentationPhase('enemy-attack', 'recovery', timing, {
            durationMs: ENEMY_TIMELINE_MS.resultHold,
            animationMs: 200,
            payload: { attackType: 'enemy-melee', actorId: getCombatActorId(enemy), resultType: resolution.resultType || 'normal' },
            onEnter: () => {
                if (resolution.hit) {
                    let dealt = 0;
                    if (isPlayerTarget) {
                        dealt = applyPlayerDamage(resolution.totalDamage, resolvedEnemyName);
                        showFloatingText(`-${dealt}`, '#ff6b6b', true, { anchorObject: playerRig });
                        playCombatSfxCue('enemy-hit-player');
                        logCombatEvent(`${resolvedEnemyName} hits you for ${dealt}`, 'miss');
                    } else {
                        dealt = applyDummyDamage(combatTarget, resolution.totalDamage);
                        showFloatingText(`-${dealt}`, '#ff6b6b', true, { anchorObject: targetRig });
                        logCombatEvent(`${resolvedEnemyName} hits ${combatTarget.userData?.name || 'target'} for ${dealt}`, 'info');
                        playCombatSfxCue('hit');
                    }
                    spawnImpactBurst(targetRig.position, 0xff4444, 28);
                    shakeScreen(0.2, 320);
                    triggerCombatFlash('#ff2d2d', 0.22, 380);
                    playConfirmAttackSnap();
                } else {
                    playCombatSfxCue('miss');
                    const targetName = isPlayerTarget ? 'you' : (combatTarget.userData?.name || 'the target');
                    logCombatEvent(`${resolvedEnemyName} misses ${targetName}`, 'info');
                }
            },
        });

        await runActionPresentationPhase('enemy-attack', 'settle', timing, {
            durationMs: ENEMY_TIMELINE_MS.damageHold,
            animationMs: 160,
            payload: { attackType: 'enemy-melee', actorId: getCombatActorId(enemy) },
        });
    } finally {
        const elapsedMs = performance.now() - sequenceStart;
        if (elapsedMs < COMBAT_PRESENTATION_MIN_MS) {
            await delay(COMBAT_PRESENTATION_MIN_MS - elapsedMs);
        }
        await tweenCameraFov(startFov, 320);
        setCombatMessageLock(false);
        endDiceCinematic();
    }
}

async function runEnemyTurn(enemyActor = null) {
    if (!isLocalCombatAuthority()) return;
    if (currentGameMode !== GAME_MODE.COMBAT) return;
    const queueEntry = enemyActor
        ? getCombatQueueEntryById(getCombatActorId(enemyActor))
        : getCurrentCombatQueueEntry();
    const enemy = enemyActor || (queueEntry && queueEntry.type === 'enemy' ? findCombatActorById(queueEntry.id) : null);
    if (!enemy || !enemy.parent || (enemy.userData.hp || 0) <= 0) {
        stepTurn();
        return;
    }

    if (modeManager.current === MODE.DM && getControlledActor() === enemy) {
        resetEnemyTurnResources(enemy);
        setCombatPhase('ENEMY');
        setCombatTimelineBusy(false);
        setCombatLock(false);
        showFloatingText(`${enemy.userData?.name || 'Enemy'} AWAITING DM`, '#ffcf85', true, { anchorObject: enemy });
        logCombatEvent(`${enemy.userData?.name || 'Enemy'} awaiting possessed DM input`, 'system');
        return;
    }

    setCombatPhase('ENEMY');
    setCombatLock(true);
    setCombatTimelineBusy(true);
    saveSnapshot('enemy-turn-start');

    try {
        resetEnemyTurnResources(enemy);
        const enemyName = enemy.userData.name || 'Enemy';
        await delay(ENEMY_TIMELINE_MS.readyHold);
        const canSeePlayerNow = canEnemySeePlayer(enemy, playerState);
        enemy.userData.playerSpotted = enemy.userData.playerSpotted || canSeePlayerNow;
        
        // If no player spotted, try to find and attack another dummy
        let combatTarget = null;
        if (enemy.userData.playerSpotted) {
            combatTarget = playerState;
        } else {
            combatTarget = findDummyTargetForDummy(enemy);
        }
        
        if (!combatTarget) {
            showFloatingText(`${enemyName.toUpperCase()} CONFUSED`, '#b9c0cf', true, { anchorObject: enemy });
            playCombatSfxCue('miss');
            logCombatEvent(`${enemyName} has no target`, 'info');
            await delay(ENEMY_TIMELINE_MS.resultHold);
            return;
        }

        if (combatTarget === playerState && combatTarget.hp <= 0) {
            showFloatingText(`${enemyName.toUpperCase()} CELEBRATES`, '#b9c0cf', true, { anchorObject: enemy });
            logCombatEvent(`${enemyName} victorious!`, 'info');
            await delay(ENEMY_TIMELINE_MS.resultHold);
            return;
        }

        if (combatTarget !== playerState && (combatTarget.userData?.hp || 0) <= 0) {
            showFloatingText(`${enemyName.toUpperCase()} SEARCHES`, '#b9c0cf', true, { anchorObject: enemy });
            logCombatEvent(`${enemyName} looks for another target`, 'info');
            await delay(ENEMY_TIMELINE_MS.resultHold);
            return;
        }

        const dist = getEffectiveCombatDistanceFeet(combatTarget, enemy);
        if (dist > DND_RANGES.melee && enemy.userData.movementRemaining > 0) {
            const startPos = enemy.position.clone();
            const neededFeet = Math.max(0, dist - DND_RANGES.melee);
            const movedFeet = moveEnemyTowardPlayer(enemy, combatTarget, neededFeet);
            const endPos = enemy.position.clone();
            enemy.position.copy(startPos);
            if (movedFeet > 0) {
                focusCameraOnAction(enemy, { strength: 1.2, durationMs: ENEMY_TIMELINE_MS.moveDuration + 420 });
                showFloatingText(`${enemyName} ADVANCES`, '#ffb3a7', true, { anchorObject: enemy });
                logCombatEvent(`${enemyName} moves ${Math.round(movedFeet)} ft toward target`, 'system');
                playCombatSfxCue('enemy-move');
                await animateEnemyAdvance(enemy, endPos, ENEMY_TIMELINE_MS.moveDuration);
                await delay(ENEMY_TIMELINE_MS.moveSettle);
            }
        }

        const newDist = getEffectiveCombatDistanceFeet(combatTarget, enemy);
        if (newDist <= DND_RANGES.melee && tryUseEnemyAction(enemy)) {
            const actionSnapshotBefore = createCombatSnapshot('action-before-enemy-melee');
            const resolution = resolveEnemyAttack(enemy, combatTarget);
            const targetRig = combatTarget === playerState ? playerRig : combatTarget;
            const isPlayerTarget = combatTarget === playerState;

            await playEnemyMeleeActionSequence({
                enemy,
                enemyName,
                combatTarget,
                targetRig,
                resolution,
            });

            const actionSnapshotAfter = createCombatSnapshot('action-after-enemy-melee');
            if (actionSnapshotBefore && actionSnapshotAfter) {
                recordCombatAction({
                    type: 'attack',
                    attackType: 'enemy-melee',
                    actorId: getCombatActorId(enemy),
                    targetId: isPlayerTarget ? 'player' : getCombatActorId(combatTarget),
                    resolution,
                    result: resolution.hit ? 'hit' : 'miss',
                    damage: resolution.totalDamage,
                    targetDefeated: isPlayerTarget ? playerState.hp <= 0 : (combatTarget.userData?.hp || 0) <= 0,
                    timestamp: Date.now(),
                    snapshotBefore: actionSnapshotBefore,
                    snapshotAfter: actionSnapshotAfter,
                });
            }
        } else {
            showFloatingText(`${enemyName.toUpperCase()} HOLDS`, '#b9c0cf', true, { anchorObject: enemy });
            playCombatSfxCue('miss');
            logCombatEvent(`${enemyName} is out of melee range`, 'info');
            await delay(ENEMY_TIMELINE_MS.resultHold);
        }
    } finally {
        setCombatTimelineBusy(false);
        if (currentGameMode === GAME_MODE.COMBAT && trainingDummies.length > 0) {
            stepTurn();
        }
    }
}

function showActionUI(show) {
    const shouldShow = !!show
        && modeManager.current !== MODE.DM
        && currentGameMode === GAME_MODE.COMBAT
        && combatState.phase === 'PLAYER';
    setActionMenuVisible(shouldShow);
}

function summarizeCombatActionForTimeline(actionRecord, index, total) {
    const seq = `${index + 1}/${total}`;
    if (!actionRecord) return `Timeline ${seq} - No action`;
    if (actionRecord.type !== 'attack') {
        return `Timeline ${seq} - ${String(actionRecord.type || 'action').toUpperCase()}`;
    }

    const attackType = String(actionRecord.attackType || 'attack').toUpperCase();
    const actor = String(actionRecord.actorId || 'unknown');
    const target = String(actionRecord.targetId || 'unknown');
    const result = String(actionRecord.result || 'pending').toUpperCase();
    const damage = Number(actionRecord.damage);
    const damageText = Number.isFinite(damage) ? ` DMG ${damage}` : '';

    return `Timeline ${seq} - ${attackType}: ${actor} -> ${target} ${result}${damageText}`;
}

function setCombatActionCursor(index) {
    if (!combatActionHistory.length) {
        combatActionHistoryCursor = -1;
        lastCombatAction = null;
        return null;
    }
    const clamped = THREE.MathUtils.clamp(Number(index) || 0, 0, combatActionHistory.length - 1);
    combatActionHistoryCursor = clamped;
    const action = combatActionHistory[clamped] || null;
    lastCombatAction = action;
    return action;
}

async function scrubDmTimelineToIndex(index) {
    if (!combatActionHistory.length) return;
    const clamped = THREE.MathUtils.clamp(Number(index) || 0, 0, combatActionHistory.length - 1);
    dmTimelinePendingIndex = clamped;
    if (dmTimelineScrubBusy) return;

    dmTimelineScrubBusy = true;
    try {
        while (Number.isInteger(dmTimelinePendingIndex)) {
            const nextIndex = dmTimelinePendingIndex;
            dmTimelinePendingIndex = null;
            setCombatActionCursor(nextIndex);
            await replayLastAction();
        }
    } finally {
        dmTimelineScrubBusy = false;
    }
}

function updateDmTimelineUI() {
    if (!dmTimelineRangeEl || !dmTimelineLabelEl) return;

    if (!DM_SHOW_TIMELINE) {
        if (dmTimelineEl) dmTimelineEl.style.display = 'none';
        return;
    }

    if (modeManager.current !== MODE.DM) {
        if (dmTimelineEl) dmTimelineEl.style.display = 'none';
        return;
    }

    if (dmTimelineEl) dmTimelineEl.style.display = 'flex';

    const total = combatActionHistory.length;
    if (total <= 0) {
        dmTimelineRangeEl.min = '0';
        dmTimelineRangeEl.max = '0';
        dmTimelineRangeEl.value = '0';
        dmTimelineRangeEl.disabled = true;
        dmTimelineLabelEl.textContent = 'DM Scrubber - waiting for combat outcomes';
        if (dmTimelineBranchEl) {
            dmTimelineBranchEl.textContent = 'No branch yet';
            dmTimelineBranchEl.style.color = '#9ec7ff';
        }
        return;
    }

    dmTimelineRangeEl.disabled = false;
    dmTimelineRangeEl.min = '0';
    dmTimelineRangeEl.max = String(total - 1);

    let activeIndex = combatActionHistoryCursor;
    if (!Number.isInteger(activeIndex) || activeIndex < 0) {
        activeIndex = total - 1;
    }
    activeIndex = THREE.MathUtils.clamp(activeIndex, 0, total - 1);
    if (Number(dmTimelineRangeEl.value) !== activeIndex) {
        dmTimelineRangeEl.value = String(activeIndex);
    }

    const action = combatActionHistory[activeIndex] || null;
    dmTimelineLabelEl.textContent = summarizeCombatActionForTimeline(action, activeIndex, total);
    if (dmTimelineBranchEl) {
        const latestIndex = Math.max(0, total - 1);
        if (activeIndex < latestIndex) {
            dmTimelineBranchEl.textContent = `Branch preview ${activeIndex + 1}/${total} (latest ${latestIndex + 1})`;
            dmTimelineBranchEl.style.color = '#ffd08e';
        } else {
            dmTimelineBranchEl.textContent = `Live branch ${latestIndex + 1}/${total}`;
            dmTimelineBranchEl.style.color = '#9ec7ff';
        }
    }
}

function runPossessedEnemyAttack(enemy) {
    if (!enemy || enemy === playerState || !enemy.parent) return false;
    if (currentGameMode !== GAME_MODE.COMBAT) return false;
    if (combatState.timelineBusy || combatReplayActive) return false;
    if (modeManager.current !== MODE.DM) return false;
    if (!isLocalCombatAuthority()) {
        showFloatingText('Combat authority is on player client', '#ff8a8a', true);
        return false;
    }
    if (getControlledActor() !== enemy) return false;

    const activeEntry = getCurrentCombatQueueEntry();
    if (!activeEntry || activeEntry.id !== getCombatActorId(enemy) || activeEntry.type !== 'enemy') {
        showFloatingText('Not this actor\'s turn', '#ff8a8a', true, { anchorObject: enemy });
        return false;
    }
    if (!enemy.userData?.actionAvailable) {
        showFloatingText('Action already used', '#ff8a8a', true, { anchorObject: enemy });
        return false;
    }

    const enemyName = enemy.userData.name || 'Enemy';
    const actionSnapshotBefore = createCombatSnapshot('action-before-possessed-enemy-melee');
    const resolution = resolveEnemyAttack(enemy, playerState);
    setCombatPhase('ENEMY');
    setCombatLock(true);
    setCombatTimelineBusy(true);
    tryUseEnemyAction(enemy);

    (async () => {
        try {
            await playEnemyMeleeActionSequence({
                enemy,
                enemyName: `${enemyName} (DM)`,
                combatTarget: playerState,
                targetRig: playerRig,
                resolution,
                prepText: `${enemyName.toUpperCase()} (DM)`,
            });
        } finally {
            setCombatTimelineBusy(false);
            setCombatLock(false);
            const actionSnapshotAfter = createCombatSnapshot('action-after-possessed-enemy-melee');
            if (actionSnapshotBefore && actionSnapshotAfter) {
                recordCombatAction({
                    type: 'attack',
                    attackType: 'enemy-melee',
                    actorId: getCombatActorId(enemy),
                    targetId: 'player',
                    resolution,
                    result: resolution.hit ? 'hit' : 'miss',
                    damage: resolution.totalDamage,
                    targetDefeated: playerState.hp <= 0,
                    timestamp: Date.now(),
                    snapshotBefore: actionSnapshotBefore,
                    snapshotAfter: actionSnapshotAfter,
                });
            }
        }
    })();

    return true;
}

function createEnemyFOVMesh() {
    const fovDegrees = 24;
    const fovRange = feetToUnits(14);
    const fovGeometry = new THREE.ConeGeometry(
        fovRange * Math.tan((fovDegrees * Math.PI / 180) / 2),
        fovRange,
        24
    );
    const fovMaterial = new THREE.MeshBasicMaterial({
        color: 0xff4444,
        transparent: true,
        opacity: 0.08,
        side: THREE.DoubleSide,
        fog: false,
        depthWrite: false,
    });
    const fovMesh = new THREE.Mesh(fovGeometry, fovMaterial);
    fovMesh.rotation.x = Math.PI / 2;
    fovMesh.position.y = 0.35;
    fovMesh.position.z = -(fovRange * 0.5);
    fovMesh.castShadow = false;
    fovMesh.receiveShadow = false;
    fovMesh.userData.isFOVMesh = true;
    return fovMesh;
}

// ─── Enemy Health Bar System ───────────────────────────────────────────────

function createEnemyHealthBar(dummy) {
    createEnemyHealthBarPrimitive(enemyHealthBars, dummy, document);
}

function removeEnemyHealthBar(dummy) {
    removeEnemyHealthBarPrimitive(enemyHealthBars, dummy);
}

function createPlayerHeadHealthBar(actorKey, name = 'Player') {
    createPlayerHeadHealthBarPrimitive(playerHeadHealthBars, actorKey, name, document);
}

function removePlayerHeadHealthBar(actorKey) {
    removePlayerHeadHealthBarPrimitive(playerHeadHealthBars, actorKey);
}

function updateSingleHeadHealthBar(bar, hp, maxHp) {
    updateSingleHeadHealthBarPrimitive(bar, hp, maxHp);
}

function updateAllPlayerHeadHealthBars() {
    if (!renderer) return;
    const activeView = getActiveViewCamera();
    if (!activeView) return;
    const w = renderer.domElement.clientWidth;
    const h = renderer.domElement.clientHeight;
    const localKey = 'local-player';
    const headBarHeightOffset = 1.65;

    // Combat uses dedicated UI; clear world-space player stat bars so they do not linger.
    if (currentGameMode === GAME_MODE.COMBAT) {
        for (const key of Array.from(playerHeadHealthBars.keys())) {
            removePlayerHeadHealthBar(key);
        }
        return;
    }

    if (modeManager.current !== MODE.DM && playerRig && playerRig.parent) {
        createPlayerHeadHealthBar(localKey, 'Player');
        const bar = playerHeadHealthBars.get(localKey);
        const pos3d = playerRig.position.clone();
        pos3d.y += headBarHeightOffset;
        pos3d.project(activeView);
        
        const shouldHide = pos3d.z > 1;
        if (shouldHide) {
            if (bar.container.style.display !== 'none') bar.container.style.display = 'none';
        } else {
            if (bar.container.style.display !== 'flex') bar.container.style.display = 'flex';
            const newLeft = `${(pos3d.x * 0.5 + 0.5) * w}px`;
            const newTop = `${(-pos3d.y * 0.5 + 0.5) * h}px`;
            if (bar.container.style.left !== newLeft) bar.container.style.left = newLeft;
            if (bar.container.style.top !== newTop) bar.container.style.top = newTop;
            updateSingleHeadHealthBar(bar, playerState.hp, playerState.maxHp);
        }
    } else {
        removePlayerHeadHealthBar(localKey);
    }

    const avatars = scene.userData && scene.userData.playerAvatars ? scene.userData.playerAvatars : null;
    const activeRemoteKeys = new Set();
    if (avatars) {
        const ownSids = getLocalSidIdentitySet();
        const ownActorIds = getLocalActorIdentitySet();
        for (const [playerId, avatarRoot] of Object.entries(avatars)) {
            // Skip the local player's own avatar — already rendered as 'local-player'.
            const avatarActorId = String(avatarRoot?.userData?.networkId || avatarRoot?.userData?.actorId || '').trim();
            if ((playerId && ownSids.has(playerId)) || (avatarActorId && ownActorIds.has(avatarActorId))) continue;
            const key = `remote-${playerId}`;
            activeRemoteKeys.add(key);
            if (!avatarRoot || !avatarRoot.parent || !avatarRoot.visible) {
                removePlayerHeadHealthBar(key);
                continue;
            }
            const role = String(avatarRoot.userData?.playerRole || '').toLowerCase();
            if (role === 'dm') {
                removePlayerHeadHealthBar(key);
                continue;
            }
            const label = 'Player';
            createPlayerHeadHealthBar(key, label);
            const bar = playerHeadHealthBars.get(key);
            if (bar && bar.nameEl.textContent !== label) {
                bar.nameEl.textContent = label;
            }

            const pos3d = avatarRoot.position.clone();
            pos3d.y += headBarHeightOffset;
            pos3d.project(activeView);
            if (pos3d.z > 1) {
                bar.container.style.display = 'none';
                continue;
            }

            bar.container.style.display = 'flex';
            bar.container.style.left = `${(pos3d.x * 0.5 + 0.5) * w}px`;
            bar.container.style.top = `${(-pos3d.y * 0.5 + 0.5) * h}px`;

            const maxHp = Number.isFinite(Number(avatarRoot.userData?.maxHp)) ? Number(avatarRoot.userData.maxHp) : 100;
            const hp = Number.isFinite(Number(avatarRoot.userData?.hp)) ? Number(avatarRoot.userData.hp) : maxHp;
            updateSingleHeadHealthBar(bar, hp, maxHp);
        }
    }

    for (const key of Array.from(playerHeadHealthBars.keys())) {
        if (key === 'local-player') continue;
        if (!activeRemoteKeys.has(key)) {
            removePlayerHeadHealthBar(key);
        }
    }
}

function updateAllEnemyHealthBars() {
    if (!renderer) return;
    const activeView = getActiveViewCamera();
    if (!activeView) return;
    const w = renderer.domElement.clientWidth;
    const h = renderer.domElement.clientHeight;

    for (const [dummy, bar] of enemyHealthBars) {
        if (!dummy.parent || (dummy.userData.hp || 0) <= 0) {
            removeEnemyHealthBar(dummy);
            continue;
        }
        const pos3d = dummy.position.clone();
        pos3d.y += 2.5;
        pos3d.project(activeView);

        // Only update display style if changed to reduce reflows
        const shouldHide = pos3d.z > 1;
        const currentDisplay = bar.container.style.display;
        if (shouldHide && currentDisplay !== 'none') {
            bar.container.style.display = 'none';
            continue;
        }
        if (!shouldHide && currentDisplay !== 'flex') {
            bar.container.style.display = 'flex';
        }
        
        // Only update position styles if changed
        const newLeft = `${(pos3d.x * 0.5 + 0.5) * w}px`;
        const newTop = `${(-pos3d.y * 0.5 + 0.5) * h}px`;
        if (bar.container.style.left !== newLeft) bar.container.style.left = newLeft;
        if (bar.container.style.top !== newTop) bar.container.style.top = newTop;

        const maxHp = dummy.userData.maxHp || 50;
        const hpFrac = Math.max(0, (dummy.userData.hp || 0) / maxHp);
        const hpPercent = `${hpFrac * 100}%`;
        if (bar.hpFill.style.width !== hpPercent) bar.hpFill.style.width = hpPercent;
        
        const newColor = hpFrac > 0.6 ? '#44ff66' : hpFrac > 0.3 ? '#ffcc00' : '#ff4444';
        if (bar.hpFill.style.background !== newColor) bar.hpFill.style.background = newColor;

        // Lag bar slowly bleeds down
        if (bar.lagValue > hpFrac) {
            bar.lagValue = Math.max(hpFrac, bar.lagValue - 0.006);
        } else {
            bar.lagValue = hpFrac;
        }
        const lagPercent = `${bar.lagValue * 100}%`;
        if (bar.lagFill.style.width !== lagPercent) bar.lagFill.style.width = lagPercent;
    }
}

// ─── Hit Flinch ────────────────────────────────────────────────────────────
const {
    triggerEnemySwingAnim,
    triggerEnemyFlinch,
    updateEnemyFlinches,
    playKillSequence,
} = createEnemyCombatFeedbackService({
    THREE,
    getPlayerState: () => playerState,
    getTrainingDummies: () => trainingDummies,
    focusOutcomeText,
    showFloatingText,
    spawnImpactBurst,
    triggerCombatFlash,
    shakeScreen,
    playCombatSfxCue,
    removeEnemyHealthBar,
    logCombatEvent,
    requestAnimationFrameFn: requestAnimationFrame,
    cancelAnimationFrameFn: cancelAnimationFrame,
    performanceObj: performance,
});

// ─── Target Glow Ring ──────────────────────────────────────────────────────

function attachTargetSelectionRing(target) {
    attachTargetSelectionRingPrimitive(target, THREE);
}

function removeTargetSelectionRing(target) {
    removeTargetSelectionRingPrimitive(target);
}

// ──────────────────────────────────────────────────────────────────────────

const {
    normalizeSpawnEntityType,
    spawnEntityByType,
    requestEntitySpawn,
    requestTrainingDummySpawn,
    requestStepTurn,
    requestEndTurn,
    requestRewindTurn,
    requestReplayLastAction,
    requestPossessActor,
    requestReleasePossession,
} = createSpawnAndTurnRequestService({
    getMode: () => modeManager.current,
    modeDm: MODE.DM,
    issueDmCommand,
    spawnTrainingDummy,
    consumePendingDmEncounterSetup,
    getPlayerState: () => playerState,
    canIssueDmCommand,
    stepTurn,
    endTurn,
    rewindTurn,
    replayLastAction,
    getCurrentGameMode: () => currentGameMode,
    gameModeCombat: GAME_MODE.COMBAT,
    getCombatActorId,
    getPlayerRig: () => playerRig,
    possessActor,
    releasePossession,
});

const dmCommandBus = createDmCommandBus({
    getMode: () => modeManager.current,
    modeDm: MODE.DM,
    canIssueDmCommand,
    getDmAuthorityLayer: () => dmAuthorityLayer,
    showFloatingText,
    appendConsoleHistory,
    getSimulationAuthority: () => simulationAuthority,
    simulationAuthorityLocalDm: SIMULATION_AUTHORITY.LOCAL_DM,
    getSocket: () => socket,
    getNetStats: () => _netStats,
    netLog,
    traceDmPipeline,
    applyDmCommandFromServer,
    addDmEvent,
    getWindow: () => window,
});

function dispatchDmCommand(command) {
    return dmCommandBus.dispatchDmCommand(command);
}

function logDmCommandAction(command) {
    return dmCommandBus.logDmCommandAction(command);
}

window.dispatchDmCommand = dispatchDmCommand;

function issueDmCommand(type, payload = {}) {
    return dmCommandBus.issueDmCommand(type, payload);
}

function emitDmCommand(command) {
    return dmCommandBus.emitDmCommand(command);
}

function applyDmCommandLocally(command) {
    return dmCommandBus.applyDmCommandLocally(command);
}

const {
    resolveCombatActorForDm,
    setActorHpById,
    applyDamageToActorById,
} = createDmActorControlService({
    getLocalCombatActorId,
    getPlayerState: () => playerState,
    findCombatActorById,
    updatePlayerHealthHud,
    removeTrainingDummy,
    getSelectedCombatTarget: () => selectedCombatTarget,
    setSelectedCombatTarget,
    exitCombatIfNoTargets,
    applyPlayerDamage,
});

const { handleDmInjectedInput } = createDmInjectedInputHandler({
    resolveCombatActorForDm,
    getSelectedCombatTarget: () => selectedCombatTarget,
    getPlayerState: () => playerState,
    setSelectedCombatTarget,
    selectMoveAndAttackAction,
    getControlledActor,
    possessActor,
    runPossessedEnemyAttack,
});

const dmCommandApplier = createDmCommandApplier({
    traceDmPipeline,
    getMode: () => modeManager.current,
    getSimulationAuthority: () => simulationAuthority,
    getDmAuthorityLayer: () => dmAuthorityLayer,
    isLocalCombatAuthority,
    spawnTrainingDummy,
    spawnEntityByType,
    stepTurn,
    endTurn,
    rewindTurn,
    replayLastAction,
    resolveCombatActorForDm,
    possessActor,
    releasePossession,
    setActorHpById,
    applyDamageToActorById,
    getPlayerState: () => playerState,
    removeTrainingDummy,
    handleDmInjectedInput,
    saveSnapshot,
    getCombatTimeline: () => combatTimeline,
    restoreCombatSnapshot,
    THREE,
    MODE,
    setSimulationAuthority,
    syncDmAuthorityLayerFromState,
    emitDiceRollEvent,
    addDmEvent,
});

function applyDmCommandFromServer(packet) {
    return dmCommandApplier.applyDmCommandFromServer(packet);
}

function forceGodModeForDiagnostics() {
    return dmAuthorityManager.forceGodModeForDiagnostics();
}

window.forceGodModeForDiagnostics = forceGodModeForDiagnostics;

function spawnTrainingDummy(x, y, z, name = 'Training Dummy') {
    const dummyGeometry = new THREE.CylinderGeometry(0.5, 0.5, 2, 16);
    const dummyMaterial = new THREE.MeshStandardMaterial({
        color: 0x883333,
        roughness: 0.78,
        metalness: 0.08,
    });
    const dummy = new THREE.Mesh(dummyGeometry, dummyMaterial);
    dummy.name = 'training_dummy_proxy';
    dummy.position.set(x, y + TRAINING_DUMMY_Y_OFFSET, z);
    dummy.castShadow = true;
    dummy.receiveShadow = true;

    const setProxyVisibility = (visible) => {
        dummy.material.transparent = !visible;
        dummy.material.opacity = visible ? 1 : 0;
        dummy.material.depthWrite = !!visible;
    };
    // Keep collider proxy fully transparent; visuals come from attached dummy model.
    setProxyVisibility(false);

    const fovMesh = createEnemyFOVMesh();
    dummy.add(fovMesh);

    dummy.userData = {
        actorId: `enemy-${combatActorIdCounter++}`,
        networkId: null,
        isTargetable: true,
        name,
        hp: 50,
        maxHp: 50,
        radius: 0.5,
        fovMesh: fovMesh,
        movementRemaining: 30,
        actionAvailable: true,
        playerSpotted: false,
        rigState: null,
        dynamic: true,
        collider: 'ignore',
    };
    dummy.userData.networkId = dummy.userData.actorId;
    scene.add(dummy);
    trainingDummies.push(dummy);
    createEnemyHealthBar(dummy);
    if (currentGameMode === GAME_MODE.COMBAT) {
        syncCombatTurnQueue();
    }

    const modelLoadToken = `training-dummy-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    dummy.userData.modelLoadToken = modelLoadToken;
    const modelUrls = Array.from(new Set([
        trainingDummyProfileModelUrl,
        TRAINING_DUMMY_MODEL_URL,
        TRAINING_DUMMY_MODEL_URL_FALLBACK,
    ].filter((url) => typeof url === 'string' && url.trim().length > 0)));

    const ensureTrainingDummyBasePoseMap = (root) => {
        if (!root || !root.userData) return null;
        if (root.userData.trainingDummyBasePoseMap instanceof Map) return root.userData.trainingDummyBasePoseMap;
        const baseMap = new Map();
        root.traverse((child) => {
            if (!child || !child.isBone) return;
            baseMap.set(child.uuid, {
                bone: child,
                quat: child.quaternion.clone(),
                pos: child.position.clone(),
            });
        });
        root.userData.trainingDummyBasePoseMap = baseMap;
        return baseMap;
    };

    const findFirstBoneByPattern = (root, pattern) => {
        if (!root) return null;
        let found = null;
        root.traverse((child) => {
            if (found || !child || !child.isBone) return;
            const nameText = String(child.name || '');
            if (pattern.test(nameText)) found = child;
        });
        return found;
    };

    const applyTrainingDummyPose = (root, poseName) => {
        if (!root) return;
        const pose = TRAINING_DUMMY_POSE_PRESETS.has(String(poseName || '').toLowerCase())
            ? String(poseName).toLowerCase()
            : 'idle';

        const baseMap = ensureTrainingDummyBasePoseMap(root);
        if (baseMap) {
            baseMap.forEach(({ bone, quat, pos }) => {
                bone.quaternion.copy(quat);
                bone.position.copy(pos);
            });
        }
        root.rotation.set(0, 0, 0);
        root.position.y = 0;
        const leftUpperArm = findFirstBoneByPattern(root, /(left.*upperarm|upperarm.*left|leftarm|arm_l|l_upperarm|larm)/i);
        const rightUpperArm = findFirstBoneByPattern(root, /(right.*upperarm|upperarm.*right|rightarm|arm_r|r_upperarm|rarm)/i);
        const chest = findFirstBoneByPattern(root, /(chest|upperchest|spine2|spine_2|spine3|spine_3|torso)/i);
        const head = findFirstBoneByPattern(root, /(head|neck)/i);

        if (pose === 'idle') {
            // Keep dummies relaxed at rest instead of defaulting to an arms-up bind stance.
            if (leftUpperArm) leftUpperArm.rotation.z += -1.15;
            if (rightUpperArm) rightUpperArm.rotation.z += 1.15;
            return;
        }

        if (pose === 'guard') {
            if (leftUpperArm) leftUpperArm.rotation.x += -0.45;
            if (rightUpperArm) rightUpperArm.rotation.x += -0.45;
            if (leftUpperArm) leftUpperArm.rotation.z += 0.25;
            if (rightUpperArm) rightUpperArm.rotation.z += -0.25;
            return;
        }

        if (pose === 'taunt') {
            if (leftUpperArm) leftUpperArm.rotation.x += -1.1;
            if (leftUpperArm) leftUpperArm.rotation.z += 0.3;
            if (rightUpperArm) rightUpperArm.rotation.x += -0.2;
            if (rightUpperArm) rightUpperArm.rotation.z += -0.12;
            if (head) head.rotation.y += 0.22;
            root.rotation.y = 0.24;
            return;
        }

        if (pose === 'slump') {
            if (chest) chest.rotation.x += 0.34;
            if (head) head.rotation.x += 0.2;
            if (leftUpperArm) leftUpperArm.rotation.x += 0.22;
            if (rightUpperArm) rightUpperArm.rotation.x += 0.22;
            root.position.y = -0.06;
        }
    };

    const tryLoadModelUrl = (urlIndex) => {
        if (!dummy.parent || dummy.userData.modelLoadToken !== modelLoadToken) return;
        if (urlIndex >= modelUrls.length) {
            console.warn('[COMBAT] Failed to load training dummy model from all configured paths', modelUrls);
            return;
        }

        const modelUrl = modelUrls[urlIndex];
        trainingDummyVisualLoader.load(
            modelUrl,
            (gltf) => {
                if (!dummy.parent || dummy.userData.modelLoadToken !== modelLoadToken) return;

                const modelRoot = gltf.scene || (gltf.scenes && gltf.scenes[0]);
                if (!modelRoot) return;

                modelRoot.name = 'training_dummy_visual';
                let visualMeshCount = 0;
                modelRoot.traverse((child) => {
                    if (!child || !child.isMesh) return;
                    visualMeshCount += 1;
                    child.castShadow = true;
                    child.receiveShadow = true;
                    child.frustumCulled = false;
                    child.userData = child.userData || {};
                    child.userData.selectTarget = dummy;
                    child.userData.dynamic = true;
                    child.userData.collider = 'ignore';
                    // Keep targeting on the lightweight proxy mesh only.
                    child.raycast = () => [];
                });
                if (visualMeshCount <= 0) return;

                const modelBounds = new THREE.Box3().setFromObject(modelRoot);
                if (!modelBounds.isEmpty()) {
                    const modelCenter = modelBounds.getCenter(new THREE.Vector3());
                    const modelSize = modelBounds.getSize(new THREE.Vector3());
                    // Center on X/Z, then anchor feet to Y=0 so dummies do not float.
                    modelRoot.position.x -= modelCenter.x;
                    modelRoot.position.z -= modelCenter.z;
                    if (modelSize.y > 0.0001) {
                        const scaleToDummyHeight = 2 / modelSize.y;
                        modelRoot.scale.setScalar(scaleToDummyHeight);
                    }
                    const groundedBounds = new THREE.Box3().setFromObject(modelRoot);
                    if (!groundedBounds.isEmpty()) {
                        modelRoot.position.y -= groundedBounds.min.y;
                    }
                }

                dummy.add(modelRoot);
                dummy.userData.modelUrl = modelUrl;
                dummy.userData.pose = trainingDummyProfilePose;
                applyTrainingDummyPose(modelRoot, trainingDummyProfilePose);
                if (trainingDummyProfilePose === 'idle') {
                    let rigState = applyStoredAvatarRig(modelRoot, trainingDummyProfileRigSettings);
                    if (!rigState || !rigState.active || typeof rigState.update !== 'function') {
                        // Fallback rebone: stored settings may not match this model's skeleton;
                        // force canonical synthetic-skeleton path so any mesh gets procedural idle.
                        rigState = applyStoredAvatarRig(modelRoot, { useFallbackRig: true });
                    }
                    if (rigState && rigState.active && typeof rigState.update === 'function') {
                        dummy.userData.rigState = rigState;
                    }
                }
                setProxyVisibility(false);
            },
            undefined,
            () => {
                tryLoadModelUrl(urlIndex + 1);
            }
        );
    };
    tryLoadModelUrl(0);

    return dummy;
}

// ============================================

function applyDeadzone(value, deadzone = xrDeadzone) {
    return Math.abs(value) < deadzone ? 0 : value;
}

function getActiveViewCamera() {
    const baseCamera = activeCamera || camera;
    if (rendererReady && renderer && renderer.xr && renderer.xr.isPresenting) {
        return renderer.xr.getCamera(baseCamera);
    }
    return baseCamera;
}

function getPrimaryStickAxes(gamepad) {
    return ensureUnifiedInputManager().getPrimaryStickAxes(gamepad);
}

function applyXRFlightControls(delta) {
    if (!renderer.xr.isPresenting) return false;
    const session = renderer.xr.getSession();
    if (!session) return false;
    const xrInput = ensureUnifiedInputManager().getXrFlightState(session.inputSources);
    const leftX = Number(xrInput.moveX) || 0;
    const leftY = Number(xrInput.moveY) || 0;
    const rightX = Number(xrInput.turnX) || 0;
    const verticalInput = Number(xrInput.vertical) || 0;

    const xrCamera = renderer.xr.getCamera(camera);
    xrCamera.getWorldDirection(xrForward);
    xrForward.y = 0;
    if (xrForward.lengthSq() < 0.0001) {
        xrForward.set(0, 0, -1);
    } else {
        xrForward.normalize();
    }

    xrRight.crossVectors(xrForward, new THREE.Vector3(0, 1, 0)).normalize();

    xrMove.set(0, 0, 0);
    xrMove.addScaledVector(xrForward, -leftY);
    xrMove.addScaledVector(xrRight, leftX);
    if (xrMove.lengthSq() > 1) xrMove.normalize();

    if (!playerRig) return false;
    playerState.position.addScaledVector(xrMove, xrMoveSpeed * delta);
    playerState.position.y += verticalInput * xrVerticalSpeed * delta;
    playerState.velocity.set(0, 0, 0);
    playerState.onGround = false;
    playerState.jumpCount = 0;
    playerState.jumpQueued = false;
    yaw -= rightX * xrTurnSpeed * delta;
    playerRig.position.copy(playerState.position);
    playerRig.rotation.y = yaw;
    localPlayerAvatarMoveSpeed = Math.hypot(xrMove.length() * xrMoveSpeed, verticalInput * xrVerticalSpeed);

    return true;
}

function getColliderBoxAndSize(obj) {
    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3());
    return { box, size };
}

function buildUnifiedInputContext() {
    return {
        canUseStandardMovementControls: canUseStandardMovementControls(),
        isDmFreeCamera: isDmFreeCamera(),
        combatMode: currentGameMode === GAME_MODE.COMBAT,
        playerFlying,
        movementLocked: turnEndRequired || isInputLockedForCombat('MOVE'),
    };
}

function handleUnifiedGameplayCommand(command) {
    switch (command) {
        case 'confirm':
            if (turnEndRequired) {
                recordInputFeedback('end-turn', 'accepted', 'confirm-end-turn', { showFloating: false });
                confirmEndTurn();
                return true;
            }
            if (isInputLockedForCombat('END_TURN')) {
                recordInputFeedback('confirm', 'blocked', 'end-turn-locked', { showFloating: false });
                return true;
            }
            if (combatInteraction.awaitingConfirm) {
                recordInputFeedback(String(combatInteraction.action || 'action'), 'accepted', 'confirm', { showFloating: false });
                confirmAction();
            } else if (currentGameMode === GAME_MODE.COMBAT) {
                recordInputFeedback('end-turn', 'accepted', 'manual-end-turn', { showFloating: false });
                endTurn();
            } else {
                recordInputFeedback('turn', 'accepted', 'reset-local-resources', { showFloating: false, pushTimeline: false });
                resetLocalTurnResources();
            }
            return true;
        case 'cancel':
            if (hasDmPossessionControl()) {
                recordInputFeedback('camera', 'accepted', 'release-possession', { showFloating: false });
                releasePossession();
                showFloatingText('POSSESSION RELEASED', '#9ec9ff', true);
                return true;
            }
            if (isInputLockedForCombat('ACTION')) {
                recordInputFeedback('action', 'blocked', 'combat-locked', { showFloating: false });
                return true;
            }
            if (combatInteraction.awaitingConfirm) {
                recordInputFeedback(String(combatInteraction.action || 'action'), 'accepted', 'cancel', { showFloating: false });
                cancelAction();
            } else {
                recordInputFeedback('action', 'blocked', 'nothing-pending', { showFloating: false, pushTimeline: false });
            }
            return true;
        case 'toggle-movement-radius':
            if (isInputLockedForCombat('MOVE')) {
                recordInputFeedback('move', 'blocked', 'movement-locked', { showFloating: false });
                return true;
            }
            if (activeMovementCircle && activeMovementCircle.parent) {
                activeMovementCircle.parent.remove(activeMovementCircle);
                activeMovementCircle = null;
                recordInputFeedback('move', 'accepted', 'preview-hidden', { showFloating: false, pushTimeline: false });
            } else {
                activeMovementCircle = createMovementRadius(playerState.position, combatState.player.movementRemaining, 0x3388ff, 0.18);
                activeMovementCircle.userData.baseFeet = Math.max(combatState.player.movementRemaining, 0.01);
                scene.add(activeMovementCircle);
                recordInputFeedback('move', 'accepted', 'preview-shown', { showFloating: false, pushTimeline: false });
            }
            return true;
        case 'toggle-combat': {
            if (!hasModePermission('combat.control')) {
                recordInputFeedback('combat', 'blocked', 'permission-denied', { showFloating: false });
                return false;
            }
            const enableCombat = currentGameMode !== GAME_MODE.COMBAT;
            clearTurnEndState();
            currentGameMode = enableCombat ? GAME_MODE.COMBAT : GAME_MODE.FREE;
            combatState.inCombat = enableCombat;
            syncSkyboxWithGameMode();
            if (enableCombat) {
                setCombatPhase('PLAYER');
                setCombatLock(false);
                combatCenter.copy(playerState.position);
                combatRadius = Math.max(combatRadius, 12);
                activateCombatCamera();
                resetLocalTurnResources();
            } else {
                setCombatPhase('TRANSITION');
                setCombatLock(false);
                deactivateCombatCamera();
                combatState.turnOrder = [];
                combatState.currentTurnIndex = 0;
            }
            recordInputFeedback('combat', 'accepted', enableCombat ? 'combat-enabled' : 'combat-disabled', { showFloating: false });
            return true;
        }
        case 'toggle-flying':
            if (isInputLockedForCombat('MOVE')) {
                recordInputFeedback('move', 'blocked', 'movement-locked', { showFloating: false });
                return true;
            }
            playerFlying = !playerFlying;
            if (playerFlying) {
                playerState.jumpCount = 0;
            } else {
                playerFlyUp = false;
                playerFlyDown = false;
            }
            recordInputFeedback('move', 'accepted', playerFlying ? 'flight-enabled' : 'flight-disabled', { showFloating: false, pushTimeline: false });
            return true;
        case 'focus-target': {
            const target = getMostRelevantActor();
            if (target) {
                recordInputFeedback('camera', 'accepted', 'focus-target', { showFloating: false, pushTimeline: false });
                focusDmCameraOnTarget(target);
            } else {
                recordInputFeedback('camera', 'blocked', 'no-target', { showFloating: false });
            }
            return true;
        }
        default:
            return false;
    }
}

function getPrimaryConnectedGamepad() {
    if (rendererReady && renderer && renderer.xr && renderer.xr.isPresenting) {
        return null;
    }
    if (!navigator || typeof navigator.getGamepads !== 'function') return null;
    const gamepads = navigator.getGamepads();
    if (!gamepads) return null;
    for (const gamepad of gamepads) {
        if (gamepad && gamepad.connected) {
            return gamepad;
        }
    }
    return null;
}

function pollUnifiedGamepadInput() {
    const manager = ensureUnifiedInputManager();
    if (consoleState.open) {
        manager.clearGamepadState();
        return null;
    }
    return manager.syncGamepad(getPrimaryConnectedGamepad(), buildUnifiedInputContext());
}

function normalizeColliderName(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function isPreferredFloorCollider(obj) {
    return normalizeColliderName(obj && obj.name) === normalizeColliderName(PRIMARY_FLOOR_COLLIDER_NAME);
}

function isNamedFloorCollider(obj) {
    const name = (obj && obj.name ? obj.name : '').toLowerCase().trim();
    return isPreferredFloorCollider(obj) || /(^|\b)(floor|ground)(\b|$)/.test(name);
}

function isTerrainLikeCollider(obj) {
    const name = (obj && obj.name ? obj.name : '').toLowerCase().trim();
    return /(^|\b)terrain(\b|$)/.test(name);
}

function isFloorDebugTarget(objOrName) {
    const rawName = typeof objOrName === 'string'
        ? objOrName
        : (objOrName && objOrName.name ? objOrName.name : '');
    return normalizeColliderName(rawName) === normalizeColliderName(FLOOR_DEBUG_TARGET_NAME);
}

function isFloorCollider(obj, size) {
    if (isNamedFloorCollider(obj)) {
        return size.x > FLOOR_MIN_SPAN && size.z > FLOOR_MIN_SPAN;
    }

    if (isTerrainLikeCollider(obj)) {
        return false;
    }

    return size.y < FLOOR_MAX_THICKNESS && size.x > FLOOR_MIN_SPAN && size.z > FLOOR_MIN_SPAN;
}

function shouldIncludeColliderMesh(obj, box, size) {
    if (!obj || !obj.isMesh || obj.visible === false) return false;
    if (!box || box.isEmpty()) return false;

    // Never treat combat actors (player/enemy proxies or their visuals) as world colliders.
    if (obj.userData?.isTargetable || obj.userData?.selectTarget) return false;
    let parent = obj.parent;
    while (parent) {
        if (parent.userData?.isTargetable || parent.userData?.selectTarget) return false;
        parent = parent.parent;
    }

    const explicitColliderTag = typeof obj.userData?.collider === 'string'
        ? obj.userData.collider.toLowerCase()
        : null;
    if (explicitColliderTag && explicitColliderTag !== 'solid') {
        return false;
    }

    const name = (obj.name || '').toLowerCase();
    if (!explicitColliderTag && /(detail|prop|foliage|weapon|avatar|character|decor)/.test(name)) {
        return false;
    }

    if (isFloorCollider(obj, size)) {
        return true;
    }

    const diagonal = size.length();
    if (diagonal < MIN_COLLIDER_DIAGONAL) return false;
    if (diagonal > MAX_COLLIDER_DIAGONAL) return false;

    return true;
}

function isColliderOnlySourceMesh(obj) {
    if (!obj || !obj.isMesh) return false;
    const rawName = String(obj.name || '').toLowerCase();
    const colliderTag = typeof obj.userData?.collider === 'string'
        ? obj.userData.collider.toLowerCase().trim()
        : '';

    if (/\b(collider|collision|hitbox|physics|proxy)\b/.test(rawName)) {
        return true;
    }

    if (colliderTag && colliderTag !== 'none' && colliderTag !== 'ignore') {
        return true;
    }

    return false;
}

function hideColliderSourceVisual(obj) {
    if (!obj || !obj.isMesh) return;
    if (!isColliderOnlySourceMesh(obj)) return;
    if (obj.userData?.colliderVisualHiddenApplied) return;

    const toInvisibleMaterial = (mat) => {
        if (!mat) return mat;
        const copy = mat.clone();
        copy.transparent = true;
        copy.opacity = 0;
        copy.depthWrite = false;
        copy.colorWrite = false;
        copy.needsUpdate = true;
        return copy;
    };

    if (Array.isArray(obj.material)) {
        obj.material = obj.material.map((mat) => toInvisibleMaterial(mat));
    } else {
        obj.material = toInvisibleMaterial(obj.material);
    }

    obj.castShadow = false;
    obj.receiveShadow = false;
    obj.userData = obj.userData || {};
    obj.userData.colliderVisualHiddenApplied = true;
}

function createWorldColliderFromBox(obj, box, size) {
    if (isPreferredFloorCollider(obj)) {
        return {
            type: 'mesh',
            mesh: obj,
            bounds: box.clone(),
        };
    }

    if (isFloorCollider(obj, size)) {
        return {
            type: 'plane',
            y: box.max.y,
            bounds: box.clone(),
        };
    }

    return {
        type: 'box',
        box: box.clone(),
    };
}

function mergeNearbyBoxColliders(boxEntries) {
    const merged = [];

    for (const entry of boxEntries) {
        const box = entry.box;
        const center = box.getCenter(new THREE.Vector3());
        let mergedIntoExisting = false;

        for (const existing of merged) {
            if (existing.distanceToPoint(center) < COLLIDER_MERGE_DISTANCE) {
                existing.union(box);
                if (entry.sourceName) {
                    existing.userData.sourceNames.add(entry.sourceName);
                }
                mergedIntoExisting = true;
                break;
            }
        }

        if (!mergedIntoExisting) {
            const mergedBox = box.clone();
            mergedBox.userData = {
                sourceNames: new Set(entry.sourceName ? [entry.sourceName] : []),
            };
            merged.push(mergedBox);
        }
    }

    return merged;
}

function getColliderTop(collider) {
    if (collider.type === 'plane') return collider.y;
    if (collider.type === 'mesh') return collider.bounds.max.y;
    return collider.box.max.y;
}

function getColliderBottom(collider) {
    if (collider.type === 'plane') return collider.y;
    if (collider.type === 'mesh') return collider.bounds.min.y;
    return collider.box.min.y;
}

function getColliderBounds(collider) {
    if (collider.type === 'plane' || collider.type === 'mesh') return collider.bounds;
    return collider.box;
}

function getColliderDebugBox(collider) {
    if (collider.type === 'box') {
        return collider.box;
    }

    const debugBox = collider.bounds.clone();
    const debugY = collider.type === 'plane' ? collider.y : collider.bounds.max.y;
    debugBox.min.y = debugY - (PLANE_DEBUG_THICKNESS * 0.5);
    debugBox.max.y = debugY + (PLANE_DEBUG_THICKNESS * 0.5);
    return debugBox;
}

function colliderContainsHorizontalPoint(collider, position, padding = 0) {
    const bounds = getColliderBounds(collider);
    return position.x >= bounds.min.x - padding &&
        position.x <= bounds.max.x + padding &&
        position.z >= bounds.min.z - padding &&
        position.z <= bounds.max.z + padding;
}

function getMeshColliderGroundY(collider, position, maxDrop = Infinity) {
    if (!collider || collider.type !== 'mesh' || !collider.mesh) return -Infinity;

    const bounds = collider.bounds;
    const probeRadius = playerState.capsule.radius * 0.75;
    const probeOffsets = [
        [0, 0],
        [probeRadius, 0],
        [-probeRadius, 0],
        [0, probeRadius],
        [0, -probeRadius],
    ];
    const rayStartY = Math.max(bounds.max.y, position.y + PLAYER_GROUND_SNAP) + FLOOR_MESH_RAYCAST_PADDING;
    const rayEndY = bounds.min.y - FLOOR_MESH_RAYCAST_PADDING;
    let highestY = -Infinity;

    collider.mesh.updateMatrixWorld(true);
    floorProbeRaycaster.firstHitOnly = false;
    floorProbeRaycaster.far = Math.max(rayStartY - rayEndY, FLOOR_MESH_RAYCAST_PADDING);

    for (const [offsetX, offsetZ] of probeOffsets) {
        const sampleX = position.x + offsetX;
        const sampleZ = position.z + offsetZ;
        if (
            sampleX < bounds.min.x - playerState.capsule.radius ||
            sampleX > bounds.max.x + playerState.capsule.radius ||
            sampleZ < bounds.min.z - playerState.capsule.radius ||
            sampleZ > bounds.max.z + playerState.capsule.radius
        ) {
            continue;
        }

        floorProbeOrigin.set(sampleX, rayStartY, sampleZ);
        floorProbeRaycaster.set(floorProbeOrigin, floorProbeDirection);
        const hits = floorProbeRaycaster.intersectObject(collider.mesh, false);
        for (const hit of hits) {
            const groundY = hit.point.y;
            if (groundY > position.y + PLAYER_GROUND_SNAP) continue;
            if ((position.y - groundY) > maxDrop) continue;
            if (groundY > highestY) {
                highestY = groundY;
            }
            break;
        }
    }

    return highestY;
}

function getGroundHeightForColliderAt(collider, position, maxDrop = Infinity) {
    if (!colliderContainsHorizontalPoint(collider, position, playerState.capsule.radius)) {
        return -Infinity;
    }

    if (collider.type === 'mesh') {
        return getMeshColliderGroundY(collider, position, maxDrop);
    }

    const topY = getColliderTop(collider);
    if (topY > position.y + PLAYER_GROUND_SNAP) return -Infinity;
    if ((position.y - topY) > maxDrop) return -Infinity;
    return topY;
}

function getHighestGroundYAt(position, maxDrop = Infinity) {
    let highestY = -Infinity;
    for (const collider of worldColliders) {
        const topY = getGroundHeightForColliderAt(collider, position, maxDrop);
        if (!Number.isFinite(topY)) continue;
        if (topY > highestY) {
            highestY = topY;
        }
    }
    return highestY;
}

function findFloorDebugCollider() {
    return worldColliders.find((collider) => {
        if (isFloorDebugTarget(collider.sourceName)) return true;
        if (Array.isArray(collider.sourceNames)) {
            return collider.sourceNames.some((name) => isFloorDebugTarget(name));
        }
        return false;
    }) || null;
}

function logFloorDebugInfo(reason) {
    void reason;
}

function addWorldCollidersFromRoot(root) {
    if (!root) return;
    root.updateMatrixWorld(true);

    const meshColliders = [];
    const planeColliders = [];
    const boxColliders = [];

    root.traverse((obj) => {
        const { box, size } = getColliderBoxAndSize(obj);

        if (!shouldIncludeColliderMesh(obj, box, size)) return;

        hideColliderSourceVisual(obj);

        const collider = createWorldColliderFromBox(obj, box, size);
        collider.sourceName = obj.name || '';
        if (collider.type === 'mesh') {
            meshColliders.push(collider);
        } else if (collider.type === 'plane') {
            planeColliders.push(collider);
        } else {
            boxColliders.push({
                box: collider.box,
                sourceName: collider.sourceName,
            });
        }

    });

    worldColliders.push(...meshColliders);
    worldColliders.push(...planeColliders);
    worldColliders.push(...mergeNearbyBoxColliders(boxColliders).map((box) => ({
        type: 'box',
        box,
        sourceName: box.userData && box.userData.sourceNames && box.userData.sourceNames.size === 1
            ? Array.from(box.userData.sourceNames)[0]
            : '',
        sourceNames: box.userData && box.userData.sourceNames
            ? Array.from(box.userData.sourceNames)
            : [],
    })));
    syncColliderDebugVisuals();
}

function ensureColliderDebugGroup() {
    if (colliderDebugGroup) return colliderDebugGroup;
    colliderDebugGroup = new THREE.Group();
    colliderDebugGroup.name = 'collider_debug_group';
    markAvatarUnselectable(colliderDebugGroup);
    scene.add(colliderDebugGroup);
    return colliderDebugGroup;
}

function getBoxVolume(box) {
    const size = box.getSize(new THREE.Vector3());
    return Math.max(size.x, 0) * Math.max(size.y, 0) * Math.max(size.z, 0);
}

function getOverlapVolume(a, b) {
    const overlapX = Math.max(0, Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x));
    const overlapY = Math.max(0, Math.min(a.max.y, b.max.y) - Math.max(a.min.y, b.min.y));
    const overlapZ = Math.max(0, Math.min(a.max.z, b.max.z) - Math.max(a.min.z, b.min.z));
    return overlapX * overlapY * overlapZ;
}

function getColliderDebugSeverity(collider, colliderIndex) {
    const box = getColliderDebugBox(collider);
    const proximityPadding = 0.35;
    const expandedBox = box.clone().expandByScalar(proximityPadding);
    let severity = 'green';

    for (let i = 0; i < worldColliders.length; i++) {
        if (i === colliderIndex) continue;
        const otherBox = getColliderDebugBox(worldColliders[i]);
        const overlapVolume = getOverlapVolume(box, otherBox);
        const verticalOverlap = Math.min(box.max.y, otherBox.max.y) - Math.max(box.min.y, otherBox.min.y);

        if (verticalOverlap < STACKED_OVERLAP_THRESHOLD) {
            continue;
        }

        if (overlapVolume > 1.0) {
            return 'red';
        }

        if (overlapVolume > 0.05) {
            severity = 'yellow';
            continue;
        }

        if (severity === 'green' && expandedBox.intersectsBox(otherBox)) {
            severity = 'yellow';
        }
    }

    return severity;
}

function getColliderDebugColor(severity) {
    if (severity === 'red') return 0xff5a5a;
    if (severity === 'yellow') return 0xffd84d;
    return 0x63ff8c;
}

function syncColliderDebugVisuals() {
    if (!colliderDebugGroup) {
        if (!colliderDebugVisible) return;
        ensureColliderDebugGroup();
    }

    colliderDebugGroup.clear();
    colliderDebugGroup.visible = colliderDebugVisible;
    if (!colliderDebugVisible) return;

    for (let i = 0; i < worldColliders.length; i++) {
        const collider = worldColliders[i];
        const box = getColliderDebugBox(collider);
        const size = box.getSize(new THREE.Vector3());
        if (size.lengthSq() <= 0.000001) continue;
        const center = box.getCenter(new THREE.Vector3());
        const severity = getColliderDebugSeverity(collider, i);
        const helper = new THREE.LineSegments(
            new THREE.EdgesGeometry(new THREE.BoxGeometry(size.x, size.y, size.z)),
            new THREE.LineBasicMaterial({
                color: getColliderDebugColor(severity),
                transparent: true,
                opacity: 0.8,
            })
        );
        helper.position.copy(center);
        helper.userData.colliderSeverity = severity;
        colliderDebugGroup.add(helper);
    }
}

function setColliderDebugVisible(visible) {
    colliderDebugVisible = visible;
    syncColliderDebugVisuals();
}

function findSafeSpawn(position) {
    const safePosition = position.clone();
    for (const collider of worldColliders) {
        if (collider.type !== 'box') continue;
        if (collider.box.containsPoint(safePosition)) {
            safePosition.y = Math.max(safePosition.y, collider.box.max.y + 1.0);
        }
    }

    const groundY = getHighestGroundYAt(safePosition, Infinity);
    if (Number.isFinite(groundY)) {
        safePosition.y = Math.max(safePosition.y, groundY);
    }

    return safePosition;
}

function resetPlayerToSafeSpawn() {
    const safeSpawn = findSafeSpawn(PLAYER_SPAWN);
    playerState.position.copy(safeSpawn);
    playerState.velocity.set(0, 0, 0);
    playerState.onGround = false;
    playerState.jumpCount = 0;
    playerState.jumpQueued = false;
    localPlayerJumpVisualBlend = 0;
    if (localPlayerAvatarRoot) {
        localPlayerAvatarRoot.position.y = LOCAL_AVATAR_BASE_Y;
        localPlayerAvatarRoot.rotation.x = 0;
    }
    playerState.hp = playerState.maxHp;
    syncPlayerRigFromState();
    updatePlayerHealthHud();
    logFloorDebugInfo('spawn-reset');
}

function enableWorldPhysics() {
    worldPhysicsReady = true;
    updateLoadingState('Enabling world physics...', 0.82);
    
    // Initialize BVH collision system
    if (useBVHCollisions) {
        console.log('🧱 Initializing BVH collision system...');
        initializeBVH().then((bvhInitialized) => {
            if (bvhInitialized && scene) {
                console.log('📊 Building merged BVH collider mesh from scene...');
                bvhColliderMesh = buildMergedColliderMesh(scene, ['avatar', 'player', 'player_rig', 'enemy', 'dummy', 'training_dummy']);
                
                if (bvhColliderMesh) {
                    // Add invisible mesh to scene for raycast support (not rendered)
                    bvhColliderMesh.name = 'BVH_Collider_Mesh';
                    scene.add(bvhColliderMesh);
                    
                    // Apply accelerated raycast ONLY to this collider mesh
                    // Do NOT apply globally to avoid breaking GroundedSkybox
                    applyAcceleratedRaycast(bvhColliderMesh);
                    
                    console.log('✅ BVH collider mesh ready for collision detection');
                } else {
                    console.warn('⚠️ Failed to build BVH collider, falling back to Box3 collisions');
                    useBVHCollisions = false;
                }
            } else {
                console.warn('⚠️ BVH initialization failed, using Box3 collisions');
                useBVHCollisions = false;
            }
        });
    }
    
    resetPlayerToSafeSpawn();
}

function capsuleOverlapsBoxHorizontally(box) {
    const radius = playerState.capsule.radius;
    const clampedX = THREE.MathUtils.clamp(playerState.position.x, box.min.x, box.max.x);
    const clampedZ = THREE.MathUtils.clamp(playerState.position.z, box.min.z, box.max.z);
    const dx = playerState.position.x - clampedX;
    const dz = playerState.position.z - clampedZ;
    return (dx * dx) + (dz * dz) < radius * radius;
}

function capsuleOverlapsBoxVertically(box) {
    const bottom = playerState.position.y + PLAYER_COLLISION_EPSILON;
    const top = playerState.position.y + playerState.capsule.height - PLAYER_COLLISION_EPSILON;
    return top > box.min.y && bottom < box.max.y;
}

function capsuleOverlapsColliderHorizontally(collider) {
    if (collider.type === 'plane' || collider.type === 'mesh') {
        return colliderContainsHorizontalPoint(collider, playerState.position, playerState.capsule.radius);
    }
    return capsuleOverlapsBoxHorizontally(collider.box);
}

function capsuleOverlapsColliderVertically(collider) {
    if (collider.type === 'plane') {
        const bottom = playerState.position.y + PLAYER_COLLISION_EPSILON;
        const top = playerState.position.y + playerState.capsule.height - PLAYER_COLLISION_EPSILON;
        return top > collider.y && bottom < collider.y + PLAYER_GROUND_SNAP;
    }
    if (collider.type === 'mesh') {
        const groundY = getMeshColliderGroundY(collider, playerState.position, Infinity);
        if (!Number.isFinite(groundY)) return false;
        const bottom = playerState.position.y + PLAYER_COLLISION_EPSILON;
        const top = playerState.position.y + playerState.capsule.height - PLAYER_COLLISION_EPSILON;
        return top > groundY && bottom < groundY + PLAYER_GROUND_SNAP;
    }
    return capsuleOverlapsBoxVertically(collider.box);
}

function resolveHorizontalCollisions(axis, movementAmount) {
    if (!movementAmount) return;
    const radius = playerState.capsule.radius;
    for (const collider of worldColliders) {
        if (collider.type !== 'box') continue;
        const box = collider.box;
        if (!capsuleOverlapsBoxVertically(box) || !capsuleOverlapsBoxHorizontally(box)) {
            continue;
        }
        if (axis === 'x') {
            playerState.position.x = movementAmount > 0
                ? box.min.x - radius - PLAYER_COLLISION_EPSILON
                : box.max.x + radius + PLAYER_COLLISION_EPSILON;
        } else {
            playerState.position.z = movementAmount > 0
                ? box.min.z - radius - PLAYER_COLLISION_EPSILON
                : box.max.z + radius + PLAYER_COLLISION_EPSILON;
        }
    }
}

function resolveVerticalCollisions(previousY) {
    const height = playerState.capsule.height;
    const currentBottom = playerState.position.y;
    const currentTop = currentBottom + height;
    const previousBottom = previousY;
    const previousTop = previousY + height;
    let onGround = false;

    for (const collider of worldColliders) {
        if (!capsuleOverlapsColliderHorizontally(collider)) continue;

        if (collider.type === 'mesh') {
            const topY = getMeshColliderGroundY(collider, playerState.position, Infinity);
            if (!Number.isFinite(topY)) continue;

            if (
                playerState.velocity.y <= 0 &&
                previousBottom >= topY - PLAYER_GROUND_SNAP &&
                currentBottom <= topY &&
                currentTop > topY
            ) {
                playerState.position.y = topY;
                playerState.velocity.y = 0;
                onGround = true;
                continue;
            }

            if (
                playerState.velocity.y <= 0 &&
                Math.abs(currentBottom - topY) <= PLAYER_GROUND_SNAP
            ) {
                playerState.position.y = topY;
                playerState.velocity.y = 0;
                onGround = true;
            }

            continue;
        }

        const topY = getColliderTop(collider);
        const bottomY = getColliderBottom(collider);

        if (
            playerState.velocity.y <= 0 &&
            previousBottom >= topY - PLAYER_GROUND_SNAP &&
            currentBottom <= topY &&
            currentTop > topY
        ) {
            playerState.position.y = topY;
            playerState.velocity.y = 0;
            onGround = true;
            continue;
        }

        if (
            playerState.velocity.y <= 0 &&
            Math.abs(currentBottom - topY) <= PLAYER_GROUND_SNAP
        ) {
            playerState.position.y = topY;
            playerState.velocity.y = 0;
            onGround = true;
            continue;
        }

        if (collider.type === 'plane') {
            continue;
        }

        if (
            playerState.velocity.y > 0 &&
            previousTop <= bottomY + PLAYER_GROUND_SNAP &&
            currentTop > bottomY &&
            currentBottom < bottomY
        ) {
            playerState.position.y = bottomY - height;
            playerState.velocity.y = 0;
        }
    }

    if (!onGround) {
        const supportingGroundY = getHighestGroundYAt(playerState.position, PLAYER_GROUND_SNAP * 2);
        if (Number.isFinite(supportingGroundY) && playerState.velocity.y <= 0) {
            if (currentBottom <= supportingGroundY + PLAYER_GROUND_SNAP) {
                playerState.position.y = supportingGroundY;
                playerState.velocity.y = 0;
                onGround = true;
            }
        }
    }

    if (playerState.position.y < 0) {
        playerState.position.y = 0;
        playerState.velocity.y = 0;
        onGround = true;
    }

    playerState.onGround = onGround;
    if (onGround) {
        playerState.jumpCount = 0;
    }
}

/**
 * BVH-based unified collision resolution
 * Resolves all collisions (horizontal and vertical) in a single capsule vs triangle mesh query
 */
function resolveCollisionsBVH() {
    if (!bvhColliderMesh || !bvhColliderMesh.geometry.boundsTree) {
        return;
    }

    const height = playerState.capsule.height;
    const radius = playerState.capsule.radius;
    
    // Capsule segment: from bottom to top of capsule (accounting for radius)
    const capsuleStart = new THREE.Vector3(
        playerState.position.x,
        playerState.position.y + radius,
        playerState.position.z
    );
    
    const capsuleEnd = new THREE.Vector3(
        playerState.position.x,
        playerState.position.y + height - radius,
        playerState.position.z
    );

    // Resolve capsule vs triangle collisions
    const player = {
        start: capsuleStart,
        end: capsuleEnd,
        radius: radius,
        velocity: playerState.velocity.clone()
    };

    resolveCollisionsWithBVH(player, bvhColliderMesh);

    // Sync back the resolved position
    // player.start is the capsule bottom point, subtract radius to get position anchor
    playerState.position.copy(player.start);
    playerState.position.y -= radius;
    
    // Update velocity with damped version
    playerState.velocity.copy(player.velocity);

    // On-ground check: raycast down from capsule bottom.
    // Probe distance must cover the configured ground offset, otherwise we lose contact and hop.
    const rayOrigin = new THREE.Vector3(playerState.position.x, playerState.position.y + radius, playerState.position.z);
    const groundProbeDistance = PLAYER_GROUND_OFFSET + radius + PLAYER_GROUND_SNAP + 0.5;
    const raycaster = new THREE.Raycaster(rayOrigin, new THREE.Vector3(0, -1, 0), 0, groundProbeDistance);
    const hits = raycaster.intersectObject(bvhColliderMesh, false);
    
    // On ground if: we hit something below AND velocity is not strongly downward
    if (hits.length > 0 && playerState.velocity.y <= 0.5) {
        playerState.onGround = true;
        playerState.jumpCount = 0;
        
        // Apply ground offset - push player up to proper height above surface
        const groundHitY = hits[0].point.y;
        const targetY = groundHitY + PLAYER_GROUND_OFFSET;
        if (playerState.position.y < targetY) {
            playerState.position.y = targetY;
        }

        // Always kill downward velocity while grounded to prevent frame-to-frame pogo hopping.
        if (playerState.velocity.y < 0) {
            playerState.velocity.y = 0;
        }
    } else {
        playerState.onGround = false;
    }
}

function syncPlayerRigFromState() {
    if (!playerRig) return;
    playerRig.position.copy(playerState.position);
}

function adjustLocalAvatarScale(direction) {
    if (!localPlayerAvatarRoot) return;
    const currentScale = Number(localPlayerAvatarRoot.scale.x) || 1;
    const nextScale = THREE.MathUtils.clamp(
        currentScale + (direction * AVATAR_SCALE_STEP),
        AVATAR_SCALE_MIN,
        AVATAR_SCALE_MAX
    );
    localPlayerAvatarRoot.scale.setScalar(nextScale);
    console.info(`Avatar scale: ${nextScale.toFixed(2)}`);
}

function createMapDmFloatingHand(side = 'right') {
    const hand = new THREE.Group();
    hand.name = `dm_world_hand_${side}`;

    const skinMat = new THREE.MeshStandardMaterial({
        color: 0xdcc2a3,
        roughness: 0.72,
        metalness: 0.04,
    });
    const nailMat = new THREE.MeshStandardMaterial({
        color: 0xe9d9cc,
        roughness: 0.6,
        metalness: 0.03,
    });

    const palm = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.5, 1.45), skinMat);
    palm.position.set(0, 0, 0.02);
    palm.castShadow = true;
    hand.add(palm);

    const fingerZ = [-0.48, -0.16, 0.16, 0.48];
    for (let i = 0; i < fingerZ.length; i++) {
        const chain = new THREE.Group();
        chain.position.set(0.62, 0.1, fingerZ[i]);
        hand.add(chain);

        const segA = new THREE.Mesh(new THREE.CapsuleGeometry(0.095, 0.33, 4, 8), skinMat);
        segA.rotation.z = Math.PI / 2;
        segA.position.set(0.2, 0, 0);
        segA.castShadow = true;
        chain.add(segA);

        const segB = new THREE.Mesh(new THREE.CapsuleGeometry(0.078, 0.26, 4, 8), skinMat);
        segB.rotation.z = Math.PI / 2;
        segB.position.set(0.52, 0, 0);
        segB.castShadow = true;
        chain.add(segB);

        const segC = new THREE.Mesh(new THREE.CapsuleGeometry(0.066, 0.2, 4, 8), skinMat);
        segC.rotation.z = Math.PI / 2;
        segC.position.set(0.77, 0, 0);
        segC.castShadow = true;
        chain.add(segC);

        const nail = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.018, 0.078), nailMat);
        nail.position.set(0.92, 0.025, 0);
        chain.add(nail);
    }

    const thumb = new THREE.Group();
    thumb.position.set(-0.48, -0.06, side === 'right' ? 0.56 : -0.56);
    thumb.rotation.y = side === 'right' ? -0.62 : 0.62;
    hand.add(thumb);

    const thumbA = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.28, 4, 8), skinMat);
    thumbA.rotation.z = Math.PI / 2;
    thumbA.castShadow = true;
    thumb.add(thumbA);

    const thumbB = new THREE.Mesh(new THREE.CapsuleGeometry(0.082, 0.22, 4, 8), skinMat);
    thumbB.rotation.z = Math.PI / 2;
    thumbB.position.set(0.28, 0, 0);
    thumbB.castShadow = true;
    thumb.add(thumbB);

    if (side === 'left') {
        hand.scale.z = -1;
    }

    return hand;
}

function createWorldDmSetpiece() {
    const root = new THREE.Group();
    root.name = 'dm_world_setpiece';

    const frameMat = new THREE.MeshStandardMaterial({ color: 0x1a1410, roughness: 0.75, metalness: 0.18 });
    const clothMat = new THREE.MeshStandardMaterial({ color: 0x2a0f0f, roughness: 0.92, metalness: 0.02 });
    const sigilMat = new THREE.MeshStandardMaterial({ color: 0x54c3ff, emissive: 0x1d6ba0, emissiveIntensity: 1.1, roughness: 0.35, metalness: 0.08 });

    const screenFrame = new THREE.Mesh(new THREE.BoxGeometry(28, 11, 1.2), frameMat);
    screenFrame.castShadow = true;
    screenFrame.receiveShadow = true;
    root.add(screenFrame);

    const screenInset = new THREE.Mesh(new THREE.BoxGeometry(25.6, 8.8, 0.26), clothMat);
    screenInset.position.z = 0.5;
    screenInset.receiveShadow = true;
    root.add(screenInset);

    const sigilRing = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.11, 16, 64), sigilMat);
    sigilRing.position.set(0, 0.4, 0.66);
    sigilRing.rotation.x = Math.PI * 0.03;
    root.add(sigilRing);

    const sigilEye = new THREE.Mesh(new THREE.SphereGeometry(0.5, 20, 16), sigilMat);
    sigilEye.position.set(0, 0.4, 0.66);
    root.add(sigilEye);

    const braceLeft = new THREE.Mesh(new THREE.BoxGeometry(1.2, 9.4, 1.2), frameMat);
    braceLeft.position.set(-12.8, -1.2, -0.1);
    braceLeft.castShadow = true;
    root.add(braceLeft);

    const braceRight = new THREE.Mesh(new THREE.BoxGeometry(1.2, 9.4, 1.2), frameMat);
    braceRight.position.set(12.8, -1.2, -0.1);
    braceRight.castShadow = true;
    root.add(braceRight);

    const handsAnchor = new THREE.Group();
    handsAnchor.name = 'dm_world_hands_anchor';
    handsAnchor.position.set(0, 7.6, 1.2);
    root.add(handsAnchor);

    const rightHand = createMapDmFloatingHand('right');
    rightHand.position.set(2.6, 0, 0.2);
    rightHand.rotation.set(0.16, -0.45, -0.2);
    rightHand.scale.setScalar(2.2);
    handsAnchor.add(rightHand);

    const leftHand = createMapDmFloatingHand('left');
    leftHand.position.set(-2.6, 0.2, -0.2);
    leftHand.rotation.set(0.12, -Math.PI, 0.17);
    leftHand.scale.setScalar(2.1);
    handsAnchor.add(leftHand);

    root.userData.floatingHands = { handsAnchor, rightHand, leftHand };
    return root;
}

function updateWorldDmSetpiece(setpiece, elapsedSeconds) {
    if (!setpiece || !setpiece.userData || !setpiece.userData.floatingHands) return;
    const { handsAnchor, rightHand, leftHand } = setpiece.userData.floatingHands;
    if (handsAnchor) {
        handsAnchor.position.y = 7.6 + Math.sin(elapsedSeconds * 0.8) * 0.28;
        handsAnchor.rotation.y = Math.sin(elapsedSeconds * 0.24) * 0.1;
    }
    if (rightHand) {
        rightHand.rotation.x = 0.16 + Math.sin(elapsedSeconds * 1.4) * 0.08;
        rightHand.rotation.z = -0.2 + Math.cos(elapsedSeconds * 1.05) * 0.06;
    }
    if (leftHand) {
        leftHand.rotation.x = 0.12 + Math.cos(elapsedSeconds * 1.25) * 0.07;
        leftHand.rotation.z = 0.17 + Math.sin(elapsedSeconds * 1.1) * 0.05;
    }
}

// Scene
const scene = new THREE.Scene();
// Initialize userData for tracking remote player avatars
scene.userData.playerAvatars = {};
scene.userData.playerAvatarStates = {};
flushPendingWorldState();

const diceScene = new THREE.Scene();

// Procedural gradient sunset sky

// Create a vertical gradient canvas texture for the sunset sky
function createSunsetGradientTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 1024;
    const ctx = canvas.getContext('2d');
    // Draw vertical gradient (pink-orange sunset)
    const gradient = ctx.createLinearGradient(0, 0, 0, 1024);
    // Top (soft pink-purple sky)
    gradient.addColorStop(0.00, '#ff9ecb');
    // Upper-mid (pink)
    gradient.addColorStop(0.35, '#ff6fa5');
    // Lower-mid (warm peach)
    gradient.addColorStop(0.70, '#ff9a5a');
    // Horizon (bright orange)
    gradient.addColorStop(1.00, '#ff6a00');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 1024, 1024);

    // Overlay a more visible grid (graidnet)
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; // Brighter white grid
    ctx.lineWidth = 2;
    // Draw vertical lines
    for (let x = 0; x <= 1024; x += 64) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, 1024);
        ctx.stroke();
    }
    // Draw horizontal lines
    for (let y = 0; y <= 1024; y += 64) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(1024, y);
        ctx.stroke();
    }
    ctx.restore();

    const texture = new THREE.Texture(canvas);
    texture.needsUpdate = true;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    return texture;
}



// --- GroundedSkybox class (custom skybox with ground projection) ---

class GroundedSkybox extends THREE.Mesh {
    /**
     * Constructs a new ground-projected skybox.
     * @param {THREE.Texture} map - The environment map to use.
     * @param {number} height - Camera height above ground.
     * @param {number} radius - Skybox radius (should be large enough to enclose the scene).
     * @param {number} [resolution=128] - Geometry resolution.
     */
    constructor(map, height, radius, resolution = 128) {
        if (height <= 0 || radius <= 0 || resolution <= 0) {
            throw new Error('GroundedSkybox height, radius, and resolution must be positive.');
        }
        const geometry = new THREE.SphereGeometry(radius, 2 * resolution, resolution);
        geometry.scale(1, -1, -1); // Flip vertically and horizontally for correct sky orientation
        const pos = geometry.getAttribute('position');
        const tmp = new THREE.Vector3();
        for (let i = 0; i < pos.count; ++i) {
            tmp.fromBufferAttribute(pos, i);
            if (tmp.y < 0) {
                // Smooth out the transition from flat floor to sphere:
                const y1 = -height * 3 / 2;
                const f = tmp.y < y1 ? -height / tmp.y : (1 - tmp.y * tmp.y / (3 * y1 * y1));
                tmp.multiplyScalar(f);
                tmp.toArray(pos.array, 3 * i);
            }
        }
        pos.needsUpdate = true;

        // Use envMap for equirectangular textures
        const material = new THREE.MeshBasicMaterial({
            envMap: map,
            side: THREE.BackSide,
            depthWrite: false
        });
        material.envMapIntensity = 1.0;

        super(geometry, material);
        this.renderOrder = -Infinity;
    }
}





// Create the skybox using an 8k tonemapped JPG (equirectangular),
// then blend a blue radial gradient over the corners to soften seams
const skyboxTextureLoader = new THREE.TextureLoader();
const SKYBOX_DAY_URL = '/static/sky_8k_tonemapped.jpg';
const SKYBOX_NIGHT_URL = '/static/skybox_night.jpg';
let daySkyTexture = null;
let nightSkyTexture = null;
let activeSkyboxTheme = null;
let combatBlackSkyMesh = null;
const RENDER_CLEAR_COLOR_FREE = 0x143366;
const RENDER_CLEAR_COLOR_COMBAT = 0x000000;

function ensureCombatBlackSkyMesh() {
    if (combatBlackSkyMesh) return combatBlackSkyMesh;
    const geometry = new THREE.SphereGeometry(900, 32, 20);
    const material = new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
            bottomColor: { value: new THREE.Color(0x000000) },
            topColor: { value: new THREE.Color(0x070707) },
        },
        vertexShader: `
            varying vec3 vWorldPos;
            void main() {
                vec4 worldPos = modelMatrix * vec4(position, 1.0);
                vWorldPos = worldPos.xyz;
                gl_Position = projectionMatrix * viewMatrix * worldPos;
            }
        `,
        fragmentShader: `
            uniform vec3 bottomColor;
            uniform vec3 topColor;
            varying vec3 vWorldPos;
            void main() {
                float h = clamp(normalize(vWorldPos).y * 0.5 + 0.5, 0.0, 1.0);
                vec3 color = mix(bottomColor, topColor, pow(h, 1.25));
                gl_FragColor = vec4(color, 1.0);
            }
        `,
    });
    combatBlackSkyMesh = new THREE.Mesh(geometry, material);
    combatBlackSkyMesh.visible = false;
    scene.add(combatBlackSkyMesh);
    return combatBlackSkyMesh;
}

function syncWorldVisualsWithGameMode() {
    if (!worldEverythingRoot) return;
    worldEverythingRoot.visible = currentGameMode !== GAME_MODE.COMBAT;
}

function syncRendererClearColorWithGameMode() {
    if (!rendererReady) return;
    const clearColor = currentGameMode === GAME_MODE.COMBAT
        ? RENDER_CLEAR_COLOR_COMBAT
        : RENDER_CLEAR_COLOR_FREE;
    renderer.setClearColor(clearColor, 1);
}

function applySkyboxTheme(theme) {
    const mesh = window.skyMesh;
    const blackSky = ensureCombatBlackSkyMesh();

    if (theme === 'combat-black') {
        if (mesh) mesh.visible = false;
        if (blackSky) blackSky.visible = true;
        activeSkyboxTheme = 'combat-black';
        return true;
    }

    if (!mesh || !mesh.material) return false;

    const nextTheme = theme === 'night' ? 'night' : 'day';
    const nextTexture = nextTheme === 'night' ? nightSkyTexture : daySkyTexture;
    if (!nextTexture) return false;

    // Always enforce visibility regardless of whether the theme changed,
    // so a stale combat-black mesh never lingers after the theme was reset.
    mesh.visible = true;
    if (blackSky) blackSky.visible = false;

    if (activeSkyboxTheme === nextTheme && mesh.material.envMap === nextTexture) {
        return true;
    }

    mesh.material.envMap = nextTexture;
    mesh.material.needsUpdate = true;
    activeSkyboxTheme = nextTheme;
    return true;
}

function syncSkyboxWithGameMode() {
    syncWorldVisualsWithGameMode();
    syncRendererClearColorWithGameMode();
    const desiredTheme = (currentGameMode === GAME_MODE.COMBAT) ? 'combat-black' : 'day';
    applySkyboxTheme(desiredTheme);
}

skyboxTextureLoader.load(
    SKYBOX_DAY_URL,
    function(texture) {
        console.log('✅ SKY LOADED');
        console.log('Texture loaded:', texture);

        // Create a canvas to blend the image with a blue overlay across the whole image
        const img = texture.image;
        const w = img.width;
        const h = img.height;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        // Draw the original image
        ctx.drawImage(img, 0, 0, w, h);
        // Create a blue overlay with a very soft radial gradient (center is subtle, edges a bit more blue)
        const cx = w / 2;
        const cy = h / 2;
        const maxR = Math.sqrt(cx*cx + cy*cy);
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR);
        grad.addColorStop(0.0, 'rgba(60,100,200,0.10)');
        grad.addColorStop(0.5, 'rgba(60,100,200,0.13)');
        grad.addColorStop(0.8, 'rgba(60,100,200,0.18)');
        grad.addColorStop(1.0, 'rgba(60,100,200,0.22)');
        ctx.globalAlpha = 1.0;
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);

        // Optionally, add a very subtle blue linear gradient from top to bottom for extra softness
        const vertGrad = ctx.createLinearGradient(0, 0, 0, h);
        vertGrad.addColorStop(0.0, 'rgba(60,100,200,0.10)');
        vertGrad.addColorStop(1.0, 'rgba(60,100,200,0.13)');
        ctx.globalAlpha = 1.0;
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = vertGrad;
        ctx.fillRect(0, 0, w, h);

        // Create a new THREE.Texture from the canvas
        const softTexture = new THREE.Texture(canvas);
        softTexture.needsUpdate = true;
        softTexture.mapping = THREE.EquirectangularReflectionMapping;
        softTexture.colorSpace = THREE.SRGBColorSpace;
        daySkyTexture = softTexture;

        const skyMesh = new GroundedSkybox(softTexture, 15, 500);
        scene.add(skyMesh);
        window.skyMesh = skyMesh;
        // Do NOT pre-set activeSkyboxTheme here — let syncSkyboxWithGameMode/applySkyboxTheme
        // set it so the early-return guard in applySkyboxTheme doesn't skip visibility updates.
        syncSkyboxWithGameMode();

        skyboxTextureLoader.load(
            SKYBOX_NIGHT_URL,
            function(nightTexture) {
                nightTexture.mapping = THREE.EquirectangularReflectionMapping;
                nightTexture.colorSpace = THREE.SRGBColorSpace;
                nightSkyTexture = nightTexture;
                syncSkyboxWithGameMode();
            },
            undefined,
            function(err) {
                console.warn('Night skybox failed to load:', err);
            }
        );
    },
    undefined,
    function(err) {
        console.error('❌ SKY FAILED TO LOAD', err);
    }
);






// Camera
const camera = new THREE.PerspectiveCamera(
    75, // standard FOV
    window.innerWidth / window.innerHeight,
    0.1,
    1000
);
dmCamera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.1,
    2400
);
// Third-person camera starting offset (behind the avatar).
camera.position.set(0, FREE_CAMERA_HEIGHT, 4.8);
camera.lookAt(0, -0.8, 0);
dmCamera.position.set(0, 24, 24);
dmCamera.lookAt(0, 0, 0);
activeCamera = camera;
flushPendingRuntimeMode();
playerRig = new THREE.Group();
// Step 1: Initialize at origin for proper rigging
playerRig.position.set(0, 0, 0);
playerRig.add(camera);
scene.add(playerRig);
// Step 2: Wait for the role selection overlay to be dismissed, THEN load
// and rig avatar so we know which role (player/DM) the user chose.
await roleChosenPromise;
await initLocalAvatarFromProfile();
// Step 3: Move to spawn position after rigging complete
playerRig.position.copy(PLAYER_SPAWN);
playerState.position.copy(PLAYER_SPAWN);

const dicePassCamera = new THREE.PerspectiveCamera(
    camera.fov,
    camera.aspect,
    camera.near,
    camera.far,
);

function syncDicePassCamera() {
    const activeView = (typeof getActiveViewCamera === 'function') ? getActiveViewCamera() : camera;
    activeView.getWorldPosition(dicePassCamera.position);
    activeView.getWorldQuaternion(dicePassCamera.quaternion);
    activeView.getWorldScale(dicePassCamera.scale);
    dicePassCamera.fov = activeView.fov;
    dicePassCamera.aspect = activeView.aspect;
    dicePassCamera.near = activeView.near;
    dicePassCamera.far = activeView.far;
    dicePassCamera.updateProjectionMatrix();
    dicePassCamera.updateMatrixWorld(true);
}

function renderWorldWithDmInset(primaryView) {
    const mainView = primaryView || getActiveViewCamera();
    const xrPresenting = !!(renderer && renderer.xr && renderer.xr.isPresenting);
    const canRenderInset =
        dmInsetEnabled &&
        modeManager.current === MODE.DM &&
        dmCamera &&
        camera &&
        !xrPresenting;

    const fullWidth = Math.max(1, window.innerWidth);
    const fullHeight = Math.max(1, window.innerHeight);

    renderer.clear();

    // Main view pass (explicit viewport/scissor)
    renderer.setViewport(0, 0, fullWidth, fullHeight);
    renderer.setScissor(0, 0, fullWidth, fullHeight);
    renderer.setScissorTest(true);
    renderer.render(scene, mainView);

    if (!canRenderInset) {
        renderer.setScissorTest(false);
        return;
    }

    const insetCamera = (mainView === dmCamera) ? camera : dmCamera;
    if (!insetCamera) return;

    const insetWidth = Math.max(220, Math.min(DM_INSET_DEFAULT_WIDTH, Math.floor(fullWidth * 0.38)));
    const insetHeight = Math.max(160, Math.min(DM_INSET_DEFAULT_HEIGHT, Math.floor(fullHeight * 0.34)));
    const insetX = Math.max(0, fullWidth - insetWidth - DM_INSET_MARGIN);
    const insetY = DM_INSET_MARGIN;

    insetCamera.aspect = insetWidth / insetHeight;
    insetCamera.updateProjectionMatrix();

    // Inset pass (always rendered after main pass)
    renderer.clearDepth();
    renderer.setViewport(insetX, insetY, insetWidth, insetHeight);
    renderer.setScissor(insetX, insetY, insetWidth, insetHeight);
    renderer.setScissorTest(true);
    renderer.render(scene, insetCamera);

    renderer.setScissorTest(false);

    renderer.setViewport(0, 0, fullWidth, fullHeight);
    renderer.setScissor(0, 0, fullWidth, fullHeight);
}

// Optional local-only diagnostics dummies. Disabled for normal network play.
if (window.__DM_FORCE_LOCAL_DM_COMMANDS__ === true || __urlSearch.get('seedlocaldummies') === '1') {
    const trainingDummy = spawnTrainingDummy(20, 12.14, 15, 'Training Dummy A');
    const trainingDummyB = spawnTrainingDummy(24, 12.14, 18, 'Training Dummy B');
    const trainingDummyC = spawnTrainingDummy(18, 12.14, 20, 'Training Dummy C');
    window.trainingDummy = trainingDummy;
    window.trainingDummies = [trainingDummy, trainingDummyB, trainingDummyC];
}

// LOS blocker wall for tactical tests (targeting should fail when blocked).
const losWall = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 2.8, 4.2),
    new THREE.MeshStandardMaterial({ color: 0x5f6670, roughness: 0.78, metalness: 0.05 })
);
losWall.position.set(21.6, 13.4, 16.2);
losWall.castShadow = true;
losWall.receiveShadow = true;
losWall.userData.blockLOS = true;
losWall.userData.name = 'LOS Wall';
scene.add(losWall);

dmWorldSetpiece = createWorldDmSetpiece();
dmWorldSetpiece.position.set(19, 36.5, 44);
dmWorldSetpiece.rotation.y = Math.PI;
scene.add(dmWorldSetpiece);

// Now create the sky mesh and add to the main scene



// Renderer


const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.domElement.id = 'canvas';
rendererReady = true;
renderer.setPixelRatio(window.devicePixelRatio || 1);
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);
renderer.xr.enabled = true;
renderer.autoClear = false;
// Enable shadow mapping
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// REQUIRED: set renderer output color space
renderer.outputColorSpace = THREE.SRGBColorSpace;
// Now safe to use renderer
renderer.setClearColor(RENDER_CLEAR_COLOR_FREE, 1); // Opaque darker blue background for sky visibility
applySettings();

const diceAmbientLight = new THREE.AmbientLight(0xffffff, 1.25);
diceScene.add(diceAmbientLight);

const diceKeyLight = new THREE.DirectionalLight(0xffffff, 1.65);
diceKeyLight.position.set(2.5, 4.5, 6.5);
diceScene.add(diceKeyLight);

function createXRHandRay(anchor, color = 0x7fc7ff) {
    const rayGeom = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0, -1)
    ]);
    const rayMat = new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: 0.9
    });
    const rayLine = new THREE.Line(rayGeom, rayMat);
    rayLine.name = 'xr_hand_ray';
    rayLine.scale.z = XR_RAY_MAX_DISTANCE;
    anchor.add(rayLine);

    return {
        anchor,
        rayLine,
        baseColor: new THREE.Color(color)
    };
}

function initXRHandRays() {
    const xrParent = playerRig || scene;
    for (let i = 0; i < 2; i++) {
        const controller = renderer.xr.getController(i);
        const controllerGrip = renderer.xr.getControllerGrip(i);
        const ray = createXRHandRay(controller, i === 0 ? 0x7fc7ff : 0xffb36b);
        ray.controller = controller;
        ray.controllerGrip = controllerGrip;
        xrHandRays.push(ray);
        xrParent.add(controller);
        xrParent.add(controllerGrip);

        controller.addEventListener('connected', (event) => {
            controller.userData.xrInputSource = event.data || null;
            if (controller.userData.xrInputSource && controller.userData.xrInputSource.handedness === 'right') {
                ray.baseColor.setHex(0xffb36b);
            } else if (controller.userData.xrInputSource && controller.userData.xrInputSource.handedness === 'left') {
                ray.baseColor.setHex(0x7fc7ff);
            }
            ray.rayLine.material.color.copy(ray.baseColor);
        });

        controller.addEventListener('disconnected', () => {
            controller.userData.xrInputSource = null;
            ray.rayLine.material.color.copy(ray.baseColor);
            ray.rayLine.scale.z = XR_RAY_MAX_DISTANCE;
        });

        controller.addEventListener('selectstart', () => {
            handleGodAction(GOD_ACTIONS.SELECT, {
                source: 'xr',
                controller,
                controllerIndex: i,
            });
        });

        controller.addEventListener('squeezestart', () => {
            handleGodAction(GOD_ACTIONS.CONTEXT, {
                source: 'xr',
                controller,
                controllerIndex: i,
            });
        });
    }
}

function getSelectableMeshes() {
    const meshes = [];
    scene.traverse((obj) => {
        if (obj.isMesh && isMeshSelectable(obj)) meshes.push(obj);
    });
    return meshes;
}

function updateXRHandRays() {
    if (!renderer.xr.isPresenting) {
        for (const handRay of xrHandRays) {
            handRay.rayLine.visible = false;
        }
        return;
    }

    const selectableMeshes = getSelectableMeshes();
    for (const handRay of xrHandRays) {
        handRay.rayLine.visible = true;
        const transformSource = handRay.controller || handRay.controllerGrip;
        if (!transformSource) continue;

        transformSource.updateMatrixWorld(true);
        xrRayOrigin.setFromMatrixPosition(transformSource.matrixWorld);
        xrRayRotation.identity().extractRotation(transformSource.matrixWorld);
        xrRayDirection.set(0, 0, -1).applyMatrix4(xrRayRotation).normalize();
        xrRaycaster.set(xrRayOrigin, xrRayDirection);

        const hits = xrRaycaster.intersectObjects(selectableMeshes, false);
        if (hits.length > 0) {
            handRay.rayLine.scale.z = Math.min(hits[0].distance, XR_RAY_MAX_DISTANCE);
            handRay.rayLine.material.color.setHex(0x63ff8c);
        } else {
            handRay.rayLine.scale.z = XR_RAY_MAX_DISTANCE;
            handRay.rayLine.material.color.copy(handRay.baseColor);
        }
    }
}

initXRHandRays();

function addWebXRButton() {
    if (isMobileTouchScreenLayout()) {
        return;
    }

    const btn = document.createElement('button');
    const status = document.createElement('div');
    btn.style.position = 'fixed';
    btn.style.left = '24px';
    btn.style.bottom = '24px';
    btn.style.padding = '12px 18px';
    btn.style.fontSize = '14px';
    btn.style.fontFamily = 'monospace';
    btn.style.color = '#fff';
    btn.style.background = 'rgba(20, 20, 24, 0.92)';
    btn.style.border = '1px solid #4a9eff';
    btn.style.borderRadius = '8px';
    btn.style.cursor = 'pointer';
    btn.style.zIndex = '2100';

    status.style.position = 'fixed';
    status.style.left = '24px';
    status.style.bottom = '68px';
    status.style.padding = '6px 10px';
    status.style.fontSize = '12px';
    status.style.fontFamily = 'monospace';
    status.style.color = '#d0d0d0';
    status.style.background = 'rgba(12, 12, 16, 0.8)';
    status.style.border = '1px solid #2e2e35';
    status.style.borderRadius = '6px';
    status.style.zIndex = '2100';
    status.textContent = 'XR: idle';

    function setXRStatus(message) {
        status.textContent = `XR: ${message}`;
    }

    if (!navigator.xr) {
        btn.textContent = 'WebXR Unsupported';
        btn.disabled = true;
        btn.style.opacity = '0.6';
        document.body.appendChild(btn);
        setXRStatus('navigator.xr missing');
        document.body.appendChild(status);
        return;
    }

    if (!window.isSecureContext) {
        btn.textContent = 'HTTPS Required';
        btn.disabled = true;
        btn.style.opacity = '0.6';
        document.body.appendChild(btn);
        setXRStatus('use localhost or https');
        document.body.appendChild(status);
        return;
    }

    let currentSession = null;
    let sessionRequestInFlight = false;

    function syncVRButtonState() {
        currentSession = renderer.xr.getSession() || currentSession;
        if (currentSession) {
            btn.textContent = 'Exit VR';
            setXRStatus('immersive session active');
        } else if (!sessionRequestInFlight) {
            btn.textContent = 'Enter VR';
            setXRStatus('ready');
        }
    }
    btn.textContent = 'Checking VR...';

    navigator.xr.isSessionSupported('immersive-vr').then((supported) => {
        if (!supported) {
            btn.textContent = 'VR Not Available';
            btn.disabled = true;
            btn.style.opacity = '0.6';
            document.body.appendChild(btn);
            setXRStatus('immersive-vr unsupported');
            document.body.appendChild(status);
            return;
        }

        syncVRButtonState();

        renderer.xr.addEventListener('sessionstart', () => {
            currentSession = renderer.xr.getSession() || currentSession;
            setXRStatus('session started');
            syncVRButtonState();
        });

        renderer.xr.addEventListener('sessionend', () => {
            currentSession = null;
            setXRStatus('session ended');
            syncVRButtonState();
        });

        btn.onclick = async () => {
            if (sessionRequestInFlight) return;

            const activeSession = renderer.xr.getSession() || currentSession;
            if (activeSession) {
                try {
                    await activeSession.end();
                } catch (err) {
                    console.warn('Failed to end VR session:', err);
                }
                return;
            }

            try {
                sessionRequestInFlight = true;
                btn.disabled = true;
                btn.textContent = 'Entering VR...';
                setXRStatus('requesting immersive session');

                const pendingHintTimer = window.setTimeout(() => {
                    if (sessionRequestInFlight && !renderer.xr.getSession()) {
                        setXRStatus('still waiting, check headset prompt');
                    }
                }, 4000);

                const session = await navigator.xr.requestSession('immersive-vr', {
                    optionalFeatures: ['local-floor', 'bounded-floor']
                });
                window.clearTimeout(pendingHintTimer);
                renderer.xr.setReferenceSpaceType('local-floor');
                await renderer.xr.setSession(session);
                currentSession = session;

                session.addEventListener('end', () => {
                    currentSession = null;
                    setXRStatus('session ended');
                    syncVRButtonState();
                });
                syncVRButtonState();
            } catch (err) {
                if (err && err.name === 'InvalidStateError') {
                    // Browser reports an already-active immersive session.
                    currentSession = renderer.xr.getSession() || null;
                    setXRStatus('session already active in browser/runtime');
                    syncVRButtonState();
                } else {
                    setXRStatus(`error ${err && err.name ? err.name : 'unknown'}`);
                }
                console.warn('Failed to start VR session:', err);
            } finally {
                sessionRequestInFlight = false;
                btn.disabled = false;
                syncVRButtonState();
            }
        };

        document.body.appendChild(btn);
        document.body.appendChild(status);
    }).catch((err) => {
        console.warn('WebXR support check failed:', err);
        btn.textContent = 'VR Check Failed';
        btn.disabled = true;
        btn.style.opacity = '0.6';
        document.body.appendChild(btn);
        setXRStatus('support check failed');
        document.body.appendChild(status);
    });
}

addWebXRButton();

// --- Scene Hierarchy Menu ---
// --- Transform Inspector Menu ---

inspectorMenu = document.createElement('div');
// Utility: Release pointer lock if active
function releasePointerLockIfActive() {
    if (document.pointerLockElement) {
        document.exitPointerLock();
    }
}
inspectorMenu.style.position = 'fixed';
inspectorMenu.style.right = '-288px'; // Tucked by default (width - tab width)
inspectorMenu.style.top = '0';
inspectorMenu.style.width = '320px';
inspectorMenu.style.height = '100vh';
inspectorMenu.style.background = 'rgba(24, 24, 32, 0.97)';
inspectorMenu.style.color = '#fff';
inspectorMenu.style.overflowY = 'auto';
inspectorMenu.style.display = 'none'; // Hidden by default in PLAYER mode
inspectorMenu.style.pointerEvents = 'none';
inspectorMenu.style.visibility = 'hidden';
inspectorMenu.style.zIndex = '2000';
inspectorMenu.style.fontFamily = 'Consolas, "Segoe UI", monospace';
inspectorMenu.style.fontSize = '16px';
inspectorMenu.style.borderLeft = '1px solid #333';
inspectorMenu.style.boxShadow = '-2px 0 8px #0008';
inspectorMenu.style.padding = '10px 0 10px 0';
inspectorMenu.style.userSelect = 'auto';
inspectorMenu.style.transition = 'right 0.2s cubic-bezier(.4,1.4,.6,1)';
inspectorMenu.style.cursor = 'pointer';
document.body.appendChild(inspectorMenu);

// Add a visible tab for opening/closing
inspectorTab = document.createElement('div');
inspectorTab.style.position = 'absolute';
inspectorTab.style.left = '-32px';
inspectorTab.style.top = '50%';
inspectorTab.style.transform = 'translateY(-50%)';
inspectorTab.style.width = '32px';
inspectorTab.style.height = '96px';
inspectorTab.style.background = 'linear-gradient(90deg, #222 80%, #333 100%)';
inspectorTab.style.borderRadius = '8px 0 0 8px';
inspectorTab.style.display = 'none'; // Hidden by default in PLAYER mode
inspectorTab.style.alignItems = 'center';
inspectorTab.style.justifyContent = 'center';
inspectorTab.style.color = '#fff';
inspectorTab.style.fontWeight = 'bold';
inspectorTab.style.fontSize = '19px';
inspectorTab.style.letterSpacing = '2px';
inspectorTab.style.boxShadow = '-2px 0 8px #0008';
inspectorTab.style.cursor = 'pointer';
inspectorTab.style.pointerEvents = 'none';
inspectorTab.style.visibility = 'hidden';
inspectorTab.innerHTML = '<span style="writing-mode: vertical-lr; transform: rotate(180deg);">INSPECT</span>';
inspectorMenu.appendChild(inspectorTab);

function setInspectorOpen(open) {
    // Prevent opening inspector in player mode
    if (!hasModePermission('tools.selection', modeManager.current) && open) {
        return;
    }
    inspectorOpen = open;
    inspectorMenu.style.right = open ? '0' : '-288px';
    inspectorMenu.style.cursor = open ? 'default' : 'pointer';
}

inspectorTab.addEventListener('click', (e) => {
    if (!hasModePermission('tools.selection', modeManager.current)) {
        e.stopPropagation();
        return;
    }
    e.stopPropagation();
    setInspectorOpen(!inspectorOpen);
});

// Also allow clicking anywhere on the tucked menu to open
inspectorMenu.addEventListener('click', (e) => {
    if (!hasModePermission('tools.selection', modeManager.current)) {
        e.stopPropagation();
        return;
    }
    if (!inspectorOpen) {
        setInspectorOpen(true);
        e.stopPropagation();
    }
});

// Optional: click outside to close
document.addEventListener('mousedown', (e) => {
    if (inspectorOpen && !inspectorMenu.contains(e.target)) {
        setInspectorOpen(false);
    }
});

// Start tucked
setInspectorOpen(false);

function createTransformInput(label, value, onChange) {
    const wrapper = document.createElement('div');
    wrapper.style.display = 'flex';
    wrapper.style.alignItems = 'center';
    wrapper.style.margin = '6px 0';
    wrapper.style.userSelect = 'auto';
    const l = document.createElement('span');
    l.textContent = label;
    l.style.width = '60px';
    l.style.display = 'inline-block';
    l.style.color = '#aaa';
    wrapper.appendChild(l);
    const input = document.createElement('input');
    input.type = 'number';
    input.value = value;
    input.step = '0.01';
    input.style.width = '70px';
    input.style.margin = '0 6px';
    input.style.background = '#222';
    input.style.color = '#fff';
    input.style.border = '1px solid #444';
    input.style.borderRadius = '3px';
    // Add unique id and name for autofill/accessibility
    const safeLabel = label.replace(/\s+/g, '_').toLowerCase();
    input.id = `inspector_${safeLabel}`;
    input.name = `inspector_${safeLabel}`;
    input.autocomplete = 'off';
    // Only update on blur/change, not on every input, to avoid losing focus
    input.onchange = (e) => {
        const v = parseFloat(input.value);
        if (!isNaN(v)) {
            onChange(v);
            if (window.socket) window.socket.emit('scene-update', serializeScene());
        }
    };
    input.onblur = (e) => {
        const v = parseFloat(input.value);
        if (!isNaN(v)) {
            onChange(v);
            if (window.socket) window.socket.emit('scene-update', serializeScene());
        }
    };
    wrapper.appendChild(input);
    return wrapper;
}


function updateInspectorMenu() {
    if (!inspectorMenu) return;
    inspectorMenu.innerHTML = '<div style="font-weight:bold;padding:0 0 8px 16px;font-size:18px;letter-spacing:1px;">Transform Inspector</div>';
    // Make inspector menu release pointer lock on click
    inspectorMenu.onclick = releasePointerLockIfActive;
    if (!selectedObject) {
        inspectorMenu.innerHTML += '<div style="padding:12px 0 0 16px;color:#aaa;">No object selected</div>';
        // Add save/load buttons even if no object is selected
        addSaveLoadButtonsToInspector();
        return;
    }
    // Name
    const nameDiv = document.createElement('div');
    nameDiv.textContent = selectedObject.name || selectedObject.type;
    nameDiv.style.fontWeight = 'bold';
    nameDiv.style.fontSize = '17px';
    nameDiv.style.margin = '8px 0 12px 16px';
    inspectorMenu.appendChild(nameDiv);
    // Position
    inspectorMenu.appendChild(createTransformInput('Pos X', selectedObject.position.x, v => { selectedObject.position.x = v; if (selectionBoxHelper) selectionBoxHelper.update(); updateInspectorMenu(); }));
    inspectorMenu.appendChild(createTransformInput('Pos Y', selectedObject.position.y, v => { selectedObject.position.y = v; if (selectionBoxHelper) selectionBoxHelper.update(); updateInspectorMenu(); }));
    inspectorMenu.appendChild(createTransformInput('Pos Z', selectedObject.position.z, v => { selectedObject.position.z = v; if (selectionBoxHelper) selectionBoxHelper.update(); updateInspectorMenu(); }));
    // Rotation (degrees)
    inspectorMenu.appendChild(createTransformInput('Rot X', THREE.MathUtils.radToDeg(selectedObject.rotation.x), v => { selectedObject.rotation.x = THREE.MathUtils.degToRad(v); if (selectionBoxHelper) selectionBoxHelper.update(); updateInspectorMenu(); }));
    inspectorMenu.appendChild(createTransformInput('Rot Y', THREE.MathUtils.radToDeg(selectedObject.rotation.y), v => { selectedObject.rotation.y = THREE.MathUtils.degToRad(v); if (selectionBoxHelper) selectionBoxHelper.update(); updateInspectorMenu(); }));
    inspectorMenu.appendChild(createTransformInput('Rot Z', THREE.MathUtils.radToDeg(selectedObject.rotation.z), v => { selectedObject.rotation.z = THREE.MathUtils.degToRad(v); if (selectionBoxHelper) selectionBoxHelper.update(); updateInspectorMenu(); }));
    // Scale
    inspectorMenu.appendChild(createTransformInput('Scale X', selectedObject.scale.x, v => { selectedObject.scale.x = v; if (selectionBoxHelper) selectionBoxHelper.update(); updateInspectorMenu(); }));
    inspectorMenu.appendChild(createTransformInput('Scale Y', selectedObject.scale.y, v => { selectedObject.scale.y = v; if (selectionBoxHelper) selectionBoxHelper.update(); updateInspectorMenu(); }));
    inspectorMenu.appendChild(createTransformInput('Scale Z', selectedObject.scale.z, v => { selectedObject.scale.z = v; if (selectionBoxHelper) selectionBoxHelper.update(); updateInspectorMenu(); }));

    // Light-specific inspector controls
    if (selectedObject.isPointLight && selectedObject.userData && selectedObject.userData.isUserLight) {
        const lightDiv = document.createElement('div');
        lightDiv.style.margin = '14px 0 0 0';
        lightDiv.innerHTML = '<div style="font-weight:bold;padding:0 0 8px 16px;font-size:17px;letter-spacing:1px;">Light Inspector</div>';

        lightDiv.appendChild(createTransformInput('Intensity', selectedObject.intensity, (v) => {
            selectedObject.intensity = Math.max(0, v);
        }));
        lightDiv.appendChild(createTransformInput('Falloff', selectedObject.distance, (v) => {
            selectedObject.distance = Math.max(0, v);
        }));

        const wrapper = document.createElement('div');
        wrapper.style.display = 'flex';
        wrapper.style.alignItems = 'center';
        wrapper.style.margin = '6px 0 10px 16px';
        wrapper.style.userSelect = 'auto';

        const l = document.createElement('span');
        l.textContent = 'Show Gizmo';
        l.style.width = '90px';
        l.style.display = 'inline-block';
        l.style.color = '#aaa';
        wrapper.appendChild(l);

        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = selectedObject.userData.showHandle !== false;
        input.onchange = () => {
            setPointLightHandleVisible(selectedObject, input.checked);
        };
        wrapper.appendChild(input);
        lightDiv.appendChild(wrapper);
        inspectorMenu.appendChild(lightDiv);
    }

    // Add save/load buttons at the bottom
    addSaveLoadButtonsToInspector();

    // --- Material Inspector ---
    if (selectedObject.material) {
        const mat = selectedObject.material;
        const matDiv = document.createElement('div');
        matDiv.style.margin = '18px 0 0 0';
        matDiv.innerHTML = '<div style="font-weight:bold;padding:0 0 8px 16px;font-size:17px;letter-spacing:1px;">Material Inspector</div>';

        // --- Material Slot Preview ---
        const slotDiv = document.createElement('div');
        slotDiv.style.display = 'flex';
        slotDiv.style.alignItems = 'center';
        slotDiv.style.margin = '8px 0 12px 16px';
        slotDiv.style.gap = '12px';
        slotDiv.style.flexWrap = 'wrap';
        slotDiv.innerHTML = '<span style="color:#aaa;font-size:15px;">Material Slots:</span>';

        // Helper to create a preview swatch for a material, with assignment dropdown
        function createMaterialSwatch(material, label, assignCallback) {
            const swatch = document.createElement('div');
            swatch.style.display = 'flex';
            swatch.style.flexDirection = 'column';
            swatch.style.alignItems = 'center';
            swatch.style.justifyContent = 'center';
            swatch.style.width = '64px';
            swatch.style.margin = '0 4px';
            // Swatch preview
            const preview = document.createElement('div');
            preview.style.width = '32px';
            preview.style.height = '32px';
            preview.style.borderRadius = '6px';
            preview.style.border = '1px solid #444';
            preview.style.background = material.color ? '#' + material.color.getHexString() : '#888';
            preview.style.boxShadow = '0 1px 4px #0006';
            if (material.map && material.map.image) {
                preview.style.background = `url('${material.map.image.currentSrc || material.map.image.src}') center/cover`;
            }
            swatch.appendChild(preview);
            // Label
            const lbl = document.createElement('span');
            lbl.textContent = label;
            lbl.style.fontSize = '12px';
            lbl.style.color = '#aaa';
            lbl.style.marginTop = '2px';
            swatch.appendChild(lbl);

            // Material type dropdown
            const select = document.createElement('select');
            select.style.marginTop = '4px';
            select.style.width = '60px';
            select.style.fontSize = '12px';
            select.style.background = '#222';
            select.style.color = '#fff';
            select.style.border = '1px solid #444';
            select.style.borderRadius = '3px';
            const materialTypes = [
                { name: 'Standard', ctor: THREE.MeshStandardMaterial },
                { name: 'Basic', ctor: THREE.MeshBasicMaterial },
                { name: 'Phong', ctor: THREE.MeshPhongMaterial },
                { name: 'Physical', ctor: THREE.MeshPhysicalMaterial },
                { name: 'Lambert', ctor: THREE.MeshLambertMaterial },
            ];
            materialTypes.forEach((type, idx) => {
                const opt = document.createElement('option');
                opt.value = idx;
                opt.textContent = type.name;
                if (material.constructor === type.ctor) opt.selected = true;
                select.appendChild(opt);
            });
            select.onchange = (e) => {
                const idx = parseInt(select.value);
                const type = materialTypes[idx];
                // Create new material, copy basic properties
                const newMat = new type.ctor();
                if (material.color) newMat.color.copy(material.color);
                if (material.map) newMat.map = material.map;
                if (material.emissive && newMat.emissive) newMat.emissive.copy(material.emissive);
                if (typeof material.metalness === 'number') newMat.metalness = material.metalness;
                if (typeof material.roughness === 'number') newMat.roughness = material.roughness;
                if (typeof material.opacity === 'number') newMat.opacity = material.opacity;
                if ('wireframe' in material) newMat.wireframe = material.wireframe;
                if (material.normalMap) newMat.normalMap = material.normalMap;
                if (material.userData && material.userData.textureAnim) {
                    newMat.userData.textureAnim = { ...material.userData.textureAnim };
                }
                newMat.transparent = material.transparent;
                newMat.side = material.side;
                newMat.visible = material.visible;
                if (assignCallback) assignCallback(newMat);
                updateInspectorMenu();
                emitMaterialChange(selectedObject);
            };
            swatch.appendChild(select);
            return swatch;
        }

        // If material is an array (multi-material mesh), show all slots
        if (Array.isArray(mat)) {
            mat.forEach((m, i) => {
                slotDiv.appendChild(createMaterialSwatch(m, `Slot ${i}`, (newMat) => {
                    mat[i] = newMat;
                    selectedObject.material = mat;
                }));
            });
        } else {
            slotDiv.appendChild(createMaterialSwatch(mat, 'Current', (newMat) => {
                selectedObject.material = newMat;
            }));
        }
        matDiv.appendChild(slotDiv);

        // --- Texture Animation (optional) ---
        function appendTextureAnimControls(material, heading, materialIndex = 0) {
            if (!material) return;
            const anim = getMaterialTextureAnim(material);
            const section = document.createElement('div');
            section.style.margin = '8px 0 0 0';
            section.innerHTML = `<div style="padding:0 0 4px 16px;font-size:14px;color:#9fb7ff;">${heading} Texture Animation</div>`;

            section.appendChild(createTransformInput('Anim X', anim.x, (v) => {
                setMaterialTextureAnimAxis(material, 'x', v);
                emitMaterialChange(selectedObject, materialIndex);
            }));
            section.appendChild(createTransformInput('Anim Y', anim.y, (v) => {
                setMaterialTextureAnimAxis(material, 'y', v);
                emitMaterialChange(selectedObject, materialIndex);
            }));
            section.appendChild(createTransformInput('Anim Z', anim.z, (v) => {
                setMaterialTextureAnimAxis(material, 'z', v);
                emitMaterialChange(selectedObject, materialIndex);
            }));
            matDiv.appendChild(section);
        }

        if (Array.isArray(mat)) {
            mat.forEach((m, i) => appendTextureAnimControls(m, `Slot ${i}`, i));
        } else {
            appendTextureAnimControls(mat, 'Current', 0);
        }

        // --- Upload Texture Button ---
        const uploadDiv = document.createElement('div');
        uploadDiv.style.margin = '12px 0 0 16px';
        const uploadLabel = document.createElement('label');
        uploadLabel.textContent = 'Upload Texture:';
        uploadLabel.style.color = '#aaa';
        uploadLabel.style.fontSize = '15px';
        uploadLabel.style.marginRight = '8px';
        uploadDiv.appendChild(uploadLabel);
        const uploadInput = document.createElement('input');
        uploadInput.type = 'file';
        uploadInput.accept = 'image/*';
        uploadInput.style.marginRight = '8px';
        uploadInput.onchange = (e) => {
            const file = uploadInput.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = function(ev) {
                const img = new window.Image();
                img.onload = function() {
                    const texture = new THREE.Texture(img);
                    texture.needsUpdate = true;
                    if (Array.isArray(selectedObject.material)) {
                        selectedObject.material.forEach(m => { m.map = texture; m.needsUpdate = true; });
                    } else {
                        selectedObject.material.map = texture;
                        selectedObject.material.needsUpdate = true;
                    }
                    updateInspectorMenu();
                };
                img.src = ev.target.result;
            };
            reader.readAsDataURL(file);
        };
        uploadDiv.appendChild(uploadInput);
        matDiv.appendChild(uploadDiv);

        // Helper to create color input
        function createColorInput(label, value, onChange) {
            const wrapper = document.createElement('div');
            wrapper.style.display = 'flex';
            wrapper.style.alignItems = 'center';
            wrapper.style.margin = '6px 0';
            wrapper.style.userSelect = 'auto';
            const l = document.createElement('span');
            l.textContent = label;
            l.style.width = '60px';
            l.style.display = 'inline-block';
            l.style.color = '#aaa';
            wrapper.appendChild(l);
            const input = document.createElement('input');
            input.type = 'color';
            // Convert THREE.Color to hex string
            input.value = '#' + value.getHexString();
            input.style.width = '40px';
            input.style.margin = '0 6px';
            input.oninput = (e) => {
                const hex = e.target.value;
                onChange(new THREE.Color(hex));
                emitMaterialChange(selectedObject);
            };
            wrapper.appendChild(input);
            return wrapper;
        }

        // Color
        if (mat.color) {
            matDiv.appendChild(createColorInput('Color', mat.color, v => { mat.color.copy(v); }));
        }
        // Emissive
        if (mat.emissive) {
            matDiv.appendChild(createColorInput('Emissive', mat.emissive, v => { mat.emissive.copy(v); }));
        }
        // Metalness
        if (typeof mat.metalness === 'number') {
            matDiv.appendChild(createTransformInput('Metalness', mat.metalness, v => { mat.metalness = v; emitMaterialChange(selectedObject); }));
        }
        // Roughness
        if (typeof mat.roughness === 'number') {
            matDiv.appendChild(createTransformInput('Roughness', mat.roughness, v => { mat.roughness = v; emitMaterialChange(selectedObject); }));
        }
        // Opacity
        if (typeof mat.opacity === 'number') {
            matDiv.appendChild(createTransformInput('Opacity', mat.opacity, v => { mat.opacity = v; mat.transparent = v < 1.0; emitMaterialChange(selectedObject); }));
        }
        // Wireframe
        if ('wireframe' in mat) {
            const wrapper = document.createElement('div');
            wrapper.style.display = 'flex';
            wrapper.style.alignItems = 'center';
            wrapper.style.margin = '6px 0';
            wrapper.style.userSelect = 'auto';
            const l = document.createElement('span');
            l.textContent = 'Wireframe';
            l.style.width = '60px';
            l.style.display = 'inline-block';
            l.style.color = '#aaa';
            wrapper.appendChild(l);
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.checked = !!mat.wireframe;
            input.onchange = (e) => { mat.wireframe = input.checked; emitMaterialChange(selectedObject); };
            wrapper.appendChild(input);
            matDiv.appendChild(wrapper);
        }

        inspectorMenu.appendChild(matDiv);
    }
}

setTimeout(updateInspectorMenu, 1200);

// Scene hierarchy menu and related code fully removed

// Scene hierarchy menu and related code removed

// --- Crosshair Overlay ---
const crosshair = document.createElement('div');
crosshair.style.position = 'fixed';
crosshair.style.left = '50%';
crosshair.style.top = '50%';
crosshair.style.width = '32px';
crosshair.style.height = '32px';
crosshair.style.transform = 'translate(-50%, -50%)';
crosshair.style.pointerEvents = 'none';
crosshair.style.zIndex = '1000';
crosshair.innerHTML = `
    <svg width="32" height="32" style="display:block" xmlns="http://www.w3.org/2000/svg">
        <line x1="16" y1="8" x2="16" y2="24" stroke="#fff" stroke-width="2"/>
        <line x1="8" y1="16" x2="24" y2="16" stroke="#fff" stroke-width="2"/>
    </svg>
`;
document.body.appendChild(crosshair);

function setCrosshairVisible(visible) {
    if (!crosshair) return;
    crosshair.style.display = visible ? 'block' : 'none';
}

// Crosshair should never appear in combat mode.
setCrosshairVisible(currentGameMode !== GAME_MODE.COMBAT);

const coordsHud = document.createElement('div');
coordsHud.id = 'coords-hud';
coordsHud.style.position = 'fixed';
coordsHud.style.left = '12px';
coordsHud.style.top = '12px';
coordsHud.style.padding = '6px 10px';
coordsHud.style.background = 'rgba(10, 10, 14, 0.78)';
coordsHud.style.border = '1px solid rgba(130, 150, 180, 0.55)';
coordsHud.style.borderRadius = '6px';
coordsHud.style.color = '#e6f0ff';
coordsHud.style.fontFamily = 'Consolas, "Segoe UI", monospace';
coordsHud.style.fontSize = '13px';
coordsHud.style.lineHeight = '1.45';
coordsHud.style.zIndex = '2200';
coordsHud.style.pointerEvents = 'none';
coordsHud.textContent = 'X: 0.00  Y: 0.00  Z: 0.00';
document.body.appendChild(coordsHud);

const fpsHud = document.createElement('div');
fpsHud.id = 'fps-hud';
fpsHud.style.position = 'fixed';
fpsHud.style.left = '12px';
fpsHud.style.top = '52px';
fpsHud.style.padding = '4px 10px';
fpsHud.style.background = 'rgba(10, 10, 14, 0.72)';
fpsHud.style.border = '1px solid rgba(130, 150, 180, 0.5)';
fpsHud.style.borderRadius = '6px';
fpsHud.style.color = '#bde4ff';
fpsHud.style.fontFamily = 'Consolas, "Segoe UI", monospace';
fpsHud.style.fontSize = '12px';
fpsHud.style.lineHeight = '1.35';
fpsHud.style.zIndex = '2200';
fpsHud.style.pointerEvents = 'none';
fpsHud.textContent = 'FPS: --';
document.body.appendChild(fpsHud);

let fpsSmoothed = 60;

// Combat HUD overlay (top-right)
combatUiEl = document.createElement('div');
combatUiEl.id = 'combat-ui';
combatUiEl.style.position = 'fixed';
combatUiEl.style.top = '20px';
combatUiEl.style.right = '20px';
combatUiEl.style.padding = '10px 14px';
combatUiEl.style.background = 'rgba(0,0,0,0.65)';
combatUiEl.style.border = '1px solid rgba(130, 150, 180, 0.55)';
combatUiEl.style.borderRadius = '6px';
combatUiEl.style.color = '#e6f0ff';
combatUiEl.style.fontFamily = 'Consolas, "Segoe UI", monospace';
combatUiEl.style.fontSize = '17px';
combatUiEl.style.lineHeight = '1.8';
combatUiEl.style.zIndex = '2200';
combatUiEl.style.pointerEvents = 'auto';
document.body.appendChild(combatUiEl);
updateCombatUI();

// ── Action Menu UI ──
// --- FFX-style nested combat menu ---

(function injectFfxMenuCss() {
    if (document.getElementById('ffx-menu-style')) return;
    const s = document.createElement('style');
    s.id = 'ffx-menu-style';
    s.textContent = `
    #action-menu { font-family:'Segoe UI',system-ui,sans-serif; font-size:14px; opacity:1; }
    .ffx-main { background:rgb(4,10,26); border:1px solid rgba(56,189,248,0.45); border-radius:10px 0 0 10px; min-width:232px; overflow:hidden; box-shadow:0 12px 48px rgba(0,0,0,0.9),inset 0 1px 0 rgba(56,189,248,0.18); }
    .ffx-main-solo { border-radius:10px; }
    .ffx-sub { background:rgb(4,10,26); border:1px solid rgba(56,189,248,0.35); border-left:none; border-radius:0 10px 10px 0; min-width:202px; overflow:hidden; box-shadow:0 12px 48px rgba(0,0,0,0.9); }
    .ffx-header { display:flex; gap:8px; align-items:center; padding:7px 14px 6px; border-bottom:1px solid rgba(56,189,248,0.18); background:rgb(0,20,50); color:#7ecfff; font-size:11.5px; font-weight:600; letter-spacing:0.04em; }
    .ffx-res-pip { display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:3px; vertical-align:middle; }
    .ffx-row { display:flex; align-items:center; padding:9px 12px 9px 10px; cursor:pointer; border-left:3px solid transparent; transition:background 0.08s,border-color 0.08s; color:#c8e4f8; }
    .ffx-row:hover:not(.ffx-row-disabled) { background:rgb(14,64,112); border-left-color:rgba(56,189,248,0.45); }
    .ffx-row.ffx-row-active { background:rgb(14,64,112); border-left-color:#38bdf8; color:#e8f8ff; }
    .ffx-row.ffx-row-disabled { color:#334a57; cursor:not-allowed; }
    .ffx-row.ffx-row-urgent { border-left-color:#ef4444 !important; color:#fca5a5 !important; }
    .ffx-arrow { width:13px; flex-shrink:0; color:#38bdf8; font-size:10px; }
    .ffx-label { flex:1; font-size:14px; font-weight:500; letter-spacing:0.02em; white-space:nowrap; }
    .ffx-detail { color:#507a92; font-size:12px; white-space:nowrap; padding-left:8px; }
    .ffx-intent-badge { margin-left:8px; padding:1px 7px; border-radius:999px; font-size:10px; letter-spacing:0.03em; text-transform:uppercase; border:1px solid rgba(148,163,184,0.45); color:#cbd5e1; background:rgba(30,41,59,0.65); }
    .ffx-intent-armed { border-color:rgba(56,189,248,0.7); color:#7dd3fc; background:rgba(3,105,161,0.28); }
    .ffx-intent-sent { border-color:rgba(251,191,36,0.75); color:#fde68a; background:rgba(146,64,14,0.32); }
    .ffx-intent-acked { border-color:rgba(52,211,153,0.75); color:#a7f3d0; background:rgba(6,95,70,0.32); }
    .ffx-intent-resolved { border-color:rgba(74,222,128,0.72); color:#bbf7d0; background:rgba(20,83,45,0.32); }
    .ffx-intent-failed { border-color:rgba(248,113,113,0.75); color:#fecaca; background:rgba(127,29,29,0.36); }
    .ffx-intent-canceled { border-color:rgba(148,163,184,0.65); color:#cbd5e1; background:rgba(51,65,85,0.38); }
    .ffx-badge { background:rgb(22,58,90); border:1px solid rgba(56,189,248,0.38); color:#7ecfff; font-size:11px; border-radius:10px; padding:1px 6px; margin-left:6px; }
    .ffx-divider { height:1px; margin:2px 0; background:rgb(18,40,66); }
    .ffx-sub-row { display:flex; align-items:center; padding:9px 12px 9px 10px; cursor:pointer; border-left:3px solid transparent; transition:background 0.08s,border-color 0.08s; color:#c8e4f8; }
    .ffx-sub-row:hover:not(.ffx-sub-disabled) { background:rgb(14,64,112); border-left-color:rgba(56,189,248,0.45); }
    .ffx-sub-row.ffx-sub-active { background:rgb(14,64,112); border-left-color:#38bdf8; color:#e8f8ff; }
    .ffx-sub-row.ffx-sub-disabled { color:#334a57; cursor:not-allowed; }
    .ffx-confirm-bar { display:flex; align-items:center; gap:8px; padding:8px 12px; background:rgb(0,10,24); border-top:1px solid rgba(56,189,248,0.28); }
    .ffx-confirm-btn { padding:5px 14px; border-radius:6px; font-size:13px; font-weight:700; cursor:pointer; border:1px solid; transition:background 0.1s; background:none; }
    .ffx-confirm-ok { border-color:#22c55e; color:#86efac; }
    .ffx-confirm-ok:hover { background:rgba(22,163,74,0.35); }
    .ffx-confirm-cancel { border-color:#dc2626; color:#fca5a5; }
    .ffx-confirm-cancel:hover { background:rgba(127,29,29,0.35); }
    .ffx-confirm-desc { flex:1; color:#7ecfff; font-size:12px; text-align:center; }
    `;
    document.head.appendChild(s);
})();

actionMenuEl = document.createElement('div');
actionMenuEl.id = 'action-menu';
actionMenuEl.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:2300;pointer-events:auto;visibility:hidden;user-select:none;display:flex;align-items:flex-end;';
document.body.appendChild(actionMenuEl);

function setActionMenuVisible(visible) {
    if (!actionMenuEl) return;
    actionMenuEl.style.visibility = visible ? 'visible' : 'hidden';
}

// Build the inner HTML for a submenu column (Actions or Items pane).
function _ffxBuildSubRows(rows) {
    return rows.map(r => {
        const activeClass = r.active ? ' ffx-sub-active' : '';
        const disabledClass = r.disabled ? ' ffx-sub-disabled' : '';
        const instAttr = r._instanceId ? ` data-instance-id="${String(r._instanceId).replace(/"/g,'')}"` : '';
        const detailHtml = r.detail ? `<span class="ffx-detail">${r.detail}</span>` : '';
        return `<div class="ffx-sub-row${activeClass}${disabledClass}" data-ffx-sub="${r.id}"${instAttr}>`
             + `<span class="ffx-arrow">${r.active ? '►' : ''}</span>`
             + `<span class="ffx-label">${r.label}</span>`
             + detailHtml
             + `</div>`;
    }).join('');
}

function _ffxHandleTopClick(topId) {
    if (topId !== 'end-turn' && isInputLockedForCombat('ACTION')) return;
    if (topId === 'attack') {
        ffxMenuState.openSub = null;
        uxSetIntentStatus('attack', 'armed', 'target');
        setCurrentAction('attack');
    } else if (topId === 'actions') {
        ffxMenuState.openSub = ffxMenuState.openSub === 'actions' ? null : 'actions';
        updateActionMenu();
    } else if (topId === 'items') {
        ffxMenuState.openSub = ffxMenuState.openSub === 'items' ? null : 'items';
        updateActionMenu();
    } else if (topId === 'end-turn') {
        ffxMenuState.openSub = null;
        uxSetIntentStatus('endTurn', 'armed', 'queued');
        turnEndRequired ? confirmEndTurn() : endTurn();
    }
}

function _ffxHandleSubClick(pane, subId, instanceId) {
    if (pane === 'actions') {
        if (subId === 'dodge') {
            if (!socket || !socket.connected) return;
            ffxMenuState.openSub = null;
            uxSetIntentStatus('move', 'sent', 'dodge');
            socket.emit('combat-action', {
                id: `client_dodge_${Date.now()}_${Math.floor(Math.random() * 1e5)}`,
                type: 'dodge',
            });
            showFloatingText('Dodge — enemies have disadvantage', '#38bdf8', true);
            updateActionMenu();
        } else {
            if (isInputLockedForCombat('ACTION')) return;
            uxSetIntentStatus('move', 'armed', subId);
            setCurrentAction(subId);
            if (subId === 'dash') showFloatingText('Dash — choose a destination', '#8dd694', true);
            else if (subId === 'disengage') showFloatingText('Disengage — choose a safe route', '#8dd694', true);
        }
    } else if (pane === 'items') {
        if (subId === '__none') return;
        if (!socket || !socket.connected) return;
        ffxMenuState.openSub = null;
        socket.emit('combat-action', {
            id: `client_use_object_${Date.now()}_${Math.floor(Math.random() * 1e5)}`,
            type: 'use-object',
            instanceId: instanceId || subId,
        });
        updateActionMenu();
    }
}

function updateActionMenu() {
    if (!actionMenuEl) return;
    if (modeManager.current === MODE.DM) {
        setActionMenuVisible(false);
        hideCombatConfirmUI();
        hideEndTurnPrompt();
        hideTargetPreview();
        return;
    }
    if (currentGameMode !== GAME_MODE.COMBAT || combatState.phase !== 'PLAYER') {
        setActionMenuVisible(false);
        hideEndTurnPrompt();
        return;
    }
    
    setActionMenuVisible(true);
    hideEndTurnPrompt(); // End-turn state is shown inline in the FFX menu row

    // — Derive state values —
    const locked      = turnEndRequired || !!combatState.lock;
    const actionUsed  = !!combatState.player.actionUsed;
    const bonusUsed   = !!combatState.player.bonusUsed;
    const moveFt      = Math.max(0, Number(combatState.player.movementRemaining) || 0);
    const baseFt      = getPlayerBaseSpeedFt();
    const movePct     = baseFt > 0 ? Math.round(Math.min(100, (moveFt / baseFt) * 100)) : 0;
    const moveColor   = moveFt <= 0 ? '#334a57' : moveFt < baseFt / 2 ? '#f59e0b' : '#38bdf8';
    const weaponName  = window.loadedEngineEntity?.combat?.weapon?.name || 'Melee';
    const consumables = getCombatConsumableItems();
    const openSub     = ffxMenuState.openSub;

    // — Capability gates —
    const canAttack    = !actionUsed && !locked;
    const canMove      = moveFt > 0 && !locked;
    const canDash      = playerCombatCapabilities.can_dash && !actionUsed && !locked;
    const canDisengage = playerCombatCapabilities.can_disengage && !actionUsed && !locked;
    const canDodge     = playerCombatCapabilities.can_dodge && !actionUsed && !locked;
    const hasItems     = consumables.length > 0 && !actionUsed && !locked;

    // — Active state flags —
    const isAttackActive    = currentAction === 'attack';
    const isMoveActive      = currentAction === 'move';
    const isDashActive      = currentAction === 'dash';
    const isDisengageActive = currentAction === 'disengage';
    const isActionsSubOpen  = openSub === 'actions';
    const isItemsSubOpen    = openSub === 'items';
    const actionsRowActive  = isActionsSubOpen || isMoveActive || isDashActive || isDisengageActive;

    // — Confirm bar / lifecycle bar —
    const awaiting = combatInteraction.awaitingConfirm;
    const previewPending = combatUiLifecycle.phase === COMBAT_UI_PHASE.PREVIEW_PENDING;
    let confirmDesc = '';
    if (awaiting) {
        const preview = combatInteraction.preview;
        const costFt  = preview ? Math.round(Number(preview.costFeet) || 0) : 0;
        if (combatInteraction.action === 'attack' || combatInteraction.action === 'auto-move-attack-choice') {
            const sourceTag = preview && preview.source === 'server' ? 'server' : 'local';
            const damageMin = Math.max(0, Number(preview?.damageMin) || 0);
            const damageMax = Math.max(0, Number(preview?.damageMax) || 0);
            if (sourceTag === 'server' && damageMax > 0) {
                confirmDesc = `Strike target (${damageMin}-${damageMax} dmg, authoritative)`;
            } else {
                confirmDesc = 'Strike target';
            }
        } else if (costFt > 0) {
            confirmDesc = `Move ${costFt}ft`;
        } else {
            confirmDesc = String(combatInteraction.action || '').replace(/-/g, ' ');
        }
    }
    let confirmBarHtml = '';
    if (previewPending) {
        confirmBarHtml = `<div class="ffx-confirm-bar"><span class="ffx-confirm-desc">Syncing server preview...</span><button class="ffx-confirm-btn ffx-confirm-cancel" data-ffx-confirm="cancel">✕&nbsp;Cancel</button></div>`;
    } else if (awaiting) {
        confirmBarHtml = `<div class="ffx-confirm-bar">
            <button class="ffx-confirm-btn ffx-confirm-ok" data-ffx-confirm="ok">✓&nbsp;Confirm</button>
            <span class="ffx-confirm-desc">${confirmDesc}</span>
            <button class="ffx-confirm-btn ffx-confirm-cancel" data-ffx-confirm="cancel">✕&nbsp;Cancel</button>
           </div>`;
    }

    // — Resource header —
    const actionPip = `<span class="ffx-res-pip" style="background:${actionUsed ? '#334a57' : '#38bdf8'};box-shadow:0 0 5px ${actionUsed ? 'transparent' : '#38bdf8'};"></span>`;
    const bonusPip  = `<span class="ffx-res-pip" style="background:${bonusUsed ? '#334a57' : '#fbbf24'};box-shadow:0 0 5px ${bonusUsed ? 'transparent' : '#fbbf2488'};"></span>`;
    const movePipBar = `<div style="width:40px;height:4px;background:rgba(56,189,248,0.15);border-radius:2px;overflow:hidden;margin-left:3px;display:inline-block;vertical-align:middle;">
        <div style="height:100%;width:${movePct}%;background:${moveColor};border-radius:2px;transition:width 0.3s;"></div></div>`;
    const attackBadge = uxIntentBadgeHtml('attack');
    const moveBadge = uxIntentBadgeHtml('move');
    const endTurnBadge = uxIntentBadgeHtml('endTurn');

    // — Subcolumn HTML —
    let subColHtml = '';
    if (isActionsSubOpen) {
        subColHtml = _ffxBuildSubRows([
            { id: 'move',      label: 'Move',      detail: `${moveFt}ft`,        active: isMoveActive,      disabled: !canMove },
            { id: 'dash',      label: 'Dash',      detail: `${baseFt * 2}ft max`, active: isDashActive,      disabled: !canDash },
            { id: 'disengage', label: 'Disengage', detail: 'No opp. attacks',     active: isDisengageActive, disabled: !canDisengage },
            { id: 'dodge',     label: 'Dodge',     detail: 'Adv. resistance',                                disabled: !canDodge },
        ]);
    } else if (isItemsSubOpen) {
        subColHtml = consumables.length === 0
            ? _ffxBuildSubRows([{ id: '__none', label: 'No items', disabled: true }])
            : _ffxBuildSubRows(consumables.map(c => ({
                id:          c.instanceId || c.itemId,
                label:       String(c.itemId || 'Item').replace(/_/g, ' ').replace(/\b\w/g, x => x.toUpperCase()),
                detail:      `×${Math.max(0, Number(c.qty) || 0)}`,
                _instanceId: c.instanceId,
                disabled:    false,
              })));
    }

    const subColClass   = subColHtml ? '' : ' ffx-main-solo';
    const endTurnUrgent = turnEndRequired;

    actionMenuEl.innerHTML =
        `<div class="ffx-main${subColClass}">
          <div class="ffx-header">
            ${actionPip}Action &nbsp; ${bonusPip}Bonus
            <span style="margin-left:auto;color:${moveColor};font-variant-numeric:tabular-nums;">${moveFt}ft</span>
            ${movePipBar}
          </div>
          <div class="ffx-row${isAttackActive ? ' ffx-row-active' : ''}${!canAttack ? ' ffx-row-disabled' : ''}" data-action-top="attack">
            <span class="ffx-arrow">${isAttackActive ? '►' : ''}</span>
            <span class="ffx-label">Attack</span>
                        ${attackBadge}
            <span class="ffx-detail">${weaponName}</span>
          </div>
          <div class="ffx-row${actionsRowActive ? ' ffx-row-active' : ''}" data-action-top="actions">
            <span class="ffx-arrow">${actionsRowActive ? '►' : ''}</span>
            <span class="ffx-label">Actions</span>
                        ${moveBadge}
            <span class="ffx-detail" style="color:#38bdf8;">▸</span>
          </div>
          <div class="ffx-row${isItemsSubOpen ? ' ffx-row-active' : ''}${!hasItems && consumables.length === 0 ? ' ffx-row-disabled' : ''}" data-action-top="items">
            <span class="ffx-arrow">${isItemsSubOpen ? '►' : ''}</span>
            <span class="ffx-label">Items</span>
            ${consumables.length > 0 ? `<span class="ffx-badge">${consumables.length}</span>` : ''}
            <span class="ffx-detail" style="color:#38bdf8;margin-left:4px;">▸</span>
          </div>
          <div class="ffx-divider"></div>
          <div class="ffx-row${endTurnUrgent ? ' ffx-row-urgent' : ''}" data-action-top="end-turn"
               style="color:${endTurnUrgent ? '#fca5a5' : '#60a5d0'};">
            <span class="ffx-arrow">${endTurnUrgent ? '!' : ''}</span>
            <span class="ffx-label">${endTurnUrgent ? 'End Turn !' : 'End Turn'}</span>
                        ${endTurnBadge}
          </div>
          ${confirmBarHtml}
        </div>${subColHtml ? `<div class="ffx-sub">${subColHtml}</div>` : ''}`;

    // — Wire events —
    actionMenuEl.querySelectorAll('[data-action-top]').forEach(row => {
        row.addEventListener('click', e => { e.stopPropagation(); _ffxHandleTopClick(row.dataset.actionTop); });
    });
    actionMenuEl.querySelectorAll('[data-ffx-sub]').forEach(row => {
        row.addEventListener('click', e => {
            e.stopPropagation();
            if (row.classList.contains('ffx-sub-disabled')) return;
            _ffxHandleSubClick(openSub, row.dataset.ffxSub, row.dataset.instanceId);
        });
    });
    const okBtn = actionMenuEl.querySelector('[data-ffx-confirm="ok"]');
    if (okBtn) okBtn.addEventListener('click', e => { e.stopPropagation(); confirmAction(); });
    const cancelBtn = actionMenuEl.querySelector('[data-ffx-confirm="cancel"]');
    if (cancelBtn) cancelBtn.addEventListener('click', e => { e.stopPropagation(); cancelAction(); });
}

function setCurrentAction(action) {
    if (isInputLockedForCombat('ACTION')) return;
    resetCombatInteraction();
    currentAction = action;
    combatInteraction.action = action;
    if (action) {
        setCombatUiPhase(COMBAT_UI_PHASE.TARGETING, { action });
    }
    if (isMovementSelectionAction(action) && isPlayerInputTurn()) {
        rebuildCombatMoveTiles();
        hideMoveDestPreview();
    }
    updateActionMenu();
}

function confirmAction() {
    if (isInputLockedForCombat('ACTION')) {
        recordInputFeedback('action', 'blocked', 'combat-locked', { showFloating: false });
        return;
    }
    if (combatState.timelineBusy) {
        recordInputFeedback('action', 'queued', 'timeline-busy', { showFloating: false });
        return;
    }
    if (!combatInteraction.awaitingConfirm || !combatInteraction.target) {
        recordInputFeedback('action', 'blocked', 'nothing-to-confirm', { showFloating: false, pushTimeline: false });
        return;
    }

    if (combatInteraction.action === 'auto-move-attack-choice') {
        const targetForAuto = combatInteraction.target;
        const prepared = combatInteraction.autoApproachPreview;
        if (!targetForAuto) {
            showFloatingText('No target selected', '#ff8a8a', true);
            return;
        }
        const previewData = prepared
            ? {
                destPos: new THREE.Vector3(prepared.destX, prepared.destY, prepared.destZ),
                costFeet: prepared.costFeet,
                valid: prepared.valid,
                remainingFeet: prepared.remainingFeet,
            }
            : buildAutoApproachPreview(targetForAuto);

        if (!previewData || !previewData.valid) {
            recordInputFeedback('move', 'blocked', 'auto-approach-invalid', { showFloating: false });
            showFloatingText('Cannot auto-move into attack range', '#ff8a8a', true);
            showMovementTilesForApproach(targetForAuto);
            return;
        }

        hideCombatConfirmUI();
        combatInteraction.awaitingConfirm = false;

        const moveStarted = executeMoveTo(previewData.destPos, previewData.costFeet);
        if (moveStarted) {
            queuePostMoveAttack(targetForAuto, 'melee');
        }
        resetCombatInteraction();
    } else if (combatInteraction.action === 'move-and-attack') {
        if (!combatInteraction.preview || !combatInteraction.preview.valid) {
            recordInputFeedback('move', 'blocked', 'invalid-move', { showFloating: false });
            showFloatingText('Invalid move', '#ff8a8a', true);
            return;
        }
        const targetForAttack = combatInteraction.moveAndAttackTarget;
        const moveStarted = executeMoveTo(combatInteraction.target, combatInteraction.preview.costFeet);
        if (moveStarted) {
            queuePostMoveAttack(targetForAttack, 'melee');
        }
        resetCombatInteraction();
    } else if (combatInteraction.action === 'move' || combatInteraction.action === 'dash' || combatInteraction.action === 'disengage' || combatInteraction.action === 'move-to-approach') {
        if (!combatInteraction.preview || !combatInteraction.preview.valid) {
            recordInputFeedback('move', 'blocked', 'invalid-move', { showFloating: false });
            showFloatingText('Invalid move', '#ff8a8a', true);
            return;
        }
        if (!socket || !socket.connected) {
            recordInputFeedback('move', 'blocked', 'no-server-connection', { showFloating: false });
            showFloatingText('No server connection', '#ff8a8a', true);
            return;
        }
        const actionType = combatInteraction.action === 'move-to-approach' ? 'move' : combatInteraction.action;
        const targetPos = combatInteraction.target;
        if (uxTelemetry.enabled) uxTelemetry.marks.moveSentAt = performance.now();
        uxSetIntentStatus('move', 'sent', actionType);
        socket.emit('combat-action', {
            id: `client_${actionType}_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
            type: actionType,
            position: {
                x: Number(targetPos.x) || 0,
                y: Number(targetPos.y) || 0,
                z: Number(targetPos.z) || 0,
            },
        });
        recordInputFeedback('move', 'queued', actionType, {
            showFloating: false,
            presentation: {
                anchorObject: playerRig || playerState,
                uiPhase: COMBAT_UI_PHASE.RESOLVING,
                action: actionType,
                color: '#66b3ff',
            },
        });
        setCombatUiPhase(COMBAT_UI_PHASE.RESOLVING, { action: actionType });
        resetCombatInteraction({ keepPhase: true });
    } else if (combatInteraction.action === 'attack') {
        if (uxTelemetry.enabled) uxTelemetry.marks.attackSentAt = performance.now();
        uxSetIntentStatus('attack', 'sent', 'attack');
        playConfirmAttackSnap();
        recordInputFeedback('attack', 'accepted', 'confirm', {
            showFloating: false,
            presentation: {
                anchorObject: combatInteraction.target || playerRig || playerState,
                uiPhase: COMBAT_UI_PHASE.RESOLVING,
                action: 'attack',
                color: '#ffd166',
            },
        });
        executeAttack(combatInteraction.target);
    }
    if (uxTelemetry.enabled) uxTelemetry.counters.confirms += 1;
    updateActionMenu();
}

function cancelAction() {
    if (isInputLockedForCombat('ACTION')) return;
    const canceledAction = combatInteraction.action;
    resetCombatInteraction();
    if (canceledAction === 'attack') {
        uxSetIntentStatus('attack', 'canceled', 'cancel');
    } else if (canceledAction === 'move' || canceledAction === 'dash' || canceledAction === 'disengage' || canceledAction === 'move-to-approach') {
        uxSetIntentStatus('move', 'canceled', 'cancel');
    }
    if (uxTelemetry.enabled) uxTelemetry.counters.cancels += 1;
    updateActionMenu();
}

// Combat event log (top-right, below combat HUD)
combatLogEl = document.createElement('div');
combatLogEl.id = 'combat-log';
combatLogEl.style.position = 'fixed';
combatLogEl.style.top = '202px';
combatLogEl.style.right = '20px';
combatLogEl.style.width = '320px';
combatLogEl.style.maxWidth = '38vw';
combatLogEl.style.maxHeight = '96px';
combatLogEl.style.overflowY = 'auto';
combatLogEl.style.padding = '8px 10px';
combatLogEl.style.background = 'rgba(8,10,18,0.74)';
combatLogEl.style.border = '1px solid rgba(180, 205, 255, 0.75)';
combatLogEl.style.borderRadius = '6px';
combatLogEl.style.color = '#d9e2ff';
combatLogEl.style.fontFamily = 'Consolas, "Segoe UI", monospace';
combatLogEl.style.fontSize = '14px';
combatLogEl.style.lineHeight = '1.5';
combatLogEl.style.boxShadow = '0 0 22px rgba(90, 150, 255, 0.35), inset 0 0 16px rgba(35, 65, 120, 0.55)';
combatLogEl.style.backdropFilter = 'blur(2px)';
combatLogEl.style.zIndex = '2200';
combatLogEl.style.pointerEvents = 'none';
document.body.appendChild(combatLogEl);
logCombatEvent('Combat log ready', 'system');

combatFlashEl = document.createElement('div');
combatFlashEl.style.position = 'fixed';
combatFlashEl.style.left = '0';
combatFlashEl.style.top = '0';
combatFlashEl.style.width = '100vw';
combatFlashEl.style.height = '100vh';
combatFlashEl.style.pointerEvents = 'none';
combatFlashEl.style.opacity = '0';
combatFlashEl.style.zIndex = '2500';
combatFlashEl.style.mixBlendMode = 'screen';
document.body.appendChild(combatFlashEl);

// Action bar (bottom center, shown only during player turn)
// Legacy action-bar removed — FFX menu (action-menu) is the sole combat UI.
(function removeLegacyActionBar() {
    const old = document.getElementById('action-bar');
    if (old) old.remove();
})();

// DM timeline scrubber (bottom center)
(function buildDmTimelineBar() {
    ensureDmControlPanel();
})();

// Now safe to use renderer.domElement (canvas)
const canvas = renderer.domElement;
canvas.tabIndex = 0;
canvas.style.outline = 'none';
createMobileTouchControls();

canvas.addEventListener('click', (event) => {
    if (isDmFreeCamera()) {
        // In DM free camera, left-click interaction is handled by the global mousedown adapter.
        return;
    }
    if (isInputLockedForCombat('ACTION')) return;
    if (isDmObserverMode()) return;
    if (isDmLikeMode()) return;
    unlockCombatAudio();
    if (!combatCameraActive) {
        canvas.requestPointerLock();
    }
});

canvas.addEventListener('mousedown', (event) => {
    if (isDmFreeCamera() && event.button === 2) {
        handleGodAction(GOD_ACTIONS.LOOK, { source: 'mouse', phase: 'start', mouseEvent: event });
        event.preventDefault();
        return;
    }
    if (event.button !== 1) return;
    if (isDmObserverMode()) {
        event.preventDefault();
        return;
    }
    orbitPreviewActive = true;
    orbitPreviewLastX = event.clientX;
    orbitPreviewLastY = event.clientY;
    event.preventDefault();
});

canvas.addEventListener('contextmenu', (event) => {
    if (isDmFreeCamera()) event.preventDefault();
});

canvas.addEventListener('auxclick', (event) => {
    if (event.button === 1) {
        event.preventDefault();
    }
});

// BG3-style hover: show destination marker + path line while mouse moves over move zone.
canvas.addEventListener('mousemove', (event) => {
    if (!combatCameraActive) return;
    if (modeManager.current === MODE.DM) {
        hideTargetPreview();
        if (hoveredMoveWorldPos) hideMoveDestPreview();
        return;
    }
    if (combatInteraction.awaitingConfirm) {
        hideTargetPreview();
        return;
    }
    if (turnEndRequired) {
        hideTargetPreview();
        return;
    }

    const rect = renderer.domElement.getBoundingClientRect();
    const mx = ((event.clientX - rect.left) / rect.width)  *  2 - 1;
    const my = -((event.clientY - rect.top)  / rect.height) * 2 + 1;
    const hoverRay = new THREE.Raycaster();
    hoverRay.setFromCamera({ x: mx, y: my }, getActiveViewCamera());

    // Check for target hover first (highest priority)
    const activeTargetables = trainingDummies.filter((dummy) => (
        dummy &&
        dummy.parent &&
        dummy.userData &&
        dummy.userData.isTargetable &&
        (dummy.userData.hp || 0) > 0
    ));
    if (activeTargetables.length > 0) {
        const targetHit = hoverRay.intersectObjects(activeTargetables, false)[0];
        if (targetHit) {
            if (hoveredMoveWorldPos) hideMoveDestPreview();
            updateTargetPreview(targetHit.object, event.clientX, event.clientY);
            return;
        }
    }

    hideTargetPreview();

    // Check move zone if no target hovered
    if (!moveZoneDisc || !hasModePermission('player.combatInput')) {
        if (hoveredMoveWorldPos) hideMoveDestPreview();
        return;
    }

    const hit = hoverRay.intersectObject(moveZoneDisc, false)[0];
    if (!hit) {
        hideMoveDestPreview();
        return;
    }

    const snapped = snapToMoveGrid(hit.point.x, hit.point.z);
    // Don't update every pixel — only when snapped cell changes.
    if (hoveredMoveWorldPos &&
        Math.abs(hoveredMoveWorldPos.x - snapped.x) < 0.01 &&
        Math.abs(hoveredMoveWorldPos.z - snapped.z) < 0.01) {
        return;
    }
    hoveredMoveWorldPos = { x: snapped.x, z: snapped.z };

    const discY = moveZoneDisc.position.y;
    updateMoveDestPreview(snapped.x, snapped.z, discY);
});

document.addEventListener('mouseup', (event) => {
    if (event.button === 2) {
        handleGodAction(GOD_ACTIONS.LOOK, { source: 'mouse', phase: 'end', mouseEvent: event });
        return;
    }
    if (event.button !== 1) return;
    orbitPreviewActive = false;
    orbitPreviewPitch = 0;
});

document.addEventListener('pointerlockchange', () => {
    canMove = document.pointerLockElement === canvas;
});

document.addEventListener('mousemove', (event) => {
    if (isInputLockedForCombat('LOOK')) return;

    // During combat review/confirm UI, freeze look rotation so selection is stable.
    if (isCombatReviewUiOpen()) {
        return;
    }

    if (isDmFreeCamera()) {
        handleGodAction(GOD_ACTIONS.LOOK, { source: 'mouse', phase: 'move', mouseEvent: event });
        return;
    }
    if (!canMove && !combatCameraActive) return;
    yaw -= event.movementX * lookSpeed;
    if (!combatCameraActive) {
        pitch -= event.movementY * lookSpeed;
        pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pitch));
    }

    // Tank control: player always turns with mouse.
    if (playerRig) {
        playerRig.rotation.y = yaw;
    }

    // Optional camera up/down tilt.
    if (!combatCameraActive) {
        camera.rotation.x = pitch;
    }
});

document.addEventListener('keydown', (event) => {
    if (consoleState.open) return;

    if (ensureUnifiedInputManager().handleKeyboardEvent(event, 'down', buildUnifiedInputContext())) {
        event.preventDefault();
        return;
    }

    const tagName = event.target && event.target.tagName ? event.target.tagName : '';
    const isTextInput = tagName === 'INPUT' || tagName === 'TEXTAREA';
    const isPlayerInputMode = canUseStandardMovementControls();

    if (!isPlayerInputMode) {
        if (isDmLikeMode() && !event.repeat && (event.code === 'Digit4' || event.code === 'Numpad4')) {
            dmInsetEnabled = !dmInsetEnabled;
            const msg = `DM inset view: ${dmInsetEnabled ? 'ON' : 'OFF'} (4)`;
            showFloatingText(msg, '#9ec9ff', true);
            appendConsoleHistory(msg, 'ok');
            event.preventDefault();
            return;
        }

        if (isDmFreeCamera()) {
            if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
                dmFreeMoveFast = true;
                event.preventDefault();
                return;
            }
            if (!event.repeat && event.code === 'KeyF') {
                const t = getMostRelevantActor();
                if (t) focusDmCameraOnTarget(t);
                event.preventDefault();
                return;
            }
            switch (event.code) {
                case 'KeyW': dmFreeMoveForward = true; event.preventDefault(); return;
                case 'KeyS': dmFreeMoveBackward = true; event.preventDefault(); return;
                case 'KeyA': dmFreeMoveLeft = true; event.preventDefault(); return;
                case 'KeyD': dmFreeMoveRight = true; event.preventDefault(); return;
                case 'Space': dmFreeMoveUp = true; event.preventDefault(); return;
                case 'ControlLeft':
                case 'ControlRight':
                    dmFreeMoveDown = true;
                    event.preventDefault();
                    return;
            }
        }

        if (event.code === 'KeyL' && !event.repeat && !isTextInput && hasModePermission('tools.selection')) {
            createPointLightFromCamera();
            event.preventDefault();
            return;
        }

        if (event.code === 'KeyC' && !event.repeat && hasModePermission('combat.control')) {
            const enableCombat = currentGameMode !== GAME_MODE.COMBAT;
            clearTurnEndState();
            currentGameMode = enableCombat ? GAME_MODE.COMBAT : GAME_MODE.FREE;
            combatState.inCombat = enableCombat;
            syncSkyboxWithGameMode();
            if (enableCombat) {
                setCombatPhase('PLAYER');
                setCombatLock(false);
                combatCenter.copy(playerState.position);
                combatRadius = Math.max(combatRadius, 12);
                activateCombatCamera();
                resetLocalTurnResources();
                console.info('Combat mode enabled.');
            } else {
                setCombatPhase('TRANSITION');
                setCombatLock(false);
                deactivateCombatCamera();
                combatState.turnOrder = [];
                combatState.currentTurnIndex = 0;
                console.info('Free roam mode enabled.');
            }
            event.preventDefault();
            return;
        }

        return;
    }

    if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
        if (isInputLockedForCombat('MOVE')) {
            event.preventDefault();
            return;
        }
        playerSprinting = true;
        event.preventDefault();
        return;
    }

    if ((event.code === 'Enter' || event.code === 'NumpadEnter') && !event.repeat) {
        if (turnEndRequired) {
            confirmEndTurn();
            event.preventDefault();
            return;
        }
        if (isInputLockedForCombat('END_TURN')) {
            event.preventDefault();
            return;
        }
        // First, check if there's a pending action to confirm
        if (combatInteraction.awaitingConfirm) {
            confirmAction();
        } else if (currentGameMode === GAME_MODE.COMBAT) {
            endTurn();
        } else {
            resetLocalTurnResources();
        }
        console.info('Action confirmed or turn ended / reset.');
        event.preventDefault();
        return;
    }

    if (event.code === 'Escape' && !event.repeat) {
        if (hasDmPossessionControl()) {
            releasePossession();
            showFloatingText('POSSESSION RELEASED', '#9ec9ff', true);
            event.preventDefault();
            return;
        }
        if (isInputLockedForCombat('ACTION')) {
            event.preventDefault();
            return;
        }
        // Cancel any pending action
        if (combatInteraction.awaitingConfirm) {
            cancelAction();
            console.info('Action cancelled.');
        }
        event.preventDefault();
        return;
    }

    if (event.code === 'KeyM' && !event.repeat) {
        if (isInputLockedForCombat('MOVE')) {
            event.preventDefault();
            return;
        }
        if (activeMovementCircle && activeMovementCircle.parent) {
            activeMovementCircle.parent.remove(activeMovementCircle);
            activeMovementCircle = null;
        } else {
            activeMovementCircle = createMovementRadius(playerState.position, combatState.player.movementRemaining, 0x3388ff, 0.18);
            activeMovementCircle.userData.baseFeet = Math.max(combatState.player.movementRemaining, 0.01);
            scene.add(activeMovementCircle);
        }
        event.preventDefault();
        return;
    }

    if (event.code === 'KeyC' && !event.repeat && hasModePermission('combat.control')) {
        const enableCombat = currentGameMode !== GAME_MODE.COMBAT;
        clearTurnEndState();
        currentGameMode = enableCombat ? GAME_MODE.COMBAT : GAME_MODE.FREE;
        combatState.inCombat = enableCombat;
        syncSkyboxWithGameMode();
        if (enableCombat) {
            setCombatPhase('PLAYER');
            setCombatLock(false);
            combatCenter.copy(playerState.position);
            combatRadius = Math.max(combatRadius, 12);
            activateCombatCamera();
            resetLocalTurnResources();
            console.info('Combat mode enabled.');
        } else {
            setCombatPhase('TRANSITION');
            setCombatLock(false);
            deactivateCombatCamera();
            combatState.turnOrder = [];
            combatState.currentTurnIndex = 0;
            console.info('Free roam mode enabled.');
        }
        event.preventDefault();
        return;
    }

    if (event.code === 'Tab') {
        if (isInputLockedForCombat('MOVE')) {
            event.preventDefault();
            return;
        }
        playerFlying = !playerFlying;
        if (playerFlying) {
            playerState.jumpCount = 0;
            console.info('Flying mode enabled (Tab).');
        } else {
            playerFlyUp = false;
            playerFlyDown = false;
            console.info('Flying mode disabled (Tab).');
        }
        event.preventDefault();
        return;
    }

    if (!isTextInput) {
        const isScaleDownKey =
            event.code === 'Slash' ||
            event.code === 'NumpadDivide' ||
            event.key === '/';
        if (isScaleDownKey) {
            adjustLocalAvatarScale(-1);
            event.preventDefault();
            return;
        }

        const isScaleUpKey =
            event.code === 'NumpadMultiply' ||
            (event.code === 'Digit8' && event.shiftKey) ||
            event.key === '*';
        if (isScaleUpKey) {
            adjustLocalAvatarScale(1);
            event.preventDefault();
            return;
        }
    }

    if (!isTextInput && !event.repeat && localPlayerAvatarRigState && localPlayerAvatarRigState.active) {
        if (event.code === 'Backquote' && typeof localPlayerAvatarRigState.reset === 'function') {
            localPlayerAvatarRigState.reset();
            console.info('Animation stopped.');
            event.preventDefault();
            return;
        }

        if ((event.code === 'Digit1' || event.code === 'Numpad1') && typeof localPlayerAvatarRigState.toggleDance === 'function') {
            const enabled = localPlayerAvatarRigState.toggleDance();
            console.info(enabled ? 'Dance enabled (1).' : 'Dance disabled (1).');
            event.preventDefault();
            return;
        }

        if ((event.code === 'Digit2' || event.code === 'Numpad2') && typeof localPlayerAvatarRigState.triggerFrontFlip === 'function') {
            localPlayerAvatarRigState.triggerFrontFlip();
            console.info('Front flip triggered (2).');
            event.preventDefault();
            return;
        }

        if ((event.code === 'Digit3' || event.code === 'Numpad3') && typeof localPlayerAvatarRigState.triggerHammerFlourish === 'function') {
            localPlayerAvatarRigState.triggerHammerFlourish();
            console.info('Hammer flourish triggered (3).');
            event.preventDefault();
            return;
        }

        if ((event.code === 'Digit4' || event.code === 'Numpad4') && typeof localPlayerAvatarRigState.toggleWorm === 'function') {
            const enabled = localPlayerAvatarRigState.toggleWorm();
            console.info(enabled ? 'Worm enabled (4).' : 'Worm disabled (4).');
            event.preventDefault();
            return;
        }

        if ((event.code === 'Digit5' || event.code === 'Numpad5') && typeof localPlayerAvatarRigState.toggleHeadspin === 'function') {
            const enabled = localPlayerAvatarRigState.toggleHeadspin();
            console.info(enabled ? 'Headspin enabled (5).' : 'Headspin disabled (5).');
            event.preventDefault();
            return;
        }
    }

    if (event.code === 'KeyL' && !event.repeat) {
        if (!isTextInput && hasModePermission('tools.selection')) {
            createPointLightFromCamera();
            event.preventDefault();
            return;
        }
    }

    if (playerFlying) {
        switch(event.code) {
            case 'Space':
                if (turnEndRequired) {
                    event.preventDefault();
                    break;
                }
                playerFlyUp = true;
                event.preventDefault();
                break;
            case 'ControlLeft':
            case 'ControlRight':
                if (turnEndRequired) {
                    event.preventDefault();
                    break;
                }
                playerFlyDown = true;
                event.preventDefault();
                break;
        }
    }

    if (turnEndRequired) {
        switch(event.code) {
            case 'KeyW':
            case 'KeyA':
            case 'KeyS':
            case 'KeyD':
            case 'ArrowLeft':
            case 'ArrowRight':
            case 'Space':
            case 'ControlLeft':
            case 'ControlRight':
                event.preventDefault();
                return;
        }
    }

    switch(event.code) {
        case 'KeyW': moveForward = true; break;
        case 'KeyS': moveBackward = true; break;
        case 'KeyA':
            if (currentGameMode === GAME_MODE.COMBAT) {
                turnLeft = true;
                moveLeft = false;
                event.preventDefault();
            } else {
                moveLeft = true;
            }
            break;
        case 'KeyD':
            if (currentGameMode === GAME_MODE.COMBAT) {
                turnRight = true;
                moveRight = false;
                event.preventDefault();
            } else {
                moveRight = true;
            }
            break;
        case 'ArrowLeft':
            if (currentGameMode !== GAME_MODE.COMBAT) {
                turnLeft = true;
            }
            event.preventDefault();
            break;
        case 'ArrowRight':
            if (currentGameMode !== GAME_MODE.COMBAT) {
                turnRight = true;
            }
            event.preventDefault();
            break;
        case 'Space':
            if (!playerFlying && !event.repeat) {
                playerState.jumpQueued = true;
            }
            event.preventDefault();
            break;
    }
});
document.addEventListener('keyup', (event) => {
    if (ensureUnifiedInputManager().handleKeyboardEvent(event, 'up', buildUnifiedInputContext())) {
        event.preventDefault();
        return;
    }

    if (isDmFreeCamera()) {
        if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
            dmFreeMoveFast = false;
            event.preventDefault();
            return;
        }

        switch(event.code) {
            case 'KeyW': dmFreeMoveForward = false; event.preventDefault(); return;
            case 'KeyS': dmFreeMoveBackward = false; event.preventDefault(); return;
            case 'KeyA': dmFreeMoveLeft = false; event.preventDefault(); return;
            case 'KeyD': dmFreeMoveRight = false; event.preventDefault(); return;
            case 'Space': dmFreeMoveUp = false; event.preventDefault(); return;
            case 'ControlLeft':
            case 'ControlRight':
                dmFreeMoveDown = false;
                event.preventDefault();
                return;
        }
    }

    if (!canUseStandardMovementControls()) {
        return;
    }

    if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
        playerSprinting = false;
        event.preventDefault();
        return;
    }

    if (playerFlying) {
        switch(event.code) {
            case 'Space':
                playerFlyUp = false;
                event.preventDefault();
                break;
            case 'ControlLeft':
            case 'ControlRight':
                playerFlyDown = false;
                event.preventDefault();
                break;
        }
    }

    switch(event.code) {
        case 'KeyW': moveForward = false; break;
        case 'KeyS': moveBackward = false; break;
        case 'KeyA':
            moveLeft = false;
            if (currentGameMode === GAME_MODE.COMBAT) {
                turnLeft = false;
                event.preventDefault();
            }
            break;
        case 'KeyD':
            moveRight = false;
            if (currentGameMode === GAME_MODE.COMBAT) {
                turnRight = false;
                event.preventDefault();
            }
            break;
        case 'ArrowLeft': turnLeft = false; event.preventDefault(); break;
        case 'ArrowRight': turnRight = false; event.preventDefault(); break;
    }
});

function updateFlyControls(delta) {
    pollUnifiedGamepadInput();

    if (applyXRFlightControls(delta)) {
        return;
    }

    const fixedDelta = Math.min(delta, MAX_PHYSICS_DELTA);
    applyTouchLookInput(fixedDelta);

    const animMode = (localPlayerAvatarRigState && typeof localPlayerAvatarRigState.getMode === 'function')
        ? localPlayerAvatarRigState.getMode()
        : 'walk';
    const isAnimating = animMode === 'dance' || animMode === 'frontflip' || animMode === 'hammerflourish' || animMode === 'worm' || animMode === 'headspin';

    // Holster hammer on back for idle/walk mode, equip it in hand for action modes.
    if (localPlayerHammerProp) {
        if (animMode === 'headspin') {
            localPlayerHammerProp.visible = false;
        } else if (animMode === 'walk' || animMode === 'dance' || animMode === 'frontflip' || animMode === 'worm') {
            setLocalHammerHolstered(true);
        } else {
            setLocalHammerHolstered(false);
        }
    }

    if (!worldPhysicsReady) {
        playerState.velocity.set(0, 0, 0);
        playerState.jumpCount = 0;
        playerState.jumpQueued = false;
        syncPlayerRigFromState();

        localPlayerJumpVisualBlend = 0;
        if (localPlayerAvatarRoot) {
            localPlayerAvatarRoot.position.y = LOCAL_AVATAR_BASE_Y;
            if (animMode !== 'headspin') {
                localPlayerAvatarRoot.rotation.x = 0;
            }
        }

        if (isAnimating) {
            autoOrbitYaw += autoOrbitSpeed * fixedDelta;
        } else {
            autoOrbitYaw = 0;
        }

        if (!updateCombatCamera(fixedDelta)) {
            if (isAnimating) {
                const orbitRadius = 4.8;
                const orbitHeight = FREE_CAMERA_HEIGHT;
                camera.position.set(
                    Math.sin(autoOrbitYaw) * orbitRadius,
                    orbitHeight,
                    Math.cos(autoOrbitYaw) * orbitRadius,
                );

                if (localPlayerAvatarRoot) {
                    localPlayerAvatarRoot.getWorldPosition(thirdPersonLookTarget);
                    thirdPersonLookTarget.y += 1.0;
                } else {
                    playerRig.getWorldPosition(thirdPersonLookTarget);
                    thirdPersonLookTarget.y -= 1.0;
                }
                camera.lookAt(thirdPersonLookTarget);
            } else {
                camera.position.set(0, FREE_CAMERA_HEIGHT, 4.8);
                camera.rotation.set(pitch, 0, 0);
            }
        }
        return;
    }

    const reviewRotationLocked = isCombatReviewUiOpen();
    if (!reviewRotationLocked && (turnLeft || turnRight)) {
        const turnDelta = (turnLeft ? 1 : 0) - (turnRight ? 1 : 0);
        yaw += turnDelta * turnSpeed * fixedDelta;
    }

    direction.set(0, 0, 0);
    if (moveForward) direction.z -= 1;
    if (moveBackward) direction.z += 1;
    if (moveLeft) direction.x -= 1;
    if (moveRight) direction.x += 1;
    direction.normalize();

    // Keep the active controlled body facing in the heading controlled by mouse/turn input.
    const controlled = getControlledActor();
    if (isDmLikeMode() && controlled && controlled !== playerState) {
        controlled.rotation.y = yaw;
        if (playerRig) playerRig.rotation.y = yaw;
    } else if (playerRig) {
        playerRig.rotation.y = yaw;
    }

    // During headspin, spin the avatar mesh root (not playerRig — camera is a child of that).
    if (localPlayerAvatarRoot) {
        if (animMode === 'headspin') {
            headspinYaw += 5.5 * fixedDelta;
            localPlayerAvatarRoot.rotation.y = Math.PI + headspinYaw;
            localPlayerAvatarRoot.rotation.x = 0;
        } else {
            headspinYaw = 0;
            localPlayerAvatarRoot.rotation.y = Math.PI;
        }

        const jumpPoseActive = animMode === 'walk' && !playerState.onGround;
        const targetJumpBlend = jumpPoseActive ? 1 : 0;
        localPlayerJumpVisualBlend = THREE.MathUtils.lerp(
            localPlayerJumpVisualBlend,
            targetJumpBlend,
            Math.min(1, fixedDelta * 10),
        );

        const normalizedVy = THREE.MathUtils.clamp(playerState.velocity.y / PLAYER_JUMP_SPEED, -1, 1);
        const jumpLift = localPlayerJumpVisualBlend * (0.08 + Math.max(0, normalizedVy) * 0.06);
        const jumpTiltX = localPlayerJumpVisualBlend * THREE.MathUtils.clamp((-normalizedVy * 0.28) + (normalizedVy < 0 ? 0.14 : 0), -0.28, 0.42);
        localPlayerAvatarRoot.position.y = LOCAL_AVATAR_BASE_Y + jumpLift;
        if (animMode !== 'headspin') {
            localPlayerAvatarRoot.rotation.x = jumpTiltX;
        }
    }

    moveVectorWorld.copy(direction);
    moveVectorWorld.applyAxisAngle(upAxis, yaw);
    const currentSpeed = playerSprinting ? speed * PLAYER_SPRINT_MULTIPLIER : speed;
    playerState.velocity.x = moveVectorWorld.x * currentSpeed;
    playerState.velocity.z = moveVectorWorld.z * currentSpeed;
    localPlayerAvatarMoveSpeed = Math.hypot(playerState.velocity.x, playerState.velocity.z);

    if (playerState.jumpQueued) {
        const canJump = playerState.onGround || playerState.jumpCount < PLAYER_MAX_JUMPS;
        if (canJump) {
            const jumpNumber = playerState.onGround ? 1 : (playerState.jumpCount + 1);
            if (jumpNumber >= 3) {
                playerState.velocity.y = PLAYER_TRIPLE_JUMP_SPEED;
                if (localPlayerAvatarRigState && typeof localPlayerAvatarRigState.triggerFrontFlip === 'function') {
                    localPlayerAvatarRigState.triggerFrontFlip();
                }
            } else if (jumpNumber === 2) {
                playerState.velocity.y = PLAYER_DOUBLE_JUMP_SPEED;
            } else {
                playerState.velocity.y = PLAYER_JUMP_SPEED;
            }
            playerState.onGround = false;
            playerState.jumpCount = jumpNumber;
        }
    }
    playerState.jumpQueued = false;

    if (playerFlying) {
        playerState.velocity.y = 0;
        if (playerFlyUp) playerState.velocity.y = PLAYER_FLY_SPEED;
        if (playerFlyDown) playerState.velocity.y = -PLAYER_FLY_SPEED;
        playerState.onGround = false;
        playerState.jumpCount = 0;
    } else {
        playerState.velocity.y = Math.max(
            playerState.velocity.y - PLAYER_GRAVITY * fixedDelta,
            -Math.max(PLAYER_TERMINAL_VELOCITY, 50),
        );
    }

    // Apply velocity
    playerState.prevPosition.copy(playerState.position);  // Save for opportunity attack detection
    let moveX = playerState.velocity.x * fixedDelta;
    let moveZ = playerState.velocity.z * fixedDelta;

    if (currentGameMode === GAME_MODE.COMBAT && !playerFlying) {
        // Combat movement is executed discretely via planned move confirmation.
        moveX = 0;
        moveZ = 0;
        playerState.velocity.x = 0;
        playerState.velocity.z = 0;
    }

    const activeInputActor = getActiveInputActor();

    // DM free camera has no physical presence — suppress player movement only when unpossessed.
    if (isDmLikeMode() && !hasDmPossessionControl() && activeInputActor === playerState) {
        playerState.velocity.set(0, 0, 0);
        moveX = 0;
        moveZ = 0;
    }
    playerState.position.x += moveX;
    playerState.position.z += moveZ;
    const previousY = playerState.position.y;
    playerState.position.y += playerState.velocity.y * fixedDelta;

    // Possession is input-rerouted: DM input drives the possessed actor entity.
    if (isDmLikeMode() && activeInputActor && activeInputActor !== playerState) {
        playerState.velocity.set(0, 0, 0);
        playerState.position.copy(playerRig.position);

        const actor = activeInputActor;
        actor.position.x += moveVectorWorld.x * currentSpeed * fixedDelta;
        actor.position.z += moveVectorWorld.z * currentSpeed * fixedDelta;
        actor.rotation.y = yaw;
    }

    // Resolve collisions using BVH or fall back to Box3
    if (useBVHCollisions && bvhColliderMesh && bvhColliderMesh.geometry.boundsTree) {
        resolveCollisionsBVH();
    } else {
        resolveHorizontalCollisions('x', playerState.velocity.x * fixedDelta);
        resolveHorizontalCollisions('z', playerState.velocity.z * fixedDelta);
        resolveVerticalCollisions(previousY);
    }

    if (playerState.position.length() > PLAYER_MAX_SAFE_DISTANCE) {
        resetPlayerToSafeSpawn();
    }

    syncPlayerRigFromState();

    if (isAnimating) {
        autoOrbitYaw += autoOrbitSpeed * fixedDelta;
    } else {
        autoOrbitYaw = 0;
    }

    if (!updateCombatCamera(fixedDelta)) {
        if (isAnimating) {
            const orbitRadius = 4.8;
            const orbitHeight = FREE_CAMERA_HEIGHT;
            camera.position.set(
                Math.sin(autoOrbitYaw) * orbitRadius,
                orbitHeight,
                Math.cos(autoOrbitYaw) * orbitRadius,
            );

            if (localPlayerAvatarRoot) {
                localPlayerAvatarRoot.getWorldPosition(thirdPersonLookTarget);
                thirdPersonLookTarget.y += 1.0;
            } else {
                playerRig.getWorldPosition(thirdPersonLookTarget);
                thirdPersonLookTarget.y -= 1.0;
            }
            camera.lookAt(thirdPersonLookTarget);
        } else {
            // Keep third-person camera locked behind player rig.
            camera.position.set(0, FREE_CAMERA_HEIGHT, 4.8);
            camera.rotation.set(pitch, 0, 0);
        }
    }
}

// Resize support
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    if (dmCamera) {
        dmCamera.aspect = window.innerWidth / window.innerHeight;
        dmCamera.updateProjectionMatrix();
    }
    const activeView = getActiveViewCamera();
    dicePassCamera.aspect = activeView.aspect;
    dicePassCamera.updateProjectionMatrix();
    const dpr = window.devicePixelRatio || 1;
    renderer.setPixelRatio(dpr * Math.max(0.35, Math.min(1.0, Number(SETTINGS.renderScale) || 1)));
    renderer.setSize(window.innerWidth, window.innerHeight);
    refreshMobileTouchControlsVisibility();
});

window.addEventListener('orientationchange', () => {
    refreshMobileTouchControlsVisibility();
});

// --- Zoom in/out with mouse wheel ---
renderer.domElement.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (isDmObserverMode() && dmCamera) {
        // DM observer mode: disable wheel/middle-mouse zoom to keep camera framing stable.
        return;
    }
    // Allow zooming in closer by lowering the minimum FOV
    camera.fov = Math.max(5, Math.min(100, camera.fov + e.deltaY * 0.05));
    camera.updateProjectionMatrix();
});


// Lighting

// Sun-like directional light
const sunLight = new THREE.DirectionalLight(0xffffff, 2.0);
sunLight.position.set(50, 100, 50);
sunLight.castShadow = true;
sunLight.shadow.mapSize.width = 2048;
sunLight.shadow.mapSize.height = 2048;
sunLight.shadow.camera.near = 1;
sunLight.shadow.camera.far = 500;
sunLight.shadow.camera.left = -100;
sunLight.shadow.camera.right = 100;
sunLight.shadow.camera.top = 100;
sunLight.shadow.camera.bottom = -100;
scene.add(sunLight);

// Add a ground plane to receive shadows
const groundGeo = new THREE.PlaneGeometry(1000, 1000);
const groundMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.8, metalness: 0.2 });
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI / 2;
ground.position.y = 0;
ground.receiveShadow = true;
scene.add(ground);

// --- Toggleable Grid Overlay ---
let gridHelper = null;
let gridVisible = false;
function setGridVisibility(visible) {
    if (!gridHelper) {
        // 1000x1000 units, 1 unit = 1 square, 500 divisions (smaller grid squares)
        gridHelper = new THREE.GridHelper(1000, 500, 0x00ffff, 0xffffff);
        gridHelper.position.y = 0.01; // Slightly above ground to avoid z-fighting
        gridHelper.material.opacity = 0.7;
        gridHelper.material.transparent = true;
        gridHelper.renderOrder = 10;
    }
    gridVisible = !!visible;
    if (gridVisible) {
        scene.add(gridHelper);
    } else {
        scene.remove(gridHelper);
    }
    return gridVisible;
}

function toggleGrid() {
    return setGridVisibility(!gridVisible);
}

window.addEventListener('keydown', (event) => {
    if (consoleState.open) return;

    if (event.key === 'm' || event.key === 'M') {
        if (!hasModePermission('tools.grid')) return;
        toggleGrid();
        return;
    }

    const tagName = event.target && event.target.tagName ? event.target.tagName : '';
    if (tagName === 'INPUT' || tagName === 'TEXTAREA') {
        return;
    }

    // Enter key combat shortcuts: confirm pending action → end turn
    if (event.key === 'Enter' && currentGameMode === GAME_MODE.COMBAT && modeManager.current !== MODE.DM) {
        event.preventDefault();
        if (combatInteraction.awaitingConfirm) {
            confirmAction();
        } else if (turnEndRequired) {
            confirmEndTurn();
        } else if (currentTurnPhase === TURN_PHASE.PLAYER) {
            endTurn();
        }
        return;
    }

    if (event.code === 'Equal' || event.code === 'NumpadAdd') {
        if (!hasModePermission('tools.colliderDebug')) return;
        setColliderDebugVisible(true);
        console.info('Collider debug enabled (+).');
        event.preventDefault();
        return;
    }

    if (event.code === 'Minus' || event.code === 'NumpadSubtract') {
        if (!hasModePermission('tools.colliderDebug')) return;
        setColliderDebugVisible(false);
        console.info('Collider debug disabled (-).');
        event.preventDefault();
    }
});

// Ambient light for soft fill
scene.add(new THREE.AmbientLight(0xffffff, 0.52));

// Gentle sky/ground fill to reduce overly dark shadow pockets.
scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x5a4a3a, 0.28));


// --- Load ONLY Everything GLTF Model ---
const loader = new GLTFLoader();

updateLoadingState('Checking world model availability...', 0.08);

fetch('/static/everything_.gltf', { method: 'HEAD' })
    .then(response => {
        if (!response.ok) {
            console.warn('everything_.gltf not found! Status:', response.status);
            updateLoadingState('World model missing, loading fallback state...', 0.96);
            finishLoadingOverlay('Loaded with missing world model');
            return;
        }

        updateLoadingState('Loading world model...', 0.14);

        loader.load('/static/everything_.gltf',
            (gltf) => {

                gltf.scene.traverse((child) => {
                    if (child.isMesh) {
                        child.frustumCulled = false;
                        child.material.side = THREE.DoubleSide;
                        child.visible = true;
                        child.castShadow = true;
                        child.receiveShadow = true;
                    }
                });

                gltf.scene.position.set(0, 0, 0);
                gltf.scene.scale.setScalar(WORLD_SCALE);
                scene.add(gltf.scene);
                worldEverythingRoot = gltf.scene;
                addWorldCollidersFromRoot(gltf.scene);
                enableWorldPhysics();
                syncWorldVisualsWithGameMode();

                let meshCount = 0;
                gltf.scene.traverse(obj => {
                    if (obj.isMesh) meshCount++;
                });

                // Spawn data-driven entity shells after static world is available.
                void initDataDrivenLayer(gltf.scene);

                // Load persisted scene/material state now that the model is in the scene.
                ensurePersistentMeshIds();
                fetch('/scene_state')
                    .then((r) => {
                        if (!r.ok) return null;
                        const contentType = r.headers.get('content-type') || '';
                        if (!contentType.includes('application/json')) return null;
                        return r.json();
                    })
                    .then((state) => {
                        if (state) hydrateWorld(state);
                        return fetch('/materials_state');
                    })
                    .then((r) => {
                        if (!r || !r.ok) return null;
                        const contentType = r.headers.get('content-type') || '';
                        if (!contentType.includes('application/json')) return null;
                        return r.json();
                    })
                    .then((materialsState) => {
                        if (materialsState) applyMaterialOverrides(materialsState);
                    })
                    .catch(err => console.warn('Could not load scene state:', err));

                // updateHierarchyMenu();
                updateLoadingState('World ready. Finalizing...', 0.98);
                finishLoadingOverlay('World loaded');
            },

            (xhr) => {
                if (xhr.lengthComputable) {
                    const percent = (xhr.loaded / xhr.total) * 100;
                    const modelProgress = Math.max(0, Math.min(1, xhr.loaded / Math.max(xhr.total, 1)));
                    const overallProgress = 0.14 + (modelProgress * 0.62);
                    updateLoadingState(`Loading world model... ${percent.toFixed(1)}%`, overallProgress);
                }
            },

            (error) => {
                enableWorldPhysics();
                console.error('Error loading everything_.gltf:', error);
                updateLoadingState('World model failed to load', 0.96);
                finishLoadingOverlay('Loaded with errors');
            }
        );
    })
    .catch(err => {
        console.warn('Error fetching everything_.gltf:', err);
        updateLoadingState('Error checking world model', 0.96);
        finishLoadingOverlay('Loaded with errors');
    });


// --- Save/Load Scene State ---

const {
    sanitizePersistToken,
    getMeshPersistentId,
    ensurePersistentMeshIds,
    getPersistableTextureMapUrl,
    serializeMaterial,
    emitMaterialChange,
    findMeshByPersistentId,
    findMeshByName,
    serializeObject,
    serializeScene,
    applyMaterialState,
    serializeMaterialOverrides,
    applyMaterialOverrides,
    applyStateToObject,
    applySceneState,
    addSaveLoadButtonsToInspector,
} = createScenePersistenceManager({
    THREE,
    scene,
    getSocket: () => socket,
    getMaterialTextureAnim,
    setMaterialTextureAnimAxis,
    serializeLight,
    applyStateToLight,
    createUserPointLight,
    isSceneReadyForWorldState,
    traceDmPipeline,
    setPendingSceneState: (state) => { pendingSceneState = state; },
    updateInspectorMenu,
    hydrateWorld,
    getInspectorMenu: () => inspectorMenu,
});

// Render loop
let lastTime = performance.now();
let lastFrameDeltaMs = 0;
let lastFrameSpikeLogAtMs = 0;
const FRAME_SPIKE_LOG_THRESHOLD_MS = 30;
function animate(nowMs) {
    // No need to force scene.background = null; skybox is now a mesh
    const now = Number.isFinite(nowMs) ? nowMs : performance.now();
    if ((now - lastFrameTimeMs) < frameIntervalMs) {
        return;
    }
    lastFrameTimeMs = now;
    processNetworkCombatTimeline(now);
    const inHitStop = now < combatHitStopUntil;
    const rawDelta = ((now - lastTime) / 1000);
    lastFrameDeltaMs = rawDelta * 1000;
    const delta = inHitStop ? (rawDelta * 0.24) : rawDelta;
    lastTime = now;

    syncSkyboxWithGameMode();
    updateClientRuntimeModeFromAuthority();

    const simulationOwner = isSimulationOwner();

    if (simulationOwner) {
        updateDeliberatePlayerMove(now);
    }

    updateFlyControls(delta);
    if (localPlayerAvatarRigState && typeof localPlayerAvatarRigState.update === 'function') {
        localPlayerAvatarRigState.update(delta, localPlayerAvatarMoveSpeed, {
            isAirborne: !playerState.onGround,
            verticalVelocity: playerState.velocity.y,
            isFlying: playerFlying,
        });
    }
    if (simulationOwner) {
        updateTrainingDummyIdleAnimations(delta);
    }
    if (playerRig) {
        coordsHud.textContent = `X: ${playerRig.position.x.toFixed(2)}  Y: ${playerRig.position.y.toFixed(2)}  Z: ${playerRig.position.z.toFixed(2)}`;
    }
    if (rawDelta > 0.00001) {
        const fpsInstant = Math.min(240, 1 / rawDelta);
        fpsSmoothed += (fpsInstant - fpsSmoothed) * 0.12;
        fpsHud.textContent = `FPS: ${Math.round(fpsSmoothed)}`;
    }

    if (activeRangeCircle) {
        activeRangeCircle.position.copy(playerState.position);
        activeRangeCircle.position.y += 0.05;
    }

    if (activeMovementCircle) {
        activeMovementCircle.position.copy(playerState.position);
        activeMovementCircle.position.y += 0.02;
        const baseFeet = Math.max(activeMovementCircle.userData.baseFeet || 30, 0.01);
        const radiusScale = Math.max(combatState.player.movementRemaining, 0.01) / baseFeet;
        activeMovementCircle.scale.set(radiusScale, radiusScale, 1);
    }

    // Smoothly lerp movement zone circles to player position
    if (moveZoneDisc && moveZoneTargetX !== null && moveZoneTargetZ !== null) {
        const lerpSpeed = 0.15; // Smooth lerp speed
        moveZoneDisc.position.x += (moveZoneTargetX - moveZoneDisc.position.x) * lerpSpeed;
        moveZoneDisc.position.z += (moveZoneTargetZ - moveZoneDisc.position.z) * lerpSpeed;
        if (moveZoneDisc.userData.targetY !== undefined) {
            moveZoneDisc.position.y += (moveZoneDisc.userData.targetY - moveZoneDisc.position.y) * lerpSpeed;
        }
    }
    if (moveZoneRing && moveZoneTargetX !== null && moveZoneTargetZ !== null) {
        const lerpSpeed = 0.15;
        moveZoneRing.position.x += (moveZoneTargetX - moveZoneRing.position.x) * lerpSpeed;
        moveZoneRing.position.z += (moveZoneTargetZ - moveZoneRing.position.z) * lerpSpeed;
        if (moveZoneDisc && moveZoneDisc.userData.targetY !== undefined) {
            moveZoneRing.position.y += (moveZoneDisc.userData.targetY + 0.005 - moveZoneRing.position.y) * lerpSpeed;
        }
    }

    // Make sky follow the camera if loaded
    if (window.skyMesh) {
        const activeView = getActiveViewCamera();
        activeView.getWorldPosition(activeViewWorldPos);
        window.skyMesh.position.copy(activeViewWorldPos);
    }

    // Send authoritative player actor transform at ~15Hz for multiplayer avatar updates.
    // DM is an observer only — never emits its own position as a player.
    if (socket && localPlayerId && modeManager.current !== MODE.DM && now - lastPlayerSyncAt > PLAYER_UPDATE_MIN_INTERVAL_MS) {
        const actorPos = playerState && playerState.position ? playerState.position : (playerRig ? playerRig.position : null);
        if (!actorPos) {
            lastPlayerSyncAt = now;
            return;
        }
        localPlayerWorldPos.set(
            Number(actorPos.x) || 0,
            Number(actorPos.y) || 0,
            Number(actorPos.z) || 0,
        );
        const actorYaw = (playerRig && Number.isFinite(playerRig.rotation?.y))
            ? Number(playerRig.rotation.y)
            : (Number.isFinite(yaw) ? Number(yaw) : 0);

        let movementCursor = null;
        const selectedMoveCursor = (
            combatInteraction.awaitingConfirm &&
            combatInteraction.action === 'move' &&
            combatInteraction.target &&
            Number.isFinite(combatInteraction.target.x) &&
            Number.isFinite(combatInteraction.target.z)
        )
            ? combatInteraction.target
            : null;

        if (selectedMoveCursor) {
            movementCursor = {
                x: Number(selectedMoveCursor.x) || 0,
                y: Number(selectedMoveCursor.y) || Number(playerState.position.y) || 0,
                z: Number(selectedMoveCursor.z) || 0,
                kind: 'selected',
            };
        } else if (hoveredMoveWorldPos && Number.isFinite(hoveredMoveWorldPos.x) && Number.isFinite(hoveredMoveWorldPos.z)) {
            movementCursor = {
                x: Number(hoveredMoveWorldPos.x) || 0,
                y: Number(playerState.position.y) || 0,
                z: Number(hoveredMoveWorldPos.z) || 0,
                kind: 'hover',
            };
        }

        const shouldShowMoveZone =
            currentGameMode === GAME_MODE.COMBAT &&
            (isPlayerInputTurn() || currentAction === 'move' || !!moveZoneDisc || !!movementCursor);

        const movementPreview = shouldShowMoveZone
            ? {
                showZone: true,
                movementRemaining: Math.max(0, Number(combatState.player?.movementRemaining) || 0),
                cursor: movementCursor,
            }
            : null;
        const includeHeavySync = (now - lastHeavyPlayerSyncAt) >= PLAYER_HEAVY_SYNC_INTERVAL_MS;
        const includeCombatSync = currentGameMode === GAME_MODE.COMBAT
            && (includeHeavySync || (now - lastCombatSyncAt) >= PLAYER_COMBAT_SYNC_INTERVAL_MS);
    // Avatar bone caching to avoid full traverse every sync
    if (!window.avatarBoneCacheMap) {
        window.avatarBoneCacheMap = new Map();
    }
    
    // Extract avatar pose (bone quaternions) if avatar is loaded
    let avatarData = null;
    if (includeHeavySync && localPlayerAvatarRoot && localPlayerAvatarRigState) {
        let boneCache = window.avatarBoneCacheMap.get(localPlayerAvatarRoot);
        
        // Rebuild cache if first time or avatar changed
        if (!boneCache || boneCache.avatarVersion !== localPlayerAvatarRoot.userData.modelUrl) {
            boneCache = { avatarVersion: localPlayerAvatarRoot.userData.modelUrl, bones: [] };
            localPlayerAvatarRoot.traverse((bone) => {
                if (bone.isBone || (bone.userData && bone.userData.boneType)) {
                    boneCache.bones.push(bone);
                }
            });
            window.avatarBoneCacheMap.set(localPlayerAvatarRoot, boneCache);
        }
        
        // Only extract poses from cached bones, don't traverse
        const bonePoses = {};
        for (let i = 0; i < boneCache.bones.length; i++) {
            const bone = boneCache.bones[i];
            const boneName = bone.name || `bone_${i}`;
            bonePoses[boneName] = {
                q: [bone.quaternion.x, bone.quaternion.y, bone.quaternion.z, bone.quaternion.w],
                p: [bone.position.x, bone.position.y, bone.position.z],
            };
        }
        
        avatarData = {
            modelUrl: localPlayerAvatarRoot.userData.modelUrl || 'fallback',
            bonePoses: bonePoses,
            scale: localPlayerAvatarRoot.scale.x,
        };
    }
        
        const playerUpdatePayload = {
            position: {
                x: localPlayerWorldPos.x,
                y: localPlayerWorldPos.y,
                z: localPlayerWorldPos.z,
            },
            rotation: {
                x: 0,
                y: actorYaw,
                z: 0,
            },
            movementPreview,
        };
        if (avatarData) {
            playerUpdatePayload.avatar = avatarData;
        }
        if (includeCombatSync) {
            playerUpdatePayload.combatSync = buildLiveCombatSyncPayload();
        }
        _netStats.playerUpdatesOut += 1;
        if (_netStats.playerUpdatesOut % 120 === 0) {
            netLog(`player-update OUT  out#=${_netStats.playerUpdatesOut}  pos=(${localPlayerWorldPos.x.toFixed(2)}, ${localPlayerWorldPos.y.toFixed(2)}, ${localPlayerWorldPos.z.toFixed(2)})`);
        }
        // Debug first few updates without dumping full bone pose payloads.
        if (_netStats.playerUpdatesOut <= 3) {
            const poseCount = avatarData && avatarData.bonePoses ? Object.keys(avatarData.bonePoses).length : 0;
            console.log(`[PLAYER] Emitting player-update #${_netStats.playerUpdatesOut}`, {
                position: playerUpdatePayload.position,
                rotation: playerUpdatePayload.rotation,
                hasAvatar: !!avatarData,
                boneCount: poseCount,
            });
        }
        socket.emit('player-update', playerUpdatePayload);
        lastPlayerSyncAt = now;
        if (includeHeavySync) {
            lastHeavyPlayerSyncAt = now;
        }
        if (includeCombatSync) {
            lastCombatSyncAt = now;
        }
    }

    animateSceneTextures(delta);
    updateWorldDmSetpiece(dmWorldSetpiece, now * 0.001);

    updateXRHandRays();

    // Update pulsing emissive effect on selected movement tile
    if (combatInteraction.target && combatInteraction.target.userData && combatInteraction.target.userData.pulsingTile) {
        const tile = combatInteraction.target;
        if (tile.material && tile.material.emissive) {
            const pulse = Math.sin(now * 0.015) * 0.5 + 0.5; // Oscillates 0-1, faster pulse
            const emissiveIntensity = 2.0 + (pulse * 1.5); // Oscillates 2.0-3.5, much more intense
            tile.material.emissiveIntensity = emissiveIntensity;
        }
    }

    // Update end-turn prompt visibility in real-time
    if (simulationOwner && currentGameMode === GAME_MODE.COMBAT && currentTurnPhase === TURN_PHASE.PLAYER) {
        syncTurnExhaustionState();
        hideEndTurnPrompt();
    } else {
        hideEndTurnPrompt();
    }

    // Maintain movement cursor every frame during player input turn
    if (isPlayerInputTurn() && canPlayerMove()) {
        if (!moveZoneDisc || !moveZoneDisc.parent) {
            rebuildCombatMoveTiles();
        }
    }

    // Spread burst allocation over frames to avoid single-frame hitches.
    processQueuedCombatParticleBursts();

    // Tick combat burst particles
    for (let i = combatParticles.length - 1; i >= 0; i--) {
        const p = combatParticles[i];
        p.position.add(p.userData.velocity);
        p.userData.velocity.y -= 0.0026; // gentler gravity for more hang-time
        p.userData.life -= (0.014 * Math.max(0.7, delta * 60));
        p.scale.setScalar(Math.max(p.userData.life, 0));
        if (p.material && typeof p.material.opacity === 'number') {
            p.material.opacity = Math.max(0, Math.min(1, p.userData.life));
        }
        if (p.userData.life <= 0) {
            scene.remove(p);
            p.visible = false;
            p.userData.velocity.set(0, 0, 0);
            p.userData.life = 0;
            if (combatParticlePool.length < combatParticlePoolMax) {
                combatParticlePool.push(p);
            } else if (p.material) {
                // Fallback cleanup if pool is full.
                p.material.dispose();
            }
            combatParticles.splice(i, 1);
        }
    }

    updateScreenShake(delta);
    updateCombatMusicTheme();
    processCombatSfxQueue();
    
    // Update enemy FOV visuals during combat
    if (currentGameMode === GAME_MODE.COMBAT) {
        for (const dummy of trainingDummies) {
            if (dummy.userData.fovMesh) {
                dummy.userData.fovMesh.visible = true;
                // Slightly pulse the opacity for visual interest
                const pulse = 0.02 + Math.sin(now * 0.003) * 0.015;
                dummy.userData.fovMesh.material.opacity = 0.08 + pulse;
            }
        }
    } else {
        // Hide FOV meshes outside of combat
        for (const dummy of trainingDummies) {
            if (dummy.userData.fovMesh) {
                dummy.userData.fovMesh.visible = false;
            }
        }
    }
    
    updateAllEnemyHealthBars();
    updateAllPlayerHeadHealthBars();
    updateEnemyFlinches(delta * 1000);
    updateDmPlacementCamera();
    updateGodContextMenu();

    // Pulse target selection ring
    if (combatInteraction.target && combatInteraction.target.userData && combatInteraction.target.userData.selectionRing) {
        const ring = combatInteraction.target.userData.selectionRing;
        ring.material.opacity = 0.55 + Math.sin(now * 0.007) * 0.35;
        ring.rotation.z += 0.018;
    }

    updateDmObserverCamera(delta);
    updateCombatUI();
    updateDmControlPanel();
    updateDmTimelineUI();
    syncDicePassCamera();
    const activeView = getActiveViewCamera();
    renderWorldWithDmInset(activeView);
    renderer.clearDepth();
    renderer.render(diceScene, dicePassCamera);
}
renderer.setAnimationLoop(animate);






