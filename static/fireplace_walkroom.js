import * as THREE from '/static/three.module.js';
import { GLTFLoader } from '/static/GLTFLoader.js';
import { DRACOLoader } from '/static/three-addons/loaders/DRACOLoader.js';
import { KTX2Loader } from '/static/three-addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from '/static/meshopt_decoder.module.js';

const SELECTED_CHARACTER_STORAGE_KEY = 'paraval_selected_character';
const SELECTED_MODEL_STORAGE_KEY = 'paraval_selected_model_url';
const DISPLAY_NAME_STORAGE_KEY = 'paraval_social_display_name';
const USER_AGENT = String(navigator.userAgent || '');
const IOS_WEBKIT = /iPad|iPhone|iPod/i.test(USER_AGENT) || (/Macintosh/i.test(USER_AGENT) && navigator.maxTouchPoints > 1);
const IS_SAFARI_ENGINE = /Safari/i.test(USER_AGENT) && !/Chrome|CriOS|Chromium|Edg|OPR|FxiOS|Firefox/i.test(USER_AGENT);
const IS_QUEST_BROWSER = /OculusBrowser|Quest/i.test(USER_AGENT);
const SAFARI_SAFE_MODE = IOS_WEBKIT || IS_SAFARI_ENGINE;
const SOCIAL_ROOM_CONFIG = window.__SOCIAL_ROOM_CONFIG__ && typeof window.__SOCIAL_ROOM_CONFIG__ === 'object'
  ? window.__SOCIAL_ROOM_CONFIG__
  : {};
const REQUESTED_SCENE_ASSET_URL = String(SOCIAL_ROOM_CONFIG.sceneAssetUrl || '').trim();
const DISABLE_SCENE_ASSET_FALLBACK = Boolean(SOCIAL_ROOM_CONFIG.disableSceneFallback);
const DISABLE_SKYBOX = Boolean(SOCIAL_ROOM_CONFIG.disableSkybox);
const SKYBOX_URL = String(SOCIAL_ROOM_CONFIG.skyboxUrl || '/static/skybox_night.jpg').trim();
const SHOW_AVATAR_SPHERE = Boolean(SOCIAL_ROOM_CONFIG.showAvatarSphere);
const DUST_PARTICLES = Boolean(SOCIAL_ROOM_CONFIG.dustParticles);
const MAP_GRID_OVERLAY = Boolean(SOCIAL_ROOM_CONFIG.mapGridOverlay);
const MAP_SPACE_TRACKING = Boolean(SOCIAL_ROOM_CONFIG.mapSpaceTracking || MAP_GRID_OVERLAY);
const MAP_CROSSHAIR = Boolean(SOCIAL_ROOM_CONFIG.mapCrosshair || MAP_SPACE_TRACKING);
const MAP_HOVER_HIGHLIGHT = Boolean(SOCIAL_ROOM_CONFIG.mapHoverHighlight || MAP_SPACE_TRACKING);
const ENABLE_WEBXR = Boolean(SOCIAL_ROOM_CONFIG.enableWebXR);
const ENABLE_VR_CONTROLS = Boolean(SOCIAL_ROOM_CONFIG.enableVrControls || ENABLE_WEBXR);
const MAP_GRID_CELL_SIZE = (() => {
  const raw = Number(SOCIAL_ROOM_CONFIG.mapGridCellSize);
  if (!Number.isFinite(raw)) return 0.2;
  return THREE.MathUtils.clamp(raw, 0.05, 2.0);
})();
const DEFAULT_OPEN_WORLD_ASSET_URL = '/static/everything_optimized_draco.glb';
const SCENE_ASSET_URL = REQUESTED_SCENE_ASSET_URL;
const IS_MAP3D_ROUTE = /^\/map3d\/?$/i.test(String(window.location.pathname || '').trim());

function resolveSpawnPosition() {
  const fallback = USE_SCENE_ASSET
    ? (IS_MAP3D_ROUTE ? [0, 0, 0] : [0, 2, 3])
    : [0, 2, 2.1];

  const raw = SOCIAL_ROOM_CONFIG.spawnPosition;
  if (Array.isArray(raw) && raw.length >= 3) {
    const x = Number(raw[0]);
    const y = Number(raw[1]);
    const z = Number(raw[2]);
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
      return [x, y, z];
    }
  }

  if (raw && typeof raw === 'object') {
    const x = Number(raw.x);
    const y = Number(raw.y);
    const z = Number(raw.z);
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
      return [x, y, z];
    }
  }

  return fallback;
}

const RESOLVED_SCENE_ASSET_URL = SCENE_ASSET_URL || (!DISABLE_SCENE_ASSET_FALLBACK && IS_MAP3D_ROUTE ? DEFAULT_OPEN_WORLD_ASSET_URL : '');
const SAFARI_LEGACY_EVERYTHING_PATTERN = /\/everything_\.gltf$/i;
const SCENE_ASSET_PRIMARY_URL = (() => {
  if (!RESOLVED_SCENE_ASSET_URL) return '';
  if (!SAFARI_SAFE_MODE) return RESOLVED_SCENE_ASSET_URL;
  if (SAFARI_LEGACY_EVERYTHING_PATTERN.test(RESOLVED_SCENE_ASSET_URL)) {
    console.warn('[SOCIAL ROOM] Safari safe mode: forcing optimized open-world asset.');
    return DEFAULT_OPEN_WORLD_ASSET_URL;
  }
  return RESOLVED_SCENE_ASSET_URL;
})();
const MAP3D_SCENE_ONLY_MODE = IS_MAP3D_ROUTE;
const SCENE_ASSET_CANDIDATE_URLS = Array.from(new Set(
  (
    MAP3D_SCENE_ONLY_MODE
      ? [SCENE_ASSET_PRIMARY_URL]
      : [
          SCENE_ASSET_PRIMARY_URL,
          ...(
            DISABLE_SCENE_ASSET_FALLBACK
              ? []
              : [
                  '/static/everything_optimized_draco.glb',
                  // Avoid legacy 145MB binary fallback on Safari to reduce repeated crash loops.
                  ...(SAFARI_SAFE_MODE ? [] : ['/static/everything_.gltf']),
                ]
          ),
        ]
  ).filter(Boolean)
));
const ROOM_TITLE = String(SOCIAL_ROOM_CONFIG.roomTitle || 'Social Room').trim() || 'Social Room';
const USE_SCENE_ASSET = SCENE_ASSET_CANDIDATE_URLS.length > 0;
const SPAWN_POSITION = resolveSpawnPosition();
const SINGLE_PLAYER_MODE = Boolean(SOCIAL_ROOM_CONFIG.singlePlayer);
const FORCE_SPHERE_AVATARS = Boolean(SOCIAL_ROOM_CONFIG.forceSphereAvatars);

const hudPlayerEl = document.getElementById('hud-player');
const nameGateEl = document.getElementById('name-gate');
const displayNameInputEl = document.getElementById('display-name-input');
const displayNameSubmitEl = document.getElementById('display-name-submit');
const displayNameErrorEl = document.getElementById('display-name-error');
const socialTitleEl = document.querySelector('.social-title');
const socialOverlayEl = document.getElementById('social-overlay');
const socialDrawerToggleEl = document.getElementById('social-drawer-toggle');
const socialPlayersEl = document.getElementById('social-players');
const socialChatLogEl = document.getElementById('social-chat-log');
const socialChatInputEl = document.getElementById('social-chat-input');
const socialChatSendEl = document.getElementById('social-chat-send');
const voiceToggleEl = document.getElementById('voice-toggle');
const voiceStateEl = document.getElementById('voice-state');

document.title = `Paraval ${ROOM_TITLE}`;
if (socialTitleEl) socialTitleEl.textContent = ROOM_TITLE;

function initSocialDrawer() {
  if (!socialOverlayEl || !socialDrawerToggleEl) return;

  if (SINGLE_PLAYER_MODE) {
    socialOverlayEl.style.display = 'none';
    socialDrawerToggleEl.style.display = 'none';
    return;
  }

  let isOpen = false;
  const applyDrawerState = () => {
    socialOverlayEl.classList.toggle('collapsed', !isOpen);
    socialOverlayEl.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
    socialDrawerToggleEl.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    socialDrawerToggleEl.textContent = isOpen ? '\u25BC' : '\u25B2';
    socialDrawerToggleEl.setAttribute('aria-label', isOpen ? 'Hide voice and chat panel' : 'Show voice and chat panel');
  };

  applyDrawerState();
  socialDrawerToggleEl.addEventListener('click', () => {
    isOpen = !isOpen;
    applyDrawerState();
  });
}

initSocialDrawer();

const urlSearch = new URLSearchParams(window.location.search || '');
const queryCharacterId = String(urlSearch.get('characterId') || '').trim();
const queryModelUrl = String(urlSearch.get('modelUrl') || '').trim();

let selectedCharacter = null;
let selectedModelUrl = '';
let chosenDisplayName = '';

const chatState = {
  messages: [],
  maxMessages: 80,
};

const voiceState = {
  stream: null,
  audioContext: null,
  source: null,
  analyser: null,
  dataArray: null,
  raf: 0,
  enabled: false,
  muted: false,
  speaking: false,
  unavailableReason: '',
};

const rtcState = {
  peers: new Map(),
  remoteAudioRoot: null,
  iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }],
};

function sanitizeText(value, maxLen = 300) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatVoiceBadge(entry) {
  const social = entry && typeof entry.social === 'object' ? entry.social : {};
  const voiceEnabled = Boolean(social.voiceEnabled);
  const speaking = Boolean(social.voiceSpeaking);
  if (!voiceEnabled) return 'voice off';
  return speaking ? 'speaking' : 'listening';
}

function renderSocialPlayers() {
  if (!socialPlayersEl) return;
  const roster = netState && netState.roster && typeof netState.roster === 'object' ? netState.roster : {};
  const rows = Object.entries(roster)
    .filter(([sid]) => Boolean(sid))
    .sort((a, b) => {
      const aIsLocal = a[0] === netState.localSid;
      const bIsLocal = b[0] === netState.localSid;
      if (aIsLocal && !bIsLocal) return -1;
      if (!aIsLocal && bIsLocal) return 1;
      const aName = String(a[1]?.name || '').toLowerCase();
      const bName = String(b[1]?.name || '').toLowerCase();
      return aName.localeCompare(bName);
    });

  if (!rows.length) {
    socialPlayersEl.innerHTML = '<div class="social-player-row"><span class="social-player-name">No players connected yet.</span></div>';
    return;
  }

  socialPlayersEl.innerHTML = rows.map(([sid, entry]) => {
    const name = sanitizeText((entry && entry.name) || `Player-${sid.slice(0, 6)}`, 24) || `Player-${sid.slice(0, 6)}`;
    const label = sid === netState.localSid ? `${name} (you)` : name;
    const badge = formatVoiceBadge(entry);
    const badgeClass = badge === 'speaking' ? 'social-player-voice voice-speaking' : 'social-player-voice';
    return `<div class="social-player-row"><span class="social-player-name">${escapeHtml(label)}</span><span class="${badgeClass}">${escapeHtml(badge)}</span></div>`;
  }).join('');
}

function renderChatLog() {
  if (!socialChatLogEl) return;
  if (!chatState.messages.length) {
    socialChatLogEl.innerHTML = '<div class="chat-line chat-system">Chat is ready. Say hello.</div>';
    return;
  }
  socialChatLogEl.innerHTML = chatState.messages.map((msg) => {
    if (msg.type === 'system') {
      return `<div class="chat-line chat-system">${escapeHtml(msg.text)}</div>`;
    }
    return `<div class="chat-line"><span class="chat-name">${escapeHtml(msg.name)}:</span>${escapeHtml(msg.text)}</div>`;
  }).join('');
  socialChatLogEl.scrollTop = socialChatLogEl.scrollHeight;
}

function pushChatMessage(message) {
  chatState.messages.push(message);
  if (chatState.messages.length > chatState.maxMessages) {
    chatState.messages.splice(0, chatState.messages.length - chatState.maxMessages);
  }
  renderChatLog();
}

function updateVoiceUi() {
  if (voiceToggleEl) {
    if (SINGLE_PLAYER_MODE) {
      voiceToggleEl.textContent = 'Voice Disabled';
      voiceToggleEl.disabled = true;
    } else if (voiceState.unavailableReason && !voiceState.enabled) {
      voiceToggleEl.textContent = 'Voice Unavailable';
    } else if (!voiceState.enabled) {
      voiceToggleEl.textContent = 'Enable Voice';
    } else if (voiceState.muted) {
      voiceToggleEl.textContent = 'Unmute Voice';
    } else {
      voiceToggleEl.textContent = 'Mute Voice';
    }
  }
  if (voiceStateEl) {
    if (SINGLE_PLAYER_MODE) voiceStateEl.textContent = 'Disabled';
    else if (voiceState.unavailableReason && !voiceState.enabled) voiceStateEl.textContent = 'Unavailable';
    else if (!voiceState.enabled) voiceStateEl.textContent = 'Voice Off';
    else if (voiceState.speaking && !voiceState.muted) voiceStateEl.textContent = 'Speaking';
    else if (voiceState.muted) voiceStateEl.textContent = 'Muted';
    else voiceStateEl.textContent = 'Listening';
  }
}

function canUseMicrophoneApis() {
  return Boolean(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function');
}

function isMicAllowedByContext() {
  if (window.isSecureContext) return true;
  const host = String(window.location.hostname || '').toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}

function buildInsecureContextMessage() {
  const origin = String(window.location.origin || '').trim();
  const host = String(window.location.hostname || '').trim();
  return `Voice needs HTTPS or localhost. Current origin ${origin || '(unknown)'} is not secure. Use https://${host || 'your-host'} or http://localhost:8080.`;
}

function formatVoiceInitError(err) {
  const name = String(err && err.name ? err.name : '').trim();
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return 'Microphone permission was blocked. Allow mic access for this site and try again.';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return 'No microphone device was found.';
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return 'Microphone is already in use by another app.';
  }
  if (name === 'SecurityError') {
    return 'Voice requires a secure context (HTTPS or localhost).';
  }
  return 'Voice could not start. Check browser permissions and try again.';
}

function ensureRemoteAudioRoot() {
  if (rtcState.remoteAudioRoot) return rtcState.remoteAudioRoot;
  const root = document.createElement('div');
  root.id = 'remote-audio-root';
  root.style.display = 'none';
  document.body.appendChild(root);
  rtcState.remoteAudioRoot = root;
  return root;
}

function createRemoteAudioElement(sid) {
  const root = ensureRemoteAudioRoot();
  const el = document.createElement('audio');
  el.id = `remote-audio-${sid}`;
  el.autoplay = true;
  el.playsInline = true;
  root.appendChild(el);
  return el;
}

function removeRemoteAudioElement(sid) {
  if (!rtcState.remoteAudioRoot) return;
  const el = document.getElementById(`remote-audio-${sid}`);
  if (!el) return;
  try {
    el.pause();
  } catch (_err) {
    // Ignore.
  }
  if (el.srcObject) {
    const tracks = el.srcObject.getTracks ? el.srcObject.getTracks() : [];
    tracks.forEach((track) => track.stop());
  }
  el.srcObject = null;
  el.remove();
}

