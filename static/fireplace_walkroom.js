import * as THREE from '/static/three.module.js';
import { GLTFLoader } from '/static/GLTFLoader.js';

const SELECTED_CHARACTER_STORAGE_KEY = 'paraval_selected_character';
const SELECTED_MODEL_STORAGE_KEY = 'paraval_selected_model_url';
const DISPLAY_NAME_STORAGE_KEY = 'paraval_social_display_name';
const SOCIAL_ROOM_CONFIG = window.__SOCIAL_ROOM_CONFIG__ && typeof window.__SOCIAL_ROOM_CONFIG__ === 'object'
  ? window.__SOCIAL_ROOM_CONFIG__
  : {};
const SCENE_ASSET_URL = String(SOCIAL_ROOM_CONFIG.sceneAssetUrl || '').trim();
const IS_MAP3D_ROUTE = /^\/map3d\/?$/i.test(String(window.location.pathname || '').trim());
const RESOLVED_SCENE_ASSET_URL = SCENE_ASSET_URL || (IS_MAP3D_ROUTE ? '/static/everything_.gltf' : '');
const ROOM_TITLE = String(SOCIAL_ROOM_CONFIG.roomTitle || 'Social Room').trim() || 'Social Room';
const USE_SCENE_ASSET = Boolean(RESOLVED_SCENE_ASSET_URL);

const hudPlayerEl = document.getElementById('hud-player');
const nameGateEl = document.getElementById('name-gate');
const displayNameInputEl = document.getElementById('display-name-input');
const displayNameSubmitEl = document.getElementById('display-name-submit');
const displayNameErrorEl = document.getElementById('display-name-error');
const socialTitleEl = document.querySelector('.social-title');
const socialPlayersEl = document.getElementById('social-players');
const socialChatLogEl = document.getElementById('social-chat-log');
const socialChatInputEl = document.getElementById('social-chat-input');
const socialChatSendEl = document.getElementById('social-chat-send');
const voiceToggleEl = document.getElementById('voice-toggle');
const voiceStateEl = document.getElementById('voice-state');
let coordHudEl = document.getElementById('coord-hud');
const tmpCameraWorldPosition = new THREE.Vector3();

function ensureCoordinateHudElement() {
  if (coordHudEl) return coordHudEl;
  const el = document.createElement('div');
  el.id = 'coord-hud';
  el.setAttribute('aria-live', 'polite');
  el.style.position = 'fixed';
  el.style.top = '14px';
  el.style.right = '14px';
  el.style.zIndex = '50';
  el.style.border = '1px solid rgba(170, 192, 255, 0.45)';
  el.style.borderRadius = '8px';
  el.style.background = 'rgba(10, 14, 25, 0.78)';
  el.style.color = '#dfe9ff';
  el.style.fontSize = '11px';
  el.style.letterSpacing = '0.04em';
  el.style.padding = '7px 9px';
  el.style.minWidth = '160px';
  el.style.textAlign = 'right';
  el.style.backdropFilter = 'blur(4px)';
  el.style.whiteSpace = 'pre';
  el.style.pointerEvents = 'none';
  el.textContent = 'X: 0.00\nY: 0.00\nZ: 0.00';
  document.body.appendChild(el);
  coordHudEl = el;
  return coordHudEl;
}

document.title = `Paraval ${ROOM_TITLE}`;
if (socialTitleEl) socialTitleEl.textContent = ROOM_TITLE;

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
    if (voiceState.unavailableReason && !voiceState.enabled) {
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
    if (voiceState.unavailableReason && !voiceState.enabled) voiceStateEl.textContent = 'Unavailable';
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

function updateCoordinateHud() {
  ensureCoordinateHudElement();
  if (!coordHudEl) return;
  camera.updateMatrixWorld(true);
  let source = camera.getWorldPosition(tmpCameraWorldPosition);
  if (!Number.isFinite(source.x) || !Number.isFinite(source.y) || !Number.isFinite(source.z)) {
    source = camera.position;
  }

  const x = Number.isFinite(source.x) ? source.x.toFixed(2) : '0.00';
  const y = Number.isFinite(source.y) ? source.y.toFixed(2) : '0.00';
  const z = Number.isFinite(source.z) ? source.z.toFixed(2) : '0.00';
  coordHudEl.textContent = `X: ${x}\nY: ${y}\nZ: ${z}`;
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
skyboxTextureLoader.load(
  '/static/skybox_night.jpg',
  (texture) => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.mapping = THREE.EquirectangularReflectionMapping;
    scene.background = texture;
  },
  undefined,
  () => {
    // Keep color fallback if skybox fails to load.
  }
);

const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 5000);
camera.position.set(0, 2.6, 6.4);
updateCoordinateHud();

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio || 1);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = USE_SCENE_ASSET ? 1.34 : 1.24;
document.body.appendChild(renderer.domElement);

const hemi = new THREE.HemisphereLight(
  USE_SCENE_ASSET ? 0xddefff : 0x6f84ad,
  USE_SCENE_ASSET ? 0x44505f : 0x241d17,
  USE_SCENE_ASSET ? 1.35 : 0.68,
);
scene.add(hemi);

