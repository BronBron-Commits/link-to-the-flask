import * as THREE from './three.module.js';
import { createMap3dRuntime } from './map3d_runtime.js';
import { createMap3dControls } from './map3d_controls.js';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x10141f);

const camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
);
camera.position.set(4, 3, 6);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio || 1);
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const keyLight = new THREE.DirectionalLight(0xffffff, 1.0);
keyLight.position.set(5, 10, 7);
scene.add(keyLight);

const grid = new THREE.GridHelper(20, 20, 0x3a4a74, 0x22314d);
scene.add(grid);

const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 20),
    new THREE.MeshStandardMaterial({
        color: 0x151c2d,
        roughness: 0.95,
        metalness: 0.05,
    })
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.001;
scene.add(floor);

const testMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x5cb8ff })
);
testMesh.position.y = 0.5;
scene.add(testMesh);

const runtime = createMap3dRuntime({
    scene,
    camera,
    renderer,
});

const controls = createMap3dControls({
    camera,
    renderer,
    getActorHitObjects: () => runtime.getActorHitObjects(),
    getInputFlags: () => runtime.getInputFlags(),
    emitIntent: (type, payload) => runtime.emitIntent(type, payload),
});
controls.start();

const urlSearch = new URLSearchParams(window.location.search || '');
const mapDebug = urlSearch.get('mapdebug') === '1';
const simulationMode = urlSearch.get('sim') === '1';
const simulationArtifactPath = urlSearch.get('simPath') || '/artifacts/timeline-debug.json';

if (simulationMode) {
    // Top-down tactical framing for simulation playback.
    camera.position.set(0, 28, 0.001);
    camera.up.set(0, 0, -1);
    camera.lookAt(0, 0, 0);
}

function debugLog(...args) {
    if (!mapDebug) return;
    console.log(...args);
}

function createSimulationPanel() {
    const panel = document.createElement('div');
    panel.style.position = 'fixed';
    panel.style.left = '12px';
    panel.style.bottom = '12px';
    panel.style.padding = '10px';
    panel.style.background = 'rgba(11,15,26,0.86)';
    panel.style.color = '#d9e2f0';
    panel.style.font = '12px/1.3 monospace';
    panel.style.border = '1px solid rgba(120,150,220,0.35)';
    panel.style.borderRadius = '8px';
    panel.style.zIndex = '20';
    panel.style.display = 'flex';
    panel.style.flexDirection = 'column';
    panel.style.gap = '8px';

    const title = document.createElement('strong');
    title.textContent = 'Simulation Replay';
    panel.appendChild(title);

    const controlsWrap = document.createElement('div');
    controlsWrap.style.display = 'flex';
    controlsWrap.style.gap = '6px';

    const loadBtn = document.createElement('button');
    loadBtn.textContent = 'Load';
    const playBtn = document.createElement('button');
    playBtn.textContent = 'Play';
    const pauseBtn = document.createElement('button');
    pauseBtn.textContent = 'Pause';
    const resetBtn = document.createElement('button');
    resetBtn.textContent = 'Reset';

    [loadBtn, playBtn, pauseBtn, resetBtn].forEach((btn) => {
        btn.style.cursor = 'pointer';
        btn.style.border = '1px solid rgba(136,168,240,0.5)';
        btn.style.background = '#15233c';
        btn.style.color = '#d9e2f0';
        btn.style.padding = '4px 8px';
        btn.style.borderRadius = '6px';
        controlsWrap.appendChild(btn);
    });

    panel.appendChild(controlsWrap);

    const speedWrap = document.createElement('label');
    speedWrap.textContent = 'Speed '; 
    const speedSelect = document.createElement('select');
    ['0.5', '1', '2', '4'].forEach((value) => {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = `${value}x`;
        if (value === '1') opt.selected = true;
        speedSelect.appendChild(opt);
    });
    speedWrap.appendChild(speedSelect);
    panel.appendChild(speedWrap);

    const tickWrap = document.createElement('label');
    tickWrap.textContent = 'Tick '; 
    const tickSlider = document.createElement('input');
    tickSlider.type = 'range';
    tickSlider.min = '0';
    tickSlider.max = '0';
    tickSlider.value = '0';
    tickSlider.style.width = '220px';
    tickWrap.appendChild(tickSlider);
    panel.appendChild(tickWrap);

    const tickText = document.createElement('div');
    tickText.textContent = 'Tick -';
    panel.appendChild(tickText);

    const eventText = document.createElement('div');
    eventText.textContent = 'Event: -';
    panel.appendChild(eventText);

    const roster = document.createElement('pre');
    roster.textContent = 'Actors: -';
    roster.style.margin = '0';
    roster.style.maxHeight = '120px';
    roster.style.overflow = 'auto';
    roster.style.background = 'rgba(5, 9, 16, 0.52)';
    roster.style.padding = '6px';
    panel.appendChild(roster);

    const status = document.createElement('div');
    status.textContent = 'Idle';
    panel.appendChild(status);

    document.body.appendChild(panel);

    return {
        panel,
        loadBtn,
        playBtn,
        pauseBtn,
        resetBtn,
        speedSelect,
        tickSlider,
        tickText,
        eventText,
        roster,
        status,
    };
}

