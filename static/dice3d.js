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
const light = new THREE.DirectionalLight(0xffffff, 1);
light.position.set(5, 10, 5);
scene.add(light);

const ambient = new THREE.AmbientLight(0xffffff, 0.4);
scene.add(ambient);

// D20
const radius = 0.6;
const d20Geometry = new THREE.IcosahedronGeometry(radius, 0);

// Edge highlight (glow) setup
const EDGE_GLOW_COLOR = 0x8fd6ff; // light blue
let d20EdgeGlow = null;
let d20bEdgeGlow = null;
let d20Hovered = false;
let d20bHovered = false;

// Create procedural royal blue + gold veins texture
const d20Canvas = document.createElement('canvas');
d20Canvas.width = 512;
d20Canvas.height = 512;
const d20Ctx = d20Canvas.getContext('2d');

// Fill royal blue
d20Ctx.fillStyle = '#1a237e'; // Royal blue
d20Ctx.fillRect(0, 0, d20Canvas.width, d20Canvas.height);

// Gold noise veins
for (let i = 0; i < 1200; i++) {
    const x = Math.random() * d20Canvas.width;
    const y = Math.random() * d20Canvas.height;
    const angle = Math.random() * Math.PI * 2;
    const length = 40 + Math.random() * 60;
    d20Ctx.save();
    d20Ctx.translate(x, y);
    d20Ctx.rotate(angle);
    d20Ctx.beginPath();
    d20Ctx.moveTo(0, 0);
    d20Ctx.lineTo(length, 0);
    d20Ctx.lineWidth = 2 + Math.random() * 2;
    // Blend gold with blue for veins
    const blueGold = 'rgba(60, 90, 200, 0.7)'; // deep blue
    const gold = 'rgba(180, 160, 80, 0.35)'; // muted gold
    d20Ctx.strokeStyle = Math.random() < 0.7 ? blueGold : gold;
    d20Ctx.shadowColor = 'rgba(60, 90, 200, 0.3)';
    d20Ctx.shadowBlur = 4;
    d20Ctx.stroke();
    d20Ctx.restore();
}

const d20Texture = new THREE.CanvasTexture(d20Canvas);
const d20Material = new THREE.MeshStandardMaterial({
    map: d20Texture,
    color: 0xffffff,
    metalness: 0.5,
    roughness: 0.3
});

const d20 = new THREE.Mesh(d20Geometry, d20Material);
scene.add(d20);

// Add second die
const d20b = new THREE.Mesh(d20Geometry.clone(), d20Material.clone());
d20b.position.set(1.2, 0, 0); // Offset second die to the right
scene.add(d20b);

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

// Second die animation state
let rollingB = false;
let fallingB = false;
let dieVelocityB = new THREE.Vector3(0, 0, 0);
let dieAngularVelocityB = new THREE.Vector2(0, 0);

