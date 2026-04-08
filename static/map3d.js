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
if (Array.isArray(grid.material)) {
    grid.material.forEach((mat) => {
        mat.depthTest = true;
        mat.depthWrite = false;
        mat.transparent = true;
        mat.opacity = 0.58;
    });
} else if (grid.material) {
    grid.material.depthTest = true;
    grid.material.depthWrite = false;
    grid.material.transparent = true;
    grid.material.opacity = 0.58;
}
grid.position.y = 0.05;
grid.renderOrder = 80;
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

const runtime = createMap3dRuntime({
    scene,
    camera,
    renderer,
});
// Expose runtime so the model-picker UI (and other page scripts) can call setModelUrl()
window.map3dRuntime = runtime;

const controls = createMap3dControls({
    camera,
    renderer,
    getActorHitObjects: () => runtime.getActorHitObjects(),
    getInputFlags: () => runtime.getInputFlags(),
    emitIntent: (type, payload) => runtime.emitIntent(type, payload),
});
controls.start();

const urlSearch = new URLSearchParams(window.location.search || '');
const selectedCharacterIdFromQuery = String(urlSearch.get('characterId') || '').trim();
const SELECTED_CHARACTER_STORAGE_KEY = 'paraval_selected_character';
let selectedCharacterProfile = null;
try {
    const rawSelected = localStorage.getItem(SELECTED_CHARACTER_STORAGE_KEY);
    if (rawSelected) {
        const parsed = JSON.parse(rawSelected);
        if (parsed && typeof parsed === 'object' && parsed.id) {
            selectedCharacterProfile = {
                id: String(parsed.id || '').trim(),
                name: String(parsed.name || '').trim(),
            };
        }
    }
} catch (_err) {
    selectedCharacterProfile = null;
}

if (selectedCharacterIdFromQuery && selectedCharacterProfile && selectedCharacterProfile.id !== selectedCharacterIdFromQuery) {
    selectedCharacterProfile = {
        id: selectedCharacterIdFromQuery,
        name: selectedCharacterProfile.name || selectedCharacterIdFromQuery,
    };
}

const rawDesign = String(urlSearch.get('design') || 'tactical').trim().toLowerCase();
const globalView = typeof window.__MAP3D_VIEW__ === 'string'
    ? String(window.__MAP3D_VIEW__).trim().toLowerCase()
    : '';
const globalScene = typeof window.__MAP3D_SCENE__ === 'string'
    ? String(window.__MAP3D_SCENE__).trim().toLowerCase()
    : '';
