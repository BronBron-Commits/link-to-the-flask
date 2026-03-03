// Camera vertical movement controls
let moveUp = false, moveDown = false;
let orbitLeft = false, orbitRight = false;
// Camera mode: "orbit" or "player"
let cameraMode = "orbit";
// First-person WASD state
let fpForward = false, fpBackward = false, fpLeft = false, fpRight = false;
let fpYaw = 0, fpPitch = 0;
let fpMouseDown = false;
document.addEventListener('keydown', (e) => {
    if (cameraMode === "orbit") {
        if (e.code === 'KeyW') moveUp = true;
        if (e.code === 'KeyS') moveDown = true;
        if (e.code === 'KeyA') orbitLeft = true;
        if (e.code === 'KeyD') orbitRight = true;
    } else if (cameraMode === "player") {
        if (e.code === 'KeyW') fpForward = true;
        if (e.code === 'KeyS') fpBackward = true;
        if (e.code === 'KeyA') fpLeft = true;
        if (e.code === 'KeyD') fpRight = true;
    }
});
document.addEventListener('keyup', (e) => {
    if (cameraMode === "orbit") {
        if (e.code === 'KeyW') moveUp = false;
        if (e.code === 'KeyS') moveDown = false;
        if (e.code === 'KeyA') orbitLeft = false;
        if (e.code === 'KeyD') orbitRight = false;
    } else if (cameraMode === "player") {
        if (e.code === 'KeyW') fpForward = false;
        if (e.code === 'KeyS') fpBackward = false;
        if (e.code === 'KeyA') fpLeft = false;
        if (e.code === 'KeyD') fpRight = false;
    }
});
// Escape returns to orbit mode
document.addEventListener('keydown', (e) => {
    if (e.code === 'Escape') {
        cameraMode = "orbit";
    }
});
import * as THREE from './three.module.js';

// --- Rain Effect ---
const RAIN_COUNT = 800;
const rainDrops = [];
let rainGeometry, rainMaterial, rainMesh;

function createRain() {
    rainGeometry = new THREE.BufferGeometry();
    const positions = [];
    for (let i = 0; i < RAIN_COUNT; i++) {
        // Spread rain over a wide area above the table
        const x = (Math.random() - 0.5) * 32;
        const y = 8 + Math.random() * 8; // start above the scene
        const z = (Math.random() - 0.5) * 32;
        positions.push(x, y, z);
        rainDrops.push({ x, y, z, velocity: 0.18 + Math.random() * 0.12 });
    }
    rainGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    rainMaterial = new THREE.PointsMaterial({ color: 0x99ccff, size: 0.13, transparent: true, opacity: 0.7 });
    rainMesh = new THREE.Points(rainGeometry, rainMaterial);
    scene.add(rainMesh);
}

function updateRain() {
    const positions = rainGeometry.attributes.position.array;
    for (let i = 0; i < RAIN_COUNT; i++) {
        let drop = rainDrops[i];
        drop.y -= drop.velocity;
        if (drop.y < -1.5) { // reset to top
            drop.x = (Math.random() - 0.5) * 32;
            drop.y = 8 + Math.random() * 8;
            drop.z = (Math.random() - 0.5) * 32;
            drop.velocity = 0.18 + Math.random() * 0.12;
        }
        positions[i * 3] = drop.x;
        positions[i * 3 + 1] = drop.y;
        positions[i * 3 + 2] = drop.z;
    }
    rainGeometry.attributes.position.needsUpdate = true;
}

const scene = new THREE.Scene();

// Particle blast system
const particleBlasts = [];
const PARTICLE_COUNT = 32;
const PARTICLE_LIFETIME = 0.7; // seconds
const PARTICLE_SIZE = 0.065; // half as small
const GOLD_COLOR = 0xffe066; // gold (matches die veins)
const ROYAL_BLUE_COLOR = 0x1a237e; // royal blue (matches die base)

// --- Dice Rolling Cage ---
// A small bowl on the table for rolling dice
const trayRadius = 8.0 * 0.7; // fallback if not yet defined
const tableHeight = 0.6; // fallback if not yet defined
const bowlRadius = trayRadius * 0.35;
const bowlHeight = tableHeight * 0.7;
const bowlGeometry = new THREE.CylinderGeometry(bowlRadius, bowlRadius * 0.8, bowlHeight, 32, 1, true);
const bowlMaterial = new THREE.MeshStandardMaterial({
    color: GOLD_COLOR, // metallic gold
    metalness: 1.0,
    roughness: 0.18,
    side: THREE.DoubleSide
});
const diceBowl = new THREE.Mesh(bowlGeometry, bowlMaterial);

function spawnParticleBlast(position, isDie2 = false) {
    const group = new THREE.Group();
    for (let i = 0; i < PARTICLE_COUNT; i++) {
        const geo = new THREE.SphereGeometry(PARTICLE_SIZE, 8, 8);
        // Alternate colors: first half gold, second half royal blue
        // If isDie2, swap order for visual distinction
        let color;
        if (isDie2) {
            color = i < PARTICLE_COUNT / 2 ? ROYAL_BLUE_COLOR : GOLD_COLOR;
        } else {
            color = i < PARTICLE_COUNT / 2 ? GOLD_COLOR : ROYAL_BLUE_COLOR;
        }
        const mat = new THREE.MeshBasicMaterial({ color });
        const mesh = new THREE.Mesh(geo, mat);
        // Random direction
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.random() * Math.PI;
        const speed = 2.2 + Math.random() * 1.2;
        mesh.userData = {
            velocity: new THREE.Vector3(
                Math.sin(phi) * Math.cos(theta) * speed,
                Math.cos(phi) * speed,
                Math.sin(phi) * Math.sin(theta) * speed
            ),
            age: 0
        };
        group.add(mesh);
    }
    group.position.copy(position);
    particleBlasts.push({ group, start: performance.now() });
    scene.add(group);

}


// ...dock removed...


// Procedural nighttime skybox (darker, animated stars)
const skyCanvas = document.createElement('canvas');
skyCanvas.width = 2048;
skyCanvas.height = 2048;
const skyCtx = skyCanvas.getContext('2d');

// Store star data for animation
const starCount = 900;
const stars = [];
for (let i = 0; i < starCount; i++) {
    stars.push({
        x: Math.random() * skyCanvas.width,
        y: Math.random() * skyCanvas.height,
        r: 0.3 + Math.random() * 0.7,
        twinkle: 0.5 + Math.random() * 0.5,
        speed: 0.002 + Math.random() * 0.004,
        phase: Math.random() * Math.PI * 2
    });
}

function drawSky() {
    // Fill with a vertical gradient: blue zenith, sunset pink/orange, dark at horizon
    const grad = skyCtx.createLinearGradient(0, 0, 0, skyCanvas.height);
    grad.addColorStop(0, '#3a5dbb'); // blue zenith
    grad.addColorStop(0.38, '#1a2a4a'); // deep blue transition
    grad.addColorStop(0.62, '#fca9c4'); // sunset pink
    grad.addColorStop(0.78, '#ffb347'); // sunset orange
    grad.addColorStop(1, '#0a0a1a'); // dark horizon
    skyCtx.fillStyle = grad;
    skyCtx.fillRect(0, 0, skyCanvas.width, skyCanvas.height);

    // Draw animated stars
    for (let i = 0; i < starCount; i++) {
        const star = stars[i];
        // Animate twinkle
        star.phase += star.speed;
        const twinkle = star.twinkle * (0.7 + 0.3 * Math.sin(star.phase));
        skyCtx.beginPath();
        skyCtx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
        skyCtx.fillStyle = 'rgba(255,255,255,' + twinkle + ')';
        skyCtx.shadowColor = '#fff';
        skyCtx.shadowBlur = 6;
        skyCtx.fill();
        skyCtx.shadowBlur = 0;
    }

    // Moon
    const moonX = 820;
    const moonY = 220;
    skyCtx.beginPath();
    skyCtx.arc(moonX, moonY, 60, 0, Math.PI * 2);
    skyCtx.fillStyle = 'rgba(240,240,255,0.85)';
    skyCtx.shadowColor = '#fff';
    skyCtx.shadowBlur = 30;
    skyCtx.fill();
    skyCtx.shadowBlur = 0;
}

const skyTexture = new THREE.CanvasTexture(skyCanvas);
skyTexture.mapping = THREE.EquirectangularReflectionMapping;
skyTexture.magFilter = THREE.LinearFilter;
skyTexture.minFilter = THREE.LinearMipMapLinearFilter;

const skyGeo = new THREE.SphereGeometry(50, 64, 64);
const skyMat = new THREE.MeshBasicMaterial({ map: skyTexture, side: THREE.BackSide });
const skySphere = new THREE.Mesh(skyGeo, skyMat);
scene.add(skySphere);

drawSky();

createRain();

const camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
);
// Camera orbit state
let orbitAngle = 0;
let orbitRadius = 6;
let orbitHeight = 4.5;
camera.position.set(0, orbitHeight, orbitRadius);
camera.lookAt(0, -1.5, 0); // Look at table center

const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// WASD and mouse look controls
let yaw = 0, pitch = 0;
let mouseDown = false;
let prevMouseX = 0, prevMouseY = 0;

// Table hover highlight state
let tableHovered = false;
const highlightBevelColor = 0xffe066; // gold highlight
const normalBevelColor = 0xffffff;

renderer.domElement.addEventListener('mousedown', (e) => {
    mouseDown = true;
    prevMouseX = e.clientX;
    prevMouseY = e.clientY;
});
renderer.domElement.addEventListener('mouseup', () => { mouseDown = false; });
renderer.domElement.addEventListener('mouseleave', () => { mouseDown = false; });
renderer.domElement.addEventListener('mousemove', (e) => {
    // Table hover detection
    const mouse = new THREE.Vector2(
        (e.clientX / renderer.domElement.clientWidth) * 2 - 1,
        -(e.clientY / renderer.domElement.clientHeight) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, camera);
    // Check intersection with table and bevel
    const intersects = raycaster.intersectObjects([table, bevel], true);
    if (intersects.length > 0) {
        if (!tableHovered) {
            tableHovered = true;
            bevel.material.color.set(highlightBevelColor);
        }
    } else {
        if (tableHovered) {
            tableHovered = false;
            bevel.material.color.set(normalBevelColor);
        }
    }

    // Only process camera look if mouseDown
    if (!mouseDown) return;
    const dx = e.clientX - prevMouseX;
    const dy = e.clientY - prevMouseY;
    prevMouseX = e.clientX;
    prevMouseY = e.clientY;
    yaw -= dx * 0.002;
    pitch -= dy * 0.002;
    pitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, pitch));
});

// Mouse wheel zoom
renderer.domElement.addEventListener('wheel', (e) => {
    // Zoom in/out by moving camera radius
    const zoomSpeed = 0.5;
    if (e.deltaY > 0) {
        orbitRadius = Math.min(orbitRadius + zoomSpeed, 24); // max zoom out
    } else {
        orbitRadius = Math.max(orbitRadius - zoomSpeed, 2.5); // min zoom in
    }
}, { passive: true });

// Fullscreen
renderer.domElement.style.position = 'fixed';
renderer.domElement.style.top = '0';
renderer.domElement.style.left = '0';
renderer.domElement.style.width = '100vw';
renderer.domElement.style.height = '100vh';
renderer.domElement.style.zIndex = '999';

function resize3D() {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize3D);
resize3D();

// Lighting
const light = new THREE.DirectionalLight(0xffffff, 1.7); // increased intensity
light.position.set(5, 10, 5);
scene.add(light);

const ambient = new THREE.AmbientLight(0xffffff, 0.7); // increased intensity
scene.add(ambient);

// D20 and D12
const radius = 0.6;
const d20Geometry = new THREE.IcosahedronGeometry(radius, 0);
const d12Geometry = new THREE.DodecahedronGeometry(radius * 0.95, 0); // d12 slightly smaller

// Edge highlight (glow) setup
const EDGE_GLOW_COLOR = 0x8fd6ff; // light blue
let d20EdgeGlow = null;
let d20bEdgeGlow = null;
let d20Hovered = false;
let d20bHovered = false;
let d12EdgeGlow = null;
let d12Hovered = false;