// Roll dice on click
renderer.domElement.addEventListener('click', (e) => {
    // Raycast to check if either die was clicked
    const mouse = new THREE.Vector2(
        (e.clientX / renderer.domElement.clientWidth) * 2 - 1,
        -(e.clientY / renderer.domElement.clientHeight) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects([d20, d20b], true);
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
            // Spawn particle blast at die position
            spawnParticleBlast(d20.position.clone(), false);
        } else if ((obj === d20b || d20b.children.includes(obj)) && !fallingB && !rollingB) {
            fallingB = true;
            d20b.position.y = dieInitialY;
            dieVelocityB.set(0, 0, 0);
            dieVelocityB.x = (Math.random() - 0.5) * 0.08;
            dieVelocityB.z = (Math.random() - 0.5) * 0.08;
            dieAngularVelocityB.x = 0.2 + Math.random() * 0.5;
            dieAngularVelocityB.y = 0.2 + Math.random() * 0.5;
            // Spawn particle blast at second die position
            spawnParticleBlast(d20b.position.clone(), true);
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
    const intersects = raycaster.intersectObjects([d20, d20b], true);
    let foundD20 = false, foundD20b = false;
    for (let i = 0; i < intersects.length; i++) {
        if (intersects[i].object === d20 || d20.children.includes(intersects[i].object)) foundD20 = true;
        if (intersects[i].object === d20b || d20b.children.includes(intersects[i].object)) foundD20b = true;
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
});

// ---- FIXED FACE EXTRACTION ----
const positionAttr = d20Geometry.attributes.position;
let outwardOffset = 0.028; // Reduced distance to move numbers outside faces

// Store face centers and normals for each die separately
const d20FacesA = [];
const d20FacesB = [];
const d20NumbersA = [];
const d20NumbersB = [];
for (let i = 0; i < positionAttr.count; i += 3) {
    // Each triangle = 3 vertices
    const vA = new THREE.Vector3().fromBufferAttribute(positionAttr, i);
    const vB = new THREE.Vector3().fromBufferAttribute(positionAttr, i + 1);
    const vC = new THREE.Vector3().fromBufferAttribute(positionAttr, i + 2);
    // Face center
    const center = new THREE.Vector3()
        .add(vA)
        .add(vB)
        .add(vC)
        .divideScalar(3);
    // Correct outward normal
    const normal = new THREE.Vector3()
        .crossVectors(
            vB.clone().sub(vA),
            vC.clone().sub(vA)
        )
        .normalize();
    // Ensure normal points outward
    if (normal.dot(center) < 0) {
        normal.negate();
    }
    d20FacesA.push({ center: center.clone(), normal: normal.clone() });
    d20FacesB.push({ center: center.clone(), normal: normal.clone() });
    // Create number texture
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffe066'; // lighter gold
    ctx.strokeStyle = '#fff9c4'; // pale gold outline
    ctx.lineWidth = 8; // half original line width
    ctx.font = 'bold 90px Arial'; // half original font size
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
    const planeA = new THREE.Mesh(
        new THREE.PlaneGeometry(0.5, 0.5),
        planeAMaterial
    );
    // Position slightly outside face
    planeA.position.copy(
        center.clone().add(
            normal.clone().multiplyScalar(outwardOffset)
        )
    );
    // Face outward
    planeA.lookAt(
        planeA.position.clone().add(normal)
    );
    d20.add(planeA);
    d20NumbersA.push(planeA);

    // Add numbers to second die (separate mesh, unique material)
    const planeBMaterial = planeAMaterial.clone();
    const planeB = new THREE.Mesh(
        new THREE.PlaneGeometry(0.5, 0.5),
        planeBMaterial
    );
    planeB.position.copy(
        center.clone().add(
            normal.clone().multiplyScalar(outwardOffset)
        )
    );
    planeB.lookAt(
        planeB.position.clone().add(normal)
    );
    d20b.add(planeB);
    d20NumbersB.push(planeB);
}

// Highlight top face for both dice
function highlightTopFace(die, faces) {
    let maxDot = -Infinity;
    let topIdx = -1;
    for (let i = 0; i < faces.length; i++) {
        // World normal
        const worldNormal = faces[i].normal.clone().applyQuaternion(die.quaternion);
        // Up vector
        const dot = worldNormal.dot(new THREE.Vector3(0, 1, 0));
        if (dot > maxDot) {
            maxDot = dot;
            topIdx = i;
        }
    }
    // Remove highlighting: all numbers same color and opacity
    let numberMeshes;
    let highlightColor;
    if (die === d20) {
        numberMeshes = d20NumbersA;
        highlightColor = '#ffe066'; // bright yellow for die 1
    } else if (die === d20b) {
        numberMeshes = d20NumbersB;
        highlightColor = '#66e0ff'; // bright blue for die 2
    } else {
        numberMeshes = die.children;
        highlightColor = '#ffffff';
    }
    for (let i = 0; i < numberMeshes.length; i++) {
        numberMeshes[i].material.color.set('#ffffff');
        numberMeshes[i].material.opacity = 0.85;
        numberMeshes[i].material.emissive = undefined;
        numberMeshes[i].material.emissiveIntensity = undefined;
    }
    // Glow the top face
    if (topIdx >= 0 && numberMeshes[topIdx]) {
        numberMeshes[topIdx].material.color.set(highlightColor);
        numberMeshes[topIdx].material.opacity = 1.0;
        // Add emissive glow if MeshStandardMaterial
        if (numberMeshes[topIdx].material.emissive !== undefined) {
            numberMeshes[topIdx].material.emissive.set(highlightColor);
            numberMeshes[topIdx].material.emissiveIntensity = 0.8;
        }
    }
    return topIdx + 1; // Face number
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
    // Alternate plank colors for realism
    const baseColor = i % 2 === 0 ? '#3a2410' : '#5a3b1a'; // much darker browns
    tableCtx.fillStyle = baseColor;
    tableCtx.fillRect(0, i * plankHeight, tableCanvas.width, plankHeight);
    // Draw plank edge shadow
    tableCtx.beginPath();
    tableCtx.moveTo(0, (i + 1) * plankHeight);
    tableCtx.lineTo(tableCanvas.width, (i + 1) * plankHeight);
    tableCtx.lineWidth = 3.2;
    tableCtx.strokeStyle = 'rgba(30, 20, 10, 0.38)'; // darker plank edge
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
        tableCtx.strokeStyle = 'rgba(40, 28, 14, 0.28)'; // darker grain
        tableCtx.stroke();
    }
    // Add a few knots
    for (let k = 0; k < 2; k++) {
        const knotX = Math.random() * tableCanvas.width;
        const knotY = (i * plankHeight) + Math.random() * plankHeight;
        const knotR = 6 + Math.random() * 7;
        const grad = tableCtx.createRadialGradient(knotX, knotY, 1, knotX, knotY, knotR);
        grad.addColorStop(0, 'rgba(30,20,10,0.32)');
        grad.addColorStop(1, 'rgba(30,20,10,0)');
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

// Fireplace (simple box with glowing fire)
// Fireplace removed

// Bookshelves (tall boxes)
// Bookshelves removed

// Add a lit candle to the table
const candleHeight = 0.7; // Increased height
const candleRadius = 0.16; // Increased radius
const candleGeometry = new THREE.CylinderGeometry(candleRadius, candleRadius, candleHeight, 32);
const candleMaterial = new THREE.MeshStandardMaterial({ color: 0xf5e6c2, roughness: 0.6 });
const candle = new THREE.Mesh(candleGeometry, candleMaterial);
const candleX = -tableRadius * 0.65; // Move to left side
candle.position.set(candleX, -1.5 + tableHeight / 2 + candleHeight / 2, 0.7);
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
flame.position.set(candleX, candle.position.y + candleHeight / 2 + 0.06, 0.7);
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
    // Highlight top face for both dice independently
    const numA = highlightTopFace(d20, d20FacesA);
    const numB = highlightTopFace(d20b, d20FacesB);
    // Display result at top of screen
    resultDiv.textContent = `Die 1: ${numA}   Die 2: ${numB}`;
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