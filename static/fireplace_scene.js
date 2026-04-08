import * as THREE from '/static/three.module.js';
import { GLTFLoader } from '/static/GLTFLoader.js';

let fireplaceMusicReady = false;
let fireplaceMusicStarted = false;
let fireplaceMusicPad = null;
let fireplaceMusicLowStrings = null;
let fireplaceMusicPulse = null;
let fireplaceMusicMaster = null;
let fireplaceMusicReverb = null;
let fireplaceMusicFilter = null;
let fireplaceMusicPadPart = null;
let fireplaceMusicLowPart = null;
let fireplaceMusicPulsePart = null;

async function ensureFireplaceMusicSetup() {
  if (fireplaceMusicReady) return true;
  if (!window.Tone) {
    console.warn('Tone.js is not available; fireplace music disabled.');
    return false;
  }

  const Tone = window.Tone;

  fireplaceMusicMaster = new Tone.Gain(0.62).toDestination();
  fireplaceMusicReverb = new Tone.Reverb({
    decay: 7.8,
    wet: 0.5,
    preDelay: 0.03,
  }).connect(fireplaceMusicMaster);
  fireplaceMusicFilter = new Tone.Filter({
    type: 'lowpass',
    frequency: 2100,
    rolloff: -24,
    Q: 0.4,
  }).connect(fireplaceMusicReverb);

  fireplaceMusicPad = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'fatsawtooth' },
    envelope: {
      attack: 0.55,
      decay: 1.8,
      sustain: 0.65,
      release: 2.8,
    },
  }).connect(fireplaceMusicFilter);
  fireplaceMusicPad.volume.value = -13;

  fireplaceMusicLowStrings = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'triangle' },
    envelope: {
      attack: 0.22,
      decay: 0.8,
      sustain: 0.58,
      release: 2.0,
    },
  }).connect(fireplaceMusicFilter);
  fireplaceMusicLowStrings.volume.value = -11;

  fireplaceMusicPulse = new Tone.Synth({
    oscillator: { type: 'square' },
    envelope: {
      attack: 0.02,
      decay: 0.25,
      sustain: 0.05,
      release: 0.45,
    },
  }).connect(fireplaceMusicFilter);
  fireplaceMusicPulse.volume.value = -22;

  fireplaceMusicPadPart = new Tone.Part((time, event) => {
    fireplaceMusicPad.triggerAttackRelease(event.notes, event.dur || '1m', time, event.vel ?? 0.52);
  }, [
    { time: '0:0:0', notes: ['A2', 'C3', 'E3'], dur: '2m', vel: 0.5 },
    { time: '2:0:0', notes: ['F2', 'A2', 'C3'], dur: '1m', vel: 0.48 },
    { time: '3:0:0', notes: ['E2', 'G#2', 'B2'], dur: '1m', vel: 0.5 },
    { time: '4:0:0', notes: ['D2', 'F2', 'A2'], dur: '2m', vel: 0.46 },
    { time: '6:0:0', notes: ['E2', 'G#2', 'B2'], dur: '1m', vel: 0.5 },
    { time: '7:0:0', notes: ['A2', 'C3', 'E3'], dur: '1m', vel: 0.54 },
  ]);
  fireplaceMusicPadPart.loop = true;
  fireplaceMusicPadPart.loopEnd = '8m';

  fireplaceMusicLowPart = new Tone.Part((time, event) => {
    fireplaceMusicLowStrings.triggerAttackRelease(event.notes, event.dur || '2m', time, event.vel ?? 0.5);
  }, [
    { time: '0:0:0', notes: ['A1', 'E2'], dur: '2m', vel: 0.52 },
    { time: '2:0:0', notes: ['F1', 'C2'], dur: '1m', vel: 0.5 },
    { time: '3:0:0', notes: ['E1', 'B1'], dur: '1m', vel: 0.54 },
    { time: '4:0:0', notes: ['D1', 'A1'], dur: '2m', vel: 0.48 },
    { time: '6:0:0', notes: ['E1', 'B1'], dur: '1m', vel: 0.54 },
    { time: '7:0:0', notes: ['A1', 'E2'], dur: '1m', vel: 0.56 },
  ]);
  fireplaceMusicLowPart.loop = true;
  fireplaceMusicLowPart.loopEnd = '8m';

  fireplaceMusicPulsePart = new Tone.Part((time, event) => {
    fireplaceMusicPulse.triggerAttackRelease(event.note, event.dur || '8n', time, event.vel ?? 0.4);
  }, [
    { time: '0:3:0', note: 'E4', dur: '8n', vel: 0.38 },
    { time: '1:3:2', note: 'D4', dur: '8n', vel: 0.36 },
    { time: '2:3:0', note: 'C4', dur: '8n', vel: 0.37 },
    { time: '3:3:2', note: 'B3', dur: '8n', vel: 0.37 },
    { time: '4:3:0', note: 'A3', dur: '8n', vel: 0.35 },
    { time: '5:3:2', note: 'B3', dur: '8n', vel: 0.36 },
    { time: '6:3:0', note: 'G#3', dur: '8n', vel: 0.38 },
    { time: '7:3:2', note: 'A3', dur: '8n', vel: 0.42 },
  ]);
  fireplaceMusicPulsePart.loop = true;
  fireplaceMusicPulsePart.loopEnd = '8m';

  Tone.Transport.bpm.value = 58;
  fireplaceMusicReady = true;
  return true;
}

async function startFireplaceMusic() {
  if (fireplaceMusicStarted) return;
  if (!window.Tone) return;
  const Tone = window.Tone;
  await Tone.start();

  const ok = await ensureFireplaceMusicSetup();
  if (!ok) return;

  if (Tone.Transport.state !== 'started') {
    Tone.Transport.stop();
    Tone.Transport.position = 0;
    fireplaceMusicPadPart.start(0);
    fireplaceMusicLowPart.start(0);
    fireplaceMusicPulsePart.start(0);
    Tone.Transport.start();
  }

  fireplaceMusicStarted = true;
}

function stopFireplaceMusic() {
  if (!window.Tone || !fireplaceMusicReady) return;
  const Tone = window.Tone;
  if (fireplaceMusicPadPart) fireplaceMusicPadPart.stop();
  if (fireplaceMusicLowPart) fireplaceMusicLowPart.stop();
  if (fireplaceMusicPulsePart) fireplaceMusicPulsePart.stop();
  Tone.Transport.stop();
  fireplaceMusicStarted = false;
}

function installFireplaceMusicStartHooks() {
  const activateMusic = async () => {
    document.removeEventListener('pointerdown', activateMusic);
    document.removeEventListener('keydown', activateMusic);
    try {
      await startFireplaceMusic();
    } catch (err) {
      console.warn('Unable to start fireplace music:', err);
    }
  };

  document.addEventListener('pointerdown', activateMusic, { once: true });
  document.addEventListener('keydown', activateMusic, { once: true });
}

installFireplaceMusicStartHooks();
window.addEventListener('beforeunload', stopFireplaceMusic);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07080f);
scene.fog = new THREE.Fog(0x07080f, 6, 24);

const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 2.2, 6.6);
camera.lookAt(0, 1.5, -3.2);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio || 1);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;
document.body.appendChild(renderer.domElement);

// Ambient base so the chamber is readable in darker areas.
const hemi = new THREE.HemisphereLight(0x596886, 0x201a18, 0.44);
scene.add(hemi);

const fill = new THREE.DirectionalLight(0x8ba0cf, 0.62);
fill.position.set(-2, 3, 2);
scene.add(fill);

const ceilingFill = new THREE.PointLight(0xffe8c9, 0.6, 18, 2);
ceilingFill.position.set(0, 4.8, -1.2);
scene.add(ceilingFill);

const fireLight = new THREE.PointLight(0xff8a2a, 3.35, 12.5, 2);
fireLight.position.set(0, 1.15, 0.65);
scene.add(fireLight);

const leftSconce = new THREE.PointLight(0xffd7a3, 0.8, 8.5, 2);
leftSconce.position.set(-4.2, 2.35, -2.2);
scene.add(leftSconce);

const rightSconce = new THREE.PointLight(0xffd7a3, 0.8, 8.5, 2);
rightSconce.position.set(4.2, 2.35, -2.2);
scene.add(rightSconce);

const roomMat = new THREE.MeshStandardMaterial({ color: 0x1b1d2a, roughness: 0.95, metalness: 0.05 });
const floorMat = new THREE.MeshStandardMaterial({ color: 0x2a1f1a, roughness: 0.92, metalness: 0.04 });
const stoneMat = new THREE.MeshStandardMaterial({ color: 0x4f535f, roughness: 0.88, metalness: 0.02 });
const mantleMat = new THREE.MeshStandardMaterial({ color: 0x5c4634, roughness: 0.85, metalness: 0.06 });

const floor = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), floorMat);
floor.rotation.x = -Math.PI / 2;
floor.position.y = 0;
scene.add(floor);

const backWall = new THREE.Mesh(new THREE.PlaneGeometry(12, 6), roomMat);
backWall.position.set(0, 3, -4.4);
scene.add(backWall);

const leftWall = new THREE.Mesh(new THREE.PlaneGeometry(10, 6), roomMat);
leftWall.position.set(-5.8, 3, 0);
leftWall.rotation.y = Math.PI / 2;
scene.add(leftWall);

const rightWall = new THREE.Mesh(new THREE.PlaneGeometry(10, 6), roomMat);
rightWall.position.set(5.8, 3, 0);
rightWall.rotation.y = -Math.PI / 2;
scene.add(rightWall);

const hearth = new THREE.Mesh(new THREE.BoxGeometry(4.8, 2.5, 1.2), stoneMat);
hearth.position.set(0, 1.25, -3.9);
scene.add(hearth);

const opening = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.65, 0.8), new THREE.MeshStandardMaterial({ color: 0x111219, roughness: 0.9 }));
opening.position.set(0, 1.05, -3.35);
scene.add(opening);

const mantle = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.28, 1.5), mantleMat);
mantle.position.set(0, 2.45, -3.85);
scene.add(mantle);

const rug = new THREE.Mesh(new THREE.PlaneGeometry(4.8, 2.8), new THREE.MeshStandardMaterial({ color: 0x2a0f12, roughness: 0.9, metalness: 0.02 }));
rug.rotation.x = -Math.PI / 2;
rug.position.set(0, 0.01, -1.2);
scene.add(rug);

// Team staging platforms: heroes and villains face each other.
const COMBAT_ARENA_MODE = !!window.__COMBAT_ARENA_MODE__;

const lobbySlotLayouts = {
  heroes: [
    { x: -4.4, z: 2.6 },
    { x: -4.4, z: 0.3 },
    { x: -4.4, z: -2.0 },
    { x: -4.4, z: -4.3 },
  ],
  villains: [
    { x: 4.4, z: 2.6 },
    { x: 4.4, z: 0.3 },
    { x: 4.4, z: -2.0 },
    { x: 4.4, z: -4.3 },
  ],
};

function createNameplateSprite(initialText) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(0.95, 0.24, 1);
  sprite.userData.canvas = canvas;
  sprite.userData.ctx = ctx;
  sprite.userData.texture = texture;
  updateNameplateSprite(sprite, initialText, '#9aa7d8');
  return sprite;
}

function updateNameplateSprite(sprite, text, color = '#9aa7d8') {
  const ctx = sprite?.userData?.ctx;
  const canvas = sprite?.userData?.canvas;
  const texture = sprite?.userData?.texture;
  if (!ctx || !canvas || !texture) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'rgba(7, 10, 20, 0.78)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
  ctx.font = 'bold 44px Consolas';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(String(text || '').slice(0, 22), canvas.width / 2, canvas.height / 2 + 2);
  texture.needsUpdate = true;
}

function createTeamSlot(team, index, pos) {
  const isHero = team === 'heroes';
  const root = new THREE.Group();
  root.position.set(pos.x, 0, pos.z);

  const baseMat = new THREE.MeshStandardMaterial({
    color: isHero ? 0x334547 : 0x4a3336,
    roughness: 0.84,
    metalness: 0.08,
  });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.54, 0.64, 0.26, 26), baseMat);
  base.position.y = 0.13;
  root.add(base);

  const ringMat = new THREE.MeshBasicMaterial({
    color: isHero ? 0x67d7a2 : 0xf08a8a,
    transparent: true,
    opacity: 0.42,
  });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.48, 0.018, 10, 48), ringMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.27;
  root.add(ring);

  const plate = createNameplateSprite(`${team.toUpperCase()}-${index + 1}`);
  plate.position.set(0, 2.4, 0);
  root.add(plate);

  scene.add(root);
  return { team, index, root, ringMat, plate, occupantSid: null };
}

const lobbyTeamSlots = COMBAT_ARENA_MODE ? [] : [
  ...lobbySlotLayouts.heroes.map((pos, i) => createTeamSlot('heroes', i, pos)),
  ...lobbySlotLayouts.villains.map((pos, i) => createTeamSlot('villains', i, pos)),
];

const SHOW_NON_PLAYER_STAGING = false;

const localPreviewAnchor = new THREE.Group();
scene.add(localPreviewAnchor);

const rosterAvatarLayer = new THREE.Group();
scene.add(rosterAvatarLayer);

const rosterAvatarVisuals = new Map();

const pedestal = new THREE.Mesh(
  new THREE.CylinderGeometry(0.34, 0.4, 0.24, 22),
  new THREE.MeshStandardMaterial({ color: 0x3a2f33, roughness: 0.86, metalness: 0.08 })
);
pedestal.position.set(0, 0.12, 0);
localPreviewAnchor.add(pedestal);

const avatar = new THREE.Group();
avatar.position.set(0, 0.24, 0);
localPreviewAnchor.add(avatar);

localPreviewAnchor.position.set(-4.4, 0, 2.6);
localPreviewAnchor.rotation.y = -Math.PI / 2;

const avatarBodyMat = new THREE.MeshStandardMaterial({ color: 0x7f6bff, roughness: 0.62, metalness: 0.08, emissive: 0x121320 });
const avatarClothMat = new THREE.MeshStandardMaterial({ color: 0x2a2f4d, roughness: 0.9, metalness: 0.03 });
const avatarSkinMat = new THREE.MeshStandardMaterial({ color: 0xe9cdb0, roughness: 0.72, metalness: 0.01 });
const avatarHairMat = new THREE.MeshStandardMaterial({ color: 0x2c1f18, roughness: 0.84, metalness: 0.02 });
const avatarOrbMat = new THREE.MeshStandardMaterial({ color: 0x9a8bff, roughness: 0.26, metalness: 0.28, emissive: 0x18142c, emissiveIntensity: 0.45 });

const avatarTorso = new THREE.Mesh(new THREE.CapsuleGeometry(0.285, 0.56, 6, 12), avatarBodyMat);
avatarTorso.position.y = 1.02;
avatar.add(avatarTorso);

const avatarShoulders = new THREE.Mesh(new THREE.CapsuleGeometry(0.36, 0.24, 4, 10), avatarClothMat);
avatarShoulders.rotation.z = Math.PI / 2;
avatarShoulders.position.y = 1.22;
avatar.add(avatarShoulders);

const avatarCloak = new THREE.Mesh(new THREE.ConeGeometry(0.43, 1.04, 14), avatarClothMat);
avatarCloak.position.y = 0.64;
avatarCloak.rotation.y = Math.PI / 8;
avatar.add(avatarCloak);

const avatarHead = new THREE.Mesh(new THREE.SphereGeometry(0.2, 24, 20), avatarSkinMat);
avatarHead.position.y = 1.58;
avatar.add(avatarHead);

const avatarHair = new THREE.Mesh(new THREE.SphereGeometry(0.205, 20, 16, 0, Math.PI * 2, 0, Math.PI * 0.58), avatarHairMat);
avatarHair.position.y = 1.64;
avatarHair.position.z = -0.01;
avatar.add(avatarHair);

const eyeMat = new THREE.MeshBasicMaterial({ color: 0x0d0f16 });
const leftEye = new THREE.Mesh(new THREE.SphereGeometry(0.024, 10, 8), eyeMat);
leftEye.position.set(-0.065, 1.59, 0.18);
avatar.add(leftEye);
const rightEye = new THREE.Mesh(new THREE.SphereGeometry(0.024, 10, 8), eyeMat);
rightEye.position.set(0.065, 1.59, 0.18);
avatar.add(rightEye);

const avatarOrb = new THREE.Mesh(new THREE.SphereGeometry(0.08, 16, 14), avatarOrbMat);
avatarOrb.position.set(0, 1.33, 0.34);
avatar.add(avatarOrb);

const leftArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.44, 4, 8), avatarSkinMat);
leftArm.position.set(-0.34, 1.04, 0.02);
leftArm.rotation.z = Math.PI / 11;
avatar.add(leftArm);
const rightArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.44, 4, 8), avatarSkinMat);
rightArm.position.set(0.34, 1.04, 0.02);
rightArm.rotation.z = -Math.PI / 11;
avatar.add(rightArm);

const leftLeg = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.76, 4, 8), avatarBodyMat);
leftLeg.position.set(-0.14, 0.35, 0.03);
avatar.add(leftLeg);
const rightLeg = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.76, 4, 8), avatarBodyMat);
rightLeg.position.set(0.14, 0.35, 0.03);
avatar.add(rightLeg);

const boots = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.08, 0.3), new THREE.MeshStandardMaterial({ color: 0x18141e, roughness: 0.86, metalness: 0.02 }));
boots.position.set(0, 0.04, 0.06);
avatar.add(boots);


const auraRing = new THREE.Mesh(
  new THREE.TorusGeometry(0.62, 0.02, 10, 44),
  new THREE.MeshBasicMaterial({ color: 0x7f6bff, transparent: true, opacity: 0.72 })
);
auraRing.rotation.x = Math.PI / 2;
auraRing.position.y = 0.12;
avatar.add(auraRing);

const dummyPedestal = new THREE.Mesh(
  new THREE.CylinderGeometry(0.52, 0.62, 0.22, 24),
  new THREE.MeshStandardMaterial({ color: 0x433033, roughness: 0.88, metalness: 0.06 })
);
dummyPedestal.position.set(4.15, 0.11, 1.75);
scene.add(dummyPedestal);

const handsPedestal = new THREE.Mesh(
  new THREE.CylinderGeometry(0.52, 0.62, 0.22, 24),
  new THREE.MeshStandardMaterial({ color: 0x2f3648, roughness: 0.8, metalness: 0.18 })
);
handsPedestal.position.set(-4.15, 0.11, 1.75);
scene.add(handsPedestal);

const proceduralHandsPreview = new THREE.Group();
proceduralHandsPreview.position.set(-4.15, 0.24, 1.75);
scene.add(proceduralHandsPreview);

const handsGlowMat = new THREE.MeshStandardMaterial({
  color: 0x8dc0ff,
  roughness: 0.36,
  metalness: 0.25,
  emissive: 0x1b2a4f,
  emissiveIntensity: 0.7,
});

function createProceduralHand(side = 1) {
  const hand = new THREE.Group();
  hand.userData.fingerPivots = [];

  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.08, 0.26), handsGlowMat);
  palm.position.y = 0.02;
  hand.add(palm);

  const knuckleY = 0.065;
  const fingerBaseZ = 0.055;
  const fingerOffsets = [-0.07, -0.023, 0.023, 0.07];
  for (let i = 0; i < fingerOffsets.length; i++) {
    const pivot = new THREE.Group();
    pivot.position.set(fingerOffsets[i], knuckleY, fingerBaseZ);
    const segmentA = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.032, 0.1), handsGlowMat);
    segmentA.position.z = 0.045;
    pivot.add(segmentA);

    const segmentB = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.028, 0.072), handsGlowMat);
    segmentB.position.z = 0.115;
    pivot.add(segmentB);

    hand.userData.fingerPivots.push(pivot);
    hand.add(pivot);
  }

  const thumbPivot = new THREE.Group();
  thumbPivot.position.set(side * 0.12, 0.02, 0.025);
  const thumbSegA = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.032, 0.075), handsGlowMat);
  thumbSegA.position.z = 0.04;
  thumbPivot.add(thumbSegA);
  const thumbSegB = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.026, 0.06), handsGlowMat);
  thumbSegB.position.z = 0.095;
  thumbPivot.add(thumbSegB);
  hand.userData.thumbPivot = thumbPivot;
  hand.add(thumbPivot);

  hand.rotation.y = side > 0 ? -0.22 : 0.22;
  return hand;
}

const proceduralHandLeft = createProceduralHand(-1);
proceduralHandLeft.position.set(-0.2, 0.56, 0);
proceduralHandsPreview.add(proceduralHandLeft);

const proceduralHandRight = createProceduralHand(1);
proceduralHandRight.position.set(0.2, 0.56, 0);
proceduralHandsPreview.add(proceduralHandRight);

const proceduralHands = [proceduralHandLeft, proceduralHandRight];

const trainingDummyPreview = new THREE.Group();
trainingDummyPreview.position.set(4.15, 0.22, 1.75);
trainingDummyPreview.rotation.y = Math.PI;
scene.add(trainingDummyPreview);

const trainingDummyFallbackRoot = new THREE.Group();
trainingDummyFallbackRoot.name = 'training_dummy_fallback';
trainingDummyPreview.add(trainingDummyFallbackRoot);

const trainingDummyFallbackMaterial = new THREE.MeshStandardMaterial({
  color: 0x9f5b44,
  roughness: 0.82,
  metalness: 0.04,
});
const trainingDummyAccentMaterial = new THREE.MeshStandardMaterial({
  color: 0x5f2d26,
  roughness: 0.8,
  metalness: 0.05,
});

const trainingDummyBody = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.27, 1.46, 18), trainingDummyFallbackMaterial);
trainingDummyBody.position.y = 0.72;
trainingDummyFallbackRoot.add(trainingDummyBody);

const trainingDummyHead = new THREE.Mesh(new THREE.SphereGeometry(0.2, 18, 14), trainingDummyFallbackMaterial);
trainingDummyHead.position.y = 1.56;
trainingDummyFallbackRoot.add(trainingDummyHead);

const trainingDummyArmL = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.5, 4, 8), trainingDummyAccentMaterial);
trainingDummyArmL.position.set(-0.34, 0.95, 0);
trainingDummyArmL.rotation.z = Math.PI / 2.6;
trainingDummyFallbackRoot.add(trainingDummyArmL);

const trainingDummyArmR = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.5, 4, 8), trainingDummyAccentMaterial);
trainingDummyArmR.position.set(0.34, 0.95, 0);
trainingDummyArmR.rotation.z = -Math.PI / 2.6;
trainingDummyFallbackRoot.add(trainingDummyArmR);

const trainingDummyBase = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.26, 16), trainingDummyAccentMaterial);
trainingDummyBase.position.y = 0.1;
trainingDummyFallbackRoot.add(trainingDummyBase);

const trainingDummyPoseRoot = trainingDummyFallbackRoot;

// NPC corner: a small cluster near the back-left wall.
const npcCornerRoot = new THREE.Group();
npcCornerRoot.position.set(-4.45, 0, -3.1);
scene.add(npcCornerRoot);

for (let i = 0; i < 3; i++) {
  const npcStand = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.27, 0.16, 18),
    new THREE.MeshStandardMaterial({ color: 0x3a3c46, roughness: 0.84, metalness: 0.08 })
  );
  npcStand.position.set((i % 2) * 0.72, 0.08, Math.floor(i / 2) * 0.7);
  npcCornerRoot.add(npcStand);

  const npcToken = new THREE.Mesh(
    new THREE.SphereGeometry(0.13, 16, 14),
    new THREE.MeshStandardMaterial({ color: 0xc8b17e, roughness: 0.6, metalness: 0.1, emissive: 0x241f16, emissiveIntensity: 0.45 })
  );
  npcToken.position.set(npcStand.position.x, 0.29, npcStand.position.z);
  npcCornerRoot.add(npcToken);
}

if (!SHOW_NON_PLAYER_STAGING) {
  handsPedestal.visible = false;
  proceduralHandsPreview.visible = false;
  dummyPedestal.visible = false;
  trainingDummyPreview.visible = false;
  npcCornerRoot.visible = false;
}

const flameCore = new THREE.Mesh(
  new THREE.SphereGeometry(0.36, 20, 18),
  new THREE.MeshBasicMaterial({ color: 0xffc066, transparent: true, opacity: 0.9 })
);
flameCore.position.set(0, 1.0, -3.2);
scene.add(flameCore);

const flameOuter = new THREE.Mesh(
  new THREE.SphereGeometry(0.62, 20, 18),
  new THREE.MeshBasicMaterial({ color: 0xff6a22, transparent: true, opacity: 0.35 })
);
flameOuter.position.copy(flameCore.position);
scene.add(flameOuter);

const embers = [];
for (let i = 0; i < 18; i++) {
  const ember = new THREE.Mesh(
    new THREE.SphereGeometry(0.03 + Math.random() * 0.04, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xffc670, transparent: true, opacity: 0.75 })
  );
  ember.position.set((Math.random() - 0.5) * 0.8, 0.8 + Math.random() * 0.45, -3.05 + (Math.random() - 0.5) * 0.35);
  ember.userData = {
    baseY: ember.position.y,
    drift: 0.6 + Math.random() * 1.2,
    phase: Math.random() * Math.PI * 2,
  };
  embers.push(ember);
  scene.add(ember);
}

// Floor-only lobby mode: keep player platforms/avatars and remove room/fireplace visuals.
const FLOOR_ONLY_PLAYERS_MODE = true;
if (FLOOR_ONLY_PLAYERS_MODE) {
  backWall.visible = false;
  leftWall.visible = false;
  rightWall.visible = false;
  hearth.visible = false;
  opening.visible = false;
  mantle.visible = false;
  rug.visible = false;
  flameCore.visible = false;
  flameOuter.visible = false;
  embers.forEach((ember) => {
    ember.visible = false;
  });
}