// Create procedural bright purple + gold veins texture (shared for d20/d12)
function createBrightPurpleGoldTexture(size = 512, veins = 1200) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#a259ff'; // Bright purple
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < veins; i++) {
        const x = Math.random() * size;
        const y = Math.random() * size;
        const angle = Math.random() * Math.PI * 2;
        const length = 40 + Math.random() * 60;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(length, 0);
        ctx.lineWidth = 2 + Math.random() * 2;
        const purpleGold = 'rgba(162, 89, 255, 0.7)'; // bright purple
        const gold = 'rgba(255, 215, 80, 0.5)'; // brighter gold
        ctx.strokeStyle = Math.random() < 0.7 ? purpleGold : gold;
        ctx.shadowColor = Math.random() < 0.7 ? 'rgba(162, 89, 255, 0.3)' : 'rgba(255, 215, 80, 0.18)';
        ctx.shadowBlur = 6;
        ctx.stroke();
        ctx.restore();
    }
    return canvas;
}

const d20Texture = new THREE.CanvasTexture(createBrightPurpleGoldTexture());
const d20Material = new THREE.MeshPhysicalMaterial({
    map: d20Texture,
    color: 0xffffff,
    metalness: 0.92,
    roughness: 0.13,
    clearcoat: 0.7,
    clearcoatRoughness: 0.08,
    reflectivity: 0.82,
    sheen: 0.25,
    sheenColor: new THREE.Color(0xffffff)
});

const d12Texture = new THREE.CanvasTexture(createBrightPurpleGoldTexture(512, 900));
const d12Material = new THREE.MeshPhysicalMaterial({
    map: d12Texture,
    color: 0xffffff,
    metalness: 0.92,
    roughness: 0.13,
    clearcoat: 0.7,
    clearcoatRoughness: 0.08,
    reflectivity: 0.82,
    sheen: 0.25,
    sheenColor: new THREE.Color(0xffffff)
});

// Move dice starting point over to the right (e.g., x = 4.5)
const diceStartX = 4.5;
const diceStartY = 1.5;
const diceStartZ = 0;

const d20 = new THREE.Mesh(d20Geometry, d20Material);
d20.position.set(diceStartX, diceStartY, diceStartZ);
scene.add(d20);
d20.visible = false;

// D12 die
const d12 = new THREE.Mesh(d12Geometry, d12Material);
d12.position.set(diceStartX - 0.5, diceStartY, diceStartZ); // Slightly left
scene.add(d12);
d12.visible = false;

// Add second die (d20b)
const d20b = new THREE.Mesh(d20Geometry.clone(), d20Material.clone());
d20b.position.set(diceStartX + 0.5, diceStartY, diceStartZ); // Slightly right
scene.add(d20b);
d20b.visible = false;

// Dice roll animation state
let rolling = false;
let falling = false;
let rollStart = 0;
let rollDuration = 1200; // ms
let rollTarget = { x: 0, y: 0 };
let gravity = -0.025;
let dieVelocity = new THREE.Vector3(0, 0, 0);
let dieAngularVelocity = new THREE.Vector2(0, 0);
const dieInitialY = 1.5;

// D12 animation state
let rollingD12 = false;
let fallingD12 = false;
let dieVelocityD12 = new THREE.Vector3(0, 0, 0);
let dieAngularVelocityD12 = new THREE.Vector2(0, 0);

// Second die animation state
let rollingB = false;
let fallingB = false;
let dieVelocityB = new THREE.Vector3(0, 0, 0);
let dieAngularVelocityB = new THREE.Vector2(0, 0);

// --- Example Player ---
// Player tracked coordinate (can be updated for movement)
// Place player above the table: y = tableHeight + (new sphere radius) + small offset
// Place player above the map mesh: map mesh is at table.position.y + tableHeight / 2 + 2.0
const player = { x: 0, y: tableHeight / 2 - .5, z: 0 }; // Lowered closer to table
// Create a simple sphere mesh for the player (half size)

// (Player glow mesh code moved below, after imagePlaneSize and table are defined)

// --- Humanoid polygon figure ---
const playerMaterial = new THREE.MeshStandardMaterial({ color: 0x22ff44, metalness: 0.3, roughness: 0.5 });
const scaleFactor = 0.5;
const playerHead = new THREE.Mesh(new THREE.SphereGeometry(0.07 * scaleFactor, 10, 10), playerMaterial);
const playerBody = new THREE.Mesh(new THREE.CylinderGeometry(0.055 * scaleFactor, 0.07 * scaleFactor, 0.18 * scaleFactor, 8), playerMaterial);
const playerArmL = new THREE.Mesh(new THREE.CylinderGeometry(0.022 * scaleFactor, 0.022 * scaleFactor, 0.13 * scaleFactor, 6), playerMaterial);
const playerArmR = new THREE.Mesh(new THREE.CylinderGeometry(0.022 * scaleFactor, 0.022 * scaleFactor, 0.13 * scaleFactor, 6), playerMaterial);
const playerLegL = new THREE.Mesh(new THREE.CylinderGeometry(0.025 * scaleFactor, 0.025 * scaleFactor, 0.13 * scaleFactor, 6), playerMaterial);
const playerLegR = new THREE.Mesh(new THREE.CylinderGeometry(0.025 * scaleFactor, 0.025 * scaleFactor, 0.13 * scaleFactor, 6), playerMaterial);

// Assemble figure
const playerMesh = new THREE.Group();
playerHead.position.set(0, 0.18 * scaleFactor, 0);
playerBody.position.set(0, 0.09 * scaleFactor, 0);
playerArmL.position.set(-0.07 * scaleFactor, 0.13 * scaleFactor, 0);
playerArmL.rotation.z = Math.PI / 2.2;
playerArmR.position.set(0.07 * scaleFactor, 0.13 * scaleFactor, 0);
playerArmR.rotation.z = -Math.PI / 2.2;
playerLegL.position.set(-0.03 * scaleFactor, -0.045 * scaleFactor, 0);
playerLegR.position.set(0.03 * scaleFactor, -0.045 * scaleFactor, 0);
playerMesh.add(playerHead);
playerMesh.add(playerBody);
playerMesh.add(playerArmL);
playerMesh.add(playerArmR);
playerMesh.add(playerLegL);
playerMesh.add(playerLegR);
// Lower the group so the feet touch the map (adjust Y offset for new scale)
playerMesh.position.set(player.x, player.y - 1.30 * scaleFactor, player.z);
scene.add(playerMesh);

// Roll dice or move camera on click
renderer.domElement.addEventListener('click', (e) => {
    const mouse = new THREE.Vector2(
        (e.clientX / renderer.domElement.clientWidth) * 2 - 1,
        -(e.clientY / renderer.domElement.clientHeight) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, camera);
    // Check for player click first
    const playerIntersects = raycaster.intersectObject(playerMesh, true);
    if (playerIntersects.length > 0) {
        cameraMode = "player";
        moveToPlayerCamera();
        return;
    }
    // Otherwise, check for dice clicks
    const intersects = raycaster.intersectObjects([d20, d20b, d12], true);
    if (intersects.length > 0) {
        // Which die?
        const obj = intersects[0].object;
        if ((obj === d20 || d20.children.includes(obj)) && !falling && !rolling) {
            falling = true;
            d20.position.y = dieInitialY;
            dieVelocity.set(0, 0, 0);
            dieVelocity.x = (Math.random() - 0.5) * 0.08;
            dieVelocity.z = (Math.random() - 0.5) * 0.08;
            dieAngularVelocity.x = 0.2 + Math.random() * 0.5;
            dieAngularVelocity.y = 0.2 + Math.random() * 0.5;
            spawnParticleBlast(d20.position.clone(), false);
        } else if ((obj === d20b || d20b.children.includes(obj)) && !fallingB && !rollingB) {
            fallingB = true;
            d20b.position.y = dieInitialY;
            dieVelocityB.set(0, 0, 0);
            dieVelocityB.x = (Math.random() - 0.5) * 0.08;
            dieVelocityB.z = (Math.random() - 0.5) * 0.08;
            dieAngularVelocityB.x = 0.2 + Math.random() * 0.5;
            dieAngularVelocityB.y = 0.2 + Math.random() * 0.5;
            spawnParticleBlast(d20b.position.clone(), true);
        } else if ((obj === d12 || d12.children.includes(obj)) && !fallingD12 && !rollingD12) {
            fallingD12 = true;
            d12.position.y = dieInitialY;
            dieVelocityD12.set(0, 0, 0);
            dieVelocityD12.x = (Math.random() - 0.5) * 0.08;
            dieVelocityD12.z = (Math.random() - 0.5) * 0.08;
            dieAngularVelocityD12.x = 0.2 + Math.random() * 0.5;
            dieAngularVelocityD12.y = 0.2 + Math.random() * 0.5;
            spawnParticleBlast(d12.position.clone(), false);
        }
    }
});
// Animate camera to player's perspective
function moveToPlayerCamera() {
    const headPos = playerMesh.position.clone().add(new THREE.Vector3(0, 0.18 * scaleFactor, 0));
    // Camera slightly behind head
    const targetPos = headPos.clone().add(new THREE.Vector3(0, 0.05 * scaleFactor, 0.35 * scaleFactor));
    const duration = 800;
    const startPos = camera.position.clone();
    const startTime = performance.now();
    function animateCamera() {
        const t = Math.min(1, (performance.now() - startTime) / duration);
        camera.position.lerpVectors(startPos, targetPos, t);
        // Always look forward from head
        const forwardLook = headPos.clone().add(new THREE.Vector3(0, 0, 1));
        camera.lookAt(forwardLook);
        if (t < 1) {
            requestAnimationFrame(animateCamera);
        }
    }
    animateCamera();
}

// Die hover detection and edge glow
renderer.domElement.addEventListener('mousemove', (e) => {
    const mouse = new THREE.Vector2(
        (e.clientX / renderer.domElement.clientWidth) * 2 - 1,
        -(e.clientY / renderer.domElement.clientHeight) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects([d20, d20b, d12], true);
    let foundD20 = false, foundD20b = false, foundD12 = false;
    for (let i = 0; i < intersects.length; i++) {
        if (intersects[i].object === d20 || d20.children.includes(intersects[i].object)) foundD20 = true;
        if (intersects[i].object === d20b || d20b.children.includes(intersects[i].object)) foundD20b = true;
        if (intersects[i].object === d12 || d12.children.includes(intersects[i].object)) foundD12 = true;
    }
    // d20 hover
    if (foundD20 && !d20Hovered) {
        d20Hovered = true;
        if (!d20EdgeGlow) {
            const edges = new THREE.EdgesGeometry(d20.geometry);
            d20EdgeGlow = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: EDGE_GLOW_COLOR, linewidth: 2 }));
            d20EdgeGlow.renderOrder = 10;
            d20.add(d20EdgeGlow);
        }
        d20EdgeGlow.visible = true;
    } else if (!foundD20 && d20Hovered) {
        d20Hovered = false;
        if (d20EdgeGlow) d20EdgeGlow.visible = false;
    }
    // d20b hover
    if (foundD20b && !d20bHovered) {
        d20bHovered = true;
        if (!d20bEdgeGlow) {
            const edges = new THREE.EdgesGeometry(d20b.geometry);

        // --- Update player mesh position (if player moves) ---
        playerMesh.position.set(player.x, player.y, player.z);
            d20bEdgeGlow = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: EDGE_GLOW_COLOR, linewidth: 2 }));
            d20bEdgeGlow.renderOrder = 10;
            d20b.add(d20bEdgeGlow);
        }
        d20bEdgeGlow.visible = true;
    } else if (!foundD20b && d20bHovered) {
        d20bHovered = false;
        if (d20bEdgeGlow) d20bEdgeGlow.visible = false;
    }
    // d12 hover
    if (foundD12 && !d12Hovered) {
        d12Hovered = true;
        if (!d12EdgeGlow) {
            const edges = new THREE.EdgesGeometry(d12.geometry);
            d12EdgeGlow = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: EDGE_GLOW_COLOR, linewidth: 2 }));
            d12EdgeGlow.renderOrder = 10;
            d12.add(d12EdgeGlow);
        }
        d12EdgeGlow.visible = true;
    } else if (!foundD12 && d12Hovered) {
        d12Hovered = false;
        if (d12EdgeGlow) d12EdgeGlow.visible = false;
    }
});