function installAudioUnlock() {
    let unlocked = false;

    const cleanup = () => {
        window.removeEventListener('pointerdown', unlockOnGesture, true);
        window.removeEventListener('keydown', unlockOnGesture, true);
        window.removeEventListener('touchstart', unlockOnGesture, true);
    };

    const unlockOnGesture = async () => {
        if (unlocked) return;
        unlocked = true;
        cleanup();

        try {
            if (window.Tone && typeof window.Tone.start === 'function') {
                await window.Tone.start();
            }
            const toneCtx = window.Tone && window.Tone.context;
            if (toneCtx && typeof toneCtx.resume === 'function') {
                await toneCtx.resume();
            }
            const rawCtx = toneCtx && toneCtx.rawContext;
            if (rawCtx && rawCtx.state === 'suspended' && typeof rawCtx.resume === 'function') {
                await rawCtx.resume();
            }
        } catch (err) {
            debugLog('[MAP3D] Audio unlock skipped', err);
        }
    };

    window.addEventListener('pointerdown', unlockOnGesture, true);
    window.addEventListener('keydown', unlockOnGesture, true);
    window.addEventListener('touchstart', unlockOnGesture, true);
}

installAudioUnlock();

const networkState = {
    localSid: null,
    playersById: new Map(),
    enemiesById: new Map(),
    currentTurn: null,
    inCombat: false,
};

const simulationReplay = {
    data: null,
    tickStates: [],
    currentIndex: 0,
    timer: null,
    playing: false,
    speed: 1,
    actorLayout: new Map(),
    actorProjectedPos: new Map(),
    attackLine: null,
    attackLineUntilMs: 0,
    ui: null,
};