function createAxisLabelSprite(text, color = '#ffffff') {
  const canvas = document.createElement('canvas');
  canvas.width = 96;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = 'bold 60px Consolas';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.strokeStyle = '#0b0d14';
  ctx.lineWidth = 10;
  ctx.strokeText(text, 48, 50);
  ctx.fillText(text, 48, 50);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(0.28, 0.28, 0.28);
  return sprite;
}

function createSundialCompass() {
  const root = new THREE.Group();
  root.name = 'sundial_compass';

  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x4d4f58, roughness: 0.9, metalness: 0.04 });
  const brassMat = new THREE.MeshStandardMaterial({ color: 0xb08d52, roughness: 0.42, metalness: 0.58 });

  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.66, 0.18, 28), stoneMat);
  plinth.position.y = 0.09;
  root.add(plinth);

  const dial = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.05, 36), brassMat);
  dial.position.y = 0.22;
  root.add(dial);

  const dialSecondary = new THREE.Mesh(
    new THREE.CylinderGeometry(0.36, 0.36, 0.035, 28),
    new THREE.MeshStandardMaterial({ color: 0x8d7448, roughness: 0.4, metalness: 0.58 })
  );
  dialSecondary.position.y = 0.36;
  root.add(dialSecondary);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.44, 0.012, 10, 44),
    new THREE.MeshStandardMaterial({ color: 0xc8a96b, roughness: 0.38, metalness: 0.68 })
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.245;
  root.add(ring);

  const innerRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.3, 0.009, 10, 40),
    new THREE.MeshStandardMaterial({ color: 0xaa8a57, roughness: 0.36, metalness: 0.6 })
  );
  innerRing.rotation.x = Math.PI / 2;
  innerRing.position.y = 0.378;
  root.add(innerRing);

  const cardinals = [
    { text: 'N', x: 0, z: -0.49, color: '#f8e9bf' },
    { text: 'S', x: 0, z: 0.49, color: '#f8e9bf' },
    { text: 'E', x: 0.49, z: 0, color: '#f8e9bf' },
    { text: 'W', x: -0.49, z: 0, color: '#f8e9bf' },
  ];
  for (const c of cardinals) {
    const marker = new THREE.Mesh(
      new THREE.BoxGeometry(0.022, 0.02, 0.06),
      new THREE.MeshStandardMaterial({ color: 0xe7cf97, roughness: 0.44, metalness: 0.32 })
    );
    marker.position.set(c.x, 0.287, c.z);
    if (c.x !== 0) marker.rotation.y = Math.PI / 2;
    root.add(marker);

    const lbl = createAxisLabelSprite(c.text, c.color);
    if (lbl) {
      lbl.scale.set(0.2, 0.2, 0.2);
      lbl.position.set(c.x * 1.08, 0.33, c.z * 1.08);
      root.add(lbl);
    }
  }

  const axisLen = 0.58;
  const axisRadius = 0.012;
  const axisY = 0.4;

  const xAxis = new THREE.Mesh(
    new THREE.CylinderGeometry(axisRadius, axisRadius, axisLen, 10),
    new THREE.MeshStandardMaterial({ color: 0xff5a5a, roughness: 0.44, metalness: 0.2 })
  );
  xAxis.rotation.z = Math.PI / 2;
  xAxis.position.set(0, axisY, 0);
  root.add(xAxis);

  const zAxis = new THREE.Mesh(
    new THREE.CylinderGeometry(axisRadius, axisRadius, axisLen, 10),
    new THREE.MeshStandardMaterial({ color: 0x5ea9ff, roughness: 0.44, metalness: 0.2 })
  );
  zAxis.rotation.x = Math.PI / 2;
  zAxis.position.set(0, axisY, 0);
  root.add(zAxis);

  const yAxis = new THREE.Mesh(
    new THREE.CylinderGeometry(axisRadius, axisRadius, axisLen * 0.75, 10),
    new THREE.MeshStandardMaterial({ color: 0x6bdf83, roughness: 0.44, metalness: 0.2 })
  );
  yAxis.position.set(0, axisY + (axisLen * 0.375), 0);
  root.add(yAxis);

  const xArrow = new THREE.Mesh(
    new THREE.ConeGeometry(0.03, 0.1, 12),
    new THREE.MeshStandardMaterial({ color: 0xff5a5a, roughness: 0.38, metalness: 0.22 })
  );
  xArrow.rotation.z = -Math.PI / 2;
  xArrow.position.set(axisLen * 0.5 + 0.05, axisY, 0);
  root.add(xArrow);

  const zArrow = new THREE.Mesh(
    new THREE.ConeGeometry(0.03, 0.1, 12),
    new THREE.MeshStandardMaterial({ color: 0x5ea9ff, roughness: 0.38, metalness: 0.22 })
  );
  zArrow.rotation.x = Math.PI / 2;
  zArrow.position.set(0, axisY, axisLen * 0.5 + 0.05);
  root.add(zArrow);

  const yArrow = new THREE.Mesh(
    new THREE.ConeGeometry(0.03, 0.1, 12),
    new THREE.MeshStandardMaterial({ color: 0x6bdf83, roughness: 0.38, metalness: 0.22 })
  );
  yArrow.position.set(0, axisY + (axisLen * 0.75) + 0.05, 0);
  root.add(yArrow);

  const xArrowNeg = new THREE.Mesh(
    new THREE.ConeGeometry(0.026, 0.085, 12),
    new THREE.MeshStandardMaterial({ color: 0xc66b6b, roughness: 0.42, metalness: 0.2 })
  );
  xArrowNeg.rotation.z = Math.PI / 2;
  xArrowNeg.position.set(-(axisLen * 0.5 + 0.05), axisY, 0);
  root.add(xArrowNeg);

  const zArrowNeg = new THREE.Mesh(
    new THREE.ConeGeometry(0.026, 0.085, 12),
    new THREE.MeshStandardMaterial({ color: 0x6f9bcf, roughness: 0.42, metalness: 0.2 })
  );
  zArrowNeg.rotation.x = -Math.PI / 2;
  zArrowNeg.position.set(0, axisY, -(axisLen * 0.5 + 0.05));
  root.add(zArrowNeg);

  const yArrowNeg = new THREE.Mesh(
    new THREE.ConeGeometry(0.026, 0.085, 12),
    new THREE.MeshStandardMaterial({ color: 0x73b585, roughness: 0.42, metalness: 0.2 })
  );
  yArrowNeg.rotation.x = Math.PI;
  yArrowNeg.position.set(0, axisY - 0.06, 0);
  root.add(yArrowNeg);

  const xLabel = createAxisLabelSprite('X', '#ff8f8f');
  if (xLabel) {
    xLabel.position.set(axisLen * 0.5 + 0.14, axisY + 0.04, 0);
    root.add(xLabel);
  }

  const yLabel = createAxisLabelSprite('Y', '#97f2ab');
  if (yLabel) {
    yLabel.position.set(0, axisY + (axisLen * 0.75) + 0.16, 0);
    root.add(yLabel);
  }

  const zLabel = createAxisLabelSprite('Z', '#9cc8ff');
  if (zLabel) {
    zLabel.position.set(0, axisY + 0.04, axisLen * 0.5 + 0.14);
    root.add(zLabel);
  }

  const xNegLabel = createAxisLabelSprite('-X', '#d6a4a4');
  if (xNegLabel) {
    xNegLabel.scale.set(0.19, 0.19, 0.19);
    xNegLabel.position.set(-(axisLen * 0.5 + 0.16), axisY + 0.04, 0);
    root.add(xNegLabel);
  }

  const yNegLabel = createAxisLabelSprite('-Y', '#a8d8b2');
  if (yNegLabel) {
    yNegLabel.scale.set(0.2, 0.2, 0.2);
    yNegLabel.position.set(0, axisY - 0.2, 0);
    root.add(yNegLabel);
  }

  const zNegLabel = createAxisLabelSprite('-Z', '#a8c1df');
  if (zNegLabel) {
    zNegLabel.scale.set(0.19, 0.19, 0.19);
    zNegLabel.position.set(0, axisY + 0.04, -(axisLen * 0.5 + 0.16));
    root.add(zNegLabel);
  }

  const upLabel = createAxisLabelSprite('UP', '#d9f5e0');
  if (upLabel) {
    upLabel.scale.set(0.17, 0.17, 0.17);
    upLabel.position.set(0, axisY + (axisLen * 0.75) + 0.27, 0);
    root.add(upLabel);
  }

  const downLabel = createAxisLabelSprite('DOWN', '#c7ddcd');
  if (downLabel) {
    downLabel.scale.set(0.15, 0.15, 0.15);
    downLabel.position.set(0, axisY - 0.29, 0);
    root.add(downLabel);
  }

  return root;
}

const axisCompass = createSundialCompass();
axisCompass.position.set(-0.1, 0.16, 1.6);
axisCompass.rotation.y = -Math.PI * 0.12;
scene.add(axisCompass);

const profile = {
  name: 'Ashen Wanderer',
  side: 'heroes',
  role: 'player',
  species: 'Human',
  className: 'Wizard',
  origin: 'Arcane Academy',
  voice: 'Calm',
  aura: '#7f6bff',
  modelUrl: null,
  rigSettings: null,
  trainingDummy: {
    modelUrl: null,
    pose: 'idle',
  },
};

const gltfLoader = new GLTFLoader();
let uploadedAvatarRoot = null;
let uploadedRigHelper = null;
let uploadedTrainingDummyRoot = null;
let fireplaceLobbySocket = null;
let fireplaceLobbyConnected = false;
let fireplaceLobbyLocalSid = null;
let fireplaceLobbyJoined = false;
let fireplaceLobbyRoster = {};
let fireplaceLobbyLastPresenceKey = '';

const moveState = {
  forward: false,
  back: false,
  left: false,
  right: false,
  up: false,
  down: false,
  boost: false,
};

let pointerLocked = false;
let yaw = 0;
let pitch = 0;

const baseMoveSpeed = 3.2;
const boostMultiplier = 2.2;
const lookSensitivity = 0.002;

const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _move = new THREE.Vector3();
const _retargetDeltaPos = new THREE.Vector3();
const _retargetDeltaQuat = new THREE.Quaternion();
const _retargetTargetQuat = new THREE.Quaternion();
const _retargetTargetPos = new THREE.Vector3();

function setMoveStateByCode(code, value) {
  if (code === 'KeyW') moveState.forward = value;
  if (code === 'KeyS') moveState.back = value;
  if (code === 'KeyA') moveState.left = value;
  if (code === 'KeyD') moveState.right = value;
  if (code === 'Space') moveState.up = value;
  if (code === 'ShiftLeft' || code === 'ShiftRight') {
    moveState.down = value;
    moveState.boost = value;
  }
}

// Initialize yaw/pitch from current camera direction.
{
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  yaw = Math.atan2(dir.x, dir.z);
  pitch = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1));
}

renderer.domElement.addEventListener('click', (event) => {
  // Alt+click supports bone selection tooling; regular click enters FPS look mode.
  if (!pointerLocked && event.altKey) {
    handleBoneSelection(event);
    return;
  }
  if (!pointerLocked) {
    renderer.domElement.requestPointerLock();
  }
});

document.addEventListener('pointerlockchange', () => {
  pointerLocked = document.pointerLockElement === renderer.domElement;
});

document.addEventListener('mousemove', (e) => {
  if (!pointerLocked) return;
  yaw -= e.movementX * lookSensitivity;
  pitch -= e.movementY * lookSensitivity;
  pitch = THREE.MathUtils.clamp(pitch, -Math.PI / 2 + 0.02, Math.PI / 2 - 0.02);
  camera.quaternion.setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
});

document.addEventListener('keydown', (e) => {
  // Avoid hijacking typing in creation panel fields.
  const tag = document.activeElement ? document.activeElement.tagName : '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (e.code === 'KeyW' || e.code === 'KeyA' || e.code === 'KeyS' || e.code === 'KeyD' || e.code === 'Space' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
    e.preventDefault();
  }
  setMoveStateByCode(e.code, true);
});

document.addEventListener('keyup', (e) => {
  if (e.code === 'KeyW' || e.code === 'KeyA' || e.code === 'KeyS' || e.code === 'KeyD' || e.code === 'Space' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
    e.preventDefault();
  }
  setMoveStateByCode(e.code, false);
});

const nameEl = document.getElementById('cc-name');
const sideEl = document.getElementById('cc-side');
const speciesEl = document.getElementById('cc-species');
const speciesOtherEl = document.getElementById('cc-species-other');
const classEl = document.getElementById('cc-class');
const classOtherEl = document.getElementById('cc-class-other');
const originEl = document.getElementById('cc-origin');
const originOtherEl = document.getElementById('cc-origin-other');
const voiceEl = document.getElementById('cc-voice');
const voiceOtherEl = document.getElementById('cc-voice-other');
const colorEl = document.getElementById('cc-color');
const modelFileEl = document.getElementById('cc-model-file');
const modelSelectEl = document.getElementById('cc-model-select');
const modelRefreshBtn = document.getElementById('cc-model-refresh');
const modelUploadBtn = document.getElementById('cc-model-upload');
const modelStatusEl = document.getElementById('cc-model-status');
const rigReportEl = document.getElementById('cc-rig-report');
const dummyModelFileEl = document.getElementById('cc-dummy-model-file');
const dummyModelUploadBtn = document.getElementById('cc-dummy-model-upload');
const dummyModelStatusEl = document.getElementById('cc-dummy-model-status');
const dummyPoseEl = document.getElementById('cc-dummy-pose');
const previewEl = document.getElementById('creator-preview');
const randomBtn = document.getElementById('cc-random');
const beginBtn = document.getElementById('cc-begin');
const startCombatBtn = document.getElementById('cc-start-combat');
const lobbyStatusEl = document.getElementById('lobby-status');
const lobbyRosterEl = document.getElementById('lobby-roster');
const roleEl = document.getElementById('cc-role');
const backLinkEl = document.getElementById('back-link');
const rigFrontFlipBtn = document.getElementById('cc-rig-backflip');
const rigIdleBtn = document.getElementById('cc-rig-idle');
const rigWalkBtn = document.getElementById('cc-rig-walk');
const rigDanceBtn = document.getElementById('cc-rig-dance');
const rigReboneBtn = document.getElementById('cc-rig-rebone');
const rigClearRotationsBtn = document.getElementById('cc-rig-clear-rotations');
const rigDiagnosticsBtn = document.getElementById('cc-rig-diagnostics');

const RIG_SLOT_PROFILES = {
  hips: {
    aliases: ['hips', 'pelvis', 'root', 'cog', 'centerofgravity'],
    keywords: ['hip', 'pelvis', 'waist', 'root'],
    side: 'center',
    targetY: 0.45,
    minChildren: 2,
  },
  spine: {
    aliases: ['spine', 'spine1', 'spine01', 'spine_01', 'abdomen', 'torso'],
    keywords: ['spine', 'abdomen', 'torso', 'body'],
    side: 'center',
    targetY: 0.58,
    minChildren: 1,
  },
  chest: {
    aliases: ['chest', 'spine2', 'spine02', 'spine_02', 'upperchest', 'spine3', 'spine03', 'spine_03', 'thorax'],
    keywords: ['chest', 'upperchest', 'thorax', 'rib'],
    side: 'center',
    targetY: 0.72,
    minChildren: 2,
  },
  neck: {
    aliases: ['neck', 'neck1', 'neck01', 'neck_01'],
    keywords: ['neck'],
    side: 'center',
    targetY: 0.86,
    minChildren: 1,
  },
  head: {
    aliases: ['head', 'skull'],
    keywords: ['head', 'skull'],
    side: 'center',
    targetY: 0.96,
    endBone: true,
  },
  leftUpperArm: {
    aliases: ['leftupperarm', 'upperarm_l', 'lupperarm', 'leftarm', 'arm_l'],
    keywords: ['upperarm', 'arm', 'shoulder'],
    excludeKeywords: ['forearm', 'lowerarm', 'hand', 'wrist'],
    side: 'left',
    targetY: 0.73,
    minX: 0.2,
    minChildren: 1,
  },
  leftLowerArm: {
    aliases: ['leftlowerarm', 'lowerarm_l', 'lforearm', 'leftforearm', 'forearm_l'],
    keywords: ['lowerarm', 'forearm', 'elbow', 'arm'],
    excludeKeywords: ['hand', 'wrist'],
    side: 'left',
    targetY: 0.63,
    minX: 0.24,
    minChildren: 1,
  },
  leftHand: {
    aliases: ['lefthand', 'hand_l', 'lhand', 'wrist_l'],
    keywords: ['hand', 'wrist'],
    side: 'left',
    targetY: 0.55,
    minX: 0.28,
    endBone: true,
  },
  rightUpperArm: {
    aliases: ['rightupperarm', 'upperarm_r', 'rupperarm', 'rightarm', 'arm_r'],
    keywords: ['upperarm', 'arm', 'shoulder'],
    excludeKeywords: ['forearm', 'lowerarm', 'hand', 'wrist'],
    side: 'right',
    targetY: 0.73,
    minX: 0.2,
    minChildren: 1,
  },
  rightLowerArm: {
    aliases: ['rightlowerarm', 'lowerarm_r', 'rforearm', 'rightforearm', 'forearm_r'],
    keywords: ['lowerarm', 'forearm', 'elbow', 'arm'],
    excludeKeywords: ['hand', 'wrist'],
    side: 'right',
    targetY: 0.63,
    minX: 0.24,
    minChildren: 1,
  },
  rightHand: {
    aliases: ['righthand', 'hand_r', 'rhand', 'wrist_r'],
    keywords: ['hand', 'wrist'],
    side: 'right',
    targetY: 0.55,
    minX: 0.28,
    endBone: true,
  },
  leftUpperLeg: {
    aliases: ['leftupleg', 'leftupperleg', 'thigh_l', 'lthigh', 'leftthigh', 'upleg_l'],
    keywords: ['upleg', 'upperleg', 'thigh', 'leg'],
    excludeKeywords: ['lowerleg', 'calf', 'foot', 'toe'],
    side: 'left',
    targetY: 0.36,
    minX: 0.08,
    minChildren: 1,
  },
  leftLowerLeg: {
    aliases: ['leftleg', 'leftlowerleg', 'calf_l', 'lcalf', 'leftknee', 'shin_l'],
    keywords: ['lowerleg', 'calf', 'shin', 'knee', 'leg'],
    excludeKeywords: ['foot', 'toe'],
    side: 'left',
    targetY: 0.18,
    minX: 0.08,
    minChildren: 1,
  },
  leftFoot: {
    aliases: ['leftfoot', 'foot_l', 'lfoot', 'ankle_l'],
    keywords: ['foot', 'ankle'],
    excludeKeywords: ['toe'],
    side: 'left',
    targetY: 0.04,
    minX: 0.08,
    endBone: true,
  },
  rightUpperLeg: {
    aliases: ['rightupleg', 'rightupperleg', 'thigh_r', 'rthigh', 'rightthigh', 'upleg_r'],
    keywords: ['upleg', 'upperleg', 'thigh', 'leg'],
    excludeKeywords: ['lowerleg', 'calf', 'foot', 'toe'],
    side: 'right',
    targetY: 0.36,
    minX: 0.08,
    minChildren: 1,
  },
  rightLowerLeg: {
    aliases: ['rightleg', 'rightlowerleg', 'calf_r', 'rcalf', 'rightknee', 'shin_r'],
    keywords: ['lowerleg', 'calf', 'shin', 'knee', 'leg'],
    excludeKeywords: ['foot', 'toe'],
    side: 'right',
    targetY: 0.18,
    minX: 0.08,
    minChildren: 1,
  },
  rightFoot: {
    aliases: ['rightfoot', 'foot_r', 'rfoot', 'ankle_r'],
    keywords: ['foot', 'ankle'],
    excludeKeywords: ['toe'],
    side: 'right',
    targetY: 0.04,
    minX: 0.08,
    endBone: true,
  },
};

const RIG_ESSENTIAL_SLOTS = ['hips', 'head', 'leftUpperArm', 'rightUpperArm', 'leftUpperLeg', 'rightUpperLeg'];

const RIG_CHAIN_FALLBACKS = [
  ['hips', 'spine'],
  ['spine', 'chest'],
  ['chest', 'neck'],
  ['neck', 'head'],
  ['leftUpperArm', 'leftLowerArm'],
  ['leftLowerArm', 'leftHand'],
  ['rightUpperArm', 'rightLowerArm'],
  ['rightLowerArm', 'rightHand'],
  ['leftUpperLeg', 'leftLowerLeg'],
  ['leftLowerLeg', 'leftFoot'],
  ['rightUpperLeg', 'rightLowerLeg'],
  ['rightLowerLeg', 'rightFoot'],
];

const RIG_MIRROR_SLOT_PAIRS = [
  ['leftUpperArm', 'rightUpperArm'],
  ['leftLowerArm', 'rightLowerArm'],
  ['leftHand', 'rightHand'],
  ['leftUpperLeg', 'rightUpperLeg'],
  ['leftLowerLeg', 'rightLowerLeg'],
  ['leftFoot', 'rightFoot'],
];

let latestRigReport = null;
let latestImportedRigReport = null;
const rigPoseState = {
  active: false,
  startAtMs: 0,
  durationMs: 1800,
};
const rigPoseBase = new Map();
const rigWalkState = {
  active: false,
  startAtMs: 0,
  cycleHz: 1.5,
  hipBob: 0.018,
};
const rigIdleState = {
  active: false,
  startAtMs: 0,
  cycleHz: 0.7,
};
const rigDanceState = {
  active: false,
  startAtMs: 0,
  cycleHz: 1.15,
  sway: 0.2,
};
const fallbackRigState = {
  active: false,
  root: null,
  helper: null,
  bones: new Map(),
  report: null,
  sourceRoot: null,
  baseMetrics: null,
  resolvedMetrics: null,
  metricOverrides: {},
};

const FALLBACK_RIG_TUNE_FIELDS = [
  { key: 'hipsY', label: 'Hips Height' },
  { key: 'shoulderOffsetY', label: 'Shoulder Height' },
  { key: 'shoulderOffsetX', label: 'Shoulder Width' },
  { key: 'armUpperLen', label: 'Upper Arm Length' },
  { key: 'armLowerLen', label: 'Lower Arm Length' },
  { key: 'armDropY', label: 'Elbow Drop' },
  { key: 'legOffsetX', label: 'Leg Stance Width' },
  { key: 'legRootDrop', label: 'Leg Root Drop' },
  { key: 'legUpperLen', label: 'Upper Leg Length' },
  { key: 'legLowerLen', label: 'Lower Leg Length' },
];

let fallbackRigEditorPanelEl = null;
let fallbackRigEditorHintEl = null;
let fallbackRigRebuildTimer = 0;
const fallbackRigEditorInputs = new Map();

// Bone selection and rotation inspector
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let boneRotationOverrides = {}; // { boneName: { x, y, z }, ... }
let boneInspectorPanelEl = null;
let selectedBoneName = null;
let previewBoneOverrideDirty = false;

const runtimeRetargetState = {
  active: false,
  pairs: [],
  controls: {
    rotationStrength: 1,
    hipsPositionStrength: 1,
    minInfluenceWeight: 0.0001,
  },
  slotTargetOverrides: new Map(),
  diagnostics: {
    pairCount: 0,
    weightedPairCount: 0,
    unresolvedSlots: [],
  },
};

const runtimeRebindState = {
  active: false,
  records: [],
  stats: {
    meshCount: 0,
    remappedInfluences: 0,
    autoWeightedMeshes: 0,
    convertedMeshes: 0,
  },
};

function makeRigEuler(x = 0, y = 0, z = 0) {
  return new THREE.Euler(x, y, z, 'XYZ');
}

function mirrorRigEuler(euler) {
  return new THREE.Euler(euler.x, -euler.y, -euler.z, 'XYZ');
}

function cloneFallbackMetricMap(metrics) {
  return metrics ? { ...metrics } : null;
}

function getFallbackRigMetricBounds(baseMetrics) {
  if (!baseMetrics) return {};

  return {
    hipsY: {
      min: baseMetrics.minY + baseMetrics.height * 0.25,
      max: baseMetrics.minY + baseMetrics.height * 0.78,
      step: Math.max(baseMetrics.height * 0.002, 0.001),
    },
    spineLen: {
      min: baseMetrics.height * 0.04,
      max: baseMetrics.height * 0.24,
      step: Math.max(baseMetrics.height * 0.002, 0.001),
    },
    chestLen: {
      min: baseMetrics.height * 0.04,
      max: baseMetrics.height * 0.24,
      step: Math.max(baseMetrics.height * 0.002, 0.001),
    },
    neckLen: {
      min: baseMetrics.height * 0.03,
      max: baseMetrics.height * 0.16,
      step: Math.max(baseMetrics.height * 0.0015, 0.001),
    },
    headLen: {
      min: baseMetrics.height * 0.03,
      max: baseMetrics.height * 0.2,
      step: Math.max(baseMetrics.height * 0.0015, 0.001),
    },
    shoulderOffsetX: {
      min: baseMetrics.width * 0.08,
      max: baseMetrics.width * 0.38,
      step: Math.max(baseMetrics.width * 0.002, 0.001),
    },
    shoulderOffsetY: {
      min: -baseMetrics.height * 0.06,
      max: baseMetrics.height * 0.1,
      step: Math.max(baseMetrics.height * 0.002, 0.001),
    },
    armUpperLen: {
      min: baseMetrics.width * 0.08,
      max: baseMetrics.width * 0.45,
      step: Math.max(baseMetrics.width * 0.002, 0.001),
    },
    armLowerLen: {
      min: baseMetrics.width * 0.06,
      max: baseMetrics.width * 0.4,
      step: Math.max(baseMetrics.width * 0.002, 0.001),
    },
    armDropY: {
      min: 0,
      max: baseMetrics.height * 0.12,
      step: Math.max(baseMetrics.height * 0.0015, 0.001),
    },
    legOffsetX: {
      min: baseMetrics.width * 0.05,
      max: baseMetrics.width * 0.24,
      step: Math.max(baseMetrics.width * 0.002, 0.001),
    },
    legRootDrop: {
      min: baseMetrics.height * 0.08,
      max: baseMetrics.height * 0.42,
      step: Math.max(baseMetrics.height * 0.002, 0.001),
    },
    legUpperLen: {
      min: baseMetrics.height * 0.1,
      max: baseMetrics.height * 0.45,
      step: Math.max(baseMetrics.height * 0.002, 0.001),
    },
    legLowerLen: {
      min: baseMetrics.height * 0.08,
      max: baseMetrics.height * 0.4,
      step: Math.max(baseMetrics.height * 0.002, 0.001),
    },
    legForward: {
      min: baseMetrics.depth * 0.005,
      max: baseMetrics.depth * 0.12,
      step: Math.max(baseMetrics.depth * 0.002, 0.001),
    },
    footForward: {
      min: baseMetrics.depth * 0.02,
      max: baseMetrics.depth * 0.28,
      step: Math.max(baseMetrics.depth * 0.002, 0.001),
    },
  };
}

