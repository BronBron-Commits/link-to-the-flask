import * as THREE from '/static/three.module.js';
import { GLTFLoader } from '/static/GLTFLoader.js';

const SELECTED_CHARACTER_STORAGE_KEY = 'paraval_selected_character';
const SELECTED_MODEL_STORAGE_KEY = 'paraval_selected_model_url';

const hudPlayerEl = document.getElementById('hud-player');

const urlSearch = new URLSearchParams(window.location.search || '');
const queryCharacterId = String(urlSearch.get('characterId') || '').trim();
const queryModelUrl = String(urlSearch.get('modelUrl') || '').trim();

let selectedCharacter = null;
let selectedModelUrl = '';

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

  if (selectedModelUrl) {
    localStorage.setItem(SELECTED_MODEL_STORAGE_KEY, selectedModelUrl);
  }

  if (hudPlayerEl) {
    hudPlayerEl.textContent = `Player: ${selectedCharacter.name || selectedCharacter.id}\nModel: ${selectedModelUrl || 'Procedural fallback'}`;
  }
}

loadSelectionContext();

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0d15);
scene.fog = new THREE.Fog(0x0a0d15, 10, 34);

const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 2.6, 6.4);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio || 1);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
document.body.appendChild(renderer.domElement);

const hemi = new THREE.HemisphereLight(0x5f7397, 0x1d1814, 0.5);
scene.add(hemi);

const key = new THREE.DirectionalLight(0x95a8cf, 0.62);
key.position.set(-3.4, 4.4, 2.8);
scene.add(key);

const fireGlow = new THREE.PointLight(0xff8f36, 2.3, 12, 2);
fireGlow.position.set(0, 1.3, -3.1);
scene.add(fireGlow);

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

const flameCore = new THREE.Mesh(
  new THREE.ConeGeometry(0.22, 0.72, 14),
  new THREE.MeshBasicMaterial({ color: 0xffb468, transparent: true, opacity: 0.75 })
);
flameCore.position.set(0, 1.04, -3.15);
scene.add(flameCore);

const flameOuter = new THREE.Mesh(
  new THREE.ConeGeometry(0.34, 0.95, 14),
  new THREE.MeshBasicMaterial({ color: 0xff7c2b, transparent: true, opacity: 0.4 })
);
flameOuter.position.set(0, 1.08, -3.16);
scene.add(flameOuter);

const actor = new THREE.Group();
actor.position.set(0, 0, 2.1);
scene.add(actor);

const fallbackBodyMat = new THREE.MeshStandardMaterial({ color: 0x7f6bff, roughness: 0.62, metalness: 0.08, emissive: 0x121425 });
const fallbackSkinMat = new THREE.MeshStandardMaterial({ color: 0xe8ccb2, roughness: 0.72, metalness: 0.01 });
const fallbackClothMat = new THREE.MeshStandardMaterial({ color: 0x2b304d, roughness: 0.9, metalness: 0.02 });

const fallbackAvatar = new THREE.Group();
actor.add(fallbackAvatar);

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

async function loadSelectedAvatar() {
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

    normalizeAvatarRoot(root);
    customAvatarRoot = root;
    actor.add(customAvatarRoot);
    fallbackAvatar.visible = false;

    if (Array.isArray(gltf.animations) && gltf.animations.length) {
      const clips = gltf.animations;
      avatarMixer = new THREE.AnimationMixer(customAvatarRoot);
      const findClip = (matcher) => clips.find((clip) => matcher.test(String(clip.name || '').toLowerCase())) || null;
      const idleClip = findClip(/idle|stand|breath|rest/);
      const walkClip = findClip(/walk|locomotion|move|run/);

      if (idleClip) {
        customIdleAction = avatarMixer.clipAction(idleClip);
        customIdleAction.enabled = true;
        customIdleAction.setEffectiveWeight(1);
        customIdleAction.play();
        activeCustomAction = customIdleAction;
      }

      if (walkClip) {
        customWalkAction = avatarMixer.clipAction(walkClip);
        customWalkAction.enabled = true;
        customWalkAction.setEffectiveWeight(0);
      }
    }
  } catch (_err) {
    avatarMixer = null;
    customIdleAction = null;
    customWalkAction = null;
    activeCustomAction = null;
    fallbackAvatar.visible = true;
  }
}