const rawView = String(urlSearch.get('view') || globalView || '').trim().toLowerCase();
const rawScene = String(urlSearch.get('scene') || globalScene || '').trim().toLowerCase();
const VIEW_ALIAS = {
    t: 'top',
    iso: 'isometric',
    i: 'isometric',
    s: 'side',
};
const VIEW_PRESETS = {
    top: {
        position: [0, 28, 0.001],
        up: [0, 0, -1],
        lookAt: [0, 0, 0],
    },
    isometric: {
        position: [16, 12, 16],
        up: [0, 1, 0],
        lookAt: [0, 0, 0],
    },
    side: {
        position: [24, 8, 0],
        up: [0, 1, 0],
        lookAt: [0, 0, 0],
    },
};
const viewKey = VIEW_ALIAS[rawView] || (VIEW_PRESETS[rawView] ? rawView : '');
const sceneKey = (rawScene === 'forest' || rawScene === 'ocean') ? rawScene : 'default';
const DESIGN_ALIAS = {
    a: 'tactical',
    b: 'cinematic',
    c: 'debug',
};
const DESIGN_PRESETS = {
    tactical: {
        background: 0x10141f,
        ambientIntensity: 0.6,
        keyIntensity: 1.0,
        keyColor: 0xffffff,
        keyPosition: [5, 10, 7],
        gridMajor: 0x3a4a74,
        gridMinor: 0x22314d,
        floorColor: 0x151c2d,
        floorRoughness: 0.95,
        floorMetalness: 0.05,
        cubeColor: 0x5cb8ff,
        panel: {
            background: 'rgba(11,15,26,0.86)',
            text: '#d9e2f0',
            border: 'rgba(120,150,220,0.35)',
            buttonBackground: '#15233c',
            buttonBorder: 'rgba(136,168,240,0.5)',
            rosterBackground: 'rgba(5, 9, 16, 0.52)',
        },
    },
    cinematic: {
        background: 0x16100b,
        ambientIntensity: 0.35,
        keyIntensity: 1.35,
        keyColor: 0xffe4b8,
        keyPosition: [7, 12, 3],
        gridMajor: 0x7f5a3a,
        gridMinor: 0x3e2a1c,
        floorColor: 0x2a1d14,
        floorRoughness: 0.85,
        floorMetalness: 0.12,
        cubeColor: 0xffa35c,
        panel: {
            background: 'rgba(30,18,10,0.88)',
            text: '#f8e6d3',
            border: 'rgba(232,173,118,0.45)',
            buttonBackground: '#4b2b17',
            buttonBorder: 'rgba(235,178,122,0.6)',
            rosterBackground: 'rgba(20, 12, 6, 0.55)',
        },
    },
    debug: {
        background: 0x0f1310,
        ambientIntensity: 0.75,
        keyIntensity: 1.0,
        keyColor: 0xd8ffe6,
        keyPosition: [4, 9, 8],
        gridMajor: 0x4caf50,
        gridMinor: 0x1f4d25,
        floorColor: 0x121a13,
        floorRoughness: 0.98,
        floorMetalness: 0.02,
        cubeColor: 0x79ff9f,
        panel: {
            background: 'rgba(8,18,10,0.88)',
            text: '#dfffe8',
            border: 'rgba(118,233,141,0.45)',
            buttonBackground: '#13311a',
            buttonBorder: 'rgba(132,248,156,0.6)',
            rosterBackground: 'rgba(6, 14, 8, 0.58)',
        },
    },
};
const designKey = DESIGN_ALIAS[rawDesign] || (DESIGN_PRESETS[rawDesign] ? rawDesign : 'tactical');
const designPreset = DESIGN_PRESETS[designKey];
const mapDebug = urlSearch.get('mapdebug') === '1';
const simulationMode = urlSearch.get('sim') === '1';
const simulationArtifactPath = urlSearch.get('simPath') || '/artifacts/timeline-debug.json';
const SIMULATION_REPLAY_SLOWDOWN = 10;
const sceneEffects = {
    ocean: null,
};

function buildSeededRandom(seedInput) {
    let seed = 0;
    const text = String(seedInput || 'forest-seed');
    for (let i = 0; i < text.length; i += 1) {
        seed = (seed * 31 + text.charCodeAt(i)) >>> 0;
    }
    if (seed === 0) seed = 0x9e3779b9;
    return () => {
        seed ^= seed << 13;
        seed ^= seed >>> 17;
        seed ^= seed << 5;
        return ((seed >>> 0) % 1_000_000) / 1_000_000;
    };
}