function sanitizeFallbackRigMetricOverrides(overrides, baseMetrics) {
  if (!overrides || typeof overrides !== 'object' || !baseMetrics) return {};

  const bounds = getFallbackRigMetricBounds(baseMetrics);
  const sanitized = {};
  for (const [key, value] of Object.entries(overrides)) {
    if (!Number.isFinite(value) || !(key in bounds)) continue;
    sanitized[key] = THREE.MathUtils.clamp(value, bounds[key].min, bounds[key].max);
  }
  return sanitized;
}

function applyFallbackRigMetricOverrides(baseMetrics, overrides) {
  if (!baseMetrics) return null;
  const sanitized = sanitizeFallbackRigMetricOverrides(overrides, baseMetrics);
  return {
    ...baseMetrics,
    ...sanitized,
  };
}

function getFallbackRigSourceRoot() {
  return fallbackRigState.sourceRoot || uploadedAvatarRoot || avatar;
}

function getFallbackRigEditorBaseMetrics() {
  if (fallbackRigState.baseMetrics) return fallbackRigState.baseMetrics;
  return uploadedAvatarRoot ? collectFallbackRigMetrics(uploadedAvatarRoot) : null;
}

function ensureFallbackRigEditorPanel() {
  if (fallbackRigEditorPanelEl) return;

  const mountTarget = rigReportEl?.parentElement || previewEl?.parentElement || document.body;
  if (!mountTarget) return;

  const panel = document.createElement('section');
  panel.id = 'cc-fallback-rig-editor';
  panel.style.marginTop = '12px';
  panel.style.padding = '12px';
  panel.style.border = '1px solid rgba(255,255,255,0.16)';
  panel.style.borderRadius = '12px';
  panel.style.background = 'rgba(10, 14, 24, 0.66)';
  panel.style.backdropFilter = 'blur(8px)';

  const title = document.createElement('div');
  title.textContent = 'Fallback Rig Tuning';
  title.style.fontSize = '12px';
  title.style.fontWeight = '700';
  title.style.letterSpacing = '0.08em';
  title.style.textTransform = 'uppercase';
  title.style.marginBottom = '6px';
  panel.appendChild(title);

  const hint = document.createElement('div');
  hint.style.fontSize = '12px';
  hint.style.lineHeight = '1.4';
  hint.style.color = 'rgba(255,255,255,0.72)';
  hint.style.marginBottom = '10px';
  panel.appendChild(hint);
  fallbackRigEditorHintEl = hint;

  const fieldsWrap = document.createElement('div');
  fieldsWrap.style.display = 'grid';
  fieldsWrap.style.gridTemplateColumns = 'repeat(auto-fit, minmax(220px, 1fr))';
  fieldsWrap.style.gap = '8px 12px';
  panel.appendChild(fieldsWrap);

  FALLBACK_RIG_TUNE_FIELDS.forEach(({ key, label }) => {
    const row = document.createElement('label');
    row.style.display = 'grid';
    row.style.gap = '4px';

    const labelRow = document.createElement('div');
    labelRow.style.display = 'flex';
    labelRow.style.justifyContent = 'space-between';
    labelRow.style.alignItems = 'center';

    const labelEl = document.createElement('span');
    labelEl.textContent = label;
    labelEl.style.fontSize = '12px';

    const valueEl = document.createElement('span');
    valueEl.style.fontSize = '11px';
    valueEl.style.color = 'rgba(255,255,255,0.62)';

    const input = document.createElement('input');
    input.type = 'range';
    input.disabled = true;
    input.addEventListener('input', () => {
      const nextValue = Number.parseFloat(input.value);
      if (!Number.isFinite(nextValue)) return;
      fallbackRigState.metricOverrides[key] = nextValue;
      valueEl.textContent = nextValue.toFixed(3);
      scheduleFallbackRigRebuild();
    });

    labelRow.append(labelEl, valueEl);
    row.append(labelRow, input);
    fieldsWrap.appendChild(row);
    fallbackRigEditorInputs.set(key, { input, valueEl });
  });

  const actions = document.createElement('div');
  actions.style.display = 'flex';
  actions.style.justifyContent = 'flex-end';
  actions.style.marginTop = '10px';

  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.textContent = 'Reset Rig Tuning';
  resetBtn.style.padding = '7px 10px';
  resetBtn.style.borderRadius = '999px';
  resetBtn.style.border = '1px solid rgba(255,255,255,0.18)';
  resetBtn.style.background = 'rgba(255,255,255,0.06)';
  resetBtn.style.color = 'inherit';
  resetBtn.style.cursor = 'pointer';
  resetBtn.addEventListener('click', () => resetFallbackRigMetricOverrides());
  actions.appendChild(resetBtn);
  panel.appendChild(actions);

  mountTarget.appendChild(panel);
  fallbackRigEditorPanelEl = panel;
}

function syncFallbackRigEditorPanel() {
  ensureFallbackRigEditorPanel();
  if (!fallbackRigEditorPanelEl) return;

  const hasUploadedModel = !!uploadedAvatarRoot;
  const baseMetrics = getFallbackRigEditorBaseMetrics();
  const resolvedMetrics = baseMetrics
    ? applyFallbackRigMetricOverrides(baseMetrics, fallbackRigState.metricOverrides)
    : null;

  fallbackRigEditorPanelEl.style.display = hasUploadedModel ? '' : 'none';
  if (!hasUploadedModel) return;

  if (fallbackRigEditorHintEl) {
    fallbackRigEditorHintEl.textContent = fallbackRigState.active
      ? 'Editing the generated fallback skeleton. Changes rebuild the rig and are saved with this character profile.'
      : 'Enable Fallback Rebone to tune the generated skeleton for this uploaded model.';
  }

  const bounds = getFallbackRigMetricBounds(baseMetrics);
  fallbackRigEditorInputs.forEach(({ input, valueEl }, key) => {
    const bound = bounds[key];
    const currentValue = resolvedMetrics && Number.isFinite(resolvedMetrics[key])
      ? resolvedMetrics[key]
      : (baseMetrics && Number.isFinite(baseMetrics[key]) ? baseMetrics[key] : 0);
    input.disabled = !fallbackRigState.active || !bound;
    if (bound) {
      input.min = String(bound.min);
      input.max = String(bound.max);
      input.step = String(bound.step);
    }
    input.value = String(currentValue);
    valueEl.textContent = currentValue.toFixed(3);
  });
}

function rebuildFallbackRigFromOverrides(statusText = 'Fallback rig rebuilt with custom skeleton tuning.') {
  const sourceRoot = getFallbackRigSourceRoot();
  if (!sourceRoot) return false;

  const metricOverrides = { ...fallbackRigState.metricOverrides };
  stopRigWalkPreview({ restore: true });
  stopRigDancePreview({ restore: true });
  rigPoseState.active = false;
  clearUploadedRigHelper();
  clearFallbackRig();
  createFallbackRig(sourceRoot, { metricOverrides });
  applyBoneRotationOverrides();
  renderRigReport(fallbackRigState.report, 'fallback rebone');
  modelStatusEl.textContent = statusText;
  return true;
}

function scheduleFallbackRigRebuild() {
  syncFallbackRigEditorPanel();
  if (!fallbackRigState.active) return;
  window.clearTimeout(fallbackRigRebuildTimer);
  fallbackRigRebuildTimer = window.setTimeout(() => {
    rebuildFallbackRigFromOverrides();
  }, 60);
}

function setFallbackRigMetricOverride(key, value) {
  const baseMetrics = getFallbackRigEditorBaseMetrics() || fallbackRigState.baseMetrics;
  const bounds = getFallbackRigMetricBounds(baseMetrics);
  if (!baseMetrics || !(key in bounds) || !Number.isFinite(value)) return false;

  fallbackRigState.metricOverrides[key] = THREE.MathUtils.clamp(value, bounds[key].min, bounds[key].max);
  syncFallbackRigEditorPanel();
  if (fallbackRigState.active) {
    rebuildFallbackRigFromOverrides(`Fallback rig updated: ${key}.`);
  }
  return true;
}

function clearFallbackRigMetricOverride(key) {
  if (!(key in fallbackRigState.metricOverrides)) return false;
  delete fallbackRigState.metricOverrides[key];
  syncFallbackRigEditorPanel();
  if (fallbackRigState.active) {
    rebuildFallbackRigFromOverrides(`Fallback rig reset: ${key}.`);
  }
  return true;
}

function resetFallbackRigMetricOverrides() {
  fallbackRigState.metricOverrides = {};
  syncFallbackRigEditorPanel();
  if (fallbackRigState.active) {
    rebuildFallbackRigFromOverrides('Fallback rig tuning reset to auto-fit defaults.');
  }
}

function handleBoneSelection(event) {
  if (!fallbackRigState.helper || !fallbackRigState.bones) return;

  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);

  // Raycast against the skeleton helper
  const intersects = raycaster.intersectObject(fallbackRigState.helper);

  if (intersects.length > 0) {
    // Find the closest intersection and determine which bone it corresponds to
    const intersection = intersects[0];
    const closestBone = findClosestBoneToPoint(intersection.point);
    
    if (closestBone) {
      selectedBoneName = closestBone;
      syncBoneInspectorPanel();
    }
  }
}

function findClosestBoneToPoint(point) {
  let closestBone = null;
  let minDistance = Infinity;

  for (const [boneName, bone] of fallbackRigState.bones) {
    const worldPos = new THREE.Vector3();
    worldPos.setFromMatrixPosition(bone.matrixWorld);
    const distance = point.distanceTo(worldPos);
    
    if (distance < minDistance && distance < 0.3) { // Within 0.3 units
      minDistance = distance;
      closestBone = boneName;
    }
  }

  return closestBone;
}

function ensureBoneInspectorPanel() {
  if (boneInspectorPanelEl) return;

  const panel = document.createElement('div');
  panel.id = 'bone-inspector-panel';
  panel.style.position = 'fixed';
  panel.style.right = '20px';
  panel.style.top = '20px';
  panel.style.background = 'rgba(20, 20, 30, 0.95)';
  panel.style.border = '1px solid rgba(255, 255, 255, 0.1)';
  panel.style.borderRadius = '8px';
  panel.style.padding = '12px';
  panel.style.color = 'white';
  panel.style.fontFamily = 'monospace';
  panel.style.fontSize = '12px';
  panel.style.zIndex = '2000';
  panel.style.minWidth = '200px';
  panel.style.maxHeight = '400px';
  panel.style.overflowY = 'auto';
  panel.style.display = 'none';

  const title = document.createElement('div');
  title.style.fontWeight = 'bold';
  title.style.marginBottom = '8px';
  title.style.borderBottom = '1px solid rgba(255,255,255,0.1)';
  title.style.paddingBottom = '6px';
  panel.appendChild(title);

  const fields = document.createElement('div');
  fields.style.display = 'flex';
  fields.style.flexDirection = 'column';
  fields.style.gap = '8px';
  panel.appendChild(fields);

  // Rotation X, Y, Z inputs
  const inputs = {};
  ['x', 'y', 'z'].forEach((axis) => {
    const row = document.createElement('label');
    row.style.display = 'flex';
    row.style.justifyContent = 'space-between';
    row.style.alignItems = 'center';
    row.style.gap = '8px';

    const label = document.createElement('span');
    label.textContent = `Rot ${axis.toUpperCase()}:`;
    label.style.flex = '0 0 60px';

    const input = document.createElement('input');
    input.type = 'number';
    input.style.flex = '1';
    input.style.padding = '4px';
    input.style.background = 'rgba(255,255,255,0.05)';
    input.style.border = '1px solid rgba(255,255,255,0.15)';
    input.style.borderRadius = '4px';
    input.style.color = 'inherit';
    input.style.fontSize = 'inherit';
    input.step = '0.01';
    input.addEventListener('input', () => {
      updateBoneRotation(axis, parseFloat(input.value));
    });

    inputs[axis] = input;
    row.append(label, input);
    fields.appendChild(row);
  });

  const actions = document.createElement('div');
  actions.style.display = 'flex';
  actions.style.justifyContent = 'flex-end';
  actions.style.gap = '6px';
  actions.style.marginTop = '10px';
  actions.style.borderTop = '1px solid rgba(255,255,255,0.1)';
  actions.style.paddingTop = '8px';

  const resetBtn = document.createElement('button');
  resetBtn.textContent = 'Reset';
  resetBtn.style.padding = '4px 8px';
  resetBtn.style.borderRadius = '4px';
  resetBtn.style.border = '1px solid rgba(255,255,255,0.2)';
  resetBtn.style.background = 'rgba(255,255,255,0.06)';
  resetBtn.style.color = 'inherit';
  resetBtn.style.cursor = 'pointer';
  resetBtn.style.fontSize = 'inherit';
  resetBtn.addEventListener('click', () => resetBoneRotation());
  actions.appendChild(resetBtn);

  const closeBtn = document.createElement('button');
  closeBtn.textContent = 'Close';
  closeBtn.style.padding = '4px 8px';
  closeBtn.style.borderRadius = '4px';
  closeBtn.style.border = '1px solid rgba(255,255,255,0.2)';
  closeBtn.style.background = 'rgba(255,255,255,0.06)';
  closeBtn.style.color = 'inherit';
  closeBtn.style.cursor = 'pointer';
  closeBtn.style.fontSize = 'inherit';
  closeBtn.addEventListener('click', () => {
    selectedBoneName = null;
    syncBoneInspectorPanel();
  });
  actions.appendChild(closeBtn);

  panel.appendChild(actions);
  panel.title_el = title;
  panel.bone_inputs = inputs;
  document.body.appendChild(panel);
  boneInspectorPanelEl = panel;
}

function syncBoneInspectorPanel() {
  ensureBoneInspectorPanel();
  if (!boneInspectorPanelEl) return;

  if (!selectedBoneName) {
    boneInspectorPanelEl.style.display = 'none';
    removeBoneHighlight();
    return;
  }

  boneInspectorPanelEl.style.display = '';
  boneInspectorPanelEl.title_el.textContent = `Bone: ${selectedBoneName}`;

  const overrides = boneRotationOverrides[selectedBoneName] || { x: 0, y: 0, z: 0 };

  ['x', 'y', 'z'].forEach((axis) => {
    const input = boneInspectorPanelEl.bone_inputs[axis];
    if (input) {
      input.value = (overrides[axis] || 0).toFixed(4);
    }
  });

  updateBoneHighlight(selectedBoneName);
}

function updateBoneRotation(axis, value) {
  if (!selectedBoneName || !Number.isFinite(value)) return;

  if (!boneRotationOverrides[selectedBoneName]) {
    boneRotationOverrides[selectedBoneName] = { x: 0, y: 0, z: 0 };
  }

  boneRotationOverrides[selectedBoneName][axis] = value;

  // During active previews, animated pose is rebuilt every frame and manual
  // offsets are applied there instead of directly writing base rotations.
  if (isRigPreviewActive()) {
    previewBoneOverrideDirty = true;
    return;
  }

  // Apply rotation to the bone immediately when previews are idle.
  const bone = fallbackRigState.bones.get(selectedBoneName);
  if (bone) {
    const rot = boneRotationOverrides[selectedBoneName];
    bone.rotation.set(rot.x, rot.y, rot.z, 'XYZ');
  }
}

function isRigPreviewActive() {
  return rigWalkState.active || rigDanceState.active || rigPoseState.active || rigIdleState.active;
}

function getBoneOverrideForPose(slot, bone) {
  if (slot && boneRotationOverrides[slot]) return boneRotationOverrides[slot];
  if (bone && bone.name && boneRotationOverrides[bone.name]) return boneRotationOverrides[bone.name];
  return null;
}

function applyBoneOverrideToAnimatedPose(slot, bone) {
  const override = getBoneOverrideForPose(slot, bone);
  if (!override || !bone) return;
  const offsetQuat = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(override.x || 0, override.y || 0, override.z || 0, 'XYZ')
  );
  bone.quaternion.multiply(offsetQuat);
}

function removeBoneHighlight() {
  if (fallbackRigState.selectedBoneHighlight) {
    // Remove from parent (the bone it was attached to)
    if (fallbackRigState.selectedBoneHighlight.parent) {
      fallbackRigState.selectedBoneHighlight.parent.remove(fallbackRigState.selectedBoneHighlight);
    }
    if (fallbackRigState.selectedBoneHighlight.material?.dispose) {
      fallbackRigState.selectedBoneHighlight.material.dispose();
    }
    if (fallbackRigState.selectedBoneHighlight.geometry?.dispose) {
      fallbackRigState.selectedBoneHighlight.geometry.dispose();
    }
    fallbackRigState.selectedBoneHighlight = null;
  }
}

function updateBoneHighlight(boneName) {
  removeBoneHighlight();

  const bone = fallbackRigState.bones.get(boneName);
  if (!bone) return;

  // Create a red wireframe box as highlight
  const geometry = new THREE.SphereGeometry(0.08, 16, 16);
  const material = new THREE.MeshBasicMaterial({
    color: 0xff3333,
    emissive: 0xff6666,
    transparent: true,
    opacity: 0.8,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });

  const highlight = new THREE.Mesh(geometry, material);
  highlight.renderOrder = 1001;
  bone.add(highlight);

  fallbackRigState.selectedBoneHighlight = highlight;
}

function resetBoneRotation() {
  if (!selectedBoneName) return;

  const bone = fallbackRigState.bones.get(selectedBoneName);
  if (bone) {
    bone.rotation.set(0, 0, 0, 'XYZ');
  }

  delete boneRotationOverrides[selectedBoneName];
  syncBoneInspectorPanel();
  updateBoneHighlight(selectedBoneName);
}

function applyBoneRotationOverrides() {
  for (const [boneName, rotation] of Object.entries(boneRotationOverrides)) {
    const bone = fallbackRigState.bones.get(boneName);
    if (bone && rotation && typeof rotation === 'object') {
      bone.rotation.set(rotation.x || 0, rotation.y || 0, rotation.z || 0, 'XYZ');
    }
  }
}

function clearBoneRotationOverrides() {
  // Reset all bone rotations to zero
  if (fallbackRigState && fallbackRigState.bones) {
    fallbackRigState.bones.forEach((bone) => {
      bone.rotation.set(0, 0, 0, 'XYZ');
    });
  }
  
  removeBoneHighlight();
  boneRotationOverrides = {};
  selectedBoneName = null;
  syncBoneInspectorPanel();
  
  // Update the rig report to reflect the cleared state
  if (rigReportEl) {
    rigReportEl.textContent += '\n✓ All bone rotations cleared.';
  }
}

const randomNames = [
  'Nyx Emberveil',
  'Kael Ironbloom',
  'Mira Starwatch',
  'Theron Duskhand',
  'Sera Frostsigil',
  'Bram Ashborn',
];

const auraPalette = ['#7f6bff', '#29b6f6', '#00c853', '#f9a825', '#ef5350', '#ec407a'];

function toggleOtherInput(selectEl, otherEl) {
  const show = selectEl.value === '__other__';
  otherEl.classList.toggle('show', show);
}

function resolvedSelectValue(selectEl, otherEl, fallback) {
  if (!selectEl) return fallback;
  if (selectEl.value !== '__other__') return selectEl.value || fallback;
  const custom = ((otherEl && otherEl.value) || '').trim();
  return custom || fallback;
}

function setSelectOrOther(selectEl, otherEl, value) {
  const normalized = (value || '').trim();
  if (!normalized) {
    selectEl.selectedIndex = 0;
    otherEl.value = '';
    toggleOtherInput(selectEl, otherEl);
    return;
  }
  const hasOption = Array.from(selectEl.options).some((opt) => opt.value === normalized || opt.text === normalized);
  if (hasOption) {
    selectEl.value = normalized;
    otherEl.value = '';
  } else {
    selectEl.value = '__other__';
    otherEl.value = normalized;
  }
  toggleOtherInput(selectEl, otherEl);
}

function setProceduralAvatarVisible(visible) {
  const proceduralMeshes = [
    avatarTorso, avatarShoulders, avatarCloak, avatarHead, avatarHair,
    leftEye, rightEye, avatarOrb, leftArm, rightArm, leftLeg, rightLeg,
    boots, auraRing,
  ];
  proceduralMeshes.forEach((mesh) => {
    mesh.visible = visible;
  });
}

