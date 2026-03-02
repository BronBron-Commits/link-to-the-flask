// Camera vertical movement controls
let moveUp = false, moveDown = false;
let orbitLeft = false, orbitRight = false;
document.addEventListener('keydown', (e) => {
    if (e.code === 'KeyW') moveUp = true;
    if (e.code === 'KeyS') moveDown = true;
    if (e.code === 'KeyA') orbitLeft = true;
    if (e.code === 'KeyD') orbitRight = true;
});
document.addEventListener('keyup', (e) => {
    if (e.code === 'KeyW') moveUp = false;
    if (e.code === 'KeyS') moveDown = false;
    if (e.code === 'KeyA') orbitLeft = false;
    if (e.code === 'KeyD') orbitRight = false;
});
import * as THREE from './three.module.js';

const scene = new THREE.Scene();

// Particle blast system
const particleBlasts = [];
const PARTICLE_COUNT = 32;
const PARTICLE_LIFETIME = 0.7; // seconds
const PARTICLE_SIZE = 0.065; // half as small
const GOLD_COLOR = 0xffe066; // gold (matches die veins)
const ROYAL_BLUE_COLOR = 0x1a237e; // royal blue (matches die base)
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
    // Fill pure black
    skyCtx.fillStyle = '#000000';
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

const camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
);
// Camera orbit state
let orbitAngle = 0;
const orbitRadius = 6;
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
    // Zoom in/out by changing camera FOV (frame zoom)
    const fovSpeed = 2;
    camera.fov += e.deltaY > 0 ? fovSpeed : -fovSpeed;
    // Clamp FOV
    camera.fov = Math.max(15, Math.min(90, camera.fov));
    camera.updateProjectionMatrix();
});

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

const d20 = new THREE.Mesh(d20Geometry, d20Material);
scene.add(d20);
d20.visible = false;

// D12 die
const d12 = new THREE.Mesh(d12Geometry, d12Material);
d12.position.set(-1.2, 0, 0); // Offset d12 to the left
scene.add(d12);
d12.visible = false;

// Add second die (d20b)
const d20b = new THREE.Mesh(d20Geometry.clone(), d20Material.clone());
d20b.position.set(1.2, 0, 0); // Offset second die to the right
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