function numberOr(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function nextIntentId(prefix) {
    return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

function toPlayerActor(entry, fallbackId) {
    if (!entry || typeof entry !== 'object') return null;
    const actorId = String(entry.actorId || entry.networkId || entry.id || fallbackId || '').trim();
    if (!actorId) return null;

    const pos = (entry.position && typeof entry.position === 'object') ? entry.position : {};
    const rot = (entry.rotation && typeof entry.rotation === 'object') ? entry.rotation : {};
    const maxHp = numberOr(entry.maxHp ?? entry.max_hp, numberOr(entry.hp ?? entry.currentHp ?? entry.current_hp, 20));
    const hp = numberOr(entry.hp ?? entry.currentHp ?? entry.current_hp, maxHp);

    return {
        id: actorId,
        team: 'player',
        label: String(entry.name || entry.label || actorId),
        hp,
        maxHp,
        position: {
            x: numberOr(pos.x, 0),
            y: numberOr(pos.y, 0.7),
            z: numberOr(pos.z, 0),
        },
        rotation: {
            y: numberOr(rot.y, 0),
        },
        ownerSid: fallbackId || null,
    };
}

function toEnemyActor(entry, fallbackId) {
    if (!entry || typeof entry !== 'object') return null;
    const actorId = String(entry.actorId || entry.networkId || entry.id || fallbackId || '').trim();
    if (!actorId) return null;

    const pos = (entry.position && typeof entry.position === 'object') ? entry.position : {};
    const maxHp = numberOr(entry.maxHp, numberOr(entry.hp, 30));
    const hp = numberOr(entry.hp, maxHp);

    return {
        id: actorId,
        team: 'enemy',
        label: String(entry.name || entry.label || actorId),
        hp,
        maxHp,
        position: {
            x: numberOr(pos.x, 0),
            y: numberOr(pos.y, 0.7),
            z: numberOr(pos.z, 0),
        },
        rotation: {
            y: numberOr(entry.rotationY, 0),
        },
    };
}

function currentTurnAllowsLocalInput() {
    const current = networkState.currentTurn;
    if (!current || typeof current !== 'object') return true;
    const currentActor = current.currentActor;
    if (!currentActor || typeof currentActor !== 'object') return true;
    if (String(currentActor.type || '').toLowerCase() !== 'player') return false;

    const ownerSid = String(currentActor.ownerSid || '').trim();
    if (!ownerSid) return true;
    if (!networkState.localSid) return true;
    return ownerSid === networkState.localSid;
}

function publishSnapshot() {
    const actors = [
        ...networkState.playersById.values(),
        ...networkState.enemiesById.values(),
    ];

    const currentTurnActorId = networkState.currentTurn?.currentActor?.id || null;
    const canInput = networkState.inCombat ? currentTurnAllowsLocalInput() : true;

    runtime.applySnapshot({
        actors,
        currentTurnActorId,
        canMove: canInput,
        canAttack: canInput,
        canEndTurn: canInput,
    });
}

function stopSimulationReplay() {
    if (simulationReplay.timer) {
        clearTimeout(simulationReplay.timer);
        simulationReplay.timer = null;
    }
    simulationReplay.playing = false;
}

function ensureActorLayout(id, team, indexHint) {
    if (simulationReplay.actorLayout.has(id)) {
        return simulationReplay.actorLayout.get(id);
    }
    const idx = Number.isFinite(indexHint) ? indexHint : simulationReplay.actorLayout.size;
    const isEnemy = team === 'enemy';
    const column = idx % 5;
    const row = Math.floor(idx / 5);
    const pos = {
        x: -8 + (column * 4),
        y: 0.7,
        z: (isEnemy ? 6 : -6) + (row * (isEnemy ? 2 : -2)),
    };
    simulationReplay.actorLayout.set(id, pos);
    return pos;
}

function getProjectedActorPos(id, fallbackPos) {
    const existing = simulationReplay.actorProjectedPos.get(id);
    if (existing) return existing;
    const seed = {
        x: numberOr(fallbackPos?.x, 0),
        y: numberOr(fallbackPos?.y, 0.7),
        z: numberOr(fallbackPos?.z, 0),
    };
    simulationReplay.actorProjectedPos.set(id, seed);
    return seed;
}

function ensureAttackLine() {
    if (simulationReplay.attackLine) return simulationReplay.attackLine;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
        0, 0.9, 0,
        0, 0.9, 0,
    ], 3));
    const material = new THREE.LineBasicMaterial({
        color: 0xffc857,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
    });
    const line = new THREE.Line(geometry, material);
    line.visible = false;
    scene.add(line);
    simulationReplay.attackLine = line;
    return line;
}

function hideAttackLine() {
    if (!simulationReplay.attackLine) return;
    simulationReplay.attackLine.visible = false;
    simulationReplay.attackLineUntilMs = 0;
}

function setAttackLineForEvent(event) {
    if (!event || typeof event !== 'object') {
        hideAttackLine();
        return;
    }

    const eventType = String(event.type || '').toLowerCase();
    if (eventType !== 'action:attack') {
        hideAttackLine();
        return;
    }

    const sourceId = String(event.source || '').trim();
    const targetId = String(event.targetId || '').trim();
    if (!sourceId || !targetId) {
        hideAttackLine();
        return;
    }

    const src = simulationReplay.actorProjectedPos.get(sourceId);
    const dst = simulationReplay.actorProjectedPos.get(targetId);
    if (!src || !dst) {
        hideAttackLine();
        return;
    }

    const line = ensureAttackLine();
    const posAttr = line.geometry.getAttribute('position');
    posAttr.setXYZ(0, src.x, 0.9, src.z);
    posAttr.setXYZ(1, dst.x, 0.9, dst.z);
    posAttr.needsUpdate = true;

    const srcTeam = classifyTeamFromId(sourceId, simulationReplay.data);
    if (line.material && line.material.color) {
        if (srcTeam === 'enemy') {
            line.material.color.setHex(0xff8a80);
        } else if (srcTeam === 'player') {
            line.material.color.setHex(0x80d8ff);
        } else {
            line.material.color.setHex(0xffc857);
        }
        line.material.opacity = 0.95;
    }

    line.visible = true;
    simulationReplay.attackLineUntilMs = performance.now() + 320;
}