function tokenizeBoneName(name) {
  return (name || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function normalizedBoneName(name) {
  return tokenizeBoneName(name).join('');
}

function findParentBone(bone) {
  let parent = bone ? bone.parent : null;
  while (parent && !parent.isBone) {
    parent = parent.parent;
  }
  return parent && parent.isBone ? parent : null;
}

function hasPropBoneHint(name) {
  const key = (name || '').toLowerCase();
  return /(hammer|weapon|sword|axe|mace|club|staff|wand|shield|prop|item|gear)/.test(key);
}

function resolveSlotFromNearestMappedBone(sourceBone, mappedSlotBones, preferredSlots = []) {
  if (!sourceBone || !Array.isArray(mappedSlotBones) || !mappedSlotBones.length) return null;
  const sourcePos = sourceBone.getWorldPosition(new THREE.Vector3());
  const preferred = new Set(preferredSlots);
  let bestSlot = null;
  let bestScore = Number.POSITIVE_INFINITY;

  mappedSlotBones.forEach(({ slot, bone }) => {
    if (!slot || !bone) return;
    const distSq = sourcePos.distanceToSquared(bone.getWorldPosition(new THREE.Vector3()));
    const score = distSq * (preferred.has(slot) ? 0.72 : 1);
    if (score < bestScore) {
      bestScore = score;
      bestSlot = slot;
    }
  });

  return bestSlot;
}

function isBoneDescendant(candidateBone, ancestorBone) {
  let current = candidateBone ? candidateBone.parent : null;
  while (current) {
    if (current === ancestorBone) return true;
    current = current.parent;
  }
  return false;
}

function detectBoneSide(name, worldX = 0) {
  const tokens = tokenizeBoneName(name);
  if (tokens.includes('left') || tokens.includes('l')) return 'left';
  if (tokens.includes('right') || tokens.includes('r')) return 'right';
  if (worldX < -0.04) return 'left';
  if (worldX > 0.04) return 'right';
  return 'center';
}

function scoreBoneName(meta, profile) {
  let score = 0;

  for (const alias of profile.aliases || []) {
    const normalizedAlias = normalizedBoneName(alias);
    if (!normalizedAlias) continue;
    if (meta.key === normalizedAlias) {
      score = Math.max(score, 140);
      continue;
    }
    if (meta.key.endsWith(normalizedAlias) || meta.key.includes(normalizedAlias)) {
      score = Math.max(score, 112);
    }
  }

  for (const keyword of profile.keywords || []) {
    const normalizedKeyword = normalizedBoneName(keyword);
    if (!normalizedKeyword) continue;
    if (meta.key.includes(normalizedKeyword)) {
      score += 18;
    }
  }

  for (const excluded of profile.excludeKeywords || []) {
    const normalizedExcluded = normalizedBoneName(excluded);
    if (normalizedExcluded && meta.key.includes(normalizedExcluded)) {
      score -= 34;
    }
  }

  return score;
}

function scoreBonePosition(meta, profile, stats) {
  let score = 0;

  if (typeof profile.targetY === 'number' && stats.height > 0.001) {
    const yDelta = Math.abs(meta.yNormalized - profile.targetY);
    score += Math.max(0, 28 - yDelta * 55);
  }

  if (profile.minX) {
    const xStrength = stats.maxAbsX > 0.001 ? Math.abs(meta.worldPos.x) / stats.maxAbsX : 0;
    if (xStrength >= profile.minX) {
      score += 16;
    } else {
      score -= 16;
    }
  }

  if (profile.minChildren && meta.childBoneCount >= profile.minChildren) {
    score += 10;
  }

  if (profile.endBone && meta.childBoneCount === 0) {
    score += 10;
  }

  return score;
}

function scoreBoneForSlot(meta, slot, profile, stats) {
  let score = scoreBoneName(meta, profile) + scoreBonePosition(meta, profile, stats);

  if (profile.side === 'left') {
    score += meta.side === 'left' ? 22 : meta.side === 'right' ? -56 : -8;
  } else if (profile.side === 'right') {
    score += meta.side === 'right' ? 22 : meta.side === 'left' ? -56 : -8;
  } else if (profile.side === 'center') {
    score += meta.side === 'center' ? 10 : -10;
  }

  if (slot === 'head' && meta.yNormalized > 0.9) score += 14;
  if ((slot === 'leftHand' || slot === 'rightHand') && Math.abs(meta.worldPos.x) > stats.maxAbsX * 0.55) score += 12;
  if ((slot === 'leftFoot' || slot === 'rightFoot') && meta.yNormalized < 0.12) score += 14;
  if ((slot === 'hips' || slot === 'spine' || slot === 'chest') && Math.abs(meta.worldPos.x) < stats.maxAbsX * 0.22) score += 8;

  return score;
}

function slotExpectedSide(slot) {
  if (slot.startsWith('left')) return 'left';
  if (slot.startsWith('right')) return 'right';
  return 'center';
}

function chooseMirroredSlotCandidate(sourceMatch, targetSlot, matchedSlots, candidateMap, stats) {
  if (!sourceMatch) return null;

  const reservedBones = new Set(
    Object.entries(matchedSlots)
      .filter(([slot]) => slot !== targetSlot)
      .map(([, match]) => match.meta.bone.uuid)
  );

  const expectedSide = slotExpectedSide(targetSlot);
  const targetX = -sourceMatch.meta.worldPos.x;
  const targetY = sourceMatch.meta.yNormalized;

  const best = candidateMap[targetSlot]
    .filter((candidate) => !reservedBones.has(candidate.meta.bone.uuid) && candidate.score >= 28)
    .map((candidate) => {
      let symmetryScore = candidate.score;
      const xDelta = Math.abs(candidate.meta.worldPos.x - targetX);
      const yDelta = Math.abs(candidate.meta.yNormalized - targetY);

      if (candidate.meta.side === expectedSide) {
        symmetryScore += 26;
      } else if (candidate.meta.side !== 'center') {
        symmetryScore -= 90;
      }

      symmetryScore += Math.max(0, 24 - (xDelta / Math.max(stats.maxAbsX * 2, 0.001)) * 40);
      symmetryScore += Math.max(0, 16 - yDelta * 80);

      if (sourceMatch.meta.parentBone && candidate.meta.parentBone && sourceMatch.meta.parentBone === candidate.meta.parentBone) {
        symmetryScore += 12;
      }

      if (sourceMatch.meta.childBoneCount === candidate.meta.childBoneCount) {
        symmetryScore += 6;
      }

      return { candidate, symmetryScore };
    })
    .sort((a, b) => b.symmetryScore - a.symmetryScore)[0];

  return best ? best.candidate : null;
}

function classifyRigReport(report) {
  if (!report.skinnedMeshCount) {
    return {
      label: 'No skinned mesh detected',
      color: '#ff8d8d',
      usable: false,
    };
  }

  if (report.essentialCoverage >= 100 && report.coverage >= 65) {
    return {
      label: 'Game-ready rig',
      color: '#7ee0a2',
      usable: true,
    };
  }

  if (report.essentialCoverage >= 67 && report.coverage >= 45) {
    return {
      label: 'Usable with forgiving mapping',
      color: '#f7d774',
      usable: true,
    };
  }

  if (report.coverage >= 25) {
    return {
      label: 'Partial rig detected',
      color: '#ffb4a2',
      usable: false,
    };
  }

  return {
    label: 'Rig not understood well enough',
    color: '#ff8d8d',
    usable: false,
  };
}

function analyzeRig(root) {
  const bones = [];
  let skinnedMeshCount = 0;

  root.updateMatrixWorld(true);
  root.traverse((obj) => {
    if (obj.isBone) bones.push(obj);
    if (obj.isSkinnedMesh) skinnedMeshCount += 1;
  });

  if (!bones.length) {
    const emptyReport = {
      boneCount: 0,
      skinnedMeshCount,
      foundCount: 0,
      requiredCount: Object.keys(RIG_SLOT_PROFILES).length,
      coverage: 0,
      essentialFound: 0,
      essentialCount: RIG_ESSENTIAL_SLOTS.length,
      essentialCoverage: 0,
      missing: Object.keys(RIG_SLOT_PROFILES),
      mapping: {},
      confidences: {},
    };
    emptyReport.classification = classifyRigReport(emptyReport);
    return emptyReport;
  }

  const worldPositions = bones.map((bone) => {
    const worldPos = new THREE.Vector3();
    bone.getWorldPosition(worldPos);
    return worldPos;
  });

  const minY = Math.min(...worldPositions.map((pos) => pos.y));
  const maxY = Math.max(...worldPositions.map((pos) => pos.y));
  const height = Math.max(maxY - minY, 0.001);
  const maxAbsX = Math.max(...worldPositions.map((pos) => Math.abs(pos.x)), 0.001);
  const stats = { minY, maxY, height, maxAbsX };

  const metas = bones.map((bone, index) => {
    const worldPos = worldPositions[index];
    const parentBone = findParentBone(bone);
    const childBoneCount = bone.children.filter((child) => child && child.isBone).length;

    return {
      bone,
      worldPos,
      key: normalizedBoneName(bone.name),
      side: detectBoneSide(bone.name, worldPos.x),
      childBoneCount,
      parentBone,
      yNormalized: (worldPos.y - minY) / height,
    };
  });

  const candidateMap = {};
  for (const [slot, profile] of Object.entries(RIG_SLOT_PROFILES)) {
    candidateMap[slot] = metas
      .map((meta) => ({ meta, score: scoreBoneForSlot(meta, slot, profile, stats) }))
      .sort((a, b) => b.score - a.score);
  }

  const matchedSlots = {};
  const usedBones = new Set();
  const slotOrder = Object.keys(RIG_SLOT_PROFILES)
    .sort((a, b) => (candidateMap[b][0]?.score || -Infinity) - (candidateMap[a][0]?.score || -Infinity));

  for (const slot of slotOrder) {
    const choice = candidateMap[slot].find((candidate) => !usedBones.has(candidate.meta.bone.uuid) && candidate.score >= 48);
    if (!choice) continue;
    matchedSlots[slot] = choice;
    usedBones.add(choice.meta.bone.uuid);
  }

  for (const [parentSlot, childSlot] of RIG_CHAIN_FALLBACKS) {
    const parentMatch = matchedSlots[parentSlot];
    const childMatch = matchedSlots[childSlot];

    if (parentMatch && !childMatch) {
      const descendant = candidateMap[childSlot].find((candidate) => (
        !usedBones.has(candidate.meta.bone.uuid)
        && candidate.score >= 28
        && isBoneDescendant(candidate.meta.bone, parentMatch.meta.bone)
      ));
      if (descendant) {
        matchedSlots[childSlot] = descendant;
        usedBones.add(descendant.meta.bone.uuid);
      }
    }

    if (!parentMatch && childMatch) {
      const ancestor = candidateMap[parentSlot].find((candidate) => (
        !usedBones.has(candidate.meta.bone.uuid)
        && candidate.score >= 28
        && isBoneDescendant(childMatch.meta.bone, candidate.meta.bone)
      ));
      if (ancestor) {
        matchedSlots[parentSlot] = ancestor;
        usedBones.add(ancestor.meta.bone.uuid);
      }
    }
  }

  for (const [leftSlot, rightSlot] of RIG_MIRROR_SLOT_PAIRS) {
    let leftMatch = matchedSlots[leftSlot];
    let rightMatch = matchedSlots[rightSlot];

    if (leftMatch && rightMatch && leftMatch.meta.worldPos.x > rightMatch.meta.worldPos.x) {
      matchedSlots[leftSlot] = rightMatch;
      matchedSlots[rightSlot] = leftMatch;
      leftMatch = matchedSlots[leftSlot];
      rightMatch = matchedSlots[rightSlot];
    }

    const leftValid = leftMatch && leftMatch.meta.worldPos.x <= 0;
    const rightValid = rightMatch && rightMatch.meta.worldPos.x >= 0;

    let anchorSlot = null;
    if (leftValid && !rightValid) {
      anchorSlot = leftSlot;
    } else if (rightValid && !leftValid) {
      anchorSlot = rightSlot;
    } else if (leftMatch && !rightMatch) {
      anchorSlot = leftSlot;
    } else if (rightMatch && !leftMatch) {
      anchorSlot = rightSlot;
    } else if (leftMatch && rightMatch) {
      anchorSlot = leftMatch.score >= rightMatch.score ? leftSlot : rightSlot;
    }

    if (!anchorSlot) continue;

    const targetSlot = anchorSlot === leftSlot ? rightSlot : leftSlot;
    const currentTarget = matchedSlots[targetSlot];
    const targetValid = currentTarget && (
      (targetSlot === leftSlot && currentTarget.meta.worldPos.x <= 0)
      || (targetSlot === rightSlot && currentTarget.meta.worldPos.x >= 0)
    );
    const mirroredCandidate = chooseMirroredSlotCandidate(matchedSlots[anchorSlot], targetSlot, matchedSlots, candidateMap, stats);

    if (mirroredCandidate && (!currentTarget || !targetValid || mirroredCandidate.score > currentTarget.score + 8)) {
      matchedSlots[targetSlot] = mirroredCandidate;
    }

    leftMatch = matchedSlots[leftSlot];
    rightMatch = matchedSlots[rightSlot];
    if (leftMatch && rightMatch && leftMatch.meta.worldPos.x > rightMatch.meta.worldPos.x) {
      matchedSlots[leftSlot] = rightMatch;
      matchedSlots[rightSlot] = leftMatch;
    }
  }

  const mapping = {};
  const confidences = {};
  for (const [slot, match] of Object.entries(matchedSlots)) {
    mapping[slot] = match.meta.bone.name || slot;
    confidences[slot] = Math.round(match.score);
  }

  const missing = Object.keys(RIG_SLOT_PROFILES).filter((slot) => !mapping[slot]);
  const foundCount = Object.keys(mapping).length;
  const requiredCount = Object.keys(RIG_SLOT_PROFILES).length;
  const coverage = Math.round((foundCount / requiredCount) * 100);
  const essentialFound = RIG_ESSENTIAL_SLOTS.filter((slot) => mapping[slot]).length;
  const essentialCoverage = Math.round((essentialFound / RIG_ESSENTIAL_SLOTS.length) * 100);

  const report = {
    boneCount: bones.length,
    skinnedMeshCount,
    foundCount,
    requiredCount,
    coverage,
    essentialFound,
    essentialCount: RIG_ESSENTIAL_SLOTS.length,
    essentialCoverage,
    missing,
    mapping,
    confidences,
  };
  report.classification = classifyRigReport(report);
  return report;
}

function renderRigReport(report, source = 'upload') {
  if (!rigReportEl) return;

  latestRigReport = report;

  if (!report) {
    rigReportEl.textContent = 'Rig report: procedural avatar (not a skinned upload).';
    rigReportEl.style.color = '#8892b0';
    return;
  }

  rigReportEl.style.color = report.classification.color;

  const lines = [
    `Rig report (${source})`,
    `Status: ${report.classification.label}`,
    `Skinned meshes: ${report.skinnedMeshCount}`,
    `Bones: ${report.boneCount}`,
    `Coverage: ${report.foundCount}/${report.requiredCount} (${report.coverage}%)`,
    `Essential: ${report.essentialFound}/${report.essentialCount} (${report.essentialCoverage}%)`,
  ];

  if (report.missing.length) {
    lines.push(`Missing: ${report.missing.join(', ')}`);
  } else {
    lines.push('Missing: none');
  }

  const summarySlots = ['hips', 'head', 'leftHand', 'rightHand', 'leftFoot', 'rightFoot']
    .filter((slot) => report.mapping[slot])
    .map((slot) => `${slot}=${report.mapping[slot]}`);
  if (summarySlots.length) {
    lines.push(`Resolved: ${summarySlots.join(' | ')}`);
  }

  rigReportEl.textContent = lines.join('\n');
}

function showRigDiagnostics() {
  if (!rigReportEl) return;

  const diagnostics = getRuntimeRetargetDiagnostics();
  const lines = [];

  if (latestRigReport) {
    lines.push('Rig diagnostics');
    lines.push(`Status: ${latestRigReport.classification.label}`);
    lines.push(`Coverage: ${latestRigReport.foundCount}/${latestRigReport.requiredCount} (${latestRigReport.coverage}%)`);
  } else {
    lines.push('Rig diagnostics');
    lines.push('Status: procedural avatar or no upload loaded');
  }

  lines.push(`Retarget active: ${diagnostics.active ? 'yes' : 'no'}`);
  lines.push(`Retarget pairs: ${diagnostics.pairCount}`);
  lines.push(`Weighted pairs: ${diagnostics.weightedPairCount}`);
  lines.push(`Mesh rebind active: ${diagnostics.meshRebind.active ? 'yes' : 'no'}`);
  lines.push(`Rebound meshes: ${diagnostics.meshRebind.meshCount}`);
  lines.push(`Remapped influences: ${diagnostics.meshRebind.remappedInfluences}`);
  lines.push(`Auto-weighted meshes: ${diagnostics.meshRebind.autoWeightedMeshes}`);
  lines.push(`Converted plain meshes: ${diagnostics.meshRebind.convertedMeshes}`);
  lines.push(`Rotation strength: ${diagnostics.controls.rotationStrength.toFixed(2)}`);
  lines.push(`Hips position strength: ${diagnostics.controls.hipsPositionStrength.toFixed(2)}`);
  lines.push(`Min influence weight: ${diagnostics.controls.minInfluenceWeight}`);

  const overrideEntries = Object.entries(diagnostics.slotTargetOverrides);
  if (overrideEntries.length) {
    lines.push(`Overrides: ${overrideEntries.map(([slot, bone]) => `${slot}=${bone}`).join(' | ')}`);
  } else {
    lines.push('Overrides: none');
  }

  if (diagnostics.unresolvedSlots.length) {
    lines.push(`Unresolved slots: ${diagnostics.unresolvedSlots.join(', ')}`);
  } else {
    lines.push('Unresolved slots: none');
  }

  rigReportEl.style.color = diagnostics.meshRebind.active ? '#8cd7ff' : diagnostics.active ? '#7ee0a2' : '#f6c177';
  rigReportEl.textContent = lines.join('\n');
  modelStatusEl.textContent = diagnostics.meshRebind.active
    ? diagnostics.meshRebind.autoWeightedMeshes > 0
      ? 'Rig diagnostics loaded. Mesh uses fallback procedural auto-weight skinning.'
      : 'Rig diagnostics loaded. Mesh is bound to the fallback skeleton.'
    : diagnostics.active
      ? 'Rig diagnostics loaded. Runtime retarget is active.'
      : 'Rig diagnostics loaded. No active runtime rebind or retarget layer.';
}

function updateRigReboneButton() {
  if (!rigReboneBtn) return;
  rigReboneBtn.textContent = fallbackRigState.active ? 'Use Imported Bones' : 'Use Fallback Rebone';
}

function clearUploadedRigHelper() {
  if (!uploadedRigHelper) return;
  scene.remove(uploadedRigHelper);
  if (uploadedRigHelper.material && typeof uploadedRigHelper.material.dispose === 'function') {
    uploadedRigHelper.material.dispose();
  }
  uploadedRigHelper = null;
}

function showUploadedRigHelper(root) {
  clearUploadedRigHelper();
  if (!root) return;

  const helper = new THREE.SkeletonHelper(root);
  helper.frustumCulled = false;
  helper.renderOrder = 999;
  helper.material.depthTest = false;
  helper.material.depthWrite = false;
  helper.material.transparent = true;
  helper.material.opacity = 0.95;
  helper.material.toneMapped = false;
  helper.material.color.setHex(0x7ee0a2);
  helper.material.linewidth = 3;
  scene.add(helper);
  uploadedRigHelper = helper;
}

function clearFallbackRig() {
  clearRuntimeMeshRebind({ restore: true });
  clearRuntimeRetargetLayer({ restoreTargets: true });
  removeBoneHighlight();
  selectedBoneName = null;
  if (fallbackRigState.helper) {
    scene.remove(fallbackRigState.helper);
    if (fallbackRigState.helper.material && typeof fallbackRigState.helper.material.dispose === 'function') {
      fallbackRigState.helper.material.dispose();
    }
  }
  if (fallbackRigState.root) avatar.remove(fallbackRigState.root);
  fallbackRigState.active = false;
  fallbackRigState.root = null;
  fallbackRigState.helper = null;
  fallbackRigState.sourceRoot = null;
  fallbackRigState.baseMetrics = null;
  fallbackRigState.resolvedMetrics = null;
  fallbackRigState.bones.clear();
  fallbackRigState.report = null;
  updateRigReboneButton();
  syncFallbackRigEditorPanel();
}

function restoreRuntimeRetargetTargets() {
  if (!runtimeRetargetState.active) return;

  runtimeRetargetState.pairs.forEach((pair) => {
    pair.targetBone.quaternion.copy(pair.targetBaseQuat);
    if (pair.slot === 'hips') {
      pair.targetBone.position.copy(pair.targetBasePos);
    }
  });

  if (uploadedAvatarRoot) uploadedAvatarRoot.updateMatrixWorld(true);
}

function clearRuntimeRetargetLayer({ restoreTargets = false } = {}) {
  if (restoreTargets) restoreRuntimeRetargetTargets();
  runtimeRetargetState.active = false;
  runtimeRetargetState.pairs = [];
}

function captureRuntimeRetargetBasePose() {
  if (!runtimeRetargetState.active) return;

  runtimeRetargetState.pairs.forEach((pair) => {
    pair.driverBaseQuat.copy(pair.driverBone.quaternion);
    pair.targetBaseQuat.copy(pair.targetBone.quaternion);
    if (pair.slot === 'hips') {
      pair.driverBasePos.copy(pair.driverBone.position);
      pair.targetBasePos.copy(pair.targetBone.position);
    }
  });
}

function collectSkinnedBoneUsage(root) {
  const influenceByBoneUuid = new Map();
  const bonesByUuid = new Map();
  const skeletonBonesById = new Map();

  root.traverse((obj) => {
    if (!obj.isSkinnedMesh || !obj.skeleton || !obj.geometry) return;
    const { skeleton } = obj;
    const skeletonId = skeleton.uuid;
    const boneList = skeletonBonesById.get(skeletonId) || [];

    skeleton.bones.forEach((bone, boneIndex) => {
      if (!bone) return;
      bonesByUuid.set(bone.uuid, bone);
      if (!boneList.includes(bone)) boneList.push(bone);
      if (!influenceByBoneUuid.has(bone.uuid)) influenceByBoneUuid.set(bone.uuid, 0);
      if (!influenceByBoneUuid.has(`${skeletonId}:${boneIndex}`)) influenceByBoneUuid.set(`${skeletonId}:${boneIndex}`, 0);
    });
    skeletonBonesById.set(skeletonId, boneList);

    const skinIndex = obj.geometry.getAttribute('skinIndex');
    const skinWeight = obj.geometry.getAttribute('skinWeight');
    if (!skinIndex || !skinWeight) return;

    for (let i = 0; i < skinWeight.count; i += 1) {
      const i0 = skinIndex.getX(i);
      const i1 = skinIndex.getY(i);
      const i2 = skinIndex.getZ(i);
      const i3 = skinIndex.getW(i);
      const w0 = skinWeight.getX(i);
      const w1 = skinWeight.getY(i);
      const w2 = skinWeight.getZ(i);
      const w3 = skinWeight.getW(i);
      const entries = [[i0, w0], [i1, w1], [i2, w2], [i3, w3]];

      entries.forEach(([boneIndex, weight]) => {
        if (!Number.isFinite(weight) || weight <= 0 || boneIndex < 0 || boneIndex >= skeleton.bones.length) return;
        const key = `${skeletonId}:${boneIndex}`;
        influenceByBoneUuid.set(key, (influenceByBoneUuid.get(key) || 0) + weight);
      });
    }
  });

  // Merge skeleton-index weights onto stable bone UUID keys.
  skeletonBonesById.forEach((bones, skeletonId) => {
    bones.forEach((bone, boneIndex) => {
      const key = `${skeletonId}:${boneIndex}`;
      const amount = influenceByBoneUuid.get(key) || 0;
      influenceByBoneUuid.set(bone.uuid, (influenceByBoneUuid.get(bone.uuid) || 0) + amount);
    });
  });

  return { influenceByBoneUuid, bonesByUuid, skeletonBonesById };
}

function hierarchyDistance(a, b) {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  if (a === b) return 0;

  const fromA = new Map();
  let cur = a;
  let dist = 0;
  while (cur) {
    fromA.set(cur.uuid, { node: cur, dist });
    cur = findParentBone(cur);
    dist += 1;
  }

  cur = b;
  dist = 0;
  while (cur) {
    const hit = fromA.get(cur.uuid);
    if (hit) return hit.dist + dist;
    cur = findParentBone(cur);
    dist += 1;
  }

  return Number.POSITIVE_INFINITY;
}

function resolveRetargetTargetBone(slot, mappedBone, usage) {
  if (!mappedBone || !usage) return null;

  const overrideName = runtimeRetargetState.slotTargetOverrides.get(slot);
  if (overrideName) {
    const overrideBone = getRigBone(uploadedAvatarRoot, overrideName);
    if (overrideBone) return overrideBone;
  }

  const minWeight = runtimeRetargetState.controls.minInfluenceWeight;
  const mappedWeight = usage.influenceByBoneUuid.get(mappedBone.uuid) || 0;
  if (mappedWeight >= minWeight) return mappedBone;

  let best = null;
  let bestScore = Number.POSITIVE_INFINITY;
  usage.skeletonBonesById.forEach((bones) => {
    if (!bones.includes(mappedBone)) return;
    bones.forEach((candidate) => {
      const candidateWeight = usage.influenceByBoneUuid.get(candidate.uuid) || 0;
      if (candidateWeight < minWeight) return;
      const dist = hierarchyDistance(mappedBone, candidate);
      const score = dist * 1000 - candidateWeight;
      if (score < bestScore) {
        best = candidate;
        bestScore = score;
      }
    });
  });

  return best || mappedBone;
}

function setRuntimeRetargetControls(partial = {}) {
  const controls = runtimeRetargetState.controls;
  if (typeof partial.rotationStrength === 'number') {
    controls.rotationStrength = THREE.MathUtils.clamp(partial.rotationStrength, 0, 1);
  }
  if (typeof partial.hipsPositionStrength === 'number') {
    controls.hipsPositionStrength = THREE.MathUtils.clamp(partial.hipsPositionStrength, 0, 1);
  }
  if (typeof partial.minInfluenceWeight === 'number') {
    controls.minInfluenceWeight = THREE.MathUtils.clamp(partial.minInfluenceWeight, 0, 0.01);
  }
  return { ...controls };
}

function setRuntimeRetargetSlotTarget(slot, boneName) {
  if (!RIG_SLOT_PROFILES[slot]) return false;
  if (!boneName) {
    runtimeRetargetState.slotTargetOverrides.delete(slot);
  } else {
    runtimeRetargetState.slotTargetOverrides.set(slot, boneName);
  }

  if (fallbackRigState.active) {
    setupRuntimeRetargetLayer();
  }
  return true;
}

function getRuntimeRetargetDiagnostics() {
  return {
    active: runtimeRetargetState.active,
    pairCount: runtimeRetargetState.diagnostics.pairCount,
    weightedPairCount: runtimeRetargetState.diagnostics.weightedPairCount,
    unresolvedSlots: [...runtimeRetargetState.diagnostics.unresolvedSlots],
    controls: { ...runtimeRetargetState.controls },
    slotTargetOverrides: Object.fromEntries(runtimeRetargetState.slotTargetOverrides.entries()),
    meshRebind: {
      active: runtimeRebindState.active,
      meshCount: runtimeRebindState.stats.meshCount,
      remappedInfluences: runtimeRebindState.stats.remappedInfluences,
      autoWeightedMeshes: runtimeRebindState.stats.autoWeightedMeshes,
      convertedMeshes: runtimeRebindState.stats.convertedMeshes,
    },
  };
}

function buildSavedRigSettings() {
  return {
    version: 2,
    useFallbackRig: !!fallbackRigState.active,
    mapping: latestImportedRigReport?.mapping ? { ...latestImportedRigReport.mapping } : {},
    controls: { ...runtimeRetargetState.controls },
    slotTargetOverrides: Object.fromEntries(runtimeRetargetState.slotTargetOverrides.entries()),
    metricOverrides: { ...fallbackRigState.metricOverrides },
    boneRotationOverrides: { ...boneRotationOverrides },
  };
}

function setupRuntimeRetargetLayer() {
  clearRuntimeRetargetLayer({ restoreTargets: false });
  runtimeRetargetState.diagnostics.pairCount = 0;
  runtimeRetargetState.diagnostics.weightedPairCount = 0;
  runtimeRetargetState.diagnostics.unresolvedSlots = [];

  if (!fallbackRigState.active || !uploadedAvatarRoot || !latestImportedRigReport) {
    return false;
  }

  const usage = collectSkinnedBoneUsage(uploadedAvatarRoot);
  const pairs = [];
  const unresolved = [];
  for (const slot of Object.keys(RIG_SLOT_PROFILES)) {
    const driverBone = fallbackRigState.bones.get(slot);
    const mappedName = latestImportedRigReport.mapping[slot];
    const mappedBone = getRigBone(uploadedAvatarRoot, mappedName);
    const targetBone = resolveRetargetTargetBone(slot, mappedBone, usage);
    if (!driverBone || !targetBone) continue;

    const resolvedWeight = usage.influenceByBoneUuid.get(targetBone.uuid) || 0;
    if (resolvedWeight < runtimeRetargetState.controls.minInfluenceWeight) {
      unresolved.push(slot);
      continue;
    }

    pairs.push({
      slot,
      driverBone,
      targetBone,
      targetWeight: resolvedWeight,
      driverBaseQuat: driverBone.quaternion.clone(),
      targetBaseQuat: targetBone.quaternion.clone(),
      driverBasePos: driverBone.position.clone(),
      targetBasePos: targetBone.position.clone(),
    });
  }

  runtimeRetargetState.diagnostics.unresolvedSlots = unresolved;
  if (!pairs.length) return false;

  runtimeRetargetState.active = true;
  runtimeRetargetState.pairs = pairs;
  runtimeRetargetState.diagnostics.pairCount = pairs.length;
  runtimeRetargetState.diagnostics.weightedPairCount = pairs.filter((p) => p.targetWeight > 0).length;
  return true;
}

function applyRuntimeRetargetLayer() {
  if (!runtimeRetargetState.active) return;
  const rotStrength = runtimeRetargetState.controls.rotationStrength;
  const posStrength = runtimeRetargetState.controls.hipsPositionStrength;

  runtimeRetargetState.pairs.forEach((pair) => {
    _retargetDeltaQuat.copy(pair.driverBaseQuat).invert().multiply(pair.driverBone.quaternion);
    _retargetTargetQuat.copy(pair.targetBaseQuat).multiply(_retargetDeltaQuat);
    pair.targetBone.quaternion.copy(pair.targetBaseQuat).slerp(_retargetTargetQuat, rotStrength);

    if (pair.slot === 'hips') {
      _retargetDeltaPos.copy(pair.driverBone.position).sub(pair.driverBasePos);
      _retargetTargetPos.copy(pair.targetBasePos).add(_retargetDeltaPos);
      pair.targetBone.position.copy(pair.targetBasePos).lerp(_retargetTargetPos, posStrength);
    }
  });

  if (uploadedAvatarRoot) uploadedAvatarRoot.updateMatrixWorld(true);
}

function restoreRuntimeMeshRebind() {
  if (!runtimeRebindState.active) return;

  runtimeRebindState.records.forEach((record) => {
    if (record.kind === 'converted') {
      if (record.replacement && record.replacement.parent) {
        record.replacement.parent.remove(record.replacement);
      }
      if (record.originalMesh && record.parent) {
        record.parent.add(record.originalMesh);
        record.originalMesh.position.copy(record.localPosition);
        record.originalMesh.quaternion.copy(record.localQuaternion);
        record.originalMesh.scale.copy(record.localScale);
        record.originalMesh.visible = true;
      }
      return;
    }

    if (!record.mesh) return;
    record.mesh.geometry = record.originalGeometry;
    record.mesh.bindMode = record.originalBindMode;
    record.mesh.bind(record.originalSkeleton, record.originalBindMatrix.clone());
  });

  runtimeRebindState.active = false;
  runtimeRebindState.records = [];
  runtimeRebindState.stats.meshCount = 0;
  runtimeRebindState.stats.remappedInfluences = 0;
  runtimeRebindState.stats.autoWeightedMeshes = 0;
  runtimeRebindState.stats.convertedMeshes = 0;
}

function clearRuntimeMeshRebind({ restore = false } = {}) {
  if (restore) restoreRuntimeMeshRebind();
  runtimeRebindState.active = false;
  runtimeRebindState.records = [];
  runtimeRebindState.stats.meshCount = 0;
  runtimeRebindState.stats.remappedInfluences = 0;
  runtimeRebindState.stats.autoWeightedMeshes = 0;
  runtimeRebindState.stats.convertedMeshes = 0;
}

function buildRigidFallbackSkinning(geometry, boneIndex) {
  const position = geometry.getAttribute('position');
  if (!position || !position.count) return null;

  const skinIndex = new THREE.Uint16BufferAttribute(position.count * 4, 4);
  const skinWeight = new THREE.Float32BufferAttribute(position.count * 4, 4);
  for (let i = 0; i < position.count; i += 1) {
    skinIndex.setX(i, boneIndex);
    skinIndex.setY(i, boneIndex);
    skinIndex.setZ(i, boneIndex);
    skinIndex.setW(i, boneIndex);
    skinWeight.setX(i, 1);
    skinWeight.setY(i, 0);
    skinWeight.setZ(i, 0);
    skinWeight.setW(i, 0);
  }

  return { skinIndex, skinWeight };
}

function isLikelyHeadAttachmentMesh(mesh) {
  const facialPattern = /(eye|eyes|lash|lashes|brow|eyebrow|teeth|tooth|tongue|mouth|lip|jaw|beard|mustache|moustache|hair|bang|fringe|head|face)/i;
  let cursor = mesh;
  let depth = 0;
  while (cursor && depth < 5) {
    if (typeof cursor.name === 'string' && facialPattern.test(cursor.name)) {
      return true;
    }
    cursor = cursor.parent;
    depth += 1;
  }
  return false;
}

function buildProceduralFallbackSkinning(mesh, geometry, fallbackBoneIndexBySlot) {
  const position = geometry.getAttribute('position');
  if (!position || !position.count) return null;

  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const bbox = geometry.boundingBox;
  if (!bbox) return null;

  const size = bbox.getSize(new THREE.Vector3());
  const center = bbox.getCenter(new THREE.Vector3());
  const minY = bbox.min.y;
  const width = Math.max(size.x, 0.001);
  const height = Math.max(size.y, 0.001);
  const depth = Math.max(size.z, 0.001);

  const skinIndex = new THREE.Uint16BufferAttribute(position.count * 4, 4);
  const skinWeight = new THREE.Float32BufferAttribute(position.count * 4, 4);
  const boneLocalPosBySlot = new Map();

  const slotProfiles = {
    hips:          { y: 0.44, ySpread: 0.14, x: 0.05, xSpread: 0.18, side: 'center', scale: 1.1  },
    spine:         { y: 0.58, ySpread: 0.14, x: 0.04, xSpread: 0.16, side: 'center', scale: 0.95 },
    chest:         { y: 0.72, ySpread: 0.13, x: 0.06, xSpread: 0.18, side: 'center', scale: 1.05 },
    neck:          { y: 0.86, ySpread: 0.09, x: 0.08, xSpread: 0.16, side: 'center', scale: 0.85 },
    head:          { y: 0.95, ySpread: 0.09, x: 0.12, xSpread: 0.2,  side: 'center', scale: 0.85 },
    leftUpperArm:  { y: 0.74, ySpread: 0.12, x: 0.56, xSpread: 0.13, side: 'left',   scale: 0.9  },
    leftLowerArm:  { y: 0.61, ySpread: 0.12, x: 0.76, xSpread: 0.12, side: 'left',   scale: 0.85 },
    leftHand:      { y: 0.49, ySpread: 0.11, x: 0.93, xSpread: 0.09, side: 'left',   scale: 0.78 },
    rightUpperArm: { y: 0.74, ySpread: 0.12, x: 0.56, xSpread: 0.13, side: 'right',  scale: 0.9  },
    rightLowerArm: { y: 0.61, ySpread: 0.12, x: 0.76, xSpread: 0.12, side: 'right',  scale: 0.85 },
    rightHand:     { y: 0.49, ySpread: 0.11, x: 0.93, xSpread: 0.09, side: 'right',  scale: 0.78 },
    leftUpperLeg:  { y: 0.36, ySpread: 0.14, x: 0.26, xSpread: 0.06, side: 'left',   scale: 1.0  },
    leftLowerLeg:  { y: 0.16, ySpread: 0.12, x: 0.24, xSpread: 0.06, side: 'left',   scale: 0.9  },
    leftFoot:      { y: 0.03, ySpread: 0.06, x: 0.22, xSpread: 0.08, side: 'left',   scale: 0.8  },
    rightUpperLeg: { y: 0.36, ySpread: 0.14, x: 0.26, xSpread: 0.06, side: 'right',  scale: 1.0  },
    rightLowerLeg: { y: 0.16, ySpread: 0.12, x: 0.24, xSpread: 0.06, side: 'right',  scale: 0.9  },
    rightFoot:     { y: 0.03, ySpread: 0.06, x: 0.22, xSpread: 0.08, side: 'right',  scale: 0.8  },
  };

  avatar.updateMatrixWorld(true);
  mesh.updateMatrixWorld(true);
  fallbackRigState.bones.forEach((bone, slot) => {
    const localPos = mesh.worldToLocal(bone.getWorldPosition(new THREE.Vector3()));
    boneLocalPosBySlot.set(slot, localPos);
  });

  function getIndex(slot) {
    return fallbackBoneIndexBySlot.get(slot) ?? fallbackBoneIndexBySlot.get('hips') ?? 0;
  }

  function gaussian(value, spread) {
    const safeSpread = Math.max(spread, 0.0001);
    return Math.exp(-((value * value) / (2 * safeSpread * safeSpread)));
  }

  function normalize(entries) {
    const merged = new Map();
    entries.forEach(({ slot, weight }) => {
      if (!slot || weight <= 0) return;
      merged.set(slot, (merged.get(slot) || 0) + weight);
    });
    const compact = Array.from(merged.entries())
      .map(([slot, weight]) => ({ slot, weight }))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 4);
    const total = compact.reduce((sum, entry) => sum + entry.weight, 0) || 1;
    return compact.map((entry) => ({
      slot: entry.slot,
      weight: entry.weight / total,
    }));
  }

  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const xNorm = (x - center.x) / (width * 0.5);
    const yNorm = (y - minY) / height;
    const side = xNorm < 0 ? 'left' : 'right';
    const lateral = Math.abs(xNorm);

    const entries = [];
    Object.entries(slotProfiles).forEach(([slot, profile]) => {
      const boneLocal = boneLocalPosBySlot.get(slot);
      if (!boneLocal) return;

      const sideScore = profile.side === 'center' ? 1 : (profile.side === side ? 1 : 0.0);
      if (sideScore === 0.0) return;
      const priorY = gaussian(yNorm - profile.y, profile.ySpread);
      const priorX = gaussian(lateral - profile.x, profile.xSpread);
      const dx = (x - boneLocal.x) / (width * (profile.side === 'center' ? 0.25 : 0.14));
      const dy = (y - boneLocal.y) / (height * (profile.side === 'center' ? 0.13 : 0.14));
      const dz = (z - boneLocal.z) / (depth * 0.28);
      const distanceScore = Math.exp(-(dx * dx + dy * dy + dz * dz));
      const weight = profile.scale * sideScore * ((distanceScore * 0.76) + (priorY * priorX * 0.24));
      if (weight > 0.0005) {
        entries.push({ slot, weight });
      }
    });

    if (!entries.length) {
      entries.push({ slot: side === 'left' ? 'leftUpperLeg' : 'rightUpperLeg', weight: 0.45 });
      entries.push({ slot: 'hips', weight: 0.35 });
      entries.push({ slot: 'spine', weight: 0.2 });
    }

    const normalized = normalize(entries);
    for (let c = 0; c < 4; c += 1) {
      const entry = normalized[c];
      const targetIndex = entry ? getIndex(entry.slot) : getIndex('hips');
      const targetWeight = entry ? entry.weight : 0;
      if (c === 0) {
        skinIndex.setX(i, targetIndex);
        skinWeight.setX(i, targetWeight);
      } else if (c === 1) {
        skinIndex.setY(i, targetIndex);
        skinWeight.setY(i, targetWeight);
      } else if (c === 2) {
        skinIndex.setZ(i, targetIndex);
        skinWeight.setZ(i, targetWeight);
      } else {
        skinIndex.setW(i, targetIndex);
        skinWeight.setW(i, targetWeight);
      }
    }
  }

  return { skinIndex, skinWeight };
}