loadSelectedAvatar();

const moveState = {
  forward: false,
  back: false,
  left: false,
  right: false,
  boost: false,
};

const moveBounds = {
  minX: -5.25,
  maxX: 5.25,
  minZ: -4.95,
  maxZ: 3.25,
};

let pointerLocked = false;
let orbitYaw = 0;
let orbitPitch = -0.12;

const moveSpeed = 3.4;
const boostMultiplier = 2.2;
const lookSensitivity = 0.0022;

const tmpForward = new THREE.Vector3();
const tmpRight = new THREE.Vector3();
const tmpMove = new THREE.Vector3();
const tmpTarget = new THREE.Vector3();
const tmpDesiredCam = new THREE.Vector3();
const worldUp = new THREE.Vector3(0, 1, 0);

function setMoveState(code, value) {
  if (code === 'KeyW') moveState.forward = value;
  if (code === 'KeyS') moveState.back = value;
  if (code === 'KeyA') moveState.left = value;
  if (code === 'KeyD') moveState.right = value;
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
  orbitPitch = THREE.MathUtils.clamp(orbitPitch - event.movementY * lookSensitivity, -0.72, 0.36);
});

document.addEventListener('keydown', (event) => {
  const tag = document.activeElement ? document.activeElement.tagName : '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

  if (event.code === 'KeyW' || event.code === 'KeyA' || event.code === 'KeyS' || event.code === 'KeyD' || event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
    event.preventDefault();
  }
  setMoveState(event.code, true);
});

document.addEventListener('keyup', (event) => {
  if (event.code === 'KeyW' || event.code === 'KeyA' || event.code === 'KeyS' || event.code === 'KeyD' || event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
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
  if (avatarMixer) {
    if (isMoving && customWalkAction) {
      switchCustomAction(customWalkAction);
    } else if (!isMoving && customIdleAction) {
      switchCustomAction(customIdleAction);
    }
    avatarMixer.update(dt);
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
  const distance = 5.2;
  const horizontal = Math.cos(orbitPitch) * distance;

  tmpDesiredCam.set(
    actor.position.x + Math.sin(orbitYaw + Math.PI) * horizontal,
    actor.position.y + 2.15 + Math.sin(orbitPitch) * distance,
    actor.position.z + Math.cos(orbitYaw + Math.PI) * horizontal,
  );

  tmpDesiredCam.x = THREE.MathUtils.clamp(tmpDesiredCam.x, -6.3, 6.3);
  tmpDesiredCam.z = THREE.MathUtils.clamp(tmpDesiredCam.z, -5.9, 4.5);
  tmpDesiredCam.y = THREE.MathUtils.clamp(tmpDesiredCam.y, 1.25, 6.2);

  const lerpAlpha = 1 - Math.exp(-8.0 * dt);
  camera.position.lerp(tmpDesiredCam, lerpAlpha);

  tmpTarget.set(actor.position.x, actor.position.y + 1.08, actor.position.z);
  camera.lookAt(tmpTarget);
}

function animate() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const elapsed = clock.elapsedTime;

  fireGlow.intensity = 2.15 + Math.sin(elapsed * 6.8) * 0.3 + Math.sin(elapsed * 10.4) * 0.18;
  flameCore.scale.set(1 + Math.sin(elapsed * 8.1) * 0.07, 1 + Math.sin(elapsed * 10.5 + 0.4) * 0.12, 1 + Math.sin(elapsed * 6.3) * 0.06);
  flameOuter.scale.set(1 + Math.sin(elapsed * 6.7 + 0.6) * 0.09, 1 + Math.sin(elapsed * 9.7) * 0.14, 1 + Math.sin(elapsed * 5.7) * 0.07);

  const isMoving = updatePlayerMovement(dt);
  updateAvatarAnimation(dt, elapsed, isMoving);
  updateCamera(dt);

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

animate();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
