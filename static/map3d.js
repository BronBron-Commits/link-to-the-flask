// --- Socket.IO real-time multiplayer ---
// Assumes <script src="https://cdn.socket.io/4.7.5/socket.io.min.js"></script> is loaded in the HTML
const socket = window.io ? window.io() : null;

if (socket) {
    socket.on('player-id', (data) => {
        if (data && data.id) {
            localPlayerId = data.id;
        }
    });

    socket.on('players-state', (players) => {
        if (!players) return;
        Object.values(players).forEach((player) => upsertPlayerAvatar(player));
    });

    socket.on('player-joined', (player) => {
        upsertPlayerAvatar(player);
    });

    socket.on('player-update', (player) => {
        upsertPlayerAvatar(player);
    });

    socket.on('player-left', (data) => {
        if (data && data.id) removePlayerAvatar(data.id);
    });

    socket.on('scene-update', (data) => {
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
        // Initial full scene state
        // Always apply the full scene state from server on connect
        if (data && data.objects) {
            applySceneState(data);
        }
    });
}
import * as THREE from '/static/three.module.js';
window.THREE = THREE;

import { GLTFLoader } from '/static/GLTFLoader.js';
// Selection logic: only selected object gets a green BoxHelper
let selectedObject = null;
let selectionBoxHelper = null;
let isGrabbing = false;
let grabAxis = null; // null = free, 'x', 'y', 'z' = axis lock
// Removed stray comma
// Raycaster and mouse for picking
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const xrRaycaster = new THREE.Raycaster();
const xrRayOrigin = new THREE.Vector3();
const xrRayDirection = new THREE.Vector3();
const xrRayRotation = new THREE.Matrix4();
let localPlayerId = null;
let lastPlayerSyncAt = 0;
const localPlayerWorldPos = new THREE.Vector3();
const localPlayerWorldQuat = new THREE.Quaternion();
const lightSpawnPos = new THREE.Vector3();
const lightSpawnDir = new THREE.Vector3();
let userLightIdCounter = 1;
const xrHandRays = [];
const XR_RAY_MAX_DISTANCE = 80;

function upsertPlayerAvatar(player) {
    // Avatar cube visuals removed intentionally.
    void player;
}