function setupRuntimeMeshRebind() {
  clearRuntimeMeshRebind({ restore: false });

  if (!fallbackRigState.active) {
    return false;
  }

  const fallbackBones = Array.from(fallbackRigState.bones.values());
  if (!fallbackBones.length) return false;

  const fallbackBoneIndexByUuid = new Map();
  fallbackBones.forEach((bone, idx) => fallbackBoneIndexByUuid.set(bone.uuid, idx));
  const fallbackBoneIndexBySlot = new Map();
  fallbackRigState.bones.forEach((bone, slot) => {
    fallbackBoneIndexBySlot.set(slot, fallbackBoneIndexByUuid.get(bone.uuid) ?? 0);
  });

  const sourceBoneNameToSlot = new Map();
  if (latestImportedRigReport?.mapping) {
    Object.entries(latestImportedRigReport.mapping).forEach(([slot, boneName]) => {
      if (boneName) sourceBoneNameToSlot.set(boneName, slot);
    });
  }
  const mappedSlotBones = [];
  if (latestImportedRigReport?.mapping) {
    Object.entries(latestImportedRigReport.mapping).forEach(([slot, boneName]) => {
      if (!fallbackRigState.bones.has(slot)) return;
      const sourceBone = getRigBone(uploadedAvatarRoot, boneName);
      if (sourceBone) {
        mappedSlotBones.push({ slot, bone: sourceBone });
      }
    });
  }

  const hipsBone = fallbackRigState.bones.get('hips');
  const hipsIndex = hipsBone ? (fallbackBoneIndexByUuid.get(hipsBone.uuid) || 0) : 0;

  const records = [];
  let remappedInfluences = 0;
  let autoWeightedMeshes = 0;
  let convertedMeshes = 0;

  function bindProceduralMesh(mesh, parent, sourceTag = 'converted') {
    const originalGeometry = mesh.geometry;
    if (!originalGeometry) return false;

    const workingGeometry = originalGeometry.clone();
    const headIndex = fallbackBoneIndexBySlot.get('head') ?? hipsIndex;
    const procedural = isLikelyHeadAttachmentMesh(mesh)
      ? buildRigidFallbackSkinning(workingGeometry, headIndex)
      : buildProceduralFallbackSkinning(mesh, workingGeometry, fallbackBoneIndexBySlot);
    if (!procedural) return false;

    workingGeometry.setAttribute('skinIndex', procedural.skinIndex);
    workingGeometry.setAttribute('skinWeight', procedural.skinWeight);

    const skinned = new THREE.SkinnedMesh(workingGeometry, mesh.material);
    skinned.name = mesh.name;
    skinned.castShadow = mesh.castShadow;
    skinned.receiveShadow = mesh.receiveShadow;
    skinned.frustumCulled = mesh.frustumCulled;
    skinned.position.copy(mesh.position);
    skinned.quaternion.copy(mesh.quaternion);
    skinned.scale.copy(mesh.scale);
    skinned.visible = mesh.visible;
    skinned.matrixAutoUpdate = mesh.matrixAutoUpdate;
    skinned.renderOrder = mesh.renderOrder;
    skinned.userData = { ...(mesh.userData || {}), runtimeFallbackGenerated: true };

    parent.add(skinned);
    mesh.visible = false;

    const newSkeleton = new THREE.Skeleton(fallbackBones);
    skinned.bind(newSkeleton);
    skinned.normalizeSkinWeights();

    records.push({
      kind: sourceTag,
      parent,
      originalMesh: mesh,
      replacement: skinned,
      localPosition: mesh.position.clone(),
      localQuaternion: mesh.quaternion.clone(),
      localScale: mesh.scale.clone(),
    });

    autoWeightedMeshes += 1;
    convertedMeshes += 1;
    return true;
  }

  const rebindRoot = uploadedAvatarRoot || avatar;
  rebindRoot.traverse((obj) => {
    if (obj.userData?.runtimeFallbackGenerated) return;

    if (obj.isMesh && !obj.isSkinnedMesh && obj.geometry && obj.material) {
      if (obj.parent) bindProceduralMesh(obj, obj.parent, 'converted');
      return;
    }

    if (!obj.isSkinnedMesh || !obj.skeleton || !obj.geometry) return;

    const oldGeometry = obj.geometry;
    const oldSkinIndex = oldGeometry.getAttribute('skinIndex');
    const oldSkinWeight = oldGeometry.getAttribute('skinWeight');

    const sourceToFallback = new Map();
    let resolvedSourceBones = 0;
    obj.skeleton.bones.forEach((sourceBone, sourceIndex) => {
      if (!sourceBone) return;

      let cursor = sourceBone;
      let resolvedSlot = null;
      while (cursor && cursor.isBone) {
        const slot = sourceBoneNameToSlot.get(cursor.name);
        if (slot && fallbackRigState.bones.has(slot)) {
          resolvedSlot = slot;
          break;
        }
        cursor = findParentBone(cursor);
      }

      if (!resolvedSlot) {
        const preferredSlots = hasPropBoneHint(sourceBone.name)
          ? ['leftHand', 'rightHand', 'leftLowerArm', 'rightLowerArm', 'leftUpperArm', 'rightUpperArm']
          : [];
        resolvedSlot = resolveSlotFromNearestMappedBone(sourceBone, mappedSlotBones, preferredSlots);
      }

      const fallbackBone = resolvedSlot ? fallbackRigState.bones.get(resolvedSlot) : hipsBone;
      const fallbackIndex = fallbackBone ? (fallbackBoneIndexByUuid.get(fallbackBone.uuid) ?? hipsIndex) : hipsIndex;
      sourceToFallback.set(sourceIndex, fallbackIndex);
      if (resolvedSlot) resolvedSourceBones += 1;
    });

    const workingGeometry = oldGeometry.clone();
    let usedProceduralWeights = false;

    if (isLikelyHeadAttachmentMesh(obj)) {
      const headIndex = fallbackBoneIndexBySlot.get('head') ?? hipsIndex;
      const rigid = buildRigidFallbackSkinning(workingGeometry, headIndex);
      if (!rigid) return;
      workingGeometry.setAttribute('skinIndex', rigid.skinIndex);
      workingGeometry.setAttribute('skinWeight', rigid.skinWeight);
    } else if (oldSkinIndex && oldSkinIndex.itemSize >= 4 && oldSkinWeight && resolvedSourceBones >= 3) {
      const clonedSkinIndex = oldSkinIndex.clone();
      const setByChannel = [
        (i, v) => clonedSkinIndex.setX(i, v),
        (i, v) => clonedSkinIndex.setY(i, v),
        (i, v) => clonedSkinIndex.setZ(i, v),
        (i, v) => clonedSkinIndex.setW(i, v),
      ];

      for (let i = 0; i < clonedSkinIndex.count; i += 1) {
        const sourceIndices = [
          clonedSkinIndex.getX(i),
          clonedSkinIndex.getY(i),
          clonedSkinIndex.getZ(i),
          clonedSkinIndex.getW(i),
        ];
        for (let c = 0; c < 4; c += 1) {
          const remapped = sourceToFallback.get(sourceIndices[c]);
          if (typeof remapped === 'number') {
            setByChannel[c](i, remapped);
            remappedInfluences += 1;
          }
        }
      }

      workingGeometry.setAttribute('skinIndex', clonedSkinIndex);
    } else {
      const headIndex = fallbackBoneIndexBySlot.get('head') ?? hipsIndex;
      const procedural = isLikelyHeadAttachmentMesh(obj)
        ? buildRigidFallbackSkinning(workingGeometry, headIndex)
        : buildProceduralFallbackSkinning(obj, workingGeometry, fallbackBoneIndexBySlot);
      if (!procedural) return;
      workingGeometry.setAttribute('skinIndex', procedural.skinIndex);
      workingGeometry.setAttribute('skinWeight', procedural.skinWeight);
      autoWeightedMeshes += 1;
      usedProceduralWeights = true;
    }

    obj.geometry = workingGeometry;

    const originalBindMatrix = obj.bindMatrix.clone();
    const originalBindMode = obj.bindMode;
    const originalSkeleton = obj.skeleton;
    const newSkeleton = new THREE.Skeleton(fallbackBones);
    obj.bind(newSkeleton, originalBindMatrix.clone());
    obj.bindMode = originalBindMode;
    obj.normalizeSkinWeights();

    records.push({
      kind: 'rebound',
      mesh: obj,
      originalGeometry: oldGeometry,
      originalSkeleton,
      originalBindMatrix,
      originalBindMode,
      usedProceduralWeights,
    });
  });

  if (!records.length) return false;

  runtimeRebindState.active = true;
  runtimeRebindState.records = records;
  runtimeRebindState.stats.meshCount = records.length;
  runtimeRebindState.stats.remappedInfluences = remappedInfluences;
  runtimeRebindState.stats.autoWeightedMeshes = autoWeightedMeshes;
  runtimeRebindState.stats.convertedMeshes = convertedMeshes;
  return true;
}

function createFallbackRigReport(skinnedMeshCount = 0) {
  const mapping = {};
  const confidences = {};
  for (const slot of Object.keys(RIG_SLOT_PROFILES)) {
    mapping[slot] = slot;
    confidences[slot] = 100;
  }

  return {
    boneCount: Object.keys(RIG_SLOT_PROFILES).length,
    skinnedMeshCount,
    foundCount: Object.keys(RIG_SLOT_PROFILES).length,
    requiredCount: Object.keys(RIG_SLOT_PROFILES).length,
    coverage: 100,
    essentialFound: RIG_ESSENTIAL_SLOTS.length,
    essentialCount: RIG_ESSENTIAL_SLOTS.length,
    essentialCoverage: 100,
    missing: [],
    mapping,
    confidences,
    classification: {
      label: 'Fallback rebone rig',
      color: '#8cd7ff',
      usable: true,
    },
  };
}

function collectFallbackRigMetrics(root) {
  const box = new THREE.Box3().setFromObject(root);
  const min = avatar.worldToLocal(box.min.clone());
  const max = avatar.worldToLocal(box.max.clone());
  const center = avatar.worldToLocal(box.getCenter(new THREE.Vector3()));
  const width = Math.max(max.x - min.x, 0.2);
  const height = Math.max(max.y - min.y, 0.2);
  const depth = Math.max(max.z - min.z, 0.1);

  const defaults = {
    centerX: center.x,
    centerZ: center.z + depth * 0.03,
    minY: min.y,
    width,
    height,
    depth,
    hipsY: min.y + height * 0.53,
    spineLen: height * 0.12,
    chestLen: height * 0.14,
    neckLen: height * 0.1,
    headLen: height * 0.1,
    shoulderOffsetX: width * 0.18,
    // Screenshot baseline: shoulder height around -0.070 on a typical avatar.
    shoulderOffsetY: -height * 0.04,
    armUpperLen: width * 0.18,
    armLowerLen: width * 0.15,
    armDropY: height * 0.016,
    legOffsetX: width * 0.09,
    legRootDrop: height * 0.25,
    legUpperLen: height * 0.26,
    legLowerLen: height * 0.24,
    legForward: depth * 0.02,
    footForward: depth * 0.08,
  };

  if (!latestImportedRigReport || !latestImportedRigReport.mapping) {
    return defaults;
  }

  const slotPos = new Map();
  for (const [slot, name] of Object.entries(latestImportedRigReport.mapping)) {
    const bone = getRigBone(root, name);
    if (!bone) continue;
    const p = avatar.worldToLocal(bone.getWorldPosition(new THREE.Vector3()));
    slotPos.set(slot, p);
  }

  const hipsPos = slotPos.get('hips');
  const spinePos = slotPos.get('spine');
  const chestPos = slotPos.get('chest');
  const neckPos = slotPos.get('neck');
  const headPos = slotPos.get('head');
  const leftUpperArmPos = slotPos.get('leftUpperArm');
  const rightUpperArmPos = slotPos.get('rightUpperArm');
  const leftLowerArmPos = slotPos.get('leftLowerArm');
  const rightLowerArmPos = slotPos.get('rightLowerArm');
  const leftHandPos = slotPos.get('leftHand');
  const rightHandPos = slotPos.get('rightHand');
  const leftUpperLegPos = slotPos.get('leftUpperLeg');
  const rightUpperLegPos = slotPos.get('rightUpperLeg');
  const leftLowerLegPos = slotPos.get('leftLowerLeg');
  const rightLowerLegPos = slotPos.get('rightLowerLeg');
  const leftFootPos = slotPos.get('leftFoot');
  const rightFootPos = slotPos.get('rightFoot');

  const armSide = (leftUpperArmPos && leftLowerArmPos) ? 'left' : ((rightUpperArmPos && rightLowerArmPos) ? 'right' : null);
  const legSide = (leftUpperLegPos && leftLowerLegPos) ? 'left' : ((rightUpperLegPos && rightLowerLegPos) ? 'right' : null);

  const sideUpperArmPos = armSide === 'left' ? leftUpperArmPos : rightUpperArmPos;
  const sideLowerArmPos = armSide === 'left' ? leftLowerArmPos : rightLowerArmPos;
  const sideHandPos = armSide === 'left' ? leftHandPos : rightHandPos;

  const sideUpperLegPos = legSide === 'left' ? leftUpperLegPos : rightUpperLegPos;
  const sideLowerLegPos = legSide === 'left' ? leftLowerLegPos : rightLowerLegPos;
  const sideFootPos = legSide === 'left' ? leftFootPos : rightFootPos;

  const hipsY = hipsPos ? THREE.MathUtils.clamp(hipsPos.y, min.y + height * 0.25, min.y + height * 0.78) : defaults.hipsY;

  const shoulderBaseY = sideUpperArmPos
    ? sideUpperArmPos.y
    : (chestPos ? chestPos.y : hipsY + height * 0.27);
  const shoulderOffsetY = THREE.MathUtils.clamp(shoulderBaseY - hipsY - (spinePos ? (spinePos.y - hipsY) : 0), -height * 0.06, height * 0.1);

  const shoulderOffsetX = sideUpperArmPos
    ? THREE.MathUtils.clamp(Math.abs(sideUpperArmPos.x - defaults.centerX), width * 0.08, width * 0.38)
    : defaults.shoulderOffsetX;

  const armUpperLen = (sideUpperArmPos && sideLowerArmPos)
    ? THREE.MathUtils.clamp(sideUpperArmPos.distanceTo(sideLowerArmPos), width * 0.08, width * 0.45)
    : defaults.armUpperLen;
  const armLowerLen = (sideLowerArmPos && sideHandPos)
    ? THREE.MathUtils.clamp(sideLowerArmPos.distanceTo(sideHandPos), width * 0.06, width * 0.4)
    : defaults.armLowerLen;

  const legOffsetX = sideUpperLegPos
    ? THREE.MathUtils.clamp(Math.abs(sideUpperLegPos.x - defaults.centerX), width * 0.05, width * 0.24)
    : defaults.legOffsetX;
  const legRootDrop = sideUpperLegPos
    ? THREE.MathUtils.clamp(Math.abs(sideUpperLegPos.y - hipsY), height * 0.08, height * 0.42)
    : defaults.legRootDrop;
  const legUpperLen = (sideUpperLegPos && sideLowerLegPos)
    ? THREE.MathUtils.clamp(sideUpperLegPos.distanceTo(sideLowerLegPos), height * 0.1, height * 0.45)
    : defaults.legUpperLen;
  const legLowerLen = (sideLowerLegPos && sideFootPos)
    ? THREE.MathUtils.clamp(sideLowerLegPos.distanceTo(sideFootPos), height * 0.08, height * 0.4)
    : defaults.legLowerLen;

  const spineLen = spinePos && hipsPos
    ? THREE.MathUtils.clamp(Math.abs(spinePos.y - hipsPos.y), height * 0.04, height * 0.24)
    : defaults.spineLen;
  const chestLen = chestPos && spinePos
    ? THREE.MathUtils.clamp(Math.abs(chestPos.y - spinePos.y), height * 0.04, height * 0.24)
    : defaults.chestLen;
  const neckLen = neckPos && chestPos
    ? THREE.MathUtils.clamp(Math.abs(neckPos.y - chestPos.y), height * 0.03, height * 0.16)
    : defaults.neckLen;
  const headLen = headPos && neckPos
    ? THREE.MathUtils.clamp(Math.abs(headPos.y - neckPos.y), height * 0.03, height * 0.2)
    : defaults.headLen;

  const legForward = (sideUpperLegPos && sideLowerLegPos)
    ? THREE.MathUtils.clamp(Math.abs(sideLowerLegPos.z - sideUpperLegPos.z), depth * 0.005, depth * 0.12)
    : defaults.legForward;
  const footForward = (sideLowerLegPos && sideFootPos)
    ? THREE.MathUtils.clamp(Math.abs(sideFootPos.z - sideLowerLegPos.z), depth * 0.02, depth * 0.28)
    : defaults.footForward;

  return {
    centerX: defaults.centerX,
    centerZ: defaults.centerZ,
    minY: defaults.minY,
    width,
    height,
    depth,
    hipsY,
    spineLen,
    chestLen,
    neckLen,
    headLen,
    shoulderOffsetX,
    shoulderOffsetY,
    armUpperLen,
    armLowerLen,
    armDropY: defaults.armDropY,
    legOffsetX,
    legRootDrop,
    legUpperLen,
    legLowerLen,
    legForward,
    footForward,
  };
}