function stepProjectedMovement(events) {
    if (!Array.isArray(events) || events.length === 0) return;

    const actorIds = Array.from(simulationReplay.actorProjectedPos.keys());
    actorIds.forEach((id) => {
        const pos = simulationReplay.actorProjectedPos.get(id);
        const home = simulationReplay.actorLayout.get(id);
        if (!pos || !home) return;
        // Gentle drift back toward formation baseline each tick.
        pos.x += (home.x - pos.x) * 0.18;
        pos.z += (home.z - pos.z) * 0.18;
    });

    events.forEach((evt) => {
        const sourceId = String(evt?.source || '').trim();
        const targetId = String(evt?.targetId || '').trim();
        const eventType = String(evt?.type || '').toLowerCase();
        if (!sourceId) return;

        const src = simulationReplay.actorProjectedPos.get(sourceId);
        if (!src) return;

        if ((eventType.startsWith('action:') || eventType === 'turn:end') && targetId) {
            const dst = simulationReplay.actorProjectedPos.get(targetId);
            if (!dst) return;
            const dx = dst.x - src.x;
            const dz = dst.z - src.z;
            const len = Math.hypot(dx, dz) || 1;
            const nx = dx / len;
            const nz = dz / len;

            if (eventType === 'action:attack') {
                // Close to a readable melee offset so attacks feel in-range.
                const desiredGap = 1.25;
                const approach = Math.max(0, len - desiredGap);
                const step = Math.min(2.2, Math.max(0.75, approach * 0.75));
                src.x += nx * step;
                src.z += nz * step;
            } else {
                const step = Math.min(1.35, len * 0.22);
                src.x += nx * step;
                src.z += nz * step;
            }
        }
    });
}

function classifyTeamFromId(id, data) {
    const players = Array.isArray(data?.players) ? data.players : [];
    const enemies = Array.isArray(data?.enemies) ? data.enemies : [];
    if (players.some((p) => String(p.id) === id)) return 'player';
    if (enemies.some((e) => String(e.id) === id)) return 'enemy';
    if (id.startsWith('p')) return 'player';
    if (id.startsWith('e')) return 'enemy';
    return 'neutral';
}

function applySimulationTick(index) {
    if (!simulationReplay.data || !simulationReplay.tickStates.length) return;
    const safeIdx = Math.max(0, Math.min(index, simulationReplay.tickStates.length - 1));
    simulationReplay.currentIndex = safeIdx;
    const tickState = simulationReplay.tickStates[safeIdx] || {};
    const tick = Number.isFinite(tickState.tick) ? tickState.tick : safeIdx;
    const actorsById = tickState.actors && typeof tickState.actors === 'object' ? tickState.actors : {};
    const actorIds = Object.keys(actorsById);
    const events = Array.isArray(simulationReplay.data?.events)
        ? simulationReplay.data.events.filter((evt) => Number(evt.tick) === Number(tick))
        : [];
    const leadEvent = events[0] || null;

    actorIds.forEach((id, idx) => {
        const state = actorsById[id] || {};
        const team = classifyTeamFromId(id, simulationReplay.data);
        const basePos = ensureActorLayout(id, team, idx);
        const projected = getProjectedActorPos(id, basePos);
        const alive = state.alive !== false;
        if (!alive) {
            projected.x = basePos.x;
            projected.z = basePos.z;
        }
    });

    stepProjectedMovement(events);
    setAttackLineForEvent(leadEvent);

    const actors = actorIds.map((id, idx) => {
        const state = actorsById[id] || {};
        const team = classifyTeamFromId(id, simulationReplay.data);
        const basePos = ensureActorLayout(id, team, idx);
        const projected = getProjectedActorPos(id, basePos);
        const alive = state.alive !== false;
        return {
            id,
            team,
            label: id,
            hp: numberOr(state.hp, 0),
            maxHp: numberOr(state.maxHp, Math.max(1, numberOr(state.hp, 1))),
            alive,
            position: {
                x: projected.x,
                y: alive ? basePos.y : -20,
                z: projected.z,
            },
            rotation: { y: 0 },
        };
    });

    runtime.applySnapshot({
        actors,
        currentTurnActorId: leadEvent && leadEvent.source ? String(leadEvent.source) : null,
        selectedTargetId: leadEvent && leadEvent.targetId ? String(leadEvent.targetId) : null,
        canMove: false,
        canAttack: false,
        canEndTurn: false,
    });

    if (simulationReplay.ui) {
        simulationReplay.ui.status.textContent = `Tick ${tick} (${safeIdx + 1}/${simulationReplay.tickStates.length})`;
        simulationReplay.ui.tickSlider.max = String(Math.max(0, simulationReplay.tickStates.length - 1));
        simulationReplay.ui.tickSlider.value = String(safeIdx);
        simulationReplay.ui.tickText.textContent = `Tick ${tick} (${safeIdx + 1}/${simulationReplay.tickStates.length})`;
        simulationReplay.ui.eventText.textContent = leadEvent
            ? `Event: ${String(leadEvent.type || 'event')} ${leadEvent.source || '-'} -> ${leadEvent.targetId || '-'}`
            : 'Event: -';

        const rosterLines = actorIds
            .map((id) => {
                const s = actorsById[id] || {};
                const hp = numberOr(s.hp, 0);
                const alive = s.alive !== false;
                return `${id}  HP ${Math.max(0, Math.round(hp))}${alive ? '' : ' (dead)'}`;
            })
            .sort();
        simulationReplay.ui.roster.textContent = rosterLines.length
            ? `Actors (${rosterLines.length})\n${rosterLines.join('\n')}`
            : 'Actors: -';
    }
}