function sanitizeDisplayName(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 24);
}

function updateHudPlayerText() {
  if (!hudPlayerEl) return;
  const nameText = chosenDisplayName || '(choose name to join)';
  hudPlayerEl.textContent = `Player: ${nameText}\nModel: ${selectedModelUrl || 'Procedural fallback'}`;
}

function loadSelectionContext() {
  try {
    const raw = localStorage.getItem(SELECTED_CHARACTER_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object' && parsed.id) {
      selectedCharacter = {
        id: String(parsed.id || '').trim(),
        name: String(parsed.name || '').trim(),
      };
    }
  } catch (_err) {
    selectedCharacter = null;
  }

  if (queryCharacterId) {
    if (!selectedCharacter) selectedCharacter = { id: queryCharacterId, name: queryCharacterId };
    if (selectedCharacter.id !== queryCharacterId) {
      selectedCharacter.id = queryCharacterId;
    }
  }

  if (!selectedCharacter) {
    selectedCharacter = { id: 'traveler', name: 'Traveler' };
  }

  try {
    selectedModelUrl = queryModelUrl || String(localStorage.getItem(SELECTED_MODEL_STORAGE_KEY) || '').trim();
  } catch (_err) {
    selectedModelUrl = queryModelUrl || '';
  }

  // In open-world scene mode, this script should not treat scene assets as avatar models.
  if (USE_SCENE_ASSET) {
    selectedModelUrl = '';
  }

  if (selectedModelUrl) {
    localStorage.setItem(SELECTED_MODEL_STORAGE_KEY, selectedModelUrl);
  }

  updateHudPlayerText();
  renderChatLog();
  updateVoiceUi();
}

loadSelectionContext();

const scene = new THREE.Scene();
scene.background = new THREE.Color(USE_SCENE_ASSET ? 0x2a3442 : 0x0a0d15);
scene.fog = USE_SCENE_ASSET ? null : new THREE.Fog(0x0a0d15, 10, 34);

const skyboxTextureLoader = new THREE.TextureLoader();
if (!DISABLE_SKYBOX) {
  skyboxTextureLoader.load(
    SKYBOX_URL,
    (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.mapping = THREE.EquirectangularReflectionMapping;
      // Flip skybox upside down by mirroring V coordinates
      texture.matrixAutoUpdate = false;
      const matrix = new THREE.Matrix3();
      matrix.setUvTransform(0, 1, 1, -1, 0, 0.5, 0.5);
      texture.matrix = matrix;
      scene.background = texture;
    },
    undefined,
    () => {
      // Keep color fallback if skybox fails to load.
    }
  );
}

const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 5000);
camera.position.set(0, 2.6, 6.4);

const renderer = new THREE.WebGLRenderer({ antialias: !SAFARI_SAFE_MODE });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, SAFARI_SAFE_MODE ? 1.25 : 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = USE_SCENE_ASSET ? (SAFARI_SAFE_MODE ? 1.58 : 1.78) : 1.18;
renderer.shadowMap.enabled = USE_SCENE_ASSET && !SAFARI_SAFE_MODE;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const xrState = {
  active: false,
  baseReferenceSpace: null,
  currentReferenceSpace: null,
  offsetPosition: new THREE.Vector3(),
  moveSpeed: 2.7,
  boostMultiplier: 2.0,
  turnSpeed: 2.2,
  deadZone: 0.18,
  minY: -500,
  maxY: 5000,
  snapTurnStep: THREE.MathUtils.degToRad(30),
  snapTurnThreshold: 0.72,
  snapTurnCooldownSec: 0.2,
  nextSnapTurnAtSec: 0,
  vrPixelRatio: IS_QUEST_BROWSER ? Math.min(window.devicePixelRatio || 1, 2) : 1,
  vrFoveation: IS_QUEST_BROWSER ? 0 : 1.0,
  restoreFoveation: 0.5,
  restorePixelRatio: Math.min(window.devicePixelRatio || 1, SAFARI_SAFE_MODE ? 1.25 : 2),
  restoreShadows: renderer.shadowMap.enabled,
};

function applyXrPerformanceMode(enabled) {
  if (enabled) {
    // Keep VR stable but avoid over-aggressive texture degradation on Quest.
    renderer.setPixelRatio(xrState.vrPixelRatio);
    renderer.shadowMap.enabled = false;
    if (renderer.xr && typeof renderer.xr.setFoveation === 'function') {
      renderer.xr.setFoveation(xrState.vrFoveation);
    }
    return;
  }

  resetVrLodVisibility();
  renderer.setPixelRatio(xrState.restorePixelRatio);
  renderer.shadowMap.enabled = xrState.restoreShadows;
  if (renderer.xr && typeof renderer.xr.setFoveation === 'function') {
    renderer.xr.setFoveation(xrState.restoreFoveation);
  }
}

function initWebXR() {
  if (!ENABLE_WEBXR) return;
  if (!navigator.xr) return;

  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType('local-floor');

  const xrBtn = document.createElement('button');
  xrBtn.id = 'xr-enter-btn';
  xrBtn.type = 'button';
  xrBtn.textContent = 'Enter VR';
  xrBtn.style.position = 'fixed';
  xrBtn.style.left = '14px';
  xrBtn.style.bottom = '14px';
  xrBtn.style.zIndex = '25';
  xrBtn.style.border = '1px solid rgba(130, 146, 208, 0.46)';
  xrBtn.style.background = 'rgba(10, 14, 25, 0.78)';
  xrBtn.style.color = '#d6def4';
  xrBtn.style.borderRadius = '8px';
  xrBtn.style.padding = '8px 10px';
  xrBtn.style.fontSize = '12px';
  xrBtn.style.letterSpacing = '0.04em';
  xrBtn.style.backdropFilter = 'blur(4px)';
  xrBtn.style.cursor = 'pointer';
  document.body.appendChild(xrBtn);

  const setBtnState = (label, disabled = false) => {
    xrBtn.textContent = label;
    xrBtn.disabled = disabled;
    xrBtn.style.opacity = disabled ? '0.65' : '1';
    xrBtn.style.cursor = disabled ? 'default' : 'pointer';
  };

  navigator.xr.isSessionSupported('immersive-vr').then((supported) => {
    if (!supported) {
      setBtnState('VR Unavailable', true);
    }
  }).catch(() => {
    setBtnState('VR Unavailable', true);
  });

  const attachSessionListeners = (session) => {
    if (!session) return;
    session.addEventListener('end', () => {
      xrState.active = false;
      xrState.baseReferenceSpace = null;
      xrState.currentReferenceSpace = null;
      xrState.offsetPosition.set(0, 0, 0);
      xrState.nextSnapTurnAtSec = 0;
      applyXrPerformanceMode(false);
      setBtnState('Enter VR', false);
    });
  };

  xrBtn.addEventListener('click', async () => {
    const activeSession = renderer.xr.getSession();
    if (activeSession) {
      await activeSession.end();
      return;
    }

    try {
      setBtnState('Entering VR...', true);
      const session = await navigator.xr.requestSession('immersive-vr', {
        optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'],
      });
      attachSessionListeners(session);
      await renderer.xr.setSession(session);
      xrState.active = true;
      applyXrPerformanceMode(true);
      xrState.baseReferenceSpace = renderer.xr.getReferenceSpace();
      // Start VR where the user currently is, so entering VR does not drop below large scenes.
      const startX = Number.isFinite(camera.position.x) ? camera.position.x : SPAWN_POSITION[0];
      const startY = Number.isFinite(camera.position.y) ? camera.position.y : SPAWN_POSITION[1];
      const startZ = Number.isFinite(camera.position.z) ? camera.position.z : SPAWN_POSITION[2];
      xrState.offsetPosition.set(startX, startY, startZ);
      if (xrState.baseReferenceSpace && typeof XRRigidTransform !== 'undefined') {
        const initialTransform = makeReferenceSpaceTranslation(
          xrState.offsetPosition.x,
          xrState.offsetPosition.y,
          xrState.offsetPosition.z,
        );
        xrState.currentReferenceSpace = xrState.baseReferenceSpace.getOffsetReferenceSpace(initialTransform);
        renderer.xr.setReferenceSpace(xrState.currentReferenceSpace);
      }
      setBtnState('Exit VR', false);
    } catch (_err) {
      setBtnState('Enter VR', false);
    }
  });
}

initWebXR();

// --- Compass gizmo ---
const _compassCanvas = document.getElementById('compass-gizmo');
const _compassCtx = _compassCanvas ? _compassCanvas.getContext('2d') : null;
const _compassDir = new THREE.Vector3();
const _coordsEl = document.getElementById('hud-coords');
let _coordsFrame = 0;