function createFallbackRig(root, { metricOverrides = {} } = {}) {
  const baseMetrics = collectFallbackRigMetrics(root);
  const sanitizedMetricOverrides = sanitizeFallbackRigMetricOverrides(metricOverrides, baseMetrics);
  const metrics = applyFallbackRigMetricOverrides(baseMetrics, sanitizedMetricOverrides);

  const group = new THREE.Group();
  group.name = 'fallbackReboneRig';

  const hips = new THREE.Bone();
  hips.name = 'hips';
  hips.position.set(metrics.centerX, metrics.hipsY, metrics.centerZ);
  group.add(hips);

  const spine = new THREE.Bone();
  spine.name = 'spine';
  spine.position.y = metrics.spineLen;
  hips.add(spine);

  const chest = new THREE.Bone();
  chest.name = 'chest';
  chest.position.y = metrics.chestLen;
  spine.add(chest);

  const neck = new THREE.Bone();
  neck.name = 'neck';
  neck.position.y = metrics.neckLen;
  chest.add(neck);

  const head = new THREE.Bone();
  head.name = 'head';
  head.position.y = metrics.headLen;
  neck.add(head);

  function addArm(sideName, sideSign) {
    const upper = new THREE.Bone();
    upper.name = `${sideName}UpperArm`;
    upper.position.set(sideSign * metrics.shoulderOffsetX, metrics.shoulderOffsetY, 0);
    // Enforce a neutral T-pose baseline on initial fallback rebone.
    upper.rotation.set(0, 0, 0);
    chest.add(upper);

    const lower = new THREE.Bone();
    lower.name = `${sideName}LowerArm`;
    lower.position.set(sideSign * metrics.armUpperLen, 0, 0);
    lower.rotation.set(0, 0, 0);
    upper.add(lower);

    const hand = new THREE.Bone();
    hand.name = `${sideName}Hand`;
    hand.position.set(sideSign * metrics.armLowerLen, 0, 0);
    hand.rotation.set(0, 0, 0);
    lower.add(hand);

    return [upper, lower, hand];
  }

  function addLeg(sideName, sideSign) {
    const upper = new THREE.Bone();
    upper.name = `${sideName}UpperLeg`;
    upper.position.set(sideSign * metrics.legOffsetX, -metrics.legRootDrop, 0);
    upper.rotation.set(0, 0, 0);
    hips.add(upper);

    const lower = new THREE.Bone();
    lower.name = `${sideName}LowerLeg`;
    lower.position.set(0, -metrics.legUpperLen, metrics.legForward);
    lower.rotation.set(0, 0, 0);
    upper.add(lower);

    const foot = new THREE.Bone();
    foot.name = `${sideName}Foot`;
    foot.position.set(0, -metrics.legLowerLen, metrics.footForward);
    foot.rotation.set(0, 0, 0);
    lower.add(foot);

    return [upper, lower, foot];
  }

  const [leftUpperArm, leftLowerArm, leftHand] = addArm('left', -1);
  const [rightUpperArm, rightLowerArm, rightHand] = addArm('right', 1);
  const [leftUpperLeg, leftLowerLeg, leftFoot] = addLeg('left', -1);
  const [rightUpperLeg, rightLowerLeg, rightFoot] = addLeg('right', 1);

  avatar.add(group);

  const helper = new THREE.SkeletonHelper(group);
  helper.frustumCulled = false;
  helper.renderOrder = 1000;
  helper.material.depthTest = false;
  helper.material.depthWrite = false;
  helper.material.transparent = true;
  helper.material.opacity = 1;
  helper.material.toneMapped = false;
  helper.material.color.setHex(0x8cd7ff);
  helper.material.linewidth = 3;
  scene.add(helper);

  fallbackRigState.active = true;
  fallbackRigState.sourceRoot = root;
  fallbackRigState.baseMetrics = cloneFallbackMetricMap(baseMetrics);
  fallbackRigState.resolvedMetrics = cloneFallbackMetricMap(metrics);
  fallbackRigState.metricOverrides = { ...sanitizedMetricOverrides };
  fallbackRigState.root = group;
  fallbackRigState.helper = helper;
  fallbackRigState.selectedBoneHighlight = null;
  fallbackRigState.bones = new Map([
    ['hips', hips],
    ['spine', spine],
    ['chest', chest],
    ['neck', neck],
    ['head', head],
    ['leftUpperArm', leftUpperArm],
    ['leftLowerArm', leftLowerArm],
    ['leftHand', leftHand],
    ['rightUpperArm', rightUpperArm],
    ['rightLowerArm', rightLowerArm],
    ['rightHand', rightHand],
    ['leftUpperLeg', leftUpperLeg],
    ['leftLowerLeg', leftLowerLeg],
    ['leftFoot', leftFoot],
    ['rightUpperLeg', rightUpperLeg],
    ['rightLowerLeg', rightLowerLeg],
    ['rightFoot', rightFoot],
  ]);
  fallbackRigState.report = createFallbackRigReport(latestImportedRigReport?.skinnedMeshCount || 0);
  const didRebind = setupRuntimeMeshRebind();
  if (didRebind) {
    clearRuntimeRetargetLayer({ restoreTargets: false });
  } else {
    setupRuntimeRetargetLayer();
  }
  updateRigReboneButton();
  syncFallbackRigEditorPanel();
}

function toggleFallbackRebone() {
  stopRigWalkPreview({ restore: true });
  stopRigDancePreview({ restore: true });
  stopRigIdlePreview({ restore: true });
  rigPoseState.active = false;

  if (fallbackRigState.active) {
    clearRuntimeMeshRebind({ restore: true });
    clearRuntimeRetargetLayer({ restoreTargets: true });
    clearFallbackRig();
    if (uploadedAvatarRoot && latestImportedRigReport?.skinnedMeshCount) showUploadedRigHelper(uploadedAvatarRoot);
    renderRigReport(latestImportedRigReport, 'upload');
    modelStatusEl.textContent = uploadedAvatarRoot ? 'Using imported rig bones again.' : 'Fallback rig removed.';
    return;
  }

  clearUploadedRigHelper();
  clearFallbackRig();
  createFallbackRig(uploadedAvatarRoot || avatar);
  applyBoneRotationOverrides();
  renderRigReport(fallbackRigState.report, 'fallback rebone');
  if (runtimeRebindState.active) {
    if (runtimeRebindState.stats.autoWeightedMeshes > 0) {
      modelStatusEl.textContent = `Fallback rig auto-weight rebind active (${runtimeRebindState.stats.autoWeightedMeshes}/${runtimeRebindState.stats.meshCount} meshes procedurally weighted, ${runtimeRebindState.stats.convertedMeshes} converted).`;
    } else {
      modelStatusEl.textContent = `Fallback rig mesh rebind active (${runtimeRebindState.stats.meshCount} skinned meshes).`;
    }
  } else if (runtimeRetargetState.active) {
    const unresolved = runtimeRetargetState.diagnostics.unresolvedSlots;
    const unresolvedText = unresolved.length ? ` Unresolved slots: ${unresolved.join(', ')}.` : '';
    modelStatusEl.textContent = `Fallback gameplay rig retarget active (${runtimeRetargetState.diagnostics.pairCount} pairs).${unresolvedText}`;
  } else {
    modelStatusEl.textContent = 'Fallback rig active, but runtime retarget found no compatible mapped bones.';
  }
}

function clearUploadedAvatar() {
  rigPoseState.active = false;
  rigIdleState.active = false;
  rigWalkState.active = false;
  rigDanceState.active = false;
  rigPoseBase.clear();
  clearRuntimeMeshRebind({ restore: false });
  clearRuntimeRetargetLayer({ restoreTargets: false });
  latestRigReport = null;
  latestImportedRigReport = null;
  updateRigIdleButton();
  updateRigWalkButton();
  clearFallbackRig();
  clearBoneRotationOverrides();
  clearUploadedRigHelper();
  if (!uploadedAvatarRoot) return;
  avatar.remove(uploadedAvatarRoot);
  uploadedAvatarRoot.traverse((obj) => {
    if (obj.geometry && typeof obj.geometry.dispose === 'function') obj.geometry.dispose();
    if (obj.material) {
      if (Array.isArray(obj.material)) {
        obj.material.forEach((m) => m && typeof m.dispose === 'function' && m.dispose());
      } else if (typeof obj.material.dispose === 'function') {
        obj.material.dispose();
      }
    }
  });
  uploadedAvatarRoot = null;
  fallbackRigState.metricOverrides = {};
  syncFallbackRigEditorPanel();
}

function normalizeUploadedModel(root) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const targetHeight = 1.85;
  const safeHeight = Math.max(size.y, 0.001);
  const scale = targetHeight / safeHeight;
  root.scale.setScalar(scale);
  root.updateMatrixWorld(true);

  const scaledBox = new THREE.Box3().setFromObject(root);
  const scaledCenter = scaledBox.getCenter(new THREE.Vector3());
  const minY = scaledBox.min.y;

  root.position.x += -scaledCenter.x;
  root.position.y += -minY + 0.02;
  root.position.z += -scaledCenter.z;
}

function getRigBone(root, boneName) {
  if (!root || !boneName) return null;
  const bone = root.getObjectByName(boneName);
  return bone && bone.isBone ? bone : null;
}

function updateRigWalkButton() {
  if (!rigWalkBtn) return;
  rigWalkBtn.textContent = rigWalkState.active ? 'Stop Walk Preview' : 'Start Walk Preview';
}

function updateRigIdleButton() {
  if (!rigIdleBtn) return;
  rigIdleBtn.textContent = rigIdleState.active ? 'Stop Idle Preview' : 'Start Idle Preview';
}

function updateRigDanceButton() {
  if (!rigDanceBtn) return;
  rigDanceBtn.textContent = rigDanceState.active ? 'Stop Dance Preview' : 'Start Dance Preview';
}

function restoreRigBasePose() {
  for (const { bone, quat, position } of rigPoseBase.values()) {
    bone.quaternion.copy(quat);
    if (position) bone.position.copy(position);
  }
  // Re-apply overrides only when they were edited while a preview was active.
  // This avoids double-stacking rotations on preview stop.
  if (previewBoneOverrideDirty) {
    applyBoneRotationOverrides();
    previewBoneOverrideDirty = false;
  }
  restoreRuntimeRetargetTargets();
  if (uploadedAvatarRoot) uploadedAvatarRoot.updateMatrixWorld(true);
}

function stopRigWalkPreview({ restore = true, statusText = null } = {}) {
  if (!rigWalkState.active && !rigPoseBase.size) {
    updateRigWalkButton();
    return;
  }

  rigWalkState.active = false;
  if (restore) restoreRigBasePose();
  if (statusText) modelStatusEl.textContent = statusText;
  updateRigWalkButton();
}

function stopRigDancePreview({ restore = true, statusText = null } = {}) {
  if (!rigDanceState.active && !rigPoseBase.size) {
    updateRigDanceButton();
    return;
  }

  rigDanceState.active = false;
  if (restore) restoreRigBasePose();
  if (statusText) modelStatusEl.textContent = statusText;
  updateRigDanceButton();
}

function stopRigIdlePreview({ restore = true, statusText = null } = {}) {
  if (!rigIdleState.active && !rigPoseBase.size) {
    updateRigIdleButton();
    return;
  }

  rigIdleState.active = false;
  if (restore) restoreRigBasePose();
  if (statusText) modelStatusEl.textContent = statusText;
  updateRigIdleButton();
}

function collectRigMappedBones(slots) {
  if (fallbackRigState.active) {
    return slots
      .map((slot) => {
        const bone = fallbackRigState.bones.get(slot);
        return bone ? { slot, bone } : null;
      })
      .filter(Boolean);
  }

  if (!uploadedAvatarRoot || !latestRigReport) return [];

  const bones = [];
  const seen = new Set();
  for (const slot of slots) {
    const mapped = latestRigReport.mapping[slot];
    const bone = getRigBone(uploadedAvatarRoot, mapped);
    if (!bone || seen.has(bone.uuid)) continue;
    seen.add(bone.uuid);
    bones.push({ slot, bone });
  }
  return bones;
}

function captureRigBasePose(slotBones) {
  rigPoseBase.clear();
  slotBones.forEach(({ slot, bone }) => {
    rigPoseBase.set(bone.uuid, {
      slot,
      bone,
      quat: bone.quaternion.clone(),
      position: bone.position.clone(),
    });
  });

  captureRuntimeRetargetBasePose();
}

function startRigWalkPreview() {
  if (rigWalkState.active) {
    stopRigWalkPreview({ statusText: 'Walk preview stopped.' });
    return;
  }

  if (!latestRigReport || (!uploadedAvatarRoot && !fallbackRigState.active)) {
    modelStatusEl.textContent = 'Upload a rigged model first.';
    return;
  }

  if (!latestRigReport.classification.usable) {
    modelStatusEl.textContent = 'Rig needs better auto-mapping before a walk preview can run.';
    return;
  }

  const walkSlots = [
    'hips', 'spine', 'chest', 'head',
    'leftUpperArm', 'rightUpperArm',
    'leftLowerArm', 'rightLowerArm',
    'leftHand', 'rightHand',
    'leftUpperLeg', 'rightUpperLeg',
    'leftLowerLeg', 'rightLowerLeg',
    'leftFoot', 'rightFoot',
  ];
  const bones = collectRigMappedBones(walkSlots);

  if (!bones.length) {
    modelStatusEl.textContent = 'No mapped bones available for walk preview.';
    return;
  }

  if (rigDanceState.active) {
    stopRigDancePreview({ restore: true });
  }
  if (rigIdleState.active) {
    stopRigIdlePreview({ restore: true });
  }

  rigPoseState.active = false;
  captureRigBasePose(bones);
  rigWalkState.active = true;
  rigWalkState.startAtMs = performance.now();
  modelStatusEl.textContent = 'Running walk preview on resolved rig bones.';
  updateRigWalkButton();
  updateRigDanceButton();
}

function startRigDancePreview() {
  if (rigDanceState.active) {
    stopRigDancePreview({ statusText: 'Dance preview stopped.' });
    return;
  }

  if (!latestRigReport || (!uploadedAvatarRoot && !fallbackRigState.active)) {
    modelStatusEl.textContent = 'Upload a rigged model first.';
    return;
  }

  if (!latestRigReport.classification.usable) {
    modelStatusEl.textContent = 'Rig needs better auto-mapping before a dance preview can run.';
    return;
  }

  const danceSlots = [
    'hips', 'spine', 'chest', 'head',
    'leftUpperArm', 'rightUpperArm',
    'leftLowerArm', 'rightLowerArm',
    'leftHand', 'rightHand',
    'leftUpperLeg', 'rightUpperLeg',
    'leftLowerLeg', 'rightLowerLeg',
    'leftFoot', 'rightFoot',
  ];
  const bones = collectRigMappedBones(danceSlots);

  if (!bones.length) {
    modelStatusEl.textContent = 'No mapped bones available for dance preview.';
    return;
  }

  if (rigWalkState.active) {
    stopRigWalkPreview({ restore: true });
  }
  if (rigIdleState.active) {
    stopRigIdlePreview({ restore: true });
  }
  rigPoseState.active = false;
  captureRigBasePose(bones);
  rigDanceState.active = true;
  rigDanceState.startAtMs = performance.now();
  modelStatusEl.textContent = 'Running dance preview on resolved rig bones.';
  updateRigDanceButton();
  updateRigWalkButton();
}

function startRigFrontFlipPreview() {
  if (!latestRigReport || (!uploadedAvatarRoot && !fallbackRigState.active)) {
    modelStatusEl.textContent = 'Upload a rigged model first.';
    return;
  }

  if (!fallbackRigState.active && !latestRigReport.skinnedMeshCount) {
    modelStatusEl.textContent = 'Model is not skinned; front flip preview unavailable.';
    return;
  }

  const slotsToTest = [
    'hips', 'spine',
    'leftUpperArm', 'rightUpperArm',
    'leftLowerArm', 'rightLowerArm',
    'leftHand', 'rightHand',
    'leftUpperLeg', 'rightUpperLeg',
    'leftLowerLeg', 'rightLowerLeg',
    'leftFoot', 'rightFoot',
    'chest', 'head',
  ];

  const bones = collectRigMappedBones(slotsToTest);

  if (!bones.length) {
    modelStatusEl.textContent = 'No mapped bones found for front flip preview.';
    return;
  }

  stopRigWalkPreview({ restore: true });
  stopRigDancePreview({ restore: true });
  stopRigIdlePreview({ restore: true });
  captureRigBasePose(bones);

  rigPoseState.active = true;
  rigPoseState.startAtMs = performance.now();
  modelStatusEl.textContent = 'Running front flip preview...';
}

function startRigIdlePreview() {
  if (rigIdleState.active) {
    stopRigIdlePreview({ statusText: 'Idle preview stopped.' });
    return;
  }

  if (!latestRigReport || (!uploadedAvatarRoot && !fallbackRigState.active)) {
    modelStatusEl.textContent = 'Upload a rigged model first.';
    return;
  }

  if (!latestRigReport.classification.usable) {
    modelStatusEl.textContent = 'Rig needs better auto-mapping before an idle preview can run.';
    return;
  }

  const idleSlots = [
    'hips', 'spine', 'chest', 'head',
    'leftUpperArm', 'rightUpperArm',
    'leftLowerArm', 'rightLowerArm',
    'leftHand', 'rightHand',
    'leftUpperLeg', 'rightUpperLeg',
    'leftLowerLeg', 'rightLowerLeg',
    'leftFoot', 'rightFoot',
  ];
  const bones = collectRigMappedBones(idleSlots);

  if (!bones.length) {
    modelStatusEl.textContent = 'No mapped bones available for idle preview.';
    return;
  }

  if (rigWalkState.active) stopRigWalkPreview({ restore: true });
  if (rigDanceState.active) stopRigDancePreview({ restore: true });
  rigPoseState.active = false;

  captureRigBasePose(bones);
  rigIdleState.active = true;
  rigIdleState.startAtMs = performance.now();
  modelStatusEl.textContent = 'Running idle preview on resolved rig bones.';
  updateRigIdleButton();
  updateRigWalkButton();
  updateRigDanceButton();
}

function applyRigWalkPreview(nowMs) {
  if (!rigWalkState.active) return;

  const elapsedSec = Math.max(0, (nowMs - rigWalkState.startAtMs) / 1000);
  const phase = elapsedSec * rigWalkState.cycleHz * Math.PI * 2;
  const leftStride = Math.sin(phase);
  const rightStride = Math.sin(phase + Math.PI);
  const leftLift = Math.max(0, -leftStride);
  const rightLift = Math.max(0, -rightStride);
  const torsoTurn = Math.sin(phase) * 0.08;
  const hipBob = Math.cos(phase * 2) * rigWalkState.hipBob;
  const slotOffsets = {
    hips: makeRigEuler(0, torsoTurn * 0.7, Math.sin(phase) * 0.05),
    spine: makeRigEuler(Math.cos(phase * 2) * 0.03, torsoTurn * 0.45, 0),
    chest: makeRigEuler(0, torsoTurn, Math.sin(phase) * 0.04),
    head: makeRigEuler(Math.cos(phase * 2) * 0.05, torsoTurn * 0.85, 0),
    leftUpperArm: makeRigEuler(rightStride * 0.65, 0, -0.12),
    rightUpperArm: mirrorRigEuler(makeRigEuler(leftStride * 0.65, 0, -0.12)),
    leftLowerArm: makeRigEuler(0.18 + rightLift * 0.28, 0, -0.04),
    rightLowerArm: mirrorRigEuler(makeRigEuler(0.18 + leftLift * 0.28, 0, -0.04)),
    leftHand: makeRigEuler(rightStride * 0.12, 0, -0.05),
    rightHand: mirrorRigEuler(makeRigEuler(leftStride * 0.12, 0, -0.05)),
    leftUpperLeg: makeRigEuler(leftStride * 0.78, 0, -0.05),
    rightUpperLeg: mirrorRigEuler(makeRigEuler(rightStride * 0.78, 0, -0.05)),
    leftLowerLeg: makeRigEuler(leftLift * 0.82, 0, 0.04),
    rightLowerLeg: mirrorRigEuler(makeRigEuler(rightLift * 0.82, 0, 0.04)),
    leftFoot: makeRigEuler(leftStride * 0.22 - leftLift * 0.25, 0, -0.03),
    rightFoot: mirrorRigEuler(makeRigEuler(rightStride * 0.22 - rightLift * 0.25, 0, -0.03)),
  };

  for (const { slot, bone, quat, position } of rigPoseBase.values()) {
    const euler = slotOffsets[slot] || makeRigEuler();
    bone.position.copy(position);

    if (slot === 'hips') {
      bone.position.y += hipBob;
    }

    bone.quaternion.copy(quat).multiply(new THREE.Quaternion().setFromEuler(euler));
    applyBoneOverrideToAnimatedPose(slot, bone);
  }

  if (runtimeRetargetState.active) {
    applyRuntimeRetargetLayer();
  } else if (uploadedAvatarRoot) {
    uploadedAvatarRoot.updateMatrixWorld(true);
  } else if (fallbackRigState.active && fallbackRigState.root) {
    fallbackRigState.root.updateMatrixWorld(true);
  }
}

function applyRigIdlePreview(nowMs) {
  if (!rigIdleState.active) return;

  const elapsedSec = Math.max(0, (nowMs - rigIdleState.startAtMs) / 1000);
  const phase = elapsedSec * rigIdleState.cycleHz * Math.PI * 2;
  const breath = Math.sin(phase);
  const subtleShift = Math.sin(phase * 0.5 + 0.7);
  const slotOffsets = {
    hips: makeRigEuler(0, subtleShift * 0.03, subtleShift * 0.02),
    spine: makeRigEuler(breath * 0.02, subtleShift * 0.015, 0),
    chest: makeRigEuler(breath * 0.04, subtleShift * 0.02, 0),
    head: makeRigEuler(breath * 0.03, subtleShift * 0.04, 0),
    leftUpperArm: makeRigEuler(0.08 + breath * 0.04, 0, -0.05),
    rightUpperArm: mirrorRigEuler(makeRigEuler(0.08 + breath * 0.04, 0, -0.05)),
    leftLowerArm: makeRigEuler(0.08 + breath * 0.05, 0, -0.02),
    rightLowerArm: mirrorRigEuler(makeRigEuler(0.08 + breath * 0.05, 0, -0.02)),
    leftHand: makeRigEuler(breath * 0.03, 0, -0.02),
    rightHand: mirrorRigEuler(makeRigEuler(breath * 0.03, 0, -0.02)),
    leftUpperLeg: makeRigEuler(0.01 + subtleShift * 0.015, 0, 0),
    rightUpperLeg: mirrorRigEuler(makeRigEuler(0.01 + subtleShift * 0.015, 0, 0)),
    leftLowerLeg: makeRigEuler(0.02, 0, 0),
    rightLowerLeg: makeRigEuler(0.02, 0, 0),
    leftFoot: makeRigEuler(0, 0, 0),
    rightFoot: makeRigEuler(0, 0, 0),
  };

  for (const { slot, bone, quat, position } of rigPoseBase.values()) {
    const euler = slotOffsets[slot] || makeRigEuler();
    bone.position.copy(position);

    if (slot === 'hips') {
      bone.position.y += Math.abs(breath) * 0.008;
    }

    bone.quaternion.copy(quat).multiply(new THREE.Quaternion().setFromEuler(euler));
    applyBoneOverrideToAnimatedPose(slot, bone);
  }

  if (runtimeRetargetState.active) {
    applyRuntimeRetargetLayer();
  } else if (uploadedAvatarRoot) {
    uploadedAvatarRoot.updateMatrixWorld(true);
  } else if (fallbackRigState.active && fallbackRigState.root) {
    fallbackRigState.root.updateMatrixWorld(true);
  }
}

