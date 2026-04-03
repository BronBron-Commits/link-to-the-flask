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
const serverEntityNetworkIds = new Set();

const CLIENT_RESUME_STORAGE_KEY = 'map3d_resume_key_v1';

function getOrCreateClientResumeKey() {
    const fallback = `anon-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    try {
        const existing = String(localStorage.getItem(CLIENT_RESUME_STORAGE_KEY) || '').trim();
        if (existing) return existing;
        const generated = (window.crypto && typeof window.crypto.randomUUID === 'function')
            ? window.crypto.randomUUID()
            : fallback;
        localStorage.setItem(CLIENT_RESUME_STORAGE_KEY, generated);
        return generated;
    } catch (_err) {
        return fallback;
    }
}

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
    const normalized = String(mode || '').toLowerCase();
    if (normalized === 'dm') return 'dm';
    if (normalized === 'dev') return 'dev';
    return 'player';
}

function registerRoleWithServer() {
    if (!socket) return;
    socket.emit('register-role', {
        role: getNetworkRoleFromMode(modeManager.current),
    });
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
let backgroundThrottled = (document.hidden === true);
const BACKGROUND_TAB_MAX_FPS = 5;
const BACKGROUND_TAB_MAX_RENDER_SCALE = 0.4;
const CLIENT_MODE_FULL = 'full';
const CLIENT_MODE_OBSERVER = 'observer';
const OBSERVER_RENDER_SCALE_MAX = 0.5;
const OBSERVER_MAX_FPS = 30;
let CLIENT_MODE = CLIENT_MODE_FULL;
let forceObserverMode = false;

function isPrimaryClient() {
    return !backgroundThrottled;
}

function isObserverClient() {
    return CLIENT_MODE === CLIENT_MODE_OBSERVER;
}

function applySettings() {
    const configuredMaxFPS = Number(SETTINGS.maxFPS) || 60;
    const baseMaxFPS = isPrimaryClient()
        ? Math.max(10, configuredMaxFPS)
        : Math.min(Math.max(1, configuredMaxFPS), BACKGROUND_TAB_MAX_FPS);
    const effectiveMaxFPS = isObserverClient()
        ? Math.min(baseMaxFPS, OBSERVER_MAX_FPS)
        : baseMaxFPS;
    frameIntervalMs = 1000 / effectiveMaxFPS;
    combatParticlesEnabled = !!SETTINGS.particles && isPrimaryClient() && !isObserverClient();
    updateCombatParticleBudget();

    if (!rendererReady) return;

    const dpr = window.devicePixelRatio || 1;
    const configuredScale = Math.max(0.35, Math.min(1.0, Number(SETTINGS.renderScale) || 1));
    const primaryScale = isPrimaryClient()
        ? configuredScale
        : Math.min(configuredScale, BACKGROUND_TAB_MAX_RENDER_SCALE);
    const scale = isObserverClient()
        ? Math.min(primaryScale, OBSERVER_RENDER_SCALE_MAX)
        : primaryScale;
    renderer.setPixelRatio(dpr * scale);
    renderer.shadowMap.enabled = !!SETTINGS.shadows && isPrimaryClient() && !isObserverClient();
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
    if (document.hidden) {
        focusedMaxFPS = Number(SETTINGS.maxFPS) || focusedMaxFPS;
        focusedParticlesEnabled = !!SETTINGS.particles;
        focusedRenderScale = Math.max(0.35, Math.min(1.0, Number(SETTINGS.renderScale) || focusedRenderScale));

        backgroundThrottled = true;
        SETTINGS.maxFPS = Math.min(focusedMaxFPS, BACKGROUND_TAB_MAX_FPS);
        SETTINGS.particles = false;
        SETTINGS.renderScale = Math.min(focusedRenderScale, BACKGROUND_TAB_MAX_RENDER_SCALE);
    } else {
        backgroundThrottled = false;
        SETTINGS.maxFPS = focusedMaxFPS;
        SETTINGS.particles = focusedParticlesEnabled;
        SETTINGS.renderScale = focusedRenderScale;
    }
    applySettings();
});

function requestStartGame() {
    if (!socket) {
        appendConsoleHistory('Cannot start game: no server connection', 'error');
        return;
    }
    socket.emit('start-game');
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

function startLocalSimulation() {
    simulationAuthority = SIMULATION_AUTHORITY.LOCAL_DM;
    dmAuthorityLayer = DM_AUTHORITY_LAYER.SIMULATOR;
    if (currentGameMode === GAME_MODE.COMBAT) {
        beginLocalCombatTimeline();
    }
    return true;
}

function setSimulationAuthority(authority) {
    const normalized = String(authority || '').toLowerCase();
    if (!Object.values(SIMULATION_AUTHORITY).includes(normalized)) return false;
    simulationAuthority = normalized;
    if (simulationAuthority === SIMULATION_AUTHORITY.LOCAL_DM && currentGameMode === GAME_MODE.COMBAT) {
        beginLocalCombatTimeline();
    }
    return true;
}

function getDmCapabilities() {
    const layer = Object.values(DM_AUTHORITY_LAYER).includes(dmAuthorityLayer)
        ? dmAuthorityLayer
        : DM_AUTHORITY_LAYER.OBSERVER;
    return DM_CAPABILITY_PRESETS[layer] || DM_CAPABILITY_PRESETS[DM_AUTHORITY_LAYER.OBSERVER];
}

function syncDmAuthorityLayerFromState() {
    if (simulationAuthority === SIMULATION_AUTHORITY.LOCAL_DM) {
        dmAuthorityLayer = DM_AUTHORITY_LAYER.SIMULATOR;
        return dmAuthorityLayer;
    }
    if (dmAuthorityLayer === DM_AUTHORITY_LAYER.SIMULATOR) {
        dmAuthorityLayer = DM_AUTHORITY_LAYER.OBSERVER;
    }
    if (getControlledActor() && dmAuthorityLayer === DM_AUTHORITY_LAYER.OBSERVER) {
        dmAuthorityLayer = DM_AUTHORITY_LAYER.PUPPETEER;
    }
    if (!Object.values(DM_AUTHORITY_LAYER).includes(dmAuthorityLayer)) {
        dmAuthorityLayer = DM_AUTHORITY_LAYER.OBSERVER;
    }
    return dmAuthorityLayer;
}

function setDmAuthorityLayer(nextLayer) {
    const normalized = String(nextLayer || '').toLowerCase();
    if (!Object.values(DM_AUTHORITY_LAYER).includes(normalized)) return false;
    dmAuthorityLayer = normalized;
    if (normalized === DM_AUTHORITY_LAYER.SIMULATOR) {
        setSimulationAuthority(SIMULATION_AUTHORITY.LOCAL_DM);
    } else {
        setSimulationAuthority(SIMULATION_AUTHORITY.SERVER);
        if (normalized === DM_AUTHORITY_LAYER.OBSERVER) {
            releasePossession();
        }
    }
    return true;
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
        void replayRemoteCombatActionRecord(queued.record, {
            offsetMs: lateMs,
            instant: !isOwner,
            allowAsyncPresentation: false,
        });
        processed += 1;
    }
}

function emitCombatActionRecord(actionRecord) {
    if (!socket || !actionRecord) return;
    beginLocalCombatTimeline();
    socket.emit('combat-action-record', {
        record: cloneJsonSafe(actionRecord),
        startTimeMs: Date.now(),
        timelineId: localCombatTimelineId || activeNetworkCombatTimeline?.id || null,
    });
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

function extractSceneStateFromWorldPayload(payload) {
    if (!payload || typeof payload !== 'object') return null;
    if (payload.scene && typeof payload.scene === 'object') return payload.scene;
    if (payload.objects) {
        return {
            objects: payload.objects,
            lights: payload.lights || {},
        };
    }
    return null;
}

function updateSceneVisibilityForCombatState(inCombat) {
    // Cache combat-hide candidates to avoid traversing the full scene every update.
    if (!isSceneReadyForWorldState()) return;

    const COMBAT_HIDE_LIST_REFRESH_MS = 5000;
    if (!Array.isArray(updateSceneVisibilityForCombatState._cached)) {
        updateSceneVisibilityForCombatState._cached = [];
        updateSceneVisibilityForCombatState._cachedAt = 0;
    }

    const nowMs = performance.now();
    const cacheExpired = (nowMs - (updateSceneVisibilityForCombatState._cachedAt || 0)) > COMBAT_HIDE_LIST_REFRESH_MS;
    if (cacheExpired || updateSceneVisibilityForCombatState._cached.length === 0) {
        const next = [];
        scene.traverse((obj) => {
            if (!obj || !obj.userData) return;

            const objectType = String(obj.userData.type || '').toLowerCase();
            const isFurniture = objectType === 'furniture' || objectType === 'prop' || objectType === 'decoration' || objectType === 'decor';

            const meshName = String(obj.name || '').toLowerCase();
            const hasMatchingName = meshName.includes('furniture') || meshName.includes('prop') || meshName.includes('decor') || meshName.includes('glb');

            const shouldHideInCombat = isFurniture || (hasMatchingName && !meshName.includes('player') && !meshName.includes('enemy'));
            if (shouldHideInCombat) {
                next.push(obj);
            }
        });
        updateSceneVisibilityForCombatState._cached = next;
        updateSceneVisibilityForCombatState._cachedAt = nowMs;
    }

    updateSceneVisibilityForCombatState._cached.forEach((obj) => {
        if (!obj || !obj.userData || !obj.parent) return;

        if (inCombat && obj.visible) {
            obj.userData.wasVisibleBeforeCombat = true;
            obj.visible = false;
            netLog(`[COMBAT] Hiding furniture: ${obj.name || obj.userData.id || obj.type}`);
        } else if (!inCombat && !obj.visible && (obj.userData.wasVisibleBeforeCombat !== false)) {
            obj.visible = true;
            delete obj.userData.wasVisibleBeforeCombat;
            netLog(`[COMBAT] Showing furniture: ${obj.name || obj.userData.id || obj.type}`);
        }
    });
}

function hydrateWorld(payload) {
    if (!payload || typeof payload !== 'object') return;

    serverEntityNetworkIds.clear();
    if (payload.entities && typeof payload.entities === 'object') {
        Object.entries(payload.entities).forEach(([entityId, entity]) => {
            if (!entity || typeof entity !== 'object') return;
            const networkId = String(entity.networkId || entityId || '').trim();
            if (networkId) serverEntityNetworkIds.add(networkId);
        });
    }

    if (payload.session && typeof payload.session === 'object') {
        sessionGameState = String(payload.session.gameState || sessionGameState || 'lobby');
        if (typeof payload.session.authoritativePlayerId === 'string') {
            authoritativePlayerId = payload.session.authoritativePlayerId;
            updateClientRuntimeModeFromAuthority();
        }
    }

    const sceneState = extractSceneStateFromWorldPayload(payload);
    if (!isSceneReadyForWorldState()) {
        pendingWorldHydrationPayload = payload;
        if (sceneState && sceneState.objects) {
            pendingSceneState = sceneState;
        }
        traceDmPipeline('WORLD HYDRATE QUEUED', {
            hasSceneState: !!(sceneState && sceneState.objects),
        });
        return;
    }

    if (sceneState && sceneState.objects) {
        applySceneState(sceneState);
    }

    // Authoritative combat mode source is payload.mode only.
    const modeRaw = String(payload.mode || '').toLowerCase();
    const modeFromWorld = modeRaw === 'combat' ? GAME_MODE.COMBAT : (modeRaw === 'exploration' ? GAME_MODE.FREE : null);
    const shouldBeInCombat = modeFromWorld === GAME_MODE.COMBAT
        ? true
        : (modeFromWorld === GAME_MODE.FREE ? false : !!combatState.inCombat);
    combatState.inCombat = shouldBeInCombat;
    if (shouldBeInCombat) {
        ensureCombatEnvironmentPresentation();
    }
    if (!shouldBeInCombat && currentGameMode === GAME_MODE.COMBAT) {
        currentGameMode = GAME_MODE.FREE;
        currentTurnPhase = TURN_PHASE.IDLE;
        combatState.phase = 'TRANSITION';
        setCombatLock(false);
        setCombatTimelineBusy(false);
        clearCombatMoveTiles();
        deactivateCombatCamera();
    }
    updateSceneVisibilityForCombatState(shouldBeInCombat);

    if (payload.players && typeof payload.players === 'object') {
        const players = payload.players;
        const seenIds = new Set();
        Object.values(players).forEach((player) => {
            if (!player || !player.id) return;
            seenIds.add(String(player.id));
            upsertPlayerAvatar(player);
        });

        if (scene.userData && scene.userData.playerAvatars) {
            const effectiveLocalId = (socket && socket.id) ? socket.id : localPlayerId;
            Object.keys(scene.userData.playerAvatars).forEach((id) => {
                if (id === effectiveLocalId) return;
                if (!seenIds.has(String(id))) {
                    removePlayerAvatar(id);
                }
            });
        }
    }
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
    if (!socket) return;

    socket.on('connect', () => {
        // socket.id is the canonical local identity for this client connection.
        localPlayerId = socket.id || localPlayerId;
        netLog(`connected  sid=${socket.id}  mode=${modeManager.current}  transport=${socket.io?.engine?.transport?.name ?? '?'}`);
        appendConsoleHistory(`[NET] connected as ${modeManager.current} (${socket.id})`, 'ok');
        // CRITICAL: Always push selected role on connect/reconnect so server lobby slots stay consistent.
        registerRoleWithServer();
        // Ensure role registration happens even in tight timing scenarios
        setTimeout(() => {
            if (modeManager.current && socket) {
                registerRoleWithServer();
            }
        }, 100);
        updateClientRuntimeModeFromAuthority();
    });

    socket.on('connect_error', (err) => {
        netWarn('connect_error', err && err.message ? err.message : err);
        appendConsoleHistory(`[NET] connection error: ${err && err.message ? err.message : String(err)}`, 'error');
        if (socket && socket.disconnected) {
            try {
                socket.connect();
            } catch (_reconnectErr) {
                // Socket.IO already handles internal backoff; this is best-effort nudging.
            }
        }
    });

    socket.on('disconnect', (reason) => {
        _netStats.disconnects += 1;
        netWarn(`disconnected  reason=${reason}  total=${_netStats.disconnects}`);
        appendConsoleHistory(`[NET] disconnected: ${reason}`, 'error');
    });

    socket.on('reconnect_attempt', (attempt) => {
        netLog(`reconnect attempt #${attempt}`);
    });

    socket.on('player-id', (data) => {
        if (data && data.id) {
            if (socket && socket.id && socket.id !== data.id) {
                netWarn(`player-id mismatch: socket.id=${socket.id} serverId=${data.id}`);
            }
            localPlayerId = data.id;
            netLog(`assigned player-id=${data.id}`);
            updateClientRuntimeModeFromAuthority();
        }
    });

    socket.on('world-init', (world) => {
        netLog('world-init received');
        hydrateWorld(world);
    });

    socket.on('world-update', (world) => {
        hydrateWorld(world);
    });

    socket.on('combat-state', (packet) => {
        const packetMode = String(packet && packet.mode ? packet.mode : '').toLowerCase();
        const inCombat = packetMode
            ? packetMode === 'combat'
            : !!(packet && packet.active);
        const packetInitiatorSid = String(packet && packet.initiator ? packet.initiator : '').trim() || null;
        console.log('[NET] combat-state received', {
            active: inCombat,
            mode: packet && packet.mode,
            initiator: packet && packet.initiator,
        });
        if (inCombat) {
            combatInitiatorSid = packetInitiatorSid || combatInitiatorSid;
            if (packetInitiatorSid) {
                const resolvedInitiatorActorId = resolveCombatActorIdForPlayerSid(packetInitiatorSid);
                if (resolvedInitiatorActorId) {
                    combatInitiatorActorId = resolvedInitiatorActorId;
                }
            }
            combatState.inCombat = true;
            if (currentGameMode !== GAME_MODE.COMBAT) {
                currentGameMode = GAME_MODE.COMBAT;
                setCombatPhase('PLAYER');
                setCombatLock(false);
            }
            const targetId = packet && packet.targetId ? String(packet.targetId) : '';
            const targetActor = targetId ? findCombatActorById(targetId) : null;
            ensureCombatEnvironmentPresentation({ targetActor });
            syncCombatMusicToGameMode();
        } else {
            combatInitiatorSid = null;
            combatInitiatorActorId = null;
            combatState.inCombat = false;
            if (currentGameMode === GAME_MODE.COMBAT) {
                currentGameMode = GAME_MODE.FREE;
                currentTurnPhase = TURN_PHASE.IDLE;
                combatState.phase = 'TRANSITION';
                setCombatLock(false);
                setCombatTimelineBusy(false);
                clearCombatMoveTiles();
                deactivateCombatCamera();
            }
            syncCombatMusicToGameMode();
        }
        syncSkyboxWithGameMode();
        updateSceneVisibilityForCombatState(inCombat);
        updateActionMenu();
        updateLobbyOverlayFromState();
    });

    socket.on('players-state', (players) => {
        if (!players) return;
        const ids = Object.keys(players);
        netLog(`players-state  count=${ids.length}  ids=[${ids.join(', ')}]`);
        Object.values(players).forEach((player) => {
            if (player && player.role === 'player' && player.combatSync) {
                applyLiveCombatSyncFromPlayer(player.id, player.combatSync);
            }
            upsertPlayerAvatar(player);
        });
    });

    socket.on('player-joined', (player) => {
        netLog(`player-joined  id=${player && player.id}  role=${player && player.role}`);
        appendConsoleHistory(`[NET] player joined: ${player && player.id}`, 'ok');
        if (player && player.role === 'player' && player.combatSync) {
            applyLiveCombatSyncFromPlayer(player.id, player.combatSync);
        }
        upsertPlayerAvatar(player);
    });

    socket.on('player-update', (player) => {
        _netStats.playerUpdatesIn += 1;
        if (_netStats.playerUpdatesIn % 120 === 0) {
            // Log every 120th update (~once every 8 s at 15 Hz) to avoid console spam.
            netLog(`player-update  id=${player && player.id}  in#=${_netStats.playerUpdatesIn}`);
        }
        if (player && player.role === 'player' && player.combatSync) {
            applyLiveCombatSyncFromPlayer(player.id, player.combatSync);
        }
        upsertPlayerAvatar(player);
    });

    socket.on('player-left', (data) => {
        netLog(`player-left  id=${data && data.id}`);
        if (data && data.id) {
            appendConsoleHistory(`[NET] player left: ${data.id}`, 'ok');
            removePlayerAvatar(data.id);
        }
    });

    socket.on('combat-start-request', (packet) => {
        if (modeManager.current !== MODE.DM || !socket) return;
        if (!packet || typeof packet !== 'object') return;
        const requestId = String(packet.requestId || '').trim();
        if (!requestId) return;
        const targetId = String(packet.targetId || '').trim();
        const requester = String(packet.from || '').trim();
        const target = targetId ? findCombatActorById(targetId) : null;
        const targetLabel = target ? getCombatActorLabel(target) : (targetId || 'unknown target');
        const approve = window.confirm(`Combat request from ${requester ? requester.slice(0, 6) : 'player'} for ${targetLabel}. Approve?`);
        socket.emit('combat-start-decision', {
            requestId,
            approved: approve,
        });
        addDmEvent(`Combat request ${approve ? 'approved' : 'rejected'}: ${targetLabel}`, approve ? 'ok' : 'system');
    });

    socket.on('combat-start-result', (packet) => {
        if (!packet || typeof packet !== 'object') return;
        const requestId = String(packet.requestId || '').trim();
        const approved = packet.approved === true;
        const status = String(packet.status || '').toLowerCase();
        const targetId = String(packet.targetId || '').trim();

        if (status === 'pending') {
            notifyPendingDmApproval('combat', targetId || 'target');
            return;
        }

        if (!pendingCombatStartRequest || pendingCombatStartRequest.requestId !== requestId) return;
        if (!approved) {
            pendingCombatStartRequest = null;
            showFloatingText('Combat request rejected by DM', '#ff8a8a', true);
            appendConsoleHistory('Combat request rejected by DM', 'error');
            return;
        }

        const target = targetId ? findCombatActorById(targetId) : null;
        if (target) {
            tryEnterCombat(target, {
                bypassDmApproval: true,
                skipNetworkEmit: true,
            });
        }
        pendingCombatStartRequest = null;
    });

    socket.on('scene-update', (data) => {
        _netStats.sceneUpdatesIn += 1;
        netLog(`scene-update  type=${data && data.type}  in#=${_netStats.sceneUpdatesIn}`);
        if (data.type === 'material') {
            const mesh = findMeshByName(data.name);
            if (!mesh) return;
            if (Array.isArray(mesh.material)) {
                applyMaterialState(mesh.material[data.materialIndex], data.materialState, mesh);
            } else {
                applyMaterialState(mesh.material, data.materialState, mesh);
            }
            return;
        }
        // Apply incoming scene update (e.g., object positions)
        if (data && data.objects) {
            applySceneState(data);
        }
    });

    socket.on('scene-state', (data) => {
        const objCount = data && Array.isArray(data.objects) ? data.objects.length : 0;
        netLog(`scene-state (initial)  objects=${objCount}`);
        // Initial full scene state — always apply on connect.
        if (data && data.objects) {
            applySceneState(data);
        }
    });

    socket.on('dm-command', (packet) => {
        _netStats.dmCommandsIn += 1;
        netLog(`dm-command IN  type=${packet && packet.command && packet.command.type}  from=${packet && packet.from}  in#=${_netStats.dmCommandsIn}`);
        traceDmPipeline('RECEIVED DM COMMAND', packet);
        applyDmCommandFromServer(packet);
    });

    socket.on('dm-command-denied', (info) => {
        const reason = info && info.reason ? String(info.reason) : 'denied';
        netWarn(`dm-command-denied  reason=${reason}`);
        appendConsoleHistory(`DM command denied: ${reason}`, 'error');
    });

    socket.on('timeline-start', (packet) => {
        if (!packet || typeof packet !== 'object') return;
        alignNetworkCombatTimeline(packet);
    });

    socket.on('combat-action-record', (packet) => {
        const record = packet && packet.record ? packet.record : null;
        if (!record) return;
        const startTimeMs = Number(packet && packet.startTimeMs);

        // Keep action history aligned across clients and replay remotely for observers.
        recordCombatAction(record, { broadcast: false, replayRemote: false });

        if (modeManager.current === MODE.DM || isDmObserverMode()) {
            const attackType = String(record.attackType || record.type || 'action').toUpperCase();
            const actor = getCombatActorLabelById(record.actorId);
            const target = getCombatActorLabelById(record.targetId);
            const result = String(record.result || 'pending').toUpperCase();
            const dmg = Number.isFinite(Number(record.damage)) ? Number(record.damage) : null;
            const dmgText = dmg !== null ? ` DMG ${dmg}` : '';
            addDmEvent(`${attackType}: ${actor} -> ${target} ${result}${dmgText}`, result === 'HIT' ? 'hit' : result === 'MISS' ? 'miss' : 'system');
            queueNetworkCombatAction(record, startTimeMs);
        }
    });

    // ── Server-authoritative turn state ────────────────────────────────────────
    socket.on('combat-turn', (packet) => {
        console.log('[COMBAT-TURN] received', {
            turnIndex: packet && packet.turnIndex,
            actor: packet && packet.currentActor && packet.currentActor.id,
            type: packet && packet.currentActor && packet.currentActor.type,
            round: packet && packet.roundNumber,
        });
        if (!packet || typeof packet !== 'object') return;
        endTurnPending = false;
        if (endTurnWatchdog) {
            clearTimeout(endTurnWatchdog);
            endTurnWatchdog = null;
        }
        const order = Array.isArray(packet.order) ? packet.order : [];
        const turnIndex = Math.max(0, Math.min(Number(packet.turnIndex) || 0, order.length > 0 ? order.length - 1 : 0));
        const roundNumber = Math.max(1, Number(packet.roundNumber) || 1);
        const currentActor = packet.currentActor || (order[turnIndex] ?? null);

        // Hard-overwrite local turn state with server authority — no merging.
        combatState.turnQueue = order;
        combatState.currentTurnIndex = turnIndex;
        combatState.turnIndex = turnIndex;
        combatState.roundNumber = roundNumber;
        combatState.turnOrder = order.map((entry) => {
            if (!entry) return null;
            if (entry.type === 'player') {
                return isLocalPlayerTurnEntry(entry) ? playerState : findCombatActorById(entry.id);
            }
            return findCombatActorById(entry.id)?.userData;
        }).filter(Boolean);

        if (currentGameMode === GAME_MODE.COMBAT && currentActor) {
            dispatchCombatTurnActor(currentActor);
        }
        updateCombatUI();
        updateDmControlPanel();
    });

    socket.on('combat-full-state', (packet) => {
        if (!packet || typeof packet !== 'object') return;
        const order = Array.isArray(packet.order) ? packet.order : [];
        const turn = Number(packet.turn) || 0;
        const turnIndex = order.length > 0 ? Math.max(0, Math.min(turn, order.length - 1)) : 0;
        const roundNumber = Math.max(1, Number((packet.state || {}).roundNumber) || 1);

        combatState.turnQueue = order;
        combatState.currentTurnIndex = turnIndex;
        combatState.turnIndex = turnIndex;
        combatState.roundNumber = roundNumber;
        combatState.turnOrder = order.map((entry) => {
            if (!entry) return null;
            if (entry.type === 'player') {
                return isLocalPlayerTurnEntry(entry) ? playerState : findCombatActorById(entry.id);
            }
            return findCombatActorById(entry.id)?.userData;
        }).filter(Boolean);

        updateCombatUI();
        updateDmControlPanel();
    });

    socket.on('combat-reset', () => {
        endTurnPending = false;
        if (endTurnWatchdog) {
            clearTimeout(endTurnWatchdog);
            endTurnWatchdog = null;
        }
        combatState.turnQueue = [];
        combatState.turnOrder = [];
        combatState.currentTurnIndex = 0;
        combatState.turnIndex = 0;
        combatState.roundNumber = 0;
        combatState.phase = 'TRANSITION';
        updateCombatUI();
        updateDmControlPanel();
    });

    socket.on('end-turn-denied', (packet) => {
        endTurnPending = false;
        if (endTurnWatchdog) {
            clearTimeout(endTurnWatchdog);
            endTurnWatchdog = null;
        }
        const reason = String((packet && packet.reason) || 'unknown');
        console.warn('[COMBAT] end-turn denied by server:', reason);
    });

    socket.on('combat-error', (packet) => {
        endTurnPending = false;
        if (endTurnWatchdog) {
            clearTimeout(endTurnWatchdog);
            endTurnWatchdog = null;
        }
        const reason = String((packet && packet.reason) || 'unknown');
        console.warn('[COMBAT] combat-error from server:', reason, packet);
    });

    socket.on('end-turn-accepted', (packet) => {
        const reason = String((packet && packet.reason) || 'received');
        console.log('[COMBAT] end-turn accepted by server:', reason);
    });

    socket.on('combat-action-result', (packet) => {
        if (!packet || typeof packet !== 'object') return;
        const attacker = String(packet.attacker || 'Unknown');
        const actorType = String(packet.actorType || 'unknown');
        const isHit = Boolean(packet.hit);
        const damage = Number(packet.damage) || 0;
        const targetId = String(packet.targetId || '');
        const hitRoll = Number(packet.hitRoll) || 0;
        const toHit = Number(packet.toHit) || 0;
        const targetAC = Number(packet.targetAC) || 0;

        if (actorType === 'enemy') {
            const atkBonus = Number(packet.attackBonus) || 0;
            const rollDetail = `(${hitRoll}+${atkBonus}=${toHit} vs AC ${targetAC})`;
            const logText = isHit
                ? `${attacker} hits you for ${damage} dmg ${rollDetail}`
                : `${attacker} miss ${rollDetail}`;
            const floatText = isHit
                ? `${attacker} hits you — ${damage} DMG`
                : `${attacker} miss`;
            logCombatEvent(logText, isHit ? 'miss' : 'hit');
            showFloatingText(floatText, isHit ? '#ff8a8a' : '#8dd694', true);
        }
    });

    socket.on('combat-turn-sync-denied', () => {
        // Server is authoritative — sync attempts are silently ignored; incoming combat-turn drives state.
        console.warn('[COMBAT] combat-turn-sync rejected: server-authoritative mode active');
    });
    // ── End server-authoritative turn state ────────────────────────────────────

    socket.on('dice-roll-event', (packet) => {
        const roll = packet && packet.roll ? packet.roll : null;
        if (!roll) return;
        triggerSharedDiceRoll(roll, { broadcast: false });
    });

    socket.on('role-ack', (info) => {
        if (!info || !info.role) return;
        netLog(`role-ack  id=${info.id}  role=${info.role}`);
        if (info.accepted === false) {
            const reason = String(info.reason || 'denied');
            appendConsoleHistory(`Lobby slot denied for ${String(info.requestedRole || '?')}: ${reason}`, 'error');
            showRuntimeModeSelectionOverlay();
            return;
        }
        appendConsoleHistory(`Network role: ${String(info.role)}`, 'ok');
    });

    socket.on('start-game-ack', (payload) => {
        if (!payload || typeof payload !== 'object') return;
        if (payload.ok) {
            appendConsoleHistory('Session started: roles locked', 'ok');
            if (payload.state && typeof payload.state === 'object') {
                sessionGameState = String(payload.state.gameState || sessionGameState || 'in_game');
                authoritativePlayerId = String(payload.state.authoritativePlayerId || authoritativePlayerId || '');
                updateClientRuntimeModeFromAuthority();
            }
            closeModeSelectionOverlay();
            return;
        }
        const denyReason = String(payload.reason || 'unknown');
        if (denyReason === 'already-started') {
            sessionGameState = 'in_game';
            updateLobbyOverlayFromState();
        }
        appendConsoleHistory(`Start game denied: ${denyReason}`, 'error');
    });

    socket.on('session-state', (payload) => {
        if (!payload || typeof payload !== 'object') return;
        sessionGameState = String(payload.gameState || sessionGameState || 'lobby');
        authoritativePlayerId = String(payload.authoritativePlayerId || authoritativePlayerId || '');
        updateClientRuntimeModeFromAuthority();
        updateLobbyOverlayFromState();
    });

    socket.on('lobby-state', (payload) => {
        if (!payload || typeof payload !== 'object') return;
        lobbyState = payload;
        if (typeof payload.authoritativePlayerId === 'string') {
            authoritativePlayerId = payload.authoritativePlayerId;
            updateClientRuntimeModeFromAuthority();
        }
        updateLobbyOverlayFromState();
    });

    // Debug: log all socket events except high-frequency noise
    const _debugIgnoredEvents = new Set(['player-update', 'players-state', 'world-update', 'combat-action-record']);
    socket.onAny((eventName, data) => {
        if (_debugIgnoredEvents.has(eventName)) return;
        console.log('[SOCKET-EVENT]', eventName, typeof data === 'object' ? JSON.stringify(data).slice(0, 120) : data);
    });
}