const key = new THREE.DirectionalLight(USE_SCENE_ASSET ? 0xfff4d6 : 0xa3b7dd, USE_SCENE_ASSET ? 2.1 : 0.86);
key.position.set(...(USE_SCENE_ASSET ? [10, 18, 12] : [-3.4, 4.4, 2.8]));
scene.add(key);

const fill = new THREE.DirectionalLight(0xbfd6ff, USE_SCENE_ASSET ? 1.15 : 0.25);
fill.position.set(...(USE_SCENE_ASSET ? [-12, 10, -10] : [3.6, 2.4, -2.6]));
scene.add(fill);

const worldSceneLoader = new GLTFLoader();
let worldSceneRoot = null;

let fireGlow = null;
let flameCore = null;
let flameOuter = null;

function tuneSceneAssetMaterials(root) {
  if (!root) return;
  root.traverse((child) => {
    if (!child || !child.isMesh || !child.material) return;
    child.castShadow = false;
    child.receiveShadow = false;
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
actor.position.set(0, 0, USE_SCENE_ASSET ? 0 : 2.1);
if (!USE_SCENE_ASSET) {
  scene.add(actor);
}

const remoteActorsLayer = new THREE.Group();
scene.add(remoteActorsLayer);

const fallbackBodyMat = new THREE.MeshStandardMaterial({ color: 0x7f6bff, roughness: 0.62, metalness: 0.08, emissive: 0x121425 });
const fallbackSkinMat = new THREE.MeshStandardMaterial({ color: 0xe8ccb2, roughness: 0.72, metalness: 0.01 });
const fallbackClothMat = new THREE.MeshStandardMaterial({ color: 0x2b304d, roughness: 0.9, metalness: 0.02 });

const fallbackAvatar = new THREE.Group();
if (!USE_SCENE_ASSET) {
  actor.add(fallbackAvatar);
}

const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.56, 6, 12), fallbackBodyMat);
torso.position.y = 1.03;
fallbackAvatar.add(torso);

const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 24, 20), fallbackSkinMat);
head.position.y = 1.59;
fallbackAvatar.add(head);

const cloak = new THREE.Mesh(new THREE.ConeGeometry(0.43, 1.05, 14), fallbackClothMat);
cloak.position.y = 0.64;
fallbackAvatar.add(cloak);

const leftArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.4, 4, 8), fallbackSkinMat);
leftArm.position.set(-0.34, 1.03, 0.02);
leftArm.rotation.z = Math.PI / 10;
fallbackAvatar.add(leftArm);

const rightArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.4, 4, 8), fallbackSkinMat);
rightArm.position.set(0.34, 1.03, 0.02);
rightArm.rotation.z = -Math.PI / 10;
fallbackAvatar.add(rightArm);

const leftLeg = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.72, 4, 8), fallbackBodyMat);
leftLeg.position.set(-0.14, 0.4, 0.02);
fallbackAvatar.add(leftLeg);

const rightLeg = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.72, 4, 8), fallbackBodyMat);
rightLeg.position.set(0.14, 0.4, 0.02);
fallbackAvatar.add(rightLeg);