function applyRigDancePreview(nowMs) {
  if (!rigDanceState.active) return;

  const elapsedSec = Math.max(0, (nowMs - rigDanceState.startAtMs) / 1000);
  const phase = elapsedSec * rigDanceState.cycleHz * Math.PI * 2;
  const twoStep = Math.sin(phase);
  const bounce = Math.max(0, Math.sin(phase * 2));
  const shoulderPop = Math.sin(phase * 2 + Math.PI * 0.25);
  const leftLead = Math.max(0, twoStep);
  const rightLead = Math.max(0, -twoStep);
  const hipBob = -0.012 + bounce * 0.022;
  const sideShift = twoStep * 0.038;
  const torsoTwist = twoStep * 0.28;

  const slotOffsets = {
    hips: makeRigEuler(0, torsoTwist * 0.65, twoStep * 0.1),
    spine: makeRigEuler(0.04 * shoulderPop, torsoTwist * 0.35, 0),
    chest: makeRigEuler(0.08 * shoulderPop, torsoTwist, twoStep * 0.06),
    head: makeRigEuler(0.03 * shoulderPop, -torsoTwist * 0.45, -twoStep * 0.05),
    leftUpperArm: makeRigEuler(0.35 + leftLead * 0.28 + bounce * 0.12, 0.14 + torsoTwist * 0.2, -0.46),
    rightUpperArm: makeRigEuler(0.35 + rightLead * 0.28 + bounce * 0.12, -0.14 - torsoTwist * 0.2, 0.46),
    leftLowerArm: makeRigEuler(0.52 + leftLead * 0.25, 0.02, -0.06),
    rightLowerArm: makeRigEuler(0.52 + rightLead * 0.25, -0.02, 0.06),
    leftHand: makeRigEuler(leftLead * 0.18, 0, -0.1),
    rightHand: makeRigEuler(rightLead * 0.18, 0, 0.1),
    leftUpperLeg: makeRigEuler(leftLead * 0.22 - rightLead * 0.08, 0, -0.1),
    rightUpperLeg: makeRigEuler(rightLead * 0.22 - leftLead * 0.08, 0, 0.1),
    leftLowerLeg: makeRigEuler(rightLead * 0.2, 0, 0),
    rightLowerLeg: makeRigEuler(leftLead * 0.2, 0, 0),
    leftFoot: makeRigEuler(leftLead * 0.1 - rightLead * 0.04, 0, -0.045),
    rightFoot: makeRigEuler(rightLead * 0.1 - leftLead * 0.04, 0, 0.045),
  };

  for (const { slot, bone, quat, position } of rigPoseBase.values()) {
    const euler = slotOffsets[slot] || makeRigEuler();
    bone.position.copy(position);

    if (slot === 'hips') {
      bone.position.y += hipBob;
      bone.position.x += sideShift;
    }

    bone.quaternion.copy(quat).multiply(new THREE.Quaternion().setFromEuler(euler));
    applyBoneOverrideToAnimatedPose(slot, bone);
  }

  if (runtimeRetargetState.active) {
    applyRuntimeRetargetLayer();
  } else if (uploadedAvatarRoot) {
    uploadedAvatarRoot.updateMatrixWorld(true);
  } else if (fallbackRigState.active && fallbackRigState.root) {
    fallbackRigState.root.updateMatrixWorld(true);
  }
}

function applyRigFrontFlipPreview(nowMs) {
  if (!rigPoseState.active) return;

  const elapsed = nowMs - rigPoseState.startAtMs;
  const t = Math.min(1, elapsed / rigPoseState.durationMs);
  const easedT = t * t * (3 - 2 * t);
  const lift = Math.pow(Math.sin(easedT * Math.PI), 1.15);
  const tuck = Math.pow(Math.sin(easedT * Math.PI), 1.35);
  const spin = easedT * Math.PI * 2;
  const slotOffsets = {
    hips: makeRigEuler(spin * 0.85, 0, 0),
    spine: makeRigEuler(spin * 0.95, 0, 0),
    chest: makeRigEuler(spin, 0, 0),
    head: makeRigEuler(spin * 0.9 - tuck * 0.2, 0, 0),
    leftUpperArm: makeRigEuler(0.25 + tuck * 0.65, 0.05, -0.35),
    rightUpperArm: mirrorRigEuler(makeRigEuler(0.25 + tuck * 0.65, 0.05, -0.35)),
    leftLowerArm: makeRigEuler(0.35 + tuck * 0.9, 0, 0),
    rightLowerArm: mirrorRigEuler(makeRigEuler(0.35 + tuck * 0.9, 0, 0)),
    leftHand: makeRigEuler(tuck * 0.2, 0, -0.08),
    rightHand: mirrorRigEuler(makeRigEuler(tuck * 0.2, 0, -0.08)),
    leftUpperLeg: makeRigEuler(-0.1 + tuck * 1.05, 0, -0.05),
    rightUpperLeg: mirrorRigEuler(makeRigEuler(-0.1 + tuck * 1.05, 0, -0.05)),
    leftLowerLeg: makeRigEuler(tuck * 1.1, 0, 0),
    rightLowerLeg: mirrorRigEuler(makeRigEuler(tuck * 1.1, 0, 0)),
    leftFoot: makeRigEuler(-0.1 + tuck * 0.25, 0, 0),
    rightFoot: mirrorRigEuler(makeRigEuler(-0.1 + tuck * 0.25, 0, 0)),
  };

  for (const { slot, bone, quat, position } of rigPoseBase.values()) {
    const euler = slotOffsets[slot] || makeRigEuler();
    bone.position.copy(position);

    if (slot === 'hips') {
      bone.position.y += lift * 0.3;
      bone.position.z += Math.sin(easedT * Math.PI) * -0.05;
    }

    const offsetQ = new THREE.Quaternion().setFromEuler(euler);
    bone.quaternion.copy(quat).multiply(offsetQ);
    applyBoneOverrideToAnimatedPose(slot, bone);
  }

  if (runtimeRetargetState.active) {
    applyRuntimeRetargetLayer();
  } else if (uploadedAvatarRoot) {
    uploadedAvatarRoot.updateMatrixWorld(true);
  } else if (fallbackRigState.active && fallbackRigState.root) {
    fallbackRigState.root.updateMatrixWorld(true);
  }

  if (elapsed >= rigPoseState.durationMs) {
    restoreRigBasePose();
    rigPoseState.active = false;
    modelStatusEl.textContent = 'Front flip preview complete.';
  }
}

function loadAvatarModel(modelUrl) {
  return new Promise((resolve, reject) => {
    gltfLoader.load(
      modelUrl,
      (gltf) => {
        const root = gltf.scene || gltf.scenes?.[0];
        if (!root) {
          reject(new Error('Model has no scene root'));
          return;
        }
        resolve(root);
      },
      undefined,
      (error) => reject(error),
    );
  });
}

function ensureTrainingDummyBasePoseMap(root) {
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
}

function findFirstBoneByPattern(root, pattern) {
  if (!root) return null;
  let found = null;
  root.traverse((child) => {
    if (found || !child || !child.isBone) return;
    const boneName = String(child.name || '');
    if (pattern.test(boneName)) found = child;
  });
  return found;
}

function applyTrainingDummyPoseToRoot(root, poseName = 'idle') {
  if (!root) return;
  const pose = String(poseName || 'idle').toLowerCase();
  const baseMap = ensureTrainingDummyBasePoseMap(root);
  if (baseMap) {
    baseMap.forEach(({ bone, quat, pos }) => {
      bone.quaternion.copy(quat);
      bone.position.copy(pos);
    });
  }

  if (root === trainingDummyPoseRoot) {
    trainingDummyPoseRoot.rotation.set(0, 0, 0);
    trainingDummyArmL.rotation.set(0, 0, Math.PI / 2.6);
    trainingDummyArmR.rotation.set(0, 0, -Math.PI / 2.6);
    if (pose === 'guard') {
      trainingDummyArmL.rotation.set(-0.25, 0.06, Math.PI / 2.9);
      trainingDummyArmR.rotation.set(-0.25, -0.06, -Math.PI / 2.9);
    } else if (pose === 'taunt') {
      trainingDummyArmL.rotation.set(-0.58, 0.16, Math.PI / 1.85);
      trainingDummyArmR.rotation.set(0.26, -0.08, -Math.PI / 2.9);
      trainingDummyPoseRoot.rotation.y = 0.18;
    } else if (pose === 'slump') {
      trainingDummyPoseRoot.rotation.x = 0.22;
      trainingDummyArmL.rotation.set(0.42, 0, Math.PI / 2.95);
      trainingDummyArmR.rotation.set(0.42, 0, -Math.PI / 2.95);
    }
    return;
  }

  root.rotation.set(0, 0, 0);
  root.position.y = 0;
  const leftUpperArm = findFirstBoneByPattern(root, /(left.*upperarm|upperarm.*left|leftarm|arm_l|l_upperarm|larm)/i);
  const rightUpperArm = findFirstBoneByPattern(root, /(right.*upperarm|upperarm.*right|rightarm|arm_r|r_upperarm|rarm)/i);
  const chest = findFirstBoneByPattern(root, /(chest|upperchest|spine2|spine_2|spine3|spine_3|torso)/i);
  const head = findFirstBoneByPattern(root, /(head|neck)/i);

  if (pose === 'guard') {
    if (leftUpperArm) leftUpperArm.rotation.x += -0.45;
    if (rightUpperArm) rightUpperArm.rotation.x += -0.45;
    if (leftUpperArm) leftUpperArm.rotation.z += 0.25;
    if (rightUpperArm) rightUpperArm.rotation.z += -0.25;
  } else if (pose === 'taunt') {
    if (leftUpperArm) leftUpperArm.rotation.x += -1.1;
    if (leftUpperArm) leftUpperArm.rotation.z += 0.3;
    if (rightUpperArm) rightUpperArm.rotation.x += -0.2;
    if (rightUpperArm) rightUpperArm.rotation.z += -0.12;
    if (head) head.rotation.y += 0.22;
    root.rotation.y = 0.24;
  } else if (pose === 'slump') {
    if (chest) chest.rotation.x += 0.34;
    if (head) head.rotation.x += 0.2;
    if (leftUpperArm) leftUpperArm.rotation.x += 0.22;
    if (rightUpperArm) rightUpperArm.rotation.x += 0.22;
    root.position.y = -0.06;
  }
}

function normalizeTrainingDummyModel(modelRoot) {
  modelRoot.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(modelRoot);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const targetHeight = 1.92;
  const safeHeight = Math.max(size.y, 0.001);
  const scale = targetHeight / safeHeight;
  modelRoot.scale.setScalar(scale);
  modelRoot.updateMatrixWorld(true);

  const scaledBox = new THREE.Box3().setFromObject(modelRoot);
  const scaledCenter = scaledBox.getCenter(new THREE.Vector3());
  const minY = scaledBox.min.y;

  modelRoot.position.x += -scaledCenter.x;
  modelRoot.position.y += -minY;
  modelRoot.position.z += -scaledCenter.z;

  modelRoot.traverse((child) => {
    if (!child || !child.isMesh) return;
    child.castShadow = true;
    child.receiveShadow = true;
  });
}

function clearTrainingDummyPreviewModel() {
  if (!uploadedTrainingDummyRoot) return;
  if (uploadedTrainingDummyRoot.parent) uploadedTrainingDummyRoot.parent.remove(uploadedTrainingDummyRoot);
  uploadedTrainingDummyRoot.traverse((child) => {
    if (child.geometry && typeof child.geometry.dispose === 'function') child.geometry.dispose();
    if (!child.material) return;
    if (Array.isArray(child.material)) {
      child.material.forEach((mat) => {
        if (mat && typeof mat.dispose === 'function') mat.dispose();
      });
    } else if (typeof child.material.dispose === 'function') {
      child.material.dispose();
    }
  });
  uploadedTrainingDummyRoot = null;
}

async function applyUploadedTrainingDummy(modelUrl) {
  try {
    if (!dummyModelStatusEl) return;
    dummyModelStatusEl.textContent = 'Loading dummy model...';
    const root = await loadAvatarModel(modelUrl);
    clearTrainingDummyPreviewModel();
    normalizeTrainingDummyModel(root);
    uploadedTrainingDummyRoot = root;
    trainingDummyPreview.add(uploadedTrainingDummyRoot);
    trainingDummyFallbackRoot.visible = false;
    applyTrainingDummyPoseToRoot(uploadedTrainingDummyRoot, profile.trainingDummy?.pose || 'idle');
    dummyModelStatusEl.textContent = `Dummy model loaded. Pose: ${profile.trainingDummy?.pose || 'idle'}.`;
  } catch (error) {
    clearTrainingDummyPreviewModel();
    trainingDummyFallbackRoot.visible = true;
    applyTrainingDummyPoseToRoot(trainingDummyPoseRoot, profile.trainingDummy?.pose || 'idle');
    if (dummyModelStatusEl) dummyModelStatusEl.textContent = `Dummy model failed: ${error}`;
    if (profile.trainingDummy) profile.trainingDummy.modelUrl = null;
  }
}

async function uploadTrainingDummyModelFile() {
  if (!dummyModelFileEl || !dummyModelUploadBtn || !dummyModelStatusEl) return;

  const files = dummyModelFileEl.files ? Array.from(dummyModelFileEl.files) : [];
  if (!files.length) {
    dummyModelStatusEl.textContent = 'Choose a .glb or .gltf file first.';
    return;
  }

  const primary = files.find((f) => f.name.toLowerCase().endsWith('.glb'))
    || files.find((f) => f.name.toLowerCase().endsWith('.gltf'));
  if (!primary) {
    dummyModelStatusEl.textContent = 'Only .glb and .gltf files are supported.';
    return;
  }

  dummyModelUploadBtn.disabled = true;
  dummyModelStatusEl.textContent = 'Uploading dummy model...';

  try {
    const form = new FormData();
    for (const file of files) {
      form.append('model_files', file);
    }
    form.append('model_entry', primary.name);

    const res = await fetch('/api/upload-character-model', {
      method: 'POST',
      body: form,
    });
    const data = await res.json();
    if (!res.ok || !data.ok || !data.model_url) {
      dummyModelStatusEl.textContent = data.error || 'Dummy upload failed.';
      dummyModelUploadBtn.disabled = false;
      return;
    }

    profile.trainingDummy.modelUrl = data.model_url;
    await applyUploadedTrainingDummy(profile.trainingDummy.modelUrl);
    refreshPreview();
  } catch (error) {
    dummyModelStatusEl.textContent = `Dummy upload failed: ${error}`;
  }

  dummyModelUploadBtn.disabled = false;
}

async function applyUploadedAvatar(modelUrl) {
  try {
    modelStatusEl.textContent = 'Loading model...';
    const root = await loadAvatarModel(modelUrl);
    clearUploadedAvatar();
    normalizeUploadedModel(root);
    uploadedAvatarRoot = root;
    avatar.add(uploadedAvatarRoot);
    setProceduralAvatarVisible(false);
    const rigReport = analyzeRig(root);
    latestImportedRigReport = rigReport;
    const savedMetricOverrides = sanitizeFallbackRigMetricOverrides(
      profile.rigSettings?.metricOverrides,
      collectFallbackRigMetrics(root),
    );
    fallbackRigState.metricOverrides = { ...savedMetricOverrides };
    boneRotationOverrides = { ...profile.rigSettings?.boneRotationOverrides } || {};
    if (profile.rigSettings?.useFallbackRig) {
      clearUploadedRigHelper();
      createFallbackRig(uploadedAvatarRoot, { metricOverrides: savedMetricOverrides });
      applyBoneRotationOverrides();
      renderRigReport(fallbackRigState.report, 'fallback rebone');
      modelStatusEl.textContent = 'Custom model loaded. Restored saved fallback rig tuning.';
      syncFallbackRigEditorPanel();
      return;
    }
    if (rigReport.skinnedMeshCount > 0) {
      showUploadedRigHelper(uploadedAvatarRoot);
    }
    renderRigReport(rigReport);
    modelStatusEl.textContent = `Custom model loaded. ${rigReport.classification.label}. Bone overlay visible.`;
    syncFallbackRigEditorPanel();
  } catch (error) {
    clearUploadedAvatar();
    setProceduralAvatarVisible(true);
    profile.modelUrl = null;
    renderRigReport(null);
    modelStatusEl.textContent = `Model load failed: ${error}`;
    syncFallbackRigEditorPanel();
  }
}

async function uploadModelFile() {
  const files = modelFileEl.files ? Array.from(modelFileEl.files) : [];
  if (!files.length) {
    modelStatusEl.textContent = 'Choose a .glb or .gltf file first.';
    return;
  }
  const primary = files.find((f) => f.name.toLowerCase().endsWith('.glb'))
    || files.find((f) => f.name.toLowerCase().endsWith('.gltf'));

  if (!primary) {
    modelStatusEl.textContent = 'Only .glb and .gltf files are supported.';
    return;
  }

  modelUploadBtn.disabled = true;
  modelStatusEl.textContent = 'Uploading model...';

  try {
    const form = new FormData();
    for (const file of files) {
      form.append('model_files', file);
    }
    form.append('model_entry', primary.name);
    const res = await fetch('/api/upload-character-model', {
      method: 'POST',
      body: form,
    });
    const data = await res.json();
    if (!res.ok || !data.ok || !data.model_url) {
      modelStatusEl.textContent = data.error || 'Upload failed.';
      modelUploadBtn.disabled = false;
      return;
    }

    profile.modelUrl = data.model_url;
    await applyUploadedAvatar(profile.modelUrl);
    refreshPreview();
  } catch (error) {
    modelStatusEl.textContent = `Upload failed: ${error}`;
  }

  modelUploadBtn.disabled = false;
}

function applyAura(hex) {
  const color = new THREE.Color(hex);
  avatarBodyMat.color.copy(color).offsetHSL(0, -0.08, -0.05);
  avatarBodyMat.emissive.copy(color).multiplyScalar(0.11);
  avatarClothMat.color.copy(color).offsetHSL(0, -0.2, -0.28);
  avatarOrbMat.color.copy(color).offsetHSL(0, -0.06, 0.2);
  avatarOrbMat.emissive.copy(color).multiplyScalar(0.2);
  auraRing.material.color.copy(color);
}

function updateClassProp(_className) {
  // Class hand items are intentionally hidden for now.
}

function refreshPreview() {
  profile.name = (nameEl?.value || profile.name || '').trim() || 'Unnamed Hero';
  profile.side = String(sideEl?.value || profile.side || 'heroes').toLowerCase();
  profile.role = roleEl?.value === 'dm' ? 'dm' : 'player';
  profile.species = resolvedSelectValue(speciesEl, speciesOtherEl, 'Custom Species');
  profile.className = resolvedSelectValue(classEl, classOtherEl, 'Custom Class');
  profile.origin = resolvedSelectValue(originEl, originOtherEl, 'Unknown Origin');
  profile.voice = resolvedSelectValue(voiceEl, voiceOtherEl, 'Custom Voice');
  profile.aura = colorEl?.value || profile.aura || '#7f6bff';
  if (!profile.trainingDummy || typeof profile.trainingDummy !== 'object') {
    profile.trainingDummy = { modelUrl: null, pose: 'idle' };
  }
  profile.trainingDummy.pose = String(dummyPoseEl?.value || profile.trainingDummy.pose || 'idle').toLowerCase();

  applyAura(profile.aura);
  updateClassProp(profile.className);

  const activeDummyRoot = uploadedTrainingDummyRoot || trainingDummyPoseRoot;
  applyTrainingDummyPoseToRoot(activeDummyRoot, profile.trainingDummy.pose);

  if (previewEl) {
    previewEl.textContent = [
      `Name: ${profile.name}`,
      `Side: ${profile.side}`,
      `Class: ${profile.className}`,
      `Species: ${profile.species}`,
      `Origin: ${profile.origin}`,
      `Voice: ${profile.voice}`,
      `Aura: ${profile.aura.toUpperCase()}`,
      `Model: ${profile.modelUrl ? 'Custom GLTF/GLB' : 'Procedural Avatar'}`,
    ].join('\n');
  }

  if (fireplaceLobbyJoined) {
    publishLocalPresenceToLobby();
  }
}

function randomizeProfile() {
  nameEl.value = randomNames[Math.floor(Math.random() * randomNames.length)];
  speciesEl.selectedIndex = Math.floor(Math.random() * speciesEl.options.length);
  if (speciesEl.value === '__other__') speciesEl.selectedIndex = 0;
  classEl.selectedIndex = Math.floor(Math.random() * classEl.options.length);
  if (classEl.value === '__other__') classEl.selectedIndex = 0;
  originEl.selectedIndex = Math.floor(Math.random() * originEl.options.length);
  if (originEl.value === '__other__') originEl.selectedIndex = 0;
  voiceEl.selectedIndex = Math.floor(Math.random() * voiceEl.options.length);
  if (voiceEl.value === '__other__') voiceEl.selectedIndex = 0;
  speciesOtherEl.value = '';
  classOtherEl.value = '';
  originOtherEl.value = '';
  voiceOtherEl.value = '';
  colorEl.value = auraPalette[Math.floor(Math.random() * auraPalette.length)];
  toggleOtherInput(speciesEl, speciesOtherEl);
  toggleOtherInput(classEl, classOtherEl);
  toggleOtherInput(originEl, originOtherEl);
  toggleOtherInput(voiceEl, voiceOtherEl);
  refreshPreview();
}

function escapeLobbyText(value) {
  return String(value || '').replace(/[\r\n]+/g, ' ').trim();
}

function setLobbyStatus(text) {
  if (!lobbyStatusEl) return;
  lobbyStatusEl.textContent = text;
}

function syncLocalProfileFromLobbyEntry(entry) {
  if (!entry || String(entry.id || '') !== String(fireplaceLobbyLocalSid || '')) return;
  const authoritativeSide = normalizeLobbySide(entry.side);
  if (profile.side !== authoritativeSide) {
    profile.side = authoritativeSide;
    if (sideEl) sideEl.value = authoritativeSide;
    setLobbyStatus(`Joined lobby as ${profile.name} (${profile.side}) · ${profile.role.toUpperCase()}.`);
  }
}

function normalizeLobbySide(value) {
  const side = String(value || '').trim().toLowerCase();
  return side === 'villains' ? 'villains' : 'heroes';
}

function getLobbyPlacement(team, index) {
  const slots = lobbySlotLayouts[team] || [];
  const fallbackZ = 2.6 - (index * 2.3);
  const pos = slots[index] || { x: team === 'villains' ? 4.4 : -4.4, z: fallbackZ };
  return {
    x: pos.x,
    y: 0,
    z: pos.z,
    rotationY: team === 'heroes' ? -Math.PI / 2 : Math.PI / 2,
  };
}

function disposeObject3D(root) {
  if (!root) return;
  root.traverse((child) => {
    if (child.geometry && typeof child.geometry.dispose === 'function') child.geometry.dispose();
    const material = child.material;
    if (Array.isArray(material)) {
      material.forEach((mat) => {
        if (mat && typeof mat.dispose === 'function') mat.dispose();
      });
    } else if (material && typeof material.dispose === 'function') {
      material.dispose();
    }
  });
}

function createProceduralRosterAvatar(colorHex = '#7f6bff') {
  const root = new THREE.Group();
  root.position.y = 0.24;

  const color = new THREE.Color(colorHex);
  const bodyMat = new THREE.MeshStandardMaterial({
    color: color.clone().offsetHSL(0, -0.08, -0.05),
    roughness: 0.62,
    metalness: 0.08,
    emissive: color.clone().multiplyScalar(0.11),
  });
  const clothMat = new THREE.MeshStandardMaterial({
    color: color.clone().offsetHSL(0, -0.2, -0.28),
    roughness: 0.9,
    metalness: 0.03,
  });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xe9cdb0, roughness: 0.72, metalness: 0.01 });
  const hairMat = new THREE.MeshStandardMaterial({ color: 0x2c1f18, roughness: 0.84, metalness: 0.02 });
  const orbMat = new THREE.MeshStandardMaterial({
    color: color.clone().offsetHSL(0, -0.06, 0.2),
    roughness: 0.26,
    metalness: 0.28,
    emissive: color.clone().multiplyScalar(0.2),
    emissiveIntensity: 0.45,
  });

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.285, 0.56, 6, 12), bodyMat);
  torso.position.y = 1.02;
  root.add(torso);

  const shoulders = new THREE.Mesh(new THREE.CapsuleGeometry(0.36, 0.24, 4, 10), clothMat);
  shoulders.rotation.z = Math.PI / 2;
  shoulders.position.y = 1.22;
  root.add(shoulders);

  const cloak = new THREE.Mesh(new THREE.ConeGeometry(0.43, 1.04, 14), clothMat);
  cloak.position.y = 0.64;
  cloak.rotation.y = Math.PI / 8;
  root.add(cloak);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 24, 20), skinMat);
  head.position.y = 1.58;
  root.add(head);

  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.205, 20, 16, 0, Math.PI * 2, 0, Math.PI * 0.58), hairMat);
  hair.position.y = 1.64;
  hair.position.z = -0.01;
  root.add(hair);

  const orb = new THREE.Mesh(new THREE.SphereGeometry(0.08, 16, 14), orbMat);
  orb.position.set(0, 1.33, 0.34);
  root.add(orb);

  const leftArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.44, 4, 8), skinMat);
  leftArm.position.set(-0.34, 1.04, 0.02);
  leftArm.rotation.z = Math.PI / 11;
  root.add(leftArm);

  const rightArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.44, 4, 8), skinMat);
  rightArm.position.set(0.34, 1.04, 0.02);
  rightArm.rotation.z = -Math.PI / 11;
  root.add(rightArm);

  const leftLeg = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.76, 4, 8), bodyMat);
  leftLeg.position.set(-0.14, 0.35, 0.03);
  root.add(leftLeg);

  const rightLeg = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.76, 4, 8), bodyMat);
  rightLeg.position.set(0.14, 0.35, 0.03);
  root.add(rightLeg);

  const boots = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.08, 0.3), new THREE.MeshStandardMaterial({ color: 0x18141e, roughness: 0.86, metalness: 0.02 }));
  boots.position.set(0, 0.04, 0.06);
  root.add(boots);

  root.userData.orb = orb;
  root.userData.leftArm = leftArm;
  root.userData.rightArm = rightArm;
  return root;
}