function getSimulationStepDelayMs(currentTick) {
    const events = Array.isArray(simulationReplay.data?.events) ? simulationReplay.data.events : [];
    const speed = Math.max(0.1, Number(simulationReplay.speed) || 1);
    const perTickDuration = events
        .filter((evt) => Number(evt.tick) === Number(currentTick))
        .reduce((sum, evt) => sum + Math.max(1, numberOr(evt.durationMs, 1)), 0);
    const base = perTickDuration > 0 ? perTickDuration : 180;
    return Math.max(60, Math.floor(base / speed));
}

function scheduleSimulationReplay() {
    if (!simulationReplay.playing) return;
    const ticks = simulationReplay.tickStates;
    if (!ticks.length) return;

    const current = ticks[simulationReplay.currentIndex] || {};
    const tick = Number.isFinite(current.tick) ? current.tick : simulationReplay.currentIndex;
    const delay = getSimulationStepDelayMs(tick);

    simulationReplay.timer = setTimeout(() => {
        const next = simulationReplay.currentIndex + 1;
        if (next >= ticks.length) {
            stopSimulationReplay();
            return;
        }
        applySimulationTick(next);
        scheduleSimulationReplay();
    }, delay);
}

async function loadSimulationArtifact(artifactPath = simulationArtifactPath) {
    stopSimulationReplay();
    simulationReplay.actorLayout.clear();
    simulationReplay.actorProjectedPos.clear();
    hideAttackLine();

    const response = await fetch(artifactPath, { cache: 'no-store' });
    if (!response.ok) {
        throw new Error(`Failed to load artifact: ${response.status}`);
    }
    const data = await response.json();
    simulationReplay.data = data;
    simulationReplay.tickStates = Array.isArray(data.stateByTick) ? data.stateByTick.slice() : [];
    simulationReplay.currentIndex = 0;

    applySimulationTick(0);
    if (simulationReplay.ui) {
        simulationReplay.ui.status.textContent = `Loaded ${simulationReplay.tickStates.length} ticks`; 
        simulationReplay.ui.tickSlider.max = String(Math.max(0, simulationReplay.tickStates.length - 1));
        simulationReplay.ui.tickSlider.value = '0';
    }
}

function playSimulationReplay() {
    if (!simulationReplay.tickStates.length) return;
    stopSimulationReplay();
    simulationReplay.playing = true;
    scheduleSimulationReplay();
}

function pauseSimulationReplay() {
    stopSimulationReplay();
}

function resetSimulationReplay() {
    stopSimulationReplay();
    hideAttackLine();
    applySimulationTick(0);
}

function ingestPlayersState(playersPayload) {
    networkState.playersById.clear();
    if (!playersPayload || typeof playersPayload !== 'object') {
        publishSnapshot();
        return;
    }

    Object.entries(playersPayload).forEach(([sid, entry]) => {
        const actor = toPlayerActor(entry, sid);
        if (!actor) return;
        networkState.playersById.set(actor.id, actor);
    });

    publishSnapshot();
}