function buildProceduralForest() {
    const rng = buildSeededRandom(urlSearch.get('seed') || 'forest');
    const treeCount = Math.max(80, Math.min(500, Number.parseInt(urlSearch.get('trees') || '240', 10) || 240));
    const forest = new THREE.Group();
    forest.name = 'procedural-forest';

    const trunkGeometry = new THREE.CylinderGeometry(0.12, 0.22, 1.6, 8);
    const canopyGeometry = new THREE.ConeGeometry(0.9, 1.8, 8);
    const trunkMaterial = new THREE.MeshStandardMaterial({
        color: 0x5f4128,
        roughness: 0.95,
        metalness: 0.02,
    });
    const canopyMaterial = new THREE.MeshStandardMaterial({
        color: 0x1f6b2f,
        roughness: 0.85,
        metalness: 0.02,
    });

    for (let i = 0; i < treeCount; i += 1) {
        const angle = rng() * Math.PI * 2;
        const radius = 8 + (rng() * 14);
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;

        const tree = new THREE.Group();

        const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
        trunk.position.y = 0.8;

        const canopy = new THREE.Mesh(canopyGeometry, canopyMaterial);
        canopy.position.y = 2.05;
        canopy.scale.setScalar(0.75 + (rng() * 0.7));

        tree.add(trunk);
        tree.add(canopy);

        const jitter = 0.6;
        tree.position.set(
            x + ((rng() * 2 - 1) * jitter),
            0,
            z + ((rng() * 2 - 1) * jitter)
        );
        tree.rotation.y = rng() * Math.PI * 2;
        const scale = 0.9 + (rng() * 1.2);
        tree.scale.set(scale, 0.9 + (rng() * 0.8), scale);

        forest.add(tree);
    }

    const moonLight = new THREE.DirectionalLight(0x88b5ff, 0.55);
    moonLight.position.set(-10, 16, -8);
    scene.add(moonLight);

    scene.fog = new THREE.FogExp2(0x0d1410, 0.03);
    grid.visible = false;
    floor.material.color.setHex(0x182317);
    floor.material.roughness = 1.0;
    floor.material.metalness = 0.0;

    scene.add(forest);
}

function buildOceanScene() {
    const oceanGroup = new THREE.Group();
    oceanGroup.name = 'ocean-scene';

    scene.fog = new THREE.FogExp2(0x091827, 0.024);
    grid.visible = true;
    if (Array.isArray(grid.material)) {
        if (grid.material[0]) {
            grid.material[0].opacity = 0.7;
            if (grid.material[0].color) {
                grid.material[0].color.setHex(0x9fe8ff);
            }
        }
        if (grid.material[1]) {
            grid.material[1].opacity = 0.42;
            if (grid.material[1].color) {
                grid.material[1].color.setHex(0x3a8fb0);
            }
        }
    } else if (grid.material) {
        grid.material.opacity = 0.62;
        if (grid.material.color) {
            grid.material.color.setHex(0x9fe8ff);
        }
    }

    floor.material.color.setHex(0xe4cf9d);
    floor.material.roughness = 0.96;
    floor.material.metalness = 0.01;

    const oceanGeometry = new THREE.PlaneGeometry(180, 180, 80, 80);
    const oceanMaterial = new THREE.MeshStandardMaterial({
        color: 0x2a8bb5,
        roughness: 0.28,
        metalness: 0.12,
        transparent: true,
        opacity: 0.92,
    });
    const oceanMesh = new THREE.Mesh(oceanGeometry, oceanMaterial);
    oceanMesh.rotation.x = -Math.PI / 2;
    oceanMesh.position.y = -0.32;
    oceanGroup.add(oceanMesh);

    const foamRing = new THREE.Mesh(
        new THREE.TorusGeometry(14.25, 0.34, 10, 64),
        new THREE.MeshStandardMaterial({
            color: 0xb5f0ff,
            roughness: 0.22,
            metalness: 0.02,
            transparent: true,
            opacity: 0.45,
        })
    );
    foamRing.rotation.x = Math.PI / 2;
    foamRing.position.y = -0.02;
    oceanGroup.add(foamRing);

    const arenaRing = new THREE.Mesh(
        new THREE.TorusGeometry(12.5, 1.8, 16, 64),
        new THREE.MeshStandardMaterial({
            color: 0xc8b27d,
            roughness: 0.95,
            metalness: 0.03,
        })
    );
    arenaRing.rotation.x = Math.PI / 2;
    arenaRing.position.y = -0.05;
    oceanGroup.add(arenaRing);

    const rng = buildSeededRandom(urlSearch.get('seed') || 'ocean-reef');
    const rockGeometry = new THREE.DodecahedronGeometry(0.75, 0);
    const rockMaterial = new THREE.MeshStandardMaterial({
        color: 0x6a737f,
        roughness: 0.92,
        metalness: 0.04,
    });
    for (let i = 0; i < 110; i += 1) {
        const angle = rng() * Math.PI * 2;
        const radius = 15 + (rng() * 55);
        const rock = new THREE.Mesh(rockGeometry, rockMaterial);
        const scale = 0.55 + (rng() * 1.75);
        rock.scale.set(scale, 0.45 + (rng() * 1.25), scale);
        rock.position.set(
            Math.cos(angle) * radius,
            -0.18 + (rng() * 0.45),
            Math.sin(angle) * radius
        );
        rock.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
        oceanGroup.add(rock);
    }

    const moonLight = new THREE.DirectionalLight(0x9ed7ff, 0.65);
    moonLight.position.set(-14, 18, 9);
    scene.add(moonLight);

    scene.add(oceanGroup);

    const posAttr = oceanGeometry.getAttribute('position');
    const baseY = new Float32Array(posAttr.count);
    for (let i = 0; i < posAttr.count; i += 1) {
        baseY[i] = posAttr.getY(i);
    }
    const wavePhase = new Float32Array(posAttr.count);
    for (let i = 0; i < posAttr.count; i += 1) {
        wavePhase[i] = rng() * Math.PI * 2;
    }
    sceneEffects.ocean = {
        mesh: oceanMesh,
        position: posAttr,
        baseY,
        foamRing,
        wavePhase,
        frame: 0,
    };
}