function removePlayerAvatar(playerId) {
    // Avatar cube visuals removed intentionally.
    void playerId;
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
    camera.getWorldPosition(lightSpawnPos);
    camera.getWorldDirection(lightSpawnDir);
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

function animateMaterialTexture(mat, delta) {
    if (!mat || !mat.map) return;
    const anim = getMaterialTextureAnim(mat);
    if (!anim.x && !anim.y && !anim.z) return;

    mat.map.wrapS = THREE.RepeatWrapping;
    mat.map.wrapT = THREE.RepeatWrapping;
    mat.map.offset.x += anim.x * delta;
    mat.map.offset.y += anim.y * delta;
    mat.map.rotation += anim.z * delta;
    mat.map.needsUpdate = true;
}

function animateSceneTextures(delta) {
    scene.traverse((obj) => {
        if (!obj.isMesh || !obj.material) return;
        if (Array.isArray(obj.material)) {
            obj.material.forEach((m) => animateMaterialTexture(m, delta));
        } else {
            animateMaterialTexture(obj.material, delta);
        }
    });
}

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

// Listen for left mouse click to select object under crosshair
window.addEventListener('mousedown', (event) => {
    // Only respond to left click
    if (event.button !== 0) return;
    // Prevent world picking if clicking on UI (menus or number boxes)
    const uiMenus = [inspectorMenu];
    let el = event.target;
    while (el) {
        if (uiMenus.includes(el) || el.tagName === 'INPUT' || el.tagName === 'BUTTON') return;
        el = el.parentElement;
    }
    if (isGrabbing && selectedObject) {
        // Confirm placement
        isGrabbing = false;
        document.body.style.cursor = '';
        return;
    }
    // Always use center of screen for picking (crosshair)
    mouse.x = 0;
    mouse.y = 0;
    raycaster.setFromCamera(mouse, camera);
    // Gather all selectable meshes in the scene
    const meshes = [];
    scene.traverse(obj => {
        if (obj.isMesh && isMeshSelectable(obj)) meshes.push(obj);
    });
    const intersects = raycaster.intersectObjects(meshes, false);
    if (intersects.length > 0) {
        selectObject(resolveSelectableTarget(intersects[0].object));
    }
});
// --- Grab (move) selected object with 'g' ---
window.addEventListener('keydown', (event) => {
    if (event.key === 'g' && selectedObject && !isGrabbing) {
        isGrabbing = true;
        grabAxis = null;
        document.body.style.cursor = 'move';
    }
    // Axis lock
    if (isGrabbing && ['x','y','z'].includes(event.key.toLowerCase())) {
        grabAxis = event.key.toLowerCase();
        event.preventDefault(); // Prevent browser navigation
    }
    // Confirm placement with Enter or Escape
    if (isGrabbing && (event.key === 'Enter' || event.key === 'Escape')) {
        isGrabbing = false;
        grabAxis = null;
        document.body.style.cursor = '';
    }
});

// Move selected object with mouse while grabbing
window.addEventListener('mousemove', (event) => {
    if (!isGrabbing || !selectedObject) return;
    const rect = renderer.domElement.getBoundingClientRect();
    const ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera({ x: ndcX, y: ndcY }, camera);
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





// --- WASD Fly Controls ---
let moveForward = false, moveBackward = false, moveLeft = false, moveRight = false, moveUp = false, moveDown = false;
let velocity = new THREE.Vector3();
let direction = new THREE.Vector3();
let canMove = false;
let playerRig = null;
const xrMove = new THREE.Vector3();
const xrForward = new THREE.Vector3();
const xrRight = new THREE.Vector3();
const activeViewWorldPos = new THREE.Vector3();
const activeViewWorldQuat = new THREE.Quaternion();

const speed = 2.5; // units per second
const lookSpeed = 0.002;
const xrMoveSpeed = 4.5;
const xrVerticalSpeed = 3.0;
const xrTurnSpeed = 2.2;
const xrDeadzone = 0.16;
const WORLD_SCALE = 8.0;
let pitch = 0, yaw = 0;

function applyDeadzone(value, deadzone = xrDeadzone) {
    return Math.abs(value) < deadzone ? 0 : value;
}

function getActiveViewCamera() {
    if (renderer && renderer.xr && renderer.xr.isPresenting) {
        return renderer.xr.getCamera(camera);
    }
    return camera;
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
    playerRig.position.addScaledVector(xrMove, xrMoveSpeed * delta);
    const verticalInput = rightTrigger - leftTrigger;
    playerRig.position.y += verticalInput * xrVerticalSpeed * delta;
    playerRig.rotation.y -= rightX * xrTurnSpeed * delta;

    return true;
}

// Scene
const scene = new THREE.Scene();

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
skyboxTextureLoader.load(
    '/static/sky_8k_tonemapped.jpg',
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

        const skyMesh = new GroundedSkybox(softTexture, 15, 500);
        scene.add(skyMesh);
        window.skyMesh = skyMesh;
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
// Standard camera position for all models
camera.position.set(0, 0, 0);
camera.lookAt(0, 0, 0);
playerRig = new THREE.Group();
playerRig.position.set(0, 2, 8);
playerRig.add(camera);
scene.add(playerRig);

// Now create the sky mesh and add to the main scene



// Renderer


const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);
renderer.xr.enabled = true;
// Enable shadow mapping
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// REQUIRED: set renderer output color space
renderer.outputColorSpace = THREE.SRGBColorSpace;
// Now safe to use renderer
renderer.setClearColor(0x143366, 1); // Opaque darker blue background for sky visibility

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

const inspectorMenu = document.createElement('div');
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
inspectorMenu.style.zIndex = '2000';
inspectorMenu.style.fontFamily = 'monospace';
inspectorMenu.style.fontSize = '15px';
inspectorMenu.style.borderLeft = '1px solid #333';
inspectorMenu.style.boxShadow = '-2px 0 8px #0008';
inspectorMenu.style.padding = '10px 0 10px 0';
inspectorMenu.style.userSelect = 'auto';
inspectorMenu.style.transition = 'right 0.2s cubic-bezier(.4,1.4,.6,1)';
inspectorMenu.style.cursor = 'pointer';
document.body.appendChild(inspectorMenu);

// Add a visible tab for opening/closing
const inspectorTab = document.createElement('div');
inspectorTab.style.position = 'absolute';
inspectorTab.style.left = '-32px';
inspectorTab.style.top = '50%';
inspectorTab.style.transform = 'translateY(-50%)';
inspectorTab.style.width = '32px';
inspectorTab.style.height = '96px';
inspectorTab.style.background = 'linear-gradient(90deg, #222 80%, #333 100%)';
inspectorTab.style.borderRadius = '8px 0 0 8px';
inspectorTab.style.display = 'flex';
inspectorTab.style.alignItems = 'center';
inspectorTab.style.justifyContent = 'center';
inspectorTab.style.color = '#fff';
inspectorTab.style.fontWeight = 'bold';
inspectorTab.style.fontSize = '18px';
inspectorTab.style.letterSpacing = '2px';
inspectorTab.style.boxShadow = '-2px 0 8px #0008';
inspectorTab.style.cursor = 'pointer';
inspectorTab.innerHTML = '<span style="writing-mode: vertical-lr; transform: rotate(180deg);">INSPECT</span>';
inspectorMenu.appendChild(inspectorTab);

let inspectorOpen = false;
function setInspectorOpen(open) {
    inspectorOpen = open;
    inspectorMenu.style.right = open ? '0' : '-288px';
    inspectorMenu.style.cursor = open ? 'default' : 'pointer';
}

inspectorTab.addEventListener('click', (e) => {
    e.stopPropagation();
    setInspectorOpen(!inspectorOpen);
});

// Also allow clicking anywhere on the tucked menu to open
inspectorMenu.addEventListener('click', (e) => {
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
    inspectorMenu.innerHTML = '<div style="font-weight:bold;padding:0 0 8px 16px;font-size:17px;letter-spacing:1px;">Transform Inspector</div>';
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
    nameDiv.style.fontSize = '16px';
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
        lightDiv.innerHTML = '<div style="font-weight:bold;padding:0 0 8px 16px;font-size:16px;letter-spacing:1px;">Light Inspector</div>';

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
        matDiv.innerHTML = '<div style="font-weight:bold;padding:0 0 8px 16px;font-size:16px;letter-spacing:1px;">Material Inspector</div>';

        // --- Material Slot Preview ---
        const slotDiv = document.createElement('div');
        slotDiv.style.display = 'flex';
        slotDiv.style.alignItems = 'center';
        slotDiv.style.margin = '8px 0 12px 16px';
        slotDiv.style.gap = '12px';
        slotDiv.style.flexWrap = 'wrap';
        slotDiv.innerHTML = '<span style="color:#aaa;font-size:14px;">Material Slots:</span>';

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
            lbl.style.fontSize = '11px';
            lbl.style.color = '#aaa';
            lbl.style.marginTop = '2px';
            swatch.appendChild(lbl);

            // Material type dropdown
            const select = document.createElement('select');
            select.style.marginTop = '4px';
            select.style.width = '60px';
            select.style.fontSize = '11px';
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
            section.innerHTML = `<div style="padding:0 0 4px 16px;font-size:13px;color:#9fb7ff;">${heading} Texture Animation</div>`;

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
        uploadLabel.style.fontSize = '14px';
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

// Now safe to use renderer.domElement (canvas)
const canvas = renderer.domElement;
canvas.tabIndex = 0;
canvas.style.outline = 'none';

canvas.addEventListener('click', () => {
    canvas.requestPointerLock();
});

document.addEventListener('pointerlockchange', () => {
    canMove = document.pointerLockElement === canvas;
});

document.addEventListener('mousemove', (event) => {
    if (!canMove) return;
    yaw -= event.movementX * lookSpeed;
    pitch -= event.movementY * lookSpeed;
    pitch = Math.max(-Math.PI/2, Math.min(Math.PI/2, pitch));
});

document.addEventListener('keydown', (event) => {
    if (event.code === 'KeyL' && !event.repeat) {
        const tagName = event.target && event.target.tagName ? event.target.tagName : '';
        if (tagName !== 'INPUT' && tagName !== 'TEXTAREA') {
            createPointLightFromCamera();
            event.preventDefault();
            return;
        }
    }

    switch(event.code) {
        case 'KeyW': moveForward = true; break;
        case 'KeyS': moveBackward = true; break;
        case 'KeyA': moveLeft = true; break;
        case 'KeyD': moveRight = true; break;
        case 'Space': moveUp = true; break;
        case 'ShiftLeft': moveDown = true; break;
    }
});
document.addEventListener('keyup', (event) => {
    switch(event.code) {
        case 'KeyW': moveForward = false; break;
        case 'KeyS': moveBackward = false; break;
        case 'KeyA': moveLeft = false; break;
        case 'KeyD': moveRight = false; break;
        case 'Space': moveUp = false; break;
        case 'ShiftLeft': moveDown = false; break;
    }
});

function updateFlyControls(delta) {
    if (applyXRFlightControls(delta)) {
        return;
    }

    direction.set(0, 0, 0);
    if (moveForward) direction.z -= 1;
    if (moveBackward) direction.z += 1;
    if (moveLeft) direction.x -= 1;
    if (moveRight) direction.x += 1;
    if (moveUp) direction.y += 1;
    if (moveDown) direction.y -= 1;
    direction.normalize();

    // Camera rotation
    camera.rotation.order = 'YXZ';
    camera.rotation.y = yaw;
    camera.rotation.x = pitch;

    // Move in local space
    velocity.copy(direction).applyEuler(camera.rotation).multiplyScalar(speed * delta);
    if (playerRig) {
        playerRig.position.add(velocity);
    }
}

// Resize support
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- Zoom in/out with mouse wheel ---
renderer.domElement.addEventListener('wheel', (e) => {
    e.preventDefault();
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
function toggleGrid() {
    if (!gridHelper) {
        // 1000x1000 units, 1 unit = 1 square, 500 divisions (smaller grid squares)
        gridHelper = new THREE.GridHelper(1000, 500, 0x00ffff, 0xffffff);
        gridHelper.position.y = 0.01; // Slightly above ground to avoid z-fighting
        gridHelper.material.opacity = 0.7;
        gridHelper.material.transparent = true;
        gridHelper.renderOrder = 10;
    }
    gridVisible = !gridVisible;
    if (gridVisible) {
        scene.add(gridHelper);
    } else {
        scene.remove(gridHelper);
    }
}

window.addEventListener('keydown', (event) => {
    if (event.key === 'm' || event.key === 'M') {
        toggleGrid();
    }
});

// Ambient light for soft fill
scene.add(new THREE.AmbientLight(0xffffff, 0.52));

// Gentle sky/ground fill to reduce overly dark shadow pockets.
scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x5a4a3a, 0.28));


// --- Load ONLY Everything GLTF Model ---
const loader = new GLTFLoader();

console.log('Attempting to load /static/everything_.gltf ...');

fetch('/static/everything_.gltf', { method: 'HEAD' })
    .then(response => {
        if (!response.ok) {
            console.warn('everything_.gltf not found! Status:', response.status);
            return;
        }

        console.log('everything_.gltf found. Size:', response.headers.get('content-length'));

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

                let meshCount = 0;
                gltf.scene.traverse(obj => {
                    if (obj.isMesh) meshCount++;
                });

                console.log('Everything mesh count:', meshCount);
                console.log('Everything GLB loaded successfully:', gltf.scene);

                // Load persisted scene state now that the model is in the scene
                fetch('/scene_state')
                    .then(r => r.json())
                    .then(state => { if (state && state.objects) applySceneState(state); })
                    .catch(err => console.warn('Could not load scene state:', err));

                // updateHierarchyMenu();
            },

            (xhr) => {
                if (xhr.lengthComputable) {
                    const percent = (xhr.loaded / xhr.total) * 100;
                    console.log(`Everything loading: ${percent.toFixed(2)}%`);
                }
            },

            (error) => {
                console.error('Error loading everything_.gltf:', error);
            }
        );
    })
    .catch(err => {
        console.warn('Error fetching everything_.gltf:', err);
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
    if (state.map) {
        new THREE.TextureLoader().load(state.map, (tex) => {
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
    saveBtn.style.fontSize = '16px';
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
    loadBtn.style.fontSize = '16px';
    loadBtn.style.cursor = 'pointer';
    loadBtn.style.width = '85%';
    loadBtn.onclick = () => {
        fetch('/scene_state').then(r => r.json()).then(state => {
            applySceneState(state);
            alert('Scene state loaded!');
        });
    };
    btnContainer.appendChild(loadBtn);

    inspectorMenu.appendChild(btnContainer);
}

// Render loop
let lastTime = performance.now();
function animate() {
    // No need to force scene.background = null; skybox is now a mesh
    const now = performance.now();
    const delta = (now - lastTime) / 1000;
    lastTime = now;
    updateFlyControls(delta);
    // Make sky follow the camera if loaded
    if (window.skyMesh) {
        const activeView = getActiveViewCamera();
        activeView.getWorldPosition(activeViewWorldPos);
        window.skyMesh.position.copy(activeViewWorldPos);
    }

    // Send local camera transform at ~15Hz for multiplayer avatar updates.
    if (socket && localPlayerId && now - lastPlayerSyncAt > 66) {
        const activeView = getActiveViewCamera();
        activeView.getWorldPosition(localPlayerWorldPos);
        activeView.getWorldQuaternion(localPlayerWorldQuat);
        const localPlayerEuler = new THREE.Euler().setFromQuaternion(localPlayerWorldQuat, 'YXZ');
        socket.emit('player-update', {
            position: {
                x: localPlayerWorldPos.x,
                y: localPlayerWorldPos.y,
                z: localPlayerWorldPos.z,
            },
            rotation: {
                x: localPlayerEuler.x,
                y: localPlayerEuler.y,
                z: localPlayerEuler.z,
            }
        });
        lastPlayerSyncAt = now;
    }

    animateSceneTextures(delta);

    updateXRHandRays();

    renderer.render(scene, camera);
}
renderer.setAnimationLoop(animate);