async function initializeSocketConnection() {
    if (!window.io || window.__DISABLE_MAP3D_SOCKET__) {
        netLog('socket init skipped: window.io missing or __DISABLE_MAP3D_SOCKET__ set');
        return;
    }
    
    if (!modeManager.current) {
        netWarn('initializeSocketConnection called but modeManager.current is not set — this should not happen');
        return;
    }

    try {
        const buildProbe = await fetch('/server-build', {
            method: 'GET',
            headers: { Accept: 'application/json' },
        });
        if (buildProbe.ok) {
            const buildInfo = await buildProbe.json();
            console.log('[NET] server-build probe', buildInfo);
            appendConsoleHistory(`[NET] server-build ${String(buildInfo && buildInfo.build ? buildInfo.build : 'unknown')}`, 'ok');
        } else {
            console.warn('[NET] server-build probe failed:', buildProbe.status);
        }
    } catch (_buildErr) {
        console.warn('[NET] server-build probe failed: network error');
    }
    
    try {
        // Probe once to avoid repeated 404 reconnect spam when Socket.IO backend is unavailable.
        const probe = await fetch('/socket.io/?EIO=4&transport=polling', {
            method: 'GET',
            headers: { Accept: '*/*' },
        });
        if (!probe.ok) {
            console.info('[NET] Socket.IO endpoint unavailable; multiplayer sync disabled for this session.');
            return;
        }
        netLog(`probe OK  status=${probe.status}`);
    } catch (_err) {
        console.info('[NET] Socket.IO probe failed; multiplayer sync disabled for this session.');
        return;
    }

    const resumeKey = getOrCreateClientResumeKey();

    socket = window.io(window.location.origin, {
        transports: ['websocket'],
        upgrade: false,
    });
    window.socket = socket;
    netLog('socket created, registering handlers…');
    appendConsoleHistory('[NET] transport mode: websocket-only', 'ok');
    registerSocketHandlers();

    if (socketModeUnsubscribe) {
        socketModeUnsubscribe();
    }
    if (typeof modeManager !== 'undefined' && modeManager && typeof modeManager.onChange === 'function') {
        socketModeUnsubscribe = modeManager.onChange(() => {
            registerRoleWithServer();
        });
    }

    registerRoleWithServer();
    
    // Safety: Ensure role is registered even if timing is tight
    // This handles case where socket connects but modeManager.current is not immediately available
    setTimeout(() => {
        if (modeManager.current && socket) {
            const currentRole = getNetworkRoleFromMode(modeManager.current);
            netLog(`Fallback role check: ${currentRole}`);
            registerRoleWithServer();
        }
    }, 250);
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
import { applyStoredAvatarRig, sanitizeStoredRigSettings, findRigHandBone } from '/static/avatar_rig_runtime.js';
import { spawnEntityFromContracts } from '/static/utils/renderBindingAdapter.js';
import { initializeBVH, buildMergedColliderMesh, resolveCollisionsWithBVH, queryGroundHeightBVH, disposeBVHCollider, applyAcceleratedRaycast } from '/static/bvh_collision.js';
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

function hasModePermission(permissionKey, mode = modeManager.current) {
    const allowed = MODE_PERMISSIONS[permissionKey];
    if (!Array.isArray(allowed)) return false;
    return allowed.includes(mode);
}

function isDmObserverMode() {
    return modeManager.current === MODE.DM && dmAuthorityLayer === DM_AUTHORITY_LAYER.OBSERVER;
}

// True whenever the DM camera is under free-fly control (not possessing an actor).
function isDmFreeCamera() {
    return modeManager.current === MODE.DM && !getControlledActor();
}

function hasDmPossessionControl() {
    return modeManager.current === MODE.DM && !!getControlledActor();
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

function updateClientRuntimeModeFromAuthority() {
    // Online multiplayer should not auto-degrade non-authoritative clients.
    // Keep observer mode as an explicit dev/testing override only.
    const nextMode = forceObserverMode ? CLIENT_MODE_OBSERVER : CLIENT_MODE_FULL;
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
        'action-bar',
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
};

const consoleCommands = Object.create(null);
const consoleEventBus = createEventBus();
let consoleRootEl = null;
let consoleModeEl = null;
let consoleLogEl = null;
let consoleInputEl = null;
let consoleSuggestionsEl = null;
let combatParticlesEnabled = true;
let consoleAudioMuted = false;
let modeOverlayEl = null;

function createEventBus() {
    const listeners = new Map();
    return {
        on(eventName, handler) {
            if (!listeners.has(eventName)) listeners.set(eventName, new Set());
            listeners.get(eventName).add(handler);
            return () => this.off(eventName, handler);
        },
        off(eventName, handler) {
            const handlers = listeners.get(eventName);
            if (!handlers) return;
            handlers.delete(handler);
            if (handlers.size === 0) listeners.delete(eventName);
        },
        emit(eventName, payload) {
            const handlers = listeners.get(eventName);
            if (!handlers || handlers.size === 0) return;
            handlers.forEach((handler) => {
                try {
                    handler(payload);
                } catch (err) {
                    console.error('Console event handler failed', eventName, err);
                }
            });
        },
    };
}

function appendConsoleHistory(text, tone = 'info') {
    const line = `[${modeManager.current}] ${text}`;
    consoleState.history.push({ line, tone });
    if (consoleState.history.length > 300) {
        consoleState.history.splice(0, consoleState.history.length - 300);
    }
    console.log('[CONSOLE]', text);
    renderConsoleHistory();
}

function renderConsoleHistory() {
    if (!consoleLogEl) return;
    consoleLogEl.innerHTML = '';
    const start = Math.max(0, consoleState.history.length - 80);
    for (let i = start; i < consoleState.history.length; i++) {
        const entry = consoleState.history[i];
        const row = document.createElement('div');
        row.textContent = entry.line;
        row.style.padding = '2px 0';
        row.style.color = entry.tone === 'error'
            ? '#ff9b9b'
            : entry.tone === 'ok'
                ? '#9ff0b2'
                : '#d5e3ff';
        consoleLogEl.appendChild(row);
    }
    consoleLogEl.scrollTop = consoleLogEl.scrollHeight;
}

function updateConsoleModeBadge() {
    if (!consoleModeEl) return;
    consoleModeEl.textContent = `mode: ${modeManager.current}`;
    renderConsoleSuggestions();
}

function getAvailableConsoleCommandNames() {
    return Object.keys(consoleCommands)
        .filter((name) => {
            const cmd = consoleCommands[name];
            return !!(cmd && Array.isArray(cmd.modes) && cmd.modes.includes(modeManager.current));
        })
        .sort();
}

function renderConsoleSuggestions() {
    if (!consoleSuggestionsEl || !consoleInputEl) return;

    const raw = String(consoleInputEl.value || '');
    const trimmedStart = raw.trimStart();
    if (!trimmedStart.startsWith('/')) {
        consoleSuggestionsEl.style.display = 'none';
        consoleSuggestionsEl.innerHTML = '';
        return;
    }

    const token = String(trimmedStart.split(/\s+/)[0] || '').slice(1).toLowerCase();
    const all = getAvailableConsoleCommandNames();
    const matches = all.filter((name) => name.includes(token)).slice(0, 12);

    if (matches.length <= 0) {
        consoleSuggestionsEl.style.display = 'none';
        consoleSuggestionsEl.innerHTML = '';
        return;
    }

    consoleSuggestionsEl.innerHTML = '';
    matches.forEach((name) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.textContent = `/${name}`;
        row.style.textAlign = 'left';
        row.style.background = 'rgba(8, 14, 28, 0.92)';
        row.style.color = '#d9e8ff';
        row.style.border = '1px solid rgba(120, 168, 255, 0.34)';
        row.style.borderRadius = '6px';
        row.style.padding = '6px 8px';
        row.style.cursor = 'pointer';
        row.style.fontFamily = 'Consolas, "Segoe UI", monospace';
        row.style.fontSize = '12px';
        row.addEventListener('mousedown', (event) => {
            event.preventDefault();
            consoleInputEl.value = `/${name} `;
            renderConsoleSuggestions();
            requestAnimationFrame(() => {
                consoleInputEl.focus();
                consoleInputEl.setSelectionRange(consoleInputEl.value.length, consoleInputEl.value.length);
            });
        });
        consoleSuggestionsEl.appendChild(row);
    });
    consoleSuggestionsEl.style.display = 'grid';
}

function ensureConsoleUi() {
    if (consoleRootEl) return;
    if (!document.body) return;

    consoleRootEl = document.createElement('div');
    consoleRootEl.id = 'console-root';
    consoleRootEl.style.position = 'fixed';
    consoleRootEl.style.left = '14px';
    consoleRootEl.style.bottom = '14px';
    consoleRootEl.style.width = 'min(720px, calc(100vw - 28px))';
    consoleRootEl.style.height = '300px';
    consoleRootEl.style.display = 'none';
    consoleRootEl.style.flexDirection = 'column';
    consoleRootEl.style.padding = '10px';
    consoleRootEl.style.border = '1px solid rgba(125, 175, 255, 0.6)';
    consoleRootEl.style.borderRadius = '8px';
    consoleRootEl.style.background = 'rgba(6, 10, 20, 0.9)';
    consoleRootEl.style.backdropFilter = 'blur(3px)';
    consoleRootEl.style.boxShadow = '0 12px 30px rgba(0, 0, 0, 0.5)';
    consoleRootEl.style.zIndex = '131520';
    consoleRootEl.addEventListener('mousedown', (event) => event.stopPropagation());

    const topRow = document.createElement('div');
    topRow.style.display = 'flex';
    topRow.style.justifyContent = 'space-between';
    topRow.style.alignItems = 'center';
    topRow.style.fontFamily = 'Consolas, "Segoe UI", monospace';
    topRow.style.fontSize = '13px';
    topRow.style.color = '#a9c8ff';
    topRow.style.marginBottom = '6px';

    const titleEl = document.createElement('div');
    titleEl.textContent = 'map3d command console';
    titleEl.style.textTransform = 'uppercase';
    titleEl.style.letterSpacing = '0.8px';
    topRow.appendChild(titleEl);

    consoleModeEl = document.createElement('div');
    consoleModeEl.style.color = '#ffd58c';
    topRow.appendChild(consoleModeEl);

    consoleLogEl = document.createElement('div');
    consoleLogEl.style.flex = '1';
    consoleLogEl.style.overflowY = 'auto';
    consoleLogEl.style.padding = '6px';
    consoleLogEl.style.border = '1px solid rgba(120, 150, 220, 0.28)';
    consoleLogEl.style.background = 'rgba(5, 9, 18, 0.7)';
    consoleLogEl.style.borderRadius = '6px';
    consoleLogEl.style.fontFamily = 'Consolas, "Segoe UI", monospace';
    consoleLogEl.style.fontSize = '13px';
    consoleLogEl.style.lineHeight = '1.45';

    consoleInputEl = document.createElement('input');
    consoleInputEl.type = 'text';
    consoleInputEl.autocapitalize = 'off';
    consoleInputEl.autocomplete = 'off';
    consoleInputEl.spellcheck = false;
    consoleInputEl.placeholder = 'type a command, press Enter';
    consoleInputEl.style.marginTop = '8px';
    consoleInputEl.style.padding = '8px 10px';
    consoleInputEl.style.border = '1px solid rgba(125, 175, 255, 0.55)';
    consoleInputEl.style.borderRadius = '6px';
    consoleInputEl.style.background = 'rgba(5, 9, 18, 0.95)';
    consoleInputEl.style.color = '#e6f0ff';
    consoleInputEl.style.outline = 'none';
    consoleInputEl.style.fontFamily = 'Consolas, "Segoe UI", monospace';
    consoleInputEl.style.fontSize = '14px';
    consoleInputEl.addEventListener('input', () => {
        renderConsoleSuggestions();
    });
    consoleInputEl.addEventListener('keydown', (event) => {
        event.stopPropagation();

        if (event.key === 'Enter') {
            const commandText = (consoleInputEl.value || '').trim();
            if (commandText.length > 0) {
                runConsoleCommand(commandText);
                consoleState.commandHistory.push(commandText);
                if (consoleState.commandHistory.length > 120) {
                    consoleState.commandHistory.shift();
                }
                consoleState.commandHistoryIndex = consoleState.commandHistory.length;
            }
            consoleInputEl.value = '';
            event.preventDefault();
            return;
        }

        if (event.key === 'ArrowUp') {
            if (consoleState.commandHistory.length === 0) {
                event.preventDefault();
                return;
            }
            consoleState.commandHistoryIndex = Math.max(0, consoleState.commandHistoryIndex - 1);
            consoleInputEl.value = consoleState.commandHistory[consoleState.commandHistoryIndex] || '';
            requestAnimationFrame(() => {
                consoleInputEl.setSelectionRange(consoleInputEl.value.length, consoleInputEl.value.length);
            });
            event.preventDefault();
            return;
        }

        if (event.key === 'ArrowDown') {
            if (consoleState.commandHistory.length === 0) {
                event.preventDefault();
                return;
            }
            consoleState.commandHistoryIndex = Math.min(consoleState.commandHistory.length, consoleState.commandHistoryIndex + 1);
            consoleInputEl.value = consoleState.commandHistory[consoleState.commandHistoryIndex] || '';
            requestAnimationFrame(() => {
                consoleInputEl.setSelectionRange(consoleInputEl.value.length, consoleInputEl.value.length);
            });
            event.preventDefault();
            return;
        }

        if (event.key === 'Escape') {
            setConsoleOpen(false);
            event.preventDefault();
        }
    });

    consoleRootEl.appendChild(topRow);
    consoleRootEl.appendChild(consoleLogEl);
    consoleRootEl.appendChild(consoleInputEl);

    consoleSuggestionsEl = document.createElement('div');
    consoleSuggestionsEl.style.display = 'none';
    consoleSuggestionsEl.style.marginTop = '6px';
    consoleSuggestionsEl.style.maxHeight = '150px';
    consoleSuggestionsEl.style.overflowY = 'auto';
    consoleSuggestionsEl.style.gap = '6px';
    consoleSuggestionsEl.style.padding = '6px';
    consoleSuggestionsEl.style.border = '1px solid rgba(120, 168, 255, 0.34)';
    consoleSuggestionsEl.style.borderRadius = '6px';
    consoleSuggestionsEl.style.background = 'rgba(4, 8, 16, 0.9)';
    consoleRootEl.appendChild(consoleSuggestionsEl);

    document.body.appendChild(consoleRootEl);

    updateConsoleModeBadge();
    renderConsoleHistory();
}

function setConsoleOpen(open) {
    ensureConsoleUi();
    if (!consoleRootEl) return;
    if (!consoleRootEl.parentNode && document.body) {
        document.body.appendChild(consoleRootEl);
        consoleRootEl.__dmDetachedLegacy = false;
    }
    consoleState.open = !!open;
    consoleRootEl.style.display = consoleState.open ? 'flex' : 'none';
    if (!consoleState.open && consoleSuggestionsEl) {
        consoleSuggestionsEl.style.display = 'none';
    }
    updateConsoleModeBadge();
    if (consoleState.open) {
        if (document.pointerLockElement) {
            document.exitPointerLock();
        }
        requestAnimationFrame(() => {
            if (!consoleInputEl) return;
            consoleInputEl.focus();
            consoleInputEl.select();
            renderConsoleSuggestions();
        });
    } else if (consoleInputEl) {
        consoleInputEl.blur();
    }
}

function toggleConsoleOpen() {
    setConsoleOpen(!consoleState.open);
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
    if (!raw) return [];
    const tokens = [];
    const re = /"([^"]*)"|'([^']*)'|([^\s]+)/g;
    let match = null;
    while ((match = re.exec(raw)) !== null) {
        tokens.push(match[1] ?? match[2] ?? match[3]);
    }
    return tokens;
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

function buildConsoleContext() {
    return {
        scene,
        renderer,
        playerState,
        combatSystem: {
            spawnEnemy(type = 'dummy') {
                const enemyName = type && String(type).trim().length > 0 ? String(type).trim() : 'Training Dummy';
                const baseAngle = Math.random() * Math.PI * 2;
                const spawnRadius = 2.8 + (Math.random() * 1.6);
                const x = playerState.position.x + (Math.cos(baseAngle) * spawnRadius);
                const z = playerState.position.z + (Math.sin(baseAngle) * spawnRadius);
                const y = playerState.position.y;
                return requestTrainingDummySpawn(x, y, z, enemyName);
            },
            saveSnapshot,
            rewindTurn: requestRewindTurn,
            replayLastAction: requestReplayLastAction,
            setDmOverride(override) {
                dmOverride = override ? { ...override } : null;
                return dmOverride;
            },
            endTurn: requestEndTurn,
            stepTurn: requestStepTurn,
            possessActor: requestPossessActor,
            releasePossession: requestReleasePossession,
            getControlledActor,
            basicAttack() {
                const controlled = getControlledActor();
                if (modeManager.current === MODE.DM && !controlled) {
                    appendConsoleHistory('DM must possess an actor before attacking', 'error');
                    return false;
                }

                const actor = controlled || playerState;
                if (actor !== playerState) {
                    const acted = runPossessedEnemyAttack(actor);
                    if (!acted) {
                        appendConsoleHistory('Possessed actor cannot attack right now', 'error');
                    }
                    return acted;
                }

                let target = selectedCombatTarget;
                if (!target || !target.parent || (target.userData?.hp || 0) <= 0) {
                    const alive = trainingDummies.filter((dummy) => dummy && dummy.parent && (dummy.userData?.hp || 0) > 0);
                    if (alive.length > 0) {
                        target = alive.sort((a, b) => getEdgeDistanceFeet(playerState, a) - getEdgeDistanceFeet(playerState, b))[0];
                    }
                }
                if (!target) {
                    appendConsoleHistory('No valid target for attack', 'error');
                    return false;
                }
                setSelectedCombatTarget(target);
                selectMoveAndAttackAction(target);
                return true;
            },
        },
        audioSystem: {
            mute() {
                consoleAudioMuted = true;
                if (combatMixerMasterGain && combatMixerMasterGain.gain) {
                    combatMixerMasterGain.gain.value = 0;
                }
                if (combatAudioMasterGain && combatAudioMasterGain.gain) {
                    combatAudioMasterGain.gain.value = 0;
                }
                if (combatMusicMasterGain && combatMusicMasterGain.gain) {
                    combatMusicMasterGain.gain.value = 0.0001;
                }
            },
            unmute() {
                consoleAudioMuted = false;
                if (combatMixerMasterGain && combatMixerMasterGain.gain) {
                    combatMixerMasterGain.gain.value = 0.6;
                }
                if (combatAudioMasterGain && combatAudioMasterGain.gain) {
                    combatAudioMasterGain.gain.value = 0.6;
                }
                if (combatMusicMasterGain && combatMusicMasterGain.gain) {
                    combatMusicMasterGain.gain.value = getCombatMusicTargetGain();
                }
            },
            play(cueName = 'melee-hit') {
                playCombatSfxCue(cueName);
            },
            get muted() {
                return consoleAudioMuted;
            },
        },
        eventBus: consoleEventBus,
    };
}

function runConsoleCommand(input) {
    const trimmed = (input || '').trim();
    if (!trimmed) return;
    appendConsoleHistory(`> ${trimmed}`);

    const tokens = tokenizeConsoleInput(trimmed);
    if (tokens.length === 0) return;
    const rawName = String(tokens[0] || '').toLowerCase();
    const name = rawName.startsWith('/') ? rawName.slice(1) : rawName;
    const args = tokens.slice(1);
    const command = consoleCommands[name];

    if (!command) {
        appendConsoleHistory(`Unknown command: ${name}`, 'error');
        return;
    }

    if (!command.modes.includes(modeManager.current)) {
        appendConsoleHistory(`Command not allowed in ${modeManager.current} mode`, 'error');
        return;
    }

    try {
        const ctx = buildConsoleContext();
        command.execute(ctx, args);
    } catch (err) {
        appendConsoleHistory(`Command failed: ${err && err.message ? err.message : String(err)}`, 'error');
    }
}

function parseConsoleScalar(raw) {
    const text = String(raw ?? '').trim();
    if (!text.length) return '';
    const lower = text.toLowerCase();
    if (lower === 'true' || lower === 'on' || lower === 'yes') return true;
    if (lower === 'false' || lower === 'off' || lower === 'no') return false;
    if (lower === 'null') return null;
    const numeric = Number(text);
    if (Number.isFinite(numeric)) return numeric;
    return text;
}