// Roll dice on click
renderer.domElement.addEventListener('click', (e) => {
    // Raycast to check if any die was clicked
    const mouse = new THREE.Vector2(
        (e.clientX / renderer.domElement.clientWidth) * 2 - 1,
        -(e.clientY / renderer.domElement.clientHeight) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, camera);
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
    ctx.font = 'bold 90px Arial';
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
    ctx.font = 'bold 90px Arial';
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
const tableRadius = 4.0;
const tableHeight = 0.3;
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

// --- Dice Tray ---
// A shallow cylinder with a felt-like material, slightly smaller than the table
const trayRadius = tableRadius * 0.7;
const trayHeight = 0.12;
const trayY = table.position.y + tableHeight / 2 + trayHeight / 2 + 0.01;
const trayGeometry = new THREE.CylinderGeometry(trayRadius, trayRadius, trayHeight, 48);
// Create a more prominent PBR-style felt texture
const trayFeltCanvas = document.createElement('canvas');
trayFeltCanvas.width = 512;
trayFeltCanvas.height = 512;
const trayFeltCtx = trayFeltCanvas.getContext('2d');
// Fill with base purple
trayFeltCtx.fillStyle = '#7c3aed';
trayFeltCtx.fillRect(0, 0, trayFeltCanvas.width, trayFeltCanvas.height);
// Add high-contrast noise and fibers
for (let y = 0; y < trayFeltCanvas.height; y++) {
    for (let x = 0; x < trayFeltCanvas.width; x++) {
        const noise = Math.floor(Math.random() * 40) - 20; // -20 to +19
        const base = 124 + noise; // base purple (124, 58, 237)
        trayFeltCtx.fillStyle = `rgb(${Math.max(0,Math.min(255,base))},${58 + noise / 2},${237 + noise})`;
        trayFeltCtx.fillRect(x, y, 1, 1);
    }
}
// Add more prominent fibers
for (let i = 0; i < 120; i++) {
    trayFeltCtx.save();
    trayFeltCtx.globalAlpha = 0.18 + Math.random() * 0.15;
    trayFeltCtx.strokeStyle = Math.random() < 0.5 ? '#a78bfa' : '#4c1d95'; // light or dark purple fiber
    trayFeltCtx.lineWidth = 1.2 + Math.random() * 2.2;
    if (Math.random() < 0.5) {
        // Horizontal fiber
        const y = Math.random() * trayFeltCanvas.height;
        trayFeltCtx.beginPath();
        trayFeltCtx.moveTo(0, y);
        trayFeltCtx.lineTo(trayFeltCanvas.width, y + Math.random() * 12 - 6);
        trayFeltCtx.stroke();
    } else {
        // Vertical fiber
        const x = Math.random() * trayFeltCanvas.width;
        trayFeltCtx.beginPath();
        trayFeltCtx.moveTo(x, 0);
        trayFeltCtx.lineTo(x + Math.random() * 12 - 6, trayFeltCanvas.height);
        trayFeltCtx.stroke();
    }
    trayFeltCtx.restore();
}
const trayFeltTexture = new THREE.CanvasTexture(trayFeltCanvas);
trayFeltTexture.wrapS = THREE.RepeatWrapping;
trayFeltTexture.wrapT = THREE.RepeatWrapping;
trayFeltTexture.repeat.set(3, 3);

// Create a bump/normal map for felt (simulate soft roughness)
const trayFeltBumpCanvas = document.createElement('canvas');
trayFeltBumpCanvas.width = 512;
trayFeltBumpCanvas.height = 512;
const trayFeltBumpCtx = trayFeltBumpCanvas.getContext('2d');
for (let y = 0; y < trayFeltBumpCanvas.height; y++) {
    for (let x = 0; x < trayFeltBumpCanvas.width; x++) {
        const n = Math.floor(Math.random() * 80) + 80; // 80-159
        trayFeltBumpCtx.fillStyle = `rgb(${n},${n},${n})`;
        trayFeltBumpCtx.fillRect(x, y, 1, 1);
    }
}
// Add some fiber streaks to bump
for (let i = 0; i < 60; i++) {
    trayFeltBumpCtx.save();
    trayFeltBumpCtx.globalAlpha = 0.18 + Math.random() * 0.12;
    trayFeltBumpCtx.strokeStyle = '#bbb';
    trayFeltBumpCtx.lineWidth = 1 + Math.random() * 1.5;
    if (Math.random() < 0.5) {
        const y = Math.random() * trayFeltBumpCanvas.height;
        trayFeltBumpCtx.beginPath();
        trayFeltBumpCtx.moveTo(0, y);
        trayFeltBumpCtx.lineTo(trayFeltBumpCanvas.width, y + Math.random() * 8 - 4);
        trayFeltBumpCtx.stroke();
    } else {
        const x = Math.random() * trayFeltBumpCanvas.width;
        trayFeltBumpCtx.beginPath();
        trayFeltBumpCtx.moveTo(x, 0);
        trayFeltBumpCtx.lineTo(x + Math.random() * 8 - 4, trayFeltBumpCanvas.height);
        trayFeltBumpCtx.stroke();
    }
    trayFeltBumpCtx.restore();
}
const trayFeltBumpTexture = new THREE.CanvasTexture(trayFeltBumpCanvas);
trayFeltBumpTexture.wrapS = THREE.RepeatWrapping;
trayFeltBumpTexture.wrapT = THREE.RepeatWrapping;
trayFeltBumpTexture.repeat.set(3, 3);

// Create a roughness map (darker = rougher)
const trayFeltRoughCanvas = document.createElement('canvas');
trayFeltRoughCanvas.width = 512;
trayFeltRoughCanvas.height = 512;
const trayFeltRoughCtx = trayFeltRoughCanvas.getContext('2d');
for (let y = 0; y < trayFeltRoughCanvas.height; y++) {
    for (let x = 0; x < trayFeltRoughCanvas.width; x++) {
        const n = Math.floor(Math.random() * 120) + 60; // 60-179
        trayFeltRoughCtx.fillStyle = `rgb(${n},${n},${n})`;
        trayFeltRoughCtx.fillRect(x, y, 1, 1);
    }
}
const trayFeltRoughTexture = new THREE.CanvasTexture(trayFeltRoughCanvas);
trayFeltRoughTexture.wrapS = THREE.RepeatWrapping;
trayFeltRoughTexture.wrapT = THREE.RepeatWrapping;
trayFeltRoughTexture.repeat.set(3, 3);

const trayMaterial = new THREE.MeshStandardMaterial({
    color: 0x7c3aed, // purple felt
    roughness: 0.92,
    metalness: 0.13,
    map: trayFeltTexture,
    bumpMap: trayFeltBumpTexture,
    bumpScale: 0.13,
    roughnessMap: trayFeltRoughTexture
});
const tray = new THREE.Mesh(trayGeometry, trayMaterial);
tray.position.set(0, trayY, 0);
scene.add(tray);


// Fireplace (simple box with glowing fire)
// Fireplace removed

// Bookshelves (tall boxes)
// Bookshelves removed

// Add a lit candle to the table

// Candle shape: more realistic (tapered, melted)
const candleHeight = 0.72;
const candleRadiusTop = 0.11; // Tapered top
const candleRadiusBottom = 0.17;
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
const candleEdgeDist = tableRadius - candleRadiusBottom - 0.11;
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
flame.position.set(candleX, candle.position.y + candleHeight / 2 + 0.06, candleZ);
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
    // Camera vertical movement with W/S
    if (moveUp) orbitHeight += 0.12;
    if (moveDown) orbitHeight -= 0.12;
    // Unclamp W/S range by 15%
    const minHeight = 2.5 - (8 - 2.5) * 0.15; // 15% lower
    const maxHeight = 8 + (8 - 2.5) * 0.15;   // 15% higher
    orbitHeight = Math.max(minHeight, Math.min(maxHeight, orbitHeight));

    // Camera orbit with A/D
    if (orbitLeft) orbitAngle -= 0.04;
    if (orbitRight) orbitAngle += 0.04;

    // Update camera position to orbit around table center
    camera.position.x = Math.sin(orbitAngle) * orbitRadius;
    camera.position.z = Math.cos(orbitAngle) * orbitRadius;
    camera.position.y = orbitHeight;
    camera.lookAt(0, -1.5, 0);
    requestAnimationFrame(animate);
    // Gravity/falling animation for both dice
    if (falling) {
        dieVelocity.y += gravity;
        d20.position.add(dieVelocity);
        d20.rotation.x += dieAngularVelocity.x;
        d20.rotation.y += dieAngularVelocity.y;
        const tableTopY = table.position.y + tableHeight / 2 + radius;
        if (d20.position.y <= tableTopY) {
            d20.position.y = tableTopY;
            falling = false;
            dieVelocity.set(0, 0, 0);
            dieAngularVelocity.set(0, 0);
        }
    }
    if (fallingB) {
        dieVelocityB.y += gravity;
        d20b.position.add(dieVelocityB);
        d20b.rotation.x += dieAngularVelocityB.x;
        d20b.rotation.y += dieAngularVelocityB.y;
        const tableTopY = table.position.y + tableHeight / 2 + radius;
        if (d20b.position.y <= tableTopY) {
            d20b.position.y = tableTopY;
            fallingB = false;
            dieVelocityB.set(0, 0, 0);
            dieAngularVelocityB.set(0, 0);
        }
    }
    if (fallingD12) {
        dieVelocityD12.y += gravity;
        d12.position.add(dieVelocityD12);
        d12.rotation.x += dieAngularVelocityD12.x;
        d12.rotation.y += dieAngularVelocityD12.y;
        const tableTopY = table.position.y + tableHeight / 2 + radius * 0.95;
        if (d12.position.y <= tableTopY) {
            d12.position.y = tableTopY;
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
                resultHtml = `<span style=\"color:#fff\">Advantage:</span> <span style=\"color:#66e0ff\">${advValue}</span>`;
            } else if (document.activeElement && document.activeElement.id === 'roll-dis-btn') {
                // Disadvantage: show lowest
                const disValue = Math.min(numA, numB);
                resultHtml = `<span style=\"color:#fff\">Disadvantage:</span> <span style=\"color:#ff2222\">${disValue}</span>`;
            } else {
                // Fallback: show both
                resultHtml = `<span style=\"color:#fff\">D20(1):</span> <span style=\"color:#ffe066\">${numA}</span> &nbsp; <span style=\"color:#fff\">D20(2):</span> <span style=\"color:#8fd6ff\">${numB}</span>`;
            }
        } else {
            // Still rolling, show both
            resultHtml = `<span style=\"color:#fff\">D20(1):</span> <span style=\"color:#ffe066\">${numA}</span> &nbsp; <span style=\"color:#fff\">D20(2):</span> <span style=\"color:#8fd6ff\">${numB}</span>`;
        }
    } else if (d12 && d12.visible && (!d20 || !d20.visible) && (!d20b || !d20b.visible)) {
        // Only d12
        resultHtml = `<span style=\"color:#fff\">D12:</span> <span style=\"color:#ffe066\">${numD12}</span>`;
    }
    resultDiv.innerHTML = resultHtml;
    // No idle spin
    // ...existing code...
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

    // Mouse look only (disabled for orbit)
    // camera.rotation.order = 'YXZ';
    // camera.rotation.y = yaw;
    // camera.rotation.x = pitch;
    // Keep camera above and angled down
    // camera.position.y = Math.max(camera.position.y, 2.5);

    renderer.render(scene, camera);
}

animate();