function ingestWorldState(worldPayload) {
    const safe = worldPayload && typeof worldPayload === 'object' ? worldPayload : {};
    ingestPlayersState(safe.players || {});

    networkState.enemiesById.clear();
    const enemies = Array.isArray(safe.enemies) ? safe.enemies : [];
    enemies.forEach((entry, index) => {
        const actor = toEnemyActor(entry, `enemy-${index}`);
        if (!actor) return;
        networkState.enemiesById.set(actor.id, actor);
    });

    const combatState = (safe.combat && typeof safe.combat === 'object') ? safe.combat : {};
    const combatMeta = (combatState.state && typeof combatState.state === 'object') ? combatState.state : {};
    networkState.inCombat = !!combatMeta.inCombat;

    publishSnapshot();
}

function upsertPlayer(entry) {
    if (!entry || typeof entry !== 'object') return;
    const actor = toPlayerActor(entry, entry.id);
    if (!actor) return;
    networkState.playersById.set(actor.id, actor);
    publishSnapshot();
}

function removePlayerBySidOrActorId(value) {
    const id = String(value || '').trim();
    if (!id) return;

    for (const [actorId, actor] of networkState.playersById.entries()) {
        if (actorId === id || String(actor.ownerSid || '') === id) {
            networkState.playersById.delete(actorId);
        }
    }
    publishSnapshot();
}

function applyEntityMove(packet) {
    if (!packet || typeof packet !== 'object') return;
    const actorId = String(packet.id || '').trim();
    const pos = (packet.position && typeof packet.position === 'object') ? packet.position : null;
    if (!actorId || !pos) return;

    const updateTarget = networkState.playersById.get(actorId) || networkState.enemiesById.get(actorId);
    if (!updateTarget) return;

    updateTarget.position = {
        x: numberOr(pos.x, numberOr(updateTarget.position?.x, 0)),
        y: numberOr(pos.y, numberOr(updateTarget.position?.y, 0.7)),
        z: numberOr(pos.z, numberOr(updateTarget.position?.z, 0)),
    };
    publishSnapshot();
}

function createSocketBridge() {
    if (typeof window.io !== 'function') {
        console.warn('[MAP3D] Socket.IO client is unavailable; runtime running in local-only mode.');
        return null;
    }

    const socket = window.io();

    socket.on('connect', () => {
        networkState.localSid = socket.id || null;
        socket.emit('request-combat-state', {});
    });

    socket.on('player-id', (payload) => {
        if (payload && typeof payload === 'object' && payload.id) {
            networkState.localSid = String(payload.id);
        }
    });

    socket.on('world-init', ingestWorldState);
    socket.on('world-update', ingestWorldState);
    socket.on('players-state', ingestPlayersState);
    socket.on('player-update', upsertPlayer);
    socket.on('player-joined', upsertPlayer);
    socket.on('player-left', (payload) => removePlayerBySidOrActorId(payload && payload.id));
    socket.on('entity-move', applyEntityMove);

    socket.on('combat-state', (packet) => {
        networkState.inCombat = !!(packet && packet.active);
        publishSnapshot();
    });

    socket.on('combat-full-state', (packet) => {
        const safe = packet && typeof packet === 'object' ? packet : {};
        const state = (safe.state && typeof safe.state === 'object') ? safe.state : {};
        networkState.inCombat = !!state.inCombat;
        publishSnapshot();
    });

    socket.on('combat-turn', (packet) => {
        networkState.currentTurn = (packet && typeof packet === 'object') ? packet : null;
        publishSnapshot();
    });

    socket.on('combat-reset', () => {
        networkState.inCombat = false;
        networkState.currentTurn = null;
        publishSnapshot();
    });

    return socket;
}

const socket = simulationMode ? null : createSocketBridge();

