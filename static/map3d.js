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

const mapDebug = new URLSearchParams(window.location.search || '').get('mapdebug') === '1';

function debugLog(...args) {
    if (!mapDebug) return;
    console.log(...args);
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

const socket = createSocketBridge();

runtime.onIntent((intent) => {
    debugLog('[MAP3D INTENT]', intent);

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
};

window.dispatchMapSnapshot = (snapshot) => runtime.applySnapshot(snapshot);
window.dispatchMapEvent = (event) => runtime.applyEvent(event);