const boots = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.08, 0.3), new THREE.MeshStandardMaterial({ color: 0x1a1520, roughness: 0.86, metalness: 0.03 }));
boots.position.set(0, 0.06, 0.07);
fallbackAvatar.add(boots);

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
  if (USE_SCENE_ASSET) return;
  let rec = netState.remoteVisuals.get(sid);
  if (!rec) {
    const root = new THREE.Group();
    const fallbackRoot = buildProceduralAvatar(String(entry?.side || '').toLowerCase() === 'villains' ? '#dd7f7f' : '#7f8fff');
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
  if (USE_SCENE_ASSET) {
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
  const localPosition = USE_SCENE_ASSET ? camera.position : actor.position;
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
  if (USE_SCENE_ASSET) return;
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

const moveSpeed = USE_SCENE_ASSET ? 8.5 : 3.4;
const boostMultiplier = USE_SCENE_ASSET ? 2.8 : 2.2;
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

function loadSceneAssetEnvironment() {
  if (!USE_SCENE_ASSET) return;
  worldSceneLoader.load(
    RESOLVED_SCENE_ASSET_URL,
    (gltf) => {
      if (worldSceneRoot) {
        scene.remove(worldSceneRoot);
      }

      const root = gltf.scene || (Array.isArray(gltf.scenes) ? gltf.scenes[0] : null);
      if (!root) return;

      tuneSceneAssetMaterials(root);
      const layout = recenterSceneAsset(root);
      scene.add(root);
      worldSceneRoot = root;

      if (layout && layout.size && layout.box) {
        const boxSize = layout.box.getSize(new THREE.Vector3());
        const halfX = Math.max(boxSize.x * 0.52, 8);
        const halfZ = Math.max(boxSize.z * 0.52, 8);
        moveBounds.minX = -halfX;
        moveBounds.maxX = halfX;
        moveBounds.minZ = -halfZ;
        moveBounds.maxZ = halfZ;
        frameSceneAsset(layout);
        actor.position.copy(camera.position);
        orbitDistance = THREE.MathUtils.clamp(Math.max(boxSize.x, boxSize.y, boxSize.z) * 0.14, 5.2, 10.5);
      }
    },
    undefined,
    (error) => {
      console.warn('[SOCIAL ROOM] Failed to load scene asset:', RESOLVED_SCENE_ASSET_URL, error);
    }
  );
}

loadSceneAssetEnvironment();

if (USE_SCENE_ASSET) {
  actor.visible = false;
  fallbackAvatar.visible = false;
  if (actor.parent) {
    actor.parent.remove(actor);
  }
}

function setMoveState(code, value) {
  if (code === 'KeyW') moveState.forward = value;
  if (code === 'KeyS') moveState.back = value;
  if (code === 'KeyA') moveState.left = value;
  if (code === 'KeyD') moveState.right = value;
  if (code === 'KeyQ') moveState.down = value;
  if (code === 'KeyE') moveState.up = value;
  if (code === 'ShiftLeft' || code === 'ShiftRight') moveState.boost = value;
}

renderer.domElement.addEventListener('click', () => {
  if (!pointerLocked) renderer.domElement.requestPointerLock();
});

document.addEventListener('pointerlockchange', () => {
  pointerLocked = document.pointerLockElement === renderer.domElement;
});

document.addEventListener('mousemove', (event) => {
  if (!pointerLocked) return;
  orbitYaw -= event.movementX * lookSensitivity;
  orbitPitch = THREE.MathUtils.clamp(orbitPitch - event.movementY * lookSensitivity, -verticalLookLimit, verticalLookLimit);
});

renderer.domElement.addEventListener('wheel', (event) => {
  if (USE_SCENE_ASSET) return;
  event.preventDefault();
  const zoomFactor = Math.exp(event.deltaY * 0.0015);
  orbitDistance *= zoomFactor;
  orbitDistance = Math.max(0.65, orbitDistance);
}, { passive: false });

document.addEventListener('keydown', (event) => {
  const tag = document.activeElement ? document.activeElement.tagName : '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

  if (event.code === 'KeyW' || event.code === 'KeyA' || event.code === 'KeyS' || event.code === 'KeyD' || event.code === 'KeyQ' || event.code === 'KeyE' || event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
    event.preventDefault();
  }
  setMoveState(event.code, true);
});

document.addEventListener('keyup', (event) => {
  if (event.code === 'KeyW' || event.code === 'KeyA' || event.code === 'KeyS' || event.code === 'KeyD' || event.code === 'KeyQ' || event.code === 'KeyE' || event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
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
  if (USE_SCENE_ASSET) {
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
    tmpRight.crossVectors(tmpFlatForward, worldUp).normalize();
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
  tmpRight.crossVectors(tmpForward, worldUp).normalize();

  tmpMove.set(0, 0, 0);
  if (moveState.forward) tmpMove.add(tmpForward);
  if (moveState.back) tmpMove.sub(tmpForward);
  if (moveState.right) tmpMove.add(tmpRight);
  if (moveState.left) tmpMove.sub(tmpRight);

  let isMoving = false;
  if (tmpMove.lengthSq() > 0) {
    tmpMove.normalize();
    const speed = moveSpeed * (moveState.boost ? boostMultiplier : 1);
    actor.position.addScaledVector(tmpMove, speed * dt);
    isMoving = true;

    actor.position.x = THREE.MathUtils.clamp(actor.position.x, moveBounds.minX, moveBounds.maxX);
    actor.position.z = THREE.MathUtils.clamp(actor.position.z, moveBounds.minZ, moveBounds.maxZ);

    actor.rotation.y = Math.atan2(tmpMove.x, tmpMove.z);
  }
  return isMoving;
}

function updateAvatarAnimation(dt, elapsed, isMoving) {
  if (USE_SCENE_ASSET) return;
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
  if (USE_SCENE_ASSET) {
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

function animate() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const elapsed = clock.elapsedTime;

  if (fireGlow && flameCore && flameOuter) {
    fireGlow.intensity = 2.65 + Math.sin(elapsed * 6.8) * 0.34 + Math.sin(elapsed * 10.4) * 0.2;
    flameCore.scale.set(1 + Math.sin(elapsed * 8.1) * 0.07, 1 + Math.sin(elapsed * 10.5 + 0.4) * 0.12, 1 + Math.sin(elapsed * 6.3) * 0.06);
    flameOuter.scale.set(1 + Math.sin(elapsed * 6.7 + 0.6) * 0.09, 1 + Math.sin(elapsed * 9.7) * 0.14, 1 + Math.sin(elapsed * 5.7) * 0.07);
  }

  const isMoving = updatePlayerMovement(dt);
  updateAvatarAnimation(dt, elapsed, isMoving);
  updateCamera(dt);
  updateCoordinateHud();

  const nowMs = performance.now();
  if (nowMs >= netState.publishAtMs) {
    publishLocalPresence(false);
    netState.publishAtMs = nowMs + (isMoving ? 90 : 300);
  }

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

animate();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

window.addEventListener('beforeunload', () => {
  teardownVoiceCapture();
});