function applyDesignPreset(preset) {
    if (!preset) return;
    scene.background = new THREE.Color(preset.background);
    ambientLight.intensity = preset.ambientIntensity;
    keyLight.intensity = preset.keyIntensity;
    if (keyLight.color && typeof keyLight.color.setHex === 'function') {
        keyLight.color.setHex(preset.keyColor);
    }
    keyLight.position.set(preset.keyPosition[0], preset.keyPosition[1], preset.keyPosition[2]);

    if (Array.isArray(grid.material)) {
        if (grid.material[0] && grid.material[0].color) {
            grid.material[0].color.setHex(preset.gridMajor);
        }
        if (grid.material[1] && grid.material[1].color) {
            grid.material[1].color.setHex(preset.gridMinor);
        }
    } else if (grid.material && grid.material.color) {
        grid.material.color.setHex(preset.gridMajor);
    }

    if (floor.material && floor.material.color) {
        floor.material.color.setHex(preset.floorColor);
    }
    if (floor.material) {
        floor.material.roughness = preset.floorRoughness;
        floor.material.metalness = preset.floorMetalness;
    }
}

applyDesignPreset(designPreset);

function applyViewPreset(presetKey) {
    const preset = VIEW_PRESETS[presetKey];
    if (!preset) return;
    camera.position.set(preset.position[0], preset.position[1], preset.position[2]);
    camera.up.set(preset.up[0], preset.up[1], preset.up[2]);
    camera.lookAt(preset.lookAt[0], preset.lookAt[1], preset.lookAt[2]);
}

if (simulationMode && !viewKey) {
    // Top-down tactical framing for simulation playback.
    applyViewPreset('top');
}

if (viewKey) {
    applyViewPreset(viewKey);
}

if (sceneKey === 'forest') {
    buildProceduralForest();
}

if (sceneKey === 'ocean') {
    buildOceanScene();
}

function debugLog(...args) {
    if (!mapDebug) return;
    console.log(...args);
}