function removeRosterAvatarVisual(sid) {
  const record = rosterAvatarVisuals.get(sid);
  if (!record) return;
  if (record.modelRoot) disposeObject3D(record.modelRoot);
  if (record.proceduralRoot) disposeObject3D(record.proceduralRoot);
  if (record.root && record.root.parent) record.root.parent.remove(record.root);
  rosterAvatarVisuals.delete(sid);
}

async function ensureRosterAvatarVisual(sid, entry, placement) {
  let record = rosterAvatarVisuals.get(sid);
  if (!record) {
    const root = new THREE.Group();
    const proceduralRoot = createProceduralRosterAvatar(entry?.side === 'villains' ? '#ff8f8f' : '#8fe8bd');
    root.add(proceduralRoot);
    rosterAvatarLayer.add(root);
    record = {
      root,
      proceduralRoot,
      modelRoot: null,
      modelUrl: null,
      loadToken: 0,
    };
    rosterAvatarVisuals.set(sid, record);
  }

  record.root.position.set(placement.x, placement.y, placement.z);
  record.root.rotation.y = placement.rotationY;

  const desiredModelUrl = String(entry?.avatar?.modelUrl || 'fallback').trim() || 'fallback';
  if (desiredModelUrl === record.modelUrl) return;
  record.modelUrl = desiredModelUrl;
  record.loadToken += 1;
  const loadToken = record.loadToken;

  if (record.modelRoot) {
    if (record.modelRoot.parent) record.modelRoot.parent.remove(record.modelRoot);
    disposeObject3D(record.modelRoot);
    record.modelRoot = null;
  }

  if (desiredModelUrl === 'fallback') {
    record.proceduralRoot.visible = true;
    return;
  }

  record.proceduralRoot.visible = true;
  try {
    const root = await loadAvatarModel(desiredModelUrl);
    if (!rosterAvatarVisuals.has(sid)) {
      disposeObject3D(root);
      return;
    }
    const latest = rosterAvatarVisuals.get(sid);
    if (!latest || latest.loadToken !== loadToken) {
      disposeObject3D(root);
      return;
    }
    normalizeUploadedModel(root);
    root.position.y = 0.36;
    latest.modelRoot = root;
    latest.root.add(root);
    latest.proceduralRoot.visible = false;
  } catch (_) {
    const latest = rosterAvatarVisuals.get(sid);
    if (latest) latest.proceduralRoot.visible = true;
  }
}

function syncRosterAvatarVisuals(byTeam) {
  const desiredSids = new Set();
  const localSid = String(fireplaceLobbyLocalSid || '');

  for (const team of ['heroes', 'villains']) {
    const arr = byTeam[team] || [];
    arr.forEach((entry, index) => {
      if (String(entry.sid) === localSid) return;
      desiredSids.add(String(entry.sid));
      ensureRosterAvatarVisual(String(entry.sid), entry, getLobbyPlacement(team, index));
    });
  }

  for (const sid of Array.from(rosterAvatarVisuals.keys())) {
    if (!desiredSids.has(sid)) removeRosterAvatarVisual(sid);
  }
}

function refreshTeamPlatformAssignments() {
  const rows = Object.entries(fireplaceLobbyRoster || {});
  const heroes = [];
  const villains = [];

  for (const [sid, entry] of rows) {
    const side = normalizeLobbySide(entry?.side);
    const payload = {
      sid,
      name: escapeLobbyText(entry?.name || `Player-${String(sid).slice(0, 6)}`),
      side,
      avatar: entry?.avatar || null,
    };
    if (side === 'villains') villains.push(payload);
    else heroes.push(payload);
  }

  heroes.sort((a, b) => a.name.localeCompare(b.name));
  villains.sort((a, b) => a.name.localeCompare(b.name));

  const byTeam = { heroes, villains };
  let localSlot = null;
  let localPlacement = null;

  for (const slot of lobbyTeamSlots) {
    const arr = byTeam[slot.team] || [];
    const occupant = arr[slot.index] || null;
    slot.occupantSid = occupant ? occupant.sid : null;

    if (occupant) {
      const isYou = String(occupant.sid) === String(fireplaceLobbyLocalSid || '');
      const baseColor = slot.team === 'heroes' ? '#8fe8bd' : '#ff9b9b';
      const text = `${occupant.name}${isYou ? ' (You)' : ''}`;
      updateNameplateSprite(slot.plate, text, baseColor);
      slot.ringMat.opacity = isYou ? 0.82 : 0.58;
      if (isYou) {
        localSlot = slot;
        localPlacement = getLobbyPlacement(slot.team, slot.index);
      }
    } else {
      const emptyText = `${slot.team.toUpperCase()}-${slot.index + 1}`;
      updateNameplateSprite(slot.plate, emptyText, '#8d95b7');
      slot.ringMat.opacity = 0.22;
    }
  }

  if (!localPlacement) {
    for (const team of ['heroes', 'villains']) {
      const arr = byTeam[team] || [];
      const index = arr.findIndex((entry) => String(entry.sid) === String(fireplaceLobbyLocalSid || ''));
      if (index >= 0) {
        localPlacement = getLobbyPlacement(team, index);
        break;
      }
    }
  }

  if (!localSlot) {
    const fallbackTeam = normalizeLobbySide(profile.side);
    localSlot = lobbyTeamSlots.find((slot) => slot.team === fallbackTeam && slot.index === 0) || null;
    if (!localPlacement) localPlacement = getLobbyPlacement(fallbackTeam, 0);
  }

  if (localSlot) {
    localPreviewAnchor.position.copy(localSlot.root.position);
    localPreviewAnchor.rotation.y = localSlot.team === 'heroes' ? -Math.PI / 2 : Math.PI / 2;
  } else if (localPlacement) {
    localPreviewAnchor.position.set(localPlacement.x, localPlacement.y, localPlacement.z);
    localPreviewAnchor.rotation.y = localPlacement.rotationY;
  }

  syncRosterAvatarVisuals(byTeam);
}

function renderLobbyRoster() {
  refreshTeamPlatformAssignments();
  if (!lobbyRosterEl) return;
  const rows = Object.entries(fireplaceLobbyRoster || {});
  if (!rows.length) {
    lobbyRosterEl.textContent = 'Lobby roster will appear here.';
    return;
  }
  const lines = rows.map(([sid, entry]) => {
    const name = escapeLobbyText(entry?.name || `Player-${String(sid).slice(0, 6)}`);
    const side = escapeLobbyText(entry?.side || 'unknown');
    const role = entry?.role === 'dm' ? ' [DM]' : '';
    const you = String(sid) === String(fireplaceLobbyLocalSid || '') ? ' (You)' : '';
    return `${name} [${side}]${role}${you}`;
  });
  lobbyRosterEl.textContent = lines.join('\n');
}

function syncLobbyButtons() {
  if (startCombatBtn) startCombatBtn.style.display = fireplaceLobbyJoined ? '' : 'none';
  if (beginBtn) beginBtn.disabled = fireplaceLobbyJoined;
}

function publishLocalPresenceToLobby(options = {}) {
  const force = !!options.force;
  const optimistic = options.optimistic !== false;
  if (!fireplaceLobbySocket || !fireplaceLobbyJoined) return;

  const payload = {
    name: profile.name,
    side: normalizeLobbySide(profile.side),
    role: profile.role || 'player',
    avatar: { modelUrl: profile.modelUrl || 'fallback' },
  };
  const key = `${payload.name}|${payload.side}|${payload.role}|${payload.avatar.modelUrl}`;
  if (!force && key === fireplaceLobbyLastPresenceKey) return;
  fireplaceLobbyLastPresenceKey = key;

  fireplaceLobbySocket.emit('player-update', payload);

  if (optimistic && fireplaceLobbyLocalSid) {
    const sid = String(fireplaceLobbyLocalSid);
    fireplaceLobbyRoster[sid] = {
      ...(fireplaceLobbyRoster[sid] || {}),
      id: sid,
      name: payload.name,
      side: payload.side,
      role: payload.role,
      avatar: payload.avatar,
    };
    renderLobbyRoster();
  }
}

async function loadAvailableCharacterModels() {
  if (!modelSelectEl) return;
  modelSelectEl.innerHTML = '';
  const base = document.createElement('option');
  base.value = '';
  base.textContent = 'Procedural Avatar (no model file)';
  modelSelectEl.appendChild(base);

  try {
    const res = await fetch('/api/character-models');
    const payload = await res.json();
    const models = Array.isArray(payload?.models) ? payload.models : [];
    for (const row of models) {
      const url = String(row?.url || '').trim();
      if (!url) continue;
      const opt = document.createElement('option');
      opt.value = url;
      const label = String(row?.label || url).trim();
      const src = String(row?.source || '').trim();
      opt.textContent = src ? `${label} (${src})` : label;
      modelSelectEl.appendChild(opt);
    }
  } catch (error) {
    modelStatusEl.textContent = `Unable to load model list: ${error}`;
  }

  if (profile.modelUrl) {
    const existing = Array.from(modelSelectEl.options).find((o) => o.value === profile.modelUrl);
    if (!existing) {
      const custom = document.createElement('option');
      custom.value = profile.modelUrl;
      custom.textContent = `${profile.modelUrl.split('/').pop() || profile.modelUrl} (selected)`;
      modelSelectEl.appendChild(custom);
    }
    modelSelectEl.value = profile.modelUrl;
  }
}

function enterCombatMode() {
  if (COMBAT_ARENA_MODE) return; // already in the arena page
  stopFireplaceMusic();
  window.location.href = '/static/combat_arena.html';
}

function connectFireplaceLobby() {
  if (fireplaceLobbySocket || typeof window.io !== 'function') {
    if (typeof window.io !== 'function') setLobbyStatus('Socket.IO unavailable; lobby offline.');
    return;
  }

  fireplaceLobbySocket = window.io();

  fireplaceLobbySocket.on('connect', () => {
    fireplaceLobbyConnected = true;
    fireplaceLobbyLocalSid = fireplaceLobbySocket.id || null;
    setLobbyStatus('Connected to fireplace lobby.');
    renderLobbyRoster();
    if (fireplaceLobbyJoined) {
      fireplaceLobbySocket.emit('register-role', { role: profile.role });
      publishLocalPresenceToLobby({ force: true });
    }
    if (COMBAT_ARENA_MODE) {
      window.__LOBBY_SOCKET__ = fireplaceLobbySocket;
      window.__COMBAT_PLAYER_NAME__ = profile.name;
      window.__COMBAT_PLAYER_SIDE__ = profile.side;
      if (!document.getElementById('combat-ui-script')) {
        const script = document.createElement('script');
        script.id = 'combat-ui-script';
        script.src = '/static/combat-ui.js';
        document.body.appendChild(script);
      }
    }
  });

  fireplaceLobbySocket.on('disconnect', () => {
    fireplaceLobbyConnected = false;
    setLobbyStatus('Disconnected from lobby. Reconnecting...');
  });

  fireplaceLobbySocket.on('player-id', (payload) => {
    if (payload && payload.id) {
      fireplaceLobbyLocalSid = String(payload.id);
      renderLobbyRoster();
    }
  });

  fireplaceLobbySocket.on('players-state', (players) => {
    fireplaceLobbyRoster = (players && typeof players === 'object') ? players : {};
    syncLocalProfileFromLobbyEntry(fireplaceLobbyRoster[fireplaceLobbyLocalSid]);
    renderLobbyRoster();
  });

  fireplaceLobbySocket.on('player-update', (entry) => {
    if (!entry || !entry.id) return;
    fireplaceLobbyRoster[entry.id] = entry;
    syncLocalProfileFromLobbyEntry(entry);
    renderLobbyRoster();
  });

  fireplaceLobbySocket.on('player-joined', (entry) => {
    if (!entry || !entry.id) return;
    fireplaceLobbyRoster[entry.id] = entry;
    renderLobbyRoster();
  });

  fireplaceLobbySocket.on('player-left', (payload) => {
    const sid = String(payload?.id || '').trim();
    if (!sid) return;
    delete fireplaceLobbyRoster[sid];
    renderLobbyRoster();
  });

  fireplaceLobbySocket.on('combat-state', (packet) => {
    if (packet && packet.active) {
      stopFireplaceMusic();
      enterCombatMode();
    }
  });
}

function joinFireplaceLobby() {
  refreshPreview();
  profile.rigSettings = buildSavedRigSettings();
  try {
    localStorage.setItem('character_profile_v1', JSON.stringify(profile));
  } catch (_) {
    // Best effort only.
  }

  connectFireplaceLobby();
  fireplaceLobbyJoined = true;
  syncLobbyButtons();

  if (fireplaceLobbyConnected && fireplaceLobbySocket) {
    fireplaceLobbySocket.emit('register-role', { role: profile.role });
    publishLocalPresenceToLobby({ force: true });
  }

  setLobbyStatus(`Joined lobby as ${profile.name} (${profile.side}) · ${profile.role.toUpperCase()}.`);
}

function requestCombatStartFromLobby() {
  if (!fireplaceLobbySocket) {
    setLobbyStatus('Lobby is not connected yet.');
    return;
  }
  fireplaceLobbySocket.emit('combat-start', {});
  setLobbyStatus('Combat start requested...');
}

function saveAndBegin() {
  joinFireplaceLobby();
}

try {
  const saved = JSON.parse(localStorage.getItem('character_profile_v1') || 'null');
  if (saved && typeof saved === 'object') {
    Object.assign(profile, saved);
    if (!profile.trainingDummy || typeof profile.trainingDummy !== 'object') {
      profile.trainingDummy = { modelUrl: null, pose: 'idle' };
    }
    profile.trainingDummy.modelUrl = typeof profile.trainingDummy.modelUrl === 'string'
      ? profile.trainingDummy.modelUrl
      : null;
    profile.trainingDummy.pose = String(profile.trainingDummy.pose || 'idle').toLowerCase();
    profile.role = profile.role === 'dm' ? 'dm' : 'player';
  }
} catch (_) {
  // Ignore malformed local profile.
}

profile.side = String(profile.side || 'heroes').toLowerCase() === 'villains' ? 'villains' : 'heroes';

if (!COMBAT_ARENA_MODE) {
  if (nameEl) nameEl.value = profile.name;
  if (sideEl) sideEl.value = profile.side;
  if (roleEl) roleEl.value = profile.role === 'dm' ? 'dm' : 'player';
  setSelectOrOther(speciesEl, speciesOtherEl, profile.species);
  setSelectOrOther(classEl, classOtherEl, profile.className);
  setSelectOrOther(originEl, originOtherEl, profile.origin);
  setSelectOrOther(voiceEl, voiceOtherEl, profile.voice);
  if (colorEl) colorEl.value = profile.aura;
  if (dummyPoseEl) {
    const allowedPoses = new Set(['idle', 'guard', 'taunt', 'slump']);
    dummyPoseEl.value = allowedPoses.has(profile.trainingDummy.pose) ? profile.trainingDummy.pose : 'idle';
  }
}

refreshPreview();
syncLobbyButtons();
renderLobbyRoster();
connectFireplaceLobby();
if (!COMBAT_ARENA_MODE) loadAvailableCharacterModels();

if (!COMBAT_ARENA_MODE) {
[nameEl, sideEl, roleEl, speciesEl, classEl, originEl, voiceEl, colorEl].filter(Boolean).forEach((el) => {
  el.addEventListener('input', refreshPreview);
  el.addEventListener('change', refreshPreview);
});

[speciesEl, classEl, originEl, voiceEl].filter(Boolean).forEach((el) => {
  el.addEventListener('change', () => {
    toggleOtherInput(speciesEl, speciesOtherEl);
    toggleOtherInput(classEl, classOtherEl);
    toggleOtherInput(originEl, originOtherEl);
    toggleOtherInput(voiceEl, voiceOtherEl);
    refreshPreview();
  });
});

[speciesOtherEl, classOtherEl, originOtherEl, voiceOtherEl].forEach((el) => {
  el.addEventListener('input', refreshPreview);
  el.addEventListener('change', refreshPreview);
});

toggleOtherInput(speciesEl, speciesOtherEl);
toggleOtherInput(classEl, classOtherEl);
toggleOtherInput(originEl, originOtherEl);
toggleOtherInput(voiceEl, voiceOtherEl);

if (randomBtn) randomBtn.addEventListener('click', randomizeProfile);
if (beginBtn) beginBtn.addEventListener('click', saveAndBegin);
if (startCombatBtn) startCombatBtn.addEventListener('click', requestCombatStartFromLobby);
if (backLinkEl) {
  backLinkEl.addEventListener('click', () => {
    stopFireplaceMusic();
  });
}
if (modelUploadBtn) modelUploadBtn.addEventListener('click', uploadModelFile);
if (modelRefreshBtn) modelRefreshBtn.addEventListener('click', loadAvailableCharacterModels);
if (modelSelectEl) {
  modelSelectEl.addEventListener('change', async () => {
    const selected = String(modelSelectEl.value || '').trim();
    profile.modelUrl = selected || null;
    if (!profile.modelUrl) {
      clearUploadedAvatar();
      setProceduralAvatarVisible(true);
      renderRigReport(null);
      modelStatusEl.textContent = 'Using procedural avatar from fireplace preview.';
      refreshPreview();
      return;
    }
    await applyUploadedAvatar(profile.modelUrl);
    refreshPreview();
  });
}
if (dummyModelUploadBtn) dummyModelUploadBtn.addEventListener('click', uploadTrainingDummyModelFile);
if (dummyPoseEl) {
  dummyPoseEl.addEventListener('change', () => {
    profile.trainingDummy.pose = String(dummyPoseEl.value || 'idle').toLowerCase();
    const activeDummyRoot = uploadedTrainingDummyRoot || trainingDummyPoseRoot;
    applyTrainingDummyPoseToRoot(activeDummyRoot, profile.trainingDummy.pose);
    if (dummyModelStatusEl) {
      dummyModelStatusEl.textContent = profile.trainingDummy.modelUrl
        ? `Dummy pose updated to ${profile.trainingDummy.pose}.`
        : `Using default dummy model with ${profile.trainingDummy.pose} pose.`;
    }
    refreshPreview();
  });
}
if (rigFrontFlipBtn) rigFrontFlipBtn.addEventListener('click', startRigFrontFlipPreview);
if (rigIdleBtn) rigIdleBtn.addEventListener('click', startRigIdlePreview);
rigWalkBtn.addEventListener('click', startRigWalkPreview);
if (rigDanceBtn) rigDanceBtn.addEventListener('click', startRigDancePreview);
rigReboneBtn.addEventListener('click', toggleFallbackRebone);
if (rigClearRotationsBtn) rigClearRotationsBtn.addEventListener('click', clearBoneRotationOverrides);
if (rigDiagnosticsBtn) rigDiagnosticsBtn.addEventListener('click', showRigDiagnostics);

updateRigIdleButton();
updateRigWalkButton();
updateRigDanceButton();
updateRigReboneButton();
} // end !COMBAT_ARENA_MODE creator panel wiring

if (profile.modelUrl) {
  applyUploadedAvatar(profile.modelUrl);
} else {
  renderRigReport(null);
}

if (profile.trainingDummy?.modelUrl) {
  applyUploadedTrainingDummy(profile.trainingDummy.modelUrl);
} else {
  trainingDummyFallbackRoot.visible = true;
  applyTrainingDummyPoseToRoot(trainingDummyPoseRoot, profile.trainingDummy?.pose || 'idle');
}

if (!SHOW_NON_PLAYER_STAGING) {
  const dummyModelWrap = dummyModelFileEl?.closest('label');
  if (dummyModelWrap) dummyModelWrap.style.display = 'none';
}

window.fireplaceRigRetarget = {
  setControls: setRuntimeRetargetControls,
  setSlotTarget: setRuntimeRetargetSlotTarget,
  clearSlotTarget: (slot) => setRuntimeRetargetSlotTarget(slot, null),
  getDiagnostics: getRuntimeRetargetDiagnostics,
  rebuild: () => setupRuntimeRetargetLayer(),
  getFallbackMetrics: () => ({
    active: fallbackRigState.active,
    baseMetrics: cloneFallbackMetricMap(fallbackRigState.baseMetrics),
    metrics: cloneFallbackMetricMap(fallbackRigState.resolvedMetrics),
    overrides: { ...fallbackRigState.metricOverrides },
  }),
  setFallbackMetric: setFallbackRigMetricOverride,
  clearFallbackMetric: clearFallbackRigMetricOverride,
  resetFallbackMetrics: resetFallbackRigMetricOverrides,
  rebuildFallbackRig: () => rebuildFallbackRigFromOverrides('Fallback rig rebuilt.'),
};

ensureFallbackRigEditorPanel();
syncFallbackRigEditorPanel();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const clock = new THREE.Clock();

function animate() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  fireLight.intensity = 2.1 + Math.sin(t * 7.3) * 0.35 + Math.sin(t * 11.1) * 0.2;
  fireLight.position.x = Math.sin(t * 1.2) * 0.08;

  flameCore.scale.set(1 + Math.sin(t * 8.2) * 0.06, 1 + Math.sin(t * 10.7 + 0.6) * 0.12, 1 + Math.sin(t * 6.8) * 0.05);
  flameOuter.scale.set(1 + Math.sin(t * 7.1 + 0.9) * 0.08, 1 + Math.sin(t * 9.9) * 0.14, 1 + Math.sin(t * 5.9) * 0.06);
  const isEditingCustomRig = !!uploadedAvatarRoot || fallbackRigState.active;
  avatar.rotation.y = 0;
  avatar.position.y = isEditingCustomRig ? 0.36 : 0.36 + Math.sin(t * 1.7) * 0.03;
  avatarHead.position.y = 1.58 + Math.sin(t * 1.9 + 0.5) * 0.01;
  leftArm.rotation.x = Math.sin(t * 1.6) * 0.08;
  rightArm.rotation.x = Math.sin(t * 1.6 + 1.2) * 0.08;
  avatarOrb.position.y = 1.33 + Math.sin(t * 2.8) * 0.04;
  auraRing.rotation.z = Math.sin(t * 1.3) * 0.32;
  trainingDummyPreview.rotation.y = Math.PI + (Math.sin(t * 0.32) * 0.2);
  dummyPedestal.rotation.y = trainingDummyPreview.rotation.y * 0.5;
  proceduralHandsPreview.rotation.y = Math.PI + (Math.sin(t * 0.45) * 0.12);
  handsPedestal.rotation.y = proceduralHandsPreview.rotation.y * 0.45;

  for (let i = 0; i < proceduralHands.length; i++) {
    const hand = proceduralHands[i];
    if (!hand) continue;
    const sideSign = i === 0 ? -1 : 1;
    hand.position.y = 0.56 + Math.sin((t * 2.2) + (i * 0.9)) * 0.04;
    hand.rotation.x = 0.08 + (Math.sin(t * 1.7 + (i * 0.7)) * 0.16);
    hand.rotation.z = sideSign * (0.15 + (Math.sin(t * 1.5 + (i * 0.5)) * 0.18));

    const fingerPivots = hand.userData.fingerPivots || [];
    for (let f = 0; f < fingerPivots.length; f++) {
      const curl = 0.4 + (Math.sin((t * 2.7) + (f * 0.45) + (i * 0.6)) * 0.35);
      fingerPivots[f].rotation.x = -curl;
    }

    if (hand.userData.thumbPivot) {
      hand.userData.thumbPivot.rotation.y = sideSign * 0.72;
      hand.userData.thumbPivot.rotation.x = -0.42 + (Math.sin(t * 2.3 + (i * 0.8)) * 0.12);
    }
  }

  const nowMs = performance.now();
  applyRigIdlePreview(nowMs);
  applyRigWalkPreview(nowMs);
  applyRigDancePreview(nowMs);
  applyRigFrontFlipPreview(nowMs);

  _move.set(0, 0, 0);
  camera.getWorldDirection(_forward);
  _forward.normalize();
  _right.crossVectors(_forward, camera.up).normalize();

  if (moveState.forward) _move.add(_forward);
  if (moveState.back) _move.sub(_forward);
  if (moveState.right) _move.add(_right);
  if (moveState.left) _move.sub(_right);
  if (moveState.up) _move.y += 1;
  if (moveState.down) _move.y -= 1;

  if (_move.lengthSq() > 0) {
    _move.normalize();
    const speed = baseMoveSpeed * (moveState.boost ? boostMultiplier : 1);
    camera.position.addScaledVector(_move, speed * dt);
  }

  for (const ember of embers) {
    const d = ember.userData;
    ember.position.y = d.baseY + Math.sin(t * d.drift + d.phase) * 0.12;
    ember.position.x += Math.sin(t * 0.7 + d.phase) * 0.0009;
    ember.material.opacity = 0.45 + (Math.sin(t * 3 + d.phase) + 1) * 0.22;
  }

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

animate();