if (simulationMode) {
    simulationReplay.ui = createSimulationPanel();
    simulationReplay.ui.loadBtn.addEventListener('click', async () => {
        try {
            await loadSimulationArtifact(simulationArtifactPath);
        } catch (err) {
            simulationReplay.ui.status.textContent = `Load failed: ${err.message || err}`;
        }
    });
    simulationReplay.ui.playBtn.addEventListener('click', () => playSimulationReplay());
    simulationReplay.ui.pauseBtn.addEventListener('click', () => pauseSimulationReplay());
    simulationReplay.ui.resetBtn.addEventListener('click', () => resetSimulationReplay());
    simulationReplay.ui.speedSelect.addEventListener('change', () => {
        simulationReplay.speed = Math.max(0.1, Number(simulationReplay.ui.speedSelect.value) || 1);
    });
    simulationReplay.ui.tickSlider.addEventListener('input', () => {
        const index = Math.max(0, Number.parseInt(simulationReplay.ui.tickSlider.value, 10) || 0);
        pauseSimulationReplay();
        applySimulationTick(index);
    });

    loadSimulationArtifact(simulationArtifactPath)
        .then(() => playSimulationReplay())
        .catch((err) => {
            if (simulationReplay.ui) {
                simulationReplay.ui.status.textContent = `Auto-load failed: ${err.message || err}`;
            }
        });
}

runtime.onIntent((intent) => {
    debugLog('[MAP3D INTENT]', intent);

    if (simulationMode) return;
    if (!socket || !socket.connected) return;
    const payload = intent && intent.payload ? intent.payload : {};

    if (intent.type === 'attack') {
        const targetId = String(payload.targetId || '').trim();
        if (!targetId) return;
        const actionId = nextIntentId('attack');
        socket.emit('combat-action-preview', {
            requestId: nextIntentId('preview'),
            type: 'attack',
            targetId,
        });
        socket.emit('combat-action', {
            id: actionId,
            type: 'attack',
            targetId,
        });
        return;
    }

    if (intent.type === 'move') {
        socket.emit('combat-action', {
            id: nextIntentId('move'),
            type: 'move',
            position: {
                x: numberOr(payload.x, 0),
                y: numberOr(payload.y, 0),
                z: numberOr(payload.z, 0),
            },
        });
        return;
    }

    if (intent.type === 'move-relative') {
        const localActor = Array.from(networkState.playersById.values()).find(
            (actor) => String(actor.ownerSid || '') === String(networkState.localSid || '')
        );
        if (!localActor || !localActor.position) return;
        socket.emit('combat-action', {
            id: nextIntentId('move'),
            type: 'move',
            position: {
                x: numberOr(localActor.position.x, 0) + numberOr(payload.x, 0),
                y: numberOr(localActor.position.y, 0),
                z: numberOr(localActor.position.z, 0) + numberOr(payload.z, 0),
            },
        });
        return;
    }

    if (intent.type === 'end-turn') {
        socket.emit('end-turn', { source: 'map3d-runtime' });
    }
});

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

function animate(timeMs) {
    const t = Number(timeMs) * 0.001;
    testMesh.rotation.y = t * 0.8;
    testMesh.rotation.x = Math.sin(t * 0.7) * 0.2;

    if (simulationReplay.attackLine && simulationReplay.attackLine.visible) {
        const remaining = simulationReplay.attackLineUntilMs - performance.now();
        if (remaining <= 0) {
            simulationReplay.attackLine.visible = false;
        } else if (simulationReplay.attackLine.material) {
            simulationReplay.attackLine.material.opacity = 0.35 + Math.min(0.6, remaining / 360);
        }
    }

    renderer.render(scene, camera);
}

renderer.setAnimationLoop(animate);

window.__MAP3D_BOOTSTRAP__ = {
    scene,
    camera,
    renderer,
    runtime,
    controls,
    applySnapshot: (snapshot) => runtime.applySnapshot(snapshot),
    applyEvent: (event) => runtime.applyEvent(event),
    onIntent: (handler) => runtime.onIntent(handler),
    simulationMode,
    simulationReplay: {
        load: (path) => loadSimulationArtifact(path || simulationArtifactPath),
        play: () => playSimulationReplay(),
        pause: () => pauseSimulationReplay(),
        reset: () => resetSimulationReplay(),
        setSpeed: (speed) => {
            simulationReplay.speed = Math.max(0.1, Number(speed) || 1);
            if (simulationReplay.ui) {
                simulationReplay.ui.speedSelect.value = String(simulationReplay.speed);
            }
        },
    },
};

window.dispatchMapSnapshot = (snapshot) => runtime.applySnapshot(snapshot);
window.dispatchMapEvent = (event) => runtime.applyEvent(event);