// ---- FIXED FACE EXTRACTION ----
let outwardOffset = 0.028; // Reduced distance to move numbers outside faces

// D20 face numbers
const d20FacesA = [], d20FacesB = [], d20NumbersA = [], d20NumbersB = [];
const d20PositionAttr = d20Geometry.attributes.position;
for (let i = 0; i < d20PositionAttr.count; i += 3) {
    const vA = new THREE.Vector3().fromBufferAttribute(d20PositionAttr, i);
    const vB = new THREE.Vector3().fromBufferAttribute(d20PositionAttr, i + 1);
    const vC = new THREE.Vector3().fromBufferAttribute(d20PositionAttr, i + 2);
    const center = new THREE.Vector3().add(vA).add(vB).add(vC).divideScalar(3);
    const normal = new THREE.Vector3().crossVectors(
        vB.clone().sub(vA),
        vC.clone().sub(vA)
    ).normalize();
    if (normal.dot(center) < 0) normal.negate();
    d20FacesA.push({ center: center.clone(), normal: normal.clone() });
    d20FacesB.push({ center: center.clone(), normal: normal.clone() });
    // Number label
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffe066';
    ctx.strokeStyle = '#fff9c4';
    ctx.lineWidth = 8;
    ctx.font = 'bold 68px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeText((i / 3 + 1).toString(), 128, 128);
    ctx.fillText((i / 3 + 1).toString(), 128, 128);
    const texture = new THREE.CanvasTexture(canvas);
    const planeAMaterial = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        side: THREE.DoubleSide
    });
    const planeA = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), planeAMaterial);
    planeA.position.copy(center.clone().add(normal.clone().multiplyScalar(outwardOffset)));
    planeA.lookAt(planeA.position.clone().add(normal));
    d20.add(planeA);
    d20NumbersA.push(planeA);
    // d20b
    const planeBMaterial = planeAMaterial.clone();
    const planeB = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), planeBMaterial);
    planeB.position.copy(center.clone().add(normal.clone().multiplyScalar(outwardOffset)));
    planeB.lookAt(planeB.position.clone().add(normal));
    d20b.add(planeB);
    d20NumbersB.push(planeB);
}

// D12 face numbers
const d12Faces = [], d12Numbers = [];
const d12PositionAttr = d12Geometry.attributes.position;
// Center d12 numbers by averaging all three triangle centers per face
for (let faceIdx = 0; faceIdx < 12; faceIdx++) {
    // Each face is made of 3 triangles (9 vertices)
    let center = new THREE.Vector3();
    let normal = new THREE.Vector3();
    for (let j = 0; j < 3; j++) {
        const i = faceIdx * 9 + j * 3;
        const vA = new THREE.Vector3().fromBufferAttribute(d12PositionAttr, i);
        const vB = new THREE.Vector3().fromBufferAttribute(d12PositionAttr, i + 1);
        const vC = new THREE.Vector3().fromBufferAttribute(d12PositionAttr, i + 2);
        const triCenter = new THREE.Vector3().add(vA).add(vB).add(vC).divideScalar(3);
        center.add(triCenter);
        const triNormal = new THREE.Vector3().crossVectors(
            vB.clone().sub(vA),
            vC.clone().sub(vA)
        ).normalize();
        normal.add(triNormal);
    }
    center.divideScalar(3);
    normal.normalize();
    if (normal.dot(center) < 0) normal.negate();
    d12Faces.push({ center: center.clone(), normal: normal.clone() });
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffe066';
    ctx.strokeStyle = '#fff9c4';
    ctx.lineWidth = 8;
    ctx.font = 'bold 68px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeText((faceIdx + 1).toString(), 128, 128);
    ctx.fillText((faceIdx + 1).toString(), 128, 128);
    const texture = new THREE.CanvasTexture(canvas);
    const planeMat = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        side: THREE.DoubleSide
    });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), planeMat);
    plane.position.copy(center.clone().add(normal.clone().multiplyScalar(outwardOffset)));
    plane.lookAt(plane.position.clone().add(normal));
    d12.add(plane);
    d12Numbers.push(plane);
}

// Highlight top face for d20, d20b, d12
function highlightTopFace(die, faces, numberMeshes, highlightColor) {
    let maxDot = -Infinity;
    let topIdx = -1;
    for (let i = 0; i < faces.length; i++) {
        const worldNormal = faces[i].normal.clone().applyQuaternion(die.quaternion);
        const dot = worldNormal.dot(new THREE.Vector3(0, 1, 0));
        if (dot > maxDot) {
            maxDot = dot;
            topIdx = i;
        }
    }
    for (let i = 0; i < numberMeshes.length; i++) {
        numberMeshes[i].material.color.set('#ffffff');
        numberMeshes[i].material.opacity = 0.85;
        numberMeshes[i].material.emissive = undefined;
        numberMeshes[i].material.emissiveIntensity = undefined;
    }
    if (topIdx >= 0 && numberMeshes[topIdx]) {
        numberMeshes[topIdx].material.color.set(highlightColor);
        numberMeshes[topIdx].material.opacity = 1.0;
        if (numberMeshes[topIdx].material.emissive !== undefined) {
            numberMeshes[topIdx].material.emissive.set(highlightColor);
            numberMeshes[topIdx].material.emissiveIntensity = 0.8;
        }
    }
    return topIdx + 1;
}

camera.position.z = 5;

// Table
// Procedural wood texture for table
const tableCanvas = document.createElement('canvas');
tableCanvas.width = 512;
tableCanvas.height = 512;
const tableCtx = tableCanvas.getContext('2d');


// Draw wooden planks
const plankCount = 8 + Math.floor(Math.random() * 3); // 8-10 planks
const plankHeight = tableCanvas.height / plankCount;
for (let i = 0; i < plankCount; i++) {
    // Use a very dark brown for all planks
    const baseColor = '#1a0e05'; // very dark brown
    tableCtx.fillStyle = baseColor;
    tableCtx.fillRect(0, i * plankHeight, tableCanvas.width, plankHeight);
    // Draw plank edge shadow
    tableCtx.beginPath();
    tableCtx.moveTo(0, (i + 1) * plankHeight);
    tableCtx.lineTo(tableCanvas.width, (i + 1) * plankHeight);
    tableCtx.lineWidth = 3.2;
    tableCtx.strokeStyle = 'rgba(20, 10, 5, 0.38)'; // even darker plank edge
    tableCtx.stroke();
    // Add some wood grain lines to each plank
    for (let g = 0; g < 7; g++) {
        const gy = (i * plankHeight) + Math.random() * plankHeight;
        tableCtx.beginPath();
        let prevY = gy;
        for (let x = 0; x < tableCanvas.width; x += 8) {
            const offset = Math.sin(x * 0.04 + i) * 2 + Math.random() * 1.2;
            tableCtx.lineTo(x, prevY + offset);
        }
        tableCtx.lineWidth = 1.1;
        tableCtx.strokeStyle = 'rgba(30, 18, 8, 0.28)'; // very dark grain
        tableCtx.stroke();
    }
    // Add a few knots
    for (let k = 0; k < 2; k++) {
        const knotX = Math.random() * tableCanvas.width;
        const knotY = (i * plankHeight) + Math.random() * plankHeight;
        const knotR = 6 + Math.random() * 7;
        const grad = tableCtx.createRadialGradient(knotX, knotY, 1, knotX, knotY, knotR);
        grad.addColorStop(0, 'rgba(20,10,5,0.32)');
        grad.addColorStop(1, 'rgba(20,10,5,0)');
        tableCtx.beginPath();
        tableCtx.arc(knotX, knotY, knotR, 0, Math.PI * 2);
        tableCtx.fillStyle = grad;
        tableCtx.fill();
    }
}

const tableTexture = new THREE.CanvasTexture(tableCanvas);
// Make table surface bigger and add beveled edge
const tableRadius = 8.0;
// const tableHeight = 0.6; // removed duplicate
const table = new THREE.Mesh(
    new THREE.CylinderGeometry(tableRadius, tableRadius, tableHeight, 64),
    new THREE.MeshStandardMaterial({
        map: tableTexture,
        color: 0xffffff,
        roughness: 0.85,
        metalness: 0.18,
        normalScale: new THREE.Vector2(1.2, 1.2)
    })
);
table.position.y = -1.5;
scene.add(table);

// Add beveled edge using torus
const bevelGeometry = new THREE.TorusGeometry(tableRadius + 0.08, 0.12, 32, 128);
const bevelMaterial = new THREE.MeshStandardMaterial({
    map: tableTexture,
    color: 0xffffff,
    roughness: 0.85,
    metalness: 0.18
});
const bevel = new THREE.Mesh(bevelGeometry, bevelMaterial);
// Lower the bevel to sit flush with table surface
bevel.position.y = -1.5 + tableHeight / 2 + 0.01; // matches table.position.y, slight offset for flush
bevel.rotation.x = Math.PI / 2;
scene.add(bevel);

// ...tray removed...

// --- Water Overflow Effect ---
// Create animated water drips/falls around the tray's rim, visually extending the water shader down the table's edge
const overflowCount = 18;
const overflowMeshes = [];
// Tray and its overflow effect removed

function animateWaterOverflow() {
    const t = performance.now() * 0.001;
    for (const { uniforms } of overflowMeshes) {
        uniforms.time.value = t + Math.random() * 10.0;
    }
    requestAnimationFrame(animateWaterOverflow);
}
animateWaterOverflow();



// --- Ocean Underneath Table ---

// Large animated water cube (open box, no top)
const oceanSize = tableRadius * 7.5;
const oceanHeight = 8; // height of the sea walls
const oceanThickness = 1.2; // thickness of the cube walls
const oceanY = table.position.y - tableHeight / 2 - 1.8;