function _drawCompass() {
  if (!_compassCtx) return;
  const ctx = _compassCtx;
  const size = _compassCanvas.width;
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.40;

  camera.getWorldDirection(_compassDir);
  const yaw = Math.atan2(_compassDir.x, -_compassDir.z);

  ctx.clearRect(0, 0, size, size);

  ctx.beginPath();
  ctx.arc(cx, cy, r + 5, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(8, 12, 22, 0.72)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(130, 146, 208, 0.38)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-yaw);

  for (let i = 0; i < 8; i++) {
    if (i % 2 === 0) continue;
    const a = (i * Math.PI) / 4;
    ctx.beginPath();
    ctx.moveTo(Math.sin(a) * (r - 2), -Math.cos(a) * (r - 2));
    ctx.lineTo(Math.sin(a) * (r - 8), -Math.cos(a) * (r - 8));
    ctx.strokeStyle = 'rgba(160, 176, 220, 0.45)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  const cardinals = [
    { label: 'N', angle: 0,             color: '#e87070' },
    { label: 'E', angle: Math.PI / 2,   color: '#b7c5ec' },
    { label: 'S', angle: Math.PI,       color: '#b7c5ec' },
    { label: 'W', angle: -Math.PI / 2,  color: '#b7c5ec' },
  ];
  ctx.font = `bold ${Math.round(size * 0.16)}px Consolas, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  cardinals.forEach(({ label, angle, color }) => {
    ctx.fillStyle = color;
    ctx.fillText(label, Math.sin(angle) * (r - 10), -Math.cos(angle) * (r - 10));
  });

  ctx.restore();

  ctx.beginPath();
  ctx.moveTo(cx, cy - r + 1);
  ctx.lineTo(cx - 4, cy - r + 9);
  ctx.lineTo(cx + 4, cy - r + 9);
  ctx.closePath();
  ctx.fillStyle = '#f4d98c';
  ctx.fill();

  if (_coordsEl && (_coordsFrame++ % 3 === 0)) {
    const pos = USE_SCENE_ASSET ? camera.position : actor.position;
    const modeLabel = (USE_SCENE_ASSET && !FORCE_SPHERE_AVATARS) ? 'fly' : 'sphere-third';
    _coordsEl.innerHTML =
      `X&nbsp;${pos.x.toFixed(2)}<br>Y&nbsp;${pos.y.toFixed(2)}<br>Z&nbsp;${pos.z.toFixed(2)}<br>`
      + `Up(Space/Q):&nbsp;${moveState.up ? '1' : '0'}&nbsp;Down(Ctrl/E):&nbsp;${moveState.down ? '1' : '0'}<br>`
      + `Mode:&nbsp;${modeLabel}`;
  }
}

const hemi = new THREE.HemisphereLight(
  USE_SCENE_ASSET ? 0xddefff : 0x6f84ad,
  USE_SCENE_ASSET ? 0x44505f : 0x241d17,
  USE_SCENE_ASSET ? (SAFARI_SAFE_MODE ? 0.64 : 0.80) : 0.62,
);
scene.add(hemi);

// Add sun directional light for mid-day effect
const sunLight = new THREE.DirectionalLight(0xffd280, 1.0);
sunLight.position.set(8, 12, 8);
scene.add(sunLight);

// Floating dust particle system (opt-in via dustParticles config)
const DUST_COUNT = 420;
let dustPoints = null;
let dustVelocities = null;
let dustOrigins = null;
if (DUST_PARTICLES) {
  const dustPositions = new Float32Array(DUST_COUNT * 3);
  dustVelocities = new Float32Array(DUST_COUNT * 3);
  dustOrigins = new Float32Array(DUST_COUNT * 3);
  const RANGE = 14;
  const HEIGHT_MIN = 0.2;
  const HEIGHT_MAX = 6.0;
  for (let i = 0; i < DUST_COUNT; i++) {
    const x = (Math.random() - 0.5) * RANGE * 2;
    const y = HEIGHT_MIN + Math.random() * (HEIGHT_MAX - HEIGHT_MIN);
    const z = (Math.random() - 0.5) * RANGE * 2;
    dustPositions[i * 3]     = x;
    dustPositions[i * 3 + 1] = y;
    dustPositions[i * 3 + 2] = z;
    dustOrigins[i * 3]     = x;
    dustOrigins[i * 3 + 1] = y;
    dustOrigins[i * 3 + 2] = z;
    // Gentle random drift velocity
    dustVelocities[i * 3]     = (Math.random() - 0.5) * 0.006;
    dustVelocities[i * 3 + 1] = (Math.random() - 0.5) * 0.003;
    dustVelocities[i * 3 + 2] = (Math.random() - 0.5) * 0.006;
  }
  const dustGeom = new THREE.BufferGeometry();
  dustGeom.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
  const dustMat = new THREE.PointsMaterial({
    color: 0xf5e8c8,
    size: 0.045,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });
  dustPoints = new THREE.Points(dustGeom, dustMat);
  scene.add(dustPoints);
}

const key = new THREE.DirectionalLight(USE_SCENE_ASSET ? 0xfff4d6 : 0xa3b7dd, USE_SCENE_ASSET ? (SAFARI_SAFE_MODE ? 0.62 : 0.78) : 0.78);
key.position.set(...(USE_SCENE_ASSET ? [10, 18, 12] : [-3.4, 4.4, 2.8]));
if (USE_SCENE_ASSET && !SAFARI_SAFE_MODE) {
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 120;
  key.shadow.camera.left = -40;
  key.shadow.camera.right = 40;
  key.shadow.camera.top = 40;
  key.shadow.camera.bottom = -40;
  key.shadow.bias = -0.0002;
}
scene.add(key);

const fill = new THREE.DirectionalLight(0xbfd6ff, USE_SCENE_ASSET ? (SAFARI_SAFE_MODE ? 0.44 : 0.62) : 0.22);
fill.position.set(...(USE_SCENE_ASSET ? [-12, 10, -10] : [3.6, 2.4, -2.6]));
scene.add(fill);

const worldSceneLoader = new GLTFLoader();
const worldSceneDracoLoader = new DRACOLoader();
worldSceneDracoLoader.setDecoderPath('/static/three-addons/libs/draco/gltf/');
const worldSceneKtx2Loader = new KTX2Loader();
worldSceneKtx2Loader.setTranscoderPath('/static/three-addons/libs/basis/');
worldSceneKtx2Loader.detectSupport(renderer);
worldSceneLoader.setDRACOLoader(worldSceneDracoLoader);
worldSceneLoader.setKTX2Loader(worldSceneKtx2Loader);
worldSceneLoader.setMeshoptDecoder(MeshoptDecoder);
let worldSceneRoot = null;
let mapGridOverlayGroup = null;
const vrLodState = {
  entries: [],
  enabled: true,
  updateIntervalSec: 0.12,
  lastUpdateSec: -Infinity,
  cameraPos: new THREE.Vector3(),
};

function resetVrLodVisibility() {
  if (!vrLodState.entries.length) return;
  for (const entry of vrLodState.entries) {
    if (!entry || !entry.mesh) continue;
    entry.mesh.visible = entry.baseVisible;
  }
}

function resolveVrLodProfile(triCount, radius) {
  if (triCount <= 900 && radius <= 0.8) {
    return {
      fullDetailDistance: 18,
      cullDistance: 34,
    };
  }
  if (triCount <= 5500 && radius <= 2.4) {
    return {
      fullDetailDistance: 28,
      cullDistance: 58,
    };
  }
  if (triCount <= 22000 && radius <= 7.5) {
    return {
      fullDetailDistance: 46,
      cullDistance: 88,
    };
  }
  return {
    fullDetailDistance: 76,
    cullDistance: 140,
  };
}

function buildVrLodIndex(root) {
  vrLodState.entries = [];
  if (!root) return;

  root.updateMatrixWorld(true);
  root.traverse((child) => {
    if (!child || !child.isMesh || !child.geometry) return;

    child.frustumCulled = true;
    const geometry = child.geometry;
    if (!geometry.boundingSphere) {
      geometry.computeBoundingSphere();
    }

    const sphere = geometry.boundingSphere;
    if (!sphere || !Number.isFinite(sphere.radius) || sphere.radius <= 0) return;

    const triCount = geometry.index
      ? Math.floor(geometry.index.count / 3)
      : Math.floor((geometry.attributes.position ? geometry.attributes.position.count : 0) / 3);
    if (!Number.isFinite(triCount) || triCount <= 0) return;

    const worldCenter = sphere.center.clone().applyMatrix4(child.matrixWorld);
    const worldRadius = sphere.radius * child.matrixWorld.getMaxScaleOnAxis();
    const profile = resolveVrLodProfile(triCount, worldRadius);
    vrLodState.entries.push({
      mesh: child,
      center: worldCenter,
      radius: worldRadius,
      baseVisible: child.visible,
      fullDetailDistance: profile.fullDetailDistance,
      cullDistance: profile.cullDistance,
      hasReducedDetail: false,
    });
  });
}

function updateVrLodVisibility(elapsedSec) {
  if (!vrLodState.enabled || !renderer.xr.isPresenting || !USE_SCENE_ASSET) return;
  if (!vrLodState.entries.length) return;
  if (elapsedSec - vrLodState.lastUpdateSec < vrLodState.updateIntervalSec) return;
  vrLodState.lastUpdateSec = elapsedSec;

  renderer.xr.getCamera(camera).getWorldPosition(vrLodState.cameraPos);

  for (const entry of vrLodState.entries) {
    const mesh = entry.mesh;
    if (!mesh) continue;

    const dx = entry.center.x - vrLodState.cameraPos.x;
    const dy = entry.center.y - vrLodState.cameraPos.y;
    const dz = entry.center.z - vrLodState.cameraPos.z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz) - entry.radius;
    const shouldCull = distance > entry.cullDistance;
    const shouldShow = entry.baseVisible && !shouldCull;
    if (mesh.visible !== shouldShow) {
      mesh.visible = shouldShow;
    }

    // LOD tiering: farther meshes keep rendering but with less expensive distance updates.
    entry.hasReducedDetail = distance > entry.fullDetailDistance;
  }
}

const mapSpaceDatabase = {
  cellSize: MAP_GRID_CELL_SIZE,
  spaces: [],
  byId: new Map(),
  occupancyBySpaceId: new Map(),
  pieceToSpaceId: new Map(),
};
let mapTargetMeshes = [];
let hoveredMapSpaceId = '';
const hoverRaycaster = new THREE.Raycaster();
const hoverRayNdc = new THREE.Vector2(0, 0);
let hoverHighlightMesh = null;

function ensureCrosshair() {
  if (!MAP_CROSSHAIR || document.getElementById('map-crosshair')) return;
  const root = document.createElement('div');
  root.id = 'map-crosshair';
  root.setAttribute('aria-hidden', 'true');
  root.style.position = 'fixed';
  root.style.left = '50%';
  root.style.top = '50%';
  root.style.width = '20px';
  root.style.height = '20px';
  root.style.transform = 'translate(-50%, -50%)';
  root.style.pointerEvents = 'none';
  root.style.zIndex = '30';

  const h = document.createElement('div');
  h.style.position = 'absolute';
  h.style.left = '0';
  h.style.top = '9px';
  h.style.width = '20px';
  h.style.height = '2px';
  h.style.background = 'rgba(255, 240, 185, 0.92)';
  h.style.boxShadow = '0 0 8px rgba(255, 220, 140, 0.65)';

  const v = document.createElement('div');
  v.style.position = 'absolute';
  v.style.left = '9px';
  v.style.top = '0';
  v.style.width = '2px';
  v.style.height = '20px';
  v.style.background = 'rgba(255, 240, 185, 0.92)';
  v.style.boxShadow = '0 0 8px rgba(255, 220, 140, 0.65)';

  root.appendChild(h);
  root.appendChild(v);
  document.body.appendChild(root);
}

function ensureHoverHighlightMesh() {
  if (!MAP_HOVER_HIGHLIGHT || hoverHighlightMesh) return;
  const geom = new THREE.PlaneGeometry(MAP_GRID_CELL_SIZE * 0.94, MAP_GRID_CELL_SIZE * 0.94);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x7af6ff,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  hoverHighlightMesh = new THREE.Mesh(geom, mat);
  hoverHighlightMesh.rotation.x = -Math.PI / 2;
  hoverHighlightMesh.visible = false;
  hoverHighlightMesh.renderOrder = 8;
  scene.add(hoverHighlightMesh);
}

let fireGlow = null;
let flameCore = null;
let flameOuter = null;

function tuneSceneAssetMaterials(root) {
  if (!root) return;
  root.traverse((child) => {
    if (!child || !child.isMesh || !child.material) return;
    child.castShadow = USE_SCENE_ASSET && !SAFARI_SAFE_MODE;
    child.receiveShadow = USE_SCENE_ASSET && !SAFARI_SAFE_MODE;
    const tuneMaterial = (material) => {
      if (!material) return;
      if ('side' in material) material.side = THREE.DoubleSide;
      if ('needsUpdate' in material) material.needsUpdate = true;
    };
    if (Array.isArray(child.material)) child.material.forEach(tuneMaterial);
    else tuneMaterial(child.material);
  });
}

function recenterSceneAsset(root) {
  if (!root) return null;
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) return null;
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  root.position.set(-center.x, -box.min.y, -center.z);
  root.updateMatrixWorld(true);
  const reframedBox = new THREE.Box3().setFromObject(root);
  const reframedCenter = reframedBox.getCenter(new THREE.Vector3());
  return { size, box: reframedBox, center: reframedCenter };
}

function frameSceneAsset(layout) {
  if (!layout || !layout.box || layout.box.isEmpty()) {
    camera.position.set(6, 4, 8);
    camera.lookAt(0, 1, 0);
    return;
  }

  const center = layout.center || layout.box.getCenter(new THREE.Vector3());
  const size = layout.size || layout.box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 1);
  const fov = THREE.MathUtils.degToRad(camera.fov);
  const distance = (maxDim * 1.15) / Math.tan(fov * 0.5);

  camera.position.set(
    center.x + distance * 0.55,
    center.y + Math.max(size.y * 0.4, 3),
    center.z + distance * 0.75,
  );
  camera.lookAt(center.x, center.y + Math.max(size.y * 0.12, 1.2), center.z);
}

function clearMapSpaceDatabase() {
  mapSpaceDatabase.spaces = [];
  mapSpaceDatabase.byId.clear();
  mapSpaceDatabase.occupancyBySpaceId.clear();
  mapSpaceDatabase.pieceToSpaceId.clear();
  mapTargetMeshes = [];
  hoveredMapSpaceId = '';
  if (hoverHighlightMesh) hoverHighlightMesh.visible = false;
}

function setPieceSpace(pieceId, spaceId) {
  const normalizedPieceId = String(pieceId || '').trim();
  const normalizedSpaceId = String(spaceId || '').trim();
  if (!normalizedPieceId || !normalizedSpaceId) return false;
  if (!mapSpaceDatabase.byId.has(normalizedSpaceId)) return false;

  const existingSpaceId = mapSpaceDatabase.pieceToSpaceId.get(normalizedPieceId);
  if (existingSpaceId) {
    mapSpaceDatabase.occupancyBySpaceId.delete(existingSpaceId);
  }

  mapSpaceDatabase.pieceToSpaceId.set(normalizedPieceId, normalizedSpaceId);
  mapSpaceDatabase.occupancyBySpaceId.set(normalizedSpaceId, normalizedPieceId);
  return true;
}

function releasePieceSpace(pieceId) {
  const normalizedPieceId = String(pieceId || '').trim();
  if (!normalizedPieceId) return false;
  const existingSpaceId = mapSpaceDatabase.pieceToSpaceId.get(normalizedPieceId);
  if (!existingSpaceId) return false;
  mapSpaceDatabase.pieceToSpaceId.delete(normalizedPieceId);
  mapSpaceDatabase.occupancyBySpaceId.delete(existingSpaceId);
  return true;
}

function getNearestMapSpace(x, z) {
  let best = null;
  let bestDistSq = Infinity;
  for (const cell of mapSpaceDatabase.spaces) {
    const dx = x - cell.center.x;
    const dz = z - cell.center.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestDistSq) {
      bestDistSq = d2;
      best = cell;
    }
  }
  return best;
}

window.tabletopSpaces = {
  getAll: () => mapSpaceDatabase.spaces.map((cell) => ({ ...cell })),
  getById: (spaceId) => {
    const cell = mapSpaceDatabase.byId.get(String(spaceId || '').trim());
    return cell ? { ...cell } : null;
  },
  getNearest: (x, z) => {
    const cell = getNearestMapSpace(Number(x), Number(z));
    return cell ? { ...cell } : null;
  },
  occupy: (pieceId, spaceId) => setPieceSpace(pieceId, spaceId),
  release: (pieceId) => releasePieceSpace(pieceId),
  getOccupancy: () => Object.fromEntries(mapSpaceDatabase.occupancyBySpaceId.entries()),
  getHovered: () => {
    if (!hoveredMapSpaceId) return null;
    const cell = mapSpaceDatabase.byId.get(hoveredMapSpaceId);
    return cell ? { ...cell } : null;
  },
  snapObjectToSpace: (object3d, spaceId, yOffset = 0.06) => {
    const cell = mapSpaceDatabase.byId.get(String(spaceId || '').trim());
    if (!cell || !object3d || typeof object3d.position?.set !== 'function') return false;
    object3d.position.set(cell.center.x, cell.y + Number(yOffset || 0), cell.center.z);
    return true;
  },
};

function buildMapGridOverlay(root) {
  if (!root) return;

  clearMapSpaceDatabase();
  ensureCrosshair();
  ensureHoverHighlightMesh();
  if (mapGridOverlayGroup) {
    scene.remove(mapGridOverlayGroup);
    mapGridOverlayGroup.traverse((obj) => {
      if (obj.geometry && typeof obj.geometry.dispose === 'function') obj.geometry.dispose();
      if (obj.material && typeof obj.material.dispose === 'function') obj.material.dispose();
    });
    mapGridOverlayGroup = null;
  }

  const mapMeshes = [];
  root.traverse((child) => {
    if (!child || !child.isMesh) return;
    const meshName = String(child.name || '').toLowerCase();
    if (meshName.includes('map')) {
      mapMeshes.push(child);
    }
  });
  if (!mapMeshes.length) return;

  mapMeshes.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  mapTargetMeshes = mapMeshes.slice();

  const overlay = new THREE.Group();
  overlay.name = 'MapGridOverlay';

  let globalSpaceNumber = 1;

  for (let meshIndex = 0; meshIndex < mapMeshes.length; meshIndex += 1) {
    const mesh = mapMeshes[meshIndex];
    const box = new THREE.Box3().setFromObject(mesh);
    if (box.isEmpty()) continue;

    const width = Math.max(box.max.x - box.min.x, MAP_GRID_CELL_SIZE);
    const depth = Math.max(box.max.z - box.min.z, MAP_GRID_CELL_SIZE);
    const cols = Math.max(1, Math.floor(width / MAP_GRID_CELL_SIZE));
    const rows = Math.max(1, Math.floor(depth / MAP_GRID_CELL_SIZE));
    const usableWidth = cols * MAP_GRID_CELL_SIZE;
    const usableDepth = rows * MAP_GRID_CELL_SIZE;
    const startX = box.min.x + (width - usableWidth) * 0.5;
    const startZ = box.min.z + (depth - usableDepth) * 0.5;
    const endX = startX + usableWidth;
    const endZ = startZ + usableDepth;
    const y = box.max.y + 0.02;

    if (MAP_SPACE_TRACKING) {
      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
          const centerX = startX + (col + 0.5) * MAP_GRID_CELL_SIZE;
          const centerZ = startZ + (row + 0.5) * MAP_GRID_CELL_SIZE;
          const id = `M${meshIndex + 1}-S${globalSpaceNumber}`;
          const cell = {
            id,
            n: globalSpaceNumber,
            mapMesh: String(mesh.name || `map-${meshIndex + 1}`),
            mapIndex: meshIndex + 1,
            row: row + 1,
            col: col + 1,
            y,
            size: MAP_GRID_CELL_SIZE,
            center: { x: centerX, z: centerZ },
          };
          mapSpaceDatabase.spaces.push(cell);
          mapSpaceDatabase.byId.set(id, cell);
          globalSpaceNumber += 1;
        }
      }
    }

    if (!MAP_GRID_OVERLAY) continue;

    const vertices = [];
    const epsilon = MAP_GRID_CELL_SIZE * 0.2;

    // X-aligned spans across Z, clipped to the map mesh footprint.
    for (let x = startX; x <= endX + epsilon; x += MAP_GRID_CELL_SIZE) {
      const lineX = Math.min(x, endX);
      vertices.push(lineX, y, startZ, lineX, y, endZ);
    }
    // Z-aligned spans across X, clipped to the map mesh footprint.
    for (let z = startZ; z <= endZ + epsilon; z += MAP_GRID_CELL_SIZE) {
      const lineZ = Math.min(z, endZ);
      vertices.push(startX, y, lineZ, endX, y, lineZ);
    }

    if (!vertices.length) continue;

    const gridGeom = new THREE.BufferGeometry();
    gridGeom.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    const gridMat = new THREE.LineBasicMaterial({
      color: 0xffde8c,
      transparent: true,
      opacity: 0.52,
      depthWrite: false,
    });
    const gridLines = new THREE.LineSegments(gridGeom, gridMat);
    gridLines.renderOrder = 6;
    overlay.add(gridLines);
  }

  if (MAP_GRID_OVERLAY && overlay.children.length) {
    mapGridOverlayGroup = overlay;
    scene.add(mapGridOverlayGroup);
  }
}

function updateHoveredMapSpaceFromCrosshair() {
  if (!MAP_HOVER_HIGHLIGHT || !hoverHighlightMesh) return;
  if (!mapTargetMeshes.length || !mapSpaceDatabase.spaces.length) {
    hoveredMapSpaceId = '';
    hoverHighlightMesh.visible = false;
    return;
  }

  hoverRaycaster.setFromCamera(hoverRayNdc, camera);
  const hits = hoverRaycaster.intersectObjects(mapTargetMeshes, true);
  if (!hits.length || !hits[0] || !hits[0].point) {
    hoveredMapSpaceId = '';
    hoverHighlightMesh.visible = false;
    return;
  }

  const hit = hits[0].point;
  const cell = getNearestMapSpace(hit.x, hit.z);
  if (!cell) {
    hoveredMapSpaceId = '';
    hoverHighlightMesh.visible = false;
    return;
  }

  hoveredMapSpaceId = cell.id;
  hoverHighlightMesh.visible = true;
  hoverHighlightMesh.position.set(cell.center.x, cell.y + 0.028, cell.center.z);
}

if (!USE_SCENE_ASSET) {
  const roomMat = new THREE.MeshStandardMaterial({ color: 0x202532, roughness: 0.93, metalness: 0.03 });
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x2f221d, roughness: 0.9, metalness: 0.02 });
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x525765, roughness: 0.88, metalness: 0.02 });
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x654d39, roughness: 0.86, metalness: 0.05 });

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), floorMat);
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  const backWall = new THREE.Mesh(new THREE.PlaneGeometry(12, 6), roomMat);
  backWall.position.set(0, 3, -4.5);
  scene.add(backWall);

  const leftWall = new THREE.Mesh(new THREE.PlaneGeometry(10, 6), roomMat);
  leftWall.position.set(-5.8, 3, 0);
  leftWall.rotation.y = Math.PI / 2;
  scene.add(leftWall);

  const rightWall = new THREE.Mesh(new THREE.PlaneGeometry(10, 6), roomMat);
  rightWall.position.set(5.8, 3, 0);
  rightWall.rotation.y = -Math.PI / 2;
  scene.add(rightWall);

  const hearth = new THREE.Mesh(new THREE.BoxGeometry(4.8, 2.4, 1.2), stoneMat);
  hearth.position.set(0, 1.2, -4.0);
  scene.add(hearth);

  const opening = new THREE.Mesh(new THREE.BoxGeometry(2.5, 1.6, 0.85), new THREE.MeshStandardMaterial({ color: 0x12141b, roughness: 0.9 }));
  opening.position.set(0, 1.04, -3.42);
  scene.add(opening);

  const mantle = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.26, 1.4), woodMat);
  mantle.position.set(0, 2.42, -3.9);
  scene.add(mantle);

  const rug = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 2.8), new THREE.MeshStandardMaterial({ color: 0x2c1318, roughness: 0.88 }));
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(0, 0.01, -1.35);
  scene.add(rug);

  fireGlow = new THREE.PointLight(0xff9a45, 2.9, 13, 2);
  fireGlow.position.set(0, 1.3, -3.1);
  scene.add(fireGlow);

  flameCore = new THREE.Mesh(
    new THREE.ConeGeometry(0.22, 0.72, 14),
    new THREE.MeshBasicMaterial({ color: 0xffb468, transparent: true, opacity: 0.75 })
  );
  flameCore.position.set(0, 1.04, -3.15);
  scene.add(flameCore);

  flameOuter = new THREE.Mesh(
    new THREE.ConeGeometry(0.34, 0.95, 14),
    new THREE.MeshBasicMaterial({ color: 0xff7c2b, transparent: true, opacity: 0.4 })
  );
  flameOuter.position.set(0, 1.08, -3.16);
  scene.add(flameOuter);
}

const actor = new THREE.Group();
actor.position.set(...SPAWN_POSITION);
if (!USE_SCENE_ASSET || FORCE_SPHERE_AVATARS || SHOW_AVATAR_SPHERE) {
  scene.add(actor);
}

const remoteActorsLayer = new THREE.Group();
scene.add(remoteActorsLayer);

const fallbackAvatar = new THREE.Group();
if (!USE_SCENE_ASSET || FORCE_SPHERE_AVATARS) {
  actor.add(fallbackAvatar);
}

// Player orb
const orbMat = new THREE.MeshStandardMaterial({
  color: 0x9b7fff,
  emissive: 0x5533cc,
  emissiveIntensity: 1.4,
  roughness: 0.08,
  metalness: 0.22,
  transparent: true,
  opacity: 0.88,
});
const orbMesh = new THREE.Mesh(new THREE.SphereGeometry(0.18, 32, 24), orbMat);
orbMesh.position.y = 1.0;
fallbackAvatar.add(orbMesh);



let customAvatarRoot = null;
let avatarMixer = null;
let customIdleAction = null;
let customWalkAction = null;
let activeCustomAction = null;
let customMixerUsable = false;
const importedRigAnimator = {
  active: false,
  bones: new Map(),
  idleOffsets: new Map(),
};

function disposeObject3D(root) {
  if (!root) return;
  root.traverse((child) => {
    if (child.geometry && typeof child.geometry.dispose === 'function') child.geometry.dispose();
    const mat = child.material;
    const disposeMat = (m) => {
      if (!m) return;
      for (const keyName in m) {
        const value = m[keyName];
        if (value && value.isTexture && typeof value.dispose === 'function') {
          value.dispose();
        }
      }
      if (typeof m.dispose === 'function') m.dispose();
    };
    if (Array.isArray(mat)) mat.forEach(disposeMat);
    else disposeMat(mat);
  });
}

function normalizeAvatarRoot(root) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  const targetHeight = 1.86;
  const scale = targetHeight / Math.max(size.y, 0.001);
  root.scale.setScalar(scale);
  root.updateMatrixWorld(true);

  const scaledBox = new THREE.Box3().setFromObject(root);
  const scaledCenter = scaledBox.getCenter(new THREE.Vector3());
  const minY = scaledBox.min.y;

  root.position.x += -scaledCenter.x;
  root.position.y += -minY;
  root.position.z += -scaledCenter.z;
}

function getBoneByPatterns(root, patterns) {
  if (!root) return null;
  let match = null;
  root.traverse((obj) => {
    if (match || !obj || !obj.isBone) return;
    const name = String(obj.name || '').toLowerCase();
    if (patterns.some((rx) => rx.test(name))) {
      match = obj;
    }
  });
  return match;
}

function collectPrimarySkeletonBones(root) {
  if (!root) return [];
  let best = [];
  root.traverse((obj) => {
    if (!obj || !obj.isSkinnedMesh || !obj.skeleton || !Array.isArray(obj.skeleton.bones)) return;
    const bones = obj.skeleton.bones.filter((b) => b && b.isBone);
    if (bones.length > best.length) best = bones;
  });
  if (best.length) return best;

  const fallback = [];
  root.traverse((obj) => {
    if (obj && obj.isBone) fallback.push(obj);
  });
  return fallback;
}

function inferBonesFromSpatialLayout(root) {
  const bones = collectPrimarySkeletonBones(root);
  if (!bones.length) return {};

  root.updateMatrixWorld(true);
  const rows = bones.map((bone) => {
    const worldPos = new THREE.Vector3();
    bone.getWorldPosition(worldPos);
    return { bone, worldPos };
  });

  const minY = Math.min(...rows.map((r) => r.worldPos.y));
  const maxY = Math.max(...rows.map((r) => r.worldPos.y));
  const spanY = Math.max(0.001, maxY - minY);

  const within = (r, lo, hi) => {
    const yNorm = (r.worldPos.y - minY) / spanY;
    return yNorm >= lo && yNorm <= hi;
  };

  const byY = [...rows].sort((a, b) => a.worldPos.y - b.worldPos.y);
  const byHeight = [...rows].sort((a, b) => b.worldPos.y - a.worldPos.y);

  const centerCandidates = rows
    .filter((r) => within(r, 0.35, 0.75))
    .sort((a, b) => Math.abs(a.worldPos.x) - Math.abs(b.worldPos.x));

  const hips = centerCandidates[0]?.bone || byY[Math.floor(byY.length * 0.45)]?.bone || null;
  const head = byHeight[0]?.bone || null;

  const upperBand = rows.filter((r) => within(r, 0.45, 0.85));
  const leftArm = [...upperBand]
    .filter((r) => r.worldPos.x < 0)
    .sort((a, b) => a.worldPos.x - b.worldPos.x)[0]?.bone || null;
  const rightArm = [...upperBand]
    .filter((r) => r.worldPos.x > 0)
    .sort((a, b) => b.worldPos.x - a.worldPos.x)[0]?.bone || null;

  const lowerBand = rows.filter((r) => within(r, 0.02, 0.45));
  const leftLeg = [...lowerBand]
    .filter((r) => r.worldPos.x < 0)
    .sort((a, b) => Math.abs(a.worldPos.x) - Math.abs(b.worldPos.x))[0]?.bone || null;
  const rightLeg = [...lowerBand]
    .filter((r) => r.worldPos.x > 0)
    .sort((a, b) => Math.abs(a.worldPos.x) - Math.abs(b.worldPos.x))[0]?.bone || null;

  const inferred = {
    hips,
    head,
    leftUpperArm: leftArm,
    rightUpperArm: rightArm,
    leftUpperLeg: leftLeg,
    rightUpperLeg: rightLeg,
  };

  return inferred;
}

function getFirstBoneChild(bone) {
  if (!bone || !Array.isArray(bone.children)) return null;
  return bone.children.find((child) => child && child.isBone) || null;
}

function rotateBoneTowardWorldDirection(bone, desiredWorldDir) {
  const child = getFirstBoneChild(bone);
  if (!bone || !child || !desiredWorldDir) return false;

  const start = new THREE.Vector3();
  const end = new THREE.Vector3();
  bone.getWorldPosition(start);
  child.getWorldPosition(end);

  const currentDir = end.sub(start);
  if (currentDir.lengthSq() < 1e-8) return false;
  currentDir.normalize();

  const targetDir = desiredWorldDir.clone().normalize();
  const deltaWorld = new THREE.Quaternion().setFromUnitVectors(currentDir, targetDir);

  const parentWorldQ = new THREE.Quaternion();
  if (bone.parent) {
    bone.parent.getWorldQuaternion(parentWorldQ);
  } else {
    parentWorldQ.identity();
  }

  const parentWorldInv = parentWorldQ.clone().invert();
  const localDelta = parentWorldInv.multiply(deltaWorld).multiply(parentWorldQ);
  bone.quaternion.premultiply(localDelta);
  bone.updateMatrixWorld(true);
  return true;
}

function captureIdleOffsetForSlot(slot) {
  const record = importedRigAnimator.bones.get(slot);
  if (!record) return;
  const baseInv = record.baseQuat.clone().invert();
  const offset = baseInv.multiply(record.bone.quaternion.clone());
  importedRigAnimator.idleOffsets.set(slot, offset);
}

function buildArmRestIdleOffsets() {
  importedRigAnimator.idleOffsets.clear();

  // Start from base pose before calibration.
  for (const record of importedRigAnimator.bones.values()) {
    record.bone.quaternion.copy(record.baseQuat);
  }

  const leftUpper = importedRigAnimator.bones.get('leftUpperArm')?.bone || null;
  const rightUpper = importedRigAnimator.bones.get('rightUpperArm')?.bone || null;
  const leftLower = importedRigAnimator.bones.get('leftLowerArm')?.bone || null;
  const rightLower = importedRigAnimator.bones.get('rightLowerArm')?.bone || null;

  const leftUpperTarget = new THREE.Vector3(-0.16, -0.98, 0.08);
  const rightUpperTarget = new THREE.Vector3(0.16, -0.98, 0.08);
  const leftLowerTarget = new THREE.Vector3(-0.12, -0.99, 0.03);
  const rightLowerTarget = new THREE.Vector3(0.12, -0.99, 0.03);

  rotateBoneTowardWorldDirection(leftUpper, leftUpperTarget);
  rotateBoneTowardWorldDirection(rightUpper, rightUpperTarget);
  rotateBoneTowardWorldDirection(leftLower, leftLowerTarget);
  rotateBoneTowardWorldDirection(rightLower, rightLowerTarget);

  captureIdleOffsetForSlot('leftUpperArm');
  captureIdleOffsetForSlot('rightUpperArm');
  captureIdleOffsetForSlot('leftLowerArm');
  captureIdleOffsetForSlot('rightLowerArm');

  // Restore base; runtime animation reapplies offsets every frame.
  for (const record of importedRigAnimator.bones.values()) {
    record.bone.quaternion.copy(record.baseQuat);
  }
}

function buildProceduralAvatar(colorHex = '#7f6bff') {
  const bodyMat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.62, metalness: 0.08, emissive: 0x121425 });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xe8ccb2, roughness: 0.72, metalness: 0.01 });
  const clothMat = new THREE.MeshStandardMaterial({ color: 0x2b304d, roughness: 0.9, metalness: 0.02 });
  const root = new THREE.Group();

  const torsoMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.56, 6, 12), bodyMat);
  torsoMesh.position.y = 1.03;
  root.add(torsoMesh);

  const headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.2, 24, 20), skinMat);
  headMesh.position.y = 1.59;
  root.add(headMesh);

  const cloakMesh = new THREE.Mesh(new THREE.ConeGeometry(0.43, 1.05, 14), clothMat);
  cloakMesh.position.y = 0.64;
  root.add(cloakMesh);

  const leftArmMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.4, 4, 8), skinMat);
  leftArmMesh.position.set(-0.34, 1.03, 0.02);
  leftArmMesh.rotation.z = Math.PI / 10;
  root.add(leftArmMesh);

  const rightArmMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.4, 4, 8), skinMat);
  rightArmMesh.position.set(0.34, 1.03, 0.02);
  rightArmMesh.rotation.z = -Math.PI / 10;
  root.add(rightArmMesh);

  const leftLegMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.72, 4, 8), bodyMat);
  leftLegMesh.position.set(-0.14, 0.4, 0.02);
  root.add(leftLegMesh);

  const rightLegMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.72, 4, 8), bodyMat);
  rightLegMesh.position.set(0.14, 0.4, 0.02);
  root.add(rightLegMesh);

  const bootsMesh = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.08, 0.3), new THREE.MeshStandardMaterial({ color: 0x1a1520, roughness: 0.86, metalness: 0.03 }));
  bootsMesh.position.set(0, 0.06, 0.07);
  root.add(bootsMesh);

  return root;
}

function buildSphereAvatar(colorHex = '#7f8fff') {
  const root = new THREE.Group();
  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(0.2, 24, 18),
    new THREE.MeshStandardMaterial({
      color: colorHex,
      emissive: 0x1c2f66,
      emissiveIntensity: 0.7,
      roughness: 0.22,
      metalness: 0.12,
      transparent: true,
      opacity: 0.92,
    })
  );
  sphere.position.y = 1.0;
  root.add(sphere);
  return root;
}

const netState = {
  socket: null,
  localSid: '',
  roster: {},
  remoteVisuals: new Map(),
  lastPublishedKey: '',
  publishAtMs: 0,
};

renderSocialPlayers();

function closeVoicePeer(sid) {
  const rec = rtcState.peers.get(sid);
  if (!rec) return;
  try {
    rec.pc.onicecandidate = null;
    rec.pc.ontrack = null;
    rec.pc.onconnectionstatechange = null;
    rec.pc.oniceconnectionstatechange = null;
    rec.pc.close();
  } catch (_err) {
    // Ignore.
  }
  removeRemoteAudioElement(sid);
  rtcState.peers.delete(sid);
}

function closeAllVoicePeers() {
  for (const sid of Array.from(rtcState.peers.keys())) {
    closeVoicePeer(sid);
  }
}

function attachLocalTracksToPeer(rec) {
  if (!rec || !rec.pc || !voiceState.stream) return;
  const existingTracks = rec.pc.getSenders().map((sender) => sender.track).filter(Boolean);
  voiceState.stream.getAudioTracks().forEach((track) => {
    track.enabled = !voiceState.muted;
    if (!existingTracks.includes(track)) {
      rec.pc.addTrack(track, voiceState.stream);
    }
  });
}

function getOrCreateVoicePeer(sid) {
  if (!sid) return null;
  const existing = rtcState.peers.get(sid);
  if (existing) {
    attachLocalTracksToPeer(existing);
    return existing;
  }

  const pc = new RTCPeerConnection({ iceServers: rtcState.iceServers });
  const audioEl = createRemoteAudioElement(sid);
  const rec = { sid, pc, audioEl, makingOffer: false };
  rtcState.peers.set(sid, rec);

  attachLocalTracksToPeer(rec);

  pc.onicecandidate = (event) => {
    if (!event.candidate || !netState.socket) return;
    netState.socket.emit('social-voice-ice-candidate', {
      targetSid: sid,
      payload: event.candidate.toJSON ? event.candidate.toJSON() : event.candidate,
    });
  };

  pc.ontrack = (event) => {
    const stream = event.streams && event.streams[0] ? event.streams[0] : null;
    if (!stream) return;
    audioEl.srcObject = stream;
    audioEl.play().catch(() => {
      // Autoplay can be blocked until user interaction; voice toggle provides one.
    });
  };

  const cleanupIfFailed = () => {
    const badStates = ['failed', 'closed', 'disconnected'];
    if (badStates.includes(pc.connectionState) || badStates.includes(pc.iceConnectionState)) {
      closeVoicePeer(sid);
    }
  };
  pc.onconnectionstatechange = cleanupIfFailed;
  pc.oniceconnectionstatechange = cleanupIfFailed;

  return rec;
}

async function sendVoiceOffer(sid) {
  if (!sid || !netState.socket || !netState.localSid) return;
  const rec = getOrCreateVoicePeer(sid);
  if (!rec) return;

  try {
    rec.makingOffer = true;
    const offer = await rec.pc.createOffer({ offerToReceiveAudio: true });
    await rec.pc.setLocalDescription(offer);
    netState.socket.emit('social-voice-offer', {
      targetSid: sid,
      payload: rec.pc.localDescription,
    });
  } catch (_err) {
    // Ignore renegotiation failures; next sync cycle can retry.
  } finally {
    rec.makingOffer = false;
  }
}

function syncVoicePeers() {
  if (!netState.socket || !netState.localSid) return;
  const roster = netState.roster && typeof netState.roster === 'object' ? netState.roster : {};
  const remoteSids = Object.keys(roster).filter((sid) => sid && sid !== netState.localSid);
  const remoteSet = new Set(remoteSids);

  for (const sid of Array.from(rtcState.peers.keys())) {
    if (!remoteSet.has(sid)) {
      closeVoicePeer(sid);
    }
  }

  if (!voiceState.enabled) return;

  for (const sid of remoteSids) {
    // Deterministic initiator rule to avoid glare.
    if (String(netState.localSid) < String(sid)) {
      const rec = getOrCreateVoicePeer(sid);
      if (!rec) continue;
      const shouldOffer = rec.pc.signalingState === 'stable' && !rec.makingOffer;
      if (shouldOffer) {
        sendVoiceOffer(sid);
      }
    }
  }
}

async function handleVoiceOffer(fromSid, payload) {
  if (!fromSid || !payload) return;
  const rec = getOrCreateVoicePeer(fromSid);
  if (!rec) return;

  try {
    const offer = new RTCSessionDescription(payload);
    if (rec.pc.signalingState !== 'stable') {
      await Promise.allSettled([
        rec.pc.setLocalDescription({ type: 'rollback' }),
      ]);
    }
    await rec.pc.setRemoteDescription(offer);
    const answer = await rec.pc.createAnswer();
    await rec.pc.setLocalDescription(answer);
    if (netState.socket) {
      netState.socket.emit('social-voice-answer', {
        targetSid: fromSid,
        payload: rec.pc.localDescription,
      });
    }
  } catch (_err) {
    // Ignore malformed offers.
  }
}

async function handleVoiceAnswer(fromSid, payload) {
  if (!fromSid || !payload) return;
  const rec = rtcState.peers.get(fromSid);
  if (!rec) return;
  try {
    await rec.pc.setRemoteDescription(new RTCSessionDescription(payload));
  } catch (_err) {
    // Ignore malformed answers.
  }
}

async function handleVoiceIceCandidate(fromSid, payload) {
  if (!fromSid || !payload) return;
  const rec = getOrCreateVoicePeer(fromSid);
  if (!rec) return;
  try {
    await rec.pc.addIceCandidate(new RTCIceCandidate(payload));
  } catch (_err) {
    // Ignore candidate races.
  }
}

function removeRemoteVisual(sid) {
  const rec = netState.remoteVisuals.get(sid);
  if (!rec) return;
  if (rec.root && rec.root.parent) rec.root.parent.remove(rec.root);
  if (rec.modelRoot) disposeObject3D(rec.modelRoot);
  if (rec.fallbackRoot) disposeObject3D(rec.fallbackRoot);
  if (rec.nameplate && rec.nameplate.material && rec.nameplate.material.map) {
    rec.nameplate.material.map.dispose();
    rec.nameplate.material.dispose();
  }
  netState.remoteVisuals.delete(sid);
}

function createNameplate(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 384;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'rgba(10,14,24,0.78)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, canvas.width - 3, canvas.height - 3);
  ctx.font = 'bold 34px Consolas';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#9db0e6';
  ctx.fillText(String(text || '').slice(0, 20), canvas.width / 2, canvas.height / 2);

  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(1.2, 0.3, 1);
  sprite.position.set(0, 2.35, 0);
  return sprite;
}

async function ensureRemoteVisual(sid, entry) {
  if (MAP3D_SCENE_ONLY_MODE) return;
  if (USE_SCENE_ASSET && !FORCE_SPHERE_AVATARS) return;
  let rec = netState.remoteVisuals.get(sid);
  if (!rec) {
    const root = new THREE.Group();
    const fallbackRoot = FORCE_SPHERE_AVATARS
      ? buildSphereAvatar(String(entry?.side || '').toLowerCase() === 'villains' ? '#dd7f7f' : '#7f8fff')
      : buildProceduralAvatar(String(entry?.side || '').toLowerCase() === 'villains' ? '#dd7f7f' : '#7f8fff');
    const nameplate = createNameplate(String(entry?.name || `Player-${sid.slice(0, 6)}`));
    root.add(fallbackRoot);
    root.add(nameplate);
    remoteActorsLayer.add(root);
    rec = {
      root,
      fallbackRoot,
      modelRoot: null,
      modelUrl: '',
      loadToken: 0,
      nameplate,
    };
    netState.remoteVisuals.set(sid, rec);
  }

  rec.root.position.set(
    Number(entry?.position?.x) || 0,
    Number(entry?.position?.y) || 0,
    Number(entry?.position?.z) || 0,
  );
  rec.root.rotation.y = Number(entry?.rotation?.y) || 0;

  const modelUrl = String(entry?.avatar?.modelUrl || 'fallback').trim() || 'fallback';
  if (modelUrl === rec.modelUrl) return;
  rec.modelUrl = modelUrl;
  rec.loadToken += 1;
  const token = rec.loadToken;

  if (rec.modelRoot) {
    rec.root.remove(rec.modelRoot);
    disposeObject3D(rec.modelRoot);
    rec.modelRoot = null;
  }

  if (modelUrl === 'fallback') {
    rec.fallbackRoot.visible = true;
    return;
  }

  try {
    const loader = new GLTFLoader();
    const gltf = await new Promise((resolve, reject) => loader.load(modelUrl, resolve, undefined, reject));
    if (!netState.remoteVisuals.has(sid)) return;
    const latest = netState.remoteVisuals.get(sid);
    if (!latest || latest.loadToken !== token) return;
    const root = gltf.scene || (Array.isArray(gltf.scenes) ? gltf.scenes[0] : null);
    if (!root) {
      latest.fallbackRoot.visible = true;
      return;
    }
    normalizeAvatarRoot(root);
    latest.root.add(root);
    latest.modelRoot = root;
    latest.fallbackRoot.visible = false;
  } catch (_err) {
    const latest = netState.remoteVisuals.get(sid);
    if (latest) latest.fallbackRoot.visible = true;
  }
}

function syncRemoteActors() {
  if (USE_SCENE_ASSET && !FORCE_SPHERE_AVATARS) {
    for (const sid of Array.from(netState.remoteVisuals.keys())) {
      removeRemoteVisual(sid);
    }
    renderSocialPlayers();
    return;
  }

  const localSid = String(netState.localSid || '');
  const wanted = new Set();

  for (const [sid, entry] of Object.entries(netState.roster || {})) {
    if (!sid || sid === localSid) continue;
    wanted.add(sid);
    ensureRemoteVisual(sid, entry);
  }

  for (const sid of Array.from(netState.remoteVisuals.keys())) {
    if (!wanted.has(sid)) removeRemoteVisual(sid);
  }

  renderSocialPlayers();
}

function publishLocalPresence(force = false) {
  if (!netState.socket || !netState.localSid) return;
  const localPosition = (USE_SCENE_ASSET && !FORCE_SPHERE_AVATARS) ? camera.position : actor.position;
  const payload = {
    name: chosenDisplayName || 'Traveler',
    side: 'heroes',
    role: 'player',
    position: {
      x: Number(localPosition.x.toFixed(3)),
      y: Number(localPosition.y.toFixed(3)),
      z: Number(localPosition.z.toFixed(3)),
    },
    rotation: {
      x: 0,
      y: Number(actor.rotation.y.toFixed(4)),
      z: 0,
    },
    avatar: {
      modelUrl: USE_SCENE_ASSET ? 'fallback' : (selectedModelUrl || 'fallback'),
    },
    social: {
      voiceEnabled: Boolean(voiceState.enabled && !voiceState.muted),
      voiceSpeaking: Boolean(voiceState.speaking && !voiceState.muted),
    },
  };

  const key = `${payload.name}|${payload.position.x},${payload.position.y},${payload.position.z}|${payload.rotation.y}|${payload.avatar.modelUrl}`;
  if (!force && key === netState.lastPublishedKey) return;
  netState.lastPublishedKey = key;

  netState.socket.emit('player-update', payload);
  netState.roster[netState.localSid] = {
    ...(netState.roster[netState.localSid] || {}),
    id: netState.localSid,
    ...payload,
  };
}

function connectMultiplayer() {
  if (SINGLE_PLAYER_MODE) return;
  if (netState.socket || typeof window.io !== 'function') return;
  const socket = window.io();
  netState.socket = socket;

  socket.on('connect', () => {
    netState.localSid = socket.id || netState.localSid;
    socket.emit('register-role', { role: 'player' });
    publishLocalPresence(true);
    pushChatMessage({ type: 'system', text: 'Connected to room.' });
  });

  socket.on('player-id', (payload) => {
    if (payload && payload.id) {
      netState.localSid = String(payload.id);
      publishLocalPresence(true);
    }
  });

  socket.on('players-state', (players) => {
    netState.roster = (players && typeof players === 'object') ? players : {};
    syncRemoteActors();
    syncVoicePeers();
  });

  socket.on('player-update', (entry) => {
    if (!entry || !entry.id) return;
    netState.roster[entry.id] = entry;
    syncRemoteActors();
    syncVoicePeers();
  });

  socket.on('player-joined', (entry) => {
    if (!entry || !entry.id) return;
    netState.roster[entry.id] = entry;
    syncRemoteActors();
    syncVoicePeers();
  });

  socket.on('player-left', (payload) => {
    const sid = String(payload?.id || '').trim();
    if (!sid) return;
    delete netState.roster[sid];
    removeRemoteVisual(sid);
    closeVoicePeer(sid);
    renderSocialPlayers();
  });

  socket.on('social-voice-offer', (packet) => {
    const fromSid = String(packet?.fromSid || '').trim();
    const payload = packet && typeof packet.payload === 'object' ? packet.payload : null;
    handleVoiceOffer(fromSid, payload);
  });

  socket.on('social-voice-answer', (packet) => {
    const fromSid = String(packet?.fromSid || '').trim();
    const payload = packet && typeof packet.payload === 'object' ? packet.payload : null;
    handleVoiceAnswer(fromSid, payload);
  });

  socket.on('social-voice-ice-candidate', (packet) => {
    const fromSid = String(packet?.fromSid || '').trim();
    const payload = packet && typeof packet.payload === 'object' ? packet.payload : null;
    handleVoiceIceCandidate(fromSid, payload);
  });

  socket.on('social-chat-message', (payload) => {
    if (!payload || typeof payload !== 'object') return;
    const name = sanitizeText(payload.name || 'Player', 24) || 'Player';
    const text = sanitizeText(payload.message || '', 300);
    if (!text) return;
    pushChatMessage({ type: 'chat', name, text });
  });

  socket.on('disconnect', () => {
    closeAllVoicePeers();
    pushChatMessage({ type: 'system', text: 'Disconnected from room.' });
  });
}

function teardownVoiceCapture() {
  if (voiceState.raf) {
    cancelAnimationFrame(voiceState.raf);
    voiceState.raf = 0;
  }
  if (voiceState.source) {
    voiceState.source.disconnect();
    voiceState.source = null;
  }
  if (voiceState.analyser) {
    voiceState.analyser.disconnect();
    voiceState.analyser = null;
  }
  if (voiceState.stream) {
    voiceState.stream.getTracks().forEach((track) => track.stop());
    voiceState.stream = null;
  }
  if (voiceState.audioContext) {
    voiceState.audioContext.close().catch(() => {});
    voiceState.audioContext = null;
  }
  voiceState.dataArray = null;
  voiceState.enabled = false;
  voiceState.muted = false;
  voiceState.speaking = false;
  closeAllVoicePeers();
  updateVoiceUi();
}

function startVoiceMeter() {
  if (!voiceState.analyser || !voiceState.dataArray) return;

  const loop = () => {
    if (!voiceState.analyser || !voiceState.dataArray) {
      voiceState.raf = 0;
      return;
    }
    voiceState.analyser.getByteTimeDomainData(voiceState.dataArray);
    let sumSquares = 0;
    for (let i = 0; i < voiceState.dataArray.length; i += 1) {
      const normalized = (voiceState.dataArray[i] - 128) / 128;
      sumSquares += normalized * normalized;
    }
    const rms = Math.sqrt(sumSquares / voiceState.dataArray.length);
    const speakingNow = !voiceState.muted && rms > 0.035;
    if (speakingNow !== voiceState.speaking) {
      voiceState.speaking = speakingNow;
      updateVoiceUi();
      publishLocalPresence(true);
      renderSocialPlayers();
    }
    voiceState.raf = requestAnimationFrame(loop);
  };

  if (!voiceState.raf) {
    voiceState.raf = requestAnimationFrame(loop);
  }
}

async function toggleVoiceState() {
  if (SINGLE_PLAYER_MODE) {
    voiceState.unavailableReason = 'single-player';
    updateVoiceUi();
    pushChatMessage({ type: 'system', text: 'Voice chat is disabled in single-player mode.' });
    return;
  }

  if (!voiceState.enabled) {
    if (!isMicAllowedByContext()) {
      voiceState.unavailableReason = 'insecure-context';
      updateVoiceUi();
      pushChatMessage({ type: 'system', text: buildInsecureContextMessage() });
      return;
    }

    if (!canUseMicrophoneApis()) {
      voiceState.unavailableReason = 'browser-api-unavailable';
      updateVoiceUi();
      pushChatMessage({ type: 'system', text: 'This browser does not expose microphone APIs (mediaDevices/getUserMedia). Try latest Chrome/Edge/Firefox/Opera with permissions enabled.' });
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);

      voiceState.stream = stream;
      voiceState.audioContext = audioContext;
      voiceState.source = source;
      voiceState.analyser = analyser;
      voiceState.dataArray = new Uint8Array(analyser.fftSize);
      voiceState.enabled = true;
      voiceState.muted = false;
      voiceState.speaking = false;
      voiceState.unavailableReason = '';
      updateVoiceUi();
      publishLocalPresence(true);
      startVoiceMeter();
      syncVoicePeers();
      pushChatMessage({ type: 'system', text: 'Voice enabled.' });
    } catch (err) {
      const detail = formatVoiceInitError(err);
      pushChatMessage({ type: 'system', text: detail });
      teardownVoiceCapture();
    }
    return;
  }

  voiceState.muted = !voiceState.muted;
  if (voiceState.stream) {
    voiceState.stream.getAudioTracks().forEach((track) => {
      track.enabled = !voiceState.muted;
    });
  }
  if (voiceState.muted) {
    voiceState.speaking = false;
  }
  updateVoiceUi();
  publishLocalPresence(true);
  renderSocialPlayers();
}

function sendChatMessage() {
  const text = sanitizeText(socialChatInputEl ? socialChatInputEl.value : '', 300);
  if (!text) return;
  if (socialChatInputEl) {
    socialChatInputEl.value = '';
  }
  if (!netState.socket) {
    pushChatMessage({ type: 'system', text: 'Not connected yet. Join room first.' });
    return;
  }
  netState.socket.emit('social-chat-message', {
    message: text,
    name: chosenDisplayName || selectedCharacter?.name || 'Traveler',
  });
}

function clipHasUsableMotion(clip) {
  if (!clip || !Array.isArray(clip.tracks) || clip.tracks.length === 0) return false;
  if (!Number.isFinite(clip.duration) || clip.duration <= 0.02) return false;

  for (const track of clip.tracks) {
    const values = track && track.values;
    if (!values || values.length < 2) continue;
    const stride = track.getValueSize ? track.getValueSize() : 1;
    if (!Number.isFinite(stride) || stride <= 0) continue;
    if (values.length < stride * 2) continue;

    for (let i = stride; i < values.length; i += stride) {
      for (let c = 0; c < stride; c += 1) {
        if (Math.abs(values[i + c] - values[c]) > 1e-4) {
          return true;
        }
      }
    }
  }
  return false;
}

function initDisplayNameGate() {
  if (SINGLE_PLAYER_MODE) {
    chosenDisplayName = sanitizeDisplayName(selectedCharacter?.name || selectedCharacter?.id || '') || 'Traveler';
    if (nameGateEl) nameGateEl.style.display = 'none';
    updateHudPlayerText();
    renderSocialPlayers();
    return;
  }

  const storedName = sanitizeDisplayName(localStorage.getItem(DISPLAY_NAME_STORAGE_KEY) || '');
  const suggested = storedName || sanitizeDisplayName(selectedCharacter?.name || selectedCharacter?.id || '');

  if (displayNameInputEl) {
    displayNameInputEl.value = suggested;
    displayNameInputEl.focus();
    displayNameInputEl.select();
  }

  const joinRoom = () => {
    const candidate = sanitizeDisplayName(displayNameInputEl ? displayNameInputEl.value : '');
    if (!candidate) {
      if (displayNameErrorEl) displayNameErrorEl.textContent = 'Display name is required.';
      if (displayNameInputEl) displayNameInputEl.focus();
      return;
    }

    chosenDisplayName = candidate;
    localStorage.setItem(DISPLAY_NAME_STORAGE_KEY, chosenDisplayName);
    if (displayNameErrorEl) displayNameErrorEl.textContent = '';
    if (nameGateEl) nameGateEl.style.display = 'none';

    updateHudPlayerText();
    connectMultiplayer();
    publishLocalPresence(true);
    renderSocialPlayers();
    pushChatMessage({ type: 'system', text: `Joined as ${chosenDisplayName}.` });
  };

  if (displayNameSubmitEl) {
    displayNameSubmitEl.addEventListener('click', joinRoom);
  }
  if (displayNameInputEl) {
    displayNameInputEl.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        joinRoom();
      }
    });
  }
}

if (socialChatSendEl) {
  socialChatSendEl.addEventListener('click', sendChatMessage);
}
if (socialChatInputEl) {
  socialChatInputEl.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      sendChatMessage();
    }
  });
}
if (voiceToggleEl) {
  voiceToggleEl.addEventListener('click', () => {
    toggleVoiceState();
  });
}

function setupImportedRigAnimator(root) {
  importedRigAnimator.active = false;
  importedRigAnimator.bones.clear();
  importedRigAnimator.idleOffsets.clear();
  if (!root) return;

  const slots = {
    hips: [/(^|[_.])hips?([_.]|$)/i, /pelvis/i, /mixamorig:?hips/i, /^root$/i],
    spine: [/spine$/i, /spine[_.-]?0*1/i, /mixamorig:?spine$/i, /torso/i],
    chest: [/chest/i, /upperchest/i, /spine[_.-]?0*2/i, /mixamorig:?spine1/i],
    neck: [/neck/i, /mixamorig:?neck/i],
    head: [/head/i, /mixamorig:?head/i],
    leftUpperArm: [/left.*upperarm/i, /upperarm.*left/i, /mixamorig:?leftarm/i, /^armature.*arm.*l/i, /arm[_ .-]*l/i],
    leftLowerArm: [/left.*(lowerarm|forearm)/i, /(lowerarm|forearm).*(left|_l|\.l| l)/i, /mixamorig:?leftforearm/i],
    leftHand: [/left.*hand/i, /hand.*left/i, /mixamorig:?lefthand/i],
    rightUpperArm: [/right.*upperarm/i, /upperarm.*right/i, /mixamorig:?rightarm/i, /^armature.*arm.*r/i, /arm[_ .-]*r/i],
    rightLowerArm: [/right.*(lowerarm|forearm)/i, /(lowerarm|forearm).*(right|_r|\.r| r)/i, /mixamorig:?rightforearm/i],
    rightHand: [/right.*hand/i, /hand.*right/i, /mixamorig:?righthand/i],
    leftUpperLeg: [/left.*(upleg|thigh|upperleg)/i, /(upleg|thigh|upperleg).*(left|_l|\.l| l)/i, /mixamorig:?leftupleg/i],
    leftLowerLeg: [/left.*(leg|calf|lowerleg)/i, /(leg|calf|lowerleg).*(left|_l|\.l| l)/i, /mixamorig:?leftleg/i],
    leftFoot: [/left.*foot/i, /foot.*left/i, /mixamorig:?leftfoot/i],
    rightUpperLeg: [/right.*(upleg|thigh|upperleg)/i, /(upleg|thigh|upperleg).*(right|_r|\.r| r)/i, /mixamorig:?rightupleg/i],
    rightLowerLeg: [/right.*(leg|calf|lowerleg)/i, /(leg|calf|lowerleg).*(right|_r|\.r| r)/i, /mixamorig:?rightleg/i],
    rightFoot: [/right.*foot/i, /foot.*right/i, /mixamorig:?rightfoot/i],
  };

  for (const [slot, patterns] of Object.entries(slots)) {
    const bone = getBoneByPatterns(root, patterns);
    if (bone) {
      importedRigAnimator.bones.set(slot, {
        bone,
        baseQuat: bone.quaternion.clone(),
      });
    }
  }

  // Fallback for unnamed/custom rigs: infer key bones from actual armature layout.
  const inferred = inferBonesFromSpatialLayout(root);
  for (const [slot, bone] of Object.entries(inferred)) {
    if (!bone || importedRigAnimator.bones.has(slot)) continue;
    importedRigAnimator.bones.set(slot, {
      bone,
      baseQuat: bone.quaternion.clone(),
    });
  }

  const hasCore = importedRigAnimator.bones.has('hips')
    || importedRigAnimator.bones.has('spine')
    || importedRigAnimator.bones.has('head');
  importedRigAnimator.active = hasCore && importedRigAnimator.bones.size >= 3;

  if (importedRigAnimator.active) {
    buildArmRestIdleOffsets();
  }
}

function applyImportedRigFallbackAnimation(elapsed, isMoving) {
  if (!importedRigAnimator.active) return;

  const walkPhase = elapsed * (moveState.boost ? 9.2 : 6.1);
  const stride = Math.sin(walkPhase);
  const antiStride = Math.sin(walkPhase + Math.PI);
  const idleBreath = Math.sin(elapsed * 2.0);
  const makeQ = (x = 0, y = 0, z = 0) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, 'XYZ'));
  const combineQ = (a, b) => a.clone().multiply(b);

  // Canonical relaxed idle pose for any imported humanoid armature.
  const idlePose = {
    hips: makeQ(0.03 + idleBreath * 0.01, Math.sin(elapsed * 0.7) * 0.02, 0),
    spine: makeQ(-0.06 + idleBreath * 0.012, 0, 0),
    chest: makeQ(-0.03 + idleBreath * 0.01, 0, 0),
    neck: makeQ(0.02, 0, 0),
    head: makeQ(0.03, Math.sin(elapsed * 0.6) * 0.03, 0),
    leftUpperArm: makeQ(Math.sin(elapsed * 1.0 + 0.4) * 0.01, 0, 0),
    leftLowerArm: makeQ(0, 0, 0),
    leftHand: makeQ(0.02, 0, 0),
    rightUpperArm: makeQ(Math.sin(elapsed * 1.0) * 0.01, 0, 0),
    rightLowerArm: makeQ(0, 0, 0),
    rightHand: makeQ(0.02, 0, 0),
    leftUpperLeg: makeQ(-0.04, 0, 0.02),
    leftLowerLeg: makeQ(0.08, 0, 0),
    leftFoot: makeQ(-0.03, 0, 0),
    rightUpperLeg: makeQ(-0.04, 0, -0.02),
    rightLowerLeg: makeQ(0.08, 0, 0),
    rightFoot: makeQ(-0.03, 0, 0),
  };

  const walkLayer = isMoving
    ? {
      hips: makeQ(0, Math.sin(walkPhase * 0.5) * 0.06, Math.sin(walkPhase) * 0.025),
      spine: makeQ(Math.sin(walkPhase * 0.5) * 0.03, 0, 0),
      chest: makeQ(Math.sin(walkPhase * 0.5 + 0.4) * 0.025, 0, 0),
      head: makeQ(0, Math.sin(walkPhase * 0.42) * 0.04, 0),
      leftUpperArm: makeQ(antiStride * 0.52, 0, 0),
      leftLowerArm: makeQ(Math.max(0, antiStride) * 0.22, 0, 0),
      rightUpperArm: makeQ(stride * 0.52, 0, 0),
      rightLowerArm: makeQ(Math.max(0, stride) * 0.22, 0, 0),
      leftUpperLeg: makeQ(stride * 0.72, 0, 0),
      leftLowerLeg: makeQ(Math.max(0, -stride) * 0.8, 0, 0),
      rightUpperLeg: makeQ(antiStride * 0.72, 0, 0),
      rightLowerLeg: makeQ(Math.max(0, -antiStride) * 0.8, 0, 0),
      leftFoot: makeQ(stride * 0.2, 0, 0),
      rightFoot: makeQ(antiStride * 0.2, 0, 0),
    }
    : {};

  for (const [slot, record] of importedRigAnimator.bones.entries()) {
    const calibratedIdle = importedRigAnimator.idleOffsets.get(slot) || makeQ();
    const idleQ = calibratedIdle.clone().multiply(idlePose[slot] || makeQ());
    const walkQ = walkLayer[slot] || makeQ();
    const offset = combineQ(idleQ, walkQ);
    record.bone.quaternion.copy(record.baseQuat).multiply(offset);
  }
}

async function loadSelectedAvatar() {
  if (MAP3D_SCENE_ONLY_MODE) return;
  if (USE_SCENE_ASSET || FORCE_SPHERE_AVATARS) return;
  if (!selectedModelUrl) return;
  const loader = new GLTFLoader();

  try {
    const gltf = await new Promise((resolve, reject) => {
      loader.load(selectedModelUrl, resolve, undefined, reject);
    });

    const root = gltf.scene || (Array.isArray(gltf.scenes) ? gltf.scenes[0] : null);
    if (!root) return;

    if (customAvatarRoot) {
      actor.remove(customAvatarRoot);
      disposeObject3D(customAvatarRoot);
      customAvatarRoot = null;
    }

    avatarMixer = null;
    customIdleAction = null;
    customWalkAction = null;
    activeCustomAction = null;
    customMixerUsable = false;
    importedRigAnimator.active = false;
    importedRigAnimator.bones.clear();

    normalizeAvatarRoot(root);
    customAvatarRoot = root;
    actor.add(customAvatarRoot);
    fallbackAvatar.visible = false;

    setupImportedRigAnimator(customAvatarRoot);

    if (Array.isArray(gltf.animations) && gltf.animations.length) {
      const clips = gltf.animations;
      const findClip = (matcher) => clips.find((clip) => matcher.test(String(clip.name || '').toLowerCase())) || null;
      const idleClip = findClip(/idle|stand|breath|rest/) || clips[0] || null;
      const walkClip = findClip(/walk|locomotion|move|run/) || clips.find((clip) => clip !== idleClip) || idleClip;
      const idleUsable = clipHasUsableMotion(idleClip);
      const walkUsable = clipHasUsableMotion(walkClip);

      if (idleUsable || walkUsable) {
        avatarMixer = new THREE.AnimationMixer(customAvatarRoot);
        customMixerUsable = true;
      }

      if (avatarMixer && idleClip && idleUsable) {
        customIdleAction = avatarMixer.clipAction(idleClip);
        customIdleAction.enabled = true;
        customIdleAction.setEffectiveWeight(1);
        customIdleAction.play();
        activeCustomAction = customIdleAction;
      }

      if (avatarMixer && walkClip && walkUsable) {
        customWalkAction = avatarMixer.clipAction(walkClip);
        customWalkAction.enabled = true;
        customWalkAction.setEffectiveWeight(0);
      }

      if (avatarMixer && !customIdleAction && customWalkAction) {
        customIdleAction = customWalkAction;
        customIdleAction.setEffectiveWeight(1);
        customIdleAction.play();
        activeCustomAction = customIdleAction;
      }

      if (avatarMixer && !customWalkAction && customIdleAction) {
        customWalkAction = customIdleAction;
      }
    }
  } catch (_err) {
    avatarMixer = null;
    customIdleAction = null;
    customWalkAction = null;
    activeCustomAction = null;
    customMixerUsable = false;
    importedRigAnimator.active = false;
    importedRigAnimator.bones.clear();
    fallbackAvatar.visible = true;
  }
}

loadSelectedAvatar();
initDisplayNameGate();

const moveState = {
  forward: false,
  back: false,
  left: false,
  right: false,
  up: false,
  down: false,
  boost: false,
};

const moveBounds = {
  minX: USE_SCENE_ASSET ? -20 : -5.25,
  maxX: USE_SCENE_ASSET ? 20 : 5.25,
  minZ: USE_SCENE_ASSET ? -20 : -4.95,
  maxZ: USE_SCENE_ASSET ? 20 : 3.25,
};

let pointerLocked = false;
let orbitYaw = 0;
let orbitPitch = -0.12;
let orbitDistance = 5.2;

const moveSpeed = FORCE_SPHERE_AVATARS ? 5.2 : (USE_SCENE_ASSET ? 8.5 : 3.4);
const boostMultiplier = FORCE_SPHERE_AVATARS ? 2.0 : (USE_SCENE_ASSET ? 2.8 : 2.2);
const lookSensitivity = 0.0022;
const verticalLookLimit = USE_SCENE_ASSET ? 1.52 : 0.72;

const tmpForward = new THREE.Vector3();
const tmpRight = new THREE.Vector3();
const tmpMove = new THREE.Vector3();
const tmpTarget = new THREE.Vector3();
const tmpDesiredCam = new THREE.Vector3();
const worldUp = new THREE.Vector3(0, 1, 0);
const tmpLookForward = new THREE.Vector3();
const tmpFlatForward = new THREE.Vector3();
const tmpVertical = new THREE.Vector3();
const xrTmpForward = new THREE.Vector3();
const xrTmpRight = new THREE.Vector3();
const xrTmpWorldPos = new THREE.Vector3();
const xrTmpQuat = new THREE.Quaternion();
const xrTmpHeadQuat = new THREE.Quaternion();

function readThumbstickAxes(gamepad) {
  if (!gamepad || !Array.isArray(gamepad.axes) || gamepad.axes.length === 0) return [0, 0];
  let x = 0;
  let y = 0;
  if (gamepad.axes.length >= 4) {
    x = Number(gamepad.axes[2] || 0);
    y = Number(gamepad.axes[3] || 0);
    // Some controllers place primary stick on axes 0/1.
    if (Math.abs(x) + Math.abs(y) < 0.05) {
      x = Number(gamepad.axes[0] || 0);
      y = Number(gamepad.axes[1] || 0);
    }
  } else {
    x = Number(gamepad.axes[0] || 0);
    y = Number(gamepad.axes[1] || 0);
  }
  return [x, y];
}

function makeReferenceSpaceTranslation(x, y, z) {
  // XR origin offsets are inverse of desired world movement.
  return new XRRigidTransform({ x: -x, y: -y, z: -z });
}

function applyIncrementalXrTransform(deltaX, deltaY, deltaZ, deltaYaw, xrFrame) {
  if (typeof XRRigidTransform === 'undefined') return false;
  if (!xrFrame) return false;

  const currentRef = xrState.currentReferenceSpace || renderer.xr.getReferenceSpace();
  if (!currentRef) return false;

  const pose = xrFrame.getViewerPose(currentRef);
  if (!pose || !pose.transform || !pose.transform.position) return false;

  let nextRef = currentRef;

  if (Math.abs(deltaYaw) > 1e-6) {
    const px = Number(pose.transform.position.x || 0);
    const pz = Number(pose.transform.position.z || 0);
    const toPivot = makeReferenceSpaceTranslation(-px, 0, -pz);
    xrTmpQuat.setFromAxisAngle(worldUp, Number(deltaYaw || 0));
    const yawTurn = new XRRigidTransform(
      { x: 0, y: 0, z: 0 },
      { x: xrTmpQuat.x, y: xrTmpQuat.y, z: xrTmpQuat.z, w: xrTmpQuat.w },
    );
    const fromPivot = makeReferenceSpaceTranslation(px, 0, pz);
    nextRef = nextRef.getOffsetReferenceSpace(toPivot);
    nextRef = nextRef.getOffsetReferenceSpace(yawTurn);
    nextRef = nextRef.getOffsetReferenceSpace(fromPivot);
  }

  if (Math.abs(deltaX) > 1e-6 || Math.abs(deltaY) > 1e-6 || Math.abs(deltaZ) > 1e-6) {
    const moveStep = makeReferenceSpaceTranslation(deltaX, deltaY, deltaZ);
    nextRef = nextRef.getOffsetReferenceSpace(moveStep);
  }

  xrState.currentReferenceSpace = nextRef;
  renderer.xr.setReferenceSpace(nextRef);
  return true;
}

function applyDeadzone(value, deadZone) {
  return Math.abs(value) < deadZone ? 0 : value;
}

function updateXrControls(dt, xrFrame) {
  if (!ENABLE_VR_CONTROLS || !renderer.xr.isPresenting || !xrState.active) return false;
  const session = renderer.xr.getSession();
  if (!session) return false;
  const xrCam = renderer.xr.getCamera(camera);

  let moveX = 0;
  let moveY = 0;
  let turnX = 0;
  let rise = 0;
  let boost = false;

  for (const inputSource of session.inputSources) {
    const gamepad = inputSource && inputSource.gamepad;
    if (!gamepad) continue;
    const [sx, sy] = readThumbstickAxes(gamepad);

    if (inputSource.handedness === 'left') {
      moveX += sx;
      moveY += sy;
      boost = boost || Boolean(gamepad.buttons && gamepad.buttons[1] && gamepad.buttons[1].pressed);
      if (gamepad.buttons && gamepad.buttons[4] && gamepad.buttons[4].pressed) rise += 1;
      if (gamepad.buttons && gamepad.buttons[5] && gamepad.buttons[5].pressed) rise -= 1;
    } else if (inputSource.handedness === 'right') {
      turnX += sx;
      if (gamepad.buttons && gamepad.buttons[4] && gamepad.buttons[4].pressed) rise += 1;
      if (gamepad.buttons && gamepad.buttons[5] && gamepad.buttons[5].pressed) rise -= 1;
    }
  }

  moveX = applyDeadzone(moveX, xrState.deadZone);
  moveY = applyDeadzone(moveY, xrState.deadZone);
  turnX = applyDeadzone(turnX, xrState.deadZone);

  const nowSec = performance.now() * 0.001;
  let deltaYaw = 0;
  if (Math.abs(turnX) >= xrState.snapTurnThreshold && nowSec >= xrState.nextSnapTurnAtSec) {
    deltaYaw = Math.sign(turnX) * xrState.snapTurnStep;
    xrState.nextSnapTurnAtSec = nowSec + xrState.snapTurnCooldownSec;
  }
  let didMove = false;
  let moveDx = 0;
  let moveDy = 0;
  let moveDz = 0;

  if (Math.abs(moveX) > 0 || Math.abs(moveY) > 0 || rise !== 0) {
    // Head-relative movement in current XR reference space.
    const currentRef = xrState.currentReferenceSpace || renderer.xr.getReferenceSpace();
    const pose = currentRef && xrFrame ? xrFrame.getViewerPose(currentRef) : null;
    if (pose && pose.transform && pose.transform.orientation) {
      const q = pose.transform.orientation;
      xrTmpHeadQuat.set(Number(q.x || 0), Number(q.y || 0), Number(q.z || 0), Number(q.w || 1));
      xrTmpForward.set(0, 0, -1).applyQuaternion(xrTmpHeadQuat);
    } else {
      xrCam.getWorldDirection(xrTmpForward);
    }
    xrTmpForward.y = 0;
    if (xrTmpForward.lengthSq() < 1e-6) {
      xrTmpForward.set(0, 0, -1);
    }
    xrTmpForward.normalize();
    xrTmpRight.crossVectors(worldUp, xrTmpForward).normalize();

    const speed = xrState.moveSpeed * (boost ? xrState.boostMultiplier : 1);
    moveDx += xrTmpForward.x * ((-moveY) * speed * dt);
    moveDz += xrTmpForward.z * ((-moveY) * speed * dt);
    moveDx += xrTmpRight.x * ((-moveX) * speed * dt);
    moveDz += xrTmpRight.z * ((-moveX) * speed * dt);
    moveDy += rise * speed * dt;
  }

  if (Math.abs(moveDx) > 0 || Math.abs(moveDy) > 0 || Math.abs(moveDz) > 0 || Math.abs(deltaYaw) > 0) {
    const nextX = THREE.MathUtils.clamp(xrState.offsetPosition.x + moveDx, moveBounds.minX, moveBounds.maxX);
    const nextY = THREE.MathUtils.clamp(xrState.offsetPosition.y + moveDy, xrState.minY, xrState.maxY);
    const nextZ = THREE.MathUtils.clamp(xrState.offsetPosition.z + moveDz, moveBounds.minZ, moveBounds.maxZ);
    const clampedDx = nextX - xrState.offsetPosition.x;
    const clampedDy = nextY - xrState.offsetPosition.y;
    const clampedDz = nextZ - xrState.offsetPosition.z;

    xrState.offsetPosition.set(nextX, nextY, nextZ);
    didMove = applyIncrementalXrTransform(clampedDx, clampedDy, clampedDz, deltaYaw, xrFrame);
  }

  xrCam.getWorldPosition(xrTmpWorldPos);
  actor.position.copy(xrTmpWorldPos);
  xrCam.getWorldDirection(tmpLookForward);
  actor.rotation.y = Math.atan2(tmpLookForward.x, tmpLookForward.z);

  return didMove;
}

function loadSceneAssetEnvironment() {
  if (!USE_SCENE_ASSET) return;
  const onLoaded = (gltf) => {
    if (worldSceneRoot) {
      scene.remove(worldSceneRoot);
    }
    if (mapGridOverlayGroup) {
      scene.remove(mapGridOverlayGroup);
      mapGridOverlayGroup = null;
    }

    const root = gltf.scene || (Array.isArray(gltf.scenes) ? gltf.scenes[0] : null);
    if (!root) return;

    tuneSceneAssetMaterials(root);
    const layout = recenterSceneAsset(root);
    scene.add(root);
    worldSceneRoot = root;
    buildVrLodIndex(root);
    buildMapGridOverlay(root);

    if (layout && layout.size && layout.box) {
      const boxSize = layout.box.getSize(new THREE.Vector3());
      const halfX = Math.max(boxSize.x * 0.52, 8);
      const halfZ = Math.max(boxSize.z * 0.52, 8);
      moveBounds.minX = -halfX;
      moveBounds.maxX = halfX;
      moveBounds.minZ = -halfZ;
      moveBounds.maxZ = halfZ;
      const spawnX = SPAWN_POSITION[0];
      const spawnY = SPAWN_POSITION[1];
      const spawnZ = SPAWN_POSITION[2];
      actor.position.set(spawnX, spawnY, spawnZ);
      if (!renderer.xr.isPresenting) {
        camera.position.set(spawnX, spawnY + 2.6, spawnZ + 6.4);
        camera.lookAt(spawnX, spawnY + 1.0, spawnZ);
      }
      orbitDistance = THREE.MathUtils.clamp(Math.max(boxSize.x, boxSize.y, boxSize.z) * 0.14, 5.2, 10.5);
    }
  };

  const tryLoadAt = (index, previousError = null) => {
    if (index >= SCENE_ASSET_CANDIDATE_URLS.length) {
      console.warn('[SOCIAL ROOM] Failed to load scene asset after fallbacks:', SCENE_ASSET_CANDIDATE_URLS, previousError);
      return;
    }

    const url = SCENE_ASSET_CANDIDATE_URLS[index];
    worldSceneLoader.load(
      url,
      onLoaded,
      undefined,
      (error) => {
        console.warn('[SOCIAL ROOM] Failed scene asset candidate:', url, error);
        tryLoadAt(index + 1, error);
      }
    );
  };

  tryLoadAt(0);
}

loadSceneAssetEnvironment();

if (USE_SCENE_ASSET && !FORCE_SPHERE_AVATARS) {
  actor.visible = false;
  fallbackAvatar.visible = false;
  if (actor.parent) {
    actor.parent.remove(actor);
  }
}

function setMoveState(code, value) {
  if (code === 'KeyW' || code === 'ArrowUp') moveState.forward = value;
  if (code === 'KeyS' || code === 'ArrowDown') moveState.back = value;
  if (code === 'KeyA' || code === 'ArrowLeft') moveState.right = value;
  if (code === 'KeyD' || code === 'ArrowRight') moveState.left = value;
  if (code === 'KeyQ' || code === 'Space' || code === 'PageUp') moveState.up = value;
  if (code === 'KeyE' || code === 'ControlLeft' || code === 'ControlRight' || code === 'PageDown') moveState.down = value;
  if (code === 'ShiftLeft' || code === 'ShiftRight') moveState.boost = value;
}

function initMobileControls() {
  const controlsEl = document.getElementById('mobile-controls');
  const lookPadEl = document.getElementById('mobile-lookpad');
  if (!controlsEl || !lookPadEl) return;

  const coarsePointer = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  const touchCapable = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  if (!coarsePointer && !touchCapable) return;

  const activeButtons = new Map();
  const resetAllMobileInputs = () => {
    for (const [pointerId, info] of activeButtons.entries()) {
      setMoveState(info.code, false);
      if (info.element) info.element.classList.remove('active');
      activeButtons.delete(pointerId);
    }
  };

  const bindMoveButton = (buttonEl) => {
    if (!buttonEl) return;
    const code = String(buttonEl.dataset.moveCode || '').trim();
    if (!code) return;

    const press = (event) => {
      event.preventDefault();
      buttonEl.setPointerCapture(event.pointerId);
      activeButtons.set(event.pointerId, { code, element: buttonEl });
      buttonEl.classList.add('active');
      setMoveState(code, true);
    };

    const release = (event) => {
      const current = activeButtons.get(event.pointerId);
      if (!current) return;
      setMoveState(current.code, false);
      if (current.element) current.element.classList.remove('active');
      activeButtons.delete(event.pointerId);
    };

    buttonEl.addEventListener('pointerdown', press);
    buttonEl.addEventListener('pointerup', release);
    buttonEl.addEventListener('pointercancel', release);
    buttonEl.addEventListener('lostpointercapture', release);
  };

  controlsEl.querySelectorAll('[data-move-code]').forEach((buttonEl) => bindMoveButton(buttonEl));

  let lookPointerId = null;
  let lookLastX = 0;
  let lookLastY = 0;

  const releaseLook = (event) => {
    if (event.pointerId !== lookPointerId) return;
    lookPointerId = null;
  };

  lookPadEl.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    lookPointerId = event.pointerId;
    lookLastX = event.clientX;
    lookLastY = event.clientY;
    lookPadEl.setPointerCapture(event.pointerId);
  });

  lookPadEl.addEventListener('pointermove', (event) => {
    if (event.pointerId !== lookPointerId) return;
    event.preventDefault();
    const dx = event.clientX - lookLastX;
    const dy = event.clientY - lookLastY;
    lookLastX = event.clientX;
    lookLastY = event.clientY;
    orbitYaw -= dx * (lookSensitivity * 1.15);
    orbitPitch = THREE.MathUtils.clamp(
      orbitPitch - dy * (lookSensitivity * 1.15),
      -verticalLookLimit,
      verticalLookLimit,
    );
  });

  lookPadEl.addEventListener('pointerup', releaseLook);
  lookPadEl.addEventListener('pointercancel', releaseLook);
  lookPadEl.addEventListener('lostpointercapture', releaseLook);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      resetAllMobileInputs();
      lookPointerId = null;
    }
  });
}

initMobileControls();

renderer.domElement.addEventListener('click', () => {
  if (!pointerLocked) renderer.domElement.requestPointerLock();
});

renderer.domElement.addEventListener('contextmenu', (event) => {
  // Reserve right-click for mouse-look drag in fly mode.
  event.preventDefault();
});

document.addEventListener('pointerlockchange', () => {
  pointerLocked = document.pointerLockElement === renderer.domElement;
});

let mouseLookDragging = false;
let mouseLookLastX = 0;
let mouseLookLastY = 0;

renderer.domElement.addEventListener('mousedown', (event) => {
  if (event.button !== 0 && event.button !== 2) return;
  mouseLookDragging = true;
  mouseLookLastX = event.clientX;
  mouseLookLastY = event.clientY;
});

window.addEventListener('mouseup', (event) => {
  if (event.button !== 0 && event.button !== 2) return;
  mouseLookDragging = false;
});

window.addEventListener('blur', () => {
  mouseLookDragging = false;
});

document.addEventListener('mousemove', (event) => {
  if (pointerLocked) {
    orbitYaw -= event.movementX * lookSensitivity;
    orbitPitch = THREE.MathUtils.clamp(orbitPitch - event.movementY * lookSensitivity, -verticalLookLimit, verticalLookLimit);
    return;
  }

  if (!mouseLookDragging) return;
  const dx = event.clientX - mouseLookLastX;
  const dy = event.clientY - mouseLookLastY;
  mouseLookLastX = event.clientX;
  mouseLookLastY = event.clientY;

  orbitYaw -= dx * lookSensitivity;
  orbitPitch = THREE.MathUtils.clamp(orbitPitch - dy * lookSensitivity, -verticalLookLimit, verticalLookLimit);
});

renderer.domElement.addEventListener('wheel', (event) => {
  event.preventDefault();

  if (USE_SCENE_ASSET && !FORCE_SPHERE_AVATARS) {
    const nextFov = THREE.MathUtils.clamp(camera.fov + event.deltaY * 0.02, 24, 90);
    if (Math.abs(nextFov - camera.fov) > 1e-6) {
      camera.fov = nextFov;
      camera.updateProjectionMatrix();
    }
    return;
  }

  const zoomFactor = Math.exp(event.deltaY * 0.0015);
  orbitDistance *= zoomFactor;
  orbitDistance = Math.max(0.65, orbitDistance);
}, { passive: false });

document.addEventListener('keydown', (event) => {
  const tag = document.activeElement ? document.activeElement.tagName : '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

  if (
    event.code === 'KeyW' || event.code === 'KeyA' || event.code === 'KeyS' || event.code === 'KeyD'
    || event.code === 'ArrowUp' || event.code === 'ArrowLeft' || event.code === 'ArrowDown' || event.code === 'ArrowRight'
    || event.code === 'KeyQ' || event.code === 'KeyE' || event.code === 'Space'
    || event.code === 'ControlLeft' || event.code === 'ControlRight' || event.code === 'PageUp' || event.code === 'PageDown'
    || event.code === 'ShiftLeft' || event.code === 'ShiftRight'
  ) {
    event.preventDefault();
  }
  setMoveState(event.code, true);
});

document.addEventListener('keyup', (event) => {
  if (
    event.code === 'KeyW' || event.code === 'KeyA' || event.code === 'KeyS' || event.code === 'KeyD'
    || event.code === 'ArrowUp' || event.code === 'ArrowLeft' || event.code === 'ArrowDown' || event.code === 'ArrowRight'
    || event.code === 'KeyQ' || event.code === 'KeyE' || event.code === 'Space'
    || event.code === 'ControlLeft' || event.code === 'ControlRight' || event.code === 'PageUp' || event.code === 'PageDown'
    || event.code === 'ShiftLeft' || event.code === 'ShiftRight'
  ) {
    event.preventDefault();
  }
  setMoveState(event.code, false);
});

const clock = new THREE.Clock();

function switchCustomAction(nextAction, fadeSeconds = 0.18) {
  if (!nextAction || nextAction === activeCustomAction) return;
  if (activeCustomAction) {
    activeCustomAction.fadeOut(fadeSeconds);
  }
  nextAction.reset().fadeIn(fadeSeconds).play();
  activeCustomAction = nextAction;
}

function updatePlayerMovement(dt) {
  if (ENABLE_VR_CONTROLS && renderer.xr.isPresenting) {
    return false;
  }

  if (USE_SCENE_ASSET && !FORCE_SPHERE_AVATARS) {
    tmpLookForward.set(
      Math.sin(orbitYaw) * Math.cos(orbitPitch),
      Math.sin(orbitPitch),
      Math.cos(orbitYaw) * Math.cos(orbitPitch),
    ).normalize();

    tmpFlatForward.set(tmpLookForward.x, 0, tmpLookForward.z);
    if (tmpFlatForward.lengthSq() < 1e-6) {
      tmpFlatForward.set(Math.sin(orbitYaw), 0, Math.cos(orbitYaw));
    }
    tmpFlatForward.normalize();
    tmpRight.crossVectors(worldUp, tmpFlatForward).normalize();
    tmpVertical.copy(worldUp);

    tmpMove.set(0, 0, 0);
    if (moveState.forward) tmpMove.add(tmpLookForward);
    if (moveState.back) tmpMove.sub(tmpLookForward);
    if (moveState.right) tmpMove.add(tmpRight);
    if (moveState.left) tmpMove.sub(tmpRight);
    if (moveState.up) tmpMove.add(tmpVertical);
    if (moveState.down) tmpMove.sub(tmpVertical);

    let isMoving = false;
    if (tmpMove.lengthSq() > 0) {
      tmpMove.normalize();
      const speed = moveSpeed * (moveState.boost ? boostMultiplier : 1);
      camera.position.addScaledVector(tmpMove, speed * dt);
      camera.position.x = THREE.MathUtils.clamp(camera.position.x, moveBounds.minX, moveBounds.maxX);
      camera.position.z = THREE.MathUtils.clamp(camera.position.z, moveBounds.minZ, moveBounds.maxZ);
      camera.position.y = THREE.MathUtils.clamp(camera.position.y, 0.5, 250);
      isMoving = true;
    }

    actor.position.copy(camera.position);
    actor.rotation.y = orbitYaw;
    return isMoving;
  }

  tmpTarget.copy(actor.position).add(new THREE.Vector3(0, 1.05, 0));

  const cameraForward = new THREE.Vector3(
    Math.sin(orbitYaw),
    0,
    Math.cos(orbitYaw)
  ).normalize();

  tmpForward.copy(cameraForward);
  tmpRight.crossVectors(worldUp, tmpForward).normalize();

  tmpMove.set(0, 0, 0);
  if (moveState.forward) tmpMove.add(tmpForward);
  if (moveState.back) tmpMove.sub(tmpForward);
  if (moveState.right) tmpMove.add(tmpRight);
  if (moveState.left) tmpMove.sub(tmpRight);
  if (moveState.up) tmpMove.y += 1;
  if (moveState.down) tmpMove.y -= 1;

  let isMoving = false;
  if (tmpMove.lengthSq() > 0) {
    tmpMove.normalize();
    const speed = moveSpeed * (moveState.boost ? boostMultiplier : 1);
    actor.position.addScaledVector(tmpMove, speed * dt);
    isMoving = true;

    actor.position.x = THREE.MathUtils.clamp(actor.position.x, moveBounds.minX, moveBounds.maxX);
    actor.position.z = THREE.MathUtils.clamp(actor.position.z, moveBounds.minZ, moveBounds.maxZ);
    actor.position.y = THREE.MathUtils.clamp(actor.position.y, 0.5, 250);

    actor.rotation.y = Math.atan2(tmpMove.x, tmpMove.z);
  }
  return isMoving;
}

function updateAvatarAnimation(dt, elapsed, isMoving) {
  if (USE_SCENE_ASSET && !FORCE_SPHERE_AVATARS) return;

  if (FORCE_SPHERE_AVATARS) {
    const idleBreath = Math.sin(elapsed * 2.1);
    fallbackAvatar.position.y = isMoving ? 0 : idleBreath * 0.02;
    return;
  }

  if (customMixerUsable && avatarMixer && (customIdleAction || customWalkAction)) {
    if (isMoving && customWalkAction) {
      switchCustomAction(customWalkAction);
    } else if (!isMoving && customIdleAction) {
      switchCustomAction(customIdleAction);
    }
    avatarMixer.update(dt);
    return;
  }

  if (customAvatarRoot && importedRigAnimator.active) {
    applyImportedRigFallbackAnimation(elapsed, isMoving);
    return;
  }

  const walkPhase = elapsed * (moveState.boost ? 9.5 : 6.2);
  const stride = Math.sin(walkPhase);
  const antiStride = Math.sin(walkPhase + Math.PI);
  const idleBreath = Math.sin(elapsed * 2.1);

  fallbackAvatar.position.y = isMoving ? 0 : idleBreath * 0.02;

  if (isMoving) {
    leftArm.rotation.x = antiStride * 0.55;
    rightArm.rotation.x = stride * 0.55;
    leftLeg.rotation.x = stride * 0.7;
    rightLeg.rotation.x = antiStride * 0.7;
    torso.rotation.y = Math.sin(walkPhase * 0.5) * 0.05;
    head.rotation.y = Math.sin(walkPhase * 0.45) * 0.04;
  } else {
    leftArm.rotation.x = Math.sin(elapsed * 1.3) * 0.04;
    rightArm.rotation.x = Math.sin(elapsed * 1.3 + 0.9) * 0.04;
    leftLeg.rotation.x = 0;
    rightLeg.rotation.x = 0;
    torso.rotation.y = Math.sin(elapsed * 0.8) * 0.02;
    head.rotation.y = Math.sin(elapsed * 0.65) * 0.03;
  }
}

function updateCamera(dt) {
  if (ENABLE_VR_CONTROLS && renderer.xr.isPresenting) {
    return;
  }

  if (USE_SCENE_ASSET && !FORCE_SPHERE_AVATARS) {
    tmpTarget.copy(camera.position).add(tmpLookForward.set(
      Math.sin(orbitYaw) * Math.cos(orbitPitch),
      Math.sin(orbitPitch),
      Math.cos(orbitYaw) * Math.cos(orbitPitch),
    ));
    camera.lookAt(tmpTarget);
    return;
  }

  const horizontal = Math.cos(orbitPitch) * orbitDistance;

  tmpDesiredCam.set(
    actor.position.x + Math.sin(orbitYaw + Math.PI) * horizontal,
    actor.position.y + 2.15 + Math.sin(orbitPitch) * orbitDistance,
    actor.position.z + Math.cos(orbitYaw + Math.PI) * horizontal,
  );

  const lerpAlpha = 1 - Math.exp(-8.0 * dt);
  camera.position.lerp(tmpDesiredCam, lerpAlpha);

  tmpTarget.set(actor.position.x, actor.position.y + 1.08, actor.position.z);
  camera.lookAt(tmpTarget);
}

function animateFrame(_time, xrFrame) {
  const dt = Math.min(clock.getDelta(), 0.05);
  const elapsed = clock.elapsedTime;

  updateVrLodVisibility(elapsed);

  if (fireGlow && flameCore && flameOuter) {
    fireGlow.intensity = 2.65 + Math.sin(elapsed * 6.8) * 0.34 + Math.sin(elapsed * 10.4) * 0.2;
    flameCore.scale.set(1 + Math.sin(elapsed * 8.1) * 0.07, 1 + Math.sin(elapsed * 10.5 + 0.4) * 0.12, 1 + Math.sin(elapsed * 6.3) * 0.06);
    flameOuter.scale.set(1 + Math.sin(elapsed * 6.7 + 0.6) * 0.09, 1 + Math.sin(elapsed * 9.7) * 0.14, 1 + Math.sin(elapsed * 5.7) * 0.07);
  }

  // Orb pulse
  if (orbMesh) {
    const pulse = 1 + Math.sin(elapsed * 2.3) * 0.06 + Math.sin(elapsed * 5.1) * 0.03;
    orbMesh.scale.setScalar(pulse);
    orbMesh.rotation.y = elapsed * 0.7;
  }

  // Animate floating dust particles
  if (dustPoints && dustVelocities && dustOrigins) {
    const pos = dustPoints.geometry.attributes.position.array;
    const RANGE = 14;
    const HEIGHT_MIN = 0.2;
    const HEIGHT_MAX = 6.0;
    for (let i = 0; i < DUST_COUNT; i++) {
      const i3 = i * 3;
      // Drift + gentle sine wobble
      pos[i3]     += dustVelocities[i3]     + Math.sin(elapsed * 0.4 + i * 0.7) * 0.0012;
      pos[i3 + 1] += dustVelocities[i3 + 1] + Math.sin(elapsed * 0.6 + i * 1.1) * 0.0008;
      pos[i3 + 2] += dustVelocities[i3 + 2] + Math.cos(elapsed * 0.5 + i * 0.9) * 0.0012;
      // Wrap within bounds
      if (pos[i3]     >  RANGE) pos[i3]     = -RANGE;
      if (pos[i3]     < -RANGE) pos[i3]     =  RANGE;
      if (pos[i3 + 2] >  RANGE) pos[i3 + 2] = -RANGE;
      if (pos[i3 + 2] < -RANGE) pos[i3 + 2] =  RANGE;
      if (pos[i3 + 1] > HEIGHT_MAX) pos[i3 + 1] = HEIGHT_MIN;
      if (pos[i3 + 1] < HEIGHT_MIN) pos[i3 + 1] = HEIGHT_MAX;
    }
    dustPoints.geometry.attributes.position.needsUpdate = true;
  }

  const xrIsMoving = updateXrControls(dt, xrFrame);
  const isMoving = xrIsMoving || updatePlayerMovement(dt);
  updateAvatarAnimation(dt, elapsed, isMoving);
  updateCamera(dt);
  updateHoveredMapSpaceFromCrosshair();

  const nowMs = performance.now();
  if (nowMs >= netState.publishAtMs) {
    publishLocalPresence(false);
    netState.publishAtMs = nowMs + (isMoving ? 90 : 300);
  }

  renderer.render(scene, camera);
  _drawCompass();
}

renderer.setAnimationLoop(animateFrame);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

window.addEventListener('beforeunload', () => {
  teardownVoiceCapture();
});