function registerDefaultConsoleCommands() {
    registerConsoleCommand('help', {
        modes: [CONSOLE_MODE.DEV, CONSOLE_MODE.DM, CONSOLE_MODE.PLAYER],
        usage: 'help',
        description: 'List commands available in the current mode',
        execute: () => {
            const names = Object.keys(consoleCommands)
                .filter((name) => consoleCommands[name].modes.includes(modeManager.current))
                .sort();
            appendConsoleHistory(`Available commands (${modeManager.current}): ${names.join(', ')}`);
        },
    });

    registerConsoleCommand('clear', {
        modes: [CONSOLE_MODE.DEV, CONSOLE_MODE.DM, CONSOLE_MODE.PLAYER],
        usage: 'clear',
        description: 'Clear console scrollback',
        execute: () => {
            consoleState.history.length = 0;
            renderConsoleHistory();
        },
    });

    registerConsoleCommand('mode', {
        modes: [CONSOLE_MODE.DEV, CONSOLE_MODE.DM, CONSOLE_MODE.PLAYER],
        usage: 'mode <dev|dm|player>',
        description: 'Switch command mode',
        execute: (_ctx, args) => {
            const next = String(args[0] || '').toLowerCase();
            if (!Object.values(CONSOLE_MODE).includes(next)) {
                appendConsoleHistory('Usage: mode <dev|dm|player>', 'error');
                return;
            }
            if (!modeManager.setMode(next)) {
                appendConsoleHistory(`Failed to switch mode to ${next}`, 'error');
                return;
            }
            appendConsoleHistory(`Mode switched to ${next}`, 'ok');
        },
    });

    registerConsoleCommand('wireframe', {
        modes: [CONSOLE_MODE.DEV],
        usage: 'wireframe',
        description: 'Toggle mesh wireframe',
        execute: ({ scene: activeScene }) => {
            let toggledCount = 0;
            activeScene.traverse((obj) => {
                if (!obj || !obj.isMesh || !obj.material) return;
                if (Array.isArray(obj.material)) {
                    obj.material.forEach((mat) => {
                        if (mat && typeof mat.wireframe === 'boolean') {
                            mat.wireframe = !mat.wireframe;
                            toggledCount += 1;
                        }
                    });
                } else if (typeof obj.material.wireframe === 'boolean') {
                    obj.material.wireframe = !obj.material.wireframe;
                    toggledCount += 1;
                }
            });
            appendConsoleHistory(`Wireframe toggled on ${toggledCount} materials`, 'ok');
        },
    });

    registerConsoleCommand('audio', {
        modes: [CONSOLE_MODE.DEV],
        usage: 'audio <mute|unmute|play> [cue]',
        description: 'Audio debug controls',
        execute: ({ audioSystem }, args) => {
            const op = String(args[0] || '').toLowerCase();
            if (op === 'mute') {
                audioSystem.mute();
                appendConsoleHistory('Audio muted', 'ok');
                return;
            }
            if (op === 'unmute') {
                audioSystem.unmute();
                appendConsoleHistory('Audio unmuted', 'ok');
                return;
            }
            if (op === 'play') {
                const cueName = String(args[1] || 'melee-hit');
                audioSystem.play(cueName);
                appendConsoleHistory(`Audio cue played: ${cueName}`, 'ok');
                return;
            }
            appendConsoleHistory('Usage: audio <mute|unmute|play> [cue]', 'error');
        },
    });

    registerConsoleCommand('quality', {
        modes: [CONSOLE_MODE.DEV, CONSOLE_MODE.PLAYER],
        usage: 'quality <low|medium|high>',
        description: 'Switch runtime performance quality preset',
        execute: (_ctx, args) => {
            const level = String(args[0] || '').toLowerCase();
            if (!setQuality(level)) {
                appendConsoleHistory('Usage: quality <low|medium|high>', 'error');
                return;
            }
            appendConsoleHistory(`Quality set to ${SETTINGS.quality} (${SETTINGS.maxFPS} fps, scale ${SETTINGS.renderScale})`, 'ok');
        },
    });

    registerConsoleCommand('observer', {
        modes: [CONSOLE_MODE.DEV, CONSOLE_MODE.PLAYER],
        usage: 'observer <auto|on|off|status>',
        description: 'Force observer runtime mode for low-power multi-instance testing',
        execute: (_ctx, args) => {
            const op = String(args[0] || 'status').toLowerCase();
            if (op === 'status') {
                appendConsoleHistory(`Observer mode: ${isObserverClient() ? 'ON' : 'OFF'} (forced=${forceObserverMode ? 'yes' : 'no'})`, 'ok');
                return;
            }
            if (op === 'auto') {
                forceObserverMode = false;
                updateClientRuntimeModeFromAuthority();
                appendConsoleHistory(`Observer mode auto (runtime=${isObserverClient() ? 'observer' : 'full'})`, 'ok');
                return;
            }
            if (op === 'on') {
                forceObserverMode = true;
                updateClientRuntimeModeFromAuthority();
                appendConsoleHistory('Observer mode forced ON', 'ok');
                return;
            }
            if (op === 'off') {
                forceObserverMode = false;
                CLIENT_MODE = CLIENT_MODE_FULL;
                applySettings();
                appendConsoleHistory('Observer mode forced OFF (full mode)', 'ok');
                return;
            }
            appendConsoleHistory('Usage: observer <auto|on|off|status>', 'error');
        },
    });

    registerConsoleCommand('spawn', {
        modes: [CONSOLE_MODE.DEV, CONSOLE_MODE.DM],
        usage: 'spawn [type] [count]',
        description: 'Spawn one or more enemies near player',
        execute: ({ combatSystem }, args) => {
            const type = String(args[0] || 'Training Dummy');
            const requestedCount = Number.parseInt(args[1], 10);
            const count = Number.isFinite(requestedCount)
                ? Math.max(1, Math.min(16, requestedCount))
                : 1;
            let okCount = 0;
            for (let i = 0; i < count; i++) {
                const spawned = combatSystem.spawnEnemy(type);
                if (spawned !== false) {
                    okCount += 1;
                }
            }
            if (okCount <= 0) {
                appendConsoleHistory(`Spawn failed for ${type}`, 'error');
                return;
            }
            if (modeManager.current === MODE.DM) {
                appendConsoleHistory(`Dispatched ${okCount} spawn command(s) for ${type}`, 'ok');
                return;
            }
            appendConsoleHistory(`Spawned ${okCount} ${type}`, 'ok');
        },
    });

    registerConsoleCommand('endturn', {
        modes: [CONSOLE_MODE.DEV, CONSOLE_MODE.DM],
        usage: 'endturn',
        description: 'End current player turn',
        execute: ({ combatSystem }) => {
            if (!combatSystem.endTurn()) {
                appendConsoleHistory('End turn unavailable right now', 'error');
                return;
            }
            appendConsoleHistory(modeManager.current === MODE.DM ? 'End turn command dispatched' : 'End turn requested', 'ok');
        },
    });

    registerConsoleCommand('stepturn', {
        modes: [CONSOLE_MODE.DEV, CONSOLE_MODE.DM],
        usage: 'stepturn',
        description: 'Advance combat to the next queued actor turn',
        execute: ({ combatSystem }) => {
            if (!combatSystem.stepTurn()) {
                appendConsoleHistory('Turn step unavailable right now', 'error');
                return;
            }
            appendConsoleHistory(modeManager.current === MODE.DM ? 'Step turn command dispatched' : 'Advanced to next queued actor', 'ok');
        },
    });

    registerConsoleCommand('brawl', {
        modes: [CONSOLE_MODE.DEV, CONSOLE_MODE.DM],
        usage: 'brawl [count]',
        description: 'Spawn dummies that fight each other while you spectate (player turns auto-skipped)',
        execute: ({ combatSystem }, args) => {
            if (currentGameMode === GAME_MODE.COMBAT) {
                appendConsoleHistory('End combat first before starting a brawl', 'error');
                return;
            }
            const count = Math.max(2, Math.min(8, Number.parseInt(args[0], 10) || 2));
            // Spawn dummies in a ring ~5 units from the player, spread evenly
            const BRAWL_RADIUS = 5;
            let spawned = 0;
            for (let i = 0; i < count; i++) {
                const angle = (i / count) * Math.PI * 2;
                const x = playerState.position.x + Math.cos(angle) * BRAWL_RADIUS;
                const z = playerState.position.z + Math.sin(angle) * BRAWL_RADIUS;
                const dummy = requestTrainingDummySpawn(x, playerState.position.y, z, `Dummy ${i + 1}`);
                if (dummy !== false) spawned += 1;
            }
            if (spawned === 0) {
                appendConsoleHistory('Failed to spawn brawl dummies', 'error');
                return;
            }
            spectatorCombat = true;
            // Small delay to let dummies finish spawning before starting combat
            setTimeout(() => {
                if (currentGameMode !== GAME_MODE.COMBAT) {
                    requestDmStartCombat(null) || emitCombatStateEvent(true, {
                        initiator: localPlayerId || (socket ? socket.id : null),
                    });
                }
            }, 400);
            appendConsoleHistory(`Brawl started: ${spawned} dummies spawned. Your turns will be skipped automatically.`, 'ok');
        },
    });

    registerConsoleCommand('possess', {
        modes: [CONSOLE_MODE.DEV, CONSOLE_MODE.DM],
        usage: 'possess [actorId|selected]',
        description: 'Possess selected enemy or actor id for manual turn control',
        execute: ({ combatSystem }, args) => {
            let actor = null;
            const requested = String(args[0] || '').trim();
            if (requested.length > 0 && requested.toLowerCase() !== 'selected') {
                actor = findCombatActorById(requested);
                if (!actor && requested.toLowerCase() === 'player') {
                    actor = playerState;
                }
            } else {
                actor = selectedCombatTarget;
            }
            if (!actor) {
                appendConsoleHistory('No actor to possess (select a target or pass actorId)', 'error');
                return;
            }
            if (!combatSystem.possessActor(actor)) {
                appendConsoleHistory('Possession failed for requested actor', 'error');
                return;
            }
            const actorName = actor === playerState
                ? 'Player'
                : (actor.userData?.name || actor.userData?.actorId || 'Enemy');
            appendConsoleHistory(modeManager.current === MODE.DM ? `Possess command dispatched for ${actorName}` : `Possessing ${actorName}`, 'ok');
        },
    });

    registerConsoleCommand('release', {
        modes: [CONSOLE_MODE.DEV, CONSOLE_MODE.DM],
        usage: 'release',
        description: 'Release currently possessed actor',
        execute: ({ combatSystem }) => {
            if (!combatSystem.releasePossession()) {
                appendConsoleHistory('No possessed actor active', 'error');
                return;
            }
            appendConsoleHistory(modeManager.current === MODE.DM ? 'Release command dispatched' : 'Possession released', 'ok');
        },
    });

    registerConsoleCommand('rewind', {
        modes: [CONSOLE_MODE.DEV, CONSOLE_MODE.DM],
        usage: 'rewind',
        description: 'Rewind combat to the previous saved turn snapshot',
        execute: ({ combatSystem }) => {
            if (!combatSystem.rewindTurn()) {
                appendConsoleHistory('No earlier combat snapshot available', 'error');
                return;
            }
            appendConsoleHistory(modeManager.current === MODE.DM ? 'Rewind command dispatched' : 'Combat rewound to previous turn snapshot', 'ok');
        },
    });

    registerConsoleCommand('forcehit', {
        modes: [CONSOLE_MODE.DEV, CONSOLE_MODE.DM],
        usage: 'forcehit [damage]',
        description: 'Force the next attack resolution to hit',
        execute: ({ combatSystem }, args) => {
            const damage = Number.parseInt(args[0], 10);
            combatSystem.setDmOverride({
                hit: true,
                resultType: 'crit',
                damage: Number.isFinite(damage) ? Math.max(0, damage) : undefined,
            });
            appendConsoleHistory('Next attack forced to hit', 'ok');
        },
    });

    registerConsoleCommand('forcemiss', {
        modes: [CONSOLE_MODE.DEV, CONSOLE_MODE.DM],
        usage: 'forcemiss',
        description: 'Force the next attack resolution to miss',
        execute: ({ combatSystem }) => {
            combatSystem.setDmOverride({ hit: false, resultType: 'fumble', damage: 0 });
            appendConsoleHistory('Next attack forced to miss', 'ok');
        },
    });

    registerConsoleCommand('snapshot', {
        modes: [CONSOLE_MODE.DEV, CONSOLE_MODE.DM],
        usage: 'snapshot',
        description: 'Save a manual combat snapshot',
        execute: ({ combatSystem }) => {
            if (!combatSystem.saveSnapshot('manual')) {
                appendConsoleHistory('Combat snapshot unavailable outside combat', 'error');
                return;
            }
            appendConsoleHistory(`Combat snapshot saved (${combatTimeline.length} total)`, 'ok');
        },
    });

    registerConsoleCommand('replay', {
        modes: [CONSOLE_MODE.DEV, CONSOLE_MODE.DM],
        usage: 'replay',
        description: 'Replay the last recorded combat action',
        execute: ({ combatSystem }) => {
            void combatSystem.replayLastAction().then((ok) => {
                const successMessage = modeManager.current === MODE.DM
                    ? 'Replay command dispatched'
                    : 'Replaying last action';
                appendConsoleHistory(ok ? successMessage : 'No recorded action to replay', ok ? 'ok' : 'error');
            }).catch((err) => {
                appendConsoleHistory(`Replay failed: ${err && err.message ? err.message : String(err)}`, 'error');
            });
        },
    });

    registerConsoleCommand('replayprev', {
        modes: [CONSOLE_MODE.DEV, CONSOLE_MODE.DM],
        usage: 'replayprev',
        description: 'Move replay cursor to the previous recorded action and replay it',
        execute: ({ combatSystem }) => {
            if (!combatActionHistory.length) {
                appendConsoleHistory('No recorded action to replay', 'error');
                return;
            }
            getCombatActionAtCursor(-1);
            void combatSystem.replayLastAction().then((ok) => {
                appendConsoleHistory(ok ? `Replaying action ${combatActionHistoryCursor + 1}/${combatActionHistory.length}` : 'Replay blocked while another timeline is active', ok ? 'ok' : 'error');
            }).catch((err) => {
                appendConsoleHistory(`Replay failed: ${err && err.message ? err.message : String(err)}`, 'error');
            });
        },
    });

    registerConsoleCommand('replaynext', {
        modes: [CONSOLE_MODE.DEV, CONSOLE_MODE.DM],
        usage: 'replaynext',
        description: 'Move replay cursor to the next recorded action and replay it',
        execute: ({ combatSystem }) => {
            if (!combatActionHistory.length) {
                appendConsoleHistory('No recorded action to replay', 'error');
                return;
            }
            getCombatActionAtCursor(1);
            void combatSystem.replayLastAction().then((ok) => {
                appendConsoleHistory(ok ? `Replaying action ${combatActionHistoryCursor + 1}/${combatActionHistory.length}` : 'Replay blocked while another timeline is active', ok ? 'ok' : 'error');
            }).catch((err) => {
                appendConsoleHistory(`Replay failed: ${err && err.message ? err.message : String(err)}`, 'error');
            });
        },
    });

    registerConsoleCommand('attack', {
        modes: [CONSOLE_MODE.PLAYER, CONSOLE_MODE.DM],
        usage: 'attack',
        description: 'Run basic attack against selected or nearest target',
        execute: ({ combatSystem }) => {
            const attacked = combatSystem.basicAttack();
            if (attacked) {
                appendConsoleHistory('Attack preview opened. Confirm to execute.', 'ok');
            }
        },
    });

    registerConsoleCommand('particles', {
        modes: [CONSOLE_MODE.DEV],
        usage: 'particles <on|off|toggle>',
        description: 'Enable or disable combat burst particles',
        execute: (_ctx, args) => {
            const op = String(args[0] || 'toggle').toLowerCase();
            if (op === 'on') {
                combatParticlesEnabled = true;
            } else if (op === 'off') {
                combatParticlesEnabled = false;
            } else {
                combatParticlesEnabled = !combatParticlesEnabled;
            }
            appendConsoleHistory(`Particles ${combatParticlesEnabled ? 'enabled' : 'disabled'}`, 'ok');
        },
    });

    registerConsoleCommand('grid', {
        modes: [CONSOLE_MODE.DEV],
        usage: 'grid <on|off|toggle>',
        description: 'Toggle world grid overlay',
        execute: (_ctx, args) => {
            const op = String(args[0] || 'toggle').toLowerCase();
            if (op === 'on') {
                setGridVisibility(true);
            } else if (op === 'off') {
                setGridVisibility(false);
            } else {
                toggleGrid();
            }
            appendConsoleHistory(`Grid ${gridVisible ? 'enabled' : 'disabled'}`, 'ok');
        },
    });

    const runtimeTunables = {
        'camera.fov': {
            get: () => Number(camera?.fov) || 0,
            set: (value) => {
                const next = THREE.MathUtils.clamp(Number(value) || 58, 5, 120);
                camera.fov = next;
                camera.updateProjectionMatrix();
                return next;
            },
        },
        'camera.yaw': {
            get: () => Number(yaw) || 0,
            set: (value) => {
                yaw = Number(value) || 0;
                return yaw;
            },
        },
        'camera.pitch': {
            get: () => Number(pitch) || 0,
            set: (value) => {
                pitch = THREE.MathUtils.clamp(Number(value) || 0, -Math.PI / 2, Math.PI / 2);
                return pitch;
            },
        },
        'input.lookSpeed': {
            get: () => Number(lookSpeed) || 0,
            set: (value) => {
                lookSpeed = THREE.MathUtils.clamp(Number(value) || 0.0025, 0.0001, 0.02);
                return lookSpeed;
            },
        },
        'player.hp': {
            get: () => Number(playerState?.hp) || 0,
            set: (value) => {
                const hp = Math.max(0, Number(value) || 0);
                const maxHp = Math.max(1, Number(playerState?.maxHp) || 1);
                playerState.hp = Math.min(maxHp, hp);
                updatePlayerHealthHud();
                return playerState.hp;
            },
        },
        'player.maxHp': {
            get: () => Number(playerState?.maxHp) || 0,
            set: (value) => {
                playerState.maxHp = Math.max(1, Number(value) || 1);
                playerState.hp = Math.min(Number(playerState.hp) || 0, playerState.maxHp);
                updatePlayerHealthHud();
                return playerState.maxHp;
            },
        },
        'player.speed': {
            get: () => Number(playerState?.speed) || 0,
            set: (value) => {
                playerState.speed = Math.max(0.1, Number(value) || 5);
                return playerState.speed;
            },
        },
        'combat.inCombat': {
            get: () => !!combatState?.inCombat,
            set: (value) => {
                const on = !!value;
                if (on) {
                    currentGameMode = GAME_MODE.COMBAT;
                    combatState.inCombat = true;
                    setCombatPhase(combatState.phase || 'PLAYER');
                } else {
                    currentGameMode = GAME_MODE.FREE;
                    combatState.inCombat = false;
                    setCombatPhase('TRANSITION');
                    setCombatLock(false);
                    deactivateCombatCamera();
                }
                updateCombatUI();
                updateActionMenu();
                return combatState.inCombat;
            },
        },
        'combat.round': {
            get: () => Number(combatState?.roundNumber) || 0,
            set: (value) => {
                combatState.roundNumber = Math.max(0, Math.floor(Number(value) || 0));
                updateCombatUI();
                return combatState.roundNumber;
            },
        },
        'combat.turnIndex': {
            get: () => Number(combatState?.currentTurnIndex) || 0,
            set: (value) => {
                combatState.currentTurnIndex = Math.max(0, Math.floor(Number(value) || 0));
                updateCombatUI();
                return combatState.currentTurnIndex;
            },
        },
        'combat.lock': {
            get: () => !!combatState?.lock,
            set: (value) => {
                setCombatLock(!!value);
                return !!combatState.lock;
            },
        },
        'dm.autostep': {
            get: () => !!dmAutoStepEnabled,
            set: (value) => {
                setDmAutoStepEnabled(!!value);
                return !!dmAutoStepEnabled;
            },
        },
        'dm.authority': {
            get: () => String(simulationAuthority || ''),
            set: (value) => {
                const next = String(value || '').toLowerCase();
                if (next === SIMULATION_AUTHORITY.SERVER || next === SIMULATION_AUTHORITY.LOCAL_DM) {
                    setSimulationAuthority(next);
                    syncDmAuthorityLayerFromState();
                }
                return String(simulationAuthority || '');
            },
        },
        'dm.layer': {
            get: () => String(dmAuthorityLayer || ''),
            set: (value) => {
                const next = String(value || '').toLowerCase();
                if (Object.values(DM_AUTHORITY_LAYER).includes(next)) {
                    setDmAuthorityLayer(next);
                }
                return String(dmAuthorityLayer || '');
            },
        },
    };

    registerConsoleCommand('vars', {
        modes: [CONSOLE_MODE.DEV, CONSOLE_MODE.DM],
        usage: 'vars [filter]',
        description: 'List runtime variable keys that can be controlled via console',
        execute: (_ctx, args) => {
            const filter = String(args[0] || '').toLowerCase();
            const keys = Object.keys(runtimeTunables)
                .filter((k) => !filter || k.toLowerCase().includes(filter))
                .sort();
            appendConsoleHistory(keys.length ? `Vars: ${keys.join(', ')}` : 'No vars matched filter', keys.length ? 'ok' : 'error');
        },
    });

    registerConsoleCommand('get', {
        modes: [CONSOLE_MODE.DEV, CONSOLE_MODE.DM],
        usage: 'get <varKey>',
        description: 'Read a runtime variable from the control registry',
        execute: (_ctx, args) => {
            const key = String(args[0] || '').trim();
            const tunable = runtimeTunables[key];
            if (!tunable) {
                appendConsoleHistory(`Unknown var key: ${key}`, 'error');
                return;
            }
            const value = tunable.get();
            appendConsoleHistory(`${key} = ${String(value)}`, 'ok');
        },
    });

    registerConsoleCommand('set', {
        modes: [CONSOLE_MODE.DEV, CONSOLE_MODE.DM],
        usage: 'set <varKey> <value>',
        description: 'Set a runtime variable in the control registry',
        execute: (_ctx, args) => {
            const key = String(args[0] || '').trim();
            const tunable = runtimeTunables[key];
            if (!tunable) {
                appendConsoleHistory(`Unknown var key: ${key}`, 'error');
                return;
            }
            if (args.length < 2) {
                appendConsoleHistory('Usage: set <varKey> <value>', 'error');
                return;
            }
            const value = parseConsoleScalar(args.slice(1).join(' '));
            const updated = tunable.set(value);
            appendConsoleHistory(`${key} -> ${String(updated)}`, 'ok');
        },
    });

    registerConsoleCommand('inc', {
        modes: [CONSOLE_MODE.DEV, CONSOLE_MODE.DM],
        usage: 'inc <varKey> [delta]',
        description: 'Increment a numeric runtime variable by delta (default 1)',
        execute: (_ctx, args) => {
            const key = String(args[0] || '').trim();
            const tunable = runtimeTunables[key];
            if (!tunable) {
                appendConsoleHistory(`Unknown var key: ${key}`, 'error');
                return;
            }
            const current = Number(tunable.get());
            if (!Number.isFinite(current)) {
                appendConsoleHistory(`${key} is not numeric`, 'error');
                return;
            }
            const delta = Number(args[1]);
            const next = current + (Number.isFinite(delta) ? delta : 1);
            const updated = tunable.set(next);
            appendConsoleHistory(`${key} -> ${String(updated)}`, 'ok');
        },
    });

    registerConsoleCommand('tp', {
        modes: [CONSOLE_MODE.DEV, CONSOLE_MODE.DM, CONSOLE_MODE.PLAYER],
        usage: 'tp <x> <y> <z>',
        description: 'Teleport local player actor to world coordinates',
        execute: (_ctx, args) => {
            if (args.length < 3) {
                appendConsoleHistory('Usage: tp <x> <y> <z>', 'error');
                return;
            }
            const x = Number(args[0]);
            const y = Number(args[1]);
            const z = Number(args[2]);
            if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
                appendConsoleHistory('tp requires numeric x y z', 'error');
                return;
            }
            playerState.position.set(x, y, z);
            playerState.prevPosition.copy(playerState.position);
            syncPlayerRigFromState();
            appendConsoleHistory(`Teleported to (${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)})`, 'ok');
        },
    });

    registerConsoleCommand('gamemode', {
        modes: [CONSOLE_MODE.DEV, CONSOLE_MODE.DM],
        usage: 'gamemode <combat|free>',
        description: 'Switch between combat and exploration mode quickly',
        execute: (_ctx, args) => {
            const mode = String(args[0] || '').toLowerCase();
            if (mode !== 'combat' && mode !== 'free') {
                appendConsoleHistory('Usage: gamemode <combat|free>', 'error');
                return;
            }
            runtimeTunables['combat.inCombat'].set(mode === 'combat');
            appendConsoleHistory(`Game mode set to ${mode}`, 'ok');
        },
    });

    registerConsoleCommand('phase', {
        modes: [CONSOLE_MODE.DEV, CONSOLE_MODE.DM],
        usage: 'phase <player|enemy|transition>',
        description: 'Set combat phase directly',
        execute: (_ctx, args) => {
            const phase = String(args[0] || '').toUpperCase();
            if (!['PLAYER', 'ENEMY', 'TRANSITION'].includes(phase)) {
                appendConsoleHistory('Usage: phase <player|enemy|transition>', 'error');
                return;
            }
            setCombatPhase(phase);
            updateCombatUI();
            appendConsoleHistory(`Combat phase set to ${phase}`, 'ok');
        },
    });

    registerConsoleCommand('authority', {
        modes: [CONSOLE_MODE.DEV, CONSOLE_MODE.DM],
        usage: 'authority <server|local-dm>',
        description: 'Set DM simulation authority source',
        execute: (_ctx, args) => {
            const next = String(args[0] || '').toLowerCase();
            if (next !== SIMULATION_AUTHORITY.SERVER && next !== SIMULATION_AUTHORITY.LOCAL_DM) {
                appendConsoleHistory('Usage: authority <server|local-dm>', 'error');
                return;
            }
            runtimeTunables['dm.authority'].set(next);
            appendConsoleHistory(`Authority set to ${simulationAuthority}`, 'ok');
        },
    });

    registerConsoleCommand('autostep', {
        modes: [CONSOLE_MODE.DEV, CONSOLE_MODE.DM],
        usage: 'autostep <on|off|toggle|status>',
        description: 'Control DM auto-step timeline behavior',
        execute: (_ctx, args) => {
            const op = String(args[0] || 'status').toLowerCase();
            if (op === 'status') {
                appendConsoleHistory(`autostep: ${dmAutoStepEnabled ? 'ON' : 'OFF'}`, 'ok');
                return;
            }
            if (op === 'toggle') {
                setDmAutoStepEnabled(!dmAutoStepEnabled);
                appendConsoleHistory(`autostep: ${dmAutoStepEnabled ? 'ON' : 'OFF'}`, 'ok');
                return;
            }
            if (op === 'on' || op === 'off') {
                setDmAutoStepEnabled(op === 'on');
                appendConsoleHistory(`autostep: ${dmAutoStepEnabled ? 'ON' : 'OFF'}`, 'ok');
                return;
            }
            appendConsoleHistory('Usage: autostep <on|off|toggle|status>', 'error');
        },
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

    const allowPlayerControl = mode === MODE.PLAYER || mode === MODE.DM;
    const inPlayerMode = mode === MODE.PLAYER;
    const inDmMode = mode === MODE.DM;

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

    if (mode === MODE.DM && !getControlledActor()) {
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
    registerDefaultConsoleCommands();
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

function clamp01(value) {
    return Math.max(0, Math.min(1, value));
}

function renderLoadingProgress(value) {
    if (!loadingOverlayProgressFill || !loadingOverlayProgressText) return;
    const percent = value * 100;
    loadingOverlayProgressFill.style.width = `${percent.toFixed(2)}%`;
    const pulse = 1 + (Math.sin((performance.now() * 0.013) + (percent * 0.05)) * 0.04);
    loadingOverlayProgressFill.style.transform = `scaleY(${pulse.toFixed(3)})`;
    loadingOverlayProgressText.textContent = `${percent.toFixed(1)}%`;
}

function animateLoadingProgressFrame() {
    loadingProgressAnimFrame = null;
    if (!loadingOverlayProgressFill || !loadingOverlayProgressText || loadingOverlayFinished) return;

    const delta = loadingProgressTarget - loadingProgressValue;
    if (Math.abs(delta) < 0.0005) {
        loadingProgressValue = loadingProgressTarget;
        renderLoadingProgress(loadingProgressValue);
        return;
    }

    // Critically damped easing: visually progressive and smooth without lagging too far behind.
    loadingProgressValue = clamp01(loadingProgressValue + (delta * 0.12));
    renderLoadingProgress(loadingProgressValue);
    loadingProgressAnimFrame = window.requestAnimationFrame(animateLoadingProgressFrame);
}

function ensureLoadingProgressAnimation() {
    if (loadingProgressAnimFrame !== null) return;
    loadingProgressAnimFrame = window.requestAnimationFrame(animateLoadingProgressFrame);
}

function setLoadingProgress(value) {
    loadingProgressTarget = clamp01(value);
    if (!loadingOverlayProgressFill || !loadingOverlayProgressText || loadingOverlayFinished) return;
    ensureLoadingProgressAnimation();
}

function updateLoadingState(statusText, progressValue) {
    if (loadingOverlayCloseScheduled || loadingOverlayFinished) return;
    if (typeof progressValue === 'number') {
        setLoadingProgress(progressValue);
    }
    setLoadingOverlayStatus(statusText);
}

function formatLoadingLogArgs(args) {
    return args.map((arg) => {
        if (typeof arg === 'string') return arg;
        if (arg instanceof Error) return arg.stack || arg.message;
        try {
            return JSON.stringify(arg);
        } catch (_err) {
            return String(arg);
        }
    }).join(' ');
}

function appendLoadingLog(level, args) {
    void level;
    void args;
}

function setLoadingOverlayStatus(text) {
    if (!loadingOverlayStatus || loadingOverlayFinished) return;
    const next = String(text || '').trim();
    if (!next) return;

    // Keep only the most recent message so the overlay does not backlog multiple silly lines.
    loadingStatusQueue.length = 0;
    loadingStatusQueue.push(next);

    const pump = () => {
        if (loadingOverlayFinished || !loadingOverlayStatus) {
            loadingStatusTimer = null;
            return;
        }
        if (loadingStatusQueue.length === 0) {
            loadingStatusTimer = null;
            return;
        }

        const now = performance.now();
        const sinceLast = now - loadingStatusLastShownAt;
        if (sinceLast < LOADING_STATUS_MIN_INTERVAL_MS) {
            loadingStatusTimer = window.setTimeout(pump, LOADING_STATUS_MIN_INTERVAL_MS - sinceLast);
            return;
        }

        const message = loadingStatusQueue.shift();
        loadingOverlayStatus.textContent = message;
        loadingStatusLastShownAt = performance.now();

        loadingOverlayStatus.style.animation = 'none';
        void loadingOverlayStatus.offsetWidth;
        loadingOverlayStatus.style.animation = 'loading-status-pop 520ms cubic-bezier(0.18, 0.88, 0.23, 1)';
        spawnLoadingMessageBurst(10);

        const jitterDelay = 40 + Math.round(Math.random() * 90);
        loadingStatusTimer = window.setTimeout(pump, jitterDelay);
    };

    if (!loadingStatusTimer) {
        const randomDelay = 70 + Math.round(Math.random() * 150);
        loadingStatusTimer = window.setTimeout(pump, randomDelay);
    }
}

function setLoadingOverlayQuote(text) {
    if (loadingOverlayFinished) return;
    const next = String(text || '').trim();
    if (!next) return;
    setLoadingOverlayStatus(next);
}

function ensureLoadingOverlayFxStyles() {
    if (loadingOverlayFxStylesInjected) return;
    if (!document.head) return;
    const style = document.createElement('style');
    style.id = 'loading-overlay-fx-style';
    style.textContent = `
@keyframes loading-status-pop {
    0% { transform: translateY(8px) scale(0.94) rotate(-0.6deg); opacity: 0.45; }
    44% { transform: translateY(0px) scale(1.03) rotate(0.45deg); opacity: 1; }
    100% { transform: translateY(0px) scale(1) rotate(0deg); opacity: 1; }
}
@keyframes loading-quote-bounce {
    0% { transform: translateX(-8px); opacity: 0.55; }
    45% { transform: translateX(4px); opacity: 1; }
    100% { transform: translateX(0px); opacity: 0.95; }
}
@keyframes loading-glyph-burst {
    0% { transform: translate(0px, 0px) scale(0.8) rotate(0deg); opacity: 0; }
    20% { opacity: 1; }
    100% { transform: translate(var(--tx), var(--ty)) scale(var(--s)) rotate(var(--r)); opacity: 0; }
}
@keyframes loading-card-jitter {
    0%, 100% { transform: translateY(0px) rotate(0deg); }
    14% { transform: translateY(-1.5px) rotate(0.22deg) skewX(0.3deg); }
    28% { transform: translateY(1.5px) rotate(-0.18deg); }
    42% { transform: translateY(-0.5px) rotate(0.08deg) skewX(-0.2deg); }
    57% { transform: translateY(1px) rotate(0.14deg); }
    71% { transform: translateY(-1.2px) rotate(-0.1deg) skewX(0.15deg); }
    85% { transform: translateY(0.6px) rotate(0.05deg); }
}
@keyframes loading-title-glitch {
    0%, 88%, 100% { text-shadow: 0 0 2px rgba(255,255,255,0.9), 0 0 22px rgba(83,184,255,0.45), 0 0 30px rgba(255,88,122,0.25), 0 6px 16px rgba(0,0,0,0.85); clip-path: none; transform: translateX(0); }
    89% { clip-path: inset(12% 0 80% 0); transform: translateX(-6px); text-shadow: 3px 0 #ff0066, -3px 0 #00ffff; color: #ff99bb; }
    90% { clip-path: none; transform: translateX(3px); }
    91% { clip-path: inset(72% 0 10% 0); transform: translateX(5px); text-shadow: -4px 0 #00ffff, 4px 0 #ff0066; color: #99eeff; }
    92% { clip-path: none; transform: translateX(0); text-shadow: 0 0 2px rgba(255,255,255,0.9), 0 0 22px rgba(83,184,255,0.45); }
    94% { clip-path: inset(35% 0 55% 0); transform: translateX(-3px) scaleX(1.02); color: #ffffff; }
    95% { clip-path: none; transform: translateX(0); }
}
@keyframes loading-scanline {
    0% { background-position: 0 0; }
    100% { background-position: 0 200px; }
}
@keyframes loading-scanline-sweep {
    0% { top: -4px; opacity: 0.14; }
    80% { opacity: 0.22; }
    100% { top: 100%; opacity: 0; }
}
@keyframes loading-flicker {
    0%, 19%, 21%, 23%, 62%, 64%, 100% { opacity: 1; }
    20% { opacity: 0.55; }
    22% { opacity: 0.88; }
    63% { opacity: 0.6; }
}
@keyframes loading-card-hard-glitch {
    0%, 100% { clip-path: none; transform: translateX(0); filter: none; }
    5% { clip-path: inset(6% 0 88% 0); transform: translateX(-8px); filter: hue-rotate(120deg) brightness(1.6); }
    6% { clip-path: none; transform: translateX(4px); filter: none; }
    7% { clip-path: inset(78% 0 6% 0); transform: translateX(-4px); filter: hue-rotate(240deg); }
    8% { clip-path: none; transform: translateX(0); }
    50% { clip-path: none; filter: none; }
    51% { clip-path: inset(45% 0 45% 0); transform: translateX(6px); filter: saturate(3) hue-rotate(60deg); }
    52% { clip-path: none; transform: translateX(0); filter: none; }
}
@keyframes loading-rgb-split {
    0%, 100% { transform: translate(0, 0); opacity: 0.18; }
    25% { transform: translate(-3px, 0); opacity: 0.28; }
    50% { transform: translate(3px, 1px); opacity: 0.22; }
    75% { transform: translate(-1px, -1px); opacity: 0.15; }
}
@keyframes loading-dice-spin {
    0% { transform: rotateY(0deg) scale(0.4) translateY(-6px); opacity: 0; }
    25% { opacity: 1; }
    75% { transform: rotateY(540deg) scale(1.15) translateY(-2px); }
    100% { transform: rotateY(720deg) scale(1) translateY(0px); opacity: 1; }
}
@keyframes loading-dice-settle {
    0% { transform: scale(1.18) rotate(-6deg); }
    35% { transform: scale(0.88) rotate(4deg); }
    65% { transform: scale(1.06) rotate(-2deg); }
    100% { transform: scale(1) rotate(0deg); }
}
@keyframes loading-dice-glow {
    0%, 100% { filter: drop-shadow(0 0 4px #ffd700) drop-shadow(0 0 10px #ff8800); }
    50% { filter: drop-shadow(0 0 8px #ffffff) drop-shadow(0 0 18px #ffd700); }
}
`;
    document.head.appendChild(style);
    loadingOverlayFxStylesInjected = true;
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
    if (!loadingOverlayQuote || loadingOverlayFinished) return;
    if (loadingQuoteTimer) {
        window.clearInterval(loadingQuoteTimer);
        loadingQuoteTimer = null;
    }

    const pickQuote = () => {
        const quote = LOADING_NONSENSE_QUOTES[loadingQuoteIndex % LOADING_NONSENSE_QUOTES.length];
        loadingQuoteIndex += 1;
        setLoadingOverlayQuote(quote);
    };

    pickQuote();
    loadingQuoteTimer = window.setInterval(pickQuote, LOADING_QUOTE_INTERVAL_MS);
}

function animateLoadingBackdropFrame() {
    loadingBackdropAnimFrame = null;
    if (!loadingOverlayRoot || !loadingOverlayCard || loadingOverlayFinished) return;

    const t = performance.now() * 0.00055;
    const x = 50 + (Math.sin(t * 1.4) * 18);
    const y = 24 + (Math.cos(t * 1.1) * 11);
    const hue = Math.round((Math.sin(t * 0.8) * 10) + 3);

    loadingOverlayRoot.style.background = `radial-gradient(circle at ${x.toFixed(1)}% ${y.toFixed(1)}%, rgba(255,77,109,0.24), rgba(18,21,38,0.94) 42%, rgba(5,7,18,0.99) 100%)`;
    loadingOverlayCard.style.filter = `hue-rotate(${hue}deg)`;

    if (loadingOverlayAccentBar) {
        const pulse = 0.92 + (Math.sin(t * 3.6) * 0.08);
        loadingOverlayAccentBar.style.transform = `scaleX(${pulse.toFixed(3)})`;
    }

    loadingBackdropAnimFrame = window.requestAnimationFrame(animateLoadingBackdropFrame);
}

function startLoadingBackdropAnimation() {
    if (loadingBackdropAnimFrame !== null) return;
    loadingBackdropAnimFrame = window.requestAnimationFrame(animateLoadingBackdropFrame);
}

function startLoadingVarietyCycle() {
    if (loadingFlavorTimer) {
        window.clearInterval(loadingFlavorTimer);
        loadingFlavorTimer = null;
    }

    loadingFlavorTimer = window.setInterval(() => {
        if (loadingOverlayFinished || !loadingOverlayRoot) return;
        const roll = Math.random();

        if (roll < 0.28) {
            const status = LOADING_VARIETY_STATUSES[Math.floor(Math.random() * LOADING_VARIETY_STATUSES.length)];
            setLoadingOverlayStatus(status);
            return;
        }

        if (roll < 0.5) {
            const quote = LOADING_VARIETY_QUOTES[Math.floor(Math.random() * LOADING_VARIETY_QUOTES.length)];
            setLoadingOverlayStatus(quote);
            return;
        }

        if (roll < 0.7) {
            setLoadingOverlayStatus(`Showtime pulse #${(loadingBurstCounter % 9) + 1}: increasing dramatic tension...`);
            spawnLoadingMessageBurst(10 + Math.floor(Math.random() * 12));
            return;
        }

        if (roll < 0.78) {
            // Re-roll the dice tray
            const diceNames = ['d4','d6','d8','d10','d12','d20'];
            const die = diceNames[Math.floor(Math.random() * diceNames.length)];
            const max = parseInt(die.slice(1));
            const result = Math.floor(Math.random() * max) + 1;
            const flavour = result === max ? '💥 NATURAL MAX!' : result === 1 ? '💀 rolled a 1...' : `rolled ${die}: ${result}`;
            setLoadingOverlayStatus(flavour);
            if (loadingDiceTray) rollAllLoadingDice();
            return;
        }

        if (roll < 0.86) {
            const progressNudge = (Math.random() * 0.03) - 0.012;
            setLoadingProgress(clamp01(loadingProgressTarget + progressNudge));
            setLoadingOverlayStatus('Buffering extra swagger into the loading bar...');
            return;
        }

        spawnLoadingMessageBurst(16 + Math.floor(Math.random() * 10));
    }, 920);
}

function finishLoadingOverlay(message = 'Ready') {
    if (!loadingOverlayRoot || loadingOverlayFinished || loadingOverlayCloseScheduled) return;
    loadingOverlayCloseScheduled = true;

    const startProgress = loadingProgressValue;
    const progressStartAt = performance.now();
    const progressDuration = 900;
    const animateProgress = () => {
        if (loadingOverlayFinished) return;
        const elapsed = performance.now() - progressStartAt;
        const t = clamp01(elapsed / progressDuration);
        const eased = 1 - Math.pow(1 - t, 3);
        setLoadingProgress(startProgress + ((1 - startProgress) * eased));
        if (t < 1) {
            window.requestAnimationFrame(animateProgress);
        }
    };
    window.requestAnimationFrame(animateProgress);

    const elapsedVisible = performance.now() - loadingOverlayStartedAt;
    const remainingToMinVisible = Math.max(0, LOADING_MIN_VISIBLE_MS - elapsedVisible);
    setLoadingOverlayStatus(`${message} - finalizing visuals...`);

    // Add one last playful fakeout sequence before fade.
    window.setTimeout(() => {
        if (loadingOverlayFinished) return;
        setLoadingOverlayStatus('99.2% - polishing boss-level dramatic timing...');
        spawnLoadingMessageBurst(18);
    }, Math.max(120, remainingToMinVisible * 0.2));
    window.setTimeout(() => {
        if (loadingOverlayFinished) return;
        setLoadingOverlayStatus('99.8% - pretending this is the final pass...');
        spawnLoadingMessageBurst(14);
    }, Math.max(260, remainingToMinVisible * 0.45));
    window.setTimeout(() => {
        if (loadingOverlayFinished) return;
        setLoadingOverlayStatus(`${message} - absolutely final pass for real this time.`);
        spawnLoadingMessageBurst(20);
    }, Math.max(420, remainingToMinVisible * 0.7));

    const closeDelay = remainingToMinVisible + LOADING_POST_COMPLETE_HOLD_MS;
    window.setTimeout(() => {
        if (!loadingOverlayRoot || loadingOverlayFinished) return;
        setLoadingOverlayStatus(message);
        spawnLoadingMessageBurst(20);
        window.setTimeout(() => {
            spawnLoadingMessageBurst(26);
        }, 220);
        loadingOverlayRoot.style.opacity = '0';

        window.setTimeout(() => {
            loadingOverlayFinished = true;
            if (loadingLogFlushTimer) {
                window.clearInterval(loadingLogFlushTimer);
                loadingLogFlushTimer = null;
            }
            if (loadingQuoteTimer) {
                window.clearInterval(loadingQuoteTimer);
                loadingQuoteTimer = null;
            }
            if (loadingFlavorTimer) {
                window.clearInterval(loadingFlavorTimer);
                loadingFlavorTimer = null;
            }
            if (loadingDiceRollTimer) {
                window.clearInterval(loadingDiceRollTimer);
                loadingDiceRollTimer = null;
            }
            if (loadingStatusTimer) {
                window.clearTimeout(loadingStatusTimer);
                loadingStatusTimer = null;
            }
            if (loadingProgressAnimFrame !== null) {
                window.cancelAnimationFrame(loadingProgressAnimFrame);
                loadingProgressAnimFrame = null;
            }
            if (loadingBackdropAnimFrame !== null) {
                window.cancelAnimationFrame(loadingBackdropAnimFrame);
                loadingBackdropAnimFrame = null;
            }
            if (loadingOverlayRoot && loadingOverlayRoot.parentElement) {
                loadingOverlayRoot.parentElement.removeChild(loadingOverlayRoot);
            }
            // Keep main theme running into free roam after loading completes.
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
            loadingStatusQueue.length = 0;
            updateDmControlPanel();
        }, LOADING_FADE_DURATION_MS);
    }, closeDelay);
}

function startMainTheme() {
    try {
        if (!mainThemeAudio) {
            mainThemeAudio = new Audio('/static/maintheme.wav');
            mainThemeAudio.loop = true;
            mainThemeAudio.volume = 0;
            mainThemeAudio.preload = 'auto';
        }
        const playPromise = mainThemeAudio.play();
        if (playPromise && typeof playPromise.then === 'function') {
            playPromise.then(() => {
                const targetVol = 0.45;
                const steps = 30;
                const stepMs = 60;
                let step = 0;
                const fadeIn = setInterval(() => {
                    step += 1;
                    mainThemeAudio.volume = Math.min(targetVol, (step / steps) * targetVol);
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

function stopMainTheme() {
    if (!mainThemeAudio) return;
    try {
        const audio = mainThemeAudio;
        const steps = 30;
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

function createLoadingOverlay() {
    ensureLoadingOverlayFxStyles();
    loadingOverlayStartedAt = performance.now();
    startMainTheme();
    loadingOverlayRoot = document.createElement('div');
    loadingOverlayRoot.style.position = 'fixed';
    loadingOverlayRoot.style.inset = '0';
    loadingOverlayRoot.style.zIndex = '99999';
    loadingOverlayRoot.style.display = 'flex';
    loadingOverlayRoot.style.flexDirection = 'column';
    loadingOverlayRoot.style.justifyContent = 'center';
    loadingOverlayRoot.style.alignItems = 'center';
    loadingOverlayRoot.style.padding = 'clamp(10px, 2vw, 24px)';
    loadingOverlayRoot.style.background = 'radial-gradient(circle at 15% 12%, rgba(255,77,109,0.24), rgba(18,21,38,0.94) 42%, rgba(5,7,18,0.99) 100%)';
    loadingOverlayRoot.style.color = '#e8f2ff';
    loadingOverlayRoot.style.fontFamily = '"Noto Sans JP", "Hiragino Kaku Gothic ProN", "Yu Gothic", "Meiryo", sans-serif';
    loadingOverlayRoot.style.fontSize = 'clamp(16px, 1.3vw, 24px)';
    loadingOverlayRoot.style.transition = 'opacity 0.45s ease';

    const card = document.createElement('div');
    loadingOverlayCard = card;
    card.style.width = '100%';
    card.style.height = '100%';
    card.style.maxWidth = 'none';
    card.style.maxHeight = 'none';
    card.style.display = 'flex';
    card.style.flexDirection = 'column';
    card.style.gap = 'clamp(10px, 1.6vh, 18px)';
    card.style.padding = 'clamp(16px, 2.4vw, 34px)';
    card.style.borderRadius = 'clamp(14px, 1.3vw, 24px)';
    card.style.border = '2px solid rgba(115, 206, 255, 0.6)';
    card.style.background = 'linear-gradient(180deg, rgba(10,14,29,0.9), rgba(7,9,20,0.94))';
    card.style.boxShadow = '0 24px 80px rgba(0,0,0,0.62), inset 0 0 0 2px rgba(255,255,255,0.05), inset 0 14px 24px rgba(255,77,109,0.08), 0 0 36px rgba(83,184,255,0.22)';
    card.style.animation = 'none';
    card.style.position = 'relative';
    loadingOverlayRoot.appendChild(card);

    loadingOverlayFxLayer = document.createElement('div');
    loadingOverlayFxLayer.style.position = 'absolute';
    loadingOverlayFxLayer.style.inset = '0';
    loadingOverlayFxLayer.style.pointerEvents = 'none';
    loadingOverlayFxLayer.style.overflow = 'hidden';
    loadingOverlayFxLayer.style.zIndex = '3';
    card.appendChild(loadingOverlayFxLayer);

    const accentBar = document.createElement('div');
    loadingOverlayAccentBar = accentBar;
    accentBar.style.height = 'clamp(6px, 0.8vh, 10px)';
    accentBar.style.borderRadius = '999px';
    accentBar.style.background = 'linear-gradient(90deg, rgba(255,77,109,0.95), rgba(255,188,66,0.9), rgba(78,214,255,0.95))';
    accentBar.style.boxShadow = '0 0 20px rgba(255,77,109,0.45), 0 0 18px rgba(78,214,255,0.35)';
    card.appendChild(accentBar);

    // Scanlines overlay
    const scanlineOverlay = document.createElement('div');
    scanlineOverlay.style.position = 'absolute';
    scanlineOverlay.style.inset = '0';
    scanlineOverlay.style.zIndex = '5';
    scanlineOverlay.style.pointerEvents = 'none';
    scanlineOverlay.style.borderRadius = 'inherit';
    scanlineOverlay.style.background = 'repeating-linear-gradient(to bottom, transparent 0px, transparent 3px, rgba(0,0,0,0.14) 3px, rgba(0,0,0,0.14) 4px)';
    scanlineOverlay.style.animation = 'loading-scanline 1.8s linear infinite, loading-flicker 5.2s step-start infinite';
    card.appendChild(scanlineOverlay);

    // Scanline sweep (single bright line passing top to bottom)
    const scanlineSweep = document.createElement('div');
    scanlineSweep.style.position = 'absolute';
    scanlineSweep.style.left = '0';
    scanlineSweep.style.right = '0';
    scanlineSweep.style.height = '4px';
    scanlineSweep.style.background = 'linear-gradient(to right, transparent, rgba(78,214,255,0.6), transparent)';
    scanlineSweep.style.pointerEvents = 'none';
    scanlineSweep.style.zIndex = '6';
    scanlineSweep.style.animation = 'loading-scanline-sweep 3.1s linear infinite';
    card.appendChild(scanlineSweep);

    // Title wrapper (for RGB split layers)
    const titleWrap = document.createElement('div');
    titleWrap.style.position = 'relative';
    titleWrap.style.lineHeight = '1.08';
    card.appendChild(titleWrap);

    // RGB ghost layers (chromatic aberration)
    ['#ff005580', '#00ffff55'].forEach((col, i) => {
        const ghost = document.createElement('div');
        ghost.textContent = 'PARAVAL ENGINE';
        ghost.style.position = 'absolute';
        ghost.style.inset = '0';
        ghost.style.fontSize = 'clamp(36px, 6.2vw, 82px)';
        ghost.style.fontWeight = '900';
        ghost.style.letterSpacing = '1.8px';
        ghost.style.color = col;
        ghost.style.pointerEvents = 'none';
        ghost.style.userSelect = 'none';
        ghost.style.animation = `loading-rgb-split ${1.4 + i * 0.7}s ease-in-out infinite`;
        ghost.style.animationDelay = `${i * 0.3}s`;
        titleWrap.appendChild(ghost);
    });

    const title = document.createElement('div');
    title.textContent = 'PARAVAL ENGINE';
    title.style.fontSize = 'clamp(36px, 6.2vw, 82px)';
    title.style.fontWeight = '900';
    title.style.letterSpacing = '1.8px';
    title.style.lineHeight = '1.08';
    title.style.color = '#ffffff';
    title.style.position = 'relative';
    title.style.zIndex = '1';
    title.style.textShadow = '0 0 2px rgba(255,255,255,0.9), 0 0 22px rgba(83,184,255,0.45), 0 0 30px rgba(255,88,122,0.25), 0 6px 16px rgba(0,0,0,0.85)';
    title.style.animation = 'loading-title-glitch 7.3s steps(1) infinite';
    titleWrap.appendChild(title);

    const progressHeader = document.createElement('div');
    progressHeader.style.display = 'flex';
    progressHeader.style.justifyContent = 'space-between';
    progressHeader.style.alignItems = 'center';
    progressHeader.style.color = '#cae6ff';
    progressHeader.style.fontSize = 'clamp(17px, 2.1vw, 32px)';

    const progressLabel = document.createElement('span');
    progressLabel.textContent = '加载进度  //  Progress';
    progressHeader.appendChild(progressLabel);

    loadingOverlayProgressText = document.createElement('span');
    loadingOverlayProgressText.textContent = '0%';
    progressHeader.appendChild(loadingOverlayProgressText);
    card.appendChild(progressHeader);

    const progressTrack = document.createElement('div');
    progressTrack.style.height = 'clamp(14px, 2.3vh, 28px)';
    progressTrack.style.borderRadius = '999px';
    progressTrack.style.overflow = 'hidden';
    progressTrack.style.background = 'rgba(70, 103, 156, 0.25)';
    progressTrack.style.border = '2px solid rgba(128, 196, 255, 0.55)';

    loadingOverlayProgressFill = document.createElement('div');
    loadingOverlayProgressFill.style.height = '100%';
    loadingOverlayProgressFill.style.width = '0%';
    loadingOverlayProgressFill.style.background = 'linear-gradient(90deg, #ff4d6d, #ffbc42 46%, #4ed6ff)';
    loadingOverlayProgressFill.style.boxShadow = '0 0 18px rgba(255,77,109,0.42), 0 0 18px rgba(78,214,255,0.4), inset 0 0 10px rgba(255,255,255,0.2)';
    loadingOverlayProgressFill.style.transition = 'none';
    loadingOverlayProgressFill.style.transformOrigin = 'left center';
    progressTrack.appendChild(loadingOverlayProgressFill);
    card.appendChild(progressTrack);

    loadingOverlayStatus = document.createElement('div');
    loadingOverlayStatus.textContent = '正在初始化渲染器和资源...';
    loadingOverlayStatus.style.color = '#bfe3ff';
    loadingOverlayStatus.style.fontSize = 'clamp(20px, 2.4vw, 36px)';
    loadingOverlayStatus.style.minHeight = 'clamp(24px, 3vh, 40px)';
    loadingOverlayStatus.style.fontWeight = '800';
    loadingOverlayStatus.style.letterSpacing = '0.8px';
    card.appendChild(loadingOverlayStatus);

    loadingOverlayQuote = document.createElement('div');
    loadingOverlayQuote.textContent = '系统正在校准... // preparing scene vectors...';
    loadingOverlayQuote.style.color = '#e7f1ff';
    loadingOverlayQuote.style.fontSize = 'clamp(17px, 1.95vw, 32px)';
    loadingOverlayQuote.style.minHeight = 'clamp(22px, 3vh, 36px)';
    loadingOverlayQuote.style.fontStyle = 'normal';
    loadingOverlayQuote.style.opacity = '0.95';
    loadingOverlayQuote.style.letterSpacing = '0.5px';
    card.appendChild(loadingOverlayQuote);

    loadingOverlayLog = null;

    // Dice tray panel
    loadingDiceTray = document.createElement('div');
    loadingDiceTray.style.display = 'flex';
    loadingDiceTray.style.gap = 'clamp(8px, 1.2vw, 18px)';
    loadingDiceTray.style.alignItems = 'center';
    loadingDiceTray.style.justifyContent = 'center';
    loadingDiceTray.style.padding = '6px 0 2px';
    loadingDiceTray.style.minHeight = 'clamp(60px, 8vh, 90px)';
    loadingDiceTray.style.flexShrink = '0';
    card.appendChild(loadingDiceTray);

    document.body.appendChild(loadingOverlayRoot);
    loadingProgressValue = 0;
    loadingProgressTarget = 0;
    loadingQuoteIndex = 0;
    renderLoadingProgress(0);
    setLoadingProgress(0.02);
    if (loadingOverlayQuote) {
        loadingOverlayQuote.textContent = '';
        loadingOverlayQuote.style.minHeight = '0';
        loadingOverlayQuote.style.opacity = '0';
    }
    startLoadingVarietyCycle();
    startLoadingBackdropAnimation();
    spawnLoadingMessageBurst(14);
    rollAllLoadingDice();
    startLoadingDiceRollCycle();
}

// Build an inline SVG die face
function buildDieSvg(dieType, value) {
    const shapes = {
        d4:  { vb: '0 0 60 56', pts: '30,3 58,53 2,53', cy: '42' },
        d6:  { vb: '0 0 60 60', pts: '5,5 55,5 55,55 5,55', cy: '50%' },
        d8:  { vb: '0 0 60 60', pts: '30,3 57,30 30,57 3,30', cy: '50%' },
        d10: { vb: '0 0 60 66', pts: '30,3 58,26 46,63 14,63 2,26', cy: '52%' },
        d12: { vb: '0 0 64 64', pts: '32,3 62,22 50,59 14,59 2,22', cy: '50%' },
        d20: { vb: '0 0 70 62', pts: '35,3 68,58 2,58', cy: '54%' },
    };
    const cfg = shapes[dieType] || shapes.d6;
    const colors = {
        d4: '#ff6b6b', d6: '#4ed6ff', d8: '#ffd700',
        d10: '#c084fc', d12: '#6bffb8', d20: '#ff9f43',
    };
    const strokeCol = colors[dieType] || '#4ed6ff';
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', cfg.vb);
    svg.setAttribute('width', '52');
    svg.setAttribute('height', '52');
    svg.style.overflow = 'visible';
    svg.style.filter = `drop-shadow(0 0 5px ${strokeCol})`;

    const poly = document.createElementNS(ns, 'polygon');
    poly.setAttribute('points', cfg.pts);
    poly.setAttribute('fill', 'rgba(6,12,30,0.95)');
    poly.setAttribute('stroke', strokeCol);
    poly.setAttribute('stroke-width', '3');
    poly.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(poly);

    const label = document.createElementNS(ns, 'text');
    label.setAttribute('x', '50%');
    label.setAttribute('y', cfg.cy);
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('dominant-baseline', 'middle');
    label.setAttribute('fill', strokeCol);
    label.setAttribute('font-size', value >= 10 ? '17' : '20');
    label.setAttribute('font-weight', '900');
    label.setAttribute('font-family', 'Consolas, monospace');
    label.textContent = String(value);
    svg.appendChild(label);

    return svg;
}

function rollAllLoadingDice() {
    if (!loadingDiceTray || loadingOverlayFinished) return;
    loadingDiceTray.innerHTML = '';
    const dieTypes = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20'];
    const maxRolls = { d4: 4, d6: 6, d8: 8, d10: 10, d12: 12, d20: 20 };

    dieTypes.forEach((dieType, idx) => {
        const max = maxRolls[dieType];
        const finalValue = Math.floor(Math.random() * max) + 1;

        const wrapper = document.createElement('div');
        wrapper.style.display = 'flex';
        wrapper.style.flexDirection = 'column';
        wrapper.style.alignItems = 'center';
        wrapper.style.gap = '3px';
        wrapper.style.opacity = '0';
        wrapper.style.transition = `opacity 120ms ease ${idx * 60}ms`;

        const svgEl = buildDieSvg(dieType, Math.floor(Math.random() * max) + 1);
        svgEl.style.animation = 'loading-dice-spin 480ms cubic-bezier(0.22, 0.8, 0.36, 1) forwards';
        svgEl.style.animationDelay = `${idx * 55}ms`;
        wrapper.appendChild(svgEl);

        const lbl = document.createElement('div');
        lbl.textContent = dieType.toUpperCase();
        lbl.style.fontSize = '10px';
        lbl.style.fontFamily = 'Consolas, monospace';
        lbl.style.color = '#7ab8dd';
        lbl.style.letterSpacing = '1px';
        wrapper.appendChild(lbl);

        loadingDiceTray.appendChild(wrapper);
        window.requestAnimationFrame(() => { wrapper.style.opacity = '1'; });

        // Rapid-fire random values while spinning, then settle on final
        let rollCount = 0;
        const rollInterval = window.setInterval(() => {
            if (loadingOverlayFinished) { window.clearInterval(rollInterval); return; }
            rollCount++;
            const rollingVal = Math.floor(Math.random() * max) + 1;
            const newSvg = buildDieSvg(dieType, rollingVal);
            if (wrapper.firstChild) wrapper.replaceChild(newSvg, wrapper.firstChild);

            if (rollCount >= 6) {
                window.clearInterval(rollInterval);
                const settledSvg = buildDieSvg(dieType, finalValue);
                settledSvg.style.animation = 'loading-dice-settle 320ms ease-out forwards, loading-dice-glow 2.2s ease-in-out infinite';
                settledSvg.style.animationDelay = '0ms, 100ms';
                if (wrapper.firstChild) wrapper.replaceChild(settledSvg, wrapper.firstChild);
            }
        }, 75 + idx * 10);
    });
}

function startLoadingDiceRollCycle() {
    if (loadingDiceRollTimer) { window.clearInterval(loadingDiceRollTimer); }
    loadingDiceRollTimer = window.setInterval(() => {
        if (loadingOverlayFinished || !loadingDiceTray) {
            window.clearInterval(loadingDiceRollTimer);
            loadingDiceRollTimer = null;
            return;
        }
        rollAllLoadingDice();
    }, 4200);
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
    const isLocalPlayer = !!(effectiveLocalId && player.id === effectiveLocalId);

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
    if (Number.isFinite(Number(player.combatSync?.player?.hp))) {
        avatarRoot.userData.hp = Math.max(0, Number(player.combatSync.player.hp));
    }
    if (Number.isFinite(Number(player.combatSync?.player?.maxHp))) {
        avatarRoot.userData.maxHp = Math.max(1, Number(player.combatSync.player.maxHp));
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
    if (Number.isFinite(Number(player.maxHp))) {
        avatarRoot.userData.maxHp = Math.max(1, Number(player.maxHp));
    } else if (!Number.isFinite(Number(avatarRoot.userData.maxHp))) {
        avatarRoot.userData.maxHp = 100;
    }
    if (Number.isFinite(Number(player.hp))) {
        avatarRoot.userData.hp = Math.max(0, Math.min(avatarRoot.userData.maxHp, Number(player.hp)));
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
            if (currentAction === 'move' || (!currentAction && currentTurnPhase === TURN_PHASE.PLAYER)) {
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
    if (!(currentAction === 'move' || !currentAction && currentTurnPhase === TURN_PHASE.PLAYER)) return;

    const hit = raycaster.intersectObject(moveZoneDisc, false)[0];
    if (!hit || !hit.point) return;

    const snapped = snapToMoveGrid(hit.point.x, hit.point.z);

    // If a move choice is already open for this snapped tile, confirm it directly.
    if (
        combatInteraction.awaitingConfirm &&
        (combatInteraction.action === 'move' || combatInteraction.action === 'move-to-approach' || combatInteraction.action === 'move-and-attack') &&
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
const MOBILE_TOUCH_ENABLED = ('ontouchstart' in window) || ((navigator && navigator.maxTouchPoints) ? navigator.maxTouchPoints > 0 : false);
const MOBILE_TOUCH_MAX_WIDTH = 900;
const MOBILE_TOUCH_PAD_SIZE = 180;
const MOBILE_TOUCH_STICK_SIZE = 88;
const MOBILE_TOUCH_PAD_OFFSET_X = 20;
const MOBILE_TOUCH_PAD_OFFSET_BOTTOM = 20;
const TOUCH_MOVE_DEADZONE = 0.22;
const TOUCH_LOOK_DEADZONE = 0.08;
const TOUCH_LOOK_SPEED = 2.45;
let touchControlsRootEl = null;
let touchMovePadEl = null;
let touchMoveStickEl = null;
let touchLookPadEl = null;
let touchLookStickEl = null;
let touchMovePointerId = null;
let touchLookPointerId = null;
const touchMoveAxis = new THREE.Vector2(0, 0);
const touchLookAxis = new THREE.Vector2(0, 0);

function isMobileTouchScreenLayout() {
    if (!MOBILE_TOUCH_ENABLED) return false;
    if (window.matchMedia && window.matchMedia(`(max-width: ${MOBILE_TOUCH_MAX_WIDTH}px)`).matches) {
        return true;
    }
    const width = Number(window.innerWidth) || 0;
    const height = Number(window.innerHeight) || 0;
    return Math.min(width, height) > 0 && Math.min(width, height) <= MOBILE_TOUCH_MAX_WIDTH;
}

function resetTouchJoystickState() {
    touchMovePointerId = null;
    touchLookPointerId = null;
    if (touchMoveStickEl) touchMoveStickEl.style.transform = 'translate(-50%, -50%)';
    if (touchLookStickEl) touchLookStickEl.style.transform = 'translate(-50%, -50%)';
    resetTouchMoveState();
    resetTouchLookState();
    updateTouchMoveFlags();
}

function refreshMobileTouchControlsVisibility() {
    if (!touchControlsRootEl) return;
    const shouldShow = isMobileTouchScreenLayout();
    touchControlsRootEl.style.display = shouldShow ? 'block' : 'none';
    if (!shouldShow) {
        resetTouchJoystickState();
    }
}

function resetTouchMoveState() {
    touchMoveAxis.set(0, 0);
    moveForward = false;
    moveBackward = false;
    moveLeft = false;
    moveRight = false;
    dmFreeMoveForward = false;
    dmFreeMoveBackward = false;
    dmFreeMoveLeft = false;
    dmFreeMoveRight = false;
}

function resetTouchLookState() {
    touchLookAxis.set(0, 0);
}

function updateTouchMoveFlags() {
    if (Math.abs(touchMoveAxis.x) < TOUCH_MOVE_DEADZONE && Math.abs(touchMoveAxis.y) < TOUCH_MOVE_DEADZONE) {
        moveForward = false;
        moveBackward = false;
        moveLeft = false;
        moveRight = false;
        dmFreeMoveForward = false;
        dmFreeMoveBackward = false;
        dmFreeMoveLeft = false;
        dmFreeMoveRight = false;
        return;
    }

    const forward = touchMoveAxis.y < -TOUCH_MOVE_DEADZONE;
    const backward = touchMoveAxis.y > TOUCH_MOVE_DEADZONE;
    const left = touchMoveAxis.x < -TOUCH_MOVE_DEADZONE;
    const right = touchMoveAxis.x > TOUCH_MOVE_DEADZONE;

    if (isDmFreeCamera()) {
        dmFreeMoveForward = forward;
        dmFreeMoveBackward = backward;
        dmFreeMoveLeft = left;
        dmFreeMoveRight = right;
        moveForward = false;
        moveBackward = false;
        moveLeft = false;
        moveRight = false;
        return;
    }

    if (canUseStandardMovementControls()) {
        moveForward = forward;
        moveBackward = backward;
        moveLeft = left;
        moveRight = right;
    }
}

function applyTouchLookInput(delta) {
    if (!MOBILE_TOUCH_ENABLED || !isMobileTouchScreenLayout()) return;
    if (Math.abs(touchLookAxis.x) < TOUCH_LOOK_DEADZONE && Math.abs(touchLookAxis.y) < TOUCH_LOOK_DEADZONE) return;
    if (consoleState.open || isCombatReviewUiOpen()) return;

    const lookYaw = touchLookAxis.x * TOUCH_LOOK_SPEED * Math.max(0, delta);
    const lookPitch = touchLookAxis.y * TOUCH_LOOK_SPEED * Math.max(0, delta);

    if (isDmFreeCamera() && dmCamera) {
        dmCamera.rotation.order = 'YXZ';
        dmCamera.rotation.y -= lookYaw;
        dmCamera.rotation.x = Math.max(-1.45, Math.min(1.45, dmCamera.rotation.x - lookPitch));
        return;
    }

    if (!canUseStandardMovementControls()) return;
    yaw -= lookYaw;
    if (!combatCameraActive) {
        pitch -= lookPitch;
        pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pitch));
    }
    if (playerRig) {
        playerRig.rotation.y = yaw;
    }
    if (!combatCameraActive) {
        camera.rotation.x = pitch;
    }
}

function setTouchPadAxisFromEvent(padEl, stickEl, touch, axisVec) {
    if (!padEl || !stickEl || !touch) return;
    const rect = padEl.getBoundingClientRect();
    const cx = rect.left + (rect.width * 0.5);
    const cy = rect.top + (rect.height * 0.5);
    const maxRadius = rect.width * 0.35;
    let dx = touch.clientX - cx;
    let dy = touch.clientY - cy;
    const len = Math.hypot(dx, dy);
    if (len > maxRadius && len > 0.0001) {
        const s = maxRadius / len;
        dx *= s;
        dy *= s;
    }
    axisVec.set(dx / Math.max(1, maxRadius), dy / Math.max(1, maxRadius));
    stickEl.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
}

function createMobileTouchControls() {
    if (!MOBILE_TOUCH_ENABLED || touchControlsRootEl) return;

    const root = document.createElement('div');
    root.id = 'mobile-touch-controls';
    root.style.position = 'fixed';
    root.style.inset = '0';
    root.style.pointerEvents = 'none';
    root.style.zIndex = '2600';

    const createPad = (left, right) => {
        const pad = document.createElement('div');
        pad.style.position = 'absolute';
        if (left !== null) pad.style.left = left;
        if (right !== null) pad.style.right = right;
        pad.style.bottom = `${MOBILE_TOUCH_PAD_OFFSET_BOTTOM}px`;
        pad.style.width = `${MOBILE_TOUCH_PAD_SIZE}px`;
        pad.style.height = `${MOBILE_TOUCH_PAD_SIZE}px`;
        pad.style.borderRadius = '999px';
        pad.style.background = 'rgba(18, 26, 42, 0.45)';
        pad.style.border = '1px solid rgba(160, 200, 255, 0.55)';
        pad.style.backdropFilter = 'blur(3px)';
        pad.style.touchAction = 'none';
        pad.style.pointerEvents = 'auto';

        const stick = document.createElement('div');
        stick.style.position = 'absolute';
        stick.style.left = '50%';
        stick.style.top = '50%';
        stick.style.width = `${MOBILE_TOUCH_STICK_SIZE}px`;
        stick.style.height = `${MOBILE_TOUCH_STICK_SIZE}px`;
        stick.style.borderRadius = '999px';
        stick.style.transform = 'translate(-50%, -50%)';
        stick.style.background = 'rgba(160, 205, 255, 0.24)';
        stick.style.border = '1px solid rgba(190, 225, 255, 0.75)';
        stick.style.boxShadow = '0 0 16px rgba(110, 170, 255, 0.4)';
        pad.appendChild(stick);

        root.appendChild(pad);
        return { pad, stick };
    };

    const leftPad = createPad(`${MOBILE_TOUCH_PAD_OFFSET_X}px`, null);
    const rightPad = createPad(null, `${MOBILE_TOUCH_PAD_OFFSET_X}px`);

    touchMovePadEl = leftPad.pad;
    touchMoveStickEl = leftPad.stick;
    touchLookPadEl = rightPad.pad;
    touchLookStickEl = rightPad.stick;

    touchMovePadEl.addEventListener('touchstart', (event) => {
        if (isTextInputTarget(event.target) || consoleState.open) return;
        if (touchMovePointerId !== null) return;
        const touch = event.changedTouches && event.changedTouches[0];
        if (!touch) return;
        touchMovePointerId = touch.identifier;
        setTouchPadAxisFromEvent(touchMovePadEl, touchMoveStickEl, touch, touchMoveAxis);
        updateTouchMoveFlags();
        event.preventDefault();
    }, { passive: false });

    touchMovePadEl.addEventListener('touchmove', (event) => {
        if (touchMovePointerId === null) return;
        for (const t of event.changedTouches) {
            if (t.identifier !== touchMovePointerId) continue;
            setTouchPadAxisFromEvent(touchMovePadEl, touchMoveStickEl, t, touchMoveAxis);
            updateTouchMoveFlags();
            event.preventDefault();
            break;
        }
    }, { passive: false });

    const endMove = (event) => {
        if (touchMovePointerId === null) return;
        for (const t of event.changedTouches) {
            if (t.identifier !== touchMovePointerId) continue;
            touchMovePointerId = null;
            touchMoveStickEl.style.transform = 'translate(-50%, -50%)';
            resetTouchMoveState();
            updateTouchMoveFlags();
            event.preventDefault();
            break;
        }
    };
    touchMovePadEl.addEventListener('touchend', endMove, { passive: false });
    touchMovePadEl.addEventListener('touchcancel', endMove, { passive: false });

    touchLookPadEl.addEventListener('touchstart', (event) => {
        if (isTextInputTarget(event.target) || consoleState.open) return;
        if (touchLookPointerId !== null) return;
        const touch = event.changedTouches && event.changedTouches[0];
        if (!touch) return;
        touchLookPointerId = touch.identifier;
        setTouchPadAxisFromEvent(touchLookPadEl, touchLookStickEl, touch, touchLookAxis);
        event.preventDefault();
    }, { passive: false });

    touchLookPadEl.addEventListener('touchmove', (event) => {
        if (touchLookPointerId === null) return;
        for (const t of event.changedTouches) {
            if (t.identifier !== touchLookPointerId) continue;
            setTouchPadAxisFromEvent(touchLookPadEl, touchLookStickEl, t, touchLookAxis);
            event.preventDefault();
            break;
        }
    }, { passive: false });

    const endLook = (event) => {
        if (touchLookPointerId === null) return;
        for (const t of event.changedTouches) {
            if (t.identifier !== touchLookPointerId) continue;
            touchLookPointerId = null;
            touchLookStickEl.style.transform = 'translate(-50%, -50%)';
            resetTouchLookState();
            event.preventDefault();
            break;
        }
    };
    touchLookPadEl.addEventListener('touchend', endLook, { passive: false });
    touchLookPadEl.addEventListener('touchcancel', endLook, { passive: false });

    document.body.appendChild(root);
    touchControlsRootEl = root;
    refreshMobileTouchControlsVisibility();
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
};

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

// ========== D&D Distance & Grid System ==========
const FEET_PER_UNIT = 5; // 1 Three.js unit = 5 feet (D&D standard)
const FEET_PER_SQUARE = 5; // D&D uses 5 ft increments
const COMBAT_TILE_FEET = 5; // 5-ft snap grid (D&D standard square)
// BG3-style zone colours
const MOVE_ZONE_COLOR  = 0x00e8ff;
const MOVE_DEST_COLOR  = 0x00ffcc;

// Convert Three.js units to feet
function unitsToFeet(units) {
    return units * FEET_PER_UNIT;
}

// Convert feet to Three.js units
function feetToUnits(feet) {
    return feet / FEET_PER_UNIT;
}

// Euclidean distance between two Vector3 positions (in units)
function getDistance(a, b) {
    return a.distanceTo(b);
}

// Euclidean distance between two Vector3 positions (in feet)
function getDistanceFeet(a, b) {
    return unitsToFeet(getDistance(a, b));
}

// Flat (XZ-only) distance in feet — ignores height difference for combat range checks
function getFlatDistanceFeet(a, b) {
    const dx = a.x - b.x;
    const dz = a.z - b.z;
    return unitsToFeet(Math.sqrt(dx * dx + dz * dz));
}

// Edge-to-edge distance in feet: flat distance minus both collider radii
// a = object with .position and optional .radius (in units)
// b = object with .position and optional .userData.radius (in units)
function getEdgeDistanceFeet(a, b) {
    const flat = getFlatDistanceFeet(a.position, b.position);
    const rA = a.radius || 0;
    const rB = (b.userData && b.userData.radius) || 0;
    return Math.max(0, flat - unitsToFeet(rA + rB));
}

// Combat distance tuning: values < 1 make actors effectively feel closer for combat checks.
const COMBAT_DISTANCE_SCALE = 0.85;

function getEffectiveCombatDistanceFeet(a, b) {
    return getEdgeDistanceFeet(a, b) * COMBAT_DISTANCE_SCALE;
}

// Convert distance to D&D grid squares (5 ft increments)
function getDistanceInSquares(a, b) {
    return Math.ceil(getDistanceFeet(a, b) / FEET_PER_SQUARE);
}

// Convert world position to grid coordinates (x, z only; y is height)
function worldToGrid(pos) {
    return {
        x: Math.round(pos.x / FEET_PER_UNIT),
        z: Math.round(pos.z / FEET_PER_UNIT),
        y: Math.round(pos.y / FEET_PER_UNIT),
    };
}

// Convert grid coordinates back to world position
function gridToWorld(grid, height = 0) {
    return new THREE.Vector3(
        grid.x * FEET_PER_UNIT,
        height || 0,
        grid.z * FEET_PER_UNIT
    );
}

// D&D grid distance (Chebyshev/max distance, allows diagonal)
// Returns distance in grid squares
function gridDistance(gridA, gridB) {
    const dx = Math.abs(gridA.x - gridB.x);
    const dz = Math.abs(gridA.z - gridB.z);
    return Math.max(dx, dz);
}

// D&D grid distance from world positions
function gridDistanceFromWorld(posA, posB) {
    const gridA = worldToGrid(posA);
    const gridB = worldToGrid(posB);
    return gridDistance(gridA, gridB);
}

// Range check in feet
function canReachInFeet(entityPos, targetPos, rangeInFeet) {
    return getDistanceFeet(entityPos, targetPos) <= rangeInFeet;
}

// Range check in grid squares
function canReachInSquares(entityPos, targetPos, rangeInSquares) {
    return gridDistanceFromWorld(entityPos, targetPos) <= rangeInSquares;
}

// Common D&D ranges
const DND_RANGES = {
    melee: 8,          // widened melee range for smoother close combat feel
    shortbow: 80,      // 80 feet
    longsword: 8,      // match widened melee range
    fireball: 150,     // 150 feet (casting range)
    spellRange30: 30,  // 30 feet
    spellRange60: 60,  // 60 feet
    spellRange120: 120,// 120 feet
    heavyCrossbow: 100,// 100 feet
};

const OPPORTUNITY_ATTACK_TRIGGER_CHANCE = 0.55;
const RETREAT_TRIP_TRIGGER_CHANCE = 0.2;
const RETREAT_TRIP_MOVE_PENALTY_FEET = 5;

// Visual nudge so training dummies sit on the floor instead of hovering.
const TRAINING_DUMMY_Y_OFFSET = -0.25;

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
const combatInteraction = {
    action: null,
    target: null,
    preview: null,
    autoApproachPreview: null,
    awaitingConfirm: false,
};
let confirmUI = null;

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

function turnPhaseToCombatPhase(phase) {
    if (phase === TURN_PHASE.ENEMY) return 'ENEMY';
    if (phase === TURN_PHASE.TRANSITION) return 'TRANSITION';
    return 'PLAYER';
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
    if (modeManager.current !== MODE.DM) return playerState;
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
    if (modeManager.current === MODE.DM) {
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
    const existingById = new Map(trainingDummies.map((dummy) => [dummy.userData?.actorId || dummy.userData?.name || '', dummy]));
    const snapshotNames = new Set(enemySnapshots.map((enemy) => enemy.name));
    for (const dummy of [...trainingDummies]) {
        const dummyName = dummy.userData?.name || '';
        if (!snapshotNames.has(dummyName)) {
            removeTrainingDummy(dummy);
        }
    }
    for (const enemyState of enemySnapshots) {
        let dummy = existingById.get(enemyState.actorId || enemyState.name);
        if (!dummy || !dummy.parent) {
            dummy = spawnTrainingDummy(
                enemyState.position?.x || 0,
                enemyState.position?.y || 0,
                enemyState.position?.z || 0,
                enemyState.name || 'Training Dummy'
            );
        }
        dummy.userData.actorId = enemyState.actorId || dummy.userData.actorId || `enemy-${combatActorIdCounter++}`;
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
    if (currentGameMode === GAME_MODE.COMBAT && combatState.phase === 'PLAYER') {
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

function rewindTurn() {
    if (combatReplayActive || combatState.timelineBusy) return false;
    if (combatTimeline.length < 2) return false;
    combatTimeline.pop();
    return loadSnapshot(combatTimeline.length - 1);
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
            beginDiceCinematic(8200);
            focusCameraOnAction(playerState, { strength: 1.45, durationMs: 1300 });
            await tweenCameraFov(43, 220);
            showFloatingText('CHARGE UP', '#ffd166', true, { anchorObject: playerRig });
            await timelineDelay(MELEE_TIMELINE_MS.windup, replayTiming);

            triggerSharedDiceRoll({ sides: 20, label: 'ATTACK', mod: resolution.attackBonus, raw: resolution.roll, total: resolution.total });
            if (target) spawnVisualDice(resolution.roll, 20, target, 'ATTACK ROLL');
            showFloatingText(`Roll: ${resolution.total}`, '#ffe08a', true, { anchorObject: target || playerRig });
            await timelineDelay(MELEE_TIMELINE_MS.rollHold, replayTiming);

            if (target) {
                focusCameraOnAction(target, { strength: 1.85, durationMs: 1350 });
                triggerLocalHammerAttackSwing();
            }
            await timelineDelay(MELEE_TIMELINE_MS.impactHold, replayTiming);
            await hitStop(120);
            if (target) displayAttackResult(resolution, target, true);
            await timelineDelay(MELEE_TIMELINE_MS.resultHold, replayTiming);

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
            await timelineDelay(MELEE_TIMELINE_MS.damageHold, replayTiming);
        } else if (actionRecord.attackType === 'ranged') {
            beginDiceCinematic(8000);
            focusCameraOnAction(playerState, { strength: 1.35, durationMs: 1250 });
            await tweenCameraFov(44, 220);
            showFloatingText('CHANNELING', '#66ccff', true, { anchorObject: playerRig });
            await timelineDelay(RANGED_TIMELINE_MS.windup, replayTiming);

            if (target) {
                focusOutcomeText('ARCANE SHOT', '#66ccff', 1400);
                showFloatingText('ARCANE SHOT', '#66ccff', true, { anchorObject: target });
            }
            const shot = target
                ? createTargetingLine(playerState.position.clone(), target.position.clone(), 0x66ccff, 1, { alwaysOnTop: true, opacity: 0.98 })
                : null;
            if (shot) scene.add(shot);
            await timelineDelay(RANGED_TIMELINE_MS.launchHold, replayTiming);
            if (shot && shot.parent) shot.parent.remove(shot);

            if (target) {
                focusCameraOnAction(target, { strength: 1.75, durationMs: 1300 });
                triggerEnemyFlinch(target);
                spawnImpactBurst(target.position, 0x66ccff, 26);
            }
            triggerCombatFlash('#66ccff', 0.12, 320);
            shakeScreen(0.18, 360);
            playCombatSfxCue('ranged-hit');
            await timelineDelay(RANGED_TIMELINE_MS.impactHold, replayTiming);
            await hitStop(120);

            focusOutcomeText(resolution.hit ? 'HIT' : 'MISS', resolution.hit ? '#00ff00' : '#ff4444', 1500);
            showFloatingText(resolution.hit ? 'HIT' : 'MISS', resolution.hit ? '#00ff00' : '#ff4444', true, { anchorObject: target || playerRig });
            await timelineDelay(RANGED_TIMELINE_MS.resultHold, replayTiming);

            if (resolution.hit && target) {
                showFloatingText(`-${resolution.totalDamage}`, '#ff6b6b', true, { anchorObject: target });
                logCombatEvent(`Replay: ranged hit ${target.userData.name || 'target'} for ${resolution.totalDamage}`, 'hit');
                if (actionRecord.targetDefeated) {
                    await playKillSequence(target);
                }
            } else {
                playCombatSfxCue('miss');
            }
            await timelineDelay(RANGED_TIMELINE_MS.damageHold, replayTiming);
        } else if (actionRecord.attackType === 'enemy-melee') {
            beginDiceCinematic(7600);
            if (actor) focusCameraOnAction(actor, { strength: 1.45, durationMs: 1300 });
            await tweenCameraFov(44, 240);
            showFloatingText(`${String(actionRecord.actorId || 'ENEMY').toUpperCase()} PREPARES`, '#ffb3a7', true, { anchorObject: actor || playerRig });
            playConfirmAttackSnap();
            await timelineDelay(ENEMY_TIMELINE_MS.windup, replayTiming);

            triggerSharedDiceRoll({ sides: 20, label: `${String(actionRecord.actorId || 'ENEMY').toUpperCase()} ATTACK`, mod: resolution.attackBonus, raw: resolution.roll, total: resolution.total });
            spawnVisualDice(resolution.roll, 20, playerRig, `${String(actionRecord.actorId || 'ENEMY').toUpperCase()} ATTACK`);
            showFloatingText(`Roll: ${resolution.total}`, '#ffe08a', true, { anchorObject: playerRig });
            await timelineDelay(ENEMY_TIMELINE_MS.rollHold, replayTiming);

            focusCameraOnAction(playerState, { strength: 1.8, durationMs: 1350 });
            await timelineDelay(ENEMY_TIMELINE_MS.impactHold, replayTiming);
            await hitStop(130);
            displayAttackResult(resolution, playerRig, true);
            await timelineDelay(ENEMY_TIMELINE_MS.resultHold, replayTiming);

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
            await timelineDelay(ENEMY_TIMELINE_MS.damageHold, replayTiming);
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
    return combatState.phase === 'PLAYER' && !isInputLockedForCombat('MOVE') && combatState.player.movementRemaining > 0;
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
    combatParticlePoolMax = isPrimaryClient()
        ? qualityCap
        : Math.min(qualityCap, COMBAT_PARTICLE_POOL_HIDDEN_MAX);

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
    if (!combatParticlesEnabled || !isPrimaryClient() || !isSimulationOwner()) return;
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
    if (!combatParticlesEnabled || !isPrimaryClient() || !isSimulationOwner()) {
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
            stopMainTheme();
            startBattleMusic();
        } else {
            stopBattleMusic();
            startMainTheme();
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
    if (!isSimulationOwner()) {
        clearCombatMoveTiles();
        return;
    }

    if (currentGameMode !== GAME_MODE.COMBAT || combatState.phase !== 'PLAYER') {
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
    
    const showEndTurnButton = currentGameMode === GAME_MODE.COMBAT;
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
    if (modeManager.current === MODE.DM && isDmFreeCamera()) {
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
    if (modeManager.current === MODE.DM && isDmFreeCamera()) {
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
    if (modeManager.current === MODE.DM && isDmFreeCamera()) return false;
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

    console.info('Entering combat...');
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

// Get all valid targets for an ability (within range, has LOS, etc)
function getValidTargets(attacker, rangeFeet, includeAllies = false) {
    const validTargets = [];
    
    // Get all player avatars (excluding attacker)
    Object.values(allPlayerAvatars || {}).forEach(avatar => {
        if (avatar === attacker) return;
        if (!includeAllies && avatar.isAlly === attacker.isAlly) return;
        
        if (canTarget(attacker, avatar, rangeFeet, true)) {
            validTargets.push(avatar);
        }
    });
    
    return validTargets;
}

// Highlight valid targets for UI feedback
function highlightTargets(attacker, rangeFeet, includeAllies = false) {
    const validTargets = getValidTargets(attacker, rangeFeet, includeAllies);
    
    Object.values(allPlayerAvatars || {}).forEach(avatar => {
        if (avatar === attacker) return;
        
        const isValid = validTargets.includes(avatar);
        
        if (avatar.userData.highlightMesh) {
            avatar.userData.highlightMesh.visible = isValid;
            if (isValid) {
                avatar.userData.highlightMesh.material.color.setHex(0x00ff00);
            } else {
                avatar.userData.highlightMesh.material.color.setHex(0x888888);
            }
        }
    });
    
    return validTargets;
}

// Clear all target highlights
function clearTargetHighlights() {
    Object.values(allPlayerAvatars || {}).forEach(avatar => {
        if (avatar.userData.highlightMesh) {
            avatar.userData.highlightMesh.visible = false;
        }
    });
}

function getFirstSelectableHit(intersects) {
    for (const hit of intersects) {
        if (!hit || !hit.object || !hit.object.isMesh) continue;
        if (!isMeshSelectable(hit.object)) continue;
        return resolveSelectableTarget(hit.object);
    }
    return null;
}

function triggerLocalHammerAttackSwing() {
    if (!localPlayerAvatarRigState || !localPlayerAvatarRigState.active) return;
    if (typeof localPlayerAvatarRigState.triggerHammerFlourish !== 'function') return;
    localPlayerAvatarRigState.triggerHammerFlourish();
}

// ── Attack Resolution with Dice ──
function getAttackConfig(attackType = 'melee') {
    const configs = {
        melee: { attackBonus: 5, damageDie: 8, damageBonus: 2 },
        ranged: { attackBonus: 4, damageDie: 6, damageBonus: 1 },
    };
    return configs[attackType] || configs.melee;
}

function getAttackPreview(attacker, target, attackType = 'melee') {
    const config = getAttackConfig(attackType);
    const targetAC = Number(target?.userData?.ac) || 12;
    let successCount = 0;

    // Deterministic preview only. No RNG in UI hover/preview paths.
    for (let roll = 1; roll <= 20; roll++) {
        if (roll === 1) continue;
        if (roll === 20 || (roll + config.attackBonus) >= targetAC) {
            successCount += 1;
        }
    }

    const hitChance = successCount / 20;
    return {
        attackType,
        attackBonus: config.attackBonus,
        targetAC,
        hitChance,
        hitChancePct: Math.round(hitChance * 100),
        damageMin: 1 + config.damageBonus,
        damageMax: config.damageDie + config.damageBonus,
    };
}

function resolveAttack(attacker, target, attackType = 'melee') {
    // Roll d20 for attack
    const roll = Math.floor(Math.random() * 20) + 1;

    const config = getAttackConfig(attackType);
    const attackBonus = config.attackBonus;
    const total = roll + attackBonus;
    
    // AC = 12 (default dummy AC)
    const targetAC = target.userData?.ac || 12;
    const hit = total >= targetAC;
    
    // Roll damage if hit
    let damageRoll = 0;
    const damageBonus = config.damageBonus;
    if (hit) {
        damageRoll = Math.floor(Math.random() * config.damageDie) + 1;
    }
    
    const totalDamage = damageRoll + damageBonus;
    
    // Check for critical (20) or fumble (1)
    let resultType = 'normal';
    if (roll === 20) resultType = 'crit';
    if (roll === 1) resultType = 'fumble';
    
    return consumeDmOverride({
        roll,
        attackBonus,
        total,
        targetAC,
        hit,
        damageRoll,
        damageBonus,
        totalDamage,
        resultType,
        attackType
    });
}

function resolveEnemyAttack(enemy, target) {
    const roll = Math.floor(Math.random() * 20) + 1;
    const attackBonus = Number.isFinite(enemy?.userData?.attackBonus)
        ? enemy.userData.attackBonus
        : 4;
    const targetAC = Number.isFinite(target?.ac)
        ? target.ac
        : (Number.isFinite(playerState.ac) ? playerState.ac : 12);
    const total = roll + attackBonus;
    const hit = total >= targetAC;
    const damageRoll = hit ? Math.max(1, Number(enemy?.userData?.damageRoll) || TRAINING_DUMMY_DAMAGE) : 0;
    const damageBonus = hit ? Math.max(0, Number(enemy?.userData?.damageBonus) || 0) : 0;
    let resultType = 'normal';
    if (roll === 20) resultType = 'crit';
    if (roll === 1) resultType = 'fumble';

    return consumeDmOverride({
        roll,
        attackBonus,
        total,
        targetAC,
        hit,
        damageRoll,
        damageBonus,
        totalDamage: damageRoll + damageBonus,
        resultType,
        attackType: 'melee',
    });
}

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
    confirmUI.style.display = 'none';
    confirmUI.style.visibility = 'hidden';
    confirmUI.style.opacity = '0';
}

function isCombatReviewUiOpen() {
    if (currentGameMode !== GAME_MODE.COMBAT) return false;
    if (combatInteraction.awaitingConfirm) return true;
    if (!confirmUI) return false;
    return confirmUI.style.display !== 'none' && confirmUI.style.visibility !== 'hidden';
}

function resetCombatInteraction(options = {}) {
    const preserveAction = !!options.preserveAction;
    restoreCombatInteractionTargetVisual();
    combatInteraction.target = null;
    combatInteraction.preview = null;
    combatInteraction.autoApproachPreview = null;
    combatInteraction.awaitingConfirm = false;
    combatInteraction.moveAndAttackTarget = null;
    if (!preserveAction) {
        combatInteraction.action = null;
        currentAction = null;
    }
    hideCombatConfirmUI();
}

function ensureCombatConfirmUI() {
    if (confirmUI) return confirmUI;

    confirmUI = document.createElement('div');
    confirmUI.style.position = 'fixed';
    confirmUI.style.top = 'auto';
    confirmUI.style.left = 'auto';
    confirmUI.style.right = '24px';
    confirmUI.style.bottom = '24px';
    confirmUI.style.transform = 'none';
    confirmUI.style.minWidth = '380px';
    confirmUI.style.width = 'min(42vw, 580px)';
    confirmUI.style.maxWidth = 'min(42vw, 580px)';
    confirmUI.style.padding = '22px 24px';
    confirmUI.style.background = 'linear-gradient(180deg, rgba(6,10,20,0.94), rgba(10,14,30,0.96))';
    confirmUI.style.border = '2px solid rgba(115, 206, 255, 0.75)';
    confirmUI.style.borderRadius = '14px';
    confirmUI.style.boxShadow = '0 20px 56px rgba(0,0,0,0.58), 0 0 28px rgba(78,214,255,0.22), inset 0 0 0 1px rgba(255,255,255,0.06)';
    confirmUI.style.backdropFilter = 'blur(10px)';
    confirmUI.style.color = '#eef6ff';
    confirmUI.style.fontFamily = 'Consolas, "Segoe UI", monospace';
    confirmUI.style.fontSize = '15px';
    confirmUI.style.lineHeight = '1.6';
    confirmUI.style.textAlign = 'left';
    confirmUI.style.zIndex = '120000';
    confirmUI.style.display = 'none';
    confirmUI.style.visibility = 'hidden';
    confirmUI.style.opacity = '0';
    confirmUI.style.pointerEvents = 'auto';
    confirmUI.style.cursor = 'default';
    document.body.appendChild(confirmUI);
    window.addEventListener('resize', () => {
        if (confirmUI && confirmUI.style.display !== 'none') {
            positionCombatConfirmUI();
        }
    });
    return confirmUI;
}

function positionCombatConfirmUI() {
    if (!confirmUI) return;

    const hud = document.getElementById('hud');
    if (!hud || !hud.classList.contains('visible')) {
        confirmUI.style.right = '24px';
        confirmUI.style.bottom = '24px';
        confirmUI.style.left = 'auto';
        confirmUI.style.top = 'auto';
        confirmUI.style.transform = 'none';
        return;
    }

    const hudRect = hud.getBoundingClientRect();
    const spacing = 18;
    const viewportPadding = 16;
    const panelRect = confirmUI.getBoundingClientRect();
    const panelWidth = panelRect.width || 380;
    const panelHeight = panelRect.height || 180;

    let left = hudRect.right + spacing;
    let top = hudRect.bottom - panelHeight;

    if (left + panelWidth > window.innerWidth - viewportPadding) {
        left = window.innerWidth - panelWidth - viewportPadding;
    }
    if (left < viewportPadding) {
        left = viewportPadding;
    }
    if (top < viewportPadding) {
        top = Math.max(viewportPadding, hudRect.top - panelHeight - spacing);
    }

    confirmUI.style.left = `${Math.round(left)}px`;
    confirmUI.style.top = `${Math.round(top)}px`;
    confirmUI.style.right = 'auto';
    confirmUI.style.bottom = 'auto';
    confirmUI.style.transform = 'none';
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
    if (modeManager.current === MODE.DM) {
        hideCombatConfirmUI();
        return;
    }
    if (!combatInteraction.preview) return;
    releasePointerLockIfActive();
    const ui = ensureCombatConfirmUI();
    const preview = combatInteraction.preview;
    console.log('SHOWING CONFIRM UI', preview);
    ui.innerHTML = `
        <div style="font-size:13px;color:#82d8ff;text-transform:uppercase;letter-spacing:0.12em;margin-bottom:6px;">Attack Preview</div>
        <div style="font-size:17px;font-weight:700;margin-bottom:10px;">Hit Chance: ${preview.hitChancePct}%</div>
        <div style="opacity:0.82;margin-bottom:12px;">Target AC ${preview.targetAC} • Damage on hit ${preview.damageMin}-${preview.damageMax} • ${combatInteraction.target?.userData?.name || 'Target'}</div>
        <div style="display:flex;gap:10px;justify-content:flex-end;">
            <button id="confirmAttack" style="padding:8px 12px;background:#16a34a;border:1px solid #22c55e;color:#fff;border-radius:6px;cursor:pointer;font-weight:700;">CONFIRM</button>
            <button id="cancelAttack" style="padding:8px 12px;background:#7f1d1d;border:1px solid #dc2626;color:#fff;border-radius:6px;cursor:pointer;">CANCEL</button>
        </div>
    `;
    ui.style.display = 'block';
    ui.style.visibility = 'visible';
    ui.style.opacity = '1';
    positionCombatConfirmUI();

    showFloatingText(`Attack queued: ${preview.hitChancePct}% hit chance • Dmg ${preview.damageMin}-${preview.damageMax}`, '#ffeb3b', true);

    const confirmBtn = document.getElementById('confirmAttack');
    const cancelBtn = document.getElementById('cancelAttack');
    if (confirmBtn) confirmBtn.onclick = confirmAction;
    if (cancelBtn) cancelBtn.onclick = cancelAction;
}

function showMoveConfirmUI() {
    if (modeManager.current === MODE.DM) {
        hideCombatConfirmUI();
        return;
    }
    if (!combatInteraction.preview) return;
    releasePointerLockIfActive();
    const ui = ensureCombatConfirmUI();
    const preview = combatInteraction.preview;
    const destFtX = Math.round(unitsToFeet(preview.destX));
    const destFtZ = Math.round(unitsToFeet(preview.destZ));
    const isMoveAndAttack = combatInteraction.action === 'move-and-attack';
    const titleText = isMoveAndAttack ? 'Move Then Attack' : 'Move Destination';
    const confirmText = isMoveAndAttack ? 'MOVE + ATTACK' : 'MOVE HERE';
    ui.innerHTML = `
        <div style="font-size:13px;color:#82d8ff;text-transform:uppercase;letter-spacing:0.12em;margin-bottom:6px;">${titleText}</div>
        <div style="font-size:17px;font-weight:700;margin-bottom:10px;">${preview.costFeet} ft &mdash; ${preview.valid ? '<span style="color:#7dffb2">IN RANGE</span>' : '<span style="color:#ff7070">TOO FAR</span>'}</div>
        <div style="opacity:0.82;margin-bottom:12px;">${preview.remainingFeet} ft remaining after move</div>
        <div style="display:flex;gap:10px;justify-content:flex-end;">
            <button id="confirmAttack" style="padding:8px 12px;background:#2563eb;border:1px solid #60a5fa;color:#fff;border-radius:6px;cursor:pointer;font-weight:700;">${confirmText}</button>
            <button id="cancelAttack" style="padding:8px 12px;background:#7f1d1d;border:1px solid #dc2626;color:#fff;border-radius:6px;cursor:pointer;">CANCEL</button>
        </div>
    `;
    ui.style.display = 'block';
    ui.style.visibility = 'visible';
    ui.style.opacity = '1';
    positionCombatConfirmUI();

    showFloatingText(preview.valid ? `Move ${preview.costFeet} ft` : 'Out of range', preview.valid ? '#66b3ff' : '#ff8a8a', true);

    const confirmBtn = document.getElementById('confirmAttack');
    const cancelBtn  = document.getElementById('cancelAttack');
    if (confirmBtn) confirmBtn.onclick = confirmAction;
    if (cancelBtn)  cancelBtn.onclick  = cancelAction;
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
        // In range: show move-or-attack choice
        showMoveOrAttackPrompt(target);
    } else if (approachPreview && approachPreview.valid) {
        // Reachable this turn: let player choose auto move+attack vs manual movement.
        showAutoMoveAttackPrompt(target, approachPreview);
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
    releasePointerLockIfActive();
    const ui = ensureCombatConfirmUI();
    const dist = getEffectiveCombatDistanceFeet(playerState, target);

    ui.innerHTML = `
        <div style="font-size:13px;color:#82d8ff;text-transform:uppercase;letter-spacing:0.12em;margin-bottom:6px;">Target Reachable This Turn</div>
        <div style="font-size:15px;font-weight:700;margin-bottom:10px;">Distance: ${dist.toFixed(1)} ft</div>
        <div style="opacity:0.82;margin-bottom:12px;">Auto move cost: ${preview.costFeet} ft • ${preview.remainingFeet} ft left after move</div>
        <div style="display:flex;gap:10px;justify-content:flex-end;">
            <button id="confirmAttack" style="padding:8px 12px;background:#dc2626;border:1px solid #ef4444;color:#fff;border-radius:6px;cursor:pointer;font-weight:700;">AUTO MOVE + ATTACK</button>
            <button id="cancelAttack" style="padding:8px 12px;background:#2563eb;border:1px solid #60a5fa;color:#fff;border-radius:6px;cursor:pointer;">MOVE MANUALLY</button>
        </div>
    `;
    ui.style.display = 'block';
    ui.style.visibility = 'visible';
    ui.style.opacity = '1';
    positionCombatConfirmUI();

    combatInteraction.action = 'auto-move-attack-choice';
    combatInteraction.autoApproachPreview = {
        destX: preview.destPos.x,
        destY: preview.destPos.y,
        destZ: preview.destPos.z,
        costFeet: preview.costFeet,
        valid: preview.valid,
        remainingFeet: preview.remainingFeet,
    };
    combatInteraction.awaitingConfirm = true;

    const confirmBtn = document.getElementById('confirmAttack');
    const cancelBtn = document.getElementById('cancelAttack');

    if (confirmBtn) {
        confirmBtn.onclick = () => {
            confirmAction();
        };
    }

    if (cancelBtn) {
        cancelBtn.onclick = () => {
            hideCombatConfirmUI();
            combatInteraction.awaitingConfirm = false;
            currentAction = 'move';
            showMovementTilesForApproach(target);
        };
    }
}

function showMoveOrAttackPrompt(target) {
    releasePointerLockIfActive();
    const ui = ensureCombatConfirmUI();
    const dist = getEffectiveCombatDistanceFeet(playerState, target);
    const preview = getAttackPreview(playerState, target, 'melee');
    
    ui.innerHTML = `
        <div style="font-size:13px;color:#82d8ff;text-transform:uppercase;letter-spacing:0.12em;margin-bottom:6px;">Ready to Attack</div>
        <div style="font-size:15px;font-weight:700;margin-bottom:10px;">Distance: ${dist.toFixed(1)} ft</div>
        <div style="opacity:0.82;margin-bottom:12px;">Hit: ${preview.hitChancePct}% | Dmg: ${preview.damageMin}-${preview.damageMax}</div>
        <div style="display:flex;gap:10px;justify-content:flex-end;">
            <button id="confirmAttack" style="padding:8px 12px;background:#dc2626;border:1px solid #ef4444;color:#fff;border-radius:6px;cursor:pointer;font-weight:700;">ATTACK NOW</button>
            <button id="cancelAttack" style="padding:8px 12px;background:#2563eb;border:1px solid #60a5fa;color:#fff;border-radius:6px;cursor:pointer;">MOVE FIRST</button>
        </div>
    `;
    ui.style.display = 'block';
    ui.style.visibility = 'visible';
    ui.style.opacity = '1';
    positionCombatConfirmUI();

    combatInteraction.action = 'move-or-attack-choice';
    combatInteraction.awaitingConfirm = true;

    const confirmBtn = document.getElementById('confirmAttack');
    const cancelBtn = document.getElementById('cancelAttack');
    
    if (confirmBtn) {
        confirmBtn.onclick = () => {
            hideCombatConfirmUI();
            combatInteraction.awaitingConfirm = false;
            selectAttackTarget(target);
        };
    }
    
    if (cancelBtn) {
        cancelBtn.onclick = () => {
            hideCombatConfirmUI();
            combatInteraction.awaitingConfirm = false;
            currentAction = 'move';
            // Show movement UI to let player move closer
            showMovementTilesForApproach(target);
        };
    }
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

    updateActionMenu();
    showMoveConfirmUI();
}

function showMovementTilesForApproach(target) {
    // Enable movement mode to let player pick an approach position
    combatInteraction.action = 'move-to-approach';
    combatInteraction.moveAndAttackTarget = target;
    
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

    resetCombatInteraction({ preserveAction: true });
    combatInteraction.action = 'attack';
    currentAction = 'attack';
    combatInteraction.target = target;
    combatInteraction.preview = getAttackPreview(playerState, target, 'melee');
    combatInteraction.awaitingConfirm = true;

    if (target.material && target.material.emissive) {
        target.userData.previewOriginalEmissive = target.material.emissive.getHex();
        target.material.emissive.setHex(0xffff00);
    } else if (target.material && target.material.color) {
        target.userData.previewOriginalColor = target.material.color.getHex();
        target.material.color.setHex(0xffff00);
    }
    attachTargetSelectionRing(target);

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

    // Clamp destination inside movement radius
    const radiusUnits = feetToUnits(combatState.player.movementRemaining);
    const dx = destX - playerState.position.x;
    const dz = destZ - playerState.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist > radiusUnits + 0.01) {
        showFloatingText('Out of range', '#ff8a8a', true);
        return false;
    }

    const destPos = new THREE.Vector3(destX, playerState.position.y, destZ);
    const costFeet = getMoveCostFeet(playerState.position, destPos);
    const valid = costFeet > 0 && costFeet <= combatState.player.movementRemaining && canMoveTo(destPos);
    
    // Fail fast if destination leaves combat arena
    if (currentGameMode === GAME_MODE.COMBAT && !canMoveTo(destPos)) {
        // Silently reject — move disc is already clamped to arena, so this is a rare edge case
        return false;
    }

    resetCombatInteraction({ preserveAction: true });
    combatInteraction.action = 'move';
    currentAction = 'move';
    combatInteraction.target = destPos;      // store world pos directly
    combatInteraction.preview = {
        destX,
        destZ,
        costFeet,
        valid,
        remainingFeet: Math.max(0, Math.round(combatState.player.movementRemaining - costFeet)),
    };
    combatInteraction.awaitingConfirm = true;

    updateActionMenu();
    showMoveConfirmUI();
    return true;
}

// ── Preview and Execution Functions ──
function showAttackPreview(target) {
    const preview = getAttackPreview(playerState, target, 'melee');
    showFloatingText(`Hit chance ${preview.hitChancePct}% | Dmg ${preview.damageMin}-${preview.damageMax}`, '#ffeb3b');
    
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
        cancelAction();
        return;
    }
    if (isInputLockedForCombat('ACTION')) return;
    if (combatState.timelineBusy) return;
    if (!isLocalCombatAuthority()) {
        showFloatingText('Combat authority is on player client', '#ff8a8a', true);
        return;
    }
    
    if (!canAttack()) {
        console.info('No action available. End turn to refresh action.');
        showFloatingText('Action already used', '#ff8a8a');
        logCombatEvent('Melee failed: no action left', 'miss');
        cancelAction();
        return;
    }

    if (!canTarget(playerState, target, DND_RANGES.melee, true)) {
        console.info('Out of range or no line of sight');
        const resolution = resolveAttack(playerState, target, 'melee');
        displayAttackResult(resolution, target, true);
        tryUseAction();
        syncTurnExhaustionState();
        cancelAction();
        return;
    }

    const actionSnapshotBefore = createCombatSnapshot('action-before-melee');

    // Execute the attack with dice roll
    const resolution = resolveAttack(playerState, target, 'melee');
    
    // Mark the timeline busy before spending the action so end-turn gating waits for the roll sequence.
    setCombatTimelineBusy(true);
    setCombatLock(true);

    // Mark action as used and sequence the presentation over time.
    if (!tryUseAction()) {
        setCombatTimelineBusy(false);
        setCombatLock(false);
        showFloatingText('Action already used', '#ff8a8a');
        return;
    }
    syncTurnExhaustionState();

    (async () => {
        const sequenceStart = performance.now();
        const startFov = camera ? camera.fov : 58;
        try {
            setCombatMessageLock(true);
            beginDiceCinematic(8200);

            // 1) Windup
            focusCameraOnAction(playerState, { strength: 1.45, durationMs: 1300 });
            await tweenCameraFov(43, 220);
            showFloatingText('CHARGE UP', '#ffd166', true, { anchorObject: playerRig });
            await delay(MELEE_TIMELINE_MS.windup);

            if (!target || !target.parent || !target.userData || !target.userData.isTargetable) {
                cancelAction();
                return;
            }

            // 2) Show roll
            triggerSharedDiceRoll({
                sides: 20,
                label: 'ATTACK',
                mod: resolution.attackBonus,
                raw: resolution.roll,
                total: resolution.total,
            });
            spawnVisualDice(resolution.roll, 20, target, 'ATTACK ROLL');
            showFloatingText(`Roll: ${resolution.total}`, '#ffe08a', true, { anchorObject: target });
            await delay(MELEE_TIMELINE_MS.rollHold);

            // 3) Impact → breathe → freeze → reveal
            focusCameraOnAction(target, { strength: 1.85, durationMs: 1350 });
            triggerLocalHammerAttackSwing();
            await delay(250);         // impact breathes
            await hitStop(120);       // FREEZE FRAME

            // 4) Result callout (outcome first, math in log)
            displayAttackResult(resolution, target, true);
            await delay(MELEE_TIMELINE_MS.resultHold);

            // 5) Damage application
            if (resolution.hit) {
                const damage = resolution.totalDamage;
                target.userData.hp = Math.max(0, (target.userData.hp || 0) - damage);

                triggerSharedDiceRoll({
                    sides: resolution.attackType === 'melee' ? 8 : 6,
                    label: resolution.attackType === 'melee' ? 'D8 DAMAGE' : 'D6 DAMAGE',
                    mod: resolution.damageBonus,
                    raw: resolution.damageRoll,
                    total: resolution.totalDamage,
                });
                spawnVisualDice(resolution.damageRoll, resolution.attackType === 'melee' ? 8 : 6, target, 'DAMAGE');

                showFloatingText(`-${damage}`, '#ff6b6b', true, { anchorObject: target });
                console.info(`Hit! ${target.userData.name || 'Target'} HP: ${target.userData.hp}`);
                logCombatEvent(`Melee hit ${target.userData.name || 'target'} for ${damage} (HP ${target.userData.hp})`, 'hit');

                triggerEnemyFlinch(target);
                spawnImpactBurst(target.position, 0x00ff00, 24);
                triggerCombatFlash('#00ff00', 0.12, 300);
                shakeScreen(0.22, 420);
                playCombatSfxCue('melee-hit');
                await delay(MELEE_TIMELINE_MS.damageHold);

                if (target.userData.hp <= 0) {
                    if (activeRangeCircle && activeRangeCircle.parent) {
                        activeRangeCircle.parent.remove(activeRangeCircle);
                        activeRangeCircle = null;
                    }
                    await playKillSequence(target);
                    removeTrainingDummy(target);
                    if (selectedCombatTarget === target) setSelectedCombatTarget(null);
                    exitCombatIfNoTargets();
                }
            } else {
                spawnImpactBurst(target.position, 0xff7878, 12);
                triggerCombatFlash('#ff3333', 0.08, 240);
                shakeScreen(0.06, 150);
                playCombatSfxCue('miss');
                logCombatEvent(`Melee miss on ${target.userData.name || 'target'}`, 'miss');
                await delay(MELEE_TIMELINE_MS.damageHold);
            }
        } finally {
            const elapsedMs = performance.now() - sequenceStart;
            if (elapsedMs < COMBAT_PRESENTATION_MIN_MS) {
                await delay(COMBAT_PRESENTATION_MIN_MS - elapsedMs);
            }
            await tweenCameraFov(startFov, 320);
            setCombatMessageLock(false);
            setCombatTimelineBusy(false);
            if (!turnEndRequired && combatState.phase === 'PLAYER') {
                setCombatLock(false);
            }
            cancelAction();
            endDiceCinematic();
            checkTurnEndRequired();
            const actionSnapshotAfter = createCombatSnapshot('action-after-melee');
            if (actionSnapshotBefore && actionSnapshotAfter) {
                recordCombatAction({
                    type: 'attack',
                    attackType: 'melee',
                    actorId: getLocalCombatActorId(),
                    targetId: getCombatActorId(target),
                    resolution,
                    result: resolution.hit ? 'hit' : 'miss',
                    damage: resolution.totalDamage,
                    targetDefeated: !!(target?.userData && target.userData.hp <= 0),
                    timestamp: Date.now(),
                    snapshotBefore: actionSnapshotBefore,
                    snapshotAfter: actionSnapshotAfter,
                });
            }
        }
    })();
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
    if (!target || !target.userData || !target.userData.isTargetable) return;
    if (isInputLockedForCombat('ACTION')) return;
    if (!canAttack()) {
        console.info('No action available. End turn to refresh action.');
        showFloatingText('Action already used', '#ff8a8a');
        logCombatEvent('Melee failed: no action left', 'miss');
        return;
    }

    if (!canTarget(playerState, target, DND_RANGES.melee, true)) {
        console.info('Out of range or no line of sight');
        showFloatingText('MISS', '#ff8a8a');
        spawnImpactBurst(target.position, 0xff7878, 12);
        triggerCombatFlash('#ff3333', 0.08, 180);
        shakeScreen(0.08, 120);  // Slight shake on miss
        playCombatSfxCue('miss');
        logCombatEvent(`Melee miss on ${target.userData.name || 'target'}`, 'miss');
        return;
    }

    if (!tryUseAction()) {
        showFloatingText('Action already used', '#ff8a8a');
        return;
    }
    syncTurnExhaustionState();
    triggerLocalHammerAttackSwing();
    focusCameraOnAction(target);
    showFloatingText('CRITICAL STRIKE', '#ffd166', false, { anchorObject: target });
    triggerEnemyFlinch(target);
    spawnImpactBurst(target.position, 0xffd166, 34);
    triggerCombatFlash('#ffd166', 0.14, 280);
    shakeScreen(0.45, 500);
    playCombatSfxCue('melee-hit');
    target.userData.hp = Math.max(0, (target.userData.hp || 0) - 10);
    logCombatEvent(`Melee hit ${target.userData.name || 'target'} for 10 (HP ${target.userData.hp})`, 'hit');

    const originalScale = target.scale.clone();
    target.scale.set(originalScale.x * 1.2, originalScale.y * 1.2, originalScale.z * 1.2);
    setTimeout(() => { if (target.parent) target.scale.copy(originalScale); }, 100);

    if (target.userData.hp <= 0) {
        if (activeRangeCircle && activeRangeCircle.parent) {
            activeRangeCircle.parent.remove(activeRangeCircle);
            activeRangeCircle = null;
        }
        playKillSequence(target).then(() => {
            removeTrainingDummy(target);
            if (selectedCombatTarget === target) setSelectedCombatTarget(null);
            exitCombatIfNoTargets();
        });
    }
}

function rangedAttack(target) {
    if (!target || !target.userData || !target.userData.isTargetable) return;
    if (isInputLockedForCombat('ACTION')) return;
    if (combatState.timelineBusy) return;
    if (!isLocalCombatAuthority()) {
        showFloatingText('Combat authority is on player client', '#ff8a8a', true);
        return;
    }
    if (!canAttack()) {
        console.info('No action available. Press Enter to end turn and refresh.');
        showFloatingText('Action already used', '#ff8a8a');
        logCombatEvent('Ranged failed: no action left', 'miss');
        return;
    }

    if (!canTarget(playerState, target, DND_RANGES.spellRange30, true)) {
        console.info('Out of ranged attack distance or no line of sight.');
        showFloatingText('MISS', '#ff8a8a');
        spawnImpactBurst(target.position, 0xff7878, 10);
        triggerCombatFlash('#ff3333', 0.07, 170);
        shakeScreen(0.06, 100);  // Tiny shake on ranged miss
        playCombatSfxCue('miss');
        logCombatEvent(`Ranged miss on ${target.userData.name || 'target'}`, 'miss');
        return;
    }

    const actionSnapshotBefore = createCombatSnapshot('action-before-ranged');
    const resolution = resolveAttack(playerState, target, 'ranged');

    setCombatTimelineBusy(true);
    setCombatLock(true);

    if (!tryUseAction()) {
        setCombatTimelineBusy(false);
        setCombatLock(false);
        showFloatingText('Action already used', '#ff8a8a');
        return;
    }
    syncTurnExhaustionState();

    (async () => {
        const sequenceStart = performance.now();
        const startFov = camera ? camera.fov : 58;
        try {
            setCombatMessageLock(true);
            beginDiceCinematic(8000);

            // 1) Windup/channel
            focusCameraOnAction(playerState, { strength: 1.35, durationMs: 1250 });
            await tweenCameraFov(44, 220);
            showFloatingText('CHANNELING', '#66ccff', true, { anchorObject: playerRig });
            await delay(RANGED_TIMELINE_MS.windup);

            if (!target || !target.parent || !target.userData || !target.userData.isTargetable) {
                return;
            }

            // 2) Launch / roll beat
            focusOutcomeText('ARCANE SHOT', '#66ccff', 1400);
            showFloatingText('ARCANE SHOT', '#66ccff', true, { anchorObject: target });
            const shot = createTargetingLine(
                playerState.position.clone(),
                target.position.clone(),
                0x66ccff,
                1,
                { alwaysOnTop: true, opacity: 0.98 }
            );
            scene.add(shot);
            await delay(RANGED_TIMELINE_MS.launchHold);
            if (shot.parent) shot.parent.remove(shot);

            // 3) Impact → breathe → freeze → reveal
            focusCameraOnAction(target, { strength: 1.75, durationMs: 1300 });
            triggerEnemyFlinch(target);
            spawnImpactBurst(target.position, 0x66ccff, 26);
            triggerCombatFlash('#66ccff', 0.12, 320);
            shakeScreen(0.18, 360);
            playCombatSfxCue('ranged-hit');
            await delay(250);         // impact breathes
            await hitStop(120);       // FREEZE FRAME

            // 4) Outcome (big moment)
            focusOutcomeText('HIT', '#00ff00', 1500);
            showFloatingText('HIT', '#00ff00', true, { anchorObject: target });
            await delay(RANGED_TIMELINE_MS.resultHold);

            // 5) Damage
            target.userData.hp = Math.max(0, (target.userData.hp || 0) - 6);
            showFloatingText('-6', '#ff6b6b', true, { anchorObject: target });
            console.info(`Ranged hit! ${target.userData.name || 'Target'} HP: ${target.userData.hp}`);
            logCombatEvent(`Ranged hit ${target.userData.name || 'target'} for 6 (HP ${target.userData.hp})`, 'hit');
            await delay(RANGED_TIMELINE_MS.damageHold);

            if (target.userData.hp <= 0) {
                await playKillSequence(target);
                removeTrainingDummy(target);
                if (selectedCombatTarget === target) setSelectedCombatTarget(null);
                exitCombatIfNoTargets();
            }
        } finally {
            const elapsedMs = performance.now() - sequenceStart;
            if (elapsedMs < COMBAT_PRESENTATION_MIN_MS) {
                await delay(COMBAT_PRESENTATION_MIN_MS - elapsedMs);
            }
            await tweenCameraFov(startFov, 320);
            setCombatMessageLock(false);
            setCombatTimelineBusy(false);
            if (!turnEndRequired && combatState.phase === 'PLAYER') {
                setCombatLock(false);
            }
            endDiceCinematic();
            checkTurnEndRequired();
            const actionSnapshotAfter = createCombatSnapshot('action-after-ranged');
            if (actionSnapshotBefore && actionSnapshotAfter) {
                recordCombatAction({
                    type: 'attack',
                    attackType: 'ranged',
                    actorId: getLocalCombatActorId(),
                    targetId: getCombatActorId(target),
                    resolution,
                    result: resolution.hit ? 'hit' : 'miss',
                    damage: resolution.totalDamage,
                    targetDefeated: !!(target?.userData && target.userData.hp <= 0),
                    timestamp: Date.now(),
                    snapshotBefore: actionSnapshotBefore,
                    snapshotAfter: actionSnapshotAfter,
                });
            }
        }
    })();
}

function resetLocalTurnResources() {
    pendingTurnEndRequired = false;
    combatState.player.actionUsed = false;
    combatState.player.bonusUsed = false;
    combatState.player.movementRemaining = 30;
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
        if (currentGameMode === GAME_MODE.COMBAT && combatState.phase === 'PLAYER') {
            rebuildCombatMoveTiles();
        }
    });
    showActionUI(true);
}

function endTurn() {
    if (!socket || !socket.connected) {
        console.warn('[END-TURN] blocked: no connection');
        return;
    }
    if (endTurnPending) {
        console.log('[END-TURN] blocked: already pending');
        return;
    }
    if (currentGameMode !== GAME_MODE.COMBAT) {
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
    socket.emit('end-turn', { clientTs: Date.now() }, (ack) => {
        console.log('[END-TURN] server ack:', ack);
        if (!ack || ack.ok === true) {
            return;
        }
        endTurnPending = false;
        if (endTurnWatchdog) {
            clearTimeout(endTurnWatchdog);
            endTurnWatchdog = null;
        }
        const reason = String(ack.reason || 'unknown');
        console.warn('[END-TURN] ack reported failure:', reason);
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
            const sequenceStart = performance.now();
            const startFov = camera ? camera.fov : 58;
            const targetRig = combatTarget === playerState ? playerRig : combatTarget;
            const isPlayerTarget = combatTarget === playerState;
            
            try {
                setCombatMessageLock(true);
                beginDiceCinematic(7600);

                focusCameraOnAction(enemy, { strength: 1.45, durationMs: 1300 });
                await tweenCameraFov(44, 240);
                showFloatingText(`${enemyName.toUpperCase()} PREPARES`, '#ffb3a7', true, { anchorObject: enemy });
                playConfirmAttackSnap();
                triggerEnemySwingAnim(enemy);
                await delay(ENEMY_TIMELINE_MS.windup);

                triggerSharedDiceRoll({
                    sides: 20,
                    label: `${enemyName.toUpperCase()} ATTACK`,
                    mod: resolution.attackBonus,
                    raw: resolution.roll,
                    total: resolution.total,
                });
                spawnVisualDice(resolution.roll, 20, targetRig, `${enemyName.toUpperCase()} ATTACK`);
                showFloatingText(`Roll: ${resolution.total}`, '#ffe08a', true, { anchorObject: targetRig });
                await delay(ENEMY_TIMELINE_MS.rollHold);

                focusCameraOnAction(targetRig, { strength: 1.8, durationMs: 1350 });
                await delay(ENEMY_TIMELINE_MS.impactHold);
                await hitStop(130);

                displayAttackResult(resolution, targetRig, isPlayerTarget);
                await delay(ENEMY_TIMELINE_MS.resultHold);

                if (resolution.hit) {
                    let dealt = 0;
                    if (isPlayerTarget) {
                        dealt = applyPlayerDamage(resolution.totalDamage, enemyName);
                        showFloatingText(`-${dealt}`, '#ff6b6b', true, { anchorObject: playerRig });
                        playCombatSfxCue('enemy-hit-player');
                        logCombatEvent(`${enemyName} hits you for ${dealt}`, 'miss');
                    } else {
                        dealt = applyDummyDamage(combatTarget, resolution.totalDamage);
                        showFloatingText(`-${dealt}`, '#ff6b6b', true, { anchorObject: targetRig });
                        logCombatEvent(`${enemyName} hits ${combatTarget.userData?.name || 'target'} for ${dealt}`, 'info');
                        playCombatSfxCue('hit');
                    }
                    spawnImpactBurst(targetRig.position, 0xff4444, 28);
                    shakeScreen(0.2, 320);
                    triggerCombatFlash('#ff2d2d', 0.22, 380);
                    playConfirmAttackSnap();
                } else {
                    playCombatSfxCue('miss');
                    const targetName = isPlayerTarget ? 'you' : (combatTarget.userData?.name || 'the target');
                    logCombatEvent(`${enemyName} misses ${targetName}`, 'info');
                }
                await delay(ENEMY_TIMELINE_MS.damageHold);
            } finally {
                const elapsedMs = performance.now() - sequenceStart;
                if (elapsedMs < COMBAT_PRESENTATION_MIN_MS) {
                    await delay(COMBAT_PRESENTATION_MIN_MS - elapsedMs);
                }
                await tweenCameraFov(startFov, 320);
                setCombatMessageLock(false);
                endDiceCinematic();
                const actionSnapshotAfter = createCombatSnapshot('action-after-enemy-melee');
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
    const bar = document.getElementById('action-bar');
    if (!bar) return;
    if (modeManager.current === MODE.DM) {
        bar.style.display = 'none';
        return;
    }
    bar.style.display = show ? 'flex' : 'none';
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
        const sequenceStart = performance.now();
        const startFov = camera ? camera.fov : 58;
        try {
            setCombatMessageLock(true);
            beginDiceCinematic(7600);

            focusCameraOnAction(enemy, { strength: 1.45, durationMs: 1300 });
            await tweenCameraFov(44, 240);
            showFloatingText(`${enemyName.toUpperCase()} (DM)`, '#ffb3a7', true, { anchorObject: enemy });
            playConfirmAttackSnap();
            await delay(ENEMY_TIMELINE_MS.windup);

            triggerSharedDiceRoll({
                sides: 20,
                label: `${enemyName.toUpperCase()} ATTACK`,
                mod: resolution.attackBonus,
                raw: resolution.roll,
                total: resolution.total,
            });
            spawnVisualDice(resolution.roll, 20, playerRig, `${enemyName.toUpperCase()} ATTACK`);
            showFloatingText(`Roll: ${resolution.total}`, '#ffe08a', true, { anchorObject: playerRig });
            await delay(ENEMY_TIMELINE_MS.rollHold);

            focusCameraOnAction(playerState, { strength: 1.8, durationMs: 1350 });
            await delay(ENEMY_TIMELINE_MS.impactHold);
            await hitStop(130);

            displayAttackResult(resolution, playerRig, true);
            await delay(ENEMY_TIMELINE_MS.resultHold);

            if (resolution.hit) {
                const dealt = applyPlayerDamage(resolution.totalDamage, `${enemyName} (DM)`);
                showFloatingText(`-${dealt}`, '#ff6b6b', true, { anchorObject: playerRig });
                spawnImpactBurst(playerState.position, 0xff4444, 28);
                shakeScreen(0.2, 320);
                triggerCombatFlash('#ff2d2d', 0.22, 380);
                playCombatSfxCue('enemy-hit-player');
                playConfirmAttackSnap();
                logCombatEvent(`${enemyName} (DM) hits you for ${dealt}`, 'miss');
            } else {
                playCombatSfxCue('miss');
                logCombatEvent(`${enemyName} (DM) misses you`, 'info');
            }
            await delay(ENEMY_TIMELINE_MS.damageHold);
        } finally {
            const elapsedMs = performance.now() - sequenceStart;
            if (elapsedMs < COMBAT_PRESENTATION_MIN_MS) {
                await delay(COMBAT_PRESENTATION_MIN_MS - elapsedMs);
            }
            await tweenCameraFov(startFov, 320);
            setCombatMessageLock(false);
            endDiceCinematic();
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
    if (enemyHealthBars.has(dummy)) return;

    const container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.pointerEvents = 'none';
    container.style.zIndex = '5000';
    container.style.left = '-300px';
    container.style.top = '-300px';
    container.style.transform = 'translateX(-50%)';
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.alignItems = 'center';
    container.style.gap = '2px';

    const nameEl = document.createElement('div');
    nameEl.textContent = dummy.userData.name || 'Enemy';
    nameEl.style.fontSize = '11px';
    nameEl.style.fontFamily = 'Consolas, monospace';
    nameEl.style.color = '#ffcccc';
    nameEl.style.textShadow = '0 1px 5px #000, 0 0 8px rgba(0,0,0,0.9)';
    nameEl.style.letterSpacing = '0.5px';
    nameEl.style.whiteSpace = 'nowrap';
    container.appendChild(nameEl);

    const track = document.createElement('div');
    track.style.width = '80px';
    track.style.height = '7px';
    track.style.borderRadius = '4px';
    track.style.background = 'rgba(0,0,0,0.75)';
    track.style.border = '1px solid rgba(255,200,200,0.3)';
    track.style.position = 'relative';
    track.style.overflow = 'hidden';

    const lagFill = document.createElement('div');
    lagFill.style.position = 'absolute';
    lagFill.style.left = '0';
    lagFill.style.top = '0';
    lagFill.style.height = '100%';
    lagFill.style.width = '100%';
    lagFill.style.background = '#cc2222';
    lagFill.style.borderRadius = '4px';
    track.appendChild(lagFill);

    const hpFill = document.createElement('div');
    hpFill.style.position = 'absolute';
    hpFill.style.left = '0';
    hpFill.style.top = '0';
    hpFill.style.height = '100%';
    hpFill.style.width = '100%';
    hpFill.style.background = '#44ff66';
    hpFill.style.borderRadius = '4px';
    hpFill.style.transition = 'width 0.35s cubic-bezier(0.2,0.9,0.3,1)';
    track.appendChild(hpFill);

    container.appendChild(track);
    document.body.appendChild(container);

    enemyHealthBars.set(dummy, { container, hpFill, lagFill, nameEl, lagValue: 1.0 });
}

function removeEnemyHealthBar(dummy) {
    const bar = enemyHealthBars.get(dummy);
    if (!bar) return;
    if (bar.container.parentNode) bar.container.parentNode.removeChild(bar.container);
    enemyHealthBars.delete(dummy);
}

function createPlayerHeadHealthBar(actorKey, name = 'Player') {
    if (!actorKey || playerHeadHealthBars.has(actorKey)) return;

    const container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.pointerEvents = 'none';
    container.style.zIndex = '5000';
    container.style.left = '-300px';
    container.style.top = '-300px';
    container.style.transform = 'translateX(-50%)';
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.alignItems = 'center';
    container.style.gap = '2px';

    const nameEl = document.createElement('div');
    nameEl.textContent = name;
    nameEl.style.fontSize = '11px';
    nameEl.style.fontFamily = 'Consolas, monospace';
    nameEl.style.color = '#c7e6ff';
    nameEl.style.textShadow = '0 1px 5px #000, 0 0 8px rgba(0,0,0,0.9)';
    nameEl.style.letterSpacing = '0.5px';
    nameEl.style.whiteSpace = 'nowrap';
    container.appendChild(nameEl);

    const track = document.createElement('div');
    track.style.width = '80px';
    track.style.height = '7px';
    track.style.borderRadius = '4px';
    track.style.background = 'rgba(0,0,0,0.75)';
    track.style.border = '1px solid rgba(150,210,255,0.35)';
    track.style.position = 'relative';
    track.style.overflow = 'hidden';

    const lagFill = document.createElement('div');
    lagFill.style.position = 'absolute';
    lagFill.style.left = '0';
    lagFill.style.top = '0';
    lagFill.style.height = '100%';
    lagFill.style.width = '100%';
    lagFill.style.background = '#2a4f7a';
    lagFill.style.borderRadius = '4px';
    track.appendChild(lagFill);

    const hpFill = document.createElement('div');
    hpFill.style.position = 'absolute';
    hpFill.style.left = '0';
    hpFill.style.top = '0';
    hpFill.style.height = '100%';
    hpFill.style.width = '100%';
    hpFill.style.background = '#44ff66';
    hpFill.style.borderRadius = '4px';
    hpFill.style.transition = 'width 0.35s cubic-bezier(0.2,0.9,0.3,1)';
    track.appendChild(hpFill);

    container.appendChild(track);
    document.body.appendChild(container);

    playerHeadHealthBars.set(actorKey, { container, hpFill, lagFill, nameEl, lagValue: 1.0 });
}

function removePlayerHeadHealthBar(actorKey) {
    if (!actorKey) return;
    const bar = playerHeadHealthBars.get(actorKey);
    if (!bar) return;
    if (bar.container.parentNode) bar.container.parentNode.removeChild(bar.container);
    playerHeadHealthBars.delete(actorKey);
}

function updateSingleHeadHealthBar(bar, hp, maxHp) {
    if (!bar) return;
    const safeMax = Math.max(1, Number(maxHp) || 1);
    const safeHp = Math.max(0, Math.min(safeMax, Number(hp) || 0));
    const hpFrac = safeHp / safeMax;
    bar.hpFill.style.width = `${hpFrac * 100}%`;
    bar.hpFill.style.background = hpFrac > 0.6 ? '#44ff66' : hpFrac > 0.3 ? '#ffcc00' : '#ff4444';
    if (bar.lagValue > hpFrac) {
        bar.lagValue = Math.max(hpFrac, bar.lagValue - 0.006);
    } else {
        bar.lagValue = hpFrac;
    }
    bar.lagFill.style.width = `${bar.lagValue * 100}%`;
}

function updateAllPlayerHeadHealthBars() {
    if (!renderer) return;
    const activeView = getActiveViewCamera();
    if (!activeView) return;
    const w = renderer.domElement.clientWidth;
    const h = renderer.domElement.clientHeight;
    const localKey = 'local-player';
    const headBarHeightOffset = 1.65;

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
        for (const [playerId, avatarRoot] of Object.entries(avatars)) {
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

function triggerEnemySwingAnim(enemy) {
    if (!enemy || !enemy.userData) return;
    const modelRoot = enemy.children.find((c) => c.name === 'training_dummy_visual');
    if (!modelRoot) return;

    // Find arm bones using the same helper pattern used during pose setup.
    let leftUpperArm = null;
    let rightUpperArm = null;
    modelRoot.traverse((child) => {
        if (!child.isBone) return;
        const n = child.name || '';
        if (!leftUpperArm  && /(left.*upperarm|upperarm.*left|leftarm|arm_l|l_upperarm|larm)/i.test(n))  leftUpperArm  = child;
        if (!rightUpperArm && /(right.*upperarm|upperarm.*right|rightarm|arm_r|r_upperarm|rarm)/i.test(n)) rightUpperArm = child;
    });
    if (!leftUpperArm && !rightUpperArm) return;

    // Snapshot rest rotations at the moment of call.
    const leftRest  = leftUpperArm  ? leftUpperArm.rotation.clone()  : null;
    const rightRest = rightUpperArm ? rightUpperArm.rotation.clone() : null;

    const SWING_DURATION_MS = 480;
    const startTime = performance.now();

    const swingRig = enemy.userData.swingAnimRig || null;
    if (swingRig) cancelAnimationFrame(swingRig.raf);

    const state = { raf: null };
    enemy.userData.swingAnimRig = state;

    const tick = () => {
        const elapsed = performance.now() - startTime;
        const t = Math.min(1, elapsed / SWING_DURATION_MS);
        // Arc forward (0→1) then back (1→0) smoothly.
        const arc = t < 0.45
            ? (t / 0.45)
            : (1 - (t - 0.45) / 0.55);
        const swing = arc * 1.9; // radians of forward pitch

        if (leftUpperArm && leftRest) {
            leftUpperArm.rotation.x  = leftRest.x  - swing;
            leftUpperArm.rotation.z  = leftRest.z  + swing * 0.28;
        }
        if (rightUpperArm && rightRest) {
            rightUpperArm.rotation.x = rightRest.x - swing;
            rightUpperArm.rotation.z = rightRest.z  - swing * 0.28;
        }

        if (t < 1) {
            state.raf = requestAnimationFrame(tick);
        } else {
            // Restore rest pose.
            if (leftUpperArm  && leftRest)  leftUpperArm.rotation.copy(leftRest);
            if (rightUpperArm && rightRest) rightUpperArm.rotation.copy(rightRest);
            enemy.userData.swingAnimRig = null;
        }
    };
    state.raf = requestAnimationFrame(tick);
}

function triggerEnemyFlinch(target) {
    if (!target || !target.userData) return;
    const dir = new THREE.Vector3(
        target.position.x - playerState.position.x,
        0,
        target.position.z - playerState.position.z
    );
    if (dir.lengthSq() < 0.001) dir.set(1, 0, 0);
    dir.normalize();
    target.userData.flinchState = {
        originX: target.position.x,
        originZ: target.position.z,
        offsetX: dir.x * 0.38,
        offsetZ: dir.z * 0.38,
        elapsed: 0,
        duration: 260,
    };
}

function updateEnemyFlinches(deltaMs) {
    for (const dummy of trainingDummies) {
        if (!dummy || !dummy.userData.flinchState) continue;
        const f = dummy.userData.flinchState;
        f.elapsed += deltaMs;
        const t = Math.min(1, f.elapsed / f.duration);
        // Knock forward then snap back
        const knock = t < 0.35 ? (t / 0.35) : (1 - (t - 0.35) / 0.65);
        dummy.position.x = f.originX + f.offsetX * knock;
        dummy.position.z = f.originZ + f.offsetZ * knock;
        if (f.elapsed >= f.duration) {
            dummy.position.x = f.originX;
            dummy.position.z = f.originZ;
            dummy.userData.flinchState = null;
        }
    }
}

// ─── Kill Sequence ─────────────────────────────────────────────────────────

async function playKillSequence(target) {
    if (!target || !target.parent) return;
    focusOutcomeText('DEFEATED', '#ff4444', 2200);
    showFloatingText('DEFEATED', '#ff4444', true, { anchorObject: target });
    spawnImpactBurst(target.position, 0xff4444, 55);
    spawnImpactBurst(target.position, 0xffcc00, 30);
    triggerCombatFlash('#ff2200', 0.38, 500);
    shakeScreen(0.55, 600);
    playCombatSfxCue('melee-hit');

    // Collapse animation
    const startScaleY = target.scale.y;
    const startPosY = target.position.y;
    const startTime = performance.now();
    const duration = 560;
    await new Promise((resolve) => {
        const collapse = () => {
            if (!target.parent) { resolve(); return; }
            const t = Math.min(1, (performance.now() - startTime) / duration);
            const eased = t * t;
            target.scale.y = Math.max(0.001, startScaleY * (1 - eased));
            target.position.y = startPosY - eased * 1.8;
            if (t < 1) { requestAnimationFrame(collapse); } else { resolve(); }
        };
        requestAnimationFrame(collapse);
    });
    removeEnemyHealthBar(target);
    logCombatEvent(`${target.userData.name || 'Target'} defeated`, 'hit');
}

// ─── Target Glow Ring ──────────────────────────────────────────────────────

function attachTargetSelectionRing(target) {
    if (!target || target.userData.selectionRing) return;
    const geo = new THREE.RingGeometry(0.58, 0.82, 36);
    const mat = new THREE.MeshBasicMaterial({
        color: 0xffcc00, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false,
    });
    const ring = new THREE.Mesh(geo, mat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -0.98;
    ring.renderOrder = 22;
    target.add(ring);
    target.userData.selectionRing = ring;
}

function removeTargetSelectionRing(target) {
    if (!target || !target.userData.selectionRing) return;
    target.remove(target.userData.selectionRing);
    target.userData.selectionRing.geometry.dispose();
    target.userData.selectionRing.material.dispose();
    target.userData.selectionRing = null;
}

// ──────────────────────────────────────────────────────────────────────────

function normalizeSpawnEntityType(type) {
    const normalized = String(type || '').trim().toLowerCase();
    if (normalized === 'player-dummy' || normalized === 'player_dummy' || normalized === 'ally-dummy') {
        return 'player-dummy';
    }
    if (normalized === 'elite-dummy' || normalized === 'elite_dummy' || normalized === 'elite') {
        return 'elite-dummy';
    }
    return 'training-dummy';
}

function spawnEntityByType(x, y, z, type = 'training-dummy') {
    const entityType = normalizeSpawnEntityType(type);
    const definitions = {
        'training-dummy': {
            name: 'Training Dummy',
            maxHp: 50,
        },
        'player-dummy': {
            name: 'Dummy Player',
            maxHp: 42,
            faction: 'player',
        },
        'elite-dummy': {
            name: 'Elite Dummy',
            maxHp: 90,
            radius: 0.65,
        },
    };

    const config = definitions[entityType] || definitions['training-dummy'];
    console.log(`[spawnEntityByType] Type: ${entityType}, Config:`, config);
    const dummy = spawnTrainingDummy(x, y, z, config.name);
    console.log(`[spawnEntityByType] spawnTrainingDummy returned:`, dummy ? 'object' : 'null/false');
    if (!dummy || !dummy.userData) {
        console.error('[spawnEntityByType] Failed: no dummy or userData');
        return false;
    }

    dummy.userData.spawnType = entityType;
    dummy.userData.maxHp = config.maxHp;
    dummy.userData.hp = config.maxHp;
    if (Number.isFinite(config.radius)) {
        dummy.userData.radius = config.radius;
    }
    if (config.faction) {
        dummy.userData.faction = config.faction;
    }
    consumePendingDmEncounterSetup(dummy, entityType);
    console.log(`[spawnEntityByType] Successfully spawned ${entityType}:`, dummy.userData);
    return dummy;
}

function requestEntitySpawn(type = 'training-dummy') {
    const spawnType = normalizeSpawnEntityType(type);
    const angle = Math.random() * Math.PI * 2;
    const radius = 2.8 + (Math.random() * 1.6);
    const x = playerState.position.x + (Math.cos(angle) * radius);
    const y = playerState.position.y;
    const z = playerState.position.z + (Math.sin(angle) * radius);

    console.log(`[requestEntitySpawn] Type: ${type} -> ${spawnType}, Pos: (${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)})`);
    console.log(`[requestEntitySpawn] Mode: ${modeManager.current}, Can issue spawn: ${canIssueDmCommand('spawn-entity')}`);

    if (modeManager.current === MODE.DM) {
        console.log('[requestEntitySpawn] Using DM command path');
        const result = issueDmCommand('spawn-entity', {
            entityType: spawnType,
            position: { x, y, z },
        });
        console.log('[requestEntitySpawn] issueDmCommand returned:', result);
        return result;
    }

    console.log('[requestEntitySpawn] Using direct spawn path (not DM mode)');
    return spawnEntityByType(x, y, z, spawnType);
}

function requestTrainingDummySpawn(x, y, z, name = 'Training Dummy') {
    const payload = {
        position: { x, y, z },
        name,
    };

    if (modeManager.current === MODE.DM) {
        return issueDmCommand('spawn-training-dummy', payload) ? null : false;
    }

    return spawnTrainingDummy(x, y, z, name);
}

function dispatchDmCommand(command) {
    if (!command || !command.type) return false;

    traceDmPipeline('ISSUE DM COMMAND', {
        type: command.type,
        payload: command.payload || {},
        mode: modeManager.current,
        authority: simulationAuthority,
        layer: dmAuthorityLayer,
        hasSocket: !!socket,
    });

    const forceLocal = window.__DM_FORCE_LOCAL_DM_COMMANDS__ === true;
    const skipSocket = window.__DM_SKIP_SOCKET_DM_COMMANDS__ === true;
    const shouldExecuteLocalFirst = forceLocal || simulationAuthority === SIMULATION_AUTHORITY.LOCAL_DM;

    if (!socket || shouldExecuteLocalFirst) {
        const applied = applyDmCommandLocally(command);
        if (socket && !skipSocket) {
            _netStats.dmCommandsOut += 1;
            netLog(`dm-command OUT  type=${command.type}  out#=${_netStats.dmCommandsOut}`);
            socket.emit('dm-command', { command });
        }
        if (applied) {
            logDmCommandAction(command);
        }
        return applied;
    }

    _netStats.dmCommandsOut += 1;
    netLog(`dm-command OUT  type=${command.type}  out#=${_netStats.dmCommandsOut}`);
    socket.emit('dm-command', { command });
    logDmCommandAction(command);
    return true;
}

function logDmCommandAction(command) {
    if (!command || !command.type) return;
    const type = String(command.type).toLowerCase();
    const payload = command.payload || {};

    let message = null;
    switch (type) {
    case 'spawn-entity':
        message = `Spawn request: ${String(payload.entityType || 'training-dummy')}`;
        break;
    case 'spawn-training-dummy':
        message = 'Spawn request: training dummy';
        break;
    case 'possess-actor':
        message = `Possess request: ${String(payload.actorId || 'unknown')}`;
        break;
    case 'release-possession':
        message = 'Released possession';
        break;
    case 'apply-damage':
        message = `Damage applied: ${Math.max(0, Math.round(Number(payload.amount) || 0))}`;
        break;
    case 'set-hp':
        message = `HP set: ${Math.max(0, Math.round(Number(payload.value) || 0))}`;
        break;
    case 'despawn-actor':
        message = `Despawn request: ${String(payload.actorId || 'unknown')}`;
        break;
    case 'rewind-turn':
        message = 'Timeline rewind requested';
        break;
    default:
        break;
    }

    if (message) {
        addDmEvent(message, 'system');
    }
}
window.dispatchDmCommand = dispatchDmCommand;

function issueDmCommand(type, payload = {}) {
    if (modeManager.current !== MODE.DM) return false;
    let normalizedType = String(type || '').trim().toLowerCase();
    // Backward-compatible aliases for older UI call sites.
    if (normalizedType === 'possess') normalizedType = 'possess-actor';
    if (!normalizedType) return false;
    if (!canIssueDmCommand(normalizedType)) {
        console.warn(`[issueDmCommand] Blocked: ${normalizedType} not available in ${dmAuthorityLayer.toUpperCase()} mode`);
        showFloatingText(`Mode ${dmAuthorityLayer.toUpperCase()} cannot run ${normalizedType}`, '#ff8a8a', true);
        appendConsoleHistory(`DM capability blocked: ${normalizedType} (requires SIMULATOR mode for spawn commands)`, 'error');
        return false;
    }

    const command = {
        type: normalizedType,
        payload,
        issuedAt: Date.now(),
        authority: simulationAuthority,
        layer: dmAuthorityLayer,
    };

    traceDmPipeline('SENDING DM COMMAND', command);

    const forceLocal = window.__DM_FORCE_LOCAL_DM_COMMANDS__ === true;
    const skipSocket = window.__DM_SKIP_SOCKET_DM_COMMANDS__ === true;
    const shouldExecuteLocalFirst = forceLocal || simulationAuthority === SIMULATION_AUTHORITY.LOCAL_DM;

    if (!socket || shouldExecuteLocalFirst) {
        const applied = applyDmCommandLocally(command);
        if (socket && !skipSocket) {
            _netStats.dmCommandsOut += 1;
            netLog(`dm-command OUT  type=${command.type}  out#=${_netStats.dmCommandsOut}`);
            socket.emit('dm-command', { command });
        }
        return applied;
    }

    _netStats.dmCommandsOut += 1;
    netLog(`dm-command OUT  type=${command.type}  out#=${_netStats.dmCommandsOut}`);
    socket.emit('dm-command', { command });
    return true;
}

function emitDmCommand(command) {
    if (!command || typeof command !== 'object') return false;
    return issueDmCommand(command.type, command.payload || {});
}

function applyDmCommandLocally(command) {
    if (!command || !command.type) return false;
    traceDmPipeline('RECEIVED DM COMMAND', { from: 'local', command });
    applyDmCommandFromServer({ command });
    return true;
}

function requestStepTurn() {
    if (modeManager.current === MODE.DM) {
        return issueDmCommand('step-turn');
    }
    return stepTurn();
}

function requestEndTurn() {
    if (currentGameMode !== GAME_MODE.COMBAT) return false;
    if (modeManager.current === MODE.DM) {
        return issueDmCommand('end-turn');
    }
    endTurn();
    return true;
}

function requestRewindTurn() {
    if (modeManager.current === MODE.DM) {
        return issueDmCommand('rewind-turn');
    }
    return rewindTurn();
}

async function requestReplayLastAction() {
    if (modeManager.current === MODE.DM) {
        return issueDmCommand('replay-last-action');
    }
    return replayLastAction();
}

function requestPossessActor(actor) {
    if (!actor) return false;
    const resolved = actor === playerRig ? playerState : actor;
    const actorId = getCombatActorId(resolved);
    if (!actorId) return false;
    if (modeManager.current === MODE.DM) {
        return issueDmCommand('possess-actor', { actorId });
    }
    return possessActor(resolved);
}

function requestReleasePossession() {
    if (modeManager.current === MODE.DM) {
        return issueDmCommand('release-possession');
    }
    return releasePossession();
}

function resolveCombatActorForDm(actorId) {
    const id = String(actorId || '').trim();
    if (!id) return null;
    if (id === 'player' || id === getLocalCombatActorId()) return playerState;
    return findCombatActorById(id);
}

function setActorHpById(actorId, value) {
    const actor = resolveCombatActorForDm(actorId);
    const hpValue = Math.max(0, Number(value) || 0);
    if (!actor) return false;

    if (actor === playerState) {
        playerState.hp = Math.min(Number(playerState.maxHp) || hpValue, hpValue);
        updatePlayerHealthHud();
        return true;
    }

    actor.userData.hp = Math.min(Number(actor.userData?.maxHp) || hpValue, hpValue);
    if (actor.userData.hp <= 0) {
        removeTrainingDummy(actor);
        if (selectedCombatTarget === actor) setSelectedCombatTarget(null);
        exitCombatIfNoTargets();
    }
    return true;
}

function applyDamageToActorById(actorId, amount) {
    const actor = resolveCombatActorForDm(actorId);
    const damage = Math.max(0, Math.round(Number(amount) || 0));
    if (!actor || damage <= 0) return false;

    if (actor === playerState) {
        applyPlayerDamage(damage, 'DM override');
        return true;
    }

    return setActorHpById(actorId, Math.max(0, Number(actor.userData?.hp) - damage));
}

function handleDmInjectedInput(payload) {
    const actorId = String(payload.actorId || '').trim();
    const action = String(payload.action || payload.input?.action || '').toLowerCase();
    const targetId = String(payload.targetId || payload.input?.target || '').trim();
    if (!actorId || !action) return false;

    const actor = resolveCombatActorForDm(actorId);
    if (!actor) return false;

    if (action === 'attack') {
        const target = resolveCombatActorForDm(targetId) || selectedCombatTarget;
        if (actor === playerState) {
            if (!target || target === playerState || !target.parent) return false;
            setSelectedCombatTarget(target);
            selectMoveAndAttackAction(target);
            return true;
        }
        if (actor !== playerState) {
            if (getControlledActor() !== actor) {
                possessActor(actor);
            }
            return runPossessedEnemyAttack(actor);
        }
    }

    if (action === 'move') {
        const move = payload.move || payload.input?.move;
        if (!move || actor === playerState) return false;
        const x = Number(move.x);
        const z = Number(move.z);
        if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
        actor.position.x += x;
        actor.position.z += z;
        return true;
    }

    return false;
}

function applyDmCommandFromServer(packet) {
    const command = packet && (packet.command || packet);
    if (!command || !command.type) return;

    traceDmPipeline('APPLY DM COMMAND', {
        type: String(command.type || '').toLowerCase(),
        from: packet && packet.from ? packet.from : 'unknown',
        mode: modeManager.current,
        authority: simulationAuthority,
        layer: dmAuthorityLayer,
    });

    const payload = command.payload || {};

    const commandType = String(command.type).toLowerCase();
    switch (commandType) {
    case 'spawn-training-dummy': {
        if (!isLocalCombatAuthority()) return;
        const pos = payload.position || {};
        const x = Number(pos.x);
        const y = Number(pos.y);
        const z = Number(pos.z);
        const name = String(payload.name || 'Training Dummy');
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
        const dummy = spawnTrainingDummy(x, y, z, name);
        const actorId = String(payload.actorId || '').trim();
        if (dummy && dummy.userData && actorId) {
            dummy.userData.actorId = actorId;
            dummy.userData.networkId = actorId;
        }
        break;
    }
    case 'spawn-entity': {
        if (!isLocalCombatAuthority()) {
            console.warn('[SPAWN] spawn-entity blocked: not local combat authority');
            return;
        }
        const pos = payload.position || {};
        const x = Number(pos.x);
        const y = Number(pos.y);
        const z = Number(pos.z);
        const type = String(payload.entityType || payload.type || 'training-dummy');
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
            console.warn('[SPAWN] spawn-entity invalid position:', x, y, z);
            return;
        }
        console.log(`[SPAWN] Spawning ${type} at (${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)})`);
        const result = spawnEntityByType(x, y, z, type);
        const actorId = String(payload.actorId || '').trim();
        if (result && result.userData && actorId) {
            result.userData.actorId = actorId;
            result.userData.networkId = actorId;
        }
        console.log(`[SPAWN] Spawn result:`, result ? 'success' : 'failed');
        break;
    }
    case 'step-turn':
        if (!isLocalCombatAuthority()) return;
        stepTurn();
        break;
    case 'end-turn':
        if (!isLocalCombatAuthority()) return;
        endTurn();
        break;
    case 'rewind-turn':
        if (!isLocalCombatAuthority()) return;
        rewindTurn();
        break;
    case 'replay-last-action':
        if (!isLocalCombatAuthority()) return;
        void replayLastAction();
        break;
    case 'possess':
    case 'possess-actor': {
        if (!isLocalCombatAuthority()) return;
        const actorId = String(payload.actorId || '').trim();
        if (!actorId) return;
        const actor = resolveCombatActorForDm(actorId);
        if (!actor) return;
        possessActor(actor);
        break;
    }
    case 'release-possession':
        if (!isLocalCombatAuthority()) return;
        releasePossession();
        break;
    case 'set-hp':
        if (!isLocalCombatAuthority()) return;
        setActorHpById(payload.actorId, payload.value);
        break;
    case 'apply-damage':
        if (!isLocalCombatAuthority()) return;
        applyDamageToActorById(payload.actorId, payload.amount);
        break;
    case 'toggle-ai': {
        if (!isLocalCombatAuthority()) return;
        const actor = resolveCombatActorForDm(payload.actorId);
        if (!actor || actor === playerState) return;
        actor.userData.aiEnabled = payload.enabled !== false;
        break;
    }
    case 'despawn-actor': {
        if (!isLocalCombatAuthority()) return;
        const actor = resolveCombatActorForDm(payload.actorId);
        if (!actor || actor === playerState) return;
        removeTrainingDummy(actor);
        break;
    }
    case 'inject-input':
        if (!isLocalCombatAuthority()) return;
        handleDmInjectedInput(payload);
        break;
    case 'save-snapshot':
        if (!isLocalCombatAuthority()) return;
        saveSnapshot(String(payload.reason || 'dm-manual-snapshot'));
        break;
    case 'restore-snapshot': {
        if (!isLocalCombatAuthority()) return;
        const index = Number(payload.index);
        const targetIndex = Number.isFinite(index)
            ? THREE.MathUtils.clamp(index, 0, Math.max(0, combatTimeline.length - 1))
            : Math.max(0, combatTimeline.length - 1);
        const snapshot = combatTimeline[targetIndex] || null;
        if (snapshot) restoreCombatSnapshot(snapshot, { restoreTimelineState: true, setCursor: false });
        break;
    }
    case 'set-simulation-authority': {
        if (modeManager.current !== MODE.DM) return;
        const authority = String(payload.authority || '').toLowerCase();
        setSimulationAuthority(authority);
        syncDmAuthorityLayerFromState();
        break;
    }
    case 'force-roll': {
        if (!isLocalCombatAuthority()) return;
        const sides = Math.max(2, Math.floor(Number(payload.sides) || 20));
        const raw = 1 + Math.floor(Math.random() * sides);
        const mod = Number(payload.mod) || 0;
        emitDiceRollEvent({
            sides,
            label: String(payload.label || 'DM FORCE ROLL'),
            raw,
            total: raw + mod,
            mod,
        });
        break;
    }
    case 'trigger-event':
        addDmEvent(String(payload.message || 'DM event triggered'), 'system');
        break;
    default:
        break;
    }
}

function forceGodModeForDiagnostics() {
    modeManager.setMode(MODE.DM);
    setDmAuthorityLayer(DM_AUTHORITY_LAYER.SIMULATOR);
    setSimulationAuthority(SIMULATION_AUTHORITY.LOCAL_DM);
    startLocalSimulation();
    traceDmPipeline('FORCED GOD MODE', {
        mode: modeManager.current,
        layer: dmAuthorityLayer,
        authority: simulationAuthority,
    });
    appendConsoleHistory('DM diagnostics: forced GOD simulator + local command execution', 'ok');
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
    if (!gamepad || !gamepad.axes || gamepad.axes.length < 2) return { x: 0, y: 0 };
    const ax0 = gamepad.axes[0] ?? 0;
    const ay0 = gamepad.axes[1] ?? 0;
    const mag0 = Math.hypot(ax0, ay0);
    if (gamepad.axes.length >= 4) {
        const ax1 = gamepad.axes[2] ?? 0;
        const ay1 = gamepad.axes[3] ?? 0;
        const mag1 = Math.hypot(ax1, ay1);
        if (mag1 > mag0) {
            return { x: applyDeadzone(ax1), y: applyDeadzone(ay1) };
        }
    }
    return { x: applyDeadzone(ax0), y: applyDeadzone(ay0) };
}

function applyXRFlightControls(delta) {
    if (!renderer.xr.isPresenting) return false;
    const session = renderer.xr.getSession();
    if (!session) return false;

    let leftX = 0;
    let leftY = 0;
    let rightX = 0;
    let leftTrigger = 0;
    let rightTrigger = 0;
    let fallbackStickCount = 0;
    let fallbackTriggerCount = 0;

    for (const source of session.inputSources) {
        if (!source || !source.gamepad) continue;
        const stick = getPrimaryStickAxes(source.gamepad);
        const triggerValue = source.gamepad.buttons && source.gamepad.buttons[0]
            ? Number(source.gamepad.buttons[0].value) || 0
            : 0;
        if (source.handedness === 'left') {
            leftX = stick.x;
            leftY = stick.y;
            leftTrigger = triggerValue;
        } else if (source.handedness === 'right') {
            rightX = stick.x;
            rightTrigger = triggerValue;
        } else {
            if (fallbackStickCount === 0) {
                leftX = stick.x;
                leftY = stick.y;
            } else if (fallbackStickCount === 1) {
                rightX = stick.x;
            }
            fallbackStickCount++;
            if (fallbackTriggerCount === 0) {
                leftTrigger = triggerValue;
            } else if (fallbackTriggerCount === 1) {
                rightTrigger = triggerValue;
            }
            fallbackTriggerCount++;
        }
    }

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
    const verticalInput = rightTrigger - leftTrigger;
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
    syncPlayerRigFromState();
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
        activeSkyboxTheme = 'day';
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

const dmWorldSetpiece = createWorldDmSetpiece();
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
actionMenuEl = document.createElement('div');
actionMenuEl.id = 'action-menu';
actionMenuEl.style.position = 'fixed';
actionMenuEl.style.bottom = '140px';
actionMenuEl.style.left = '50%';
actionMenuEl.style.transform = 'translateX(-50%)';
actionMenuEl.style.padding = '12px 16px';
actionMenuEl.style.background = 'rgba(0,0,0,0.85)';
actionMenuEl.style.border = '2px solid rgba(99, 102, 241, 0.6)';
actionMenuEl.style.borderRadius = '8px';
actionMenuEl.style.color = '#eef2ff';
actionMenuEl.style.fontFamily = 'Consolas, "Segoe UI", monospace';
actionMenuEl.style.fontSize = '15px';
actionMenuEl.style.zIndex = '2300';
actionMenuEl.style.pointerEvents = 'auto';
actionMenuEl.style.display = 'flex';
actionMenuEl.style.gap = '8px';
actionMenuEl.style.visibility = 'hidden'; // Hidden by default
document.body.appendChild(actionMenuEl);

function setActionMenuVisible(visible) {
    if (!actionMenuEl) return;
    actionMenuEl.style.visibility = visible ? 'visible' : 'hidden';
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
    
    // Show end-turn prompt if player is out of resources
    if (!turnEndRequired && shouldShowEndTurnPrompt()) {
        showEndTurnPrompt();
    } else {
        hideEndTurnPrompt();
    }
    
    const isMove = currentAction === 'move';
    const isAttack = currentAction === 'attack';
    const isAbility = currentAction === 'ability';
    const actionButtonsDisabled = (turnEndRequired || combatState.lock)
        ? 'opacity: 0.45; cursor: not-allowed;'
        : '';
    const endTurnButtonStyle = turnEndRequired
        ? 'padding: 8px 12px; background: #7f1d1d; border: 1px solid #ef4444; color: #fff; border-radius: 4px; cursor: pointer; margin-left: 8px; font-weight: 700;'
        : 'padding: 8px 12px; background: #38404f; border: 1px solid #555; color: #999; border-radius: 4px; cursor: pointer; margin-left: 8px;';
    
    actionMenuEl.innerHTML = `
        <button class="action-btn ${isMove ? 'active' : ''}" data-action="move" style="padding: 8px 12px; background: ${isMove ? '#4f46e5' : '#38404f'}; border: 1px solid ${isMove ? '#818cf8' : '#555'}; color: #eef2ff; border-radius: 4px; cursor: pointer; ${actionButtonsDisabled}">Move</button>
        <button class="action-btn ${isAttack ? 'active' : ''}" data-action="attack" style="padding: 8px 12px; background: ${isAttack ? '#dc2626' : '#38404f'}; border: 1px solid ${isAttack ? '#f87171' : '#555'}; color: #eef2ff; border-radius: 4px; cursor: pointer; ${actionButtonsDisabled}">Attack</button>
        <button class="action-btn ${isAbility ? 'active' : ''}" data-action="ability" style="padding: 8px 12px; background: ${isAbility ? '#7c3aed' : '#38404f'}; border: 1px solid ${isAbility ? '#a78bfa' : '#555'}; color: #eef2ff; border-radius: 4px; cursor: pointer; ${actionButtonsDisabled}">Ability</button>
        <button class="action-btn end-turn" data-action="end-turn" style="${endTurnButtonStyle}">${turnEndRequired ? 'End Turn Required' : 'End Turn'}</button>
        ${combatInteraction.awaitingConfirm ? '<button class="confirm-btn" style="padding: 8px 12px; background: #16a34a; border: 1px solid #22c55e; color: #fff; border-radius: 4px; cursor: pointer; font-weight: bold;">CONFIRM</button>' : ''}
        ${combatInteraction.awaitingConfirm ? '<button class="cancel-btn" style="padding: 8px 12px; background: #7f1d1d; border: 1px solid #dc2626; color: #fff; border-radius: 4px; cursor: pointer;">Cancel</button>' : ''}
    `;
    
    // Attach click handlers
    Array.from(actionMenuEl.querySelectorAll('.action-btn')).forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const action = btn.dataset.action;
            if (action === 'end-turn') {
                if (turnEndRequired) {
                    confirmEndTurn();
                } else {
                    endTurn();
                }
            } else {
                if (isInputLockedForCombat('ACTION')) return;
                setCurrentAction(action);
            }
        });
    });
    
    const confirmBtn = actionMenuEl.querySelector('.confirm-btn');
    if (confirmBtn) {
        confirmBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            confirmAction();
        });
    }
    
    const cancelBtn = actionMenuEl.querySelector('.cancel-btn');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            cancelAction();
        });
    }
}

function setCurrentAction(action) {
    if (isInputLockedForCombat('ACTION')) return;
    resetCombatInteraction();
    currentAction = action;
    combatInteraction.action = action;
    updateActionMenu();
}

function confirmAction() {
    if (isInputLockedForCombat('ACTION')) return;
    if (combatState.timelineBusy) return;
    if (!combatInteraction.awaitingConfirm || !combatInteraction.target) return;

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
            showFloatingText('Invalid move', '#ff8a8a', true);
            return;
        }
        const targetForAttack = combatInteraction.moveAndAttackTarget;
        const moveStarted = executeMoveTo(combatInteraction.target, combatInteraction.preview.costFeet);
        if (moveStarted) {
            queuePostMoveAttack(targetForAttack, 'melee');
        }
        resetCombatInteraction();
    } else if (combatInteraction.action === 'move' || combatInteraction.action === 'move-to-approach') {
        if (!combatInteraction.preview || !combatInteraction.preview.valid) {
            showFloatingText('Invalid move', '#ff8a8a', true);
            return;
        }
        // target is now a world-space Vector3
        executeMoveTo(combatInteraction.target, combatInteraction.preview.costFeet);
        resetCombatInteraction();
    } else if (combatInteraction.action === 'attack') {
        playConfirmAttackSnap();
        executeAttack(combatInteraction.target);
    }
    updateActionMenu();
}

function cancelAction() {
    if (isInputLockedForCombat('ACTION')) return;
    resetCombatInteraction();
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
(function buildActionBar() {
    const bar = document.createElement('div');
    bar.id = 'action-bar';
    bar.style.position = 'fixed';
    bar.style.bottom = '24px';
    bar.style.left = '50%';
    bar.style.transform = 'translateX(-50%)';
    bar.style.display = 'none';
    bar.style.flexDirection = 'row';
    bar.style.gap = '10px';
    bar.style.zIndex = '2400';
    bar.style.pointerEvents = 'auto';

    const btnStyle = `
        padding: 10px 20px;
        background: rgba(20,20,30,0.88);
        color: #e6f0ff;
        border: 1px solid rgba(180,180,255,0.4);
        border-radius: 6px;
        font-family: monospace;
        font-size: 14px;
        cursor: pointer;
        pointer-events: auto;
    `;

    const makeBtn = (label, onClick) => {
        const b = document.createElement('button');
        b.textContent = label;
        b.setAttribute('style', btnStyle);
        b.addEventListener('mousedown', e => e.stopPropagation());
        b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
        return b;
    };

    bar.appendChild(makeBtn('⚔ Melee', () => {
        if (!playerState.actionAvailable) { showFloatingText('No action left', '#ff8a8a'); return; }
        pendingAction = 'melee';
        showFloatingText('Click a target to attack', '#ffd166');
    }));
    bar.appendChild(makeBtn('🏹 Ranged', () => {
        if (!playerState.actionAvailable) { showFloatingText('No action left', '#ff8a8a'); return; }
        pendingAction = 'ranged';
        showFloatingText('Click a target to shoot', '#ffd166');
    }));
    bar.appendChild(makeBtn('⏩ End Turn', () => endTurn()));

    document.body.appendChild(bar);
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
    if (modeManager.current === MODE.DM) return;
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

    const tagName = event.target && event.target.tagName ? event.target.tagName : '';
    const isTextInput = tagName === 'INPUT' || tagName === 'TEXTAREA';
    const isPlayerInputMode = canUseStandardMovementControls();

    if (!isPlayerInputMode) {
        if (modeManager.current === MODE.DM && !event.repeat && (event.code === 'Digit4' || event.code === 'Numpad4')) {
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
        if (modeManager.current === MODE.DM && getControlledActor()) {
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
    if (modeManager.current === MODE.DM && controlled && controlled !== playerState) {
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
    if (modeManager.current === MODE.DM && !hasDmPossessionControl() && activeInputActor === playerState) {
        playerState.velocity.set(0, 0, 0);
        moveX = 0;
        moveZ = 0;
    }
    playerState.position.x += moveX;
    playerState.position.z += moveZ;
    const previousY = playerState.position.y;
    playerState.position.y += playerState.velocity.y * fixedDelta;

    // Possession is input-rerouted: DM input drives the possessed actor entity.
    if (modeManager.current === MODE.DM && activeInputActor && activeInputActor !== playerState) {
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

                // Load persisted scene state now that the model is in the scene
                fetch('/scene_state')
                    .then((r) => {
                        if (!r.ok) return null;
                        const contentType = r.headers.get('content-type') || '';
                        if (!contentType.includes('application/json')) return null;
                        return r.json();
                    })
                    .then((state) => {
                        if (state) hydrateWorld(state);
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

// --- Improved serialization using object names as keys, robust material/transform handling ---
function serializeMaterial(mat) {
    if (!mat) return null;
    const textureAnim = getMaterialTextureAnim(mat);
    return {
        type: mat.type,
        color: mat.color ? mat.color.getHex() : null,
        emissive: mat.emissive ? mat.emissive.getHex() : null,
        metalness: typeof mat.metalness === 'number' ? mat.metalness : undefined,
        roughness: typeof mat.roughness === 'number' ? mat.roughness : undefined,
        opacity: typeof mat.opacity === 'number' ? mat.opacity : undefined,
        wireframe: typeof mat.wireframe === 'boolean' ? mat.wireframe : undefined,
        map: mat.map?.image?.src || null,
        textureAnim,
    };
}

function emitMaterialChange(obj, materialIndex = 0) {
    if (!socket || !obj || !obj.isMesh) return;
    let mat = Array.isArray(obj.material)
        ? obj.material[materialIndex]
        : obj.material;
    socket.emit('scene-update', {
        type: 'material',
        name: obj.name,
        materialIndex,
        materialState: serializeMaterial(mat)
    });
}

function findMeshByName(name) {
    let found = null;
    scene.traverse(obj => {
        if (obj.isMesh) {
            const n = obj.name && obj.name.trim() ? obj.name : obj.type + '_' + obj.id;
            if (n === name) found = obj;
        }
    });
    return found;
}

function serializeObject(obj) {
    if (!obj.isMesh) return null;
    // Use name as key, fallback to type+index if missing
    const name = obj.name && obj.name.trim() ? obj.name : obj.type + '_' + obj.id;
    let materials = null;
    if (Array.isArray(obj.material)) {
        materials = obj.material.map(m => serializeMaterial(m));
    } else if (obj.material) {
        materials = [serializeMaterial(obj.material)];
    }
    return {
        name,
        position: { x: obj.position.x, y: obj.position.y, z: obj.position.z },
        rotation: { x: obj.rotation.x, y: obj.rotation.y, z: obj.rotation.z },
        scale: { x: obj.scale.x, y: obj.scale.y, z: obj.scale.z },
        materials
    };
}

function serializeScene() {
    const objects = {};
    const lights = {};
    scene.traverse(obj => {
        const data = serializeObject(obj);
        if (data) objects[data.name] = data;

        const lightData = serializeLight(obj);
        if (lightData) lights[lightData.name] = lightData;
    });
    return { objects, lights };
}

function applyMaterialState(mat, state, mesh) {
    if (!mat || !state) return;
    // If material type differs, replace it
    if (mat.type !== state.type && THREE[state.type]) {
        const newMat = new THREE[state.type]();
        if (Array.isArray(mesh.material)) {
            const index = mesh.material.indexOf(mat);
            if (index !== -1) mesh.material[index] = newMat;
        } else {
            mesh.material = newMat;
        }
        mat = newMat;
    }
    if (state.color && mat.color) mat.color.setHex(state.color);
    if (state.emissive && mat.emissive) mat.emissive.setHex(state.emissive);
    if (typeof state.metalness === 'number') mat.metalness = state.metalness;
    if (typeof state.roughness === 'number') mat.roughness = state.roughness;
    if (typeof state.opacity === 'number') mat.opacity = state.opacity;
    if (typeof state.wireframe === 'boolean') mat.wireframe = state.wireframe;
    if (state.textureAnim) {
        setMaterialTextureAnimAxis(mat, 'x', state.textureAnim.x);
        setMaterialTextureAnimAxis(mat, 'y', state.textureAnim.y);
        setMaterialTextureAnimAxis(mat, 'z', state.textureAnim.z);
    }
    const mapUrl = typeof state.map === 'string' ? state.map.trim() : '';
    if (mapUrl && mapUrl !== 'undefined' && mapUrl !== 'null') {
        new THREE.TextureLoader().load(mapUrl, (tex) => {
            mat.map = tex;
            mat.needsUpdate = true;
        });
    }
    mat.needsUpdate = true;
}

function applyStateToObject(obj, state) {
    if (!obj.isMesh) return;
    if (state.position) obj.position.set(state.position.x, state.position.y, state.position.z);
    if (state.rotation) obj.rotation.set(state.rotation.x, state.rotation.y, state.rotation.z);
    if (state.scale) obj.scale.set(state.scale.x, state.scale.y, state.scale.z);
    if (state.materials && obj.material) {
        if (Array.isArray(obj.material)) {
            for (let i = 0; i < obj.material.length; ++i) {
                if (state.materials[i]) applyMaterialState(obj.material[i], state.materials[i], obj);
            }
        } else if (state.materials[0]) {
            applyMaterialState(obj.material, state.materials[0], obj);
        }
    }
}

function applySceneState(state) {
    if (!state || !state.objects) return;
    if (!isSceneReadyForWorldState()) {
        pendingSceneState = state;
        traceDmPipeline('SCENE STATE QUEUED', {
            objectCount: Object.keys(state.objects || {}).length,
        });
        return;
    }
    // Map name to mesh
    const meshMap = {};
    scene.traverse(obj => {
        if (obj.isMesh) {
            const name = obj.name && obj.name.trim() ? obj.name : obj.type + '_' + obj.id;
            meshMap[name] = obj;
        }
    });
    for (const name in state.objects) {
        if (meshMap[name]) {
            applyStateToObject(meshMap[name], state.objects[name]);
        }
    }

    // Sync user-created point lights from persisted state.
    const lightMap = {};
    scene.traverse(obj => {
        if (obj.isPointLight && obj.userData.isUserLight) {
            lightMap[obj.name] = obj;
        }
    });
    if (state.lights) {
        for (const name in state.lights) {
            if (lightMap[name]) {
                applyStateToLight(lightMap[name], state.lights[name]);
            } else {
                const newLight = createUserPointLight(state.lights[name]);
                scene.add(newLight);
            }
        }
    }

    // (updateHierarchyMenu removed)
    updateInspectorMenu();
}
// (Old floating save/load button code removed; now handled in inspector menu only)

// Add save/load buttons to inspector menu
function addSaveLoadButtonsToInspector() {
    // Remove any existing button container
    const old = inspectorMenu.querySelector('.inspector-save-load');
    if (old) old.remove();
    const btnContainer = document.createElement('div');
    btnContainer.className = 'inspector-save-load';
    btnContainer.style.display = 'flex';
    btnContainer.style.flexDirection = 'column';
    btnContainer.style.gap = '12px';
    btnContainer.style.position = 'absolute';
    btnContainer.style.bottom = '24px';
    btnContainer.style.left = '0';
    btnContainer.style.width = '100%';
    btnContainer.style.alignItems = 'center';
    btnContainer.style.pointerEvents = 'auto';

    // Save button
    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save Scene State';
    saveBtn.style.padding = '10px 18px';
    saveBtn.style.background = '#1976d2';
    saveBtn.style.color = '#fff';
    saveBtn.style.border = 'none';
    saveBtn.style.borderRadius = '6px';
    saveBtn.style.fontSize = '17px';
    saveBtn.style.cursor = 'pointer';
    saveBtn.style.width = '85%';
    saveBtn.onclick = () => {
        const state = serializeScene();
        fetch('/scene_state', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(state)
        }).then(r => r.json()).then(data => {
            if (data.ok) alert('Scene state saved!');
            else alert('Failed to save scene state.');
        });
    };
    btnContainer.appendChild(saveBtn);

    // Load button
    const loadBtn = document.createElement('button');
    loadBtn.textContent = 'Load Scene State';
    loadBtn.style.padding = '10px 18px';
    loadBtn.style.background = '#388e3c';
    loadBtn.style.color = '#fff';
    loadBtn.style.border = 'none';
    loadBtn.style.borderRadius = '6px';
    loadBtn.style.fontSize = '17px';
    loadBtn.style.cursor = 'pointer';
    loadBtn.style.width = '85%';
    loadBtn.onclick = () => {
        fetch('/scene_state')
            .then((r) => {
                if (!r.ok) throw new Error(`Scene state unavailable (${r.status})`);
                const contentType = r.headers.get('content-type') || '';
                if (!contentType.includes('application/json')) {
                    throw new Error('Scene state endpoint did not return JSON');
                }
                return r.json();
            })
            .then(state => {
                hydrateWorld(state);
                alert('Scene state loaded!');
            })
            .catch((err) => {
                console.warn('Could not load scene state from button:', err);
                alert('Scene state is unavailable on this server.');
            });
    };
    btnContainer.appendChild(loadBtn);

    inspectorMenu.appendChild(btnContainer);
}

// Render loop
let lastTime = performance.now();
let lastFrameDeltaMs = 0;
let lastFrameSpikeLogAtMs = 0;
const FRAME_SPIKE_LOG_THRESHOLD_MS = 30;
let observerFrameCounter = 0;
const OBSERVER_FRAME_STRIDE = 2;
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

    if (!isPrimaryClient()) {
        return;
    }
    syncSkyboxWithGameMode();
    updateClientRuntimeModeFromAuthority();

    if (isObserverClient()) {
        observerFrameCounter += 1;
        if ((observerFrameCounter % OBSERVER_FRAME_STRIDE) !== 0) {
            return;
        }
        const observerView = getActiveViewCamera();
        syncDicePassCamera();
        renderWorldWithDmInset(observerView);
        renderer.clearDepth();
        renderer.render(diceScene, dicePassCamera);
        return;
    }
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
            (combatState.phase === 'PLAYER' || currentAction === 'move' || !!moveZoneDisc || !!movementCursor);

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
        if (!turnEndRequired && shouldShowEndTurnPrompt()) {
            showEndTurnPrompt();
        } else {
            hideEndTurnPrompt();
        }
    } else {
        hideEndTurnPrompt();
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