// Water shader for the base and walls
const waterUniforms = {
    time: { value: 0 },
    deepColor: { value: new THREE.Color(0x3a5dbb) },
    shallowColor: { value: new THREE.Color(0x8dbad6) },
    foamColor: { value: new THREE.Color(0x3a5dbb) }
};
const waterMaterial = new THREE.ShaderMaterial({
    uniforms: waterUniforms,
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform float time;
        uniform vec3 deepColor;
        uniform vec3 shallowColor;
        uniform vec3 foamColor;
        varying vec2 vUv;
        float hash(vec2 p) {
            return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }
        float noise(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            float a = hash(i);
            float b = hash(i + vec2(1.0, 0.0));
            float c = hash(i + vec2(0.0, 1.0));
            float d = hash(i + vec2(1.0, 1.0));
            vec2 u = f * f * (3.0 - 2.0 * f);
            return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
        }
        float oceanWaves(vec2 uv, float t) {
            float wave = 0.0;
            float slowT = t * 0.07;
            wave += sin(uv.x * 10.0 + slowT * 1.1) * 0.10;
            wave += cos(uv.y * 12.0 + slowT * 0.9) * 0.08;
            wave += sin((uv.x + uv.y) * 7.0 + slowT * 1.3) * 0.06;
            wave += sin(uv.x * 22.0 - uv.y * 10.0 + slowT * 1.7) * 0.03;
            wave += noise(uv * 18.0 + slowT * 0.7) * 0.07;
            wave += noise(uv * 54.0 - slowT * 0.5) * 0.04;
            return wave;
        }
        void main() {
            float t = time;
            vec2 distortedUv = vUv;
            distortedUv.x += 0.09 * sin(10.0 * vUv.y + t * 0.2) + 0.07 * cos(18.0 * vUv.x + t * 0.13);
            distortedUv.y += 0.09 * cos(12.0 * vUv.x - t * 0.18) + 0.07 * sin(16.0 * vUv.y - t * 0.11);
            distortedUv += 0.05 * noise(vUv * 14.0 + t * 0.09);
            float wave = oceanWaves(distortedUv, t);
            float ripple = sin(38.0 * (distortedUv.x + distortedUv.y) + t * 0.13) * 0.02;
            float baseMix = 0.5 + 0.5 * sin(6.0 * distortedUv.x + 7.0 * distortedUv.y + t * 0.05 + wave + ripple);
            vec3 waterColor = mix(shallowColor, deepColor, baseMix);
            float foam = 0.0;
            float foamWaves = sin(18.0 * distortedUv.x + t * 0.11) * 0.5 + cos(20.0 * distortedUv.y + t * 0.09) * 0.5;
            float foamNoise = noise(distortedUv * 48.0 + t * 0.05);
            foam = smoothstep(0.62, 0.84, foamWaves + foamNoise + wave * 0.5);
            float foamStreaks = smoothstep(0.7, 0.9, sin(40.0 * distortedUv.x + t * 0.16 + 8.0 * distortedUv.y));
            foam = max(foam, foamStreaks * 0.7);
            vec3 finalColor = mix(waterColor, foamColor, foam);
            gl_FragColor = vec4(finalColor, 0.92);
        }
    `,
    transparent: true
});

// Use the water shader material for the walls
// (waterMaterial is now defined above)

// Front wall
const wallFront = new THREE.Mesh(
    new THREE.BoxGeometry(oceanSize, oceanHeight, oceanThickness),
    waterMaterial
);
wallFront.position.set(0, oceanY + oceanHeight / 2, -oceanSize / 2 + oceanThickness / 2);
scene.add(wallFront);

// Back wall
const wallBack = new THREE.Mesh(
    new THREE.BoxGeometry(oceanSize, oceanHeight, oceanThickness),
    waterMaterial
);
wallBack.position.set(0, oceanY + oceanHeight / 2, oceanSize / 2 - oceanThickness / 2);
scene.add(wallBack);

// Left wall
const wallLeft = new THREE.Mesh(
    new THREE.BoxGeometry(oceanThickness, oceanHeight, oceanSize),
    waterMaterial
);
wallLeft.position.set(-oceanSize / 2 + oceanThickness / 2, oceanY + oceanHeight / 2, 0);
scene.add(wallLeft);

// Right wall
const wallRight = new THREE.Mesh(
    new THREE.BoxGeometry(oceanThickness, oceanHeight, oceanSize),
    waterMaterial
);
wallRight.position.set(oceanSize / 2 - oceanThickness / 2, oceanY + oceanHeight / 2, 0);
scene.add(wallRight);

// Base (bottom) of the sea cube
const base = new THREE.Mesh(
    new THREE.BoxGeometry(oceanSize, oceanThickness, oceanSize),
    waterMaterial
);
base.position.set(0, oceanY + oceanThickness / 2, 0);
scene.add(base);

// Animate water shader
function animateWaterBase() {
    waterUniforms.time.value = performance.now() * 0.001;
    requestAnimationFrame(animateWaterBase);
}
animateWaterBase();

// --- Floating Wooden Crate ---
const crateSize = 1.1;
// Beveled box for more realism
const crateGeometry = new THREE.BoxGeometry(crateSize, crateSize, crateSize, 2, 2, 2);
// Add plank grooves by modifying geometry
const cratePlankCount = 4;
for (let i = 0; i < crateGeometry.attributes.position.count; i++) {
    let v = new THREE.Vector3().fromBufferAttribute(crateGeometry.attributes.position, i);
    // Add shallow grooves along X and Z faces
    if (Math.abs(v.y) > crateSize * 0.45) {
        v.x += Math.sin(v.z * cratePlankCount * Math.PI / crateSize) * 0.04;
        v.z += Math.sin(v.x * cratePlankCount * Math.PI / crateSize) * 0.04;
    }
    crateGeometry.attributes.position.setXYZ(i, v.x, v.y, v.z);
}
crateGeometry.computeVertexNormals();

// Load a wood texture for realism
const crateTexture = new THREE.TextureLoader().load('https://cdn.jsdelivr.net/gh/mrdoob/three.js@master/examples/textures/wood.jpg');
crateTexture.wrapS = crateTexture.wrapT = THREE.RepeatWrapping;
crateTexture.repeat.set(1.5, 1.5);

const crateMaterial = new THREE.MeshStandardMaterial({
    color: 0x8b5a2b,
    roughness: 0.48,
    metalness: 0.13,
    map: crateTexture,
    normalScale: new THREE.Vector2(0.5, 0.5),
});
const crate = new THREE.Mesh(crateGeometry, crateMaterial);
crate.castShadow = true;
crate.receiveShadow = true;
// Place crate somewhere in the water, not too close to tray or rocks

const crateAngle = Math.PI * 1.12; // moved further left
const crateDist = oceanSize * 0.36;
crate.position.set(
    Math.cos(crateAngle) * crateDist,
    oceanY + crateSize / 2 + 0.18,
    Math.sin(crateAngle) * crateDist
);
scene.add(crate);

// Add a wooden dock at the outer edge of the sea

const dockLength = oceanSize * 0.38;
const dockWidth = 1.2;
const dockHeight = 0.18;
const dockPlankCount = 7;
const dockGeometry = new THREE.BoxGeometry(dockLength, dockHeight, dockWidth, dockPlankCount, 1, 2);
// Add plank grooves
for (let i = 0; i < dockGeometry.attributes.position.count; i++) {
    let v = new THREE.Vector3().fromBufferAttribute(dockGeometry.attributes.position, i);
    // Grooves between planks along the length
    if (Math.abs(v.z) > dockWidth * 0.45) {
        v.x += Math.sin(v.x * dockPlankCount * Math.PI / dockLength) * 0.04;
    }
    dockGeometry.attributes.position.setXYZ(i, v.x, v.y, v.z);
}
dockGeometry.computeVertexNormals();

// Procedural wood texture for dock
function createWoodTexture(size = 512, planks = 7) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    // Wood base color
    ctx.fillStyle = '#a97c50';
    ctx.fillRect(0, 0, size, size);
    // Draw planks
    for (let i = 0; i < planks; i++) {
        ctx.save();
        ctx.strokeStyle = '#7a5632';
        ctx.lineWidth = 8;
        ctx.beginPath();
        let y = Math.round((i + 1) * size / (planks + 1));
        ctx.moveTo(0, y);
        ctx.lineTo(size, y);
        ctx.stroke();
        ctx.restore();
    }
    // Add wood grain
    for (let i = 0; i < 120; i++) {
        ctx.save();
        ctx.globalAlpha = 0.18 + Math.random() * 0.12;
        ctx.strokeStyle = '#6b4a2b';
        ctx.lineWidth = 1 + Math.random() * 2;
        ctx.beginPath();
        let x = Math.random() * size;
        let y = Math.random() * size;
        let len = 60 + Math.random() * 120;
        let angle = (Math.random() - 0.5) * 0.5;
        ctx.moveTo(x, y);
        ctx.lineTo(x + len * Math.cos(angle), y + len * Math.sin(angle));
        ctx.stroke();
        ctx.restore();
    }
    return canvas;
}
const dockTexture = new THREE.CanvasTexture(createWoodTexture(512, dockPlankCount));
dockTexture.wrapS = dockTexture.wrapT = THREE.RepeatWrapping;
dockTexture.repeat.set(2, 1.5);
const dockMaterial = new THREE.MeshStandardMaterial({
    color: 0x9b7653,
    roughness: 0.44,
    metalness: 0.11,
    map: dockTexture,
    normalScale: new THREE.Vector2(0.5, 0.5),
});
const dock = new THREE.Mesh(dockGeometry, dockMaterial);
dock.castShadow = true;
dock.receiveShadow = true;
// Place dock at the outer front edge of the ocean, slightly above water
const dockY = oceanY + oceanHeight + dockHeight / 2 - 0.08;
dock.position.set(0, dockY, -oceanSize / 2 + dockLength / 2 + 0.2);
scene.add(dock);

// Add pilings (cylinders) under the dock
const pilingRadius = 0.13;
const pilingHeight = oceanHeight + 0.5;
const pilingMaterial = new THREE.MeshStandardMaterial({
    color: 0x7a5632,
    roughness: 0.5,
    metalness: 0.08
});
const pilingCount = 4;
for (let i = 0; i < pilingCount; i++) {
    const x = -dockLength/2 + (i + 0.5) * (dockLength / pilingCount);
    for (let j = 0; j < 2; j++) { // two rows (front/back)
        const z = (j === 0) ? -dockWidth/2 + pilingRadius*1.1 : dockWidth/2 - pilingRadius*1.1;
        const piling = new THREE.Mesh(
            new THREE.CylinderGeometry(pilingRadius, pilingRadius * 0.97, pilingHeight, 16),
            pilingMaterial
        );
        piling.position.set(x, dockY - pilingHeight/2 - dockHeight/2 + 0.01, dock.position.z + z);
        piling.castShadow = true;
        piling.receiveShadow = true;
        scene.add(piling);
    }
}

// Add a subtle wetness effect to the bottom of the crate
const wetMaterial = crateMaterial.clone();
wetMaterial.color = new THREE.Color(0x5a3a1a);
wetMaterial.roughness = 0.22;
wetMaterial.metalness = 0.22;
wetMaterial.opacity = 0.7;
wetMaterial.transparent = true;
const wetGeo = new THREE.BoxGeometry(crateSize * 0.98, crateSize * 0.18, crateSize * 0.98);
const wetMesh = new THREE.Mesh(wetGeo, wetMaterial);
wetMesh.position.y = -crateSize * 0.41;
crate.add(wetMesh);

// Animate crate bobbing up and down
let crateBobPhase = Math.random() * Math.PI * 2;
// ...rocks removed...


// Ocean animation removed (no animated ocean shader in use)

// ...animateWater removed...

// --- Image Plane Above Table (shows map.png) ---
const imagePlaneSize = tableRadius * 0.8;
const imagePlaneHeight = table.position.y + tableHeight / 2 + 0.0241 - 2 - 2;
const imagePlaneGeometry = new THREE.PlaneGeometry(imagePlaneSize, imagePlaneSize);
// Terrain heights must be accessible to all relevant functions
const terrainGridSize = 32; // Reasonable detail for color-based geometry
let terrainHeights = [];
for (let y = 0; y <= terrainGridSize; y++) {
    terrainHeights[y] = [];
    for (let x = 0; x <= terrainGridSize; x++) {
        terrainHeights[y][x] = 0;
    }
}
const loader = new THREE.TextureLoader();
loader.setPath('static/');
loader.load('map.png', function(texture) {
    texture.anisotropy = 8;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.minFilter = THREE.LinearFilter;

    // Create a canvas to draw the image and grid
    const gridCanvas = document.createElement('canvas');
    gridCanvas.width = 1024;
    gridCanvas.height = 1024;
    const ctx = gridCanvas.getContext('2d');

    // Draw the map image semi-transparent
    const img = new window.Image();
    img.onload = function() {
        ctx.globalAlpha = 0.55; // semi-transparent
        ctx.drawImage(img, 0, 0, gridCanvas.width, gridCanvas.height);
        ctx.globalAlpha = 1.0;

        // --- Add paper grain/noise overlay ---
        const noiseAlpha = 0.10; // subtle
        const noiseIntensity = 32; // 0-255
        const noiseCanvas = document.createElement('canvas');
        noiseCanvas.width = gridCanvas.width;
        noiseCanvas.height = gridCanvas.height;
        const noiseCtx = noiseCanvas.getContext('2d');
        const noiseImgData = noiseCtx.createImageData(noiseCanvas.width, noiseCanvas.height);
        for (let i = 0; i < noiseImgData.data.length; i += 4) {
            const n = Math.floor(Math.random() * noiseIntensity);
            noiseImgData.data[i] = n;
            noiseImgData.data[i + 1] = n;
            noiseImgData.data[i + 2] = n;
            noiseImgData.data[i + 3] = Math.floor(255 * noiseAlpha);
        }
        noiseCtx.putImageData(noiseImgData, 0, 0);
        ctx.drawImage(noiseCanvas, 0, 0);

        // --- Overlay quad grid ---
        ctx.save();
        ctx.globalAlpha = 0.45; // grid lines semi-transparent
        ctx.strokeStyle = '#222';
        ctx.lineWidth = 2;
        for (let i = 0; i <= terrainGridSize; i++) {
            // Vertical lines
            const x = (i / terrainGridSize) * gridCanvas.width;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, gridCanvas.height);
            ctx.stroke();
            // Horizontal lines
            const y = (i / terrainGridSize) * gridCanvas.height;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(gridCanvas.width, y);
            ctx.stroke();
        }
        ctx.restore();

        const gridCount = terrainGridSize;

        // --- Generate height map from image color ---
        // Sample the image at grid points and set terrainHeights based on color
        function colorToHeight(r, g, b) {
            // Example mapping: blue=water, green=grass, brown=mountain, gray=stone
            if (b > 180 && r < 100 && g < 100) return -5.0; // Water (blue, much lower)
            if (g > 140 && r < 120 && b < 120) return 2.0; // Grass (green, higher)
            if (r > 120 && g > 80 && b < 80) return 8.0; // Mountain (brown, much higher)
            if (r > 150 && g > 150 && b > 150) return 0.0; // Flat (white/gray)
            return 0.0; // Default flat
        }
        for (let y = 0; y <= gridCount; y++) {
            for (let x = 0; x <= gridCount; x++) {
                // Sample center of each cell
                const px = Math.floor((x / gridCount) * gridCanvas.width);
                const py = Math.floor((y / gridCount) * gridCanvas.height);
                const pixel = ctx.getImageData(px, py, 1, 1).data;
                terrainHeights[y][x] = colorToHeight(pixel[0], pixel[1], pixel[2]);
            }
        }

            // --- Smooth the terrain heights to remove outliers ---
            function smoothHeights(heights, passes = 2) {
                const h = heights.length;
                const w = heights[0].length;
                for (let pass = 0; pass < passes; pass++) {
                    const copy = heights.map(row => row.slice());
                    for (let y = 0; y < h; y++) {
                        for (let x = 0; x < w; x++) {
                            let sum = 0, count = 0;
                            for (let dy = -1; dy <= 1; dy++) {
                                for (let dx = -1; dx <= 1; dx++) {
                                    const ny = y + dy, nx = x + dx;
                                    if (ny >= 0 && ny < h && nx >= 0 && nx < w) {
                                        sum += copy[ny][nx];
                                        count++;
                                    }
                                }
                            }
                            heights[y][x] = sum / count;
                        }
                    }
                }
            }
            smoothHeights(terrainHeights, 3); // 3 passes for extra smoothness

        // Draw grid
        // Grid drawing removed: no visible grid on the map

        const gridTexture = new THREE.CanvasTexture(gridCanvas);
        gridTexture.anisotropy = 8;
        gridTexture.wrapS = THREE.ClampToEdgeWrapping;
        gridTexture.wrapT = THREE.ClampToEdgeWrapping;
        gridTexture.minFilter = THREE.LinearFilter;
        // --- Editable Terrain Grid & Deformable Map ---
        // --- Glowing overlay for player square (must be after imagePlaneSize and table are defined) ---
        let playerGlowMesh = null;
        function createPlayerGlowMesh() {
            const cellSize = imagePlaneSize / terrainGridSize;
            const glowGeo = new THREE.PlaneGeometry(cellSize * 0.98, cellSize * 0.98);
            const glowMat = new THREE.MeshBasicMaterial({
                color: 0xffff00,
                transparent: true,
                opacity: 0.45,
                blending: THREE.AdditiveBlending,
                depthWrite: false
            });
            const mesh = new THREE.Mesh(glowGeo, glowMat);
            mesh.rotation.x = -Math.PI / 2;
            mesh.renderOrder = 10;
            return mesh;
        }
        playerGlowMesh = createPlayerGlowMesh();
        scene.add(playerGlowMesh);

        function updatePlayerGlow() {
            // Convert player.x, player.z to grid cell
            const gridX = Math.floor((player.x + imagePlaneSize / 2) / (imagePlaneSize / terrainGridSize));
            const gridZ = Math.floor((player.z + imagePlaneSize / 2) / (imagePlaneSize / terrainGridSize));
            const cellSize = imagePlaneSize / terrainGridSize;
            // Clamp to grid
            const clampedX = Math.max(0, Math.min(terrainGridSize - 1, gridX));
            const clampedZ = Math.max(0, Math.min(terrainGridSize - 1, gridZ));
            // Center of cell
            const px = -imagePlaneSize / 2 + (clampedX + 0.5) * cellSize;
            const pz = -imagePlaneSize / 2 + (clampedZ + 0.5) * cellSize;
            // Place just above the map mesh
            playerGlowMesh.position.set(px, player.y - 0.18, pz);
        }
        updatePlayerGlow();

        // Update glow position when player moves (add to animation loop if needed)
        function animatePlayerGlow() {
            updatePlayerGlow();
            requestAnimationFrame(animatePlayerGlow);
        }
        animatePlayerGlow();
        const terrainCellSize = imagePlaneSize / terrainGridSize;

        let terrainMesh = null;
        let mapMesh = null;
        function createTerrainGeometry() {
            // Higher resolution plane for displacement
            return new THREE.PlaneGeometry(imagePlaneSize, imagePlaneSize, 128, 128);
        }

        function addTerrainMesh() {
            if (terrainMesh) scene.remove(terrainMesh);
            if (mapMesh) scene.remove(mapMesh);
            const geometry = createTerrainGeometry();

            // --- Load supplemental maps ---
            const texLoader = new THREE.TextureLoader();
            texLoader.setPath('static/');
            const normalMap = texLoader.load('map_normal.png');
            const specularMap = texLoader.load('map_specular.png');
            const displacementMap = texLoader.load('map_displacement.png');
            const aoMap = texLoader.load('map_ambient_occlusion.png');

            [normalMap, specularMap, displacementMap, aoMap].forEach(t => {
                if (t) {
                    t.anisotropy = 8;
                    t.wrapS = THREE.ClampToEdgeWrapping;
                    t.wrapT = THREE.ClampToEdgeWrapping;
                    t.minFilter = THREE.LinearFilter;
                }
            });

            // Subtle animated distortion ShaderMaterial for map
            const mapUniforms = {
                map: { value: gridTexture },
                time: { value: 0 },
                displacementMap: { value: displacementMap },
                displacementScale: { value: 0.07 }, // very subtle
            };
            const mapMaterial = new THREE.ShaderMaterial({
                uniforms: mapUniforms,
                vertexShader: `
                    varying vec2 vUv;
                    void main() {
                        vUv = uv;
                        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                    }
                `,
                fragmentShader: `
                    uniform sampler2D map;
                    uniform sampler2D displacementMap;
                    uniform float displacementScale;
                    uniform float time;
                    varying vec2 vUv;
                    void main() {
                        float freq = 2.0;
                        float amp = 0.0015;
                        vec2 uv = vUv;
                        uv.x += sin(uv.y * 6.2831 * freq + time * 0.7) * amp;
                        uv.y += cos(uv.x * 6.2831 * freq + time * 0.5) * amp;
                        // Sample displacement map in fragment shader
                        float disp = texture2D(displacementMap, uv).r;
                        float d = (disp - 0.5) * displacementScale;
                        // Optionally use d to modulate color, alpha, or lighting
                        vec4 tex = texture2D(map, uv);
                        gl_FragColor = tex;
                    }
                `,
                side: THREE.DoubleSide,
                transparent: false
            });
            const meshY = table.position.y + tableHeight / 2 + .1;
            mapMesh = new THREE.Mesh(geometry.clone(), mapMaterial);
            mapMesh.position.set(0, meshY, 0);
            mapMesh.rotation.x = -Math.PI / 2;
            scene.add(mapMesh);
            // Animate map distortion
            function animateMapDistortion() {
                if (mapMesh && mapMesh.material && mapMesh.material.uniforms && mapMesh.material.uniforms.time) {
                    mapMesh.material.uniforms.time.value = performance.now() * 0.001;
                }
                requestAnimationFrame(animateMapDistortion);
            }
            animateMapDistortion();
            // Terrain wireframe overlay removed: no grid or wireframe visible
        }
        addTerrainMesh();
        // --- Face Selection for Terrain ---
        let selectedFace = null;
        renderer.domElement.addEventListener('mousedown', (e) => {
            // Only left click
            if (e.button !== 0) return;
            // Convert mouse to NDC
            const rect = renderer.domElement.getBoundingClientRect();
            const mouse = new THREE.Vector2(
                ((e.clientX - rect.left) / rect.width) * 2 - 1,
                -((e.clientY - rect.top) / rect.height) * 2 + 1
            );
            const raycaster = new THREE.Raycaster();
            raycaster.setFromCamera(mouse, camera);
            if (!terrainMesh) return;
            const intersects = raycaster.intersectObject(terrainMesh, false);
            if (intersects.length > 0) {
                selectedFace = intersects[0];
                // Visual feedback: highlight selected face
                const idx = selectedFace.face.a;
                const geometry = terrainMesh.geometry;
                if (!geometry.attributes.color) {
                    const colors = [];
                    for (let i = 0; i < geometry.attributes.position.count; i++) {
                        colors.push(0.8, 0.8, 0.8);
                    }
                    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
                }
                // Reset all colors
                for (let i = 0; i < geometry.attributes.color.count; i++) {
                    geometry.attributes.color.setXYZ(i, 0.8, 0.8, 0.8);
                }
                // Highlight the three vertices of the selected face
                geometry.attributes.color.setXYZ(selectedFace.face.a, 1, 0.5, 0.2);
                geometry.attributes.color.setXYZ(selectedFace.face.b, 1, 0.5, 0.2);
                geometry.attributes.color.setXYZ(selectedFace.face.c, 1, 0.5, 0.2);
                geometry.attributes.color.needsUpdate = true;
                geometry.attributes.position.needsUpdate = true;

                // --- Raise/lower terrain on click ---
                // Find grid indices for the three vertices
                const indices = [selectedFace.face.a, selectedFace.face.b, selectedFace.face.c];
                const verts = indices.map(i => {
                    return {
                        ix: i % (terrainGridSize + 1),
                        iy: Math.floor(i / (terrainGridSize + 1))
                    };
                });
                // Raise with left click, lower with right click
                let delta = e.shiftKey ? -0.2 : 0.2;
                verts.forEach(v => {
                    terrainHeights[v.iy][v.ix] += delta;
                });
                addTerrainMesh();
            }
        });
    };
    img.src = texture.image.currentSrc || texture.image.src;
});


// Fireplace (simple box with glowing fire)
// Fireplace removed

// Bookshelves (tall boxes)
// Bookshelves removed

// Add a lit candle to the table

// --- Waterfall Cylinder ---
// Create a hollow open-ended cylinder for the waterfall
const waterfallRadius = tableRadius * 1.18; // slightly outside the table
const waterfallHeight = 6.0;
const waterfallRadialSegments = 96;
const waterfallHeightSegments = 32;
const waterfallGeometry = new THREE.CylinderGeometry(
    waterfallRadius, waterfallRadius, waterfallHeight, waterfallRadialSegments, waterfallHeightSegments, true // openEnded
);
const waterfallUniforms = {
    time: { value: 0 },
    color1: { value: new THREE.Color(0x7fd8ff) }, // light blue
    color2: { value: new THREE.Color(0x0055aa) }, // deep blue
    alpha: { value: 0.82 }
};
const waterfallMaterial = new THREE.ShaderMaterial({
    uniforms: waterfallUniforms,
    vertexShader: `
        uniform float time;
        varying vec2 vUv;
        void main() {
            vUv = uv;
            vec3 pos = position;
            // Animate waves around the cylinder
            float angle = atan(pos.x, pos.z);
            float wave = sin(vUv.y * 12.0 + time * 1.2 + angle * 4.0) * 0.18;
            float wave2 = cos(vUv.y * 8.0 + time * 1.5 + angle * 2.0) * 0.12;
            pos.x += cos(angle) * wave;
            pos.z += sin(angle) * wave2;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        }
    `,
    fragmentShader: `
        uniform float time;
        uniform vec3 color1;
        uniform vec3 color2;
        uniform float alpha;
        varying vec2 vUv;
        void main() {
            float stripe = smoothstep(0.45, 0.55, abs(sin(vUv.y * 24.0 + time * 2.0)));
            vec3 color = mix(color1, color2, vUv.y) + vec3(0.18 * stripe);
            float a = alpha * (0.7 + 0.3 * sin(vUv.y * 8.0 + time * 2.5));
            gl_FragColor = vec4(color, a);
        }
    `,
    transparent: true,
    side: THREE.DoubleSide
});
const waterfallMesh = new THREE.Mesh(waterfallGeometry, waterfallMaterial);
// Place the cylinder so it surrounds the table, centered at (0, y, 0)
waterfallMesh.position.set(0, -1.5 + waterfallHeight / 2, 0);
scene.add(waterfallMesh);

// Optional: Add a cliff cylinder behind the waterfall
const cliffRadius = waterfallRadius * 1.04;
const cliffHeight = waterfallHeight * 1.05;
const cliffGeometry = new THREE.CylinderGeometry(
    cliffRadius, cliffRadius, cliffHeight, waterfallRadialSegments, 1, true
);
const cliffMaterial = new THREE.MeshStandardMaterial({
    color: 0x444444,
    roughness: 0.95,
    metalness: 0.05,
    side: THREE.BackSide
});
const cliffMesh = new THREE.Mesh(cliffGeometry, cliffMaterial);
cliffMesh.position.set(0, -1.5 + cliffHeight / 2 - 0.12, 0);
scene.add(cliffMesh);
// --- Barrel on the Dock ---
// Barrel proportions
const barrelHeight = 1.1;
const barrelRadiusTop = 0.38;
const barrelRadiusBottom = 0.38;
const barrelRadiusMiddle = 0.48; // bulge in the middle
const barrelSegments = 32;
// Create a lathe geometry for the barrel profile
const barrelProfile = [];
for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    // Bulge in the middle
    const r = barrelRadiusTop + (barrelRadiusMiddle - barrelRadiusTop) * Math.sin(Math.PI * t);
    barrelProfile.push(new THREE.Vector2(r, -barrelHeight/2 + t * barrelHeight));
}
const barrelGeometry = new THREE.LatheGeometry(barrelProfile, barrelSegments);
// Wood material
// Procedural noise-based wood effect using a custom shader material
const barrelMaterial = new THREE.ShaderMaterial({
    uniforms: {
        baseColor: { value: new THREE.Color(0x8b5a2b) },
        ringColor: { value: new THREE.Color(0x6b3a1a) },
        noiseScale: { value: 6.0 },
        ringScale: { value: 8.0 }
    },
    vertexShader: `
        varying vec3 vPos;
        varying vec2 vUv;
        void main() {
            vPos = position;
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform vec3 baseColor;
        uniform vec3 ringColor;
        uniform float noiseScale;
        uniform float ringScale;
        varying vec3 vPos;
        varying vec2 vUv;

        // Simple 2D noise (value noise)
        float hash(vec2 p) {
            return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }
        float noise(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            float a = hash(i);
            float b = hash(i + vec2(1.0, 0.0));
            float c = hash(i + vec2(0.0, 1.0));
            float d = hash(i + vec2(1.0, 1.0));
            vec2 u = f * f * (3.0 - 2.0 * f);
            return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
        }

        void main() {
            // Simulate wood rings using radial distance and noise
            float r = length(vPos.xz);
            float rings = sin((r + noise(vPos.xz * noiseScale)) * ringScale);
            float wood = 0.5 + 0.5 * rings;
            // Blend base and ring color
            vec3 color = mix(baseColor, ringColor, wood * 0.45);
            // Add subtle noise for grain
            float grain = noise(vPos.xz * noiseScale * 2.0);
            color += 0.08 * (grain - 0.5);
            gl_FragColor = vec4(color, 1.0);
        }
    `
});
const barrel = new THREE.Mesh(barrelGeometry, barrelMaterial);
// Add metal hoops (3 rings)
const hoopMaterial = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.85, roughness: 0.22 });
const hoops = [];
for (let i = 0; i < 3; i++) {
    const y = -barrelHeight/2 + (i / 2) * barrelHeight;
    const hoopGeo = new THREE.TorusGeometry(barrelRadiusMiddle * 1.01, 0.035, 12, 32);
    const hoop = new THREE.Mesh(hoopGeo, hoopMaterial);
    hoop.position.y = y;
    hoop.rotation.x = Math.PI / 2;
    barrel.add(hoop);
    hoops.push(hoop);
}
// Place barrel on dock: estimate dock position near ocean, slightly offset from center
const dockX = 0 + 0.8; // ocean is centered at (0, oceanY, 0)
const dockYBarrel = oceanY + 0.55; // slightly above dock
const dockZ = 0 - 2.2;
barrel.position.set(dockX, dockYBarrel + barrelHeight/2, dockZ);
barrel.rotation.y = Math.random() * Math.PI * 2;
scene.add(barrel);

// Candle shape: more realistic (tapered, melted)
const candleHeight = 1.44;
const candleRadiusTop = 0.22;
const candleRadiusBottom = 0.34;
const candleGeometry = new THREE.CylinderGeometry(candleRadiusTop, candleRadiusBottom, candleHeight, 32, 1, false);
// Add some melted wax effect by modifying vertices
const pos = candleGeometry.attributes.position;
for (let i = 0; i < pos.count; i++) {
    let y = pos.getY(i);
    // Only modify top edge vertices
    if (Math.abs(y - candleHeight/2) < 0.01) {
        let x = pos.getX(i);
        let z = pos.getZ(i);
        // Add random melt effect
        let melt = Math.random() * 0.04 + 0.01;
        pos.setY(i, y + melt);
        // Optionally, bulge some points for wax drips
        if (Math.random() < 0.18) {
            pos.setX(i, x + (Math.random()-0.5)*0.03);
            pos.setZ(i, z + (Math.random()-0.5)*0.03);
        }
    }
}
pos.needsUpdate = true;
const candleMaterial = new THREE.MeshStandardMaterial({ color: 0xf5e6c2, roughness: 0.62 });
const candle = new THREE.Mesh(candleGeometry, candleMaterial);
// Move candle closer to edge of table (right side, not blocking dice)
const candleAngle = Math.PI * 0.18; // ~10 degrees from x axis
const candleEdgeDist = tableRadius - candleRadiusBottom - 0.22;
const candleX = Math.cos(candleAngle) * candleEdgeDist;
const candleZ = Math.sin(candleAngle) * candleEdgeDist;
candle.position.set(candleX, -1.5 + tableHeight / 2 + candleHeight / 2, candleZ);
scene.add(candle);

// Candle flame (small sphere)
const flameGeometry = new THREE.SphereGeometry(0.06, 24, 24); // Slightly larger, smoother
// Create a custom shader material for a stylized gradient flame
const flameMaterial = new THREE.ShaderMaterial({
    uniforms: {
        color1: { value: new THREE.Color(0xffd700) }, // gold
        color2: { value: new THREE.Color(0xff6600) }, // orange
        color3: { value: new THREE.Color(0xffffff) }, // white core
        time: { value: 0 }
    },
    vertexShader: `
        varying vec3 vPosition;
        void main() {
            vPosition = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform vec3 color1;
        uniform vec3 color2;
        uniform vec3 color3;
        uniform float time;
        varying vec3 vPosition;
        void main() {
            float intensity = 1.0 - length(vPosition) * 1.2;
            float flicker = 0.98 + sin(time * 0.8) * 0.04 + fract(sin(dot(vPosition.xy, vec2(12.9898,78.233))) * 43758.5453) * 0.08;
            vec3 color = mix(color2, color1, intensity);
            color = mix(color, color3, pow(intensity, 8.0));
            gl_FragColor = vec4(color * flicker, intensity);
        }
    `,
    transparent: true
});

const flame = new THREE.Mesh(flameGeometry, flameMaterial);
flame.position.set(candleX, candle.position.y + candleHeight / 2 + 0.12, candleZ);
scene.add(flame);

// Candle light
const candleLight = new THREE.PointLight(0xffd700, 1.2, 2.5);
candleLight.position.copy(flame.position);
scene.add(candleLight);

// Add Leave Table button
const leaveBtn = document.createElement('button');
leaveBtn.textContent = 'Leave Table';
leaveBtn.style.position = 'fixed';
leaveBtn.style.top = '16px';
leaveBtn.style.left = '16px';
leaveBtn.style.zIndex = '1001';
leaveBtn.style.padding = '10px 22px';
leaveBtn.style.fontSize = '1.1em';
leaveBtn.style.background = '#222';
leaveBtn.style.color = '#fff';
leaveBtn.style.border = '2px solid #fff';
leaveBtn.style.borderRadius = '8px';
leaveBtn.style.cursor = 'pointer';
leaveBtn.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)';
leaveBtn.style.opacity = '0.92';
leaveBtn.addEventListener('mouseenter', () => leaveBtn.style.opacity = '1');
leaveBtn.addEventListener('mouseleave', () => leaveBtn.style.opacity = '0.92');
leaveBtn.addEventListener('click', () => {
    window.location.href = '/'; // Redirect to main scene (index.html)
});
document.body.appendChild(leaveBtn);

// Controls legend
const legendDiv = document.createElement('div');
legendDiv.style.position = 'fixed';
legendDiv.style.top = '60px';
legendDiv.style.left = '16px';
legendDiv.style.zIndex = '1001';
legendDiv.style.background = 'rgba(34,34,34,0.92)';
legendDiv.style.color = '#ffe066';
legendDiv.style.padding = '12px 18px 12px 18px';
legendDiv.style.borderRadius = '8px';
legendDiv.style.fontSize = '1.05em';
legendDiv.style.fontFamily = 'sans-serif';
legendDiv.style.lineHeight = '1.6';
legendDiv.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)';
legendDiv.innerHTML = `
<b>Controls</b><br>
<span style="color:#fff">W/S</span> &mdash; Raise/Lower Camera<br>
<span style="color:#fff">A/D</span> &mdash; Orbit Camera<br>
<span style="color:#fff">Mouse Drag</span> &mdash; Look Around<br>
<span style="color:#fff">Mouse Wheel</span> &mdash; Zoom<br>
<span style="color:#fff">Click Die</span> &mdash; Roll Die<br>
`;
document.body.appendChild(legendDiv);


// --- Dice Action Menu ---
function createDiceMenu() {
    const diceMenuDiv = document.createElement('div');
    diceMenuDiv.style.position = 'fixed';
    diceMenuDiv.style.top = '320px';
    diceMenuDiv.style.left = '16px';
    diceMenuDiv.style.zIndex = '2001'; // ensure on top
    diceMenuDiv.style.background = 'rgba(34,34,34,0.92)';
    diceMenuDiv.style.color = '#ffe066';
    diceMenuDiv.style.padding = '12px 18px 12px 18px';
    diceMenuDiv.style.borderRadius = '8px';
    diceMenuDiv.style.fontSize = '1.05em';
    diceMenuDiv.style.fontFamily = 'sans-serif';
    diceMenuDiv.style.lineHeight = '1.6';
    diceMenuDiv.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)';
    diceMenuDiv.style.pointerEvents = 'auto';
    diceMenuDiv.innerHTML = `
<b>Dice Actions</b><br>
<button id="roll-d20-btn" style="margin:6px 0;width:100%;padding:7px 0;background:#222;color:#ffe066;border:1px solid #ffe066;border-radius:6px;cursor:pointer;">Roll Standard d20</button><br>
<button id="roll-adv-btn" style="margin:6px 0;width:100%;padding:7px 0;background:#222;color:#66e0ff;border:1px solid #66e0ff;border-radius:6px;cursor:pointer;">Roll d20 (Advantage)</button><br>
<button id="roll-dis-btn" style="margin:6px 0;width:100%;padding:7px 0;background:#222;color:#ff2222;border:1px solid #ff2222;border-radius:6px;cursor:pointer;">Roll d20 (Disadvantage)</button><br>
<button id="roll-d12-btn" style="margin:6px 0;width:100%;padding:7px 0;background:#222;color:#ffe066;border:1px solid #ffe066;border-radius:6px;cursor:pointer;">Roll 12</button><br>
<button id="put-away-dice-btn" style="margin:12px 0 0 0;width:100%;padding:7px 0;background:#222;color:#bbb;border:1px solid #bbb;border-radius:6px;cursor:pointer;">Put Away Dice</button>
`;
    document.body.appendChild(diceMenuDiv);
    // Button handlers must be set after adding to DOM
    document.getElementById('put-away-dice-btn').onclick = () => {
        if (typeof d20 !== 'undefined') d20.visible = false;
        if (typeof d20b !== 'undefined') d20b.visible = false;
        if (typeof d12 !== 'undefined') d12.visible = false;
        // Optionally clear result display
        if (typeof resultDiv !== 'undefined') resultDiv.innerHTML = '';
    };
    // ...existing code for other button handlers...
    document.getElementById('roll-d20-btn').onclick = () => {
        if (!falling && !rolling) {
            d20.visible = true;
            if (typeof d20b !== 'undefined') d20b.visible = false;
            if (typeof d12 !== 'undefined') d12.visible = false;
            falling = true;
            d20.position.y = dieInitialY;
            dieVelocity.set(0, 0, 0);
            dieVelocity.x = (Math.random() - 0.5) * 0.08;
            dieVelocity.z = (Math.random() - 0.5) * 0.08;
            dieAngularVelocity.x = 0.2 + Math.random() * 0.5;
            dieAngularVelocity.y = 0.2 + Math.random() * 0.5;
            spawnParticleBlast(d20.position.clone(), false);
        }
    };
    document.getElementById('roll-adv-btn').onclick = () => {
        if (!falling && !rolling && !fallingB && !rollingB) {
            d20.visible = true;
            d20b.visible = true;
            if (typeof d12 !== 'undefined') d12.visible = false;
            falling = true;
            d20.position.y = dieInitialY;
            dieVelocity.set(0, 0, 0);
            dieVelocity.x = (Math.random() - 0.5) * 0.08;
            dieVelocity.z = (Math.random() - 0.5) * 0.08;
            dieAngularVelocity.x = 0.2 + Math.random() * 0.5;
            dieAngularVelocity.y = 0.2 + Math.random() * 0.5;
            spawnParticleBlast(d20.position.clone(), false);

            fallingB = true;
            d20b.position.y = dieInitialY;
            dieVelocityB.set(0, 0, 0);
            dieVelocityB.x = (Math.random() - 0.5) * 0.08;
            dieVelocityB.z = (Math.random() - 0.5) * 0.08;
            dieAngularVelocityB.x = 0.2 + Math.random() * 0.5;
            dieAngularVelocityB.y = 0.2 + Math.random() * 0.5;
            spawnParticleBlast(d20b.position.clone(), true);
        }
    };
    document.getElementById('roll-dis-btn').onclick = () => {
        if (!falling && !rolling && !fallingB && !rollingB) {
            d20.visible = true;
            d20b.visible = true;
            if (typeof d12 !== 'undefined') d12.visible = false;
            falling = true;
            d20.position.y = dieInitialY;
            dieVelocity.set(0, 0, 0);
            dieVelocity.x = (Math.random() - 0.5) * 0.08;
            dieVelocity.z = (Math.random() - 0.5) * 0.08;
            dieAngularVelocity.x = 0.2 + Math.random() * 0.5;
            dieAngularVelocity.y = 0.2 + Math.random() * 0.5;
            spawnParticleBlast(d20.position.clone(), false);

            fallingB = true;
            d20b.position.y = dieInitialY;
            dieVelocityB.set(0, 0, 0);
            dieVelocityB.x = (Math.random() - 0.5) * 0.08;
            dieVelocityB.z = (Math.random() - 0.5) * 0.08;
            dieAngularVelocityB.x = 0.2 + Math.random() * 0.5;
            dieAngularVelocityB.y = 0.2 + Math.random() * 0.5;
            spawnParticleBlast(d20b.position.clone(), true);
        }
    };
    // ...add other button handlers as needed...
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createDiceMenu);
} else {
    createDiceMenu();
}

// Dice action handlers
document.getElementById('roll-d20-btn').onclick = () => {
    // Standard d20 roll: roll first d20 only
    if (!falling && !rolling) {
        // Only show d20
        d20.visible = true;
        if (typeof d20b !== 'undefined') d20b.visible = false;
        if (typeof d12 !== 'undefined') d12.visible = false;
        falling = true;
        d20.position.y = dieInitialY;
        dieVelocity.set(0, 0, 0);
        dieVelocity.x = (Math.random() - 0.5) * 0.08;
        dieVelocity.z = (Math.random() - 0.5) * 0.08;
        dieAngularVelocity.x = 0.2 + Math.random() * 0.5;
        dieAngularVelocity.y = 0.2 + Math.random() * 0.5;
        spawnParticleBlast(d20.position.clone(), false);
    }
};
document.getElementById('roll-adv-btn').onclick = () => {
    // Advantage: roll both d20 and d20b
    if (!falling && !rolling && !fallingB && !rollingB) {
        // Show both d20 and d20b
        d20.visible = true;
        d20b.visible = true;
        if (typeof d12 !== 'undefined') d12.visible = false;
        falling = true;
        d20.position.y = dieInitialY;
        dieVelocity.set(0, 0, 0);
        dieVelocity.x = (Math.random() - 0.5) * 0.08;
        dieVelocity.z = (Math.random() - 0.5) * 0.08;
        dieAngularVelocity.x = 0.2 + Math.random() * 0.5;
        dieAngularVelocity.y = 0.2 + Math.random() * 0.5;
        spawnParticleBlast(d20.position.clone(), false);

        fallingB = true;
        d20b.position.y = dieInitialY;
        dieVelocityB.set(0, 0, 0);
        dieVelocityB.x = (Math.random() - 0.5) * 0.08;
        dieVelocityB.z = (Math.random() - 0.5) * 0.08;
        dieAngularVelocityB.x = 0.2 + Math.random() * 0.5;
        dieAngularVelocityB.y = 0.2 + Math.random() * 0.5;
        spawnParticleBlast(d20b.position.clone(), true);
    }
};
document.getElementById('roll-dis-btn').onclick = () => {
    // Disadvantage: roll both d20 and d20b
    if (!falling && !rolling && !fallingB && !rollingB) {
        // Show both d20 and d20b
        d20.visible = true;
        d20b.visible = true;
        if (typeof d12 !== 'undefined') d12.visible = false;
        falling = true;
        d20.position.y = dieInitialY;
        dieVelocity.set(0, 0, 0);
        dieVelocity.x = (Math.random() - 0.5) * 0.08;
        dieVelocity.z = (Math.random() - 0.5) * 0.08;
        dieAngularVelocity.x = 0.2 + Math.random() * 0.5;
        dieAngularVelocity.y = 0.2 + Math.random() * 0.5;
        spawnParticleBlast(d20.position.clone(), false);

        fallingB = true;
        d20b.position.y = dieInitialY;
        dieVelocityB.set(0, 0, 0);
        dieVelocityB.x = (Math.random() - 0.5) * 0.08;
        dieVelocityB.z = (Math.random() - 0.5) * 0.08;
        dieAngularVelocityB.x = 0.2 + Math.random() * 0.5;
        dieAngularVelocityB.y = 0.2 + Math.random() * 0.5;
        spawnParticleBlast(d20b.position.clone(), true);
    }
};

// D12 roll button handler
document.getElementById('roll-d12-btn').onclick = () => {
    // Roll only the d12
    if (!fallingD12 && !rollingD12) {
        // Only show d12
        if (typeof d20 !== 'undefined') d20.visible = false;
        if (typeof d20b !== 'undefined') d20b.visible = false;
        d12.visible = true;
        fallingD12 = true;
        d12.position.y = dieInitialY;
        dieVelocityD12.set(0, 0, 0);
        dieVelocityD12.x = (Math.random() - 0.5) * 0.08;
        dieVelocityD12.z = (Math.random() - 0.5) * 0.08;
        dieAngularVelocityD12.x = 0.2 + Math.random() * 0.5;
        dieAngularVelocityD12.y = 0.2 + Math.random() * 0.5;
        spawnParticleBlast(d12.position.clone(), false);
    }
};

// Display winning numbers at the top of the screen
const resultDiv = document.createElement('div');
resultDiv.style.position = 'fixed';
resultDiv.style.top = '16px';
resultDiv.style.left = '50%';
resultDiv.style.transform = 'translateX(-50%)';
resultDiv.style.zIndex = '1002';
resultDiv.style.fontSize = '2.2em';
resultDiv.style.fontWeight = 'bold';
resultDiv.style.color = '#ffe066';
resultDiv.style.textShadow = '0 2px 8px #222, 0 0 8px #fff9c4';
resultDiv.style.pointerEvents = 'none';
document.body.appendChild(resultDiv);

// Animate
function animate() {
    // Orbit camera controls
    if (cameraMode === "orbit") {
        if (moveUp) orbitHeight += 0.12;
        if (moveDown) orbitHeight -= 0.12;
        const minHeight = 2.5 - (8 - 2.5) * 0.15;
        const maxHeight = 8 + (8 - 2.5) * 0.15;
        orbitHeight = Math.max(minHeight, Math.min(maxHeight, orbitHeight));
        if (orbitLeft) orbitAngle -= 0.04;
        if (orbitRight) orbitAngle += 0.04;
        camera.position.x = Math.sin(orbitAngle) * orbitRadius;
        camera.position.z = Math.cos(orbitAngle) * orbitRadius;
        camera.position.y = orbitHeight;
        camera.lookAt(0, -1.5, 0);
    }
    // --- Rain update ---
    updateRain();
    // First-person player controls
    // --- First-person Mouse Look ---
    // Pointer lock variables
    let pointerLocked = false;
    let mouseLookSensitivity = 0.0022;
    // Yaw and pitch are assumed to be fpYaw and fpPitch
    // Set up pointer lock controls if not already
    if (typeof window._mouseLookSetup === 'undefined') {
        window._mouseLookSetup = true;
        const canvas = renderer.domElement;
        canvas.tabIndex = 0;
        canvas.style.outline = 'none';
        // Request pointer lock on click in player mode
        canvas.addEventListener('click', function() {
            if (cameraMode === 'player' && !pointerLocked) {
                canvas.requestPointerLock();
            }
        });
        document.addEventListener('pointerlockchange', function() {
            pointerLocked = (document.pointerLockElement === canvas);
        });
        // Mouse move event for look
        document.addEventListener('mousemove', function(e) {
            if (pointerLocked && cameraMode === 'player') {
                fpYaw -= e.movementX * mouseLookSensitivity;
                fpPitch -= e.movementY * mouseLookSensitivity;
                // Clamp pitch to avoid flipping
                const maxPitch = Math.PI / 2 - 0.08;
                fpPitch = Math.max(-maxPitch, Math.min(maxPitch, fpPitch));
            }
        });
        // Optional: exit pointer lock on Escape
        document.addEventListener('keydown', function(e) {
            if (pointerLocked && e.key === 'Escape') {
                document.exitPointerLock();
            }
        });
    }
    if (cameraMode === "player") {
        // WASD movement relative to camera yaw (W/S = forward/back, A/D = strafe, but flipped)
        const moveSpeed = 0.08;
        let moveVec = new THREE.Vector3();
        // Flipped: W = back, S = forward, A = right, D = left
        if (fpForward) moveVec.z += 1;   // W = back
        if (fpBackward) moveVec.z -= 1;  // S = forward
        if (fpLeft) moveVec.x += 1;      // A = right
        if (fpRight) moveVec.x -= 1;     // D = left
        if (moveVec.lengthSq() > 0) {
            moveVec.normalize();
            // Rotate by yaw
            const cos = Math.cos(fpYaw), sin = Math.sin(fpYaw);
            const x = moveVec.x * cos - moveVec.z * sin;
            const z = moveVec.x * sin + moveVec.z * cos;
            moveVec.set(x, 0, z);
            // Save previous position
            const prevPos = playerMesh.position.clone();
            playerMesh.position.add(moveVec.multiplyScalar(moveSpeed));
            // Clamp player to tray/table area
            // Assume tray is centered at (0, 0), use trayRadius
            const px = playerMesh.position.x;
            const pz = playerMesh.position.z;
            const dist = Math.sqrt(px * px + pz * pz);
            const maxDist = tableRadius * 0.97 - 0.18; // stay inside table edge
            if (dist > maxDist) {
                // Clamp to edge
                playerMesh.position.x = (px / dist) * maxDist;
                playerMesh.position.z = (pz / dist) * maxDist;
            }
        }
        // Always clamp Y to table surface so player never falls through
        // If you have terrain heights, sample here; otherwise, use table top
        const minPlayerY = table.position.y + tableHeight / 2 + 0.18 * scaleFactor;
        if (playerMesh.position.y < minPlayerY) {
            playerMesh.position.y = minPlayerY;
        }
        // Camera follows head
        const headPos = playerMesh.position.clone().add(new THREE.Vector3(0, 0.18 * scaleFactor, 0));
        // Camera collision with tray edge: don't let camera go outside tray
        const camDist = Math.sqrt(headPos.x * headPos.x + headPos.z * headPos.z);
        const camMaxDist = tableRadius * 0.99 - 0.12;
        if (camDist > camMaxDist) {
            headPos.x = (headPos.x / camDist) * camMaxDist;
            headPos.z = (headPos.z / camDist) * camMaxDist;
        }
        camera.position.copy(headPos);
        // Look direction from yaw/pitch
        const lookDir = new THREE.Vector3(0, 0, 1)
            .applyAxisAngle(new THREE.Vector3(1, 0, 0), fpPitch)
            .applyAxisAngle(new THREE.Vector3(0, 1, 0), fpYaw);
        camera.lookAt(headPos.clone().add(lookDir));
    }
    requestAnimationFrame(animate);
    // ...existing code...
    // Gravity/falling animation for both dice
    // --- D20 ---
    if (falling) {
        dieVelocity.y += gravity;
        d20.position.add(dieVelocity);
        d20.rotation.x += dieAngularVelocity.x;
        d20.rotation.y += dieAngularVelocity.y;
        // Bowl collision
        const bowlCenter = diceBowl.position;
        const bowlRimY = diceBowl.position.y + bowlHeight / 2;
        const bowlInnerRadius = bowlRadius * 0.98 - radius * 0.9; // leave a little gap
        const dx = d20.position.x - bowlCenter.x;
        const dz = d20.position.z - bowlCenter.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (d20.position.y < bowlRimY && dist > bowlInnerRadius) {
            // Push back to bowl surface
            const push = (dist - bowlInnerRadius);
            d20.position.x -= (dx / dist) * push;
            d20.position.z -= (dz / dist) * push;
            // Stop velocity in that direction
            const vProj = (dieVelocity.x * dx + dieVelocity.z * dz) / dist;
            dieVelocity.x -= (dx / dist) * vProj;
            dieVelocity.z -= (dz / dist) * vProj;
        }
        // Bowl floor
        const bowlFloorY = diceBowl.position.y - bowlHeight / 2 + radius * 0.98;
        if (d20.position.y <= bowlFloorY) {
            d20.position.y = bowlFloorY;
            falling = false;
            dieVelocity.set(0, 0, 0);
            dieAngularVelocity.set(0, 0);
        }
    }
    // --- D20b ---
    if (fallingB) {
        dieVelocityB.y += gravity;
        d20b.position.add(dieVelocityB);
        d20b.rotation.x += dieAngularVelocityB.x;
        d20b.rotation.y += dieAngularVelocityB.y;
        // Bowl collision
        const bowlCenter = diceBowl.position;
        const bowlRimY = diceBowl.position.y + bowlHeight / 2;
        const bowlInnerRadius = bowlRadius * 0.98 - radius * 0.9;
        const dx = d20b.position.x - bowlCenter.x;
        const dz = d20b.position.z - bowlCenter.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (d20b.position.y < bowlRimY && dist > bowlInnerRadius) {
            const push = (dist - bowlInnerRadius);
            d20b.position.x -= (dx / dist) * push;
            d20b.position.z -= (dz / dist) * push;
            const vProj = (dieVelocityB.x * dx + dieVelocityB.z * dz) / dist;
            dieVelocityB.x -= (dx / dist) * vProj;
            dieVelocityB.z -= (dz / dist) * vProj;
        }
        // Bowl floor
        const bowlFloorY = diceBowl.position.y - bowlHeight / 2 + radius * 0.9;
        if (d20b.position.y <= bowlFloorY) {
            d20b.position.y = bowlFloorY;
            fallingB = false;
            dieVelocityB.set(0, 0, 0);
            dieAngularVelocityB.set(0, 0);
        }
    }
    // --- D12 ---
    if (fallingD12) {
        dieVelocityD12.y += gravity;
        d12.position.add(dieVelocityD12);
        d12.rotation.x += dieAngularVelocityD12.x;
        d12.rotation.y += dieAngularVelocityD12.y;
        // Bowl collision
        const bowlCenter = diceBowl.position;
        const bowlRimY = diceBowl.position.y + bowlHeight / 2;
        const bowlInnerRadius = bowlRadius * 0.98 - radius * 0.95;
        const dx = d12.position.x - bowlCenter.x;
        const dz = d12.position.z - bowlCenter.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (d12.position.y < bowlRimY && dist > bowlInnerRadius) {
            const push = (dist - bowlInnerRadius);
            d12.position.x -= (dx / dist) * push;
            d12.position.z -= (dz / dist) * push;
            const vProj = (dieVelocityD12.x * dx + dieVelocityD12.z * dz) / dist;
            dieVelocityD12.x -= (dx / dist) * vProj;
            dieVelocityD12.z -= (dz / dist) * vProj;
        }
        // Bowl floor
        const bowlFloorY = diceBowl.position.y - bowlHeight / 2 + radius * 0.95;
        if (d12.position.y <= bowlFloorY) {
            d12.position.y = bowlFloorY;
            fallingD12 = false;
            dieVelocityD12.set(0, 0, 0);
            dieAngularVelocityD12.set(0, 0);
        }
    }
    // Highlight top face for all dice independently
    let numA = null, numB = null, numD12 = null;
    if (d20 && d20.visible) numA = highlightTopFace(d20, d20FacesA, d20NumbersA, '#ffe066');
    if (d20b && d20b.visible) numB = highlightTopFace(d20b, d20FacesB, d20NumbersB, '#66e0ff');
    if (d12 && d12.visible) numD12 = highlightTopFace(d12, d12Faces, d12Numbers, '#ffe066');

    // Decide which value to show based on which dice are visible
    let resultHtml = '';
    if (d20 && d20.visible && (!d20b || !d20b.visible) && (!d12 || !d12.visible)) {
        // Standard d20
        resultHtml = `<span style="color:#fff">D20:</span> <span style="color:#ffe066">${numA}</span>`;
    } else if (d20 && d20.visible && d20b && d20b.visible && (!d12 || !d12.visible)) {
        // Advantage/disadvantage
        if (!falling && !fallingB && !rolling && !rollingB) {
            // Both dice have landed, decide which value to show
            if (document.activeElement && document.activeElement.id === 'roll-adv-btn') {
                // Advantage: show highest
                const advValue = Math.max(numA, numB);
                resultHtml = `<span style="color:#fff">Advantage:</span> <span style="color:#66e0ff">${advValue}</span>`;
            } else if (document.activeElement && document.activeElement.id === 'roll-dis-btn') {
                // Disadvantage: show lowest
                const disValue = Math.min(numA, numB);
                resultHtml = `<span style="color:#fff">Disadvantage:</span> <span style="color:#ff2222">${disValue}</span>`;
            } else {
                // Fallback: show both
                resultHtml = `<span style="color:#fff">D20(1):</span> <span style="color:#ffe066">${numA}</span> &nbsp; <span style="color:#fff">D20(2):</span> <span style="color:#8fd6ff">${numB}</span>`;
            }
        } else {
            // Still rolling, show both
            resultHtml = `<span style="color:#fff">D20(1):</span> <span style="color:#ffe066">${numA}</span> &nbsp; <span style="color:#fff">D20(2):</span> <span style="color:#8fd6ff">${numB}</span>`;
        }
    } else if (d12 && d12.visible && (!d20 || !d20.visible) && (!d20b || !d20b.visible)) {
        // Only d12
        resultHtml = `<span style="color:#fff">D12:</span> <span style="color:#ffe066">${numD12}</span>`;
    }
    resultDiv.innerHTML = resultHtml;
    // No idle spin
    // Procedural nighttime skybox (darker, animated stars)
    const skyCanvas = document.createElement('canvas');
    skyCanvas.width = 2048;
    skyCanvas.height = 2048;
    const skyCtx = skyCanvas.getContext('2d');

    // Store star data for animation
    const starCount = 900;
    const stars = [];
    for (let i = 0; i < starCount; i++) {
        stars.push({
            x: Math.random() * skyCanvas.width,
            y: Math.random() * skyCanvas.height,
            r: 0.3 + Math.random() * 0.7,
            twinkle: Math.random() * Math.PI * 2,
            speed: 0.5 + Math.random() * 1.5,
            alpha: 0.5 + Math.random() * 0.5
        });
    }

    // ...existing code...
// Place the bowl on the table, to the right
diceBowl.position.set(tableRadius * 0.7, table.position.y + tableHeight + bowlHeight / 2 + 0.05, 0);
scene.add(diceBowl);


    // Add a solid gold base to the bowl (moved out of animate)
    const baseThickness = bowlHeight * 0.12;
    const baseGeometry = new THREE.CylinderGeometry(bowlRadius * 0.95, bowlRadius * 0.95, baseThickness, 32);
    const baseMaterial = new THREE.MeshStandardMaterial({
        color: GOLD_COLOR,   // gold color
        metalness: 1.0,
        roughness: 0.18
    });
    const bowlBase = new THREE.Mesh(baseGeometry, baseMaterial);
    bowlBase.position.set(
        diceBowl.position.x,
        diceBowl.position.y - bowlHeight / 2 + baseThickness / 2,
        diceBowl.position.z
    );
    scene.add(bowlBase);
    // Animate skybox stars
    drawSky();
    skyTexture.needsUpdate = true;
    // Flicker candle flame and light
    const flicker = 0.98 + Math.sin(Date.now() * 0.008) * 0.04 + Math.random() * 0.02;
    candleLight.intensity = 1.2 * flicker;
    flame.scale.set(flicker, flicker * 1.25, flicker);
    // Animate flame shader
    if (flame.material.uniforms && flame.material.uniforms.time) {
        flame.material.uniforms.time.value = performance.now() * 0.001;
    }

    // Animate particle blasts
    for (let i = particleBlasts.length - 1; i >= 0; i--) {
        const { group, start } = particleBlasts[i];
        const elapsed = (performance.now() - start) / 1000;
        for (let j = 0; j < group.children.length; j++) {
            const mesh = group.children[j];
            mesh.userData.age += 0.016;
            // Fade out
            mesh.material.opacity = Math.max(0, 1 - mesh.userData.age / PARTICLE_LIFETIME);
            mesh.material.transparent = true;
            // Move
            mesh.position.add(mesh.userData.velocity.clone().multiplyScalar(0.016));
        }
        if (elapsed > PARTICLE_LIFETIME) {
            scene.remove(group);
            particleBlasts.splice(i, 1);
        }
    }

    // Animate floating crate bobbing up and down
    if (crate) {
        const t = performance.now() * 0.001;
        crate.position.y = oceanY + crateSize / 2 + 0.18 + Math.sin(t * 1.1 + crateBobPhase) * 0.22;
        crate.rotation.y = crateBobPhase + Math.sin(t * 0.7) * 0.18;
        crate.rotation.x = Math.sin(t * 0.5 + crateBobPhase) * 0.07;
        crate.rotation.z = Math.cos(t * 0.6 + crateBobPhase) * 0.07;
    }

    // Mouse look only (disabled for orbit)
    // camera.rotation.order = 'YXZ';
    // camera.rotation.y = yaw;
    // camera.rotation.x = pitch;
    // Keep camera above and angled down
    // camera.position.y = Math.max(camera.position.y, 2.5);

    // Animate waterfall
    if (waterfallUniforms && waterfallUniforms.time) {
        waterfallUniforms.time.value = performance.now() * 0.001;
    }
    renderer.render(scene, camera);
}

animate();