function createSimulationPanel() {
    const panelTheme = designPreset && designPreset.panel ? designPreset.panel : DESIGN_PRESETS.tactical.panel;
    const panel = document.createElement('div');
    panel.style.position = 'fixed';
    panel.style.left = '12px';
    panel.style.bottom = '12px';
    panel.style.padding = '10px';
    panel.style.background = panelTheme.background;
    panel.style.color = panelTheme.text;
    panel.style.font = '12px/1.3 monospace';
    panel.style.border = `1px solid ${panelTheme.border}`;
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
        btn.style.border = `1px solid ${panelTheme.buttonBorder}`;
        btn.style.background = panelTheme.buttonBackground;
        btn.style.color = panelTheme.text;
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
    roster.style.background = panelTheme.rosterBackground;
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

function getSimulationLivingCounts(actorsById, data) {
    const counts = {
        playersAlive: 0,
        enemiesAlive: 0,
    };

    Object.entries(actorsById || {}).forEach(([id, state]) => {
        const alive = state && state.alive !== false && numberOr(state.hp, 0) > 0;
        if (!alive) return;
        const team = classifyTeamFromId(String(id), data);
        if (team === 'player') counts.playersAlive += 1;
        if (team === 'enemy') counts.enemiesAlive += 1;
    });

    return counts;
}

function applySimulationTick(index) {
    if (!simulationReplay.data || !simulationReplay.tickStates.length) return;
    const safeIdx = Math.max(0, Math.min(index, simulationReplay.tickStates.length - 1));
    simulationReplay.currentIndex = safeIdx;
    const tickState = simulationReplay.tickStates[safeIdx] || {};
    const tick = Number.isFinite(tickState.tick) ? tickState.tick : safeIdx;
    const actorsById = tickState.actors && typeof tickState.actors === 'object' ? tickState.actors : {};
    const actorIds = Object.keys(actorsById);
    const livingCounts = getSimulationLivingCounts(actorsById, simulationReplay.data);
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
        const combatOver = livingCounts.playersAlive <= 0 || livingCounts.enemiesAlive <= 0;
        const winner = livingCounts.enemiesAlive <= 0
            ? 'Players win'
            : livingCounts.playersAlive <= 0
                ? 'Enemies win'
                : null;
        simulationReplay.ui.status.textContent = combatOver
            ? `${winner} at tick ${tick}`
            : `Tick ${tick} (${safeIdx + 1}/${simulationReplay.tickStates.length})`;
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

    if (livingCounts.playersAlive <= 0 || livingCounts.enemiesAlive <= 0) {
        stopSimulationReplay();
    }
}

function getSimulationStepDelayMs(currentTick) {
    const events = Array.isArray(simulationReplay.data?.events) ? simulationReplay.data.events : [];
    const speed = Math.max(0.1, Number(simulationReplay.speed) || 1);
    const perTickDuration = events
        .filter((evt) => Number(evt.tick) === Number(currentTick))
        .reduce((sum, evt) => sum + Math.max(1, numberOr(evt.durationMs, 1)), 0);
    const base = perTickDuration > 0 ? perTickDuration : 180;
    return Math.max(600, Math.floor((base * SIMULATION_REPLAY_SLOWDOWN) / speed));
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
        if (selectedCharacterProfile && selectedCharacterProfile.name) {
            socket.emit('player-update', {
                name: selectedCharacterProfile.name,
            });
        }
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
    if (sceneEffects.ocean && sceneEffects.ocean.mesh) {
        const t = Number(timeMs) * 0.001;
        const ocean = sceneEffects.ocean;
        const posAttr = ocean.position;
        for (let i = 0; i < posAttr.count; i += 1) {
            const x = posAttr.getX(i);
            const z = posAttr.getZ(i);
            const p = ocean.wavePhase[i];
            const waveA = Math.sin((x * 0.11) + (t * 1.35) + p) * 0.12;
            const waveB = Math.cos((z * 0.09) - (t * 1.6) + (p * 0.7)) * 0.09;
            const waveC = Math.sin(((x + z) * 0.06) - (t * 0.95) + (p * 1.7)) * 0.07;
            posAttr.setY(i, ocean.baseY[i] + waveA + waveB + waveC);
        }
        posAttr.needsUpdate = true;
        ocean.frame += 1;
        if (ocean.frame % 3 === 0) {
            ocean.mesh.geometry.computeVertexNormals();
        }
        ocean.mesh.material.opacity = 0.82 + (Math.sin(t * 1.1) * 0.06);

        if (ocean.foamRing && ocean.foamRing.material) {
            const pulse = 1.0 + (Math.sin((t * 2.2) + 0.6) * 0.035);
            ocean.foamRing.scale.set(pulse, pulse, 1);
            ocean.foamRing.material.opacity = 0.34 + (Math.sin((t * 1.8) - 0.3) * 0.12);
        }
    }

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
    designKey,
    viewKey,
    sceneKey,
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
